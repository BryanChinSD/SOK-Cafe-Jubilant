//import dayjs from "https://esm.sh/dayjs"; 
// import { contrastColor } from "contrast-color";
//import axios from "axios";
// import jsPDF, { jsPDFOptions } from "jspdf";
import { jsPDF } from "https://esm.sh/jspdf";


import customParseFormat from "https://esm.sh/dayjs/plugin/customParseFormat.js";
dayjs.extend(customParseFormat);

const FONT_URLS = {
    'NotoSerifSC-Regular': '/fonts/NotoSerifSC-Regular.ttf',
    'NotoSerifSC-Black': '/fonts/NotoSerifSC-Black.ttf',
    'NotoSerifSC-Bold': '/fonts/NotoSerifSC-Black.ttf',
    // ✅ Add these aliases to match what printConfig uses:
    'NotoSansSC-Regular': '/fonts/NotoSerifSC-Regular.ttf',
    'NotoSansSC-Bold': '/fonts/NotoSerifSC-Black.ttf',
    'NotoSansSC-Black': '/fonts/NotoSerifSC-Black.ttf',
};

/**
 * Common functions:
 *
 * getNowInAPIFormat                                : get current date and time in API required format.
 * convertToCSV                                     : convert data to CSV.
 * downloadCSVFile                                  : download CSV file.
 * downloadCSVTextFile                              : download CSV text file.
 * onlyDecimals                                     : filter out all characters except numbers and the dot from the string.
 * removeSpecialChars                               : remove special characters from the string.
 * contrast                                         : calculate contrast ratio between a background color and the default text color.
 * bool                                             : convert the string to a boolean.
 * toNormalCase                                     : convert the string to normal case.
 * same                                             : compare two strings without case-sensitive.
 * contains                                         : check if the string is exists in the array or string.
 * isImageExisted                                   : check if an image existsed.
 * timestamp                                        : generate a unique ID using the current timestamp.
 * newPDF                                           : create a new jsPDF instance with the custom font already set.
 * jspdfGetNextLineY                                : get the next line Y position for jsPDF.
 * clone                                            : clone an object.
 * splitCapitalWithSpace                            : split a string by capital letters and join them with a space.
 * number                                           : convert the string or number to a number.
 */
/**
 * Gets current date and time in API required format.
 * @param {string} [date] - Optional date string to use instead of current date
 * @returns {string} Formatted date and time string
 */
export const getNowInAPIFormat = (date) => {
    const now = dayjs().format("YYYY/MM/DD HH:mm:ss");
    if (date) {
        // Keep only the date part of the input and append current time
        const datePart = date.split(' ')[0]; // "YYYY/MM/DD"
        return `${datePart}${now.substring(10)}`; // append current " HH:mm:ss"
    } else {
        return now;
    }
};
/**
 * Converts data to CSV format.
 * @param {any} data - Data to be converted to CSV
 * @returns {string} CSV formatted string
 */
export const convertToCSV = (data) => {
    let array = typeof data != "object" ? JSON.parse(data) : data;
    let str = "";
    let row = "";
    for (let index in array[0]) {
        //Now convert each value to string and comma-separated
        row += index + ",";
    }
    row = row.slice(0, -1);
    //append Label row with line break
    str += row + "\r\n";
    for (let i = 0; i < array.length; i++) {
        let line = "";
        for (let index in array[i]) {
            if (line != "")
                line += ",";
            line += array[i][index];
        }
        str += line + "\r\n";
    }
    return str;
};
/**
 * Downloads data as a CSV file.
 * @param {any} csvData - Data to be downloaded as CSV
 * @param {string} fileName - Name of the file to be downloaded
 * @returns {string} Success message
 */
export const downloadCSVFile = (csvData, fileName) => {
    csvData = convertToCSV(csvData);
    let a = document.createElement("a");
    a.setAttribute("style", "display:none;");
    document.body.appendChild(a);
    let blob = new Blob([csvData], { type: "text/csv" });
    let url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName;
    a.click();
    return "success";
};
/**
 * Downloads CSV data as a text file.
 * @param {string} csvData - CSV data to be downloaded
 * @param {string} fileName - Name of the file to be downloaded
 * @returns {string} Success message
 */
export const downloadCSVTextFile = (csvData, fileName) => {
    let a = document.createElement("a");
    a.setAttribute("style", "display:none;");
    document.body.appendChild(a);
    let blob = new Blob([csvData], { type: "text/plain" });
    let url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName;
    a.click();
    return "success";
};
/**
 * Filters out all characters except numbers, dot and negative sign from the string.
 * @param {string} input - Input string to be filtered
 * @returns {string} Filtered string containing only numbers, dot and negative sign
 */
export const onlyDecimals = (input) => {
    const str = (input === null || input === void 0 ? void 0 : input.toString()) || "";
    const filtered = str.replace(/[^0-9.-]/g, "");
    // Clean up the number string
    const cleaned = filtered
        .replace(/\.{2,}/g, ".") // Multiple dots to single dot
        .replace(/(?<=\..*)\./g, "") // Only allow one dot
        .replace(/-{2,}/g, "-") // Multiple negative signs to single negative
        .replace(/(?<=\d)-/g, "") // Remove negative signs after digits
        .replace(/(?<=-)\./g, "") // Remove dots immediately after negative sign
        .replace(/(?<=\.)-/g, ""); // Remove negative signs after dots
    return cleaned;
};
/**
 * Removes special characters from the string.
 * @param {string} input - Input string to remove special characters from
 * @param {boolean} [acceptEnter] - Whether to accept newline characters
 * @returns {string} String with special characters removed
 */
export const removeSpecialChars = (input, acceptEnter) => {
    return input === null || input === void 0 ? void 0 : input.replace(new RegExp(`[^@.,\\-_0-9a-zA-Z\\u4e00-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff\\uff0c\\u3002 ${acceptEnter ? "\\n" : ""}]`, "g"), "");
};
// /**
//  * Calculates contrast ratio between a background color and the default text color.
//  * @param {string} bgColor - Background color in hex format
//  * @returns {string} Contrasting text color (black or white)
//  */
// export const contrast = (bgColor: string) => {
//   return bgColor ? contrastColor({ bgColor, threshold: 135 }) : "#000000";
// };
/**
 * Converts the string to a boolean.
 * @param {string | number} value - String or number to be converted to boolean
 * @returns {boolean} Converted boolean value
 */
//export const bool = (value) => {
//    return typeof value === "string"
//        ? same(value, "true") || same(value, "1") || same(value, "Y")
//        : !!value;
//};

// bool.js
export const bool = (value) => {
    return typeof value === "string"
        ? same(value, "true") || same(value, "1") || same(value, "Y")
        : !!value;
};
/**
 * Converts the string to normal case with specific words capitalized.
 * @param {string} value - String to be converted to normal case
 * @returns {string} String in normal case with specific words capitalized
 */
export const toNormalCase = (value) => {
    const capitalizedWords = [
        "CRM",
        "KDS",
        "QMS",
        "SKU",
        "API",
        "FMH",
        "NETS",
        "UOB",
        "QLUB",
        "OCBC",
    ];
    return value === null || value === void 0 ? void 0 : value.replace(/\w\S*/g, (word) => {
        if (contains(capitalizedWords, word, false)) {
            return word.toUpperCase();
        }
        else {
            return word.charAt(0).toUpperCase() + word.substr(1).toLowerCase();
        }
    });
};
/**
 * Compares two strings without case-sensitivity.
 * @param {string | number} value1 - First value to compare
 * @param {string | number} value2 - Second value to compare
 * @returns {boolean} True if the values are the same, false otherwise
 */
export const same = (value1, value2) => {
    var _a, _b, _c, _d;
    return (((_b = (_a = value1 === null || value1 === void 0 ? void 0 : value1.toString()) === null || _a === void 0 ? void 0 : _a.toUpperCase()) === null || _b === void 0 ? void 0 : _b.trim()) ===
        ((_d = (_c = value2 === null || value2 === void 0 ? void 0 : value2.toString()) === null || _c === void 0 ? void 0 : _c.toUpperCase()) === null || _d === void 0 ? void 0 : _d.trim()));
};
/**
 * Checks if the string exists in the array or string.
 * @param {string | string[]} value1 - Array of strings or a string to search in
 * @param {string | number} value2 - Value to search for
 * @returns {boolean} True if the value is found, false otherwise
 */
export const contains = (value1, value2, wordWrap = true) => {
    var _a, _b, _c, _d, _e;
    if (Array.isArray(value1)) {
        if (Array.isArray(value2)) {
            if (wordWrap) {
                return value1 === null || value1 === void 0 ? void 0 : value1.some((item) => value2 === null || value2 === void 0 ? void 0 : value2.some((value) => {
                    var _a, _b, _c, _d;
                    return same((_b = (_a = item === null || item === void 0 ? void 0 : item.toString()) === null || _a === void 0 ? void 0 : _a.toUpperCase()) === null || _b === void 0 ? void 0 : _b.trim(), (_d = (_c = value === null || value === void 0 ? void 0 : value.toString()) === null || _c === void 0 ? void 0 : _c.toUpperCase()) === null || _d === void 0 ? void 0 : _d.trim());
                }));
            }
            else {
                return value1 === null || value1 === void 0 ? void 0 : value1.some((item) => {
                    var _a, _b, _c, _d, _e;
                    return (_c = (_b = (_a = item === null || item === void 0 ? void 0 : item.toString()) === null || _a === void 0 ? void 0 : _a.toUpperCase()) === null || _b === void 0 ? void 0 : _b.trim()) === null || _c === void 0 ? void 0 : _c.includes((_e = (_d = value2 === null || value2 === void 0 ? void 0 : value2.toString()) === null || _d === void 0 ? void 0 : _d.toUpperCase()) === null || _e === void 0 ? void 0 : _e.trim());
                });
            }
        }
        else {
            if (wordWrap) {
                return value1 === null || value1 === void 0 ? void 0 : value1.some((item) => {
                    var _a, _b, _c, _d;
                    return same((_b = (_a = item === null || item === void 0 ? void 0 : item.toString()) === null || _a === void 0 ? void 0 : _a.toUpperCase()) === null || _b === void 0 ? void 0 : _b.trim(), (_d = (_c = value2 === null || value2 === void 0 ? void 0 : value2.toString()) === null || _c === void 0 ? void 0 : _c.toUpperCase()) === null || _d === void 0 ? void 0 : _d.trim());
                });
            }
            else {
                return value1 === null || value1 === void 0 ? void 0 : value1.some((item) => {
                    var _a, _b, _c, _d, _e;
                    return (_c = (_b = (_a = item === null || item === void 0 ? void 0 : item.toString()) === null || _a === void 0 ? void 0 : _a.toUpperCase()) === null || _b === void 0 ? void 0 : _b.trim()) === null || _c === void 0 ? void 0 : _c.includes((_e = (_d = value2 === null || value2 === void 0 ? void 0 : value2.toString()) === null || _d === void 0 ? void 0 : _d.toUpperCase()) === null || _e === void 0 ? void 0 : _e.trim());
                });
            }
        }
    }
    else {
        if (Array.isArray(value2)) {
            if (wordWrap) {
                return value2 === null || value2 === void 0 ? void 0 : value2.some((item) => {
                    var _a, _b, _c, _d;
                    return same((_b = (_a = value1 === null || value1 === void 0 ? void 0 : value1.toString()) === null || _a === void 0 ? void 0 : _a.toUpperCase()) === null || _b === void 0 ? void 0 : _b.trim(), (_d = (_c = item === null || item === void 0 ? void 0 : item.toString()) === null || _c === void 0 ? void 0 : _c.toUpperCase()) === null || _d === void 0 ? void 0 : _d.trim());
                });
            }
            else {
                return value2 === null || value2 === void 0 ? void 0 : value2.some((item) => {
                    var _a, _b, _c, _d, _e;
                    return (_c = (_b = (_a = value1 === null || value1 === void 0 ? void 0 : value1.toString()) === null || _a === void 0 ? void 0 : _a.toUpperCase()) === null || _b === void 0 ? void 0 : _b.trim()) === null || _c === void 0 ? void 0 : _c.includes((_e = (_d = item === null || item === void 0 ? void 0 : item.toString()) === null || _d === void 0 ? void 0 : _d.toUpperCase()) === null || _e === void 0 ? void 0 : _e.trim());
                });
            }
        }
        else {
            return (_c = (_b = (_a = value1 === null || value1 === void 0 ? void 0 : value1.toString()) === null || _a === void 0 ? void 0 : _a.toUpperCase()) === null || _b === void 0 ? void 0 : _b.trim()) === null || _c === void 0 ? void 0 : _c.includes((_e = (_d = value2 === null || value2 === void 0 ? void 0 : value2.toString()) === null || _d === void 0 ? void 0 : _d.toUpperCase()) === null || _e === void 0 ? void 0 : _e.trim());
        }
    }
};
/**
 * Checks if an image exists at the given URL.
 * @param {string} imageUrl - URL of the image to check
 * @returns {Promise<boolean>} Promise resolving to true if the image exists, false otherwise
 */
export const isImageExisted = async (imageUrl) => {
    try {
        const res = await axios.head(imageUrl);
        return res.status !== 404;
    } catch (error) {
        return false;
    }
};
/**
 * Generates a unique ID using the current timestamp.
 * @returns {string} Unique ID based on current timestamp
// */
export const timestamp = () => {
  return dayjs().format("YYYYMMDDHHmmssSSS");
};



// ── Font cache ────────────────────────────────────────────────────────
const _fontCache = {};

const fetchFontAsBase64 = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Font fetch failed: ${url} → ${res.status}`);
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

const loadFont = async (name) => {
    if (_fontCache[name]) return _fontCache[name];
    const url = FONT_URLS[name];
    if (!url) throw new Error(`Unknown font: ${name}`);
    console.log(`🔤 [loadFont] Fetching ${name}...`);
    try {
        _fontCache[name] = await fetchFontAsBase64(url);
        console.log(`✅ [loadFont] Loaded ${name}`);
    } catch (err) {
        console.warn(`⚠️ [loadFont] Failed to load ${name}:`, err.message);
        _fontCache[name] = null;
    }
    return _fontCache[name];
};

export const preloadFonts = async () => {
    await Promise.all(Object.keys(FONT_URLS).map(loadFont));
    console.log('✅ [preloadFonts] All fonts ready');
};

export const newPDF = async (options) => {
    const doc = new jsPDF({ compress: true, ...options });

    await Promise.all(Object.keys(FONT_URLS).map(loadFont));

    for (const [name] of Object.entries(FONT_URLS)) {
        const base64 = _fontCache[name];
        if (!base64) continue;
        const fileName = `${name}.ttf`;
        doc.addFileToVFS(fileName, base64);
        doc.addFont(fileName, name, 'normal', 'Identity-H'); // ✅
    }

    const cjkFont = _fontCache['NotoSerifSC-Regular'] ? 'NotoSerifSC-Regular' : null;

    if (cjkFont) {
        const _originalSetFont = doc.setFont.bind(doc);
        doc.setFont = (fontName, fontStyle, fontWeight) => {
            const isBuiltin = ['helvetica', 'courier', 'times', 'symbol', 'zapfdingbats']
                .includes((fontName ?? '').toLowerCase());
            const target = isBuiltin ? cjkFont : (fontName ?? cjkFont);
            try {
                return _originalSetFont(target, fontStyle ?? 'normal', fontWeight);
            } catch {
                // ✅ If font not found, fall back to CJK font silently
                return _originalSetFont(cjkFont, 'normal');
            }
        };

        // ── PATCH splitTextToSize to always use CJK font context ──
        const _originalSplit = doc.splitTextToSize.bind(doc);
        doc.splitTextToSize = (text, maxWidth, options) => {
            // Ensure font is set to CJK before measuring — jsPDF uses
            // the active font's metrics internally for width calculation
            _originalSetFont(cjkFont, 'normal');
            return _originalSplit(text, maxWidth, options);
        };
    }

    doc.setFont(cjkFont ?? 'helvetica');
    console.log(`🖊️ [newPDF] Default font set to: ${cjkFont ?? 'helvetica'}`);
    return doc;
};


// /**
//  * Gets the next line Y position for jsPDF.
//  * @param {jsPDF} doc - jsPDF instance
//  * @param {number} y - Current Y position
//  * @returns {number} Next line Y position
//  */
export const jspdfGetNextLineY = (doc, y) => {
    return Math.ceil(y + doc.getLineHeight() * 0.3514057);
};
/**
 * Clones an object.
 * @param {any} obj - Object to be cloned
 * @returns {any} Cloned object
 */
export const clone = (obj) => {
    return obj ? JSON.parse(JSON.stringify(obj)) : obj;
};
/**
 * Splits a string by capital letters and joins them with a space.
 * @param {string} value - The input string to split
 * @returns {string[]} An array of strings split by capital letters
 */
export const splitCapitalWithSpace = (value) => {
    return value === null || value === void 0 ? void 0 : value.split(/(?=[A-Z])/).join(" ");
};
/**
 * Converts a string or number to a number.
 * @param {string | number} value - The input string or number to convert
 * @returns {number} The converted number
 */
export const number = (value) => {
    return typeof value === "string"
        ? parseInt(value) || 0
        : value || 0;
};


export const getCookie = (name) => {
    if (typeof document === "undefined") return null;
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
        const part = parts.pop()?.split(";").shift();
        return part ? decodeURIComponent(part) : null;
    }
    return null;
};

export const setCookie = (name, value, expires) => {
    if (typeof document === "undefined") return;
    const expiresStr = expires ? `; expires=${expires.toISOString()}` : "";
    document.cookie = `${name}=${value}${expiresStr}; path=/; SameSite=Lax`;
};

preloadFonts().catch(err => console.warn('⚠️ [common.js] Font preload failed:', err));
