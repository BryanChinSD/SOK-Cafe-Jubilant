"use client";

import { useCache } from "../stores/cache-store";
import { useOrder } from "../stores/order-store";

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
} from "./constants";
import { bool, clone, contains, getNowInAPIFormat, same } from "./common";
import dayjs from "https://esm.sh/dayjs"; // ✅ works in browser TypeScript
import isBetween from "dayjs/plugin/isBetween";

// import {
//   getCashReconStatus,
//   getDeliveryOrders,
//   getFloorPlans,
//   getMenu,
//   getNonClosedOrders,
//   getTQROrders,
// } from "./api/api";
// import { toastify } from "./toast";
// import { routes } from "@/configs/routes";
// import { route } from "@/stores/route-store";

dayjs.extend(isBetween);

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
export const sequenceOrderItems = (orderItems: any[], s_no?: string) => {
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
export const desequenceOrderItems = (orderItems: any[]) => {
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
export const getRounding = (
  net_amt: string,
  rounding_precision: number,
  rounding_type?: number // 1: round up, 0: round down
) => {
  const lastChar = net_amt.slice(-1);
  let new_net_amt = "0.00";

  // last digit is 0, no need to round
  if (lastChar === "0") {
    new_net_amt = net_amt;
  }
  // round up
  else if (rounding_type === 1) {
    // For precision of 5: If last digit is less than 5, round up to next 5
    if (rounding_precision === 5 && parseFloat(lastChar) < 5) {
      new_net_amt = net_amt.slice(0, -1) + "5";
    }
    // For precision of 5: If last digit is exactly 5, keep as is
    else if (rounding_precision === 5 && parseFloat(lastChar) === 5) {
      new_net_amt = net_amt;
    }
    // For precision of 5: If last digit is greater than 5, round up to next 10
    else if (rounding_precision === 5 && parseFloat(lastChar) > 5) {
      const a = parseFloat(net_amt) + parseFloat(".05");
      const b = a.toFixed(2);
      new_net_amt = b.slice(0, -1) + "0";
    }
    // For precision of 10: Round up to next 10 cents
    else if (rounding_precision === 10) {
      const a = parseFloat(net_amt) + parseFloat(".10");
      const b = a.toFixed(2);
      new_net_amt = b.slice(0, -1) + "0";
    }
  }
  // round down
  else if (rounding_type === 0) {
    // For precision of 5: If last digit is less than 5, round down to previous 0
    if (rounding_precision === 5 && parseFloat(lastChar) < 5) {
      new_net_amt = net_amt.slice(0, -1) + "0";
    }
    // For precision of 5: If last digit is exactly 5, keep as is
    else if (rounding_precision === 5 && parseFloat(lastChar) === 5) {
      new_net_amt = net_amt;
    }
    // For precision of 5: If last digit is greater than 5, round down to previous 5
    else if (rounding_precision === 5 && parseFloat(lastChar) > 5) {
      new_net_amt = net_amt.slice(0, -1) + "5";
    }
    // For precision of 10: Round down to previous 10 cents
    else if (rounding_precision === 10) {
      new_net_amt = net_amt.slice(0, -1) + "0";
    }
  }
  // round to nearest
  else if (rounding_type === 2) {
    // For precision of 5: Round to nearest 5 cents
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
    // For precision of 10: Round to nearest 10 cents
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
export const calcRemainingTenderAmt = (
  net_amt: number,
  payments: any[],
  payment: any
) => {
  const { order: activeOrder } = useOrder();

  const thisOrder = activeOrder;

  const tender_amt = payments
    ?.map((item) => parseFloat(item?.tender_amt))
    ?.reduce((acc, val) => acc + val, 0);

  let remaining_tender_amt = net_amt - tender_amt;

  // split payment
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
export const calcOrderAmt = (order: any, orderItems?: any[]) => {
  orderItems = orderItems ? orderItems : order?.sales_dtls;
  const sub_total =
    orderItems
      ?.map((item) => parseFloat(item?.sub_total))
      ?.reduce((acc, val) => acc + val, 0)
      ?.toFixed(2) || "0.00";

  const total_disc =
    orderItems
      ?.map((item) => parseFloat(item?.pro_disc_amt))
      ?.reduce((acc, val) => acc + val, 0)
      ?.toFixed(2) || "0.00";

  const total_svc =
    orderItems
      ?.map((item) => parseFloat(item?.svc_amt))
      ?.reduce((acc, val) => acc + val, 0)
      ?.toFixed(2) || "0.00";

  const total_tax =
    orderItems
      ?.map((item) => parseFloat(item?.tax_amt))
      ?.reduce((acc, val) => acc + val, 0)
      ?.toFixed(2) || "0.00";

  const total_tax_absorbed =
    orderItems
      ?.filter((item) => isAbsorbTax(item))
      ?.map((item) => parseFloat(item?.tax_amt))
      ?.reduce((acc, val) => acc + val, 0)
      ?.toFixed(2) || "0.00";

  const round_adj_amt = parseFloat(order?.round_adj_amt).toFixed(2);

  const net_amt = (
    parseFloat(sub_total) -
    parseFloat(total_disc) +
    parseFloat(total_svc) +
    parseFloat(total_tax) -
    parseFloat(total_tax_absorbed) +
    parseFloat(round_adj_amt)
  ).toFixed(2);

  return {
    ...order,
    sales_dtls: orderItems,
    sub_total,
    total_disc,
    total_svc,
    total_tax,
    round_adj_amt,
    net_amt,
  };
};

/**
 * Gets the price based on service type.
 * @param {any} price - The price object.
 * @param {string} [service_type] - Optional service type.
 * @returns {number} The price for the given service type.
 */
export const getPriceByServiceType = (price: any, service_type?: string) => {
  const { order: activeOrder } = useOrder();

  const serviceType = activeOrder?.service_type;
  if (!price) {
    return 0;
  }
  service_type = service_type ? service_type : serviceType;

  switch (service_type) {
    case "Q": // quick service
    case "E": // dine in
      return price?.dine_in_price !== undefined && price?.dine_in_price !== null
        ? price?.dine_in_price
        : price?.default_price;
    case "T": // take away
      return price?.takeaway_price;
    case "D": // delivery
      return price?.delivery_price;
  }
};

/**
 * Calculates and returns order item with discount.
 * @param {any} orderItem - The order item object.
 * @param {any} discount - The discount object.
 * @param {any[]} orderItems - The array of order items.
 * @returns {any} The updated order item with calculated discount.
 */
export const calcOrderItemDiscount = (
  orderItem: any,
  discount: any,
  orderItems: any
) => {
  const { disc_type, disc_name, disc_value } = discount || {};
  const parentItem = useCache()?.items?.find(
    (item) =>
      item?.item_no ===
      orderItems?.find((item) => item?.s_no === orderItem.parent_sno)?.item_no
  );
  const parent_menu_type =
    // modifier
    Array.isArray(parentItem?.itemmaster_menutype) &&
    parentItem?.itemmaster_menutype[0]?.menu_type;

  const isNonAlacarteChildItem = !!(
    //  modifier child item
    (
      (orderItem.s_no !== orderItem.parent_sno && parent_menu_type) ||
      // addon child item
      (orderItem.s_no !== orderItem.parent_sno &&
        bool(parentItem?.is_addon_enable) &&
        parentItem?.add_on_name)
    )
  );
  const isAlacarteItem = !!(
    orderItem.s_no === orderItem.parent_sno && !parent_menu_type
  );

  if (disc_name && disc_name !== "None") {
    let disc_amt = 0;
    let sub_total = orderItem.qty * orderItem.unit_price;
    switch (disc_type) {
      // item
      case "V":
      case "$":
      // promo
      case "A":
        //  non-alacarte child items
        if (isNonAlacarteChildItem) {
          const total = orderItems
            ?.filter((item) => item?.parent_sno === orderItem.parent_sno)
            ?.map((item) => item?.sub_total)
            ?.reduce((acc, val) => acc + val, 0);
          disc_amt = (disc_value / total) * orderItem.sub_total;
          sub_total = orderItem?.sub_total;
        } else {
          disc_amt = disc_value > sub_total ? sub_total : disc_value;
          sub_total = sub_total - disc_amt;
        }
        break;
      // item
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
    let sub_total =
      isNonAlacarteChildItem || isAlacarteItem
        ? orderItem.qty * orderItem.unit_price
        : 0;
    // const takeAwayChargeItemNo = getSysSetting(
    //   "System Settings",
    //   "ta_fixed_item_no"
    // );
    // if (same(orderItem?.item_no, takeAwayChargeItemNo)) {
    //   sub_total = orderItem.qty * orderItem.unit_price;
    // } else if (isNonAlacarteChildItem || isAlacarteItem) {
    //   sub_total = orderItem.qty * orderItem.unit_price;
    // }
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
export const goodToApplyDisc = (
  orderItem: any,
  discount: any,
  orderItems: any[]
) => {
  const item = useCache()?.items?.find(
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
  // }
  return !(
    (discount?.disc_type === "V" || discount?.disc_type === "$") &&
    sub_total < discount?.disc_value
  );
};

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
export const addTax = (orderItem: any) => {
  const { svcs } = useCache();
  const { order: activeOrder } = useOrder();

  const serviceType = activeOrder?.service_type;

  const service_type = orderItem?.take_away_item === "Y" ? "T" : serviceType;
  const svc = svcs.find((item) => item?.service_type === service_type);
  const service_by = svc?.service_by;
  const service_value = svc?.service_value;
  const total =
    parseFloat(orderItem?.sub_total) - parseFloat(orderItem?.pro_disc_amt);

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
      ((total + svc_amt) * parseFloat(orderItem?.tax_value)) /
      (100 + parseFloat(orderItem?.tax_value));
  } else {
    tax_amt = ((total + svc_amt) * parseFloat(orderItem?.tax_value)) / 100;
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
export const haveCashPayment = (payments: any[]) => {
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
export const onlyCashPayments = (payments: any[]) => {
  const cashPayments = payments?.filter((item) => item?.payment_type === "C");
  return cashPayments?.length === payments?.length;
};

/**
 * Calculates and returns order item with subtotal.
 * @param {any} orderItem - The order item object.
 * @param {any[]} orderItems - The array of order items.
 * @returns {any} The updated order item with calculated subtotal.
 */
export const calcOrderItemSubtotal = (orderItem: any, orderItems: any[]) => {
  const { order: activeOrder } = useOrder();

  const serviceType = activeOrder?.service_type;

  // recalculate subtotal for take away charge item
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

  const item = useCache()?.items?.find(
    (item) => item?.item_no === orderItem?.item_no
  );

  const unit_price =
    // addon item
    isAddonItem(orderItem) ||
    // open item
    isOpenItem(orderItem)
      ? orderItem?.unit_price
      : getPriceByServiceType(
          item?.selling_uom_dtls[0]?.price_dtls[0],
          orderItem?.take_away_item === "Y" ? "T" : serviceType
        );

  // main or alacarte order item
  if (orderItem?.s_no === orderItem.parent_sno) {
    // modifier, set or combo order item
    if (orderItem?.menu_type) {
      return addTax({ ...orderItem });
    }
    // alacarte order item
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
  // child order item
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
export const isWeightableItem = (item: any) => {
  let lstItem = useCache()?.items?.filter(function (v) {
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
export const getSetting = (
  main_group_name: string,
  group_name: string,
  setting_code: string
) => {
  const storeRegisterSettings = useCache()?.storeRegisterSettings || [];
  const settings = useCache()?.settings || [];
  const list = [...storeRegisterSettings, ...settings];
  return list?.find(
    (item) =>
      same(item?.main_group_name, main_group_name) &&
      same(item?.group_name, group_name) &&
      same(item?.setting_code, setting_code)
  )?.setting_value;
};

/**
 * Checks user rights for the action.
 * @param {string} module - The module to check rights for.
 * @param {any} [user] - Optional user object.
 * @returns {boolean} True if the user has rights, false otherwise.
 */
export const authorised = (module: string, user?: any) => {
  try {
    if (same(module, "ORDER")) {
      return true;
    }

    user = user || useCache()?.user;
    return bool(
      useCache()
        ?.roles?.find((item) => same(item?.gr_code, user?.gr_code))
        ?.menu[0]?.sub?.find((item) => same(item?.menu_name, module))
        ?.access_flag
    );
  } catch (error) {
    return false;
  }
};

/**
 * Gets menu item display name.
 * @param {any} item - The item object.
 * @returns {string} The display name of the item.
 */
export const getItemDisplayName = (item: any) => {
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
    // Check if the window is already open and not closed
    if (!secondScreenWindow || secondScreenWindow.closed) {
      secondScreenWindow = window.open(
        `${window.location.origin}/second-screen`,
        "SecondDisplay",
        "resizable=1,scrollbars=1,fullscreen=1,height=300,width=4685,top=4685,left=4685,toolbar=0,menubar=0,status=1"
      );
    }
    // else {
    //   // If the window is already open, focus on it
    //   secondScreenWindow.focus();
    // }
  }
};

/**
 * Sorts list by sequence number.
 * @param {any[]} list - The list to sort.
 * @returns {any[]} The sorted list.
 */
export const sortModifierAddonItems = (list: any[]) => {
  return clone(list)?.sort((a, b) => {
    // general sequence
    if (a.seq_no !== null && a.seq_no !== undefined) {
      if (a.seq_no === 0 && b.seq_no === 0) return 0;
      if (a.seq_no === 0) return 1;
      if (b.seq_no === 0) return -1;
      return a.seq_no - b.seq_no;
    }
    // modifier group sequence
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
    // modifier item sequence
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
export const availableNow = (items: any[]) => {
    if (!items) return [];

    const now = dayjs();
    const loginNow = getNowWithLoginDate();
    const todayDay = loginNow.format("ddd");

    return items.filter((item) => {
        const start = dayjs(item?.start_time, TIME_FORMAT);
        const end = dayjs(item?.end_time, TIME_FORMAT);

        const validItemTime = start.isValid() && end.isValid() && now.isBetween(start, end);
        if (validItemTime) {
            console.log(`✅ Order item in time: ${item.name} (${item.item_no})`);
            return true;
        }

        const promoStart = dayjs(item?.promo_st_date);
        const promoEnd = dayjs(item?.promo_ed_date);
        const isPromoDay = (item?.time_slot_dtls || []).some((slot) => {
            const matchDay = same(slot?.day_info, todayDay);
            const slotStart = dayjs(slot?.st_time, TIME_FORMAT);
            const slotEnd = dayjs(slot?.ed_time, TIME_FORMAT);
            return matchDay && now.isBetween(slotStart, slotEnd);
        });

        const isPromoItem = promoStart.isValid() && promoEnd.isValid() && loginNow.isBetween(promoStart, promoEnd) && isPromoDay;

        if (isPromoItem) {
            console.log(`🎉 Promo item in time: ${item.name} (${item.item_no})`);
        } else {
            console.log(`⛔ Skipped: ${item.name} (${item.item_no})`);
        }

        return isPromoItem;
    });
};


/**
 * Gets root and selected categories based on current selected menu item.
 * @param {any} menuItem - The selected menu item.
 * @returns {Object} An object containing rootCategory and selectedCategory arrays.
 */
export const getRootAndSelectedCategories = (menuItem: any) => {
  const categories = [];

  let currentCategory = null;

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
export const getPromo = (item: any, criteria_type: string | string[]) => {
  const { order: activeOrder } = useOrder();

  const serviceType = activeOrder?.service_type;

  const promos = (useCache()?.promos || [])
    // filter only promo with current service type
    ?.filter((promo) =>
      contains(
        promo?.service_type?.map((item) => item?.service_type),
        serviceType
      )
    )
    // filter linked items
    ?.filter((promo) => isPromoApplicable(promo, item))
    // filter criteria type
    ?.filter((item) => {
      if (Array.isArray(criteria_type)) {
        return contains(criteria_type, item?.criteria_type);
      } else {
        return same(item?.criteria_type, criteria_type);
      }
    });

  return promos?.length > 0 ? promos[0] : null;
};

/**
 * Sorts order items ascendingly.
 * @param {any[]} orderItems - The array of order items to sort.
 * @returns {any[]} The sorted array of order items.
 */
export const sortOrderItems = (orderItems: any[]) => {
  return (orderItems || [])?.sort((a, b) => {
      if (a.parent_sno !== b.parent_sno) {
          console.log("d_sno1", a.parent_sno - b.parent_sno);
      return a.parent_sno - b.parent_sno;
    }
      if (a.ds_no !== b.ds_no) {
          console.log("d_sno2", a.parent_sno - b.parent_sno);
      return a.ds_no - b.ds_no;
      }
      console.log("d_sno3", a.parent_sno - b.parent_sno);

    return a.s_no - b.s_no;
  });
};

/**
 * Get the sets of the promo.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of promo set.
 */
export const getPromoSets = (promo, orderItems, orderItem?) => {
  const { setLastSNo } = useOrder();

  const isTotalDiscountPromo = same(
    promo?.criteria_type,
    PROMO_TYPE.TOTAL_DISCOUNT
  );

  let remaining = orderItems
    // parent items
    ?.filter((item) => same(item?.parent_sno, item?.s_no))
    // non-discounted items, except item discount items
    ?.filter((item) =>
      same(
        findPromoByName(item?.disc_name)?.criteria_type,
        PROMO_TYPE.ITEM_DISCOUNT
      )
        ? true
        : same(item?.disc_name, "None")
    );

  let newOrderItems = clone(orderItems);

  const sets = [];
  let _insert = false;
  let _delete = false;
  let cont = true;

  // // order item existed in the order items (inserting)
  // if (
  //   isTotalDiscountPromo ||
  //   contains(
  //     orderItems?.map((item) => item?.s_no),
  //     orderItem?.s_no
  //   )
  // ) {
  //   _insert = true;
  // }
  // // order item is not existed in the order items (deleting)
  // else {
  //   _delete = true;
  // }
  _insert = true;

  if (isTotalDiscountPromo || isPromoApplicable(promo, orderItem)) {
    // loop until all remaining items are checked
    while (cont && remaining?.length > 0) {
      // process special logic for lowest price discount promo
      if (same(promo?.criteria_type, PROMO_TYPE.LOWEST_PRICE_DISCOUNT)) {
        // sort by unit_price in descending order
        remaining = remaining?.sort((a, b) => {
          if (!same(a?.s_no, a?.parent_sno)) return 1;
          if (!same(b?.s_no, b?.parent_sno)) return -1;
          return (b?.unit_price || 0) - (a?.unit_price || 0);
        });

        // take last item and move to start
        if (remaining?.length > 0) {
          const lastItem = remaining[remaining.length - 1];
          remaining = [lastItem, ...remaining.slice(0, -1)];
        }
      }

      let found = false;
      const set = [];

      // loop through item criterias
      if (Array.isArray(promo?.item_dtls)) {
        for (let i = 0; i < promo?.item_dtls?.length; i++) {
          const promoitem = promo?.item_dtls[i];
          let qty = promoitem?.qty;

          if (qty > 0) {
            for (
              let j = 0;
              j < remaining?.filter((item) => !item?.checked)?.length;
              j++
            ) {
              const orderitem = remaining[j];
              if (same(promoitem?.item_no, orderitem?.item_no)) {
                // item criteria quantity is more than or equal to the order item quantity
                if (qty >= orderitem?.qty) {
                  set.push(orderitem);
                  qty = qty - orderitem?.qty;
                  if (qty <= 0) {
                    break;
                  }
                }
                // order item quantity is more than item criteria quantity
                else {
                  const newOrderItem = { ...orderitem, qty };
                  set.push(newOrderItem);
                  // newOrderItems.push(newOrderItem);

                  // split order item
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

          // update remaining items by removing the inserted set items
          remaining = remaining?.filter(
            (item) =>
              !contains(
                sets?.flat()?.map((item) => item?.s_no),
                item?.s_no
              )
          );
        }

        // check whether the set is fulfilled the criteria quantity
        if (set?.length > 0) {
          // merge items with same item_no and sum their quantities
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
          // check whether all criteria are fulfilled
          found = promo?.item_dtls?.every((criteria) => {
            return (
              merged?.find((item) => same(item?.item_no, criteria?.item_no))
                ?.qty === criteria?.qty
            );
          });
        }
      }

      // loop through category criterias
      else if (Array.isArray(promo?.item_menu_category_dtls)) {
        for (let i = 0; i < promo?.item_menu_category_dtls?.length; i++) {
          const promoitem = promo?.item_menu_category_dtls[i];
          let qty = promoitem?.qty;

          if (qty > 0) {
            for (
              let j = 0;
              j < remaining?.filter((item) => !item?.checked)?.length;
              j++
            ) {
              const orderitem = remaining[j];
              if (same(promoitem?.category_code, orderitem?.category_code)) {
                // category criteria quantity is more than or equal to the order item quantity
                if (qty >= orderitem?.qty) {
                  set.push(orderitem);
                  qty = qty - orderitem?.qty;
                  if (qty <= 0) {
                    break;
                  }
                }
                // order item quantity is more than item criteria quantity
                else {
                  const newOrderItem = { ...orderitem, qty };
                  set.push(newOrderItem);
                  // newOrderItems.push(newOrderItem);

                  // split order item
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

          // update remaining items by removing the inserted set items
          remaining = remaining?.filter(
            (item) =>
              !contains(
                sets?.flat()?.map((item) => item?.s_no),
                item?.s_no
              )
          );
        }

        // check whether the set is fulfilled the criteria quantity
        if (set?.length > 0) {
          // merge items with same item_no and sum their quantities
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
          // check whether all criteria are fulfilled
          found = promo?.item_menu_category_dtls?.every((criteria) => {
            return (
              merged?.find((item) =>
                same(item?.category_code, criteria?.category_code)
              )?.qty === criteria?.qty
            );
          });
        }
      }

      if (found) {
        if (_delete) {
          _insert = false;
        }
        sets.push(set);
        // update remaining items by removing the inserted set items
        remaining = remaining?.filter(
          (item) =>
            !contains(
              sets?.flat()?.map((item) => item?.s_no),
              item?.s_no
            )
        );
        // update subtotal of each order item
        newOrderItems = newOrderItems?.map((orderitem) =>
          calcOrderItemSubtotal(orderitem, newOrderItems)
        );
      } else {
        cont = false;
      }
    }
  }

  return { sets, _insert, _delete, _orderItems: newOrderItems };
};

/**
 * Checks if the order item is not free item based on the criteria type.
 * @param {any} orderItem - The order item object.
 * @param {string} criteriaType - The criteria type.
 * @returns {boolean} True if the order item is not free item, false otherwise.
 */
export const notFreeItem = (orderItem, criteriaType?) => {
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
};

/**
 * Checks if the order item is promo applicable.
 * @param {any} promo - The promo object.
 * @param {any} orderItem - The order item object.
 * @returns {boolean} True if the promo is applicable, false otherwise.
 */
const isPromoApplicable = (promo, orderItem) => {
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

  if (same(promo?.by_item, "AI")) {
    return true;
  } else if (same(promo?.by_item, "SC")) {
    return contains(
      (promo?.item_menu_category_dtls || [])?.map(
        (item) => item?.category_code
      ),
      orderItem?.category_code
    );
  } else if (same(promo?.by_item, "SI")) {
    return contains(
      (promo?.item_dtls || [])?.map((item) => item?.item_no),
      orderItem?.item_no
    );
  } else if (same(promo?.by_item, "SD")) {
    return (
      contains(
        (promo?.item_menu_category_dtls || [])?.map(
          (item) => item?.category_code
        ),
        orderItem?.category_code
      ) ||
      contains(
        (promo?.item_dtls || [])?.map((item) => item?.item_no),
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
 * Process and apply promotion logic to the order items.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any} The result object.
 */
export const applyPromotions = (orderItems, orderItem) => {
  let newOrderItems = [...orderItems];

  let promos = useCache()?.promos;

  // filter out expired promotions
  promos = availableNow(promos);

  // break the sets for all promotions except total discount
  const setPromos = promos?.filter(
    (promo) =>
      same(promo?.by_item, "SD") &&
      !same(promo?.criteria_type, PROMO_TYPE.TOTAL_DISCOUNT)
  );

  setPromos?.forEach((promo) => {
    newOrderItems = newOrderItems
      ?.map((orderitem) => {
        if (same(promo?.promo_name, orderitem?.disc_name)) {
          if (notFreeItem(orderitem, promo)) {
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
          }
        } else {
          return orderitem;
        }
      })
      ?.filter((orderitem) => !!orderitem);
  });

  const result = {
    orderItems: newOrderItems,
    process: null,
  };

  for (const promo of promos || []) {
    // item discount
    if (same(promo?.criteria_type, PROMO_TYPE.ITEM_DISCOUNT)) {
      newOrderItems = processItemDiscountPromo(promo, newOrderItems, orderItem);
    }

    // free item, special price, special discount with quantity
    if (
      contains(
        [PROMO_TYPE.FREE_ITEM, PROMO_TYPE.SPECIAL_PRICE],
        promo?.criteria_type
      )
    ) {
      newOrderItems = processDirectInsertFreeItemPromo(
        promo,
        newOrderItems,
        orderItem
      );
    }
    // free item by quantity
    else if (
      same(promo?.criteria_type, PROMO_TYPE.SPECIAL_DISCOUNT_WITH_QUANTITY)
    ) {
      newOrderItems = processFreeItemByQuantityPromo(
        promo,
        newOrderItems,
        orderItem
      );
    }
    // lowest price discount
    else if (same(promo?.criteria_type, "LD")) {
      newOrderItems = processLowestPriceDiscountPromo(
        promo,
        newOrderItems,
        orderItem
      );
    }
    // free item with limit
    else if (same(promo?.criteria_type, PROMO_TYPE.FREE_ITEM_WITH_LIMIT)) {
      const { processOrderItem, orderItems } = processFreeItemByLimitPromo(
        promo,
        newOrderItems,
        orderItem
      );
      newOrderItems = orderItems;
      if (processOrderItem) {
        result.process = { promo, item: processOrderItem };
        break;
      }
    }
    // free item by value
    else if (same(promo?.criteria_type, PROMO_TYPE.FREE_ITEM_BY_VALUE)) {
      const { processOrderItem, orderItems } = processFreeItemByValuePromo(
        promo,
        newOrderItems,
        orderItem
      );
      newOrderItems = orderItems;
      if (processOrderItem) {
        result.process = { promo, item: processOrderItem };
        break;
      }
    }
  }

  result.orderItems = newOrderItems;
  return result;
};

/**
 * Processes free item promo (free item, special price, special discount with quantity) and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
const processDirectInsertFreeItemPromo = (
  promo: any,
  orderItems: any[],
  orderItem: any
) => {
  let newOrderItems = [...orderItems];

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
        // let freeItems = [];
        sets?.forEach((set) => {
          let tempFreeItems = getFreeItems(
            promo,
            set[set.length - 1],
            newOrderItems
          );
          if (tempFreeItems?.length > 0) {
            // freeItems = [...freeItems, ...tempFreeItems];
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
                  ref_2: 1,
                };
              } else {
                return item;
              }
            });
          }
          newOrderItems = [...newOrderItems, ...tempFreeItems];
        });
        // newOrderItems = [...newOrderItems, ...freeItems];
      } else if (_delete) {
        newOrderItems = resetSetPromo(promo, newOrderItems, orderItem);
      }
    }

    // selected categories / items criteria
    else {
      let freeItems = [];
      if (
        // non-discounted items, except item discount items
        same(
          findPromoByName(orderItem?.disc_name)?.criteria_type,
          PROMO_TYPE.ITEM_DISCOUNT
        )
          ? true
          : same(
              orderItems?.find((orderitem) =>
                same(orderitem?.s_no, orderItem?.s_no)
              )?.disc_name,
              "None"
            )
      ) {
        let tempFreeItems = getFreeItems(promo, orderItem, newOrderItems);
        if (tempFreeItems?.length > 0) {
          freeItems = [...freeItems, ...tempFreeItems];
          newOrderItems = newOrderItems?.map((item) => {
            if (
              same(item?.parent_sno, item?.s_no) &&
              same(item?.s_no, orderItem?.s_no)
            ) {
              return {
                ...item,
                disc_name: promo?.promo_name,
              };
            } else {
              return item;
            }
          });
        }
      }
      newOrderItems = [...newOrderItems, ...freeItems];
    }
  }

  return newOrderItems;
};

/**
 * Processes free item by quantity promo and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
const processFreeItemByQuantityPromo = (
  promo: any,
  orderItems: any[],
  orderItem: any
) => {
  let newOrderItems = [...orderItems];

  let freeItems = [];
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
            ref_2: 1,
          };
        } else {
          return item;
        }
      });
    }
  } else {
    newOrderItems = resetSetPromo(promo, newOrderItems, orderItem);
  }
  newOrderItems = [...newOrderItems, ...freeItems];

  return newOrderItems;
};

/**
 * Get the direct inserted free items (free item, special price, special discount with quantity).
 * @param {any} promo - The promo object.
 * @param {any} orderItem - The order item object.
 * @param {any[]} orderItems - The array of order items.
 * @param {string} item_no - The item number.
 * @returns {any[]} The array of promo items.
 */
export const getFreeItems = (
  promo: any,
  orderItem: any,
  orderItems: any[],
  item_no?: string
) => {
  const { orderSeq } = useOrder();

  const freeItems = [];

  if (isPromoApplicable(promo, orderItem)) {
    // auto promo items inserted
    const isFreeItemPromo = same(promo?.criteria_type, "FI");
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
    (isSpecialPriceItemPromo || isSpecialDiscountWithQuantityPromo
      ? [promo?.criteria_promo_item_no]?.map((item) => ({ item_no: item }))
      : (promo?.creteria_item_dtls || [])?.filter((item) =>
          isFreeItemPromo ? true : same(item?.item_no, item_no)
        )
    )?.forEach((freeItem) => {
      const item =
        useCache()?.items.find((item) =>
          same(item?.item_no, freeItem?.item_no)
        ) || null;

      if (item && item?.selling_uom_dtls) {
        const qty = isFreeItemPromo ? freeItem?.qty : 1;
        const unit_price = isSpecialPriceItemPromo
          ? promo?.criteria_spl_price
          : isSpecialDiscountWithQuantityPromo
          ? getPriceByServiceType(item?.selling_uom_dtls[0]?.price_dtls[0])
          : 0;
        const sub_total = unit_price * qty;
        // only add free item if item is not 0, and is alacarte
        if (qty && !item?.itemmaster_menutype) {
          i++;
          // const s_no = useOrder()?.lastSNo + i;
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
            case "FI":
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
          const ds_no =
            orderItems
              ?.filter((item) => same(item?.parent_sno, orderItem?.s_no))
              ?.map((item) => item?.ds_no)
              .reduce((max, val) => Math.max(max, val), from) + i;

          const selling_uom_dtls = item?.selling_uom_dtls[0];

          let freeItem = {
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
            ref_2: 1,
            ref_3: "",
            ref_4: "",
          };

          freeItems.push(addTax(freeItem));
        }
      }
    });
  }

  return freeItems;
};

/**
 * Processes item discount promo and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
const processItemDiscountPromo = (
  promo: any,
  orderItems: any[],
  orderItem: any
) => {
  let newOrderItems = [...orderItems];

  newOrderItems = newOrderItems?.map((orderitem) => {
    if (
      // orderItem
      //   ? same(orderItem?.s_no, orderitem?.s_no)
      //   : isPromoApplicable(promo, orderItem) &&
      //     same(orderitem?.disc_name, "None")
      same(orderItem?.s_no, orderitem?.s_no) &&
      isPromoApplicable(promo, orderItem) &&
      same(orderitem?.disc_name, "None")
    ) {
      return calcOrderItemDiscount(
        orderitem,
        {
          disc_type: promo?.criteria_disc_type,
          disc_name: promo?.promo_name,
          disc_value: promo?.criteria_disc_value,
        },
        newOrderItems
      );
    } else {
      return orderitem;
    }
  });

  return newOrderItems;
};

/**
 * Processes lowest price discount promo and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
const processLowestPriceDiscountPromo = (
  promo: any,
  orderItems: any[],
  orderItem: any
) => {
  const { setLastSNo, setSelectedOrderItemSNo } = useOrder();

  let newOrderItems = [...orderItems];

  // set deal criteria
  if (same(promo?.by_item, "SD")) {
    const { sets, _insert, _delete, _orderItems } = getPromoSets(
      promo,
      newOrderItems,
      orderItem
    );
    if (_insert) {
      newOrderItems = _orderItems?.map((orderitem) => ({ ...orderitem }));
      sets?.forEach((set) => {
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
            let s_no = Math.max(...newOrderItems.map((item) => item?.s_no)) + 1;
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
              return calcOrderItemDiscount(
                {
                  ...item,
                  disc_name: promo?.promo_name,
                  ref_1: orderItem?.s_no,
                  ref_2: 1,
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
                ref_2: 1,
              };
            } else {
              return item;
            }
          });
        }
      });
    } else if (_delete) {
      newOrderItems = resetSetPromo(promo, newOrderItems, orderItem);
    }
  }

  // there is no selected categories / items criteria currently

  return newOrderItems;
};

/**
 * Processes free item by limit promo and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
const processFreeItemByLimitPromo = (
  promo: any,
  orderItems: any[],
  orderItem: any
) => {
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
      for (const orderitem of newOrderItems) {
        if (
          // parent items
          same(orderitem?.parent_sno, orderitem?.s_no) &&
          // non-discounted items, except item discount items
          (same(
            findPromoByName(orderitem?.disc_name)?.criteria_type,
            PROMO_TYPE.ITEM_DISCOUNT
          )
            ? true
            : same(orderitem?.disc_name, "None")) &&
          // meet subtotal
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

  return { processOrderItem, orderItems: newOrderItems };
};

/**
 * Processes free item by value promo and returns new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
const processFreeItemByValuePromo = (
  promo: any,
  orderItems: any[],
  orderItem: any
) => {
  let newOrderItems = [...orderItems];
  let processOrderItem = null;

  if (isPromoApplicable(promo, orderItem)) {
    for (const orderitem of newOrderItems) {
      if (
        // parent items
        same(orderitem?.parent_sno, orderitem?.s_no)
        //  &&
        // // non-discounted items, except item discount items
        // (same(thisPromo?.criteria_type, PROMO_TYPE.ITEM_DISCOUNT)
        //   ? true
        //   : same(orderitem?.disc_name, "None"))
      ) {
        const sub_total = orderItems
          ?.filter((item) => same(item?.parent_sno, orderItem?.s_no))
          ?.map((item) => item?.sub_total)
          ?.reduce((acc, val) => acc + val, 0);
        const insertedFreeItemsQty = getInsertedFreeItems(
          promo,
          newOrderItems?.filter((orderitem) =>
            same(orderitem?.parent_sno, orderItem?.s_no)
          )
        )
          ?.map((orderitem) => orderitem?.qty)
          ?.reduce((acc, val) => acc + val, 0);
        const maxFreeItemQty =
          Math.floor(sub_total / promo?.receipt_terms_amount) *
          promo?.criteria_free_item_qty_limit;
        // meet subtotal
        if (sub_total >= promo?.receipt_terms_amount) {
          if (
            same(promo?.receipt_amt_check_by, "O") &&
            insertedFreeItemsQty <= 0
          ) {
            processOrderItem = orderitem;
            break;
          } else if (same(promo?.receipt_amt_check_by, "E")) {
            if (insertedFreeItemsQty < maxFreeItemQty) {
              processOrderItem = orderitem;
              break;
            } else if (insertedFreeItemsQty > maxFreeItemQty) {
              newOrderItems = resetSetPromo(promo, newOrderItems, orderItem);
              processOrderItem = orderitem;
              break;
            }
          }
        } else {
          newOrderItems = resetSetPromo(promo, newOrderItems, orderItem);
        }
      }
    }
  }

  return { processOrderItem, orderItems: newOrderItems };
};

/**
 * Insert discount name for all parent items in the set for manual free item promo and return new order items.
 * @param {any} promo - The promo object.
 * @param {any[]} orderItems - The array of order items.
 * @param {any} orderItem - The order item object.
 * @returns {any[]} The array of new order items.
 */
export const insertDiscountName = (
  promo: any,
  orderItems: any[],
  orderItem: any
) => {
  let newOrderItems = [...orderItems];

  if (
    getInsertedFreeItems(
      promo,
      newOrderItems?.filter((item) => same(item?.parent_sno, orderItem?.s_no))
    )?.length > 0
  ) {
    // set deal criteria
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
      //  insert discount name for all parent items in this set
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
    // selected category / item criteria
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
const resetSetPromo = (promo: any, orderItems: any[], orderItem: any) => {
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
const findPromoByName = (name: string) => {
  return useCache()?.promos?.find((promo) => same(promo?.promo_name, name));
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
export const getSysSetting = (group_name: string, param_id: string) => {
  return (
    useCache()?.systemSettings?.find((item) =>
      same(item?.group_name, group_name)
    )?.setting_group_dtls || []
  )?.find((item) => same(item?.sys_param_id, param_id))?.sys_param_value;
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
export const getNewOrder = (data?: any) => {
  const { date, store } = useCache();

  const service_type = data?.service_type || "E";

  const service_type_info = SERVICE_TYPES?.find((item) =>
    same(item?.service_type, service_type)
  )?.service_type_info;

  const table_no = data?.table_no || "";

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
  });

  return newOrder;
};

/**
 * Get last s_no.
 * @param {any[]} orderItems - The array of order items.
 * @returns {number} The last s_no.
 */
export const getLastSNo = (orderItems: any[]) => {
  return Math.max(...(orderItems || []).map((item) => parseInt(item?.s_no)), 0);
};

/**
 * Convert order items to parent-children format.
 * @param {any[]} orderItems - The array of order items.
 * @returns {any[]} The array of parent-children order items.
 */
export const formatOrderItemsToParentChild = (orderItems: any[]) => {
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
export const resetRounding = (order: any) => {
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
export const needMandatoryItemRemarks = (item: any) => {
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
export const processTakeAwayCharge = (orderItems: any[]) => {
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
export const processTotalDiscountPromo = (orderItems: any[]) => {
  const { promos } = useCache();

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
export const getNowWithLoginDate = (): dayjs.Dayjs => {
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
export const getMenuItems = (
  variant: "category" | "item",
  menuItems: any[],
  all: boolean,
  rootCategory: any[],
  selectedCategory: any[]
) => {
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
 * Get menu category columns.
 * @returns {number} The menu category columns.
 */
export const getMenuCategoryColumns = () => {
  return (
    parseInt(
      getSetting("MORE", "ORDERING", "MENU_CATEGORY_COLUMNS") ||
        DEFAULT_MENU_CATEGORY_COLUMNS
    ) || 4
  );
};

/**
 * Get menu category rows.
 * @returns {number} The menu category rows.
 */
export const getMenuCategoryRows = () => {
  return 2;
};

/**
 * Get menu item columns.
 * @returns {number} The menu item columns.
 */
export const getMenuItemColumns = () => {
  return (
    parseInt(
      getSetting("MORE", "ORDERING", "MENU_ITEM_COLUMNS") ||
        DEFAULT_MENU_ITEM_COLUMNS
    ) || 4
  );
};

/**
 * Get menu item rows.
 * @returns {number} The menu item rows.
 */
export const getMenuItemRows = () => {
  return 4;
};

// /**
//  * Check cash recon status.
//  * @param {string} registerName - The register name.
//  * @param {boolean} silent - True if silent, false otherwise.
//  * @param {boolean} noLoading - True if no loading, false otherwise.
//  * @returns {boolean} True if unable to order, false otherwise.
//  */
// export const checkCashReconStatus = async (
//   registerName?,
//   silent = false,
//   noLoading = false
// ) => {
//   const { setUnableToOrder } = useOrder();

//   let unableToOrder = true;
//   let status = null;

//   const resData = await getCashReconStatus({
//     info: { registerName },
//     silent,
//     noLoading,
//   });
//   if (resData) {
//     // last working day is not closed
//     if (
//       same(
//         resData["last_working_day_close_status"],
//         CASH_RECON_STATUS.LAST_WORKING_DAY_NOT_CLOSED
//       )
//     ) {
//       status = CASH_RECON_STATUS.LAST_WORKING_DAY_NOT_CLOSED;
//       if (!silent) {
//         toastify("Lastworkingdayisnotclosed", STATUS.FAIL, false, {
//           date: dayjs(resData["last_working_date"], "YYYYMMDD").format(
//             DATE_FORMAT
//           ),
//         });
//       }
//     }

//     // cash in not done
//     else if (
//       same(resData["cash_in_status"], CASH_RECON_STATUS.CASH_IN_NOT_DONE)
//     ) {
//       status = CASH_RECON_STATUS.CASH_IN_NOT_DONE;
//       if (!silent) {
//         toastify("CashinnotdonePleasecashinfirst", STATUS.FAIL);
//       }
//     }

//     // shift already closed
//     else if (
//       same(
//         resData["shift_close_status"],
//         CASH_RECON_STATUS.SHIFT_ALREADY_CLOSED
//       )
//     ) {
//       status = CASH_RECON_STATUS.SHIFT_ALREADY_CLOSED;
//       if (!silent) {
//         toastify(
//           "CurrentshiftisalreadyclosedCreatingormodifyingsalesisnotallowed",
//           STATUS.FAIL
//         );
//       }
//     }

//     // day already closed
//     else if (
//       same(resData["day_close_status"], CASH_RECON_STATUS.DAY_ALREADY_CLOSED)
//     ) {
//       status = CASH_RECON_STATUS.DAY_ALREADY_CLOSED;
//       if (!silent) {
//         toastify(
//           "CurrentlogidatenisclosedCreatingormodifyingsalesisnotallowed",
//           STATUS.FAIL
//         );
//       }
//     }

//     // other cases
//     else {
//       unableToOrder = false;
//     }
//   }
//   setUnableToOrder(unableToOrder);
//   return { unableToOrder, status, original: resData };
// };

// /**
//  * Get default order page.
//  * @returns {string} The default order page.
//  */
// export const getDefaultOrderPage = async () => {
//   let menu = null;
//   const { menu: menuCache } = useCache();
//   if (menuCache) {
//     menu = menuCache;
//   } else {
//     menu = await getMenu();
//   }
//   const activeOrdersMenuName = routes?.find((route) =>
//     same(route?.path, "/active-orders")
//   )?.key;
//   if (
//     menu?.find((menuitem) => same(menuitem?.menu_name, activeOrdersMenuName))
//   ) {
//     return "/active-orders";
//   } else {
//     return "/order";
//   }
// };

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
export const isOpenItem = (item: any) => {
  return item?.item_name?.toUpperCase()?.startsWith(OPEN_ITEM_PREFIX);
};

/**
 * Check if item is addon item.
 * @param {object} orderItem - The order item.
 * @returns {boolean} True if item is addon item, false otherwise.
 */
export const isAddonItem = (orderItem: any) => {
  return orderItem?.ds_no >= ADDON_STARTING_DS_NO;
};

/**
 * Calculate set menu item price.
 * @param {any[]} orderItems - The order items.
 * @param {any} orderItem - The order item.
 * @returns {any[]} The new order items.
 */
export const calcSetMemuItemPrice = (orderItems: any[], orderItem: any) => {
  const { items } = useCache();

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
export const minimiseSNo = (orderItems: any[]) => {
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

// /**
//  * Check if can generate table QR.
//  * @returns {boolean} True if can generate table QR, false otherwise.
//  */
// export const canGenerateTableQR = () => {
//   const { menu } = useCache();
//   if (menu?.length > 0) {
//     const generateTableQRMenuName = routes?.find((route) =>
//       same(route?.path, "/generate-table-qr")
//     )?.key;
//     return bool(
//       menu?.find((menuitem) =>
//         same(menuitem?.menu_name, generateTableQRMenuName)
//       )
//     );
//   }
//   return false;
// };

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
export const preprocessKitchenInfo = (kitchenInfo: any, orderItems: any) => {
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
export const needRounding = (payments: any[]) => {
  const { paymentModes } = useCache();
  const paymentDetails = paymentModes?.flatMap(
    (paymentmode) => paymentmode?.pymt_type_details
  );

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
export const getPreorderServiceType = (order_type: string) => {
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
export const getNewPreOrder = (data?) => {
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

// /**
//  * Process auto logout.
//  * @returns {Promise<void>}
//  */
// export const processAutoLogout = async () => {
//   const { date, store, register } = useCache();
//   const { unableToOrder } = useOrder();

//   if (unableToOrder) return false;

//   let process = false;

//   const weekday = dayjs(date, DATE_FORMAT)?.format("dddd");

//   let st_time = null;
//   let ed_time = null;
//   let next_day_st_time = null;
//   let next_day_ed_time = null;

//   switch (weekday) {
//     case WEEKDAY.SUNDAY:
//       st_time = store?.sun_st_time;
//       ed_time = store?.sun_ed_time;
//       next_day_st_time = store?.mon_st_time;
//       next_day_ed_time = store?.mon_ed_time;
//       break;
//     case WEEKDAY.MONDAY:
//       st_time = store?.mon_st_time;
//       ed_time = store?.mon_ed_time;
//       next_day_st_time = store?.tue_st_time;
//       next_day_ed_time = store?.tue_ed_time;
//       break;
//     case WEEKDAY.TUESDAY:
//       st_time = store?.tue_st_time;
//       ed_time = store?.tue_ed_time;
//       next_day_st_time = store?.wed_st_time;
//       next_day_ed_time = store?.wed_ed_time;
//       break;
//     case WEEKDAY.WEDNESDAY:
//       st_time = store?.wed_st_time;
//       ed_time = store?.wed_ed_time;
//       next_day_st_time = store?.thu_st_time;
//       next_day_ed_time = store?.thu_ed_time;
//       break;
//     case WEEKDAY.THURSDAY:
//       st_time = store?.thu_st_time;
//       ed_time = store?.thu_ed_time;
//       next_day_st_time = store?.fri_st_time;
//       next_day_ed_time = store?.fri_ed_time;
//       break;
//     case WEEKDAY.FRIDAY:
//       st_time = store?.fri_st_time;
//       ed_time = store?.fri_ed_time;
//       next_day_st_time = store?.sat_st_time;
//       next_day_ed_time = store?.sat_ed_time;
//       break;
//     case WEEKDAY.SATURDAY:
//       st_time = store?.sat_st_time;
//       ed_time = store?.sat_ed_time;
//       next_day_st_time = store?.sun_st_time;
//       next_day_ed_time = store?.sun_ed_time;
//       break;
//   }

//   // operation end time is before next day operation start time (past midnight)
//   if (
//     dayjs(ed_time, TIME_FORMAT)?.isBefore(dayjs(next_day_st_time, TIME_FORMAT))
//   ) {
//     // now weekday is same as login date next weekday
//     if (
//       same(
//         dayjs()?.format("dddd"),
//         dayjs(date, DATE_FORMAT)?.add(1, "day")?.format("dddd")
//       )
//     ) {
//       // now is after operation end time
//       if (dayjs().format(TIME_FORMAT) > ed_time) {
//         process = true;
//       }
//     }
//   }
//   // operation end time is after next day operation start time (normal operation)
//   else {
//     // now is after operation end time
//     if (dayjs().format(TIME_FORMAT) > ed_time) {
//       process = true;
//     }
//   }

//   if (process) {
//     const { unableToOrder } = await checkCashReconStatus(
//       register?.register_name,
//       true,
//       true
//     );
//     if (unableToOrder) {
//       logout();
//       return unableToOrder;
//     }
//   }

//   return false;
// };

// /**
//  * Check if active orders page is available.
//  * @returns {boolean} True if active orders page is available, false otherwise.
//  */
// export const haveActiveOrdersPage = () => {
//   const { menu } = useCache();

//   return contains(
//     menu?.map((item) => item?.menu_name),
//     routes?.find((route) => same(route.path, "/active-orders"))?.key
//   );
// };

/**
 * Get sales service details.
 * @param {any} order - The order.
 * @returns {any[]} The sales service details.
 */
export const getSalesServiceDtls = (order: any) => {
  const { svcs } = useCache();

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
export const getServiceTypeInfo = (serviceType: string) => {
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
export const validateItemMandatoryRemarks = (
  remarks: string,
  remarksItems: any[]
) => {
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
export const isTakeawayItem = (orderItem: any) => {
  return orderItem?.ds_no >= TAKEAWAY_CHARGE_ITEM_STARTING_DS_NO;
};