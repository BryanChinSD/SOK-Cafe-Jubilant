"use client";

import { getMenuCategoryItemTranslations } from "../js/netApi.js";
import { useCache } from "../stores/cache-store.js";
import { useOrder } from "../stores/order-store.js";
import { bool, clone, contains, getNowInAPIFormat, same } from "../utils/common.js";
import {
    ADDON_STARTING_DS_NO,
    FREE_ITEM_BY_VALUE_STARTING_DS_NO,
    PROMO_TYPE,
    SPECIAL_DISCOUNT_WITH_QUANTITY_ITEM_STARTING_DS_NO,
    SPECIAL_PRICE_ITEM_STARTING_DS_NO,
} from "../utils/constants.js";
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
    sortModifierAddonItems,
    sortOrderItems,
    validateItemMandatoryRemarks,
} from "./pos.js";

/**
 * Build visible categories.
 * @returns {any[]} The visible categories.
 */
// TEMPORARY DEBUG VERSION - Replace your current function with this
export const buildVisibleCategories = () => {
    console.log('🔍 buildVisibleCategories DEBUG called');

    const cache = useCache();
    console.log('📊 Cache in buildVisibleCategories:', {
        menuItems: cache.menuItems?.length || 0,
        menuItemsFirst: cache.menuItems?.[0],
        items: cache.items?.length || 0
    });

    // If no menuItems, return empty array
    if (!cache.menuItems || !Array.isArray(cache.menuItems) || cache.menuItems.length === 0) {
        console.error('❌ No menuItems in cache!');
        return [];
    }

    // SIMPLE APPROACH: Extract all categories from all sections
    const allCategories = [];
    const seen = new Set();

    cache.menuItems.forEach((section, sectionIndex) => {
        console.log(`📂 Section ${sectionIndex}:`, {
            sectionKeys: Object.keys(section),
            hasCategories: !!section.category,
            categoriesCount: section.category?.length || 0,
            hasItems: !!section.items,
            itemsCount: section.items?.length || 0
        });

        // Extract categories from this section
        if (section.category && Array.isArray(section.category)) {
            section.category.forEach(cat => {
                if (cat && cat.category_code) {
                    // Skip hidden categories entirely
                    if (String(cat.hide_from_tqr) === "1") return;

                    const categoryCode = cat.category_code.trim();
                    if (!seen.has(categoryCode)) {
                        allCategories.push({
                            ...cat,
                            category_code: categoryCode,
                            root_category_code: cat.root_category_code || 'MAIN',
                            category_name: cat.category_name || categoryCode
                        });
                        seen.add(categoryCode);
                        console.log(`✅ Added category: ${categoryCode}`);
                    }
                }
            });
        }
    });

    console.log('📋 Final categories found:', allCategories);

    // If still no categories, try to extract from items
    if (allCategories.length === 0) {
        console.log('🔄 No categories in menuItems, trying to extract from items...');
        return extractCategoriesFromItems();
    }

    return allCategories;
};

// Fallback: Extract categories from items array
function extractCategoriesFromItems() {
    const cache = useCache();
    const categories = [];
    const seen = new Set();

    if (cache.items && Array.isArray(cache.items)) {
        cache.items.forEach(item => {
            if (item && item.category_code && !seen.has(item.category_code)) {
                categories.push({
                    category_code: item.category_code,
                    category_name: item.category_code,
                    root_category_code: 'MAIN'
                });
                seen.add(item.category_code);
            }
        });
    }

    console.log('📋 Categories from items:', categories);
    return categories;
}



// ✅ Helper function to check if category has visible items
function checkCategoryHasVisibleItems(categoryCode, items = [], menuItems = []) {
    if (!categoryCode) return false;

    // Method 1: Check in items array (preferred)
    if (Array.isArray(items) && items.length > 0) {
        const categoryItems = items.filter(item =>
            item &&
            item.category_code === categoryCode &&
            !isItemHidden(item)
        );

        if (categoryItems.length > 0) {
            console.log(`✅ Category ${categoryCode} has ${categoryItems.length} items in cache`);
            return true;
        }
    }

    // Method 2: Check in menuItems structure (fallback)
    if (Array.isArray(menuItems) && menuItems.length > 0) {
        for (const section of menuItems) {
            if (section.items && Array.isArray(section.items)) {
                const sectionItems = section.items.filter(item =>
                    item &&
                    item.category_code === categoryCode &&
                    !isItemHidden(item)
                );

                if (sectionItems.length > 0) {
                    console.log(`✅ Category ${categoryCode} has ${sectionItems.length} items in menu sections`);
                    return true;
                }
            }
        }
    }

    console.log(`❌ Category ${categoryCode} has no visible items`);
    return false;
}

// ✅ Simple item visibility check (replace with your actual logic)
function isItemHidden(item) {
    if (!item || !item.item_no) return true;

    // Check if item has a valid price
    const price = parseFloat(getPriceByServiceType(item));
    if (isNaN(price) || price <= 0) {
        return true;
    }

    // Add any other hiding logic here
    return false;
}

// ✅ Fallback: If the complex version fails, use this simple version
export const buildVisibleCategoriesSimple = () => {
    const cache = useCache();
    const { menuItems } = cache;

    console.log('🔍 Using SIMPLE category builder');

    if (!Array.isArray(menuItems) || menuItems.length === 0) {
        return [];
    }

    // Simply return all categories from the first section that has them
    const categories = [];
    const seen = new Set();

    menuItems.forEach(section => {
        if (section.category && Array.isArray(section.category)) {
            section.category.forEach(cat => {
                if (cat && cat.category_code && !seen.has(cat.category_code)) {
                    categories.push(cat);
                    seen.add(cat.category_code);
                }
            });
        }
    });

    console.log('📋 Simple categories found:', categories);
    return categories;
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
    )?.filter((item) => {
        const { menu_type, addonName } = getItemInfo(item?.item_no);

        return (
            (!contains(["M", "S", "C"], menu_type) && !addonName
                ? parseFloat(getPriceByServiceType(item)) > 0
                : true) && !isMenuCategoryOrItemHidden("I", item?.item_no)
        );
    });

    return items && items.length > 0;
};

/**
 * Check if a menu category or menu item is hidden.
 * @param {string} type - The type of category.
 * @param {string} category_code - The category code.
 * @returns {boolean} True if the category is hidden, false otherwise.
 */
export const isMenuCategoryOrItemHidden = (type, category_code) => {
    const { stocks } = useCache();

    const stock = stocks?.find(
        (stock) =>
            same(stock?.item_category, category_code) && same(stock?.avl_type, type)
    );
    return stock && bool(stock?.is_emenu_disable);
};

/**
 * Get stock status based on item no.
 * @param {string} item_no - The item no.
 * @returns {any} The stock status.
 */
export const getStockStatus = (item_no) => {
    // Get the whole cache object
    const cache = useCache();

    // Extract the actual array (default to empty array to be safe)
    const stocks = cache.stocks || [];

    // Optional: guard against non-array (just in case)
    const stockArray = Array.isArray(stocks) ? stocks : [];

    const status = {
        isSoldOut: false,
        isOutOfStock: false,
        balQty: Infinity,
        is_emenu_disable: false,
    };

    // Now stockArray is the array, .find works
    const stock = stockArray.find((stock) => same(stock?.item_category, item_no));

    status.isSoldOut = bool(stock?.is_soldout);
    status.isOutOfStock = bool(stock?.is_avl_limit_check) && stock?.bal_qty <= 0;
    status.balQty = bool(stock?.is_avl_limit_check) ? stock?.bal_qty : Infinity;
    status.is_emenu_disable = bool(stock?.is_emenu_disable);

    return status;
};

/**
 * Get item info from item master by item no.
 * @param {string} item_no - The item no.
 * @returns {any} The item info.
 */
export const getItemInfo = (item_no) => {
    const { items, itemRemarks } = useCache();

    const item = items?.find((item) => same(item?.item_no, item_no));
    const menu_type = Array.isArray(item?.itemmaster_menutype)
        ? item?.itemmaster_menutype[0]?.menu_type
        : "";
    //console.log("getItemInfo item_no", item_no);

    const addonName = bool(item?.is_addon_enable) ? item?.add_on_name : null;

    const haveRemarks = (typeof itemRemarks === "string"
        ? JSON.parse(itemRemarks)
        : itemRemarks ?? []
    ).find((remark) => same(remark?.item_no, item_no));

    const priceList = item?.selling_uom_dtls?.[0]?.price_dtls?.[0];
    //console.log("getItemInfo priceList", priceList);

    const selling_uom_dtls = item?.selling_uom_dtls
        ? item?.selling_uom_dtls[0]
        : null;
    //console.log("getItemInfo menu_type", menu_type);
    //console.log("getItemInfo item", item);
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
    const { items = [], date } = useCache(); // Default to empty array
    const { order, lastSNo = 0, orderSeq = 1 } = useOrder(); // Default values for safety

    // 1. ATTEMPT CACHE LOOKUP, FALLBACK TO PASSED OBJECT
    // If 'items' is empty during a "start over", we use the data already in menuItem
    const cachedItem = items.find((it) => it.item_no === menuItem.item_no);
    const item = cachedItem || menuItem;

    console.log("🔍 addAlacarteItem Trace:", {
        searchId: menuItem.item_no,
        foundInCache: !!cachedItem,
        orderType: localStorage.getItem("orderType")
    });

    let newOrderItems = clone(order?.sales_dtls || []);
    let processFreeItemSelection = null;

    // 2. VALIDATE WE HAVE ENOUGH DATA TO PROCEED
    if (item) {
        const orderType = localStorage.getItem("orderType") || "E";
        const isTakeAway = orderType === "T" ? "Y" : "N";

        // Incremental S_NO safety
        const s_no = (lastSNo || 0) + 1;

        // Extract pricing from UOM details OR fallback to properties on the item itself
        const uom_dtl = item?.selling_uom_dtls?.[0] || {
            uom: item.uom || 'Unit',
            uom_cf: item.uom_cf || 1,
            price_dtls: [{ price: item.unit_price || item.price || 0 }]
        };

        const qty = menuItem.qty || 1;

        // Calculate price based on service type (Dine-in vs Take-away)
        const unit_price = uom_dtl.price_dtls
            ? getPriceByServiceType(uom_dtl.price_dtls[0], orderType)
            : (parseFloat(item.unit_price) || 0);

        const sub_total = qty * unit_price;

        const newOrderItem = {
            s_no,
            parent_sno: s_no,
            ds_no: menuItem.ds_no || 0,
            seat_no: 1,
            category_code: item.category_code || menuItem.category_code,
            item_no: item.item_no || menuItem.item_no,
            item_name: item.item_name || menuItem.item_name,
            item_desc: item.item_desc || menuItem.item_desc,
            remarks: menuItem?.remarks || "",
            qty,
            uom: uom_dtl.uom,
            uom_cf: uom_dtl.uom_cf,
            unit_price,
            disc_type: "N",
            disc_name: "None",
            disc_value: 0,
            disc_amt: 0,
            sub_total,
            pro_disc_amt: 0,
            svc_amt: "0.000000",
            is_apply_svc: item?.is_apply_svc !== undefined ? item.is_apply_svc : 1,
            tax_amt: "0.000000",
            tax_rate: item?.tax_value || 0,
            tax_value: item?.tax_value || 0,
            is_absorbtax: typeof isAbsorbTax === 'function' ? isAbsorbTax(item) : 0,
            take_away_item: isTakeAway,
            order_seq: orderSeq || 1,
            order_seq_type: "New",
            order_datetime: getNowInAPIFormat(),
            print_flag: "N",
            item_kds_ready_status: "N",
            item_kds_ready_datetime: getNowInAPIFormat(),
            item_kds_serve_status: "N",
            item_kds_serve_datetime: getNowInAPIFormat(),
            override_f: 0,
            is_addon_enable: item?.is_addon_enable || 0,
            add_on_name: item?.add_on_name || "",
            menu_type: "",
            modifier_name: "",
            ref_1: "",
            ref_2: "",
            ref_3: "",
            ref_4: "",
        };

        newOrderItems.push(addTax(newOrderItem));

        // APPLY PROMOTIONS
        const promoResult = applyPromotions(newOrderItems, newOrderItem);
        newOrderItems = promoResult.orderItems;
        processFreeItemSelection = promoResult.process;

        console.log("✅ newOrderItems updated:", newOrderItems.length);
    } else {
        console.error("❌ Critical: Item definition missing in addAlacarteItem");
    }

    return {
        orderItems: calcOrderAmt({ ...order, sales_dtls: newOrderItems }),
        processFreeItemSelection,
    };
};

/**
 * Add space before and after plus sign.
 * @param {string} text - The text.
 * @returns {string} The text with space before and after plus sign.
 */
export const addSpaceBeforeAndAfterPlusSign = (text) => {
    return text.replace(/\+/g, " + ");
};

/**
 * Add item have modifier or addon.
 * @param {any} value - The value.
 * @returns {any} The order items.
 */
export const addItemHaveModifierOrAddon = (value, editingOrderItemSNo) => {
    const { order } = useOrder();
    console.log("addItemHaveModifierOrAddon", value);
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
    const processFreeItemSelection = process; // ✅ CAPTURE

    console.log("orderItems", calcOrderAmt({ ...order, sales_dtls: newOrderItems }));
    return {
        orderItems: calcOrderAmt({ ...order, sales_dtls: newOrderItems }),
        processFreeItemSelection, // ✅ RETURN
    };
};

/**
 * Populate parent, modifier or addon items when open menu item details.
 * @param item - The item.
 * @param editingOrderItemSNo - The editing order item s no.
 * @returns {any} The order items.
 */
export const populateParentAndAddonItems = (item, editingOrderItemSNo) => {
    const { order, lastSNo, orderSeq } = useOrder();
    const { date } = useCache();

    let newSelectionItems = [];

    const { menu_type, selling_uom_dtls } = getItemInfo(item?.item_no);

    const orderItems = order?.sales_dtls || [];

    if (selling_uom_dtls) {
        const isModifier = contains(["M", "S", "C"], menu_type);
        const price = getPriceByServiceType(selling_uom_dtls?.price_dtls[0]);
        console.log("isModifier", isModifier);
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
                order_datetime: getNowInAPIFormat(),
                print_flag: "N",
                item_kds_ready_status: "N",
                item_kds_ready_datetime: getNowInAPIFormat(),
                item_kds_serve_status: "N",
                item_kds_serve_datetime: getNowInAPIFormat(),
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
    //console.log("newSelectionItems", newSelectionItems);
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
    //console.log("addModifierItem selectionItems 1 ", selectionItems)
    if (item) {
        const { modiferItem: newModifierItem, exceed: modiferItemExceed } =
            getModifierItem(grp, modifierItem, selectionItems);
        exceed = modiferItemExceed;
        console.log("item 1",item);
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
            console.log("selectedModifierItem 2", selectedModifierItem);
            console.log("a.ds_no - b.ds_no 2", (newSelectionItems.sort((a, b) => a.ds_no - b.ds_no)));


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
    const isTakeAway = localStorage.getItem("orderType") === "T" ? "Y" : "N";

    let exceed = false;

    const { item, menu_type, priceList } = getItemInfo(modifierItem?.citem_no);
    console.log("item", item);
    const orderItems = order?.sales_dtls || [];
    console.log("orderItems", orderItems);
    console.log("selectionItems", selectionItems);
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
    console.log("ds_no", ds_no);
    //console.log("_price", _price);
    //console.log("menu_type", menu_type);
  
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
        take_away_item: isTakeAway,
        order_seq: orderSeq,
        order_seq_type: "New",
        order_datetime: getNowInAPIFormat(),
        print_flag: "N",
        item_kds_ready_status: "N",
        item_kds_ready_datetime: getNowInAPIFormat(),
        item_kds_serve_status: "N",
        item_kds_serve_datetime: getNowInAPIFormat(),
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

    //console.log("item", item);

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
export const modifierMaxQtyAvail = (grp, selectionItems) => {
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
export const modifierGroupLimitAvail = (grp, selectionItems) => {
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
export const addonGroupLimitAvail = (grp, selectionItems) => {
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
export const addonMaxQtyAvail = (grp, selectionItems) => {
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

    const { addonName } = getItemInfo(selectionItems[0]?.item_no);

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
 * @param grp - The addon group.o
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
    console.log("addAddonItem", item);
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
        order_datetime: getNowInAPIFormat(),
        print_flag: "N",
        item_kds_ready_status: "N",
        item_kds_ready_datetime: getNowInAPIFormat(),
        item_kds_serve_status: "N",
        item_kds_serve_datetime: getNowInAPIFormat(),
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
export const getSelectionItems = (selectionItems, editingOrderItemSNo) => {
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
                        order_datetime: getNowInAPIFormat(),
                        print_flag: "N",
                        item_kds_ready_status: "N",
                        item_kds_ready_datetime: getNowInAPIFormat(),
                        item_kds_serve_status: "N",
                        item_kds_serve_datetime: getNowInAPIFormat(),
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
    console.log("newOrderItems", newOrderItems);
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
    Object.values(groupedByOrderSeq).forEach((group) => {
        newOrderItems.push(group);
    });

    return newOrderItems;
};

/**
 * Calculate the remaining stock quantity based on items already in the order.
 * @param balQty - The current balance quantity available in stock
 * @param item_no - The item number to check
 * @param orderItems - Array of order items to check against
 * @returns The remaining stock quantity after accounting for ordered items
 */
export const getRemainingStockBasedOnOrderedItems = (balQty, item_no, orderItems) => {
    const orderedQty = orderItems
        ?.filter((orderitem) => same(orderitem?.item_no, item_no))
        ?.reduce((acc, orderitem) => acc + (orderitem?.qty || 0), 0);
    return balQty - orderedQty;
};

/**
 * Get the available modifier items for a given modifier and group.
 * @param modifier - The modifier.
 * @param grp - The group.
 * @returns The available modifier items.
 */
export const getAvailableModifierItems = (modifier, grp) => {
    const { items } = useCache();

    return sortModifierAddonItems(modifier?.itemmaster_menutypedtls || [])
        ?.map((item) => {
            const found = items?.find((_item) =>
                same(_item?.item_no, item?.citem_no)
            );

            const {
                isSoldOut: isChildItemSoldOut,
                isOutOfStock: isChildItemOutOfStock,
                balQty: childItemBalQty,
                is_emenu_disable: isChildItemEmenuDisable,
            } = getStockStatus(item?.citem_no);

            if (
                same(item?.modifier_name, grp?.modifier_name) &&
                found &&
                !isChildItemEmenuDisable
            ) {
                return {
                    ...item,
                    isSoldOut: isChildItemSoldOut,
                    isOutOfStock: isChildItemOutOfStock,
                    balQty: childItemBalQty,
                    is_emenu_disable: isChildItemEmenuDisable,
                };
            }
        })
        ?.filter((item) => !!item);
};

/**
 * Get the available addon items for a given addon and group.
 * @param addon - The addon.
 * @param grp - The group.
 * @returns The available addon items.
 */
export const getAvailableAddonItems = (addon, grp) => {
    // ✅ Get items with fallback
    let { items } = useCache();

    if (!items?.length) {
        items = window.apiManager?.loadedData?.get('FullItems')
            || JSON.parse(sessionStorage.getItem('FullItems') || '[]');

        if (items?.length) {
            console.log(`⚡ getAvailableAddonItems: using FullItems fallback (${items.length} items)`);
        }
    }

    return (sortModifierAddonItems(addon?.item_dtls) || [])
        ?.map((item) => {
            const found = items?.find((_item) => same(_item?.item_no, item?.item_no));
            const { isSoldOut, isOutOfStock, balQty, is_emenu_disable } =
                getStockStatus(item?.item_no);
            if (
                same(item?.category_code, grp?.category_code) &&
                found &&
                !is_emenu_disable
            ) {
                return {
                    ...item,
                    isSoldOut,
                    isOutOfStock,
                    balQty,
                    is_emenu_disable,
                };
            }
        })
        ?.filter((item) => !!item);
};

/**
 * Get the display name of the service type.
 * @returns The display name of the service type.
 */
export const getServiceTypeDisplayName = () => {
    const { order, isPreorder } = useOrder();

    return isPreorder ? "Preorder" : getServiceTypeInfo(order?.service_type);
};

/**
 * Check if the current time is within the operation time.
 * @returns True if the current time is within the operation time, false otherwise.
 */
export const isWithinOperationTime = () => {
    const now = new Date();
    const day = now.getDay(); // 0=Sun … 6=Sat
    const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const prefix = weekdays[day];

    const { store } = useCache();

    const [sh, sm] = (store[`${prefix}_st_time`] || "00:00")
        .split(":")
        .map(Number);
    const [eh, em] = (store[`${prefix}_ed_time`] || "23:59")
        .split(":")
        .map(Number);

    const start = new Date(now);
    start.setHours(sh, sm, 0, 0);
    let end = new Date(now);
    end.setHours(eh, em, 0, 0);

    if (end <= start) {
        if (now <= end) {
            start.setDate(start.getDate() - 1);
        } else {
            end.setDate(end.getDate() + 1);
        }
    }

    return now >= start && now <= end;
};

/**
 * Trasnslate menu category or menu item based on.
 * @param item Menu category or menu item object.
 * @param type `C` = category, `I` = item
 * @returns Trasnlated menu category or menu item.
 */
export const translate = async (input, type) => {   // ✅ async here
    const { langs } = useCache();

    const languageName = SUPPORTED_LOCALES.find(({ value }) =>
        same(locale, value)
    )?.label;

    const language_name = langs?.find((l) =>
        same(l?.language_name, languageName)
    )?.language_name;

    await getMenuCategoryItemTranslations({
        info: { language_name },
    });
};
/**
 * Returns the nutri-grade image path
 * @param item Menu item object  `tqr_nutrition_type`
 * @returns Array with  nutri-grade path if available, otherwise []
 */
export const getNutriPaths = (item) => {
    if (!item) return [];
    const i = (item && item.item) ? item.item : item;
    const val = ((i.tqr_nutrition_type || "") + "").trim();

    return val ? [val] : [];
};

/**
 * Returns the allergen image path(s)
 * @param item Menu item object `tqr_alergin_type`
 * @returns Array of allergen paths split by comma
 */
export const getAllergenPaths = (item) => {
    if (!item) return [];
    const i = (item && item.item) ? item.item : item;
    const raw = ((i.tqr_alergin_type || "") + "").trim();
    if (!raw) return [];
    return Array.from(new Set(
        raw.split(",").map(s => s.trim()).filter(Boolean)
    ));
};


export const getDateBasedOnOperationTime = () => {
    const { store } = useCache();
    const now = dayjs();
    const day = now.day(); // 0=Sun … 6=Sat
    const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const prefix = weekdays[day];

    // parse the two HH:mm strings
    const [sh, sm] = (store[`${prefix}_st_time`] || "00:00")
        .split(":")
        .map(Number);
    const [eh, em] = (store[`${prefix}_ed_time`] || "23:59")
        .split(":")
        .map(Number);
};

/**
 * Get initials from a name for avatar display.
 * @param {string} name - The full name to extract initials from
 * @returns {string} The initials (2 characters) or "?" if name is invalid
 */
export const getInitials = (name) => {
    if (!name || name === "-") return "?";
    const names = name.split(" ");
    if (names.length >= 2) {
        return `${names[0][0]}${names[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
};

/**
 * Checks if a category should stay sticky on the left while scrolling.
 * @param {Object} category - Category object.
 * @returns {boolean} True if mobile_is_sticky === Y
 */

export const isStickyCategory = (category) => {
    return bool(category?.mobile_is_sticky);
};

/**
 * Get the display columns.
 * @returns {number} True if display columns is greater than or equal to 2, false otherwise.
 */
export const getDisplayColumns = () => {
    const { tqrInfo } = useCache();
    return Number(tqrInfo?.ref_2);
};

/**
 * Gets the store's estimated waiting time range.
 * @returns {{ min: any, max: any }}
 */
export const getEstimatedWaitingTimeRange = () => {
    const { store } = useCache();

    return {
        min: store?.mobile_min_wait_time,
        max: store?.mobile_max_wait_time,
    };
};

/**
 * Get the CRM points redeemed as.
 * @returns {string} CRM_POINTS_REDEEMED_AS
 */
export const getCrmPointsRedeemedAs = () => {
    const { tqrInfo } = useCache();

    switch (tqrInfo?.ref_3) {
        case "T":
            return CRM_POINTS_REDEEMED_AS.TENDER;
        case "D":
            return CRM_POINTS_REDEEMED_AS.DISCOUNT;
        default:
            return CRM_POINTS_REDEEMED_AS.TENDER;
    }
};

/**
 * Get the display name of the CRM points redemption.
 * @returns {string} The display name of the CRM points redemption.
 */
export const getCrmPointsRedemptionDisplayName = () => {
    const { tqrInfo } = useCache();

    return tqrInfo?.ref_4 || "CRM POINT";
};

/**
 * Check if the category should not be shown in the menu.
 * @param {Object} category - The category.
 * @returns {boolean} True if the category should not be shown in the menu, false otherwise.
 */
export const hideCategoryFromMenu = (category) => {
    return bool(category?.hide_from_tqr);
};

/**
 * Retrieve the customer info.
 * @param {string} user_id - The user id.
 * @returns {Promise<void>} The customer info.
 */
export const retrieveCustomerInfo = async (user_id) => {
    const crmInfo = getCachedCrmInfo();
    const { setUser } = useUser();
    const { order, setOrder } = useOrder();

    if (same(crmInfo?.crmVendorName, CRM_VENDOR.EBER)) {
        if (user_id) {
            const custeomerInfo = await getEberCustomerInfo({
                info: { user_id },
            });
            if (custeomerInfo) {
                setUser(custeomerInfo);

                setOrder({
                    ...order,
                    customer_code: custeomerInfo?.customer_code,
                    customer: custeomerInfo,
                });
            } else {
                window.location.href = window.location.origin + "/user-not-found";
            }
        }
    }
};

/**
 * Calculates the order amount for TQR.
 * @param {Object} order - The order object.
 * @param {Array} [orderItems] - The order items.
 * @returns {Object} The calculated order amount.
 */
export const calcOrderAmtTQR = (order, orderItems) => {
    const { tqrInfo } = useCache();

    let newOrder = calcOrderAmt(order, orderItems);

    let sub_total = (order?.sales_dtls || [])
        ?.map((item) => parseFloat(item?.sub_total))
        ?.reduce((acc, val) => acc + val, 0);

    let total_svc = (order?.sales_dtls || [])
        ?.map((item) => parseFloat(item?.svc_amt))
        ?.reduce((acc, val) => acc + val, 0);

    let total_tax = (order?.sales_dtls || [])
        ?.map((item) => parseFloat(item?.tax_amt))
        ?.reduce((acc, val) => acc + val, 0);

    sub_total = bool(tqrInfo?.is_payfirst)
        ? sub_total?.toFixed(2) || "0.00"
        : sub_total?.toFixed(6) || "0.000000";

    total_svc = bool(tqrInfo?.is_payfirst)
        ? total_svc?.toFixed(2) || "0.00"
        : total_svc?.toFixed(6) || "0.000000";

    total_tax = bool(tqrInfo?.is_payfirst)
        ? total_tax?.toFixed(2) || "0.00"
        : total_tax?.toFixed(6) || "0.000000";

    newOrder.sub_total = sub_total;
    newOrder.total_svc = total_svc;
    newOrder.total_tax = total_tax;

    return newOrder;
};