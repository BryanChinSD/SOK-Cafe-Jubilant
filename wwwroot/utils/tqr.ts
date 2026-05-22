"use client";

import { useCache } from "../stores/cache-store";
import { useOrder } from "../stores/order-store";

import { bool, clone, contains, getNowInAPIFormat, same } from "./common";
import {
    ADDON_STARTING_DS_NO,
    FREE_ITEM_BY_VALUE_STARTING_DS_NO,
    PROMO_TYPE,
    SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO,
    SPECIAL_PRICE_ITEM_STARTING_DS_NO,
} from "./constants";
import {
    addTax,
    applyPromotions,
    availableNow,
    calcOrderAmt,
    calcOrderItemDiscount,
    calcOrderItemSubtotal,
    calcSetMemuItemPrice,
    desequenceOrderItems,
    getPriceByServiceType,
    getPromo,
    getSysSetting,
    isAbsorbTax,
    isAddonItem,
    isTakeawayItem,
    notFreeItem,
    sequenceOrderItems,
    sortOrderItems,
    validateItemMandatoryRemarks,
} from "./pos";

/**
 * Build visible categories.
 * @returns {any[]} The visible categories.
 */
export const buildVisibleCategories = () => {
  const allCategories = getAllCategoriesInOrder();
  const visibleCategoryCodes = new Set();

  // First pass: identify categories with direct items
  allCategories.forEach((category) => {
    if (hasDirectItems(category.category_code)) {
      visibleCategoryCodes.add(category.category_code);
    }
  });

  // Second pass: recursively add parent categories if any child has content
  const addParentCategories = (categoryCode) => {
    const subCategories = getCategories(categoryCode);
    if (subCategories && subCategories.length > 0) {
      const hasVisibleChild = subCategories.some((subCat) => {
        addParentCategories(subCat.category_code);
        return visibleCategoryCodes.has(subCat.category_code);
      });
      if (hasVisibleChild) {
        visibleCategoryCodes.add(categoryCode);
      }
    }
  };

  // Start from MAIN and work down
  addParentCategories("MAIN");

  // Always include MAIN
  visibleCategoryCodes.add("MAIN");

  return allCategories.filter((category) =>
    visibleCategoryCodes.has(category.category_code)
  );
};

/**
 * Get menu categories by category code.
 * @param {string} category_code - The category code.
 * @returns {any[]} The categories.
 */
export const getCategories = (category_code) => {
  const { menuItems } = useCache();

  const categories = availableNow(
    menuItems?.find(
      ({ root_category_code, category: categories, items }) =>
        same(root_category_code, category_code) &&
        // check categories availability
        ((Array.isArray(categories) && availableNow(categories)?.length > 0) ||
          // check items availability
          (Array.isArray(items) && availableNow(items)?.length > 0))
    )?.category
  );

  return categories;
};

/**
 * Get all menu categories in order.
 * @returns {any[]} The categories.
 */
const getAllCategoriesInOrder = () => {
  const categories = [];

  // Add MAIN category first (as it has its own section) if not disabled
  if (!isMenuCategoryOrItemHidden("C", "MAIN")) {
    categories.push({ category_code: "MAIN", root_category_code: "MAIN" });
  }

  let queue = getCategories("MAIN");
  do {
    const category = queue.shift();
    if (category && !isMenuCategoryOrItemHidden("C", category?.category_code)) {
      categories.push(category);
      const subCategories = getCategories(category?.category_code);
      if (subCategories?.length > 0) {
        // Filter subcategories before adding to queue
        const enabledSubCategories = subCategories.filter(
          (subCat) => !isMenuCategoryOrItemHidden("C", subCat?.category_code)
        );
        queue.unshift(...enabledSubCategories);
      }
    }
  } while (queue?.length > 0);

  return categories;
};

/**
 * Check if a category has menu items.
 * @param {string} category_code - The category code.
 * @returns {boolean} True if the category has menu items, false otherwise.
 */
export const hasDirectItems = (category_code) => {
  const { menuItems } = useCache();

  const items = availableNow(
    menuItems?.find(
      ({ root_category_code, items }) =>
        same(root_category_code, category_code) &&
        Array.isArray(items) &&
        availableNow(items)?.length > 0
    )?.items
  )
    ?.filter((item) => parseFloat(getPriceByServiceType(item)) > 0)
    ?.filter((item) => !isMenuCategoryOrItemHidden("I", item?.item_no));

  return items && items.length > 0;
};

/**
 * Check if a menu category or menu item is hidden.
 * @param {string} type - The type of category.
 * @param {string} category_code - The category code.
 * @returns {boolean} True if the category is hidden, false otherwise.
 */
export const isMenuCategoryOrItemHidden = (
  type: "C" | "I",
  category_code: string
) => {
  const { stocks } = useCache();

  const stock = stocks?.find(
    (stock) =>
      same(stock?.item_category, category_code) && same(stock?.avl_type, type)
  );
  return stock && bool(stock?.is_emenu_disable);
};

/**
 * Get stock status based on item name.
 * @param {string} item_name - The item name.
 * @returns {any} The stock status.
 */
export const getStockStatus = (item_name: string) => {
  const { stocks } = useCache();

  const status = {
    isSoldOut: false,
    isOutOfStock: false,
    balQty: Infinity,
  };

  const stock = stocks?.find((stock) => same(stock?.item_category, item_name));

  status.isSoldOut = bool(stock?.is_soldout);
  status.isOutOfStock = bool(stock?.is_avl_limit_check) && stock?.bal_qty <= 0;
  status.balQty = bool(stock?.is_avl_limit_check) ? stock?.bal_qty : Infinity;

  return status;
};

/**
 * Get item info from item master by item no.
 * @param {string} item_no - The item no.
 * @returns {any} The item info.
 */
export const getItemInfo = (item_no: string) => {
  const { items, itemRemarks } = useCache();

  const item = items?.find((item) => same(item?.item_no, item_no));
  const menu_type = Array.isArray(item?.itemmaster_menutype)
    ? item?.itemmaster_menutype[0]?.menu_type
    : "";

  const addonName = bool(item?.is_addon_enable) ? item?.add_on_name : null;

  const haveRemarks = itemRemarks?.find((remark) =>
    same(remark?.item_no, item_no)
  );

  const priceList = item?.selling_uom_dtls[0]?.price_dtls[0];

  const selling_uom_dtls = item?.selling_uom_dtls
    ? item?.selling_uom_dtls[0]
    : null;

  return {
    item,
    menu_type,
    addonName,
    haveRemarks,
    priceList,
    selling_uom_dtls,
  };
};

/**
 * Add alacarte item to order.
 * @param {any} menuItem - The menu item.
 * @returns {any} The order items.
 */
export const addAlacarteItem = (menuItem) => {
  const { items, date } = useCache();
  const { order, lastSNo, orderSeq } = useOrder();

  const item = items.find((item) => item.item_no === menuItem.item_no) || null;

  let newOrderItems = clone(order?.sales_dtls || []);

  if (item && item?.selling_uom_dtls) {
    const itemDiscountPromo = getPromo(item, PROMO_TYPE.ITEM_DISCOUNT);

    // // accumulate alacarte items
    // if (
    //   bool(getSetting("GENERAL SETTINGS", "ORDERING", "accumulate_items")) &&
    //   // exclude manual choosen free item promo due to the chossen items quantity may be varied
    //   !getPromo(item, [
    //     PROMO_TYPE.FREE_ITEM_WITH_LIMIT,
    //     PROMO_TYPE.FREE_ITEM_BY_VALUE,
    //   ])
    // ) {
    //   const existedOrderItemIndex = orderItems?.findIndex(
    //     (item) =>
    //       // same item
    //       same(item?.item_no, menuItem?.item_no) &&
    //       // same discount
    //       (itemDiscountPromo
    //         ? same(item?.disc_name, itemDiscountPromo?.promo_name)
    //         : true) &&
    //       // alacarte item
    //       same(item?.parent_sno, item?.s_no) &&
    //       // exclude item already have remarks
    //       !item?.remarks &&
    //       // exclude item already have add-ons
    //       orderItems
    //         ?.filter((orderitem) =>
    //           same(orderitem?.parent_sno, item?.parent_sno)
    //         )
    //         ?.every((orderitem) => !isAddonItem(orderitem) && notFreeItem(orderitem)) &&
    //       // exclude item already have discount
    //       same(item?.disc_name, "None")
    //   );
    //   if (existedOrderItemIndex >= 0) {
    //     const selectedOrderItem = orderItems[existedOrderItemIndex];
    //     onQtyChange(
    //       selectedOrderItem?.qty + 1,
    //       orderItems,
    //       selectedOrderItem?.s_no
    //     );
    //     setSelectedOrderItemSNo(selectedOrderItem?.s_no);
    //     return;
    //   }
    // }

    const s_no = lastSNo + 1;

    let newOrderItem = null;

    const selling_uom_dtls = item?.selling_uom_dtls[0];
    const qty = 1;
    const unit_price = getPriceByServiceType(selling_uom_dtls?.price_dtls[0]);
    const sub_total = qty * unit_price;
    newOrderItem = {
      s_no,
      parent_sno: s_no,
      ds_no: 1,
      seat_no: 1,
      category_code: menuItem.category_code,
      item_no: menuItem.item_no,
      item_name: menuItem.item_name,
      item_desc: menuItem.item_desc,
      remarks: menuItem?.remarks || "",
      qty,
      uom: selling_uom_dtls.uom,
      uom_cf: selling_uom_dtls.uom_cf,
      unit_price,
      disc_type: "N",
      disc_name: "None",
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
      take_away_item: contains(["T", "D"], order?.service_type) ? "Y" : "N",
      order_seq: orderSeq,
      order_seq_type: "New",
      order_datetime: getNowInAPIFormat(date),
      print_flag: "N",
      item_kds_ready_status: "N",
      item_kds_ready_datetime: getNowInAPIFormat(date),
      item_kds_serve_status: "N",
      item_kds_serve_datetime: getNowInAPIFormat(date),
      override_f: 0,
      is_addon_enable: item?.is_addon_enable,
      add_on_name: item?.add_on_name,
      menu_type: "",
      modifier_name: "",
      ref_1: "",
      ref_2: "",
      ref_3: "",
      ref_4: "",
    };
    newOrderItems.push(addTax(newOrderItem));

    const { orderItems: tempOrderItems, process } = applyPromotions(
      newOrderItems,
      newOrderItem
    );
    newOrderItems = tempOrderItems;
    // todo - free item logic
    // if (process) {
    //   setShowFreeItemModal(true);
    //   setFreeItemModalPromo(process?.promo);
    // }
  }

  return {
    orderItems: calcOrderAmt({ ...order, sales_dtls: newOrderItems }),
  };
};

/**
 * Add space before and after plus sign.
 * @param {string} text - The text.
 * @returns {string} The text with space before and after plus sign.
 */
export const addSpaceBeforeAndAfterPlusSign = (text: string) => {
  return text.replace(/\+/g, " + ");
};

/**
 * Add item have modifier or addon.
 * @param {any} value - The value.
 * @returns {any} The order items.
 */
export const addItemHaveModifierOrAddon = (value, editingOrderItemSNo?) => {
  const { order } = useOrder();

  let newOrderItems = clone(order?.sales_dtls || []);
  if (editingOrderItemSNo) {
    newOrderItems = (newOrderItems || [])?.filter(
      (item) => item?.parent_sno !== editingOrderItemSNo
    );
  }
  newOrderItems = [...newOrderItems, ...value];

  const { orderItems: tempOrderItems, process } = applyPromotions(
    newOrderItems,
    value[0]
  );
  newOrderItems = sortOrderItems(tempOrderItems);
  // todo - free item logic
  // if (process) {
  //   setShowFreeItemModal(true);
  //   setFreeItemModalPromo(process?.promo);
  // }

  return { orderItems: calcOrderAmt({ ...order, sales_dtls: newOrderItems }) };
};

/**
 * Populate parent, modifier or addon items when open menu item details.
 * @param item - The item.
 * @param editingOrderItemSNo - The editing order item s no.
 * @returns {any} The order items.
 */
export const populateParentAndAddonItems = (item, editingOrderItemSNo?) => {
  const { order, lastSNo, orderSeq } = useOrder();
  const { date } = useCache();

  let newSelectionItems = [];

  const { menu_type, selling_uom_dtls } = getItemInfo(item?.item_no);

  const orderItems = order?.sales_dtls || [];

  if (selling_uom_dtls) {
    const isModifier = contains(["M", "S", "C"], menu_type);
    const price = getPriceByServiceType(selling_uom_dtls?.price_dtls[0]);

    if (!editingOrderItemSNo) {
      const s_no = lastSNo + 1;
      const sub_total = !isModifier ? price : 0;
      const parentItem = addTax({
        s_no,
        parent_sno: 1,
        ds_no: 1,
        seat_no: 1,
        category_code: item.category_code,
        item_no: item.item_no,
        item_name: item.item_name,
        item_desc: item.item_desc,
        remarks: "",
        qty: 1,
        uom: selling_uom_dtls.uom,
        uom_cf: selling_uom_dtls.uom_cf,
        unit_price: sub_total,
        disc_type: "N",
        disc_name: "None",
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
        take_away_item: contains(["T", "D"], order?.service_type) ? "Y" : "N",
        order_seq: orderSeq,
        order_seq_type: "New",
        order_datetime: getNowInAPIFormat(date),
        print_flag: "N",
        item_kds_ready_status: "N",
        item_kds_ready_datetime: getNowInAPIFormat(date),
        item_kds_serve_status: "N",
        item_kds_serve_datetime: getNowInAPIFormat(date),
        override_f: 0,
        is_addon_enable: item?.is_addon_enable,
        add_on_name: item?.add_on_name,
        menu_type,
        modifier_name: "",
        ref_1: "",
        ref_2: "",
        ref_3: "",
        ref_4: "",
      });
      newSelectionItems.push(parentItem);

      // add default modifier items
      (item?.itemmaster_menutypedtls || [])?.forEach((modifierItem) => {
        const grp = item?.itemmaster_menutype_grpdtls.find((item) =>
          same(item?.modifier_name, modifierItem?.modifier_name)
        );
        if (bool(modifierItem?.is_default)) {
          const { modiferItem } = getModifierItem(
            grp,
            modifierItem,
            newSelectionItems
          );

          if (modiferItem) {
            newSelectionItems.push(modiferItem);
          }
        }
      });
    } else {
      newSelectionItems = clone(orderItems);

      newSelectionItems = desequenceOrderItems(
        (newSelectionItems || [])?.filter((item) =>
          same(item?.parent_sno, editingOrderItemSNo)
        )
      )?.filter((item) => notFreeItem(item));

      // clear applied discount
      newSelectionItems = newSelectionItems?.map((item) =>
        calcOrderItemDiscount(item, null, newSelectionItems)
      );

      const parentItem = newSelectionItems[0];

      // reset parent item quantity to 1, and respective child items quantity to follow parent item quantity
      newSelectionItems = newSelectionItems?.map((item) =>
        calcOrderItemSubtotal(
          { ...item, qty: item?.qty / parentItem?.qty },
          newSelectionItems
        )
      );
    }
  }

  return newSelectionItems;
};

/**
 * Add modifier item into selection items.
 * @param grp - The modifier group.
 * @param modifierItem - The modifier item.
 * @param selectionItems - The selection items.
 * @returns {any} The order items.
 */
export const addModifierItem = (grp, modifierItem, selectionItems) => {
  const { items } = useCache();

  let newSelectionItems = clone(selectionItems || []);
  let exceed = false;

  const { item, menu_type } = getItemInfo(modifierItem?.citem_no);

  if (item) {
    const { modiferItem: newModifierItem, exceed: modiferItemExceed } =
      getModifierItem(grp, modifierItem, selectionItems);

    exceed = modiferItemExceed;

    // user manual click
    if (newModifierItem) {
      const parentItem = items?.find((item) =>
        same(item?.item_no, selectionItems[0]?.item_no)
      );

      const groupQty = (selectionItems || [])
        ?.filter(
          (item) =>
            same(item?.modifier_name, grp?.modifier_name) &&
            !isAddonItem(item) &&
            notFreeItem(item)
        )
        ?.map((item) => item.qty)
        ?.reduce((acc, val) => acc + val, 0);

      const isNewItem = !newSelectionItems?.find(
        (modifieritem) =>
          same(modifieritem?.modifier_name, grp?.modifier_name) &&
          same(modifieritem?.item_no, modifierItem?.citem_no) &&
          !isAddonItem(modifieritem) &&
          notFreeItem(modifieritem)
      );

      // group limit toggle logic
      if (
        !bool(grp?.is_optional) &&
        grp?.group_limit === grp?.max_qty &&
        groupQty + (isNewItem ? 1 : 0) >
          grp?.group_limit * newSelectionItems[0]?.qty
      ) {
        // find the first in item which is not the selected item but within same group
        const itemToRemove = newSelectionItems?.find(
          (modifierItem) =>
            same(modifierItem?.modifier_name, grp?.modifier_name) &&
            !same(modifierItem?.item_no, modifierItem?.citem_no)
        );
        if (itemToRemove) {
          newSelectionItems = newSelectionItems?.filter(
            (modifieritem) => modifieritem?.s_no !== itemToRemove?.s_no
          );
        }
      }

      newSelectionItems.push(newModifierItem);
      newSelectionItems.sort((a, b) => a.ds_no - b.ds_no);

      const selectedModifierItem = (newSelectionItems || [])
        ?.filter((item) => !isAddonItem(item) && notFreeItem(item))
        ?.find((item) => same(item.item_no, modifierItem?.citem_no));

      exceed = modifierExceedMaxQty(
        grp,
        selectedModifierItem,
        newSelectionItems
      );

      // recalculate the price of the set menu items
      if (same(menu_type, "S")) {
        newSelectionItems = calcSetMemuItemPrice(newSelectionItems, item);
      }
    }
  }

  return { selectionItems: newSelectionItems, exceed };
};

/**
 * Get modifier item.
 * @param grp - The modifier group.
 * @param modifierItem - The modifier item.
 * @param selectionItems - The selection items.
 * @returns {any} The modifier item.
 */
export const getModifierItem = (grp, modifierItem, selectionItems) => {
  const { order, orderSeq } = useOrder();
  const { date } = useCache();

  let exceed = false;

  const { item, menu_type, priceList } = getItemInfo(modifierItem?.citem_no);

  const orderItems = order?.sales_dtls || [];

  const s_no =
    [...orderItems, ...selectionItems]
      ?.map((item) => item.s_no)
      .reduce((max, val) => Math.max(max, val), 0) + 1;
  const ds_no =
    (selectionItems || [])
      ?.filter((item) => !isAddonItem(item) && notFreeItem(item))
      ?.map((item) => item.ds_no)
      .reduce((max, val) => Math.max(max, val), 0) + 1;
  const _price = same(menu_type, "S")
    ? priceList
    : getPriceByServiceType(modifierItem?.price_dtls[0]);
  const price_per = grp?.price_per;
  let qty = modifierItem?.qty * selectionItems[0]?.qty;
  const unit_price = same(menu_type, "S")
    ? (_price * price_per) / 100 / qty
    : _price;
  const left = modifierMaxQtyAvail(grp, selectionItems);
  if (left && qty > left) {
    if (left > 0) {
      qty = left;
    } else {
      exceed = true;
    }
  }
  const sub_total = unit_price * qty;

  const newModifierItem = addTax({
    s_no,
    parent_sno: ds_no,
    ds_no,
    seat_no: 1,
    category_code: modifierItem?.modifier_name,
    item_no: modifierItem?.citem_no,
    item_name: modifierItem?.citem_name,
    item_desc: modifierItem?.citem_name,
    remarks: modifierItem?.remarks || "",
    qty,
    uom: modifierItem?.uom,
    uom_cf: modifierItem?.uom_cf,
    unit_price,
    disc_type: "N",
    disc_name: "None",
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
    take_away_item: contains(["T", "D"], order?.service_type) ? "Y" : "N",
    order_seq: orderSeq,
    order_seq_type: "New",
    order_datetime: getNowInAPIFormat(date),
    print_flag: "N",
    item_kds_ready_status: "N",
    item_kds_ready_datetime: getNowInAPIFormat(date),
    item_kds_serve_status: "N",
    item_kds_serve_datetime: getNowInAPIFormat(date),
    override_f: 0,
    is_addon_enable: item?.is_addon_enable,
    add_on_name: item?.add_on_name,
    menu_type: "",
    modifier_name: modifierItem?.modifier_name,
    ref_1: "",
    ref_2: "",
    ref_3: "",
    ref_4: "",
  });

  return { modiferItem: newModifierItem, exceed };
};

/**
 * Change the modifier item quantity.
 * @param value - The value.
 * @param grp - The modifier group.
 * @param modifierItem - The modifier item.
 * @param selectionItems - The selection items.
 * @param _return - The return.
 * @returns {boolean} True if the modifier item quantity is changed, false otherwise.
 */
export const changeModifierItemQty = (
  value,
  grp,
  modifierItem,
  selectionItems
) => {
  let newSelectionItems = clone(selectionItems);
  let exceed = false;
  let isZero = false;

  const parentItem = selectionItems[0];

  const { menu_type } = getItemInfo(parentItem?.item_no);

  const selectedModifierItem = (newSelectionItems || [])
    ?.filter((item) => !isAddonItem(item) && notFreeItem(item))
    ?.find((item) => same(item.item_no, modifierItem?.citem_no));

  // disable quantity to be amended to 0
  if (parseInt(value) === 0) {
    newSelectionItems = selectionItems?.filter(
      (item) => !same(item.item_name, modifierItem?.citem_name)
    );
    isZero = true;
  }

  if (!isZero) {
    const tempSelectionItems = [];

    // process quantity
    (selectionItems || [])?.forEach((modifieritem) => {
      if (same(modifieritem?.item_no, modifierItem?.citem_no)) {
        const qty = parseFloat(value);
        tempSelectionItems.push({
          ...modifieritem,
          qty,
          sub_total: qty * modifieritem?.unit_price,
        });
      } else {
        tempSelectionItems.push(modifieritem);
      }
    });

    exceed = modifierExceedMaxQty(
      grp,
      selectedModifierItem,
      tempSelectionItems
    );

    if (!exceed) {
      newSelectionItems = tempSelectionItems;

      // recalculate the price of the set menu items
      if (same(menu_type, "S")) {
        newSelectionItems = calcSetMemuItemPrice(
          newSelectionItems,
          selectedModifierItem
        );
      }
    }
  }

  return { selectionItems: newSelectionItems, exceed, isZero };
};

/**
 * Check if the modifier item exceeds the maximum quantity limit.
 * @param grp - The modifier group.
 * @param modifierItem - The modifier item.
 * @param selectionItems - The selection items.
 * @returns {boolean} True if the modifier item exceeds the maximum quantity limit, false otherwise.
 */
export const modifierExceedMaxQty = (grp, modifierItem, selectionItems) => {
  const parentItem = selectionItems[0];

  const { item } = getItemInfo(parentItem?.item_no);

  const grpQty = (selectionItems || [])
    ?.filter((item) => same(item.modifier_name, modifierItem?.modifier_name))
    ?.map((item) => item.qty)
    ?.reduce((acc, val) => acc + val, 0);
  const itemQty = (selectionItems || [])
    ?.filter(
      (item) =>
        same(item.modifier_name, modifierItem?.modifier_name) &&
        same(item.item_name, modifierItem?.item_name)
    )
    ?.map((item) => item.qty)
    ?.reduce((acc, val) => acc + val, 0);
  const grpMaxQty = grp?.max_qty * selectionItems[0]?.qty;
  const itemMaxQty =
    item?.itemmaster_menutypedtls?.find((item) =>
      same(item.citem_no, modifierItem?.item_no)
    )?.max_qty * selectionItems[0]?.qty;
  return (
    (itemMaxQty && itemQty > itemMaxQty) || (grpMaxQty && grpQty > grpMaxQty)
  );
};

/**
 * Check if the modifier item exceeds the maximum quantity limit.
 * @param grp - The modifier group.
 * @param selectionItems - The selection items.
 * @returns {number} The maximum quantity available.
 */
export const modifierMaxQtyAvail = (grp, selectionItems?) => {
  const orderItems = clone(selectionItems);
  if (grp?.max_qty) {
    return (
      grp?.max_qty * orderItems[0]?.qty -
      (orderItems || [])
        ?.filter(
          (item) =>
            same(item.modifier_name, grp?.modifier_name) &&
            !isAddonItem(item) &&
            notFreeItem(item)
        )
        ?.map((item) => item.qty)
        ?.reduce((acc, val) => acc + val, 0)
    );
  } else {
    return Infinity;
  }
};

/**
 * Check if the modifier group limit is available.
 * @param grp - The modifier group.
 * @param selectionItems - The selection items.
 * @returns {number} The group limit available.
 */
export const modifierGroupLimitAvail = (grp, selectionItems?) => {
  const orderItems = clone(selectionItems);
  if (grp?.group_limit) {
    return (
      grp?.group_limit * orderItems[0]?.qty -
      new Set(
        (orderItems || [])
          ?.filter(
            (item) =>
              same(item.modifier_name, grp?.modifier_name) &&
              !isAddonItem(item) &&
              notFreeItem(item)
          )
          ?.map((orderitem) => orderitem?.item_no)
      )?.size
    );
  } else {
    return Infinity;
  }
};

/**
 * Check if the modifier group limit or maximum quantity is reached.
 * @param grp - The modifier group.
 * @param selectionItems - The selection items.
 * @returns {boolean} True if the modifier group limit or maximum quantity is reached, false otherwise.
 */
export const reachModifierMaxGroupLimitOrMaxQty = (grp, selectionItems) => {
  const groupLimitAvail =
    modifierGroupLimitAvail(grp, selectionItems) === Infinity
      ? true
      : !modifierGroupLimitAvail(grp, selectionItems);
  const maxQtyAvail =
    modifierMaxQtyAvail(grp, selectionItems) === Infinity
      ? true
      : !modifierMaxQtyAvail(grp, selectionItems);
  return groupLimitAvail && maxQtyAvail;
};

/**
 * Check if the addon group limit is available.
 * @param grp - The addon group.
 * @param selectionItems - The selection items.
 * @returns {number} The addon group limit available.
 */
export const addonGroupLimitAvail = (grp, selectionItems?) => {
  const orderItems = clone(selectionItems);
  if (grp?.max_qty) {
    return (
      grp?.max_qty * orderItems[0]?.qty -
      new Set(
        (orderItems || [])
          ?.filter(
            (item) =>
              same(item.category_code, grp?.category_code) && isAddonItem(item)
          )
          ?.map((orderitem) => orderitem?.item_no)
      )?.size
    );
  } else {
    return Infinity;
  }
};

/**
 * Check if the addon group limit or maximum quantity is reached.
 * @param grp - The addon group.
 * @param selectionItems - The selection items.
 * @returns {number} The addon group limit available.
 */
export const addonMaxQtyAvail = (grp, selectionItems?) => {
  const orderItems = clone(selectionItems);
  if (grp?.max_qty) {
    return (
      grp?.max_qty * orderItems[0]?.qty -
      (orderItems || [])
        ?.filter(
          (item) =>
            same(item.category_code, grp?.category_code) && isAddonItem(item)
        )
        ?.map((item) => item.qty)
        ?.reduce((acc, val) => acc + val, 0)
    );
  } else {
    return Infinity;
  }
};

/**
 * Check if the addon item exceeds the maximum quantity limit.
 * @param grp - The addon group.
 * @param addonItem - The addon item.
 * @param selectionItems - The selection items.
 * @returns {boolean} True if the addon item exceeds the maximum quantity limit, false otherwise.
 */
export const addonExceedMaxQty = (grp, addonItem, selectionItems) => {
  const { addons } = useCache();

  const { addonName } = getItemInfo(addonItem?.item_no);

  const qty = (selectionItems || [])
    ?.filter(
      (item) =>
        same(item.modifier_name, addonItem?.modifier_name) && isAddonItem(item)
    )
    ?.map((item) => item.qty)
    ?.reduce((acc, val) => acc + val, 0);
  const grpQty = (selectionItems || [])
    ?.filter(
      (item) =>
        same(item.modifier_name, addonItem?.modifier_name) &&
        isAddonItem(item) &&
        same(item.category_code, addonItem?.category_code)
    )
    ?.map((item) => item.qty)
    ?.reduce((acc, val) => acc + val, 0);
  const itemQty = (selectionItems || [])
    ?.filter(
      (item) =>
        same(item.modifier_name, addonItem?.modifier_name) &&
        isAddonItem(item) &&
        same(item.item_no, addonItem?.item_no)
    )
    ?.map((item) => item.qty)
    ?.reduce((acc, val) => acc + val, 0);

  const addon = addons?.find((item) => same(item?.add_on_name, addonName));

  const maxQty = addon?.qty * selectionItems[0]?.qty;
  const grpMaxQty = grp?.max_qty * selectionItems[0]?.qty;
  const itemMaxQty =
    addon?.item_dtls?.find((item) => same(item.item_no, addonItem?.item_no))
      ?.max_qty * selectionItems[0]?.qty;
  return (
    (itemMaxQty && itemQty > itemMaxQty) ||
    (grpMaxQty && grpQty > grpMaxQty) ||
    (maxQty && qty > maxQty)
  );
};

/**
 * Check if the addon group limit or maximum quantity is reached.
 * @param grp - The addon group.
 * @param selectionItems - The selection items.
 * @returns {boolean} True if the addon group limit or maximum quantity is reached, false otherwise.
 */
export const reachAddonMaxGroupLimitOrMaxQty = (grp, selectionItems) => {
  const groupLimitCheck =
    addonGroupLimitAvail(grp, selectionItems) === Infinity
      ? true
      : !addonGroupLimitAvail(grp, selectionItems);
  const maxQtyCheck =
    addonMaxQtyAvail(grp, selectionItems) === Infinity
      ? true
      : !addonMaxQtyAvail(grp, selectionItems);
  return groupLimitCheck && maxQtyCheck;
};

/**
 * Add an addon item to the selection items.
 * @param addonItem - The addon item.
 * @param grp - The addon group.
 * @param selectionItems - The selection items.
 * @returns {object} The new addon item.
 */
export const addAddonItem = (grp, addonItem, selectionItems) => {
  let newSelectionItems = clone(selectionItems);
  let exceed = false;

  const { item, selling_uom_dtls } = getItemInfo(addonItem?.item_no);

  if (item && selling_uom_dtls) {
    const { addonItem: newAddonItem, exceed: addonItemExceed } = getAddonItem(
      grp,
      addonItem,
      selectionItems
    );

    exceed = addonItemExceed;

    if (newAddonItem) {
      const groupQty = (selectionItems || [])
        ?.filter(
          (item) =>
            same(item?.category_code, grp?.category_code) && isAddonItem(item)
        )
        ?.map((item) => item.qty)
        ?.reduce((acc, val) => acc + val, 0);
      const isNewItem = !newSelectionItems?.find(
        (addonitem) =>
          same(addonitem?.category_code, grp?.category_code) &&
          same(addonitem?.item_no, addonItem.item_no) &&
          isAddonItem(addonitem)
      );
      const addonIsRadioGroup = !bool(addonItem?.is_edit_by_admin);

      // group limit toggle logic
      if (
        // isMandatory &&
        addonIsRadioGroup &&
        grp?.max_qty &&
        groupQty + (isNewItem ? 1 : 0) >
          grp?.max_qty * newSelectionItems[0]?.qty
      ) {
        // find the first in item which is not the selected item but within same group
        const itemToRemove = newSelectionItems?.find(
          (addonitem) =>
            same(addonitem?.category_code, grp?.category_code) &&
            !same(addonitem?.item_no, addonItem.item_no)
        );
        if (itemToRemove) {
          newSelectionItems = newSelectionItems?.filter(
            (addonitem) => addonitem?.s_no !== itemToRemove?.s_no
          );
        }
      }

      newSelectionItems.push(newAddonItem);
      newSelectionItems.sort((a, b) => a.ds_no - b.ds_no);

      const selectedAddonItem = (newSelectionItems || [])
        ?.filter((item) => isAddonItem(item))
        ?.find((item) => same(item.item_desc, addonItem?.item_desc));
      exceed = addonExceedMaxQty(grp, selectedAddonItem, newSelectionItems);
    }
  }

  return { selectionItems: newSelectionItems, exceed };
};

/**
 * Get an addon item.
 * @param grp - The addon group.
 * @param addonItem - The addon item.
 * @param selectionItems - The selection items.
 * @returns {object} The addon item.
 */
export const getAddonItem = (grp, addonItem, selectionItems) => {
  const { order, orderSeq } = useOrder();
  const { date } = useCache();

  let exceed = false;

  const { item } = getItemInfo(addonItem?.item_no);

  const orderItems = order?.sales_dtls || [];

  const unit_price = addonItem?.price;

  const s_no =
    [...orderItems, ...selectionItems]
      ?.map((item) => item.s_no)
      ?.reduce((max, val) => Math.max(max, val), 0) + 1;
  const ds_no =
    (selectionItems || [])
      ?.filter((item) => isAddonItem(item))
      ?.map((item) => item.ds_no)
      ?.reduce((max, val) => Math.max(max, val), ADDON_STARTING_DS_NO) + 1;
  let qty = addonItem?.qty * selectionItems[0]?.qty;
  const left = addonMaxQtyAvail(grp, selectionItems);
  if (left && qty > left) {
    if (left > 0) {
      qty = left;
    } else {
      exceed = true;
    }
  }
  const sub_total = unit_price * qty;

  let newAddonItem = addTax({
    s_no,
    parent_sno: ds_no,
    ds_no,
    seat_no: 1,
    category_code: addonItem.category_code,
    item_no: addonItem.item_no,
    item_name: addonItem.item_desc,
    item_desc: addonItem.item_desc,
    remarks: addonItem?.remarks || "",
    qty,
    uom: addonItem.uom,
    uom_cf: addonItem.uom_cf,
    unit_price,
    disc_type: "N",
    disc_name: "None",
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
    take_away_item: contains(["T", "D"], order?.service_type) ? "Y" : "N",
    order_seq: orderSeq,
    order_seq_type: "New",
    order_datetime: getNowInAPIFormat(date),
    print_flag: "N",
    item_kds_ready_status: "N",
    item_kds_ready_datetime: getNowInAPIFormat(date),
    item_kds_serve_status: "N",
    item_kds_serve_datetime: getNowInAPIFormat(date),
    override_f: 0,
    is_addon_enable: item?.is_addon_enable,
    add_on_name: item?.add_on_name,
    menu_type: "",
    modifier_name: addonItem.modifier_name,
    ref_1: "",
    ref_2: "",
    ref_3: "",
    ref_4: "",
  });

  return { addonItem: newAddonItem, exceed };
};

/**
 * Change the addon item quantity.
 * @param value - The value.
 * @param grp - The addon group.
 * @param addonItem - The addon item.
 * @param selectionItems - The selection items.
 * @returns {boolean} True if the addon item quantity is changed, false otherwise.
 */
export const changeAddonItemQty = (value, grp, addonItem, selectionItems) => {
  let newSelectionItems = clone(selectionItems);
  let exceed = false;
  let isZero = false;

  const { item } = getItemInfo(addonItem?.item_no);

  const selectedAddonItem = newSelectionItems
    ?.filter((item) => isAddonItem(item))
    ?.find((item) => same(item.item_desc, addonItem?.item_desc));

  // disable quantity to be amended to 0
  if (parseInt(value) === 0) {
    newSelectionItems = selectionItems?.filter(
      (item) => !same(item.item_desc, addonItem?.item_desc)
    );
    isZero = true;
  }

  if (!isZero) {
    const tempSelectionItems = [];
    (newSelectionItems || []).forEach((addonitem) => {
      if (
        same(addonitem.item_desc, addonItem?.item_desc) &&
        isAddonItem(addonitem)
      ) {
        const qty = parseFloat(value);
        tempSelectionItems.push({
          ...addonitem,
          qty,
          sub_total: qty * item.unit_price,
        });
      } else {
        tempSelectionItems.push(addonitem);
      }
    });

    exceed = addonExceedMaxQty(grp, selectedAddonItem, tempSelectionItems);

    if (!exceed) {
      newSelectionItems = tempSelectionItems;
    }
  }

  return { selectionItems: newSelectionItems, exceed, isZero };
};

/**
 * Check if the selection is completed.
 * @param item - The item.
 * @param selectionItems - The order items.
 * @returns {boolean} True if the selection is completed, false otherwise.
 */
export const isSelectionCompleted = (item, selectionItems) => {
  const { itemRemarks, addons } = useCache();

  let result = true;

  const { addonName, menu_type } = getItemInfo(item?.item_no);

  const isModifier = !!menu_type;

  const addonItem = addons?.find((addon) =>
    same(addon?.item_no, item?.item_no)
  );

  // check modifier completeness
  if (isModifier) {
    const itemmaster_menutype_grpdtls = item?.itemmaster_menutype_grpdtls;
    for (let i = 0; i < itemmaster_menutype_grpdtls?.length; i++) {
      const item = itemmaster_menutype_grpdtls[i];

      const remarksItems =
        itemRemarks?.find((itemremark) =>
          same(itemremark?.item_no, item?.item_no)
        )?.remarks_item_details || [];

      if (!bool(item?.is_optional)) {
        if (
          new Set(
            (selectionItems || [])
              ?.filter(
                (_item) =>
                  same(_item.modifier_name, item.modifier_name) &&
                  !isAddonItem(_item) &&
                  notFreeItem(_item)
              )
              ?.map((item) => item.item_no)
          )?.size <
          item.group_limit * selectionItems[0]?.qty
        ) {
          result = false;
          break;
        }
        if (
          (selectionItems || [])
            ?.filter(
              (_item) =>
                same(_item.modifier_name, item.modifier_name) &&
                !isAddonItem(_item) &&
                notFreeItem(_item)
            )
            ?.map((item) => item.qty)
            ?.reduce((acc, val) => acc + val, 0) <
          item.max_qty * selectionItems[0]?.qty
        ) {
          result = false;
          break;
        }
      }

      // check remarks completeness
      if (remarksItems?.length > 0) {
        if (
          !(remarksItems?.some((remarksitemdetails) =>
            same(remarksitemdetails?.remarks_group_type, "S")
          )
            ? item?.remarks &&
              validateItemMandatoryRemarks(item?.remarks, remarksItems)
            : true)
        ) {
          result = false;
          break;
        }
      }
    }
  }

  // check addon completeness
  if (addonName && addonItem) {
    const cat_dtls = addonItem?.cat_dtls;
    const isMandatory = bool(addonItem?.is_mobile_enable);
    const isGroupLimit = !bool(addonItem?.is_edit_by_admin);

    const remarksItems =
      itemRemarks?.find((itemremark) =>
        same(itemremark?.item_no, addonItem?.item_no)
      )?.remarks_item_details || [];

    for (let i = 0; i < cat_dtls?.length; i++) {
      const item = cat_dtls[i];
      if (isMandatory) {
        if (isGroupLimit && item?.max_qty) {
          if (
            new Set(
              (selectionItems || [])
                ?.filter(
                  (_item) =>
                    same(_item.category_code, item.category_code) &&
                    isAddonItem(_item)
                )
                ?.map((item) => item.item_no)
            )?.size <
            item.max_qty * selectionItems[0]?.qty
          ) {
            result = false;
            break;
          }
        }
        if (
          (selectionItems || [])
            ?.filter(
              (_item) =>
                same(_item.category_code, item.category_code) &&
                isAddonItem(_item)
            )
            ?.map((item) => item.qty)
            ?.reduce((acc, val) => acc + val, 0) <
          item.max_qty * selectionItems[0]?.qty
        ) {
          result = false;
          break;
        }
      }

      // check remarks completeness
      if (remarksItems?.length > 0) {
        if (
          !(remarksItems?.some((remarksitemdetails) =>
            same(remarksitemdetails?.remarks_group_type, "S")
          )
            ? item?.remarks &&
              validateItemMandatoryRemarks(item?.remarks, remarksItems)
            : true)
        ) {
          result = false;
          break;
        }
      }
    }
  }

  return result;
};

/**
 * Get the selection items.
 * @param selectionItems - The selection items.
 * @param editingOrderItemSNo - The editing order item SNo.
 * @returns {array} The selection items.
 */
export const getSelectionItems = (selectionItems, editingOrderItemSNo?) => {
  const { order } = useOrder();

  const orderItems = order?.sales_dtls || [];

  let newSelectionItems = clone(
    sequenceOrderItems(selectionItems, editingOrderItemSNo) || []
  );

  // recover parent item quantity and respective child items quantity to follow parent item quantity
  if (editingOrderItemSNo) {
    const parentItem = orderItems?.find((orderitem) =>
      same(orderitem?.s_no, editingOrderItemSNo)
    );
    newSelectionItems = newSelectionItems?.map((item) =>
      calcOrderItemSubtotal(
        { ...item, qty: item?.qty * parentItem?.qty },
        newSelectionItems
      )
    );
  }

  // process svc and tax
  newSelectionItems?.map((item) => addTax(item));

  return newSelectionItems;
};

/**
 * Check if the modifier group is done.
 * @param grp - The modifier group.
 * @param selectionItems - The selection items.
 * @returns {boolean} True if the modifier group is done, false otherwise.
 */
export const isModifierGroupDone = (grp, selectionItems) => {
  return bool(grp?.is_optional)
    ? !modifierGroupLimitAvail(grp, selectionItems) ||
        !modifierMaxQtyAvail(grp, selectionItems)
    : (!modifierGroupLimitAvail(grp, selectionItems) ||
        modifierGroupLimitAvail(grp, selectionItems) === Infinity) &&
        !modifierMaxQtyAvail(grp, selectionItems);
};

/**
 * Check if the addon group is done.
 * @param grp - The addon group.
 * @param selectionItems - The selection items.
 * @param isMandatory - The is mandatory.
 * @returns {boolean} True if the addon group is done, false otherwise.
 */
export const isAddonGroupDone = (grp, selectionItems, isMandatory) => {
  return !isMandatory
    ? !addonGroupLimitAvail(grp, selectionItems) ||
        !addonMaxQtyAvail(grp, selectionItems)
    : !addonGroupLimitAvail(grp, selectionItems) &&
        !addonMaxQtyAvail(grp, selectionItems);
};

/**
 * Remove trailing comma from a string value.
 * @param value - The string value to process
 * @returns The string with trailing comma removed
 */
export const removeLastComma = (value) => {
  let newRemarks = value?.trim();
  const lastCommaIndex = newRemarks?.lastIndexOf(",");
  if (lastCommaIndex === newRemarks?.length - 1) {
    newRemarks = newRemarks?.substring(0, newRemarks?.length - 1);
  }

  return newRemarks;
};

/**
 * Select or deselect remarks based on type and existence.
 * @param type - The remarks group type (e.g., "S" for single selection)
 * @param value - The remark value to add or remove
 * @param remarks - The current remarks string
 * @param existed - Whether the remark should be added (true) or removed (false)
 * @returns The updated remarks string with trailing comma
 */
export const selectRemarks = (type, value, remarks, existed) => {
  let remarksList = [];
  let newRemarks = "";

  if (existed) {
    if (!same(type, "S")) {
      remarksList = remarks
        ?.split(",")
        ?.map((remarks) => remarks?.trim())
        ?.filter((remarks) => !!remarks);
    }
    remarksList?.push(value);
  } else {
    remarksList = remarks
      ?.split(",")
      ?.filter((remarks) => !same(remarks, value));
  }

  newRemarks = remarksList?.join(", ");
  newRemarks += ", ";
  return newRemarks;
};

/**
 * Get subtotal within same parent item.
 * @param orderItem - The order item.
 * @returns {string} The subtotal within same parent item.
 */
export const getSubtotalWithinSameParentItem = (orderItem) => {
  const { menu_type } = getItemInfo(orderItem?.item_no);

  const parentItemSubtotal = orderItem?.sub_total;
  const childItemsSubtotal = (orderItem?.childItems || [])
    ?.map((orderItem) => orderItem.sub_total)
    .reduce((acc, val) => acc + val, 0);

  return (
    orderItem?.childItems?.length > 0
      ? menu_type
        ? childItemsSubtotal
        : parentItemSubtotal + childItemsSubtotal
      : parentItemSubtotal
  )?.toFixed(2);
};

/**
 * Delete an order item.
 * @param orderItem - The order item.
 */
export const deleteOrderItem = (orderItem) => {
  const { order, lastSNo, setOrder, setSelectedOrderItemSNo } = useOrder();

  const orderItems = order?.sales_dtls || [];

  let newOrderItems = [];
  let newCanceledOrderItems = [];

  // process delete item
  (sortOrderItems(orderItems) || []).forEach((_item) => {
    if (_item.parent_sno !== orderItem?.parent_sno) {
      newOrderItems.push(_item);
    } else if (_item.s_no <= lastSNo) {
      newCanceledOrderItems.push(_item);
    }
  });

  const { orderItems: tempOrderItems } = applyPromotions(
    newOrderItems,
    orderItem
  );
  newOrderItems = tempOrderItems;

  // process svc and tax
  newOrderItems = (newOrderItems || [])?.map((item) => addTax(item));

  setOrder(calcOrderAmt({ ...order, sales_dtls: newOrderItems }));

  // find previous or next order item's s_no
  const currentIndex = sortOrderItems(orderItems)?.findIndex((item) =>
    same(item.s_no, orderItem.s_no)
  );
  let s_no =
    currentIndex === 0
      ? newOrderItems[0]?.s_no
      : newOrderItems[currentIndex - 1]?.s_no;

  const newSelectedOrderitem = newOrderItems?.find((orderitem) =>
    same(orderitem?.s_no, s_no)
  );
  if (
    // deleted item is modifier / set / combo item but the next going to selected item is addon item
    isAddonItem(newSelectedOrderitem) &&
    !isAddonItem(orderItem) &&
    notFreeItem(orderItem)
  ) {
    s_no = 0;
  } // deleted item is addon item but the next going to selected item is modifier / set / combo item
  else if (
    isAddonItem(orderItem) &&
    !isAddonItem(newSelectedOrderitem) &&
    notFreeItem(newSelectedOrderitem)
  ) {
    const firstAddonItem = newOrderItems
      ?.filter((orderitem) => isAddonItem(orderitem))
      .shift();
    s_no = firstAddonItem?.s_no || 0;
  }

  // auto select last order items
  setSelectedOrderItemSNo?.(s_no);
};

/**
 * Take away an order item.
 * @param orderItem - The order item.
 */
export const takeaway = (orderItem) => {
  const { order, lastSNo, orderSeq, setOrder } = useOrder();
  const { items, date } = useCache();

  const { item } = getItemInfo(orderItem?.item_no);

  const orderItems = order?.sales_dtls || [];

  const take_away_item = orderItem?.take_away_item === "Y" ? "N" : "Y";
  const newOrderItem = {
    ...orderItem,
    take_away_item,
  };
  let newOrderItems = (orderItems || [])?.map((item) => {
    // selected order item
    if (item.s_no === newOrderItem.s_no) {
      return { ...newOrderItem };
    }
    // child order items of selected order item
    else if (item.parent_sno === newOrderItem.s_no) {
      return { ...item, take_away_item };
    }
    // non-selected order item
    else {
      return { ...item };
    }
  });
  newOrderItems = (newOrderItems || [])?.map((item) =>
    calcOrderItemSubtotal(item, newOrderItems)
  );
  newOrderItems = (newOrderItems || [])?.map((item) =>
    calcOrderItemDiscount(
      item,
      {
        disc_type: item?.disc_type,
        disc_name: item?.disc_name,
        disc_value: item?.disc_value,
      },
      newOrderItems
    )
  );
  if (bool(take_away_item)) {
    // todo - apply take away charge item
    const takeAwayChargeItemNo = getSysSetting(
      "System Settings",
      "ta_fixed_item_no"
    );
    if (takeAwayChargeItemNo) {
      const takeAwayChargeItem = items?.find(
        (item) => item?.item_no === takeAwayChargeItemNo
      );
      if (takeAwayChargeItem && takeAwayChargeItem?.selling_uom_dtls) {
        const selling_uom_dtls = takeAwayChargeItem?.selling_uom_dtls[0];
        const qty = orderItem?.qty;
        const unit_price =
          orderItem?.ds_no === 1
            ? orderItem?.takeaway_charge
            : orderItem?.addon_takeaway_charge;
        const ds_no =
          Math.max(
            ...newOrderItems
              ?.filter(
                (item) =>
                  item.parent_sno === orderItem?.parent_sno &&
                  item.ds_no > ADDON_STARTING_DS_NO
              )
              ?.map((item) => item.ds_no),
            ADDON_STARTING_DS_NO
          ) + 1;
        newOrderItems.push(
          addTax({
            s_no: lastSNo + 1,
            parent_sno: orderItem.s_no,
            ds_no,
            seat_no: 1,
            category_code: takeAwayChargeItem.category_code,
            item_no: takeAwayChargeItem.item_no,
            item_name: takeAwayChargeItem.item_name,
            item_desc: takeAwayChargeItem.item_desc,
            remarks: "",
            qty,
            uom: selling_uom_dtls?.uom,
            uom_cf: selling_uom_dtls?.uom_cf,
            unit_price,
            disc_type: "N",
            disc_name: "None",
            disc_value: 0,
            disc_amt: 0,
            sub_total: qty * unit_price,
            pro_disc_amt: 0,
            svc_amt: "0.000000",
            is_apply_svc: takeAwayChargeItem?.is_apply_svc,
            tax_amt: "0.000000",
            tax_rate: takeAwayChargeItem?.tax_value,
            tax_value: takeAwayChargeItem?.tax_value,
            is_absorbtax: isAbsorbTax(takeAwayChargeItem),
            take_away_item: "Y",
            order_seq: orderSeq,
            order_seq_type: "New",
            order_datetime: getNowInAPIFormat(date),
            print_flag: "N",
            item_kds_ready_status: "N",
            item_kds_ready_datetime: getNowInAPIFormat(date),
            item_kds_serve_status: "N",
            item_kds_serve_datetime: getNowInAPIFormat(date),
            override_f: 0,
            is_addon_enable: item?.is_addon_enable,
            add_on_name: item?.add_on_name,
            menu_type: "",
            modifier_name: "",
            ref_1: "",
            ref_2: "",
            ref_3: "",
            ref_4: "",
          })
        );
      }
    }
  } else {
    newOrderItems = newOrderItems?.filter((orderitem) => {
      if (same(orderitem?.parent_sno, orderItem?.parent_sno)) {
        if (isTakeawayItem(orderitem)) {
          return false;
        } else {
          return true;
        }
      } else {
        return true;
      }
    });
  }

  setOrder(calcOrderAmt({ ...order, sales_dtls: newOrderItems }));
};

/**
 * Change the quantity of an order item and its child items.
 * @param {number} value - The new quantity.
 * @param {any} orderItem - The order item.
 */
export const changeItemQuantity = (value, orderItem) => {
  const { order, lastSNo, orderSeq, setOrder } = useOrder();
  const { items, date } = useCache();

  const orderItems = order?.sales_dtls || [];

  // disable quantity to be amended to 0
  if (value === 0) return;

  let newOrderItems = [];
  let newOrderItem = null;
  const setSNo = orderItem?.ref_1;
  // process quantity
  (orderItems || [])?.forEach((item) => {
    // // bundled as a set in promotion, not free item
    // if (
    //   setSNo &&
    //   setSNo === item?.ref_1
    //   // && item?.ds_no <= FREE_ITEM_STARTING_DS_NO
    // ) {
    //   const changes = parseFloat(value) - parseFloat(orderItem?.qty); // plus or minus
    //   const ref_2 = changes + item?.ref_2;
    //   const qty = (item?.qty * ref_2) / item?.ref_2;
    //   if (qty > 0) {
    //     newOrderItems.push({ ...item, qty, ref_2 });
    //   } else {
    //     newOrderItems.push(item);
    //   }
    // }
    // else
    // alacarte order item
    if (item.s_no === orderItem?.s_no && !orderItem?.menu_type) {
      const qty = parseFloat(value);
      // const sub_total = value * item.unit_price;
      const result = {
        ...item,
        qty,
        // sub_total,
      };
      if (!newOrderItem) {
        newOrderItem = result;
      }
      newOrderItems.push(result);
    }
    // free items, special price items, special discount with quantity items
    else if (
      item?.ds_no > FREE_ITEM_BY_VALUE_STARTING_DS_NO &&
      item?.ds_no <= SPECIAL_PRICE_ITEM_STARTING_DS_NO &&
      item?.ds_no <= SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO
    ) {
      newOrderItems.push(item);
    }
    // non-alacarte order item
    else if (item.parent_sno === orderItem?.s_no) {
      const qty = (item.qty / orderItem.qty) * parseFloat(value);
      // const sub_total = item?.menu_type
      //   ? item?.sub_total
      //   : item?.unit_price * qty;
      const result = {
        ...item,
        qty,
        // sub_total,
      };
      if (!newOrderItem) {
        newOrderItem = result;
      }
      newOrderItems.push(result);
    }
    // others
    else {
      newOrderItems.push(item);
    }
  });

  newOrderItems = newOrderItems?.map((orderitem) =>
    calcOrderItemSubtotal(orderitem, newOrderItems)
  );

  const { orderItems: tempOrderItems, process } = applyPromotions(
    newOrderItems,
    newOrderItem
  );
  newOrderItems = tempOrderItems;
  // todo - free item logic
  // if (process) {
  //   setShowFreeItemModal(true);
  //   setFreeItemModalPromo(process?.promo);
  // }

  // process svc and tax
  newOrderItems = (newOrderItems || [])?.map((item) => addTax(item));

  setOrder(calcOrderAmt({ ...order, sales_dtls: newOrderItems }));
};

/**
 * Clear the cart.
 */
export const clearCart = () => {
  const { order, setOrder } = useOrder();

  setOrder(calcOrderAmt({ ...order, sales_dtls: [] }));
};

/**
 * Split the order items by order seq.
 * @param {any[]} sales_dtls - The sales dtls.
 * @returns {any[]} The sales dtls by order seq.
 */
export const splitOrderItemsByOrderSeq = (orderItems) => {
  let newOrderItems = [];
  orderItems?.sort((a, b) => {
    if (a.order_seq !== b.order_seq) {
      return a.order_seq - b.order_seq;
    }
    return a.s_no - b.s_no;
  });

  // Group by order_seq
  const groupedByOrderSeq = {};
  orderItems?.forEach((item) => {
    if (!groupedByOrderSeq[item.order_seq]) {
      groupedByOrderSeq[item.order_seq] = [];
    }
    groupedByOrderSeq[item.order_seq].push(item);
  });

  // Insert each group into salesDtls
    Object.keys(groupedByOrderSeq).forEach(key => {
        newOrderItems.push(groupedByOrderSeq[key]);
    });


  return newOrderItems;
};
