// ============================================
// EBER.JS - Complete Member & Voucher Management
// ============================================

import { useCache } from "../stores/cache-store.js";
import { useOrder } from "../stores/order-store.js";
import { selectOrderType, setKioskLogo, resolveImageUrl } from "../js/GetHomeAPI.js";
import { applyPromotions } from "../utils/pos.js";

// ============================================
// CONSTANTS
// ============================================
const ORIGINAL_URL = window.location.href;
console.log('📍 URL locked:', ORIGINAL_URL);
let isSelectingOrderType = false;

// ============================================
// VOUCHER STATE MANAGEMENT (CONSOLIDATED)
// ============================================
const voucherState = {
    appliedVouchers: [],
    selectedVoucher: null,
    availableVouchers: [],
    loadingVoucher: null,
    previousOrderBeforeVouchers: null,

    isApplied: function (voucherCode) {
        return this.appliedVouchers.some(function (v) {
            return v?.code === voucherCode || v?.raw?.redeem_code === voucherCode;
        });
    },

    setSelected: function (voucher) {
        this.selectedVoucher = voucher;
        console.log('✅ Voucher selected:', voucher?.code);
    },

    add: function (voucher) {
        if (!this.isApplied(voucher?.code || voucher?.raw?.redeem_code)) {
            this.appliedVouchers.push(voucher);
            this.selectedVoucher = voucher;
            console.log('✅ Voucher added to applied list:', voucher?.code);
        }
    },

    remove: function (voucherCode) {
        this.appliedVouchers = this.appliedVouchers.filter(function (v) {
            return (v?.code || v?.raw?.redeem_code) !== voucherCode;
        });
        if (this.selectedVoucher?.code === voucherCode) {
            this.selectedVoucher = null;
        }
        console.log('🗑️ Voucher removed from applied list:', voucherCode);
    },

    clear: function () {
        this.appliedVouchers = [];
        this.selectedVoucher = null;
        this.loadingVoucher = null;
        this.previousOrderBeforeVouchers = null;
        console.log('🗑️ All vouchers cleared');
    },

    getApplied: function () {
        return this.appliedVouchers;
    },

    setLoading: function (voucher) {
        this.loadingVoucher = voucher;
    },

    clearLoading: function () {
        this.loadingVoucher = null;
    },

    savePreviousOrder: function (order) {
        if (!this.previousOrderBeforeVouchers) {
            this.previousOrderBeforeVouchers = JSON.parse(JSON.stringify(order));
            console.log('💾 Saved order state before vouchers');
        }
    },

    getPreviousOrder: function () {
        return this.previousOrderBeforeVouchers;
    },

    clearPreviousOrder: function () {
        this.previousOrderBeforeVouchers = null;
        console.log('🗑️ Cleared previous order state');
    }
};


let _voucherCache = null;
let _voucherCacheTime = 0;
const VOUCHER_CACHE_TTL_MS = 30000;

export function invalidateVoucherCache() {
    _voucherCache = null;
    _voucherCacheTime = 0;
    console.log('🗑️ Voucher cache invalidated');
}

// ✅ updateVoucherUI DEBOUNCE timer
let _updateVoucherUITimer = null;


function sendVoucherWS(payload) {
    const ws = window.sokWebSocket?.ws;
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            ...payload,
            deviceId: localStorage.getItem("sok_device_id"),
            timestamp: new Date().toISOString()
        }));
    } else {
        console.warn('⚠️ WebSocket not open, voucher event not sent:', payload.action);
    }
}

export function getVoucherInfo(crmVendor, voucher) {
    const cache = useCache();
    let promos = cache?.promos;

    console.log('🎫 getVoucherInfo called with:', {
        vendor: crmVendor,
        voucherCode: voucher?.redeem_code || voucher?.code,
        voucherName: voucher?.redeem_name || voucher?.name,
        hasVoucher: !!voucher
    });

    console.log('📦 Full voucher object passed in:', voucher);
    console.log('📦 Voucher keys:', Object.keys(voucher || {}));

    if (!voucher) {
        console.warn('⚠️ No voucher provided to getVoucherInfo');
        return null;
    }

    if (voucher?.redeem_type === 'REWARD'
        || voucher?.code?.startsWith('rewardid-')
        || voucher?.redeem_code?.startsWith('rewardid-')) {

        console.log('🎁 Reward voucher detected — bypassing promotion & fallback logic');

        return {
            raw: voucher,
            code: voucher.redeem_code || voucher.code,
            name: voucher.redeem_name || voucher.name,
            type: 'REWARD',
            promotion: null,
            promo_name: voucher.redeem_name || voucher.name,
            limit: 0,
            is_reward: true
        };
    }


    const voucherInfo = {
        raw: voucher,
        promo_name: "",
        limit: 0,
        type: null,
        promotion: null,
        code: voucher.redeem_code || voucher.code,
        name: voucher.redeem_name || voucher.name
    };

    if (crmVendor === 'EBER') {
        const posRedeemExtra = voucher?.pos_redeem_extra;
        const posRedeemMethod = voucher?.pos_redeem_method;
        const posRedeemAmount = voucher?.pos_redeem_amount;

        console.log('📦 EBER voucher details:', {
            posRedeemExtra,
            posRedeemMethod,
            posRedeemAmount,
            redeemType: voucher?.redeem_type
        });

        if (posRedeemExtra) {
            const config = posRedeemExtra.split(",");
            const discountrule = config[0];
            const qty = config[1];

            if (discountrule) {
                const parts = discountrule.split("=");
                voucherInfo.promo_name = parts[1] || "";
            }

            if (qty) {
                const parts = qty.split("=");
                voucherInfo.limit = parseInt(parts[1]) || 0;
            }

            console.log('✅ Parsed EBER config:', {
                promo_name: voucherInfo.promo_name,
                limit: voucherInfo.limit
            });
        } else {
            console.warn('⚠️ No pos_redeem_extra - voucher may not have promotion mapping');

            if (voucher.redeem_name || voucher.name) {
                voucherInfo.promo_name = voucher.redeem_name || voucher.name;
                console.log('📝 Using voucher name as promo_name:', voucherInfo.promo_name);
            }
        }
    }

    if (!promos) {
        console.error('❌ Promos is null or undefined');
        return createFallbackVoucherInfo(voucher, voucherInfo);
    }

    if (typeof promos === 'string') {
        console.log('🔄 Promos is a string, parsing JSON...');
        try {
            promos = JSON.parse(promos);
            console.log('✅ Successfully parsed promos');
        } catch (error) {
            console.error('❌ Failed to parse promos JSON:', error);
            return createFallbackVoucherInfo(voucher, voucherInfo);
        }
    }

    if (!Array.isArray(promos) && typeof promos === 'object') {
        console.log('🔄 Converting promos object to array');
        promos = Object.values(promos);
    }

    if (!Array.isArray(promos)) {
        console.error('❌ Promos is not an array after conversion:', typeof promos);
        return createFallbackVoucherInfo(voucher, voucherInfo);
    }

    if (promos.length === 0) {
        console.warn('⚠️ Promos array is empty');
        return createFallbackVoucherInfo(voucher, voucherInfo);
    }

    console.log('✅ Promos loaded:', promos.length, 'promotions');
    console.log('🔍 Searching for promotion with name:', voucherInfo.promo_name);

    const promotion = promos.find(function (promo) {
        const matches = promo?.promo_name === voucherInfo?.promo_name &&
            promo?.apply_terminal === 2;

        if (matches) {
            console.log('✅ Found matching promotion:', promo);
        }

        return matches;
    });

    if (promotion) {
        voucherInfo.promotion = promotion;

        if (promotion?.criteria_type === 'TOTAL_DISCOUNT') {
            voucherInfo.type = 'BILL';
        } else {
            voucherInfo.type = 'ITEM';
        }

        console.log('✅ Promotion mapped to voucher:', {
            code: voucherInfo.code,
            promo_name: voucherInfo.promo_name,
            type: voucherInfo.type,
            limit: voucherInfo.limit,
            criteria_type: promotion?.criteria_type,
            criteria_disc_type: promotion?.criteria_disc_type,
            criteria_disc_value: promotion?.criteria_disc_value
        });
    } else {
        console.warn('⚠️ No matching promotion found for:', voucherInfo.promo_name);
        console.warn('   Available promos:');
        promos.forEach(function (p, index) {
            console.warn(`     [${index}] ${p?.promo_name} (terminal: ${p?.apply_terminal})`);
        });

        return createFallbackVoucherInfo(voucher, voucherInfo);
    }

    return voucherInfo;
}


// ============================================
// APPLY BILL VOUCHER (TOTAL DISCOUNT)
// ============================================
async function applyBillVoucher(order, voucherInfo) {
    console.log('💳 Applying bill voucher:', voucherInfo.code);

    const promotion = voucherInfo.promotion;
    if (!promotion) {
        console.error('❌ No promotion found for bill voucher');
        return { success: false, error: 'Invalid voucher configuration' };
    }

    const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
    const svcRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;
    const isTakeaway = localStorage.getItem("orderType") === "T";

    const subtotal = order.sales_dtls.reduce((sum, item) =>
        sum + parseFloat(item.sub_total || 0), 0
    );

    let discountAmount = 0;

    if (promotion.criteria_disc_type === 'V') {
        discountAmount = parseFloat(promotion.criteria_disc_value || 0);
    } else if (promotion.criteria_disc_type === 'P') {
        const percentage = parseFloat(promotion.criteria_disc_value || 0);
        discountAmount = (subtotal * percentage) / 100;
    }

    discountAmount = Math.min(discountAmount, subtotal);

    const subtotalAfterDiscount = Math.max(0, subtotal - discountAmount);
    const totalService = !isTakeaway ? (subtotalAfterDiscount * svcRate / 100) : 0;
    const totalGST = subtotalAfterDiscount * gstRate / 100;
    const netTotal = subtotalAfterDiscount + totalService + totalGST;

    console.log('💰 Bill voucher calculation:', {
        subtotal: subtotal.toFixed(2),
        discount: discountAmount.toFixed(2),
        afterDiscount: subtotalAfterDiscount.toFixed(2),
        service: totalService.toFixed(2),
        gst: totalGST.toFixed(2),
        total: netTotal.toFixed(2)
    });

    const updatedOrder = {
        ...order,
        voucher_code: voucherInfo.code,
        voucher_name: voucherInfo.name,
        voucher_discount: discountAmount.toFixed(2),
        total_disc: discountAmount.toFixed(2),
        total_svc: totalService.toFixed(2),
        total_tax: totalGST.toFixed(2),
        net_amt: netTotal.toFixed(2),
        final_amt: netTotal.toFixed(2),
    };

    return {
        success: true,
        order: updatedOrder,
        discount: discountAmount
    };
}

async function applyItemVoucher(order, voucherInfo) {
    console.log('💳 Applying item voucher:', voucherInfo.code);

    const promotion = voucherInfo.promotion;
    if (!promotion) {
        console.error('❌ No promotion found for item voucher');
        return { success: false, error: 'Invalid voucher configuration' };
    }

    if (!order.sales_dtls || !Array.isArray(order.sales_dtls)) {
        console.error('❌ Invalid order structure');
        return { success: false, error: 'Invalid order structure' };
    }

    console.log('🎯 Calling applyPromotions with mapping:', {
        itemsCount: order.sales_dtls.length,
        promotion: promotion.promo_name,
        criteria_type: promotion.criteria_type,
        originalCategories: promotion.item_menu_category_dtls,
        limit: voucherInfo.limit
    });

    try {
        const result = await applyPromotionsWithMapping(
            order.sales_dtls,
            [promotion],
            voucherInfo.limit
        );

        console.log('📊 applyPromotions full result:', result);

        if (result && result.orderItems && (result.applied === 0 || result.amount === 0)) {
            const needsManualDiscount =
                voucherInfo.name?.toLowerCase().includes('free') ||
                promotion.promo_name?.toLowerCase().includes('free') ||
                promotion.criteria_type === 'LD' ||
                promotion.criteria_type === 'ID' ||
                promotion.criteria_type === 'TD';

            if (needsManualDiscount) {
                console.log('🔧 Manual discount needed - attempting fallback');

                let promoCategories = promotion.item_menu_category_dtls;
                if (typeof promoCategories === 'string') {
                    promoCategories = promoCategories ? [{ category_code: promoCategories }] : [];
                } else if (!Array.isArray(promoCategories)) {
                    promoCategories = [];
                }

                const promoCategoryCodes = promoCategories.map(c => c.category_code);

                const matchingItems = result.orderItems.filter(item => {
                    const itemCategory = item.category_code || item.menu_category_code || '';

                    if (promoCategoryCodes.length === 0) {
                        return true;
                    }

                    return promoCategoryCodes.includes(itemCategory);
                });

                if (matchingItems.length > 0) {
                    let totalDiscount = 0;
                    let updatedItems = [...result.orderItems];

                    if (promotion.criteria_type === 'TD') {
                        const cartSubtotal = result.orderItems.reduce((sum, item) =>
                            sum + parseFloat(item.sub_total || 0), 0
                        );

                        if (promotion.criteria_disc_type === 'P') {
                            const percentage = parseFloat(promotion.criteria_disc_value || 0);
                            totalDiscount = (cartSubtotal * percentage) / 100;
                        } else if (promotion.criteria_disc_type === 'V' || promotion.criteria_disc_type === 'F') {
                            totalDiscount = parseFloat(promotion.criteria_disc_value || 0);
                        }

                        const matchingSubtotal = matchingItems.reduce((sum, item) =>
                            sum + parseFloat(item.sub_total || 0), 0
                        );

                        updatedItems = result.orderItems.map(item => {
                            const isMatchingItem = matchingItems.some(m => m.s_no === item.s_no);
                            if (isMatchingItem) {
                                const itemSubtotal = parseFloat(item.sub_total || 0);
                                const itemProportion = matchingSubtotal > 0 ? itemSubtotal / matchingSubtotal : 0;
                                const itemDiscount = totalDiscount * itemProportion;

                                return {
                                    ...item,
                                    pro_disc_amt: itemDiscount.toFixed(2),
                                    disc_amt: (parseFloat(item.disc_amt || 0) + itemDiscount).toFixed(2)
                                };
                            }
                            return item;
                        });

                    } else if (promotion.criteria_type === 'ID' || promotion.criteria_type === 'LD') {
                        let itemsToDiscount;
                        if (promotion.criteria_type === 'LD') {
                            const cheapest = matchingItems.reduce((min, item) =>
                                parseFloat(item.unit_price || 0) < parseFloat(min.unit_price || 0) ? item : min
                            );
                            itemsToDiscount = [cheapest];
                        } else {
                            const limit = voucherInfo.limit || matchingItems.length;
                            itemsToDiscount = matchingItems.slice(0, limit);
                        }

                        updatedItems = result.orderItems.map(item => {
                            const shouldDiscount = itemsToDiscount.some(d => d.s_no === item.s_no);
                            if (shouldDiscount) {
                                let itemDiscount = 0;
                                const unitPrice = parseFloat(item.unit_price || 0);
                                const qty = parseInt(item.qty || 1);

                                if (promotion.criteria_disc_type === 'P') {
                                    const percentage = parseFloat(promotion.criteria_disc_value || 0);
                                    itemDiscount = (unitPrice * qty * percentage) / 100;
                                } else if (promotion.criteria_disc_type === 'V' || promotion.criteria_disc_type === 'F') {
                                    itemDiscount = parseFloat(promotion.criteria_disc_value || 0) * qty;
                                } else if (promotion.criteria_disc_type === 'N' || !promotion.criteria_disc_value) {
                                    itemDiscount = unitPrice * qty;
                                } else {
                                    itemDiscount = unitPrice * qty;
                                }

                                totalDiscount += itemDiscount;

                                return {
                                    ...item,
                                    pro_disc_amt: itemDiscount.toFixed(2),
                                    disc_amt: (parseFloat(item.disc_amt || 0) + itemDiscount).toFixed(2)
                                };
                            }
                            return item;
                        });
                    }

                    result.orderItems = updatedItems;
                    result.applied = matchingItems.length;
                    result.amount = totalDiscount;

                    console.log('✅ Manual discount applied successfully!', {
                        type: promotion.criteria_type,
                        discountType: promotion.criteria_disc_type,
                        amount: totalDiscount.toFixed(2),
                        itemsAffected: matchingItems.length
                    });
                } else {
                    console.warn('⚠️ No matching items found for manual discount');
                }
            }
        }

        if (result && result.orderItems) {
            const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
            const svcRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;
            const isTakeaway = localStorage.getItem("orderType") === "T";

            const subtotal = result.orderItems.reduce((sum, item) =>
                sum + parseFloat(item.sub_total || 0), 0
            );

            const totalDiscount = result.orderItems.reduce((sum, item) =>
                sum + parseFloat(item.pro_disc_amt || 0), 0
            );

            if (result.applied === 0 || totalDiscount === 0) {
                console.warn('⚠️ Promotion did not apply - items may not match criteria');

                const categoryNames = Array.isArray(promotion.item_menu_category_dtls)
                    ? promotion.item_menu_category_dtls.map(c => c.category_code).join(', ')
                    : 'specific items';

                showToast(
                    `This voucher applies only to ${categoryNames}. Add qualifying items to use this voucher.`,
                    'warning',
                    'Voucher Applied (No Discount)',
                    6000
                );
            }

            const subtotalAfterDiscount = subtotal - totalDiscount;
            const totalService = !isTakeaway ? (subtotalAfterDiscount * svcRate / 100) : 0;
            const totalGST = subtotalAfterDiscount * gstRate / 100;
            const netTotal = subtotalAfterDiscount + totalService + totalGST;

            const updatedOrder = {
                ...order,
                sales_dtls: result.orderItems,
                total_disc: totalDiscount.toFixed(2),
                total_svc: totalService.toFixed(2),
                total_tax: totalGST.toFixed(2),
                net_amt: netTotal.toFixed(2),
                final_amt: netTotal.toFixed(2),
                voucher_code: voucherInfo.code,
                voucher_name: voucherInfo.name,
                voucher_discount: totalDiscount.toFixed(2),
                voucher_pending: result.applied === 0
            };

            return {
                success: true,
                order: updatedOrder,
                discount: totalDiscount,
                pending: result.applied === 0
            };
        }

        console.error('❌ Invalid result from applyPromotions:', result);
        return { success: false, error: 'Promotion calculation failed' };

    } catch (error) {
        console.error('❌ Error calling applyPromotions:', error);
        return { success: false, error: error.message };
    }
}


async function applyVoucherToOrder(voucher) {
    console.log('💳 Applying voucher:', voucher.redeem_code || voucher.code);

    if (!voucher) {
        console.error('❌ Voucher is missing');
        return { success: false, error: 'Voucher missing' };
    }

    const { order, setOrder } = useOrder();
    if (!order || !order.sales_dtls || order.sales_dtls.length === 0) {
        console.warn('⚠️ Cannot apply voucher to empty cart');
        return { success: false, error: 'Cart is empty' };
    }

    const voucherAmount = parseFloat(voucher.pos_redeem_amount || 0);

    if (!voucherAmount) {
        console.log('🎁 Verify-only reward voucher, no price impact');
        order.reward_voucher = {
            code: voucher.redeem_code,
            name: voucher.reward.name
        };
        setOrder({ ...order });
        return { success: true, voucher, discountAmount: 0 };
    }

    const subtotal = order.sales_dtls.reduce((sum, i) => sum + parseFloat(i.sub_total || 0), 0);
    const gstRate = parseFloat(sessionStorage.getItem("GST"));
    const svcRate = parseFloat(sessionStorage.getItem("ServiceCharge"));
    const isTakeaway = localStorage.getItem("orderType") === "T";

    const subtotalAfterVoucher = Math.max(0, subtotal - voucherAmount);

    const finalSubTotal = subtotal;
    order.sales_dtls = order.sales_dtls.map(item => {
        const itemSubTotal = parseFloat(item.sub_total || 0);
        const itemProportion = finalSubTotal > 0 ? itemSubTotal / finalSubTotal : 0;
        const itemDiscount = voucherAmount * itemProportion;
        const itemSubtotalAfterDiscount = itemSubTotal - (parseFloat(item.disc_amt || 0) + itemDiscount);

        const isApplySvc = isTakeaway ? 0 : parseFloat(item.is_apply_svc || 0);
        const svcAmt = (isApplySvc === 1 && itemSubtotalAfterDiscount > 0)
            ? (svcRate * itemSubtotalAfterDiscount / 100)
            : 0;
        const taxAmt = itemSubtotalAfterDiscount > 0
            ? (itemSubtotalAfterDiscount * gstRate / 100)
            : 0;

        return {
            ...item,
            pro_disc_amt: parseFloat(item.pro_disc_amt || 0) + itemDiscount,
            svc_amt: svcAmt.toFixed(2),
            tax_amt: taxAmt.toFixed(2)
        };
    });

    const totalSvc = order.sales_dtls.reduce((sum, i) => sum + parseFloat(i.svc_amt || 0), 0);
    const totalTax = order.sales_dtls.reduce((sum, i) => sum + parseFloat(i.tax_amt || 0), 0);
    const totalItemDiscount = order.sales_dtls.reduce((sum, i) => sum + parseFloat(i.pro_disc_amt || 0), 0);

    const netAmount = subtotal - totalItemDiscount + totalSvc + totalTax;

    const updatedOrder = {
        ...order,
        voucher_code: voucher.redeem_code,
        voucher_name: voucher.reward.name,
        voucher_discount: voucherAmount.toFixed(2),
        total_disc: totalItemDiscount.toFixed(2),
        total_svc: totalSvc.toFixed(2),
        total_tax: totalTax.toFixed(2),
        net_amt: netAmount.toFixed(2),
        final_amt: netAmount.toFixed(2)
    };

    setOrder(updatedOrder);

    const voucherRow = document.getElementById('voucher-discount-row');
    if (voucherRow) {
        voucherRow.style.display = 'flex';
        document.getElementById('voucher-discount-label').textContent = voucher.reward.name || voucher.redeem_name;
        document.getElementById('voucher-discount-amount').textContent = `-$${voucherAmount.toFixed(2)}`;
    }

    document.getElementById('service-charge').textContent = `$${totalSvc.toFixed(2)}`;
    document.getElementById('gst').textContent = `$${totalTax.toFixed(2)}`;
    document.getElementById('total').textContent = `$${netAmount.toFixed(2)}`;

    return { success: true, voucher, discountAmount: voucherAmount };
}

function applyVoucherToOrderDOM(voucher) {
    console.log('💳 Applying voucher to DOM:', voucher.redeem_code || voucher.code);

    if (!voucher) {
        console.error('❌ Voucher is missing');
        return { success: false, error: 'Voucher missing' };
    }

    const cartItems = document.querySelectorAll('.cart-item-card');
    if (!cartItems || cartItems.length === 0) {
        console.warn('⚠️ Cannot apply voucher to empty cart');
        return { success: false, error: 'Cart is empty' };
    }

    const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
    const svcRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;
    const isTakeaway = localStorage.getItem("orderType") === "T";

    let subtotal = 0;
    const itemSubTotals = [];
    cartItems.forEach(item => {
        const priceElem = item.querySelector('.cart-item-price');
        const qtyElem = item.querySelector('.cart-item-qty');
        const price = parseFloat(priceElem?.textContent.replace('$', '')) || 0;
        const qty = parseInt(qtyElem?.textContent.replace('x', '')) || 1;
        const itemTotal = price * qty;
        itemSubTotals.push(itemTotal);
        subtotal += itemTotal;
    });

    const voucherAmount = parseFloat(voucher.pos_redeem_amount || voucher.posRedeemAmount || 0);

    if (!voucherAmount || voucherAmount <= 0) {
        console.warn('⚠️ No voucher amount to apply');
        return { success: false, error: 'Invalid voucher amount' };
    }

    const totalDiscount = Math.min(voucherAmount, subtotal);
    const subtotalAfterDiscount = Math.max(0, subtotal - totalDiscount);
    const totalService = (!isTakeaway ? subtotalAfterDiscount * svcRate / 100 : 0);
    const totalGST = subtotalAfterDiscount * gstRate / 100;
    const netTotal = subtotalAfterDiscount + totalService + totalGST;

    const itemDiscounts = itemSubTotals.map(itemTotal => {
        return subtotal > 0 ? (itemTotal / subtotal) * totalDiscount : 0;
    });

    cartItems.forEach((item, idx) => {
        item.dataset.voucherDiscount = itemDiscounts[idx].toFixed(2);
    });

    const cartTotalElem = document.getElementById('cartTotal');
    if (cartTotalElem) cartTotalElem.textContent = `$${subtotal.toFixed(2)}`;

    const voucherRow = document.getElementById('voucher-discount-row');
    if (voucherRow) {
        voucherRow.style.display = 'flex';

        const voucherLabel = document.getElementById('voucher-discount-label');
        const voucherAmountElem = document.getElementById('voucher-discount-amount');

        const voucherName = voucher.name || voucher.redeem_name || voucher.raw?.redeem_name || voucher.raw?.reward?.name || 'Voucher Discount';

        if (voucherLabel) {
            const voucherNameSpan = voucherLabel.querySelector('.voucher-name');
            if (voucherNameSpan) voucherNameSpan.textContent = voucherName;
        }
        if (voucherAmountElem) voucherAmountElem.textContent = `-$${totalDiscount.toFixed(2)}`;
    }

    const serviceChargeElem = document.getElementById('service-charge');
    if (serviceChargeElem) serviceChargeElem.textContent = `$${totalService.toFixed(2)}`;

    const gstElem = document.getElementById('gst');
    if (gstElem) gstElem.textContent = `$${totalGST.toFixed(2)}`;

    const totalElem = document.getElementById('total');
    if (totalElem) totalElem.textContent = `$${netTotal.toFixed(2)}`;

    console.log('✅ Voucher applied to DOM successfully');

    return { success: true, voucher, discountAmount: totalDiscount };
}

async function syncVoucherToServer(order, voucherInfo, discountAmount) {
    try {
        const orderId = order.server_order_id || localStorage.getItem('currentOrderId');

        if (!orderId) {
            console.warn('⚠️ No order ID found, cannot sync voucher');
            return;
        }

        const payload = {
            orderId,
            voucherCode: voucherInfo.code,
            voucherName: voucherInfo.name,
            voucherDiscount: parseFloat(discountAmount).toFixed(2),
            voucherType: voucherInfo.type || 'REWARD'
        };

        const response = await fetch('/API/SOKOrder/apply-voucher', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to sync voucher to server');

        const result = await response.json();
        console.log('✅ Voucher synced to server:', result);

        return result;
    } catch (error) {
        console.error('❌ Error syncing voucher to server:', error);
    }
}

// ============================================
// GET MEMBER BY PHONE
// ============================================
export async function getEberMemberByPhone(phoneNumber) {
    if (!phoneNumber) {
        await showAlert('Please enter your phone number to continue', 'Phone Number Required', 'warning');
        return;
    }

    let cleanPhone = phoneNumber.replace(/\D/g, "");
    if (cleanPhone.startsWith("65") && cleanPhone.length === 10) {
        cleanPhone = cleanPhone.substring(2);
    }
    if (cleanPhone.length !== 8) {
        console.error("❌ Invalid Singapore number, must be 8 digits.");
        return { success: false, error: "Invalid Singapore phone number." };
    }

    const url = `/api/eber/user/show?phone=${cleanPhone}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queryString: "" })
        });

        const text = await response.text();
        const json = text ? JSON.parse(text) : null;

        if (!response.ok) {
            console.error("❌ API Error:", text);
            return { success: false, error: text };
        }

        return json;
    } catch (err) {
        console.error("❌ Network error:", err);
        return { success: false, error: err.message };
    }
}

// ============================================
// VERIFY MEMBER LOGIN
// ============================================
export async function verifyMemberLogin(phoneNumber) {
    const res = await getEberMemberByPhone(phoneNumber);

    if (res.success && res.member_found && res.member) {
        const member = res.member;
        const cache = useCache();
        const voucherBanner = document.getElementById('voucherBanner');
        const voucherCount = document.getElementById('availableVoucherCount');

        cache.isMemberLoggedIn = true;
        cache.currentMember = member;
        cache.memberRawData = res.raw_data;
        invalidateVoucherCache();
        cache.memberInfo = {
            id: member.id,
            name: member.display_name,
            phone: member.phone,
            phone_format: member.phone_format,
            email: member.email,
            points: member.points,
            tier: member.tier,
            available_rewards: member.available_rewards
        };

        localStorage.setItem("memberInfo", JSON.stringify({
            id: member.id,
            name: member.display_name,
            phone: member.phone_format,
            points: member.points,
            tier: member.tier
        }));

        const counts = getVoucherCount();
        if (counts.total > 0) {
            voucherCount.textContent = counts.total;
            voucherBanner.style.display = 'flex';
        }

        updateVoucherUI();

        console.log("✅ Member logged in:", member.display_name);
        return { success: true, member };
    } else {
        console.log("⚠️ Member not found");
        return { success: false, error: res.error || "Member not found" };
    }
}

// ============================================
// HANDLE MEMBER LOGIN (UI + VALIDATION)
// ============================================
export async function handleMemberLogin(event) {
    if (event) event.preventDefault();

    const phoneInput = document.getElementById('phoneNumber');
    if (!phoneInput) {
        console.error('❌ Phone input not found');
        return false;
    }

    const phoneNumber = phoneInput.value.trim();

    if (!/^\d{8}$/.test(phoneNumber)) {
        showLoginError('Please enter a valid 8-digit phone number');
        return false;
    }

    const loginBtn = event?.target.querySelector('button[type="submit"]');
    const originalBtnText = loginBtn?.textContent || 'Login';

    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = 'Verifying...';
    }

    try {
        console.log('🔐 Verifying member:', phoneNumber);

        const result = await verifyMemberLogin(phoneNumber);

        if (result.success && result.member) {
            const memberName = result.member.display_name || result.member.name || 'Member';
            showLoginSuccess(`Welcome back, ${memberName}!`);

            setTimeout(() => {
                closeLoginModal();
                displayMemberBadge(result.member);
                updateOrderWithMemberInfo(result.member);
                showOrderTypeSelection();
            }, 1500);

        } else {
            showLoginError('Member not found. Please check your phone number.');
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.textContent = originalBtnText;
            }
        }

    } catch (error) {
        console.error('❌ Login error:', error);
        showLoginError('Connection error. Please try again.');
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = originalBtnText;
        }
    }

    return false;
}


function showLoginSuccess(message) {
    const successMsg = document.getElementById('loginSuccessMessage');
    const errorMsg = document.getElementById('loginErrorMessage');
    if (successMsg) { successMsg.textContent = message; successMsg.style.display = 'block'; }
    if (errorMsg) errorMsg.style.display = 'none';
}

function showLoginError(message) {
    const successMsg = document.getElementById('loginSuccessMessage');
    const errorMsg = document.getElementById('loginErrorMessage');
    if (errorMsg) { errorMsg.textContent = message; errorMsg.style.display = 'block'; }
    if (successMsg) successMsg.style.display = 'none';
}

function hideLoginMessages() {
    const successMsg = document.getElementById('loginSuccessMessage');
    const errorMsg = document.getElementById('loginErrorMessage');
    if (successMsg) successMsg.style.display = 'none';
    if (errorMsg) errorMsg.style.display = 'none';
}

// ============================================
// SHOW/CLOSE LOGIN MODAL
// ============================================
export function showLoginScreen() {
    const loginModal = document.getElementById('loginModal');
    const memberGuestSelection = document.getElementById('memberGuestSelection');

    if (loginModal) {
        if (memberGuestSelection) memberGuestSelection.style.display = 'none';
        loginModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            const phoneInput = document.getElementById('phoneNumber');
            if (phoneInput) phoneInput.focus();
        }, 300);
    }
}

export function closeLoginModal() {
    const loginModal = document.getElementById('loginModal');
    const memberGuestSelection = document.getElementById('memberGuestSelection');

    if (loginModal) {
        loginModal.style.display = 'none';
        document.body.style.overflow = '';
        if (memberGuestSelection) memberGuestSelection.style.display = 'flex';
    }
}

// ============================================
// PROCEED AS GUEST
// ============================================
export function proceedAsGuest() {
    console.log('👤 Proceeding as guest');

    const cache = useCache();
    cache.isMemberLoggedIn = false;
    cache.memberInfo = null;
    cache.currentMember = null;

    localStorage.removeItem('memberInfo');

    showOrderTypeSelection();
}

// ============================================
// SHOW ORDER TYPE SELECTION
// ============================================
export async function showOrderTypeSelection() {
    const orderTypeSelection = document.getElementById('orderTypeSelection');
    if (!orderTypeSelection) return;
    window.__orderTypeHandlersAttached = false; // ← ADD THIS

    // 1. Show the container but add a 'not-ready' class
    orderTypeSelection.style.display = 'flex';
    orderTypeSelection.classList.add('loading-state');
    orderTypeSelection.style.opacity = '0.5';
    orderTypeSelection.style.pointerEvents = 'none'; // Disable all clicks

    console.log('⏳ Waiting for App Initialization...');

    // 2. Wait for the actual app readiness before enabling buttons
    if (typeof initPromise !== 'undefined') {
        await initPromise;
    }

    // 3. Now attach handlers and enable UI
    attachOrderTypeHandlers();
    orderTypeSelection.classList.remove('loading-state');
    orderTypeSelection.style.opacity = '1';
    orderTypeSelection.style.pointerEvents = 'auto'; // Re-enable clicks

    console.log('✅ Order type selection ready for user');
}

export function attachOrderTypeHandlers() {
    if (window.__orderTypeHandlersAttached) return;
    window.__orderTypeHandlersAttached = true;

    const orderOptions = document.querySelectorAll('#orderTypeSelection .landing-option[data-type]');

    orderOptions.forEach((option) => {
        // Replace node to clear old listeners
        const newOption = option.cloneNode(true);
        option.parentNode.replaceChild(newOption, option);

        newOption.addEventListener('click', async function (e) {
            e.preventDefault();

            if (isSelectingOrderType) {
                console.warn('⏳ Order type selection in progress...');
                return;
            }

            isSelectingOrderType = true;

            // Disable all options
            const currentOptions = document.querySelectorAll('#orderTypeSelection .landing-option[data-type]');
            currentOptions.forEach(opt => opt.style.pointerEvents = 'none');

            // Visual feedback
            currentOptions.forEach(opt => opt.classList.remove('selected'));
            newOption.classList.add('selected');

            const selectedType = this.getAttribute('data-type');

            try {
                // ✅ Ensure storage is written before any async operation
                const written = setOrderType(selectedType);
                if (!written) {
                    console.error('❌ Failed to persist orderType, aborting selection');
                    isSelectingOrderType = false;
                    return;
                }
                await handleOrderTypeSelection(selectedType);
            } catch (err) {
                console.error('❌ Error selecting order type:', err);
            } finally {
                // Re-enable options
                const finalOptions = document.querySelectorAll('#orderTypeSelection .landing-option[data-type]');
                finalOptions.forEach(opt => opt.style.pointerEvents = '');
                isSelectingOrderType = false;
            }
        });
    });
}

export async function handleOrderTypeSelection(type) {
    // ✅ Safety net: recover orderType from DOM if missing
    if (!localStorage.getItem('orderType')) {
        const domType = document.querySelector(`#orderTypeSelection .landing-option[data-type="${type}"]`)?.getAttribute('data-type')
            || document.querySelector('#orderTypeSelection .landing-option.selected')?.getAttribute('data-type')
            || type;
        localStorage.setItem('orderType', domType);
        localStorage.setItem('orderType_ts', Date.now().toString());
        console.warn('⚠️ orderType was missing — recovered from DOM:', domType);
    }

    setOrderType(type); // always write fresh
    const ws = window.sokWebSocket;
    console.log('📦 Processing order type:', type);
    localStorage.removeItem('active_cart');
    const isAbsorbTax = (type === 'T') ? "N" : "Y";
    const navSubtotal = document.getElementById('navSubtotal');
    const cartBadge = document.getElementById('cartBadge');
    const bottomNav = document.querySelector('.bottom-nav');
    if (navSubtotal) navSubtotal.textContent = '$0.00';
    if (cartBadge) {
        cartBadge.textContent = '0';
        cartBadge.style.display = 'none';
    }
    if (bottomNav) {
        bottomNav.classList.remove('show');
        bottomNav.style.display = 'none';
    }

    try {
        if (ws) await ws.clearOrderCache(true);
    } catch (err) {
        console.error("❌ Cache clear failed:", err);
    }

    // ✅ Re-stamp orderType after clearOrderCache — defensive final write
    // clearOrderCache internally calls clearOrderState which may wipe localStorage
    setOrderType(type);
    console.log('🔒 orderType re-confirmed after cache clear:', localStorage.getItem('orderType'));

    const language = localStorage.getItem('selectedLang') || 'en';
    const { order, setOrder } = useOrder();
    if (order) {
        setOrder({ ...order, order_type: type }); // ← force store value
    }
    if (typeof selectOrderType === 'function') {
        await selectOrderType(type, language, isAbsorbTax);
        if (typeof updateCartCount === 'function') {
            updateCartCount();
        }
    }

    // ✅ Final verification before handing off to menu
    const finalType = localStorage.getItem('orderType');
    if (finalType !== type) {
        console.error(`❌ orderType mismatch after full flow! Expected "${type}", got "${finalType}" — forcing fix`);
        localStorage.setItem('orderType', type);
        localStorage.setItem('orderType_ts', Date.now().toString());
    } else {
        console.log(`✅ orderType verified at end of handleOrderTypeSelection: "${finalType}"`);
    }
}

// ============================================
// BULLETPROOF ORDER TYPE SETTER
// ============================================
function setOrderType(type) {
    if (!type) {
        console.error('❌ setOrderType: no type provided');
        return false;
    }

    const validTypes = ['T', 'D', 'Q']; // Takeaway, DineIn, QSR
    if (!validTypes.includes(type)) {
        console.warn(`⚠️ setOrderType: unexpected type "${type}" — setting anyway`);
    }

    try {
        // 1. Write
        localStorage.setItem('orderType', type);

        // 2. Verify immediately
        const written = localStorage.getItem('orderType');
        if (written !== type) {
            console.error(`❌ setOrderType: write verification FAILED — wrote "${type}", read back "${written}"`);
            return false;
        }

        // 3. Also stamp a timestamp so you can detect stale values on next boot
        localStorage.setItem('orderType_ts', Date.now().toString());

        console.log(`✅ orderType confirmed in localStorage: "${type}"`);
        return true;

    } catch (err) {
        // localStorage can throw if storage is full or blocked (private mode)
        console.error('❌ setOrderType: localStorage write failed:', err);
        // Fallback to sessionStorage so at least the current tab works
        try {
            sessionStorage.setItem('orderType', type);
            console.warn('⚠️ Fell back to sessionStorage for orderType');
        } catch (e) {
            console.error('❌ sessionStorage fallback also failed:', e);
        }
        return false;
    }
}

// Safe reader — checks localStorage first, then sessionStorage fallback
function getOrderType() {
    return localStorage.getItem('orderType') || sessionStorage.getItem('orderType') || null;
}

// ============================================
// UPDATE ORDER WITH MEMBER INFO
// ============================================
export function updateOrderWithMemberInfo(memberData) {
    try {
        const { order, setOrder } = useOrder();

        if (order) {
            const updatedOrder = {
                ...order,
                customer_code: memberData.id || memberData.customer_code,
                customer_name: memberData.display_name || memberData.name,
                customer_phone: memberData.phone || memberData.phone_format,
                customer_email: memberData.email || '',
                is_member: true,
                member_tier: memberData.tier || '',
                member_points: memberData.points || 0
            };

            setOrder(updatedOrder);
            console.log('✅ Order updated with member info');
        }
    } catch (error) {
        console.error('❌ Error updating order with member info:', error);
    }
}

// ============================================
// DISPLAY MEMBER BADGE IN HEADER
// ============================================
export function displayMemberBadge(memberData) {
    const headerInfo = document.querySelector('.header-info');
    if (!headerInfo) return;

    const existingBadge = headerInfo.querySelector('.member-badge');
    if (existingBadge) existingBadge.remove();

    const memberBadge = document.createElement('div');
    memberBadge.className = 'member-badge';

    const memberName = memberData.display_name || memberData.name || 'Member';
    const memberPoints = memberData.points || 0;
    const memberTier = memberData.tier || '';

    memberBadge.innerHTML = `
        <div class="member-info">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <div class="member-details">
                <span class="member-name">${memberName}</span>
                ${memberTier ? `<span class="member-tier">${memberTier}</span>` : ''}
            </div>
        </div>
        ${memberPoints > 0 ? `<span class="member-points">${memberPoints} pts</span>` : ''}
        <button class="member-logout" onclick="window.handleMemberLogout()" title="Logout">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
        </button>
    `;

    headerInfo.insertBefore(memberBadge, headerInfo.firstChild);
    console.log('✅ Member badge displayed');
}

// ============================================
// SESSION MANAGEMENT
// ============================================
export function getMemberSession() {
    const cache = useCache();

    if (cache.isMemberLoggedIn && cache.memberInfo) {
        return cache.memberInfo;
    }

    const stored = localStorage.getItem("memberInfo");
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error("Failed to parse stored member info");
        }
    }

    return null;
}

export function logoutMember(shouldRedirect = false) {
    console.log('👋 Logging out member...');
    const cache = useCache();
    cache.isMemberLoggedIn = false;
    cache.memberInfo = null;
    cache.currentMember = null;
    cache.memberRawData = null;

    localStorage.removeItem("memberInfo");
    localStorage.removeItem("memberSession");
    localStorage.removeItem("memberVouchers");
    localStorage.removeItem('memberName');
    localStorage.removeItem('memberEmail');
    localStorage.removeItem('memberPhone');
    localStorage.removeItem('memberId');
    localStorage.removeItem('memberPoints');
    localStorage.removeItem('currentMember');
    localStorage.removeItem('loggedInMember');

    const voucherBanner = document.getElementById('voucherBanner');
    const voucherFab = document.getElementById('voucherFab');
    if (voucherBanner) voucherBanner.style.display = 'none';
    if (voucherFab) voucherFab.style.display = 'none';

    const memberBadge = document.querySelector('.member-badge');
    if (memberBadge) memberBadge.remove();

    console.log("✅ Member logged out completely");

    if (shouldRedirect) {
        const storeName = localStorage.getItem('storename');
        const deviceId = localStorage.getItem("sok_device_id");

        if (storeName && deviceId) {
            console.log("🏠 Redirecting to home page...");

            // ✅ FIX 1: Save API cache before redirecting so the next page
            //    load restores menu/items/langs from memory instead of
            //    re-fetching every API from scratch.
            if (typeof window.saveCacheBeforeRedirect === 'function') {
                window.saveCacheBeforeRedirect();
            }

            sessionStorage.setItem('intentional_reset', 'true');
            window.location.replace(
                `/KIOSK/Home/${encodeURIComponent(storeName)}?device_id=${deviceId}`
            );
        } else {
            console.warn("⚠️ Missing storeName or deviceId for redirect");
            window.location.reload();
        }
    }
}

export async function handleMemberLogout() {
    const confirmed = await showConfirm(
        'Are you sure you want to logout? Your current session will be ended.',
        'Logout Confirmation',
        { confirmText: 'Yes, Logout', cancelText: 'Cancel', danger: false }
    );

    if (confirmed) {
        try {
            await logoutMember(true);
            showToast('Successfully logged out', 'success', 'Goodbye!');
        } catch (error) {
            console.error('❌ Logout failed:', error);
            showToast('Failed to logout. Please try again.', 'error', 'Error');
        }
    }
}

// ============================================
// SHOW LANDING SCREEN (CONSOLIDATED)
// ============================================
function showLandingScreen() {
    window.__orderTypeHandlersAttached = false;
    console.log('🏠 Showing landing screen (NO reload, NO URL change)');

    const landingOverlay = document.getElementById('landingOverlay');
    if (landingOverlay) {
        landingOverlay.style.display = 'flex';
        landingOverlay.style.visibility = 'visible';
        landingOverlay.style.opacity = '1';
    }

    // Skip member/guest selection entirely — go straight to order type
    const memberGuestSelection = document.getElementById('memberGuestSelection');
    if (memberGuestSelection) memberGuestSelection.style.display = 'none';

    // ↓ Show orderTypeSelection directly instead of hiding it
    const orderTypeSelection = document.getElementById('orderTypeSelection');
    if (orderTypeSelection) {
        orderTypeSelection.style.display = 'flex';
        orderTypeSelection.style.opacity = '0.5';           // ← lock immediately
        orderTypeSelection.style.pointerEvents = 'none';    // ← no taps until ready
        orderTypeSelection.style.transition = 'opacity 0.25s ease';
    }


    setTimeout(() => {
        window.__orderTypeHandlersAttached = false; // reset guard first
        attachOrderTypeHandlers();

        // re-enable UI after attaching
        const orderTypeSelection = document.getElementById('orderTypeSelection');
        if (orderTypeSelection) {
            orderTypeSelection.style.opacity = '1';
            orderTypeSelection.style.pointerEvents = 'auto';
        }
    }, 100);

    console.log('✅ Landing screen shown (URL unchanged)');
}

// ============================================
// CLEAR SESSION ON PAGE LOAD
// ============================================
export function clearSessionOnPageLoad() {
    if (isRefresh) {
        logoutMember();
        localStorage.setItem('orderType', '');     // ← SET EMPTY instead of remove
        localStorage.setItem('orderType_ts', '');  // ← SET EMPTY instead of remove
        showLandingScreen();
    }
}

// ============================================
// CHECK EXISTING MEMBER SESSION
// ============================================
function checkExistingMemberSession() {
    console.log('🚀 Checking for existing member session...');

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('refresh')) {
        console.log('🔄 Fresh start detected - clearing member session');

        const cache = useCache();
        cache.isMemberLoggedIn = false;
        cache.memberInfo = null;
        cache.currentMember = null;
        cache.memberRawData = null;

        localStorage.removeItem('memberInfo');
        localStorage.removeItem('memberSession');
        localStorage.removeItem('memberVouchers');
        sessionStorage.clear();

        voucherState.clear();

        const memberBadge = document.querySelector('.member-badge');
        if (memberBadge) memberBadge.remove();

        const voucherBanner = document.getElementById('voucherBanner');
        const voucherFab = document.getElementById('voucherFab');
        if (voucherBanner) voucherBanner.style.display = 'none';
        if (voucherFab) voucherFab.style.display = 'none';

        console.log('✅ Fresh start - member data cleared');
        return;
    }

    const memberSession = getMemberSession();

    if (memberSession) {
        console.log('✅ Existing member session found:', memberSession.name);
        displayMemberBadge(memberSession);
        updateOrderWithMemberInfo(memberSession);

        const landingOverlay = document.getElementById('landingOverlay');
        if (landingOverlay) landingOverlay.style.display = 'none';
    } else {
        console.log('👤 No existing member session');
    }
}

// ✅ FIX 2: Merged into one guarded DOMContentLoaded listener.
// Previously two separate listeners caused double execution when the module
// was evaluated twice (due to duplicate <script> tag in HTML).
// The __eberDOMListenerAttached guard makes this idempotent.
if (!window.__eberDOMListenerAttached) {
    window.__eberDOMListenerAttached = true;

    document.addEventListener('DOMContentLoaded', function () {
        // Member session check
        console.log('🚀 Checking for existing member session...');
        checkExistingMemberSession();

        // Voucher modal overlay click-to-close
        const modalOverlay = document.getElementById('vouchersModalOverlay');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', function (e) {
                if (e.target === modalOverlay) {
                    window.closeVouchersModal();
                }
            });
        }
    });
}

// ============================================
// VOUCHER FUNCTIONS
// ============================================

export function getAvailableVouchers() {
    const now = Date.now();
    if (_voucherCache && (now - _voucherCacheTime) < VOUCHER_CACHE_TTL_MS) {
        return _voucherCache;
    }

    const cache = useCache();
    const rawData = cache.memberRawData;

    if (!rawData?.redeemable_list) {
        console.warn('⚠️ No voucher data available');
        return [];
    }

    const vouchers = rawData.redeemable_list.map(voucher => {
        const imageUrl = voucher.image_url?.trim() || voucher.reward?.image_url?.trim() || null;
        return {
            code: voucher.redeem_code,
            name: voucher.redeem_name,
            type: voucher.redeem_type,
            imageUrl,
            expiryDate: voucher.expiry_date_tz,
            posRedeemMethod: voucher.pos_redeem_method,
            posRedeemAmount: voucher.pos_redeem_amount,
            posRedeemPercentage: voucher.pos_redeem_percentage,
            posRedeemExtra: voucher.pos_redeem_extra,
            currency: voucher.pos_redeem_amount_currency,
            discountRule: parseDiscountRule(voucher.pos_redeem_extra),
            raw: voucher
        };
    });

    voucherState.availableVouchers = vouchers;

    console.log(`📋 Vouchers loaded: ${vouchers.length} total, ${vouchers.filter(v => v.imageUrl).length} with images`);

    _voucherCache = vouchers;
    _voucherCacheTime = now;

    return vouchers;
}


export function getVouchersByType() {
    const vouchers = getAvailableVouchers();

    return {
        issued: vouchers.filter(v => v.type === 'issued_reward'),
        catalog: vouchers.filter(v => v.type === 'reward')
    };
}

export function getVoucherCount() {
    const vouchers = getAvailableVouchers();
    const grouped = getVouchersByType();

    return {
        total: vouchers.length,
        issued: grouped.issued.length,
        catalog: grouped.catalog.length
    };
}

export function updateVoucherUI() {
    if (_updateVoucherUITimer) return;

    _updateVoucherUITimer = setTimeout(() => {
        _updateVoucherUITimer = null;

        const counts = getVoucherCount();
        console.log('🎟️ Updating voucher UI:', counts);

        const banner = document.getElementById('voucherBanner');
        const bannerCount = document.getElementById('availableVoucherCount');
        if (banner && bannerCount) {
            if (counts.total > 0) {
                bannerCount.textContent = counts.total;
                banner.style.display = 'flex';
            } else {
                banner.style.display = 'none';
            }
        }

        const fab = document.getElementById('voucherFab');
        const fabCount = document.getElementById('fabVoucherCount');
        if (fab && fabCount) {
            if (counts.total > 0) {
                fabCount.textContent = counts.total;
                fab.style.display = 'flex';
            } else {
                fab.style.display = 'none';
            }
        }
    }, 0);
}

export function parseDiscountRule(extraData) {
    if (!extraData) return null;

    try {
        const params = new URLSearchParams(extraData);
        const discountRule = params.get('discountrule');
        const qty = params.get('qty');

        return {
            rule: discountRule || 'No rule specified',
            quantity: qty ? parseInt(qty) : 0,
            raw: extraData
        };
    } catch (error) {
        console.warn('⚠️ Failed to parse discount rule:', error);
        return null;
    }
}

function createFallbackVoucherInfo(voucher, voucherInfo) {
    console.log('🔄 Creating fallback voucher info from direct discount data');

    const posRedeemMethod = voucher?.pos_redeem_method;
    const posRedeemAmount = voucher?.pos_redeem_amount;
    const posRedeemPercentage = voucher?.pos_redeem_percentage;

    if (posRedeemMethod || posRedeemAmount || posRedeemPercentage) {
        const syntheticPromotion = {
            promo_name: voucherInfo.name || 'Direct Discount',
            criteria_type: 'TOTAL_DISCOUNT',
            criteria_disc_type: 'V',
            criteria_disc_value: parseFloat(posRedeemAmount || 0),
            apply_terminal: 2,
            is_synthetic: true
        };

        if (posRedeemPercentage && parseFloat(posRedeemPercentage) > 0) {
            syntheticPromotion.criteria_disc_type = 'P';
            syntheticPromotion.criteria_disc_value = parseFloat(posRedeemPercentage);
        }

        voucherInfo.promotion = syntheticPromotion;
        voucherInfo.type = 'BILL';
        voucherInfo.promo_name = syntheticPromotion.promo_name;

        console.log('✅ Created synthetic promotion:', syntheticPromotion);

        return voucherInfo;
    }

    console.error('❌ Cannot create voucher info: no promotion mapping and no direct discount data');
    return voucherInfo;
}

// ============================================
// VOUCHER MODAL FUNCTIONS (CONSOLIDATED)
// ============================================

function renderVoucherSkeletons(count = 6) {
    return Array(count).fill(null).map(() => `
        <div class="voucher-card-skeleton">
            <div class="skeleton-header">
                <div class="skeleton-image"></div>
                <div class="skeleton-info">
                    <div class="skeleton-text" style="width: 80px; height: 24px;"></div>
                    <div class="skeleton-text title"></div>
                    <div class="skeleton-text code"></div>
                </div>
            </div>
            <div class="skeleton-details">
                <div class="skeleton-text discount"></div>
                <div class="skeleton-text quantity"></div>
            </div>
            <div class="skeleton-text expiry"></div>
            <div class="skeleton-text" style="width: 100%; height: 48px; border-radius: 12px;"></div>
        </div>
    `).join('');
}

export function openVouchersModal() {
    const modal = document.getElementById('vouchersModalOverlay');
    const content = document.getElementById('vouchersModalContent');

    if (!modal || !content) return;

    sendVoucherWS({ action: 'voucher_modal_open' });

    modal.style.display = 'flex';
    modal.classList.add('active');

    updateVoucherFilterCounts();

    content.innerHTML = renderVoucherSkeletons(6);

    setTimeout(() => {
        const DEFAULT_FILTER = "catalog";

        document.querySelectorAll('.voucher-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === DEFAULT_FILTER);
        });

        filterVouchers(DEFAULT_FILTER);

        setTimeout(() => {
            document.querySelectorAll('.voucher-card-full').forEach(card => {
                card.classList.add('loaded');
            });
        }, 50);
    }, 300);
}

export function closeVouchersModal() {
    console.log('🔒 Closing vouchers modal');

    const overlay = document.getElementById('vouchersModalOverlay');
    sendVoucherWS({ action: 'voucher_modal_close' });

    if (overlay) overlay.style.display = 'none';
}

export function renderVouchersModal(filterType = 'all') {
    console.log('🎨 Rendering vouchers:', filterType);

    const content = document.getElementById('vouchersModalContent');
    if (!content) {
        console.error('❌ Vouchers modal content not found');
        return;
    }

    let vouchers = getAvailableVouchers();

    if (filterType === 'issued') {
        vouchers = vouchers.filter(v => v.type === 'issued_reward');
    } else if (filterType === 'catalog') {
        vouchers = vouchers.filter(v => v.type === 'reward');
    }

    const { order } = useOrder();
    const appliedVoucherCode = order?.voucher_code;
    const loadingVoucher = voucherState.loadingVoucher;

    if (vouchers.length === 0) {
        content.innerHTML = `
            <div class="no-vouchers">
                <div class="no-vouchers-icon">🎟️</div>
                <p>No vouchers available</p>
            </div>
        `;
        return;
    }

    content.innerHTML = vouchers.map(voucher => {
        const isApplied = appliedVoucherCode === voucher.code;
        const isLoading = loadingVoucher?.code === voucher.code;
        const disabled = !!loadingVoucher && loadingVoucher?.code !== voucher.code;

        const voucherName = voucher.name || voucher.raw?.redeem_name || 'Voucher';
        const voucherAmount = parseFloat(voucher.posRedeemAmount || voucher.raw?.pos_redeem_amount || 0);
        const voucherPercentage = parseFloat(voucher.posRedeemPercentage || voucher.raw?.pos_redeem_percentage || 0);

        let discountDisplay = getVoucherBadge(voucher.raw || voucher);
        if (voucherAmount > 0) {
            discountDisplay = `$${voucherAmount.toFixed(2)} OFF`;
        } else if (voucherPercentage > 0) {
            discountDisplay = `${voucherPercentage}% OFF`;
        } else {
            discountDisplay = 'Complimentary';
        }

        const expiryDate = voucher.expiryDate || voucher.raw?.expiry_date_tz;
        let expiryDisplay = '';
        if (expiryDate) {
            const date = new Date(expiryDate);
            const today = new Date();
            const daysLeft = Math.ceil((date - today) / (1000 * 60 * 60 * 24));

            if (daysLeft < 0) {
                expiryDisplay = 'Expired';
            } else if (daysLeft === 0) {
                expiryDisplay = 'Expires today';
            } else if (daysLeft <= 7) {
                expiryDisplay = `Expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`;
            } else {
                expiryDisplay = `Valid until ${date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}`;
            }
        }

        const hasImage = voucher.imageUrl && voucher.imageUrl.trim() !== '';

        return `
            <div class="voucher-card-full ${isApplied ? 'selected applied' : ''} ${disabled ? 'disabled' : ''}"
                 data-voucher-code="${voucher.code}">
                <div class="voucher-card-header">
                    <div class="voucher-icon-wrapper">
                        ${hasImage ? `
                            <img src="${voucher.imageUrl}"
                                 alt="${voucherName}"
                                 class="voucher-image-large"
                                 loading="lazy"
                                 onerror="this.style.display='none'; this.parentElement.innerHTML += '<div class=\\'voucher-placeholder-large\\'><svg width=\\'48\\' height=\\'48\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><rect x=\\'2\\' y=\\'5\\' width=\\'20\\' height=\\'14\\' rx=\\'2\\'/><path d=\\'M2 10h20M7 15h.01M11 15h2\\'/></svg></div>';">
                        ` : `
                            <div class="voucher-placeholder-large">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="2" y="5" width="20" height="14" rx="2"/>
                                    <path d="M2 10h20M7 15h.01M11 15h2"/>
                                </svg>
                            </div>
                        `}
                        ${isApplied ? '<div class="voucher-check-badge">✓</div>' : ''}
                    </div>
                    <div class="voucher-info-wrapper">
                        <div class="voucher-type-badge ${voucher.type === 'issued_reward' ? 'issued' : 'catalog'}">
                            ${voucher.type === 'issued_reward' ? '🎟️ Issued' : '🎁 Redeemable'}
                        </div>
                        <h3 class="voucher-name">${voucherName}</h3>
                    </div>
                </div>
                ${expiryDisplay ? `
                    <div class="voucher-expiry ${expiryDisplay.includes('Expires in') ? 'urgent' : ''}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        <span>${expiryDisplay}</span>
                    </div>
                ` : ''}
                <div class="voucher-card-actions">
                    ${isApplied ? `
                        <button class="voucher-btn voucher-applied" disabled>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Applied
                        </button>
                        <button class="voucher-btn voucher-remove"
                                onclick="event.stopPropagation(); window.handleVoucherRemove('${voucher.code}');"
                                ${disabled ? 'disabled' : ''}>
                            ${isLoading ? '⏳' : '✕'}
                        </button>
                    ` : `
                        <button class="voucher-btn voucher-apply"
                                onclick="event.stopPropagation(); window.handleVoucherApply('${voucher.code}');"
                                ${disabled ? 'disabled' : ''}>
                            ${isLoading ? `<span class="btn-spinner"></span>Applying...` : 'Apply Voucher'}
                        </button>
                    `}
                </div>
            </div>
        `;
    }).join('');

    console.log('✅ Rendered', vouchers.length, 'vouchers');

    if (appliedVoucherCode) {
        setTimeout(() => {
            const appliedCard = document.querySelector(`[data-voucher-code="${appliedVoucherCode}"]`);
            if (appliedCard) appliedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
}

export function filterVouchers(filterType) {
    console.log('🔍 Filtering vouchers by type:', filterType);

    if (!['all', 'issued', 'catalog'].includes(filterType)) {
        console.error('❌ Invalid filter type:', filterType);
        return;
    }

    const content = document.getElementById('vouchersModalContent');
    if (!content) {
        console.error('❌ Vouchers modal content not found');
        return;
    }

    sendVoucherWS({ action: 'voucher_filter_change', filterType });

    updateFilterButtons(filterType);

    content.innerHTML = renderVoucherSkeletons(3);

    setTimeout(() => {
        renderVouchersModal(filterType);

        setTimeout(() => {
            document.querySelectorAll('.voucher-card-full').forEach(card => {
                card.classList.add('loaded');
            });
        }, 50);
    }, 150);
}

function updateFilterButtons(activeFilter) {
    const buttons = document.querySelectorAll('.voucher-filter-btn');

    if (buttons.length === 0) {
        console.warn('⚠️ No filter buttons found');
        return;
    }

    buttons.forEach(btn => {
        const filterType = btn.getAttribute('data-filter');
        if (!filterType) return;
        btn.classList.toggle('active', filterType === activeFilter);
    });
}

export function updateVoucherFilterCounts() {
    const counts = getVoucherCount();

    console.log('🔢 Updating filter button counts:', counts);

    const allCount = document.getElementById('filterAllCount');
    const issuedCount = document.getElementById('filterIssuedCount');
    const catalogCount = document.getElementById('filterCatalogCount');

    if (allCount) allCount.textContent = counts.total;
    if (issuedCount) issuedCount.textContent = counts.issued;
    if (catalogCount) catalogCount.textContent = counts.catalog;
}

// ============================================
// VOUCHER APPLY/REMOVE LOGIC (CONSOLIDATED)
// ============================================

export async function applyVoucherAndRecalculate(voucher) {
    console.log('💳 Applying voucher:', voucher.redeem_code || voucher.code);

    if (!voucher) {
        console.error('❌ Voucher is missing');
        return { success: false, error: 'Voucher missing' };
    }

    const { order, setOrder } = useOrder();

    if (!order || !order.sales_dtls || order.sales_dtls.length === 0) {
        console.warn('⚠️ Cannot apply voucher to empty cart');
        return { success: false, error: 'Cart is empty' };
    }

    const voucherInfo = getVoucherInfo('EBER', voucher);
    if (!voucherInfo) {
        showVoucherError('Invalid voucher configuration');
        return { success: false, error: 'Invalid voucher configuration' };
    }

    if (voucherInfo.type === 'REWARD') {
        console.log('🎁 Reward voucher detected');

        const redeemResult = await redeemEberVoucher({
            info: {
                eberpayload: {
                    redeem_code: voucher.redeem_code || voucher.code,
                    verify_only: 0,
                },
            },
        });

        if (!redeemResult?.success) {
            showVoucherError('Failed to redeem voucher');
            return { success: false, error: 'Voucher redemption failed' };
        }

        const voucherAmount = parseFloat(voucher.pos_redeem_amount || voucher.posRedeemAmount || 0);

        if (!voucherAmount || voucherAmount <= 0) {
            console.warn('⚠️ No voucher amount - treating as verify-only reward');
            setOrder({ ...order, voucher_code: voucherInfo.code, voucher_name: voucherInfo.name });
            return { success: true, voucher: voucherInfo, discount: 0, order };
        }

        const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
        const svcRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;
        const isTakeaway = localStorage.getItem("orderType") === "T";

        const subtotal = order.sales_dtls.reduce((sum, item) =>
            sum + parseFloat(item.sub_total || 0), 0
        );

        const totalDiscount = Math.min(voucherAmount, subtotal);
        const subtotalAfterDiscount = Math.max(0, subtotal - totalDiscount);
        const totalService = !isTakeaway ? (subtotalAfterDiscount * svcRate / 100) : 0;
        const totalGST = subtotalAfterDiscount * gstRate / 100;
        const netTotal = subtotalAfterDiscount + totalService + totalGST;

        const updatedOrder = {
            ...order,
            voucher_code: voucherInfo.code,
            voucher_name: voucherInfo.name,
            voucher_discount: totalDiscount.toFixed(2),
            total_disc: totalDiscount.toFixed(2),
            total_svc: totalService.toFixed(2),
            total_tax: totalGST.toFixed(2),
            net_amt: netTotal.toFixed(2),
            final_amt: netTotal.toFixed(2),
        };

        setOrder(updatedOrder);

        if (typeof renderCartFromOrder === 'function') renderCartFromOrder();
        if (typeof updateCartCount === 'function') updateCartCount();

        return { success: true, voucher: voucherInfo, discount: totalDiscount, order: updatedOrder };
    }

    let updatedOrder;
    let discountAmount = 0;

    if (voucherInfo.type === 'BILL') {
        const result = await applyBillVoucher(order, voucherInfo);
        updatedOrder = result.order || result;
        discountAmount = parseFloat(result.discount || updatedOrder.voucher_discount || 0);
    } else if (voucherInfo.type === 'ITEM') {
        const result = await applyItemVoucher(order, voucherInfo);
        updatedOrder = result.order || result;
        discountAmount = parseFloat(result.discount || updatedOrder.voucher_discount || 0);
    } else {
        showVoucherError('Unsupported voucher type');
        return { success: false, error: 'Unsupported voucher type' };
    }

    setOrder(updatedOrder);

    return { success: true, voucher: voucherInfo, discount: discountAmount, order: updatedOrder };
}

function showVoucherAppliedMessage(voucherName, discount = 0) {
    if (discount && discount > 0) {
        showToast(`You saved $${discount.toFixed(2)}`, 'success', `${voucherName} applied!`, 4000);
    } else {
        showToast('Voucher has been applied to your order', 'success', `${voucherName} applied!`, 4000);
    }
}


function calculateVoucherDiscount(voucher, subtotal, items) {
    let discount = 0;

    const method = voucher.posRedeemMethod?.toLowerCase() || '';

    if (method.includes('evolut') || method.includes('tender')) {
        if (voucher.posRedeemAmount) {
            discount = parseFloat(voucher.posRedeemAmount);
        } else {
            const amountMatch = method.match(/\$(\d+(?:\.\d+)?)/);
            if (amountMatch) discount = parseFloat(amountMatch[1]);
        }
    } else if (method === 'fixed' || voucher.posRedeemAmount) {
        discount = parseFloat(voucher.posRedeemAmount || 0);
        if (discount > subtotal) {
            return { success: false, error: `Minimum order of ${discount.toFixed(2)} required` };
        }
    } else if (method === 'percentage' || voucher.posRedeemPercentage) {
        const percentage = parseFloat(voucher.posRedeemPercentage || 0);
        discount = (subtotal * percentage) / 100;
        if (voucher.posRedeemAmount) {
            discount = Math.min(discount, parseFloat(voucher.posRedeemAmount));
        }
    } else if (method === 'special' || voucher.discountRule) {
        discount = calculateSpecialDiscount(voucher, subtotal, items);
    } else {
        const nameMatch = voucher.name?.match(/(\d+(?:\.\d+)?)\s*\$/);
        if (nameMatch) {
            discount = parseFloat(nameMatch[1]);
        } else if (voucher.posRedeemAmount) {
            discount = parseFloat(voucher.posRedeemAmount);
        } else {
            return { success: false, error: 'Could not determine voucher discount amount' };
        }
    }

    if (isNaN(discount) || discount <= 0) {
        return { success: false, error: 'Invalid voucher discount amount' };
    }

    return { success: true, discount: parseFloat(discount.toFixed(2)) };
}

function calculateSpecialDiscount(voucher, subtotal, items) {
    const rule = voucher.discountRule;
    if (!rule || !rule.rule) return 0;

    const ruleLower = rule.rule.toLowerCase();

    if (ruleLower.includes('lowest price')) {
        const prices = items
            .filter(item => !item.parent_sno || item.parent_sno === item.s_no)
            .map(item => parseFloat(item.unit_price || 0));
        if (prices.length > 0) return Math.min(...prices);
    }

    if (ruleLower.includes('free')) {
        const qty = rule.quantity || 1;
        const itemPrices = items
            .filter(item => !item.parent_sno || item.parent_sno === item.s_no)
            .map(item => parseFloat(item.unit_price || 0))
            .sort((a, b) => a - b);
        return itemPrices.slice(0, qty).reduce((sum, price) => sum + price, 0);
    }

    return 0;
}

export async function removeVoucherAndRecalculate(voucherCode) {
    console.log('🗑️ Removing voucher with batch logic:', voucherCode);

    const { order, setOrder } = useOrder();

    if (!voucherCode) {
        voucherCode = order?.voucher_code;
        console.log('⚠️ No voucher code provided, using from order:', voucherCode);
    }

    if (!voucherCode) {
        showVoucherError('No voucher to remove');
        return { success: false, error: 'No voucher specified' };
    }

    const appliedVouchers = voucherState.getApplied();
    const voucherToRemove = appliedVouchers.find(
        v => v.code === voucherCode || v.raw?.redeem_code === voucherCode
    );

    if (!voucherToRemove && !order?.voucher_code) {
        showVoucherError('Voucher not found');
        return { success: false, error: 'Voucher not applied' };
    }

    voucherState.setLoading(voucherToRemove || { code: voucherCode });

    try {
        voucherState.remove(voucherCode);

        const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
        const svcRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;
        const isTakeaway = localStorage.getItem("orderType") === "T";

        const subtotal = order.sales_dtls.reduce((sum, item) =>
            sum + parseFloat(item.sub_total || 0), 0
        );

        const totalService = !isTakeaway ? (subtotal * svcRate / 100) : 0;
        const totalGST = subtotal * gstRate / 100;
        const netTotal = subtotal + totalService + totalGST;

        const updatedOrder = {
            ...order,
            voucher_code: undefined,
            voucher_name: undefined,
            voucher_discount: undefined,
            total_disc: '0.00',
            total_svc: totalService.toFixed(2),
            total_tax: totalGST.toFixed(2),
            net_amt: netTotal.toFixed(2),
            final_amt: netTotal.toFixed(2),
        };

        setOrder(updatedOrder);

        if (typeof renderCartFromOrder === 'function') renderCartFromOrder();
        if (typeof updateCartCount === 'function') updateCartCount();

        showVoucherRemovedMessage();

        console.log('✅ Voucher removed successfully');

        voucherState.clearLoading();
        voucherState.clearPreviousOrder();

        return { success: true };

    } catch (error) {
        console.error('❌ Error removing voucher:', error);
        voucherState.clearLoading();
        showVoucherError('Failed to remove voucher. Please try again.');
        return { success: false, error: error.message };
    }
}

// ============================================
// VOUCHER UI MESSAGES (CONSOLIDATED)
// ============================================

function showVoucherSuccessMessage(voucher, discount) {
    showToast(`You saved $${discount.toFixed(2)}`, 'success', `${voucher.name} applied!`);
}

function showVoucherError(message) {
    const messageEl = document.getElementById('voucherMessage');
    if (messageEl) {
        messageEl.className = 'voucher-message error';
        messageEl.innerHTML = `<span class="message-icon">⚠️</span><span class="message-text">${message}</span>`;
        messageEl.style.display = 'flex';
        setTimeout(() => { messageEl.style.display = 'none'; }, 3000);
    }

    const modalMessage = document.getElementById('voucherModalMessage');
    if (modalMessage) {
        modalMessage.className = 'voucher-modal-message error';
        modalMessage.textContent = message;
        modalMessage.style.display = 'block';
        setTimeout(() => { modalMessage.style.display = 'none'; }, 3000);
    }
}

function showVoucherRemovedMessage() {
    const messageEl = document.getElementById('voucherMessage');
    if (messageEl) {
        messageEl.className = 'voucher-message info';
        messageEl.innerHTML = `<span class="message-icon">ℹ️</span><span class="message-text">Voucher removed</span>`;
        messageEl.style.display = 'flex';
        setTimeout(() => { messageEl.style.display = 'none'; }, 2000);
    }
}

// ============================================
// EBER API FUNCTIONS
// ============================================

export async function redeemEberVoucher(params = {}) {
    const storeName = localStorage.getItem("storename");

    if (!storeName) {
        console.error('❌ Store name missing');
        return { success: false, error: 'Store not initialized' };
    }

    let eberpayload = params?.info?.eberpayload || {};
    eberpayload = { ...eberpayload, custom_store_id: storeName };

    try {
        const response = await fetch(`/api/eber/integration/redeem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eberpayload, ...params })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to redeem voucher');
        }

        const result = await response.json();
        console.log('✅ Voucher redeemed successfully:', result);
        return { success: true, ...result };

    } catch (error) {
        console.error('❌ Redeem voucher error:', error);
        return { success: false, error: error.message };
    }
}

export async function voidEberVoucherTransaction(params = {}) {
    const sessionid = sessionStorage.getItem("sessionid");
    let eberpayload = params?.info?.eberpayload || {};

    try {
        const response = await fetch(`/api/eber/integration/used_issued_reward/void?sessionid=${sessionid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eberpayload, ...params })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to void voucher');
        }

        const result = await response.json();
        console.log('✅ Voucher voided successfully:', result);
        return { success: true, ...result };

    } catch (error) {
        console.error('❌ Void voucher error:', error);
        return { success: false, error: error.message };
    }
}

export async function issueEberPoints(params = {}) {
    const sessionid = sessionStorage.getItem("sessionid");
    let eberpayload = params?.info?.eberpayload || {};

    try {
        const response = await fetch(`/api/eber/integration/issue_point?sessionid=${sessionid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eberpayload, ...params })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to issue points');
        }

        const result = await response.json();
        console.log('✅ Points issued successfully:', result);
        return { success: true, ...result };

    } catch (error) {
        console.error('❌ Issue points error:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// VOUCHER SELECT HANDLER (CONSOLIDATED)
// ============================================
export function selectVoucher(voucher) {
    console.log('🎟️ Selecting voucher:', voucher.code);

    const order = window.orderData || useOrder?.getState?.()?.order || {};
    const voucherCard = document.querySelector(`[data-voucher-code="${voucher.code}"]`);

    if (order?.voucher_code === voucher.code) {
        showConfirm(
            `Are you sure you want to remove "${voucher.redeem_name || voucher.name}"?`,
            'Remove Voucher',
            { confirmText: 'Yes, Remove', cancelText: 'Cancel', danger: true }
        ).then(confirmed => {
            if (confirmed) removeVoucherAndRecalculate();
        });
        return;
    }

    if (voucherCard) {
        const btn = voucherCard.querySelector('.voucher-select-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Applying...'; }
    }

    voucherState.setLoading(voucher);
    applyVoucherAndRecalculate(voucher)
        .then(result => {
            if (result.success) {
                console.log('✅ Voucher applied successfully');
                const voucherName = result.voucher?.name || voucher.name || voucher.redeem_name;
                const discountAmount = result.discount || 0;
                showVoucherAppliedMessage(voucherName, discountAmount);
                voucherState.add(voucher);
                sendVoucherWS({ action: 'voucher_apply_result', success: true, voucherCode: voucher.code, voucherName, discount: discountAmount });
                setTimeout(() => { closeVouchersModal(); }, 1500);
            } else {
                console.error('❌ Failed to apply voucher:', result.error);
                if (voucherCard) {
                    const btn = voucherCard.querySelector('.voucher-select-btn');
                    if (btn) { btn.disabled = false; btn.textContent = 'Select Voucher'; }
                }
                showVoucherError(result.error || 'Failed to apply voucher');
            }
            voucherState.clearLoading();
        })
        .catch(err => {
            console.error('❌ Error applying voucher:', err);
            if (voucherCard) {
                const btn = voucherCard.querySelector('.voucher-select-btn');
                if (btn) { btn.disabled = false; btn.textContent = 'Select Voucher'; }
            }
            voucherState.clearLoading();
            showVoucherError('Failed to apply voucher. Please try again.');
        });
}

// ✅ FIX 3: keydown ESC listener guarded against double-registration.
// Previously this ran at module scope on every evaluation.
if (!window.__eberKeydownListenerAttached) {
    window.__eberKeydownListenerAttached = true;
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeVouchersModal();
        }
    });
}

window.addEventListener('memberLoggedIn', () => {
    updateVoucherUI();
});

// ============================================
// HANDLE VOUCHER APPLY/REMOVE (WRAPPER FUNCTIONS)
// ============================================

window.handleVoucherApply = function (voucherCode) {
    const vouchers = getAvailableVouchers();
    const voucher = vouchers.find(v => v.code === voucherCode);
    if (!voucher) {
        showVoucherError('Voucher not found');
        return;
    }
    selectVoucher(voucher);
};

window.handleVoucherRemove = async function (voucherCode) {
    const vouchers = getAvailableVouchers();
    const voucher = vouchers.find(v => v.code === voucherCode);

    if (!voucher) {
        showToast('Voucher not found', 'error');
        return;
    }

    const confirmed = await showVoucherRemovalConfirm(voucher.name);

    if (confirmed) {
        removeVoucherAndRecalculate();
        voucherState.remove(voucherCode);
        setTimeout(() => { renderVouchersModal(); }, 100);
        showToast('Voucher removed successfully', 'success');
    }
};

// ============================================
// EXPORT FOR GLOBAL ACCESS
// ============================================

window.showOrderTypeSelection = showOrderTypeSelection;
window.attachOrderTypeHandlers = attachOrderTypeHandlers;
window.handleOrderTypeSelection = handleOrderTypeSelection;
window.handleMemberLogin = handleMemberLogin;
window.clearSessionOnPageLoad = clearSessionOnPageLoad;
window.proceedAsGuest = proceedAsGuest;
window.selectVoucher = selectVoucher;
window.openVouchersModal = openVouchersModal;
window.closeVouchersModal = closeVouchersModal;
window.renderVouchersModal = renderVouchersModal;
window.filterVouchers = filterVouchers;
window.updateVoucherFilterCounts = updateVoucherFilterCounts;
window.applyVoucherAndRecalculate = applyVoucherAndRecalculate;
window.removeVoucherAndRecalculate = removeVoucherAndRecalculate;
window.handleMemberLogout = handleMemberLogout;
window.applyVoucherToOrder = applyVoucherToOrder;
window.getVoucherInfo = getVoucherInfo;
window.showVoucherAppliedMessage = showVoucherAppliedMessage;
window.logoutMember = logoutMember;
window.invalidateVoucherCache = invalidateVoucherCache;

// ============================================
// EXPORT DEFAULT
// ============================================

export default {
    getAvailableVouchers,
    getVouchersByType,
    getVoucherCount,
    selectVoucher,
    openVouchersModal,
    closeVouchersModal,
    renderVouchersModal,
    voucherState,
    attachOrderTypeHandlers,
    proceedAsGuest,
    getVoucherInfo,
    applyVoucherAndRecalculate,
    removeVoucherAndRecalculate,
    applyVoucherToOrder
};

// ============================================
// INITIALIZATION
// ============================================

(function initializeEberModule() {
    console.log('🚀 Initializing eber.js module...');

    const criticalFunctions = [
        'clearSessionOnPageLoad',
        'attachOrderTypeHandlers',
        'handleOrderTypeSelection',
        'handleMemberLogin',
        'proceedAsGuest',
        'showOrderTypeSelection'
    ];

    const missing = criticalFunctions.filter(fn => typeof window[fn] !== 'function');

    if (missing.length > 0) {
        console.error('❌ Missing functions:', missing);
    } else {
        console.log('✅ All eber.js functions exported successfully');
    }

    window.eberReady = true;
    window.dispatchEvent(new CustomEvent('eberModuleReady', {
        detail: { timestamp: Date.now() }
    }));

    console.log('✅ Eber.js module ready');
})();

const CATEGORY_MAPPING = {
    'DRAUGHT BEERS 500ML': ['DRAUGHT BEERS 500ML', 'BEER BOTTLED', 'BOTTLED BEER', 'BEER', 'BEERS'],
    'SPIRITS': ['SPIRITS', 'LIQUOR', 'HARD LIQUOR'],
    'WINE': ['WINE', 'RED WINE', 'WHITE WINE', 'SPARKLING WINE'],
    'COCKTAILS': ['COCKTAILS', 'MIXED DRINKS'],
    'FOOD': ['FOOD', 'APPETIZERS', 'MAINS', 'SIDES', 'DESSERTS']
};


function checkItemEligibility(item, promotion) {
    const requiredCategories = promotion.item_menu_category_dtls || [];

    if (!requiredCategories.length) return true;

    const itemCategoryRaw = item.category_code || item.menu_category_code || item.category || '';
    const itemCategory = normalizeCategory(itemCategoryRaw);

    if (!itemCategory) return false;

    const categoryMapping = buildCategoryMapping();

    for (const reqCat of requiredCategories) {
        const requiredCode = normalizeCategory(reqCat.category_code);

        if (itemCategory === requiredCode) return true;

        const mappedCategories = (categoryMapping[requiredCode] || []).map(normalizeCategory);
        if (mappedCategories.includes(itemCategory)) return true;

        const reverseMapped = (categoryMapping[itemCategory] || []).map(normalizeCategory);
        if (reverseMapped.includes(requiredCode)) return true;

        if (itemCategory.includes(requiredCode) || requiredCode.includes(itemCategory)) return true;
    }

    return false;
}

async function applyPromotionsWithMapping(items, promotions) {
    console.log('🎯 Applying promotions with dynamic category mapping');

    const itemsWithCategories = items.map(item => ({
        ...item,
        category_code: normalizeCategory(
            item.category_code || item.menu_category_code || item.category
        )
    }));

    const applyPromotionsFunc = applyPromotions || window.applyPromotions;

    if (typeof applyPromotionsFunc !== 'function') {
        console.error('❌ applyPromotions function not available');
        return { orderItems: itemsWithCategories, applied: 0, amount: 0 };
    }

    const categoryMapping = buildCategoryMapping();

    const enhancedPromotions = promotions.map(originalPromo => {
        const promo = JSON.parse(JSON.stringify(originalPromo));
        const categories = promo.item_menu_category_dtls || [];

        if (!categories.length) return promo;

        const expandedCategories = [];
        const seen = new Set();

        categories.forEach(cat => {
            const code = normalizeCategory(cat.category_code);

            if (!seen.has(code)) {
                expandedCategories.push({ ...cat, category_code: code });
                seen.add(code);
            }

            const mapped = categoryMapping[code] || [];
            mapped.forEach(mappedCode => {
                const normalizedMapped = normalizeCategory(mappedCode);
                if (!seen.has(normalizedMapped)) {
                    expandedCategories.push({ ...cat, category_code: normalizedMapped });
                    seen.add(normalizedMapped);
                }
            });
        });

        promo.item_menu_category_dtls = expandedCategories;
        promo.creteria_item_dtls = expandedCategories.map(c => c.category_code);
        promo.limit = promo.limit ?? promo.qty_limit ?? 0;

        return promo;
    });

    const voucherPromoInfo = enhancedPromotions[0];

    const result = await applyPromotionsFunc(itemsWithCategories, null, voucherPromoInfo);

    console.log('📊 Promotion result:', result);

    return result;
}

function normalizeCategory(code) {
    return (code || '').toString().trim().toUpperCase();
}

function buildCategoryMapping() {
    const baseMapping = {
        'DRAUGHT BEERS 500ML': ['DRAUGHT BEERS 500ML', 'BEER BOTTLED', 'BOTTLED BEER', 'BEER', 'BEERS'],
        'BEER BOTTLED': ['BEER BOTTLED', 'DRAUGHT BEERS 500ML', 'BEER', 'BEERS', 'BOTTLED BEER'],
        'BEER': ['BEER', 'BEER BOTTLED', 'DRAUGHT BEERS 500ML', 'BEERS'],
        'BEERS': ['BEERS', 'BEER', 'BEER BOTTLED', 'DRAUGHT BEERS 500ML'],
        'WINE': ['WINE', 'RED WINE', 'WHITE WINE', 'SPARKLING WINE', 'WINES'],
        'RED WINE': ['RED WINE', 'WINE', 'WINES'],
        'WHITE WINE': ['WHITE WINE', 'WINE', 'WINES']
    };

    const cache = useCache();
    let promos = cache?.promos;

    if (typeof promos === 'string') {
        try { promos = JSON.parse(promos); } catch { return baseMapping; }
    }

    if (!Array.isArray(promos)) promos = Object.values(promos || {});

    promos.forEach(promo => {
        const categories = promo.item_menu_category_dtls || [];

        categories.forEach(cat => {
            const code = normalizeCategory(cat.category_code);
            if (!code) return;

            if (!baseMapping[code]) baseMapping[code] = [];
            if (!baseMapping[code].includes(code)) baseMapping[code].unshift(code);

            const variations = generateCategoryVariations(code);
            variations.forEach(variation => {
                const normalized = normalizeCategory(variation);
                if (!baseMapping[code].includes(normalized)) baseMapping[code].push(normalized);
            });
        });
    });

    return baseMapping;
}


function generateCategoryVariations(categoryCode) {
    const variations = [categoryCode];

    if (categoryCode.endsWith('S')) {
        variations.push(categoryCode.slice(0, -1));
    } else {
        variations.push(categoryCode + 'S');
    }

    const withoutSize = categoryCode
        .replace(/\s*\d+ML$/i, '')
        .replace(/\s*BOTTLED$/i, '')
        .replace(/\s*DRAUGHT$/i, '')
        .trim();

    if (withoutSize !== categoryCode) variations.push(withoutSize);

    const words = categoryCode.split(/\s+/);
    const baseWord = words.find(w => !w.match(/^\d+$/) && !w.match(/ML$/i) && w.length > 2);

    if (baseWord && !variations.includes(baseWord)) {
        variations.push(baseWord);
        if (baseWord.endsWith('S')) {
            variations.push(baseWord.slice(0, -1));
        } else {
            variations.push(baseWord + 'S');
        }
    }

    return [...new Set(variations)];
}


const VOUCHER_BADGE_MAP = {
    "ROCY9DA": "$10.00 OFF",
    "RBYULGV": "$10.00 OFF",
    "RB7Z60Y": "$10.00 OFF",
    "rewardid-48842-uid-21169555": "$10.00 OFF",
    "rewardid-48843-uid-21169555": "$10.00 OFF",
    "RD3EEO4": "Complimentary",
    "R3U3TI9": "Complimentary"
};


function getVoucherBadge(voucher) {
    const code = voucher.redeem_code || voucher.code;
    if (VOUCHER_BADGE_MAP[code]) return VOUCHER_BADGE_MAP[code];

    const amount = parseFloat(voucher.pos_redeem_amount || 0);
    const name = (voucher.redeem_name || voucher.name || '').toLowerCase();

    if ((name.includes('free') || name.includes('complimentary')) && amount === 0) return 'Complimentary';
    return amount > 0 ? `$${amount.toFixed(2)} OFF` : 'Complimentary';
}