import { useCache } from "../../stores/cache-store";
import { useOrder } from "../../stores/order-store";
import {
  COMP_CODE,
  DATE_FORMAT,
  HTTPS,
  POST_ORDER_ACTION,
  STATUS,
} from "../constants";
import { callApi } from "@/utils/api/base";
//import { RequestBody } from "@/app/api/route";
import { getNowWithLoginDate } from "../pos";
import { bool, clone, getNowInAPIFormat, same } from "../common";
//import { useDeviceSession } from "@/hooks/use-device-session";
import dayjs from "dayjs";

export interface APIParams {
  info?: {
    storename?: string;
    [key: string]: any;
  };
}

export const getSession = async (params?: APIParams) => {
  const { setSessionid } = useCache();

  let sessionid = "";

  const res = await callApi({
    api: "GetSessionID",
    method: HTTPS.GET,
    ...params,
  });
  if (same(res?.message, STATUS.SUCCESS)) {
    sessionid = res?.data[0]?.output[0]?.session_id;
  }
  setSessionid(sessionid);
  return sessionid;
};

export const getStore = async (params?: APIParams) => {
  const { sessionid, setStore } = useCache();

  const storename = params?.info?.storename;

  if (!storename) return null;

  let store = null;

  const res = await callApi({
    api: "GetStore",
    method: HTTPS.GET,
    searchparams: { sessionid, storename: storename || "%" },
    ...params,
  });
  if (same(res?.message, STATUS.SUCCESS)) {
    store = res?.data[0]?.output[0];
  }
  setStore(store);
  return store;
};

export const getMenuItems = async (params?: APIParams) => {
  const { sessionid, store, setMenuItems } = useCache();

  let menuItems = [];

  const res = await callApi({
    api: "GetPOSMenuButton",
    method: HTTPS.GET,
    searchparams: {
      sessionid,
      storename: store?.store_name,
      dayname: getNowWithLoginDate().format("dddd"),
      deviceType: "T",
      logindate: getNowWithLoginDate().format(DATE_FORMAT),
    },
    ...params,
  });
  if (same(res?.message, STATUS.SUCCESS)) {
    menuItems = res?.data[0]?.output;
  }
  setMenuItems(menuItems);
  return menuItems;
};

export const getItems = async (params?: APIParams) => {
  const { sessionid, store, date, setItems } = useCache();

  let items = [];

  const res = await callApi({
    api: "GetPosFullItemList",
    method: HTTPS.GET,
    searchparams: {
      sessionid,
      storename: store?.store_name,
      dayname: date,
    },
    ...params,
  });
  if (same(res?.message, STATUS.SUCCESS)) {
    items = res.data[0]?.output;
  }
  setItems(items);
  return items;
};

export const checkStocks = async (params?: APIParams) => {
  const { sessionid, store, setStocks } = useCache();

  const check = params?.info?.check ?? true;
  const sales_dtls = params?.info?.sales_dtls;

  const res = await callApi({
    // api: "GetPosStroreStockCheck",
    api: "ExternalGetStroreStockList",
    method: HTTPS.GET,
    searchparams: {
      sessionid,
      apikey: "Basic a3JlbW90ZTprcmVtb3RlMTMy",
      storename: store?.store_name,
      dayname: getNowWithLoginDate().format("dddd"),
      logindate: getNowWithLoginDate().format("YYYY-MM-DD"),
      // sales_no: "%",
    },
    ...params,
  });
  // const stocks = same(res?.output, "[]") ? [] : res?.output;
  const stocks = same(res?.data[0]?.output, "[]") ? [] : res?.data[0]?.output;

  let valid = true;
  let unavailableItems = [];

  if (stocks && check) {
    // Collapse sales_dtls items with same item_name and sum quantities
    const orderItemsWithQty = [];
    sales_dtls?.forEach((item) => {
      const existingItem = orderItemsWithQty?.find((collapsed) =>
        same(collapsed?.item_name, item?.item_name)
      );
      if (existingItem) {
        existingItem.qty = parseFloat(existingItem.qty) + parseFloat(item.qty);
      } else {
        orderItemsWithQty.push({
          item_name: item?.item_name,
          item_desc: item?.item_desc,
          qty: item?.qty,
        });
      }
    });

    for (const item of orderItemsWithQty) {
      const stock = stocks?.find(
        (stock) =>
          same(stock?.avl_type, "I") && same(stock?.item_name, item?.item_name)
      );
      if (stock) {
        if (bool(stock?.is_soldout)) {
          valid = false;
          unavailableItems.push({
            item_name: item?.item_name,
            item_desc: item?.item_desc,
            bal_qty: 0,
            is_soldout: true,
          });
        } else if (
          bool(stock?.is_avl_limit_check) &&
          parseFloat(item?.qty) > parseFloat(stock?.bal_qty)
        ) {
          valid = false;
          unavailableItems.push({
            item_name: item?.item_name,
            item_desc: item?.item_desc,
            bal_qty: stock?.bal_qty,
            is_avl_limit_check: true,
          });
        }
      }
    }
  }

  setStocks(stocks);
  return { stocks, valid, unavailableItems };
};

export const getSvcs = async (params?: APIParams) => {
  const { sessionid, store, setSvcs } = useCache();

  let svcs = [];

  const res = await callApi({
    api: "GetPosServiceChargelist",
    method: HTTPS.GET,
    searchparams: {
      sessionid,
      storename: store?.store_name,
    },
    ...params,
  });
  if (same(res?.message, "SUCCESS")) {
    svcs = res?.data[0]?.output || [];
  }
  setSvcs(svcs);
  return svcs;
};

export const getAddons = async (params?: APIParams) => {
  const { sessionid, store, register, setAddons } = useCache();

  let addons = [];

  const res = await callApi({
    api: "GetStoreAddonDtls",
    method: HTTPS.GET,
    searchparams: {
      sessionid,
      storename: store?.store_name,
      registername: register?.register_name,
    },
    ...params,
  });
  if (same(res?.message, "SUCCESS")) {
    addons = res.data[0].output;
  }
  setAddons(addons);
  return addons;
};

export const getItemRemarks = async (params?: APIParams) => {
  const { sessionid, store, setItemRemarks } = useCache();

  let itemRemarks = [];

  const res = await callApi({
    api: "GetPosRemarksBygrpitem",
    method: HTTPS.GET,
    searchparams: {
      sessionid,
      store: store?.store_name,
      itemname: "%",
    },
    ...params,
  });
  itemRemarks = same(res?.output, "[]") ? [] : res?.output;
  setItemRemarks(itemRemarks);
  return itemRemarks;
};

export const getShift = async (params?: APIParams) => {
  const { sessionid, store, register } = useCache();

  let shift = null;

  const res = await callApi({
    api: "GetShift",
    method: HTTPS.GET,
    searchparams: {
      sessionid,
      storename: store?.store_name,
      registername: register?.register_name || "POS01",
      logindate: getNowWithLoginDate().format("YYYYMMDD"),
    },
    ...params,
  });
  if (same(res?.message, "SUCCESS")) {
    shift = res?.data[0]?.default_shift;
  }
  return shift;
};

// PosOrder
export const postOrder = async (params?: APIParams) => {
  const { sessionid, store, register, date, svcs } = useCache();

  let order = params?.info?.order;
  // req preprocessing
  let action = "create";
  order = clone(order);

  const { valid, unavailableItems } = await checkStocks({
    info: { sales_dtls: order?.sales_dtls },
  });

  if (!valid) {
    return { success: false, response: unavailableItems };
  }

  if (order?.sales_no) {
    action = "update";
  } else {
    order.doc_date = getNowInAPIFormat(date);
  }
  let sales_dtls = (order?.sales_dtls || [])?.map((item) => ({
    ...item,
    c_userid: "WEBORDER",
    c_date: getNowInAPIFormat(),
    m_userid: "WEBORDER",
    m_date: getNowInAPIFormat(),
  }));
  order.sales_dtls = sales_dtls;

  // process service charges
  const sales_service_dtls = [];
  let sales_service_dtl = svcs?.find(
    (item) => item?.service_type === order?.service_type
  );
  if (sales_service_dtl) {
    sales_service_dtl = clone(sales_service_dtl);
    delete sales_service_dtl?.comp_code;
    sales_service_dtl.sales_amt = order?.sub_total;
    sales_service_dtl.service_amt = (sales_dtls || [])
      ?.filter((item) => item?.take_away_item !== "Y")
      ?.map((item) => parseFloat(item?.svc_amt))
      ?.reduce((acc, val) => acc + val, 0);
    sales_service_dtls?.push(sales_service_dtl);
    const takeAwayOrderItems = (sales_dtls || [])?.filter(
      (item) => item?.take_away_item === "Y"
    );
    if (takeAwayOrderItems?.length > 0) {
      let take_away_sales_service_dtl = svcs?.find(
        (svc) => svc?.service_type === "T"
      );
      if (take_away_sales_service_dtl) {
        take_away_sales_service_dtl = JSON.parse(
          JSON.stringify(take_away_sales_service_dtl)
        );
        delete take_away_sales_service_dtl.comp_code;
        take_away_sales_service_dtl.sales_amt = order?.sub_total;
        take_away_sales_service_dtl.service_amt = (takeAwayOrderItems || [])
          ?.map((item) => parseFloat(item?.svc_amt))
          ?.reduce((acc, val) => acc + val, 0);
        sales_service_dtls?.push(take_away_sales_service_dtl);
      }
    }
    order.sales_service_dtls = sales_service_dtls;
  }

  const deviceSession = JSON.parse(
    localStorage.getItem("device-session") || "{}"
  );

  const qr_code = localStorage.getItem("qr_code") || "";

  const shift = await getShift();

  order = {
    ...order,
    try_count: deviceSession?.tryCount,
    device_id: deviceSession?.token,
    // todo - temporarily hardcode until api is ready
    order_mode: "PayLater",
    qr_type: "Dynamic",
    qr_code,
    comp_code: COMP_CODE,
    store_name: store?.store_name,
    register_name: register?.register_name || "POS01",
    shift_code: shift,
    order_from: "TQR",
    c_userid: "WEBORDER",
    c_date: getNowInAPIFormat(),
    m_userid: "WEBORDER",
    m_date: getNowInAPIFormat(),
  };

  let response = null;

  const res = await callApi({
    api: `PosOrder/${action}`,
    body: [order],
    method: HTTPS.POST,
    searchparams: {
      sessionid,
    },
    ...params,
  });
  if (same(res?.message, "SUCCESS")) {
    let data = res?.data[0];

    if (same(data?.result, "SUCCESS")) {
      let receipt_dtls = JSON.parse(data?.receipt_dtls);
      if (receipt_dtls.length > 0) {
        if (receipt_dtls[0].sales_dtls != "") {
          receipt_dtls[0].sales_dtls = JSON.parse(receipt_dtls[0].sales_dtls);
        }
        if (receipt_dtls[0].sales_service_dtls != "") {
          receipt_dtls[0].sales_service_dtls = JSON.parse(
            receipt_dtls[0].sales_service_dtls
          );
        }
        if (receipt_dtls[0].sales_payment_dtls != "") {
          receipt_dtls[0].sales_payment_dtls = JSON.parse(
            receipt_dtls[0].sales_payment_dtls
          );
        }
        if (receipt_dtls[0].sales_other_info != "") {
          receipt_dtls[0].sales_other_info = JSON.parse(
            receipt_dtls[0].sales_other_info
          );
        }
        if (receipt_dtls[0].ticket_dtls != "") {
          receipt_dtls[0].ticket_dtls = JSON.parse(receipt_dtls[0].ticket_dtls);
        }
        // todo - hpb
        // if (receipt_dtls[0].hpb_qr_print != "") {
        //   Generate_hpb_qr_print(receipt_dtls[0].hpb_qr_print);
        // }
      }
      data.receipt_dtls = receipt_dtls;
    }

    response = data;
  }
  return { success: true, response };
};

export const getMyOrders = async (params?: APIParams) => {
  const { sessionid, store, date } = useCache();
  const { order } = useOrder();

  let orders = [];

  const res = await callApi({
    api: "GetTableQROrderDtls",
    method: HTTPS.GET,
    searchparams: {
      sessionid,
      storename: store?.store_name,
      tableno: order?.table_no,
      trandate: date,
    },
    ...params,
  });
  if (same(res?.message, "SUCCESS")) {
    orders = res?.data[0]?.output;
  }
  return orders;
};

export const validateQRCode = async (params?: APIParams) => {
  const { sessionid, store, date } = useCache();
  const { order } = useOrder();

  const storename =
    params?.info?.storename ||
    store?.store_name ||
    localStorage.getItem("outlet");
  const tableno =
    params?.info?.tableno ||
    order?.table_no ||
    localStorage.getItem("table_no");
  const qrcode = params?.info?.qrcode || localStorage.getItem("qr_code") || "";

  let isValid = false;
  let message = "";

  const res = await callApi({
    api: "GetPOSTableQRValidation",
    method: HTTPS.GET,
    searchparams: {
      sessionid,
      storename,
      tableno,
      trandate: date,
      qrcode,
    },
    ...params,
  });

  if (same(res?.message, "SUCCESS")) {
    const data = res?.data[0];
    if (same(data?.result, "SUCCESS")) {
      isValid = true;
    } else {
      message = data?.information;
    }
  }

  return { isValid, message };
};

export const getTQRInfo = async (params?: APIParams) => {
  const { sessionid, store, setTQRInfo } = useCache();

  let tqrInfo = null;

  const res = await callApi({
    api: "GettqrinfoStatusList",
    method: HTTPS.GET,
    searchparams: {
      sessionid,
      storename: store?.store_name,
    },
    ...params,
  });

  if (same(res?.message, "SUCCESS")) {
    tqrInfo = JSON.parse(res?.data[0]?.output);
  }

  setTQRInfo(tqrInfo);
  return tqrInfo;
};
