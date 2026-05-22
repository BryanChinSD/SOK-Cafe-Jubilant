"use client";

import {
    ADDON_STARTING_DS_NO,
    FREE_ITEM_BY_VALUE_STARTING_DS_NO,
    FREE_ITEM_STARTING_DS_NO,
    PROMO_TYPE,
    SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO,
    SPECIAL_PRICE_ITEM_STARTING_DS_NO,
    TIME_FORMAT,
    ORDERS_TYPE,
    SERVICE_TYPES,
    DEFAULT_MENU_CATEGORY_COLUMNS,
    DEFAULT_MENU_ITEM_COLUMNS,
    DATE_FORMAT,
    STATUS,
    CASH_RECON_STATUS,
    TQR_ORDERS_CAPTURING_PROCESS_TYPE,
    OPEN_ITEM_PREFIX,
    ACTIVE_ORDERS_VIEW,
    WEEKDAY,
    TAKEAWAY_CHARGE_ITEM_STARTING_DS_NO,
    ADDON_2_STARTING_DS_NO,
    CRM_VENDOR,
    CRM_VOUCHER_TYPE,
    MODIFIER_STARTING_DS_NO,
    MODIFIER_2_STARTING_DS_NO

} from "../utils/constants.js";

import { bool, clone, contains, getNowInAPIFormat, same } from "../utils/common.js";
import { useCache } from "../stores/cache-store.js";
import { useOrder } from "../stores/order-store.js";
import { issueEberPoints, voidEberVoucherTransaction } from "../utils/eber.js";

dayjs.extend(dayjs_plugin_isBetween); // ✅ use the plugin loaded via CDN
/**
 * Common POS related functions:
 *
 * sequenceOrderItems                               : sequence order items for modifier item.
 * desequenceOrderItems                             : desequence order items for modifier item.
 * getRounding                                      : get rounding adjustment amount in order.
 * calcRemainingTenderAmt                           : calculate remaining tender amount needed to be paid.
 * calcOrderAmt                                     : calculate and update order amounts.
 * getPriceByServiceType                            : get price based on service type.
 * calcOrderItemDiscount                            : calculate and return order item with discount.
 * goodToApplyDisc                                  : check if discount can be applied to the order item.
 * isAbsorbTax                                      : get is absorb tax based on service type.
 * addTax                                           : calculate and return order item with tax amount.
 * haveCashPayment                                  : check if there is a cash payment in payment list.
 * onlyCashPayments                                 : check if all payments are cash payments.
 * calcOrderItemSubtotal                            : calculate and return order item with subtotal.
 * isWeightableItem                                 : check if the item is weightable.
 * getSetting                                       : get store setting based on main group name, group name and setting code.
 * authorised                                       : check user rights for the action.
 * getItemDisplayName                               : get menu item display name.
 * openSecondScreen                                 : open second display.
 * sortModifierAddonItems                           : sort by seq_no.
 * availableNow                                     : check if the item is available now.
 * getRootAndSelectedCategories                     : get root and selected categories based on current selected menu item.
 * getPromo                                         : get promo linked to the item.
 * sortOrderItems                                   : sort order items ascendingly.
 * applyPromotions                                  : process and apply promotion logic to order items.
 * getFreeItems                                     : get free items based on criteria type.
 * insertDiscountName                               : insert discount name to order item.
 * isDeliveryPartnersIntegrated                     : check if delivery partners are integrated.
 * getSysSetting                                    : get system setting value by group name and param id.
 * getOrderItemsDiff                                : get order items diff.
 * getNewOrder                                      : get new order.
 * getLastSNo                                       : get last s_no.
 * formatOrderItemsToParentChild                    : convert order items to parent-children format.
 * autoRefreshOrders                                : auto refresh orders.
 * resetRounding                                    : reset rounding.
 * needMandatoryItemRemarks                         : check if item needs mandatory remarks.
 * processTotalDiscountPromo                        : process total discount promo.
 * getNowWithLoginDate                              : get now with login date.
 * getAvailableServiceTypes                         : get available service types.
 * getMenuItems                                     : get menu items.
 * getMenuCategoryColumns                           : get menu category columns.
 * getMenuCategoryRows                              : get menu category rows.
 * getMenuItemColumns                               : get menu item columns.
 * getMenuItemRows                                  : get menu item rows.
 * checkCashReconStatus                             : check cash recon status.
 * getDefaultOrderPage                              : get default order page.
 * notSecondScreen                                  : check if not second screen.
 * logout                                           : logout.
 * isOpenItem                                       : check if item is open item.
 * isAddonItem                                      : check if item is addon item.
 * calcSetMemuItemPrice                             : calculate set menu item price.
 * minimiseSNo                                      : minimise s_no.
 * canGenerateTableQR                               : check if can generate table QR.
 * getOrdersRefreshInterval                         : get orders refresh interval.
 * preprocessKitchenInfo                            : preprocess kitchen info.
 * needCaptureTableNo                               : determine if table number should be captured.
 * needRounding                                     : determine if rounding is needed.
 * getNewPreOrder                                   : get new pre order.
 * processAutoLogout                                : process auto logout.
 * haveActiveOrdersPage                             : check if active orders page is available.
 * getSalesServiceDtls                              : get sales service details.
 */

/**
 * Sequences order items for modifier items.
 * @param {any[]} orderItems - The array of order items to sequence.
 * @param {string} [s_no] - Optional sequence number.
 * @returns {any[]} The sequenced order items.
 */
export const sequenceOrderItems = (orderItems, s_no) => {
    let result = [];
    clone(orderItems)?.forEach((item) => {
        if (item?.qty > 0) {
            result.push({
                ...item,
                parent_sno: s_no ? s_no : orderItems[0]?.s_no,
            });
        }
    });
    return result;
};

/**
 * Desequences order items for modifier items.
 * @param {any[]} orderItems - The array of order items to desequence.
 * @returns {any[]} The desequenced order items.
 */
export const desequenceOrderItems = (orderItems) => {
    return orderItems?.map((item) => ({
        ...item,
        parent_sno: item?.ds_no,
    }));
};

/**
 * Calculates the rounding adjustment amount in an order.
 * @param {string} net_amt - The net amount to round.
 * @param {number} rounding_precision - The rounding precision.
 * @param {number} [rounding_type] - The rounding type (1: round up, 0: round down).
 * @returns {string} The rounding adjustment amount.
 */
export const getRounding = (net_amt, rounding_precision, rounding_type) => {
    const lastChar = net_amt.slice(-1);
    let new_net_amt = "0.00";

    if (lastChar === "0") {
        new_net_amt = net_amt;
    }
    else if (rounding_type === 1) {
        if (rounding_precision === 5 && parseFloat(lastChar) < 5) {
            new_net_amt = net_amt.slice(0, -1) + "5";
        }
        else if (rounding_precision === 5 && parseFloat(lastChar) === 5) {
            new_net_amt = net_amt;
        }
        else if (rounding_precision === 5 && parseFloat(lastChar) > 5) {
            const a = parseFloat(net_amt) + parseFloat(".05");
            const b = a.toFixed(2);
            new_net_amt = b.slice(0, -1) + "0";
        }
        else if (rounding_precision === 10) {
            const a = parseFloat(net_amt) + parseFloat(".10");
            const b = a.toFixed(2);
            new_net_amt = b.slice(0, -1) + "0";
        }
    }
    else if (rounding_type === 0) {
        if (rounding_precision === 5 && parseFloat(lastChar) < 5) {
            new_net_amt = net_amt.slice(0, -1) + "0";
        }
        else if (rounding_precision === 5 && parseFloat(lastChar) === 5) {
            new_net_amt = net_amt;
        }
        else if (rounding_precision === 5 && parseFloat(lastChar) > 5) {
            new_net_amt = net_amt.slice(0, -1) + "5";
        }
        else if (rounding_precision === 10) {
            new_net_amt = net_amt.slice(0, -1) + "0";
        }
    }
    else if (rounding_type === 2) {
        if (rounding_precision === 5) {
            const lastDigit = parseFloat(lastChar);
            if (lastDigit < 3) {
                new_net_amt = net_amt.slice(0, -1) + "0";
            } else if (lastDigit >= 3 && lastDigit < 8) {
                new_net_amt = net_amt.slice(0, -1) + "5";
            } else {
                const a = parseFloat(net_amt) + parseFloat(".10");
                const b = a.toFixed(2);
                new_net_amt = b.slice(0, -1) + "0";
            }
        }
        else if (rounding_precision === 10) {
            const lastDigit = parseFloat(lastChar);
            if (lastDigit < 5) {
                new_net_amt = net_amt.slice(0, -1) + "0";
            } else {
                const a = parseFloat(net_amt) + parseFloat(".10");
                const b = a.toFixed(2);
                new_net_amt = b.slice(0, -1) + "0";
            }
        }
    }
    const round_adj_amt = parseFloat(new_net_amt) - parseFloat(net_amt);
    return round_adj_amt.toFixed(2);
};

/**
 * Calculates the remaining tender amount needed to be paid.
 * @param {number} net_amt - The net amount of the order.
 * @param {any[]} payments - The array of payments made.
 * @returns {string} The remaining tender amount.
 */
export const calcRemainingTenderAmt = (net_amt, payments, payment) => {
    const { order: activeOrder } = useOrder();

    const thisOrder = activeOrder;

    const tender_amt = payments
        ?.map((item) => parseFloat(item?.tender_amt))
        ?.reduce((acc, val) => acc + val, 0);

    let remaining_tender_amt = net_amt - tender_amt;

    if (
        !same(payment?.payment_type, "C") &&
        thisOrder?.splitTo &&
        thisOrder?.netAmtPerPax &&
        payments?.length + 1 < thisOrder?.splitTo
    ) {
        remaining_tender_amt = parseFloat(thisOrder?.netAmtPerPax);
    }

    if (net_amt > 0 && tender_amt > net_amt) {
        remaining_tender_amt = 0;
    }

    return remaining_tender_amt.toFixed(2);
};

/**
 * Calculates and updates order amounts.
 * @param {any} order - The order object.
 * @param {any[]} [orderItems] - Optional array of order items.
 * @returns {any} The updated order object with calculated amounts.
 */
export const calcOrderAmt = (order, orderItems) => {
    const itemsToUse = orderItems || order?.sales_dtls || [];

    // Calculate Subtotal (Sum of item prices)
    const sub_total = itemsToUse
        .reduce((acc, item) => acc + parseFloat(item?.sub_total || 0), 0)
        .toFixed(2);

    // Calculate Service Charge
    const total_svc = itemsToUse
        .reduce((acc, item) => acc + parseFloat(item?.svc_amt || 0), 0)
        .toFixed(2);

    // Calculate Total Tax (The "Input" Tax)
    const total_tax = itemsToUse
        .reduce((acc, item) => acc + parseFloat(item?.tax_amt || 0), 0)
        .toFixed(2);

    // Calculate Absorbed Tax (The amount to subtract from the customer's bill)
    // We pass 'order' into isAbsorbTax to check the header status
    const total_tax_absorbed_val = itemsToUse
        .reduce((acc, item) => {
            if (isAbsorbTax(item, order)) {
                return acc + parseFloat(item?.tax_amt || 0);
            }
            return acc;
        }, 0);

    const total_tax_absorbed = total_tax_absorbed_val.toFixed(2);
    const round_adj_amt = parseFloat(order?.round_adj_amt || 0).toFixed(2);

    // Formula: (Subtotal + Service + Tax) - AbsorbedTax + Rounding
    const net_amt = (
        parseFloat(sub_total) +
        parseFloat(total_svc) +
        parseFloat(total_tax) -
        parseFloat(total_tax_absorbed) +
        parseFloat(round_adj_amt)
    ).toFixed(2);

    console.log("--- Math Check ---");
    console.log(`Sub: ${sub_total} + Svc: ${total_svc} + Tax: ${total_tax}`);
    console.log(`Minus Absorbed: ${total_tax_absorbed}`);
    console.log(`Final Net: ${net_amt}`);

    return {
        ...order,
        sales_dtls: itemsToUse,
        sub_total,
        total_disc: itemsToUse.reduce((acc, item) => acc + parseFloat(item?.pro_disc_amt || 0), 0).toFixed(2),
        total_svc,
        total_tax,
        total_tax_absorbed,
        round_adj_amt,
        net_amt
    };
};


/**
 * Gets the price based on service type.
 * @param {any} price - The price object.
 * @param {string} [service_type] - Optional service type.
 * @returns {number} The price for the given service type.
 */
export const getPriceByServiceType = (priceObj, service_type) => {
    const { order: activeOrder } = useOrder();
    //const serviceType = activeOrder?.service_type || "E"; // default to dine-in
    if (!priceObj) return 0;
    if (!service_type) {
        service_type = localStorage.getItem("orderType");
    }
    //console.log("priceObj", priceObj);
    switch (service_type) {
        case "Q":
        case "E":
            return priceObj.dine_in_price ?? priceObj.default_price ?? 0;
        case "T":
            return priceObj.takeaway_price ?? priceObj.default_price ?? 0;
        case "D":
            return priceObj.delivery_price ?? priceObj.default_price ?? 0;
    }
};


/**
 * Calculates and returns order item with discount.
 * @param {any} orderItem - The order item object.
 * @param {any} discount - The discount object.
 * @param {any[]} orderItems - The array of order items.
 * @returns {any} The updated order item with calculated discount.
 */
export const calcOrderItemDiscount = (orderItem, discount, orderItems) => {
    const { disc_type, disc_name, disc_value } = discount || {};

    const parentItem = useCache()?.items?.find(
        (item) =>
            item?.item_no ===
            orderItems?.find((item) => item?.s_no === orderItem.parent_sno)?.item_no
    );

    const parent_menu_type =
        Array.isArray(parentItem?.itemmaster_menutype) &&
        parentItem?.itemmaster_menutype[0]?.menu_type;

    const isNonAlacarteChildItem = !!(
        (orderItem.s_no !== orderItem.parent_sno && parent_menu_type) ||
        (orderItem.s_no !== orderItem.parent_sno &&
            bool(parentItem?.is_addon_enable) &&
            parentItem?.add_on_name)
    );

    const isAlacarteItem = !!(
        orderItem.s_no === orderItem.parent_sno && !parent_menu_type
    );

    let sub_total =
        isNonAlacarteChildItem || isAlacarteItem
            ? isModifierItem(orderItem) &&
                same(parent_menu_type, "S") &&
                orderItem?.ref_5
                ? 0
                : orderItem.qty * orderItem.unit_price
            : 0;

    if (disc_name && disc_name !== "None") {
        let disc_amt = 0;

        switch (disc_type) {
            // Fixed amount - item level
            case "V":
            case "$":
            // Fixed amount - promo level
            case "A":
                if (isNonAlacarteChildItem) {
                    const total = orderItems
                        ?.filter((item) => item?.parent_sno === orderItem.parent_sno)
                        ?.map((item) => item?.sub_total)
                        ?.reduce((acc, val) => acc + val, 0);
                    const totalDiscValue = disc_value * orderItem.qty;
                    disc_amt = (totalDiscValue / total) * orderItem.sub_total;
                    sub_total = sub_total - disc_amt;
                } else {
                    const totalDiscValue = disc_value * orderItem.qty;
                    disc_amt = totalDiscValue > sub_total ? sub_total : totalDiscValue;
                    sub_total = sub_total - disc_amt;
                }
                break;

            // Percentage - item level
            case "P":
            case "%":
                disc_amt = (sub_total * disc_value) / 100;
                sub_total = sub_total - disc_amt;
                break;
        }

        let newOrderItem = {
            ...orderItem,
            disc_type,
            disc_name,
            disc_value,
            disc_amt: disc_amt.toFixed(2),
            sub_total,
        };
        return addTax(newOrderItem);
    } else {
        let newOrderItem = {
            ...orderItem,
            disc_type: "N",
            disc_name: "None",
            disc_value: 0,
            disc_amt: "0.00",
            sub_total,
        };
        return addTax(newOrderItem);
    }
};

/**
 * Checks if discount can be applied to the order item.
 * @param {any} orderItem - The order item object.
 * @param {any} discount - The discount object.
 * @param {any[]} orderItems - The array of order items.
 * @returns {boolean} True if discount can be applied, false otherwise.
 */
export const goodToApplyDisc = (orderItem, discount, orderItems) => {
    const items = Array.isArray(useCache()?.items) ? useCache()?.items : [];
    const item = items.find(
        (item) => item?.item_no === orderItem?.item_no
    );
    const menu_type = Array.isArray(item?.itemmaster_menutype)
        ? item?.itemmaster_menutype[0]?.menu_type
        : "";
    let sub_total = orderItem?.qty * orderItem?.unit_price;
    sub_total = orderItems
        ?.filter((item) => item?.parent_sno === orderItem.s_no)
        ?.map((item) => item?.qty * item?.unit_price)
        ?.reduce((acc, val) => acc + val, 0);
    return !(
        (discount?.disc_type === "V" || discount?.disc_type === "$") &&
        sub_total < discount?.disc_value
    );
};

/**
 * Gets is absorb tax based on service type and global settings.
 * @param {any} item - The individual item object from sales_dtls.
 * @param {any} activeOrder - The current active order object.
 * @returns {boolean} True if tax is absorbed (included), false otherwise (added on top).
 */
/**
 * Gets is absorb tax based on service type.
 * @param {Object} item - The item object from sales_dtls.
 * @returns {boolean} True if tax is absorbed (included), false otherwise.
 */
export const isAbsorbTax = (item) => {
    // Use existing hooks/state managers
    const { store } = useCache?.() || {};
    const { order: activeOrder } = useOrder?.() || {};

    const serviceType = activeOrder?.service_type || localStorage.getItem("orderType");

    // Initialize with store-level default
    let is_absorbtax = store?.is_absorbtax;

    // Check if GST behavior is governed by mode of sales
    const ENABLE_GST_BY_MODE_OF_SALES = bool(
        getSetting("GENERAL SETTINGS", "ORDERING", "ENABLE_GST_BY_MODE_OF_SALES")
    );
    console.log("serviceType", serviceType);
    if (ENABLE_GST_BY_MODE_OF_SALES) {
        switch (serviceType) {
            case "Q": // Quick Service / QR
                is_absorbtax = ENABLE_GST_BY_MODE_OF_SALES
                    ? getSetting("GENERAL SETTINGS", "ORDERING", "QUICK_SERVICE_TAX_ABSORB")
                    : item?.quickservice_is_absorbtax;
                break;
            case "E": // Dine In
                is_absorbtax = ENABLE_GST_BY_MODE_OF_SALES
                    ? getSetting("GENERAL SETTINGS", "ORDERING", "DINE_IN_TAX_ABSORB")
                    : item?.dine_in_is_absorbtax;
                break;
            case "T": // Take Away
                is_absorbtax = ENABLE_GST_BY_MODE_OF_SALES
                    ? getSetting("GENERAL SETTINGS", "ORDERING", "TAKE_AWAY_TAX_ABSORB")
                    : item?.take_away_is_absorbtax;
                break;
            case "D": // Delivery
                is_absorbtax = ENABLE_GST_BY_MODE_OF_SALES
                    ? getSetting("GENERAL SETTINGS", "ORDERING", "DELIVERY_TAX_ABSORB")
                    : item?.delivery_is_absorbtax;
                break;
        }
    }

    // Final Conversion: Ensure we return a strict Boolean for calcOrderAmt filtering
    // Returns true if value is 1, "1", "Y", or true
    return (
        is_absorbtax === 1 ||
        is_absorbtax === "1" ||
        is_absorbtax === "Y" ||
        is_absorbtax === true
    );
};

/**
 * Calculates and returns order item with tax amount.
 * @param {any} orderItem - The order item object.
 * @returns {any} The updated order item with calculated tax amount.
 */
export const addTax = (orderItem) => {
    const { svcs } = useCache();
    const { order: activeOrder } = useOrder();
    const serviceType = activeOrder?.service_type;
    const service_type = orderItem?.take_away_item === "Y" ? "T" : serviceType;

    // ✅ Add safety check
    const svc = Array.isArray(svcs)
        ? svcs.find((item) => item?.service_type === service_type)
        : null;

    const service_by = svc?.service_by;
    const service_value = svc?.service_value || 0;

    // ✅ FIX: Use sub_total directly (it's already discounted)
    // Don't subtract pro_disc_amt because the discount was already applied to unit_price
    const total = parseFloat(orderItem?.sub_total || 0);

    let svc_amt = 0;
    switch (service_by) {
        case "V":
        case "$":
            svc_amt = service_value;
            break;
        case "P":
        case "%":
            svc_amt = (total * service_value) / 100;
            break;
        default:
            svc_amt = 0;
    }

    let tax_amt = 0;
    if (isAbsorbTax(orderItem)) {
        tax_amt =
            ((total + svc_amt) * parseFloat(orderItem?.tax_value || 0)) /
            (100 + parseFloat(orderItem?.tax_value || 0));
    } else {
        tax_amt = ((total + svc_amt) * parseFloat(orderItem?.tax_value || 0)) / 100;
    }

    return {
        ...orderItem,
        svc_amt: svc_amt.toFixed(6),
        tax_amt: tax_amt.toFixed(6),
    };
};

  /**
 * Checks if there is a cash payment in payment list.
 * @param {any[]} payments - The array of payments.
 * @returns {boolean} True if there is a cash payment, false otherwise.
 */
export const haveCashPayment = (payments) => {
    const cashPayments = payments?.filter((item) => item?.payment_type === "C");
    const cashPaymentModes = useCache()?.paymentModes?.find(
        (item) => item?.payment_type === "C"
    )?.pymt_type_details;
    const haveCashPayment = cashPaymentModes
        ?.filter((item) =>
            contains(
                cashPayments?.map((item) => item?.payment_name),
                item?.payment_name
            )
        )
        ?.some((item) => item?.rounding);
    return !!haveCashPayment;
};

/**
 * Checks if all payments are cash payments.
 * @param {any[]} payments - The array of payments.
 * @returns {boolean} True if all payments are cash payments, false otherwise.
 */
export const onlyCashPayments = (payments) => {
    const cashPayments = payments?.filter((item) => item?.payment_type === "C");
    return cashPayments?.length === payments?.length;
};

/**
 * Calculates and returns order item with subtotal.
 * @param {any} orderItem - The order item object.
 * @param {any[]} orderItems - The array of order items.
 * @returns {any} The updated order item with calculated subtotal.
 */
export const calcOrderItemSubtotal = (orderItem, orderItems) => {
    const { order: activeOrder } = useOrder();

    const serviceType = activeOrder?.service_type;

    const takeAwayChargeItemNo = getSysSetting(
        "System Settings",
        "ta_fixed_item_no"
    );
    if (same(orderItem?.item_no, takeAwayChargeItemNo)) {
        return addTax({
            ...orderItem,
            sub_total: orderItem?.qty * orderItem?.unit_price,
        });
    }

    const items = Array.isArray(useCache()?.items) ? useCache()?.items : [];
    const item = items.find(
        (item) => item?.item_no === orderItem?.item_no
    );

    const unit_price =
        isAddonItem(orderItem) ||
            isAddon2Item(orderItem) ||
            false
            ? orderItem?.unit_price
            : getPriceByServiceType(
                item?.selling_uom_dtls[0]?.price_dtls[0],
                orderItem?.take_away_item === "Y" ? "T" : serviceType
            );

    if (orderItem?.s_no === orderItem.parent_sno) {
        if (orderItem?.menu_type) {
            return addTax({ ...orderItem });
        }
        else {
            return calcOrderItemDiscount(
                {
                    ...orderItem,
                    unit_price,
                    sub_total: orderItem?.qty * unit_price,
                },
                {
                    disc_name: orderItem?.disc_name,
                    disc_type: orderItem?.disc_type,
                    disc_value: orderItem?.disc_value,
                },
                orderItems
            );
        }
    }
    else if (orderItem?.s_no !== orderItem.parent_sno) {
        return addTax({
            ...orderItem,
            sub_total: orderItem?.qty * orderItem?.unit_price,
        });
    }
};

/**
 * Checks if the item is weightable.
 * @param {any} item - The item object.
 * @returns {boolean} True if the item is weightable, false otherwise.
 */
export const isWeightableItem = (item) => {
    const items = Array.isArray(useCache()?.items) ? useCache()?.items : [];
    let lstItem = items.filter(function (v) {
        return v.item_no === item?.item_no;
    });
    if (lstItem.length > 0) {
        let is_weightable = lstItem[0].is_weightable;
        if (is_weightable === 1 || is_weightable === true) {
            return true;
        } else {
            return false;
        }
    }
    return false;
};

/**
 * Gets store setting based on main group name, group name and setting code.
 * @param {string} main_group_name - The main group name.
 * @param {string} group_name - The group name.
 * @param {string} setting_code - The setting code.
 * @returns {string} The setting value.
 */
export const getSetting = (main_group_name, group_name, setting_code) => {
    // 1. Get the raw cache (the large nested array you shared)
    const settingsCache = useCache()?.settings || [];

    // 2. Locate the Main Group (e.g., "GENERAL SETTINGS")
    const mainGroupObj = settingsCache.find(obj => obj[main_group_name]);
    if (!mainGroupObj) return undefined;

    // 3. Locate the Sub Group (e.g., "ORDERING")
    const subGroupObj = mainGroupObj[main_group_name].find(obj => obj[group_name]);
    if (!subGroupObj) return undefined;

    // 4. Return the value from the first item in that group's array
    // Based on your JSON: subGroupObj["ORDERING"] is an array [ { ... } ]
    return subGroupObj[group_name][0][setting_code];
};
/**
 * Checks user rights for the action.
 * @param {string} module - The module to check rights for.
 * @param {any} [user] - Optional user object.
 * @returns {boolean} True if the user has rights, false otherwise.
 */
export const authorised = (module, user) => {
    try {
        if (same(module, "ORDER")) {
            return true;
        }

        user = user || useCache()?.user;

        // ✅ Add safety checks
        const roles = Array.isArray(useCache()?.roles) ? useCache()?.roles : [];
        const role = roles.find((item) => same(item?.gr_code, user?.gr_code));

        if (!role || !Array.isArray(role?.menu)) {
            return false;
        }

        const menuItem = role.menu[0]?.sub?.find((item) => same(item?.menu_name, module));

        return bool(menuItem?.access_flag);
    } catch (error) {
        return false;
    }
};

/**
 * Gets menu item display name.
 * @param {any} item - The item object.
 * @returns {string} The display name of the item.
 */
export const getItemDisplayName = (item) => {
    const displayAs = getSetting(
        "GENERAL SETTINGS",
        "ORDERING",
        "display_name_orderscreen"
    );
    return (item ? item[displayAs] : null) || item?.item_name;
};

/**
 * Opens second screen.
 */
let secondScreenWindow = null;
export const openSecondScreen = () => {
    if (bool(getSetting("HARDWARE", "HARDWARE", "2nd_display_Enable"))) {
        if (!secondScreenWindow || secondScreenWindow.closed) {
            secondScreenWindow = window.open(
                `${window.location.origin}/second-screen`,
                "SecondDisplay",
                "resizable=1,scrollbars=1,fullscreen=1,height=300,width=4685,top=4685,left=4685,toolbar=0,menubar=0,status=1"
            );
        }
    }
};

/**
 * Sorts list by sequence number.
 * @param {any[]} list - The list to sort.
 * @returns {any[]} The sorted list.
 */
export const sortModifierAddonItems = (list) => {
    return clone(list)?.sort((a, b) => {
        if (a.seq_no !== null && a.seq_no !== undefined) {
            if (a.seq_no === 0 && b.seq_no === 0) return 0;
            if (a.seq_no === 0) return 1;
            if (b.seq_no === 0) return -1;
            return a.seq_no - b.seq_no;
        }
        else if (
            a.item_menutype_grpdtls !== null &&
            a.item_menutype_grpdtls !== undefined
        ) {
            if (a.item_menutype_grpdtls === 0 && b.item_menutype_grpdtls === 0)
                return 0;
            if (a.item_menutype_grpdtls === 0) return 1;
            if (b.item_menutype_grpdtls === 0) return -1;
            return a.item_menutype_grpdtls - b.item_menutype_grpdtls;
        }
        if (a.item_menutypedtls !== null && b.item_menutypedtls !== undefined) {
            if (a.item_menutypedtls === 0 && b.item_menutypedtls === 0) return 0;
            if (a.item_menutypedtls === 0) return 1;
            if (b.item_menutypedtls === 0) return -1;
            return a.item_menutypedtls - b.item_menutypedtls;
        }
    });
};

/**
 * Filters items that are available now.
 * @param {any[]} items - The array of items to filter.
 * @returns {any[]} The filtered array of items available now.
 */
export const availableNow = (items) => {
    if (!Array.isArray(items)) return [];
    const now = dayjs();
    const nowLogin = getNowWithLoginDate();

    return items.filter((item) => {
        // Check if promotion has time-based restrictions (start_time/end_time)
        if (item?.start_time && item?.end_time) {
            return now.isBetween(
                dayjs(item.start_time, TIME_FORMAT),
                dayjs(item.end_time, TIME_FORMAT)
            );
        }

        // Check promotion date range
        const inDateRange = nowLogin.isBetween(
            dayjs(item?.promo_st_date),
            dayjs(item?.promo_ed_date)
        );

        // If no time period restriction, just check date range
        if (item?.by_time_period === "N" || !item?.time_slot_dtls || item?.time_slot_dtls === "") {
            return inDateRange;
        }

        // If has time slots, check both date range AND time slots
        if (Array.isArray(item?.time_slot_dtls) && item.time_slot_dtls.length > 0) {
            return inDateRange && item.time_slot_dtls.some(
                (time) =>
                    same(time?.day_info, nowLogin.format("ddd")) &&
                    now.isBetween(
                        dayjs(time?.st_time, TIME_FORMAT),
                        dayjs(time?.ed_time, TIME_FORMAT)
                    )
            );
        }

        return inDateRange;
    });
};

/**
 * Gets root and selected categories based on current selected menu item.
 * @param {any} menuItem - The selected menu item.
 * @returns {Object} An object containing rootCategory and selectedCategory arrays.
 */
export const getRootAndSelectedCategories = (menuItem) => {
    const categories = [];

    let currentCategory = null;
    const menuItems = Array.isArray(useCache()?.menuItems) ? useCache()?.menuItems : [];

    do {
        for (const item of useCache()?.menuItems) {
            if (currentCategory) {
                if (Array.isArray(item?.category)) {
                    const foundItem = item?.category?.find((item) =>
                        same(item?.category_code, currentCategory)
                    );
                    if (foundItem) {
                        const root_category_code = foundItem?.root_category_code;
                        categories.unshift(root_category_code);
                        currentCategory = root_category_code;
                        break;
                    }
                }
            } else {
                if (Array.isArray(item?.items)) {
                    const foundItem = item?.items?.find((item) =>
                        same(item?.item_no, menuItem?.item_no)
                    );
                    if (foundItem) {
                        const category_code = foundItem?.category_code;
                        categories.unshift(category_code);
                        currentCategory = category_code;
                        break;
                    }
                }
            }
        }
    } while (!currentCategory || !same(currentCategory, "MAIN"));

    let rootCategory = categories?.map((item) => item);
    rootCategory.pop();
    let selectedCategory = categories?.map((item) => item);
    selectedCategory.shift();

    return { rootCategory, selectedCategory };
};

/**
 * Gets promo linked to the item.
 * @param {any} item - The item object.
 * @param {string | string[]} criteria_type - The criteria type of the promo.
 * @returns {any} The promo object linked to the item, or null if no promo is found.
 */
export const getPromo = (item, criteria_type) => {
    const { order: activeOrder } = useOrder();
    const serviceType = activeOrder?.service_type;

    const cache = useCache();
    const allPromos = Array.isArray(cache?.promos) ? cache.promos : [];

    const promos = allPromos
        .filter((promo) =>
            contains(
                promo?.service_type?.map((item) => item?.service_type),
                serviceType
            )
        )
        .filter((promo) => isPromoApplicable(promo, item))
        .filter((promo) => {
            if (Array.isArray(criteria_type)) {
                return contains(criteria_type, promo?.criteria_type);
            } else {
                return same(promo?.criteria_type, criteria_type);
            }
        });

    return promos.length > 0 ? promos[0] : null;
};


/**
 * Sorts order items ascendingly.
 * @param {any[]} orderItems - The array of order items to sort.
 * @returns {any[]} The sorted array of order items.
 */
export const sortOrderItems = (orderItems) => {

    return (orderItems || [])?.sort((a, b) => {
        if (a.s_no !== b.s_no) {
            console.log("d_sno1", a.parent_sno - b.parent_sno);
            return a.s_no - b.s_no;
        }
        if (a.parent_sno !== b.parent_sno) {
            console.log("d_sno2", a.parent_sno - b.parent_sno);

            return a.parent_sno - b.parent_sno;
        }
        console.log("d_sno3", a.parent_sno - b.parent_sno);
        console.log("orderItems", orderItems);

        return a.ds_no - b.ds_no;
    });
};

/**
 * Get the sets of the promo.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of promo set.
 */
export const getPromoSets = (promo, orderItems, orderItem) => {
    console.log(`\n🔍 getPromoSets START`);
    console.log(`   - Promo: ${promo?.promo_name} (Type: ${promo?.criteria_type})`);
    console.log(`   - Payment Name (set size): ${promo?.criteria_payment_name}`);
    console.log(`   - Order items count: ${orderItems?.length}`);
    console.log(`   - Current item: ${orderItem?.item_no}`);

    const { setLastSNo } = useOrder();

    const isTotalDiscountPromo = same(
        promo?.criteria_type,
        PROMO_TYPE.TOTAL_DISCOUNT
    );

    console.log("   📊 orderItems:", orderItems);
    console.log("   📊 orderItem:", orderItem);

    // ===== NEW: Log promo criteria =====
    console.log(`\n   📋 PROMO CRITERIA:`);
    console.log(`      - item_dtls (specific items):`, promo?.item_dtls);
    console.log(`      - item_menu_category_dtls (categories):`, promo?.item_menu_category_dtls);
    console.log(`      - criteria_type:`, promo?.criteria_type);
    console.log(`      - isTotalDiscountPromo:`, isTotalDiscountPromo);
    // ===================================

    let remaining = orderItems
        ?.filter((item) => same(item?.parent_sno, item?.s_no))
        ?.filter((item) =>
            same(
                findPromoByName(item?.disc_name)?.criteria_type,
                PROMO_TYPE.ITEM_DISCOUNT
            )
                ? true
                : same(item?.disc_name, "None") || !item?.disc_name  // ✅ also allow empty string
        );

    // ===== NEW: Log remaining items =====
    console.log(`\n   🔍 REMAINING ITEMS (after filtering):`);
    console.log(`      Count: ${remaining?.length}`);
    remaining?.forEach((item, idx) => {
        console.log(`      ${idx}: ${item.item_no} (${item.category_code}) - qty: ${item.qty}, disc_name: "${item.disc_name}"`);
    });
    // ====================================

    let newOrderItems = clone(orderItems);

    const sets = [];
    let _insert = false;
    let _delete = false;
    let cont = true;

    _insert = true;

    // ===== NEW: Check promo applicability =====
    const isApplicable = isTotalDiscountPromo || isPromoApplicable(promo, orderItem);
    console.log(`\n   ✅ PROMO APPLICABILITY CHECK:`);
    console.log(`      - isTotalDiscountPromo: ${isTotalDiscountPromo}`);
    console.log(`      - isPromoApplicable(promo, orderItem): ${isPromoApplicable(promo, orderItem)}`);
    console.log(`      - Result: ${isApplicable ? '✅ PASSED' : '❌ FAILED'}`);

    if (!isApplicable) {
        console.log(`      ⚠️ PROMO NOT APPLICABLE - EXITING`);
    }
    // ==========================================

    if (isApplicable) {
        console.log(`\n   🔄 STARTING SET FORMATION LOOP...`);
        let loopIteration = 0;

        while (cont && remaining?.length > 0) {
            loopIteration++;
            console.log(`\n   🔁 Loop Iteration ${loopIteration}:`);
            console.log(`      - Remaining items: ${remaining?.length}`);
            console.log(`      - Sets found so far: ${sets?.length}`);

            if (same(promo?.criteria_type, PROMO_TYPE.LOWEST_PRICE_DISCOUNT)) {
                console.log(`      💰 Sorting by LOWEST PRICE...`);
                remaining = remaining?.sort((a, b) => {
                    if (!same(a?.s_no, a?.parent_sno)) return 1;
                    if (!same(b?.s_no, b?.parent_sno)) return -1;
                    return (b?.unit_price || 0) - (a?.unit_price || 0);
                });

                if (remaining?.length > 0) {
                    const lastItem = remaining[remaining.length - 1];
                    remaining = [lastItem, ...remaining.slice(0, -1)];
                }
            }

            let found = false;
            const set = [];

            // ===== CASE 1: Specific Items (item_dtls) =====
            if (Array.isArray(promo?.item_dtls)) {
                console.log(`\n      📦 CASE 1: SPECIFIC ITEMS (item_dtls)`);
                console.log(`         Required items count: ${promo?.item_dtls?.length}`);

                for (let i = 0; i < promo?.item_dtls?.length; i++) {
                    const promoitem = promo?.item_dtls[i];
                    let qty = promoitem?.qty;

                    console.log(`\n         🔍 Looking for: ${promoitem?.item_no} (need qty: ${qty})`);

                    if (qty > 0) {
                        for (
                            let j = 0;
                            j < remaining?.filter((item) => !item?.checked)?.length;
                            j++
                        ) {
                            const orderitem = remaining[j];

                            if (same(promoitem?.item_no, orderitem?.item_no)) {
                                console.log(`            ✅ Found match: ${orderitem?.item_no} (has qty: ${orderitem?.qty})`);

                                if (qty >= orderitem?.qty) {
                                    set.push(orderitem);
                                    qty = qty - orderitem?.qty;
                                    console.log(`               Added entire item. Remaining needed: ${qty}`);
                                    if (qty <= 0) {
                                        break;
                                    }
                                }
                                else {
                                    const newOrderItem = { ...orderitem, qty };
                                    set.push(newOrderItem);

                                    let s_no =
                                        Math.max(...newOrderItems.map((item) => item?.s_no)) + 1;
                                    const remainingQty = orderitem?.qty - qty;
                                    const splitedOrderItem = {
                                        ...orderitem,
                                        s_no: s_no,
                                        parent_sno: s_no,
                                        qty: remainingQty,
                                    };
                                    setLastSNo(s_no);

                                    console.log(`               Split item: ${qty} for promo, ${remainingQty} remaining`);

                                    newOrderItems = newOrderItems?.map((item, index) => {
                                        if (same(item?.parent_sno, orderitem?.s_no)) {
                                            return {
                                                ...item,
                                                qty,
                                            };
                                        } else {
                                            return item;
                                        }
                                    });
                                    newOrderItems.push(splitedOrderItem);
                                    remaining.push(splitedOrderItem);
                                    break;
                                }
                            }
                        }
                    }

                    remaining = remaining?.filter(
                        (item) =>
                            !contains(
                                sets?.flat()?.map((item) => item?.s_no),
                                item?.s_no
                            )
                    );
                }

                if (set?.length > 0) {
                    console.log(`\n         📊 Set formed with ${set?.length} items. Validating...`);

                    const merged = set.reduce((acc, curr) => {
                        const existingItem = acc.find((item) =>
                            same(item.item_no, curr.item_no)
                        );
                        if (existingItem) {
                            existingItem.qty += curr.qty;
                        } else {
                            acc.push({ item_no: curr.item_no, qty: curr.qty });
                        }
                        return acc;
                    }, []);

                    console.log(`         Merged quantities:`, merged);
                    console.log(`         Required:`, promo?.item_dtls?.map(d => ({ item_no: d.item_no, qty: d.qty })));

                    found = promo?.item_dtls?.every((criteria) => {
                        const hasItem = merged?.find((item) => same(item?.item_no, criteria?.item_no))?.qty === criteria?.qty;
                        console.log(`            ${criteria?.item_no}: ${hasItem ? '✅' : '❌'} (need ${criteria?.qty}, have ${merged?.find(i => same(i?.item_no, criteria?.item_no))?.qty || 0})`);
                        return hasItem;
                    });

                    console.log(`         Validation result: ${found ? '✅ SET VALID' : '❌ SET INVALID'}`);
                } else {
                    console.log(`         ⚠️ No items added to set`);
                }
            }

            // ===== CASE 2: Categories (item_menu_category_dtls) =====
            else if (Array.isArray(promo?.item_menu_category_dtls)) {
                console.log(`\n      📦 CASE 2: CATEGORIES (item_menu_category_dtls)`);
                console.log(`         Required categories count: ${promo?.item_menu_category_dtls?.length}`);

                for (let i = 0; i < promo?.item_menu_category_dtls?.length; i++) {
                    const promoitem = promo?.item_menu_category_dtls[i];
                    let qty = promoitem?.qty;

                    console.log(`\n         🔍 Looking for category: ${promoitem?.category_code} (need qty: ${qty})`);

                    if (qty > 0) {
                        for (
                            let j = 0;
                            j < remaining?.filter((item) => !item?.checked)?.length;
                            j++
                        ) {
                            const orderitem = remaining[j];

                            if (same(promoitem?.category_code, orderitem?.category_code)) {
                                console.log(`            ✅ Found match: ${orderitem?.item_no} (category: ${orderitem?.category_code}, has qty: ${orderitem?.qty})`);

                                if (qty >= orderitem?.qty) {
                                    set.push(orderitem);
                                    qty = qty - orderitem?.qty;
                                    console.log(`               Added entire item. Remaining needed: ${qty}`);
                                    if (qty <= 0) {
                                        break;
                                    }
                                }
                                else {
                                    const newOrderItem = { ...orderitem, qty };
                                    set.push(newOrderItem);

                                    let s_no =
                                        Math.max(...newOrderItems.map((item) => item?.s_no)) + 1;
                                    const remainingQty = orderitem?.qty - qty;
                                    const splitedOrderItem = {
                                        ...orderitem,
                                        s_no: s_no,
                                        parent_sno: s_no,
                                        qty: remainingQty,
                                    };
                                    setLastSNo(s_no);

                                    console.log(`               Split item: ${qty} for promo, ${remainingQty} remaining`);

                                    newOrderItems = newOrderItems?.map((item, index) => {
                                        if (same(item?.parent_sno, orderitem?.s_no)) {
                                            return {
                                                ...item,
                                                qty,
                                            };
                                        } else {
                                            return item;
                                        }
                                    });
                                    newOrderItems.push(splitedOrderItem);
                                    remaining.push(splitedOrderItem);
                                    break;
                                }
                            }
                        }
                    }

                    remaining = remaining?.filter(
                        (item) =>
                            !contains(
                                sets?.flat()?.map((item) => item?.s_no),
                                item?.s_no
                            )
                    );
                }

                if (set?.length > 0) {
                    console.log(`\n         📊 Set formed with ${set?.length} items. Validating...`);

                    const merged = set.reduce((acc, curr) => {
                        const existingItem = acc.find((item) =>
                            same(item.category_code, curr.category_code)
                        );
                        if (existingItem) {
                            existingItem.qty += curr.qty;
                        } else {
                            acc.push({ category_code: curr.category_code, qty: curr.qty });
                        }
                        return acc;
                    }, []);

                    console.log(`         Merged quantities:`, merged);
                    console.log(`         Required:`, promo?.item_menu_category_dtls?.map(d => ({ category_code: d.category_code, qty: d.qty })));

                    found = promo?.item_menu_category_dtls?.every((criteria) => {
                        const hasCategory = merged?.find((item) =>
                            same(item?.category_code, criteria?.category_code)
                        )?.qty === criteria?.qty;
                        console.log(`            ${criteria?.category_code}: ${hasCategory ? '✅' : '❌'} (need ${criteria?.qty}, have ${merged?.find(i => same(i?.category_code, criteria?.category_code))?.qty || 0})`);
                        return hasCategory;
                    });

                    console.log(`         Validation result: ${found ? '✅ SET VALID' : '❌ SET INVALID'}`);
                } else {
                    console.log(`         ⚠️ No items added to set`);
                }
            }
            // ===== NO CRITERIA =====
            else {
                console.log(`\n      ⚠️ NO CRITERIA DEFINED`);
                console.log(`         - item_dtls is ${Array.isArray(promo?.item_dtls) ? 'array' : typeof promo?.item_dtls}`);
                console.log(`         - item_menu_category_dtls is ${Array.isArray(promo?.item_menu_category_dtls) ? 'array' : typeof promo?.item_menu_category_dtls}`);
            }

            // ===== PROCESS FOUND SET =====
            if (found) {
                console.log(`\n      ✅ SET ${sets.length + 1} ADDED TO SETS ARRAY`);
                if (_delete) {
                    _insert = false;
                }
                sets.push(set);
                remaining = remaining?.filter(
                    (item) =>
                        !contains(
                            sets?.flat()?.map((item) => item?.s_no),
                            item?.s_no
                        )
                );
                newOrderItems = newOrderItems?.map((orderitem) =>
                    calcOrderItemSubtotal(orderitem, newOrderItems)
                );
            } else {
                console.log(`\n      ❌ NO VALID SET FOUND - STOPPING LOOP`);
                cont = false;
            }
        }

        if (remaining?.length === 0 && sets?.length === 0) {
            console.log(`\n   ⚠️ LOOP ENDED: No remaining items but also no sets formed`);
        }
    }

    console.log(`\n   ======================================`);
    console.log(`   ➡️ FINAL RESULT:`);
    console.log(`      - _insert: ${_insert}`);
    console.log(`      - _delete: ${_delete}`);
    console.log(`      - sets found: ${sets?.length || 0}`);
    if (sets?.length > 0) {
        console.log(`   📦 SETS:`);
        sets.forEach((set, idx) => {
            console.log(`      Set ${idx + 1}:`);
            set.forEach(item => {
                console.log(`         - ${item.item_no} (${item.category_code}) qty: ${item.qty}`);
            });
        });
    } else {
        console.log(`      ⚠️ NO SETS FORMED`);
    }
    console.log(`   ======================================\n`);

    return { sets, _insert, _delete, _orderItems: newOrderItems };
};


/**
 * Checks if the order item is not free item based on the criteria type.
 * @param {any} orderItem - The order item object.
 * @param {string} criteriaType - The criteria type.
 * @returns {boolean} True if the order item is not free item, false otherwise.
 */
export const notFreeItem = (orderItem, criteriaType) => {
    switch (criteriaType) {
        case PROMO_TYPE.FREE_ITEM:
        case PROMO_TYPE.FREE_ITEM_WITH_LIMIT:
            return !(
                orderItem?.ds_no >= FREE_ITEM_STARTING_DS_NO &&
                orderItem?.ds_no < FREE_ITEM_BY_VALUE_STARTING_DS_NO
            );
        case PROMO_TYPE.FREE_ITEM_BY_VALUE:
            return !(
                orderItem?.ds_no >= FREE_ITEM_BY_VALUE_STARTING_DS_NO &&
                orderItem?.ds_no < SPECIAL_PRICE_ITEM_STARTING_DS_NO
            );
        case PROMO_TYPE.SPECIAL_PRICE:
            return !(
                orderItem?.ds_no >= SPECIAL_PRICE_ITEM_STARTING_DS_NO &&
                orderItem?.ds_no < SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO
            );
        case PROMO_TYPE.SPECIAL_DISCOUNT_WITH_QUANTITY:
            return !(
                orderItem?.ds_no >=
                SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO &&
                orderItem?.ds_no < ADDON_STARTING_DS_NO
            );
        default:
            return !(
                orderItem?.ds_no >= FREE_ITEM_STARTING_DS_NO &&
                orderItem?.ds_no < ADDON_STARTING_DS_NO
            );
    }
    console.log('🔍 notFreeItem:', {
        item_no: orderItem?.item_no,
        item_name: orderItem?.item_name,
        ds_no: orderItem?.ds_no,
        criteriaType,
        expectedRange: range,
        isFreeItem: !result,   // true = IS a free item
        notFreeItem: result,   // true = is NOT a free item
    });
};

/**
 * Checks if the order item is promo applicable.
 * @param {any} promo - The promo object.
 * @param {any} orderItem - The order item object.
 * @returns {boolean} True if the promo is applicable, false otherwise.
 */
const isPromoApplicable = (promo, orderItem) => {
    console.log(`🔍 isPromoApplicable v2: criteria_type="${promo?.criteria_type}" by_item="${promo?.by_item}"`);

    const { order: activeOrder } = useOrder();
    const serviceType = activeOrder?.service_type;
    if (
        !contains(
            promo?.service_type?.map(({ service_type }) => service_type),
            bool(orderItem?.take_away_item) ? "T" : serviceType
        )
    ) {
        return false;
    }

    if (same(promo?.criteria_type, PROMO_TYPE.LOWEST_PRICE_DISCOUNT)) {
        // ✅ Debug — remove after fix confirmed
        console.log('🎯 LD promo categories:', promo?.item_menu_category_dtls?.map(i => i?.category_code));
        console.log('🎯 orderItem category:', orderItem?.category_code);

        return (
            contains(
                (promo?.item_menu_category_dtls || [])?.map((item) => item?.category_code),
                orderItem?.category_code
            ) ||
            contains(
                (promo?.item_dtls || [])?.map((item) => item?.item_no),
                orderItem?.item_no
            )
        );
    }

    if (same(promo?.by_item, "AI")) {
        return true;
    } else if (same(promo?.by_item, "SC")) {
        const inCategory = contains(
            (promo?.item_menu_category_dtls || [])?.map((item) => item?.category_code),
            orderItem?.category_code
        );
        const inCriteriaItems = contains(
            (promo?.creteria_item_dtls || [])?.map((item) => item?.item_no),
            orderItem?.item_no
        );
        const inItemDtls = contains(
            (promo?.item_dtls || [])?.map((item) => item?.item_no),
            orderItem?.item_no
        );
        return inCategory || inCriteriaItems || inItemDtls;
    } else if (same(promo?.by_item, "SI")) {
        const inItemDtls = contains(
            (promo?.item_dtls || [])?.map((item) => item?.item_no),
            orderItem?.item_no
        );
        const inCriteriaItems = contains(
            (promo?.creteria_item_dtls || [])?.map((item) => item?.item_no),
            orderItem?.item_no
        );
        return inItemDtls || inCriteriaItems;
    } else if (same(promo?.by_item, "SD")) {
        return (
            contains(
                (promo?.item_menu_category_dtls || [])?.map((item) => item?.category_code),
                orderItem?.category_code
            ) ||
            contains(
                (promo?.item_dtls || [])?.map((item) => item?.item_no),
                orderItem?.item_no
            ) ||
            contains(
                (promo?.creteria_item_dtls || [])?.map((item) => item?.item_no),
                orderItem?.item_no
            )
        );
    } else {
        return false;
    }
};


/**
 * Get the inserted free items based on the promo criteria type.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @returns {any[]} The array of free items.
 */
const getInsertedFreeItems = (promo, orderItems) => {
    let from = 0;
    switch (promo?.criteria_type) {
        case PROMO_TYPE.FREE_ITEM_WITH_LIMIT:
            from = FREE_ITEM_STARTING_DS_NO;
            break;
        case PROMO_TYPE.FREE_ITEM_BY_VALUE:
            from = FREE_ITEM_BY_VALUE_STARTING_DS_NO;
            break;
        case PROMO_TYPE.SPECIAL_PRICE:
            from = SPECIAL_PRICE_ITEM_STARTING_DS_NO;
            break;
        case PROMO_TYPE.SPECIAL_DISCOUNT_WITH_QUANTITY:
            from = SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO;
            break;
    }

    return orderItems?.filter((item) => item?.ds_no > from);
};

/**
 * Check if pre order page.
 * @returns {boolean} True if pre order page, false otherwise.
 */
export const isPreOrderPage = () => {
    if (typeof window === "undefined") return false;
    return same(window.location.pathname, "/pre-orders");
};


/**
 * Process and apply promotion logic to the order items.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any} The result object.
 */
export const applyPromotions = (
    orderItems,
    orderItem,
    voucherPromoInfo = null
) => {
    console.log('🔢 DS_NO Constants:', {
        FREE_ITEM_STARTING_DS_NO,
        FREE_ITEM_BY_VALUE_STARTING_DS_NO,
        SPECIAL_PRICE_ITEM_STARTING_DS_NO,
        SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO,
        ADDON_STARTING_DS_NO,
    });
    console.log('🛒 Incoming orderItem ds_no:', orderItem?.ds_no, '| item_no:', orderItem?.item_no, '| item_name:', orderItem?.item_name);
    console.log('📋 All orderItems ds_no map:', orderItems.map(i => ({
        s_no: i.s_no,
        item_no: i.item_no,
        item_name: i.item_name,
        ds_no: i.ds_no,
        disc_name: i.disc_name,
    })));


    let newOrderItems = [...orderItems];

    // ✅ Safe array init
    let promos = Array.isArray(useCache()?.promos) ? useCache()?.promos : [];

    // ✅ Enhanced: check customer group exclusion only when customer data is available.
    // If promo targets registered customers (by_target_customer = "R") but no customer
    // is on the order yet, allow the promo through — we cannot validate group membership
    // without a customer, so we default to permissive rather than blocking.
    const { order: activeOrder, preorder } = useOrder();
    const orderData = isPreOrderPage() ? preorder : activeOrder;
    promos = promos?.filter((promo) => {
        if (same(promo?.by_target_customer, "R")) {
            if (orderData?.customer_code && orderData?.customer) {
                // Customer is present — check if their group is excluded
                return !(promo?.exclude_customer_group || [])?.some((customergroup) =>
                    same(
                        customergroup?.cust_group_name,
                        orderData?.customer?.cust_group_name
                    )
                );
            } else {
                // ✅ Enhancement: no customer on order, allow promo (cannot validate group)
                return true;
            }
        } else {
            return true;
        }
    });

    // ✅ Enhanced: only filter out promos that are explicitly disabled for web (apply_web === 0 or false).
    // If apply_web is null/undefined (not configured), allow the promo through.
    promos = promos?.filter((promo) => {
        // If apply_web is explicitly set to 0 or false, exclude it
        if (promo?.apply_web === 0 || promo?.apply_web === false) return false;
        // Otherwise allow (covers true, 1, null, undefined — not explicitly disabled)
        return true;
    });

    if (!voucherPromoInfo) {
        // break the sets for all promotions except total discount
        const setPromos = promos?.filter(
            (promo) =>
                same(promo?.by_item, "SD") &&
                !same(promo?.criteria_type, PROMO_TYPE.TOTAL_DISCOUNT)
        );

        setPromos?.forEach((promo) => {
            newOrderItems = newOrderItems
                ?.map((orderitem) => {
                    // Only remove promotion from items that are bound to the deleted item
                    if (
                        same(promo?.promo_name, orderitem?.disc_name) &&
                        orderitem?.ref_1 &&
                        same(orderitem?.ref_1, orderItem?.s_no)
                    ) {
                        if (notFreeItem(orderitem, promo)) {
                            return calcOrderItemDiscount(
                                {
                                    ...orderitem,
                                    disc_name: "None",
                                    ref_1: "",
                                },
                                null,
                                newOrderItems
                            );
                        }
                    } else {
                        return orderitem;
                    }
                })
                ?.filter((orderitem) => !!orderitem);
        });
    }

    // filter out expired promotions
    promos = availableNow(promos);

    // filter promos depending whether it is voucher type or promotion type
    // ✅ Safe array guard
    promos = Array.isArray(promos)
        ? promos.filter((promo) => {
            if (voucherPromoInfo) {
                return promo?.apply_terminal === 2;
            } else {
                return promo?.apply_terminal === 0;
            }
        })
        : [];

    const result = {
        orderItems: newOrderItems,
        process: null,
        // CRM voucher related
        applied: 0,
        amount: 0,
    };

    for (const promo of promos || []) {
        if (
            // if specific promotion is passed in, only process that promotion, skip for others
            // else it is processing all promotions, set to true to loop through all promotions
            voucherPromoInfo
                ? same(voucherPromoInfo?.promo_name, promo?.promo_name)
                : true
        ) {
            // item discount
            if (same(promo?.criteria_type, PROMO_TYPE.ITEM_DISCOUNT)) {
                const { orderItems, applied, amount } = processItemDiscountPromo(
                    promo,
                    newOrderItems,
                    orderItem,
                    voucherPromoInfo?.limit
                );
                newOrderItems = orderItems;
                result.applied = applied;
                result.amount = amount;
            }

            // free item, special price, special discount with quantity
            else if (
                contains(
                    [PROMO_TYPE.FREE_ITEM, PROMO_TYPE.SPECIAL_PRICE],
                    promo?.criteria_type
                )
            ) {
                const { orderItems, applied, amount } =
                    processDirectInsertFreeItemPromo(
                        promo,
                        newOrderItems,
                        orderItem,
                        voucherPromoInfo?.limit
                    );
                newOrderItems = orderItems;
                result.applied = applied;
                result.amount = amount;
            }
            // free item by quantity
            else if (
                same(promo?.criteria_type, PROMO_TYPE.SPECIAL_DISCOUNT_WITH_QUANTITY)
            ) {
                const { orderItems, applied } = processFreeItemByQuantityPromo(
                    promo,
                    newOrderItems,
                    orderItem
                );
                newOrderItems = orderItems;
                result.applied = applied;
            }
            // lowest price discount
            else if (same(promo?.criteria_type, "LD")) {
                const { orderItems, applied, amount } = processLowestPriceDiscountPromo(
                    promo,
                    newOrderItems,
                    orderItem,
                    voucherPromoInfo?.limit
                );
                newOrderItems = orderItems;
                result.applied = applied;
                result.amount = amount;
            }
            // free item with limit
            else if (same(promo?.criteria_type, PROMO_TYPE.FREE_ITEM_WITH_LIMIT)) {
                const { processOrderItem, orderItems, applied } =
                    processFreeItemByLimitPromo(promo, newOrderItems, orderItem);
                newOrderItems = orderItems;
                result.applied = applied;
                if (processOrderItem) {
                    result.process = { promo, item: processOrderItem };
                    break;
                }
            }
            // free item by value
            else if (same(promo?.criteria_type, PROMO_TYPE.FREE_ITEM_BY_VALUE)) {
                const { processOrderItem, orderItems, applied } =
                    processFreeItemByValuePromo(promo, newOrderItems, orderItem);
                newOrderItems = orderItems;
                result.applied = applied;
                if (processOrderItem) {
                    result.process = { promo, item: processOrderItem };
                    break;
                }
            }
        }
    }

    result.orderItems = newOrderItems;
    return result;
};

export const processTotalDiscountVoucherPromo = (promo, orderItems, limit = 1) => {
    // Get eligible categories (uppercase trimmed)
    const categories =
        promo?.item_menu_category_dtls?.map(c =>
            c.category_code?.trim().toUpperCase()
        ) || [];

    let applied = 0;
    let amount = 0;

    // Filter items eligible for total discount
    const eligibleItems = orderItems.filter(item => {
        const itemCategory = item?.category_code?.trim().toUpperCase();
        return categories.length === 0 || categories.includes(itemCategory);
    });

    if (eligibleItems.length === 0) {
        return { orderItems, applied, amount }; // no eligible items
    }

    // Calculate total discount on subtotal
    let subtotal = eligibleItems.reduce((sum, i) => sum + i.price * i.qty, 0);
    let discount = 0;

    if (promo.criteria_disc_type === "P") {
        discount = subtotal * (promo.criteria_disc_value / 100);
    } else if (promo.criteria_disc_type === "F") {
        discount = promo.criteria_disc_value;
    }

    if (discount > 0) {
        applied = 1; // One application of this promo
        amount = discount;

        // Optionally, prorate discount across items
        const totalQty = eligibleItems.reduce((sum, i) => sum + i.qty, 0);
        const newItems = orderItems.map(item => {
            const itemCategory = item?.category_code?.trim().toUpperCase();
            if (categories.length === 0 || categories.includes(itemCategory)) {
                const itemTotal = item.price * item.qty;
                const itemDiscount = (itemTotal / subtotal) * discount;

                return {
                    ...item,
                    disc_name: promo.promo_name,
                    disc_amt: parseFloat(itemDiscount.toFixed(2)), // keep 2 decimals
                };
            }
            return item;
        });

        return { orderItems: newItems, applied, amount };
    }

    return { orderItems, applied, amount };
};

/**
 * Processes free item promo (free item, special price, special discount with quantity) and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
const processDirectInsertFreeItemPromo = (
    promo,
    orderItems,
    orderItem,
    limit
) => {
    let newOrderItems = [...orderItems];

    let applied = 0;
    let amount = 0;

    let remaining = limit ?? Infinity;

    const isSpecialPricePromo = same(
        promo?.criteria_type,
        PROMO_TYPE.SPECIAL_PRICE
    );

    if (isPromoApplicable(promo, orderItem)) {
        // set deal criteria
        if (same(promo?.by_item, "SD")) {
            const { sets, _insert, _delete, _orderItems } = getPromoSets(
                promo,
                newOrderItems,
                orderItem,
                limit
            );
            if (_insert) {
                newOrderItems = clone(_orderItems);
                sets?.forEach((set) => {
                    if (remaining > 0) {
                        let tempFreeItems = getFreeItems(
                            promo,
                            set[set.length - 1],
                            newOrderItems
                        );
                        if (tempFreeItems?.length > 0) {
                            newOrderItems = newOrderItems?.map((item) => {
                                if (
                                    contains(
                                        set?.map((item) => item?.s_no),
                                        item?.s_no
                                    )
                                ) {
                                    return {
                                        ...item,
                                        disc_name: promo?.promo_name,
                                        ref_1: orderItem?.s_no,
                                    };
                                } else {
                                    return item;
                                }
                            });

                            applied++;
                            remaining -= applied;
                            if (isSpecialPricePromo) {
                                amount += Math.abs(
                                    tempFreeItems?.reduce((acc, item) => acc + item?.sub_total, 0)
                                );
                            }
                        }
                        newOrderItems = [...newOrderItems, ...tempFreeItems];
                    }
                });
            } else if (_delete) {
                newOrderItems = resetSetPromo(promo, newOrderItems, orderItem);
            }
        }

        // selected categories / items criteria
        else {
            if (remaining > 0) {
                const splitedOrderItems = [];
                const changedOrderItems = [];
                let latestOrderItem = clone(orderItem);

                newOrderItems?.forEach((orderitem, index) => {
                    const changesNeedOrderItem = changedOrderItems?.find((item) =>
                        same(item?.s_no, orderitem?.s_no)
                    );
                    if (changesNeedOrderItem) {
                        newOrderItems[index] = changesNeedOrderItem;
                        orderitem = changesNeedOrderItem; // Update local reference too
                    }

                    if (same(orderitem?.s_no, orderItem?.s_no)) {
                        if (orderitem?.qty <= remaining) {
                            applied += orderitem?.qty;
                        }
                        // qty or remaining is less than order item qty (apply partial and split the non-applied)
                        else {
                            const qty = remaining;
                            remaining = 0;

                            const splitSNo =
                                Math.max(...newOrderItems.map((item) => item?.s_no)) + 1;
                            const splitQty = orderitem?.qty - qty;
                            let childOffset = 0;
                            newOrderItems?.forEach((_orderitem) => {
                                if (same(_orderitem?.parent_sno, orderitem?.parent_sno)) {
                                    let qty = _orderitem?.qty;
                                    const isMainItem =
                                        _orderitem?.ds_no === 1 ||
                                        _orderitem?.s_no === _orderitem?.parent_sno;

                                    if (isMainItem) {
                                        qty = splitQty;
                                    } else {
                                        changedOrderItems.push(
                                            calcOrderItemSubtotal(
                                                { ..._orderitem, qty: _orderitem?.qty - splitQty },
                                                newOrderItems
                                            )
                                        );
                                        qty = (qty / orderitem?.qty) * splitQty;
                                    }

                                    // For main item: s_no = parent_sno = splitSNo
                                    // For child items: s_no = splitSNo + offset, parent_sno = splitSNo
                                    const newSNo = isMainItem
                                        ? splitSNo
                                        : splitSNo + ++childOffset;
                                    const newParentSNo = splitSNo;

                                    splitedOrderItems.push(
                                        calcOrderItemSubtotal(
                                            {
                                                ..._orderitem,
                                                s_no: newSNo,
                                                parent_sno: newParentSNo,
                                                qty,
                                                disc_name: "",
                                                ref_1: "",
                                            },
                                            newOrderItems
                                        )
                                    );
                                }
                            });

                            const newOrderItem = {
                                ...orderitem,
                                qty,
                                sub_total: orderitem?.unit_price * qty,
                            };
                            newOrderItems[index] = newOrderItem;
                            applied += qty;
                            remaining -= applied;
                            latestOrderItem = newOrderItem;

                            newOrderItems = [...newOrderItems, ...splitedOrderItems];
                        }
                    }
                });

                // Check if quantity requirement is met
                let reachQty = false;
                if (promo?.criteria_payment_name) {
                    if (applied >= parseInt(promo?.criteria_payment_name)) {
                        reachQty = true;
                    }
                }

                if (reachQty) {
                    let freeItems = getFreeItems(promo, latestOrderItem, newOrderItems);
                    if (freeItems?.length > 0) {
                        newOrderItems = newOrderItems?.map((item) => {
                            if (
                                same(item?.parent_sno, item?.s_no) &&
                                same(item?.s_no, latestOrderItem?.s_no)
                            ) {
                                return {
                                    ...item,
                                    disc_name: promo?.promo_name,
                                };
                            } else {
                                return item;
                            }
                        });

                        if (isSpecialPricePromo) {
                            amount += Math.abs(
                                freeItems?.reduce((acc, item) => acc + item?.sub_total, 0)
                            );
                        }

                        newOrderItems = [...newOrderItems, ...freeItems];
                    }
                }
            }
        }
    }

    return { orderItems: newOrderItems, applied, amount };
};

/**
 * Processes free item by quantity promo and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object. 
 * @returns {any[]} The array of new order items.
 */
const processFreeItemByQuantityPromo = (promo, orderItems, orderItem) => {
    let newOrderItems = [...orderItems];

    let applied = 0;

    let freeItems = [];
    if (isPromoApplicable(promo, orderItem)) {
        // meet quantity limit
        if (orderItem?.qty >= promo?.criteria_spldisc_qty_limit) {
            let tempFreeItems = getFreeItems(promo, orderItem, newOrderItems);
            if (tempFreeItems?.length > 0) {
                newOrderItems = newOrderItems?.filter((orderitem) =>
                    same(orderitem?.parent_sno, orderItem?.s_no)
                        ? notFreeItem(orderitem, promo?.criteria_type)
                        : true
                );
                tempFreeItems = tempFreeItems?.map((freeitem) => ({
                    ...freeitem,
                    qty: Math.floor(orderItem?.qty / promo?.criteria_spldisc_qty_limit),
                }));
                freeItems = [...freeItems, ...tempFreeItems];
                newOrderItems = newOrderItems?.map((item) => {
                    if (
                        same(item?.parent_sno, item?.s_no) &&
                        same(item?.s_no, orderItem?.s_no)
                    ) {
                        return {
                            ...item,
                            disc_name: promo?.promo_name,
                            ref_1: orderItem?.s_no,
                        };
                    } else {
                        return item;
                    }
                });
            }
        } else {
            newOrderItems = resetSetPromo(promo, newOrderItems, orderItem);
        }
    }
    newOrderItems = [...newOrderItems, ...freeItems];

    applied = applied + freeItems?.reduce((acc, item) => acc + item?.qty, 0);

    return { orderItems: newOrderItems, applied };
};

/**
 * Get free items based on promo configuration.
 * @param {any} promo - The promo object.
 * @param {any} orderItem - The order item object.
 * @param {any[]} orderItems - The array of order items.
 * @param {string} [item_no] - Optional item number.
 * @returns {any[]} Array of free items to add.
 */
export const getFreeItems = (promo, orderItem, orderItems, item_no) => {
    const { orderSeq } = useOrder();

    const result = [];

    if (isPromoApplicable(promo, orderItem)) {
        // auto promo items inserted
        const isFreeItemPromo = same(promo?.criteria_type, PROMO_TYPE.FREE_ITEM);
        const isSpecialPriceItemPromo = same(
            promo?.criteria_type,
            PROMO_TYPE.SPECIAL_PRICE
        );
        const isSpecialDiscountWithQuantityPromo = same(
            promo?.criteria_type,
            PROMO_TYPE.SPECIAL_DISCOUNT_WITH_QUANTITY
        );

        // manual promo items inserted
        const isFreeItemWithLimitPromo = same(
            promo?.criteria_type,
            PROMO_TYPE.FREE_ITEM_WITH_LIMIT
        );
        const isFreeItemByValuePromo = same(
            promo?.criteria_type,
            PROMO_TYPE.FREE_ITEM_BY_VALUE
        );

        let i = 0;

        let freeItems = [];

        if (isSpecialPriceItemPromo || isSpecialDiscountWithQuantityPromo) {
            freeItems = [promo?.criteria_promo_item_no]?.map((item) => ({
                item_no: item,
            }));
        } else {
            freeItems = (promo?.creteria_item_dtls || [])?.filter((item) =>
                isFreeItemPromo ? true : same(item?.item_no, item_no)
            );
        }

        freeItems?.forEach((freeItem, index) => {
            const item =
                useCache()?.items.find((item) => same(item?.item_no, freeItem?.item_no)) ||
                null;

            if (item && item?.selling_uom_dtls) {
                const qty = isFreeItemByValuePromo
                    ? 1
                    : orderItem?.qty * (isFreeItemPromo ? freeItem?.qty : 1);
                const unit_price = isSpecialPriceItemPromo
                    ? promo?.criteria_spl_price -
                    orderItems
                        ?.filter((orderitem) => orderitem?.parent_sno === orderItem?.s_no)
                        ?.map((orderitem) => parseFloat(orderitem?.sub_total))
                        .reduce((acc, val) => acc + val, 0) /
                    qty
                    : isSpecialDiscountWithQuantityPromo
                        ? getPriceByServiceType(getMenuItemByItemNo(item?.item_no))
                        : 0;
                const sub_total = unit_price * qty;
                // only add free item if item is not 0, and is alacarte
                if (qty && !item?.itemmaster_menutype) {
                    i++;
                    const s_no =
                        orderItems
                            ?.map((item) => item?.s_no)
                            .reduce((max, val) => Math.max(max, val), 0) + i;
                    const parent_sno =
                        isFreeItemPromo ||
                            isSpecialPriceItemPromo ||
                            isSpecialDiscountWithQuantityPromo ||
                            isFreeItemWithLimitPromo ||
                            isFreeItemByValuePromo
                            ? orderItem?.s_no
                            : orderItems
                                ?.map((item) => item?.parent_sno)
                                .reduce(
                                    (max, val) => Math.max(max, val),
                                    FREE_ITEM_STARTING_DS_NO
                                ) + i;

                    let from = 0;
                    switch (promo?.criteria_type) {
                        case PROMO_TYPE.FREE_ITEM:
                        case PROMO_TYPE.FREE_ITEM_WITH_LIMIT:
                            from = FREE_ITEM_STARTING_DS_NO;
                            break;
                        case PROMO_TYPE.FREE_ITEM_BY_VALUE:
                            from = FREE_ITEM_BY_VALUE_STARTING_DS_NO;
                            break;
                        case PROMO_TYPE.SPECIAL_PRICE:
                            from = SPECIAL_PRICE_ITEM_STARTING_DS_NO;
                            break;
                        case PROMO_TYPE.SPECIAL_DISCOUNT_WITH_QUANTITY:
                            from = SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO;
                            break;
                    }
                    let ds_no;
                    const dsNos = (orderItems || [])
                        .filter(
                            (item) =>
                                same(item?.parent_sno, orderItem?.s_no) && item?.ds_no >= from
                        )
                        .map((item) => item.ds_no);
                    if (dsNos.length === 0) {
                        ds_no = from;
                    } else {
                        ds_no = Math.max(...dsNos) + 1;
                    }

                    const selling_uom_dtls = item?.selling_uom_dtls[0];

                    let freeItemObj = {
                        s_no,
                        parent_sno,
                        ds_no,
                        seat_no: 1,
                        category_code: item?.category_code,
                        item_no: item?.item_no,
                        item_name: item?.item_name,
                        item_desc: item?.item_desc,
                        remarks: "",
                        qty,
                        uom: selling_uom_dtls.uom,
                        uom_cf: selling_uom_dtls.uom_cf,
                        unit_price,
                        disc_type: "N",
                        disc_name: promo?.promo_name,
                        disc_value: 0,
                        disc_amt: 0,
                        sub_total,
                        pro_disc_amt: 0,
                        svc_amt: "0.000000",
                        is_apply_svc: item?.is_apply_svc,
                        tax_amt: "0.000000",
                        tax_rate: item?.tax_value,
                        tax_value: item?.tax_value,
                        is_absorbtax: isAbsorbTax(item),
                        take_away_item: "N",
                        order_seq: orderSeq,
                        order_seq_type: "New",
                        order_datetime: getNowInAPIFormat(useCache()?.date),
                        print_flag: "N",
                        item_kds_ready_status: "N",
                        item_kds_ready_datetime: getNowInAPIFormat(useCache()?.date),
                        item_kds_serve_status: "N",
                        item_kds_serve_datetime: getNowInAPIFormat(useCache()?.date),
                        override_f: 0,
                        is_addon_enable: item?.is_addon_enable,
                        add_on_name: item?.add_on_name,
                        menu_type: "",
                        modifier_name: "",
                        ref_1: orderItem?.s_no,
                        ref_2: "",
                        ref_3: "",
                        ref_4: "",
                    };

                    result.push(addTax(freeItemObj));
                }
            }
        });
    }

    return result;
};


/**
 * Processes item discount promo and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @param {number} limit - The limit of the promo.
 * @returns {object} Object with orderItems, applied, and amount.
 */
const processItemDiscountPromo = (promo, orderItems, orderItem, limit) => {
    let newOrderItems = clone(orderItems);

    let applied = 0;
    let amount = 0;

    let splitingOccured = false;
    let remaining = limit ?? Infinity;
    const splitedOrderItems = [];
    const changedOrderItems = [];

    newOrderItems?.forEach((orderitem, index) => {
        const changesNeedOrderItem = changedOrderItems?.find((item) =>
            same(item?.s_no, orderitem?.s_no)
        );
        if (changesNeedOrderItem) {
            newOrderItems[index] = changesNeedOrderItem;
            orderitem = changesNeedOrderItem; // Update local reference too
        }

        if (
            (limit ? true : same(orderItem?.s_no, orderitem?.s_no)) &&
            isPromoApplicable(promo, orderitem) &&
            !splitingOccured &&
            remaining > 0
        ) {
            let disc_type = promo?.criteria_disc_type;
            let disc_value = promo?.criteria_disc_value;

            let apply = false;

            // item discount by each item in value
            if (same(disc_type, "E")) {
                const found = promo?.creteria_item_dtls?.find(
                    (creteriaitemdtl) =>
                        same(creteriaitemdtl?.category_code, orderitem?.category_code) &&
                        same(creteriaitemdtl?.item_no, orderitem?.item_no)
                );

                if (found) {
                    apply = true;
                    disc_type = "A";
                    disc_value = found?.qty;
                }
            }
            // ✅ FIXED: was same(disc_value, "F") — should be same(disc_type, "F")
            // item discount by each item in percentage
            else if (same(disc_type, "F")) {
                const found = promo?.creteria_item_dtls?.find(
                    (creteriaitemdtl) =>
                        same(creteriaitemdtl?.category_code, orderitem?.category_code) &&
                        same(creteriaitemdtl?.item_no, orderitem?.item_no)
                );

                if (found) {
                    apply = true;
                    disc_type = "P";
                    disc_value = found?.qty;
                }
            } else {
                apply = true;
            }

            if (apply) {
                // qty or remaining is more than order item qty (apply all)
                if (orderitem?.qty <= remaining) {
                    remaining -= orderitem?.qty;
                    const discountedItem = calcOrderItemDiscount(
                        orderitem,
                        {
                            disc_type,
                            disc_name: promo?.promo_name,
                            disc_value,
                        },
                        newOrderItems
                    );
                    newOrderItems[index] = discountedItem;
                    applied += discountedItem?.qty;
                    amount += parseFloat(discountedItem?.disc_amt);
                }
                // qty or remaining is less than order item qty (apply partial and split the non-applied)
                else {
                    splitingOccured = true;

                    const qty = remaining;
                    remaining = 0;

                    const splitSNo =
                        Math.max(...newOrderItems.map((item) => item?.s_no)) + 1;
                    const splitQty = orderitem?.qty - qty;

                    newOrderItems?.forEach((_orderitem) => {
                        if (same(_orderitem?.parent_sno, orderitem?.parent_sno)) {
                            let qty = _orderitem?.qty;
                            if (_orderitem?.ds_no === 1) {
                                qty = splitQty;
                            } else {
                                changedOrderItems.push(
                                    calcOrderItemSubtotal(
                                        { ..._orderitem, qty: _orderitem?.qty - splitQty },
                                        newOrderItems
                                    )
                                );
                                qty = (qty / orderitem?.qty) * splitQty;
                            }
                            splitedOrderItems.push(
                                calcOrderItemSubtotal(
                                    {
                                        ..._orderitem,
                                        s_no: splitSNo - 1 + _orderitem?.s_no,
                                        parent_sno: splitSNo,
                                        qty,
                                    },
                                    newOrderItems
                                )
                            );
                        }
                    });

                    const discountedItem = calcOrderItemDiscount(
                        {
                            ...orderitem,
                            qty,
                            sub_total: orderitem?.unit_price * qty,
                        },
                        {
                            disc_type,
                            disc_name: promo?.promo_name,
                            disc_value,
                        },
                        newOrderItems
                    );
                    newOrderItems[index] = discountedItem;

                    applied += qty;
                    amount += parseFloat(discountedItem?.disc_amt);
                }
            }
        }
    });

    newOrderItems = [...newOrderItems, ...splitedOrderItems];

    return { orderItems: newOrderItems, applied, amount };
};
/**
 * Processes lowest price discount promo and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
const processLowestPriceDiscountPromo = (promo, orderItems, orderItem, limit) => {
    const { setLastSNo, setSelectedOrderItemSNo } = useOrder();

    let newOrderItems = [...orderItems];

    let applied = 0;
    let amount = 0;

    let remaining = limit ?? Infinity;

    // set deal criteria
    if (same(promo?.by_item, "SD")) {
        const { sets, _insert, _delete, _orderItems } = getPromoSets(
            promo,
            newOrderItems,
            orderItem,
            limit
        );
        if (_insert) {
            newOrderItems = _orderItems?.map((orderitem) => ({ ...orderitem }));
            sets?.forEach((set) => {
                if (remaining > 0) {
                    const lowestPriceOrderItem = set
                        // filter out the items that are in category excluded
                        ?.filter(
                            (item) =>
                                !contains(promo?.creteria_item_dtls || [], item?.category_code)
                        )
                        ?.sort((a, b) => {
                            const getSum = (item) =>
                                newOrderItems
                                    ?.filter((i) => same(i?.parent_sno, item?.s_no))
                                    ?.reduce((acc, i) => acc + (i?.unit_price || 0), 0);
                            return getSum(a) - getSum(b);
                        })[0];

                    if (lowestPriceOrderItem) {
                        // split order item out if the lowest price item has more than 1 quantity
                        if (lowestPriceOrderItem?.qty > 1) {
                            let s_no =
                                Math.max(...newOrderItems.map((item) => item?.s_no)) + 1;
                            setLastSNo(s_no);

                            newOrderItems = newOrderItems?.map((item) => {
                                if (same(item?.parent_sno, lowestPriceOrderItem?.s_no)) {
                                    return calcOrderItemSubtotal(
                                        {
                                            ...item,
                                            qty: 1,
                                        },
                                        newOrderItems
                                    );
                                } else {
                                    return item;
                                }
                            });

                            const splitedOrderItem = calcOrderItemSubtotal(
                                {
                                    ...lowestPriceOrderItem,
                                    s_no,
                                    parent_sno: s_no,
                                    qty: lowestPriceOrderItem?.qty - 1,
                                },
                                newOrderItems
                            );
                            newOrderItems.push(splitedOrderItem);
                            set.push(splitedOrderItem);
                            setSelectedOrderItemSNo(s_no);
                        }

                        newOrderItems = newOrderItems?.map((item) => {
                            if (same(item?.parent_sno, lowestPriceOrderItem?.parent_sno)) {
                                applied += item?.qty;
                                amount +=
                                    parseFloat(lowestPriceOrderItem?.unit_price) *
                                    lowestPriceOrderItem?.qty;
                                return calcOrderItemDiscount(
                                    {
                                        ...item,
                                        disc_name: promo?.promo_name,
                                        ref_1: orderItem?.s_no,
                                    },
                                    {
                                        disc_type: promo?.criteria_disc_type,
                                        disc_name: promo?.promo_name,
                                        disc_value: promo?.criteria_disc_value,
                                    },
                                    newOrderItems
                                );
                            } else if (
                                contains(
                                    set?.map((item) => item?.s_no),
                                    item?.s_no
                                )
                            ) {
                                return {
                                    ...item,
                                    disc_name: promo?.promo_name,
                                    ref_1: orderItem?.s_no,
                                };
                            } else {
                                return item;
                            }
                        });

                        remaining -= applied;
                    }
                }
            });
        } else if (_delete) {
            newOrderItems = resetSetPromo(promo, newOrderItems, orderItem);
        }
    }

    // there is no selected categories / items criteria currently

    return { orderItems: newOrderItems, applied, amount };
};


/**
 * Processes free item by limit promo and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
const processFreeItemByLimitPromo = (promo, orderItems, orderItem) => {
    let newOrderItems = [...orderItems];
    let processOrderItem = null;

    if (isPromoApplicable(promo, orderItem)) {
        // set deal criteria
        if (same(promo?.by_item, "SD")) {
            const { sets, _insert, _delete, _orderItems } = getPromoSets(
                promo,
                newOrderItems,
                orderItem
            );
            if (_insert) {
                newOrderItems = _orderItems?.map((orderitem) => ({ ...orderitem }));
                for (const set of sets) {
                    const orderItem = set[set.length - 1];
                    processOrderItem = orderItem;
                    break;
                }
            } else if (_delete) {
                newOrderItems = resetSetPromo(promo, newOrderItems, orderItem);
            }
        }

        // selected categories / items criteria
        else {
            const freeItemDefs = promo?.creteria_item_dtls || [];
            const triggerItemDefs = Array.isArray(promo?.item_dtls) && promo.item_dtls.length > 0
                ? promo.item_dtls
                : null;

            const isIncomingAFreeItem = freeItemDefs.some((f) =>
                same(f?.item_no, orderItem?.item_no)
            );

            if (isIncomingAFreeItem) {
                const existingFreeByValueCount = newOrderItems.filter(i =>
                    i?.ds_no >= FREE_ITEM_BY_VALUE_STARTING_DS_NO &&
                    i?.ds_no < SPECIAL_PRICE_ITEM_STARTING_DS_NO
                ).length;
                const assignedDsNo = FREE_ITEM_BY_VALUE_STARTING_DS_NO + existingFreeByValueCount;

                // ✅ Find the trigger item — the qualifying parent item that triggered this promo
                const group = getFreeItemByValueGroup(promo, newOrderItems, newOrderItems.find(i =>
                    isPromoApplicable(promo, i) && same(i.s_no, i.parent_sno)
                ) || orderItem);
                const triggerSNo = group?.leadOrderItem?.s_no ?? orderItem?.parent_sno;

                console.log(`🎁 Free-by-value item stamp: ${orderItem.item_no} | parent_sno: ${triggerSNo} | ds_no: ${assignedDsNo}`);

                newOrderItems = newOrderItems.map(i =>
                    same(i?.s_no, orderItem?.s_no)
                        ? {
                            ...i,
                            ds_no: assignedDsNo,
                            parent_sno: triggerSNo,  
                            ref_1: promo?.promo_name || '',
                        }
                        : i
                );

                return {
                    processOrderItem: null,
                    orderItems: newOrderItems,
                    applied: 1,
                };
            }

            // existing: find first parent item that meets subtotal threshold
            for (const orderitem of newOrderItems) {
                if (
                    same(orderitem?.parent_sno, orderitem?.s_no) &&
                    orderItems
                        ?.filter((item) => same(item?.parent_sno, orderItem?.s_no))
                        ?.map((item) => item?.sub_total)
                        ?.reduce((acc, val) => acc + val, 0) >= promo?.receipt_terms_amount
                ) {
                    processOrderItem = orderitem;
                    break;
                }
            }
        }
    }

    return {
        processOrderItem,
        orderItems: newOrderItems,
        applied: parseFloat(processOrderItem?.qty) || 0,
    };
};
/**
 * Get order items that form the "group" for free item by value: all applicable non-accumulated lines (SC/SI/AI) so their subtotals are summed.
 * Free item by value is not applicable for set deal (SD); returns null when by_item is SD.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {object|null} { groupItems, groupParentSNos, leadOrderItem } or null if orderItem not in any group.
 */
const getFreeItemByValueGroup = (promo, orderItems, orderItem) => {
    if (same(promo?.by_item, "SD")) return null;

    const orderItemParentSNo = same(orderItem?.parent_sno, orderItem?.s_no)
        ? orderItem?.s_no
        : orderItem?.parent_sno;

    // Group all applicable parent lines (non-accumulated) so sum of subtotals is used
    const applicableParents = orderItems?.filter(
        (item) =>
            same(item?.parent_sno, item?.s_no) &&
            isPromoApplicable(promo, item) &&
            (same(item?.disc_name, "None") ||
                same(
                    findPromoByName(item?.disc_name)?.criteria_type,
                    PROMO_TYPE.TOTAL_DISCOUNT
                ))
    );
    const groupParentSNos = applicableParents?.map((item) => item?.s_no) ?? [];
    if (
        !contains(groupParentSNos, orderItem?.s_no) &&
        !contains(groupParentSNos, orderItemParentSNo)
    )
        return null;
    const groupItems = orderItems?.filter(
        (item) =>
            contains(groupParentSNos, item?.s_no) ||
            contains(groupParentSNos, item?.parent_sno)
    );
    return {
        groupItems,
        groupParentSNos,
        leadOrderItem: applicableParents?.[applicableParents.length - 1],
    };
};

/**
 * Processes free item by value promo and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any} The result object.
 */
const processFreeItemByValuePromo = (promo, orderItems, orderItem) => {
    let newOrderItems = [...orderItems];
    let processOrderItem = null;

    const freeItemDefs = promo?.creteria_item_dtls || [];
    const isIncomingAFreeItem = freeItemDefs.some(f => same(f?.item_no, orderItem?.item_no));

    if (isIncomingAFreeItem) {
        const existingFreeByValueCount = newOrderItems.filter(i =>
            i?.ds_no >= FREE_ITEM_BY_VALUE_STARTING_DS_NO &&
            i?.ds_no < SPECIAL_PRICE_ITEM_STARTING_DS_NO
        ).length;
        const assignedDsNo = FREE_ITEM_BY_VALUE_STARTING_DS_NO + existingFreeByValueCount;

        // ✅ Use reverse().find() to get MOST RECENTLY added trigger
        // This ensures 2nd promo set free items point to s_no:4, not s_no:1
        const triggerItem = [...newOrderItems]
            .reverse()
            .find(i =>
                same(i?.s_no, i?.parent_sno) &&
                parseInt(i?.ds_no) < FREE_ITEM_BY_VALUE_STARTING_DS_NO &&
                !same(i?.s_no, orderItem?.s_no) &&  // ✅ exclude the free item itself
                isPromoApplicable(promo, i)
            );
        const triggerSNo = triggerItem?.s_no ?? orderItem?.s_no;

        console.log(`🎁 Free-by-value stamp: ${orderItem.item_no} | parent_sno: ${triggerSNo} | ds_no: ${assignedDsNo}`);

        newOrderItems = newOrderItems.map(i =>
            same(i?.s_no, orderItem?.s_no)
                ? {
                    ...i,
                    ds_no: assignedDsNo,
                    parent_sno: triggerSNo,  // ✅ was missing
                    ref_1: promo?.promo_name || '',
                }
                : i
        );

        return { processOrderItem: null, orderItems: newOrderItems, applied: 1 };
    }

    // trigger-item logic — unchanged
    if (isPromoApplicable(promo, orderItem)) {
        const group = getFreeItemByValueGroup(promo, newOrderItems, orderItem);
        if (group) {
            const { groupItems, leadOrderItem } = group;
            const sub_total = groupItems?.reduce((acc, item) => acc + (item?.sub_total ?? 0), 0) ?? 0;
            const insertedFreeItemsQty = getInsertedFreeItems(promo, groupItems)
                ?.reduce((acc, item) => acc + (item?.qty ?? 0), 0) ?? 0;
            const maxFreeItemQty = promo?.receipt_terms_amount > 0
                ? Math.floor(sub_total / promo.receipt_terms_amount) * (promo?.criteria_free_item_qty_limit ?? 0)
                : 0;

            if (sub_total >= promo?.receipt_terms_amount) {
                if (same(promo?.receipt_amt_check_by, "O") && insertedFreeItemsQty <= 0) {
                    processOrderItem = leadOrderItem;
                } else if (same(promo?.receipt_amt_check_by, "E")) {
                    if (insertedFreeItemsQty < maxFreeItemQty) {
                        processOrderItem = leadOrderItem;
                    } else if (insertedFreeItemsQty > maxFreeItemQty) {
                        const itemsWithRef1 = groupItems?.filter(
                            item => same(item?.disc_name, promo?.promo_name) && item?.ref_1
                        );
                        itemsWithRef1?.forEach(item => {
                            newOrderItems = resetSetPromo(promo, newOrderItems, item);
                        });
                    }
                }
            } else {
                const itemsWithRef1 = groupItems?.filter(
                    item => same(item?.disc_name, promo?.promo_name) && item?.ref_1
                );
                itemsWithRef1?.forEach(item => {
                    newOrderItems = resetSetPromo(promo, newOrderItems, item);
                });
            }
        }
    }

    return {
        processOrderItem,
        orderItems: newOrderItems,
        applied: parseFloat(processOrderItem?.qty) || 0,
    };
};
/**
 * Insert discount name for all parent items in the set for manual free item promo and return new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
export const insertDiscountName = (promo, orderItems, orderItem) => {
    let newOrderItems = [...orderItems];

    if (
        getInsertedFreeItems(
            promo,
            newOrderItems?.filter((item) => same(item?.parent_sno, orderItem?.s_no))
        )?.length > 0
    ) {
        if (same(promo?.by_item, "SD")) {
            const { sets, _orderItems } = getPromoSets(
                promo,
                newOrderItems,
                orderItem
            );
            if (sets?.length > 0) {
                newOrderItems = _orderItems?.map((orderitem) => ({ ...orderitem }));
            }
            let selectedSet = null;
            for (const set of sets) {
                if (
                    contains(
                        set?.map((set) => set?.s_no),
                        orderItem?.s_no
                    )
                ) {
                    selectedSet = set;
                    break;
                }
            }
            if (selectedSet) {
                newOrderItems = newOrderItems?.map((orderitem) => {
                    if (
                        contains(
                            selectedSet?.flat()?.map((set) => set?.s_no),
                            orderitem?.s_no
                        )
                    ) {
                        return {
                            ...orderitem,
                            disc_name: promo?.promo_name,
                            ref_1: orderItem?.s_no,
                        };
                    } else {
                        return orderitem;
                    }
                });
            }
        }
        else {
            newOrderItems = newOrderItems?.map((orderitem) => {
                if (same(orderitem?.s_no, orderItem?.s_no)) {
                    return {
                        ...orderitem,
                        disc_name: promo?.promo_name,
                        ref_1: orderItem?.s_no,
                    };
                } else {
                    return orderitem;
                }
            });
        }
    }

    return newOrderItems;
};

/**
 * Reset set deal promo in the set and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
const resetSetPromo = (promo, orderItems, orderItem) => {
    let newOrderItems = [...orderItems];

    newOrderItems = newOrderItems
        ?.filter((orderitem) =>
            orderitem?.ref_1 && same(orderItem?.ref_1, orderitem?.ref_1)
                ? notFreeItem(orderitem, promo)
                : true
        )
        ?.map((orderitem) => {
            if (orderitem?.ref_1 && same(orderItem?.ref_1, orderitem?.ref_1)) {
                return calcOrderItemDiscount(
                    {
                        ...orderitem,
                        disc_name: "None",
                        ref_1: "",
                        ref_2: "",
                    },
                    null,
                    newOrderItems
                );
            } else {
                return orderitem;
            }
        });

    return newOrderItems;
};

/**
 * Find promo by promo name.
 * @param {string} name - The name of the promo.
 * @returns {any} The promo object.
 */
const findPromoByName = (name) => {
    // ✅ Add safety check
    const promos = Array.isArray(useCache()?.promos) ? useCache()?.promos : [];
    return promos.find((promo) => same(promo?.promo_name, name));
};
/**
 * Check if delivery partners are integrated.
 * @returns {boolean} True if delivery partners are integrated, false otherwise.
 */
export const isDeliveryPartnersIntegrated = () =>
    (bool(getSetting("MORE", "DELIVERY", "GRABFOOD_INTEGRATION")) &&
        bool(getSetting("MORE", "DELIVERY", "GRABFOOD"))) ||
    (bool(getSetting("MORE", "DELIVERY", "FOODPANDA_INTEGRATION")) &&
        bool(getSetting("MORE", "DELIVERY", "FOODPANDA"))) ||
    (bool(getSetting("MORE", "DELIVERY", "DELIVEROO_INTEGRATION")) &&
        bool(getSetting("MORE", "DELIVERY", "DELIVEROO"))) ||
    (bool(getSetting("MORE", "DELIVERY", "ALIPAY_INTEGRATION")) &&
        bool(getSetting("MORE", "DELIVERY", "ALIPAY")));

/**
 * Get system setting value by group name and param id.
 * @param {string} group_name - The group name.
 * @param {string} param_id - The param id.
 * @returns {string} The system setting value.
 */
export const getSysSetting = (group_name, param_id) => {
    const groups = (useCache()?.systemSettings || [])
        .flatMap(item => item?.output || []);

    return (
        groups.find(item => same(item?.group_name, group_name))
            ?.setting_group_dtls || []
    ).find(item => same(item?.sys_param_id, param_id))?.sys_param_value;
};

/**
 * Get order items diff.
 * @returns {any[]} The array of order items diff.
 */
export const getOrderItemsDiff = () => {
    const { oriOrder, order: newOrder } = useOrder();

    const orderItems = [];

    (oriOrder?.sales_dtls || [])?.forEach((oriorderitem) => {
        const existedItem = newOrder?.sales_dtls?.find(
            (orderitem) =>
                same(orderitem?.s_no, oriorderitem?.s_no) &&
                same(orderitem?.item_no, oriorderitem?.item_no)
        );
        if (!existedItem) {
            orderItems.push({ ...oriorderitem, qty: -oriorderitem?.qty });
        }
    });

    if (oriOrder) {
        (newOrder?.sales_dtls || [])?.forEach((orderitem) => {
            const existedItem = oriOrder?.sales_dtls?.find(
                (oriorderitem) =>
                    same(oriorderitem?.s_no, orderitem?.s_no) &&
                    same(oriorderitem?.item_no, orderitem?.item_no)
            );
            if (existedItem) {
                if (orderitem?.qty !== existedItem?.qty) {
                    const qty = orderitem?.qty - existedItem?.qty;
                    orderItems.push({ ...existedItem, qty });
                }
            } else {
                orderItems.push({ ...orderitem, qty: orderitem?.qty });
            }
        });
    }

    const cancelledOrderItems = orderItems?.filter((item) => item?.qty <= 0);
    const additionalOrderItems = orderItems?.filter((item) => item?.qty > 0);

    return { cancelledOrderItems, additionalOrderItems };
};

/**
 * Get new order.
 * @param {any} data - The data.
 * @returns {any} The new order.
 */
export const getNewOrder = (data) => {
    const { date, store } = useCache();

    const service_type = data?.service_type || "E";

    const service_type_info = SERVICE_TYPES?.find((item) =>
        same(item?.service_type, service_type)
    )?.service_type_info;

    const table_no = data?.table_no || "";

    delete data?.service_type;
    delete data?.service_type_info;
    delete data?.table_no;

    const newOrder = calcOrderAmt({
        sales_no: "",
        doc_date: getNowInAPIFormat(date),
        customer_code: "",
        cust_addr_s_no: "",
        service_type,
        service_type_info,
        order_status_id: "N",
        order_status_desc: "New",
        kitchen_status_id: "P",
        kitchen_status_desc: "In Progress",
        sub_total: "0.00",
        disc_type: "N",
        disc_name: "None",
        disc_value: 0,
        total_disc: "0.00",
        total_svc: "0.00",
        total_tax: "0.00",
        round_adj_amt: "0.00",
        absorb_tax: store?.is_absorbtax ? "Y" : "N",
        absorb_tax_info: store?.is_absorbtax ? "Absorb Tax" : "Not Absorb Tax",
        net_amt: "0.00",
        tips_amt: "0.00",
        total_tender_amt: "0.00",
        change_amt: "0.00",
        no_of_pax: 1,
        table_no,
        remarks: "",
        del_driver: "",
        ref_1: "",
        ref_2: "",
        ref_3: "",
        ref_4: "",
        ref_5: "",
        sales_dtls: [],
        sales_service_dtls: [],
        sales_payment_dtls: [],
        sales_other_info: "",
        table_transfer: "N",
        table_transfer_sno: "",
        ...data,
    });

    return newOrder;
};

/**
 * Get new order.
 * @param {any} data - The data.
 * @returns {any} The new order.
 */


export const getNewOrderSOK = (data) => {
    const { date, store, svcs: cacheSvcs } = useCache();
    const svcs = cacheSvcs || window.apiManager?.loadedData?.get('svcs');
    const service_type = localStorage.getItem("orderType");

    const service_type_info = SERVICE_TYPES?.find((item) =>
        same(item?.service_type, service_type)
    )?.service_type_info;
    const isTakeaway = service_type === "T";
    const currentDateTime = getNowInAPIFormat(date);
    const customer_code = data?.customer_code || "";
    const svcConfig = Array.isArray(svcs)
        ? svcs.find(s => s.service_type === service_type)
        : null;
    const svcRate = Number(svcConfig?.service_value ?? 0);
    const svcBy = svcConfig?.service_by ?? 'P';
    const isApplySvc = svcRate > 0 ? 1 : 0;

    // ✅ FIXED: Read absorb tax from register settings with validation
    // Falls back to store.is_absorbtax if register settings are overwritten by printer data
    const getAbsorbTax = () => {
        try {
            const raw = localStorage.getItem('storeRegisterSettings');
            const parsed = JSON.parse(raw);
            const ordering = Array.isArray(parsed)
                ? parsed?.[0]?.["GENERAL SETTINGS"]
                    ?.find(s => s["ORDERING"])?.["ORDERING"]?.[0]
                : null;
            // Validate it's actually register settings, not printer data
            if (ordering?.QUICK_SERVICE_TAX_ABSORB !== undefined) {
                const flagMap = {
                    "Q": ordering?.QUICK_SERVICE_TAX_ABSORB === "1",
                    "D": ordering?.DINE_IN_TAX_ABSORB === "1",
                    "T": ordering?.TAKE_AWAY_TAX_ABSORB === "1",
                    "L": ordering?.DELIVERY_TAX_ABSORB === "1",
                };
                return flagMap[service_type] ? "Y" : "N";
            }
        } catch { }
        // Fallback to store.is_absorbtax
        return store?.is_absorbtax ? "Y" : "N";
    };
    const absorbTax = getAbsorbTax();

    const table_no = data?.table_no || "";
    delete data?.service_type;
    delete data?.service_type_info;
    delete data?.table_no;

    const newOrder = calcOrderAmt({
        sales_no: "",
        doc_date: currentDateTime,
        customer_code,
        cust_addr_s_no: "",
        service_type,
        service_type_info,
        order_status_id: "N",
        order_status_desc: "New",
        kitchen_status_id: "P",
        kitchen_status_desc: "In Progress",
        sub_total: 0,
        disc_type: "N",
        disc_name: "None",
        disc_value: 0,
        total_disc: 0,
        total_svc: 0,
        total_tax: 0,
        round_adj_amt: 0,
        absorb_tax: absorbTax,
        absorb_tax_info: absorbTax === "Y" ? "Absorb Tax" : "Not Absorb Tax",
        net_amt: 0,
        tips_amt: 0,
        total_tender_amt: 0,
        change_amt: 0,
        no_of_pax: 1,
        table_no,
        remarks: "",
        del_driver: "",
        ref_1: "",
        ref_2: "",
        ref_3: "",
        ref_4: "",
        ref_5: "",
        sales_dtls: [],
        sales_service_dtls: [],
        sales_payment_dtls: [],
        sales_other_info: "",
        table_transfer: "N",
        table_transfer_sno: "",
        order_from: "SOK",
        mode_of_order: service_type_info || (isTakeaway ? "Takeaway" : "Dine In"),
        order_mode: "PayFirst",
        qr_type: "Static",
        store_name: store?.store_name || "",
        comp_code: store?.comp_code || "01",
        register_name: store?.register_name || "POS01",
        shift_code: store?.shift_code || "SHIFT1",
        c_date: currentDateTime,
        m_date: currentDateTime,
        c_userid: "WEBORDER",
        m_userid: "WEBORDER",
        svc_rate: svcRate,
        svc_by: svcBy,
        is_apply_svc: isApplySvc,
        ...data,
    });
    return newOrder;
};



/**
 * Get last s_no.
 * @param {any[]} orderItems - The array of order items.
 * @returns {number} The last s_no.
 */
export const getLastSNo = (orderItems) => {
    return Math.max(...(orderItems || []).map((item) => parseInt(item?.s_no)), 0);
};

/**
 * Convert order items to parent-children format.
 * @param {any[]} orderItems - The array of order items.
 * @returns {any[]} The array of parent-children order items.
 */
export const formatOrderItemsToParentChild = (orderItems) => {
    let newOrderItems = [];
    (orderItems || [])?.forEach((item) => {
        const parentIndex = newOrderItems.findIndex(
            (_item) => _item.s_no === item.parent_sno
        );
        if (parentIndex >= 0) {
            newOrderItems[parentIndex]["childItems"].push(item);
        } else {
            newOrderItems.push({ ...item, childItems: [] });
        }
    });
    return newOrderItems;
};

/**
 * Reset rounding.
 * @param {any} order - The order.
 * @returns {any} The new order.
 */
export const resetRounding = (order) => {
    return {
        ...order,
        round_adj_amt: "0.00",
        net_amt: (
            parseFloat(order?.net_amt) - parseFloat(order?.round_adj_amt)
        ).toFixed(2),
    };
};

/**
 * Check if item needs mandatory remarks.
 * @param {any} item - The item.
 * @returns {boolean} True if item needs mandatory remarks, false otherwise.
 */
export const needMandatoryItemRemarks = (item) => {
    const { itemRemarks } = useCache();
    const remarksItemDetails = itemRemarks?.find((itemremark) =>
        same(itemremark?.item_no, item?.item_no)
    )?.remarks_item_details;
    if (remarksItemDetails && remarksItemDetails?.length > 0) {
        const found = remarksItemDetails?.find((remarkitemdetail) =>
            same(remarkitemdetail?.remarks_group_type, "S")
        );
        if (found) return true;
    }
    return false;
};

/**
 * Process take away charge.
 * @param {any[]} orderItems - The array of order items.
 * @returns {any[]} The array of take away order items.
 */
export const processTakeAwayCharge = (orderItems) => {
    let newOrderItems = [];
    (orderItems || [])?.forEach((item) => {
        if (
            bool(getSysSetting("System Settings", "enable_fixed_ta_charge")) &&
            item?.take_away_item
        ) {
            newOrderItems.push(item);
        }
    });
    return newOrderItems;
};

/**
 * Process total discount promo.
 * @param {any[]} orderItems - The array of order items.
 * @returns {any} The total discount promo.
 */
export const processTotalDiscountPromo = (orderItems) => {
    const promos = Array.isArray(useCache()?.promos) ? useCache()?.promos : [];

    let totalDiscountPromo = null;
    for (const promo of promos?.filter((promo) =>
        same(promo?.criteria_type, PROMO_TYPE.TOTAL_DISCOUNT)
    )) {
        const { sets, _insert, _orderItems } = getPromoSets(promo, orderItems);
        if (sets?.length > 0 && _insert) {
            totalDiscountPromo = promo;
            break;
        }
    }
    return totalDiscountPromo;
};

/**
 * Get now with login date.
 * @returns {dayjs.Dayjs} The now with login date.
 */
export const getNowWithLoginDate = () => {
    const { date } = useCache();
    return dayjs(getNowInAPIFormat(date), "YYYY/MM/DD HH:mm:ss");
};

/**
 * Get available service types.
 * @returns {any[]} The array of available service types.
 */
export const getAvailableServiceTypes = () => {
    return (SERVICE_TYPES || [])?.filter((item) => {
        switch (item?.service_type) {
            case "E":
                return bool(
                    getSetting("GENERAL SETTINGS", "ALLOWED SERVICES", "DINE_IN")
                );
            case "T":
                return bool(
                    getSetting("GENERAL SETTINGS", "ALLOWED SERVICES", "TAKE_AWAY")
                );
            case "D":
                return bool(
                    getSetting("GENERAL SETTINGS", "ALLOWED SERVICES", "DELIVERY")
                );
            case "Q":
                return bool(
                    getSetting("GENERAL SETTINGS", "ALLOWED SERVICES", "QUICK_SERVICES")
                );
        }
    });
};

/**
 * Get menu items.
 * @param {string} variant - The variant.
 * @param {any[]} menuItems - The menu items.
 * @param {boolean} all - True if all, false otherwise.
 * @param {any[]} rootCategory - The root category.
 * @param {any[]} selectedCategory - The selected category.
 */
export const getMenuItems = (variant, menuItems, all, rootCategory, selectedCategory) => {
    switch (variant) {
        case "category":
            if (all) {
                return availableNow(
                    (menuItems || [])
                        ?.flatMap((item) => item.category)
                        ?.filter((category) => !!category)
                );
            } else {
                return (
                    availableNow(
                        (menuItems || [])?.find(
                            (item) =>
                                item.root_category_code ===
                                rootCategory[rootCategory.length - 1]
                        )?.category
                    ) || []
                );
            }
        case "item":
            if (selectedCategory) {
                const menuItem = menuItems?.find(
                    (item) =>
                        item.root_category_code ===
                        selectedCategory[selectedCategory?.length - 1]
                );
                const subcategories = [];
                if (!all && Array.isArray(menuItem?.category)) {
                    (availableNow(menuItem.category) || [])?.forEach((item) => {
                        subcategories.push({ ...item, variant: "category" });
                    });
                }
                let result = clone(subcategories);
                if (all) {
                    result = result?.concat(
                        availableNow(
                            (menuItems || [])
                                ?.flatMap((item) => item?.items)
                                ?.filter((item) => !!item)
                        )?.map((item) => ({ ...item, variant: "item" }))
                    );
                } else {
                    result = result?.concat(
                        availableNow(menuItem?.items || [])?.map((item) => ({
                            ...item,
                            variant: "item",
                        }))
                    );
                }
                return result;
            }
            return [];
    }
};


/**
 * Get menu category rows.
 * @returns {number} The menu category rows.
 */
export const getMenuCategoryRows = () => {
    return 2;
};


/**
 * Get menu item rows.
 * @returns {number} The menu item rows.
 */
export const getMenuItemRows = () => {
    return 4;
};









/**
 * Check if not second screen.
 * @returns {boolean} True if not second screen, false otherwise.
 */
export const notSecondScreen = () => {
    return !same(location.pathname, "/second-screen");
};

/**
 * Logout.
 * @returns {void}
 */
export const logout = () => {
    const { setUser, setShift, setDate } = useCache();
    const { setOrder, setOriOrder, setUnableToOrder, setPreorder } = useOrder();
    setUser(null);
    setShift(null);
    setDate(null);
    setOrder(null);
    setOriOrder(null);
    setUnableToOrder(true);
    setPreorder(null);
};

/**
 * Check if item is open item.
 * @param {object} item - The item.
 * @returns {boolean} True if item is open item, false otherwise.
 */
export const isOpenItem = (item) => {
    return item?.item_name?.toUpperCase()?.startsWith(OPEN_ITEM_PREFIX);
};


/**
 * Check if item is addon item.
 * @param {object} orderItem - The order item.
 * @returns {boolean} True if item is addon item, false otherwise.
 */
export const isAddonItem = (orderItem) => {
    return (
        orderItem?.ds_no >= ADDON_STARTING_DS_NO &&
        orderItem?.ds_no < ADDON_2_STARTING_DS_NO
    );
};

/**
 * Calculate set menu item price.
 * @param {any[]} orderItems - The order items.
 * @param {any} orderItem - The order item.
 * @returns {any[]} The new order items.
 */
export const calcSetMemuItemPrice = (orderItems, orderItem) => {
    const items = Array.isArray(useCache()?.items) ? useCache()?.items : [];

    let newOrderItems = clone(orderItems);

    const parentOrderItem = newOrderItems[0];
    if (parentOrderItem) {
        const parentItem = items?.find((item) =>
            same(item?.item_no, parentOrderItem?.item_no)
        );
        if (parentItem) {
            const price = getPriceByServiceType(
                (parentItem?.selling_uom_dtls ? parentItem?.selling_uom_dtls[0] : null)
                    ?.price_dtls[0]
            );
            const grp = (parentItem?.itemmaster_menutype_grpdtls || [])?.find((grp) =>
                same(grp?.modifier_name, orderItem?.category_code)
            );
            const modifierItem = (parentItem?.itemmaster_menutypedtls || [])
                ?.filter((modifieritem) =>
                    same(modifieritem?.modifier_name, grp?.modifier_name)
                )
                ?.find((modifieritem) =>
                    same(modifieritem?.citem_no, orderItem?.item_no)
                );

            const menu_type = Array.isArray(parentItem?.itemmaster_menutype)
                ? parentItem?.itemmaster_menutype[0]?.menu_type
                : "";
            if (same(menu_type, "S")) {
                newOrderItems?.forEach((orderitem) => {
                    if (
                        same(orderitem?.category_code, modifierItem?.modifier_name) &&
                        !isAddonItem(orderitem) &&
                        !isAddon2Item(orderitem) &&
                        notFreeItem(orderitem)
                    ) {
                        const sameGrpQty = newOrderItems
                            ?.filter((orderitem) =>
                                same(orderitem?.category_code, modifierItem?.modifier_name)
                            )
                            ?.map((orderitem) => orderitem?.qty)
                            ?.reduce((acc, val) => acc + val, 0);
                        orderitem.unit_price = (price * grp?.price_per) / 100 / sameGrpQty;

                        orderitem.sub_total = orderitem.unit_price * orderitem.qty;
                    }
                });
            }
        }
    }

    return newOrderItems;
};

/**
 * Minimise SNO.
 * @param {any[]} orderItems - The order items.
 * @returns {any[]} The new order items.
 */
export const minimiseSNo = (orderItems) => {
    const smallestSNo = orderItems
        ?.map((orderitem) => orderitem?.s_no)
        ?.reduce((acc, val) => {
            return Math.min(acc, val);
        }, 1);

    if (smallestSNo > 1) {
        return orderItems?.map((orderitem) => ({
            ...orderitem,
            s_no: orderitem?.s_no - smallestSNo,
        }));
    } else {
        return orderItems;
    }
};


/**
 * Get orders refresh interval.
 * @returns {number} The orders refresh interval.
 */
export const getOrdersRefreshInterval = () => {
    let interval = parseInt(
        getSetting("MORE", "ORDERING", "ORDERS_REFRESH_INTERVAL")
    );
    if (!interval || isNaN(interval)) {
        interval = 30;
    }
    return interval * 1000;
};

/**
 * Preprocess kitchen info.
 * @param {any} kitchenInfo - The kitchen info.
 * @param {any[]} orderItems - The order items.
 * @returns {any} The new kitchen info.
 */
export const preprocessKitchenInfo = (kitchenInfo, orderItems) => {
    const sales_dtls = kitchenInfo?.sales_dtls
        ?.map((info) => {
            const orderItem = orderItems?.find((orderitem) =>
                same(orderitem?.s_no, info?.s_no)
            );

            if (orderItem) {
                return { ...info, qty: orderItem?.qty };
            } else {
                return null;
            }
        })
        ?.filter((info) => !!info);

    return { ...kitchenInfo, sales_dtls };
};

/**
 * Determine if table number should be captured.
 * @returns {boolean} True if table number should be captured, false otherwise.
 */
export const needCaptureTableNo = () => {
    const { order: activeOrder } = useOrder();

    const serviceType = activeOrder?.service_type;

    switch (serviceType) {
        case "Q":
            return (
                bool(
                    getSetting(
                        "GENERAL SETTINGS",
                        "ORDERING",
                        "QUICK_SERVICE_ORDER_ENABLE_TABLE_NUMBER_SELECTION"
                    )
                ) &&
                !bool(
                    getSetting(
                        "GENERAL SETTINGS",
                        "ORDERING",
                        "QUICK_SERVICE_ORDER_ENABLE_CAPTURE_PAGER_TOKEN_NUMBER"
                    )
                )
            );
        case "E":
            return bool(
                getSetting("GENERAL SETTINGS", "ORDERING", "CAPTURE_TABLE_WHEN_DINEIN")
            );
        case "T":
        case "D":
            return false;
    }
};

/**
 * Determine if rounding is needed.
 * @param {any[]} payments - The payments.
 * @returns {boolean} True if rounding is needed, false otherwise.
 */
export const needRounding = (payments) => {
    const { paymentModes } = useCache();
    const paymentDetails = Array.isArray(paymentModes)
        ? paymentModes.flatMap((paymentmode) => paymentmode?.pymt_type_details || [])
        : [];

    return payments?.some((payment) => {
        return bool(
            paymentDetails?.find((paymentdetail) =>
                same(paymentdetail?.payment_name, payment?.payment_name)
            )?.rounding
        );
    });
};

/**
 * Get preorder service type.
 * @param {string} order_type - The order type.
 * @returns {string} The preorder service type.
 */
export const getPreorderServiceType = (order_type) => {
    switch (order_type) {
        case "D":
            return "D";
        case "S":
            return "T";
    }
};

/**
 * Get new pre order.
 * @param {any} data - The data.
 * @returns {any} The new pre order.
 */
export const getNewPreOrder = (data) => {
    const { store, date } = useCache();

    const orderType = data?.order_type || "D";

    return {
        order_no: "",
        order_type: orderType,
        order_date: getNowInAPIFormat(date),
        collection_store_name: store?.store_name,
        coll_del_date: getNowInAPIFormat(date),
        coll_del_time: "",
        customer_code: "",
        contact_person: "",
        contact_no: "",
        contact_email: "",
        payment_name: "",
        payment_status: "N",
        order_status: "N",
        is_gift_personal: "0",
        recipient_name: "",
        alternative_recipient:
            "Email Address / Fax Number(for sending copy of invoice)",
        recipient_contact_no: "",
        del_addr: "",
        postal_code: "",
        del_driver: "",
        sub_total: 0,
        disc_type: "N",
        disc_value: 0,
        disc_name: "None",
        total_disc: "0.00",
        total_svc: "0.00",
        total_tax: "0.00",
        round_adj_amt: "0.00",
        absorb_tax: store?.is_absorbtax ? "Y" : "N",
        net_amt: "0.00",
        total_paid_amt: 0,
        no_of_pax: 1,
        inv_doc_no: "",
        remarks: "",
        ref_1: "",
        ref_2: "",
        ref_3: "",
        ref_4: "",
        ref_5: "",
        sales_dtls: [],
        sales_service_dtls: [],
    };
};












/**
 * Get sales service details.
 * @param {any} order - The order.
 * @returns {any[]} The sales service details.
 */
export const getSalesServiceDtls = (order) => {
    const svcs = Array.isArray(useCache()?.svcs) ? useCache()?.svcs : [];

    const serviceType = order?.service_type;

    const sales_dtls = order?.sales_dtls;
    const sales_service_dtls = [];
    let sales_service_dtl = svcs?.find(
        (item) => item?.service_type === serviceType
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
        return sales_service_dtls;
    }
    return [];
};

/**
 * Get service type info.
 * @param {string} serviceType - The service type.
 * @returns {string} The service type info.
 */
export const getServiceTypeInfo = (serviceType) => {
    return SERVICE_TYPES?.find(({ service_type }) =>
        same(service_type, serviceType)
    )?.service_type_info;
};

/**
 * Validate item mandatory remarks.
 * @param {string} remarks - The remarks.
 * @param {any[]} remarksItems - The remarks items.
 * @returns {boolean} True if the remarks are valid, false otherwise.
 */
export const validateItemMandatoryRemarks = (remarks, remarksItems) => {
    return contains(
        remarksItems
            ?.filter((remarksitemdetails) =>
                same(remarksitemdetails?.remarks_group_type, "S")
            )
            ?.flatMap((remarksitemdetails) => remarksitemdetails?.remarks_details)
            ?.map((remarks) => remarks?.remarks),
        remarks?.split(",")?.map((remark) => remark?.trim())
    );
};

/**
 * Check if the item is a takeaway item.
 * @param {any} orderItem - The order item.
 * @returns {boolean} True if the item is a takeaway item, false otherwise.
 */
export const isTakeawayItem = (orderItem) => {
    return orderItem?.ds_no >= TAKEAWAY_CHARGE_ITEM_STARTING_DS_NO;
};

/**
 * Check if the item is a addon2 item.
 * @param {any} orderItem - The order item.
 * @returns {boolean} True if the item is a addon2 item, false otherwise.
 */
export const isAddon2Item = (orderItem) => {
    return (
        orderItem?.ds_no >= ADDON_2_STARTING_DS_NO &&
        orderItem?.ds_no < TAKEAWAY_CHARGE_ITEM_STARTING_DS_NO
    );
};

/**
 * Check if the addon item has addon2 item.
 * @param {any} addon - The addon.
 * @param {any} addonItem - The addon item.
 * @returns {boolean} True if the addon item has addon2 item, false otherwise.
 */
export const haveAddon2Item = (addon, addonItem) => {
    return (
        Array.isArray(addon?.child_cat_dtls) &&
        addon?.child_cat_dtls?.filter((childcatdtls) =>
            same(childcatdtls?.parent_item_no, addonItem?.item_no)
        )?.length > 0 &&
        Array.isArray(addon?.child_item_dtls) &&
        addon?.child_item_dtls?.filter((childitemdtls) =>
            same(childitemdtls?.parent_item_no, addonItem?.item_no)
        )?.length > 0
    );
};


/**
* Get menu item by item no.
* @param {string} item_no - The item no.
* @returns {any} The menu item.
*/
export const getMenuItemByItemNo = (item_no) => {
    const { menuItems } = useCache();

    const menuItem = menuItems
        ?.flatMap((menuitem) => menuitem?.items)
        ?.find((item) => !!item && same(item?.item_no, item_no));

    return menuItem;
};

/**
 * Check if the order item is a modifier child item.
 * @param {any} orderItem - The order item.
 * @returns {boolean} True if the order item is a modifier child item, false otherwise.
 */
export const isModifierChildItem = (orderItem) => {
    return orderItem?.ds_no > 1 && orderItem?.ds_no < ADDON_STARTING_DS_NO;
};

/**
 * Check if the order items have stocks.
 * @param {any[]} orderItems - The order items.
 * @returns {boolean} True if the order items have stocks, false otherwise.
 */
export const haveStocks = async (orderItems) => {
    return await checkStocks({ info: { sales_dtls: orderItems } });
};

/**
 * Get voucher info.
 * @param crmVendor - The CRM vendor.
 * @param voucher - The voucher.
 * @returns {any} The voucher info.
 */
export const getVoucherInfo = (crmVendor, voucher) => {
    const { promos } = useCache();

    if (voucher) {
        const voucherInfo = {
            raw: voucher,
            promo_name: "",
            limit: 0,
            type: null,
            promotion: null,
        };

        switch (crmVendor) {
            case CRM_VENDOR.EBER:
                const config = voucher?.pos_redeem_extra?.split(",");
                const discountrule = config?.[0];
                const qty = config?.[1];

                voucherInfo.promo_name = discountrule?.split("=")[1] || "";
                voucherInfo.limit = qty?.split("=")[1] || "";

                break;
        }

        const promotion = promos?.find(
            (promo) =>
                same(promo?.promo_name, voucherInfo?.promo_name) &&
                promo?.apply_terminal === 2
        );
        if (promotion) {
            voucherInfo.promotion = promotion;
            if (same(promotion?.criteria_type, PROMO_TYPE.TOTAL_DISCOUNT)) {
                voucherInfo.type = CRM_VOUCHER_TYPE.BILL;
            } else {
                voucherInfo.type = CRM_VOUCHER_TYPE.ITEM;
            }
        }

        return voucherInfo;
    }
    return null;
};

/**
 * Check if need verify 18.
 * @param {any} order - The order.
 * @returns {boolean} True if need verify 18, false otherwise.
 */
export const needVerify18 = (order) => {
    const { items } = useCache();

    const have18Item = order?.sales_dtls?.some((orderItem) => {
        const item = items?.find((item) => item?.item_no === orderItem?.item_no);
        return bool(item?.is_tobacco_item);
    });
    return (
        bool(getSetting("GENERAL SETTINGS", "ORDERING", "ASK_PASSPORT")) &&
        have18Item
    );
};

/**
 * Check if the discount is applicable.
 * @param discount - The discount.
 * @param orderItem - The order item.
 * @returns {boolean} True if the discount is applicable, false otherwise.
 */
export const checkDiscApplicable = (discount, orderItem) => {
    switch (discount?.apply_to) {
        case "A":
            return true;
        case "I":
            const constant_disctype_itemdtls = discount?.constant_disctype_itemdtls;
            if (Array.isArray(constant_disctype_itemdtls)) {
                return !contains(
                    (constant_disctype_itemdtls || [])?.map((item) => item?.itemdtls),
                    orderItem?.item_name
                );
            } else {
                return true;
            }
        case "C":
            const constant_disctype_catdtls = discount?.constant_disctype_catdtls;
            if (Array.isArray(constant_disctype_catdtls)) {
                return !contains(
                    (constant_disctype_catdtls || [])?.map((item) => item?.categorydtls),
                    orderItem?.category_code
                );
            } else {
                return true;
            }

        default:
            return false;
    }
};

/**
 * Issue CRM points.
 * @param {any} order - The order.
 * @param {any[]} redeemedVouchers - The redeemed vouchers.
 * @param {any} crmPointsRedemptionInfo - The CRM points redemption info.
 * @returns {Promise<any>} The CRM points.
 */
export const issueCRMPoints = async (
    order,
    redeemedVouchers,
    crmPointsRedemptionInfo
) => {
    const { store } = useCache();

    const crmVendor = getSetting(
        "GENERAL SETTINGS",
        "ALLOWED SERVICES",
        "CRM_VENDOR_NAME"
    );

    const customer = order?.customer;
    const vendor_info = customer?.vendor_info;

    let res = null;

    switch (crmVendor) {
        case CRM_VENDOR.EBER:
            const nowInUtc = dayjs().utc().format("YYYY-MM-DD HH:mm:ss"); // Y-m-d H:i:s UTC format
            res = await issueEberPoints({
                info: {
                    eberpayload: {
                        email: vendor_info?.email,
                        phone: vendor_info?.phone,
                        phone_code: vendor_info?.phone_code,
                        user_id: vendor_info?.id,
                        skip_phone_if_invalid: 1,
                        qr_code: vendor_info?.user_qr_codes[0]?.code,
                        external_member_id: vendor_info?.external_member_id,
                        display_name: vendor_info?.display_name,
                        amount: order?.net_amt,
                        note: "",
                        transaction_no: order?.sales_no,
                        notify: true,
                        custom_store_id: store?.store_name,
                        custom_staff_id: "WEBORDER",
                        item_data_json: JSON.stringify(
                            order?.sales_dtls?.map((orderitem) => ({
                                name: orderitem?.item_name,
                                total_amount: orderitem?.sub_total,
                                quantity: orderitem?.qty,
                                unit_amount: orderitem?.unit_price,
                            }))
                        ),
                        utc_transaction_created_at: nowInUtc,
                        utc_created_at: nowInUtc,
                        tax: order?.total_tax,
                        shipping_cost: 0,
                        service_charge: order?.total_svc,
                        discount: order?.total_disc,
                        payment_data_json: JSON.stringify(
                            order?.sales_payment_dtls?.map((payment) => ({
                                name: payment?.payment_name,
                                amount: payment?.tender_amt,
                                description: payment?.ref_info,
                            }))
                        ),
                        issued_reward_ids: redeemedVouchers?.map(
                            (voucher) => voucher?.issued_reward?.id
                        ),
                        card_transaction_ids: [],
                        unique_type: "evolut",
                        create: 1,
                        sub_type: "",
                        transaction_tags: [],
                        refund_amount: 0,
                        point_conversion_points: crmPointsRedemptionInfo?.points || 0,
                        public_params: [],
                    },
                },
            });
            break;
    }
    return res;
};

/**
 * Rollback all redeemed vouchers.
 * @param {any[]} vouchers - The vouchers.
 * @param {string} transaction_no - The transaction no.
 * @returns {Promise<void>} The voided vouchers.
 */
export const rollbackAllRedeemedVouchers = async (
    vouchers,
    transaction_no
) => {
    const { crmInfo } = useCrm();

    const crmVendor = crmInfo?.vendorName;

    switch (crmVendor) {
        case CRM_VENDOR.EBER:
            await Promise.all(
                vouchers
                    ?.filter((voucher) => !!voucher)
                    ?.map(async (voucher) => {
                        await voidEberVoucherTransaction({
                            info: {
                                eberpayload: {
                                    issued_reward_id: voucher?.issued_reward?.id,
                                    transaction_no,
                                },
                            },
                        });
                    })
            );
            break;
    }
};



/**
* Gets device ID from SOK device mapping based on register name.
* @param {string} register_name - The register name to look up.
* @returns {string | null} The device ID if found, null otherwise.
*/
export const getSokDeviceId = (register_name) => {
    if (!register_name) {
        return null;
    }

    const mappingRaw = getSetting("MORE", "SOK", "SOK_DEVICE_MAPPING") || "{}";

    let mapping = {};
    try {
        mapping = JSON.parse(mappingRaw);
    } catch {
        mapping = {};
    }

    return mapping[register_name] || null;
};


/**
 * Check if the order item is a modifier item.
 * @param {any} orderItem - The order item.
 * @returns {boolean} True if the order item is a modifier item, false otherwise.
 */
export const isModifierItem = (orderItem) => {
    return (
        orderItem?.ds_no >= MODIFIER_STARTING_DS_NO &&
        orderItem?.ds_no < MODIFIER_2_STARTING_DS_NO
    );
};

/**
 * Check if the order item is a modifier2 item.
 * @param {any} orderItem - The order item.
 * @returns {boolean} True if the order item is a modifier2 item, false otherwise.
 */
export const isModifier2Item = (orderItem) => {
    return (
        orderItem?.ds_no >= MODIFIER_2_STARTING_DS_NO &&
        orderItem?.ds_no < ADDON_STARTING_DS_NO
    );
};

/**
 * Check if the modifier item has modifier2 item.
 * @param {any} item - The item configuration.
 * @param {any} modifierItem - The selected 1st level modifier item.
 * @returns {boolean} True if the modifier item has modifier2 item, false otherwise.
 */
export const haveModifier2Item = (item, modifierItem) => {
    const additionalGrpdtls =
        typeof item?.itemmaster_menutype_additional_grpdtls === "string" &&
            item?.itemmaster_menutype_additional_grpdtls !== ""
            ? JSON.parse(item.itemmaster_menutype_additional_grpdtls)
            : item?.itemmaster_menutype_additional_grpdtls || [];
    const additionalDtls =
        typeof item?.itemmaster_menutype_additional_dtls === "string" &&
            item?.itemmaster_menutype_additional_dtls !== ""
            ? JSON.parse(item.itemmaster_menutype_additional_dtls)
            : item?.itemmaster_menutype_additional_dtls || [];

    return (
        additionalGrpdtls?.filter(
            (grp) =>
                additionalDtls?.filter(
                    (_item) =>
                        same(_item?.parent_item_no, modifierItem?.citem_no) &&
                        same(_item?.category_code, grp?.category_code)
                )?.length > 0
        )?.length > 0
    );
};

/**
 * Check if the order data has new order items.
 * @param {any} orderData - The order data.
 * @returns {boolean} True if the order data has new order items, false otherwise.
 */
export const hasNewOrderItems = (orderData) => {
    const { orderSeq } = useOrder();
    return (orderData?.sales_dtls || []).some((item) =>
        same(item?.order_seq, orderSeq)
    );
};

/**
 * Check if the checkout remarks modal should be shown.
 * @param {any} orderData - The order data to check.
 * @returns {boolean} True if the checkout remarks modal should be shown, false otherwise.
 */
export const shouldShowConfirmOrderOrCheckoutRemarks = (orderData) => {
    const { allRemarks } = useCache();

    const haveCheckoutRemarks =
        allRemarks?.find((remarkgroup) =>
            same(remarkgroup?.remarks_group_type, "O")
        )?.remarks_type_details?.length > 0;

    return haveCheckoutRemarks && hasNewOrderItems(orderData);
};