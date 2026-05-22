using Microsoft.AspNetCore.Mvc;
using System.Security.Cryptography.X509Certificates;
using CafeJubilant_SOK.Converters;
namespace CafeJubilant_SOK.Models
{
    public class KioskModel : Controller
    {
        public class SOKOrder
        {
            public string OrderId { get; set; }
            public string SokDeviceId { get; set; }
            public string DeviceId { get; set; } // NEW: Physical device ID (SOK-001, SOK-002, SOK-003)
            public string QueueNumber { get; set; }
            public object OrderData { get; set; }
            public string Status { get; set; }
            public DateTime CreatedAt { get; set; }
            public DateTime CompletedAt { get; set; }
            public DateTime UpdatedAt { get; set; }
            public string CreatedBy { get; set; }
            public string UpdatedBy { get; set; }
        }

        public class OrderCache
        {
            public string OrderId { get; set; }
            public string TableNo { get; set; }
            public string OrderType { get; set; }
            public string DeviceId { get; set; }
            public string Location { get; set; }
            public DateTime Timestamp { get; set; }
            public SOKOrderData OrderData { get; set; }
            public decimal TotalAmount { get; set; }
            public string Status { get; set; }
            public DateTime CreatedAt { get; set; }
            public DateTime UpdatedAt { get; set; }
        }

        // DTOs
        public class CreateOrderDto
        {
            public string SokDeviceId { get; set; }
            public string DeviceId { get; set; } // NEW: Physical device ID
            public string QueueNumber { get; set; }
            public object OrderData { get; set; }
            public string PosDeviceId { get; set; }
        }

        public class UpdateOrderDto
        {
            public string? DeviceId { get; set; }
            public object? OrderData { get; set; }
        }

        public class BatchUpdateDto
        {
            public List<string> OrderIds { get; set; }
            public string Status { get; set; }
            public string PosDeviceId { get; set; }
        }

        public class SetOrderTypeDto
        {
            public string OrderType { get; set; }
            public string TableNo { get; set; }
            public string DeviceId { get; set; }
            public string Location { get; set; } // ✅ NEW
            public DateTime? Timestamp { get; set; }
            public SOKOrderData OrderData { get; set; }
        }

        public class UpdateOrderCacheDto
        {
            public string OrderType { get; set; }
            public SOKOrderData OrderData { get; set; }
            public string Status { get; set; }
        }

        public class DeviceRegistrationDto
        {
            public string DeviceId { get; set; }
            public string DeviceName { get; set; }
            public string Location { get; set; }

            public DateTime RegisteredAt { get; set; }
        }

        public class DeviceInfo
        {
            public string DeviceId { get; set; }
            public string DeviceName { get; set; }
            public string Location { get; set; }
            public DateTime RegisteredAt { get; set; }
            public DateTime LastSeenAt { get; set; }
            public bool IsActive { get; set; }
        }

        public class DeviceControlRequestDto
        {
            public string SokDeviceId { get; set; }
            public string PosDeviceId { get; set; }
            public string Message { get; set; } // Optional message from POS
        }

        public class BroadcastMessageDto
        {
            public string DeviceId { get; set; }
            public string FromDeviceId { get; set; }
            public string Action { get; set; }
            public object? Data { get; set; }
            public string? Message { get; set; }
        }

        // ✅ POS Sync DTO - Used for POS-to-SOK synchronization
        public class POSSyncDto
        {
            public string Location { get; set; }
            public string PosDeviceId { get; set; }
            public string DeviceId { get; set; }
            public string TableNo { get; set; }
            public string OrderType { get; set; }
            public SOKOrderData OrderData { get; set; }
            public string Status { get; set; }
        }
    }

    public class BroadcastOrderDto
    {
        public string OrderId { get; set; }
        public string SourceDeviceId { get; set; }
        public string SourceType { get; set; } // "pos", "sok", "server"
        public string CacheKey { get; set; }
        public string DeviceId { get; set; }
        public string TableNo { get; set; }
        public string OrderType { get; set; }
        public SOKOrderData OrderData { get; set; }
        public string Status { get; set; }
        public decimal? TotalAmount { get; set; }
        public bool BroadcastToAllSOK { get; set; } = true;
        public bool BroadcastToPOS { get; set; } = false;
        public Dictionary<string, object> Metadata { get; set; }
    }

    public class BroadcastToDeviceDto
    {
        public string DeviceId { get; set; }
        public string OrderType { get; set; }
        public string OrderId { get; set; }
        public SOKOrderData OrderData { get; set; }
        public string Status { get; set; }
    }

    public class BroadcastByTypeDto
    {
        public string OrderType { get; set; } // "E" or "T"
        public List<object> Orders { get; set; }
    }

    public class BroadcastBatchDto
    {
        public List<BatchOrderItem> Orders { get; set; }
        public bool BroadcastToAll { get; set; } = false;
    }

    public class BatchOrderItem
    {
        public string DeviceId { get; set; }
        public string TableNo { get; set; }
        public string OrderType { get; set; }
    }

    public class SyncAllOrdersDto
    {
        public bool BroadcastToAll { get; set; } = true;
        public string OrderType { get; set; } // Optional: filter by type
    }

    public class BroadcastMessage
    {
        public string BroadcastId { get; set; }
        public string Action { get; set; }
        public string Source { get; set; }
        public string SourceType { get; set; }
        public string OrderId { get; set; }
        public SOKOrderData OrderData { get; set; }
        public string OrderType { get; set; }
        public string TableNo { get; set; }
        public string DeviceId { get; set; }
        public string Status { get; set; }
        public decimal TotalAmount { get; set; }
        public int ItemCount { get; set; }
        public DateTime Timestamp { get; set; }
        public Dictionary<string, object> Metadata { get; set; }
    }

    public class BroadcastResults
    {
        public bool SpecificDevice { get; set; }
        public int AllSOKDevices { get; set; }
        public int TableDevices { get; set; }
        public int POSDevices { get; set; }
        public int OrderTypeDevices { get; set; }

        public int GetTotalRecipients()
        {
            return (SpecificDevice ? 1 : 0) + AllSOKDevices + TableDevices + POSDevices + OrderTypeDevices;
        }
    }

    public class BroadcastHistory
    {
        public string BroadcastId { get; set; }
        public string OrderId { get; set; }
        public string SourceDeviceId { get; set; }
        public DateTime Timestamp { get; set; }
        public BroadcastResults Results { get; set; }
        public BroadcastMessage Message { get; set; }
    }

    public class BatchBroadcastResult
    {
        public string OrderId { get; set; }
        public string CacheKey { get; set; }
        public bool Success { get; set; }
        public int RecipientCount { get; set; }
    }

    public class SyncResult
    {
        public string OrderId { get; set; }
        public string DeviceId { get; set; }
        public int RecipientCount { get; set; }
        public bool Success { get; set; }
    }


    public class AccessRequestDto
    {
        public string ControllerDeviceId { get; set; } // Can be anything - no validation
        public string SokDeviceId { get; set; }
        public string Message { get; set; } = "Remote control request";
        public bool ForceOverride { get; set; } = false;
    }

    public class ReleaseControlDto
    {
        public string SessionId { get; set; } // Optional - can use SokDeviceId instead
        public string SokDeviceId { get; set; } // Optional - can use SessionId instead
    }

    public class RemoteCommandDto
    {
        public string SessionId { get; set; } // Optional
        public string SokDeviceId { get; set; }
        public string Command { get; set; }
        public object Data { get; set; }
    }

    public class ScreenSyncRequestDto
    {
        public string SokDeviceId { get; set; }
    }

    public class PaymentRequest
    {
        public PaymentData Payment { get; set; }
        public string OldECN { get; set; }
    }

    public class PaymentData
    {
        public string PaymentName { get; set; }
        public decimal TenderAmt { get; set; }
        public int SNo { get; set; }
        public string RefInfo { get; set; }
    }

    public class PaymentResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public PaymentData Payment { get; set; }
        public List<SalesOtherInfo> SalesOtherInfo { get; set; }
        public object Result { get; set; }
    }

    public class SalesOtherInfo
    {
        public string InfoName { get; set; }
        public string InfoValue { get; set; }
    }

    
    public class PaymentLog
    {
        public string Id { get; set; }
        public string Module { get; set; }
        public string Info { get; set; }
        public object Req { get; set; }
        public object Res { get; set; }
        public DateTime Timestamp { get; set; }
    }

    public class PaymentSuccessDto
    {
        public string OrderType { get; set; } // "E" or "T"
        public string PaymentMethod { get; set; } // "cash", "card", "ewallet", etc.
        public string TransactionId { get; set; }
        public string ReceiptNumber { get; set; }
    }

    public class PaymentFailureDto
    {
        public string OrderType { get; set; }
        public string Reason { get; set; }
        public string ErrorCode { get; set; }
        public string PaymentMethod { get; set; }
    }



    public class PaymentCompleteDto
    {
        public string DeviceId { get; set; }
        public string OrderId { get; set; }
        public string SalesNo { get; set; }
        public string TableNo { get; set; }
        public string OrderType { get; set; }
        public string PaymentMethod { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public decimal ChangeAmount { get; set; }
        public string TransactionId { get; set; }
        public string ReceiptNumber { get; set; }

        public SOKOrderData OrderData { get; set; }
    }
}