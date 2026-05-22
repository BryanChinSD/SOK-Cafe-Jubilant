using CafeJubilant_SOK.Models;
using CafeJubilant_SOK.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Hosting;
using System.Text;
using System.Text.Json;

namespace CafeJubilant_SOK.Controllers
{
    [ApiController]
    [Route("API/[controller]")]
    public class PaymentController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<PaymentController> _logger;
        private readonly IConfiguration _configuration;
        private readonly string _netsServiceUrl;

        /// <summary>
        /// Root folder that contains all payment log files.
        /// Configurable via appsettings: PaymentSettings:LogFolder
        /// Default: &lt;AppBaseDir&gt;/PaymentLogs
        /// </summary>
        private readonly string _logBaseFolder;

        public PaymentController(
            IHttpClientFactory httpClientFactory,
            ILogger<PaymentController> logger,
            IConfiguration configuration)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
            _configuration = configuration;
            _netsServiceUrl = _configuration["PaymentSettings:NetsServiceUrl"];

            // Log folder is always next to the executable: <AppBaseDir>/PaymentLogs/
            _logBaseFolder = Path.Combine(AppContext.BaseDirectory, "PaymentLogs");

            // Pre-create the folder so the first write never fails
            Directory.CreateDirectory(_logBaseFolder);
        }

        /// <summary>
        /// Returns the full path of today's log file, e.g.
        ///   PaymentLogs/2026-04-05.txt
        /// Creates the folder on first call of each new day.
        /// </summary>
        private string GetDailyLogFilePath()
        {
            // One file per calendar day (local time so the filename matches the operator's clock)
            var fileName = $"{DateTime.Now:yyyy-MM-dd}.txt";
            return Path.Combine(_logBaseFolder, fileName);
        }

        /// <summary>
        /// A930 Credit Card Payment
        /// POST /API/Payment/a930
        /// </summary>
        [HttpPost("a930")]
        public async Task<IActionResult> A930Pay([FromBody] PaymentRequest request)
        {
            try
            {
                var payment = request.Payment;
                var url = $"{_netsServiceUrl}/api/A930/card/credit/sales?amount={payment.TenderAmt}";

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(150);
                client.DefaultRequestHeaders.Add("X-Payment-Name", payment.PaymentName);
                var response = await client.GetAsync(url);
                var content = await response.Content.ReadAsStringAsync();
                var result = JsonSerializer.Deserialize<A930Response>(content);

                string info;
                PaymentResponse paymentResponse;

                if (result?.ResponceCode == "00")
                {
                    // Extract card issuer name
                    var lines = result.ResponceInfo?.Split("\r\n");
                    var cardIssuerName = lines?.Length > 6 ? lines[6].Split(' ')[0] : null;

                    if (!string.IsNullOrEmpty(cardIssuerName))
                    {
                        payment.PaymentName = cardIssuerName;
                    }

                    var salesOtherInfo = new List<SalesOtherInfo>
                    {
                        new SalesOtherInfo
                        {
                            InfoName = $"{payment.PaymentName}{payment.SNo}",
                            InfoValue = JsonSerializer.Serialize(new[] { result })
                        }
                    };

                    paymentResponse = new PaymentResponse
                    {
                        Success = true,
                        Message = "A930 payment successful",
                        Payment = payment,
                        SalesOtherInfo = salesOtherInfo,
                        Result = result
                    };

                    info = "[SUCCESS] A930 payment successful.";
                }
                else
                {
                    paymentResponse = new PaymentResponse
                    {
                        Success = false,
                        Message = "A930 payment failed",
                        Payment = payment,
                        Result = result
                    };

                    info = "[FAIL] A930 payment failed.";
                }

                LogPayment("", "PAYMENT TERMINAL - A930", info, request, result);

                return paymentResponse.Success ? Ok(paymentResponse) : BadRequest(paymentResponse);
            }
            catch (OperationCanceledException)
            {
                var info = "[FAIL] A930 payment cancelled by user.";
                LogPayment("", "PAYMENT TERMINAL - A930", info, request, null);

                return BadRequest(new PaymentResponse
                {
                    Success = false,
                    Message = "Payment cancelled by user",
                    Payment = request.Payment
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ A930 payment error");
                var info = "[FAIL] A930 payment failed due to network error.";
                LogPayment("", "PAYMENT TERMINAL - A930", info, request, ex.Message);

                return StatusCode(500, new PaymentResponse
                {
                    Success = false,
                    Message = "Payment failed due to network error",
                    Payment = request.Payment
                });
            }
        }

        /// <summary>
        /// NETS Debit Card Payment
        /// POST /API/Payment/nets
        /// </summary>
        [HttpPost("nets")]
        public async Task<IActionResult> NetsPay([FromBody] PaymentRequest request)
        {
            try
            {
                var payment = request.Payment;
                var oldECN = request.OldECN ?? "";
                var url = $"{_netsServiceUrl}/api/nets/card/debit/pay?amount={payment.TenderAmt}&old_ECN={oldECN}";

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(150); // ✅
                var response = await client.GetAsync(url);
                var content = await response.Content.ReadAsStringAsync();
                var result = JsonSerializer.Deserialize<NetsResponse>(content);

                string info;
                PaymentResponse paymentResponse;

                if (result?.ResponseCode == "00")
                {
                    // Extract approval code
                    var approvalCode = result.ApprovalCode?.Split('\u0006');
                    if (approvalCode?.Length > 1)
                    {
                        payment.RefInfo = "*" + approvalCode[1];
                    }

                    var salesOtherInfo = new List<SalesOtherInfo>
                    {
                        new SalesOtherInfo
                        {
                            InfoName = $"{payment.PaymentName}{payment.SNo}",
                            InfoValue = JsonSerializer.Serialize(new[] { result }).Replace("'", "|")
                        }
                    };

                    paymentResponse = new PaymentResponse
                    {
                        Success = true,
                        Message = "NETS payment successful",
                        Payment = payment,
                        SalesOtherInfo = salesOtherInfo,
                        Result = result
                    };

                    info = "[SUCCESS] NETS payment successful.";
                }
                else
                {
                    paymentResponse = new PaymentResponse
                    {
                        Success = false,
                        Message = "NETS payment failed",
                        Payment = payment,
                        Result = result
                    };

                    info = "[FAIL] NETS payment failed.";
                }

                LogPayment(result?.S_ECN, "PAYMENT TERMINAL - NETS", info, request, result);

                return paymentResponse.Success ? Ok(paymentResponse) : BadRequest(paymentResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ NETS payment error");
                var info = "[FAIL] NETS payment failed due to network error.";
                LogPayment("", "PAYMENT TERMINAL - NETS", info, request, ex.Message);

                return StatusCode(500, new PaymentResponse
                {
                    Success = false,
                    Message = "Payment failed due to network error",
                    Payment = request.Payment
                });
            }
        }

        /// <summary>
        /// NETS Credit Card Payment
        /// POST /API/Payment/nets-credit
        /// </summary>
        [HttpPost("nets-credit")]
        public async Task<IActionResult> NetsCreditCardPay([FromBody] PaymentRequest request)
        {
            try
            {
                var payment = request.Payment;
                var oldECN = request.OldECN ?? "";
                var url = $"{_netsServiceUrl}/api/nets/card/credit/sales?amount={payment.TenderAmt}&old_ECN={oldECN}";

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(150); // ✅

                var response = await client.GetAsync(url);
                var content = await response.Content.ReadAsStringAsync();
                var result = JsonSerializer.Deserialize<NetsCreditResponse>(content);

                string info;
                PaymentResponse paymentResponse;

                if (result?.ResponseCode == "00")
                {
                    // Extract card issuer name
                    var cardIssuerName = ExtractCardIssuerName(result.IssuerName_Raw);

                    if (!string.IsNullOrEmpty(cardIssuerName))
                    {
                        payment.PaymentName = cardIssuerName;
                    }

                    var salesOtherInfo = new List<SalesOtherInfo>
                    {
                        new SalesOtherInfo
                        {
                            InfoName = $"{payment.PaymentName}{payment.SNo}",
                            InfoValue = JsonSerializer.Serialize(new[] { result })
                        }
                    };

                    paymentResponse = new PaymentResponse
                    {
                        Success = true,
                        Message = "NETS CREDIT CARD payment successful",
                        Payment = payment,
                        SalesOtherInfo = salesOtherInfo,
                        Result = result
                    };

                    info = "[SUCCESS] NETS CREDIT CARD payment successful.";
                }
                else
                {
                    paymentResponse = new PaymentResponse
                    {
                        Success = false,
                        Message = "NETS CREDIT CARD payment failed",
                        Payment = payment,
                        Result = result
                    };

                    info = "[FAIL] NETS CREDIT CARD payment failed.";
                }

                LogPayment(result?.S_ECN, "PAYMENT TERMINAL - NETS CREDIT CARD", info, request, result);

                return paymentResponse.Success ? Ok(paymentResponse) : BadRequest(paymentResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ NETS CREDIT CARD payment error");
                var info = "[FAIL] NETS CREDIT CARD payment failed due to network error.";
                LogPayment("", "PAYMENT TERMINAL - NETS CREDIT CARD", info, request, ex.Message);

                return StatusCode(500, new PaymentResponse
                {
                    Success = false,
                    Message = "Payment failed due to network error",
                    Payment = request.Payment
                });
            }
        }

        /// <summary>
        /// UOB Credit Card Payment
        /// POST /API/Payment/uob
        /// </summary>
        [HttpPost("uob")]
        public async Task<IActionResult> UobPay([FromBody] PaymentRequest request)
        {
            string info = "";
            PaymentResponse paymentResponse = new PaymentResponse();

            try
            {
                var payment = request.Payment;
                var oldECN = request.OldECN ?? "";
                var url = $"{_netsServiceUrl}/api/uob/card/credit/sales?amount={payment.TenderAmt}&old_ECN={oldECN}";

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(150); // ✅

                client.DefaultRequestHeaders.Add("X-Payment-Name", payment.PaymentName);

                var response = await client.GetAsync(url);
                var content = await response.Content.ReadAsStringAsync();
                var result = JsonSerializer.Deserialize<UobResponse>(content);

                if (result?.ResponseCode == "00")
                {
                    if (!string.IsNullOrEmpty(result.CardNumber_Raw))
                    {
                        var parts = result.CardNumber_Raw.Split('\u0000');
                        string fullCard = parts.Length > 1 ? parts[1].Trim() : result.CardNumber_Raw;
                        payment.RefInfo = fullCard.Length >= 10 ? fullCard[^10..] : fullCard;
                    }

                    paymentResponse = new PaymentResponse
                    {
                        Success = true,
                        Message = "UOB payment successful",
                        Payment = payment,
                        Result = result
                    };
                    info = "[SUCCESS] UOB payment successful.";
                }
                else
                {
                    paymentResponse = new PaymentResponse
                    {
                        Success = false,
                        Message = $"UOB payment failed: {result?.ResponseDesc}",
                        Payment = payment,
                        Result = result
                    };
                    info = $"[FAIL] UOB payment failed: {result?.ResponseDesc}";
                }

                LogPayment(result?.S_ECN, "PAYMENT TERMINAL - UOB", info, request, result);
                return paymentResponse.Success ? Ok(paymentResponse) : BadRequest(paymentResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ UOB payment error");
                info = $"[FAIL] UOB payment failed due to network error: {ex.Message}";
                LogPayment("", "PAYMENT TERMINAL - UOB", info, request, ex.Message);
                return StatusCode(500, new PaymentResponse { Success = false, Message = ex.Message });
            }
        }

        /// <summary>
        /// OCBC Credit Card Payment
        /// POST /API/Payment/ocbc
        /// </summary>
        [HttpPost("ocbc")]
        public async Task<IActionResult> OcbcPay([FromBody] PaymentRequest request)
        {
            try
            {
                var payment = request.Payment;
                var url = $"{_netsServiceUrl}/api/ocbc/card/credit/sale?amount={payment.TenderAmt}&old_ECN=";

                var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(150); // ✅

                client.DefaultRequestHeaders.Add("X-Payment-Name", payment.PaymentName);

                var response = await client.GetAsync(url);
                var content = await response.Content.ReadAsStringAsync();
                var result = JsonSerializer.Deserialize<OcbcResponse>(content);

                string info;
                PaymentResponse paymentResponse;

                if (result?.ResponseCode == "00")
                {
                    var cardLabel = result.CardLabel?.Trim();
                    var cardNumber = result.Pan?.Replace("\u0000", "");

                    if (!string.IsNullOrEmpty(result.AlipayOrderNo_Raw))
                    {
                        var parts = result.AlipayOrderNo_Raw.Split('\u0000');
                        if (parts.Length > 1)
                        {
                            var alipayNo = parts[1]?.Replace("\0", "")?.Trim();
                            payment.RefInfo = alipayNo;
                        }
                    }
                    else if (!string.IsNullOrEmpty(cardNumber))
                    {
                        payment.RefInfo = cardNumber.Length >= 10
                            ? cardNumber[^10..]
                            : cardNumber;
                    }

                    if (!string.IsNullOrEmpty(cardLabel))
                    {
                        payment.PaymentName = cardLabel;
                    }

                    var salesOtherInfo = new List<SalesOtherInfo>
                    {
                        new SalesOtherInfo
                        {
                            InfoName = $"{payment.PaymentName}{payment.SNo}",
                            InfoValue = JsonSerializer.Serialize(new[] { result })
                        }
                    };

                    paymentResponse = new PaymentResponse
                    {
                        Success = true,
                        Message = "OCBC payment successful",
                        Payment = payment,
                        SalesOtherInfo = salesOtherInfo,
                        Result = result
                    };

                    info = "[SUCCESS] OCBC payment successful.";
                }
                else
                {
                    paymentResponse = new PaymentResponse
                    {
                        Success = false,
                        Message = "OCBC payment failed",
                        Payment = payment,
                        Result = result
                    };

                    info = "[FAIL] OCBC payment failed.";
                }

                LogPayment(result?.S_ECN, "PAYMENT TERMINAL - OCBC", info, request, result);

                return paymentResponse.Success ? Ok(paymentResponse) : BadRequest(paymentResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ OCBC payment error");
                var info = "[FAIL] OCBC payment failed due to network error.";
                LogPayment("", "PAYMENT TERMINAL - OCBC", info, request, ex.Message);

                return StatusCode(500, new PaymentResponse
                {
                    Success = false,
                    Message = "Payment failed due to network error",
                    Payment = request.Payment
                });
            }
        }

        #region Helper Methods

        private string ExtractCardIssuerName(string issuerNameRaw)
        {
            if (string.IsNullOrEmpty(issuerNameRaw)) return null;

            // Try splitting by \u0010
            var parts = issuerNameRaw.Split('\u0010');
            if (parts.Length > 1)
            {
                return parts[1].Replace("\0", "").Trim();
            }

            // Fallback: try splitting by \u0000
            parts = issuerNameRaw.Split('\u0000');
            if (parts.Length > 1)
            {
                return parts[1].Replace("\0", "").Trim();
            }

            return null;
        }

        /// <summary>
        /// Logs payment activity to the console/ASP.NET logger AND appends a structured
        /// entry to a daily file under PaymentLogs/ for offline audit / debugging.
        ///
        /// Folder structure:
        ///   PaymentLogs/
        ///     2026-04-05.txt   ← all transactions for that day
        ///     2026-04-06.txt
        ///     ...
        /// </summary>
        /// <param name="id">Transaction / ECN identifier</param>
        /// <param name="module">Payment terminal label (e.g. "PAYMENT TERMINAL - NETS")</param>
        /// <param name="info">Human-readable outcome string (e.g. "[SUCCESS] ...")</param>
        /// <param name="req">The original PaymentRequest payload received by the endpoint</param>
        /// <param name="res">The raw response object returned by the downstream service</param>
        private void LogPayment(string id, string module, string info, object req, object res)
        {
            var now = DateTime.Now; // local time — matches the filename date operators see
            var log = new PaymentLog
            {
                Id = id ?? "",
                Module = module,
                Info = info,
                Req = req,
                Res = res,
                Timestamp = DateTime.UtcNow
            };

            // ── 1. ASP.NET structured logger (existing behaviour) ──────────────────
            _logger.LogInformation("💳 {Module}: {Info}", module, info);
            _logger.LogDebug("Payment Log: {Log}", JsonSerializer.Serialize(log));

            // ── 2. Daily flat-file log under PaymentLogs/ ──────────────────────────
            try
            {
                var serializerOptions = new JsonSerializerOptions { WriteIndented = false };

                // Resolve today's file: PaymentLogs/2026-04-05.txt
                var logFilePath = GetDailyLogFilePath();

                var entry = new StringBuilder();
                entry.AppendLine("==========================================================");
                entry.AppendLine($"Timestamp : {now:yyyy-MM-dd HH:mm:ss} (Local) | {log.Timestamp:yyyy-MM-dd HH:mm:ss} UTC");
                entry.AppendLine($"Module    : {module}");
                entry.AppendLine($"Id        : {log.Id}");
                entry.AppendLine($"Info      : {info}");
                entry.AppendLine($"Request   : {JsonSerializer.Serialize(req, serializerOptions)}");
                entry.AppendLine($"Response  : {JsonSerializer.Serialize(res, serializerOptions)}");
                entry.AppendLine("==========================================================");
                entry.AppendLine();

                // System.IO.File is fully qualified to avoid conflict with ControllerBase.File()
                // AppendAllText creates the file automatically if it does not exist yet,
                // so the first transaction of each new day creates that day's file.
                System.IO.File.AppendAllText(logFilePath, entry.ToString(), Encoding.UTF8);

                _logger.LogDebug("📄 Payment log written → {Path}", logFilePath);
            }
            catch (Exception fileEx)
            {
                // Never let a logging failure surface to the caller
                _logger.LogWarning(fileEx, "⚠️ Could not write to payment log file in: {Folder}", _logBaseFolder);
            }
        }

        #endregion
    }
}