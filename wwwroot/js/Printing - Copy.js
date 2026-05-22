import {
    API_URL,
    DATE_FORMAT,
    DATE_TIME_FORMAT,
    KITCHEN_PRINT_TYPE,
    STATUS,
    NOTO_FONT,
    PRINT_SERVICE,
    PROMO_TYPE,
    STOCK_TYPE,
    TIME_FORMAT,
    RECEIPT_PRINT_TYPE,
    KITCHEN_STATUS,
    TQR_PRINT_TYPE,
    DISPLAY_DATE_FORMAT,
    KITCHEN_PRINTING,
} from "../utils/constants.js";
import {
    bool,
    clone,
    contains,
    getNowInAPIFormat,
    isImageExisted,
    jspdfGetNextLineY,
    newPDF,
    same,
    timestamp
} from "../utils/common.js";
import dayjs from "https://esm.sh/dayjs";
import {
    getNowWithLoginDate,
    getSetting,
    getSysSetting,
    isAddon2Item,
    isAddonItem,
    isOpenItem,
    isWeightableItem,
    notFreeItem,
    sortOrderItems,
} from "../utils/pos.js";
import html2canvas from "https://esm.sh/html2canvas";
import QRCode from "https://esm.sh/qrcode";
import { useCache } from '../stores/cache-store.js';




const print = async (pdfBlob, printerName, fileName, url = 'http://localhost/API/printer/print') => {
    console.group('📤 [print] Sending to printer');
    console.log('printerName :', printerName);
    console.log('fileName    :', fileName);
    console.log('blobSize    :', pdfBlob?.size);
    console.groupEnd();

    if (!printerName || printerName.trim() === '') {
        console.warn('⚠️ [print] Empty printerName — aborting');
        return false;
    }

    try {
        const formData = new FormData();
        formData.append('printerName', printerName);
        formData.append('fileName', fileName);
        formData.append('file', pdfBlob, fileName);

        const res = await fetch('http://localhost/API/printer/print', { // Use absolute path to be safe
            method: 'POST',
            body: formData
        });

        const contentType = res.headers.get("content-type");
        if (!res.ok || !contentType || !contentType.includes("application/json")) {
            const text = await res.text();
            console.error("❌ Server sent non-JSON response. Check C# logs.", text);
            return false;
        }
        const data = await res.json();
        console.log('📨 [print] Response:', { ok: res.ok, success: data.success, message: data.message, printerName });

        if (!data.success) {
            console.warn(`⚠️ [print] Logic Failed [${printerName}]: ${data.message}`);
            return false;
        }

        console.log(`🖨️ [PRINT] Success [${printerName}]: ${fileName}`);
        return true;

    } catch (err) {
        console.error("❌ [print] Critical failure in print utility:", err);
        return false;
    }
};


/**
 * 1. RESOLVER: Matches the item's printer code to the physical Printer Name
 */
function getPhysicalPrinterName(itemPrinterCode) {
    // Get the settings you cached earlier in getStoreRegisterSettings
    const settings = useCache().getPrinterSettings() || [];

    // Find the record where setting_code matches (e.g., "K1" or "HOTPOT MEAT")
    const match = settings.find(s =>
        s.setting_code.trim().toUpperCase() === itemPrinterCode.trim().toUpperCase()
    );

    // Return the 'setting_value' (e.g., "K3"), or fallback to the code itself
    if (match && match.setting_value) {
        console.log(`🔍 Resolved Printer: ${itemPrinterCode} -> ${match.setting_value}`);
        return match.setting_value;
    }

    console.warn(`⚠️ No mapping found for printer code: ${itemPrinterCode}. Using as-is.`);
    return itemPrinterCode || "K1";
}

/**
 * 2. MODIFIED HANDLER: Groups by RESOLVED printer names
 */
async function handleKitchenPrinting(kprint_dtls) {
    if (!kprint_dtls || kprint_dtls.length === 0) {
        console.warn("⚠️ No kitchen items to print.");
        return;
    }

    // Group items by their RESOLVED physical printer name
    const grouped = kprint_dtls.reduce((acc, item) => {
        // Use the resolver to get the actual "setting_value" (e.g., S1, K3)
        const rawCode = item.printer_name || item.printer_id || "K1";
        const physicalPrinter = getPhysicalPrinterName(rawCode);

        if (!acc[physicalPrinter]) acc[physicalPrinter] = [];
        acc[physicalPrinter].push(item);
        return acc;
    }, {});

    // Loop through each physical printer group
    for (const [printer, items] of Object.entries(grouped)) {
        // Skip if printer name is empty (like the "SUMMARY" setting in your JSON)
        if (!printer || printer === "null") continue;

        console.log(`🖨️ Preparing Kitchen Print for: ${printer} (${items.length} items)`);

        try {
            // Generate your PDF blob
            const pdfBlob = await generateKitchenPdfBlob(items);
            const fileName = `Kitchen_${printer}_${Date.now()}.pdf`;

            // Fire to the specific Kitchen IP Endpoint
            await printToKitchen(printer, pdfBlob, fileName);
        } catch (err) {
            console.error(`❌ Error in Kitchen PDF generation for ${printer}:`, err);
        }
    }
}

/**
 * 3. THE PRINT CALL: Sends the data to the C# API
 */
async function printToKitchen(printerName, pdfBlob, fileName) {
    const kitchenEndpoint = "http://10.0.194.30:503/API/printer/print";

    const formData = new FormData();
    formData.append("printerName", printerName); // This is now the "setting_value" (e.g. K3, S1)
    formData.append("fileName", fileName);
    formData.append("rotate", "false");
    formData.append("file", pdfBlob, fileName);

    try {
        const response = await fetch(kitchenEndpoint, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`❌ Kitchen Print Failed (${printerName}):`, errText);
            return false;
        }

        const result = await response.json();
        console.log(`✅ Kitchen Print Success (${printerName}):`, result);
        return true;
    } catch (error) {
        console.error(`❌ Kitchen Network Error (${printerName}):`, error);
        return false;
    }
}

// ── printReceiptAsPng ─────────────────────────────────────────────────────────
// Converts jsPDF doc → PNG via canvas, then sends PNG to the print service.
// Thermal printers have no PDF renderer — they need raster image input.
const printReceiptAsPng = async (doc, printerName, pdfName) => {
    try {
        const pdfBlob = doc.output('blob');
        const url = URL.createObjectURL(pdfBlob);
        window.open(url); // opens in a new tab
        console.log(`🖨️ [printReceiptAsPng] Sending raw PDF → ${printerName} | ${pdfName}`);
        const success = await print(pdfBlob, printerName, pdfName, null);
        if (!success) {
            console.error(`❌ [printReceiptAsPng] Failed → ${printerName}`);
        } else {
            console.log(`✅ [printReceiptAsPng] Done: ${pdfName}`);
        }
    } catch (err) {
        console.error('❌ [printReceiptAsPng] Error:', err);
    }
};


export const kitchenPrint = async (
    type,
    data,
    printSNo = null,
    tableFrom = null
) => {
    try {
        const { printerSettings, register, printConfig } = useCache();
        const doc = await newPDF();
        const safeSetFont = (fontFamily) => {
            const fallback = printConfig?.Receipt?.DashDivider?.fontFamily
                ?? printConfig?.Receipt?.StarDivider?.fontFamily
                ?? 'helvetica';
            const font = fontFamily ?? fallback;
            try {
                doc.setFont(font);
            } catch {
                console.warn(`⚠️ [safeSetFont] "${font}" not registered — using helvetica`);
                doc.setFont('helvetica');
            }
        };

        if (!printConfig?.Kitchen || typeof printConfig.Kitchen !== 'object') {
            console.warn('🖨️ [kitchen] BAIL: no printConfig.Kitchen');
            return;
        }

        if (data) {
            let sales_dtls = data?.sales_dtls;

            // Format sales_dtls to object
            if (sales_dtls && typeof sales_dtls === "string") {
                sales_dtls = JSON.parse(sales_dtls);
            }

            console.log('🖨️ [kitchen] printConfig?.Kitchen:', !!printConfig?.Kitchen);
            console.log('🖨️ [kitchen] data?.sales_dtls length:', data?.sales_dtls?.length);
            console.log('🖨️ [kitchen] printers found:', printerSettings);
            console.log('🖨️ [kitchen] first item printer_name:', sales_dtls[0]?.printer_name);
            console.log('🖨️ [kitchen] first item e:', sales_dtls[0]?.e);

            // Check if sales_dtls is an array
            if (!Array.isArray(sales_dtls)) return;

            sales_dtls?.forEach((v) => {
                // Print only selected items
                if (printSNo) {
                    if (printSNo.includes(v.s_no)) {
                        v.print_flag = "Y";
                    } else {
                        v.print_flag = "N";
                    }
                }

                // Auto print to print all items
                if (same(type, KITCHEN_PRINT_TYPE.AUTO)) {
                    v.print_flag = "Y";
                }

                // Do not print take away charge item
                if (
                    same(v?.item_no, getSysSetting("System Settings", "ta_fixed_item_no"))
                ) {
                    v.print_flag = "N";
                }

                // Change all the qty to negative for void kitchen print type
                if (same(type, KITCHEN_PRINT_TYPE.VOID)) {
                    v.qty = -v.qty;
                }
            });

            sales_dtls?.forEach((s) => {
                s.ref_print = 0;
            });

            sales_dtls.forEach((orderitem) => {
                if (!orderitem.e || !orderitem.e[0]) return; // no e[] = trust printer_name from POS as-is
                if (
                    orderitem.e[0].category_kitchen_print_by === 1 &&
                    orderitem.take_away_item !== "N"
                ) {
                    orderitem.printer_name = "";
                } else if (
                    orderitem.e[0].category_kitchen_print_by === 2 &&
                    orderitem.take_away_item !== "Y"
                ) {
                    orderitem.printer_name = "";
                }
            });

            // Pre-update print status to Y to avoid double-notify and duplicate kitchen printing
            let tempData = clone(data);
            tempData.sales_dtls?.forEach((v) => (v.print_flag = "Y"));

            // POST posorderkitchen/update - fire and forget, silent
            fetch('/API/printer/posorderkitchen/update', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(tempData),
            })
                .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
                .catch(err => console.error('❌ Kitchen PRE-UPDATE failed:', err));

            let printers = Array.from(
                new Set(
                    sales_dtls
                        ?.map((orderitem) => orderitem.printer_name)
                        ?.filter((printer) => !!printer)
                )
            );

            const printQueue = [];

            printers.forEach(async (printer_name) => {
                if (printer_name) {
                    const kPrinterName = printerSettings?.filter((v) => {
                        return v.setting_code === printer_name;
                    })[0];

                    if (!kPrinterName?.setting_value) return;

                    if (!same(kPrinterName.setting_desc, "LABELPRINT")) {
                        const orderItems = sales_dtls?.filter(
                            (orderitem) =>
                                same(orderitem?.printer_name, printer_name) &&
                                !bool(orderitem?.ref_print) &&
                                bool(orderitem?.print_flag)
                        );

                        if (orderItems?.length <= 0) return;

                        try {
                            //Header
                            var sales_no = data?.sales_no;
                            var status = data?.order_status_desc;
                            var no_of_pax = data?.no_of_pax;
                            var register_name = register?.register_name;
                            var doc_date = dayjs(data?.doc_date).format(DATE_TIME_FORMAT);
                            var m_userid = data?.m_userid;
                            var table_no = data?.table_no;

                            if (
                                contains(
                                    [
                                        "SUMMARY",
                                        "BOTH",
                                        "SUMMARYFLANG",
                                        "BOTHFLANG",
                                        "DOTMATRIX_SUMMARY",
                                        "DOTMATRIX_BOTHFLANG",
                                    ],
                                    kPrinterName.setting_desc
                                )
                            ) {
                                const doc = await newPDF();

                                var x = printConfig?.Kitchen?.x;
                                var y = printConfig?.Kitchen?.y;
                                var maxWidth = printConfig?.Kitchen?.maxWidth;
                                var pageHeight = doc.internal.pageSize.height - 10;

                                if (contains(["DOTMATRIX"], kPrinterName.setting_desc, false)) {
                                    x = 7;
                                }

                                const maxOrderSeq = Math.max.apply(
                                    Math,
                                    orderItems?.map((item) => {
                                        return item.order_seq;
                                    })
                                );

                                // Topmost Table No
                                if (table_no && printConfig?.Kitchen?.TopmostTableNo.visible) {
                                    y = y + printConfig?.Kitchen?.EmptyLine;

                                    doc.setFont(printConfig?.Kitchen?.TopmostTableNo.fontFamily);
                                    doc.setFontSize(
                                        printConfig?.Kitchen?.TopmostTableNo.fontSize
                                    );
                                    doc.setTextColor(
                                        printConfig?.Kitchen?.TopmostTableNo.fontColor
                                    );
                                    doc.text(
                                        printConfig?.Kitchen?.TopmostTableNo.label + table_no,
                                        x,
                                        y
                                    );
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Additional Items
                                if (
                                    printConfig?.Kitchen?.AdditionalItems &&
                                    maxOrderSeq > 1 &&
                                    !same(type, KITCHEN_PRINT_TYPE.MANUAL) &&
                                    !same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM)
                                ) {
                                    doc.setFont(printConfig?.Kitchen?.AdditionalItems.fontFamily);
                                    doc.setFontSize(
                                        printConfig?.Kitchen?.AdditionalItems.fontSize
                                    );
                                    doc.setTextColor(
                                        printConfig?.Kitchen?.AdditionalItems.fontColor
                                    );
                                    doc.text(printConfig?.Kitchen?.AdditionalItems.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                y = jspdfGetNextLineY(doc, y);

                                // Self Collect Order
                                if (
                                    !table_no &&
                                    contains(["SAL-TQR", "SAL-WOR"], sales_no, false)
                                ) {
                                    doc.text("SELF COLLECT ORDER", x, y);
                                    y = jspdfGetNextLineY(doc, y);

                                    doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                    doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Table Transfer
                                if (tableFrom && printConfig?.Kitchen?.TransferTable.visible) {
                                    y = y + printConfig?.Kitchen?.EmptyLine;

                                    doc.setFont(printConfig?.Kitchen?.TransferTable.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.TransferTable.fontSize);
                                    doc.setTextColor(
                                        printConfig?.Kitchen?.TransferTable.fontColor
                                    );
                                    doc.text(
                                        `${printConfig?.Kitchen?.TransferTable.label} ${tableFrom} to ${table_no}`,
                                        x,
                                        y
                                    );
                                    y = jspdfGetNextLineY(doc, y);

                                    y = y + printConfig?.Kitchen?.EmptyLine;

                                    doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                    doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Cancel
                                if (
                                    same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM) &&
                                    printConfig?.Kitchen?.Cancel.visible
                                ) {
                                    y = y + printConfig?.Kitchen?.EmptyLine;

                                    doc.setFont(printConfig?.Kitchen?.Cancel.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.Cancel.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.Cancel.fontColor);
                                    doc.text(printConfig?.Kitchen?.Cancel.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);

                                    y = y + printConfig?.Kitchen?.EmptyLine;

                                    doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                    doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Void
                                if (status === "Void" && printConfig?.Kitchen?.Void.visible) {
                                    y = y + printConfig?.Kitchen?.EmptyLine;

                                    doc.setFont(printConfig?.Kitchen?.Void.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.Void.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.Void.fontColor);
                                    doc.text(printConfig?.Kitchen?.Void.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                    y = y + printConfig?.Kitchen?.EmptyLine;

                                    doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                    doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Header
                                if (printConfig?.Kitchen?.Header.visible) {
                                    doc.setFont(printConfig?.Kitchen?.Header.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.Header.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.Header.fontColor);
                                    doc.text(printConfig?.Kitchen?.Header.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Printer Name
                                if (printConfig?.Kitchen?.PrinterName.visible) {
                                    doc.setFont(printConfig?.Kitchen?.PrinterName.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.PrinterName.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.PrinterName.fontColor);
                                    doc.text(kPrinterName?.setting_code, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                y = y + printConfig?.Kitchen?.EmptyLine;

                                // Table No
                                if (table_no && printConfig?.Kitchen?.TableNo.visible) {
                                    doc.setFont(printConfig?.Kitchen?.TableNo.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.TableNo.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.TableNo.fontColor);
                                    doc.text(
                                        `${printConfig?.Kitchen?.TableNo.label} ${table_no}`,
                                        x,
                                        y,
                                        {
                                            align: "left",
                                        }
                                    );
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Queue No
                                if (printConfig?.Kitchen?.QueueNo.visible) {
                                    doc.setFont(printConfig?.Kitchen?.QueueNo.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.QueueNo.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.QueueNo.fontColor);
                                    doc.text(
                                        `${printConfig?.Kitchen?.QueueNo.label} ${sales_no
                                            .substring(17, 19)
                                            .trim()}`,
                                        x,
                                        y
                                    );
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Register
                                if (printConfig?.Kitchen?.Register.visible) {
                                    doc.setFont(printConfig?.Kitchen?.Register.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.Register.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.Register.fontColor);
                                    doc.text(
                                        printConfig?.Kitchen?.Register.label + register_name,
                                        x,
                                        y
                                    );
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Short Sales No
                                if (printConfig?.Kitchen?.ShortSalesNo.visible) {
                                    doc.setFont(printConfig?.Kitchen?.ShortSalesNo.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.ShortSalesNo.fontSize);
                                    doc.setTextColor(
                                        printConfig?.Kitchen?.ShortSalesNo.fontColor
                                    );
                                    doc.text(
                                        `${printConfig?.Kitchen?.ShortSalesNo.label} ${sales_no
                                            .substring(4, 7)
                                            .trim()}-${sales_no.substring(15, 19).trim()}`,
                                        x,
                                        y
                                    );
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Sales No
                                if (printConfig?.Kitchen?.SalesNo.visible) {
                                    doc.setFont(printConfig?.Kitchen?.SalesNo.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.SalesNo.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.SalesNo.fontColor);
                                    doc.text(
                                        `${printConfig?.Kitchen?.SalesNo.label} ${sales_no}`,
                                        x,
                                        y
                                    );
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Date & Time
                                if (printConfig?.Kitchen?.DateTime.visible) {
                                    doc.setFont(printConfig?.Kitchen?.DateTime.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.DateTime.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.DateTime.fontColor);
                                    doc.text(
                                        `${printConfig?.Kitchen?.DateTime.label} ${doc_date}`,
                                        x,
                                        y
                                    );
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // User
                                if (printConfig?.Kitchen?.User.visible) {
                                    doc.setFont(printConfig?.Kitchen?.User.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.User.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.User.fontColor);
                                    doc.text(
                                        `${printConfig?.Kitchen?.User.label} ${m_userid}`,
                                        x,
                                        y
                                    );
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                // Status
                                if (printConfig?.Kitchen?.Status.visible) {
                                    doc.setFont(printConfig?.Kitchen?.Status.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.Status.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.Status.fontColor);
                                    doc.text(
                                        `${printConfig?.Kitchen?.Status.label} ${status}`,
                                        x,
                                        y
                                    );
                                }

                                // No of Pax
                                if (printConfig?.Kitchen?.NoOfPax.visible) {
                                    doc.setFont(printConfig?.Kitchen?.NoOfPax.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.NoOfPax.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.NoOfPax.fontColor);
                                    doc.text(
                                        `${printConfig?.Kitchen?.NoOfPax.label} ${no_of_pax}`,
                                        maxWidth,
                                        y,
                                        {
                                            align: "right",
                                        }
                                    );
                                }
                                y = jspdfGetNextLineY(doc, y);

                                doc.setFont(printConfig?.Kitchen?.DashDivider.fontFamily);
                                doc.setFontSize(printConfig?.Kitchen?.DashDivider.fontSize);
                                doc.setTextColor(printConfig?.Kitchen?.DashDivider.fontColor);
                                doc.text(printConfig?.Kitchen?.DashDivider.label, x, y);
                                y = jspdfGetNextLineY(doc, y);

                                var Qty_X = printConfig?.Kitchen?.QtyValue.x;
                                var Items_X = printConfig?.Kitchen?.ItemsValue.x;

                                var lstTakeEat = Array.from(
                                    new Set(orderItems?.map((o) => o.take_away_item))
                                );

                                if (true) {
                                    lstTakeEat?.forEach((te) => {
                                        var lstTakeAway = orderItems?.filter(function (v) {
                                            return v.take_away_item === te;
                                        });

                                        // Dine In
                                        if (
                                            te === "N" &&
                                            printConfig?.Kitchen?.DineIn.visible &&
                                            !contains(["T", "D"], data?.service_type)
                                        ) {
                                            doc.setFont(printConfig?.Kitchen?.DineIn.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.DineIn.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.DineIn.fontColor);
                                            doc.text(printConfig?.Kitchen?.DineIn.label, x, y);

                                            if (y >= pageHeight) {
                                                doc.addPage();
                                                y = printConfig?.Kitchen?.y;
                                            }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) {
                                                doc.addPage();
                                                y = printConfig?.Kitchen?.y;
                                            }
                                        }
                                        // Take Away
                                        else if (printConfig?.Kitchen?.TakeAway.visible) {
                                            doc.setFont(printConfig?.Kitchen?.TakeAway.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.TakeAway.fontSize);
                                            doc.setTextColor(
                                                printConfig?.Kitchen?.TakeAway.fontColor
                                            );
                                            doc.text(printConfig?.Kitchen?.TakeAway.label, x, y);

                                            if (y >= pageHeight) {
                                                doc.addPage();
                                                y = printConfig?.Kitchen?.y;
                                            }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) {
                                                doc.addPage();
                                                y = printConfig?.Kitchen?.y;
                                            }
                                        }

                                        lstTakeAway?.forEach((v, index) => {
                                            // Qty Value
                                            doc.setFont(printConfig?.Kitchen?.QtyValue.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.QtyValue.fontSize);
                                            doc.setTextColor(
                                                printConfig?.Kitchen?.QtyValue.fontColor
                                            );
                                            if (v.s_no == v.parent_sno) {
                                                if (isWeightableItem(v)) {
                                                    doc.text(
                                                        `   ${parseFloat(
                                                            v.qty
                                                        ).toString()} ${v.uom.toString()}`,
                                                        Qty_X,
                                                        y
                                                    );
                                                } else {
                                                    doc.text(`   ${v.qty.toString()}`, Qty_X, y);
                                                }
                                            }

                                            // Items Value
                                            doc.setFont(printConfig?.Kitchen?.ItemsValue.fontFamily);
                                            doc.setFontSize(
                                                printConfig?.Kitchen?.ItemsValue.fontSize
                                            );
                                            doc.setTextColor(
                                                printConfig?.Kitchen?.ItemsValue.fontColor
                                            );
                                            var ls_itemdesc = "";
                                            if (
                                                contains(
                                                    [
                                                        "SUMMARYFLANG",
                                                        "BOTHFLANG",
                                                        "DOTMATRIX_SUMMARY",
                                                        "DOTMATRIX_BOTHFLANG",
                                                    ],
                                                    kPrinterName.setting_desc
                                                )
                                            ) {
                                                if (v.s_no == v.parent_sno) {
                                                    ls_itemdesc = v.flang_desc.toString();
                                                } else {
                                                    ls_itemdesc = `(${v.qty.toString()}) ${v.flang_desc.toString()}`;
                                                }
                                            } else {
                                                if (v.s_no == v.parent_sno) {
                                                    ls_itemdesc = v.item_desc.toString();
                                                } else {
                                                    if (isWeightableItem(v)) {
                                                        ls_itemdesc = `(${parseFloat(
                                                            v.qty
                                                        ).toString()}) ${v.uom.toString()} ${v.item_desc.toString()}`;
                                                    } else {
                                                        ls_itemdesc = `(${parseFloat(
                                                            v.qty
                                                        ).toString()}) ${v.item_desc.toString()}`;
                                                    }
                                                }
                                            }
                                            var splitText = doc.splitTextToSize(
                                                ls_itemdesc,
                                                maxWidth - Items_X - 1
                                            );
                                            for (
                                                var i = 0, length = splitText.length;
                                                i < length;
                                                i++
                                            ) {
                                                if (isWeightableItem(v) && v.s_no == v.parent_sno) {
                                                    doc.text(splitText[i], Items_X + 17, y);
                                                } else {
                                                    doc.text(splitText[i], Items_X, y);
                                                }
                                                if (i < splitText.length - 1) {
                                                    if (y >= pageHeight) {
                                                        doc.addPage();
                                                        y = printConfig?.Kitchen?.y;
                                                    }
                                                    y = jspdfGetNextLineY(doc, y);
                                                    if (y >= pageHeight) {
                                                        doc.addPage();
                                                        y = printConfig?.Kitchen?.y;
                                                    }
                                                }
                                            }

                                            // Remarks
                                            if (v.remarks && printConfig?.Kitchen.Remarks.visible) {
                                                var ls_itemremarks = v.remarks.toString();
                                                var splitRemarks = [];
                                                var currentLine = "";
                                                var maxLineWidth = maxWidth - Items_X - 1;

                                                for (
                                                    var charIndex = 0;
                                                    charIndex < ls_itemremarks.length;
                                                    charIndex++
                                                ) {
                                                    var testLine = currentLine + ls_itemremarks[charIndex];
                                                    var testWidth = doc.getTextWidth(testLine);

                                                    if (
                                                        testWidth > maxLineWidth &&
                                                        currentLine.length > 0
                                                    ) {
                                                        splitRemarks.push(currentLine);
                                                        currentLine = ls_itemremarks[charIndex];
                                                    } else {
                                                        currentLine = testLine;
                                                    }
                                                }

                                                if (currentLine.length > 0) {
                                                    splitRemarks.push(currentLine);
                                                }
                                                for (
                                                    var i = 0, remarksLength = splitRemarks.length;
                                                    i < remarksLength;
                                                    i++
                                                ) {
                                                    if (y >= pageHeight) {
                                                        doc.addPage();
                                                        y = printConfig?.Kitchen.y;
                                                    }
                                                    y = jspdfGetNextLineY(doc, y);
                                                    if (y >= pageHeight) {
                                                        doc.addPage();
                                                        y = printConfig?.Kitchen.y;
                                                    }

                                                    if (v.s_no == v.parent_sno) {
                                                        if (i == 0) {
                                                            doc.text("**", Qty_X, y);
                                                            doc.text(splitRemarks[i], Items_X, y);
                                                        } else {
                                                            doc.text(splitRemarks[i], Items_X, y);
                                                        }
                                                    } else {
                                                        if (i == 0) {
                                                            doc.text("**", Items_X, y);
                                                            doc.text(splitRemarks[i], Items_X + 7, y);
                                                        } else {
                                                            doc.text(splitRemarks[i], Items_X + 7, y);
                                                        }
                                                    }
                                                }
                                            }

                                            // Check if there's a next element with the same parent_sno
                                            if (index < lstTakeAway.length - 1) {
                                                const nextElement = lstTakeAway[index + 1];
                                                if (nextElement.parent_sno !== v.parent_sno) {
                                                    if (y >= pageHeight) {
                                                        doc.addPage();
                                                        y = printConfig?.Kitchen?.y;
                                                    }
                                                    y = jspdfGetNextLineY(doc, y);
                                                    if (y >= pageHeight) {
                                                        doc.addPage();
                                                        y = printConfig?.Kitchen?.y;
                                                    }
                                                }
                                            }

                                            if (y >= pageHeight) {
                                                doc.addPage();
                                                y = printConfig?.Kitchen?.y;
                                            }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) {
                                                doc.addPage();
                                                y = printConfig?.Kitchen?.y;
                                            }
                                        });

                                        if (y >= pageHeight) {
                                            doc.addPage();
                                            y = printConfig?.Kitchen?.y;
                                        }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) {
                                            doc.addPage();
                                            y = printConfig?.Kitchen?.y;
                                        }
                                    });
                                }

                                // Footer
                                doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);

                                var customers = customers?.filter(function (cus) {
                                    return cus.customer_code === data?.customer_code;
                                });

                                if (
                                    (sales_no.includes("SAL-TQR") ||
                                        sales_no.includes("SAL-WOR")) &&
                                    (data?.ref_1.toUpperCase().includes("DELI") ||
                                        data?.ref_1.toUpperCase().includes("TAKE")) &&
                                    printConfig?.Kitchen?.DeliveryOrderInfo.visible
                                ) {
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                    doc.setFont(printConfig?.Kitchen?.DeliveryOrderInfo.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.DeliveryOrderInfo.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.DeliveryOrderInfo.fontColor);
                                    doc.text(printConfig?.Kitchen?.DeliveryOrderInfo.label, x, y);

                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                    var customerName = "";
                                    var contact_no = "";
                                    var card_no = "";
                                    var email = "";
                                    var address = "";
                                    if (customers?.length > 0) {
                                        customerName = `${customers[0].first_name} - ${customers[0].last_name}`;
                                        contact_no = customers[0].contact_no;
                                        card_no = customers[0].card_no;
                                        email = customers[0].email;
                                        var lstaddress = customers[0].custaddrinfodtls;
                                        address = lstaddress[0].address;
                                        if (lstaddress[0].address == "") {
                                            address += `${lstaddress[0].country_name} - ${lstaddress[0].postal_code}`;
                                        } else {
                                            address += `, ${lstaddress[0].country_name} - ${lstaddress[0].postal_code}`;
                                        }
                                    }

                                    doc.text(`Customer : ${customerName}`, x, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                    doc.text(`Phone No : ${contact_no}`, x, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                    doc.text(`Card No : ${card_no}`, x, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                    doc.text(`Customer Email : ${email}`, x, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                    if (address) {
                                        var start_index = 0;
                                        var value_end_index = 32;
                                        var length = address.length / value_end_index;
                                        for (var k = 0; k < length; k++) {
                                            if (k == 0) {
                                                doc.text(`Cust Addr : ${address.substring(start_index, value_end_index).trim()}`, x, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                y = jspdfGetNextLineY(doc, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            } else {
                                                doc.text(`${address.substring(start_index, value_end_index).trim()}`, x + "Cust Addr : ".length + 6, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                y = jspdfGetNextLineY(doc, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            }
                                            start_index = value_end_index;
                                            value_end_index = value_end_index + value_end_index;
                                        }
                                    } else {
                                        doc.text("Cust Addr : ", x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    }

                                    doc.text("Mode Of Order : " + data?.ref_1, x, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                    var spl_remarks = data?.ref_2;
                                    if (spl_remarks) {
                                        var start_index = 0;
                                        value_end_index = 29;
                                        var length = spl_remarks.length / value_end_index;
                                        for (var k = 0; k < length; k++) {
                                            if (k == 0) {
                                                doc.text(`SPL Remarks : ${spl_remarks.substring(start_index, value_end_index).trim()}`, x, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                y = jspdfGetNextLineY(doc, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            } else {
                                                doc.text(`${spl_remarks.substring(start_index, value_end_index).trim()}`, x + "PL Remarks : ".length + 10, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                y = jspdfGetNextLineY(doc, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            }
                                            start_index = value_end_index;
                                            value_end_index = value_end_index + value_end_index;
                                        }
                                    } else {
                                        doc.text("SPL Remarks : ", x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    }

                                    if (data?.ref_1.toUpperCase().includes("DELI")) {
                                        doc.text(`Delivery Date Time : ${data?.ref_3}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    }

                                    if (data?.ref_1.toUpperCase().includes("TAKE")) {
                                        doc.text(`Pickup Date Time : ${data?.ref_4}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    }

                                    doc.text(`Order Ref.No : ${data?.ref_5}`, x, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                    doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                    doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                    doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                    doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                const pdf = doc.output("blob");

                                const pdfName = `EvolutPOS_${kPrinterName.setting_value
                                    }_${timestamp()}_${same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM)
                                        ? "CANCEL_ITEM"
                                        : ""
                                    }_${kPrinterName.setting_desc}_${sales_no}_Kitchen_Receipt.pdf`;
                                if (
                                    same(
                                        getSetting("MORE", "GENERAL", "PRINT_OPTION"),
                                        PRINT_SERVICE.PRINT
                                    )
                                ) {
                                    printQueue.push({
                                        pdfName,
                                        type: KITCHEN_PRINTING.SUMMARY,
                                        func: async () =>
                                            await print(
                                                pdf,
                                                kPrinterName.setting_value,
                                                pdfName,
                                                doc
                                            ),
                                    });
                                } else {
                                    doc.save(pdfName);
                                }
                            }

                            if (
                                contains(
                                    [
                                        "SINGLE",
                                        "BOTH",
                                        "SINGLEFLANG",
                                        "BOTHFLANG",
                                        "DOTMATRIX_SINGLEFLANG",
                                        "DOTMATRIX_BOTHFLANG",
                                    ],
                                    kPrinterName.setting_desc
                                )
                            ) {
                                var single_print_index = 0;
                                var lstTakeEat = Array.from(
                                    new Set(sales_dtls?.map((o) => o.take_away_item))
                                );
                                lstTakeEat?.forEach((te) => {
                                    var lstTakeAway = sales_dtls?.filter(function (v) {
                                        return v.take_away_item === te;
                                    });

                                    lstTakeAway?.forEach(async (v) => {
                                        single_print_index = single_print_index + 1;

                                        const doc = await newPDF();

                                        var x = printConfig?.Kitchen?.x;
                                        var y = printConfig?.Kitchen?.y;
                                        var maxWidth = printConfig?.Kitchen?.maxWidth;
                                        var pageHeight = doc.internal.pageSize.height - 10;

                                        if (
                                            contains(["DOTMATRIX"], kPrinterName.setting_desc, false)
                                        ) {
                                            x = 7;
                                        }

                                        const maxOrderSeq = Math.max.apply(
                                            Math,
                                            sales_dtls?.map((item) => {
                                                return item.order_seq;
                                            })
                                        );

                                        // Topmost Table No
                                        if (table_no && printConfig?.Kitchen?.TopmostTableNo.visible) {
                                            y = y + printConfig?.Kitchen?.EmptyLine;
                                            doc.setFont(printConfig?.Kitchen?.TopmostTableNo.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.TopmostTableNo.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.TopmostTableNo.fontColor);
                                            doc.text(printConfig?.Kitchen?.TopmostTableNo.label + table_no, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Additional Items
                                        if (
                                            printConfig?.Kitchen?.AdditionalItems &&
                                            maxOrderSeq > 1 &&
                                            !same(type, KITCHEN_PRINT_TYPE.MANUAL) &&
                                            !same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM)
                                        ) {
                                            doc.setFont(printConfig?.Kitchen?.AdditionalItems.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.AdditionalItems.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.AdditionalItems.fontColor);
                                            doc.text(printConfig?.Kitchen?.AdditionalItems.label, x, y);
                                            y = y + printConfig?.Kitchen?.EmptyLine * 2;
                                        }

                                        doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                        doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                        doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                        doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                        y = jspdfGetNextLineY(doc, y);

                                        // Self Collect Order
                                        if (!table_no && contains(["SAL-TQR", "SAL-WOR"], sales_no, false)) {
                                            doc.text("SELF COLLECT ORDER", x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                            doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                            doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Table Transfer
                                        if (tableFrom && printConfig?.Kitchen?.TransferTable.visible) {
                                            y = y + printConfig?.Kitchen?.EmptyLine;
                                            doc.setFont(printConfig?.Kitchen?.TransferTable.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.TransferTable.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.TransferTable.fontColor);
                                            doc.text(`${printConfig?.Kitchen?.TransferTable.label} ${tableFrom} to ${table_no}`, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                            y = y + printConfig?.Kitchen?.EmptyLine;
                                            doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                            doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Cancel
                                        if (same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM) && printConfig?.Kitchen?.Cancel.visible) {
                                            y = y + printConfig?.Kitchen?.EmptyLine;
                                            doc.setFont(printConfig?.Kitchen?.Cancel.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.Cancel.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.Cancel.fontColor);
                                            doc.text(printConfig?.Kitchen?.Cancel.label, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                            y = y + printConfig?.Kitchen?.EmptyLine;
                                            doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                            doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Void
                                        if (status === "Void" && printConfig?.Kitchen?.Void.visible) {
                                            y = y + printConfig?.Kitchen?.EmptyLine;
                                            doc.setFont(printConfig?.Kitchen?.Void.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.Void.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.Void.fontColor);
                                            doc.text(printConfig?.Kitchen?.Void.label, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                            y = y + printConfig?.Kitchen?.EmptyLine;
                                            doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                            doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Single Header
                                        if (printConfig?.Kitchen?.SingleHeader.visible) {
                                            doc.setFont(printConfig?.Kitchen?.SingleHeader.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.SingleHeader.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.SingleHeader.fontColor);
                                            doc.text(printConfig?.Kitchen?.SingleHeader.label, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Printer Name
                                        if (printConfig?.Kitchen?.PrinterName.visible) {
                                            doc.setFont(printConfig?.Kitchen?.PrinterName.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.PrinterName.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.PrinterName.fontColor);
                                            doc.text(kPrinterName?.setting_code, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                            y = y + printConfig?.Kitchen?.EmptyLine;
                                        }

                                        // Table No
                                        if (table_no && printConfig?.Kitchen?.TableNo.visible) {
                                            doc.setFont(printConfig?.Kitchen?.TableNo.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.TableNo.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.TableNo.fontColor);
                                            doc.text(`${printConfig?.Kitchen?.TableNo.label} ${table_no}`, x, y, { align: "left" });
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Queue No
                                        if (printConfig?.Kitchen?.QueueNo.visible) {
                                            doc.setFont(printConfig?.Kitchen?.QueueNo.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.QueueNo.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.QueueNo.fontColor);
                                            doc.text(`${printConfig?.Kitchen?.QueueNo.label} ${sales_no.substring(17, 19).trim()}`, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Register
                                        if (printConfig?.Kitchen?.Register.visible) {
                                            doc.setFont(printConfig?.Kitchen?.Register.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.Register.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.Register.fontColor);
                                            doc.text(printConfig?.Kitchen?.Register.label + register_name, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Short Sales No
                                        if (printConfig?.Kitchen?.ShortSalesNo.visible) {
                                            doc.setFont(printConfig?.Kitchen?.ShortSalesNo.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.ShortSalesNo.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.ShortSalesNo.fontColor);
                                            doc.text(`${printConfig?.Kitchen?.ShortSalesNo.label} ${sales_no.substring(4, 7).trim()}-${sales_no.substring(15, 19).trim()}`, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Sales No
                                        if (printConfig?.Kitchen?.SalesNo.visible) {
                                            doc.setFont(printConfig?.Kitchen?.SalesNo.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.SalesNo.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.SalesNo.fontColor);
                                            doc.text(`${printConfig?.Kitchen?.SalesNo.label} ${sales_no}`, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Date & Time
                                        if (printConfig?.Kitchen?.DateTime.visible) {
                                            doc.setFont(printConfig?.Kitchen?.DateTime.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.DateTime.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.DateTime.fontColor);
                                            doc.text(`${printConfig?.Kitchen?.DateTime.label} ${doc_date}`, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // User
                                        if (printConfig?.Kitchen?.User.visible) {
                                            doc.setFont(printConfig?.Kitchen?.User.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.User.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.User.fontColor);
                                            doc.text(`${printConfig?.Kitchen?.User.label} ${m_userid}`, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        // Status
                                        if (printConfig?.Kitchen?.Status.visible) {
                                            doc.setFont(printConfig?.Kitchen?.Status.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.Status.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.Status.fontColor);
                                            doc.text(`${printConfig?.Kitchen?.Status.label} ${status}`, x, y);
                                        }

                                        // No of Pax
                                        if (printConfig?.Kitchen?.NoOfPax.visible) {
                                            doc.setFont(printConfig?.Kitchen?.NoOfPax.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.NoOfPax.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.NoOfPax.fontColor);
                                            doc.text(`${printConfig?.Kitchen?.NoOfPax.label} ${no_of_pax}`, maxWidth, y, { align: "right" });
                                        }
                                        y = jspdfGetNextLineY(doc, y);

                                        doc.setFont(printConfig?.Kitchen?.DashDivider.fontFamily);
                                        doc.setFontSize(printConfig?.Kitchen?.DashDivider.fontSize);
                                        doc.setTextColor(printConfig?.Kitchen?.DashDivider.fontColor);
                                        doc.text(printConfig?.Kitchen?.DashDivider.label, x, y);
                                        y = jspdfGetNextLineY(doc, y);

                                        var Qty_X = printConfig?.Kitchen?.QtyValue.x;
                                        var Items_X = printConfig?.Kitchen?.ItemsValue.x;

                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                        // Dine In
                                        if (te === "N" && printConfig?.Kitchen?.DineIn.visible && !contains(["T", "D"], data?.service_type)) {
                                            doc.setFont(printConfig?.Kitchen?.DineIn.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.DineIn.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.DineIn.fontColor);
                                            doc.text(printConfig?.Kitchen?.DineIn.label, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                        }

                                        var lstCombo = [];

                                        if (bool(getSetting("MORE", "KITCHEN", "KITCHEN_PRINT_SINGLE_PRINT_WITH_CHILD"))) {
                                            lstCombo = sales_dtls?.filter(function (i) {
                                                return (
                                                    (i.parent_sno === v.s_no || i.s_no === v.s_no) &&
                                                    i.printer_name === printer_name &&
                                                    i.ref_print === 0 &&
                                                    i.print_flag === "Y"
                                                );
                                            });
                                            if (lstCombo.length === 0) { return false; }

                                            sales_dtls?.forEach((s) => {
                                                var selectedCombo = lstCombo.filter(function (i) {
                                                    return (
                                                        (i.parent_sno === s.s_no || i.s_no === s.s_no) &&
                                                        i.printer_name === s.printer_name &&
                                                        i.print_flag === "Y"
                                                    );
                                                });
                                                if (selectedCombo.length > 0) { s.ref_print = 1; }
                                            });
                                        } else {
                                            lstCombo = sales_dtls?.filter(function (i) {
                                                return (
                                                    i.s_no === v.s_no &&
                                                    i.printer_name === printer_name &&
                                                    i.ref_print === 0 &&
                                                    i.print_flag === "Y"
                                                );
                                            });
                                            if (lstCombo.length === 0) { return false; }

                                            sales_dtls?.forEach((s) => {
                                                var selectedCombo = lstCombo.filter(function (i) {
                                                    return (
                                                        i.s_no === s.s_no &&
                                                        i.printer_name === s.printer_name &&
                                                        i.print_flag === "Y"
                                                    );
                                                });
                                                if (selectedCombo.length > 0) { s.ref_print = 1; }
                                            });
                                        }

                                        if (true) {
                                            lstCombo?.forEach((v) => {
                                                if (
                                                    printConfig?.Kitchen?.TakeAway.visible &&
                                                    (v.take_away_item === "Y" || contains(["T", "D"], data?.service_type))
                                                ) {
                                                    doc.setFont(printConfig?.Kitchen?.TakeAway.fontFamily);
                                                    doc.setFontSize(printConfig?.Kitchen?.TakeAway.fontSize);
                                                    doc.setTextColor(printConfig?.Kitchen?.TakeAway.fontColor);
                                                    doc.text(printConfig?.Kitchen?.TakeAway.label, x, y);
                                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                    y = jspdfGetNextLineY(doc, y);
                                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                }

                                                // Qty Value
                                                doc.setFont(printConfig?.Kitchen?.QtyValue.fontFamily);
                                                doc.setFontSize(printConfig?.Kitchen?.QtyValue.fontSize);
                                                doc.setTextColor(printConfig?.Kitchen?.QtyValue.fontColor);
                                                if (v.s_no == v.parent_sno) {
                                                    if (isWeightableItem(v)) {
                                                        doc.text(`   ${parseFloat(v.qty).toString()} ${v.uom.toString()}`, Qty_X, y);
                                                    } else {
                                                        doc.text(`   ${v.qty.toString()}`, Qty_X, y);
                                                    }
                                                }

                                                // Items Value
                                                doc.setFont(printConfig?.Kitchen?.ItemsValue.fontFamily);
                                                doc.setFontSize(printConfig?.Kitchen?.ItemsValue.fontSize);
                                                doc.setTextColor(printConfig?.Kitchen?.ItemsValue.fontColor);
                                                var ls_itemdesc = "";
                                                if (contains(["SINGLEFLANG", "BOTHFLANG", "DOTMATRIX_SINGLEFLANG"], kPrinterName.setting_desc)) {
                                                    if (v.s_no == v.parent_sno) {
                                                        ls_itemdesc = v.flang_desc.toString();
                                                    } else {
                                                        ls_itemdesc = `(${v.qty.toString()}) ${v.flang_desc.toString()}`;
                                                    }
                                                } else {
                                                    if (v.s_no == v.parent_sno) {
                                                        ls_itemdesc = v.item_desc.toString();
                                                    } else {
                                                        if (isWeightableItem(v)) {
                                                            ls_itemdesc = `(${parseFloat(v.qty).toString()}) ${v.uom.toString()} ${v.item_desc.toString()}`;
                                                        } else {
                                                            ls_itemdesc = `(${parseFloat(v.qty).toString()}) ${v.item_desc.toString()}`;
                                                        }
                                                    }
                                                }
                                                var splitText = doc.splitTextToSize(ls_itemdesc, maxWidth - Items_X - 1);
                                                for (var i = 0, length = splitText.length; i < length; i++) {
                                                    if (isWeightableItem(v) && v.s_no == v.parent_sno) {
                                                        doc.text(splitText[i], Items_X + 17, y);
                                                    } else {
                                                        doc.text(splitText[i], Items_X, y);
                                                    }
                                                    if (i < splitText.length - 1) {
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                        y = jspdfGetNextLineY(doc, y);
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                    }
                                                }

                                                // Remarks
                                                if (v.remarks && printConfig?.Kitchen?.Remarks.visible) {
                                                    var ls_itemremarks = v.remarks.toString();
                                                    var splitText = doc.splitTextToSize(ls_itemremarks, maxWidth);
                                                    for (var i = 0, length = splitText.length; i < length; i++) {
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                        y = jspdfGetNextLineY(doc, y);
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                                        if (v.s_no == v.parent_sno) {
                                                            if (i == 0) {
                                                                doc.text("**", Qty_X, y);
                                                                doc.text(splitText[i], Items_X, y);
                                                            } else {
                                                                doc.text(splitText[i], Items_X, y);
                                                            }
                                                        } else {
                                                            if (i == 0) {
                                                                doc.text("**", Items_X, y);
                                                                doc.text(splitText[i], Items_X + 7, y);
                                                            } else {
                                                                doc.text(splitText[i], Items_X + 7, y);
                                                            }
                                                        }
                                                    }
                                                }

                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                y = jspdfGetNextLineY(doc, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            });
                                        }

                                        // Footer
                                        doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                        doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                        doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                        doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);

                                        var customers = customers?.filter(function (cus) {
                                            return cus.customer_code === data?.customer_code;
                                        });

                                        if (
                                            (sales_no.includes("SAL-TQR") || sales_no.includes("SAL-WOR")) &&
                                            (data?.ref_1.toUpperCase().includes("DELI") || data?.ref_1.toUpperCase().includes("TAKE")) &&
                                            printConfig?.Kitchen?.DeliveryOrderInfo.visible
                                        ) {
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                            doc.setFont(printConfig?.Kitchen?.DeliveryOrderInfo.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.DeliveryOrderInfo.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.DeliveryOrderInfo.fontColor);
                                            doc.text(printConfig?.Kitchen?.DeliveryOrderInfo.label, x, y);

                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                            var customerName = "";
                                            var contact_no = "";
                                            var card_no = "";
                                            var email = "";
                                            var address = "";
                                            if (customers?.length > 0) {
                                                customerName = `${customers[0].first_name} - ${customers[0].last_name}`;
                                                contact_no = customers[0].contact_no;
                                                card_no = customers[0].card_no;
                                                email = customers[0].email;
                                                var lstaddress = customers[0].custaddrinfodtls;
                                                address = lstaddress[0].address;
                                                if (lstaddress[0].address == "") {
                                                    address += `${lstaddress[0].country_name} - ${lstaddress[0].postal_code}`;
                                                } else {
                                                    address += `, ${lstaddress[0].country_name} - ${lstaddress[0].postal_code}`;
                                                }
                                            }

                                            doc.text(`Customer : ${customerName}`, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                            doc.text(`Phone No : ${contact_no}`, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                            doc.text(`Card No : ${card_no}`, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                            doc.text(`Customer Email : ${email}`, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                            if (address) {
                                                var start_index = 0;
                                                var value_end_index = 32;
                                                var length = address.length / value_end_index;
                                                for (var k = 0; k < length; k++) {
                                                    if (k == 0) {
                                                        doc.text(`Cust Addr : ${address.substring(start_index, value_end_index).trim()}`, x, y);
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                        y = jspdfGetNextLineY(doc, y);
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                    } else {
                                                        doc.text(`${address.substring(start_index, value_end_index).trim()}`, x + "Cust Addr : ".length + 6, y);
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                        y = jspdfGetNextLineY(doc, y);
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                    }
                                                    start_index = value_end_index;
                                                    value_end_index = value_end_index + value_end_index;
                                                }
                                            } else {
                                                doc.text("Cust Addr : ", x, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                y = jspdfGetNextLineY(doc, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            }

                                            doc.text("Mode Of Order : " + data?.ref_1, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                            var spl_remarks = data?.ref_2;
                                            if (spl_remarks) {
                                                var start_index = 0;
                                                value_end_index = 29;
                                                var length = spl_remarks.length / value_end_index;
                                                for (var k = 0; k < length; k++) {
                                                    if (k == 0) {
                                                        doc.text(`SPL Remarks : ${spl_remarks.substring(start_index, value_end_index).trim()}`, x, y);
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                        y = jspdfGetNextLineY(doc, y);
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                    } else {
                                                        doc.text(`${spl_remarks.substring(start_index, value_end_index).trim()}`, x + "PL Remarks : ".length + 10, y);
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                        y = jspdfGetNextLineY(doc, y);
                                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                    }
                                                    start_index = value_end_index;
                                                    value_end_index = value_end_index + value_end_index;
                                                }
                                            } else {
                                                doc.text("SPL Remarks : ", x, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                y = jspdfGetNextLineY(doc, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            }

                                            if (data?.ref_1.toUpperCase().includes("DELI")) {
                                                doc.text(`Delivery Date Time : ${data?.ref_3}`, x, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                y = jspdfGetNextLineY(doc, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            }

                                            if (data?.ref_1.toUpperCase().includes("TAKE")) {
                                                doc.text(`Pickup Date Time : ${data?.ref_4}`, x, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                                y = jspdfGetNextLineY(doc, y);
                                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            }

                                            doc.text(`Order Ref.No : ${data?.ref_5}`, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }

                                            doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                                            doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                                            doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                                            doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                                            y = jspdfGetNextLineY(doc, y);
                                        }

                                        const pdf = doc.output("blob");

                                        const pdfName = `EvolutPOS_${kPrinterName.setting_value
                                            }_${timestamp()}${same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM) ? "CANCEL_ITEM" : ""
                                            }_${kPrinterName.setting_desc}_${sales_no}_Kitchen_Receipt.pdf`;

                                        if (same(getSetting("MORE", "GENERAL", "PRINT_OPTION"), PRINT_SERVICE.PRINT)) {
                                            printQueue.push({
                                                pdfName,
                                                type: KITCHEN_PRINTING.SINGLE,
                                                func: async () => await print(pdf, kPrinterName.setting_value, pdfName, doc),
                                            });
                                        } else {
                                            doc.save(pdfName);
                                        }
                                    });
                                });
                            }
                        } catch (error) { }
                    }
                }
            });

            for (let i = 0; i < printQueue.length; i++) {
                const printDelayBeforeKitchenPrint =
                    parseFloat(getSetting("MORE", "KITCHEN", "PRINT_DELAY_BEFORE_KITCHEN_PRINT")) || 0;
                if (printDelayBeforeKitchenPrint > 0)
                    await new Promise((resolve) => setTimeout(resolve, printDelayBeforeKitchenPrint * 1000));
                const current = printQueue[i];
                try {
                    await current.func();
                    console.log(`[ORDER - ${type} - KITCHEN PRINTING] [SUCCESS] Kitchen manually printed successfully | id: ${data?.sales_no} | res: ${current.pdfName}`);
                    const next = printQueue[i + 1];
                    if (
                        next &&
                        same(current?.type, KITCHEN_PRINTING.SUMMARY) &&
                        same(next?.type, KITCHEN_PRINTING.SINGLE)
                    ) {
                        await new Promise((resolve) => setTimeout(resolve, 500));
                    }
                } catch (error) {
                    console.error(`[ORDER - ${type} - KITCHEN PRINTING] [FAIL] Kitchen printing failed | id: ${data?.sales_no} | res: ${current.pdfName}`, error);
                }
            }
        }
    } catch (error) {
        console.error(`[ORDER - ${type} - KITCHEN PRINTING] [FAIL] Kitchen printing failed | id: ${data?.sales_no}`, error);
    }
};

export const receiptPrint = async (
    type,
    data,
    index = "0",
    printerNameOverride = null    // ← add this
) => {
    const { store, promos, printConfig } = useCache();

    // Use override directly — caller already resolved + verified the name
    const printerName = printerNameOverride?.trim()
        || getSetting("HARDWARE", "HARDWARE", "RECEIPT_PRINTER_NAME")?.trim();

    console.group('🖨️ [receiptPrint] Printer Resolution');
    console.log('printerNameOverride :', printerNameOverride);
    console.log('getSetting result   :', getSetting("HARDWARE", "HARDWARE", "RECEIPT_PRINTER_NAME"));
    console.log('resolved printerName:', printerName);
    console.log('type                :', type);
    console.log('printConfig.Receipt :', !!printConfig?.Receipt);
    console.groupEnd();

    if ((!printerName || !printConfig?.Receipt) && !same(type, RECEIPT_PRINT_TYPE.VIEW)) {
        console.warn('⚠️ [receiptPrint] BAIL — printer:', printerName, '| config:', !!printConfig?.Receipt);
        return;
    }

    try {
        var customers = [];

        const doc = await newPDF();

        const safeSetFont = (fontFamily) => {
            const fallback = printConfig?.Receipt?.DashDivider?.fontFamily ?? 'helvetica';
            if (!fontFamily) { doc.setFont(fallback); return; }
            try {
                doc.setFont(fontFamily);
            } catch {
                console.warn(`⚠️ [safeSetFont] "${fontFamily}" not registered — using ${fallback}`);
                doc.setFont(fallback);
            }
        };

        var order = data[0];




        order = {
            ...order,
            sub_total: parseFloat(order?.sub_total),
            total_disc: parseFloat(order?.total_disc),
            total_svc: parseFloat(order?.total_svc),
            total_tax: parseFloat(order?.total_tax),
            total_tax_absorbed: parseFloat(order?.total_tax_absorbed),
            round_adj_amt: parseFloat(order?.round_adj_amt),
            change_amt: parseFloat(order?.change_amt),
            net_amt: parseFloat(order?.net_amt),
        };

        var ticket_dtls = order?.ticket_dtls;

        if (!order?.customer_code && same(type, RECEIPT_PRINT_TYPE.EMAIL)) {
            return;
        }

        let newSalesDtls = [];
        clone(order?.sales_dtls)?.forEach((orderitem) => {
            if (
                // alacarte item
                !orderitem?.menu_type &&
                // parent item
                same(orderitem?.ds_no, 1) &&
                // no discount
                same(orderitem?.disc_name, "None") &&
                // not a set item
                !orderitem?.ref_1 &&
                // not an open item
                !isOpenItem(orderitem) &&
                // not an addon item
                !isAddonItem(orderitem) &&
                !isAddon2Item(orderitem) &&
                // not a free item
                notFreeItem(orderitem)
            ) {
                const existedItemIndex = newSalesDtls?.findIndex(
                    (v) =>
                        same(v?.item_no, orderitem?.item_no) &&
                        // same takeaway item or dine in item
                        same(v?.take_away_item, orderitem?.take_away_item)
                );
                if (existedItemIndex >= 0) {
                    newSalesDtls[existedItemIndex].qty += orderitem.qty;
                    newSalesDtls[existedItemIndex].sub_total += orderitem.sub_total;
                } else {
                    newSalesDtls.push(orderitem);
                }
            } else {
                newSalesDtls.push(orderitem);
            }
        });
        order.sales_dtls = newSalesDtls;

        // remove zero price item
        if (
            bool(
                getSetting(
                    "PRINT SETTINGS",
                    "RECEIPT",
                    "Remove_Zero_Price_Item_InReceipt"
                )
            )
        ) {
            var sales_dtls = order?.sales_dtls?.filter((v) => {
                return parseFloat(v.price.toFixed(0)) > 0 || v.menu_type;
            });
            order.sales_dtls = sales_dtls;
        }

        order.sales_dtls = sortOrderItems(order.sales_dtls);


        var x = printConfig?.Receipt?.x;
        var y = printConfig?.Receipt?.y;
        var maxWidth = printConfig?.Receipt?.maxWidth;

        var store_group = store?.store_group;
        var store_name = store?.store_name;
        var store_addr = store?.store_addr;
        var gst_no = store?.gst_no;
        var sales_no = order?.sales_no;
        var status = order?.order_status_desc;
        var register_name = order?.register_name;
        const rawDate = (order?.doc_date ?? '').replace('T', ' ').split('.')[0];
        var doc_date = dayjs(rawDate).format(DATE_TIME_FORMAT);
        var date = getNowWithLoginDate().format(DATE_TIME_FORMAT);
        var m_userid = order?.m_userid;
        var table_no = order?.table_no;
        var no_of_pax = order?.no_of_pax;
        console.log('📅 doc_date raw:', order?.doc_date, '| parsed:', doc_date, '| format:', DATE_TIME_FORMAT);
        var pageHeight = doc.internal.pageSize.height;

        y = y + printConfig?.Receipt?.EmptyLine;

        // Topmost Table No
        if (table_no && printConfig?.Receipt?.TopmostTableNo.visible) {
            safeSetFont(printConfig?.Receipt?.TopmostTableNo?.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.TopmostTableNo.fontSize);
            doc.setTextColor(printConfig?.Receipt?.TopmostTableNo.fontColor);
            doc.text(printConfig?.Receipt?.TopmostTableNo.label + table_no, x, y);
            y = jspdfGetNextLineY(doc, y);
        }

        const isImageWithHeader = bool(
            getSysSetting("Store Receipt Settings", "store_receipt_imagewithheader")
        );

        // Header
        if (isImageWithHeader) {
            // Logo
            if (await isImageExisted("/Receipt?.png")) {
                var logo = new Image();
                logo.src = "/Receipt?.png";
                doc.addImage(logo, "png", 0, 0, maxWidth, 48);
                y += 40;
            }
            y = y + printConfig?.Receipt?.EmptyLine;
        }

        doc.setFont(printConfig?.Receipt?.StarDivider.fontFamily);
        doc.setFontSize(printConfig?.Receipt?.StarDivider.fontSize);
        doc.setTextColor(printConfig?.Receipt?.StarDivider.fontColor);
        doc.text(printConfig?.Receipt?.StarDivider.label, x, y);
        y = y + printConfig?.Receipt?.EmptyLine;

        // Store Group / Company Name
        if (
            store_group &&
            bool(
                getSetting("PRINT SETTINGS", "RECEIPT", "show_company_name_onreceipt")
            ) &&
            (printConfig?.isdefault || printConfig?.Receipt?.StoreGroup.visible)
        ) {
            doc.setFont(printConfig?.Receipt?.StoreGroup.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.StoreGroup.fontSize);
            doc.setTextColor(printConfig?.Receipt?.StoreGroup.fontColor);
            doc.text(store_group, x, y);
            y = jspdfGetNextLineY(doc, y);
        }

        // Store Name
        if (
            store_name &&
            (printConfig?.isdefault || printConfig?.Receipt?.StoreName.visible)
        ) {
            safeSetFont(printConfig?.Receipt?.StoreName?.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.StoreName.fontSize);
            doc.setTextColor(printConfig?.Receipt?.StoreName.fontColor);
            doc.text(store_name, x, y);
            y = jspdfGetNextLineY(doc, y);
        }

        // Store Address
        if (
            store_addr &&
            (printConfig?.isdefault || printConfig?.Receipt?.StoreAddress.visible)
        ) {
            doc.setFont(printConfig?.Receipt?.StoreAddress.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.StoreAddress.fontSize);
            doc.setTextColor(printConfig?.Receipt?.StoreAddress.fontColor);
            store_addr.split("\n").forEach((line) => {
                doc.text(line, x, y);
                y = jspdfGetNextLineY(doc, y);
            });
        }

        // GST No
        if (
            gst_no &&
            printConfig?.Receipt?.GstNo &&
            (printConfig?.isdefault || printConfig?.Receipt?.GstNo.visible)
        ) {
            doc.setFont(printConfig?.Receipt?.GstNo.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.GstNo.fontSize);
            doc.setTextColor(printConfig?.Receipt?.GstNo.fontColor);
            doc.text(printConfig?.Receipt?.GstNo.label + gst_no, x, y);
            y = jspdfGetNextLineY(doc, y);
        }

        // Queue No
        if (
            sales_no &&
            (printConfig?.isdefault || printConfig?.Receipt?.QueueNo.visible) &&
            bool(
                getSetting("PRINT SETTINGS", "RECEIPT", "show_queue_number_onreceipt")
            )
        ) {
            doc.setFont(printConfig?.Receipt?.QueueNo.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.QueueNo.fontSize);
            doc.setTextColor(printConfig?.Receipt?.QueueNo.fontColor);

            if (contains(["SAL-TQR"], sales_no, false)) {
                doc.text(
                    `${printConfig?.Receipt?.QueueNo.label}A${sales_no
                        .substring(16, 19)
                        .trim()}`,
                    x,
                    y
                );
            }
            // Check if first character after hyphen in sales_no is an alphabet
            else if (
                /^[a-zA-Z]+$/.test(sales_no.toString().split("-")[1].substring(0, 1))
            ) {
                // alphabet
                doc.text(
                    `${printConfig?.Receipt?.QueueNo.label}${sales_no
                        .toString()
                        .split("-")[1]
                        .substring(0, 1)}${sales_no.substring(16, 19).trim()}`,
                    x,
                    y
                );
            } else {
                doc.text(
                    `${printConfig?.Receipt?.QueueNo.label}${sales_no
                        .substring(6, 7)
                        .trim()}${sales_no.substring(16, 19).trim()}`,
                    x,
                    y
                );
                y = jspdfGetNextLineY(doc, y);
            }
        }

        // Delivery / Takeaway Order
        if (
            order?.ref_1 &&
            contains(
                ["SAL-TQR", "SAL-SOK", "SAL-WOR", "SAL-GRF", "SAL-FOP"],
                sales_no,
                false
            ) &&
            contains(["DELI", "TAKE"], order?.ref_1, false)
        ) {
            var customer = customers;
            if (
                (customer.length > 0 && printConfig?.isdefault) ||
                printConfig?.Receipt?.Customer.visible
            ) {
                var customerName = `${customer[0].first_name} - ${customer[0].last_name}`;
                doc.setFont(printConfig?.Receipt?.Customer.fontFamily);
                doc.setFontSize(printConfig?.Receipt?.Customer.fontSize);
                doc.setTextColor(printConfig?.Receipt?.Customer.fontColor);
                doc.text(printConfig?.Receipt?.Customer.label + customerName, x, y);
                y = jspdfGetNextLineY(doc, y);
            }

            // Order Ref No
            if (
                order?.ref_5 &&
                (printConfig?.isdefault || printConfig?.Receipt?.OrderRefNo.visible)
            ) {
                doc.setFont(printConfig?.Receipt?.OrderRefNo.fontFamily);
                doc.setFontSize(printConfig?.Receipt?.OrderRefNo.fontSize);
                doc.setTextColor(printConfig?.Receipt?.OrderRefNo.fontColor);
                if (contains(["SAL-GRF", "SAL-FOP"], sales_no, false)) {
                    doc.text(
                        `${printConfig?.Receipt?.OrderRefNo.label}${order?.ref_5}`,
                        x,
                        y
                    );
                } else if (order?.ref_5 != "") {
                    doc.text(
                        `${printConfig?.Receipt?.OrderRefNo.label}APP${order?.ref_5.slice(-4)}`,
                        x,
                        y
                    );
                } else {
                    doc.text(
                        `${printConfig?.Receipt?.OrderRefNo.label}APP${order?.ref_5.slice(-4)}`,
                        x,
                        y
                    );
                }
                y = jspdfGetNextLineY(doc, y);
            }
        }

        y = y + printConfig?.Receipt?.EmptyLine;

        // Sales No
        if (
            sales_no &&
            (printConfig?.isdefault || printConfig?.Receipt?.SalesNo.visible)
        ) {
            doc.setFont(printConfig?.Receipt?.SalesNo.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.SalesNo.fontSize);
            doc.setTextColor(printConfig?.Receipt?.SalesNo.fontColor);
            doc.text(`${printConfig?.Receipt?.SalesNo.label}${sales_no}`, x, y);
            y = jspdfGetNextLineY(doc, y);
        }

        // Status
        if (
            status &&
            (printConfig?.isdefault || printConfig?.Receipt?.Status.visible)
        ) {
            doc.setFont(printConfig?.Receipt?.Status.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Status.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Status.fontColor);
            doc.text(`${printConfig?.Receipt?.Status.label}${status}`, x, y);

            // Table No
            if (
                table_no &&
                (printConfig?.isdefault || printConfig?.Receipt?.TableNo.visible)
            ) {
                doc.setFont(printConfig?.Receipt?.TableNo.fontFamily);
                doc.setFontSize(printConfig?.Receipt?.TableNo.fontSize);
                doc.setTextColor(printConfig?.Receipt?.TableNo.fontColor);
                doc.text(printConfig?.Receipt?.TableNo.label + table_no, maxWidth, y, {
                    align: "right",
                });
            }

            y = jspdfGetNextLineY(doc, y);
        }

        // Register Name
        if (
            register_name &&
            (printConfig?.isdefault || printConfig?.Receipt?.Register.visible)
        ) {
            doc.setFont(printConfig?.Receipt?.Register.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Register.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Register.fontColor);
            doc.text(`${printConfig?.Receipt?.Register.label}${register_name}`, x, y);
            y = jspdfGetNextLineY(doc, y);
        }

        // Date
        if (
            doc_date &&
            (printConfig?.isdefault || printConfig?.Receipt?.Date.visible)
        ) {
            doc.setFont(printConfig?.Receipt?.Date.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Date.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Date.fontColor);
            doc.text(`${printConfig?.Receipt?.Date.label}${doc_date}`, x, y);
            y = jspdfGetNextLineY(doc, y);
        }

        // User
        if (
            m_userid &&
            (printConfig?.isdefault || printConfig?.Receipt?.User.visible)
        ) {
            doc.setFont(printConfig?.Receipt?.User.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.User.fontSize);
            doc.setTextColor(printConfig?.Receipt?.User.fontColor);
            doc.text(`${printConfig?.Receipt?.User.label}${m_userid}`, x, y);
            y = jspdfGetNextLineY(doc, y);
        }

        // No Of Pax
        if (
            no_of_pax &&
            (printConfig?.isdefault || printConfig?.Receipt?.NoOfPax.visible)
        ) {
            doc.setFontSize(printConfig?.Receipt?.NoOfPax.fontSize);
            doc.setTextColor(printConfig?.Receipt?.NoOfPax.fontColor);
            doc.text(`${printConfig?.Receipt?.NoOfPax.label}${no_of_pax}`, x, y);
            y = jspdfGetNextLineY(doc, y);
        }

        y = y + printConfig?.Receipt?.EmptyLine;

        // Duplicate Receipt
        var isDuplicatedReceipt =
            bool(
                getSetting(
                    "PRINT SETTINGS",
                    "RECEIPT",
                    "PRINT_DUPLICATE_RECEIPT_AFTER_PAYMENT"
                )
            ) &&
            !bool(
                getSetting(
                    "GENERAL SETTINGS",
                    "ALLOWED SERVICES",
                    "ENABLE_TABLET_ORDER_MODE"
                )
            );

        // manual print always is duplicated receipt
        if (
            (same(type, RECEIPT_PRINT_TYPE.MANUAL) ||
                same(type, RECEIPT_PRINT_TYPE.DUPLICATE)) &&
            order.sales_payment_dtls?.length > 0
        ) {
            isDuplicatedReceipt = true;
        } else {
            isDuplicatedReceipt = false;
        }

        if (isDuplicatedReceipt) {
            doc.setFont(printConfig?.Receipt?.DuplicateReceipt.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.DuplicateReceipt.fontSize);
            doc.setTextColor(printConfig?.Receipt?.DuplicateReceipt.fontColor);
            doc.text(printConfig?.Receipt?.DuplicateReceipt.label, maxWidth / 2, y, {
                align: "center",
            });
            y = jspdfGetNextLineY(doc, y);
        }

        // Body Divider
        safeSetFont(printConfig?.Receipt?.DashDivider?.fontFamily);
        doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
        doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
        doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
        y = jspdfGetNextLineY(doc, y);

        var Qty_X = printConfig?.Receipt?.Qty.x;
        var Items_X = printConfig?.Receipt?.Items.x;
        var Amount_X = printConfig?.Receipt?.Amount.x;

        // Qty Column Header
        if (printConfig?.isdefault || printConfig?.Receipt?.Qty.visible) {
            doc.setFont(printConfig?.Receipt?.Qty.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Qty.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Qty.fontColor);
            doc.text(printConfig?.Receipt?.Qty.label, Qty_X, y, {
                maxWidth: Items_X - Qty_X - 1,
            });
        }

        // Items Column Header
        if (printConfig?.isdefault || printConfig?.Receipt?.Items.visible) {
            doc.setFont(printConfig?.Receipt?.Items.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Items.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Items.fontColor);
            doc.text(printConfig?.Receipt?.Items.label, Items_X, y, {
                maxWidth: Amount_X - Items_X - 1,
            });
        }

        // Amount Column Header
        if (printConfig?.isdefault || printConfig?.Receipt?.Amount.visible) {
            doc.setFont(printConfig?.Receipt?.Amount.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Amount.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Amount.fontColor);
            doc.text(printConfig?.Receipt?.Amount.label, maxWidth, y, {
                maxWidth: maxWidth - Amount_X - 1,
                align: "right",
            });
        }
        y = jspdfGetNextLineY(doc, y);

        doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
        doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
        doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
        doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
        y = y + printConfig?.Receipt?.EmptyLine;

        var lstTakeEat = Array.from(
            new Set(order?.sales_dtls?.map((o) => o.take_away_item))
        )?.sort();

        lstTakeEat.forEach((te) => {
            var lstTakeAway = order?.sales_dtls?.filter((v) => {
                return v.take_away_item === te;
            });

            // Dine In Divider
            if (
                te === "N" &&
                (printConfig?.isdefault ||
                    printConfig?.Receipt?.DineInDivider.visible) &&
                lstTakeAway?.length > 0
            ) {
                doc.setFont(printConfig?.Receipt?.DineInDivider.fontFamily);
                doc.setFontSize(printConfig?.Receipt?.DineInDivider.fontSize);
                doc.setTextColor(printConfig?.Receipt?.DineInDivider.fontColor);
                doc.text(printConfig?.Receipt?.DineInDivider.label, x, y);

                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            // Take Away Divider
            else if (
                (printConfig?.isdefault ||
                    printConfig?.Receipt?.TakeAwayDivider.visible) &&
                lstTakeAway?.length > 0
            ) {
                doc.setFont(printConfig?.Receipt?.TakeAwayDivider.fontFamily);
                doc.setFontSize(printConfig?.Receipt?.TakeAwayDivider.fontSize);
                doc.setTextColor(printConfig?.Receipt?.TakeAwayDivider.fontColor);
                doc.text(printConfig?.Receipt?.TakeAwayDivider.label, x, y);

                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            lstTakeAway.forEach((v) => {
                // Qty Value
                doc.setFont(printConfig?.Receipt?.QtyValue.fontFamily);
                doc.setFontSize(printConfig?.Receipt?.QtyValue.fontSize);
                doc.setTextColor(printConfig?.Receipt?.QtyValue.fontColor);
                var ls_itemdesc = "";
                // parent item
                if (v.s_no == v.parent_sno) {
                    doc.text(v.qty.toString(), Qty_X, y, { maxWidth: 10 });
                    ls_itemdesc = v.item_desc.toString();
                }
                // child item
                else {
                    doc.text("", Qty_X, y, { maxWidth: 10 });
                    var ls_itemdesc = v.qty.toString() + "x " + v.item_desc.toString();
                }

                // Amount Value
                // do not print amount value for non-alacarte parent item
                if (v.ds_no === 1 && contains(["S", "C", "M"], v.menu_type)) {
                } else {
                    doc.text(v.sub_total.toFixed(2), maxWidth, y, { align: "right" });
                }

                // Items Value
                var splitText = doc.splitTextToSize(ls_itemdesc, Amount_X - Items_X - 1);
                for (var i = 0, length = splitText.length; i < length; i++) {
                    doc.text(splitText[i], Items_X, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    y = jspdfGetNextLineY(doc, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                }

                // Discount / Promo Value
                if (
                    v.disc_name &&
                    !same(v.disc_name, "None") &&
                    (printConfig?.isdefault || printConfig?.Receipt?.DiscountValue.visible)
                ) {
                    doc.setFont(printConfig?.Receipt?.DiscountValue.fontFamily);
                    doc.setFontSize(printConfig?.Receipt?.DiscountValue.fontSize);
                    doc.setTextColor(printConfig?.Receipt?.DiscountValue.fontColor);

                    if (parseFloat(v.unit_price) > 0) {
                        doc.text(`@ ${v.unit_price.toFixed(2)}`, Items_X, y);
                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        y = jspdfGetNextLineY(doc, y);
                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    }

                    if (parseFloat(v.disc_amt) > 0) {
                        // Open Item Discount
                        if (same(v.disc_name, "OPEN ITEM DISCOUNT")) {
                            if (same(v.disc_type, "P")) {
                                doc.text(
                                    `${v.disc_value.toFixed(2)}% Open Item Discount : ${v.disc_amt.toFixed(2)}`,
                                    Items_X, y
                                );
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            } else if (same(v.disc_type, "V")) {
                                doc.text(`$${v.disc_value.toFixed(2)} Open Item Discount`, Items_X, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            }
                        }
                        // Constant / Fixed Discount
                        else {
                            doc.text(`${v.disc_name} : -${v.disc_amt.toFixed(2).toString()}`, Items_X, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            y = jspdfGetNextLineY(doc, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        }
                    }
                    // Promo
                    else {
                        var promo = promos?.find((promo) => {
                            return same(promo.promo_name, v.disc_name);
                        });
                        if (promo) {
                            if (
                                (same(promo.criteria_type, PROMO_TYPE.SPECIAL_PRICE) ||
                                    same(promo.criteria_type, PROMO_TYPE.SPECIAL_DISCOUNT_WITH_QUANTITY)) &&
                                same(promo.criteria_promo_item_no, v.item_no)
                            ) {
                                if (parseFloat(v.unit_price) > 0) {
                                    doc.text(`@ ${v.unit_price.toFixed(2)}`, Items_X, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                }
                                doc.text(v.disc_name, Items_X, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            } else if (
                                promo.criteria_type === PROMO_TYPE.FREE_ITEM ||
                                promo.criteria_type === PROMO_TYPE.FREE_ITEM_WITH_LIMIT ||
                                promo.criteria_type === PROMO_TYPE.FREE_ITEM_BY_VALUE
                            ) {
                                var creteria_item_dtls = promo.creteria_item_dtls;
                                if (creteria_item_dtls != "") {
                                    var chkProitem = creteria_item_dtls.filter(function (p1) {
                                        return p1.item_no === v.item_no;
                                    });
                                    if (chkProitem.length > 0) {
                                        doc.text(v.disc_name, Items_X, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                    }
                                }
                            }
                        } else {
                            doc.text(v.disc_name, Items_X, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            y = jspdfGetNextLineY(doc, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        }
                    }
                }

                // Ref Value
                if (v.ref_4) {
                    if (printConfig?.isdefault || printConfig?.Receipt?.RefValue.visible) {
                        doc.setFont(printConfig?.Receipt?.RefValue.fontFamily);
                        doc.setFontSize(printConfig?.Receipt?.RefValue.fontSize);
                        doc.setTextColor(printConfig?.Receipt?.RefValue.fontColor);
                        doc.text(v.ref_4, Items_X, y);
                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        y = jspdfGetNextLineY(doc, y);
                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    }
                }
            });
        });

        if (printConfig?.isdefault || printConfig?.Receipt?.DashDivider.visible) {
            doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
            doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
            doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
        }

        // Footer
        if (printConfig?.isdefault || printConfig?.Receipt?.Subtotal.visible) {
            doc.setFont(printConfig?.Receipt?.Subtotal.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Subtotal.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Subtotal.fontColor);
            doc.text(printConfig?.Receipt?.Subtotal.label, x, y);
            doc.text(order?.sub_total.toFixed(2), maxWidth, y, { align: "right" });
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
        }

        // Total Discount
        if (
            parseFloat(order?.total_disc) > 0 &&
            (printConfig?.isdefault || printConfig?.Receipt?.TotalDiscount.visible)
        ) {
            doc.setFont(printConfig?.Receipt?.TotalDiscount.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.TotalDiscount.fontSize);
            doc.setTextColor(printConfig?.Receipt?.TotalDiscount.fontColor);
            doc.text(printConfig?.Receipt?.TotalDiscount.label, x, y);
            doc.text(order?.total_disc.toFixed(2), maxWidth, y, { align: "right" });
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

            if (order?.disc_name && !same(order?.disc_name, "None")) {
                if (same(order?.disc_name, "OPEN TOTAL DISCOUNT")) {
                    if (same(order?.disc_type, "P")) {
                        doc.text(
                            `${order.disc_value.toFixed(2)}% ${order.disc_name} : ${order.total_disc.toFixed(2)}`,
                            x + 2, y
                        );
                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        y = jspdfGetNextLineY(doc, y);
                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    } else if (same(order?.disc_type, "V")) {
                        doc.text(`$${order?.disc_value.toFixed(2)} ${order?.disc_name}`, x + 2, y);
                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        y = jspdfGetNextLineY(doc, y);
                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    }
                } else {
                    doc.text(order?.disc_name, x + 2, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    y = jspdfGetNextLineY(doc, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                }
            }
        }

        // Service Charges
        if (printConfig?.isdefault || printConfig?.Receipt?.ServiceCharge.visible) {
            doc.setFont(printConfig?.Receipt?.ServiceCharge.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.ServiceCharge.fontSize);
            doc.setTextColor(printConfig?.Receipt?.ServiceCharge.fontColor);
            (order?.sales_service_dtls || []).forEach((sv) => {
                if (parseFloat(sv.service_amt) > 0) {
                    doc.text(sv.service_name, x, y);
                    doc.text(parseFloat(sv.service_amt).toFixed(2), maxWidth, y, { align: "right" });
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    y = jspdfGetNextLineY(doc, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                }
            });
        }

        // Tax
        const isAbsorbTax = bool(store?.is_absorbtax);
        if (printConfig?.isdefault || printConfig?.Receipt?.GST.visible) {
            doc.setFont(printConfig?.Receipt?.GST.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.GST.fontSize);
            doc.setTextColor(printConfig?.Receipt?.GST.fontColor);
            doc.text(`${printConfig?.Receipt?.GST.label} ${order?.sales_dtls[0].tax_value}%`, x, y);
            doc.text(order?.total_tax.toFixed(2), maxWidth, y, { align: "right" });
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
        }

        // Rounding Adjustment
        if (parseFloat(order?.round_adj_amt) !== 0) {
            if (printConfig?.isdefault || printConfig?.Receipt?.RoundingAdjustment.visible) {
                doc.setFont(printConfig?.Receipt?.RoundingAdjustment.fontFamily);
                doc.setFontSize(printConfig?.Receipt?.RoundingAdjustment.fontSize);
                doc.setTextColor(printConfig?.Receipt?.RoundingAdjustment.fontColor);
                doc.text(printConfig?.Receipt?.RoundingAdjustment.label, x, y);
                doc.text(order?.round_adj_amt.toFixed(2), maxWidth, y, { align: "right" });
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }
        }

        // Total
        if (printConfig?.isdefault || printConfig?.Receipt?.Total.visible) {
            doc.setFont(printConfig?.Receipt?.Total.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Total.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Total.fontColor);
            doc.text(
                `${printConfig?.Receipt?.Total.label} ${isAbsorbTax ? "Incl." : "Excl."} ${printConfig?.Receipt?.GST.label}`,
                x, y
            );
            doc.text(order?.net_amt.toFixed(2), maxWidth, y, { align: "right" });
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
        }

        // No of Items
        if (printConfig?.isdefault || printConfig?.Receipt?.NoofItems.visible) {
            doc.setFont(printConfig?.Receipt?.NoofItems.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.NoofItems.fontSize);
            doc.setTextColor(printConfig?.Receipt?.NoofItems.fontColor);
            doc.text(`${printConfig?.Receipt?.NoofItems.label} ${order?.sales_dtls?.length.toString()}`, x, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
        }

        // Payment Info
        if (
            order?.sales_payment_dtls?.length > 0 &&
            (printConfig?.isdefault || printConfig?.Receipt?.PaymentInfo.visible)
        ) {
            console.log('💳 [RECEIPT] sales_payment_dtls at print time:',
                JSON.stringify(order?.sales_payment_dtls));
            doc.setFont(printConfig?.Receipt?.PaymentInfo.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.PaymentInfo.fontSize);
            doc.setTextColor(printConfig?.Receipt?.PaymentInfo.fontColor);
            doc.text(printConfig?.Receipt?.PaymentInfo.label, x, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

            order?.sales_payment_dtls?.forEach((v) => {
                doc.text(v.payment_name.toString().trim(), x, y);
                doc.text(parseFloat(v.tender_amt).toFixed(2), maxWidth, y, { align: "right" });
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                if (printConfig?.Receipt?.PaymentTerminalInfo.visible) {
                    doc.setFont(printConfig?.Receipt?.PaymentTerminalInfo.fontFamily);
                    doc.setFontSize(printConfig?.Receipt?.PaymentTerminalInfo.fontSize);
                    doc.setTextColor(printConfig?.Receipt?.PaymentTerminalInfo.fontColor);

                    var sales_other_info = order?.sales_other_info;
                    if (sales_other_info) {
                        // todo - fomo qr
                        if (
                            bool(getSetting("MORE", "PAYMENT", "QR_FOMO")) &&
                            same(v.payment_name, getSetting("OTHERS", "FOMO_QR", "fomo_qr_payment_name"))
                        ) {
                        }
                        // todo - shopback qr
                        else if (
                            bool(getSetting("MORE", "PAYMENT", "QR_SHOPBACK")) &&
                            same(v.payment_name, getSetting("OTHERS", "SHOPBACK_QR", "shopback_qr_payment_name"))
                        ) {
                        }
                        // todo - nets qr
                        else if (
                            bool(getSetting("MORE", "PAYMENT", "QR_NETS")) &&
                            same(v.payment_name, getSetting("OTHERS", "NETS_QR", "nets_qr_payment_name"))
                        ) {
                            var info_value = sales_other_info.find((oi) => {
                                return oi.info_name === v.payment_name.toString();
                            });
                            if (info_value) {
                                info_value = JSON.parse(info_value?.info_value)[0];

                                doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
                                doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
                                doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
                                doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                doc.setFont(printConfig?.Receipt?.PaymentInfo.fontFamily);
                                doc.setFontSize(printConfig?.Receipt?.PaymentInfo.fontSize);
                                doc.setTextColor(printConfig?.Receipt?.PaymentInfo.fontColor);
                                doc.text(`${v.payment_name.toString().toUpperCase()} ${printConfig?.Receipt?.PaymentInfo.label}`, x, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                doc.text(`MID : ${info_value.host_mid}`, x, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                doc.text(`TID : ${info_value.host_tid}`, x, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                doc.text(`STAN : ${info_value.stan}`, x, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                doc.text(`Date : ${info_value.transaction_date} ${info_value.transaction_time}`, x, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
                                doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
                                doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
                                doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            }
                        }
                        // Card Payment
                        else {
                            var info_value = sales_other_info.find((oi) => {
                                return oi.info_name === v.payment_name.toString() + v.s_no;
                            });
                            if (info_value) {
                                info_value = JSON.parse(info_value.info_value)[0];

                                doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
                                doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
                                doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
                                doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                var A930_info = "";
                                if (info_value.responce_info) {
                                    A930_info = info_value.responce_info.split("\r\n");
                                }

                                // A930
                                if (bool(getSetting("MORE", "PAYMENT", "ECR_A930")) && A930_info.length === 14) {
                                    doc.text("Card Payment Info :", x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                    for (var r = 0; r < A930_info.length; r++) {
                                        if (A930_info[r] != "" && r != 0 && r != 1 && r != 2) {
                                            doc.text(A930_info[r], x + 4, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        }
                                    }

                                    doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
                                    doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
                                    doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
                                    doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                }
                                // NETS
                                else if (v.payment_name.toString().trim().includes("NETS")) {
                                    info_value = JSON.parse(info_value?.info_value)[0];

                                    if (info_value?.approvalCode) {
                                        doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
                                        doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
                                        doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
                                        doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`NETS ${printConfig?.Receipt?.PaymentInfo.label}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Approval Code : ${info_value.approvalCode.split("\u0006")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Merchant ID : ${info_value.merchantID.split("\u0015")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        if (info_value.cardName.split("\u0000")[1].includes("FLASHPAY")) {
                                            doc.text(`Response : ${info_value.responseText.split("\u0000")[1].split("\n")[0]}`, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                            doc.text(`CAN Number : ${info_value.responseText.split("\u0000")[1].split("\n")[1]}`, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                            doc.text(info_value.responseText.split("\u0000")[1].split("\n")[2], x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        } else {
                                            doc.text(`Response : ${info_value.responseText.split("\u0000")[1]}`, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        }

                                        doc.text(`Terminal ID : ${info_value.terminalID.split("\u0000")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Purchase Amt : ${(parseFloat(info_value.transactionAmount.split("\u0012")[1]) / 100).toFixed(2)}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Date : ${info_value.transactionDate.split("\u0006")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`STAN : ${info_value.stan.split("\u0006")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Time : ${info_value.transactionTime.split("\u0006")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Card Name : ${info_value.cardName.split("\u0000")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
                                        doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
                                        doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
                                        doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                    }
                                }
                                // Credit Card
                                else {
                                    info_value = JSON.parse(info_value.info_value)[0];

                                    if (info_value?.approvalCode_Raw) {
                                        doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
                                        doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
                                        doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
                                        doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Card ${printConfig?.Receipt?.PaymentInfo.label}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Approval Code : ${info_value.approvalCode_Raw.split("\u0006")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Batch Number : ${info_value.batchNumber_Raw.split("\u0006")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`CAN Number : ${info_value.cardNumber_Raw.slice(-4)}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Invoice Number : ${info_value.invoiceNumber_Raw.split("\u0006")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Merchant ID : ${info_value.merchantID_Raw.split("\u0015")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`RRN : ${info_value.rrN_Raw.split("\u0012")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Terminal ID : ${info_value.terminalID_Raw.split("\u0008")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Date : ${info_value.transactionDate_Raw.split("\u0006")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.text(`Time : ${info_value.transactionTime_Raw.split("\u0006")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        if (info_value.tvr && info_value.tvr.split("0005")[1]) {
                                            doc.text(`TVR(EMV) : ${info_value.tvr.split("0005")[1]}`, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        }

                                        if (info_value.entryType_Raw && info_value.entryType_Raw.split("\u0010")[1]) {
                                            doc.text(`Entry Type: ${info_value.entryType_Raw.split("\u0010")[1]}`, x, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        }

                                        doc.text(`Issuer Name: ${info_value.issuerName_Raw.split("\u0010")[1]}`, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                                        doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
                                        doc.setFontSize(printConfig?.Receipt?.DashDivider.fontSize);
                                        doc.setTextColor(printConfig?.Receipt?.DashDivider.fontColor);
                                        doc.text(printConfig?.Receipt?.DashDivider.label, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                                    }
                                }
                            }
                        }
                    }
                }

                // Credit Card Payment Reference
                if (
                    v.ref_info.toString().trim()?.length > 0 &&
                    !v.payment_name.toString().trim().includes("NETS") &&
                    (printConfig?.isdefault || printConfig?.Receipt?.PaymentReference.visible)
                ) {
                    doc.setFont(printConfig?.Receipt?.PaymentReference.fontFamily);
                    doc.setFontSize(printConfig?.Receipt?.PaymentReference.fontSize);
                    doc.setTextColor(printConfig?.Receipt?.PaymentReference.fontColor);
                    doc.text(v.ref_info.toString().trim(), x + 5, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    y = jspdfGetNextLineY(doc, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                }
            });

            // Change
            if (printConfig?.isdefault === true || printConfig?.Receipt?.Change.visible === true) {
                doc.setFont(printConfig?.Receipt?.Change.fontFamily);
                doc.setFontSize(printConfig?.Receipt?.Change.fontSize);
                doc.setTextColor(printConfig?.Receipt?.Change.fontColor);
                doc.text(printConfig?.Receipt?.Change.label, x, y);
                doc.text(order?.change_amt.toFixed(2), maxWidth, y, { align: "right" });
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }
        }

        // Draft
        else if (printConfig?.isdefault || printConfig?.Receipt?.PrintDraft.visible) {
            doc.setFont(printConfig?.Receipt?.PrintDraft.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.PrintDraft.fontSize);
            doc.setTextColor(printConfig?.Receipt?.PrintDraft.fontColor);
            doc.text(
                `${printConfig?.Receipt?.PrintDraft.label}${same(type, RECEIPT_PRINT_TYPE.SPLIT_PAYMENT) ? ` (${index})` : ""}`,
                maxWidth / 2, y, { align: "center" }
            );
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
        }

        // split bill
        if (same(type, RECEIPT_PRINT_TYPE.SPLIT_PAYMENT)) {
            if (printConfig?.isdefault === true || printConfig?.Receipt?.AmountDueforPax.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.Receipt?.AmountDueforPax.fontSize);
                doc.setTextColor(printConfig?.Receipt?.AmountDueforPax.fontColor);
                doc.text(printConfig?.Receipt?.AmountDueforPax.label + index, x, y);
                doc.text(parseFloat(order?.net_amt).toFixed(2), maxWidth, y, { align: "right" });
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }
        }

        if (
            bool(getSetting("GENERAL SETTINGS", "ORDERING", "ENABLE_AUTO_DONE_WHEN_PRINT_DRAFT_PRINTED")) &&
            status !== "Void" &&
            !same(type, RECEIPT_PRINT_TYPE.QR)
        ) {
            // POST posorderkitchenother/update - DONE status
            const res = await fetch('/API/printer/posorderkitchenother/update', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...order,
                    update_for: "KITCHEN_STATUS",
                    kitchen_status_id: "D",
                    kitchen_status_desc: "Done",
                }),
            });

            if (res.ok) {
                const json = await res.json();
                const resData = json?.data?.[0];
                console.log(`[ORDER - UPDATE KITCHEN STATUS] [${json?.message?.toUpperCase()}] ${resData?.information} | id: ${order?.sales_no}`);
            } else {
                console.error(`❌ Kitchen STATUS UPDATE failed → HTTP ${res.status}`);
                const text = await res.text();
                console.error(text);
            }
        }

        // Change Payment History
        if (
            order.sales_change_payment_dtls &&
            order.sales_change_payment_dtls?.length > 0 &&
            (printConfig?.isdefault || printConfig?.Receipt?.ChangePaymentHistory.visible)
        ) {
            doc.setFont(printConfig?.Receipt?.ChangePaymentHistory.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.ChangePaymentHistory.fontSize);
            doc.setTextColor(printConfig?.Receipt?.ChangePaymentHistory.fontColor);
            doc.text(printConfig?.Receipt?.ChangePaymentHistory.label, x, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

            order.sales_change_payment_dtls.forEach((v) => {
                doc.text(v.payment_name.toString().trim(), x, y);
                doc.text(`-${v.tender_amt.toFixed(2)}`, maxWidth, y, { align: "right" });
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            });
        }

        // Date & Time
        if (printConfig?.isdefault || printConfig?.Receipt?.DateTime.visible) {
            doc.setFont(printConfig?.Receipt?.DateTime.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.DateTime.fontSize);
            doc.setTextColor(printConfig?.Receipt?.DateTime.fontColor);
            doc.text(printConfig?.Receipt?.DateTime.label + date, x, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
        }

        // Cashier
        if (printConfig?.isdefault || printConfig?.Receipt?.Cashier.visible) {
            doc.setFont(printConfig?.Receipt?.Cashier.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Cashier.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Cashier.fontColor);
            doc.text(`${printConfig?.Receipt?.Cashier.label} ${order?.c_userid}`, x, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
        }

        // Signature
        if (
            bool(getSetting("PRINT SETTINGS", "RECEIPT", "show_signature_onreceipt")) &&
            (printConfig?.isdefault || printConfig?.Receipt?.Signature.visible)
        ) {
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = y + printConfig?.Receipt?.EmptyLine;
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

            doc.setFont(printConfig?.Receipt?.Signature.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Signature.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Signature.fontColor);
            doc.text(`${printConfig?.Receipt?.Signature.label} ${order?.c_userid}`, x, y);
        }

        // Footer
        if (bool(getSetting("PRINT SETTINGS", "RECEIPT", "show_footer_onreceipt"))) {
            // Thank You Message
            if (printConfig?.isdefault || printConfig?.Receipt?.ThankYou.visible) {
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = y + printConfig?.Receipt?.EmptyLine;
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                doc.setFont(printConfig?.Receipt?.ThankYou.fontFamily);
                doc.setFontSize(printConfig?.Receipt?.ThankYou.fontSize);
                doc.setTextColor(printConfig?.Receipt?.ThankYou.fontColor);
                doc.text(printConfig?.Receipt?.ThankYou.label, x, y);
            }
        }

        y = jspdfGetNextLineY(doc, y);
        doc.setFont(printConfig?.Receipt?.StarDivider.fontFamily);
        doc.setFontSize(printConfig?.Receipt?.StarDivider.fontSize);
        doc.setTextColor(printConfig?.Receipt?.StarDivider.fontColor);
        doc.text(printConfig?.Receipt?.StarDivider.label, x, y);

        // Delivery - Food Panda
        if (sales_no.includes("SAL-FOP")) {
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

            if (printConfig?.fbInfo != undefined && printConfig?.fbInfo.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.fbInfo.fontSize);
                doc.setTextColor(printConfig?.fbInfo.fontColor);
                doc.text(printConfig?.fbInfo.label, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            if (printConfig?.fbNumber != undefined && printConfig?.fbNumber.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.fbNumber.fontSize);
                doc.setTextColor(printConfig?.fbNumber.fontColor);
                doc.text(printConfig?.fbNumber.label + order?.ref_5, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            if (printConfig?.fbCusName != undefined && printConfig?.fbCusName.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.fbCusName.fontSize);
                doc.setTextColor(printConfig?.fbCusName.fontColor);
                doc.text(printConfig?.fbCusName.label + order?.ref_2, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            if (printConfig?.fbCuSPhoneNumber != undefined && printConfig?.fbCuSPhoneNumber.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.fbCuSPhoneNumber.fontSize);
                doc.setTextColor(printConfig?.fbCuSPhoneNumber.fontColor);
                doc.text(printConfig?.fbCuSPhoneNumber.label + order?.ref_3, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            if (printConfig?.fbPaymentName != undefined && printConfig?.fbPaymentName.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.fbPaymentName.fontSize);
                doc.setTextColor(printConfig?.fbPaymentName.fontColor);
                doc.text(printConfig?.fbPaymentName.label + order?.ref_4, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            if (printConfig?.fbDeliveryInstraction != undefined && printConfig?.fbDeliveryInstraction.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.fbDeliveryInstraction.fontSize);
                doc.setTextColor(printConfig?.fbDeliveryInstraction.fontColor);
                doc.text(printConfig?.fbDeliveryInstraction.label, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

                var deliveryIns = order?.remarks?.split("+");
                if (deliveryIns?.length > 0) {
                    var splitText = doc.splitTextToSize(deliveryIns[0], Amount_X - Items_X - 1);
                    for (var i = 0, length = splitText?.length; i < length; i++) {
                        doc.text(splitText[i], x + 5, y);
                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        y = jspdfGetNextLineY(doc, y);
                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    }

                    if (deliveryIns?.length > 1) {
                        var splitText = doc.splitTextToSize("    " + deliveryIns[1], Amount_X - Items_X - 1);
                        for (var i = 0, length = splitText?.length; i < length; i++) {
                            doc.text(splitText[i], x, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            y = jspdfGetNextLineY(doc, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        }
                    }
                }
            }
        } else if (
            (sales_no.includes("SAL-TQR") ||
                sales_no.includes("SAL-SOK") ||
                sales_no.includes("SAL-WOR")) &&
            order?.ref_1 &&
            (order?.ref_1.toUpperCase().includes("DELI") ||
                order?.ref_1.toUpperCase().includes("TAKE"))
        ) {
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = y + 5;
            doc.setFont(NOTO_FONT.BLACK);
            doc.setFontSize(10);
            doc.text("Order Information : ", x, y);

            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = y + 5;
            doc.setFont(NOTO_FONT.NORMAL);
            doc.setFontSize(10);

            var customerName = "";
            var contact_no = "";
            var card_no = "";
            var email = "";
            var address = "";
            if (customers?.length > 0) {
                customerName = customers[0].first_name + " - " + customers[0].last_name;
                contact_no = customers[0].contact_no;
                card_no = customers[0].card_no;
                email = customers[0].email;
                var lstaddress = customers[0].custaddrinfodtls;
                if (lstaddress != "") {
                    address = lstaddress[0].address;
                    if (lstaddress[0].address == "") {
                        address += lstaddress[0].country_name + " - " + lstaddress[0].postal_code;
                    } else {
                        address += ", " + lstaddress[0].country_name + " - " + lstaddress[0].postal_code;
                    }
                }
            }

            if (printConfig?.isdefault === true || printConfig?.SALCustomer.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.SALCustomer.fontSize);
                doc.setTextColor(printConfig?.SALCustomer.fontColor);
                doc.text(printConfig?.SALCustomer.label + customerName, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = y + printConfig?.Receipt?.EmptyLine;
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            if (contact_no != "" && contact_no != undefined) {
                if (printConfig?.isdefault === true || printConfig?.SALPhoneNo.visible === true) {
                    var padding = "x".repeat(6);
                    var last4_contact_no = padding + contact_no.slice(-4);
                    doc.setFont(NOTO_FONT.BLACK);
                    doc.setFontSize(printConfig?.SALPhoneNo.fontSize);
                    doc.setTextColor(printConfig?.SALPhoneNo.fontColor);
                    doc.text(printConfig?.SALPhoneNo.label + last4_contact_no, x, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    y = y + printConfig?.Receipt?.EmptyLine;
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                }
            }

            if (printConfig?.isdefault === true || printConfig?.SALCardNo.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.SALCardNo.fontSize);
                doc.setTextColor(printConfig?.SALCardNo.fontColor);
                doc.text(printConfig?.SALCardNo.label + card_no, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = y + printConfig?.Receipt?.EmptyLine;
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            if (email != "" && email != undefined) {
                if (printConfig?.isdefault === true || printConfig?.SALCustomerEmail.visible === true) {
                    doc.setFont(NOTO_FONT.BLACK);
                    doc.setFontSize(printConfig?.SALCustomerEmail.fontSize);
                    doc.setTextColor(printConfig?.SALCustomerEmail.fontColor);
                    doc.text(printConfig?.SALCustomerEmail.label + email, x, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    y = y + printConfig?.Receipt?.EmptyLine;
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                }
            }

            if (address != "" && address != undefined) {
                var start_index = 0;
                var value_end_index = 32;
                var length = address?.length / value_end_index;
                var decimal_val = length.toString().split(".");
                if (decimal_val != "" && parseInt(decimal_val) > 0) {
                    length = parseInt(length) + 1;
                }

                for (var k = 0; k < length; k++) {
                    if (k == 0) {
                        if (printConfig?.isdefault === true || printConfig?.SALCustAddr.visible === true) {
                            doc.setFont(NOTO_FONT.BLACK);
                            doc.setFontSize(printConfig?.SALCustAddr.fontSize);
                            doc.setTextColor(printConfig?.SALCustAddr.fontColor);
                            doc.text(printConfig?.SALCustAddr.label + address.substring(start_index, value_end_index).trim(), x, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            y = y + printConfig?.Receipt?.EmptyLine;
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        }
                    } else {
                        if (printConfig?.isdefault === true || printConfig?.SALCustAddr.visible === true) {
                            doc.text(address.substring(start_index, value_end_index).trim(), x + printConfig?.SALCustAddr.label?.length + 6, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            y = y + printConfig?.Receipt?.EmptyLine;
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        }
                    }
                    start_index = value_end_index;
                    value_end_index = value_end_index + value_end_index;
                }
            }

            if (printConfig?.isdefault === true || printConfig?.SALModeOfOrder.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.SALModeOfOrder.fontSize);
                doc.setTextColor(printConfig?.SALModeOfOrder.fontColor);
                doc.text(printConfig?.SALModeOfOrder.label, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = y + printConfig?.Receipt?.EmptyLine;
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            var spl_remarks = order?.ref_2;
            if (spl_remarks != "" && spl_remarks != undefined) {
                var start_index = 0;
                var value_end_index = 29;
                var length = spl_remarks?.length / value_end_index;
                var decimal_val = length.toString().split(".");
                if (decimal_val != "" && parseInt(decimal_val) > 0) {
                    length = parseInt(length) + 1;
                }

                if (printConfig?.isdefault === true || printConfig?.SALSPLRemarks.visible === true) {
                    for (var k = 0; k < length; k++) {
                        if (k == 0) {
                            doc.setFont(NOTO_FONT.BLACK);
                            doc.setFontSize(printConfig?.SALSPLRemarks.fontSize);
                            doc.setTextColor(printConfig?.SALSPLRemarks.fontColor);
                            doc.text(printConfig?.SALSPLRemarks.label, x, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            y = y + printConfig?.Receipt?.EmptyLine;
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        } else {
                            doc.text(spl_remarks.substring(start_index, value_end_index).trim(), x + printConfig?.SALSPLRemarks.label?.length + 10, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                            y = y + printConfig?.Receipt?.EmptyLine;
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                        }
                        start_index = value_end_index;
                        value_end_index = value_end_index + value_end_index;
                    }
                }
            }

            if (order?.ref_1.toUpperCase().includes("DELI")) {
                if (printConfig?.isdefault === true || printConfig?.SALDeliveryDateTime.visible === true) {
                    doc.setFont(NOTO_FONT.BLACK);
                    doc.setFontSize(printConfig?.SALDeliveryDateTime.fontSize);
                    doc.setTextColor(printConfig?.SALDeliveryDateTime.fontColor);
                    doc.text(printConfig?.SALDeliveryDateTime.label + order?.ref_3, x, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    y = y + printConfig?.Receipt?.EmptyLine;
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                }
            }

            if (order?.ref_1.toUpperCase().includes("TAKE")) {
                if (printConfig?.isdefault === true || printConfig?.SALPickupDateTime.visible === true) {
                    doc.setFont(NOTO_FONT.BLACK);
                    doc.setFontSize(printConfig?.SALPickupDateTime.fontSize);
                    doc.setTextColor(printConfig?.SALPickupDateTime.fontColor);
                    doc.text(printConfig?.SALPickupDateTime.label + order?.ref_4, x, y);
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                    y = y + printConfig?.Receipt?.EmptyLine;
                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                }
            }

            if (printConfig?.isdefault === true || printConfig?.SALOrderRefNo.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.SALOrderRefNo.fontSize);
                doc.setTextColor(printConfig?.SALOrderRefNo.fontColor);
                doc.text(printConfig?.SALOrderRefNo.label + order?.ref_5, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = y + printConfig?.Receipt?.EmptyLine;
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }

            if (printConfig?.isdefault === true || printConfig?.SALFooterDivider.visible === true) {
                doc.setFont(NOTO_FONT.BLACK);
                doc.setFontSize(printConfig?.SALFooterDivider.fontSize);
                doc.setTextColor(printConfig?.SALFooterDivider.fontColor);
                doc.text(printConfig?.SALFooterDivider.label, x, y);
            }

            // POST posorderkitchenother/update - DONE status (SAL-TQR/SOK/WOR delivery/takeaway)
            const res = await fetch('/API/printer/posorderkitchenother/update', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...order,
                    update_for: "KITCHEN_STATUS",
                    kitchen_status_id: "D",
                    kitchen_status_desc: "Done",
                }),
            });

            if (res.ok) {
                const json = await res.json();
                const resData = json?.data?.[0];
                console.log(`[ORDER - UPDATE KITCHEN STATUS] [${json?.message?.toUpperCase()}] ${resData?.information} | id: ${order?.sales_no}`);
            } else {
                console.error(`❌ Kitchen STATUS UPDATE failed → HTTP ${res.status}`);
                const text = await res.text();
                console.error(text);
            }
        }

        // Agreement
        // ✅ Declare BOTH before the if check
        var agreementText = String(getSetting("PRINT SETTINGS", "AGREEMENT", "AGREEMENT_HEADER") ?? '').replaceAll("|n", "\n");
        var consumerProtectionText = String(getSetting("PRINT SETTINGS", "AGREEMENT", "CONSUMER_PROTECTION_TEXT") ?? '').replaceAll("|n", "\n");

        if (
            agreementText?.length > 0 &&
            bool(getSetting("PRINT SETTINGS", "AGREEMENT", "PRINT_AGREEMENT_ON_RECEIPT_FOOTER")) &&
            (printConfig?.isdefault || printConfig?.Receipt?.Agreement.visible)
        ) {
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

            doc.setFont(printConfig?.Receipt?.Agreement.fontFamily);
            doc.setFontSize(printConfig?.Receipt?.Agreement.fontSize);
            doc.setTextColor(printConfig?.Receipt?.Agreement.fontColor);
            doc.text(agreementText, x, y);

            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            y = jspdfGetNextLineY(doc, y);
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

            y = y + printConfig?.Receipt?.EmptyLine;
            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }

            // Consumer Protection
            if (printConfig?.isdefault || printConfig?.Receipt?.ConsumerProtection.visible) {
                doc.setFont(printConfig?.Receipt?.ConsumerProtection.fontFamily);
                doc.setFontSize(printConfig?.Receipt?.ConsumerProtection.fontSize);
                doc.setTextColor(printConfig?.Receipt?.ConsumerProtection.fontColor);
                doc.text(consumerProtectionText, x, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
                y = jspdfGetNextLineY(doc, y);
                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Receipt?.y; }
            }
        }

        var pdf = doc.output("blob");

        // Email
        if (same(type, RECEIPT_PRINT_TYPE.EMAIL)) {
            if (order?.customer_code) {
                var Attachfile = doc.output("blob");
                if (customers[0].email) {
                    await sendEmail(
                        Attachfile,
                        "Receipt?.pdf",
                        customers[0].email,
                        `${store_name} - Receipt - ${date?.replace(/\//g, "-")}`,
                        `Dear ${customers[0].first_name}, Please find the attached documents for your reference. Thanks you!`
                    );
                    console.log(`[ORDER - RECEIPT PRINTING - EMAIL] [SUCCESS] Receipt emailed successfully | id: ${order?.sales_no}`);
                }
            }
        }
        // Print
        else {
            if (same(type, RECEIPT_PRINT_TYPE.QR)) {
                var pdf = doc.output("blob");
                var img = document.getElementById("pdf_url");
                var url = window.URL || window.webkitURL;
                var pdf_url = url.createObjectURL(pdf);
                //   @ts-ignore
                img.src = pdf_url + "#toolbar=0&navpanes=0&scrollbar=0&zoom=100";
            } else {
                const pdf = doc.output("blob");
                const pdfName = `EvolutPOS_${printerName}_${timestamp()}_${index}${isDuplicatedReceipt ? "_Duplicate" : ""}${sales_no ? `_${sales_no}` : ""}_Receipt.pdf`;

                const printOption = getSetting("MORE", "GENERAL", "PRINT_OPTION");
                console.log('🖨️ [receiptPrint] PRINT_OPTION:', printOption, '| PRINT_SERVICE.PRINT:', PRINT_SERVICE.PRINT, '| match:', same(printOption, PRINT_SERVICE.PRINT));

                if (same(type, RECEIPT_PRINT_TYPE.VIEW)) {
                    return `${URL.createObjectURL(pdf)}#toolbar=0&navpanes=0&scrollbar=0&zoom=100`;
                } else if (
                    same(getSetting("MORE", "GENERAL", "PRINT_OPTION"), PRINT_SERVICE.PRINT) ||
                    same(type, RECEIPT_PRINT_TYPE.AUTO)
                ) {
                    await printReceiptAsPng(doc, printerName, pdfName);
                } else {
                    doc.save(pdfName);
                }
            }
            console.log(`[ORDER - ${type} - RECEIPT PRINTING] [SUCCESS] Receipt printed successfully | id: ${order?.sales_no}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
        console.error(`[ORDER - ${type} - RECEIPT PRINTING] [FAIL] Receipt printing failed | id: ${order?.sales_no}`, error);
    }
};