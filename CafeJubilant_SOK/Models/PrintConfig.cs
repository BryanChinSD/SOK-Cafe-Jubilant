using System.Text.Json.Serialization;

namespace CafeJubilant_SOK.Models
{
    public class PrintConfig
    {
        [JsonPropertyName("isdefault")]
        public bool IsDefault { get; set; }

        [JsonPropertyName("Kitchen")]
        public KitchenPrintConfig? Kitchen { get; set; }

        [JsonPropertyName("Receipt")]
        public ReceiptPrintConfig? Receipt { get; set; }

        [JsonPropertyName("TQR")]
        public TQRPrintConfig? TQR { get; set; }

        [JsonPropertyName("Reservation")]
        public ReservationPrintConfig? Reservation { get; set; }

        [JsonPropertyName("PreOrderReceipt")]
        public PreOrderReceiptPrintConfig? PreOrderReceipt { get; set; }
    }

    // ── Shared element config ──────────────────────────────────────────────────

    public class PrintElement
    {
        [JsonPropertyName("visible")]
        public bool Visible { get; set; }

        [JsonPropertyName("fontSize")]
        public int FontSize { get; set; }

        [JsonPropertyName("fontColor")]
        public string FontColor { get; set; } = "#000000";

        [JsonPropertyName("label")]
        public string Label { get; set; } = string.Empty;

        [JsonPropertyName("fontFamily")]
        public string FontFamily { get; set; } = string.Empty;
    }

    public class PrintElementWithX : PrintElement
    {
        [JsonPropertyName("x")]
        public int X { get; set; }
    }

    public class PrintElementWithFontWeight : PrintElement
    {
        [JsonPropertyName("fontWeight")]
        public string FontWeight { get; set; } = "normal";
    }

    public class PrintElementWithXAndFontWeight : PrintElementWithFontWeight
    {
        [JsonPropertyName("x")]
        public int X { get; set; }
    }

    // ── Kitchen ────────────────────────────────────────────────────────────────

    public class KitchenPrintConfig
    {
        [JsonPropertyName("x")]
        public int X { get; set; }

        [JsonPropertyName("y")]
        public int Y { get; set; }

        [JsonPropertyName("maxWidth")]
        public int MaxWidth { get; set; }

        [JsonPropertyName("EmptyLine")]
        public int EmptyLine { get; set; }

        [JsonPropertyName("StarDivider")]
        public PrintElement? StarDivider { get; set; }

        [JsonPropertyName("DashDivider")]
        public PrintElement? DashDivider { get; set; }

        [JsonPropertyName("TableNo")]
        public PrintElement? TableNo { get; set; }

        [JsonPropertyName("AdditionalItems")]
        public PrintElement? AdditionalItems { get; set; }

        [JsonPropertyName("TransferTable")]
        public PrintElement? TransferTable { get; set; }

        [JsonPropertyName("Cancel")]
        public PrintElement? Cancel { get; set; }

        [JsonPropertyName("Void")]
        public PrintElement? Void { get; set; }

        [JsonPropertyName("Header")]
        public PrintElement? Header { get; set; }

        [JsonPropertyName("SingleHeader")]
        public PrintElement? SingleHeader { get; set; }

        [JsonPropertyName("PrinterName")]
        public PrintElement? PrinterName { get; set; }

        [JsonPropertyName("QueueNo")]
        public PrintElement? QueueNo { get; set; }

        [JsonPropertyName("Register")]
        public PrintElement? Register { get; set; }

        [JsonPropertyName("ShortSalesNo")]
        public PrintElement? ShortSalesNo { get; set; }

        [JsonPropertyName("SalesNo")]
        public PrintElement? SalesNo { get; set; }

        [JsonPropertyName("DateTime")]
        public PrintElement? DateTime { get; set; }

        [JsonPropertyName("User")]
        public PrintElement? User { get; set; }

        [JsonPropertyName("Status")]
        public PrintElement? Status { get; set; }

        [JsonPropertyName("NoOfPax")]
        public PrintElement? NoOfPax { get; set; }

        [JsonPropertyName("QtyValue")]
        public PrintElementWithX? QtyValue { get; set; }

        [JsonPropertyName("ItemsValue")]
        public PrintElementWithX? ItemsValue { get; set; }

        [JsonPropertyName("DineIn")]
        public PrintElement? DineIn { get; set; }

        [JsonPropertyName("TakeAway")]
        public PrintElement? TakeAway { get; set; }

        [JsonPropertyName("Remarks")]
        public PrintElement? Remarks { get; set; }

        [JsonPropertyName("DeliveryOrderInfo")]
        public PrintElement? DeliveryOrderInfo { get; set; }

        [JsonPropertyName("TopmostTableNo")]
        public PrintElement? TopmostTableNo { get; set; }
    }

    // ── Receipt ────────────────────────────────────────────────────────────────

    public class ReceiptPrintConfig
    {
        [JsonPropertyName("x")]
        public int X { get; set; }

        [JsonPropertyName("y")]
        public int Y { get; set; }

        [JsonPropertyName("maxWidth")]
        public int MaxWidth { get; set; }

        [JsonPropertyName("EmptyLine")]
        public int EmptyLine { get; set; }

        [JsonPropertyName("StarDivider")]
        public PrintElement? StarDivider { get; set; }

        [JsonPropertyName("DashDivider")]
        public PrintElement? DashDivider { get; set; }

        [JsonPropertyName("StoreGroup")]
        public PrintElement? StoreGroup { get; set; }

        [JsonPropertyName("StoreName")]
        public PrintElement? StoreName { get; set; }

        [JsonPropertyName("StoreAddress")]
        public PrintElement? StoreAddress { get; set; }

        [JsonPropertyName("GstNo")]
        public PrintElement? GstNo { get; set; }

        [JsonPropertyName("QueueNo")]
        public PrintElement? QueueNo { get; set; }

        [JsonPropertyName("TableNo")]
        public PrintElement? TableNo { get; set; }

        [JsonPropertyName("Customer")]
        public PrintElement? Customer { get; set; }

        [JsonPropertyName("OrderRefNo")]
        public PrintElement? OrderRefNo { get; set; }

        [JsonPropertyName("SalesNo")]
        public PrintElement? SalesNo { get; set; }

        [JsonPropertyName("Status")]
        public PrintElement? Status { get; set; }

        [JsonPropertyName("Register")]
        public PrintElement? Register { get; set; }

        [JsonPropertyName("Date")]
        public PrintElement? Date { get; set; }

        [JsonPropertyName("User")]
        public PrintElement? User { get; set; }

        [JsonPropertyName("NoOfPax")]
        public PrintElement? NoOfPax { get; set; }

        [JsonPropertyName("DuplicateReceipt")]
        public PrintElement? DuplicateReceipt { get; set; }

        [JsonPropertyName("Qty")]
        public PrintElementWithX? Qty { get; set; }

        [JsonPropertyName("Items")]
        public PrintElementWithXAndFontWeight? Items { get; set; }

        [JsonPropertyName("Amount")]
        public PrintElementWithXAndFontWeight? Amount { get; set; }

        [JsonPropertyName("DineInDivider")]
        public PrintElement? DineInDivider { get; set; }

        [JsonPropertyName("TakeAwayDivider")]
        public PrintElement? TakeAwayDivider { get; set; }

        [JsonPropertyName("QtyValue")]
        public PrintElement? QtyValue { get; set; }

        [JsonPropertyName("ItemsValue")]
        public PrintElement? ItemsValue { get; set; }

        [JsonPropertyName("AmountValue")]
        public PrintElement? AmountValue { get; set; }

        [JsonPropertyName("DiscountValue")]
        public PrintElement? DiscountValue { get; set; }

        [JsonPropertyName("RefValue")]
        public PrintElement? RefValue { get; set; }

        [JsonPropertyName("Subtotal")]
        public PrintElement? Subtotal { get; set; }

        [JsonPropertyName("TotalDiscount")]
        public PrintElement? TotalDiscount { get; set; }

        [JsonPropertyName("ServiceCharge")]
        public PrintElement? ServiceCharge { get; set; }

        [JsonPropertyName("GST")]
        public PrintElement? GST { get; set; }

        [JsonPropertyName("RoundingAdjustment")]
        public PrintElement? RoundingAdjustment { get; set; }

        [JsonPropertyName("Total")]
        public PrintElement? Total { get; set; }

        [JsonPropertyName("NoofItems")]
        public PrintElement? NoofItems { get; set; }

        [JsonPropertyName("PaymentInfo")]
        public PrintElement? PaymentInfo { get; set; }

        [JsonPropertyName("PaymentReference")]
        public PrintElement? PaymentReference { get; set; }

        [JsonPropertyName("AmountDueforPax")]
        public PrintElement? AmountDueforPax { get; set; }

        [JsonPropertyName("Change")]
        public PrintElement? Change { get; set; }

        [JsonPropertyName("PrintDraft")]
        public PrintElement? PrintDraft { get; set; }

        [JsonPropertyName("ChangePaymentHistory")]
        public PrintElement? ChangePaymentHistory { get; set; }

        [JsonPropertyName("DateTime")]
        public PrintElement? DateTime { get; set; }

        [JsonPropertyName("Cashier")]
        public PrintElement? Cashier { get; set; }

        [JsonPropertyName("Signature")]
        public PrintElement? Signature { get; set; }

        [JsonPropertyName("ThankYou")]
        public PrintElement? ThankYou { get; set; }

        [JsonPropertyName("Agreement")]
        public PrintElement? Agreement { get; set; }

        [JsonPropertyName("ConsumerProtection")]
        public PrintElement? ConsumerProtection { get; set; }

        [JsonPropertyName("TopmostTableNo")]
        public PrintElementWithFontWeight? TopmostTableNo { get; set; }

        [JsonPropertyName("PaymentTerminalInfo")]
        public PrintElement? PaymentTerminalInfo { get; set; }
    }

    // ── TQR ───────────────────────────────────────────────────────────────────

    public class TQRPrintConfig
    {
        [JsonPropertyName("x")]
        public int X { get; set; }

        [JsonPropertyName("y")]
        public int Y { get; set; }

        [JsonPropertyName("maxWidth")]
        public int MaxWidth { get; set; }

        [JsonPropertyName("EmptyLine")]
        public int EmptyLine { get; set; }

        [JsonPropertyName("StarDivider")]
        public PrintElement? StarDivider { get; set; }

        [JsonPropertyName("DashDivider")]
        public PrintElement? DashDivider { get; set; }

        [JsonPropertyName("StoreGroup")]
        public PrintElement? StoreGroup { get; set; }

        [JsonPropertyName("StoreName")]
        public PrintElement? StoreName { get; set; }

        [JsonPropertyName("TableQRLabel")]
        public PrintElement? TableQRLabel { get; set; }

        [JsonPropertyName("Date")]
        public PrintElement? Date { get; set; }

        [JsonPropertyName("TableNo")]
        public PrintElement? TableNo { get; set; }

        [JsonPropertyName("Footer")]
        public PrintElement? Footer { get; set; }
    }

    // ── Reservation ───────────────────────────────────────────────────────────

    public class ReservationPrintConfig
    {
        [JsonPropertyName("x")]
        public int X { get; set; }

        [JsonPropertyName("y")]
        public int Y { get; set; }

        [JsonPropertyName("maxWidth")]
        public int MaxWidth { get; set; }

        [JsonPropertyName("EmptyLine")]
        public int EmptyLine { get; set; }

        [JsonPropertyName("StarDivider")]
        public PrintElement? StarDivider { get; set; }

        [JsonPropertyName("DashDivider")]
        public PrintElement? DashDivider { get; set; }

        [JsonPropertyName("StoreGroup")]
        public PrintElement? StoreGroup { get; set; }

        [JsonPropertyName("StoreName")]
        public PrintElement? StoreName { get; set; }

        [JsonPropertyName("StoreAddress")]
        public PrintElement? StoreAddress { get; set; }

        [JsonPropertyName("DocNo")]
        public PrintElement? DocNo { get; set; }

        [JsonPropertyName("Store")]
        public PrintElement? Store { get; set; }

        [JsonPropertyName("DocDate")]
        public PrintElement? DocDate { get; set; }

        [JsonPropertyName("ReservationDate")]
        public PrintElement? ReservationDate { get; set; }

        [JsonPropertyName("StartTime")]
        public PrintElement? StartTime { get; set; }

        [JsonPropertyName("EndTime")]
        public PrintElement? EndTime { get; set; }

        [JsonPropertyName("CustomerName")]
        public PrintElement? CustomerName { get; set; }

        [JsonPropertyName("Email")]
        public PrintElement? Email { get; set; }

        [JsonPropertyName("ContactNo")]
        public PrintElement? ContactNo { get; set; }

        [JsonPropertyName("TableNo")]
        public PrintElement? TableNo { get; set; }

        [JsonPropertyName("NoOfPax")]
        public PrintElement? NoOfPax { get; set; }

        [JsonPropertyName("PaymentName")]
        public PrintElement? PaymentName { get; set; }

        [JsonPropertyName("DepositAmount")]
        public PrintElement? DepositAmount { get; set; }

        [JsonPropertyName("RefundPaymentName")]
        public PrintElement? RefundPaymentName { get; set; }

        [JsonPropertyName("RefundAmount")]
        public PrintElement? RefundAmount { get; set; }

        [JsonPropertyName("Remarks")]
        public PrintElement? Remarks { get; set; }

        [JsonPropertyName("Agreement")]
        public PrintElement? Agreement { get; set; }

        [JsonPropertyName("ConsumerProtection")]
        public PrintElement? ConsumerProtection { get; set; }
    }

    // ── PreOrderReceipt ───────────────────────────────────────────────────────

    public class PreOrderReceiptPrintConfig
    {
        [JsonPropertyName("x")]
        public int X { get; set; }

        [JsonPropertyName("y")]
        public int Y { get; set; }

        [JsonPropertyName("maxWidth")]
        public int MaxWidth { get; set; }

        [JsonPropertyName("EmptyLine")]
        public int EmptyLine { get; set; }

        [JsonPropertyName("StarDivider")]
        public PrintElement? StarDivider { get; set; }

        [JsonPropertyName("DashDivider")]
        public PrintElement? DashDivider { get; set; }

        [JsonPropertyName("StoreGroup")]
        public PrintElement? StoreGroup { get; set; }

        [JsonPropertyName("StoreName")]
        public PrintElement? StoreName { get; set; }

        [JsonPropertyName("StoreAddress")]
        public PrintElement? StoreAddress { get; set; }

        [JsonPropertyName("GstNo")]
        public PrintElement? GstNo { get; set; }

        [JsonPropertyName("PaymentDocNo")]
        public PrintElement? PaymentDocNo { get; set; }

        [JsonPropertyName("PaymentDate")]
        public PrintElement? PaymentDate { get; set; }

        [JsonPropertyName("OrderNo")]
        public PrintElement? OrderNo { get; set; }

        [JsonPropertyName("OrderDate")]
        public PrintElement? OrderDate { get; set; }

        [JsonPropertyName("CollectionStoreName")]
        public PrintElement? CollectionStoreName { get; set; }

        [JsonPropertyName("CollectionDate")]
        public PrintElement? CollectionDate { get; set; }

        [JsonPropertyName("CustomerName")]
        public PrintElement? CustomerName { get; set; }

        [JsonPropertyName("ContactNo")]
        public PrintElement? ContactNo { get; set; }

        [JsonPropertyName("ContactPerson")]
        public PrintElement? ContactPerson { get; set; }

        [JsonPropertyName("OrderStatus")]
        public PrintElement? OrderStatus { get; set; }

        [JsonPropertyName("PaymentStatus")]
        public PrintElement? PaymentStatus { get; set; }

        [JsonPropertyName("User")]
        public PrintElement? User { get; set; }

        [JsonPropertyName("Qty")]
        public PrintElementWithX? Qty { get; set; }

        [JsonPropertyName("Items")]
        public PrintElementWithXAndFontWeight? Items { get; set; }

        [JsonPropertyName("Amount")]
        public PrintElementWithXAndFontWeight? Amount { get; set; }

        [JsonPropertyName("QtyValue")]
        public PrintElement? QtyValue { get; set; }

        [JsonPropertyName("ItemsValue")]
        public PrintElement? ItemsValue { get; set; }

        [JsonPropertyName("AmountValue")]
        public PrintElement? AmountValue { get; set; }

        [JsonPropertyName("DiscountValue")]
        public PrintElement? DiscountValue { get; set; }

        [JsonPropertyName("RefValue")]
        public PrintElement? RefValue { get; set; }

        [JsonPropertyName("Subtotal")]
        public PrintElement? Subtotal { get; set; }

        [JsonPropertyName("TotalDiscount")]
        public PrintElement? TotalDiscount { get; set; }

        [JsonPropertyName("ServiceCharge")]
        public PrintElement? ServiceCharge { get; set; }

        [JsonPropertyName("GST")]
        public PrintElement? GST { get; set; }

        [JsonPropertyName("RoundingAdjustment")]
        public PrintElement? RoundingAdjustment { get; set; }

        [JsonPropertyName("Total")]
        public PrintElement? Total { get; set; }

        [JsonPropertyName("PaymentInfo")]
        public PrintElement? PaymentInfo { get; set; }

        [JsonPropertyName("PaymentReference")]
        public PrintElement? PaymentReference { get; set; }

        [JsonPropertyName("TotalPaidAmount")]
        public PrintElement? TotalPaidAmount { get; set; }

        [JsonPropertyName("BalanceToBeCollected")]
        public PrintElement? BalanceToBeCollected { get; set; }

        [JsonPropertyName("DateTime")]
        public PrintElement? DateTime { get; set; }

        [JsonPropertyName("Cashier")]
        public PrintElement? Cashier { get; set; }

        [JsonPropertyName("Signature")]
        public PrintElement? Signature { get; set; }

        [JsonPropertyName("ThankYou")]
        public PrintElement? ThankYou { get; set; }

        [JsonPropertyName("Agreement")]
        public PrintElement? Agreement { get; set; }

        [JsonPropertyName("ConsumerProtection")]
        public PrintElement? ConsumerProtection { get; set; }

        [JsonPropertyName("RefundDocNo")]
        public PrintElement? RefundDocNo { get; set; }

        [JsonPropertyName("RefundDate")]
        public PrintElement? RefundDate { get; set; }

        [JsonPropertyName("RefundStatus")]
        public PrintElement? RefundStatus { get; set; }

        [JsonPropertyName("RefundInfo")]
        public PrintElement? RefundInfo { get; set; }
    }
}