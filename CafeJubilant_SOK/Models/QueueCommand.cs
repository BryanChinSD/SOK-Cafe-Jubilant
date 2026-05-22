using Microsoft.AspNetCore.Mvc;

namespace CafeJubilant_SOK.Models
{
    public class QueueCommand
    {
        public string Action { get; set; } = string.Empty;
        public string TargetDeviceId { get; set; } = string.Empty;
        public string? SourceDeviceId { get; set; }
        public string? QueueNumber { get; set; }
        public string? Counter { get; set; }
        public string? Status { get; set; }
        public string? Message { get; set; }
        public DateTime? Timestamp { get; set; }
        public Dictionary<string, object>? Metadata { get; set; }
    }
}
