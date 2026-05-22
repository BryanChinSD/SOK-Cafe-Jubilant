using CafeJubilant_SOK.Models;
using CafeJubilant_SOK.Services;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using static CafeJubilant_SOK.Models.KioskModel;

namespace CafeJubilant_SOK.Controllers
{
    [ApiController]
    [Route("API/[controller]")]
    public class SOKOrderController : ControllerBase
    {
        private readonly WebSocketConnectionManager _wsManager;
        private readonly ILogger<SOKOrderController> _logger;

        // In-memory storage for SOK orders
        private static readonly ConcurrentDictionary<string, KioskModel.SOKOrder> _orders = new();

        // In-memory storage for order caches by table/device
        internal static readonly ConcurrentDictionary<string, OrderCache> _orderCaches = new();

        // ✅ Track pending sync operations to prevent race conditions
        private static readonly ConcurrentDictionary<string, DateTime> _pendingSyncs = new();

        private static readonly ConcurrentDictionary<string, DeviceInfo> _deviceRegistry = new();


        public SOKOrderController(
            WebSocketConnectionManager wsManager,
            ILogger<SOKOrderController> logger)
        {
            _wsManager = wsManager;
            _logger = logger;
        }


        /// <summary>
        /// Broadcast POS sync update to connected devices
        /// ✅ FIXED: Uses deviceId directly (no orderType suffix)
        /// </summary>
        private async Task<int> BroadcastPOSUpdate(OrderCache cache, string posDeviceId)
        {
            try
            {
                var salesDtls = cache.OrderData?.SalesDtls ?? new List<SalesDetail>();
                var itemCount = salesDtls.Count(item => item.SNo == item.ParentSno);

                // ✅ Send in jsondata array format
                var messageObj = new
                {
                    action = "pos_sync",
                    source = "pos",
                    jsondata = new[] { cache.OrderData }, // ✅ Wrap in array
                    metadata = new
                    {
                        posDeviceId = posDeviceId,
                        deviceId = cache.DeviceId,
                        orderId = cache.OrderId,
                        orderType = cache.OrderType,
                        status = cache.Status,
                        tableNo = cache.TableNo,
                        totalAmount = cache.TotalAmount,
                        itemCount = itemCount,
                        timestamp = DateTime.UtcNow
                    }
                };

                var broadcastCount = 0;

                // Send to specific device
                if (!string.IsNullOrEmpty(cache.DeviceId))
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(cache.DeviceId, messageObj);
                        broadcastCount++;

                        _logger.LogInformation(
                            "✅ POS sync sent to {DeviceId}: Order {OrderId}, Items: {Items}, Total: ${Total}",
                            cache.DeviceId, cache.OrderId, itemCount, cache.TotalAmount
                        );
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(
                            "⚠️ Device {DeviceId} not available: {Message}",
                            cache.DeviceId, ex.Message
                        );
                    }
                }

                // Broadcast to all SOK devices
                try
                {
                    await _wsManager.BroadcastToTypeAsync("sok", messageObj);
                    broadcastCount++;
                    _logger.LogInformation("✅ POS sync broadcasted to all SOK devices");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "❌ Failed to broadcast POS sync to SOK devices");
                }

                return broadcastCount;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error in BroadcastPOSUpdate");
                return 0;
            }
        }
        /// <summary>
        /// ✅ Broadcast cache update to ALL SOK devices (including sender)
        /// </summary>
        public async Task BroadcastCacheUpdate(OrderCache cache)
        {
            try
            {
                var salesDtls = cache.OrderData?.SalesDtls ?? new List<SalesDetail>();
                var itemCount = salesDtls.Count(i => i.SNo == i.ParentSno);

                // Build the message object once
                var messageObj = new
                {
                    action = "cache_updated",
                    deviceId = cache.DeviceId,
                    orderType = cache.OrderType,
                    orderId = cache.OrderId,
                    orderData = cache.OrderData,
                    status = cache.Status,
                    totalAmount = cache.TotalAmount,
                    itemCount,
                    summary = new
                    {
                        itemCount,
                        netAmount = cache.OrderData?.NetAmt ?? "0.00",
                        subTotal = cache.OrderData?.SubTotal ?? "0.00",
                        totalTax = cache.OrderData?.TotalTax ?? "0.00",
                        totalSvc = cache.OrderData?.TotalSvc ?? "0.00"
                    },
                    timestamp = DateTime.UtcNow
                };

                var message = JsonSerializer.Serialize(messageObj);

                // Get all connected SOK devices (including sender)
                var sokDevices = _wsManager.GetConnectedDevices("sok");

                if (sokDevices.Count == 0)
                {
                    _logger.LogWarning("⚠️ No connected SOK devices found for broadcast.");
                    return;
                }

                // 🔥 Parallel send to all devices
                var tasks = sokDevices.Select(deviceId =>
                    _wsManager.SendMessageAsync(deviceId, message)
                        .ContinueWith(t =>
                        {
                            if (t.IsFaulted)
                                _logger.LogWarning(t.Exception, "Failed to broadcast to {DeviceId}", deviceId);
                        })
                );

                await Task.WhenAll(tasks);

                _logger.LogInformation("✅ Broadcasted cache update to {Count} SOK devices (parallel)", sokDevices.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error broadcasting cache update");
            }
        }


        /// <summary>
        /// Send order notification to specific device
        /// POST /API/ws/notify-order
        /// </summary>
        [HttpPost("notify-order")]
        public async Task<IActionResult> NotifyOrder(
            [FromQuery] string deviceId,
            [FromBody] object orderData)
        {
            if (string.IsNullOrWhiteSpace(deviceId))
                return BadRequest(new { success = false, error = "deviceId is required" });

            try
            {
                // Check if device is connected (no orderType suffix anymore)
                var socket = _wsManager.GetSocketById(deviceId);
                if (socket == null)
                {
                    return NotFound(new
                    {
                        success = false,
                        error = "Device not connected",
                        connectionId = deviceId
                    });
                }

                // ✅ Use object overload
                await _wsManager.SendMessageAsync(deviceId, new
                {
                    action = "new_order",
                    data = orderData,
                    timestamp = DateTime.UtcNow
                });

                return Ok(new
                {
                    success = true,
                    message = "Order notification sent",
                    connectionId = deviceId,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending order notification");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }


        /// <summary>
        /// Register or update device information
        /// </summary>
        [HttpPost("devices/register")]
        public IActionResult RegisterDevice([FromBody] DeviceRegistrationDto request)
        {
            try
            {
                var deviceKey = $"{request.Location}_{request.DeviceId}";

                var deviceInfo = new DeviceInfo
                {
                    DeviceId = request.DeviceId,
                    DeviceName = request.DeviceName,
                    Location = request.Location,
                    RegisteredAt = DateTime.UtcNow,
                    LastSeenAt = DateTime.UtcNow,
                    IsActive = true
                };

                _deviceRegistry[deviceKey] = deviceInfo;

                _logger.LogInformation("✅ Device registered: {DeviceId} at {Location}",
                    request.DeviceId, request.Location);

                return Ok(new
                {
                    success = true,
                    message = "Device registered successfully",
                    device = deviceInfo
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error registering device");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Validate device exists and is active
        /// ✅ Enhanced: Falls back to WebSocket registry if device not in device registry
        /// </summary>
        private bool ValidateDevice(string location, string deviceId, out string errorMessage)
        {
            errorMessage = null;

            if (string.IsNullOrEmpty(location))
            {
                errorMessage = "Location is required";
                return false;
            }

            if (string.IsNullOrEmpty(deviceId))
            {
                errorMessage = "Device ID is required";
                return false;
            }

            var deviceKey = $"{location}_{deviceId}";

            // STEP 1: Check registry
            if (_deviceRegistry.TryGetValue(deviceKey, out var device))
            {
                if (!device.IsActive)
                {
                    errorMessage = $"Device is inactive: {deviceId} at {location}";
                    return false;
                }

                device.LastSeenAt = DateTime.UtcNow;
                _deviceRegistry[deviceKey] = device;

                _logger.LogDebug("✅ Device validated from registry: {DeviceId} at {Location}", deviceId, location);
                return true;
            }

            // STEP 2: Fallback - check WebSocket connections safely
            try
            {
                var sokConnections = _wsManager.GetConnectedDevices("sok") ?? new List<string>();

                foreach (var connectionId in sokConnections)
                {
                    var wsDeviceInfo = _wsManager.GetDeviceInfoById(connectionId);
                    if (wsDeviceInfo != null &&
                        wsDeviceInfo.DeviceId.Equals(deviceId, StringComparison.OrdinalIgnoreCase) &&
                        wsDeviceInfo.Outlet?.Equals(location, StringComparison.OrdinalIgnoreCase) == true)
                    {
                        // Auto-register device
                        _deviceRegistry[deviceKey] = new DeviceInfo
                        {
                            DeviceId = deviceId,
                            DeviceName = $"SOK-{deviceId}",
                            Location = location,
                            RegisteredAt = DateTime.UtcNow,
                            LastSeenAt = DateTime.UtcNow,
                            IsActive = true
                        };

                        _logger.LogInformation("✅ Auto-registered device from WebSocket: {DeviceId} at {Location} (ConnectionId: {ConnectionId})",
                            deviceId, location, connectionId);

                        return true;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "⚠️ WebSocket check failed for device {DeviceId}", deviceId);
                // Don't throw, just fail validation
            }

            // STEP 3: Device not found
            _logger.LogWarning("❌ Device validation failed: {DeviceId} at {Location}", deviceId, location);
            errorMessage = $"Device not registered: {deviceId} at {location}";
            return false;
        }


        /// <summary>
        /// DELETE ORDER CACHE - Clear cached order by device and order type
        /// </summary>
        [HttpPost("{location}/{deviceId}/cache/clear")]
        public async Task<IActionResult> ClearOrderCache(
        string location,
        string deviceId)
        {
            try
            {
                _logger.LogInformation("=== START ClearOrderCache ===");
                _logger.LogInformation($"Params: location={location}, device={deviceId}");

                // --- STEP 1: Validate device ---
                if (!ValidateDevice(location, deviceId, out var errorMessage))
                {
                    _logger.LogWarning("Device validation failed: {Error}", errorMessage);
                    return Ok(new { success = false, error = errorMessage });
                }

                int removedCount = 0;
                int broadcastSuccessCount = 0;
                int broadcastFailCount = 0;

                // Clear all caches for device
                _logger.LogInformation("Clearing all caches for device: {Device}", deviceId);

                var keysToRemove = _orderCaches.Keys
                    .Where(k => k.StartsWith($"{deviceId}_"))
                    .ToList();

                _logger.LogInformation("Found {Count} cache entries to remove", keysToRemove.Count);

                foreach (var key in keysToRemove)
                {
                    // Get the cache item before removing so we can broadcast it
                    if (_orderCaches.TryRemove(key, out var removedCacheItem))
                    {
                        removedCount++;
                        _logger.LogInformation("Removed cache key: {CacheKey}", key);

                        // Broadcast cache cleared
                        try
                        {
                            await BroadcastCacheCleared(removedCacheItem);
                            broadcastSuccessCount++;
                            _logger.LogInformation("Broadcast successful for cache key: {CacheKey}", key);
                        }
                        catch (Exception ex)
                        {
                            broadcastFailCount++;
                            _logger.LogWarning(ex, "Broadcast failed for cache key {CacheKey}", key);
                        }

                        // Remove matching order if exists
                        var orderToRemove = _orders.Values
                            .FirstOrDefault(o => o.OrderId == removedCacheItem.OrderId &&
                                                 (o.DeviceId == deviceId || o.SokDeviceId == deviceId));

                        if (orderToRemove != null)
                        {
                            if (_orders.TryRemove(orderToRemove.OrderId, out _))
                            {
                                _logger.LogInformation("Removed associated order: {OrderId}", orderToRemove.OrderId);
                            }
                        }
                    }
                }

                _logger.LogInformation("Bulk clear complete: {Removed} caches, {Success} broadcasts, {Failed} failures",
                    removedCount, broadcastSuccessCount, broadcastFailCount);

                return Ok(new
                {
                    success = true,
                    message = $"Cleared {removedCount} cache entries",
                    location,
                    deviceId,
                    cleared = removedCount,
                    broadcastSuccess = broadcastSuccessCount,
                    broadcastFailed = broadcastFailCount
                });
            }
            catch (Exception ex)
            {
                // NEVER throw 500 — always log and return safe response
                _logger.LogError(ex, "Exception in ClearOrderCache: {Message}", ex.Message);
                return Ok(new
                {
                    success = false,
                    error = "An unexpected error occurred, please try again",
                    details = ex.Message
                });
            }
        }



        /// <summary>
        /// Sync all connected WebSocket devices to device registry
        /// This should be called on application startup or periodically
        /// </summary>
        [HttpPost("devices/sync-from-websocket")]
        public IActionResult SyncDevicesFromWebSocket()
        {
            try
            {
                var wsConnections = _wsManager.GetConnectedDevices("sok");
                int syncedCount = 0;
                int skippedCount = 0;

                foreach (var connectionId in wsConnections)
                {
                    var wsDeviceInfo = _wsManager.GetDeviceInfoById(connectionId);

                    if (wsDeviceInfo == null)
                    {
                        _logger.LogWarning("⚠️ Could not get device info for connection {ConnectionId}", connectionId);
                        continue;
                    }

                    var deviceKey = $"{wsDeviceInfo.Outlet}_{wsDeviceInfo.DeviceId}";

                    if (!_deviceRegistry.ContainsKey(deviceKey))
                    {
                        _deviceRegistry[deviceKey] = new DeviceInfo
                        {
                            DeviceId = wsDeviceInfo.DeviceId,
                            DeviceName = $"SOK-{wsDeviceInfo.DeviceId}",
                            Location = wsDeviceInfo.Outlet,
                            RegisteredAt = DateTime.UtcNow,
                            LastSeenAt = DateTime.UtcNow,
                            IsActive = true
                        };
                        syncedCount++;

                        _logger.LogInformation("✅ Synced device from WebSocket: {DeviceId} at {Location}",
                            wsDeviceInfo.DeviceId, wsDeviceInfo.Outlet);
                    }
                    else
                    {
                        // Update last seen time for existing devices
                        if (_deviceRegistry.TryGetValue(deviceKey, out var existingDevice))
                        {
                            existingDevice.LastSeenAt = DateTime.UtcNow;
                            existingDevice.IsActive = true;
                            _deviceRegistry[deviceKey] = existingDevice;
                        }
                        skippedCount++;
                    }
                }

                _logger.LogInformation("📊 Device sync complete: {Synced} synced, {Skipped} already registered",
                    syncedCount, skippedCount);

                return Ok(new
                {
                    success = true,
                    message = $"Device sync complete",
                    syncedCount = syncedCount,
                    skippedCount = skippedCount,
                    totalRegistered = _deviceRegistry.Count,
                    wsConnections = wsConnections.Count
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error syncing devices from WebSocket");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get all registered devices (for debugging)
        /// </summary>
        [HttpGet("devices/registry")]
        public IActionResult GetDeviceRegistry()
        {
            try
            {
                var devices = _deviceRegistry.Select(kvp => new
                {
                    key = kvp.Key,
                    device = kvp.Value
                }).ToList();

                return Ok(new
                {
                    success = true,
                    devices = devices,
                    count = devices.Count
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving device registry");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }


        /// <summary>
        /// Broadcast cache cleared message to all connected clients
        /// ✅ FIXED: Uses deviceId directly (no orderType suffix)
        /// </summary>
        private async Task BroadcastCacheCleared(OrderCache cache)
        {
            var messageObj = new
            {
                action = "cache_cleared",
                deviceId = cache.DeviceId,
                orderType = cache.OrderType,
                orderId = cache.OrderId,
                tableNo = cache.TableNo,
                timestamp = DateTime.UtcNow
            };

            // Send to specific device (connectionId is just deviceId now)
            if (!string.IsNullOrEmpty(cache.DeviceId))
            {
                try
                {
                    await _wsManager.SendMessageAsync(cache.DeviceId, messageObj);
                    _logger.LogInformation("✅ Cache cleared message sent to device {DeviceId}", cache.DeviceId);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to send cache cleared to device {DeviceId}", cache.DeviceId);
                }
            }

            // Broadcast to all SOK devices
            try
            {
                await _wsManager.BroadcastToTypeAsync("sok", messageObj);
                _logger.LogInformation("✅ Cache cleared broadcasted to all SOK devices");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to broadcast cache cleared to SOK devices");
            }




        }

        /// <summary>
        /// Handle payment success - Complete order and clear cache
        /// POST /API/SOKOrder/{location}/{deviceId}/payment/success
        /// </summary>
        [HttpPost("{location}/{deviceId}/payment/success")]
        public async Task<IActionResult> HandlePaymentSuccess(
            string location,
            string deviceId,
            [FromBody] PaymentSuccessDto request)
        {
            try
            {
                _logger.LogInformation("💳 Payment success for device: {DeviceId}, OrderType: {OrderType}",
                    deviceId, request.OrderType);

                // ✅ Validate device
                if (!ValidateDevice(location, deviceId, out var errorMessage))
                {
                    return BadRequest(new { success = false, error = errorMessage });
                }

                // Build cache key
                var cacheKey = $"{deviceId}_{request.OrderType}";

                // ✅ Find the order cache
                if (!_orderCaches.TryGetValue(cacheKey, out var cache))
                {
                    _logger.LogWarning("⚠️ Cache not found for payment: {CacheKey}", cacheKey);
                    return NotFound(new
                    {
                        success = false,
                        error = "Order cache not found",
                        cacheKey
                    });
                }

                var orderId = cache.OrderId;
                var queueNumber = GenerateQueueNumber(cache);
                var orderData = cache.OrderData;
                var totalAmount = cache.TotalAmount;
                var itemCount = orderData?.SalesDtls?.Count(i => i.SNo == i.ParentSno) ?? 0;

                _logger.LogInformation("💰 Processing payment for Order {OrderId}, Queue: {Queue}, Amount: ${Amount}",
                    orderId, queueNumber, totalAmount);

                // ✅ Create completed order record (optional - for order history)
                var completedOrder = new SOKOrder
                {
                    OrderId = orderId,
                    SokDeviceId = deviceId,
                    DeviceId = deviceId,
                    QueueNumber = queueNumber,
                    OrderData = orderData,
                    Status = "completed",
                    CreatedAt = cache.CreatedAt,
                    UpdatedAt = DateTime.UtcNow,
                    CompletedAt = DateTime.UtcNow,
                    CreatedBy = $"{location}_{deviceId}",
                    UpdatedBy = "payment-system"
                };

                // Store in orders dictionary (for history/reporting)
                _orders[orderId] = completedOrder;

                // ✅ Remove from cache (order is now complete)
                _orderCaches.TryRemove(cacheKey, out _);

                _logger.LogInformation("✅ Order {OrderId} marked as completed and removed from cache", orderId);

                // ✅ Build payment success notification
                var paymentNotification = new
                {
                    action = "payment_success",
                    orderId,
                    queueNumber,
                    deviceId,
                    orderType = request.OrderType,
                    location,
                    paymentDetails = new
                    {
                        paymentMethod = request.PaymentMethod ?? "unknown",
                        transactionId = request.TransactionId,
                        amount = totalAmount,
                        paidAt = DateTime.UtcNow
                    },
                    orderSummary = new
                    {
                        itemCount,
                        subTotal = orderData?.SubTotal ?? "0.00",
                        totalTax = orderData?.TotalTax ?? "0.00",
                        totalSvc = orderData?.TotalSvc ?? "0.00",
                        netAmount = orderData?.NetAmt ?? "0.00"
                    },
                    timestamp = DateTime.UtcNow
                };

                // ✅ Broadcast to ALL SOK devices
                var sokDevices = _wsManager.GetConnectedDevices("sok");
                int successCount = 0;
                int failCount = 0;

                foreach (var connId in sokDevices)
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(connId, paymentNotification);
                        successCount++;
                        _logger.LogInformation("📤 Payment notification sent to {ConnId}", connId);
                    }
                    catch (Exception ex)
                    {
                        failCount++;
                        _logger.LogWarning(ex, "⚠️ Failed to notify {ConnId}", connId);
                    }
                }

                _logger.LogInformation(
                    "✅ Payment processed: Order {OrderId}, Notified {Success}/{Total} devices",
                    orderId, successCount, sokDevices.Count);

                // ✅ Return success response
                return Ok(new
                {
                    success = true,
                    message = "Payment processed successfully",
                    location,
                    deviceId,
                    orderId,
                    queueNumber,
                    orderType = request.OrderType,
                    completedAt = DateTime.UtcNow,
                    payment = new
                    {
                        method = request.PaymentMethod,
                        transactionId = request.TransactionId,
                        amount = totalAmount
                    },
                    orderSummary = new
                    {
                        itemCount,
                        totalAmount
                    },
                    notifications = new
                    {
                        sent = successCount,
                        failed = failCount,
                        total = sokDevices.Count
                    },
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error processing payment for {DeviceId}", deviceId);
                return StatusCode(500, new
                {
                    success = false,
                    error = "Payment processing failed",
                    details = ex.Message
                });
            }
        }

        /// <summary>
        /// Handle payment failure - Keep order in cache, update status
        /// POST /API/SOKOrder/{location}/{deviceId}/payment/failed
        /// </summary>
        [HttpPost("{location}/{deviceId}/payment/failed")]
        public async Task<IActionResult> HandlePaymentFailure(
            string location,
            string deviceId,
            [FromBody] PaymentFailureDto request)
        {
            try
            {
                _logger.LogWarning("❌ Payment failed for device: {DeviceId}, OrderType: {OrderType}, Reason: {Reason}",
                    deviceId, request.OrderType, request.Reason);

                // ✅ Validate device
                if (!ValidateDevice(location, deviceId, out var errorMessage))
                {
                    return BadRequest(new { success = false, error = errorMessage });
                }

                var cacheKey = $"{deviceId}_{request.OrderType}";

                if (!_orderCaches.TryGetValue(cacheKey, out var cache))
                {
                    return NotFound(new
                    {
                        success = false,
                        error = "Order cache not found",
                        cacheKey
                    });
                }

                // ✅ Update cache status to payment_failed
                cache.Status = "payment_failed";
                cache.UpdatedAt = DateTime.UtcNow;
                _orderCaches[cacheKey] = cache;

                // ✅ Notify device about payment failure
                var failureNotification = new
                {
                    action = "payment_failed",
                    orderId = cache.OrderId,
                    queueNumber = GenerateQueueNumber(cache),
                    deviceId,
                    orderType = request.OrderType,
                    location,
                    reason = request.Reason,
                    errorCode = request.ErrorCode,
                    timestamp = DateTime.UtcNow
                };

                // Send to specific device
                try
                {
                    await _wsManager.SendMessageAsync(deviceId, failureNotification);
                    _logger.LogInformation("📤 Payment failure notification sent to {DeviceId}", deviceId);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "⚠️ Failed to notify device about payment failure");
                }

                return Ok(new
                {
                    success = true,
                    message = "Payment failure recorded",
                    location,
                    deviceId,
                    orderId = cache.OrderId,
                    orderType = request.OrderType,
                    status = "payment_failed",
                    reason = request.Reason,
                    cachePreserved = true,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error handling payment failure");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Retry payment - Reset status to allow payment retry
        /// POST /API/SOKOrder/{location}/{deviceId}/payment/retry
        /// </summary>
        [HttpPost("{location}/{deviceId}/payment/retry")]
        public async Task<IActionResult> RetryPayment(
            string location,
            string deviceId,
            [FromQuery] string orderType)
        {
            try
            {
                // ✅ Validate device
                if (!ValidateDevice(location, deviceId, out var errorMessage))
                {
                    return BadRequest(new { success = false, error = errorMessage });
                }

                var cacheKey = $"{deviceId}_{orderType}";

                if (!_orderCaches.TryGetValue(cacheKey, out var cache))
                {
                    return NotFound(new
                    {
                        success = false,
                        error = "Order cache not found"
                    });
                }

                // ✅ Reset status to active for retry
                cache.Status = "active";
                cache.UpdatedAt = DateTime.UtcNow;
                _orderCaches[cacheKey] = cache;

                // Notify device
                await _wsManager.SendMessageAsync(deviceId, new
                {
                    action = "payment_retry",
                    orderId = cache.OrderId,
                    deviceId,
                    orderType,
                    status = "active",
                    timestamp = DateTime.UtcNow
                });

                _logger.LogInformation("🔄 Payment retry initiated for Order {OrderId}", cache.OrderId);

                return Ok(new
                {
                    success = true,
                    message = "Payment retry enabled",
                    orderId = cache.OrderId,
                    status = "active"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error retrying payment");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }





        #region POS Sync Endpoints

        /// <summary>
        /// ✅ POS SYNC - Main entry point for POS-to-SOK synchronization
        /// Called when POS updates order and needs to broadcast to all SOK devices
        /// </summary>
        [HttpPost("pos-sync")]
        public async Task<IActionResult> POSSync([FromBody] POSSyncDto request)
        {
            try
            {
                _logger.LogInformation("📥 POS sync received from {PosDeviceId} for {Identifier}",
                    request.PosDeviceId, request.DeviceId ?? request.TableNo);

                // Prevent duplicate syncs within 500ms
                var syncKey = $"{request.DeviceId}_{request.OrderType}_{request.TableNo}";
                if (_pendingSyncs.TryGetValue(syncKey, out var lastSync))
                {
                    if ((DateTime.UtcNow - lastSync).TotalMilliseconds < 500)
                    {
                        _logger.LogWarning("⏳ Sync debounced for {SyncKey}", syncKey);
                        return Ok(new
                        {
                            success = true,
                            message = "Sync debounced",
                            debounced = true
                        });
                    }
                }
                _pendingSyncs[syncKey] = DateTime.UtcNow;

                // Build cache key
                var cacheKey = BuildCacheKey(request.DeviceId, request.OrderType);
                OrderCache cache;

                // Check if cache exists, create or update
                if (_orderCaches.TryGetValue(cacheKey, out var existingCache))
                {
                    cache = existingCache;

                    // Update existing cache
                    if (request.OrderData != null)
                    {
                        cache.OrderData = request.OrderData;
                        cache.TotalAmount = decimal.Parse(request.OrderData.NetAmt ?? "0.00");
                    }

                    if (!string.IsNullOrEmpty(request.Status))
                        cache.Status = request.Status;

                    cache.UpdatedAt = DateTime.UtcNow;

                    _logger.LogInformation("✅ Updated existing cache: {CacheKey}", cacheKey);
                }
                else
                {
                    // Create new cache
                    var orderId = request.OrderData?.ServerOrderId
                        ?? $"ORD-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{request.DeviceId ?? request.TableNo}";

                    cache = new OrderCache
                    {
                        OrderId = orderId,
                        TableNo = request.TableNo,
                        OrderType = request.OrderType,
                        DeviceId = request.DeviceId,
                        Location = request.Location,
                        Timestamp = DateTime.UtcNow,
                        OrderData = request.OrderData ?? new SOKOrderData
                        {
                            ServiceType = request.OrderType,
                            ServiceTypeInfo = request.OrderType == "E" ? "Dine In" : "Takeaway",
                            TableNo = request.TableNo,
                            ServerOrderId = orderId
                        },
                        TotalAmount = decimal.Parse(request.OrderData?.NetAmt ?? "0.00"),
                        Status = request.Status ?? "active",
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow
                    };

                    _orderCaches[cacheKey] = cache;
                    _logger.LogInformation("✅ Created new cache: {CacheKey}", cacheKey);
                }

                // Broadcast to ALL connected SOK devices
                var broadcastResult = await BroadcastPOSUpdate(cache, request.PosDeviceId);

                _logger.LogInformation(
                    "✅ POS sync completed: {CacheKey}, Items: {ItemCount}, Total: ${Total}, Broadcasted to {ClientCount} clients",
                    cacheKey,
                    cache.OrderData?.SalesDtls?.Count ?? 0,
                    cache.TotalAmount,
                    broadcastResult
                );

                return Ok(new
                {
                    success = true,
                    message = "POS sync completed and broadcasted",
                    orderId = cache.OrderId,
                    cacheKey = cacheKey,
                    cache = cache,
                    broadcastedTo = broadcastResult,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error in POS sync");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }


        /// <summary>
        /// SET ORDER TYPE - Initialize order with type and store order cache
        /// </summary>
        [HttpPost("set-order-type")]
        public async Task<IActionResult> SetOrderType([FromBody] SetOrderTypeDto request)
        {
            try
            {
                var cacheKey = BuildCacheKey(request.DeviceId, request.OrderType);

                var orderId = !string.IsNullOrEmpty(request.OrderData?.ServerOrderId)
                    ? request.OrderData.ServerOrderId
                    : $"ORD-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{request.DeviceId ?? request.TableNo}";

                var orderCache = new OrderCache
                {
                    OrderId = orderId,
                    TableNo = request.TableNo,
                    OrderType = request.OrderType,
                    DeviceId = request.DeviceId,
                    Location = request.Location,
                    Timestamp = request.Timestamp ?? DateTime.UtcNow,
                    OrderData = request.OrderData ?? new SOKOrderData
                    {
                        ServiceType = request.OrderType,
                        ServiceTypeInfo = request.OrderType == "E" ? "Dine In" : "Takeaway",
                        TableNo = request.TableNo,
                        DocDate = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss"),
                        AbsorbTax = "N",
                        AbsorbTaxInfo = "Not Absorb Tax",
                        ServerOrderId = orderId
                    },
                    TotalAmount = decimal.Parse(request.OrderData?.NetAmt ?? "0.00"),
                    Status = "initialized",
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };

                orderCache.OrderData.ServerOrderId = orderId;
                _orderCaches[cacheKey] = orderCache;

                await BroadcastCacheUpdate(orderCache);

                _logger.LogInformation(
                    "Order type set: {OrderType} (Key: {CacheKey}), OrderId: {OrderId}, Location: {Location}",
                    request.OrderType == "E" ? "Dine In" : "Takeaway",
                    cacheKey,
                    orderId,
                    request.Location
                );

                return Ok(new
                {
                    success = true,
                    message = "Order type set successfully",
                    orderId,
                    cacheKey = cacheKey,
                    orderType = request.OrderType,
                    tableNo = request.TableNo,
                    deviceId = request.DeviceId,
                    location = request.Location,
                    timestamp = orderCache.Timestamp,
                    cache = orderCache,
                    broadcasted = true
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error setting order type");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// GET ORDER CACHE - Retrieve cached order by device
        /// </summary>
        [HttpGet("order-cache/{deviceId}")]
        public IActionResult GetOrderCache(string deviceId)
        {
            try
            {
                // Return all caches for this device
                var allCaches = _orderCaches
                    .Where(kvp => kvp.Value.DeviceId == deviceId)
                    .Select(kvp => kvp.Value)
                    .OrderByDescending(c => c.UpdatedAt)
                    .FirstOrDefault();

                if (allCaches == null)
                {
                    return NotFound(new
                    {
                        success = false,
                        error = "Order cache not found",
                        deviceId
                    });
                }

                _logger.LogInformation("✅ Cache retrieved for device: {DeviceId}", deviceId);

                return Ok(new
                {
                    success = true,
                    cache = allCaches,
                    deviceId
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving order cache");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Send order notification for specific actions (add item, update, etc.)
        /// </summary>
        private async Task SendOrderNotification(
            string deviceId,
            string orderType,
            OrderCache cache,
            string actionType = "order_updated")
        {
            try
            {
                if (cache?.OrderData == null)
                {
                    _logger.LogWarning("⚠️ Cannot send notification - cache or orderData is null");
                    return;
                }

                var salesDtls = cache.OrderData.SalesDtls ?? new List<SalesDetail>();
                var itemCount = salesDtls.Count(item => item.SNo == item.ParentSno);

                // ConnectionId is just deviceId (no orderType suffix)
                var socket = _wsManager.GetSocketById(deviceId);
                if (socket == null)
                {
                    _logger.LogWarning(
                        "⚠️ Device not connected for notification: {DeviceId}",
                        deviceId
                    );
                    return;
                }

                // ✅ Use object overload
                await _wsManager.SendMessageAsync(deviceId, new
                {
                    action = actionType,
                    deviceId,
                    orderType,
                    orderId = cache.OrderId,
                    orderData = cache.OrderData,
                    summary = new
                    {
                        itemCount = itemCount,
                        netAmount = cache.OrderData.NetAmt ?? "0.00",
                        subTotal = cache.OrderData.SubTotal ?? "0.00",
                        totalTax = cache.OrderData.TotalTax ?? "0.00",
                        totalSvc = cache.OrderData.TotalSvc ?? "0.00"
                    },
                    timestamp = DateTime.UtcNow
                });

                _logger.LogInformation(
                    "✅ {Action} notification sent to {DeviceId}: Items: {Items}, Total: ${Total}",
                    actionType, deviceId, itemCount, cache.TotalAmount
                );
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "❌ Failed to send {Action} notification for {DeviceId}",
                    actionType,
                    deviceId
                );
            }
        }

        [HttpPost("order-cache/sok/{deviceId}")]
        public async Task<IActionResult> CreateOrderCache(string deviceId, [FromBody] UpdateOrderCacheDto request)
        {
            try
            {
                _logger.LogInformation("📝 POST CreateOrderCache - deviceId: {DeviceId}, orderType: {OrderType}, request: {Request}",
                    deviceId, request?.OrderType, System.Text.Json.JsonSerializer.Serialize(request));

                // ✅ Validate request
                if (request == null)
                {
                    return BadRequest(new { success = false, error = "Request body is required" });
                }

                if (string.IsNullOrEmpty(request.OrderType))
                {
                    return BadRequest(new { success = false, error = "OrderType is required" });
                }

                // ✅ Ensure OrderData exists
                if (request.OrderData == null)
                {
                    request.OrderData = new SOKOrderData();
                }

                // ✅ Fill in REQUIRED fields with defaults if missing
                request.OrderData.DocDate ??= DateTime.UtcNow.ToString("yyyy/MM/dd HH:mm:ss");
                request.OrderData.ServiceType ??= request.OrderType;
                request.OrderData.ServiceTypeInfo ??= request.OrderType == "E" ? "DineIn" : "Takeaway";
                request.OrderData.AbsorbTax ??= "Y";
                request.OrderData.AbsorbTaxInfo ??= "Absorb Tax";

                var cacheKey = BuildCacheKey(deviceId, request.OrderType);

                _logger.LogInformation("📝 Processed - orderType: {OrderType}, cacheKey: {CacheKey}, DocDate: {DocDate}",
                    request.OrderType, cacheKey, request.OrderData.DocDate);

                // Check if cache already exists
                if (_orderCaches.ContainsKey(cacheKey))
                {
                    _logger.LogWarning("⚠️ Cache already exists: {CacheKey}, will update it", cacheKey);

                    var existingCache = _orderCaches[cacheKey];

                    // ✅ Preserve required fields from existing cache if new data doesn't have them
                    request.OrderData.DocDate ??= existingCache.OrderData?.DocDate ?? DateTime.UtcNow.ToString("yyyy/MM/dd HH:mm:ss");
                    request.OrderData.ServiceType ??= existingCache.OrderData?.ServiceType ?? request.OrderType;
                    request.OrderData.ServiceTypeInfo ??= existingCache.OrderData?.ServiceTypeInfo ?? (request.OrderType == "E" ? "DineIn" : "Takeaway");
                    request.OrderData.AbsorbTax ??= existingCache.OrderData?.AbsorbTax ?? "Y";
                    request.OrderData.AbsorbTaxInfo ??= existingCache.OrderData?.AbsorbTaxInfo ?? "Absorb Tax";
                    request.OrderData.ServerOrderId ??= existingCache.OrderId;

                    existingCache.OrderData = request.OrderData;
                    existingCache.TotalAmount = decimal.Parse(request.OrderData.NetAmt ?? "0.00");
                    if (request.Status != null) existingCache.Status = request.Status;
                    existingCache.UpdatedAt = DateTime.UtcNow;

                    await BroadcastCacheUpdate(existingCache);

                    return Ok(new
                    {
                        success = true,
                        message = "Cache already existed, updated instead",
                        orderId = existingCache.OrderId,
                        cacheKey = cacheKey,
                        cache = existingCache
                    });
                }

                // ✅ GENERATE ORDER ID
                var orderId = !string.IsNullOrEmpty(request.OrderData?.ServerOrderId)
                    ? request.OrderData.ServerOrderId
                    : $"ORD-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{deviceId ?? request.OrderData?.TableNo ?? "UNKNOWN"}";

                _logger.LogInformation("✅ Generated order ID: {OrderId}", orderId);

                // ✅ Set ServerOrderId
                request.OrderData.ServerOrderId = orderId;

                // ✅ CREATE NEW CACHE WITH ORDER ID
                var cache = new OrderCache
                {
                    OrderId = orderId,
                    DeviceId = deviceId,
                    OrderType = request.OrderType,
                    OrderData = request.OrderData,
                    Status = request.Status ?? "N",
                    TotalAmount = decimal.Parse(request.OrderData.NetAmt ?? "0.00"),
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };

                _orderCaches[cacheKey] = cache;

                await BroadcastCacheUpdate(cache);

                _logger.LogInformation("✅ Cache created - OrderId: {OrderId}, CacheKey: {CacheKey}, Items: {ItemCount}",
                    orderId, cacheKey, request.OrderData.SalesDtls?.Count ?? 0);

                return Ok(new
                {
                    success = true,
                    message = "Order cache created successfully",
                    orderId = orderId,
                    cacheKey = cacheKey,
                    cache = cache
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error creating order cache: {Message}\nStackTrace: {StackTrace}",
                    ex.Message, ex.StackTrace);
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message,
                    stackTrace = ex.StackTrace,
                    innerException = ex.InnerException?.Message
                });
            }
        }
        // ✅ PUT - UPDATE existing cache
        [HttpPut("order-cache/sok/{deviceId}")]
        public async Task<IActionResult> UpdateOrderCache(string deviceId, [FromBody] UpdateOrderCacheDto request)
        {
            try
            {
                var cacheKey = BuildCacheKey(deviceId, request.OrderType);

                _logger.LogInformation("📝 PUT UpdateOrderCache called - deviceId: {DeviceId}, orderType: {OrderType}, cacheKey: {CacheKey}",
                    deviceId, request.OrderType, cacheKey);

                if (!_orderCaches.TryGetValue(cacheKey, out var cache))
                {
                    _logger.LogWarning("⚠️ Cache not found for UPDATE: {CacheKey}", cacheKey);

                    return NotFound(new
                    {
                        success = false,
                        error = "Order cache not found",
                        searchedKey = cacheKey
                    });
                }

                // Update cache
                if (request.OrderData != null)
                {
                    cache.OrderData = request.OrderData;
                    cache.TotalAmount = decimal.Parse(request.OrderData.NetAmt ?? "0.00");
                }
                if (request.Status != null) cache.Status = request.Status;
                cache.UpdatedAt = DateTime.UtcNow;

                await BroadcastCacheUpdate(cache);

                _logger.LogInformation("✅ Cache updated: {CacheKey}", cacheKey);

                return Ok(new
                {
                    success = true,
                    message = "Order cache updated successfully",
                    cacheKey = cacheKey,
                    cache = cache
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error updating order cache");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        #endregion

        #region Order CRUD Operations

        /// <summary>
        /// CREATE - Create new order
        /// </summary>
        [HttpPost]
        public async Task<IActionResult> CreateOrder([FromBody] CreateOrderDto request)
        {
            try
            {
                var orderId = Guid.NewGuid().ToString();
                var order = new SOKOrder
                {
                    OrderId = orderId,
                    SokDeviceId = request.SokDeviceId,
                    DeviceId = request.DeviceId,
                    QueueNumber = request.QueueNumber,
                    OrderData = request.OrderData,
                    Status = "pending",
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                    CreatedBy = request.PosDeviceId
                };

                _orders[orderId] = order;

                // ✅ Use object overload
                await _wsManager.SendMessageAsync(request.SokDeviceId, new
                {
                    action = "new_order",
                    order = order,
                    timestamp = DateTime.UtcNow
                });

                _logger.LogInformation("Order created: {OrderId} for SOK {SokId}", orderId, request.SokDeviceId);

                return Ok(new { success = true, message = "Order created successfully", order = order });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating order");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// READ - Get orders for a specific device
        /// </summary>
        [HttpGet("{location}/{deviceId}/orders")]
        public IActionResult GetOrders(string location, string deviceId, [FromQuery] string orderType = null)
        {
            try
            {
                // ✅ Validate device
                if (!ValidateDevice(location, deviceId, out var errorMessage))
                {
                    return BadRequest(new
                    {
                        success = false,
                        error = errorMessage
                    });
                }

                // Get orders for this device
                var ordersBySok = _orders.Values.Where(o => o.SokDeviceId == deviceId).ToList();
                var ordersByDevice = _orders.Values.Where(o => o.DeviceId == deviceId).ToList();

                // Filter by order type if specified
                var ordersFromCache = _orderCaches.Values
                    .Where(c => c.DeviceId == deviceId &&
                           (string.IsNullOrEmpty(orderType) || c.OrderType == orderType))
                    .Select(c => MapOrderCacheToSokOrder(c))
                    .ToList();

                // ✅ FIX: Put ordersFromCache FIRST so DistinctBy keeps the NEWEST data
                var allOrders = ordersFromCache        // ✅ NEW data (qty: 4) - FIRST
                    .Concat(ordersBySok)               // ❌ OLD data (qty: 2)
                    .Concat(ordersByDevice)            // ❌ OLD data
                    .DistinctBy(o => o.OrderId)        // ✅ Now keeps cache data!
                    .OrderByDescending(o => o.CreatedAt)
                    .ToList();

                // 🔍 Logging for debugging
                foreach (var order in ordersFromCache)
                {
                    var orderData = order.OrderData as SOKOrderData;

                    if (orderData?.SalesDtls != null)
                    {
                        var itemCount = orderData.SalesDtls.Count(i => i.SNo == i.ParentSno);

                        _logger.LogInformation("📦 GET returning order {OrderId} with {ItemCount} items",
                            order.OrderId, itemCount);

                        foreach (var item in orderData.SalesDtls.Where(i => i.SNo == i.ParentSno))
                        {
                            _logger.LogInformation("   Item: {ItemName}, Qty: {Qty}",
                                item.ItemName, item.Qty);
                        }
                    }
                    else
                    {
                        _logger.LogInformation("📦 GET returning order {OrderId} with no items",
                            order.OrderId);
                    }
                }

                _logger.LogInformation("✅ Orders retrieved for {DeviceId}: {Count} orders",
                    deviceId, allOrders.Count);

                return Ok(new
                {
                    success = true,
                    message = "Orders retrieved successfully",
                    location = location,
                    deviceId = deviceId,
                    orderType = orderType,
                    orders = allOrders,
                    count = allOrders.Count
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error retrieving orders for {Location}/{DeviceId}",
                    location, deviceId);
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }


        /// <summary>
        /// READ - Get all orders for a specific SOK device OR DeviceId
        /// </summary>
        [HttpGet("sok/{deviceIdentifier}")]
        public IActionResult GetOrdersBySok(string deviceIdentifier)
        {
            try
            {
                var ordersBySok = _orders.Values.Where(o => o.SokDeviceId == deviceIdentifier).ToList();
                var ordersByDevice = _orders.Values.Where(o => o.DeviceId == deviceIdentifier).ToList();
                var ordersFromCache = _orderCaches.Values
                    .Where(c => c.DeviceId == deviceIdentifier)
                    .Select(c => MapOrderCacheToSokOrder(c))
                    .ToList();

                var allOrders = ordersBySok
                    .Concat(ordersByDevice)
                    .Concat(ordersFromCache)
                    .DistinctBy(o => o.OrderId)
                    .OrderByDescending(o => o.CreatedAt)
                    .ToList();

                return Ok(new
                {
                    success = true,
                    deviceIdentifier = deviceIdentifier,
                    orders = allOrders,
                    count = allOrders.Count
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving orders");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        [HttpGet("{location}/{deviceId}/orders/{orderId}")]
        public IActionResult GetOrderById(string location, string deviceId, string orderId)
        {
            try
            {
                // ✅ Validate device
                if (!ValidateDevice(location, deviceId, out var errorMessage))
                {
                    return BadRequest(new { success = false, error = errorMessage });
                }

                // Try to find in _orders
                if (_orders.TryGetValue(orderId, out var order))
                {
                    // Verify order belongs to this device
                    if (order.DeviceId != deviceId && order.SokDeviceId != deviceId)
                    {
                        return Forbid("Order does not belong to this device");
                    }

                    return Ok(new { success = true, order = order });
                }

                // Try to find in _orderCaches
                var cache = _orderCaches.Values.FirstOrDefault(c => c.OrderId == orderId && c.DeviceId == deviceId);
                if (cache != null)
                {
                    return Ok(new { success = true, order = MapOrderCacheToSokOrder(cache) });
                }

                return NotFound(new { success = false, error = "Order not found" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving order {OrderId}", orderId);
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// READ - Get all orders
        /// </summary>
        [HttpGet]
        public IActionResult GetAllOrders([FromQuery] string status = null)
        {
            var orders = string.IsNullOrEmpty(status)
                ? GetAllOrdersInternal()
                : GetOrdersByStatusInternal(status);

            return Ok(new { success = true, orders = orders, count = orders.Count });
        }

        /// <summary>
        /// DELETE - Delete all orders from a device
        /// ✅ FIXED: Uses deviceId directly (no orderType suffix), no orderId or queueNumber required
        /// </summary>
        [HttpDelete("{location}/{deviceId}/orders")]
        public async Task<IActionResult> DeleteAllOrders(
            string location,
            string deviceId,
            [FromQuery] string posDeviceId = null)
        {
            try
            {
                // ✅ Validate device
                if (!ValidateDevice(location, deviceId, out var errorMessage))
                {
                    return BadRequest(new { success = false, error = errorMessage });
                }

                var deletedOrders = new List<object>();
                var failedNotifications = new List<string>();

                // Find and delete all orders from _orders
                var ordersToDelete = _orders.Where(o =>
                    o.Value.DeviceId == deviceId || o.Value.SokDeviceId == deviceId)
                    .ToList();

                foreach (var orderEntry in ordersToDelete)
                {
                    var orderId = orderEntry.Key;
                    var order = orderEntry.Value;

                    if (_orders.TryRemove(orderId, out _))
                    {
                        var orderData = order.OrderData as SOKOrderData;
                        var serviceType = orderData?.ServiceType ?? "E";
                        var sokConnectionId = order.SokDeviceId;

                        _logger.LogInformation("🔍 Attempting to send delete notification to: {ConnectionId} for order {OrderId}",
                            sokConnectionId, orderId);

                        try
                        {
                            await _wsManager.SendMessageAsync(sokConnectionId, new
                            {
                                action = "order_deleted",
                                orderId = orderId,
                                queueNumber = order.QueueNumber,
                                deviceId = order.SokDeviceId,
                                serviceType = serviceType,
                                timestamp = DateTime.UtcNow
                            });

                            _logger.LogInformation("✅ WebSocket notification sent successfully for order {OrderId}", orderId);
                        }
                        catch (Exception wsEx)
                        {
                            _logger.LogWarning(wsEx, "⚠️ Failed to send WebSocket notification for order {OrderId}", orderId);
                            failedNotifications.Add(orderId);
                        }

                        deletedOrders.Add(new
                        {
                            orderId = orderId,
                            queueNumber = order.QueueNumber,
                            serviceType = serviceType
                        });
                    }
                }

                // Find and delete all orders from _orderCaches
                var cachesToDelete = _orderCaches.Where(c => c.Value.DeviceId == deviceId).ToList();

                foreach (var cacheEntry in cachesToDelete)
                {
                    var cacheKey = cacheEntry.Key;
                    var orderCache = cacheEntry.Value;

                    if (_orderCaches.TryRemove(cacheKey, out _))
                    {
                        var order = MapOrderCacheToSokOrder(orderCache);
                        var orderData = order.OrderData as SOKOrderData;
                        var serviceType = orderData?.ServiceType ?? "E";
                        var sokConnectionId = order.SokDeviceId;

                        _logger.LogInformation("🔍 Attempting to send delete notification to: {ConnectionId} for cached order {OrderId}",
                            sokConnectionId, orderCache.OrderId);

                        try
                        {
                            await _wsManager.SendMessageAsync(sokConnectionId, new
                            {
                                action = "order_deleted",
                                orderId = orderCache.OrderId,
                                queueNumber = order.QueueNumber,
                                deviceId = order.SokDeviceId,
                                serviceType = serviceType,
                                timestamp = DateTime.UtcNow
                            });

                            _logger.LogInformation("✅ WebSocket notification sent successfully for cached order {OrderId}",
                                orderCache.OrderId);
                        }
                        catch (Exception wsEx)
                        {
                            _logger.LogWarning(wsEx, "⚠️ Failed to send WebSocket notification for cached order {OrderId}",
                                orderCache.OrderId);
                            failedNotifications.Add(orderCache.OrderId);
                        }

                        deletedOrders.Add(new
                        {
                            orderId = orderCache.OrderId,
                            queueNumber = order.QueueNumber,
                            serviceType = serviceType
                        });
                    }
                }

                if (deletedOrders.Count == 0)
                {
                    return NotFound(new
                    {
                        success = false,
                        error = $"No orders found for device {deviceId}"
                    });
                }

                _logger.LogInformation("Deleted {Count} orders from device {DeviceId} at {Location}",
                    deletedOrders.Count, deviceId, location);

                return Ok(new
                {
                    success = true,
                    message = $"All orders deleted successfully from device {deviceId}",
                    location = location,
                    deviceId = deviceId,
                    deletedCount = deletedOrders.Count,
                    deletedOrders = deletedOrders,
                    failedNotifications = failedNotifications.Count > 0 ? failedNotifications : null
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting orders from device {DeviceId}", deviceId);
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }



        /// <summary>
        /// DELETE - Delete specific item from order by s_no
        /// ✅ FIXED: Uses deviceId directly (no orderType suffix), no orderId required
        /// </summary>
        [HttpDelete("{location}/{deviceId}/items/{sno}")]
        public async Task<IActionResult> DeleteOrderItem(
            string location,
            string deviceId,
            int sno)
        {
            try
            {
                _logger.LogInformation("Current device registry keys:");

                foreach (var key in _deviceRegistry.Keys)
                {
                    _logger.LogInformation(" - {Key}", key);
                }

                // ✅ Validate device
                if (!ValidateDevice(location, deviceId, out var errorMessage))
                {
                    return BadRequest(new { success = false, error = errorMessage });
                }

                SOKOrder order = null;
                OrderCache orderCache = null;
                bool isFromCache = false;
                string cacheKey = null;
                string orderId = null;

                // Try to find order in _orders first
                var orderEntry = _orders.FirstOrDefault(o =>
                    (o.Value.DeviceId == deviceId || o.Value.SokDeviceId == deviceId) &&
                    (o.Value.OrderData as SOKOrderData)?.SalesDtls?.Any(item => item.SNo == sno) == true
                );

                if (!orderEntry.Equals(default(KeyValuePair<string, SOKOrder>)))
                {
                    orderId = orderEntry.Key;
                    order = orderEntry.Value;
                }
                else
                {
                    // Look in _orderCaches
                    var cacheEntry = _orderCaches.FirstOrDefault(c =>
                        c.Value.DeviceId == deviceId &&
                        c.Value.OrderData?.SalesDtls?.Any(item => item.SNo == sno) == true);

                    if (!cacheEntry.Equals(default(KeyValuePair<string, OrderCache>)))
                    {
                        orderCache = cacheEntry.Value;
                        cacheKey = cacheEntry.Key;
                        orderId = orderCache.OrderId;
                        order = MapOrderCacheToSokOrder(orderCache);
                        isFromCache = true;
                    }
                    else
                    {
                        return NotFound(new { success = false, error = $"No order found for device {deviceId} with item s_no {sno}" });
                    }
                }

                // Get the order details
                var orderData = order.OrderData as SOKOrderData;
                if (orderData?.SalesDtls == null || !orderData.SalesDtls.Any())
                {
                    return NotFound(new { success = false, error = "Order has no items" });
                }

                // Find the item with matching s_no
                var itemToRemove = orderData.SalesDtls.FirstOrDefault(item => item.SNo == sno);
                if (itemToRemove == null)
                {
                    return NotFound(new { success = false, error = $"Item with s_no {sno} not found in order" });
                }

                _logger.LogInformation("Deleting item s_no {Sno} from order {OrderId} at {Location}/{DeviceId}: {ItemName}",
                    sno, orderId, location, deviceId, itemToRemove.ItemName);

                // Remove the item
                orderData.SalesDtls.Remove(itemToRemove);

                // Check if this was the last item
                if (!orderData.SalesDtls.Any())
                {
                    // Delete the entire order
                    if (isFromCache)
                    {
                        _orderCaches.TryRemove(cacheKey, out _);
                    }
                    else
                    {
                        _orders.TryRemove(orderId, out _);
                    }

                    // ✅ Use object overload
                    await _wsManager.SendMessageAsync(order.SokDeviceId, new
                    {
                        action = "order_deleted",
                        orderId,
                        location,
                        deviceId,
                        queueNumber = order.QueueNumber,
                        reason = "last_item_removed",
                        timestamp = DateTime.UtcNow
                    });

                    _logger.LogInformation("Last item removed, order {OrderId} deleted", orderId);

                    return Ok(new
                    {
                        success = true,
                        message = "Last item removed, order deleted",
                        location,
                        deviceId,
                        orderId,
                        deletedSno = sno,
                        orderDeleted = true
                    });
                }

                // Recalculate totals
                RecalculateOrderTotals(orderData);

                // Update the order
                order.UpdatedAt = DateTime.UtcNow;
                order.UpdatedBy = $"{location}_{deviceId}";

                // Update cache if it came from cache
                if (isFromCache && orderCache != null)
                {
                    orderCache.OrderData = orderData;
                    orderCache.TotalAmount = decimal.Parse(orderData.NetAmt ?? "0.00");
                    orderCache.UpdatedAt = DateTime.UtcNow;
                    _orderCaches[cacheKey] = orderCache;
                }
                else
                {
                    _orders[orderId] = order;
                }

                // ✅ Use object overload
                await _wsManager.SendMessageAsync(order.SokDeviceId, new
                {
                    action = "order_item_deleted",
                    location,
                    deviceId,
                    orderId,
                    deletedSno = sno,
                    itemName = itemToRemove.ItemName,
                    queueNumber = order.QueueNumber,
                    remainingItems = orderData.SalesDtls.Count,
                    newSubTotal = orderData.SubTotal,
                    newTax = orderData.TotalTax,
                    newTotal = orderData.NetAmt,
                    timestamp = DateTime.UtcNow
                });

                // Also broadcast cache update if from cache
                if (isFromCache && orderCache != null)
                {
                    await BroadcastCacheUpdate(orderCache);
                }

                _logger.LogInformation(
                    "Item deleted from order {OrderId}: s_no {Sno}, Remaining items: {Count}, New total: ${Total}",
                    orderId, sno, orderData.SalesDtls.Count, orderData.NetAmt
                );

                return Ok(new
                {
                    success = true,
                    message = "Item deleted successfully",
                    location,
                    deviceId,
                    orderId,
                    deletedSno = sno,
                    deletedItem = itemToRemove.ItemName,
                    remainingItems = orderData.SalesDtls.Count,
                    newSubTotal = orderData.SubTotal,
                    newTax = orderData.TotalTax,
                    newTotal = orderData.NetAmt,
                    order = order
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting order item");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }



        /// <summary>
        /// Helper method to recalculate order totals after item deletion
        /// </summary>
        public static void RecalculateOrderTotals(SOKOrderData orderData, ILogger logger = null)
        {
            if (orderData?.SalesDtls == null || !orderData.SalesDtls.Any())
            {
                orderData.SubTotal = "0.00";
                orderData.TotalTax = "0.00";
                orderData.TotalSvc = "0.00";
                orderData.NetAmt = "0.00";
                return;
            }

            decimal subTotal = 0;
            decimal totalTax = 0;
            decimal totalSvc = 0;

            foreach (var item in orderData.SalesDtls)
            {
                subTotal += item.SubTotal;

                if (decimal.TryParse(item.TaxAmt, out var taxAmt))
                    totalTax += taxAmt;

                if (decimal.TryParse(item.SvcAmt, out var svcAmt))
                    totalSvc += svcAmt;
            }

            decimal totalDisc = decimal.Parse(orderData.TotalDisc ?? "0.00");

            orderData.SubTotal = subTotal.ToString("F2");
            orderData.TotalSvc = totalSvc.ToString("F2");
            orderData.TotalTax = totalTax.ToString("F2");

            decimal netAmt = subTotal - totalDisc + totalSvc + totalTax;

            if (decimal.TryParse(orderData.RoundAdjAmt, out var roundAdj))
                netAmt += roundAdj;

            orderData.NetAmt = netAmt.ToString("F2");

            logger?.LogInformation(
                "Totals recalculated - SubTotal: ${SubTotal}, Tax: ${Tax}, Service: ${Svc}, Net: ${Net}",
                orderData.SubTotal, orderData.TotalTax, orderData.TotalSvc, orderData.NetAmt
            );
        }
        #endregion

        #region Broadcast Helper Methods

        /// <summary>
        /// Payment completion notification endpoint
        /// POST /API/SOKOrder/payment-complete
        /// </summary>
        [HttpPost("payment-complete")]
        public async Task<IActionResult> NotifyPaymentComplete([FromBody] PaymentCompleteDto request)
        {
            if (string.IsNullOrWhiteSpace(request.DeviceId))
                return BadRequest(new { success = false, error = "deviceId is required" });

            if (string.IsNullOrWhiteSpace(request.OrderId))
                return BadRequest(new { success = false, error = "orderId is required" });

            try
            {
                _logger.LogInformation(
                    "💳 Payment notification received from {DeviceId} for Order {OrderId}",
                    request.DeviceId, request.OrderId
                );

                // Get the order cache
                var cacheKey = $"{request.DeviceId}";
                if (_orderCaches.TryGetValue(cacheKey, out var cache))
                {
                    // Update cache status
                    cache.Status = "paid";
                    cache.UpdatedAt = DateTime.UtcNow;

                    _logger.LogInformation(
                        "✅ Updated cache for {DeviceId}: Status=Paid, Amount=${Amount}",
                        request.DeviceId, request.TotalAmount
                    );
                }

                // Broadcast to POS systems
                var posBroadcastCount = await BroadcastPaymentToPOS(request);

                // Broadcast to all SOK devices
                var sokBroadcastCount = await BroadcastPaymentToSOK(request);

                return Ok(new
                {
                    success = true,
                    message = "Payment notification sent",
                    orderId = request.OrderId,
                    deviceId = request.DeviceId,
                    posBroadcastCount,
                    sokBroadcastCount,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error processing payment notification");
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }


        /// <summary>
        /// Broadcast payment completion to POS devices
        /// </summary>
        private async Task<int> BroadcastPaymentToPOS(PaymentCompleteDto request)
        {
            try
            {
                var messageObj = new
                {
                    action = "payment_complete",
                    source = "sok",
                    deviceId = request.DeviceId,
                    orderId = request.OrderId,
                    salesNo = request.SalesNo,
                    tableNo = request.TableNo,
                    orderType = request.OrderType,
                    paymentMethod = request.PaymentMethod,
                    totalAmount = request.TotalAmount,
                    paidAmount = request.PaidAmount,
                    changeAmount = request.ChangeAmount,
                    transactionId = request.TransactionId,
                    receiptNumber = request.ReceiptNumber,
                    orderData = request.OrderData,
                    timestamp = DateTime.UtcNow
                };

                var broadcastCount = 0;

                // Send to all POS devices
                var posDevices = _wsManager.GetConnectedDevices("pos");
                if (posDevices.Count > 0)
                {
                    var tasks = posDevices.Select(async posDeviceId =>
                    {
                        try
                        {
                            await _wsManager.SendMessageAsync(posDeviceId, messageObj);
                            _logger.LogInformation(
                                "✅ Payment notification sent to POS {PosDeviceId}: Order {OrderId}, Method: {Method}, Amount: ${Amount}",
                                posDeviceId, request.OrderId, request.PaymentMethod, request.TotalAmount
                            );
                            return true;
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(
                                "⚠️ Failed to send payment to POS {PosDeviceId}: {Message}",
                                posDeviceId, ex.Message
                            );
                            return false;
                        }
                    });

                    var results = await Task.WhenAll(tasks);
                    broadcastCount = results.Count(r => r);
                }
                else
                {
                    _logger.LogWarning("⚠️ No POS devices connected for payment notification");
                }

                return broadcastCount;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error broadcasting payment to POS");
                return 0;
            }
        }

        /// <summary>
        /// Broadcast payment completion to SOK devices (for synchronization)
        /// </summary>
        private async Task<int> BroadcastPaymentToSOK(PaymentCompleteDto request)
        {
            try
            {
                // ✅ Wrap the orderData in an array with jsondata property
                var messageObj = new
                {
                    action = "payment_synced",
                    orderData = new[] { request.OrderData }, // ✅ Array format
                    metadata = new
                    {
                        deviceId = request.DeviceId,
                        orderId = request.OrderId,
                        salesNo = request.SalesNo,
                        tableNo = request.TableNo,
                        orderType = request.OrderType,
                        status = "paid",
                        paymentMethod = request.PaymentMethod,
                        totalAmount = request.TotalAmount,
                        transactionId = request.TransactionId,
                        receiptNumber = request.ReceiptNumber,
                        timestamp = DateTime.UtcNow
                    }
                };

                var sokDevices = _wsManager.GetConnectedDevices("sok");
                if (sokDevices.Count == 0)
                {
                    _logger.LogWarning("⚠️ No SOK devices connected for payment sync");
                    return 0;
                }

                var tasks = sokDevices.Select(async deviceId =>
                {
                    try
                    {
                        await _wsManager.SendMessageAsync(deviceId, messageObj);
                        return true;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning("Failed to sync payment to {DeviceId}: {Message}",
                            deviceId, ex.Message);
                        return false;
                    }
                });

                var results = await Task.WhenAll(tasks);
                var broadcastCount = results.Count(r => r);

                _logger.LogInformation(
                    "✅ Payment synced to {Count} SOK devices with complete order data",
                    broadcastCount
                );

                return broadcastCount;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error broadcasting payment to SOK");
                return 0;
            }
        }

        private string BuildCacheKey(string deviceId, string orderType)
        {
            if (!string.IsNullOrEmpty(deviceId)) return $"{deviceId}_{orderType}";
            return $"UNKNOWN_{orderType}_{DateTime.UtcNow.Ticks}";
        }

        private SOKOrder MapOrderCacheToSokOrder(OrderCache cache)
        {
            return new SOKOrder
            {
                OrderId = cache.OrderId,
                SokDeviceId = cache.DeviceId,
                DeviceId = cache.DeviceId,
                QueueNumber = GenerateQueueNumber(cache),
                OrderData = cache.OrderData,
                Status = GetMappedStatus(cache.Status),
                CreatedAt = cache.CreatedAt,
                UpdatedAt = cache.UpdatedAt,
                CreatedBy = "cache-system"
            };
        }

        private string GenerateQueueNumber(OrderCache cache)
        {
            if (cache.OrderType == "T") return $"TA{cache.CreatedAt:MMddHHmm}";
            if (cache.OrderType == "E") return $"DI{cache.CreatedAt:MMddHHmm}";
            return $"OC{cache.CreatedAt:MMddHHmm}";
        }

        private string GetMappedStatus(string cacheStatus)
        {
            return cacheStatus?.ToLower() switch
            {
                "initialized" => "pending",
                "active" => "preparing",
                "completed" => "completed",
                "cancelled" => "cancelled",
                _ => cacheStatus ?? "pending"
            };
        }

        private string GetReverseMappedStatus(string orderStatus)
        {
            return orderStatus?.ToLower() switch
            {
                "pending" => "initialized",
                "preparing" => "active",
                "completed" => "completed",
                "cancelled" => "cancelled",
                _ => orderStatus ?? "initialized"
            };
        }

        public static List<SOKOrder> GetAllOrdersInternal()
        {
            return _orders.Values.OrderByDescending(o => o.CreatedAt).ToList();
        }

        public static List<SOKOrder> GetOrdersByStatusInternal(string status)
        {
            return _orders.Values
                .Where(o => o.Status.Equals(status, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(o => o.CreatedAt)
                .ToList();
        }

        #endregion



        #region WebSocket Helper Methods

        /// <summary>
        /// Try to get order by ID
        /// </summary>
        public static bool TryGetOrder(string orderId, out SOKOrder order)
        {
            return _orders.TryGetValue(orderId, out order);
        }

        /// <summary>
        /// Try to remove order by ID
        /// </summary>
        public static bool TryRemoveOrder(string orderId, out SOKOrder order)
        {
            return _orders.TryRemove(orderId, out order);
        }

        /// <summary>
        /// Try to get cache by key
        /// </summary>
        public static bool TryGetCache(string cacheKey, out OrderCache cache)
        {
            return _orderCaches.TryGetValue(cacheKey, out cache);
        }

        /// <summary>
        /// Try to remove cache by key
        /// </summary>
        public static bool TryRemoveCache(string cacheKey, out OrderCache cache)
        {
            return _orderCaches.TryRemove(cacheKey, out cache);
        }

        /// <summary>
        /// Find cache by orderId
        /// </summary>
        public static KeyValuePair<string, OrderCache>? FindCacheByOrderId(string orderId)
        {
            var cache = _orderCaches.FirstOrDefault(c => c.Value.OrderId == orderId);
            return cache.Equals(default(KeyValuePair<string, OrderCache>)) ? null : cache;
        }

        /// <summary>
        /// Find cache by orderId and deviceId
        /// </summary>
        public static KeyValuePair<string, OrderCache>? FindCacheByOrderIdAndDevice(string orderId, string deviceId)
        {
            var cache = _orderCaches.FirstOrDefault(c =>
                c.Value.OrderId == orderId && c.Value.DeviceId == deviceId);
            return cache.Equals(default(KeyValuePair<string, OrderCache>)) ? null : cache;
        }

        /// <summary>
        /// Get all caches for a device
        /// </summary>
        public static List<OrderCache> GetCachesByDevice(string deviceId, string orderType = null)
        {
            return _orderCaches.Values
                .Where(c => c.DeviceId == deviceId &&
                       (string.IsNullOrEmpty(orderType) || c.OrderType == orderType))
                .ToList();
        }

        /// <summary>
        /// Get all orders for a device
        /// </summary>
        public static List<SOKOrder> GetOrdersByDevice(string deviceId)
        {
            return _orders.Values
                .Where(o => o.SokDeviceId == deviceId || o.DeviceId == deviceId)
                .ToList();
        }

        /// <summary>
        /// Get all cache keys for a device
        /// </summary>
        public static List<string> GetCacheKeysByDevice(string deviceId)
        {
            return _orderCaches.Keys
                .Where(k => k.StartsWith($"{deviceId}_"))
                .ToList();
        }



        #endregion


       
       
    }

}