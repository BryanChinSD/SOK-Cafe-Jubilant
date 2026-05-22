import { bool } from "../utils/common";

// ------------------------------ ENV CONSTANTS ------------------------------
export const CAPTURE_LOG = bool(process.env.NEXT_CAPTURE_LOG);

export const COMP_CODE = process.env.NEXT_PUBLIC_COMP_CODE;
export const TENANT_REGION = process.env.NEXT_TENANT_REGION;
export const TENANT_NAME = process.env.NEXT_TENANT_NAME;
export const TENANT_USERID = process.env.NEXT_TENANT_USERID;
export const TENANT_PWD = process.env.NEXT_TENANT_PWD;
export const API_URL = process.env.NEXT_API_URL;
export const ONLINE_API_URL = process.env.NEXT_ONLINE_API_URL;
export const DELIVERY_API_URL = process.env.NEXT_DELIVERY_API_URL;
export const GRABFOOD_API_URL = process.env.NEXT_GRABFOOD_API_URL;
export const FOODPANDA_API_URL = process.env.NEXT_FOODPANDA_API_URL;
export const DELIVEROO_API_URL = process.env.NEXT_DELIVEROO_API_URL;
export const ALIPAY_API_URL = process.env.NEXT_ALIPAY_API_URL;

export const IMAGES_BACKUP = parseInt(process.env.NEXT_IMAGES_BACKUP) || 1;

export const FLASK_CONFIG = {
  DOMAIN: process.env.NEXT_PUBLIC_FLASK_DOMAIN,
  GENERATE: bool(process.env.NEXT_PUBLIC_FLASK_GENERATE),
  ORG: process.env.NEXT_PUBLIC_FLASK_ORG,
  PRINT_LOGO: bool(process.env.NEXT_PUBLIC_FLASK_PRINT_LOGO),
  PRINT_TNC: bool(process.env.NEXT_PUBLIC_FLASK_PRINT_TNC),
};

export const NETS_API_URL = process.env.NEXT_PUBLIC_NETS_API_URL;
export const QLUB_URL = process.env.NEXT_PUBLIC_QLUB_URL;
export const QLUB_SECRET = process.env.NEXT_PUBLIC_QLUB_SECRET;
export const QLUB_RESTAURANT_UNIQUE =
  process.env.NEXT_PUBLIC_QLUB_RESTAURANT_UNIQUE;
export const QLUB_TABLE_ID = process.env.NEXT_PUBLIC_QLUB_TABLE_ID;
export const QLUB_NAME = process.env.NEXT_PUBLIC_QLUB_NAME;
export const QLUB_EXTRA_INFO = {
  orderHash: process.env.NEXT_PUBLIC_QLUB_EXTRA_INFO_ORDER_HASH,
  orderSource: process.env.NEXT_PUBLIC_QLUB_EXTRA_INFO_ORDER_SOURCE,
  brandName: process.env.NEXT_PUBLIC_QLUB_EXTRA_INFO_BRAND_NAME,
  outletName: process.env.NEXT_PUBLIC_QLUB_EXTRA_INFO_OUTLET_NAME,
};

export const ADDON_STARTING_DS_NO =
  parseInt(process.env.NEXT_PUBLIC_ADDON_STARTING_DS_NO) || 500;
export const FREE_ITEM_STARTING_DS_NO =
  parseInt(process.env.NEXT_PUBLIC_FREE_ITEM_STARTING_DS_NO) || 300;
export const FREE_ITEM_BY_VALUE_STARTING_DS_NO =
  parseInt(process.env.NEXT_PUBLIC_FREE_ITEM_BY_VALUE_STARTING_DS_NO) || 350;
export const SPECIAL_PRICE_ITEM_STARTING_DS_NO =
  parseInt(process.env.NEXT_PUBLIC_SPECIAL_PRICE_ITEM_STARTING_DS_NO) || 400;
export const SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO =
  parseInt(
    process.env.NEXT_PUBLIC_SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO
  ) || 450;
export const TAKEAWAY_CHARGE_ITEM_STARTING_DS_NO =
  parseInt(process.env.NEXT_PUBLIC_TAKEAWAY_CHARGE_ITEM_STARTING_DS_NO) || 600;
export const TOAST_AUTO_CLOSE_TIME =
  parseInt(process.env.NEXT_PUBLIC_TOAST_AUTO_CLOSE_TIME) || 1500;
export const OPEN_DISCOUNT_NAMES = (
  process.env.NEXT_PUBLIC_OPEN_DISCOUNT_NAMES ||
  "OPEN ITEM DISCOUNT, OPEN TOTAL DISCOUNT"
)
  ?.split(",")
  ?.map((item) => item.toUpperCase().trim());
export const OPEN_ITEM_PREFIX = (
  process.env.NEXT_PUBLIC_OPEN_ITEM_PREFIX || "OPEN ITEM"
)?.toUpperCase();
export const API_ERROR_RETRIES =
  parseInt(process.env.NEXT_PUBLIC_API_ERROR_RETRIES) || 3;

// ------------------------------ SELF-DECLARED CONSTANTS ------------------------------
// -------------------------------------- GENERAL --------------------------------------
export const DATE_FORMAT = "YYYY/MM/DD";

export const TIME_FORMAT = "HH:mm:ss";

export const DATE_TIME_FORMAT = "DD/MM/YYYY hh:mm:ss A";

export const DISPLAY_DATE_FORMAT = "DD/MM/YYYY";

export const DISPLAY_TIME_FORMAT = "hh:mm A";

export enum WEEKDAY {
  MONDAY = "Monday",
  TUESDAY = "Tuesday",
  WEDNESDAY = "Wednesday",
  THURSDAY = "Thursday",
  FRIDAY = "Friday",
  SATURDAY = "Saturday",
  SUNDAY = "Sunday",
}

// ---------------------------------------- API ----------------------------------------
export enum HTTPS {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
}

export enum URL {
  API = "api",
  ONLINE = "online",
  DELIVERY = "delivery",
  GRABFOOD = "grabfood",
  FOODPANDA = "foodpanda",
  DELIVEROO = "deliveroo",
  ALIPAY = "alipay",
}

// ---------------------------------------- UI -----------------------------------------
export const SIDEMENU_WIDTH = 500;

export const LOGO_WIDTH = 500;
export const LOGO_HEIGHT = 500;

export enum COLOR {
  PRIMARY = "primary",
  SUCCESS = "success",
  ERROR = "error",
  WARNING = "warning",
  GRAY = "gray",
  GOLD = "gold",
  PURPLE = "purple",
  WHITE = "white",
  BLACK = "black",
  NETS_RED = "nets-red",
  FOMO_RED = "fomo-red",
  FAVE_RED = "fave-red",
  GRAB_GREEN = "grab-green",
  PAYNOW_PURPLE = "paynow-purple",
}

export enum STATUS {
  SUCCESS = "success",
  FAIL = "fail",
}

// -------------------------------------- ORDERS ---------------------------------------
export enum ORDERS_TYPE {
  NONCLOSED = "NONCLOSED",
  DELIVERY = "DELIVERY",
  CLOSED = "CLOSED",
  TQR = "TQR",
}

export enum POST_ORDER_ACTION {
  HOLD = "hold",
  VOID = "void",
  PAY = "pay",
  TABLE_TRANSFER = "table transfer",
  SPLIT_PAYMENT = "split payment",
}

export enum PROMO_TYPE {
  ITEM_DISCOUNT = "ID", // item discount
  TOTAL_DISCOUNT = "TD", // total discount
  FREE_ITEM = "FI", // free item
  FREE_ITEM_WITH_LIMIT = "FO", // free item with limit
  FREE_ITEM_BY_VALUE = "BV", // by value
  SPECIAL_DISCOUNT_WITH_QUANTITY = "SD", // special discount
  SPECIAL_PRICE = "SP", // special price
  LOWEST_PRICE_DISCOUNT = "LD", // lowest price discount
}

export const SERVICE_TYPES = [
  { service_type: "Q", service_type_info: "QuickService" },
  { service_type: "E", service_type_info: "DineIn" },
  { service_type: "T", service_type_info: "TakeAway" },
  { service_type: "D", service_type_info: "Delivery" },
];

export enum USER_RIGHTS {
  ORDER = "ORDER",
  CANCEL_ITEM = "CANCEL ITEM",
  VOID_SALES = "VOID SALES",
  PRICE_OVERIDE = "PRICE OVERIDE",
  UNDO_SHIFT_CLOSE = "UNDO SHIFT CLOSE",
  UNDO_DAY_CLOSE = "UNDO DAY CLOSE",
  CHANGE_PAYMENT = "CHANGE PAYMENT",
  PRE_ORDER_REFUND_ACCESS = "PRE ORDER REFUND ACCESS",
  ALLOW_REPORT_BEFORE_DAY_CLOSE = "ALLOW REPORT BEFORE DAY CLOSE",
}

export enum DATE_RANGE {
  TODAY = "TODAY",
  LASTWEEK = "LAST WEEK",
  LAST_MONTH = "LAST MONTH",
  LAST_2_MONTHS = "LAST 2 MONTHS",
  LAST_4_MONTHS = "LAST 4 MONTHS",
  LAST_6_MONTHS = "LAST 6 MONTHS",
  LAST_YEAR = "LAST YEAR",
}

export enum KITCHEN_STATUS {
  DONE = "D",
  CLOSE = "C",
}

export const ACTION_PANEL_ROWS = 2;
export const ACTION_PANEL_COLS = 7;
export const MORE_ACTION_MODAL_ROWS = 1;
export const ACTION_PANEL_BUTTON_HEIGHT = 58;
export const ACTION_PANEL_BUTTON_MARGIN = 8;
export const ACTION_PANEL_BUTTON_MAX_HEIGHT = 2;

export const DEFAULT_MENU_CATEGORY_COLUMNS =
  parseInt(process.env.NEXT_PUBLIC_DEFAULT_MENU_CATEGORY_COLUMNS) || 4;
export const DEFAULT_MENU_ITEM_COLUMNS =
  parseInt(process.env.NEXT_PUBLIC_DEFAULT_MENU_ITEM_COLUMNS) || 4;

export enum ACTIVE_ORDERS_VIEW {
  LIST = "list",
  FLOORPLAN = "floorplan",
}

// -------------------------------------- STOCKS ---------------------------------------
export enum STOCK_TYPE {
  REQUESTED = "REQUESTED",
  RECEIVED = "RECEIVED",
}

export enum STOCK_AVAILABLE_MODULE {
  POS = "POS",
  FOODPANDA = "FOODPANDA",
  GRABFOOD = "GRABFOOD",
  DELIVEROO = "DELIVEROO",
  ALIPAY = "ALIPAY",
  ODDLE = "ODDLE",
}

// ------------------------------------ CASH DRAWER -------------------------------------
export enum CASH_DRAWER_ACTION {
  CASH_IN = "CASH IN",
  CASH_ADD_ON = "CASH ADD ON",
  CASH_OUT = "CASH OUT",
  CASHIER_IN = "CASHIER IN",
  CASHIER_OUT = "CASHIER OUT",
  SHIFT_CLOSE = "SHIFT CLOSE",
  DAY_CLOSE = "DAY CLOSE",
  UNDO_SHIFT_CLOSE = "UNDO SHIFT CLOSE",
  UNDO_DAY_CLOSE = "UNDO DAY CLOSE",
}

export enum CASH_RECON_STATUS {
  LAST_WORKING_DAY_NOT_CLOSED = "Last Working Day is not closed",
  CASH_IN_NOT_DONE = "Cash In not Done",
  SHIFT_ALREADY_CLOSED = "Shift already Closed",
  DAY_ALREADY_CLOSED = "Day already Closed",
  SHIFT_IS_NOT_CLOSED = "Shift is not closed",
}

// -------------------------------------- PAYMENT --------------------------------------
export enum QUICKPAY_TYPE {
  CASH = "CASH",
  CREDIT_CARD = "CREDIT CARD",
  NETS = "NETS",
  FOMO_PAY = "FOMO PAY",
  FAVE_PAY = "FAVE PAY",
  GRAB_PAY = "GRAB PAY",
  FOOD_PANDA = "FOOD PANDA",
  GRAB_FOOD = "GRAB FOOD",
  DELIVEROO = "DELIVEROO",
  ALIPAY = "ALIPAY",
  PAYNOW = "PAYNOW",
}

export const PAYMENT_TYPES = [
  { payment_type: "C", payment_info: "Cash" },
  { payment_type: "R", payment_info: "Card" },
  { payment_type: "O", payment_info: "OnlinePayment" },
  { payment_type: "V", payment_info: "Vouchers" },
  {
    payment_type: "M",
    payment_info: "Membership",
  },
  {
    payment_type: "P",
    payment_info: "RedeemPoints",
  },
];

export const FOMOPAY_API_RESPONSE_CODES = {
  create: [
    {
      code: "00",
      description: "Request completed successfully",
    },
    {
      code: "03",
      description: "Invalid merchant",
    },
    {
      code: "05",
      description: "Do not honor",
    },
    {
      code: "06",
      description: "Unsupported condition code",
    },
    {
      code: "09",
      description: "Request in progress",
    },
    {
      code: "12",
      description: "Duplicate record",
    },
    {
      code: "30",
      description: "Format error",
    },
    {
      code: "96",
      description: "System malfunction",
    },
    {
      code: "26",
      description: "Duplicate record",
    },
  ],
  check: [
    {
      code: "00",
      description: "Payment success",
    },
    {
      code: "03",
      description: "Invalid merchant",
    },
    {
      code: "05",
      description: "Payment error",
    },
    {
      code: "06",
      description: "Payment closed",
    },
    {
      code: "09",
      description: "Payment in progress",
    },
    {
      code: "12",
      description: "Invalid transaction",
    },
    {
      code: "21",
      description: "Payment void",
    },
    {
      code: "22",
      description: "Payment reversed",
    },
    {
      code: "23",
      description: "Payment cancelled",
    },
    {
      code: "30",
      description: "Format error",
    },
    {
      code: "96",
      description: "System malfunction",
    },
  ],
  reversal: [
    {
      code: "00",
      description: "Request completed successfully",
    },
    {
      code: "03",
      description: "Invalid merchant",
    },
    {
      code: "05",
      description: "Do not honor",
    },
    {
      code: "06",
      description: "Request not applicable",
    },
    {
      code: "12",
      description: "Invalid transaction",
    },
    {
      code: "30",
      description: "Format error",
    },
    {
      code: "96",
      description: "System malfunction",
    },
  ],
  void: [
    {
      code: "00",
      description: "Request completed successfully",
    },
    {
      code: "03",
      description: "Invalid merchant",
    },
    {
      code: "05",
      description: "Do not honor",
    },
    {
      code: "06",
      description: "Request not applicable",
    },
    {
      code: "12",
      description: "Invalid transaction",
    },
    {
      code: "30",
      description: "Format error",
    },
    {
      code: "96",
      description: "System malfunction",
    },
  ],
  cancel: [
    {
      code: "00",
      description: "Request completed successfully",
    },
    {
      code: "03",
      description: "Invalid merchant",
    },
    {
      code: "05",
      description: "Do not honor",
    },
    {
      code: "06",
      description: "Request not applicable",
    },
    {
      code: "12",
      description: "Invalid transaction",
    },
    {
      code: "30",
      description: "Format error",
    },
    {
      code: "96",
      description: "System malfunction",
    },
  ],
  refund: [
    {
      code: "00",
      description: "Request completed successfully",
    },
    {
      code: "03",
      description: "Invalid merchant",
    },
    {
      code: "05",
      description: "Do not honor",
    },
    {
      code: "06",
      description: "Request not applicable",
    },
    {
      code: "12",
      description: "Invalid transaction",
    },
    {
      code: "30",
      description: "Format error",
    },
    {
      code: "96",
      description: "System malfunction",
    },
  ],
  batchSubmit: [
    {
      code: "00",
      description: "Request completed successfully",
    },
    {
      code: "03",
      description: "Invalid merchant",
    },
    {
      code: "30",
      description: "Format error",
    },
    {
      code: "96",
      description: "System malfunction",
    },
  ],
};

export const PAYMENT_MODES_TRIGGER_PAYMENT_REMARKS =
  process.env.NEXT_PUBLIC_PAYMENT_MODES_TRIGGER_PAYMENT_REMARKS?.split(",")
    ?.filter((item) => !!item)
    ?.map((item) => item.trim()) || [];

export enum PAYMENT_TERMINAL_TYPES {
  NETS = "NETS",
  NETS_CREDIT_CARD = "NETS_CREDIT_CARD",
  NETS_UOB = "NETS_UOB",
  UOB = "UOB",
  OCBC = "OCBC",
  QLUB = "QLUB",
  A930 = "A930",
}

// -------------------------------------- PRINTING -------------------------------------
export enum NOTO_FONT {
  NORMAL = "NotoSerifSC-Regular",
  BLACK = "NotoSerifSC-Black",
}

export enum PRINT_SERVICE {
  PRINT = "print",
  EMAIL = "email",
  SAVE = "save",
  VIEW = "view",
}

export enum KITCHEN_PRINT_TYPE {
  AUTO = "AUTO",
  MANUAL = "MANUAL",
  VOID = "VOID",
  TABLE_TRANSFER = "TABLE TRANSFER",
  CANCEL_ITEM = "CANCEL ITEM",
  TQR = "TQR",
}

export enum RECEIPT_PRINT_TYPE {
  PAY = "PAY",
  DUPLICATE = "DUPLICATE",
  MANUAL = "MANUAL",
  QR = "QR",
  EMAIL = "EMAIL",
  VOID = "VOID",
  VIEW = "VIEW",
  SPLIT_PAYMENT = "SPLIT PAYMENT",
  AUTO = "AUTO",
}

export enum TQR_PRINT_TYPE {
  PRINT = "PRINT",
  VIEW = "VIEW",
}

export const NUMBER_OF_RECEIPT_PRINT_FOR_PAYMENT_SELECTOPTS = [
  { label: "0", value: "0" },
  { label: "1", value: "1" },
  { label: "2", value: "2" },
  { label: "3", value: "3" },
  { label: "4", value: "4" },
  { label: "5", value: "5" },
  { label: "6", value: "6" },
  { label: "7", value: "7" },
  { label: "8", value: "8" },
  { label: "9", value: "9" },
  { label: "10", value: "10" },
];

export const KITCHEN_PRINTER_OPTIONS = [
  { label: "SUMMARY", value: "SUMMARY" },
  { label: "SINGLE", value: "SINGLE" },
  { label: "BOTH", value: "BOTH" },
  { label: "SUMMARY-FLANG", value: "SUMMARYFLANG" },
  { label: "SINGLE-FLANG", value: "SINGLEFLANG" },
  { label: "BOTH-FLANG", value: "BOTHFLANG" },
  { label: "LABEL-PRINT", value: "LABELPRINT" },
  { label: "DOTMATRIX_SUMMARY", value: "DOTMATRIX_SUMMARY" },
  { label: "DOTMATRIX_SINGLE", value: "DOTMATRIX_SINGLE" },
  { label: "DOTMATRIX_BOTH", value: "DOTMATRIX_BOTH" },
  { label: "DOTMATRIX_SUMMARY-FLANG", value: "DOTMATRIX_SUMMARYFLANG" },
  { label: "DOTMATRIX_SINGLE-FLANG", value: "DOTMATRIX_SINGLEFLANG" },
  { label: "DOTMATRIX_BOTH-FLANG", value: "DOTMATRIX_BOTHFLANG" },
];

// -------------------------------------- DELIVERY -------------------------------------
export enum GRABFOOD_ORDER_STATUS {
  ACCEPTED = "ACCEPTED",
  // REJECTED = "REJECTED",
  // FINDDRIVER = "FINDDRIVER",
  COLLECTED = "COLLECTED",
  DELIVERED = "DELIVERED",
  DRIVER_ALLOCATED = "DRIVER_ALLOCATED",
  DRIVER_ARRIVED = "DRIVER_ARRIVED",
  CANCELED = "GRF-CANCELLED",
}

export enum FOODPANDA_ORDER_STATUS {
  ACCEPTED = "order_accepted",
  REJECTED = "order_rejected",
  PICKEDUP = "order_picked_up",
  PREPARED = "order_prepared",
}

export const FOODPANDA_REJECT_REASONS = [
  {
    reason: "Address incomplete or misstated.",
    code: "ADDRESS_INCOMPLETE_MISSTATED",
  },
  { reason: "Bad weather.", code: "BAD_WEATHER" },
  { reason: "Blacklisted.", code: "BLACKLISTED" },
  { reason: "Card reader not available.", code: "CARD_READER_NOT_AVAILABLE" },
  { reason: "Closed.", code: "CLOSED" },
  { reason: "Content wrong or misleading.", code: "CONTENT_WRONG_MISLEADING" },
  { reason: "Food quality spillage.", code: "FOOD_QUALITY_SPILLAGE" },
  { reason: "Fraud or prank.", code: "FRAUD_PRANK" },
  { reason: "Item unavailable.", code: "ITEM_UNAVAILABLE" },
  { reason: "Late delivery.", code: "LATE_DELIVERY" },
  { reason: "Menu account settings.", code: "MENU_ACCOUNT_SETTINGS" },
  { reason: "Mov not reached.", code: "MOV_NOT_REACHED" },
  { reason: "No courier.", code: "NO_COURIER" },
  { reason: "No picker.", code: "NO_PICKER" },
  { reason: "No response.", code: "NO_RESPONSE" },
  { reason: "Outside delivery area.", code: "OUTSIDE_DELIVERY_AREA" },
  { reason: "Technical problem.", code: "TECHNICAL_PROBLEM" },
  { reason: "Test order.", code: "TEST_ORDER" },
  { reason: "Too busy.", code: "TOO_BUSY" },
  { reason: "Unable to find.", code: "UNABLE_TO_FIND" },
  { reason: "Unable to pay.", code: "UNABLE_TO_PAY" },
  { reason: "Unprofessional behaviour.", code: "UNPROFESSIONAL_BEHAVIOUR" },
  { reason: "Will not work with.", code: "WILL_NOT_WORK_WITH" },
  {
    reason: "Wrong order items delivered.",
    code: "WRONG_ORDER_ITEMS_DELIVERED",
  },
];

export enum FOODPANDA_INTEGRATION_TYPE {
  DIRECT = "direct",
  INDIRECT = "indirect",
}

export enum DELIVEROO_ORDER_STATUS {
  ACCEPTED = "ACCEPTED",
  CONFIRMED = "CONFIRMED",
  IN_KITCHEN = "IN KITCHEN",
  READY_FOR_COLLECTION = "READY FOR COLLECTION",
  READY_FOR_COLLECTION_SOON = "READY FOR COLLECTION SOON",
  COLLECTED = "COLLECTED",
}

export enum ALIPAY_ORDER_STATUS {
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  REFUND = "REFUND",
  READY = "READY",
  COMPLETED = "COMPLETED",
}

export const FOODPANDA_CHAINCODE = process.env.NEXT_FOODPANDA_CHAINCODE;

// ---------------------------------------- TQR ----------------------------------------
export enum TQR_ORDERS_CAPTURING_PROCESS_TYPE {
  INTERVAL = "interval",
  LIVE = "live",
}

export enum WEBSOCKET_EVENTS {
  TQR_ORDERS_NOTIFIED = "ReceiveNotification",
  DELIVERY_ORDERS_NOTIFIED = "DPReceiveNotification",
}

// --------------------------------- TABLE RESERVATION ---------------------------------
export enum POST_TABLE_RESERVATION_ACTION {
  CREATE = "create",
  UPDATE = "update",
  CANCEL = "cancel",
}

// ------------------------------------- PRE ORDER -------------------------------------
export const PRE_ORDER_TYPES = [
  { service_type: "D", service_type_info: "Delivery" },
  { service_type: "S", service_type_info: "SelfCollection" },
];

export const PRE_ORDER_ACTION_BUTTONS_LAYOUT = [
  { x: 0, y: 0, w: 1, h: 2, i: "CancelOrRefund", maxH: 2 },
  { x: 1, y: 0, w: 1, h: 2, i: "ClearItems", maxH: 2 },
  { x: 2, y: 0, w: 1, h: 2, i: "Remarks", maxH: 2 },
  { x: 3, y: 0, w: 1, h: 2, i: "Customer", maxH: 2 },
  { x: 4, y: 0, w: 1, h: 2, i: "PreOrderInformation", maxH: 2 },
  { x: 5, y: 0, w: 1, h: 2, i: "ConfirmPreOrder", maxH: 2 },
  { x: 6, y: 0, w: 1, h: 2, i: "PayOrCompletePreOrder", maxH: 2 },
];

export enum POST_PRE_ORDER_ACTION {
  CONFIRM = "confirm",
  PAY = "pay",
  VOID = "void",
  COMPLETE = "complete",
}

export enum POST_PRE_ORDER_REFUND_ACTION {
  CREATE = "create",
  CANCEL = "cancel",
}
