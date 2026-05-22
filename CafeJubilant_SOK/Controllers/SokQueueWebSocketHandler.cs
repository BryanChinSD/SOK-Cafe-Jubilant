using CafeJubilant_SOK.Models;
using CafeJubilant_SOK.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace CafeJubilant_SOK.Controllers
{
    public class SokQueueWebSocketHandler
    {
        private readonly RequestDelegate _next;
        private readonly WebSocketConnectionManager _wsManager;
        private readonly ILogger<SokQueueWebSocketHandler> _logger;
        private readonly SOKOrderController _orderController; // Inject controller to access orders
        private readonly OrderStore _orderStore;

        public SokQueueWebSocketHandler(
                RequestDelegate next,
                WebSocketConnectionManager wsManager,
                ILogger<SokQueueWebSocketHandler> logger,
                OrderStore orderStore) // ✅ Only inject the service
        {
            _next = next;
            _wsManager = wsManager;
            _logger = logger;
            _orderStore = orderStore;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            await HandleAsync(context);
        }
   
        public async Task HandleAsync(HttpContext context)
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = 400;
                return;
            }

            var socket = await context.WebSockets.AcceptWebSocketAsync();

            var deviceId = context.Request.Query["deviceId"].ToString();
            var deviceType = context.Request.Query["type"].ToString();

            if (string.IsNullOrEmpty(deviceId) || string.IsNullOrEmpty(deviceType))
            {
                await socket.CloseAsync(
                    WebSocketCloseStatus.PolicyViolation,
                    "deviceId and type are required",
                    CancellationToken.None);
                return;
            }

            var connectionId = $"{deviceType}_{deviceId}";
            await _wsManager.AddSocketAsync(connectionId, socket, deviceType);

            _logger.LogInformation("Device connected: {ConnectionId}", connectionId);

            // Send welcome message
            var welcomeMsg = JsonSerializer.Serialize(new
            {
                type = "connection",
                status = "connected",
                deviceId,
                deviceType,
                timestamp = DateTime.UtcNow
            });
            await _wsManager.SendMessageAsync(connectionId, welcomeMsg);

            // If POS connects, send initial orders
            if (deviceType == "pos")
            {
                await SendInitialOrdersToPos(deviceId);
            }

            await ReceiveMessagesAsync(socket, connectionId, deviceType, deviceId);
        }

        private async Task SendInitialOrdersToPos(string posDeviceId)
        {
            try
            {
                // Directly access in-memory orders from controller
                var orders = SOKOrderController.GetAllOrdersInternal();

                var message = JsonSerializer.Serialize(new
                {
                    type = "initial_sync",
                    orders,
                    timestamp = DateTime.UtcNow
                });

                await _wsManager.SendMessageAsync($"pos_{posDeviceId}", message);
                _logger.LogInformation("Initial order sync sent to POS {PosId}", posDeviceId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending initial orders to POS {PosId}", posDeviceId);
            }
        }

        private async Task ReceiveMessagesAsync(
            WebSocket socket,
            string connectionId,
            string deviceType,
            string deviceId)
        {
            var buffer = new byte[1024 * 4];

            try
            {
                while (socket.State == WebSocketState.Open)
                {
                    var result = await socket.ReceiveAsync(
                        new ArraySegment<byte>(buffer),
                        CancellationToken.None);

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await socket.CloseAsync(
                            WebSocketCloseStatus.NormalClosure,
                            "Closed by client",
                            CancellationToken.None);
                        break;
                    }

                    var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    _logger.LogInformation("Received from {ConnectionId}: {Message}",
                        connectionId, message);

                    await HandleMessageAsync(message, connectionId, deviceType, deviceId);
                }
            }
            catch (WebSocketException ex)
            {
                _logger.LogError(ex, "WebSocket error for {ConnectionId}", connectionId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in WebSocket connection: {ConnectionId}", connectionId);
            }
            finally
            {
                await _wsManager.RemoveSocketAsync(connectionId);
                _logger.LogInformation("Device disconnected: {ConnectionId}", connectionId);
            }
        }

        private async Task HandleMessageAsync(
            string message,
            string connectionId,
            string deviceType,
            string deviceId)
        {
            try
            {
                var command = JsonSerializer.Deserialize<QueueCommand>(message);

                if (command == null)
                {
                    _logger.LogWarning("Invalid message format from {ConnectionId}", connectionId);
                    return;
                }

                _logger.LogInformation("Command from {ConnectionId}: {Action} -> {Target}",
                    connectionId, command.Action, command.TargetDeviceId);

                if (deviceType == "pos")
                {
                    await HandlePosCommand(command, deviceId);
                }
                else if (deviceType == "sok")
                {
                    await HandleSokResponse(command, deviceId);
                }
            }
            catch (JsonException ex)
            {
                _logger.LogError(ex, "JSON parsing error from {ConnectionId}", connectionId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error handling message from {ConnectionId}", connectionId);
            }
        }

        private async Task HandlePosCommand(QueueCommand command, string posDeviceId)
        {
            var targetSokId = $"sok_{command.TargetDeviceId}";

            command.SourceDeviceId = posDeviceId;
            var message = JsonSerializer.Serialize(command);

            await _wsManager.SendMessageAsync(targetSokId, message);

            var ack = new
            {
                type = "acknowledgment",
                status = "sent",
                action = command.Action,
                targetDevice = command.TargetDeviceId,
                queueNumber = command.QueueNumber,
                timestamp = DateTime.UtcNow
            };

            var ackMessage = JsonSerializer.Serialize(ack);
            await _wsManager.SendMessageAsync($"pos_{posDeviceId}", ackMessage);

            _logger.LogInformation("Command routed from POS {PosId} to SOK {SokId}",
                posDeviceId, command.TargetDeviceId);
        }

        private async Task HandleSokResponse(QueueCommand command, string sokDeviceId)
        {
            if (!string.IsNullOrEmpty(command.TargetDeviceId))
            {
                var targetPosId = $"pos_{command.TargetDeviceId}";
                command.SourceDeviceId = sokDeviceId;

                var message = JsonSerializer.Serialize(command);
                await _wsManager.SendMessageAsync(targetPosId, message);

                _logger.LogInformation("Response sent from SOK {SokId} to POS {PosId}",
                    sokDeviceId, command.TargetDeviceId);
            }
        }
    }
}
