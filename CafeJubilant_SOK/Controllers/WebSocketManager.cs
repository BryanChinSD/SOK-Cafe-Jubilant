using CafeJubilant_SOK.Models;
using CafeJubilant_SOK.Services;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;

namespace CafeJubilant_SOK.Services
{
    /// <summary>
    /// WebSocket Connection Manager - Thread-safe management of WebSocket connections
    /// </summary>
    public class WebSocketConnectionManager
    {
        private readonly ConcurrentDictionary<string, WebSocket> _sockets = new();
        private readonly ConcurrentDictionary<string, DeviceConnectionInfo> _deviceInfo = new();
        private readonly ILogger<WebSocketConnectionManager> _logger;
        private readonly SemaphoreSlim _sendLock = new(1, 1);

        public WebSocketConnectionManager(ILogger<WebSocketConnectionManager> logger)
        {
            _logger = logger;
        }

        /// <summary>
        /// Add a WebSocket connection (3 parameters - backward compatible)
        /// </summary>
        public async Task AddSocketAsync(string connectionId, WebSocket socket, string type)
        {
            await AddSocketAsync(connectionId, socket, type, "default");
        }

        /// <summary>
        /// Add a WebSocket connection with outlet information
        /// </summary>
        public async Task AddSocketAsync(string connectionId, WebSocket socket, string type, string outlet)
        {
            try
            {
                // Remove existing connection if it exists
                if (_sockets.ContainsKey(connectionId))
                {
                    _logger.LogWarning("⚠️ Connection {ConnectionId} already exists, removing old connection", connectionId);
                    await RemoveSocketAsync(connectionId);
                }

                // Extract device ID from connection ID
                string deviceId = ExtractDeviceId(connectionId, type);

                // Add socket
                _sockets[connectionId] = socket;

                // Store device info
                _deviceInfo[connectionId] = new DeviceConnectionInfo
                {
                    ConnectionId = connectionId,
                    DeviceId = deviceId,
                    Type = type,
                    Outlet = outlet,
                    ConnectedAt = DateTime.UtcNow,
                    LastActivity = DateTime.UtcNow
                };

                _logger.LogInformation("✅ Socket added: {ConnectionId} (Type: {Type}, Device: {DeviceId}, Outlet: {Outlet})",
                    connectionId, type, deviceId, outlet);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error adding socket {ConnectionId}", connectionId);
                throw;
            }
        }

        /// <summary>
        /// Remove a WebSocket connection
        /// </summary>
        public async Task RemoveSocketAsync(string connectionId)
        {
            try
            {
                if (_sockets.TryRemove(connectionId, out var socket))
                {
                    _deviceInfo.TryRemove(connectionId, out _);

                    if (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived)
                    {
                        try
                        {
                            await socket.CloseAsync(
                                WebSocketCloseStatus.NormalClosure,
                                "Connection removed",
                                CancellationToken.None
                            );
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Error closing socket {ConnectionId}", connectionId);
                        }
                    }

                    socket.Dispose();
                    _logger.LogInformation("🗑️ Socket removed: {ConnectionId}", connectionId);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error removing socket {ConnectionId}", connectionId);
            }
        }

        /// <summary>
        /// Get WebSocket by connection ID
        /// </summary>
        public WebSocket? GetSocketById(string connectionId)
        {
            return _sockets.TryGetValue(connectionId, out var socket) ? socket : null;
        }

        /// <summary>
        /// Get device information by connection ID
        /// </summary>
        public DeviceConnectionInfo? GetDeviceInfoById(string connectionId)
        {
            return _deviceInfo.TryGetValue(connectionId, out var info) ? info : null;
        }

        /// <summary>
        /// Get device type by connection ID
        /// </summary>
        public string? GetDeviceTypeById(string connectionId)
        {
            return _deviceInfo.TryGetValue(connectionId, out var info) ? info.Type : null;
        }

        /// <summary>
        /// Get all connected device IDs
        /// </summary>
        public List<string> GetAllConnectedDevices()
        {
            return _sockets.Keys.ToList();
        }

        /// <summary>
        /// Get connected devices filtered by type
        /// </summary>
        public List<string> GetConnectedDevices(string type)
        {
            return _deviceInfo.Values
                .Where(info => info.Type.Equals(type, StringComparison.OrdinalIgnoreCase))
                .Select(info => info.ConnectionId)
                .ToList();
        }

        /// <summary>
        /// Send message object to specific device (auto-serializes to JSON)
        /// </summary>
        public async Task SendMessageAsync(string connectionId, object messageObject)
        {
            var jsonString = System.Text.Json.JsonSerializer.Serialize(messageObject);
            await SendMessageAsync(connectionId, jsonString);
        }

        /// <summary>
        /// Send message string to specific device
        /// </summary>
        public async Task SendMessageAsync(string connectionId, string message)
        {
            if (!_sockets.TryGetValue(connectionId, out var socket))
            {
                _logger.LogWarning("⚠️ Socket not found: {ConnectionId}", connectionId);
                _logger.LogWarning("📋 Available connections: {Connections}",
                    string.Join(", ", _sockets.Keys));
                throw new InvalidOperationException($"Socket not found: {connectionId}");
            }

            if (socket.State != WebSocketState.Open)
            {
                _logger.LogWarning("⚠️ Socket not open: {ConnectionId}, State: {State}",
                    connectionId, socket.State);
                await RemoveSocketAsync(connectionId);
                throw new InvalidOperationException($"Socket not in Open state: {connectionId}");
            }

            try
            {
                var bytes = Encoding.UTF8.GetBytes(message);
                var buffer = new ArraySegment<byte>(bytes);

                await _sendLock.WaitAsync();
                try
                {
                    await socket.SendAsync(
                        buffer,
                        WebSocketMessageType.Text,
                        endOfMessage: true,
                        CancellationToken.None
                    );

                    if (_deviceInfo.TryGetValue(connectionId, out var info))
                    {
                        info.LastActivity = DateTime.UtcNow;
                    }

                    _logger.LogDebug("📤 Message sent to {ConnectionId}: {MessagePreview}",
                        connectionId,
                        message.Length > 100 ? message.Substring(0, 100) + "..." : message);
                }
                finally
                {
                    _sendLock.Release();
                }
            }
            catch (WebSocketException wsEx)
            {
                _logger.LogError(wsEx, "WebSocket error sending to {ConnectionId}", connectionId);
                await RemoveSocketAsync(connectionId);
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending message to {ConnectionId}", connectionId);
                throw;
            }
        }

        /// <summary>
        /// Broadcast message to all devices of a specific type
        /// </summary>
        public async Task BroadcastToTypeAsync(string type, object message)
        {
            // ✅ CRITICAL: Clean up dead connections FIRST
            await CleanupDeadConnections();

            // ✅ Get only ACTIVE connections (not just registered)
            var devices = GetActiveConnections(type);

            if (!devices.Any())
            {
                _logger.LogWarning("⚠️ No active devices of type {Type} connected", type);
                return;
            }

            _logger.LogInformation("📡 Broadcasting to {Count} active device(s) of type {Type}",
                devices.Count, type);

            int successCount = 0;
            int failCount = 0;

            foreach (var connectionId in devices)
            {
                try
                {
                    // ✅ Double-check connection is still active
                    if (!IsConnectionActive(connectionId))
                    {
                        _logger.LogWarning("⚠️ Skipping {ConnId} - no longer active", connectionId);
                        failCount++;
                        continue;
                    }

                    await SendMessageAsync(connectionId, message);
                    successCount++;
                }
                catch (Exception ex)
                {
                    failCount++;
                    _logger.LogWarning(ex, "Failed to broadcast to {ConnectionId}", connectionId);
                }
            }

            _logger.LogInformation("✅ Broadcast complete: {Success} success, {Fail} failed",
                successCount, failCount);
        }

        /// <summary>
        /// Get ONLY actually connected devices (socket exists and is open)
        /// </summary>
        public List<string> GetActiveConnections(string type = null)
        {
            var activeConnections = new List<string>();

            foreach (var kvp in _sockets)
            {
                var connectionId = kvp.Key;
                var socket = kvp.Value;

                // Only include if socket is actually open
                if (socket != null && socket.State == WebSocketState.Open)
                {
                    // Filter by type if specified
                    if (!string.IsNullOrEmpty(type))
                    {
                        if (_deviceInfo.TryGetValue(connectionId, out var info))
                        {
                            if (info.Type?.Equals(type, StringComparison.OrdinalIgnoreCase) == true)
                            {
                                activeConnections.Add(connectionId);
                            }
                        }
                    }
                    else
                    {
                        activeConnections.Add(connectionId);
                    }
                }
            }

            return activeConnections;
        }

        /// <summary>
        /// Verify if a connection is actually alive
        /// </summary>
        public bool IsConnectionActive(string connectionId)
        {
            if (_sockets.TryGetValue(connectionId, out var socket))
            {
                return socket != null && socket.State == WebSocketState.Open;
            }
            return false;
        }

        /// <summary>
        /// Clean up dead connections
        /// </summary>
        public async Task CleanupDeadConnections()
        {
            var deadConnections = new List<string>();

            foreach (var kvp in _sockets)
            {
                var connectionId = kvp.Key;
                var socket = kvp.Value;

                if (socket == null ||
                    socket.State == WebSocketState.Closed ||
                    socket.State == WebSocketState.Aborted)
                {
                    deadConnections.Add(connectionId);
                }
            }

            foreach (var connectionId in deadConnections)
            {
                await RemoveSocketAsync(connectionId);
                _logger.LogInformation("🧹 Cleaned up dead connection: {ConnectionId}", connectionId);
            }

            if (deadConnections.Count > 0)
            {
                _logger.LogInformation("🧹 Cleanup complete: {Count} dead connections removed",
                    deadConnections.Count);
            }
        }

        /// <summary>
        /// Broadcast message to all connected devices
        /// </summary>
        public async Task BroadcastToAllAsync(string message)
        {
            var allDevices = GetAllConnectedDevices();

            if (!allDevices.Any())
            {
                _logger.LogWarning("⚠️ No devices connected for broadcast");
                return;
            }

            _logger.LogInformation("📡 Broadcasting to all {Count} connected device(s)", allDevices.Count);

            var tasks = allDevices.Select(async connectionId =>
            {
                try
                {
                    await SendMessageAsync(connectionId, message);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to broadcast to {ConnectionId}", connectionId);
                }
            });

            await Task.WhenAll(tasks);
        }

        /// <summary>
        /// Extract device ID from connection ID
        /// </summary>
        private string ExtractDeviceId(string connectionId, string type)
        {
            // If connectionId follows pattern "type_deviceId", extract deviceId
            var prefix = $"{type}_";
            if (connectionId.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return connectionId.Substring(prefix.Length);
            }

            return connectionId;
        }

        /// <summary>
        /// Clean up inactive connections
        /// </summary>
        public async Task CleanupInactiveConnections(TimeSpan inactivityThreshold)
        {
            var cutoffTime = DateTime.UtcNow - inactivityThreshold;
            var inactiveConnections = _deviceInfo.Values
                .Where(info => info.LastActivity < cutoffTime)
                .Select(info => info.ConnectionId)
                .ToList();

            foreach (var connectionId in inactiveConnections)
            {
                _logger.LogInformation("🧹 Cleaning up inactive connection: {ConnectionId}", connectionId);
                await RemoveSocketAsync(connectionId);
            }

            if (inactiveConnections.Any())
            {
                _logger.LogInformation("🧹 Cleaned up {Count} inactive connection(s)", inactiveConnections.Count);
            }
        }

        /// <summary>
        /// Get connection statistics for debugging
        /// </summary>
        public Dictionary<string, object> GetConnectionStats()
        {
            var stats = new Dictionary<string, object>
            {
                ["total_connections"] = _sockets.Count,
                ["by_type"] = _deviceInfo.Values
                    .GroupBy(d => d.Type)
                    .ToDictionary(g => g.Key, g => g.Count()),
                ["connections"] = _deviceInfo.Values.Select(d => new
                {
                    d.ConnectionId,
                    d.DeviceId,
                    d.Type,
                    d.Outlet,
                    State = _sockets.TryGetValue(d.ConnectionId, out var socket)
                        ? socket.State.ToString()
                        : "Unknown",
                    d.ConnectedAt,
                    d.LastActivity
                }).ToList()
            };

            return stats;
        }

        /// <summary>
        /// Get all device connection information (for validation and syncing)
        /// </summary>
        public List<DeviceConnectionInfo> GetAllDeviceInfo()
        {
            return _deviceInfo.Values.ToList();
        }

        /// <summary>
        /// Get device connections filtered by outlet/location
        /// </summary>
        public List<DeviceConnectionInfo> GetDevicesByOutlet(string outlet)
        {
            return _deviceInfo.Values
                .Where(info => info.Outlet.Equals(outlet, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        /// <summary>
        /// Check if device is connected via WebSocket
        /// </summary>
        public bool IsDeviceConnected(string deviceId, string outlet)
        {
            return _deviceInfo.Values.Any(info =>
                info.DeviceId.Equals(deviceId, StringComparison.OrdinalIgnoreCase) &&
                info.Outlet.Equals(outlet, StringComparison.OrdinalIgnoreCase));
        }
    }

    /// <summary>
    /// Device connection information
    /// </summary>
    public class DeviceConnectionInfo
    {
        public string ConnectionId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty;
        public string Outlet { get; set; } = string.Empty;
        public DateTime ConnectedAt { get; set; }
        public DateTime LastActivity { get; set; }


        public long? MemberId { get; set; }
        public string? MemberName { get; set; }
        public string? MemberPhone { get; set; }
        public int? MemberPoints { get; set; }

        public EberCustomerResponse? Member { get; set; }


        public bool IsMemberLoggedIn => MemberId.HasValue;
    }
}