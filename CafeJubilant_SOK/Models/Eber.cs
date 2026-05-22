namespace CafeJubilant_SOK.Models
{
    // ==========================================
    // CONFIGURATION MODELS
    // ==========================================
    public class EberSettings
    {
        public string NEXT_EBER_API_URL { get; set; }
        public string NEXT_POS_EBER_API_URL { get; set; }  

        public string NEXT_EBER_USERNAME { get; set; }
        public string NEXT_EBER_PASSWORD { get; set; }
        public string NEXT_EBER_HMAC_SECRET_KEY { get; set; }
    }

    public class OutletSettings
    {
        public string NEXT_ONLINE_API_URL { get; set; }
        public string IMAGE_API_URL { get; set; }
        public string NEXT_CAPTURE_LOG { get; set; }
        public string NEXT_COMP_CODE { get; set; }
    }

    // ==========================================
    // EBER API RESPONSE MODELS
    // ==========================================
    public class EberCustomerResponse
    {
        public string Id { get; set; }
        public string ExternalMemberId { get; set; }
        public string DisplayName { get; set; }
        public string Email { get; set; }
        public string PhoneFormat { get; set; }
        public List<MemberTier> MemberTiers { get; set; }
        public List<PointBalance> Points { get; set; }
    }

    public class MemberTier
    {
        public string Id { get; set; }
        public string Name { get; set; }
    }

    public class PointBalance
    {
        public decimal Points { get; set; }
        public string Type { get; set; }
    }

    public class EberPointsResponse
    {
        public decimal TotalPoints { get; set; }
        public List<PointBalance> Balances { get; set; }
    }

    // ==========================================
    // REQUEST MODELS
    // ==========================================
    public class ValidateMemberRequest
    {
        public string MembershipId { get; set; }
    }

    public class LoginRequest
    {
        public string MembershipId { get; set; }
        public string Password { get; set; }
    }

    // Add to the end of Models/Eber.cs

    // ==========================================
    // COMBINED CUSTOMER REQUEST
    // ==========================================
    public class CombinedCustomerRequest
    {
        public string UserId { get; set; }
    }

    // ==========================================
    // POS API RESPONSE MODELS
    // ==========================================
    public class PosCustomerResponse
    {
        public string Message { get; set; }
        public List<PosCustomerData> Data { get; set; }
    }

    public class PosCustomerData
    {
        public List<PosCustomerOutput> Output { get; set; }
    }

    public class PosCustomerOutput
    {
        public string CustomerId { get; set; }
        public string CustomerName { get; set; }
        public string CustomerCode { get; set; }
        public string PhoneNumber { get; set; }
        public string Email { get; set; }
        // Add other POS fields as needed
    }

    // Add these at the end of your Eber.cs file (inside the namespace)

    // ==========================================
    // EBER USER SHOW REQUEST
    // ==========================================
    public class EberUserShowRequest
    {
        public string QueryString { get; set; }
    }

    // ==========================================
    // EBER USER LIST REQUEST
    // ==========================================
    public class EberUserListRequest
    {
        public int Page { get; set; } = 1;
        public int PageSize { get; set; } = 20;
        public string Search { get; set; }
    }

    // ==========================================
    // CUSTOMER LIST RESPONSE
    // ==========================================
    public class EberCustomerListResponse
    {
        public List<EberCustomerResponse> Items { get; set; }
        public int Total { get; set; }
        public int Page { get; set; }
        public int PerPage { get; set; }
    }


    public class EberIntegrationRequest
    {
        public Dictionary<string, object> EberPayload { get; set; }
    }
}