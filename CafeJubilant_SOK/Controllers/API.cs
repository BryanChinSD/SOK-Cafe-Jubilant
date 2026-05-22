using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Net;
using System.Net.Mail;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using System.Globalization;
using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using System.Net.Http;
using System.Security.Cryptography.X509Certificates;
using CafeJubilant_SOK.Models;

[Route("api/[action]")]
[ApiController]

//[Route("SR")] // Set fixed route prefix
public class KIOSKController : Controller
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<KIOSKController> _logger;
    private readonly IConfiguration _configuration;
    private readonly string _getPOSURL;
    private readonly string _getImgURL;
    private string _storeName;
    private readonly IMemoryCache _memoryCache;
    private readonly HttpClient _httpClient; // Create this inside the constructor
    private static readonly TimeSpan SessionExpiration = TimeSpan.FromMinutes(30);
    private readonly string _posOrderLogBaseFolder;

    public KIOSKController(
       IHttpClientFactory httpClientFactory,
       ILogger<KIOSKController> logger,
       IConfiguration configuration,
       IMemoryCache memoryCache,
       IWebHostEnvironment env)
    {
        _httpClientFactory = httpClientFactory ?? throw new ArgumentNullException(nameof(httpClientFactory));
        _httpClient = _httpClientFactory.CreateClient(); // Create actual client instance
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _getPOSURL = _configuration["Outlet:NEXT_ONLINE_API_URL"];
        _getImgURL = _configuration["Outlet:IMAGE_API_URL"];
        //_storeName = _configuration["Outlet:storeName"];
        _memoryCache = memoryCache ?? throw new ArgumentNullException(nameof(memoryCache));
        _posOrderLogBaseFolder = Path.Combine(env.ContentRootPath, "PosOrderLogs");

    }
    string formattedDate = DateTime.Today.ToString("yyyy-MM-dd");
    string dayName = DateTime.Today.ToString("dddd");
    string registerName = "POS01";

    public class TranslationRequest
    {
        public string LanguageName { get; set; }
    }

    [HttpGet]
    public async Task<IActionResult> GetImageProxy(string imageUrl)
    {
        try
        {
            if (string.IsNullOrEmpty(imageUrl))
            {
                _logger.LogWarning("GetImageProxy called with empty imageUrl");
                return BadRequest("Missing imageUrl parameter");
            }

            // Decode and clean
            imageUrl = Uri.UnescapeDataString(imageUrl).TrimStart('/');

            // ✅ Log the configuration values
            _logger.LogInformation("📋 Configuration Check:");
            _logger.LogInformation("   _getImgURL: {GetImgURL}", _getImgURL);
            _logger.LogInformation("   imageUrl param: {ImageUrl}", imageUrl);

            // Construct full URL
            string baseUrl = _getImgURL?.TrimEnd('/') ?? string.Empty;
            string fullImageUrl = $"{baseUrl}/{imageUrl}";

            _logger.LogInformation("🔗 Full URL constructed: {FullUrl}", fullImageUrl);

            // Make the request
            var response = await _httpClient.GetAsync(fullImageUrl);

            _logger.LogInformation("📊 HTTP Response Status: {StatusCode}", response.StatusCode);

            if (response.IsSuccessStatusCode)
            {
                var contentType = response.Content.Headers.ContentType?.ToString() ?? "image/jpeg";
                var imageBytes = await response.Content.ReadAsByteArrayAsync();

                Response.Headers.CacheControl = "public, max-age=86400";
                Response.Headers.Append("Access-Control-Allow-Origin", "*");

                _logger.LogInformation("✅ Image served successfully: {ImageUrl} ({Bytes} bytes)",
                    imageUrl, imageBytes.Length);
                return File(imageBytes, contentType);
            }

            _logger.LogWarning("❌ Image not found: {FullUrl} - Status: {StatusCode}",
                fullImageUrl, response.StatusCode);

            return NotFound(new
            {
                error = "Image not found",
                requestedPath = imageUrl,
                fullUrl = fullImageUrl,
                status = response.StatusCode.ToString(),
                configuredBaseUrl = _getImgURL
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "💥 Error in GetImageProxy for: {ImageUrl}", imageUrl);
            return StatusCode(500, new
            {
                error = "Internal server error",
                message = ex.Message,
                configuredBaseUrl = _getImgURL
            });
        }
    }
    private async Task<string> getStore(string storeName)
    {
        try
        {
            // Normalize store name to lowercase for consistency
            _storeName = storeName?.ToLower();
            _memoryCache.Set("STORE_NAME", _storeName);

            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                    return sessionId;
            }

            string url = $"{_getPOSURL}/GetStore/01?sessionid={sessionId}&storename={_storeName}";
            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
            return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An exception occurred while fetching store data.");
            return $"Exception: {ex.Message}";
        }
    }
    public string GetStoreNameFromCache()
    {
        return _memoryCache.Get<string>("STORE_NAME");
    }

    public async Task<IActionResult> GetStore([FromQuery] string storename)
    {
        if (string.IsNullOrWhiteSpace(storename))
            return BadRequest(new { error = "Store name is required" });

        // Log the received store name for debugging
        _logger.LogInformation("Received store name: {StoreName}", storename);

        var result = await getStore(storename);

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        return Content(result, "application/json");
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

    private async Task<string> getPOSFullItemMenu()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId;
                }
            }
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Store name not set";
            }
            string url = $"{_getPOSURL}/GetPosFullItemList/01?sessionid={sessionId}&storename={storeName}&deviceType=T&dayname={dayName}&logindate={formattedDate}";
            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);
            _logger.LogWarning("Error: {_storeName} - {_storeName}", storeName, storeName);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            else
            {
                _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An exception occurred while fetching store data.");
            return $"Exception: {ex.Message}";
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetPosFullItemList()
    {
        var result = await getPOSFullItemMenu();

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        // Just return raw JSON string content as is
        return Content(result, "application/json");
    }

    private async Task<string> GetAddonDtls()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();

                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId;
                }
            }
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Store name not set";
            }

            string url = $"{_getPOSURL}/GetStoreAddonDtls/01?sessionid={sessionId}&storename={storeName}";

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            else
            {
                _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An exception occurred while fetching store data.");
            return $"Exception: {ex.Message}";
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetStoreAddonDtls()
    {
        var result = await GetAddonDtls();

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        // Just return raw JSON string content as is
        return Content(result, "application/json");
    }

    private async Task<string> getPOSMenu()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();

                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId;
                }
            }
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Store name not set";
            }

            string url = $"{_getPOSURL}/GetPOSMenuButton/01?sessionid={sessionId}&storename={storeName}&deviceType=T&dayname={dayName}&logindate={formattedDate}";

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            else
            {
                _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An exception occurred while fetching store data.");
            return $"Exception: {ex.Message}";
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetPOSMenuButton()
    {
        var result = await getPOSMenu();

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        // Just return raw JSON string content as is
        return Content(result, "application/json");
    }
    private async Task<string> getRemarksbyType(string groupType = "%")
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                    return sessionId;
            }

            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
                return "Error: Store name not set";

            // Match the date formats from the sample URL
            string loginDate = DateTime.Today.ToString("yyyyMMdd");
            string currentDateTime = DateTime.Now.ToString("yyyy/MM/dd HH:mm:ss");
            var shiftCode = _memoryCache.Get<string>("SHIFT_CODE") ?? "SHIFT1";

            // URL-encode parameters that may contain spaces or special characters
            string encodedStoreName = Uri.EscapeDataString(storeName);
            string encodedGroupType = Uri.EscapeDataString(groupType);
            string encodedCurrentDate = Uri.EscapeDataString(currentDateTime);
            string encodedUserId = Uri.EscapeDataString("SD POS");

            string url = $"{_getPOSURL}/GetPosRemarksByType/01" +
                         $"?sessionid={sessionId}" +
                         $"&comp_code=01" +
                         $"&store_name={encodedStoreName}" +
                         $"&storename={encodedStoreName}" +
                         $"&register_name={registerName}" +
                         $"&registername={registerName}" +
                         $"&shift_code={Uri.EscapeDataString(shiftCode)}" +
                         $"&shiftcode={Uri.EscapeDataString(shiftCode)}" +
                         $"&logindate={loginDate}" +
                         $"&grouptype={encodedGroupType}" +
                         $"&c_userid={encodedUserId}" +
                         $"&c_date={encodedCurrentDate}" +
                         $"&m_userid={encodedUserId}" +
                         $"&m_date={encodedCurrentDate}";

            _logger.LogInformation("Fetching remarks by type. URL: {Url}", url);

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            _logger.LogWarning("GetPosRemarksByType error: {StatusCode} - {ReasonPhrase}",
                response.StatusCode, response.ReasonPhrase);
            return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception in getRemarksbyType.");
            return $"Exception: {ex.Message}";
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetRemarksByType([FromQuery] string grouptype = "%")
    {
        var result = await getRemarksbyType(grouptype);

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        return Content(result, "application/json");
    }


    private async Task<string> getRemarks()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                // If not found in cache, fetch and cache again
                sessionId = await POSSessionID();

                // You might want to check if sessionId is valid before proceeding
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId; // propagate error
                }
            }
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Store name not set";
            }
            string url = $"{_getPOSURL}/GetPosRemarksBygrpitem/01?sessionid={sessionId}&store={storeName}&itemname=%";
            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            else
            {
                _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An exception occurred while fetching store data.");
            return $"Exception: {ex.Message}";
        }
    }



    [HttpGet]
    public async Task<IActionResult> getItemRemarks()
    {
        var result = await getRemarks();

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        // Just return raw JSON string content as is
        return Content(result, "application/json");
    }

    private async Task<string> getCheckStock()
    {
        try
        {
            // ✅ Get session ID from cache or fetch
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID().ConfigureAwait(false);

                if (string.IsNullOrWhiteSpace(sessionId) ||
                    sessionId.StartsWith("Error") ||
                    sessionId.StartsWith("Exception"))
                {
                    _logger.LogWarning("Failed to get POS session ID: {SessionId}", sessionId);
                    return sessionId ?? "Error: Invalid session";
                }
            }

            // ✅ Get store name
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                _logger.LogWarning("Store name is not set in memory cache or _storeName.");
                return "Error: Store name not set";
            }

            // ✅ Build API URL
            string url = $"{_getPOSURL}/ExternalGetStroreStockList/01" +
                         $"?sessionid={sessionId}" +
                         $"&storename={storeName}" +
                         $"&dayname={dayName}" +
                         $"&logindate={formattedDate}" +
                         $"&apikey=Basic a3JlbW90ZTprcmVtb3RlMTMy";

            _logger.LogInformation("Calling POS stock API: {Url}", url);

            // ✅ Call API
            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                _logger.LogInformation("POS stock API response length: {Length}", content.Length);
                return content;
            }
            else
            {
                _logger.LogWarning(
                    "POS stock API returned failure. StatusCode: {StatusCode}, Reason: {ReasonPhrase}",
                    response.StatusCode,
                    response.ReasonPhrase
                );
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception occurred while fetching store stock data.");
            return $"Exception: {ex.Message}";
        }
    }
    private async Task<string> getCheckPOSMenuStock()
    {
        try
        {
            // ✅ Get session ID from cache or fetch
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID().ConfigureAwait(false);

                if (string.IsNullOrWhiteSpace(sessionId) ||
                    sessionId.StartsWith("Error") ||
                    sessionId.StartsWith("Exception"))
                {
                    _logger.LogWarning("Failed to get POS session ID: {SessionId}", sessionId);
                    return sessionId ?? "Error: Invalid session";
                }
            }

            // ✅ Get store name
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                _logger.LogWarning("Store name is not set in memory cache or _storeName.");
                return "Error: Store name not set";
            }

            // ✅ Build API URL
            string url = $"{_getPOSURL}/GetPosStroreStockList/01" +
                         $"?sessionid={sessionId}" +
                         $"&storename={storeName}" +
                         $"&dayname={dayName}" +
                         $"&logindate={formattedDate}";

            _logger.LogInformation("Calling POS Menu stock API: {Url}", url);

            // ✅ Call API
            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                _logger.LogInformation("POS Menu stock API response length: {Length}", content.Length);
                return content;
            }
            else
            {
                _logger.LogWarning(
                    "POS Menu stock API returned failure. StatusCode: {StatusCode}, Reason: {ReasonPhrase}",
                    response.StatusCode,
                    response.ReasonPhrase
                );
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception occurred while fetching store stock data.");
            return $"Exception: {ex.Message}";
        }
    }

    [HttpGet]
    public async Task<IActionResult> checkStocks()
    {
        var result = await getCheckStock().ConfigureAwait(false);

        if (string.IsNullOrWhiteSpace(result))
        {
            _logger.LogWarning("getCheckStock returned empty result.");
            return StatusCode(500, new { error = "Empty result from POS" });
        }

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
        {
            _logger.LogWarning("getCheckStock returned error: {Result}", result);
            return StatusCode(500, new { error = result });
        }

        // ✅ Return raw JSON as-is
        return Content(result, "application/json");
    }

    [HttpGet]
    public async Task<IActionResult> checkPOSMenuStocks()
    {
        var result = await getCheckPOSMenuStock().ConfigureAwait(false);

        if (string.IsNullOrWhiteSpace(result))
        {
            _logger.LogWarning("getCheckPOSMenuStock returned empty result.");
            return StatusCode(500, new { error = "Empty result from POS" });
        }

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
        {
            _logger.LogWarning("getCheckPOSMenuStock returned error: {Result}", result);
            return StatusCode(500, new { error = result });
        }

        // ✅ Return raw JSON as-is
        return Content(result, "application/json");
    }


    private async Task<string> getServiceCharge()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                // If not found in cache, fetch and cache again
                sessionId = await POSSessionID();

                // You might want to check if sessionId is valid before proceeding
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId; // propagate error
                }
            }
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Store name not set";
            }
            string url = $"{_getPOSURL}/GetPosServiceChargelist/01?sessionid={sessionId}&storename={storeName}";
            //string url = $"{_getPOSURL}/GetPosServiceChargelist/01?sessionid={sessionId}&store={storeName}";
            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            else
            {
                _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An exception occurred while fetching store data.");
            return $"Exception: {ex.Message}";
        }
    }

    private async Task<string> getServiceLanguages()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                // If not found in cache, fetch and cache again
                sessionId = await POSSessionID();

                // You might want to check if sessionId is valid before proceeding
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId; // propagate error
                }
            }
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Store name not set";
            }
            string url = $"{_getPOSURL}/GetsyslanguageList/01?sessionid={sessionId}&store_name={storeName}&language_name=%";
            //string url = $"{_getPOSURL}/GetPosServiceChargelist/01?sessionid={sessionId}&store={storeName}";
            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            else
            {
                _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An exception occurred while fetching store data.");
            return $"Exception: {ex.Message}";
        }
    }

    [HttpGet]
    public async Task<IActionResult> getPromos()
    {
        var result = await getPromosAsync();

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        // Just return raw JSON string content as is
        return Content(result, "application/json");
    }

    private async Task<string> getPromosAsync()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                // If not found in cache, fetch and cache again
                sessionId = await POSSessionID();

                // You might want to check if sessionId is valid before proceeding
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId; // propagate error
                }
            }
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Promotion List not set";
            }
            string url = $"{_getPOSURL}/GetPosPromolist/01?sessionid={sessionId}&store={storeName}";
            //string url = $"{_getPOSURL}/GetPosServiceChargelist/01?sessionid={sessionId}&store={storeName}";
            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            else
            {
                _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An exception occurred while fetching store data.");
            return $"Exception: {ex.Message}";
        }
    }


    [HttpGet]
    public async Task<IActionResult> getSystemSettting()
    {
        var result = await getSystemConfiguration();

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        // Just return raw JSON string content as is
        return Content(result, "application/json");
    }

    private async Task<string> getSystemConfiguration()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                // If not found in cache, fetch and cache again
                sessionId = await POSSessionID();

                // You might want to check if sessionId is valid before proceeding
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId; // propagate error
                }
            }
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Promotion List not set";
            }
            string url = $"{_getPOSURL}/GetSystemSetting/01?sessionid={sessionId}";
            //string url = $"{_getPOSURL}/GetPosServiceChargelist/01?sessionid={sessionId}&store={storeName}";
            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            else
            {
                _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An exception occurred while fetching store data.");
            return $"Exception: {ex.Message}";
        }
    }

    [HttpGet]
    public async Task<IActionResult> getSvcs()
    {
        var result = await getServiceCharge();

        if (string.IsNullOrWhiteSpace(result))
            return Ok(new { data = new List<object>() });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        try
        {
            dynamic parsed = JsonConvert.DeserializeObject(result);

            var services = new List<object>();

            if (parsed?.data != null && parsed.data.Count > 0)
            {
                var output = parsed.data[0]?.output;

                if (output != null)
                {
                    foreach (var item in output)
                    {
                        services.Add(new
                        {
                            service_name = (string)item.service_name,
                            service_value = (decimal)item.service_value,
                            service_type = (string)item.service_type,
                            service_by = (string)item.service_by
                        });
                    }
                }
            }

            return Ok(new { data = services });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to parse service charges response");
            return StatusCode(500, new { error = ex.Message });
        }
    }


    [HttpGet]
    public async Task<IActionResult> getLangs()
    {
        var result = await getServiceLanguages();

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        // Just return raw JSON string content as is
        return Content(result, "application/json");
    }

    private async Task<string> GetMenuCategoryItemTranslationsAsync(string languageName = null)
    {
        try
        {
            // ✅ Session ID
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                // If not found in cache, fetch and cache again
                sessionId = await POSSessionID();

                // You might want to check if sessionId is valid before proceeding
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId; // propagate error
                }
            }

            // ✅ Store name
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Store name not set";
            }


            // ✅ API call
            var url = $"{_getPOSURL}/etqr/Getitemvslanguagemap/01?sessionid={sessionId}&storename={storeName}&language_name={languageName}";
            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            else
            {
                _logger.LogWarning("Error: {StatusCode} - {ReasonPhrase}", response.StatusCode, response.ReasonPhrase);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception in GetMenuCategoryItemTranslationsAsync");
            return $"Exception: {ex.Message}";
        }
    }



    [HttpGet]
    public async Task<IActionResult> GetMenuCategoryItemTranslations([FromQuery] string languageName)
    {
        var result = await GetMenuCategoryItemTranslationsAsync(languageName);

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        // ✅ Return raw JSON string as-is
        return Content(result, "application/json");
    }


    [HttpGet("/api/payment-modes")]
    public async Task<IActionResult> GetPosPaymentModeDtls()
    {
        try
        {
            // ✅ Session ID
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return StatusCode(500, new { success = false, error = sessionId });
                }
            }

            // ✅ Store info from cache
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            var registerName = _memoryCache.Get<string>("REGISTER_NAME") ?? "POS01";
            var shiftCode = _memoryCache.Get<string>("SHIFT_CODE") ?? "SHIFT1";
            var compCode = _memoryCache.Get<string>("COMP_CODE") ?? "01";
            var loginDate = DateTime.Now.ToString("yyyyMMdd");
            var cDate = DateTime.Now.ToString("yyyy/MM/dd HH:mm:ss");

            if (string.IsNullOrWhiteSpace(storeName))
            {
                return StatusCode(500, new { success = false, error = "Store name not set" });
            }

            // ✅ Build URL matching GePosPaymentModeDtls endpoint
            var url = $"{_getPOSURL}/GePosPaymentModeDtls/{compCode}" +
                      $"?sessionid={Uri.EscapeDataString(sessionId)}" +
                      $"&comp_code={Uri.EscapeDataString(compCode)}" +
                      $"&store_name={Uri.EscapeDataString(storeName)}" +
                      $"&storename={Uri.EscapeDataString(storeName)}" +
                      $"&register_name={Uri.EscapeDataString(registerName)}" +
                      $"&registername={Uri.EscapeDataString(registerName)}" +
                      $"&shift_code={Uri.EscapeDataString(shiftCode)}" +
                      $"&shiftcode={Uri.EscapeDataString(shiftCode)}" +
                      $"&logindate={loginDate}" +
                      $"&c_userid=WEBORDER" +
                      $"&c_date={Uri.EscapeDataString(cDate)}" +
                      $"&m_userid=WEBORDER" +
                      $"&m_date={Uri.EscapeDataString(cDate)}";

            _logger.LogInformation("📡 Fetching payment modes: {Url}", url);

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

                _logger.LogInformation("✅ Payment modes fetched successfully");

                // ✅ Parse and return as JSON result
                var paymentModes = System.Text.Json.JsonSerializer.Deserialize<JsonElement>(content);

                return Ok(new
                {
                    success = true,
                    data = paymentModes,
                    timestamp = DateTime.UtcNow
                });
            }
            else
            {
                _logger.LogWarning("⚠️ Payment modes fetch failed: {StatusCode} - {Reason}",
                    response.StatusCode, response.ReasonPhrase);

                return StatusCode((int)response.StatusCode, new
                {
                    success = false,
                    error = $"{response.StatusCode} - {response.ReasonPhrase}"
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Exception in GetPosPaymentModeDtls");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    public class OrderRequest
    {
        public string jsondata { get; set; }
    }


    [HttpPost]
    public async Task<IActionResult> SendPostCartItem()
    {
        _logger.LogInformation("sendPostCartItem endpoint called");

        string jsondata;
        try
        {
            using var reader = new StreamReader(Request.Body, Encoding.UTF8);
            var rawBody = await reader.ReadToEndAsync();

            _logger.LogInformation("SendPostCartItem — raw body length: {Len}", rawBody.Length);

            if (rawBody.StartsWith("jsondata=", StringComparison.OrdinalIgnoreCase))
                jsondata = Uri.UnescapeDataString(rawBody["jsondata=".Length..].Replace("+", " "));
            else if (rawBody.TrimStart().StartsWith("[") || rawBody.TrimStart().StartsWith("{"))
                jsondata = rawBody;
            else
            {
                _logger.LogWarning("SendPostCartItem — unexpected body: {Preview}",
                    rawBody.Length > 100 ? rawBody[..100] : rawBody);
                return StatusCode(400, new { error = "Unexpected body format" });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "SendPostCartItem — failed to read body");
            return StatusCode(400, new { error = "Failed to read request body: " + ex.Message });
        }

        if (string.IsNullOrWhiteSpace(jsondata))
            return StatusCode(400, new { error = "No orders provided" });

        List<JObject> orders;
        try
        {
            orders = JsonConvert.DeserializeObject<List<JObject>>(jsondata);
        }
        catch (Exception ex)
        {
            return StatusCode(400, new { error = "Invalid JSON format in jsondata", details = ex.Message });
        }

        if (orders == null || orders.Count == 0)
            return StatusCode(400, new { error = "No orders provided" });

        // Extract action
        string action = orders[0]["action"]?.ToString() ?? "create";

        // Force print_flag = Y on all sales_dtls
        foreach (var order in orders)
        {
            var salesDtls = order["sales_dtls"] as JArray;
            if (salesDtls != null)
                foreach (JObject item in salesDtls)
                    item["print_flag"] = "Y";
        }

        // Post to POS
        var cartResult = await PostCartItem(action, orders.Cast<object>().ToList());

        if (string.IsNullOrWhiteSpace(cartResult) || cartResult.StartsWith("Error") || cartResult.StartsWith("Exception"))
        {
            _logger.LogError("PostCartItem failed: {Result}", cartResult);

            // ── Log the failure ──────────────────────────────────────────────
            LogPosOrder(null, "SendPostCartItem", "PostCartItem failed", orders, new { error = cartResult });

            return StatusCode(500, new { error = cartResult });
        }

        // Extract sales_no from POS response
        string salesNo = null;
        try
        {
            var posResponse = JObject.Parse(cartResult);
            salesNo = posResponse["data"]?[0]?["sales_no"]?.ToString();
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Could not parse salesNo from PostCartItem response: {Error}", ex.Message);
        }

        if (string.IsNullOrWhiteSpace(salesNo))
        {
            _logger.LogWarning("No sales_no returned from POS, skipping print data fetch");

            // ── Log the no-sales_no case ─────────────────────────────────────
            LogPosOrder(null, "SendPostCartItem", "No sales_no returned from POS", orders, cartResult);

            return Content(cartResult, "application/json");
        }

        _logger.LogInformation("Order created: {SalesNo} — fetching print data", salesNo);

        // Fetch kitchen print and receipt in parallel
        Task<string> kitchenTask = GetPosOrderKitchenPrint(salesNo);
        Task<string> receiptTask = GetOrderDtls(salesNo);
        await Task.WhenAll(kitchenTask, receiptTask);

        string kprintRaw = kitchenTask.Result;
        string receiptRaw = receiptTask.Result;

        JToken kprintJson = TryParseToken(kprintRaw) ?? new JArray();
        JToken receiptJson = TryParseToken(receiptRaw) ?? new JArray();

        // If APIs return a wrapper object, extract the data array
        if (kprintJson is JObject ko && ko["data"] != null) kprintJson = ko["data"];
        if (receiptJson is JObject ro && ro["data"] != null) receiptJson = ro["data"];

        _logger.LogInformation(
            "Print data fetched — Kitchen items: {KCount}, Receipt items: {RCount}",
            (kprintJson as JArray)?.Count ?? 0,
            (receiptJson as JArray)?.Count ?? 0);

        // Build enriched response
        JObject posResp;
        try { posResp = JObject.Parse(cartResult); }
        catch { posResp = new JObject(); }

        var enriched = new JObject
        {
            ["status"] = posResp["status"],
            ["message"] = posResp["message"],
            ["result"] = posResp["data"]?[0]?["result"],
            ["information"] = posResp["data"]?[0]?["information"],
            ["sales_no"] = salesNo,
            ["kprint_dtls"] = kprintJson,
            ["receipt_dtls"] = receiptJson,
            ["data"] = posResp["data"]
        };

        // ── Log the completed order ──────────────────────────────────────────
        LogPosOrder(salesNo, "SendPostCartItem", "Order completed", orders, enriched);

        _logger.LogInformation("sendPostCartItem completed. SalesNo: {SalesNo}", salesNo);
        return Content(enriched.ToString(Newtonsoft.Json.Formatting.None), "application/json");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  PosOrder flat-file logger
    // ─────────────────────────────────────────────────────────────────────────────

    private void LogPosOrder(string salesNo, string module, string info, object req, object res)
    {
        var now = DateTime.Now;

        _logger.LogInformation("🛒 {Module}: {Info} | SalesNo: {SalesNo}", module, info, salesNo ?? "-");

        try
        {
            // ✅ Use Newtonsoft — matches the JObject types passed in
            var reqJson = Newtonsoft.Json.JsonConvert.SerializeObject(req);
            var resJson = Newtonsoft.Json.JsonConvert.SerializeObject(res);

            var logFilePath = GetPosOrderDailyLogFilePath();

            var entry = new StringBuilder();
            entry.AppendLine("==========================================================");
            entry.AppendLine($"Timestamp : {now:yyyy-MM-dd HH:mm:ss} (Local) | {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");
            entry.AppendLine($"Module    : {module}");
            entry.AppendLine($"SalesNo   : {salesNo ?? "-"}");
            entry.AppendLine($"Info      : {info}");
            entry.AppendLine($"Request   : {reqJson}");
            entry.AppendLine($"Response  : {resJson}");
            entry.AppendLine("==========================================================");
            entry.AppendLine();

            System.IO.File.AppendAllText(logFilePath, entry.ToString(), Encoding.UTF8);

            _logger.LogDebug("📄 PosOrder log written → {Path}", logFilePath);
        }
        catch (Exception fileEx)
        {
            _logger.LogWarning(fileEx, "⚠️ Could not write to PosOrder log file in: {Folder}", _posOrderLogBaseFolder);
        }
    }

    /// <summary>
    /// Returns today's log file path, e.g. PosOrderLogs/2026-04-05.txt
    /// Creates the folder on first use.
    /// </summary>
    private string GetPosOrderDailyLogFilePath()
    {
        Directory.CreateDirectory(_posOrderLogBaseFolder);   // no-op if already exists
        var fileName = $"PostOrder_{DateTime.Now:yyyy-MM-dd}.txt";
        return Path.Combine(_posOrderLogBaseFolder, fileName);
    }

    private static JToken TryParseToken(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try { return JToken.Parse(raw); }
        catch { return null; }
    }

    [HttpPost]
    public async Task<IActionResult> GetOrderPrintDtls([FromBody] GetOrderPrintDtlsRequest req)
    {
        if (string.IsNullOrWhiteSpace(req?.SalesNo))
            return StatusCode(400, new { error = "sales_no is required" });

        _logger.LogInformation("GetOrderPrintDtls called for SalesNo: {SalesNo}", req.SalesNo);

        Task<string> kitchenTask = GetPosOrderKitchenPrint(req.SalesNo);
        Task<string> receiptTask = GetOrderDtls(req.SalesNo);
        await Task.WhenAll(kitchenTask, receiptTask);

        JToken kprintJson = TryParseToken(kitchenTask.Result) ?? new JArray();
        JToken receiptJson = TryParseToken(receiptTask.Result) ?? new JArray();

        if (kprintJson is JObject ko && ko["data"] != null) kprintJson = ko["data"];
        if (receiptJson is JObject ro && ro["data"] != null) receiptJson = ro["data"];

        _logger.LogInformation(
            "GetOrderPrintDtls — Kitchen items: {KCount}, Receipt items: {RCount}",
            (kprintJson as JArray)?.Count ?? 0,
            (receiptJson as JArray)?.Count ?? 0);

        var result = new JObject
        {
            ["sales_no"] = req.SalesNo,
            ["kprint_dtls"] = kprintJson,
            ["receipt_dtls"] = receiptJson,
        };

        return Content(result.ToString(Newtonsoft.Json.Formatting.None), "application/json");
    }

    public class GetOrderPrintDtlsRequest
    {
        public string SalesNo { get; set; }
    }



    private async Task<string> PostCartItem(string action, List<object> orders)
    {
        _logger.LogInformation("PostCartItem started with action: {Action}", action);

        try
        {
            // Get session ID
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                _logger.LogInformation("Session ID not found in cache, fetching new session ID");
                sessionId = await POSSessionID();

                if (string.IsNullOrWhiteSpace(sessionId) ||
                    sessionId.StartsWith("Error") ||
                    sessionId.StartsWith("Exception"))
                {
                    _logger.LogError("Failed to retrieve valid session ID: {SessionId}", sessionId ?? "null");
                    return sessionId ?? "Error: Failed to retrieve session ID";
                }

                _logger.LogInformation("Session ID retrieved successfully: {SessionId}", sessionId);
            }
            else
            {
                _logger.LogInformation("Session ID found in cache: {SessionId}", sessionId);
            }

            // Store name
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                _logger.LogError("Store name not set or empty");
                return "Error: Store name not set";
            }

            _logger.LogInformation("Store name: {StoreName}, Action: {Action}", storeName, action);

            // Step 1: Serialize the orders array to a JSON string
            var ordersJson = JsonConvert.SerializeObject(orders, new JsonSerializerSettings
            {
                NullValueHandling = NullValueHandling.Include,
                Formatting = Formatting.None
            });

            _logger.LogInformation("Orders JSON (inner): {OrdersJson}", ordersJson);

            // Step 2: Wrap it in the jsondata property structure
            var payload = new
            {
                jsondata = ordersJson  // This is a STRING, not an object
            };

            // Step 3: Serialize the wrapper to JSON
            var finalJson = JsonConvert.SerializeObject(payload);

            _logger.LogInformation("===== FINAL PAYLOAD START =====");
            _logger.LogInformation("{Payload}", finalJson);
            _logger.LogInformation("===== FINAL PAYLOAD END =====");
            _logger.LogInformation("Payload length: {Length} bytes", Encoding.UTF8.GetByteCount(finalJson));

            var content = new StringContent(finalJson, Encoding.UTF8, "application/json");

            // API call
            var url = $"{_getPOSURL}/PosOrder/{action}/01?sessionid={sessionId}";
            _logger.LogInformation("Posting order to URL: {Url}", url);

            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            var response = await _httpClient.PostAsync(url, content).ConfigureAwait(false);
            stopwatch.Stop();

            _logger.LogInformation("API response received after {ElapsedMs}ms. StatusCode: {StatusCode}",
                stopwatch.ElapsedMilliseconds,
                response.StatusCode);

            var responseContent = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("PostCartItem completed successfully. Response: {Response}",
                    responseContent);
                return responseContent;
            }
            else
            {
                _logger.LogWarning("PostCartItem failed: {StatusCode} - {ReasonPhrase}. Response: {ErrorContent}",
                    response.StatusCode, response.ReasonPhrase, responseContent);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "HTTP request exception in PostCartItem: {Message}", ex.Message);
            return $"Exception: Network error - {ex.Message}";
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogError(ex, "Request timeout in PostCartItem: {Message}", ex.Message);
            return $"Exception: Request timeout - {ex.Message}";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected exception in PostCartItem: {Message}", ex.Message);
            return $"Exception: {ex.Message}";
        }
    }


    [HttpGet]
    public async Task<IActionResult> GetCashReconStatus()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                    return StatusCode(500, new { error = sessionId });
            }

            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
                return StatusCode(500, new { error = "Store name not set" });

            var registerNameVal = _memoryCache.Get<string>("REGISTER_NAME") ?? registerName;
            var shiftCode = _memoryCache.Get<string>("SHIFT_CODE") ?? "SHIFT1";
            var userId = _memoryCache.Get<string>("POS_USER_ID") ?? "SD POS";
            var loginDate = DateTime.Now.ToString("yyyyMMdd");
            var cDate = Uri.EscapeDataString(DateTime.Now.ToString("yyyy/MM/dd HH:mm:ss"));

            var url = $"{_getPOSURL}/GetCashReconStatus/01" +
                      $"?sessionid={sessionId}" +
                      $"&comp_code=01" +
                      $"&store_name={Uri.EscapeDataString(storeName)}" +
                      $"&storename={Uri.EscapeDataString(storeName)}" +
                      $"&register_name={Uri.EscapeDataString(registerNameVal)}" +
                      $"&registername={Uri.EscapeDataString(registerNameVal)}" +
                      $"&shift_code={Uri.EscapeDataString(shiftCode)}" +
                      $"&shiftcode={Uri.EscapeDataString(shiftCode)}" +
                      $"&logindate={loginDate}" +
                      $"&c_userid={Uri.EscapeDataString(userId)}" +
                      $"&c_date={cDate}" +
                      $"&m_userid={Uri.EscapeDataString(userId)}" +
                      $"&m_date={cDate}";

            _logger.LogInformation("Calling GetCashReconStatus API: {Url}", url);

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                _logger.LogInformation("GetCashReconStatus succeeded");
                return Content(content, "application/json");
            }

            _logger.LogWarning("GetCashReconStatus failed: {StatusCode} - {ReasonPhrase}",
                response.StatusCode, response.ReasonPhrase);
            return StatusCode((int)response.StatusCode, new { error = $"{response.StatusCode} - {response.ReasonPhrase}" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception in GetCashReconStatus");
            return StatusCode(500, new { error = ex.Message });
        }
    }


    private async Task<string> GetPOSShiftting()
    {
        try
        {
            // ✅ Session ID
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId;
                }
            }

            // ✅ Store name
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Store name not set";
            }

            // ✅ Register name (add this)
            var registerName = _memoryCache.Get<string>("REGISTER_NAME")
                ?? Environment.GetEnvironmentVariable("REGISTER_NAME")
                ?? "KIOSK01";

            // ✅ Formatted date (add this)
            var formattedDate = DateTime.Now.ToString("yyyy-MM-dd");

            var url = $"{_getPOSURL}/GetShift/01?sessionid={sessionId}&storename={storeName}&registername={registerName}&logindate={formattedDate}";

            _logger.LogInformation("Calling GetShift API: {Url}", url);

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                _logger.LogInformation("GetShift API response received successfully");
                return content;
            }
            else
            {
                _logger.LogWarning("GetShift API error: {StatusCode} - {ReasonPhrase}",
                    response.StatusCode, response.ReasonPhrase);
                return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception in GetPOSShiftting");
            return $"Exception: {ex.Message}";
        }
    }


    private async Task<string> GetPOSPaymentModeAsync()
    {
        try
        {
            // ✅ Session ID
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                {
                    return sessionId;
                }
            }

            // ✅ Store name
            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
            {
                return "Error: Store name not set";
            }

            // ✅ Dates
            var loginDate = DateTime.Now.ToString("yyyyMMdd");
            var nowDateTime = DateTime.Now.ToString("yyyy/MM/dd HH:mm:ss");

            // ✅ Build URL (match Evolut API exactly)
            var url =
                $"{_getPOSURL}/GePosPaymentModeDtls/01" +
                $"?sessionid={Uri.EscapeDataString(sessionId)}" +
                $"&comp_code=01" +
                $"&store_name={Uri.EscapeDataString(storeName)}" +
                $"&storename={Uri.EscapeDataString(storeName)}" +
                $"&register_name={Uri.EscapeDataString(registerName)}" +
                $"&registername={Uri.EscapeDataString(registerName)}" +
                $"&shift_code={Uri.EscapeDataString(await GetPOSShiftting())}" +
                $"&shiftcode={Uri.EscapeDataString(await GetPOSShiftting())}" +
                $"&logindate={loginDate}" +
                $"&c_userid=SD%20POS" +
                $"&c_date={Uri.EscapeDataString(nowDateTime)}" +
                $"&m_userid=SD%20POS" +
                $"&m_date={Uri.EscapeDataString(nowDateTime)}";

            _logger.LogInformation("Calling POS Payment Mode API: {Url}", url);

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                _logger.LogInformation("POS Payment Mode API response received successfully");
                return content;
            }

            _logger.LogWarning(
                "POS Payment Mode API error: {StatusCode} - {ReasonPhrase}",
                response.StatusCode,
                response.ReasonPhrase
            );

            return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception in GetPOSPaymentModeAsync");
            return $"Exception: {ex.Message}";
        }
    }


    [HttpGet]
    public async Task<IActionResult> GetPosShift()
    {
        var result = await GetPOSShiftting();

        //if (string.IsNullOrWhiteSpace(result))
        //    return StatusCode(500, new { error = "Empty result from POS" });

        //if (result.StartsWith("Error") || result.StartsWith("Exception"))
        //    return StatusCode(500, new { error = result });

        // ✅ Return raw JSON string as-is
        return Content(result, "application/json");
    }


    private string GetDeviceSessionAsync()
    {
        try
        {
            // Generate unique device token
            string token = GenerateSecureToken();
            int tryCount = 0;

            // Set cookies with expiration
            var cookieOptions = new CookieOptions
            {
                HttpOnly = false, // Allow JavaScript to read it (frontend needs access)
                Secure = true, // HTTPS only
                SameSite = SameSiteMode.Strict,
                Expires = DateTimeOffset.UtcNow.Add(SessionExpiration)
            };

            Response.Cookies.Append("token", token, cookieOptions);
            Response.Cookies.Append("try-count", tryCount.ToString(), cookieOptions);

            _logger.LogInformation("Device session created: {Token}", token);

            // Return JSON response
            var response = new
            {
                success = true,
                message = "Device session created successfully",
                expiresIn = SessionExpiration.TotalMinutes
            };

            return System.Text.Json.JsonSerializer.Serialize(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception in GetDeviceSessionAsync");
            return $"Exception: {ex.Message}";
        }
    }

    [HttpGet]
    public IActionResult GetDeviceSession()
    {
        var result = GetDeviceSessionAsync();

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        // ✅ Return raw JSON string as-is
        return Content(result, "application/json");
    }

    // ── PrintConfig ────────────────────────────────────────────────────────────

    [HttpGet]
    public IActionResult GetPrintConfig()
    {
        try
        {
            var printConfig = _configuration
                .GetSection("PrintConfig")
                .Get<PrintConfig>();

            if (printConfig == null)
            {
                _logger.LogWarning("GetPrintConfig: PrintConfig section not found in configuration.");
                return NotFound(new { error = "PrintConfig not found in configuration." });
            }

            _logger.LogInformation("GetPrintConfig succeeded. IsDefault={IsDefault}", printConfig.IsDefault);

            return Ok(printConfig);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetPrintConfig failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetStoreRegisterSettings()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                    return StatusCode(500, new { error = sessionId });
            }

            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
                return StatusCode(500, new { error = "Store name not set" });

            var registerNameVal = _memoryCache.Get<string>("REGISTER_NAME") ?? registerName;
            var loginDate = DateTime.Now.ToString("yyyyMMdd");
            var cDate = Uri.EscapeDataString(DateTime.Now.ToString("yyyy/MM/dd HH:mm:ss"));

            var url = $"{_getPOSURL}/GetStoreRegisterPrinterSettingDtls/01" +
                      $"?sessionid={sessionId}" +
                      $"&comp_code=01" +
                      $"&store_name={Uri.EscapeDataString(storeName)}" +
                      $"&storename={Uri.EscapeDataString(storeName)}" +
                      $"&register_name={Uri.EscapeDataString(registerNameVal)}" +
                      $"&registername={Uri.EscapeDataString(registerNameVal)}" +
                      $"&logindate={loginDate}" +
                      $"&c_date={cDate}" +
                      $"&m_date={cDate}";

            _logger.LogInformation("Calling GetStoreRegisterSettings API: {Url}", url);

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                _logger.LogInformation("GetStoreRegisterSettings succeeded");
                return Content(content, "application/json");
            }

            _logger.LogWarning("GetStoreRegisterSettings failed: {StatusCode} - {ReasonPhrase}",
                response.StatusCode, response.ReasonPhrase);
            return StatusCode((int)response.StatusCode, new { error = $"{response.StatusCode} - {response.ReasonPhrase}" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception in GetStoreRegisterSettings");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetStoreRegisterPrinter()
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                    return StatusCode(500, new { error = sessionId });
            }

            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
                return StatusCode(500, new { error = "Store name not set" });

            var registerNameVal = _memoryCache.Get<string>("REGISTER_NAME") ?? registerName;
            var shiftCode = _memoryCache.Get<string>("SHIFT_CODE") ?? "SHIFT1";
            var userId = _memoryCache.Get<string>("USER_ID") ?? "SD POS";

            var now = DateTime.Now;
            var loginDate = now.ToString("yyyyMMdd");
            var dateTimeFormatted = Uri.EscapeDataString(now.ToString("yyyy/MM/dd HH:mm:ss"));

            var url = $"{_getPOSURL}/GetStoreRegisterSetting/01" +
                      $"?sessionid={sessionId}" +
                      $"&comp_code=01" +
                      $"&store_name={Uri.EscapeDataString(storeName)}" +
                      $"&storename={Uri.EscapeDataString(storeName)}" +
                      $"&register_name={Uri.EscapeDataString(registerNameVal)}" +
                      $"&registername={Uri.EscapeDataString(registerNameVal)}" +
                      $"&shift_code={shiftCode}" +
                      $"&shiftcode={shiftCode}" +
                      $"&logindate={loginDate}" +
                      $"&c_userid={Uri.EscapeDataString(userId)}" +
                      $"&c_date={dateTimeFormatted}" +
                      $"&m_userid={Uri.EscapeDataString(userId)}" +
                      $"&m_date={dateTimeFormatted}";

            _logger.LogInformation("Calling GetStoreRegisterPrinter API: {Url}", url);

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                _logger.LogInformation("GetStoreRegisterPrinter succeeded");
                return Content(content, "application/json");
            }

            _logger.LogWarning("GetStoreRegisterPrinter failed: {StatusCode} - {ReasonPhrase}",
                response.StatusCode, response.ReasonPhrase);

            return StatusCode((int)response.StatusCode,
                new { error = $"{response.StatusCode} - {response.ReasonPhrase}" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception in GetStoreRegisterPrinter");
            return StatusCode(500, new { error = ex.Message });
        }
    }



    private async Task<string> GetPosOrderKitchenPrint(string salesNo)
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                    return sessionId;
            }

            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
                return "Error: Store name not set";

            var registerNameVal = _memoryCache.Get<string>("REGISTER_NAME") ?? registerName;
            var shiftCode = _memoryCache.Get<string>("SHIFT_CODE") ?? "SHIFT1";
            var compCode = _memoryCache.Get<string>("COMP_CODE") ?? "01";

            var url = $"{_getPOSURL}/getPosOrderkitchenPrint/{compCode}" +
                      $"?sessionid={Uri.EscapeDataString(sessionId)}" +
                      $"&storename={Uri.EscapeDataString(storeName)}" +
                      $"&registername={Uri.EscapeDataString(registerNameVal)}" +
                      $"&shiftcode={Uri.EscapeDataString(shiftCode)}" +
                      $"&salesno={Uri.EscapeDataString(salesNo)}";

            _logger.LogInformation("Calling GetPosOrderKitchenPrint: {Url}", url);

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            _logger.LogWarning("GetPosOrderKitchenPrint error: {StatusCode} - {ReasonPhrase}",
                response.StatusCode, response.ReasonPhrase);
            return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception in GetPosOrderKitchenPrint");
            return $"Exception: {ex.Message}";
        }
    }

    private async Task<string> GetOrderDtls(string salesNo)
    {
        try
        {
            if (!_memoryCache.TryGetValue("POS_SESSION_ID", out string sessionId))
            {
                sessionId = await POSSessionID();
                if (sessionId.StartsWith("Error") || sessionId.StartsWith("Exception"))
                    return sessionId;
            }

            var storeName = _storeName ?? _memoryCache.Get<string>("STORE_NAME");
            if (string.IsNullOrWhiteSpace(storeName))
                return "Error: Store name not set";

            var registerNameVal = _memoryCache.Get<string>("REGISTER_NAME") ?? registerName;
            var shiftCode = _memoryCache.Get<string>("SHIFT_CODE") ?? "SHIFT1";
            var compCode = _memoryCache.Get<string>("COMP_CODE") ?? "01";

            var url = $"{_getPOSURL}/GetOrderDtls/{compCode}" +
                      $"?sessionid={Uri.EscapeDataString(sessionId)}" +
                      $"&storename={Uri.EscapeDataString(storeName)}" +
                      $"&registername={Uri.EscapeDataString(registerNameVal)}" +
                      $"&shiftcode={Uri.EscapeDataString(shiftCode)}" +
                      $"&salesno={Uri.EscapeDataString(salesNo)}";

            _logger.LogInformation("Calling GetOrderDtls: {Url}", url);

            var response = await _httpClient.GetAsync(url).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            _logger.LogWarning("GetOrderDtls error: {StatusCode} - {ReasonPhrase}",
                response.StatusCode, response.ReasonPhrase);
            return $"Error: {response.StatusCode} - {response.ReasonPhrase}";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception in GetOrderDtls");
            return $"Exception: {ex.Message}";
        }
    }


    // ── Public endpoints ───────────────────────────────────────────────────────────

    /// <summary>
    /// Returns kitchen print data for a given sales number.
    /// GET /api/GetKitchenPrint?salesno=SAL-004202603110005
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetKitchenPrint([FromQuery] string salesno)
    {
        if (string.IsNullOrWhiteSpace(salesno))
            return StatusCode(400, new { error = "salesno is required" });

        var result = await GetPosOrderKitchenPrint(salesno);

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        return Content(result, "application/json");
    }

    /// <summary>
    /// Returns receipt print data for a given sales number.
    /// GET /api/GetReceiptPrint?salesno=SAL-004202603110005
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetReceiptPrint([FromQuery] string salesno)
    {
        if (string.IsNullOrWhiteSpace(salesno))
            return StatusCode(400, new { error = "salesno is required" });

        var result = await GetOrderDtls(salesno);

        if (string.IsNullOrWhiteSpace(result))
            return StatusCode(500, new { error = "Empty result from POS" });

        if (result.StartsWith("Error") || result.StartsWith("Exception"))
            return StatusCode(500, new { error = result });

        return Content(result, "application/json");
    }

    /// <summary>
    /// Returns both kitchen and receipt print data in one call after payment.
    /// GET /api/GetPrintData?salesno=SAL-004202603110005
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetPrintData([FromQuery] string salesno)
    {
        if (string.IsNullOrWhiteSpace(salesno))
            return StatusCode(400, new { error = "salesno is required" });

        _logger.LogInformation("GetPrintData called for salesno: {SalesNo}", salesno);

        // Fire both requests in parallel — same pattern used internally
        var kitchenTask = GetPosOrderKitchenPrint(salesno);
        var receiptTask = GetOrderDtls(salesno);

        await Task.WhenAll(kitchenTask, receiptTask);

        var kitchenResult = kitchenTask.Result;
        var receiptResult = receiptTask.Result;

        // Validate kitchen result
        if (string.IsNullOrWhiteSpace(kitchenResult) || kitchenResult.StartsWith("Error") || kitchenResult.StartsWith("Exception"))
        {
            _logger.LogError("GetPosOrderKitchenPrint failed: {Result}", kitchenResult);
            return StatusCode(500, new { error = "Kitchen print failed", details = kitchenResult });
        }

        // Validate receipt result
        if (string.IsNullOrWhiteSpace(receiptResult) || receiptResult.StartsWith("Error") || receiptResult.StartsWith("Exception"))
        {
            _logger.LogError("GetOrderDtls failed: {Result}", receiptResult);
            return StatusCode(500, new { error = "Receipt print failed", details = receiptResult });
        }

        _logger.LogInformation("GetPrintData completed successfully for salesno: {SalesNo}", salesno);

        // Return both payloads together
        var combined = new JObject
        {
            ["salesno"] = salesno,
            ["kitchen"] = JToken.Parse(kitchenResult),
            ["receipt"] = JToken.Parse(receiptResult)
        };

        return Content(combined.ToString(Newtonsoft.Json.Formatting.None), "application/json");
    }


    /// <summary>
    /// Posts cart, then immediately returns kitchen + receipt print data.
    /// POST /api/SendPostCartItemAndPrint  (form: jsondata=...)
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> SendPostCartItemAndPrint([FromForm] string jsondata)
    {
        _logger.LogInformation("SendPostCartItemAndPrint endpoint called");

        Request.EnableBuffering();
        using (var reader = new StreamReader(Request.Body, Encoding.UTF8, leaveOpen: true))
        {
            var rawBody = await reader.ReadToEndAsync();
            Request.Body.Position = 0;

            if (rawBody.StartsWith("jsondata=", StringComparison.OrdinalIgnoreCase))
                jsondata = Uri.UnescapeDataString(rawBody["jsondata=".Length..].Replace("+", " "));
            else
                jsondata = rawBody;
        }

        if (string.IsNullOrWhiteSpace(jsondata))
            return StatusCode(400, new { error = "No orders provided" });

        List<JObject> orders;
        try
        {
            orders = JsonConvert.DeserializeObject<List<JObject>>(jsondata);
        }
        catch (Exception ex)
        {
            _logger.LogError("Failed to deserialize jsondata: {Error}", ex.Message);
            return StatusCode(400, new { error = "Invalid JSON format in jsondata", details = ex.Message });
        }

        if (orders == null || orders.Count == 0)
            return StatusCode(400, new { error = "No orders provided" });

        string action = "create";
        try { action = orders[0]["action"]?.ToString() ?? "create"; }
        catch { /* keep default */ }

        // Step 1 — post the cart
        var cartResult = await PostCartItem(action, orders.Cast<object>().ToList());

        if (string.IsNullOrWhiteSpace(cartResult) || cartResult.StartsWith("Error") || cartResult.StartsWith("Exception"))
        {
            _logger.LogError("PostCartItem failed: {Result}", cartResult);
            return StatusCode(500, new { error = cartResult });
        }

        // Step 2 — extract sales_no from response
        string salesNo;
        try
        {
            var cartJson = JObject.Parse(cartResult);
            salesNo = cartJson["data"]?[0]?["output"]?[0]?["sales_no"]?.ToString();

            if (string.IsNullOrWhiteSpace(salesNo))
                throw new Exception("sales_no not found in POS response");
        }
        catch (Exception ex)
        {
            _logger.LogError("Could not extract sales_no: {Error}", ex.Message);
            return StatusCode(500, new { error = "Could not extract sales_no", details = ex.Message });
        }

        _logger.LogInformation("sales_no extracted: {SalesNo}", salesNo);

        // Step 3 — fetch kitchen + receipt print data in parallel
        var kitchenTask = GetPosOrderKitchenPrint(salesNo);
        var receiptTask = GetOrderDtls(salesNo);

        await Task.WhenAll(kitchenTask, receiptTask);

        var kitchenResult = kitchenTask.Result;
        var receiptResult = receiptTask.Result;

        if (string.IsNullOrWhiteSpace(kitchenResult) || kitchenResult.StartsWith("Error") || kitchenResult.StartsWith("Exception"))
        {
            _logger.LogError("GetPosOrderKitchenPrint failed: {Result}", kitchenResult);
            return StatusCode(500, new { error = "Kitchen print failed", details = kitchenResult });
        }

        if (string.IsNullOrWhiteSpace(receiptResult) || receiptResult.StartsWith("Error") || receiptResult.StartsWith("Exception"))
        {
            _logger.LogError("GetOrderDtls failed: {Result}", receiptResult);
            return StatusCode(500, new { error = "Receipt print failed", details = receiptResult });
        }

        _logger.LogInformation("SendPostCartItemAndPrint completed successfully for salesno: {SalesNo}", salesNo);

        var combined = new JObject
        {
            ["salesno"] = salesNo,
            ["cart"] = JToken.Parse(cartResult),
            ["kitchen"] = JToken.Parse(kitchenResult),
            ["receipt"] = JToken.Parse(receiptResult)
        };

        return Content(combined.ToString(Newtonsoft.Json.Formatting.None), "application/json");
    }

    private string GenerateSecureToken()
    {
        byte[] randomBytes = new byte[32];
        using (var rng = RandomNumberGenerator.Create())
        {
            rng.GetBytes(randomBytes);
        }

        return Convert.ToBase64String(randomBytes)
            .Replace("+", "-")
            .Replace("/", "_")
            .Replace("=", "");
    }

}