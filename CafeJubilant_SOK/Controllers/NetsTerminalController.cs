using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CafeJubilant_SOK.Controllers
{
    [ApiController]
    [Route("API")]
    public class NetsTerminalController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<NetsTerminalController> _logger;
        private readonly IConfiguration _configuration;
        private readonly IMemoryCache _memoryCache;
        private readonly string _terminalServiceUrl;

        public NetsTerminalController(
            IHttpClientFactory httpClientFactory,
            ILogger<NetsTerminalController> logger,
            IConfiguration configuration,
            IMemoryCache memoryCache)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
            _configuration = configuration;
            _memoryCache = memoryCache;

            // Read terminal service URL from config or use default
            _terminalServiceUrl = _configuration["PaymentSettings:NetsServiceUrl"];
        }

        #region Status and Health Checks

        [HttpGet("terminal/status")]
        public async Task<IActionResult> GetTerminalStatus()
        {
            try
            {
                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(5);

                var response = await client.GetAsync($"{_terminalServiceUrl}/api/test");
                
                if (!response.IsSuccessStatusCode)
                {
                    return Ok(new
                    {
                        IsConnected = false,
                        Status = $"Terminal service returned {response.StatusCode}"
                    });
                }

                var result = await response.Content.ReadAsStringAsync();
                return Ok(new
                {
                    IsConnected = true,
                    Status = "Connected to terminal service",
                    ServiceResponse = result
                });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Cannot reach terminal service");
                return Ok(new
                {
                    IsConnected = false,
                    Status = $"Terminal service unavailable at {_terminalServiceUrl}"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error checking terminal status");
                return Ok(new
                {
                    IsConnected = false,
                    Status = $"Error: {ex.Message}"
                });
            }
        }

        [HttpGet("terminal/health")]
        public async Task<IActionResult> HealthCheck()
        {
            try
            {
                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(3);

                var response = await client.GetAsync($"{_terminalServiceUrl}/api/test");
                var result = await response.Content.ReadAsStringAsync();

                return Ok(new
                {
                    TerminalServiceUrl = _terminalServiceUrl,
                    IsReachable = response.IsSuccessStatusCode,
                    StatusCode = response.StatusCode,
                    Response = result
                });
            }
            catch (Exception ex)
            {
                return Ok(new
                {
                    TerminalServiceUrl = _terminalServiceUrl,
                    IsReachable = false,
                    Error = ex.Message
                });
            }
        }

        #endregion

        #region NETS Payments

        [HttpGet("nets/card/debit/pay")]
        public async Task<IActionResult> NetsDebitPay(
            [FromQuery] decimal amount,
            [FromQuery] string old_ECN = "")
        {
            try
            {
                _logger.LogInformation("💳 NETS Debit Payment: ${Amount}", amount);

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(60);

                var url = $"{_terminalServiceUrl}/api/nets/card/debit/pay?amount={amount}&old_ECN={old_ECN}";

                _logger.LogInformation("Calling terminal service: {Url}", url);
                var response = await client.GetAsync(url);

                if (!response.IsSuccessStatusCode)
                {
                    return Ok(new
                    {
                        ResponseCode = "99",
                        ResponseMessage = $"Terminal service error: {response.StatusCode}"
                    });
                }

                var result = await response.Content.ReadAsStringAsync();
                _logger.LogInformation("Terminal service response: {Result}", result);

                // Return raw JSON as object
                var jsonResponse = JsonSerializer.Deserialize<object>(result);
                return Ok(jsonResponse);
            }
            catch (TaskCanceledException)
            {
                _logger.LogWarning("Payment request timed out");
                return Ok(new
                {
                    ResponseCode = "99",
                    ResponseMessage = "Payment timeout - terminal may be processing"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ NETS debit payment error");
                return Ok(new
                {
                    ResponseCode = "99",
                    ResponseMessage = $"Error: {ex.Message}"
                });
            }
        }

        [HttpGet("nets/card/credit/sales")]
        public async Task<IActionResult> NetsCreditSales(
            [FromQuery] decimal amount,
            [FromQuery] string old_ECN = "")
        {
            try
            {
                _logger.LogInformation("💳 NETS Credit Sale: ${Amount}", amount);

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(60);

                var url = $"{_terminalServiceUrl}/api/nets/card/credit/sales?amount={amount}&old_ECN={old_ECN}";

                _logger.LogInformation("Calling terminal service: {Url}", url);
                var response = await client.GetAsync(url);

                if (!response.IsSuccessStatusCode)
                {
                    return Ok(new
                    {
                        ResponseCode = "99",
                        ResponseMessage = $"Terminal service error: {response.StatusCode}"
                    });
                }

                var result = await response.Content.ReadAsStringAsync();
                _logger.LogInformation("Terminal service response: {Result}", result);

                // Return raw JSON as object
                var jsonResponse = JsonSerializer.Deserialize<object>(result);
                return Ok(jsonResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ NETS credit payment error");
                return Ok(new
                {
                    ResponseCode = "99",
                    ResponseMessage = $"Error: {ex.Message}"
                });
            }
        }

        #endregion

        #region A930 Payment

        [HttpGet("A930/card/credit/sales")]
        public async Task<IActionResult> A930CreditSales([FromQuery] decimal amount)
        {
            try
            {
                _logger.LogInformation("💳 A930 Credit Sale: ${Amount}", amount);

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(60);

                var url = $"{_terminalServiceUrl}/api/A930/card/credit/sales?amount={amount}";

                _logger.LogInformation("Calling terminal service: {Url}", url);
                var response = await client.GetAsync(url);

                if (!response.IsSuccessStatusCode)
                {
                    return Ok(new
                    {
                        ResponceCode = "99",
                        ResponceInfo = $"Terminal service error: {response.StatusCode}"
                    });
                }

                var result = await response.Content.ReadAsStringAsync();
                _logger.LogInformation("Terminal service response: {Result}", result);

                // Return raw JSON as object
                var jsonResponse = JsonSerializer.Deserialize<object>(result);
                return Ok(jsonResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ A930 payment error");
                return Ok(new
                {
                    ResponceCode = "99",
                    ResponceInfo = $"Error: {ex.Message}"
                });
            }
        }

        #endregion

        #region UOB Payment

        [HttpGet("uob/card/credit/sales")]
        public async Task<IActionResult> UobCreditSales(
            [FromQuery] decimal amount,
            [FromQuery] string old_ECN = "")
        {
            try
            {
                _logger.LogInformation("💳 UOB Credit Sale: ${Amount}", amount);

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(60);

                var url = $"{_terminalServiceUrl}/api/uob/card/credit/sales?amount={amount}&old_ECN={old_ECN}";

                _logger.LogInformation("Calling terminal service: {Url}", url);

                var request = new HttpRequestMessage(HttpMethod.Get, url);
                var response = await client.SendAsync(request);

                if (!response.IsSuccessStatusCode)
                {
                    return Ok(new
                    {
                        ResponseCode = "99",
                        ResponseMessage = $"Terminal service error: {response.StatusCode}"
                    });
                }

                var result = await response.Content.ReadAsStringAsync();
                _logger.LogInformation("Terminal service response: {Result}", result);

                // Return raw JSON as object
                var jsonResponse = JsonSerializer.Deserialize<object>(result);
                return Ok(jsonResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ UOB payment error");
                return Ok(new
                {
                    ResponseCode = "99",
                    ResponseMessage = $"Error: {ex.Message}"
                });
            }
        }

        #endregion

        #region OCBC Payment

        [HttpGet("ocbc/card/credit/sale")]
        public async Task<IActionResult> OcbcCreditSale(
            [FromQuery] decimal amount,
            [FromQuery] string old_ECN = "")
        {
            try
            {
                _logger.LogInformation("💳 OCBC Credit Sale: ${Amount}", amount);

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(60);

                // NOTE: OCBC service runs on port 5019, not 5017!
                var ocbcServiceUrl = _configuration["OcbcServiceUrl"] ?? "http://localhost:5019";
                var url = $"{ocbcServiceUrl}/api/ocbc/card/credit/sale?amount={amount}&old_ECN={old_ECN}";

                _logger.LogInformation("Calling OCBC terminal service: {Url}", url);

                var request = new HttpRequestMessage(HttpMethod.Get, url);
                var response = await client.SendAsync(request);

                if (!response.IsSuccessStatusCode)
                {
                    return Ok(new
                    {
                        ResponseCode = "99",
                        ResponseMessage = $"OCBC terminal service error: {response.StatusCode}"
                    });
                }

                var result = await response.Content.ReadAsStringAsync();
                _logger.LogInformation("Terminal service response: {Result}", result);

                // Return raw JSON as object
                var jsonResponse = JsonSerializer.Deserialize<object>(result);
                return Ok(jsonResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ OCBC payment error");
                return Ok(new
                {
                    ResponseCode = "99",
                    ResponseMessage = $"Error: {ex.Message}"
                });
            }
        }

        [HttpGet("ocbc/card/credit/connectiontest")]
        public async Task<IActionResult> OcbcConnectionTest()
        {
            try
            {
                _logger.LogInformation("Testing OCBC connection");

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(10);

                var ocbcServiceUrl = _configuration["OcbcServiceUrl"] ?? "http://localhost:5019";
                var url = $"{ocbcServiceUrl}/api/ocbc/card/credit/connectiontest";

                _logger.LogInformation("Calling OCBC connection test: {Url}", url);
                var response = await client.GetAsync(url);

                if (!response.IsSuccessStatusCode)
                {
                    return Ok(new
                    {
                        ResponseCode = "99", 
                        ResponseMessage = $"OCBC connection test failed: {response.StatusCode}"
                    });
                }

                var result = await response.Content.ReadAsStringAsync();

                // Return raw JSON as object
                var jsonResponse = JsonSerializer.Deserialize<object>(result);
                return Ok(jsonResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ OCBC connection test error");
                return Ok(new
                {
                    ResponseCode = "99",
                    ResponseMessage = $"Error: {ex.Message}"
                });
            }
        }

        #endregion
    }
}