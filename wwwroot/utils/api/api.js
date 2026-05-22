import { useCache } from "../../stores/cache-store.js";
import { useOrder } from "../../stores/order-store.js";
import { COMP_CODE, DATE_FORMAT, HTTPS, STATUS, } from "../constants.js";
import { callApi } from "../api/base.js";
//import { RequestBody } from "@/app/api/route";
import { getNowWithLoginDate } from "../pos.js";
import { bool, clone, getNowInAPIFormat, same } from "../common.js";



export const getSession = async (params) => {
    var _a, _b;
    const { setSessionid } = useCache();
    let sessionid = "";
    const res = await callApi(Object.assign({ api: "GetSessionID", method: HTTPS.GET }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, STATUS.SUCCESS)) {
        sessionid = (_b = (_a = res === null || res === void 0 ? void 0 : res.data[0]) === null || _a === void 0 ? void 0 : _a.output[0]) === null || _b === void 0 ? void 0 : _b.session_id;
    }
    setSessionid(sessionid);
    return sessionid;
};


export const getStore = async (params) => {
    var _a, _b;
    const { sessionid, setStore } = useCache();
    const storename = (_a = params === null || params === void 0 ? void 0 : params.info) === null || _a === void 0 ? void 0 : _a.storename;
    if (!storename)
        return null;
    let store = null;
    const res = await callApi(Object.assign({ api: "GetStore", method: HTTPS.GET, searchparams: { sessionid, storename: storename || "%" } }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, STATUS.SUCCESS)) {
        store = (_b = res === null || res === void 0 ? void 0 : res.data[0]) === null || _b === void 0 ? void 0 : _b.output[0];
    }
    setStore(store);
    return store;
};


export const getMenuItems = async (params) => {
    var _a;
    const { sessionid, store, setMenuItems } = useCache();
    let menuItems = [];
    const res = await callApi(Object.assign({ api: "GetPOSMenuButton", method: HTTPS.GET, searchparams: {
            sessionid,
            storename: store === null || store === void 0 ? void 0 : store.store_name,
            dayname: getNowWithLoginDate().format("dddd"),
            deviceType: "T",
            logindate: getNowWithLoginDate().format(DATE_FORMAT),
        } }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, STATUS.SUCCESS)) {
        menuItems = (_a = res === null || res === void 0 ? void 0 : res.data[0]) === null || _a === void 0 ? void 0 : _a.output;
    }
    setMenuItems(menuItems);
    return menuItems;
};


export const getItems = async (params) => {
    var _a;
    const { sessionid, store, date, setItems } = useCache();
    let items = [];
    const res = await callApi(Object.assign({ api: "GetPosFullItemList", method: HTTPS.GET, searchparams: {
            sessionid,
            storename: store === null || store === void 0 ? void 0 : store.store_name,
            dayname: date,
        } }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, STATUS.SUCCESS)) {
        items = (_a = res.data[0]) === null || _a === void 0 ? void 0 : _a.output;
    }
    setItems(items);
    return items;
};


export const checkStocks = async (params) => {
    var _a, _b, _c, _d, _e;
    const { sessionid, store, setStocks } = useCache();
    const check = (_b = (_a = params === null || params === void 0 ? void 0 : params.info) === null || _a === void 0 ? void 0 : _a.check) !== null && _b !== void 0 ? _b : true;
    const sales_dtls = (_c = params === null || params === void 0 ? void 0 : params.info) === null || _c === void 0 ? void 0 : _c.sales_dtls;
    const res = await callApi(Object.assign({ 
        // api: "GetPosStroreStockCheck",
        api: "ExternalGetStroreStockList", method: HTTPS.GET, searchparams: {
            sessionid,
            apikey: "Basic a3JlbW90ZTprcmVtb3RlMTMy",
            storename: store === null || store === void 0 ? void 0 : store.store_name,
            dayname: getNowWithLoginDate().format("dddd"),
            logindate: getNowWithLoginDate().format("YYYY-MM-DD"),
            // sales_no: "%",
        } }, params));
    // const stocks = same(res?.output, "[]") ? [] : res?.output;
    const stocks = same((_d = res === null || res === void 0 ? void 0 : res.data[0]) === null || _d === void 0 ? void 0 : _d.output, "[]") ? [] : (_e = res === null || res === void 0 ? void 0 : res.data[0]) === null || _e === void 0 ? void 0 : _e.output;
    let valid = true;
    let unavailableItems = [];
    if (stocks && check) {
        // Collapse sales_dtls items with same item_name and sum quantities
        const orderItemsWithQty = [];
        sales_dtls === null || sales_dtls === void 0 ? void 0 : sales_dtls.forEach((item) => {
            const existingItem = orderItemsWithQty === null || orderItemsWithQty === void 0 ? void 0 : orderItemsWithQty.find((collapsed) => same(collapsed === null || collapsed === void 0 ? void 0 : collapsed.item_name, item === null || item === void 0 ? void 0 : item.item_name));
            if (existingItem) {
                existingItem.qty = parseFloat(existingItem.qty) + parseFloat(item.qty);
            }
            else {
                orderItemsWithQty.push({
                    item_name: item === null || item === void 0 ? void 0 : item.item_name,
                    item_desc: item === null || item === void 0 ? void 0 : item.item_desc,
                    qty: item === null || item === void 0 ? void 0 : item.qty,
                });
            }
        });
        for (const item of orderItemsWithQty) {
            const stock = stocks === null || stocks === void 0 ? void 0 : stocks.find((stock) => same(stock === null || stock === void 0 ? void 0 : stock.avl_type, "I") && same(stock === null || stock === void 0 ? void 0 : stock.item_name, item === null || item === void 0 ? void 0 : item.item_name));
            if (stock) {
                if (bool(stock === null || stock === void 0 ? void 0 : stock.is_soldout)) {
                    valid = false;
                    unavailableItems.push({
                        item_name: item === null || item === void 0 ? void 0 : item.item_name,
                        item_desc: item === null || item === void 0 ? void 0 : item.item_desc,
                        bal_qty: 0,
                        is_soldout: true,
                    });
                }
                else if (bool(stock === null || stock === void 0 ? void 0 : stock.is_avl_limit_check) &&
                    parseFloat(item === null || item === void 0 ? void 0 : item.qty) > parseFloat(stock === null || stock === void 0 ? void 0 : stock.bal_qty)) {
                    valid = false;
                    unavailableItems.push({
                        item_name: item === null || item === void 0 ? void 0 : item.item_name,
                        item_desc: item === null || item === void 0 ? void 0 : item.item_desc,
                        bal_qty: stock === null || stock === void 0 ? void 0 : stock.bal_qty,
                        is_avl_limit_check: true,
                    });
                }
            }
        }
    }
    setStocks(stocks);
    return { stocks, valid, unavailableItems };
};


export const getSvcs = async (params) => {
    var _a;
    const { sessionid, store, setSvcs } = useCache();
    let svcs = [];
    const res = await callApi(Object.assign({ api: "GetPosServiceChargelist", method: HTTPS.GET, searchparams: {
            sessionid,
            storename: store === null || store === void 0 ? void 0 : store.store_name,
        } }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, "SUCCESS")) {
        svcs = ((_a = res === null || res === void 0 ? void 0 : res.data[0]) === null || _a === void 0 ? void 0 : _a.output) || [];
    }
    sessionStorage.setItem("Svcs", svcs.service_value);

    setSvcs(svcs);
    return svcs;
};


export const getAddons = async (params) => {
    const { sessionid, store, register, setAddons } = useCache();
    let addons = [];
    const res = await callApi(Object.assign({ api: "GetStoreAddonDtls", method: HTTPS.GET, searchparams: {
            sessionid,
            storename: store === null || store === void 0 ? void 0 : store.store_name,
            registername: register === null || register === void 0 ? void 0 : register.register_name,
        } }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, "SUCCESS")) {
        addons = res.data[0].output;
    }
    setAddons(addons);
    return addons;
};


export const getItemRemarks = async (params) => {
    const { sessionid, store, setItemRemarks } = useCache();
    let itemRemarks = [];
    const res = await callApi(Object.assign({ api: "GetPosRemarksBygrpitem", method: HTTPS.GET, searchparams: {
            sessionid,
            store: store === null || store === void 0 ? void 0 : store.store_name,
            itemname: "%",
        } }, params));
    itemRemarks = same(res === null || res === void 0 ? void 0 : res.output, "[]") ? [] : res === null || res === void 0 ? void 0 : res.output;
    setItemRemarks(itemRemarks);
    return itemRemarks;
};

export const getShift = async (params) => {
    var _a;
    const { sessionid, store, register } = useCache();
    let shift = null;
    const res = await callApi(Object.assign({ api: "GetShift", method: HTTPS.GET, searchparams: {
            sessionid,
            storename: store === null || store === void 0 ? void 0 : store.store_name,
            registername: (register === null || register === void 0 ? void 0 : register.register_name) || "POS01",
            logindate: getNowWithLoginDate().format("YYYYMMDD"),
        } }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, "SUCCESS")) {
        shift = (_a = res === null || res === void 0 ? void 0 : res.data[0]) === null || _a === void 0 ? void 0 : _a.default_shift;
    }
    return shift;
};

// PosOrder
export const postOrder = async (params) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const { sessionid, store, register, date, svcs } = useCache();
    let order = (_a = params === null || params === void 0 ? void 0 : params.info) === null || _a === void 0 ? void 0 : _a.order;
    // req preprocessing
    let action = "create";
    order = clone(order);
    const { valid, unavailableItems } = await checkStocks({
        info: { sales_dtls: order === null || order === void 0 ? void 0 : order.sales_dtls },
    });
    if (!valid) {
        return { success: false, response: unavailableItems };
    }
    if (order === null || order === void 0 ? void 0 : order.sales_no) {
        action = "update";
    }
    else {
        order.doc_date = getNowInAPIFormat(date);
    }
    let sales_dtls = (_b = ((order === null || order === void 0 ? void 0 : order.sales_dtls) || [])) === null || _b === void 0 ? void 0 : _b.map((item) => (Object.assign(Object.assign({}, item), { c_userid: "WEBORDER", c_date: getNowInAPIFormat(), m_userid: "WEBORDER", m_date: getNowInAPIFormat() })));
    order.sales_dtls = sales_dtls;
    // process service charges
    const sales_service_dtls = [];
    let sales_service_dtl = svcs === null || svcs === void 0 ? void 0 : svcs.find((item) => (item === null || item === void 0 ? void 0 : item.service_type) === (order === null || order === void 0 ? void 0 : order.service_type));
    if (sales_service_dtl) {
        sales_service_dtl = clone(sales_service_dtl);
        sales_service_dtl === null || sales_service_dtl === void 0 ? true : delete sales_service_dtl.comp_code;
        sales_service_dtl.sales_amt = order === null || order === void 0 ? void 0 : order.sub_total;
        sales_service_dtl.service_amt = (_e = (_d = (_c = (sales_dtls || [])) === null || _c === void 0 ? void 0 : _c.filter((item) => (item === null || item === void 0 ? void 0 : item.take_away_item) !== "Y")) === null || _d === void 0 ? void 0 : _d.map((item) => parseFloat(item === null || item === void 0 ? void 0 : item.svc_amt))) === null || _e === void 0 ? void 0 : _e.reduce((acc, val) => acc + val, 0);
        sales_service_dtls === null || sales_service_dtls === void 0 ? void 0 : sales_service_dtls.push(sales_service_dtl);
        const takeAwayOrderItems = (_f = (sales_dtls || [])) === null || _f === void 0 ? void 0 : _f.filter((item) => (item === null || item === void 0 ? void 0 : item.take_away_item) === "Y");
        if ((takeAwayOrderItems === null || takeAwayOrderItems === void 0 ? void 0 : takeAwayOrderItems.length) > 0) {
            let take_away_sales_service_dtl = svcs === null || svcs === void 0 ? void 0 : svcs.find((svc) => (svc === null || svc === void 0 ? void 0 : svc.service_type) === "T");
            if (take_away_sales_service_dtl) {
                take_away_sales_service_dtl = JSON.parse(JSON.stringify(take_away_sales_service_dtl));
                delete take_away_sales_service_dtl.comp_code;
                take_away_sales_service_dtl.sales_amt = order === null || order === void 0 ? void 0 : order.sub_total;
                take_away_sales_service_dtl.service_amt = (_h = (_g = (takeAwayOrderItems || [])) === null || _g === void 0 ? void 0 : _g.map((item) => parseFloat(item === null || item === void 0 ? void 0 : item.svc_amt))) === null || _h === void 0 ? void 0 : _h.reduce((acc, val) => acc + val, 0);
                sales_service_dtls === null || sales_service_dtls === void 0 ? void 0 : sales_service_dtls.push(take_away_sales_service_dtl);
            }
        }
        order.sales_service_dtls = sales_service_dtls;
    }
    const deviceSession = JSON.parse(localStorage.getItem("device-session") || "{}");
    const qr_code = localStorage.getItem("qr_code") || "";
    const shift = await getShift();
    order = Object.assign(Object.assign({}, order), { try_count: deviceSession === null || deviceSession === void 0 ? void 0 : deviceSession.tryCount, device_id: deviceSession === null || deviceSession === void 0 ? void 0 : deviceSession.token, 
        // todo - temporarily hardcode until api is ready
        order_mode: "PayLater", qr_type: "Dynamic", qr_code, comp_code: COMP_CODE, store_name: store === null || store === void 0 ? void 0 : store.store_name, register_name: (register === null || register === void 0 ? void 0 : register.register_name) || "POS01", shift_code: shift, order_from: "TQR", c_userid: "WEBORDER", c_date: getNowInAPIFormat(), m_userid: "WEBORDER", m_date: getNowInAPIFormat() });
    let response = null;
    const res = await callApi(Object.assign({ api: `PosOrder/${action}`, body: [order], method: HTTPS.POST, searchparams: {
            sessionid,
        } }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, "SUCCESS")) {
        let data = res === null || res === void 0 ? void 0 : res.data[0];
        if (same(data === null || data === void 0 ? void 0 : data.result, "SUCCESS")) {
            let receipt_dtls = JSON.parse(data === null || data === void 0 ? void 0 : data.receipt_dtls);
            if (receipt_dtls.length > 0) {
                if (receipt_dtls[0].sales_dtls != "") {
                    receipt_dtls[0].sales_dtls = JSON.parse(receipt_dtls[0].sales_dtls);
                }
                if (receipt_dtls[0].sales_service_dtls != "") {
                    receipt_dtls[0].sales_service_dtls = JSON.parse(receipt_dtls[0].sales_service_dtls);
                }
                if (receipt_dtls[0].sales_payment_dtls != "") {
                    receipt_dtls[0].sales_payment_dtls = JSON.parse(receipt_dtls[0].sales_payment_dtls);
                }
                if (receipt_dtls[0].sales_other_info != "") {
                    receipt_dtls[0].sales_other_info = JSON.parse(receipt_dtls[0].sales_other_info);
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

export const getMyOrders = async (params) => {
    var _a;
    const { sessionid, store, date } = useCache();
    const { order } = useOrder();
    let orders = [];
    const res = await callApi(Object.assign({ api: "GetTableQROrderDtls", method: HTTPS.GET, searchparams: {
            sessionid,
            storename: store === null || store === void 0 ? void 0 : store.store_name,
            tableno: order === null || order === void 0 ? void 0 : order.table_no,
            trandate: date,
        } }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, "SUCCESS")) {
        orders = (_a = res === null || res === void 0 ? void 0 : res.data[0]) === null || _a === void 0 ? void 0 : _a.output;
    }
    return orders;
};

export const validateQRCode = async (params) => {
    var _a, _b, _c;
    const { sessionid, store, date } = useCache();
    const { order } = useOrder();
    const storename = ((_a = params === null || params === void 0 ? void 0 : params.info) === null || _a === void 0 ? void 0 : _a.storename) ||
        (store === null || store === void 0 ? void 0 : store.store_name) ||
        localStorage.getItem("outlet");
    const tableno = ((_b = params === null || params === void 0 ? void 0 : params.info) === null || _b === void 0 ? void 0 : _b.tableno) ||
        (order === null || order === void 0 ? void 0 : order.table_no) ||
        localStorage.getItem("table_no");
    const qrcode = ((_c = params === null || params === void 0 ? void 0 : params.info) === null || _c === void 0 ? void 0 : _c.qrcode) || localStorage.getItem("qr_code") || "";
    let isValid = false;
    let message = "";
    const res = await callApi(Object.assign({ api: "GetPOSTableQRValidation", method: HTTPS.GET, searchparams: {
            sessionid,
            storename,
            tableno,
            trandate: date,
            qrcode,
        } }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, "SUCCESS")) {
        const data = res === null || res === void 0 ? void 0 : res.data[0];
        if (same(data === null || data === void 0 ? void 0 : data.result, "SUCCESS")) {
            isValid = true;
        }
        else {
            message = data === null || data === void 0 ? void 0 : data.information;
        }
    }
    return { isValid, message };
};

export const getTQRInfo = async (params) => {
    var _a;
    const { sessionid, store, setTQRInfo } = useCache();
    let tqrInfo = null;
    const res = await callApi(Object.assign({ api: "GettqrinfoStatusList", method: HTTPS.GET, searchparams: {
            sessionid,
            storename: store === null || store === void 0 ? void 0 : store.store_name,
        } }, params));
    if (same(res === null || res === void 0 ? void 0 : res.message, "SUCCESS")) {
        tqrInfo = JSON.parse((_a = res === null || res === void 0 ? void 0 : res.data[0]) === null || _a === void 0 ? void 0 : _a.output);
    }
    setTQRInfo(tqrInfo);
    return tqrInfo;
};


export const getPromos = async (params) => {
    const { sessionid, store, setPromos } = useCache();

    let promos = [];

    const res = await callApi({
        api: "GetPosPromolist",
        method: HTTPS.GET,
        searchparams: {
            sessionid,
            storename: store?.store_name,
        },
        ...params,
    });

    if (same(res?.message, "SUCCESS")) {
        promos = same(res?.output, "[]") ? [] : res?.output;
    }

    setPromos(promos);
    return promos;
};

export const getLangs = async () => {
    const { sessionid, store, setLangs } = useCache();

    let langs = [];

    const res = await callApi({
        api: "GetsyslanguageList",
        method: HTTPS.GET,
        searchparams: {
            sessionid,
            store_name: store?.store_name,
            language_name: "%",
        },
    });

    if (same(res?.message, "SUCCESS")) {
        langs = res?.data;
    }

    setLangs(langs);
    return langs;
};

export const getMenuCategoryItemTranslations = async (params) => {
    const { sessionid, store, setMenuCategoryItemTranslations } = useCache();

    let translations = [];
    let map = {};

    const language_name = params?.info?.language_name;

    const res = await callApi({
        api: "etqr/Getitemvslanguagemap",
        method: "post",
        searchparams: {
            sessionid,
            storename: store?.store_name,
            language_name
        }
    });

    if (same(res?.message, "SUCCESS")) {
        translations = res?.data;

        translations?.forEach((row) => {
            if (row?.item_no && row?.item_name_lang) {
                map[row.item_no] = row.item_name_lang;
            }
            if (row?.category_code && row?.category_name_lang) {
                map[row.category_code] = row.category_name_lang;
            }
        });

        setMenuCategoryItemTranslations(map);
    }

    return map;
};
