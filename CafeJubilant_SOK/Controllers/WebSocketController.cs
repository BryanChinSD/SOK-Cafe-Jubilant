using CafeJubilant_SOK.Models;
using CafeJubilant_SOK.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Concurrent;
using System.Net.Http;
using System.Net.WebSockets;
using System.Numerics;
using System.Reflection;
using System.Reflection.Metadata;
using System.Text;
using System.Text.Json;
using static CafeJubilant_SOK.Models.KioskModel;
using static System.Runtime.InteropServices.JavaScript.JSType;
using static System.Runtime.InteropServices.Marshalling.IIUnknownCacheStrategy;

namespace CafeJubilant_SOK.Controllers
{
    [ApiController]
    [Route("API/ws")]
    public class WebSocketController : ControllerBase
    {

        private readonly WebSocketConnectionManager _wsManager;
        private readonly ILogger<WebSocketController> _logger;
        private static readonly ConcurrentDictionary<string, KioskModel.SOKOrder> _orders = new();
        private readonly SOKOrderController _sokOrderController;
        private readonly SokCRM _sokCrm;
        private readonly Dictionary<string, object> _pendingMemberLogins = new();
        private static readonly ConcurrentDictionary<string, object> _pendingPaymentOrderData = new();
        public WebSocketController(WebSocketConnectionManager wsManager, ILogger<WebSocketController> logger)
        {
            _wsManager = wsManager;
            _logger = logger;

        }

        /// <summary>
        /// WebSocket connection endpoint
        /// Usage: ws://localhost:5000/API/ws/connect?device_id=01&outlet=Jewel&type=sok
        /// </summary>
        [HttpGet("connect")]
        public async Task Connect(
        [FromQuery] string device_id,
        [FromQuery] string outlet,
        [FromQuery] string type = "sok")
        {
            if (!HttpContext.WebSockets.IsWebSocketRequest)
            {
                HttpContext.Response.StatusCode = 400;
                await HttpContext.Response.WriteAsync("WebSocket request expected.");
                return;
            }

            if (string.IsNullOrWhiteSpace(device_id))
            {
                HttpContext.Response.StatusCode = 400;
                await HttpContext.Response.WriteAsync("device_id is required.");
                return;
            }

            if (string.IsNullOrWhiteSpace(outlet))
            {
                HttpContext.Response.StatusCode = 400;
                await HttpContext.Response.WriteAsync("outlet is required.");
                return;
            }

            WebSocket socket = null;
            string connectionId = $"{device_id}_{DateTime.UtcNow.Ticks}";
            string deviceConnectionKey = device_id;

            try
            {
                var existingSocket = _wsManager.GetSocketById(deviceConnectionKey);
                if (existingSocket != null)
                {
                    _logger.LogWarning("⚠️ Connection {DeviceId} already exists, forcing cleanup", deviceConnectionKey);

                    if (existingSocket.State == WebSocketState.Open ||
                        existingSocket.State == WebSocketState.CloseReceived)
                    {
                        try
                        {
                            await existingSocket.CloseAsync(
                                WebSocketCloseStatus.NormalClosure,
                                "New connection replacing old one",
                                CancellationToken.None);
                        }
                        catch (Exception closeEx)
                        {
                            _logger.LogWarning(closeEx, "Failed to gracefully close old socket for {DeviceId}", deviceConnectionKey);
                        }
                    }

                    await _wsManager.RemoveSocketAsync(deviceConnectionKey);

                    int retries = 0;
                    while (_wsManager.GetSocketById(deviceConnectionKey) != null && retries < 10)
                    {
                        await Task.Delay(100);
                        retries++;
                    }

                    if (retries >= 10)
                    {
                        _logger.LogError("❌ Failed to cleanup old connection for {DeviceId} after {Retries} retries",
                            deviceConnectionKey, retries);
                    }
                    else
                    {
                        _logger.LogInformation("✅ Old connection cleaned up after {Retries} retries", retries);
                    }
                }

                socket = await HttpContext.WebSockets.AcceptWebSocketAsync();
                await _wsManager.AddSocketAsync(deviceConnectionKey, socket, type, outlet);

                _logger.LogInformation(
                    "✅ WebSocket connected: DeviceKey={DeviceKey}, Type={Type}, DeviceId={DeviceId}, Outlet={Outlet}",
                    deviceConnectionKey, type, device_id, outlet
                );

                try
                {
                    var confirmMessage = new
                    {
                        action = "connected",
                        connectionId = deviceConnectionKey,
                        deviceId = device_id,
                        type,
                        outlet,
                        timestamp = DateTime.UtcNow
                    };
                    await _wsManager.SendMessageAsync(deviceConnectionKey, confirmMessage);
                }
                catch (Exception confirmEx)
                {
                    _logger.LogWarning(confirmEx,
                        "⚠️ Failed to send connection confirmation to {DeviceId}, but connection is established",
                        deviceConnectionKey);
                }

                await Listen(deviceConnectionKey, device_id, socket);
            }
            catch (WebSocketException wsEx) when (
                wsEx.WebSocketErrorCode == WebSocketError.ConnectionClosedPrematurely)
            {
                _logger.LogWarning("⚠️ WebSocket connection closed prematurely during handshake for DeviceId={DeviceId}",
                    device_id);

                if (deviceConnectionKey != null)
                {
                    await _wsManager.RemoveSocketAsync(deviceConnectionKey);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error establishing WebSocket connection for DeviceId={DeviceId}", device_id);

                if (deviceConnectionKey != null)
                {
                    await _wsManager.RemoveSocketAsync(deviceConnectionKey);
                }

                if (socket != null &&
                    (socket.State == WebSocketState.Open || socket.State == WebSocketState.Connecting))
                {
                    try
                    {
                        await socket.CloseAsync(
                            WebSocketCloseStatus.InternalServerError,
                            "Connection error",
                            CancellationToken.None
                        );
                    }
                    catch
                    {
                        // Ignore errors during error cleanup
                    }
                }
            }
        }

        private async Task Listen(string connectionId, string deviceId, WebSocket socket)
        {
            var buffer = new byte[1024 * 64];
            var receiveTimeout = TimeSpan.FromSeconds(3000);
            var pingInterval = TimeSpan.FromSeconds(30);
            var lastPingTime = DateTime.UtcNow;

            _logger.LogInformation("🎧 Started listening for {ConnectionId}", connectionId);

            try
            {
                while (socket.State == WebSocketState.Open)
                {
                    try
                    {
                        if (DateTime.UtcNow - lastPingTime >= pingInterval)
                        {
                            try
                            {
                                var pingMessage = JsonSerializer.Serialize(new
                                {
                                    action = "ping",
                                    timestamp = DateTime.UtcNow
                                });
                                await _wsManager.SendMessageAsync(connectionId, pingMessage);
                                lastPingTime = DateTime.UtcNow;
                                _logger.LogTrace("📤 Sent ping to {ConnectionId}", connectionId);
                            }
                            catch (Exception ex)
                            {
                                _logger.LogWarning(ex, "Failed to send ping to {ConnectionId}", connectionId);
                                break;
                            }
                        }

                        using var cts = new CancellationTokenSource(receiveTimeout);

                        WebSocketReceiveResult result;
                        try
                        {
                            result = await socket.ReceiveAsync(
                                new ArraySegment<byte>(buffer),
                                cts.Token
                            );
                        }
                        catch (OperationCanceledException)
                        {
                            _logger.LogWarning("⏰ No activity for {Timeout}s on {ConnectionId}",
                                receiveTimeout.TotalSeconds, connectionId);
                            break;
                        }

                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            _logger.LogInformation("🔌 Client requested close: {ConnectionId}", connectionId);
                            break;
                        }

                        if (result.MessageType == WebSocketMessageType.Text)
                        {
                            var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                            _logger.LogDebug("📩 Received from {ConnectionId}: {Message}",
                                connectionId, message);
                            await HandleIncomingMessage(connectionId, message);
                        }
                    }
                    catch (WebSocketException wsEx) when (
                        wsEx.WebSocketErrorCode == WebSocketError.ConnectionClosedPrematurely)
                    {
                        _logger.LogWarning("⚠️ Connection closed prematurely for {ConnectionId}", connectionId);
                        break;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "❌ Error in receive loop for {ConnectionId}", connectionId);
                        break;
                    }
                }

                _logger.LogInformation("🛑 Listen loop exited for {ConnectionId}, State: {State}",
                    connectionId, socket.State);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Fatal error listening to WebSocket {ConnectionId}", connectionId);
            }
            finally
            {
                await _wsManager.RemoveSocketAsync(connectionId);

                if (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived)
                {
                    try
                    {
                        await socket.CloseAsync(
                            WebSocketCloseStatus.NormalClosure,
                            "Connection closed",
                            CancellationToken.None
                        );
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Error closing WebSocket {ConnectionId}", connectionId);
                    }
                }

                socket?.Dispose();
                _logger.LogInformation("❌ WebSocket disconnected and disposed: {ConnectionId}", connectionId);
            }
        }

        private async Task HandleIncomingMessage(string connectionId, string message)
        {
            try
            {
                _logger.LogInformation("🔍 Received from {ConnectionId}: {Message}",
                    connectionId, message.Substring(0, Math.Min(200, message.Length)));

                var json = JsonSerializer.Deserialize<JsonElement>(message);

                // Check for simplified format first
                if (!json.TryGetProperty("action", out var action))
                {
                    _logger.LogInformation("📦 No 'action' property - checking for simplified format");

                    if (json.TryGetProperty("deviceId", out var devId) &&
                        json.TryGetProperty("orderData", out var orderData))
                    {
                        _logger.LogInformation("✅ Simplified format detected!");
                        await HandleSimplifiedUpdate(connectionId, json);
                        return;
                    }

                    _logger.LogWarning("⚠️ Unknown format from {ConnectionId}", connectionId);
                    return;
                }

                var actionType = action.GetString();

                switch (actionType)
                {
                    case "ping":
                        await _wsManager.SendMessageAsync(connectionId, new
                        {
                            action = "pong",
                            timestamp = DateTime.UtcNow
                        });
                        break;

                    case "heartbeat":
                        _logger.LogDebug("💓 Heartbeat from {ConnectionId}", connectionId);
                        break;

                    case "pong":
                        _logger.LogDebug("💓 Pong received from {ConnectionId}", connectionId);
                        break;

                    // UPDATE/CREATE ACTIONS
                    case "update_items":
                    case "item_quantity_changed":
                    case "cache_update":
                        await HandleCacheUpdateFromClient(connectionId, json);
                        break;

                    // DELETE ACTIONS
                    case "delete_order":
                        await HandleDeleteOrder(connectionId, json);
                        break;

                    case "delete_item":
                        await HandleDeleteItem(connectionId, json);
                        break;

                    case "clear_cache":
                        await HandleClearCache(connectionId, json);
                        break;

                    // READ/QUERY ACTIONS
                    case "get_order":
                        await HandleGetOrder(connectionId, json);
                        break;

                    case "get_orders":
                        await HandleGetOrders(connectionId, json);
                        break;

                    case "get_cache":
                        await HandleGetCache(connectionId, json);
                        break;

                    // ✅ PAYMENT ACTIONS - ENHANCED
                    case "checkout":
                        await HandleCheckout(connectionId, json);
                        break;

                    case "payment_status_update":
                        await HandlePaymentStatusUpdate(connectionId, json);
                        break;

                    case "payment_processing":
                        await HandlePaymentProcessing(connectionId, json);
                        break;

                    case "payment_complete":
                        await HandlePaymentComplete(connectionId, json);
                        break;

                    case "payment_failed":
                        await HandlePaymentFailed(connectionId, json);
                        break;

                    case "order_complete":
                        await HandleOrderComplete(connectionId, json);
                        break;

                    case "payment_modal_opened":
                        await HandlePaymentModalOpened(connectionId, json);
                        break;

                    case "payment_modal_closed":
                        await HandlePaymentModalClosed(connectionId, json);
                        break;

                    case "payment_initiated":
                        await HandlePaymentInitiated(connectionId, json);
                        break;

                    case "terminal_check_started":
                        await HandleTerminalCheckStarted(connectionId, json);
                        break;

                    case "terminal_status":
                        await HandleTerminalStatus(connectionId, json);
                        break;

                    case "card_presented":
                        await HandleCardPresented(connectionId, json);
                        break;

                    case "payment_response_received":
                        await HandlePaymentResponseReceived(connectionId, json);
                        break;

                    case "payment_success":
                        await HandlePaymentSuccess(connectionId, json);
                        break;

                    case "order_submitting":
                        await HandleOrderSubmitting(connectionId, json);
                        break;

                    case "ordering_page_closed":
                        await HandleOrderingPageClosed(connectionId, json);
                        break;

                    case "payment_page_closed":
                        await HandlePaymentModalClosed(connectionId, json);
                        break;

                    case "set_service_type":
                        _logger.LogInformation("🖥️ POS triggered set_service_type");
                        await HandleSetServiceType(connectionId, json);
                        break;

                    case "member_login":
                        _logger.LogInformation("👤 POS triggered member_login");
                        await HandleMemberLogin(connectionId, json);
                        break;

                    case "voucher_modal_open":
                    case "voucher_modal_close":
                    case "voucher_filter_change":
                    case "voucher_apply":
                    case "voucher_apply_result":
                    case "voucher_remove":
                    case "voucher_remove_result":
                    case "member_logout":
                    case "voucher_state_sync":
                        await HandleVoucherAction(connectionId, json);
                        break;

                    default:
                        _logger.LogDebug("Unknown action: {Action}", actionType);
                        await _wsManager.SendMessageAsync(connectionId, new
                        {
                            action = "error",
                            message = $"Unknown action: {actionType}",
                            timestamp = DateTime.UtcNow
                        });
                        break;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error in HandleIncomingMessage");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "error",
                    message = "Internal server error",
                    timestamp = DateTime.UtcNow
                });
            }
        }


        private async Task HandleVoucherAction(string connectionId, JsonElement message)
        {
            try
            {
                var action = message.GetProperty("action").GetString();
                var deviceId = message.TryGetProperty("deviceId", out var d) ? d.GetString() : connectionId;

                _logger.LogInformation("🎟️ Voucher action: {Action} from {DeviceId}", action, deviceId);

                // Broadcast to all OTHER SOK devices (exclude sender)
                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;

                var notification = new
                {
                    action,
                    deviceId,
                    // Forward the entire message payload transparently
                    data = message,
                    timestamp = DateTime.UtcNow
                };

                foreach (var connId in sokDevices.Where(c => c != connectionId))
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, message); // forward raw
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to forward {Action} to {ConnId}", action, connId);
                    }
                }

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = $"{action}_ack",
                    success = true,
                    deliveredCount = successCount,
                    timestamp = DateTime.UtcNow
                });

                _logger.LogInformation("✅ {Action} forwarded to {Count} devices", action, successCount);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling voucher action");
            }
        }

        private async Task HandleSetServiceType(string connectionId, JsonElement message)
        {
            try
            {
                var serviceType = message.TryGetProperty("serviceType", out var st)
                    ? st.GetString()
                    : null;

                var language = message.TryGetProperty("language", out var lang)
                    ? lang.GetString()
                    : "en";

                var targetDeviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : null;

                if (string.IsNullOrWhiteSpace(serviceType) ||
                    (serviceType != "T" && serviceType != "E"))
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "set_service_type_response",
                        success = false,
                        error = "Invalid serviceType",
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                if (string.IsNullOrWhiteSpace(targetDeviceId))
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "set_service_type_response",
                        success = false,
                        error = "Missing targetDeviceId",
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                _logger.LogInformation(
                    "🖥️ set_service_type: ServiceType={ServiceType}, TargetDevice={DeviceId}",
                    serviceType, targetDeviceId);

                var notification = new
                {
                    action = "set_service_type",
                    serviceType,
                    language,
                    deviceId = targetDeviceId,
                    timestamp = DateTime.UtcNow
                };

                var sokDevices = _wsManager.GetConnectedDevices("sok");

                int successCount = 0;

                foreach (var connId in sokDevices.ToList()) // thread-safe snapshot
                {
                    try
                    {
                        // ✅ Use existing GetDeviceInfoById method
                        var deviceInfo = _wsManager.GetDeviceInfoById(connId);
                        if (deviceInfo == null)
                            continue;

                        if (!string.Equals(deviceInfo.DeviceId,
                                           targetDeviceId,
                                           StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }

                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;

                        _logger.LogInformation(
                            "✅ set_service_type sent to DeviceId={DeviceId}, ConnId={ConnId}",
                            deviceInfo.DeviceId, connId);

                        break; // DeviceId should be unique
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex,
                            "Failed to send set_service_type to {ConnId}", connId);
                    }
                }

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "set_service_type_response",
                    success = successCount > 0,
                    serviceType,
                    deviceId = targetDeviceId,
                    deliveredCount = successCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling set_service_type");

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "set_service_type_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }


        /// <summary>
        /// Handle ordering_page_closed - notify all devices that ordering is closed
        /// </summary>
        private async Task HandleOrderingPageClosed(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var outlet = message.TryGetProperty("outlet", out var outletProp)
                    ? outletProp.GetString()
                    : "default";

                var reason = message.TryGetProperty("reason", out var reasonProp)
                    ? reasonProp.GetString()
                    : "Ordering temporarily unavailable";


                _logger.LogWarning(
                    "🚫 Ordering page CLOSED: Outlet={Outlet}, Reason={Reason}",
                    outlet, reason);

                // Build notification
                var notification = new
                {
                    action = "ordering_page_closed",
                    deviceId,
                    outlet,
                    reason,
                    timestamp = DateTime.UtcNow
                };

                // Broadcast to all SOK devices
                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;

                foreach (var connId in sokDevices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to send ordering closed notification to {ConnId}", connId);
                    }
                }

                _logger.LogInformation(
                    "✅ Ordering closed broadcasted: Outlet={Outlet}, Notified: {Success}/{Total} devices",
                    outlet, successCount, sokDevices.Count);

                // Send acknowledgment back to sender
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "ordering_page_closed_response",
                    success = true,
                    outlet,
                    broadcastSuccess = successCount,
                    timestamp = DateTime.UtcNow
                });

            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling ordering_page_closed");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "ordering_page_closed_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }


        private async Task HandleMemberLogin(string connectionId, JsonElement message)
        {
            try
            {
                var targetDeviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : null;

                var phoneNumber = message.TryGetProperty("phoneNumber", out var phone)
                    ? phone.GetString()
                    : null;

                if (string.IsNullOrWhiteSpace(targetDeviceId))
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "member_login_response",
                        success = false,
                        error = "Missing targetDeviceId",
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                if (string.IsNullOrWhiteSpace(phoneNumber))
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "member_login_response",
                        success = false,
                        error = "Missing phoneNumber",
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                _logger.LogInformation(
                    "👤 member_login: TargetDevice={DeviceId}, Phone={Phone}",
                    targetDeviceId, phoneNumber);

                var notification = new
                {
                    action = "member_login",
                    phoneNumber,
                    deviceId = targetDeviceId,
                    timestamp = DateTime.UtcNow
                };

                var sokDevices = _wsManager.GetConnectedDevices("sok");

                _logger.LogInformation("🔍 SOK devices found: {Count} → {Devices}",
                    sokDevices.Count,
                    string.Join(", ", sokDevices.Select(c => {
                        var d = _wsManager.GetDeviceInfoById(c);
                        return $"{d?.DeviceId}({c})";
                    })));

                int successCount = 0;

                foreach (var connId in sokDevices.ToList())
                {
                    try
                    {
                        var deviceInfo = _wsManager.GetDeviceInfoById(connId);
                        if (deviceInfo == null) continue;

                        _logger.LogInformation(
                            "🔍 Checking connId={ConnId}, DeviceId={DeviceId}, Target={Target}",
                            connId, deviceInfo.DeviceId, targetDeviceId);

                        if (!string.Equals(deviceInfo.DeviceId, targetDeviceId,
                                StringComparison.OrdinalIgnoreCase))
                            continue;

                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;

                        _logger.LogInformation(
                            "✅ member_login forwarded to DeviceId={DeviceId}, ConnId={ConnId}",
                            deviceInfo.DeviceId, connId);
                        break;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to send member_login to {ConnId}", connId);
                    }
                }

                if (successCount == 0)
                {
                    _logger.LogWarning(
                        "⚠️ Device {DeviceId} not connected - storing pending member_login",
                        targetDeviceId);

                    _pendingMemberLogins[targetDeviceId] = notification;
                }

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "member_login_response",
                    success = successCount > 0,
                    deviceId = targetDeviceId,
                    deliveredCount = successCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling member_login");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "member_login_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }



        private async Task SendMemberLoginResponse(
            string connectionId,
            bool success,
            string? errorMessage = null,
            DeviceConnectionInfo? deviceInfo = null)
        {
            await _wsManager.SendMessageAsync(connectionId, new
            {
                action = "member_login_response",
                success,
                message = errorMessage,
                member = deviceInfo == null ? null : new
                {
                    memberId = deviceInfo.MemberId,
                    name = deviceInfo.MemberName,
                    phone = deviceInfo.MemberPhone,
                    points = deviceInfo.MemberPoints
                }
            });
        }

        private async Task HandlePaymentModalClosed(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;
                var orderId = message.TryGetProperty("orderId", out var oid)
                    ? oid.GetString()
                    : null;
                var tableNo = message.TryGetProperty("tableNo", out var tn)
                    ? tn.GetString()
                    : null;
                var orderType = message.TryGetProperty("orderType", out var ot)
                    ? ot.GetString()
                    : null;
                var amount = message.TryGetProperty("amount", out var amt)
                    ? amt.GetDecimal()
                    : 0m;
                var itemCount = message.TryGetProperty("itemCount", out var ic)
                    ? ic.GetInt32()
                    : 0;

                var outlet = message.TryGetProperty("outlet", out var outletProp)
                    ? outletProp.GetString()
                    : "default";

                var reason = message.TryGetProperty("reason", out var reasonProp)
                    ? reasonProp.GetString()
                    : "Payment page closed";

                _logger.LogInformation(
                    "🚫 Payment modal closed: DeviceId={DeviceId}, OrderId={OrderId}, Table={TableNo}, Amount={Amount}",
                    deviceId, orderId, tableNo, amount);

                // Build notification
                var notification = new
                {
                    action = "payment_page_closed",
                    deviceId,
                    orderId,
                    tableNo,
                    orderType,
                    amount,
                    itemCount,
                    outlet,
                    reason,
                    timestamp = DateTime.UtcNow
                };

                // Broadcast to all SOK devices (optional - for other devices to see)
                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;
                foreach (var connId in sokDevices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to send payment modal closed notification to {ConnId}", connId);
                    }
                }

                _logger.LogInformation(
                    "✅ Payment modal closed broadcasted: {OrderId}, Notified: {Success}/{Total} devices",
                    orderId, successCount, sokDevices.Count);

                // Send acknowledgment back to sender
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_page_closed_response",
                    success = true,
                    deviceId,
                    orderId,
                    amount,
                    broadcastSuccess = successCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling payment_modal_closed");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_page_closed_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }
        private async Task HandlePaymentInitiated(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId) ? devId.GetString() : connectionId;
                var orderId = message.TryGetProperty("orderId", out var oid) ? oid.GetString() : null;
                var sessionId = message.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;
                var paymentMethod = message.TryGetProperty("paymentMethod", out var pm) ? pm.GetString() : null;
                var amount = message.TryGetProperty("amount", out var amt) ? amt.GetDecimal() : 0m;

                _logger.LogInformation(
                    "🚀 Payment initiated: DeviceId={DeviceId}, OrderId={OrderId}, SessionId={SessionId}, Method={Method}, Amount={Amount}",
                    deviceId, orderId, sessionId, paymentMethod, amount);

                // Broadcast to all SOK devices
                var notification = new
                {
                    action = "payment_initiated",
                    deviceId,
                    orderId,
                    sessionId,
                    paymentMethod,
                    amount,
                    timestamp = DateTime.UtcNow
                };

                await BroadcastToSokDevices(notification, connectionId);

                // Send acknowledgment
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_initiated_response",
                    success = true,
                    deviceId,
                    orderId,
                    sessionId,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling payment_initiated");
            }
        }

        private async Task HandleTerminalCheckStarted(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId) ? devId.GetString() : connectionId;
                var orderId = message.TryGetProperty("orderId", out var oid) ? oid.GetString() : null;
                var sessionId = message.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;

                _logger.LogInformation(
                    "🔌 Terminal check started: DeviceId={DeviceId}, OrderId={OrderId}, SessionId={SessionId}",
                    deviceId, orderId, sessionId);

                var notification = new
                {
                    action = "terminal_check_started",
                    deviceId,
                    orderId,
                    sessionId,
                    timestamp = DateTime.UtcNow
                };

                await BroadcastToSokDevices(notification, connectionId);

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "terminal_check_started_response",
                    success = true,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling terminal_check_started");
            }
        }

        private async Task HandleTerminalStatus(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId) ? devId.GetString() : connectionId;
                var orderId = message.TryGetProperty("orderId", out var oid) ? oid.GetString() : null;
                var sessionId = message.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;
                var isConnected = message.TryGetProperty("isConnected", out var ic) ? ic.GetBoolean() : false;
                var status = message.TryGetProperty("status", out var st) ? st.GetString() : "unknown";

                _logger.LogInformation(
                    "🔌 Terminal status: DeviceId={DeviceId}, Connected={IsConnected}, Status={Status}",
                    deviceId, isConnected, status);

                var notification = new
                {
                    action = "terminal_status",
                    deviceId,
                    orderId,
                    sessionId,
                    isConnected,
                    status,
                    timestamp = DateTime.UtcNow
                };

                await BroadcastToSokDevices(notification, connectionId);

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "terminal_status_response",
                    success = true,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling terminal_status");
            }
        }

        private async Task HandleCardPresented(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId) ? devId.GetString() : connectionId;
                var orderId = message.TryGetProperty("orderId", out var oid) ? oid.GetString() : null;
                var sessionId = message.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;

                _logger.LogInformation("💳 Card presented: DeviceId={DeviceId}, OrderId={OrderId}", deviceId, orderId);

                var notification = new
                {
                    action = "card_presented",
                    deviceId,
                    orderId,
                    sessionId,
                    timestamp = DateTime.UtcNow
                };

                await BroadcastToSokDevices(notification, connectionId);

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "card_presented_response",
                    success = true,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling card_presented");
            }
        }

        private async Task HandlePaymentResponseReceived(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId) ? devId.GetString() : connectionId;
                var responseCode = message.TryGetProperty("responseCode", out var rc) ? rc.GetString() : null;
                var responseMessage = message.TryGetProperty("responseMessage", out var rm) ? rm.GetString() : null;

                _logger.LogInformation(
                    "📨 Payment response: DeviceId={DeviceId}, Code={Code}, Message={Message}",
                    deviceId, responseCode, responseMessage);

                var notification = new
                {
                    action = "payment_response_received",
                    deviceId,
                    responseCode,
                    responseMessage,
                    timestamp = DateTime.UtcNow
                };

                await BroadcastToSokDevices(notification, connectionId);

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_response_received_response",
                    success = true,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling payment_response_received");
            }
        }

        private async Task HandlePaymentSuccess(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId) ? devId.GetString() : connectionId;
                var orderId = message.TryGetProperty("orderId", out var oid) ? oid.GetString() : null;
                var transactionId = message.TryGetProperty("transactionId", out var tid) ? tid.GetString() : null;
                var amount = message.TryGetProperty("amount", out var amt) ? amt.GetDecimal() : 0m;

                object orderData = null;
                Dictionary<string, object> orderDataDict = null;

                // 1️⃣ Try from message
                if (message.TryGetProperty("orderData", out var orderDataElement) &&
                    orderDataElement.ValueKind != JsonValueKind.Null)
                {
                    try
                    {
                        orderDataDict = JsonSerializer.Deserialize<Dictionary<string, object>>(
                            orderDataElement.GetRawText(),
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                        );
                        _logger.LogInformation("✅ [payment_success] OrderData from message");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "⚠️ [payment_success] Failed to deserialize orderData from message");
                    }
                }

                // 2️⃣ Fallback: cache by orderId
                if (orderDataDict == null && !string.IsNullOrEmpty(orderId))
                {
                    try
                    {
                        var cacheEntry = SOKOrderController.FindCacheByOrderId(orderId);
                        if (cacheEntry.HasValue && cacheEntry.Value.Value.OrderData != null)
                        {
                            orderDataDict = JsonSerializer.Deserialize<Dictionary<string, object>>(
                                JsonSerializer.Serialize(cacheEntry.Value.Value.OrderData),
                                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                            );
                            _logger.LogInformation("✅ [payment_success] OrderData from cache by orderId: {OrderId}", orderId);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "⚠️ [payment_success] Cache lookup by orderId failed");
                    }
                }

                // 3️⃣ Fallback: cache by deviceId key
                if (orderDataDict == null && !string.IsNullOrEmpty(deviceId))
                {
                    foreach (var orderType in new[] { "E", "T", "D" })
                    {
                        var cacheKey = $"{deviceId}_{orderType}";
                        if (SOKOrderController._orderCaches.TryGetValue(cacheKey, out var cache) &&
                            cache.OrderData?.SalesDtls?.Count > 0)
                        {
                            try
                            {
                                orderDataDict = JsonSerializer.Deserialize<Dictionary<string, object>>(
                                    JsonSerializer.Serialize(cache.OrderData),
                                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                                );
                                _logger.LogInformation("✅ [payment_success] OrderData from cache key: {CacheKey}", cacheKey);
                                break;
                            }
                            catch (Exception ex)
                            {
                                _logger.LogWarning(ex, "⚠️ [payment_success] Failed to deserialize cache key: {CacheKey}", cacheKey);
                            }
                        }
                    }
                }

                // ✅ SAVE to pending store so order_complete can retrieve it
                // Key by deviceId — order_complete arrives very shortly after
                if (orderDataDict != null && !string.IsNullOrEmpty(deviceId))
                {
                    _pendingPaymentOrderData[deviceId] = orderDataDict;
                    _logger.LogInformation("💾 [payment_success] Saved orderData to pending store for deviceId: {DeviceId}", deviceId);
                }

                orderData = orderDataDict;

                _logger.LogInformation(
                    "✅ Payment success: DeviceId={DeviceId}, OrderId={OrderId}, Amount={Amount}, TxnId={TxnId}, HasOrderData={HasOrderData}",
                    deviceId, orderId, amount, transactionId, orderData != null);

                var notification = new
                {
                    action = "payment_success",
                    deviceId,
                    orderId,
                    transactionId,
                    amount,
                    orderData,
                    timestamp = DateTime.UtcNow
                };

                var sokDevices = _wsManager.GetConnectedDevices("sok");

                if (sokDevices == null || sokDevices.Count == 0)
                {
                    _logger.LogWarning("⚠️ No SOK devices connected for payment_success broadcast");
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "payment_success_response",
                        success = true,
                        broadcastCount = 0,
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                var recipientDevices = sokDevices.ToList();
                var broadcastTasks = recipientDevices.Select(deviceConnectionId =>
                    Task.Run(async () =>
                    {
                        try
                        {
                            await _wsManager.SendMessageAsync(deviceConnectionId, notification);
                            return true;
                        }
                        catch (WebSocketException wsEx)
                        {
                            _logger.LogWarning("❌ WebSocket error to {ConnId}: {Error}", deviceConnectionId, wsEx.Message);
                            if (wsEx.WebSocketErrorCode == WebSocketError.ConnectionClosedPrematurely)
                                await _wsManager.RemoveSocketAsync(deviceConnectionId);
                            return false;
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "❌ Failed to send payment_success to {ConnId}", deviceConnectionId);
                            return false;
                        }
                    })
                ).ToList();

                var results = await Task.WhenAll(broadcastTasks);
                var successCount = results.Count(r => r);
                var failCount = results.Count(r => !r);

                _logger.LogInformation(
                    "✅ payment_success broadcast: {Success}/{Total} devices, {Failed} failed",
                    successCount, recipientDevices.Count, failCount);

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_success_response",
                    success = true,
                    broadcastSuccess = successCount,
                    broadcastFailed = failCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling payment_success");
                try
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "payment_success_response",
                        success = false,
                        error = ex.Message,
                        timestamp = DateTime.UtcNow
                    });
                }
                catch { }
            }
        }
        private async Task HandleOrderSubmitting(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId) ? devId.GetString() : connectionId;
                var orderId = message.TryGetProperty("orderId", out var oid) ? oid.GetString() : null;
                var itemCount = message.TryGetProperty("itemCount", out var ic) ? ic.GetInt32() : 0;
                var totalAmount = message.TryGetProperty("totalAmount", out var ta) ? ta.GetDecimal() : 0m;

                _logger.LogInformation(
                    "📤 Order submitting: DeviceId={DeviceId}, OrderId={OrderId}, Items={Items}, Amount={Amount}",
                    deviceId, orderId, itemCount, totalAmount);

                var notification = new
                {
                    action = "order_submitting",
                    deviceId,
                    orderId,
                    itemCount,
                    totalAmount,
                    timestamp = DateTime.UtcNow
                };

                await BroadcastToSokDevices(notification, connectionId);

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "order_submitting_response",
                    success = true,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling order_submitting");
            }
        }

        // Helper method to broadcast to all SOK devices
        private async Task BroadcastToSokDevices(object notification, string excludeConnectionId = null)
        {
            var sokDevices = _wsManager.GetConnectedDevices("sok");
            int successCount = 0;

            foreach (var connId in sokDevices)
            {
                if (connId != excludeConnectionId)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to broadcast to {ConnId}", connId);
                    }
                }
            }

            _logger.LogDebug("Broadcasted to {Count}/{Total} SOK devices", successCount, sokDevices.Count);
        }

        /// <summary>
        /// Handle payment_modal_opened - payment selection modal displayed
        /// </summary>
        private async Task HandlePaymentModalOpened(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var orderId = message.TryGetProperty("orderId", out var oid)
                    ? oid.GetString()
                    : null;

                var tableNo = message.TryGetProperty("tableNo", out var tn)
                    ? tn.GetString()
                    : null;

                var orderType = message.TryGetProperty("orderType", out var ot)
                    ? ot.GetString()
                    : null;

                var amount = message.TryGetProperty("amount", out var amt)
                    ? amt.GetDecimal()
                    : 0m;

                var itemCount = message.TryGetProperty("itemCount", out var ic)
                    ? ic.GetInt32()
                    : 0;

                _logger.LogInformation(
                    "💳 Payment modal opened: DeviceId={DeviceId}, OrderId={OrderId}, Table={TableNo}, Amount={Amount}",
                    deviceId, orderId, tableNo, amount);

                // Build notification
                var notification = new
                {
                    action = "payment_modal_opened",
                    deviceId,
                    orderId,
                    tableNo,
                    orderType,
                    amount,
                    itemCount,
                    timestamp = DateTime.UtcNow
                };

                // Broadcast to all SOK devices (optional - for other devices to see)
                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;

                foreach (var connId in sokDevices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to send payment modal notification to {ConnId}", connId);
                    }
                }

                _logger.LogInformation(
                    "✅ Payment modal opened broadcasted: {OrderId}, Notified: {Success}/{Total} devices",
                    orderId, successCount, sokDevices.Count);

                // Send acknowledgment back to sender
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_modal_opened_response",
                    success = true,
                    deviceId,
                    orderId,
                    amount,
                    broadcastSuccess = successCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling payment_modal_opened");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_modal_opened_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        // =====================================================
        // ✅ PAYMENT STATUS HANDLERS - ENHANCED
        // =====================================================

        /// <summary>
        /// Handle payment_status_update - NEW handler for detailed status tracking
        /// Message format: { action: "payment_status_update", deviceId: "...", orderId: "...", status: "...", details: {...} }
        /// </summary>
        private async Task HandlePaymentStatusUpdate(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var orderId = message.TryGetProperty("orderId", out var oid)
                    ? oid.GetString()
                    : null;

                var status = message.TryGetProperty("status", out var stat)
                    ? stat.GetString()
                    : "unknown";

                var sessionId = message.TryGetProperty("sessionId", out var sid)
                    ? sid.GetString()
                    : null;

                var paymentMethod = message.TryGetProperty("paymentMethod", out var pm)
                    ? pm.GetString()
                    : null;

                var amount = message.TryGetProperty("amount", out var amt)
                    ? amt.GetDecimal()
                    : 0m;

                var details = message.TryGetProperty("details", out var det)
                    ? JsonSerializer.Deserialize<Dictionary<string, object>>(det.GetRawText())
                    : new Dictionary<string, object>();

                _logger.LogInformation(
                    "💳 Payment status update: DeviceId={DeviceId}, OrderId={OrderId}, Status={Status}, SessionId={SessionId}",
                    deviceId, orderId, status, sessionId);

                // Build notification message
                var notification = new
                {
                    action = "payment_status_update",
                    deviceId,
                    orderId,
                    sessionId,
                    status,
                    paymentMethod,
                    amount,
                    details,
                    timestamp = DateTime.UtcNow
                };

                // ✅ Broadcast to all SOK devices
                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;
                int failCount = 0;

                foreach (var connId in sokDevices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        failCount++;
                        _logger.LogWarning(ex, "Failed to send payment status update to {ConnId}", connId);
                    }
                }

                _logger.LogInformation(
                    "✅ Payment status broadcasted: {Status}, Notified: {Success}/{Total} devices",
                    status, successCount, sokDevices.Count);

                // Send acknowledgment to sender
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_status_update_response",
                    success = true,
                    deviceId,
                    orderId,
                    sessionId,
                    status,
                    broadcastSuccess = successCount,
                    broadcastFailed = failCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling payment_status_update");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_status_update_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        /// <summary>
        /// Handle checkout action - triggers payment process
        /// </summary>
        private async Task HandleCheckout(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var orderId = message.TryGetProperty("orderId", out var oid)
                    ? oid.GetString()
                    : null;

                var amount = message.TryGetProperty("amount", out var amt)
                    ? amt.GetDecimal()
                    : 0m;

                var paymentMethod = message.TryGetProperty("paymentMethod", out var pm)
                    ? pm.GetString()
                    : "cash";

                _logger.LogInformation(
                    "💳 Checkout request: DeviceId={DeviceId}, OrderId={OrderId}, Amount={Amount}, Method={Method}",
                    deviceId, orderId, amount, paymentMethod);

                // Build checkout notification
                var notification = new
                {
                    action = "checkout",
                    deviceId,
                    orderId,
                    amount,
                    paymentMethod,
                    timestamp = DateTime.UtcNow
                };

                // Broadcast to all SOK devices
                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;

                foreach (var connId in sokDevices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to send checkout notification to {ConnId}", connId);
                    }
                }

                _logger.LogInformation(
                    "✅ Checkout broadcasted: {OrderId}, Notified: {Success}/{Total} devices",
                    orderId, successCount, sokDevices.Count);

                // Send response
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "checkout_response",
                    success = true,
                    deviceId,
                    orderId,
                    amount,
                    broadcastSuccess = successCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling checkout");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "checkout_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        /// <summary>
        /// Handle payment_processing - payment started
        /// </summary>
        private async Task HandlePaymentProcessing(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var orderId = message.TryGetProperty("orderId", out var oid)
                    ? oid.GetString()
                    : null;

                var paymentMethod = message.TryGetProperty("paymentMethod", out var pm)
                    ? pm.GetString()
                    : "unknown";

                var amount = message.TryGetProperty("amount", out var amt)
                    ? amt.GetDecimal()
                    : 0m;

                var sessionId = message.TryGetProperty("sessionId", out var sid)
                    ? sid.GetString()
                    : null;

                _logger.LogInformation(
                    "💳 Payment processing: DeviceId={DeviceId}, OrderId={OrderId}, Method={Method}, Amount={Amount}, SessionId={SessionId}",
                    deviceId, orderId, paymentMethod, amount, sessionId);

                // Build notification
                var notification = new
                {
                    action = "payment_processing",
                    deviceId,
                    orderId,
                    sessionId,
                    paymentMethod,
                    amount,
                    timestamp = DateTime.UtcNow
                };

                // Broadcast to all SOK devices
                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;

                foreach (var connId in sokDevices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to send payment processing notification to {ConnId}", connId);
                    }
                }

                _logger.LogInformation(
                    "✅ Payment processing broadcasted: {OrderId}, Method: {Method}, Notified: {Success}/{Total} devices",
                    orderId, paymentMethod, successCount, sokDevices.Count);

                // Send acknowledgment
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_processing_response",
                    success = true,
                    deviceId,
                    orderId,
                    sessionId,
                    broadcastSuccess = successCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling payment_processing");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_processing_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        /// <summary>
        /// Handle payment_complete - payment succeeded
        /// </summary>
        private async Task HandlePaymentComplete(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var orderId = message.TryGetProperty("orderId", out var oid)
                    ? oid.GetString()
                    : null;

                var salesNo = message.TryGetProperty("salesNo", out var sn)
                    ? sn.GetString()
                    : null;

                var paymentMethod = message.TryGetProperty("paymentMethod", out var pm)
                    ? pm.GetString()
                    : "unknown";

                var amount = message.TryGetProperty("amount", out var amt)
                    ? amt.GetDecimal()
                    : 0m;

                var paidAmount = message.TryGetProperty("paidAmount", out var pa)
                    ? pa.GetDecimal()
                    : amount;

                var changeAmount = message.TryGetProperty("changeAmount", out var ca)
                    ? ca.GetDecimal()
                    : 0m;

                var transactionId = message.TryGetProperty("transactionId", out var tid)
                    ? tid.GetString()
                    : null;

                var sessionId = message.TryGetProperty("sessionId", out var sid)
                    ? sid.GetString()
                    : null;

                var paymentDuration = message.TryGetProperty("paymentDuration", out var pd)
                    ? pd.GetInt64()
                    : 0L;

                _logger.LogInformation(
                    "✅ Payment complete: DeviceId={DeviceId}, OrderId={OrderId}, SalesNo={SalesNo}, Method={Method}, Amount={Amount}, Duration={Duration}ms",
                    deviceId, orderId, salesNo, paymentMethod, amount, paymentDuration);

                // Build notification
                var notification = new
                {
                    action = "payment_complete",
                    deviceId,
                    orderId,
                    salesNo,
                    sessionId,
                    paymentMethod,
                    amount,
                    paidAmount,
                    changeAmount,
                    transactionId,
                    paymentDuration,
                    timestamp = DateTime.UtcNow
                };

                // Broadcast to all SOK devices
                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;

                foreach (var connId in sokDevices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to send payment complete notification to {ConnId}", connId);
                    }
                }

                _logger.LogInformation(
                    "✅ Payment complete broadcasted: SalesNo={SalesNo}, Notified: {Success}/{Total} devices",
                    salesNo, successCount, sokDevices.Count);

                // Send acknowledgment
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_complete_response",
                    success = true,
                    deviceId,
                    orderId,
                    salesNo,
                    sessionId,
                    broadcastSuccess = successCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling payment_complete");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_complete_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        /// <summary>
        /// Handle payment_failed - payment failed
        /// </summary>
        private async Task HandlePaymentFailed(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var orderId = message.TryGetProperty("orderId", out var oid)
                    ? oid.GetString()
                    : null;

                var paymentMethod = message.TryGetProperty("paymentMethod", out var pm)
                    ? pm.GetString()
                    : "unknown";

                var amount = message.TryGetProperty("amount", out var amt)
                    ? amt.GetDecimal()
                    : 0m;

                var errorCode = message.TryGetProperty("errorCode", out var ec)
                    ? ec.GetString()
                    : "UNKNOWN";

                var errorMessage = message.TryGetProperty("errorMessage", out var em)
                    ? em.GetString()
                    : "Payment failed";

                var sessionId = message.TryGetProperty("sessionId", out var sid)
                    ? sid.GetString()
                    : null;

                var paymentDuration = message.TryGetProperty("paymentDuration", out var pd)
                    ? pd.GetInt64()
                    : 0L;

                _logger.LogWarning(
                    "❌ Payment failed: DeviceId={DeviceId}, OrderId={OrderId}, Method={Method}, ErrorCode={ErrorCode}, Error={Error}, Duration={Duration}ms",
                    deviceId, orderId, paymentMethod, errorCode, errorMessage, paymentDuration);

                // Build notification
                var notification = new
                {
                    action = "payment_failed",
                    deviceId,
                    orderId,
                    sessionId,
                    paymentMethod,
                    amount,
                    errorCode,
                    errorMessage,
                    paymentDuration,
                    timestamp = DateTime.UtcNow
                };

                // Broadcast to all SOK devices
                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;

                foreach (var connId in sokDevices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, notification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to send payment failed notification to {ConnId}", connId);
                    }
                }

                _logger.LogInformation(
                    "✅ Payment failed broadcasted: {OrderId}, Notified: {Success}/{Total} devices",
                    orderId, successCount, sokDevices.Count);

                // Send acknowledgment
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_failed_response",
                    success = true,
                    deviceId,
                    orderId,
                    sessionId,
                    broadcastSuccess = successCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling payment_failed");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "payment_failed_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        /// <summary>
        /// Handle order_complete - order finalized
        /// </summary>
        private async Task HandleOrderComplete(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString() : connectionId;
                var orderId = message.TryGetProperty("orderId", out var oid)
                    ? oid.GetString() : null;
                var salesNo = message.TryGetProperty("salesNo", out var sn)
                    ? sn.GetString() : null;

                Dictionary<string, object> orderDataDict = null;

                // 1️⃣ Try from message
                if (message.TryGetProperty("orderData", out var orderDataElement) &&
                    orderDataElement.ValueKind != JsonValueKind.Null)
                {
                    try
                    {
                        orderDataDict = JsonSerializer.Deserialize<Dictionary<string, object>>(
                            orderDataElement.GetRawText(),
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                        );
                        _logger.LogInformation("✅ [order_complete] OrderData from message");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "⚠️ [order_complete] Failed to deserialize orderData from message");
                    }
                }

                // 2️⃣ Fallback: retrieve from pending store saved by payment_success
                if (orderDataDict == null && !string.IsNullOrEmpty(deviceId))
                {
                    if (_pendingPaymentOrderData.TryRemove(deviceId, out var pendingData))
                    {
                        orderDataDict = pendingData as Dictionary<string, object>;
                        _logger.LogInformation("✅ [order_complete] OrderData from pending store for deviceId: {DeviceId}", deviceId);
                    }
                    else
                    {
                        _logger.LogWarning("⚠️ [order_complete] No pending orderData for deviceId: {DeviceId}", deviceId);
                    }
                }

                // 3️⃣ Fallback: cache by orderId
                if (orderDataDict == null && !string.IsNullOrEmpty(orderId))
                {
                    try
                    {
                        var cacheEntry = SOKOrderController.FindCacheByOrderId(orderId);
                        if (cacheEntry.HasValue && cacheEntry.Value.Value.OrderData != null)
                        {
                            orderDataDict = JsonSerializer.Deserialize<Dictionary<string, object>>(
                                JsonSerializer.Serialize(cacheEntry.Value.Value.OrderData),
                                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                            );
                            _logger.LogInformation("✅ [order_complete] OrderData from cache by orderId");
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "⚠️ [order_complete] Cache by orderId failed");
                    }
                }

                // 4️⃣ Fallback: cache by deviceId key (may already be cleared, but try anyway)
                if (orderDataDict == null && !string.IsNullOrEmpty(deviceId))
                {
                    foreach (var orderType in new[] { "E", "T", "D" })
                    {
                        var cacheKey = $"{deviceId}_{orderType}";
                        if (SOKOrderController._orderCaches.TryGetValue(cacheKey, out var cache) &&
                            cache.OrderData?.SalesDtls?.Count > 0)
                        {
                            try
                            {
                                orderDataDict = JsonSerializer.Deserialize<Dictionary<string, object>>(
                                    JsonSerializer.Serialize(cache.OrderData),
                                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                                );
                                _logger.LogInformation("✅ [order_complete] OrderData from cache key: {CacheKey}", cacheKey);
                                break;
                            }
                            catch (Exception ex)
                            {
                                _logger.LogWarning(ex, "⚠️ [order_complete] Cache key failed: {CacheKey}", cacheKey);
                            }
                        }
                    }
                }

                // ✅ Backfill sales_no
                if (orderDataDict != null && !string.IsNullOrEmpty(salesNo))
                {
                    var currentSalesNo = orderDataDict.TryGetValue("sales_no", out var existing)
                        ? existing?.ToString() : null;

                    if (string.IsNullOrEmpty(currentSalesNo))
                    {
                        orderDataDict["sales_no"] = salesNo;
                        _logger.LogInformation("✅ [order_complete] Backfilled sales_no={SalesNo}", salesNo);
                    }
                }

                object orderData = orderDataDict;

                _logger.LogInformation(
                    "🎉 Order complete: DeviceId={DeviceId}, OrderId={OrderId}, SalesNo={SalesNo}, HasOrderData={HasOrderData}",
                    deviceId, orderId, salesNo, orderData != null);

                var notification = new
                {
                    action = "order_complete",
                    deviceId,
                    orderId,
                    salesNo,
                    orderData,
                    timestamp = DateTime.UtcNow
                };

                var sokDevices = _wsManager.GetConnectedDevices("sok");

                if (sokDevices == null || sokDevices.Count == 0)
                {
                    _logger.LogWarning("⚠️ No SOK devices for order_complete broadcast");
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "order_complete_response",
                        success = true,
                        broadcastCount = 0,
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                var recipientDevices = sokDevices.ToList();
                var broadcastTasks = recipientDevices.Select(deviceConnectionId =>
                    Task.Run(async () =>
                    {
                        try
                        {
                            await _wsManager.SendMessageAsync(deviceConnectionId, notification);
                            return true;
                        }
                        catch (WebSocketException wsEx)
                        {
                            _logger.LogWarning("❌ WebSocket error to {ConnId}: {Error}", deviceConnectionId, wsEx.Message);
                            if (wsEx.WebSocketErrorCode == WebSocketError.ConnectionClosedPrematurely)
                                await _wsManager.RemoveSocketAsync(deviceConnectionId);
                            return false;
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "❌ Failed to send order_complete to {ConnId}", deviceConnectionId);
                            return false;
                        }
                    })
                ).ToList();

                var results = await Task.WhenAll(broadcastTasks);
                var successCount = results.Count(r => r);
                var failCount = results.Count(r => !r);

                _logger.LogInformation(
                    "✅ order_complete broadcast: {Success}/{Total} devices, {Failed} failed",
                    successCount, recipientDevices.Count, failCount);

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "order_complete_response",
                    success = true,
                    deviceId,
                    orderId,
                    salesNo,
                    broadcastSuccess = successCount,
                    broadcastFailed = failCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling order_complete");
                try
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "order_complete_response",
                        success = false,
                        error = ex.Message,
                        timestamp = DateTime.UtcNow
                    });
                }
                catch { }
            }
        }
        // =====================================================
        // EXISTING DELETE HANDLERS (unchanged)
        // =====================================================

        private async Task HandleDeleteOrder(string connectionId, JsonElement message)
        {
            try
            {
                var orderId = message.GetProperty("orderId").GetString();
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                _logger.LogInformation("🗑️ Delete order request via WebSocket: {OrderId}", orderId);

                SOKOrder removedOrder = null;
                string queueNumber = null;
                string serviceType = "E";

                if (!SOKOrderController.TryRemoveOrder(orderId, out removedOrder))
                {
                    var cacheEntry = SOKOrderController.FindCacheByOrderId(orderId);

                    if (cacheEntry.HasValue)
                    {
                        SOKOrderController.TryRemoveCache(cacheEntry.Value.Key, out var cache);
                        var orderData = cache.OrderData;
                        serviceType = orderData?.ServiceType ?? "E";

                        removedOrder = new SOKOrder
                        {
                            OrderId = cache.OrderId,
                            SokDeviceId = cache.DeviceId,
                            DeviceId = cache.DeviceId,
                            QueueNumber = GenerateQueueNumber(cache),
                            OrderData = cache.OrderData
                        };
                        queueNumber = removedOrder.QueueNumber;
                    }
                }
                else
                {
                    queueNumber = removedOrder.QueueNumber;
                    var orderData = removedOrder.OrderData as SOKOrderData;
                    serviceType = orderData?.ServiceType ?? "E";
                }

                if (removedOrder == null)
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "delete_order_response",
                        success = false,
                        error = "Order not found",
                        orderId,
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                var deleteNotification = new
                {
                    action = "order_deleted",
                    orderId,
                    queueNumber,
                    deviceId,
                    serviceType,
                    timestamp = DateTime.UtcNow
                };

                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;
                int failCount = 0;

                foreach (var connId in sokDevices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, deleteNotification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        failCount++;
                        _logger.LogWarning(ex, "Failed to send delete notification to {ConnId}", connId);
                    }
                }

                _logger.LogInformation(
                    "✅ Order deleted via WebSocket: {OrderId}, Notified: {Success}/{Total} devices",
                    orderId, successCount, sokDevices.Count);

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "delete_order_response",
                    success = true,
                    orderId,
                    queueNumber,
                    deviceId,
                    serviceType,
                    broadcastSuccess = successCount,
                    broadcastFailed = failCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling delete_order");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "delete_order_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        private string GenerateQueueNumber(OrderCache cache)
        {
            if (cache.OrderType == "T") return $"TA{cache.CreatedAt:MMddHHmm}";
            if (cache.OrderType == "E") return $"DI{cache.CreatedAt:MMddHHmm}";
            return $"OC{cache.CreatedAt:MMddHHmm}";
        }

        private async Task HandleDeleteItem(string connectionId, JsonElement message)
        {
            try
            {
                var sno = message.GetProperty("sno").GetInt32();
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var orderId = message.TryGetProperty("orderId", out var oidProp)
                    ? oidProp.GetString()
                    : null;

                _logger.LogInformation("🗑️ Delete item request: DeviceId={DeviceId}, S_NO={Sno}, OrderId={OrderId}",
                    deviceId, sno, orderId ?? "auto-detect");

                KeyValuePair<string, OrderCache>? cacheEntry = null;

                if (!string.IsNullOrEmpty(orderId))
                {
                    cacheEntry = SOKOrderController.FindCacheByOrderIdAndDevice(orderId, deviceId);
                }
                else
                {
                    cacheEntry = SOKOrderController._orderCaches.FirstOrDefault(c =>
                        c.Value.DeviceId == deviceId &&
                        c.Value.OrderData?.SalesDtls?.Any(item => item.SNo == sno) == true
                    );
                }

                if (!cacheEntry.HasValue)
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "delete_item_response",
                        success = false,
                        error = "Order not found",
                        sno,
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                var cache = cacheEntry.Value.Value;
                var cacheKey = cacheEntry.Value.Key;
                orderId = cache.OrderId;
                var orderData = cache.OrderData;
                var itemToRemove = orderData?.SalesDtls?.FirstOrDefault(item => item.SNo == sno);


                if (itemToRemove == null)
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "delete_item_response",
                        success = false,
                        error = $"Item with s_no {sno} not found",
                        orderId,
                        sno,
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                var deletedItemName = itemToRemove.ItemName;
                var deletedItemQty = itemToRemove.Qty;

                orderData.SalesDtls.Remove(itemToRemove);

                if (!orderData.SalesDtls.Any())
                {
                    SOKOrderController.TryRemoveCache(cacheKey, out _);

                    var deleteNotification = new
                    {
                        action = "order_deleted",
                        orderId,
                        queueNumber = GenerateQueueNumber(cache),
                        deviceId,
                        serviceType = cache.OrderType,
                        reason = "last_item_removed",
                        deletedItem = new
                        {
                            sno,
                            name = deletedItemName,
                            qty = deletedItemQty
                        },
                        timestamp = DateTime.UtcNow
                    };

                    var sokDevices = _wsManager.GetConnectedDevices("sok");
                    foreach (var connId in sokDevices)
                    {
                        try
                        {
                            await _wsManager.SendMessageAsync(connId, deleteNotification);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Failed to broadcast order deletion to {ConnId}", connId);
                        }
                    }

                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "delete_item_response",
                        success = true,
                        orderId,
                        sno,
                        orderDeleted = true,
                        message = "Last item removed, order deleted",
                        timestamp = DateTime.UtcNow
                    });

                    _logger.LogInformation("✅ Last item removed, order deleted: {OrderId}", orderId);
                    return;
                }

                SOKOrderController.RecalculateOrderTotals(orderData, _logger);
                cache.OrderData = orderData;
                cache.TotalAmount = decimal.Parse(orderData.NetAmt ?? "0.00");
                cache.UpdatedAt = DateTime.UtcNow;

                var updateNotification = new
                {
                    action = "order_item_deleted",
                    orderId,
                    queueNumber = GenerateQueueNumber(cache),
                    deviceId,
                    serviceType = cache.OrderType,
                    deletedSno = sno,
                    deletedItem = new
                    {
                        name = deletedItemName,
                        qty = deletedItemQty
                    },
                    remainingItems = orderData.SalesDtls.Count(i => i.SNo == i.ParentSno),
                    summary = new
                    {
                        subTotal = orderData.SubTotal,
                        totalTax = orderData.TotalTax,
                        totalSvc = orderData.TotalSvc,
                        netAmount = orderData.NetAmt
                    },
                    timestamp = DateTime.UtcNow
                };

                var devices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;

                foreach (var connId in devices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, updateNotification);
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to broadcast item deletion to {ConnId}", connId);
                    }
                }

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "delete_item_response",
                    success = true,
                    orderId,
                    sno,
                    deletedItem = deletedItemName,
                    remainingItems = orderData.SalesDtls.Count(i => i.SNo == i.ParentSno),
                    newTotal = orderData.NetAmt,
                    broadcastedTo = successCount,
                    timestamp = DateTime.UtcNow
                });

                _logger.LogInformation("✅ Item deleted via WebSocket: Order {OrderId}, Item {Sno}, Notified {Count} devices",
                    orderId, sno, successCount);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling delete_item");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "delete_item_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        private async Task HandleClearCache(string connectionId, JsonElement message)
        {
            try
            {
                if (!message.TryGetProperty("deviceId", out var devIdElement))
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "clear_cache_response",
                        success = false,
                        error = "deviceId is required",
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                var deviceId = devIdElement.GetString();

                if (string.IsNullOrWhiteSpace(deviceId))
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "clear_cache_response",
                        success = false,
                        error = "deviceId cannot be empty",
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                _logger.LogInformation("🗑️ Clear cache request via WebSocket for device: {DeviceId}", deviceId);

                int removedCount = 0;
                int broadcastSuccessCount = 0;
                int broadcastFailCount = 0;
                var clearedOrders = new List<object>();

                var keysToRemove = SOKOrderController.GetCacheKeysByDevice(deviceId);

                foreach (var key in keysToRemove)
                {
                    if (SOKOrderController.TryRemoveCache(key, out var cache))
                    {
                        removedCount++;
                        clearedOrders.Add(new
                        {
                            orderId = cache.OrderId,
                            orderType = cache.OrderType,
                            itemCount = cache.OrderData?.SalesDtls?.Count ?? 0
                        });

                        var clearNotification = new
                        {
                            action = "cache_cleared",
                            deviceId = cache.DeviceId,
                            orderType = cache.OrderType,
                            orderId = cache.OrderId,
                            timestamp = DateTime.UtcNow
                        };

                        var sokDevices = _wsManager.GetConnectedDevices("sok");
                        foreach (var connId in sokDevices)
                        {
                            try
                            {
                                await _wsManager.SendMessageAsync(connId, clearNotification);
                                broadcastSuccessCount++;
                            }
                            catch (Exception ex)
                            {
                                broadcastFailCount++;
                                _logger.LogWarning(ex, "Failed to broadcast cache clear to {ConnId}", connId);
                            }
                        }
                    }
                }

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "clear_cache_response",
                    success = true,
                    deviceId,
                    clearedCount = removedCount,
                    clearedOrders,
                    broadcastSuccess = broadcastSuccessCount,
                    broadcastFailed = broadcastFailCount,
                    timestamp = DateTime.UtcNow
                });

                _logger.LogInformation(
                    "✅ Cleared {Count} caches via WebSocket for device: {DeviceId}, Broadcasts: {Success}/{Total}",
                    removedCount, deviceId, broadcastSuccessCount, broadcastSuccessCount + broadcastFailCount);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling clear_cache");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "clear_cache_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        // =====================================================
        // READ/QUERY HANDLERS (unchanged)
        // =====================================================

        private async Task HandleGetOrder(string connectionId, JsonElement message)
        {
            try
            {
                var orderId = message.GetProperty("orderId").GetString();

                _logger.LogInformation("📖 Get order request via WebSocket: {OrderId}", orderId);

                if (SOKOrderController.TryGetOrder(orderId, out var order))
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "get_order_response",
                        success = true,
                        order,
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                var cacheEntry = SOKOrderController.FindCacheByOrderId(orderId);

                if (cacheEntry.HasValue)
                {
                    var cache = cacheEntry.Value.Value;
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "get_order_response",
                        success = true,
                        order = new
                        {
                            orderId = cache.OrderId,
                            deviceId = cache.DeviceId,
                            orderType = cache.OrderType,
                            orderData = cache.OrderData,
                            status = cache.Status,
                            totalAmount = cache.TotalAmount,
                            createdAt = cache.CreatedAt,
                            updatedAt = cache.UpdatedAt
                        },
                        timestamp = DateTime.UtcNow
                    });
                    return;
                }

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "get_order_response",
                    success = false,
                    error = "Order not found",
                    orderId,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling get_order");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "get_order_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        private async Task HandleGetOrders(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var orderType = message.TryGetProperty("orderType", out var ot)
                    ? ot.GetString()
                    : null;

                _logger.LogInformation("📖 Get orders request via WebSocket for device: {DeviceId}, type: {Type}",
                    deviceId, orderType ?? "all");

                var ordersFromDict = SOKOrderController.GetOrdersByDevice(deviceId);
                var ordersFromCache = SOKOrderController.GetCachesByDevice(deviceId, orderType)
                    .Select(c => new
                    {
                        orderId = c.OrderId,
                        deviceId = c.DeviceId,
                        orderType = c.OrderType,
                        orderData = c.OrderData,
                        status = c.Status,
                        totalAmount = c.TotalAmount,
                        createdAt = c.CreatedAt,
                        updatedAt = c.UpdatedAt
                    })
                    .ToList();

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "get_orders_response",
                    success = true,
                    deviceId,
                    orderType,
                    orders = ordersFromCache,
                    count = ordersFromCache.Count,
                    timestamp = DateTime.UtcNow
                });

                _logger.LogInformation("✅ Sent {Count} orders via WebSocket to {DeviceId}",
                    ordersFromCache.Count, deviceId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling get_orders");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "get_orders_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        private async Task HandleGetCache(string connectionId, JsonElement message)
        {
            try
            {
                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var orderType = message.TryGetProperty("orderType", out var ot)
                    ? ot.GetString()
                    : null;

                _logger.LogInformation("📖 Get cache request via WebSocket for device: {DeviceId}, type: {Type}",
                    deviceId, orderType ?? "all");

                if (!string.IsNullOrEmpty(orderType))
                {
                    var cacheKey = $"{deviceId}_{orderType}";
                    if (SOKOrderController.TryGetCache(cacheKey, out var cache))
                    {
                        await _wsManager.SendMessageAsync(connectionId, new
                        {
                            action = "get_cache_response",
                            success = true,
                            cache = new
                            {
                                orderId = cache.OrderId,
                                deviceId = cache.DeviceId,
                                orderType = cache.OrderType,
                                orderData = cache.OrderData,
                                status = cache.Status,
                                totalAmount = cache.TotalAmount,
                                createdAt = cache.CreatedAt,
                                updatedAt = cache.UpdatedAt
                            },
                            timestamp = DateTime.UtcNow
                        });
                        return;
                    }
                }

                var caches = SOKOrderController.GetCachesByDevice(deviceId, orderType)
                    .Select(c => new
                    {
                        orderId = c.OrderId,
                        deviceId = c.DeviceId,
                        orderType = c.OrderType,
                        orderData = c.OrderData,
                        status = c.Status,
                        totalAmount = c.TotalAmount,
                        createdAt = c.CreatedAt,
                        updatedAt = c.UpdatedAt
                    })
                    .ToList();

                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "get_cache_response",
                    success = true,
                    caches,
                    count = caches.Count,
                    timestamp = DateTime.UtcNow
                });

                _logger.LogInformation("✅ Sent cache data via WebSocket to {DeviceId}", deviceId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling get_cache");
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "get_cache_response",
                    success = false,
                    error = ex.Message,
                    timestamp = DateTime.UtcNow
                });
            }
        }

        // =====================================================
        // CACHE UPDATE HANDLERS (unchanged)
        // =====================================================

        private async Task HandleSimplifiedUpdate(string connectionId, JsonElement message)
        {
            try
            {
                // Extract request ID if present
                var requestId = message.TryGetProperty("requestId", out var reqId)
                    ? reqId.GetString()
                    : null;

                _logger.LogInformation("📥 Handling simplified update from {ConnectionId}, RequestId={RequestId}",
                    connectionId, requestId ?? "none");

                if (message.ValueKind != JsonValueKind.Object)
                {
                    _logger.LogWarning("⚠️ Invalid message format - not an object");
                    return;
                }

                if (!message.TryGetProperty("deviceId", out var deviceIdElement))
                {
                    _logger.LogWarning("⚠️ Missing deviceId in message");
                    return;
                }

                var deviceId = deviceIdElement.GetString();
                if (string.IsNullOrEmpty(deviceId))
                {
                    _logger.LogWarning("⚠️ Empty deviceId");
                    return;
                }

                if (!message.TryGetProperty("orderData", out var orderDataElement))
                {
                    _logger.LogWarning("⚠️ Missing orderData in message");
                    return;
                }



                if (orderDataElement.ValueKind != JsonValueKind.Object)
                {
                    _logger.LogWarning("⚠️ orderData is not an object");
                    return;
                }

                SOKOrderData orderData;
                try
                {
                    var options = new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true,
                        PropertyNamingPolicy = null,
                        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString |
                        System.Text.Json.Serialization.JsonNumberHandling.WriteAsString
                    };

                    orderData = JsonSerializer.Deserialize<SOKOrderData>(
                        orderDataElement.GetRawText(),
                        options
                    );

                    if (orderData == null)
                    {
                        _logger.LogWarning("⚠️ Failed to deserialize orderDetails - result is null");
                        return;
                    }
                }
                catch (JsonException jsonEx)
                {
                    _logger.LogError(jsonEx, "❌ Failed to deserialize orderDetails");
                    return;
                }

                if (string.IsNullOrEmpty(orderData.ServiceType))
                {
                    _logger.LogWarning("⚠️ Missing service_type in orderDetails");
                    return;
                }

                var orderType = orderData.ServiceType;

                if (orderData.SalesDtls == null)
                {
                    _logger.LogWarning("⚠️ orderData.SalesDtls is null, initializing empty list");
                    orderData.SalesDtls = new List<SalesDetail>();
                }

                var itemCount = orderData.SalesDtls.Count(i => i.SNo == i.ParentSno);
                _logger.LogInformation("📦 Update: DeviceId={DeviceId}, Type={Type}, Items={ItemCount}",
                    deviceId, orderType, itemCount);

                var cacheKey = $"{deviceId}_{orderType}";

                var deviceInfo = _wsManager.GetDeviceInfoById(connectionId);
                var location = deviceInfo?.Outlet ?? "unknown";

                if (string.IsNullOrEmpty(orderData.ServerOrderId))
                {
                    orderData.ServerOrderId = $"ORD-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{deviceId}";
                    _logger.LogInformation("✅ Generated ServerOrderId: {OrderId}", orderData.ServerOrderId);
                }

                decimal totalAmount = 0m;
                if (!string.IsNullOrEmpty(orderData.NetAmt) &&
                    decimal.TryParse(orderData.NetAmt, out var parsedAmount))
                {
                    totalAmount = parsedAmount;
                }

                OrderCache cache;
                if (SOKOrderController._orderCaches.TryGetValue(cacheKey, out var existingCache))
                {
                    cache = existingCache;
                    cache.OrderData = orderData;
                    cache.TotalAmount = totalAmount;
                    cache.UpdatedAt = DateTime.UtcNow;

                    _logger.LogInformation("✅ Updated existing cache: {CacheKey}", cacheKey);
                }
                else
                {
                    cache = new OrderCache
                    {
                        OrderId = orderData.ServerOrderId,
                        DeviceId = deviceId,
                        OrderType = orderType,
                        Location = location,
                        TableNo = orderData.TableNo ?? "",
                        OrderData = orderData,
                        Status = "active",
                        TotalAmount = totalAmount,
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow
                    };

                    SOKOrderController._orderCaches[cacheKey] = cache;
                    _logger.LogInformation("✅ Created new cache: {CacheKey}", cacheKey);
                }

                // ✅ CRITICAL FIX: Send acknowledgment to sender FIRST
                // WITHOUT sending back the full order data
                await _wsManager.SendMessageAsync(connectionId, new
                {
                    action = "update_acknowledged",
                    requestId = requestId, // ✅ Include request ID for matching
                    orderId = orderData.ServerOrderId,
                    cacheKey = cacheKey,
                    itemCount = itemCount,
                    totalAmount = totalAmount,
                    success = true,
                    timestamp = DateTime.UtcNow
                    // ❌ DO NOT INCLUDE: orderData (this was causing the override!)
                });

                _logger.LogInformation("✅ Acknowledgment sent to sender (NO order data included)");

                // ✅ CRITICAL FIX: Broadcast to OTHER devices only (exclude sender)
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await BroadcastCacheUpdateExcludingSender(cache, connectionId);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "❌ Broadcast error (non-blocking)");
                    }
                });

                _logger.LogInformation("✅ Update processed and broadcast initiated for {CacheKey}", cacheKey);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error in HandleSimplifiedUpdate for {ConnectionId}", connectionId);

                try
                {
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "error",
                        message = "Failed to process update",
                        error = ex.Message,
                        timestamp = DateTime.UtcNow
                    });
                }
                catch
                {
                    // Ignore errors when sending error message
                }
            }
        }


        private async Task BroadcastCacheUpdateExcludingSender(OrderCache cache, string senderConnectionId)
        {
            try
            {
                if (cache == null)
                {
                    _logger.LogWarning("⚠️ Cannot broadcast - cache is null");
                    return;
                }
                if (cache.OrderData == null)
                {
                    _logger.LogWarning("⚠️ Cannot broadcast - cache.OrderData is null");
                    return;
                }

                var salesDtls = cache.OrderData.SalesDtls ?? new List<SalesDetail>();
                var itemCount = salesDtls.Count(i => i.SNo == i.ParentSno);

                var messageObj = new
                {
                    action = "cache_updated",
                    deviceId = cache.DeviceId ?? "",
                    orderType = cache.OrderType ?? "",
                    orderId = cache.OrderId ?? "",
                    orderData = cache.OrderData,
                    status = cache.Status ?? "active",
                    totalAmount = cache.TotalAmount,
                    itemCount,
                    summary = new
                    {
                        itemCount,
                        netAmount = cache.OrderData.NetAmt ?? "0.00",
                        subTotal = cache.OrderData.SubTotal ?? "0.00",
                        totalTax = cache.OrderData.TotalTax ?? "0.00",
                        totalSvc = cache.OrderData.TotalSvc ?? "0.00"
                    },
                    fromDevice = cache.DeviceId, // ✅ Track source
                    timestamp = DateTime.UtcNow
                };

                var sokDevices = _wsManager.GetConnectedDevices("sok");

                if (sokDevices == null || sokDevices.Count == 0)
                {
                    _logger.LogWarning("⚠️ No SOK devices connected for broadcast");
                    return;
                }

                // ✅ CRITICAL: Filter out the sender
                var recipientDevices = sokDevices
                    .Where(deviceId => deviceId != senderConnectionId)
                    .ToList();

                _logger.LogInformation(
                    "📡 Broadcasting to {Count} OTHER SOK devices (excluding sender {Sender})...",
                    recipientDevices.Count,
                    senderConnectionId);

                var broadcastTasks = recipientDevices.Select(deviceConnectionId =>
                    Task.Run(async () =>
                    {
                        try
                        {
                            await _wsManager.SendMessageAsync(deviceConnectionId, messageObj);
                            _logger.LogDebug("✅ Sent to {ConnId}", deviceConnectionId);
                            return true;
                        }
                        catch (WebSocketException wsEx)
                        {
                            _logger.LogWarning("❌ WebSocket error sending to {ConnId}: {Error}",
                                deviceConnectionId, wsEx.Message);

                            if (wsEx.WebSocketErrorCode == WebSocketError.ConnectionClosedPrematurely)
                            {
                                _logger.LogInformation("🧹 Removing dead connection: {ConnId}", deviceConnectionId);
                                await _wsManager.RemoveSocketAsync(deviceConnectionId);
                            }
                            return false;
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "❌ Failed to send to {ConnId}", deviceConnectionId);
                            return false;
                        }
                    })
                ).ToList();

                var results = await Task.WhenAll(broadcastTasks);
                var successCount = results.Count(r => r);
                var failCount = results.Count(r => !r);

                _logger.LogInformation(
                    "✅ Broadcast complete: {Success}/{Total} OTHER devices notified, {Failed} failed, Sender EXCLUDED",
                    successCount, recipientDevices.Count, failCount);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error in BroadcastCacheUpdateExcludingSender");
            }
        }

        private async Task BroadcastCacheUpdateImmediate(OrderCache cache, string senderConnectionId)
        {
            try
            {
                if (cache == null)
                {
                    _logger.LogWarning("⚠️ Cannot broadcast - cache is null");
                    return;
                }
                if (cache.OrderData == null)
                {
                    _logger.LogWarning("⚠️ Cannot broadcast - cache.OrderData is null");
                    return;
                }

                var salesDtls = cache.OrderData.SalesDtls ?? new List<SalesDetail>();
                var itemCount = salesDtls.Count(i => i.SNo == i.ParentSno);

                var messageObj = new
                {
                    action = "cache_updated",
                    deviceId = cache.DeviceId ?? "",
                    orderType = cache.OrderType ?? "",
                    orderId = cache.OrderId ?? "",
                    orderData = cache.OrderData,
                    status = cache.Status ?? "active",
                    totalAmount = cache.TotalAmount,
                    itemCount,
                    summary = new
                    {
                        itemCount,
                        netAmount = cache.OrderData.NetAmt ?? "0.00",
                        subTotal = cache.OrderData.SubTotal ?? "0.00",
                        totalTax = cache.OrderData.TotalTax ?? "0.00",
                        totalSvc = cache.OrderData.TotalSvc ?? "0.00"
                    },
                    timestamp = DateTime.UtcNow
                };

                var sokDevices = _wsManager.GetConnectedDevices("sok");

                if (sokDevices == null || sokDevices.Count == 0)
                {
                    _logger.LogWarning("⚠️ No SOK devices connected for broadcast");
                    return;
                }

                _logger.LogInformation("📡 Broadcasting to {Count} SOK devices IMMEDIATELY...", sokDevices.Count);

                var broadcastTasks = sokDevices.Select(deviceConnectionId =>
                    Task.Run(async () =>
                    {
                        try
                        {
                            await _wsManager.SendMessageAsync(deviceConnectionId, messageObj);
                            _logger.LogDebug("✅ Sent to {ConnId}", deviceConnectionId);
                            return true;
                        }
                        catch (WebSocketException wsEx)
                        {
                            _logger.LogWarning("❌ WebSocket error sending to {ConnId}: {Error}",
                                deviceConnectionId, wsEx.Message);

                            if (wsEx.WebSocketErrorCode == WebSocketError.ConnectionClosedPrematurely)
                            {
                                _logger.LogInformation("🧹 Removing dead connection: {ConnId}", deviceConnectionId);
                                await _wsManager.RemoveSocketAsync(deviceConnectionId);
                            }
                            return false;
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "❌ Failed to send to {ConnId}", deviceConnectionId);
                            return false;
                        }
                    })
                ).ToList();

                var results = await Task.WhenAll(broadcastTasks);
                var successCount = results.Count(r => r);
                var failCount = results.Count(r => !r);

                _logger.LogInformation(
                    "✅ Broadcast complete: {Success}/{Total} devices notified, {Failed} failed",
                    successCount, sokDevices.Count, failCount);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error in BroadcastCacheUpdateImmediate");
            }
        }

        private async Task HandleCacheUpdateFromClient(string connectionId, JsonElement message)
        {
            try
            {
                var requestId = message.TryGetProperty("requestId", out var reqId)
                    ? reqId.GetString()
                    : null;

                var deviceId = message.TryGetProperty("deviceId", out var devId)
                    ? devId.GetString()
                    : connectionId;

                var orderType = message.TryGetProperty("orderType", out var ot)
                    ? ot.GetString()
                    : null;

                if (string.IsNullOrEmpty(orderType))
                {
                    _logger.LogWarning("⚠️ No orderType in cache update from {ConnectionId}", connectionId);
                    return;
                }

                var orderDataElement = message.GetProperty("orderData");
                var orderData = JsonSerializer.Deserialize<SOKOrderData>(orderDataElement.GetRawText());

                if (orderData == null)
                {
                    _logger.LogWarning("⚠️ No orderData in cache update from {ConnectionId}", connectionId);
                    return;
                }

                var cacheKey = $"{deviceId}_{orderType}";

                if (SOKOrderController._orderCaches.TryGetValue(cacheKey, out var cache))
                {
                    cache.OrderData = orderData;
                    cache.TotalAmount = decimal.Parse(orderData.NetAmt ?? "0.00");
                    cache.UpdatedAt = DateTime.UtcNow;

                    if (message.TryGetProperty("status", out var status))
                    {
                        cache.Status = status.GetString();
                    }

                    if (orderData.SalesDtls != null)
                    {
                        _logger.LogInformation("🔄 WebSocket sync - {ItemCount} items for {CacheKey}:",
                            orderData.SalesDtls.Count, cacheKey);

                        foreach (var item in orderData.SalesDtls.Where(i => i.SNo == i.ParentSno))
                        {
                            _logger.LogInformation("   Item: {ItemName}, Qty: {Qty}", item.ItemName, item.Qty);
                        }
                    }

                    _logger.LogInformation("✅ Cache updated from WebSocket: {CacheKey}", cacheKey);

                    // ✅ CRITICAL FIX: Send acknowledgment to sender WITHOUT order data
                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "cache_update_response",
                        requestId = requestId,
                        success = true,
                        cacheKey = cacheKey,
                        itemCount = orderData.SalesDtls?.Count(i => i.SNo == i.ParentSno) ?? 0,
                        totalAmount = cache.TotalAmount,
                        timestamp = DateTime.UtcNow
                        // ❌ DO NOT INCLUDE: orderData
                    });

                    // ✅ CRITICAL FIX: Broadcast to OTHER devices only
                    await BroadcastCacheUpdateExcludingSender(cache, connectionId);
                }
                else
                {
                    _logger.LogWarning("⚠️ Cache not found for WebSocket update: {CacheKey}", cacheKey);

                    await _wsManager.SendMessageAsync(connectionId, new
                    {
                        action = "cache_update_response",
                        requestId = requestId,
                        success = false,
                        error = "Cache not found",
                        cacheKey = cacheKey,
                        timestamp = DateTime.UtcNow
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling cache update from {ConnectionId}", connectionId);
            }
        }



        private async Task BroadcastCacheToOtherDevices(OrderCache cache, string senderConnectionId)
        {
            try
            {
                var salesDtls = cache.OrderData?.SalesDtls ?? new List<SalesDetail>();
                var itemCount = salesDtls.Count(item => item.SNo == item.ParentSno);

                var messageObj = new
                {
                    action = "cache_updated",
                    deviceId = cache.DeviceId,
                    orderType = cache.OrderType,
                    orderId = cache.OrderId,
                    orderData = cache.OrderData,
                    status = cache.Status,
                    totalAmount = cache.TotalAmount,
                    itemCount = itemCount,
                    summary = new
                    {
                        itemCount = itemCount,
                        netAmount = cache.OrderData?.NetAmt ?? "0.00",
                        subTotal = cache.OrderData?.SubTotal ?? "0.00",
                        totalTax = cache.OrderData?.TotalTax ?? "0.00",
                        totalSvc = cache.OrderData?.TotalSvc ?? "0.00"
                    },
                    timestamp = DateTime.UtcNow
                };

                var message = JsonSerializer.Serialize(messageObj);

                var sokDevices = _wsManager.GetConnectedDevices("sok");

                foreach (var deviceId in sokDevices)
                {
                    if (deviceId != senderConnectionId)
                    {
                        try
                        {
                            await _wsManager.SendMessageAsync(deviceId, message);
                            _logger.LogDebug("📤 Broadcasted to {DeviceId}", deviceId);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Failed to broadcast to {DeviceId}", deviceId);
                        }
                    }
                }

                _logger.LogInformation("✅ Broadcasted cache update to {Count} devices (excluding sender)",
                    sokDevices.Count - 1);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error broadcasting cache to other devices");
            }
        }

        // =====================================================
        // HTTP ENDPOINTS (unchanged)
        // =====================================================

        [HttpGet("{outletName}/devices")]
        public IActionResult GetDevices([FromRoute] string outletName, [FromQuery] string? type)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(outletName))
                {
                    _logger.LogWarning("⚠️ No outlet specified in request");
                    return Ok(new
                    {
                        success = true,
                        message = "No devices available - outlet name is required",
                        outlet = (string?)null,
                        devices = new List<object>(),
                        count = 0,
                        timestamp = DateTime.UtcNow
                    });
                }

                _logger.LogInformation("📋 GetDevices called - Outlet: {Outlet}, Type: {Type}",
                    outletName, type ?? "none");

                var deviceIds = string.IsNullOrWhiteSpace(type)
                    ? _wsManager.GetAllConnectedDevices()
                    : _wsManager.GetConnectedDevices(type);

                var filteredDeviceIds = deviceIds.Where(id =>
                {
                    var deviceInfo = _wsManager.GetDeviceInfoById(id);
                    if (deviceInfo != null)
                    {
                        var outlet = GetPropertyValue(deviceInfo, "Outlet") as string;
                        return string.Equals(outlet, outletName, StringComparison.OrdinalIgnoreCase);
                    }
                    return false;
                }).ToList();

                _logger.LogInformation("📋 Found {Count} devices for outlet {Outlet} (Filter: {Type})",
                    filteredDeviceIds.Count, outletName, type ?? "none");

                var devices = filteredDeviceIds.Select(id =>
                {
                    var deviceInfo = _wsManager.GetDeviceInfoById(id);
                    var socket = _wsManager.GetSocketById(id);

                    string extractedDeviceId;
                    string? deviceType = null;
                    string? outlet = null;
                    DateTime? connectedAt = null;
                    DateTime? lastActivity = null;

                    if (deviceInfo != null)
                    {
                        extractedDeviceId = GetPropertyValue(deviceInfo, "DeviceId") as string ?? id;
                        deviceType = GetPropertyValue(deviceInfo, "Type") as string;
                        outlet = GetPropertyValue(deviceInfo, "Outlet") as string;
                        connectedAt = GetPropertyValue(deviceInfo, "ConnectedAt") as DateTime?;
                        lastActivity = GetPropertyValue(deviceInfo, "LastActivity") as DateTime?;
                    }
                    else
                    {
                        extractedDeviceId = id;
                        deviceType = _wsManager.GetDeviceTypeById(id);
                    }

                    var deviceData = new
                    {
                        connectionId = id,
                        deviceId = extractedDeviceId,
                        type = deviceType ?? _wsManager.GetDeviceTypeById(id) ?? "unknown",
                        outlet = outlet,
                        state = socket?.State.ToString() ?? "Unknown",
                        connectedAt = connectedAt,
                        lastActivity = lastActivity
                    };

                    _logger.LogDebug("  📱 Device: {ConnectionId} -> DeviceId={DeviceId}, Type={Type}",
                        id, extractedDeviceId, deviceData.type);

                    return deviceData;
                }).ToList();

                object? GetPropertyValue(object obj, string propertyName)
                {
                    try
                    {
                        return obj?.GetType()?.GetProperty(propertyName)?.GetValue(obj);
                    }
                    catch
                    {
                        return null;
                    }
                }

                _logger.LogInformation("✅ Returning {Count} devices for outlet {Outlet}",
                    devices.Count, outletName);

                return Ok(new
                {
                    success = true,
                    outlet = outletName,
                    devices,
                    count = devices.Count,
                    filteredByType = type,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving devices for outlet {Outlet}", outletName);
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        [HttpGet("{outletName}/device")]
        public IActionResult GetDeviceById([FromRoute] string outletName, [FromQuery] string deviceId)
        {
            if (string.IsNullOrWhiteSpace(outletName))
            {
                _logger.LogWarning("⚠️ No outlet specified in request");
                return BadRequest(new
                {
                    success = false,
                    error = "Outlet name is required in the path"
                });
            }

            if (string.IsNullOrWhiteSpace(deviceId))
                return BadRequest(new { success = false, error = "deviceId is required" });

            try
            {
                _logger.LogInformation("🔍 Searching for device: {DeviceId}, Outlet: {Outlet}",
                    deviceId, outletName);

                var foundDevice = _wsManager.GetDeviceInfoById(deviceId);

                if (foundDevice != null &&
                    string.Equals(foundDevice.Outlet, outletName, StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogInformation("✅ Found device with connection ID: {ConnectionId} in outlet: {Outlet}",
                        foundDevice.ConnectionId, foundDevice.Outlet);
                }
                else
                {
                    foundDevice = null;
                }

                if (foundDevice == null)
                {
                    _logger.LogWarning("❌ Device not found: {DeviceId} in outlet: {Outlet}", deviceId, outletName);
                    return NotFound(new
                    {
                        success = false,
                        error = $"Device not found or not connected in outlet '{outletName}'",
                        outlet = outletName
                    });
                }

                var socket = _wsManager.GetSocketById(foundDevice.ConnectionId);

                return Ok(new
                {
                    success = true,
                    device = new
                    {
                        connectionId = foundDevice.ConnectionId,
                        deviceId = foundDevice.DeviceId,
                        type = foundDevice.Type,
                        outlet = foundDevice.Outlet,
                        state = socket?.State.ToString() ?? "Unknown",
                        connectedAt = foundDevice.ConnectedAt,
                        lastActivity = foundDevice.LastActivity
                    }
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving device {DeviceId} in outlet {Outlet}", deviceId, outletName);
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        [HttpPost("send-test")]
        public async Task<IActionResult> SendTestMessage(
            [FromQuery] string deviceId,
            [FromBody] object? data = null)
        {
            if (string.IsNullOrWhiteSpace(deviceId))
                return BadRequest(new { success = false, error = "deviceId is required" });

            try
            {
                if (_wsManager.GetSocketById(deviceId) == null)
                    return NotFound(new { success = false, error = "Device not connected" });

                var message = JsonSerializer.Serialize(new
                {
                    action = "test_message",
                    deviceId,
                    data,
                    timestamp = DateTime.UtcNow
                });

                await _wsManager.SendMessageAsync(deviceId, message);

                return Ok(new
                {
                    success = true,
                    message = "Test message sent",
                    connectionId = deviceId,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending test message to {DeviceId}", deviceId);
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }


        [HttpPost("{outletName}/update-order")]
        public async Task<IActionResult> UpdateOrderFromPOS(
        [FromRoute] string outletName,
        [FromQuery] string deviceId,
        [FromQuery] string orderType,
        [FromBody] SOKOrderData orderData)
        {
            try
            {
                var cacheKey = $"{deviceId}_{orderType}";

                if (SOKOrderController._orderCaches.TryGetValue(cacheKey, out var cache))
                {
                    cache.OrderData = orderData;
                    cache.TotalAmount = decimal.Parse(orderData.NetAmt ?? "0.00");
                    cache.UpdatedAt = DateTime.UtcNow;

                    await BroadcastCacheToOtherDevices(cache, "POS_SYSTEM");

                    return Ok(new { success = true, message = "Order updated and broadcasted" });
                }

                return NotFound(new { success = false, error = "Order cache not found" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating order from POS");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        [HttpPost("broadcast")]
        public async Task<IActionResult> BroadcastMessage(
            [FromQuery] string type,
            [FromBody] object data)
        {
            if (string.IsNullOrWhiteSpace(type))
                return BadRequest(new { success = false, error = "type is required" });

            try
            {
                var message = JsonSerializer.Serialize(new
                {
                    action = "broadcast",
                    type,
                    data,
                    timestamp = DateTime.UtcNow
                });

                await _wsManager.BroadcastToTypeAsync(type, message);

                var deviceCount = _wsManager.GetConnectedDevices(type).Count;

                return Ok(new
                {
                    success = true,
                    message = "Broadcast sent",
                    type,
                    deviceCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error broadcasting to type {Type}", type);
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        [HttpGet("health")]
        public IActionResult Health()
        {
            var allDevices = _wsManager.GetAllConnectedDevices();
            var devicesByType = allDevices
                .GroupBy(id => _wsManager.GetDeviceTypeById(id) ?? "unknown")
                .ToDictionary(g => g.Key, g => g.Count());

            return Ok(new
            {
                success = true,
                status = "healthy",
                totalConnections = allDevices.Count,
                devicesByType,
                timestamp = DateTime.UtcNow
            });
        }
    }
}

