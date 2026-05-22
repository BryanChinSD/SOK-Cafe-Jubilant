using CafeJubilant_SOK.Models;
using CafeJubilant_SOK.Services;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Concurrent;
using System.Text.Json;
using static CafeJubilant_SOK.Models.KioskModel;

namespace CafeJubilant_SOK.Controllers
{
    [ApiController]
    [Route("API/[controller]")]
    public class RemoteControlController : ControllerBase
    {
        private readonly WebSocketConnectionManager _wsManager;
        private readonly ILogger<RemoteControlController> _logger;

        // Store active control sessions - open to everyone
        private static readonly ConcurrentDictionary<string, ControlSession> _controlSessions = new();
        private static readonly ConcurrentDictionary<string, CafeJubilant_SOK.Models.KioskModel.DeviceInfo> _registeredDevices = new();

        public RemoteControlController(
            WebSocketConnectionManager wsManager,
            ILogger<RemoteControlController> logger)
        {
            _wsManager = wsManager;
            _logger = logger;
        }

        public class ControlSession
        {
            public string SessionId { get; set; }
            public string ControllerDeviceId { get; set; }
            public string SokDeviceId { get; set; }
            public DateTime StartedAt { get; set; }
            public DateTime LastActivityAt { get; set; }
        }


        /// <summary>
        /// Register or update a SOK device
        /// </summary>
        [HttpPost("register-device")]
        public IActionResult RegisterDevice([FromBody] DeviceRegistrationDto request)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(request.DeviceId))
                {
                    return BadRequest(new { success = false, error = "Device ID is required" });
                }

                var deviceInfo = new CafeJubilant_SOK.Models.KioskModel.DeviceInfo
                {
                    DeviceId = request.DeviceId,
                    DeviceName = request.DeviceName ?? $"SOK Machine {request.DeviceId}",
                    Location = request.Location ?? "Unknown",
                    RegisteredAt = request.RegisteredAt != default ? request.RegisteredAt : DateTime.UtcNow,
                    LastSeenAt = DateTime.UtcNow,
                    IsActive = true
                };

                var isNewDevice = !_registeredDevices.ContainsKey(request.DeviceId);
                _registeredDevices[request.DeviceId] = deviceInfo;

                // Set device ID in cookie for session persistence
                var cookieOptions = new CookieOptions
                {
                    HttpOnly = false, // Allow JavaScript to read it
                    Secure = true,
                    SameSite = SameSiteMode.Strict,
                    Expires = DateTimeOffset.UtcNow.AddYears(1)
                };

                Response.Cookies.Append("sok_device_id", request.DeviceId, cookieOptions);

                _logger.LogInformation(
                    "{Action} device: {DeviceId} ({DeviceName}) at {Location}",
                    isNewDevice ? "Registered new" : "Updated",
                    deviceInfo.DeviceId,
                    deviceInfo.DeviceName,
                    deviceInfo.Location
                );

                return Ok(new
                {
                    success = true,
                    message = isNewDevice ? "Device registered successfully" : "Device updated successfully",
                    device = deviceInfo,
                    isNewDevice = isNewDevice
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error registering device");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get device information
        /// </summary>
        [HttpGet("device-info")]
        public IActionResult GetDeviceInfo([FromQuery] string deviceId = null)
        {
            try
            {
                // Try to get from query parameter first
                if (string.IsNullOrWhiteSpace(deviceId))
                {
                    // Try to get from cookie
                    deviceId = Request.Cookies["sok_device_id"];
                }

                if (string.IsNullOrWhiteSpace(deviceId))
                {
                    return BadRequest(new
                    {
                        success = false,
                        error = "Device ID not found in request or cookies"
                    });
                }

                if (_registeredDevices.TryGetValue(deviceId, out var device))
                {
                    // Update last seen
                    device.LastSeenAt = DateTime.UtcNow;

                    return Ok(new
                    {
                        success = true,
                        device = device
                    });
                }

                return NotFound(new
                {
                    success = false,
                    error = "Device not registered",
                    deviceId = deviceId
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting device info");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// List all registered devices
        /// </summary>
        [HttpGet("list-devices")]
        public IActionResult ListAllDevices()
        {
            try
            {
                var devices = _registeredDevices.Values
                    .OrderBy(d => d.DeviceId)
                    .ToList();

                return Ok(new
                {
                    success = true,
                    devices = devices,
                    count = devices.Count,
                    active = devices.Count(d => d.IsActive)
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error listing devices");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Update device status (heartbeat)
        /// </summary>
        [HttpPost("device-heartbeat")]
        public IActionResult DeviceHeartbeat([FromQuery] string deviceId = null)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(deviceId))
                {
                    deviceId = Request.Cookies["sok_device_id"];
                }

                if (string.IsNullOrWhiteSpace(deviceId))
                {
                    return BadRequest(new { success = false, error = "Device ID required" });
                }

                if (_registeredDevices.TryGetValue(deviceId, out var device))
                {
                    device.LastSeenAt = DateTime.UtcNow;
                    device.IsActive = true;

                    return Ok(new
                    {
                        success = true,
                        deviceId = deviceId,
                        lastSeen = device.LastSeenAt
                    });
                }

                return NotFound(new { success = false, error = "Device not registered" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating device heartbeat");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Deactivate a device
        /// </summary>
        [HttpPost("deactivate-device")]
        public IActionResult DeactivateDevice([FromQuery] string deviceId)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(deviceId))
                {
                    return BadRequest(new { success = false, error = "Device ID required" });
                }

                if (_registeredDevices.TryGetValue(deviceId, out var device))
                {
                    device.IsActive = false;
                    device.LastSeenAt = DateTime.UtcNow;

                    _logger.LogInformation("Device deactivated: {DeviceId}", deviceId);

                    return Ok(new
                    {
                        success = true,
                        message = "Device deactivated",
                        deviceId = deviceId
                    });
                }

                return NotFound(new { success = false, error = "Device not found" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deactivating device");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }


        /// <summary>
        /// Request remote access to SOK device - OPEN TO EVERYONE, NO AUTH REQUIRED
        /// </summary>
        [HttpPost("request-access")]
        public async Task<IActionResult> RequestAccess([FromBody] AccessRequestDto request)
        {
            try
            {
                _logger.LogInformation("Access request from {ControllerId} to SOK {SokId}",
                    request.ControllerDeviceId, request.SokDeviceId);

                var sokConnectionId = $"sok_{request.SokDeviceId}";

                // Check if SOK device exists
                if (_wsManager.GetSocketById(sokConnectionId) == null)
                {
                    return BadRequest(new
                    {
                        success = false,
                        error = "SOK device not connected",
                        sokDeviceId = request.SokDeviceId
                    });
                }

                // Check if SOK is already being controlled
                var existingSession = _controlSessions.Values
                    .FirstOrDefault(s => s.SokDeviceId == request.SokDeviceId);

                if (existingSession != null && !request.ForceOverride)
                {
                    return Ok(new
                    {
                        success = false,
                        error = "SOK device is already being controlled",
                        controlledBy = existingSession.ControllerDeviceId,
                        sessionId = existingSession.SessionId,
                        hint = "Set forceOverride=true to take control"
                    });
                }

                // AUTO-GRANT ACCESS - No approval needed
                var sessionId = Guid.NewGuid().ToString();
                var session = new ControlSession
                {
                    SessionId = sessionId,
                    ControllerDeviceId = request.ControllerDeviceId,
                    SokDeviceId = request.SokDeviceId,
                    StartedAt = DateTime.UtcNow,
                    LastActivityAt = DateTime.UtcNow
                };

                // Remove old session if force override
                if (existingSession != null && request.ForceOverride)
                {
                    _controlSessions.TryRemove(existingSession.SessionId, out _);
                    _logger.LogInformation("Control session overridden: {OldSession}", existingSession.SessionId);
                }

                _controlSessions[sessionId] = session;

                // Notify SOK that control is active
                var activeMessage = JsonSerializer.Serialize(new
                {
                    action = "control_active",
                    sessionId = sessionId,
                    controllerDeviceId = request.ControllerDeviceId,
                    message = request.Message ?? "Remote control active",
                    timestamp = DateTime.UtcNow
                });
                await _wsManager.SendMessageAsync(sokConnectionId, activeMessage);

                // Request initial screen sync
                var syncMessage = JsonSerializer.Serialize(new
                {
                    action = "request_screen_sync",
                    sessionId = sessionId,
                    timestamp = DateTime.UtcNow
                });
                await _wsManager.SendMessageAsync(sokConnectionId, syncMessage);

                _logger.LogInformation("Access AUTO-GRANTED: Session {SessionId}", sessionId);

                return Ok(new
                {
                    success = true,
                    sessionId = sessionId,
                    sokDeviceId = request.SokDeviceId,
                    message = "Access granted - control active",
                    startedAt = session.StartedAt
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing access request");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Release remote control - Anyone can release any session
        /// </summary>
        [HttpPost("release-control")]
        public async Task<IActionResult> ReleaseControl([FromBody] ReleaseControlDto request)
        {
            try
            {
                ControlSession session = null;

                // Find session by SessionId OR SokDeviceId
                if (!string.IsNullOrEmpty(request.SessionId))
                {
                    _controlSessions.TryGetValue(request.SessionId, out session);
                }
                else if (!string.IsNullOrEmpty(request.SokDeviceId))
                {
                    session = _controlSessions.Values
                        .FirstOrDefault(s => s.SokDeviceId == request.SokDeviceId);
                }

                if (session == null)
                {
                    return Ok(new
                    {
                        success = false,
                        error = "No active control session found"
                    });
                }

                // Remove session
                _controlSessions.TryRemove(session.SessionId, out _);

                var sokConnectionId = $"sok_{session.SokDeviceId}";

                // Notify SOK
                var releaseMessage = JsonSerializer.Serialize(new
                {
                    action = "control_released",
                    sessionId = session.SessionId,
                    message = "Remote control has been released",
                    timestamp = DateTime.UtcNow
                });
                await _wsManager.SendMessageAsync(sokConnectionId, releaseMessage);

                _logger.LogInformation("Control released: Session {SessionId}", session.SessionId);

                return Ok(new
                {
                    success = true,
                    message = "Control released successfully",
                    sessionId = session.SessionId,
                    sokDeviceId = session.SokDeviceId
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error releasing control");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Send remote control command to SOK - Anyone can send if they have sessionId
        /// </summary>
        [HttpPost("send-command")]
        public async Task<IActionResult> SendCommand([FromBody] RemoteCommandDto request)
        {
            try
            {
                // Find session
                var session = _controlSessions.Values
                    .FirstOrDefault(s =>
                        s.SokDeviceId == request.SokDeviceId &&
                        (string.IsNullOrEmpty(request.SessionId) || s.SessionId == request.SessionId));

                if (session == null)
                {
                    return Ok(new
                    {
                        success = false,
                        error = "No active control session for this SOK device",
                        hint = "Request access first using /request-access"
                    });
                }

                // Update last activity
                session.LastActivityAt = DateTime.UtcNow;

                var sokConnectionId = $"sok_{request.SokDeviceId}";

                // Send command to SOK
                var commandMessage = JsonSerializer.Serialize(new
                {
                    action = "remote_control",
                    sessionId = session.SessionId,
                    command = request.Command,
                    data = request.Data,
                    timestamp = DateTime.UtcNow
                });

                await _wsManager.SendMessageAsync(sokConnectionId, commandMessage);

                _logger.LogInformation("Command sent: {Command} to SOK {SokId}",
                    request.Command, request.SokDeviceId);

                return Ok(new
                {
                    success = true,
                    message = "Command sent successfully",
                    sessionId = session.SessionId,
                    command = request.Command
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending command");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Request screen sync from SOK device
        /// </summary>
        [HttpPost("request-screen-sync")]
        public async Task<IActionResult> RequestScreenSync([FromBody] ScreenSyncRequestDto request)
        {
            try
            {
                var sokConnectionId = $"sok_{request.SokDeviceId}";

                if (_wsManager.GetSocketById(sokConnectionId) == null)
                {
                    return BadRequest(new
                    {
                        success = false,
                        error = "SOK device not connected"
                    });
                }

                var message = JsonSerializer.Serialize(new
                {
                    action = "request_screen_sync",
                    timestamp = DateTime.UtcNow
                });

                await _wsManager.SendMessageAsync(sokConnectionId, message);

                _logger.LogInformation("Screen sync requested for SOK {SokId}", request.SokDeviceId);

                return Ok(new
                {
                    success = true,
                    message = "Screen sync requested"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error requesting screen sync");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get list of available SOK devices
        /// </summary>
        [HttpGet("sok-devices")]
        public IActionResult GetSOKDevices()
        {
            try
            {
                var sokDevices = _wsManager.GetConnectedDevices("pos")
                    .Select(id => {
                        var deviceId = id.Replace("sok_", "");
                        var session = _controlSessions.Values
                            .FirstOrDefault(s => s.SokDeviceId == deviceId);

                        return new
                        {
                            deviceId = deviceId,
                            connectionId = id,
                            isControlled = session != null,
                            controlledBy = session?.ControllerDeviceId,
                            sessionId = session?.SessionId,
                            controlStartedAt = session?.StartedAt
                        };
                    })
                    .ToList();
                _logger.LogInformation("GetSOKDevices {SokId}", sokDevices);

                return Ok(new
                {
                    success = true,
                    devices = sokDevices,
                    count = sokDevices.Count
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting SOK devices");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get active control sessions
        /// </summary>
        [HttpGet("sessions")]
        public IActionResult GetActiveSessions()
        {
            try
            {
                var sessions = _controlSessions.Values
                    .Select(s => new
                    {
                        sessionId = s.SessionId,
                        controllerDeviceId = s.ControllerDeviceId,
                        sokDeviceId = s.SokDeviceId,
                        startedAt = s.StartedAt,
                        lastActivityAt = s.LastActivityAt,
                        durationSeconds = (DateTime.UtcNow - s.StartedAt).TotalSeconds,
                        isActive = (DateTime.UtcNow - s.LastActivityAt).TotalMinutes < 5
                    })
                    .ToList();

                return Ok(new
                {
                    success = true,
                    sessions = sessions,
                    count = sessions.Count
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting sessions");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get session details by ID
        /// </summary>
        [HttpGet("sessions/{sessionId}")]
        public IActionResult GetSession(string sessionId)
        {
            if (!_controlSessions.TryGetValue(sessionId, out var session))
            {
                return NotFound(new
                {
                    success = false,
                    error = "Session not found"
                });
            }

            return Ok(new
            {
                success = true,
                session = new
                {
                    sessionId = session.SessionId,
                    controllerDeviceId = session.ControllerDeviceId,
                    sokDeviceId = session.SokDeviceId,
                    startedAt = session.StartedAt,
                    lastActivityAt = session.LastActivityAt,
                    durationSeconds = (DateTime.UtcNow - session.StartedAt).TotalSeconds
                }
            });
        }

        /// <summary>
        /// Cleanup expired sessions (inactive for more than specified minutes)
        /// </summary>
        [HttpPost("cleanup")]
        public IActionResult CleanupExpired([FromQuery] int inactiveMinutes = 30)
        {
            try
            {
                var cutoffTime = DateTime.UtcNow.AddMinutes(-inactiveMinutes);

                var expiredSessions = _controlSessions
                    .Where(kvp => kvp.Value.LastActivityAt < cutoffTime)
                    .Select(kvp => kvp.Key)
                    .ToList();

                foreach (var sessionId in expiredSessions)
                {
                    if (_controlSessions.TryRemove(sessionId, out var session))
                    {
                        _logger.LogInformation("Cleaned up expired session: {SessionId}", sessionId);
                    }
                }

                return Ok(new
                {
                    success = true,
                    message = "Cleanup completed",
                    removedSessions = expiredSessions.Count,
                    activeSessions = _controlSessions.Count
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during cleanup");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Health check endpoint
        /// </summary>
        [HttpGet("health")]
        public IActionResult Health()
        {
            return Ok(new
            {
                success = true,
                status = "healthy",
                activeSessions = _controlSessions.Count,
                timestamp = DateTime.UtcNow
            });
        }
    }


}