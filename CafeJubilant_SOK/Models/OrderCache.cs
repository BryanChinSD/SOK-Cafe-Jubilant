using Microsoft.AspNetCore.Mvc;
using System.Text.Json.Serialization;
using CafeJubilant_SOK.Converters; 


namespace CafeJubilant_SOK.Models
{
    /// <summary>
    /// Main order model matching the JavaScript getNewOrder structure
    /// </summary>
    public class SOKOrderData
    {
        [JsonPropertyName("sales_no")]
        public string SalesNo { get; set; } = "";

        [JsonPropertyName("doc_date")]
        public string DocDate { get; set; }

        [JsonPropertyName("customer_code")]
        public string CustomerCode { get; set; } = "";

        [JsonPropertyName("cust_addr_s_no")]
        public string CustAddrSNo { get; set; } = "";

        [JsonPropertyName("service_type")]
        public string ServiceType { get; set; } // E = Dine In, T = Takeaway

        [JsonPropertyName("service_type_info")]
        public string ServiceTypeInfo { get; set; }

        [JsonPropertyName("order_status_id")]
        public string OrderStatusId { get; set; } = "N";

        [JsonPropertyName("order_status_desc")]
        public string OrderStatusDesc { get; set; } = "New";

        [JsonPropertyName("kitchen_status_id")]
        public string KitchenStatusId { get; set; } = "P";

        [JsonPropertyName("kitchen_status_desc")]
        public string KitchenStatusDesc { get; set; } = "In Progress";

        [JsonPropertyName("sub_total")]
        public string SubTotal { get; set; } = "0.00";

        [JsonPropertyName("disc_type")]
        public string DiscType { get; set; } = "N";

        [JsonPropertyName("disc_name")]
        public string DiscName { get; set; } = "None";

        [JsonPropertyName("disc_value")]
        public decimal DiscValue { get; set; } = 0;

        [JsonPropertyName("total_disc")]
        public string TotalDisc { get; set; } = "0.00";

        [JsonPropertyName("total_svc")]
        public string TotalSvc { get; set; } = "0.00";

        [JsonPropertyName("total_tax")]
        public string TotalTax { get; set; } = "0.00";

        [JsonPropertyName("round_adj_amt")]
        public string RoundAdjAmt { get; set; } = "0.00";

        [JsonPropertyName("absorb_tax")]
        public string AbsorbTax { get; set; } // Y or N

        [JsonPropertyName("absorb_tax_info")]
        public string AbsorbTaxInfo { get; set; }

        [JsonPropertyName("net_amt")]
        public string NetAmt { get; set; } = "0.00";

        [JsonPropertyName("tips_amt")]
        public string TipsAmt { get; set; } = "0.00";

        [JsonPropertyName("total_tender_amt")]
        public string TotalTenderAmt { get; set; } = "0.00";

        [JsonPropertyName("change_amt")]
        public string ChangeAmt { get; set; } = "0.00";

        [JsonPropertyName("no_of_pax")]
        public int NoOfPax { get; set; } = 1;

        [JsonPropertyName("table_no")]
        public string TableNo { get; set; } = "";

        [JsonPropertyName("remarks")]
        public string Remarks { get; set; } = "";

        [JsonPropertyName("del_driver")]
        public string DelDriver { get; set; } = "";

        [JsonPropertyName("ref_1")]
        public string Ref1 { get; set; } = "";

        [JsonPropertyName("ref_2")]
        public string Ref2 { get; set; } = "";

        [JsonPropertyName("ref_3")]
        public string Ref3 { get; set; } = "";

        [JsonPropertyName("ref_4")]
        public string Ref4 { get; set; } = "";

        [JsonPropertyName("ref_5")]
        public string Ref5 { get; set; } = "";

        [JsonPropertyName("sales_dtls")]
        public List<SalesDetail> SalesDtls { get; set; } = new();

        [JsonPropertyName("sales_service_dtls")]
        public List<SalesServiceDetail> SalesServiceDtls { get; set; } = new();

        [JsonPropertyName("sales_payment_dtls")]
        public List<SalesPaymentDetail> SalesPaymentDtls { get; set; } = new();

        [JsonPropertyName("sales_other_info")]
        public string SalesOtherInfo { get; set; } = "";

        [JsonPropertyName("table_transfer")]
        public string TableTransfer { get; set; } = "N";

        [JsonPropertyName("table_transfer_sno")]
        public string TableTransferSno { get; set; } = "";

        // Additional properties for tracking
        [JsonPropertyName("created_at")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [JsonPropertyName("updated_at")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        [JsonPropertyName("server_order_id")]
        public string? ServerOrderId { get; set; }
    }

    /// <summary>
    /// Sales detail line item
    /// </summary>
    public class SalesDetail
    {
        [JsonPropertyName("s_no")]
        public int SNo { get; set; }

        [JsonPropertyName("parent_sno")]
        public int ParentSno { get; set; }

        [JsonPropertyName("ds_no")]
        public int DsNo { get; set; }

        [JsonPropertyName("seat_no")]
        public int SeatNo { get; set; }

        [JsonPropertyName("category_code")]
        public string CategoryCode { get; set; } = "";

        [JsonPropertyName("item_no")]
        public string ItemNo { get; set; } = "";

        [JsonPropertyName("item_name")]
        public string ItemName { get; set; } = "";

        [JsonPropertyName("item_desc")]
        public string ItemDesc { get; set; } = "";

        [JsonPropertyName("remarks")]
        public string Remarks { get; set; } = "";

        [JsonPropertyName("qty")]
        public decimal Qty { get; set; }

        [JsonPropertyName("uom")]
        public string Uom { get; set; } = "";

        [JsonPropertyName("uom_cf")]
        public decimal UomCf { get; set; } = 1;

        [JsonPropertyName("unit_price")]
        public decimal UnitPrice { get; set; }

        [JsonPropertyName("disc_type")]
        public string DiscType { get; set; } = "N";

        [JsonPropertyName("disc_name")]
        public string DiscName { get; set; } = "None";

        [JsonPropertyName("disc_value")]
        public decimal DiscValue { get; set; } = 0;

        // ✅ ADD CONVERTER HERE
        [JsonPropertyName("disc_amt")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string DiscAmt { get; set; } = "0.00";

        [JsonPropertyName("sub_total")]
        public decimal SubTotal { get; set; }

        // ✅ ADD CONVERTER HERE
        [JsonPropertyName("pro_disc_amt")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string ProDiscAmt { get; set; } = "0.00";

        // ✅ ADD CONVERTER HERE
        [JsonPropertyName("svc_amt")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string SvcAmt { get; set; } = "0.000000";

        [JsonPropertyName("is_apply_svc")]
        public int IsApplySvc { get; set; } = 0;

        // ✅ ADD CONVERTER HERE
        [JsonPropertyName("tax_amt")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string TaxAmt { get; set; } = "0.000000";

        [JsonPropertyName("tax_rate")]
        public decimal TaxRate { get; set; } = 0;

        [JsonPropertyName("tax_value")]
        public decimal TaxValue { get; set; } = 0;

        [JsonPropertyName("is_absorbtax")]
        public int IsAbsorbtax { get; set; } = 0;

        [JsonPropertyName("take_away_item")]
        public string TakeAwayItem { get; set; } = "N";

        [JsonPropertyName("order_seq")]
        public int OrderSeq { get; set; }

        [JsonPropertyName("order_seq_type")]
        public string OrderSeqType { get; set; } = "New";

        [JsonPropertyName("order_datetime")]
        public string OrderDatetime { get; set; } = "";

        [JsonPropertyName("print_flag")]
        public string PrintFlag { get; set; } = "N";

        [JsonPropertyName("item_kds_ready_status")]
        public string ItemKdsReadyStatus { get; set; } = "N";

        [JsonPropertyName("item_kds_ready_datetime")]
        public string ItemKdsReadyDatetime { get; set; } = "";

        [JsonPropertyName("item_kds_serve_status")]
        public string ItemKdsServeStatus { get; set; } = "N";

        [JsonPropertyName("item_kds_serve_datetime")]
        public string ItemKdsServeDatetime { get; set; } = "";

        [JsonPropertyName("override_f")]
        public int OverrideF { get; set; } = 0;

        [JsonPropertyName("is_addon_enable")]
        public string IsAddonEnable { get; set; } = "N";

        [JsonPropertyName("add_on_name")]
        public string AddOnName { get; set; } = "";

        [JsonPropertyName("menu_type")]
        public string MenuType { get; set; } = "";

        [JsonPropertyName("modifier_name")]
        public string ModifierName { get; set; } = "";

        [JsonPropertyName("ref_1")]
        public string Ref1 { get; set; } = "";

        [JsonPropertyName("ref_2")]
        public string Ref2 { get; set; } = "";

        [JsonPropertyName("ref_3")]
        public string Ref3 { get; set; } = "";

        [JsonPropertyName("ref_4")]
        public string Ref4 { get; set; } = "";
    }
    /// <summary>
    /// Item modifier/addon
    /// </summary>
    public class ItemModifier
    {
        [JsonPropertyName("modifier_code")]
        public string ModifierCode { get; set; }

        [JsonPropertyName("modifier_name")]
        public string ModifierName { get; set; }

        [JsonPropertyName("modifier_name_zh")]
        public string ModifierNameZh { get; set; }

        [JsonPropertyName("price")]
        public string Price { get; set; }

        [JsonPropertyName("qty")]
        public decimal Qty { get; set; } = 1;
    }

    /// <summary>
    /// Service charges detail
    /// </summary>
    public class SalesServiceDetail
    {
        [JsonPropertyName("service_code")]
        public string ServiceCode { get; set; }

        [JsonPropertyName("service_name")]
        public string ServiceName { get; set; }

        [JsonPropertyName("service_type")]
        public string ServiceType { get; set; } // P = Percentage, A = Amount

        [JsonPropertyName("service_value")]
        public decimal ServiceValue { get; set; }

        [JsonPropertyName("service_amt")]
        public string ServiceAmt { get; set; }

        [JsonPropertyName("is_taxable")]
        public bool IsTaxable { get; set; } = false;
    }

    /// <summary>
    /// Payment detail
    /// </summary>
    public class SalesPaymentDetail
    {
        [JsonPropertyName("payment_name")]       // or "payment_code" — match your JS
        public string? PaymentCode { get; set; }

        [JsonPropertyName("tender_amt")]         // match your JS  
        public decimal? PaymentAmt { get; set; }

        [JsonPropertyName("payment_type")]
        public string? PaymentType { get; set; }

        [JsonPropertyName("s_no")]
        public int SNo { get; set; }

        [JsonPropertyName("ref_info")]
        public string? RefInfo { get; set; }

        [JsonPropertyName("currency_name")]
        public string? CurrencyName { get; set; }

        [JsonPropertyName("exch_rate")]
        public string? ExchRate { get; set; }

        [JsonPropertyName("currency_amount")]
        public string? CurrencyAmount { get; set; }
    }

    /// <summary>
    /// Service type information
    /// </summary>
    public class ServiceTypeInfo
    {
        [JsonPropertyName("service_type")]
        public string ServiceType { get; set; }

        [JsonPropertyName("service_type_info")]
        public string ServiceTypeInfoDesc { get; set; }

        [JsonPropertyName("is_default")]
        public bool IsDefault { get; set; } = false;
    }

    /// <summary>
    /// Store configuration
    /// </summary>
    public class StoreConfig
    {
        [JsonPropertyName("store_code")]
        public string StoreCode { get; set; }

        [JsonPropertyName("store_name")]
        public string StoreName { get; set; }

        [JsonPropertyName("is_absorbtax")]
        public bool IsAbsorbTax { get; set; } = false;

        [JsonPropertyName("tax_rate")]
        public decimal TaxRate { get; set; }

        [JsonPropertyName("service_charge_rate")]
        public decimal ServiceChargeRate { get; set; }

        [JsonPropertyName("currency")]
        public string Currency { get; set; } = "SGD";
    }
}