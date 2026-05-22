import dayjs from "dayjs";
//import axios from "axios";
// import jsPDF, { jsPDFOptions } from "jspdf";

import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

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
export const getNowInAPIFormat = (date?: string) => {
  const now = dayjs().format("YYYY/MM/DD HH:mm:ss");
  if (date) {
    return `${date}${now.substring(10)}`;
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
      if (line != "") line += ",";

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
export const downloadCSVTextFile = (csvData: string, fileName: string) => {
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
export const onlyDecimals = (input: string) => {
  const str = input?.toString() || "";
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
export const removeSpecialChars = (input: string, acceptEnter?: boolean) => {
  return input?.replace(
    new RegExp(
      `[^@.,\\-_0-9a-zA-Z\\u4e00-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff\\uff0c\\u3002 ${
        acceptEnter ? "\\n" : ""
      }]`,
      "g"
    ),
    ""
  );
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
export const bool = (value: string | number) => {
  return typeof value === "string"
    ? same(value, "true") || same(value, "1") || same(value, "Y")
    : !!value;
};

/**
 * Converts the string to normal case with specific words capitalized.
 * @param {string} value - String to be converted to normal case
 * @returns {string} String in normal case with specific words capitalized
 */
export const toNormalCase = (value: string) => {
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

  return value?.replace(/\w\S*/g, (word) => {
    if (contains(capitalizedWords, word, false)) {
      return word.toUpperCase();
    } else {
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
export const same = (value1: string | number, value2: string | number) => {
  return (
    value1?.toString()?.toUpperCase()?.trim() ===
    value2?.toString()?.toUpperCase()?.trim()
  );
};

/**
 * Checks if the string exists in the array or string.
 * @param {string | string[]} value1 - Array of strings or a string to search in
 * @param {string | number} value2 - Value to search for
 * @returns {boolean} True if the value is found, false otherwise
 */
export const contains = (
  value1: (string | number) | (string | number)[],
  value2: (string | number) | (string | number)[],
  wordWrap: boolean = true
) => {
  if (Array.isArray(value1)) {
    if (Array.isArray(value2)) {
      if (wordWrap) {
        return value1?.some((item) =>
          value2?.some((value) =>
            same(
              item?.toString()?.toUpperCase()?.trim(),
              value?.toString()?.toUpperCase()?.trim()
            )
          )
        );
      } else {
        return value1?.some((item) =>
          item
            ?.toString()
            ?.toUpperCase()
            ?.trim()
            ?.includes(value2?.toString()?.toUpperCase()?.trim())
        );
      }
    } else {
      if (wordWrap) {
        return value1?.some((item) =>
          same(
            item?.toString()?.toUpperCase()?.trim(),
            value2?.toString()?.toUpperCase()?.trim()
          )
        );
      } else {
        return value1?.some((item) =>
          item
            ?.toString()
            ?.toUpperCase()
            ?.trim()
            ?.includes(value2?.toString()?.toUpperCase()?.trim())
        );
      }
    }
  } else {
    if (Array.isArray(value2)) {
      if (wordWrap) {
        return value2?.some((item) =>
          same(
            value1?.toString()?.toUpperCase()?.trim(),
            item?.toString()?.toUpperCase()?.trim()
          )
        );
      } else {
        return value2?.some((item) =>
          value1
            ?.toString()
            ?.toUpperCase()
            ?.trim()
            ?.includes(item?.toString()?.toUpperCase()?.trim())
        );
      }
    } else {
      return value1
        ?.toString()
        ?.toUpperCase()
        ?.trim()
        ?.includes(value2?.toString()?.toUpperCase()?.trim());
    }
  }
};

/**
 * Checks if an image exists at the given URL.
 * @param {string} imageUrl - URL of the image to check
 * @returns {Promise<boolean>} Promise resolving to true if the image exists, false otherwise
 */
//export const isImageExisted = async (imageUrl: string) => {
//  try {
//    const res = await axios.head(imageUrl);
//    return res.status != 404;
//  } catch (error) {
//    return false;
//  }
//};

/**
 * Generates a unique ID using the current timestamp.
 * @returns {string} Unique ID based on current timestamp
// */
//export const timestamp = () => {
//  return dayjs().format("YYYYMMDDHHmmssSSS");
//};

// /**
//  * Creates a new jsPDF instance with the custom font already set.
//  * @returns {jsPDF} jsPDF instance with the custom font set
//  */
// export const newPDF = (options?: jsPDFOptions) => {
//   return new jsPDF({
//     compress: true, // Enable compression
//     ...options,
//   });
// };

// /**
//  * Gets the next line Y position for jsPDF.
//  * @param {jsPDF} doc - jsPDF instance
//  * @param {number} y - Current Y position
//  * @returns {number} Next line Y position
//  */
// export const jspdfGetNextLineY = (doc: jsPDF, y: number) => {
//   return Math.ceil(y + doc.getLineHeight() * 0.3514057);
// };

/**
 * Clones an object.
 * @param {any} obj - Object to be cloned
 * @returns {any} Cloned object
 */
export const clone = (obj: any) => {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
};

/**
 * Splits a string by capital letters and joins them with a space.
 * @param {string} value - The input string to split
 * @returns {string[]} An array of strings split by capital letters
 */
export const splitCapitalWithSpace = (value: string) => {
  return value?.split(/(?=[A-Z])/).join(" ");
};

/**
 * Converts a string or number to a number.
 * @param {string | number} value - The input string or number to convert
 * @returns {number} The converted number
 */
export const number = (value: string | number) => {
  return typeof value === "string"
    ? parseInt(value) || 0
    : (value as number) || 0;
};
