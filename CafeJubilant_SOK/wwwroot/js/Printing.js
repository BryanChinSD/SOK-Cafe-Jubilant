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
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { useCache } from '../stores/cache-store.js';



// ── print utility ─────────────────────────────────────────────────────────────
const print = async (pdfBlob, printerName, fileName, rotate = false, useLocal = false) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    console.group(`📤 [print] ${useLocal ? 'Local' : 'Remote'} Send`);
    console.log({ printerName, fileName, useLocal });
    console.groupEnd();

    if (!printerName?.trim()) {
        console.warn('⚠️ [print] BAIL: No printerName');
        return false;
    }

    try {
        let response;

        if (useLocal) {
            // ── Local ASP.NET (Multipart) ──
            const formData = new FormData();
            formData.append('printerName', printerName);
            formData.append('fileName', fileName || 'receipt.pdf');
            formData.append('rotate', rotate);
            formData.append('file', pdfBlob, fileName || 'receipt.pdf');

            response = await fetch('/API/Printer/Print', {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });
        } else {
            // ── Remote Flask (Base64) ──
            const arrayBuffer = await pdfBlob.arrayBuffer();
            const base64data = btoa(
                new Uint8Array(arrayBuffer)
                    .reduce((data, byte) => data + String.fromCharCode(byte), '')
            );

            const flaskDomain = "http://10.0.194.30:5033";
            response = await fetch(`${flaskDomain}/printer/CJ`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    file: base64data,
                    printerName,
                    fileName: fileName || 'undefined',
                    rotate,
                }),
            });
        }

        clearTimeout(timeoutId);

        if (response.ok) {
            console.log(`✅ [PRINT] Success: ${printerName}`);
            return true;
        } else {
            const errorText = await response.text();
            console.error(`❌ [PRINT] Server Error (${response.status}):`, errorText);
            return false;
        }

    } catch (err) {
        if (err.name === 'AbortError') {
            console.error('❌ [PRINT] Timeout: Printer server is unresponsive.');
        } else {
            console.error('❌ [PRINT] Critical Error:', err);
        }
        return false;
    }
};

/**
 * Sends order items to the local Kitchen Server.
 * @param {Array} items - The parsed sales_dtls array.
 * @param {string} salesNo - The SAL number for reference.
 */
/**
 * Sends a PDF Blob to the local Flask Print Server (Port 503).
 */
export async function handleKitchenPrinting(kprintItems, salesNo) {
    try {
        console.log("📤 [print] Kitchen generating PDF for:", salesNo);

        // 1. Create the PDF Blob
        // Use your existing PDF utility (newPDF / jsPDF)
        const doc = new jsPDF();

        // Add your kitchen template logic here (Header, Items, etc.)
        doc.text(`KITCHEN ORDER: ${salesNo}`, 10, 10);
        kprintItems.forEach((item, index) => {
            doc.text(`${item.qty}x ${item.name}`, 10, 20 + (index * 10));
        });

        // 2. Output as Blob
        const blob = doc.output('blob');

        // 3. Now perform the Base64 conversion
        const base64data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            // ✅ parameter 1 is now officially a Blob
            reader.readAsDataURL(blob);
        });

        // 4. Send to your printing API/Service
        const printerName = localStorage.getItem("kitchen_printer_name") || "Kitchen";
        await sendToPrinter(printerName, base64data, salesNo);

    } catch (error) {
        console.error("❌ Kitchen Printjob failed error:", error);
    }
}
// ── printReceiptAsPng ─────────────────────────────────────────────────────────
// Converts jsPDF doc → PNG via canvas, then sends PNG to the print service.
// Thermal printers have no PDF renderer — they need raster image input.
const printReceiptAsPng = async (doc, printerName, pdfName) => {
    try {
        // 1. Get PDF as a data URL and load into pdf.js
        const pdfDataUri = doc.output('datauristring');

        const pdfjsLib = window['pdfjsLib']
            ?? window['pdfjs-dist/build/pdf']
            ?? window['PDFJS'];

        if (!pdfjsLib) {
            console.error('❌ [printReceiptAsPng] pdf.js not found on window — falling back to raw PDF');
            const fallbackBlob = doc.output('blob');
            await print(fallbackBlob, printerName, pdfName, null);
            return;
        }

        const loadingTask = pdfjsLib.getDocument({ url: pdfDataUri });
        const pdfDoc = await loadingTask.promise;

        console.log(`🖼️ [printReceiptAsPng] Rendering ${pdfDoc.numPages} page(s) for printer: ${printerName}`);

        // 2. Render each page to canvas → PNG blob → send to printer
        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);

            // Scale 3x for crisp 203dpi thermal output
            const scale = 3;
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const ctx = canvas.getContext('2d');
            // White background (thermal default is transparent → prints black)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport }).promise;

            // 3. Export canvas as PNG blob
            const pngBlob = await new Promise((resolve, reject) => {
                canvas.toBlob(blob => {
                    if (blob) resolve(blob);
                    else reject(new Error('canvas.toBlob returned null'));
                }, 'image/png');
            });

            const pngName = pdfName.replace('.pdf', `_p${pageNum}.png`);
            console.log(`🖨️ [printReceiptAsPng] Sending page ${pageNum}: ${pngName} | size: ${pngBlob.size}`);

            const success = await print(pngBlob, printerName, pngName, null, true); // ← useLocal = true
            if (!success) {
                console.error(`❌ [printReceiptAsPng] Failed on page ${pageNum}`);
            }
        }

        console.log(`✅ [printReceiptAsPng] Done: ${pdfName}`);

    } catch (err) {
        console.error('❌ [printReceiptAsPng] Error:', err);
        // Fallback: send raw PDF (better than silent failure)
        const fallbackBlob = doc.output('blob');
        await print(fallbackBlob, printerName, pdfName, null, true); // ← useLocal = true
    }
};

// ── KITCHEN PRINT — non-async outer function ──────────────────────────────────
// The outer kitchenPrint() is now synchronous — it returns immediately.
// All PDF building + sending happens inside a detached async IIFE (fire-and-forget).
// This means the caller (completeOrderAfterPayment) is never blocked waiting for kitchen.
export function kitchenPrint(type, data, isGroup, printerNameOverride, tableFrom, allItems = null) {
    (async () => {
        try {
            const { printerSettings, printConfig, register } = useCache();
            let printData = Array.isArray(data) ? data[0] : data;

            tableFrom = tableFrom ?? printData?.table_from ?? "";

            if (!printConfig?.Kitchen) {
                console.warn('🖨️ [kitchen] BAIL: no printConfig.Kitchen');
                return;
            }

            let sales_dtls = printData?.sales_dtls;
            if (typeof sales_dtls === "string") sales_dtls = JSON.parse(sales_dtls);

            if (!Array.isArray(sales_dtls) || sales_dtls.length === 0) {
                console.warn("🖨️ [kitchen] No items to print.");
                return;
            }

            sales_dtls = sales_dtls.map(item => ({ ...item }));
            sales_dtls.forEach((s) => { s.ref_print = 0; });
            sales_dtls.forEach((v) => { v.print_flag = "Y"; });

            sales_dtls.sort((a, b) => {
                if (a.parent_sno !== b.parent_sno) return a.parent_sno - b.parent_sno;
                const aIsChild = a.s_no !== a.parent_sno ? 1 : 0;
                const bIsChild = b.s_no !== b.parent_sno ? 1 : 0;
                return aIsChild - bIsChild;
            });

            sales_dtls.forEach((orderitem) => {
                const categoryPrintBy = orderitem?.e?.[0]?.category_kitchen_print_by;
                if (categoryPrintBy === 1 && orderitem.take_away_item !== "N") {
                    orderitem.printer_name = "";
                } else if (categoryPrintBy === 2 && orderitem.take_away_item !== "Y") {
                    orderitem.printer_name = "";
                }
            });

            let tempData = clone(printData);
            fetch('/API/printer/posorderkitchen/update', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(tempData),
            })
                .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
                .catch(err => console.error('❌ Kitchen PRE-UPDATE failed:', err));

            let printers = Array.from(new Set(
                sales_dtls.map(item => item.printer_name).filter(p => !!p)
            ));

            console.log(`🖨️ [kitchen] Printers to process: [${printers.join(', ')}]`);

            const printQueue = [];

            // ── Deduplicated pool from allItems (one row per s_no, with print_flag/ref_print applied) ──
            // allItems comes from kprintItems (full API response) — we stamp print_flag + ref_print
            // so lstCombo filters work correctly.
            const uniqueItemPool = [...new Map(
                (allItems ?? sales_dtls).map(i => [i.s_no, i])
            ).values()].map(i => ({ ...i, ref_print: 0, print_flag: "Y" }));

            for (const printer_name of printers) {
                const kPrinterName = printerSettings?.find((v) => v.setting_code === printer_name);

                const resolvedPrinterValue =
                    kPrinterName?.setting_value?.trim() ||
                    kPrinterName?.setting_code;

                if (!resolvedPrinterValue) {
                    console.warn(`🖨️ [kitchen] SKIP: no printer value for: ${printer_name}`);
                    continue;
                }

                if (same(kPrinterName.setting_desc, "LABELPRINT")) {
                    console.warn(`🖨️ [kitchen] SKIP: LABELPRINT not handled: ${printer_name}`);
                    continue;
                }

                const orderItems = sales_dtls?.filter(
                    (orderitem) =>
                        same(orderitem?.printer_name, printer_name) &&
                        !bool(orderitem?.ref_print) &&
                        bool(orderitem?.print_flag)
                );

                if (!orderItems?.length) {
                    console.warn(`🖨️ [kitchen] SKIP: no matching orderItems for printer: ${printer_name}`);
                    continue;
                }

                console.log(`🖨️ [kitchen] Processing printer: [${printer_name}] → resolved: [${resolvedPrinterValue}] | items: ${orderItems.length}`);

                try {
                    const sales_no = printData?.sales_no;
                    const status = printData?.order_status_desc;
                    const no_of_pax = printData?.no_of_pax;
                    const register_name = register?.register_name;
                    const doc_date = dayjs(printData?.doc_date).format(DATE_TIME_FORMAT);
                    const m_userid = printData?.m_userid;
                    const table_no = printData?.table_no;

                    // ── SUMMARY / BOTH / SUMMARYFLANG / BOTHFLANG / DOTMATRIX_SUMMARY ──
                    if (contains(
                        ["SUMMARY", "BOTH", "SUMMARYFLANG", "BOTHFLANG", "DOTMATRIX_SUMMARY", "DOTMATRIX_BOTHFLANG"],
                        kPrinterName.setting_desc
                    )) {
                        let doc = await newPDF({ compress: true });
                        if (!doc) {
                            console.error(`❌ [kitchen] newPDF returned null for printer: ${printer_name}`);
                            continue;
                        }

                        let x = printConfig?.Kitchen?.x;
                        let y = printConfig?.Kitchen?.y;
                        const maxWidth = printConfig?.Kitchen?.maxWidth;
                        const pageHeight = doc.internal.pageSize.height - 10;

                        if (contains(["DOTMATRIX"], kPrinterName.setting_desc, false)) {
                            x = 7;
                        }

                        const maxOrderSeq = Math.max.apply(Math, orderItems?.map((item) => item.order_seq));

                        if (table_no && printConfig?.Kitchen?.TopmostTableNo.visible) {
                            y = y + printConfig?.Kitchen?.EmptyLine;
                            y = y + printConfig?.Kitchen?.EmptyLine;
                            doc.setFont(printConfig?.Kitchen?.TopmostTableNo.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.TopmostTableNo.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.TopmostTableNo.fontColor);
                            doc.text(printConfig?.Kitchen?.TopmostTableNo.label + table_no, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

                        if (printConfig?.Kitchen?.AdditionalItems && maxOrderSeq > 1 &&
                            !same(type, KITCHEN_PRINT_TYPE.MANUAL) && !same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM)) {
                            doc.setFont(printConfig?.Kitchen?.AdditionalItems.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.AdditionalItems.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.AdditionalItems.fontColor);
                            doc.text(printConfig?.Kitchen?.AdditionalItems.label, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

                        doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                        doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                        doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                        doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                        y = jspdfGetNextLineY(doc, y);

                        if (!table_no && contains(["SAL-TQR", "SAL-WOR"], sales_no, false)) {
                            doc.text("SELF COLLECT ORDER", x, y);
                            y = jspdfGetNextLineY(doc, y);
                            doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                            doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

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

                        if (printConfig?.Kitchen?.Header.visible) {
                            doc.setFont(printConfig?.Kitchen?.Header.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.Header.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.Header.fontColor);
                            doc.text(printConfig?.Kitchen?.Header.label, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

                        if (printConfig?.Kitchen?.PrinterName.visible) {
                            doc.setFont(printConfig?.Kitchen?.PrinterName.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.PrinterName.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.PrinterName.fontColor);
                            doc.text(kPrinterName?.setting_code, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

                        y = y + printConfig?.Kitchen?.EmptyLine;

                        if (table_no && printConfig?.Kitchen?.TableNo.visible) {
                            doc.setFont(printConfig?.Kitchen?.TableNo.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.TableNo.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.TableNo.fontColor);
                            doc.text(`${printConfig?.Kitchen?.TableNo.label} ${table_no}`, x, y, { align: "left" });
                            y = jspdfGetNextLineY(doc, y);
                        }

                        if (printConfig?.Kitchen?.QueueNo.visible) {
                            doc.setFont(printConfig?.Kitchen?.QueueNo.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.QueueNo.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.QueueNo.fontColor);
                            doc.text(`${printConfig?.Kitchen?.QueueNo.label} ${sales_no.substring(17, 19).trim()}`, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

                        if (printConfig?.Kitchen?.Register.visible) {
                            doc.setFont(printConfig?.Kitchen?.Register.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.Register.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.Register.fontColor);
                            doc.text(printConfig?.Kitchen?.Register.label + register_name, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

                        if (printConfig?.Kitchen?.ShortSalesNo.visible) {
                            doc.setFont(printConfig?.Kitchen?.ShortSalesNo.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.ShortSalesNo.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.ShortSalesNo.fontColor);
                            doc.text(`${printConfig?.Kitchen?.ShortSalesNo.label} ${sales_no.substring(4, 7).trim()}-${sales_no.substring(15, 19).trim()}`, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

                        if (printConfig?.Kitchen?.SalesNo.visible) {
                            doc.setFont(printConfig?.Kitchen?.SalesNo.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.SalesNo.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.SalesNo.fontColor);
                            doc.text(`${printConfig?.Kitchen?.SalesNo.label} ${sales_no}`, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

                        if (printConfig?.Kitchen?.DateTime.visible) {
                            doc.setFont(printConfig?.Kitchen?.DateTime.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.DateTime.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.DateTime.fontColor);
                            doc.text(`${printConfig?.Kitchen?.DateTime.label} ${doc_date}`, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

                        if (printConfig?.Kitchen?.User.visible) {
                            doc.setFont(printConfig?.Kitchen?.User.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.User.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.User.fontColor);
                            doc.text(`${printConfig?.Kitchen?.User.label} ${m_userid}`, x, y);
                            y = jspdfGetNextLineY(doc, y);
                        }

                        if (printConfig?.Kitchen?.Status.visible) {
                            doc.setFont(printConfig?.Kitchen?.Status.fontFamily);
                            doc.setFontSize(printConfig?.Kitchen?.Status.fontSize);
                            doc.setTextColor(printConfig?.Kitchen?.Status.fontColor);
                            doc.text(`${printConfig?.Kitchen?.Status.label} ${status}`, x, y);
                        }

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

                        const Qty_X = printConfig?.Kitchen?.QtyValue.x;
                        const Items_X = printConfig?.Kitchen?.ItemsValue.x;

                        // Filter uniqueItemPool to items that belong to this printer's order groups
                        const summaryParentSnos = new Set(
                            sales_dtls
                                .filter(item => same(item.printer_name, printer_name))
                                .map(item => item.parent_sno)
                        );
                        const summaryItems = uniqueItemPool.filter(i =>
                            summaryParentSnos.has(i.parent_sno) || summaryParentSnos.has(i.s_no)
                        );

                        const lstTakeEatSummary = Array.from(new Set(summaryItems.map((o) => o.take_away_item)));

                        lstTakeEatSummary?.forEach((te) => {
                            const lstTakeAway = summaryItems.filter((v) => v.take_away_item === te);

                            if (te === "N" && printConfig?.Kitchen?.DineIn.visible && !contains(["T", "D"], printData?.service_type)) {
                                doc.setFont(printConfig?.Kitchen?.DineIn.fontFamily);
                                doc.setFontSize(printConfig?.Kitchen?.DineIn.fontSize);
                                doc.setTextColor(printConfig?.Kitchen?.DineIn.fontColor);
                                doc.text(printConfig?.Kitchen?.DineIn.label, x, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                            } else if (printConfig?.Kitchen?.TakeAway.visible) {
                                doc.setFont(printConfig?.Kitchen?.TakeAway.fontFamily);
                                doc.setFontSize(printConfig?.Kitchen?.TakeAway.fontSize);
                                doc.setTextColor(printConfig?.Kitchen?.TakeAway.fontColor);
                                doc.text(printConfig?.Kitchen?.TakeAway.label, x, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                            }

                            lstTakeAway?.forEach((v, index) => {
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

                                doc.setFont(printConfig?.Kitchen?.ItemsValue.fontFamily);
                                doc.setFontSize(printConfig?.Kitchen?.ItemsValue.fontSize);
                                doc.setTextColor(printConfig?.Kitchen?.ItemsValue.fontColor);
                                let ls_itemdesc = "";
                                if (contains(["SUMMARYFLANG", "BOTHFLANG", "DOTMATRIX_SUMMARY", "DOTMATRIX_BOTHFLANG"], kPrinterName.setting_desc)) {
                                    ls_itemdesc = v.s_no == v.parent_sno ? v.flang_desc.toString() : `(${v.qty.toString()}) ${v.flang_desc.toString()}`;
                                } else {
                                    if (v.s_no == v.parent_sno) {
                                        ls_itemdesc = v.item_desc.toString();
                                    } else {
                                        ls_itemdesc = isWeightableItem(v)
                                            ? `(${parseFloat(v.qty).toString()}) ${v.uom.toString()} ${v.item_desc.toString()}`
                                            : `(${parseFloat(v.qty).toString()}) ${v.item_desc.toString()}`;
                                    }
                                }
                                const splitText = doc.splitTextToSize(ls_itemdesc, maxWidth - Items_X - 1);
                                for (let i = 0; i < splitText.length; i++) {
                                    doc.text(splitText[i], isWeightableItem(v) && v.s_no == v.parent_sno ? Items_X + 17 : Items_X, y);
                                    if (i < splitText.length - 1) {
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    }
                                }

                                if (v.remarks && printConfig?.Kitchen.Remarks.visible) {
                                    const ls_itemremarks = v.remarks.toString();
                                    const splitRemarks = [];
                                    let currentLine = "";
                                    const maxLineWidth = maxWidth - Items_X - 1;
                                    for (let charIndex = 0; charIndex < ls_itemremarks.length; charIndex++) {
                                        const testLine = currentLine + ls_itemremarks[charIndex];
                                        if (doc.getTextWidth(testLine) > maxLineWidth && currentLine.length > 0) {
                                            splitRemarks.push(currentLine);
                                            currentLine = ls_itemremarks[charIndex];
                                        } else {
                                            currentLine = testLine;
                                        }
                                    }
                                    if (currentLine.length > 0) splitRemarks.push(currentLine);

                                    for (let i = 0; i < splitRemarks.length; i++) {
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen.y; }
                                        if (v.s_no == v.parent_sno) {
                                            if (i == 0) { doc.text("**", Qty_X, y); doc.text(splitRemarks[i], Items_X, y); }
                                            else { doc.text(splitRemarks[i], Items_X, y); }
                                        } else {
                                            if (i == 0) { doc.text("**", Items_X, y); doc.text(splitRemarks[i], Items_X + 7, y); }
                                            else { doc.text(splitRemarks[i], Items_X + 7, y); }
                                        }
                                    }
                                }

                                if (index < lstTakeAway.length - 1 && lstTakeAway[index + 1].parent_sno !== v.parent_sno) {
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                }

                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                            });

                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                            y = jspdfGetNextLineY(doc, y);
                            if (y >= pageHeight) { doc.addPage(); y = printConfig?.Kitchen?.y; }
                        });

                        doc.setFont(printConfig?.Kitchen?.StarDivider.fontFamily);
                        doc.setFontSize(printConfig?.Kitchen?.StarDivider.fontSize);
                        doc.setTextColor(printConfig?.Kitchen?.StarDivider.fontColor);
                        doc.text(printConfig?.Kitchen?.StarDivider.label, x, y);

                        const pdf = doc.output("blob");
                        const pdfName = `EvolutPOS_${resolvedPrinterValue}_${timestamp()}_${same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM) ? "CANCEL_ITEM" : ""}_${kPrinterName.setting_desc}_${sales_no}_Kitchen_Receipt.pdf`;
                        printQueue.push({
                            pdfName,
                            type: KITCHEN_PRINTING.SUMMARY,
                            func: () => print(pdf, resolvedPrinterValue, pdfName),
                        });
                        console.log(`✅ [kitchen] SUMMARY PDF queued for [${printer_name}] → [${resolvedPrinterValue}]`);
                    }

                    // ── SINGLE / BOTH / SINGLEFLANG / BOTHFLANG ──
                    if (contains(
                        ["SINGLE", "BOTH", "SINGLEFLANG", "BOTHFLANG", "DOTMATRIX_SINGLEFLANG", "DOTMATRIX_BOTHFLANG"],
                        kPrinterName.setting_desc
                    )) {
                        let single_print_index = 0;
                        const seenSno = new Set();

                        // Find parent_sno values for all items assigned to this printer.
                        // This covers child-only printers (e.g. K3 only has Cabbage s_no:2,
                        // but its parent_sno:1 points to Hotpot which we need to print).
                        const printerParentSnos = new Set(
                            sales_dtls
                                .filter(item => same(item.printer_name, printer_name))
                                .map(item => item.parent_sno)
                        );

                        // Get parent items from uniqueItemPool whose s_no is in printerParentSnos
                        const lstTakeEatSingle = Array.from(new Set(
                            uniqueItemPool
                                .filter(item => item.s_no === item.parent_sno && printerParentSnos.has(item.s_no))
                                .map(o => o.take_away_item)
                        ));

                        console.log(`🖨️ [kitchen] SINGLE [${printer_name}] printerParentSnos: [${[...printerParentSnos]}] | lstTakeEat: [${lstTakeEatSingle}]`);

                        for (const te of lstTakeEatSingle) {
                            const lstTakeAway = uniqueItemPool.filter(
                                v => v.take_away_item === te
                                    && v.s_no === v.parent_sno
                                    && printerParentSnos.has(v.s_no)
                            );

                            for (const v of lstTakeAway) {
                                if (seenSno.has(v.s_no)) continue;
                                seenSno.add(v.s_no);

                                single_print_index = single_print_index + 1;

                                let doc = await newPDF({ compress: true });
                                const kConfig = printConfig.Kitchen;
                                let x = kConfig.x;
                                let y = kConfig.y;
                                const maxWidth = kConfig.maxWidth;
                                const pageHeight = doc.internal.pageSize.height - 10;
                                const maxOrderSeq = Math.max.apply(Math, sales_dtls?.map((item) => item.order_seq));

                                if (table_no && kConfig.TopmostTableNo.visible) {
                                    y = y + kConfig.EmptyLine;
                                    y = y + kConfig.EmptyLine;
                                    doc.setFont(kConfig.TopmostTableNo.fontFamily);
                                    doc.setFontSize(kConfig.TopmostTableNo.fontSize);
                                    doc.setTextColor(kConfig.TopmostTableNo.fontColor);
                                    doc.text(kConfig.TopmostTableNo.label + table_no, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                if (kConfig.AdditionalItems && maxOrderSeq > 1 &&
                                    !same(type, KITCHEN_PRINT_TYPE.MANUAL) && !same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM)) {
                                    doc.setFont(kConfig.AdditionalItems.fontFamily);
                                    doc.setFontSize(kConfig.AdditionalItems.fontSize);
                                    doc.setTextColor(kConfig.AdditionalItems.fontColor);
                                    doc.text(kConfig.AdditionalItems.label, x, y);
                                    y = y + kConfig.EmptyLine * 2;
                                }

                                doc.setFont(kConfig.StarDivider.fontFamily);
                                doc.setFontSize(kConfig.StarDivider.fontSize);
                                doc.setTextColor(kConfig.StarDivider.fontColor);
                                doc.text(kConfig.StarDivider.label, x, y);
                                y = jspdfGetNextLineY(doc, y);

                                if (!table_no && contains(["SAL-TQR", "SAL-WOR"], sales_no, false)) {
                                    doc.text("SELF COLLECT ORDER", x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                    doc.setFont(kConfig.StarDivider.fontFamily);
                                    doc.setFontSize(kConfig.StarDivider.fontSize);
                                    doc.setTextColor(kConfig.StarDivider.fontColor);
                                    doc.text(kConfig.StarDivider.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                if (tableFrom && kConfig.TransferTable.visible) {
                                    y = y + kConfig.EmptyLine;
                                    doc.setFont(kConfig.TransferTable.fontFamily);
                                    doc.setFontSize(kConfig.TransferTable.fontSize);
                                    doc.setTextColor(kConfig.TransferTable.fontColor);
                                    doc.text(`${kConfig.TransferTable.label} ${tableFrom} to ${table_no}`, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                    y = y + kConfig.EmptyLine;
                                    doc.setFont(kConfig.StarDivider.fontFamily);
                                    doc.setFontSize(kConfig.StarDivider.fontSize);
                                    doc.setTextColor(kConfig.StarDivider.fontColor);
                                    doc.text(kConfig.StarDivider.label, x, y);
                                    y = jspdfGetNextLineY(doc, y);
                                }

                                if (same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM) && kConfig.Cancel.visible) {
                                    y = y + kConfig.EmptyLine;
                                    doc.setFont(kConfig.Cancel.fontFamily); doc.setFontSize(kConfig.Cancel.fontSize); doc.setTextColor(kConfig.Cancel.fontColor);
                                    doc.text(kConfig.Cancel.label, x, y); y = jspdfGetNextLineY(doc, y); y = y + kConfig.EmptyLine;
                                    doc.setFont(kConfig.StarDivider.fontFamily); doc.setFontSize(kConfig.StarDivider.fontSize); doc.setTextColor(kConfig.StarDivider.fontColor);
                                    doc.text(kConfig.StarDivider.label, x, y); y = jspdfGetNextLineY(doc, y);
                                }

                                if (status === "Void" && kConfig.Void.visible) {
                                    y = y + kConfig.EmptyLine;
                                    doc.setFont(kConfig.Void.fontFamily); doc.setFontSize(kConfig.Void.fontSize); doc.setTextColor(kConfig.Void.fontColor);
                                    doc.text(kConfig.Void.label, x, y); y = jspdfGetNextLineY(doc, y); y = y + kConfig.EmptyLine;
                                    doc.setFont(kConfig.StarDivider.fontFamily); doc.setFontSize(kConfig.StarDivider.fontSize); doc.setTextColor(kConfig.StarDivider.fontColor);
                                    doc.text(kConfig.StarDivider.label, x, y); y = jspdfGetNextLineY(doc, y);
                                }

                                if (kConfig.SingleHeader.visible) {
                                    doc.setFont(kConfig.SingleHeader.fontFamily); doc.setFontSize(kConfig.SingleHeader.fontSize); doc.setTextColor(kConfig.SingleHeader.fontColor);
                                    doc.text(kConfig.SingleHeader.label, x, y); y = jspdfGetNextLineY(doc, y);
                                }
                                if (kConfig.PrinterName.visible) {
                                    doc.setFont(kConfig.PrinterName.fontFamily); doc.setFontSize(kConfig.PrinterName.fontSize); doc.setTextColor(kConfig.PrinterName.fontColor);
                                    doc.text(kPrinterName?.setting_code, x, y); y = jspdfGetNextLineY(doc, y); y = y + kConfig.EmptyLine;
                                }
                                if (table_no && kConfig.TableNo.visible) {
                                    doc.setFont(kConfig.TableNo.fontFamily); doc.setFontSize(kConfig.TableNo.fontSize); doc.setTextColor(kConfig.TableNo.fontColor);
                                    doc.text(`${kConfig.TableNo.label} ${table_no}`, x, y, { align: "left" }); y = jspdfGetNextLineY(doc, y);
                                }
                                if (kConfig.QueueNo.visible) {
                                    doc.setFont(kConfig.QueueNo.fontFamily); doc.setFontSize(kConfig.QueueNo.fontSize); doc.setTextColor(kConfig.QueueNo.fontColor);
                                    doc.text(`${kConfig.QueueNo.label} ${sales_no.substring(17, 19).trim()}`, x, y); y = jspdfGetNextLineY(doc, y);
                                }
                                if (kConfig.Register.visible) {
                                    doc.setFont(kConfig.Register.fontFamily); doc.setFontSize(kConfig.Register.fontSize); doc.setTextColor(kConfig.Register.fontColor);
                                    doc.text(kConfig.Register.label + register_name, x, y); y = jspdfGetNextLineY(doc, y);
                                }
                                if (kConfig.ShortSalesNo.visible) {
                                    doc.setFont(kConfig.ShortSalesNo.fontFamily); doc.setFontSize(kConfig.ShortSalesNo.fontSize); doc.setTextColor(kConfig.ShortSalesNo.fontColor);
                                    doc.text(`${kConfig.ShortSalesNo.label} ${sales_no.substring(4, 7).trim()}-${sales_no.substring(15, 19).trim()}`, x, y); y = jspdfGetNextLineY(doc, y);
                                }
                                if (kConfig.SalesNo.visible) {
                                    doc.setFont(kConfig.SalesNo.fontFamily); doc.setFontSize(kConfig.SalesNo.fontSize); doc.setTextColor(kConfig.SalesNo.fontColor);
                                    doc.text(`${kConfig.SalesNo.label} ${sales_no}`, x, y); y = jspdfGetNextLineY(doc, y);
                                }
                                if (kConfig.DateTime.visible) {
                                    doc.setFont(kConfig.DateTime.fontFamily); doc.setFontSize(kConfig.DateTime.fontSize); doc.setTextColor(kConfig.DateTime.fontColor);
                                    doc.text(`${kConfig.DateTime.label} ${doc_date}`, x, y); y = jspdfGetNextLineY(doc, y);
                                }
                                if (kConfig.User.visible) {
                                    doc.setFont(kConfig.User.fontFamily); doc.setFontSize(kConfig.User.fontSize); doc.setTextColor(kConfig.User.fontColor);
                                    doc.text(`${kConfig.User.label} ${m_userid}`, x, y); y = jspdfGetNextLineY(doc, y);
                                }
                                if (kConfig.Status.visible) {
                                    doc.setFont(kConfig.Status.fontFamily); doc.setFontSize(kConfig.Status.fontSize); doc.setTextColor(kConfig.Status.fontColor);
                                    doc.text(`${kConfig.Status.label} ${status}`, x, y);
                                }
                                if (kConfig.NoOfPax.visible) {
                                    doc.setFont(kConfig.NoOfPax.fontFamily); doc.setFontSize(kConfig.NoOfPax.fontSize); doc.setTextColor(kConfig.NoOfPax.fontColor);
                                    doc.text(`${kConfig.NoOfPax.label} ${no_of_pax}`, maxWidth, y, { align: "right" });
                                }
                                y = jspdfGetNextLineY(doc, y);

                                doc.setFont(kConfig.DashDivider.fontFamily); doc.setFontSize(kConfig.DashDivider.fontSize); doc.setTextColor(kConfig.DashDivider.fontColor);
                                doc.text(kConfig.DashDivider.label, x, y); y = jspdfGetNextLineY(doc, y);

                                const Qty_X = kConfig.QtyValue.x;
                                const Items_X = kConfig.ItemsValue.x;

                                if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                y = jspdfGetNextLineY(doc, y);
                                if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }

                                if (te === "N" && kConfig.DineIn.visible && !contains(["T", "D"], printData?.service_type)) {
                                    doc.setFont(kConfig.DineIn.fontFamily); doc.setFontSize(kConfig.DineIn.fontSize); doc.setTextColor(kConfig.DineIn.fontColor);
                                    doc.text(kConfig.DineIn.label, x, y);
                                    if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                }

                                // Get all items (parent + children) for this parent item
                                const lstCombo = uniqueItemPool.filter((i) =>
                                    (i.parent_sno === v.s_no || i.s_no === v.s_no) &&
                                    i.ref_print === 0 && i.print_flag === "Y" &&
                                    (
                                        i.s_no === v.s_no ||
                                        sales_dtls.some(sd => sd.s_no === i.s_no && same(sd.printer_name, printer_name))
                                    )
                                );

                                if (lstCombo.length === 0) continue;

                                // Mark these items as printed to avoid re-printing in subsequent printer loops
                                uniqueItemPool.forEach((s) => {
                                    const inCombo = lstCombo.some((i) =>
                                        (i.parent_sno === s.s_no || i.s_no === s.s_no) && i.print_flag === "Y"
                                    );
                                    if (inCombo) s.ref_print = 1;
                                });

                                lstCombo?.forEach((v) => {
                                    if (kConfig.TakeAway.visible && (v.take_away_item === "Y" || contains(["T", "D"], printData?.service_type))) {
                                        doc.setFont(kConfig.TakeAway.fontFamily); doc.setFontSize(kConfig.TakeAway.fontSize); doc.setTextColor(kConfig.TakeAway.fontColor);
                                        doc.text(kConfig.TakeAway.label, x, y);
                                        if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                        y = jspdfGetNextLineY(doc, y);
                                        if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                    }

                                    doc.setFont(kConfig.QtyValue.fontFamily); doc.setFontSize(kConfig.QtyValue.fontSize); doc.setTextColor(kConfig.QtyValue.fontColor);
                                    if (v.s_no == v.parent_sno) {
                                        doc.text(isWeightableItem(v)
                                            ? `   ${parseFloat(v.qty).toString()} ${v.uom.toString()}`
                                            : `   ${v.qty.toString()}`, Qty_X, y);
                                    }

                                    doc.setFont(kConfig.ItemsValue.fontFamily); doc.setFontSize(kConfig.ItemsValue.fontSize); doc.setTextColor(kConfig.ItemsValue.fontColor);
                                    let ls_itemdesc = "";
                                    if (contains(["SINGLEFLANG", "BOTHFLANG", "DOTMATRIX_SINGLEFLANG", "DOTMATRIX_BOTHFLANG"], kPrinterName.setting_desc)) {
                                        ls_itemdesc = v.s_no == v.parent_sno ? v.flang_desc.toString() : `(${v.qty.toString()}) ${v.flang_desc.toString()}`;
                                    } else {
                                        if (v.s_no == v.parent_sno) { ls_itemdesc = v.item_desc.toString(); }
                                        else { ls_itemdesc = isWeightableItem(v) ? `(${parseFloat(v.qty).toString()}) ${v.uom.toString()} ${v.item_desc.toString()}` : `(${parseFloat(v.qty).toString()}) ${v.item_desc.toString()}`; }
                                    }
                                    const splitText = doc.splitTextToSize(ls_itemdesc, maxWidth - Items_X - 1);
                                    for (let i = 0; i < splitText.length; i++) {
                                        doc.text(splitText[i], isWeightableItem(v) && v.s_no == v.parent_sno ? Items_X + 17 : Items_X, y);
                                        if (i < splitText.length - 1) {
                                            if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                        }
                                    }

                                    if (v.remarks && kConfig.Remarks.visible) {
                                        const splitText = doc.splitTextToSize(v.remarks.toString(), maxWidth);
                                        for (let i = 0; i < splitText.length; i++) {
                                            if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                            y = jspdfGetNextLineY(doc, y);
                                            if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                            if (v.s_no == v.parent_sno) {
                                                if (i == 0) { doc.text("**", Qty_X, y); doc.text(splitText[i], Items_X, y); }
                                                else { doc.text(splitText[i], Items_X, y); }
                                            } else {
                                                if (i == 0) { doc.text("**", Items_X, y); doc.text(splitText[i], Items_X + 7, y); }
                                                else { doc.text(splitText[i], Items_X + 7, y); }
                                            }
                                        }
                                    }

                                    if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                    y = jspdfGetNextLineY(doc, y);
                                    if (y >= pageHeight) { doc.addPage(); y = kConfig.y; }
                                });

                                doc.setFont(kConfig.StarDivider.fontFamily); doc.setFontSize(kConfig.StarDivider.fontSize); doc.setTextColor(kConfig.StarDivider.fontColor);
                                doc.text(kConfig.StarDivider.label, x, y);

                                const pdf = doc.output("blob");
                                const pdfName = `EvolutPOS_${resolvedPrinterValue}_${timestamp()}_${same(type, KITCHEN_PRINT_TYPE.CANCEL_ITEM) ? "CANCEL_ITEM" : ""}_${kPrinterName.setting_desc}_${sales_no}_Kitchen_Receipt.pdf`;
                                printQueue.push({
                                    pdfName,
                                    type: KITCHEN_PRINTING.SINGLE,
                                    func: () => print(pdf, resolvedPrinterValue, pdfName),
                                });
                                console.log(`✅ [kitchen] SINGLE PDF queued for [${printer_name}] → [${resolvedPrinterValue}]`);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`❌ [kitchen] Error building PDF for printer: ${printer_name}`, error);
                }
            }

            console.log(`🖨️ [kitchen] Total print queue: ${printQueue.length}`);

            await Promise.allSettled(
                printQueue.map(async (current, i) => {
                    const printDelayBeforeKitchenPrint =
                        parseFloat(getSetting("MORE", "KITCHEN", "PRINT_DELAY_BEFORE_KITCHEN_PRINT")) || 0;
                    if (printDelayBeforeKitchenPrint > 0)
                        await new Promise((resolve) => setTimeout(resolve, printDelayBeforeKitchenPrint * 1000));

                    try {
                        await current.func();
                        console.log(`[ORDER - ${type} - KITCHEN PRINTING] [SUCCESS] | id: ${printData?.sales_no} | res: ${current.pdfName}`);
                        const next = printQueue[i + 1];
                        if (next && same(current?.type, KITCHEN_PRINTING.SUMMARY) && same(next?.type, KITCHEN_PRINTING.SINGLE)) {
                            await new Promise((resolve) => setTimeout(resolve, 500));
                        }
                    } catch (error) {
                        console.error(`[ORDER - ${type} - KITCHEN PRINTING] [FAIL] | id: ${printData?.sales_no} | res: ${current.pdfName}`, error);
                    }
                })
            );

        } catch (error) {
            console.error(`[ORDER - ${type} - KITCHEN PRINTING] [FAIL] | id: ${(Array.isArray(data) ? data[0] : data)?.sales_no}`, error);
        }
    })();
}

export const receiptPrint = async (
    type,
    data,
    index = "0",
    printerNameOverride = null    // ← add this
) => {
    const { store, promos, printConfig, printerSettings } = useCache();
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

    const currentPrinter = printerSettings?.find(p => p.printer_name === printerName);

    if ((!printerName || !printConfig?.Receipt) && !same(type, RECEIPT_PRINT_TYPE.VIEW)) {
        console.warn('⚠️ [receiptPrint] BAIL — printer:', printerName, '| config:', !!printConfig?.Receipt);
        return;
    }

    try {
        var customers = [];

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

        console.log('🛠️ [PDF Init] Attempting to init with profile:', printerName);
        let doc = await newPDF({ compress: true });

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
            doc.setFont(printConfig?.Receipt?.TopmostTableNo.fontFamily);
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
            doc.setFont(printConfig?.Receipt?.StoreName.fontFamily);
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
        doc.setFont(printConfig?.Receipt?.DashDivider.fontFamily);
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
        )?.sort();;


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
        var agreementText = (getSetting("PRINT SETTINGS", "AGREEMENT", "AGREEMENT_HEADER") ?? '').replaceAll("|n", "\n");
        var consumerProtectionText = (getSetting("PRINT SETTINGS", "AGREEMENT", "CONSUMER_PROTECTION_TEXT") ?? '').replaceAll("|n", "\n");

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
        } else {
            if (same(type, RECEIPT_PRINT_TYPE.QR)) {
                var pdf = doc.output("blob");
                var img = document.getElementById("pdf_url");
                var url = window.URL || window.webkitURL;
                var pdf_url = url.createObjectURL(pdf);
                // @ts-ignore
                img.src = pdf_url + "#toolbar=0&navpanes=0&scrollbar=0&zoom=100";
            } else {
                const pdf = doc.output("blob");
                const pdfName = `EvolutPOS_${printerName}_${timestamp()}_${index}${isDuplicatedReceipt ? "_Duplicate" : ""}${sales_no ? `_${sales_no}` : ""}_Receipt.pdf`;
                const printOption = getSetting("MORE", "GENERAL", "PRINT_OPTION");
                console.log('🖨️ [receiptPrint] PRINT_OPTION:', printOption, '| PRINT_SERVICE.PRINT:', PRINT_SERVICE.PRINT, '| match:', same(printOption, PRINT_SERVICE.PRINT));

                if (same(type, RECEIPT_PRINT_TYPE.VIEW)) {
                    return `${URL.createObjectURL(pdf)}#toolbar=0&navpanes=0&scrollbar=0&zoom=100`;
                } else {
                    // ✅ Always route through local ASP.NET printer — no doc.save(), no Flask
                    await print(pdf, printerName, pdfName, false, true);
                }
            }
            console.log(`[ORDER - ${type} - RECEIPT PRINTING] [SUCCESS] Receipt printed successfully | id: ${order?.sales_no}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
        console.error(`[ORDER - ${type} - RECEIPT PRINTING] [FAIL] Receipt printing failed | id: ${order?.sales_no}`, error);
    }
};