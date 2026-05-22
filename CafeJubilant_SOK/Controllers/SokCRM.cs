using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using CafeJubilant_SOK.Models;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CafeJubilant_SOK.Controllers
{
    [ApiController]
    [Route("api")]
    public class SokCRM : ControllerBase
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<SokCRM> _logger;
        private readonly IConfiguration _configuration;
        private readonly EberSettings _eberSettings;
        private readonly OutletSettings _outletSettings;
        private readonly string _getPOSURL;
        private readonly IMemoryCache _memoryCache;


        public SokCRM(
         IHttpClientFactory httpClientFactory,
         IConfiguration configuration,
         ILogger<SokCRM> logger,
         IOptions<EberSettings> eberSettings,
         IOptions<OutletSettings> outletSettings,
          IMemoryCache memoryCache)
        {
            _httpClient = httpClientFactory.CreateClient();
            _logger = logger;
            _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
            _eberSettings = eberSettings.Value;
            _outletSettings = outletSettings.Value;
            _memoryCache = memoryCache;
            // Use the Outlet API URL instead
            _getPOSURL = _outletSettings.NEXT_ONLINE_API_URL;

            if (string.IsNullOrWhiteSpace(_getPOSURL))
            {
                throw new InvalidOperationException("NEXT_ONLINE_API_URL must be configured in Outlet settings");
            }

            _logger.LogInformation("✅ POS URL configured: {Url}", _getPOSURL);
        }
        private async Task<string> POSSessionID()
        {
            try
            {
                // Check if we have a valid cached session ID
                if (_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId) &&
                    !string.IsNullOrEmpty(sessionId))
                {
                    _logger.LogInformation("Using cached session ID: {SessionId}", sessionId);
                    return sessionId;
                }

                string url = $"{_getPOSURL}/GetSessionID/01?sessionid=";
                var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

                if (response.IsSuccessStatusCode)
                {
                    var jsonString = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

                    // Parse JSON to extract session_id
                    var jObj = Newtonsoft.Json.Linq.JObject.Parse(jsonString);

                    // Navigate the JSON structure to get session_id:
                    var newSessionId = jObj["data"]?[0]?["output"]?[0]?["session_id"]?.ToString();

                    if (string.IsNullOrEmpty(newSessionId))
                    {
                        _logger.LogWarning("Session ID not found in POS response");
                        return "Error: Session ID not found";
                    }

                    // Cache only the session_id string with expiration
                    _memoryCache.Set("POS_SESSION_ID", newSessionId, new MemoryCacheEntryOptions
                    {
                        AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(25) // Slightly less than 30 mins
                    });

                    _logger.LogInformation("New session ID retrieved and cached: {SessionId}", newSessionId);
                    return newSessionId;
                }
                else
                {
                    _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
                    return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "An exception occurred while fetching POS session ID.");
                return $"Exception: {ex.Message}";
            }
        }

   

        /// <summary>
        /// Test different POS endpoint variations
        /// GET: API/crm/pos/test-endpoints?sessionid=xxx
        /// </summary>
        [HttpGet("pos/test-endpoints")]
        public async Task<IActionResult> TestPosEndpoints([FromQuery] string sessionid)
        {
            var results = new List<object>();
            var baseUrl = _getPOSURL;

            var endpoints = new[]
            {
                "/GetCustomers",
                "/getcustomers",
                "/getCustomers",
                "/customers",
                "/Customers",
                "/customer/list",
                "/Customer/List",
                "/api/GetCustomers",
                "/GetCustomer",
                "/Member/List",
                "/members"
            };

            foreach (var endpoint in endpoints)
            {
                try
                {
                    var fullUrl = $"{baseUrl}{endpoint}?sessionid={Uri.EscapeDataString(sessionid)}&customername=%25";

                    var response = await _httpClient.GetAsync(fullUrl);
                    var content = await response.Content.ReadAsStringAsync();

                    results.Add(new
                    {
                        endpoint,
                        url = fullUrl,
                        statusCode = (int)response.StatusCode,
                        success = response.IsSuccessStatusCode,
                        responsePreview = content.Length > 200 ? content.Substring(0, 200) : content
                    });

                    if (response.IsSuccessStatusCode)
                    {
                        _logger.LogInformation("✅ Found working endpoint: {Endpoint}", endpoint);
                    }
                }
                catch (Exception ex)
                {
                    results.Add(new
                    {
                        endpoint,
                        error = ex.Message
                    });
                }
            }

            return Ok(new
            {
                message = "Tested multiple endpoint variations",
                baseUrl,
                results,
                workingEndpoints = results.Where(r => ((dynamic)r).success == true).ToList()
            });
        }

        [HttpPost("eber/user/show")]
        public async Task<IActionResult> EberUserShow(
        [FromQuery] string? phone = null,
        [FromQuery] bool list_redeemable = true,
        [FromQuery] int list_redeemable_mode = 2,
        [FromQuery] bool list_point_conversion = true,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] EberUserShowRequest? request = null)
        {
            


            try
            {
                string? userId = null;
                string? phoneNumber = phone;

                // Get from request body if provided
                if (request != null && !string.IsNullOrWhiteSpace(request.QueryString))
                {
                    var queryParams = System.Web.HttpUtility.ParseQueryString(request.QueryString);
                    userId = queryParams["user_id"];

                    if (string.IsNullOrWhiteSpace(phoneNumber))
                    {
                        phoneNumber = queryParams["phone"];
                    }
                }

                if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
                {
                    sessionId = await POSSessionID();
                    if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                        return BadRequest(new { success = false, error = sessionId });
                }

                var posApiUrl = $"{_eberSettings.NEXT_POS_EBER_API_URL}/eber/user/show/01";
                var fullUrl = $"{posApiUrl}?sessionid={sessionId}";

                // ✅ Build query string matching EBER format
                string queryString = "";

                if (!string.IsNullOrWhiteSpace(userId))
                {
                    queryString = $"user_id={userId}";
                    _logger.LogInformation("🔍 Searching by user_id: {UserId}", userId);
                }
                else if (!string.IsNullOrWhiteSpace(phoneNumber))
                {
                    // Clean phone number - remove everything except digits
                    var cleanPhone = new string(phoneNumber.Where(char.IsDigit).ToArray());

                    // If phone starts with country code (65), remove it
                    if (cleanPhone.StartsWith("65") && cleanPhone.Length == 10)
                    {
                        cleanPhone = cleanPhone.Substring(2);
                    }

                    // Validate 8 digits
                    if (cleanPhone.Length != 8)
                    {
                        return BadRequest(new
                        {
                            success = false,
                            error = "Invalid Singapore phone number. Must be 8 digits.",
                            provided = phoneNumber,
                            cleaned = cleanPhone
                        });
                    }

                    queryString = $"phone={cleanPhone}";
                    _logger.LogInformation("🔍 Searching by phone: {Phone}", cleanPhone);
                }

                // Add additional parameters if searching for specific user
                if (!string.IsNullOrWhiteSpace(queryString))
                {
                    if (list_redeemable)
                    {
                        queryString += $"&list_redeemable=1&list_redeemable_mode={list_redeemable_mode}";
                    }

                    if (list_point_conversion)
                    {
                        queryString += "&list_point_conversion=1";
                    }
                }

                // ✅ CRITICAL: Create nested object that will be stringified
                var innerData = new
                {
                    queryString = queryString,
                    api_url = _eberSettings.NEXT_EBER_API_URL,
                    eberUserId = _eberSettings.NEXT_EBER_USERNAME,
                    eberPassword = _eberSettings.NEXT_EBER_PASSWORD ?? ""
                };

                // ✅ Stringify the inner object
                var innerDataJson = JsonSerializer.Serialize(innerData, new JsonSerializerOptions
                {
                    WriteIndented = false
                });

                // ✅ Create form data with stringified JSON
                var formData = new FormUrlEncodedContent(new[]
                {
                    new KeyValuePair<string, string>("jsondata", innerDataJson)
                });

                _logger.LogInformation("📡 Calling POS EBER endpoint: {Url}", fullUrl);
                _logger.LogInformation("📤 jsondata value: {Data}", innerDataJson);

                var response = await _httpClient.PostAsync(fullUrl, formData);
                var content = await response.Content.ReadAsStringAsync();

                _logger.LogInformation("📥 Status: {Status}, Response length: {Length}",
                    response.StatusCode, content.Length);

                if (!response.IsSuccessStatusCode)
                {
                    try
                    {
                        var errorResponse = JsonSerializer.Deserialize<JsonElement>(content);
                        if (errorResponse.TryGetProperty("error", out var errorObj) &&
                            errorObj.TryGetProperty("exception", out var exceptions))
                        {
                            var errorMessage = exceptions.EnumerateArray().FirstOrDefault().GetString();

                            _logger.LogWarning("❌ EBER API Error: {Error}", errorMessage);

                            return NotFound(new
                            {
                                success = false,
                                member_found = false,
                                error = errorMessage ?? "Member not found",
                                search_criteria = new
                                {
                                    phone = phoneNumber,
                                    user_id = userId,
                                    query_sent = queryString
                                }
                            });
                        }
                    }
                    catch { }

                    return NotFound(new
                    {
                        success = false,
                        member_found = false,
                        error = "Member not found",
                        debug = new
                        {
                            query_sent = queryString,
                            statusCode = (int)response.StatusCode,
                            response_preview = content.Length > 500 ? content.Substring(0, 500) : content
                        }
                    });
                }

                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var result = JsonSerializer.Deserialize<JsonElement>(content, options);

                // ✅ Extract and structure member info
                var memberData = new
                {
                    id = result.TryGetProperty("id", out var id) ? id.GetInt64() : 0,
                    display_name = result.TryGetProperty("display_name", out var name) ? name.GetString() : null,
                    email = result.TryGetProperty("email", out var email) ? email.GetString() : null,
                    phone = result.TryGetProperty("phone", out var ph) ? ph.GetString() : null,
                    phone_format = result.TryGetProperty("phone_format", out var phFormat) ? phFormat.GetString() : null,
                    points = 0,
                    tier = "Standard",
                    available_rewards = 0
                };

                // Extract points from points array
                if (result.TryGetProperty("points", out var pointsArray) &&
                    pointsArray.ValueKind == JsonValueKind.Array &&
                    pointsArray.GetArrayLength() > 0)
                {
                    var firstPoints = pointsArray[0];
                    if (firstPoints.TryGetProperty("points", out var pts))
                    {
                        memberData = memberData with { points = pts.GetInt32() };
                    }
                }

                // Extract member tier
                if (result.TryGetProperty("member_tiers", out var tiersArray) &&
                    tiersArray.ValueKind == JsonValueKind.Array &&
                    tiersArray.GetArrayLength() > 0)
                {
                    var firstTier = tiersArray[0];
                    if (firstTier.TryGetProperty("name", out var tierName))
                    {
                        memberData = memberData with { tier = tierName.GetString() ?? "Standard" };
                    }
                }

                // Count redeemable rewards
                if (result.TryGetProperty("redeemable_list", out var redeemableList) &&
                    redeemableList.ValueKind == JsonValueKind.Array)
                {
                    memberData = memberData with { available_rewards = redeemableList.GetArrayLength() };
                }

                _logger.LogInformation("✅ Member found: {DisplayName}, Points: {Points}, Tier: {Tier}",
                    memberData.display_name, memberData.points, memberData.tier);

                return Ok(new
                {
                    success = true,
                    member_found = true,
                    member = memberData,
                    raw_data = result // Include full response for reference
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error in EBER user/show");
                return StatusCode(500, new
                {
                    success = false,
                    member_found = false,
                    error = "Failed to retrieve customer information",
                    details = ex.Message
                });
            }
        }

        [HttpPost("eber/customer/combined")]
        public async Task<IActionResult> GetEberCustomerInfoCombined(
            [FromQuery] string sessionid,
            [FromBody] EberUserShowRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.QueryString))
            {
                _logger.LogWarning("⚠️ Missing queryString in request");
                return BadRequest(new { success = false, error = "Query string is required" });
            }

            try
            {
                var queryParams = System.Web.HttpUtility.ParseQueryString(request.QueryString);
                var userId = queryParams["user_id"];

                if (string.IsNullOrWhiteSpace(userId))
                {
                    _logger.LogWarning("⚠️ Missing user_id in queryString");
                    return BadRequest(new { success = false, error = "user_id is required in queryString" });
                }

                _logger.LogInformation("🔍 Getting combined customer info - UserId: {UserId}, SessionId: {SessionId}",
                    userId, sessionid);

                var customerInfoFromCrmVendor = await GetCustomerInfoFromEberAsync(userId);

                if (customerInfoFromCrmVendor == null)
                {
                    _logger.LogWarning("❌ Customer not found in EBER: {UserId}", userId);
                    return NotFound(new { success = false, error = "Customer not found" });
                }

                var response = new Dictionary<string, object>
                {
                    { "vendor_info", customerInfoFromCrmVendor }
                };

                var crmVendor = Request.Cookies["crm"] ?? "EBER";
                string customerCode = "";

                if (crmVendor == "EBER")
                {
                    var displayNamePrefix = customerInfoFromCrmVendor.DisplayName?.Length >= 3
                        ? customerInfoFromCrmVendor.DisplayName.Substring(0, 3)
                        : customerInfoFromCrmVendor.DisplayName;

                    customerCode = $"{displayNamePrefix}-{customerInfoFromCrmVendor.PhoneFormat}";
                }

                _logger.LogInformation("📝 Generated customer code: {CustomerCode}", customerCode);

                var customerInfoFromPos = await GetPosCustomersAsync(sessionid, customerCode);

                if (customerInfoFromPos != null &&
                    customerInfoFromPos.Message == "SUCCESS" &&
                    customerInfoFromPos.Data != null &&
                    customerInfoFromPos.Data.Count > 0 &&
                    customerInfoFromPos.Data[0].Output != null &&
                    customerInfoFromPos.Data[0].Output.Count > 0)
                {
                    var customerInfo = customerInfoFromPos.Data[0].Output[0];

                    _logger.LogInformation("✅ POS customer info retrieved");

                    var mergedResponse = new Dictionary<string, object>();

                    foreach (var prop in customerInfo.GetType().GetProperties())
                    {
                        mergedResponse[ToCamelCase(prop.Name)] = prop.GetValue(customerInfo);
                    }

                    mergedResponse["vendor_info"] = customerInfoFromCrmVendor;

                    return Ok(mergedResponse);
                }
                else
                {
                    _logger.LogWarning("⚠️ POS customer info not found or invalid response");
                    return Ok(response);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error getting combined customer info");
                return StatusCode(500, new { success = false, error = "Failed to retrieve customer information" });
            }
        }

        [HttpGet("eber/user/list")]
        public async Task<IActionResult> EberUserListGet(
            [FromQuery] string sessionid,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20,
            [FromQuery] string search = null)
        {
            try
            {
                _logger.LogInformation("📋 EBER user/list (GET) - Page: {Page}, Size: {PageSize}, Search: {Search}, SessionId: {SessionId}",
                    page, pageSize, search ?? "none", sessionid);

                var customers = await GetCustomersFromEberAsync(page, pageSize, search, null);

                if (customers == null || customers.Items == null || customers.Items.Count == 0)
                {
                    _logger.LogWarning("⚠️ No customers found");
                    return Ok(new
                    {
                        items = new List<object>(),
                        total = 0,
                        page,
                        per_page = pageSize
                    });
                }

                _logger.LogInformation("✅ Retrieved {Count} customers", customers.Items.Count);

                return Ok(new
                {
                    items = customers.Items,
                    total = customers.Total,
                    page,
                    per_page = pageSize
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error in EBER user/list");
                return StatusCode(500, new { success = false, error = "Failed to retrieve customer list" });
            }
        }

        [HttpGet("customer")]
        public async Task<IActionResult> GetCustomerInfo([FromQuery] string membershipId)
        {
            if (string.IsNullOrWhiteSpace(membershipId))
            {
                _logger.LogWarning("⚠️ Missing membershipId in request");
                return BadRequest(new { success = false, error = "Membership ID is required" });
            }

            try
            {
                _logger.LogInformation("🔍 Fetching customer info for: {MembershipId}", membershipId);

                var customer = await GetCustomerInfoFromEberAsync(membershipId);

                if (customer == null)
                {
                    _logger.LogWarning("❌ Customer not found: {MembershipId}", membershipId);
                    return NotFound(new { success = false, error = "Customer not found" });
                }

                HttpContext.Session.SetString("UserData", JsonSerializer.Serialize(customer));
                HttpContext.Session.SetString("MembershipId", membershipId);

                _logger.LogInformation("✅ Customer info retrieved: {DisplayName}", customer.DisplayName);

                return Ok(new { success = true, customer, timestamp = DateTime.UtcNow });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "❌ HTTP error retrieving customer: {MembershipId}", membershipId);
                return StatusCode(503, new { success = false, error = "EBER service unavailable" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error retrieving customer: {MembershipId}", membershipId);
                return StatusCode(500, new { success = false, error = "Failed to retrieve customer information" });
            }
        }

        [HttpGet("customer/points")]
        public async Task<IActionResult> GetCustomerPoints([FromQuery] string membershipId)
        {
            if (string.IsNullOrWhiteSpace(membershipId))
            {
                _logger.LogWarning("⚠️ Missing membershipId in request");
                return BadRequest(new { success = false, error = "Membership ID is required" });
            }

            try
            {
                _logger.LogInformation("💰 Fetching points for: {MembershipId}", membershipId);

                var points = await GetCustomerPointsFromEberAsync(membershipId);

                _logger.LogInformation("✅ Points retrieved: {TotalPoints}", points.TotalPoints);

                return Ok(new { success = true, points, timestamp = DateTime.UtcNow });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error retrieving points: {MembershipId}", membershipId);
                return StatusCode(500, new { success = false, error = "Failed to retrieve points" });
            }
        }

        [HttpPost("validate")]
        public async Task<IActionResult> ValidateMember([FromBody] ValidateMemberRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.MembershipId))
            {
                _logger.LogWarning("⚠️ Missing membershipId in validation request");
                return BadRequest(new { success = false, error = "Membership ID is required" });
            }

            try
            {
                _logger.LogInformation("🔐 Validating member: {MembershipId}", request.MembershipId);

                var isValid = await ValidateMemberAsync(request.MembershipId);

                _logger.LogInformation(isValid
                    ? "✅ Member validated: {MembershipId}"
                    : "❌ Invalid member: {MembershipId}",
                    request.MembershipId);

                return Ok(new
                {
                    success = true,
                    isValid,
                    membershipId = request.MembershipId,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error validating member: {MembershipId}", request.MembershipId);
                return StatusCode(500, new { success = false, error = "Failed to validate member" });
            }
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.MembershipId))
            {
                _logger.LogWarning("⚠️ Missing membershipId in login request");
                return BadRequest(new { success = false, error = "Membership ID is required" });
            }

            try
            {
                _logger.LogInformation("🔑 Login attempt: {MembershipId}", request.MembershipId);

                var isValid = await ValidateMemberAsync(request.MembershipId);

                if (!isValid)
                {
                    _logger.LogWarning("❌ Invalid login attempt: {MembershipId}", request.MembershipId);
                    return Unauthorized(new { success = false, error = "Invalid membership ID" });
                }

                var customer = await GetCustomerInfoFromEberAsync(request.MembershipId);

                HttpContext.Session.SetString("UserData", JsonSerializer.Serialize(customer));
                HttpContext.Session.SetString("MembershipId", request.MembershipId);
                HttpContext.Session.SetString("IsAuthenticated", "true");

                Response.Cookies.Append("crm", "EBER", new CookieOptions
                {
                    HttpOnly = false,
                    Secure = true,
                    SameSite = SameSiteMode.Strict,
                    Expires = DateTimeOffset.UtcNow.AddDays(30)
                });

                Response.Cookies.Append("auth", "true", new CookieOptions
                {
                    HttpOnly = true,
                    Secure = true,
                    SameSite = SameSiteMode.Strict,
                    Expires = DateTimeOffset.UtcNow.AddHours(8)
                });

                _logger.LogInformation("✅ Login successful: {DisplayName}", customer.DisplayName);

                return Ok(new { success = true, user = customer, message = "Login successful", timestamp = DateTime.UtcNow });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Login error: {MembershipId}", request.MembershipId);
                return StatusCode(500, new { success = false, error = "Login failed" });
            }
        }

        [HttpPost("customer/combined")]
        public async Task<IActionResult> GetCombinedCustomerInfo([FromBody] CombinedCustomerRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.UserId))
            {
                _logger.LogWarning("⚠️ Missing userId in request");
                return BadRequest(new { success = false, error = "User ID is required" });
            }

            try
            {
                _logger.LogInformation("🔍 Fetching combined customer info for: {UserId}", request.UserId);

                var eberCustomer = await GetCustomerInfoFromEberAsync(request.UserId);

                if (eberCustomer == null)
                {
                    _logger.LogWarning("❌ Customer not found in EBER: {UserId}", request.UserId);
                    return NotFound(new { success = false, error = "Customer not found in EBER" });
                }

                var crmVendor = Request.Cookies["crm"] ?? "EBER";
                string customerCode = "";

                if (crmVendor == "EBER")
                {
                    var displayNamePrefix = eberCustomer.DisplayName?.Length >= 3
                        ? eberCustomer.DisplayName.Substring(0, 3)
                        : eberCustomer.DisplayName;

                    customerCode = $"{displayNamePrefix}-{eberCustomer.PhoneFormat}";
                }

                _logger.LogInformation("📝 Generated customer code: {CustomerCode}", customerCode);

                var posCustomerInfo = await GetPosCustomerInfoAsync(customerCode);

                if (posCustomerInfo != null)
                {
                    _logger.LogInformation("✅ POS customer info retrieved");

                    return Ok(new
                    {
                        success = true,
                        data = new
                        {
                            vendorInfo = eberCustomer,
                            posInfo = posCustomerInfo,
                            customerCode
                        },
                        timestamp = DateTime.UtcNow
                    });
                }
                else
                {
                    _logger.LogWarning("⚠️ POS customer info not found, returning EBER data only");

                    return Ok(new
                    {
                        success = true,
                        data = new
                        {
                            vendorInfo = eberCustomer,
                            posInfo = (object)null,
                            customerCode
                        },
                        timestamp = DateTime.UtcNow
                    });
                }
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "❌ HTTP error retrieving combined customer info: {UserId}", request.UserId);
                return StatusCode(503, new { success = false, error = "Service unavailable" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error retrieving combined customer info: {UserId}", request.UserId);
                return StatusCode(500, new { success = false, error = "Failed to retrieve customer information" });
            }
        }

        [HttpPost("logout")]
        public IActionResult Logout()
        {
            try
            {
                var membershipId = HttpContext.Session.GetString("MembershipId");

                HttpContext.Session.Clear();
                Response.Cookies.Delete("auth");
                Response.Cookies.Delete("crm");

                _logger.LogInformation("✅ Logout successful: {MembershipId}", membershipId ?? "unknown");

                return Ok(new { success = true, message = "Logout successful", timestamp = DateTime.UtcNow });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Logout error");
                return StatusCode(500, new { success = false, error = "Logout failed" });
            }
        }

        [HttpGet("session/user")]
        public IActionResult GetSessionUser()
        {
            try
            {
                var userData = HttpContext.Session.GetString("UserData");

                if (string.IsNullOrEmpty(userData))
                {
                    _logger.LogWarning("⚠️ No user session found");
                    return NotFound(new { success = false, error = "No user session found" });
                }

                var user = JsonSerializer.Deserialize<EberCustomerResponse>(userData);

                _logger.LogDebug("✅ Session user retrieved: {DisplayName}", user?.DisplayName);

                return Ok(new { success = true, user, timestamp = DateTime.UtcNow });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error retrieving session user");
                return StatusCode(500, new { success = false, error = "Failed to retrieve session data" });
            }
        }

        [HttpGet("config")]
        public IActionResult GetConfig()
        {
            try
            {
                var config = new
                {
                    crmVendor = "EBER",
                    outletApiUrl = _outletSettings.NEXT_ONLINE_API_URL,
                    imageApiUrl = _outletSettings.IMAGE_API_URL,
                    compCode = _outletSettings.NEXT_COMP_CODE,
                    captureLog = _outletSettings.NEXT_CAPTURE_LOG
                };

                return Ok(new { success = true, config, timestamp = DateTime.UtcNow });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error retrieving config");
                return StatusCode(500, new { success = false, error = "Failed to retrieve configuration" });
            }
        }

        [HttpGet("health")]
        public IActionResult Health()
        {
            try
            {
                var isEberConfigured = !string.IsNullOrWhiteSpace(_eberSettings.NEXT_EBER_API_URL);

                return Ok(new
                {
                    success = true,
                    status = "healthy",
                    crmVendor = "EBER",
                    isConfigured = isEberConfigured,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Health check failed");
                return StatusCode(500, new { success = false, error = "Health check failed" });
            }
        }

        [HttpGet("eber/test")]
        public async Task<IActionResult> TestEberConnection()
        {
            var results = new List<object>();

            try
            {
                var endpoint1 = "/members?page=1&per_page=5";
                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
                var fullUrl1 = _eberSettings.NEXT_EBER_API_URL + endpoint1;

                var request1 = new HttpRequestMessage(HttpMethod.Get, fullUrl1);
                AddAuthHeaders(request1, HttpMethod.Get, endpoint1, timestamp);

                var response1 = await _httpClient.SendAsync(request1);
                var content1 = await response1.Content.ReadAsStringAsync();

                results.Add(new
                {
                    test = "HMAC Auth - /members",
                    success = response1.IsSuccessStatusCode,
                    statusCode = (int)response1.StatusCode,
                    url = fullUrl1,
                    response = content1
                });
            }
            catch (Exception ex)
            {
                results.Add(new { test = "HMAC Auth - /members", error = ex.Message });
            }

            try
            {
                var endpoint2 = "/members?page=1&per_page=5";
                var fullUrl2 = _eberSettings.NEXT_EBER_API_URL + endpoint2;

                var request2 = new HttpRequestMessage(HttpMethod.Get, fullUrl2);
                var credentials = Convert.ToBase64String(
                    Encoding.UTF8.GetBytes($"{_eberSettings.NEXT_EBER_USERNAME}:{_eberSettings.NEXT_EBER_PASSWORD}")
                );
                request2.Headers.Add("Authorization", $"Basic {credentials}");

                var response2 = await _httpClient.SendAsync(request2);
                var content2 = await response2.Content.ReadAsStringAsync();

                results.Add(new
                {
                    test = "Basic Auth - /members",
                    success = response2.IsSuccessStatusCode,
                    statusCode = (int)response2.StatusCode,
                    url = fullUrl2,
                    response = content2
                });
            }
            catch (Exception ex)
            {
                results.Add(new { test = "Basic Auth - /members", error = ex.Message });
            }

            return Ok(new
            {
                message = "Tested multiple endpoints and auth methods",
                baseUrl = _eberSettings.NEXT_EBER_API_URL,
                results
            });
        }

        // PRIVATE HELPER METHODS

        private async Task<EberCustomerListResponse> GetCustomersFromEberAsync(
            int page,
            int pageSize,
            string search = null,
            string tier = null)
        {
            try
            {
                var endpoint = "/members";
                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();

                var queryParams = new List<string>
                {
                    $"page={page}",
                    $"per_page={pageSize}"
                };

                if (!string.IsNullOrWhiteSpace(search))
                {
                    queryParams.Add($"search={Uri.EscapeDataString(search)}");
                }

                if (!string.IsNullOrWhiteSpace(tier))
                {
                    queryParams.Add($"tier={Uri.EscapeDataString(tier)}");
                }

                var queryString = string.Join("&", queryParams);
                var fullEndpoint = $"{endpoint}?{queryString}";
                var fullUrl = _eberSettings.NEXT_EBER_API_URL + fullEndpoint;

                _logger.LogInformation("🌐 Calling EBER API: {Url}", fullUrl);

                var request = new HttpRequestMessage(HttpMethod.Get, fullUrl);
                AddAuthHeaders(request, HttpMethod.Get, fullEndpoint, timestamp);

                var response = await _httpClient.SendAsync(request);

                _logger.LogInformation("📥 EBER API Response - Status: {StatusCode}", response.StatusCode);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError("❌ EBER API Error Response: {Content}", errorContent);
                    throw new HttpRequestException($"EBER API returned {response.StatusCode}: {errorContent}");
                }

                var content = await response.Content.ReadAsStringAsync();
                _logger.LogInformation("📄 Response: {Content}", content.Substring(0, Math.Min(500, content.Length)));

                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                return JsonSerializer.Deserialize<EberCustomerListResponse>(content, options);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Exception in GetCustomersFromEberAsync");
                throw;
            }
        }

        public async Task<EberCustomerResponse> GetCustomerInfoFromEberAsync(string membershipId)
        {
            var endpoint = $"/members/{membershipId}";
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();

            var fullUrl = _eberSettings.NEXT_EBER_API_URL + endpoint;

            var request = new HttpRequestMessage(HttpMethod.Get, fullUrl);
            AddAuthHeaders(request, HttpMethod.Get, endpoint, timestamp);

            var response = await _httpClient.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

            return JsonSerializer.Deserialize<EberCustomerResponse>(content, options);
        }

        private async Task<EberPointsResponse> GetCustomerPointsFromEberAsync(string membershipId)
        {
            var endpoint = $"/members/{membershipId}/points";
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();

            var fullUrl = _eberSettings.NEXT_EBER_API_URL + endpoint;

            var request = new HttpRequestMessage(HttpMethod.Get, fullUrl);
            AddAuthHeaders(request, HttpMethod.Get, endpoint, timestamp);

            var response = await _httpClient.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

            return JsonSerializer.Deserialize<EberPointsResponse>(content, options);
        }

        private async Task<PosCustomerResponse> GetPosCustomersAsync(string sessionid, string customerCode)
        {
            try
            {
                var searchPattern = string.IsNullOrWhiteSpace(customerCode)
                    ? "%"
                    : $"%{customerCode}%";

                var posApiUrl = $"{_getPOSURL}/GetCustomers";
                var queryParams = $"?sessionid={Uri.EscapeDataString(sessionid)}&customername={Uri.EscapeDataString(searchPattern)}";

                var fullUrl = posApiUrl + queryParams;

                _logger.LogInformation("📡 Calling POS API: {Url}", fullUrl);

                var response = await _httpClient.GetAsync(fullUrl);

                _logger.LogInformation("📥 POS API Response Status: {StatusCode}", response.StatusCode);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogWarning("⚠️ POS API Error - Status: {StatusCode}, Content: {Content}",
                        response.StatusCode, errorContent);
                    return null;
                }

                var content = await response.Content.ReadAsStringAsync();
                _logger.LogInformation("📄 POS API Response Length: {Length}", content.Length);
                _logger.LogDebug("📄 POS API Response: {Content}", content.Substring(0, Math.Min(500, content.Length)));

                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var posResponse = JsonSerializer.Deserialize<PosCustomerResponse>(content, options);

                _logger.LogInformation("✅ Deserialized POS Response - Message: {Message}, DataCount: {Count}",
                    posResponse?.Message, posResponse?.Data?.Count ?? 0);

                return posResponse;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error calling POS API - Message: {Message}", ex.Message);
                return null;
            }
        }

        private async Task<object> GetPosCustomerInfoAsync(string customerCode)
        {
            try
            {
                var searchPattern = string.IsNullOrWhiteSpace(customerCode)
                    ? "%"
                    : $"%{customerCode}%";

                var posApiUrl = $"{_outletSettings.NEXT_ONLINE_API_URL}/GetCustomers";
                var queryParams = $"?customername={Uri.EscapeDataString(searchPattern)}";

                var fullUrl = posApiUrl + queryParams;

                _logger.LogInformation("📡 Calling POS API: {Url}", fullUrl);

                var response = await _httpClient.GetAsync(fullUrl);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("⚠️ POS API returned status: {StatusCode}", response.StatusCode);
                    return null;
                }

                var content = await response.Content.ReadAsStringAsync();
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var posResponse = JsonSerializer.Deserialize<PosCustomerResponse>(content, options);

                if (posResponse?.Message == "SUCCESS" &&
                    posResponse.Data != null &&
                    posResponse.Data.Count > 0 &&
                    posResponse.Data[0].Output != null &&
                    posResponse.Data[0].Output.Count > 0)
                {
                    return posResponse.Data[0].Output[0];
                }

                _logger.LogWarning("⚠️ No customer found in POS with code: {CustomerCode}", customerCode);
                return null;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error calling POS API for customer: {CustomerCode}", customerCode);
                return null;
            }
        }

        private string ToCamelCase(string str)
        {
            if (string.IsNullOrEmpty(str) || char.IsLower(str[0]))
                return str;

            return char.ToLower(str[0]) + str.Substring(1);
        }

        private async Task<bool> ValidateMemberAsync(string membershipId)
        {
            try
            {
                var customer = await GetCustomerInfoFromEberAsync(membershipId);
                return customer != null && !string.IsNullOrEmpty(customer.Id);
            }
            catch
            {
                return false;
            }
        }

        private void AddAuthHeaders(HttpRequestMessage request, HttpMethod method, string endpoint, string timestamp)
        {
            var signature = GenerateHmacSignature(method.Method, endpoint, timestamp);

            request.Headers.Add("X-EBER-USERNAME", _eberSettings.NEXT_EBER_USERNAME);
            request.Headers.Add("X-EBER-TIMESTAMP", timestamp);
            request.Headers.Add("X-EBER-SIGNATURE", signature);
        }

        private string GenerateHmacSignature(string method, string endpoint, string timestamp)
        {
            var message = $"{method.ToUpper()}|{endpoint}|{timestamp}";

            using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_eberSettings.NEXT_EBER_HMAC_SECRET_KEY)))
            {
                var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(message));
                return Convert.ToBase64String(hash);
            }
        }


        /// <summary>
        /// Redeem EBER voucher
        /// POST: api/eber/integration/redeem
        /// </summary>
        [HttpPost("eber/integration/redeem")]
        public async Task<IActionResult> RedeemEberVoucher([FromBody] EberIntegrationRequest request)
        {
            try
            {
                if (request?.EberPayload == null)
                {
                    _logger.LogWarning("⚠️ Missing eberpayload in request");
                    return BadRequest(new { success = false, error = "eberpayload is required" });
                }

                // Get session ID
                if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
                {
                    sessionId = await POSSessionID();
                    if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                        return BadRequest(new { success = false, error = sessionId });
                }


                // Get store name from cache
                var storeName = _memoryCache.Get<string>("STORE_NAME");

                if (string.IsNullOrEmpty(storeName))
                {
                    _logger.LogWarning("⚠️ Store name not found in cache");
                    return BadRequest(new { success = false, error = "Store name not initialized. Please initialize store first." });
                }

                // Add custom_store_id to payload
                var payload = new Dictionary<string, object>(request.EberPayload);

                if (!payload.ContainsKey("custom_store_id"))
                {
                    payload["custom_store_id"] = storeName;
                }

                var transactionNo = payload.ContainsKey("transaction_no") ? payload["transaction_no"]?.ToString() : null;

                _logger.LogInformation("🎫 Redeeming EBER voucher - Transaction: {TransactionNo}, Store: {StoreName}",
                    transactionNo, storeName);

                // Prepare request to POS EBER API
                var posApiUrl = $"{_eberSettings.NEXT_POS_EBER_API_URL}/eber/integration/redeem/01";
                var fullUrl = $"{posApiUrl}?sessionid={sessionId}";

                var innerData = new
                {
                    eberpayload = payload,
                    api_url = _eberSettings.NEXT_EBER_API_URL,
                    eberUserId = _eberSettings.NEXT_EBER_USERNAME,
                    eberPassword = _eberSettings.NEXT_EBER_PASSWORD ?? ""
                };

                var innerDataJson = JsonSerializer.Serialize(innerData, new JsonSerializerOptions
                {
                    WriteIndented = false
                });

                var formData = new FormUrlEncodedContent(new[]
                {
                    new KeyValuePair<string, string>("jsondata", innerDataJson)
                });

                _logger.LogInformation("📡 Calling POS EBER redeem endpoint: {Url}", fullUrl);

                var response = await _httpClient.PostAsync(fullUrl, formData);
                var content = await response.Content.ReadAsStringAsync();

                _logger.LogInformation("📥 Status: {Status}, Response: {Content}",
                    response.StatusCode, content.Substring(0, Math.Min(500, content.Length)));

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError("❌ Failed to redeem voucher: {StatusCode}", response.StatusCode);
                    return StatusCode((int)response.StatusCode, new
                    {
                        success = false,
                        error = "Failed to redeem voucher",
                        details = content
                    });
                }

                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var result = JsonSerializer.Deserialize<JsonElement>(content, options);

                _logger.LogInformation("✅ Voucher redeemed successfully");

                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error redeeming EBER voucher");
                return StatusCode(500, new
                {
                    success = false,
                    error = "Failed to redeem voucher",
                    details = ex.Message
                });
            }
        }

        /// <summary>
        /// Void EBER voucher transaction
        /// POST: api/eber/integration/used_issued_reward/void
        /// </summary>
        [HttpPost("eber/integration/used_issued_reward/void")]
        public async Task<IActionResult> VoidEberVoucherTransaction([FromBody] EberIntegrationRequest request)
        {
            try
            {
                if (request?.EberPayload == null)
                {
                    _logger.LogWarning("⚠️ Missing eberpayload in request");
                    return BadRequest(new { success = false, error = "eberpayload is required" });
                }

                // Get session ID
                if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
                {
                    sessionId = await POSSessionID();
                    if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                        return BadRequest(new { success = false, error = sessionId });
                }

                var transactionNo = request.EberPayload.ContainsKey("transaction_no")
                    ? request.EberPayload["transaction_no"]?.ToString()
                    : null;

                _logger.LogInformation("🔄 Voiding EBER voucher transaction - Transaction: {TransactionNo}", transactionNo);

                // Prepare request to POS EBER API
                var posApiUrl = $"{_eberSettings.NEXT_POS_EBER_API_URL}/eber/integration/used_issued_reward/void/01";
                var fullUrl = $"{posApiUrl}?sessionid={sessionId}";

                var innerData = new
                {
                    eberpayload = request.EberPayload,
                    api_url = _eberSettings.NEXT_EBER_API_URL,
                    eberUserId = _eberSettings.NEXT_EBER_USERNAME,
                    eberPassword = _eberSettings.NEXT_EBER_PASSWORD ?? ""
                };

                var innerDataJson = JsonSerializer.Serialize(innerData, new JsonSerializerOptions
                {
                    WriteIndented = false
                });

                var formData = new FormUrlEncodedContent(new[]
                {
                    new KeyValuePair<string, string>("jsondata", innerDataJson)
                });

                _logger.LogInformation("📡 Calling POS EBER void endpoint: {Url}", fullUrl);

                var response = await _httpClient.PostAsync(fullUrl, formData);
                var content = await response.Content.ReadAsStringAsync();

                _logger.LogInformation("📥 Status: {Status}, Response: {Content}",
                    response.StatusCode, content.Substring(0, Math.Min(500, content.Length)));

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError("❌ Failed to void voucher transaction: {StatusCode}", response.StatusCode);
                    return StatusCode((int)response.StatusCode, new
                    {
                        success = false,
                        error = "Failed to void voucher transaction",
                        details = content
                    });
                }

                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var result = JsonSerializer.Deserialize<JsonElement>(content, options);

                _logger.LogInformation("✅ Voucher transaction voided successfully");

                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error voiding EBER voucher transaction");
                return StatusCode(500, new
                {
                    success = false,
                    error = "Failed to void voucher transaction",
                    details = ex.Message
                });
            }
        }

       

        /// <summary>
        /// Issue EBER points
        /// POST: api/eber/integration/issue_point
        /// </summary>
        [HttpPost("eber/integration/issue_point")]
        public async Task<IActionResult> IssueEberPoints([FromBody] EberIntegrationRequest request)
        {
            try
            {
                if (request?.EberPayload == null)
                {
                    _logger.LogWarning("⚠️ Missing eberpayload in request");
                    return BadRequest(new { success = false, error = "eberpayload is required" });
                }

                // Get session ID
                if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
                {
                    sessionId = await POSSessionID();
                    if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                        return BadRequest(new { success = false, error = sessionId });
                }

                var transactionNo = request.EberPayload.ContainsKey("transaction_no")
                    ? request.EberPayload["transaction_no"]?.ToString()
                    : null;

                _logger.LogInformation("💰 Issuing EBER points - Transaction: {TransactionNo}", transactionNo);

                // Prepare request to POS EBER API
                var posApiUrl = $"{_eberSettings.NEXT_POS_EBER_API_URL}/eber/integration/issue_point/01";
                var fullUrl = $"{posApiUrl}?sessionid={sessionId}";

                var innerData = new
                {
                    eberpayload = request.EberPayload,
                    api_url = _eberSettings.NEXT_EBER_API_URL,
                    eberUserId = _eberSettings.NEXT_EBER_USERNAME,
                    eberPassword = _eberSettings.NEXT_EBER_PASSWORD ?? ""
                };

                var innerDataJson = JsonSerializer.Serialize(innerData, new JsonSerializerOptions
                {
                    WriteIndented = false
                });

                var formData = new FormUrlEncodedContent(new[]
                {
            new KeyValuePair<string, string>("jsondata", innerDataJson)
        });

                _logger.LogInformation("📡 Calling POS EBER issue_point endpoint: {Url}", fullUrl);

                var response = await _httpClient.PostAsync(fullUrl, formData);
                var content = await response.Content.ReadAsStringAsync();

                _logger.LogInformation("📥 Status: {Status}, Response: {Content}",
                    response.StatusCode, content.Substring(0, Math.Min(500, content.Length)));

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError("❌ Failed to issue points: {StatusCode}", response.StatusCode);
                    return StatusCode((int)response.StatusCode, new
                    {
                        success = false,
                        error = "Failed to issue points",
                        details = content
                    });
                }

                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var result = JsonSerializer.Deserialize<JsonElement>(content, options);

                _logger.LogInformation("✅ Points issued successfully");

                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error issuing EBER points");
                return StatusCode(500, new
                {
                    success = false,
                    error = "Failed to issue points",
                    details = ex.Message
                });
            }
        }

        private async Task<EberCustomerResponse?> FetchMemberByPhoneAsync(string phoneNumber)
        {
            var result = await EberUserShow(phoneNumber);

            if (result is OkObjectResult ok)
            {
                var json = JsonSerializer.Serialize(ok.Value);
                var parsed = JsonSerializer.Deserialize<JsonElement>(json);

                if (parsed.TryGetProperty("member", out var memberElement))
                {
                    return memberElement.Deserialize<EberCustomerResponse>(
                        new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true
                        });
                }
            }

            return null;
        }


        // Optional: Add helper method to your SokCRM controller to get store name from cache
        private string GetStoreNameFromCache()
        {
            return _memoryCache.Get<string>("STORE_NAME");
        }
    }
}