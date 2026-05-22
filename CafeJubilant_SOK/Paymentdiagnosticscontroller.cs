using Microsoft.AspNetCore.Mvc;
using CafeJubilant_SOK.Services;

namespace CafeJubilant_SOK.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class PaymentDiagnosticsController : ControllerBase
    {
        private readonly ISerialPortService _serialPortService;
        private readonly ILogger<PaymentDiagnosticsController> _logger;

        public PaymentDiagnosticsController(
            ISerialPortService serialPortService,
            ILogger<PaymentDiagnosticsController> logger)
        {
            _serialPortService = serialPortService;
            _logger = logger;
        }

        [HttpGet("status")]
        public IActionResult GetStatus()
        {
            try
            {
                var status = _serialPortService.GetConnectionStatus();
                var isConnected = _serialPortService.IsConnected;

                return Ok(new
                {
                    connected = isConnected,
                    status = status,
                    timestamp = DateTime.Now
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting connection status");
                return Ok(new
                {
                    connected = false,
                    status = $"Error: {ex.Message}",
                    timestamp = DateTime.Now
                });
            }
        }

        [HttpPost("connect")]
        public async Task<IActionResult> Connect()
        {
            try
            {
                _logger.LogInformation("📡 Manual connection request received");

                var result = await _serialPortService.TryConnectAsync();

                if (result)
                {
                    return Ok(new
                    {
                        success = true,
                        message = "Connected successfully",
                        status = _serialPortService.GetConnectionStatus()
                    });
                }
                else
                {
                    return Ok(new
                    {
                        success = false,
                        message = "Failed to connect",
                        status = _serialPortService.GetConnectionStatus()
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during manual connection");
                return StatusCode(500, new
                {
                    success = false,
                    message = ex.Message,
                    error = ex.ToString()
                });
            }
        }

        [HttpPost("test")]
        public async Task<IActionResult> TestConnection()
        {
            try
            {
                _logger.LogInformation("🧪 Test command request received");

                if (!_serialPortService.IsConnected)
                {
                    var connected = await _serialPortService.TryConnectAsync();
                    if (!connected)
                    {
                        return Ok(new
                        {
                            success = false,
                            message = "Connection not up",
                            status = _serialPortService.GetConnectionStatus()
                        });
                    }
                }

                // Send a simple test command (adjust based on your terminal's protocol)
                // Example: ENQ (enquiry) command
                var response = await _serialPortService.SendCommandAsync("\x05");

                return Ok(new
                {
                    success = true,
                    message = "Test command sent successfully",
                    response = response,
                    status = _serialPortService.GetConnectionStatus()
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during test");
                return Ok(new
                {
                    success = false,
                    message = ex.Message,
                    error = ex.ToString(),
                    status = _serialPortService.GetConnectionStatus()
                });
            }
        }
    }
}