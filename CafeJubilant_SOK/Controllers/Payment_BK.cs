//using CafeJubilant_SOK.Models;
//using CafeJubilant_SOK.Services;
//using Microsoft.AspNetCore.Mvc;
//using Microsoft.Extensions.Hosting;
//using System.Text;
//using System.Text.Json;

//namespace CafeJubilant_SOK.Controllers
//{
//    [ApiController]
//    [Route("API/[controller]")]
//    public class PaymentController : ControllerBase
//    {
//        private readonly IHttpClientFactory _httpClientFactory;
//        private readonly ILogger<PaymentController> _logger;
//        private readonly IConfiguration _configuration;
//        private readonly string _netsServiceUrl;
//        public PaymentController(
//          IHttpClientFactory httpClientFactory,
//          ILogger<PaymentController> logger,
//          IConfiguration configuration) 
//        {
//            _httpClientFactory = httpClientFactory;
//            _logger = logger;
//            _configuration = configuration;
//            _netsServiceUrl = _configuration["PaymentSettings:NetsServiceUrl"];
//        }

//        /// <summary>
//        /// A930 Credit Card Payment
//        /// POST /API/Payment/a930
//        /// </summary>
//        [HttpPost("a930")]
//        public async Task<IActionResult> A930Pay([FromBody] PaymentRequest request)
//        {
//            try
//            {
//                var payment = request.Payment;
//                var url = $"{_netsServiceUrl}/api/A930/card/credit/sales?amount={payment.TenderAmt}";

//                var client = _httpClientFactory.CreateClient();
//                var response = await client.GetAsync(url);
//                var content = await response.Content.ReadAsStringAsync();
//                var result = JsonSerializer.Deserialize<A930Response>(content);

//                string info;
//                PaymentResponse paymentResponse;

//                if (result?.ResponceCode == "00")
//                {
//                    // Extract card issuer name
//                    var lines = result.ResponceInfo?.Split("\r\n");
//                    var cardIssuerName = lines?.Length > 6 ? lines[6].Split(' ')[0] : null;

//                    if (!string.IsNullOrEmpty(cardIssuerName))
//                    {
//                        payment.PaymentName = cardIssuerName;
//                    }

//                    var salesOtherInfo = new List<SalesOtherInfo>
//                    {
//                        new SalesOtherInfo
//                        {
//                            InfoName = $"{payment.PaymentName}{payment.SNo}",
//                            InfoValue = JsonSerializer.Serialize(new[] { result })
//                        }
//                    };

//                    paymentResponse = new PaymentResponse
//                    {
//                        Success = true,
//                        Message = "A930 payment successful",
//                        Payment = payment,
//                        SalesOtherInfo = salesOtherInfo,
//                        Result = result
//                    };

//                    info = "[SUCCESS] A930 payment successful.";
//                }
//                else
//                {
//                    paymentResponse = new PaymentResponse
//                    {
//                        Success = false,
//                        Message = "A930 payment failed",
//                        Payment = payment,
//                        Result = result
//                    };

//                    info = "[FAIL] A930 payment failed.";
//                }

//                LogPayment("", "PAYMENT TERMINAL - A930", info, new { url }, result);

//                return paymentResponse.Success ? Ok(paymentResponse) : BadRequest(paymentResponse);
//            }
//            catch (OperationCanceledException)
//            {
//                var info = "[FAIL] A930 payment cancelled by user.";
//                LogPayment("", "PAYMENT TERMINAL - A930", info, null, null);

//                return BadRequest(new PaymentResponse
//                {
//                    Success = false,
//                    Message = "Payment cancelled by user",
//                    Payment = request.Payment
//                });
//            }
//            catch (Exception ex)
//            {
//                _logger.LogError(ex, "❌ A930 payment error");
//                var info = "[FAIL] A930 payment failed due to network error.";
//                LogPayment("", "PAYMENT TERMINAL - A930", info, null, ex.Message);

//                return StatusCode(500, new PaymentResponse
//                {
//                    Success = false,
//                    Message = "Payment failed due to network error",
//                    Payment = request.Payment
//                });
//            }
//        }

//        /// <summary>
//        /// NETS Debit Card Payment
//        /// POST /API/Payment/nets
//        /// </summary>
//        [HttpPost("nets")]
//        public async Task<IActionResult> NetsPay([FromBody] PaymentRequest request)
//        {
//            try
//            {
//                var payment = request.Payment;
//                var oldECN = request.OldECN ?? "";
//                var url = $"{_netsServiceUrl}/api/nets/card/debit/pay?amount={payment.TenderAmt}&old_ECN={oldECN}";

//                var client = _httpClientFactory.CreateClient();
//                var response = await client.GetAsync(url);
//                var content = await response.Content.ReadAsStringAsync();
//                var result = JsonSerializer.Deserialize<NETSResponse>(content);

//                string info;
//                PaymentResponse paymentResponse;

//                if (result?.ResponseCode == "00")
//                {
//                    // Extract approval code
//                    var approvalCode = result.ApprovalCode?.Split('\u0006');
//                    if (approvalCode?.Length > 1)
//                    {
//                        payment.RefInfo = "*" + approvalCode[1];
//                    }

//                    var salesOtherInfo = new List<SalesOtherInfo>
//                    {
//                        new SalesOtherInfo
//                        {
//                            InfoName = $"{payment.PaymentName}{payment.SNo}",
//                            InfoValue = JsonSerializer.Serialize(new[] { result }).Replace("'", "|")
//                        }
//                    };

//                    paymentResponse = new PaymentResponse
//                    {
//                        Success = true,
//                        Message = "NETS payment successful",
//                        Payment = payment,
//                        SalesOtherInfo = salesOtherInfo,
//                        Result = result
//                    };

//                    info = "[SUCCESS] NETS payment successful.";
//                }
//                else
//                {
//                    paymentResponse = new PaymentResponse
//                    {
//                        Success = false,
//                        Message = "NETS payment failed",
//                        Payment = payment,
//                        Result = result
//                    };

//                    info = "[FAIL] NETS payment failed.";
//                }

//                LogPayment(result?.S_ECN, "PAYMENT TERMINAL - NETS", info, new { url }, result);

//                return paymentResponse.Success ? Ok(paymentResponse) : BadRequest(paymentResponse);
//            }
//            catch (Exception ex)
//            {
//                _logger.LogError(ex, "❌ NETS payment error");
//                var info = "[FAIL] NETS payment failed due to network error.";
//                LogPayment("", "PAYMENT TERMINAL - NETS", info, null, ex.Message);

//                return StatusCode(500, new PaymentResponse
//                {
//                    Success = false,
//                    Message = "Payment failed due to network error",
//                    Payment = request.Payment
//                });
//            }
//        }

//        /// <summary>
//        /// NETS Credit Card Payment
//        /// POST /API/Payment/nets-credit
//        /// </summary>
//        [HttpPost("nets-credit")]
//        public async Task<IActionResult> NetsCreditCardPay([FromBody] PaymentRequest request)
//        {
//            try
//            {
//                var payment = request.Payment;
//                var oldECN = request.OldECN ?? "";
//                var url = $"{_netsServiceUrl}/api/nets/card/credit/sales?amount={payment.TenderAmt}&old_ECN={oldECN}";

//                var client = _httpClientFactory.CreateClient();
//                var response = await client.GetAsync(url);
//                var content = await response.Content.ReadAsStringAsync();
//                var result = JsonSerializer.Deserialize<NETSResponse>(content);

//                string info;
//                PaymentResponse paymentResponse;

//                if (result?.ResponseCode == "00")
//                {
//                    // Extract card issuer name
//                    var cardIssuerName = ExtractCardIssuerName(result.IssuerName_Raw);

//                    if (!string.IsNullOrEmpty(cardIssuerName))
//                    {
//                        payment.PaymentName = cardIssuerName;
//                    }

//                    var salesOtherInfo = new List<SalesOtherInfo>
//                    {
//                        new SalesOtherInfo
//                        {
//                            InfoName = $"{payment.PaymentName}{payment.SNo}",
//                            InfoValue = JsonSerializer.Serialize(new[] { result })
//                        }
//                    };

//                    paymentResponse = new PaymentResponse
//                    {
//                        Success = true,
//                        Message = "NETS CREDIT CARD payment successful",
//                        Payment = payment,
//                        SalesOtherInfo = salesOtherInfo,
//                        Result = result
//                    };

//                    info = "[SUCCESS] NETS CREDIT CARD payment successful.";
//                }
//                else
//                {
//                    paymentResponse = new PaymentResponse
//                    {
//                        Success = false,
//                        Message = "NETS CREDIT CARD payment failed",
//                        Payment = payment,
//                        Result = result
//                    };

//                    info = "[FAIL] NETS CREDIT CARD payment failed.";
//                }

//                LogPayment(result?.S_ECN, "PAYMENT TERMINAL - NETS CREDIT CARD", info, new { url }, result);

//                return paymentResponse.Success ? Ok(paymentResponse) : BadRequest(paymentResponse);
//            }
//            catch (Exception ex)
//            {
//                _logger.LogError(ex, "❌ NETS CREDIT CARD payment error");
//                var info = "[FAIL] NETS CREDIT CARD payment failed due to network error.";
//                LogPayment("", "PAYMENT TERMINAL - NETS CREDIT CARD", info, null, ex.Message);

//                return StatusCode(500, new PaymentResponse
//                {
//                    Success = false,
//                    Message = "Payment failed due to network error",
//                    Payment = request.Payment
//                });
//            }
//        }

//        /// <summary>
//        /// UOB Credit Card Payment
//        /// POST /API/Payment/uob
//        /// </summary>
//        [HttpPost("uob")]
//        public async Task<IActionResult> UobPay([FromBody] PaymentRequest request)
//        {
//            try
//            {
//                var payment = request.Payment;
//                var oldECN = request.OldECN ?? "";
//                var url = $"{_netsServiceUrl}/api/uob/card/credit/sales?amount={payment.TenderAmt}&old_ECN={oldECN}";

//                var client = _httpClientFactory.CreateClient();
//                client.DefaultRequestHeaders.Add("X-Payment-Name", payment.PaymentName);

//                var response = await client.GetAsync(url);
//                var content = await response.Content.ReadAsStringAsync();
//                var result = JsonSerializer.Deserialize<NETSResponse>(content);

//                string info;
//                PaymentResponse paymentResponse;

//                if (result?.ResponseCode == "00")
//                {
//                    // Extract card issuer name
//                    var cardIssuerName = ExtractCardIssuerName(result.IssuerName_Raw);

//                    // Extract Alipay number or card number
//                    if (!string.IsNullOrEmpty(result.AlipayOrderNo_Raw))
//                    {
//                        var alipayNo = result.AlipayOrderNo_Raw.Split('\u0000')[1]
//                            ?.Replace("\0", "")
//                            ?.Trim();
//                        payment.RefInfo = alipayNo;
//                    }
//                    else if (!string.IsNullOrEmpty(result.CardNumber_Raw))
//                    {
//                        payment.RefInfo = result.CardNumber_Raw[^10..];
//                    }

//                    if (!string.IsNullOrEmpty(cardIssuerName))
//                    {
//                        payment.PaymentName = cardIssuerName;
//                    }

//                    var salesOtherInfo = new List<SalesOtherInfo>
//                    {
//                        new SalesOtherInfo
//                        {
//                            InfoName = $"{payment.PaymentName}{payment.SNo}",
//                            InfoValue = JsonSerializer.Serialize(new[] { result })
//                        }
//                    };

//                    paymentResponse = new PaymentResponse
//                    {
//                        Success = true,
//                        Message = "UOB payment successful",
//                        Payment = payment,
//                        SalesOtherInfo = salesOtherInfo,
//                        Result = result
//                    };

//                    info = "[SUCCESS] UOB payment successful.";
//                }
//                else
//                {
//                    paymentResponse = new PaymentResponse
//                    {
//                        Success = false,
//                        Message = "UOB payment failed",
//                        Payment = payment,
//                        Result = result
//                    };

//                    info = "[FAIL] UOB payment failed.";
//                }

//                LogPayment(result?.S_ECN, "PAYMENT TERMINAL - UOB", info, new { url }, result);

//                return paymentResponse.Success ? Ok(paymentResponse) : BadRequest(paymentResponse);
//            }
//            catch (Exception ex)
//            {
//                _logger.LogError(ex, "❌ UOB payment error");
//                var info = "[FAIL] UOB payment failed due to network error.";
//                LogPayment("", "PAYMENT TERMINAL - UOB", info, null, ex.Message);

//                return StatusCode(500, new PaymentResponse
//                {
//                    Success = false,
//                    Message = "Payment failed due to network error",
//                    Payment = request.Payment
//                });
//            }
//        }

//        /// <summary>
//        /// OCBC Credit Card Payment
//        /// POST /API/Payment/ocbc
//        /// </summary>
//        [HttpPost("ocbc")]
//        public async Task<IActionResult> OcbcPay([FromBody] PaymentRequest request)
//        {
//            try
//            {
//                var payment = request.Payment;
//                var url = $"{_netsServiceUrl}/api/ocbc/card/credit/sale?amount={payment.TenderAmt}&old_ECN=";

//                var client = _httpClientFactory.CreateClient();
//                client.DefaultRequestHeaders.Add("X-Payment-Name", payment.PaymentName);

//                var response = await client.GetAsync(url);
//                var content = await response.Content.ReadAsStringAsync();
//                var result = JsonSerializer.Deserialize<OCBCResponse>(content);

//                string info;
//                PaymentResponse paymentResponse;

//                if (result?.ResponseCode == "00")
//                {
//                    var cardLabel = result.Cardlabel?.Trim();
//                    var cardNumber = result.Pan?.Replace("\u0000", "");

//                    // Extract Alipay number or card number
//                    if (!string.IsNullOrEmpty(result.AlipayOrderNo_Raw))
//                    {
//                        var alipayNo = result.AlipayOrderNo_Raw.Split('\u0000')[1]
//                            ?.Replace("\0", "")
//                            ?.Trim();
//                        payment.RefInfo = alipayNo;
//                    }
//                    else if (!string.IsNullOrEmpty(cardNumber))
//                    {
//                        payment.RefInfo = cardNumber[^10..];
//                    }

//                    if (!string.IsNullOrEmpty(cardLabel))
//                    {
//                        payment.PaymentName = cardLabel;
//                    }

//                    var salesOtherInfo = new List<SalesOtherInfo>
//                    {
//                        new SalesOtherInfo
//                        {
//                            InfoName = $"{payment.PaymentName}{payment.SNo}",
//                            InfoValue = JsonSerializer.Serialize(new[] { result })
//                        }
//                    };

//                    paymentResponse = new PaymentResponse
//                    {
//                        Success = true,
//                        Message = "OCBC payment successful",
//                        Payment = payment,
//                        SalesOtherInfo = salesOtherInfo,
//                        Result = result
//                    };

//                    info = "[SUCCESS] OCBC payment successful.";
//                }
//                else
//                {
//                    paymentResponse = new PaymentResponse
//                    {
//                        Success = false,
//                        Message = "OCBC payment failed",
//                        Payment = payment,
//                        Result = result
//                    };

//                    info = "[FAIL] OCBC payment failed.";
//                }

//                LogPayment(result?.S_ECN, "PAYMENT TERMINAL - OCBC", info, new { url }, result);

//                return paymentResponse.Success ? Ok(paymentResponse) : BadRequest(paymentResponse);
//            }
//            catch (Exception ex)
//            {
//                _logger.LogError(ex, "❌ OCBC payment error");
//                var info = "[FAIL] OCBC payment failed due to network error.";
//                LogPayment("", "PAYMENT TERMINAL - OCBC", info, null, ex.Message);

//                return StatusCode(500, new PaymentResponse
//                {
//                    Success = false,
//                    Message = "Payment failed due to network error",
//                    Payment = request.Payment
//                });
//            }
//        }

//        #region Helper Methods

//        private string ExtractCardIssuerName(string issuerNameRaw)
//        {
//            if (string.IsNullOrEmpty(issuerNameRaw)) return null;

//            // Try splitting by \u0010
//            var parts = issuerNameRaw.Split('\u0010');
//            if (parts.Length > 1)
//            {
//                return parts[1].Replace("\0", "").Trim();
//            }

//            // Fallback: try splitting by \u0000
//            parts = issuerNameRaw.Split('\u0000');
//            if (parts.Length > 1)
//            {
//                return parts[1].Replace("\0", "").Trim();
//            }

//            return null;
//        }


      

//        private void LogPayment(string id, string module, string info, object req, object res)
//        {
//            var log = new PaymentLog
//            {
//                Id = id ?? "",
//                Module = module,
//                Info = info,
//                Req = req,
//                Res = res,
//                Timestamp = DateTime.UtcNow
//            };

//            _logger.LogInformation("💳 {Module}: {Info}", module, info);
//            _logger.LogDebug("Payment Log: {Log}", JsonSerializer.Serialize(log));
//        }

//        #endregion
//    }
//}