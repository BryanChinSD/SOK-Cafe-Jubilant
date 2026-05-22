import { useCache } from '../stores/cache-store.js';
import { useOrder, useOrderStore } from '../stores/order-store.js';
import { uiTranslations } from './Translation.js';

import {
    handleMemberLogin,
    clearSessionOnPageLoad,
    attachOrderTypeHandlers,
    handleOrderTypeSelection,
    proceedAsGuest,
    showOrderTypeSelection,
    removeVoucherAndRecalculate
} from '../utils/eber.js';

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

import {
    getLangs,
    fetchStoreDetails,
    getMenuItems,
    getItems,
    getPromos,
    getAddons,
    getItemRemarks,
    checkStocks,
    getSvcs,
    getMenuCategoryItemTranslations,
    postOrder
} from './netApi.js';

import {
    getItemImageUrl,
    addToCart,
    updateCartCount,
    showAddOnModalOriginal,
    groupItemsByTemperature,
    getItemTemperature,
    resolveImageUrl,
    getTranslatedName,
    preloadCartImages,
    emptyCart
} from './GetHomeAPI.js';

let renderDebounceTimer = null;
const RENDER_DEBOUNCE_MS = 50; // Small delay to batch multiple updates

export function renderCartFromOrder(forceImmediate = false) {
    // Clear any pending render
    if (renderDebounceTimer && !forceImmediate) {
        clearTimeout(renderDebounceTimer);
    }

    // If force immediate or no debounce timer, render now
    if (forceImmediate) {
        _renderCartFromOrderInternal();
    } else {
        // Debounce: wait for updates to settle
        renderDebounceTimer = setTimeout(() => {
            renderDebounceTimer = null;
            _renderCartFromOrderInternal();
        }, RENDER_DEBOUNCE_MS);
    }
}

window.updateBottomNavVisibility = updateBottomNavVisibility;

function _renderCartFromOrderInternal() {
    if (window.isRenderingCart) {
        console.log('⏭️ Already rendering, will retry after completion');
        if (!window.renderCartPending) {
            window.renderCartPending = true;
            setTimeout(() => {
                window.renderCartPending = false;
                renderCartFromOrder(true);
            }, 150);
        }
        return;
    }

    window.isRenderingCart = true;
    let savedScroll = 0;

    try {
        const cartItemsContainer = document.getElementById('cartItems');
        savedScroll = cartItemsContainer?.scrollTop || 0;

        console.log('🔄 renderCartFromOrder called');

        const orderObj = useOrder();
        const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
        const serviceRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;

        if (!orderObj || !orderObj.order) {
            console.warn('⚠️ No order found, rendering empty cart');
            renderEmptyCart();
            return;
        }

        const order = orderObj.order;
        const salesDtls = order.sales_dtls || [];
        if (!cartItemsContainer) {
            console.warn('⚠️ Cart items container not found');
            return;
        }

        const orderType = order.service_type || order.service_type_info || order.order_type || '';
        const lsOrderType = localStorage.getItem('orderType') || 'E';

        const isDineIn = orderType === 'E' || lsOrderType === 'E' || orderType.toLowerCase().includes('dine');

        // ✅ HELPER: Identify charge items
        const isChargeItem = (item) =>
            item.is_charge_item === 'Y' ||
            item.category_code === 'TAKEAWAY CHARGES' ||
            item.item_no === 'TAKEAWAY_CHARGE';

        const imageMap = new Map();
        const restaurantLogo = RESTAURANT_CONFIG?.logo || '/img/LIHO-logo.jpg';

        // ✅ DEEP IMAGE MAPPER: Resolves by ID and Name to fix "Best Seller" missing images
        const buildImageMapFromArray = (itemsArray, sourceName) => {
            if (!Array.isArray(itemsArray)) return 0;
            let count = 0;
            itemsArray.forEach(item => {
                const imageSource = item.tqr_image_url || item.item_image || item.image || '';
                if (!imageSource || imageSource.includes('Logo.png')) return;

                const finalUrl = imageSource.startsWith('public/upload/')
                    ? `/api/GetImageProxy?imageUrl=${encodeURIComponent(imageSource)}`
                    : imageSource;

                // Map by multiple ID fields
                const ids = [item.item_no, item.product_code, item.product_no, item.item_id];
                ids.forEach(id => { if (id) imageMap.set(String(id), finalUrl); });

                // Map by Name (Normalizing to lowercase for fuzzy matching)
                const names = [item.item_desc, item.item_name, item.product_name];
                names.forEach(name => {
                    if (name) {
                        const key = String(name).trim().toLowerCase();
                        if (key) imageMap.set(key, finalUrl);
                    }
                });
                count++;
            });
            console.log(`✅ [${sourceName}] indexed ${count} image references.`);
            return count;
        };

        // Populate the map from all available memory/storage buffers
        try {
            if (window.apiManager?.isLoaded('menuItems')) {
                const menuData = window.apiManager.loadedData.get('menuItems') || [];
                buildImageMapFromArray(menuData.flatMap(s => s.items || []), 'apiManager');
            }
            if (Array.isArray(window.menuGridItems)) {
                buildImageMapFromArray(window.menuGridItems, 'window.menuGridItems');
            }
            if (window.itemImageMap?.size > 0) {
                window.itemImageMap.forEach((url, key) => imageMap.set(String(key), url || restaurantLogo));
            }
            // Check session storage fallbacks
            ['MenuItems', 'FullItems'].forEach(storageKey => {
                try {
                    const data = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
                    const flat = storageKey === 'MenuItems' ? data.flatMap(s => s.items || []) : data;
                    buildImageMapFromArray(flat, `sessionStorage ${storageKey}`);
                } catch (e) { }
            });
        } catch (err) {
            console.error("❌ Image map build failed:", err);
        }

        const getImageUrlForItem = (item) => {
            // 1. Direct property check
            const rawUrl = item.tqr_image_url || item.item_image || item.image;
            if (rawUrl && rawUrl !== '' && !rawUrl.includes('Logo.png')) {
                return rawUrl.startsWith('public/upload/') ? `/api/GetImageProxy?imageUrl=${encodeURIComponent(rawUrl)}` : rawUrl;
            }
            // 2. Map Lookup (ID then Name)
            const idKey = String(item.item_no || item.product_code || '');
            if (idKey && imageMap.has(idKey)) return imageMap.get(idKey);

            const nameKey = (item.item_desc || item.item_name || '').trim().toLowerCase();
            if (nameKey && imageMap.has(nameKey)) return imageMap.get(nameKey);

            return restaurantLogo;
        };

        // Language resolution
        let selectedLang = window.selectedLang || sessionStorage.getItem('selectedLang') || localStorage.getItem('selectedLang') || 'en';

        // Deduplicate and translate
        const seen = new Set();
        const sales = salesDtls.filter(i => {
            const key = `${i.s_no ?? ''}-${i.item_no ?? ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        sales.forEach(item => {
            item.display_name = (typeof getTranslatedName === 'function')
                ? getTranslatedName(item.item_no, item.item_desc || item.item_name, selectedLang, "item")
                : (item.item_desc || item.item_name || 'Unknown Item');
        });
        window.globalImageMap = imageMap;
        const baseItems = sales.filter(i => String(i.s_no) === String(i.parent_sno || i.s_no));
        const addonRecords = sales.filter(i => String(i.s_no) !== String(i.parent_sno || i.s_no));

        if (!baseItems.length) { renderEmptyCart(); return; }

        showBottomNav();
        enableCartButtons();

        cartItemsContainer.innerHTML = baseItems.map((item) => {
            const qty = Number(item.qty || 1);
            const childItems = addonRecords.filter(a => String(a.parent_sno) === String(item.s_no));
            const realChildItems = childItems.filter(c => !isChargeItem(c));
            const chargeItems = childItems.filter(c => isChargeItem(c));

            const imageUrl = getImageUrlForItem(item);
            const isModifierSet = Array.isArray(item.itemmaster_menutype_grpdtls) ? item.itemmaster_menutype_grpdtls.length > 0 : Boolean(item.itemmaster_menutype_grpdtls);
            const isAddonSet = item.add_on_name?.trim().toUpperCase() === 'ADD ON';
            const isAlacarte = realChildItems.length === 0;

            let displayPrice = 0;
            let mainItemPrice = 0;

            if (isModifierSet) {
                displayPrice = realChildItems.reduce((sum, child) => sum + Number(child.sub_total ?? 0), 0);
            } else if (isAddonSet) {
                mainItemPrice = Number(item.selling_uom_dtls?.[0]?.price_dtls?.[0]?.dine_in_price || item.selling_uom_dtls?.[0]?.price_dtls?.[0]?.takeaway_price || item.sub_total || 0);
                displayPrice = mainItemPrice + realChildItems.reduce((sum, child) => sum + Number(child.sub_total ?? 0), 0);
            } else {
                displayPrice = (Number(item.unit_price ?? 0) * qty) + realChildItems.reduce((sum, child) => sum + Number(child.sub_total ?? 0), 0);
                mainItemPrice = displayPrice;
            }

            const mainRemarks = item.remarks?.trim() ? item.remarks.split(',').map(r => r.trim()).filter(Boolean) : [];
            const isTakeaway = item.take_away_item === 'Y';

            // Generate HTML for modifications and charges
            const modsHtml = (realChildItems.length > 0 || chargeItems.length > 0) ? `
                <div class="cart-modifications">
                    ${isAddonSet && realChildItems.length > 0 ? `<div class="cart-modification-row"><span class="cart-modification-name" style="font-weight: 500;">Base Item</span><span class="cart-modification-qty-spacer"></span><span class="cart-modification-price">$${mainItemPrice.toFixed(2)}</span></div>` : ''}
                    ${realChildItems.map(c => `
                        <div class="cart-modification-item">
                            <div class="cart-modification-row">
                                <span class="cart-modification-prefix">+</span><span class="cart-modification-name">${c.display_name}</span>
                                ${c.qty > 1 ? `<span class="cart-modification-qty">×${c.qty}</span>` : `<span class="cart-modification-qty-spacer"></span>`}
                                <span class="cart-modification-price">${(c.disc_name && c.disc_name !== 'None') ? `<span style="color:#16a34a;font-weight:700;">FREE</span>` : `+$${Number(c.sub_total || 0).toFixed(2)}`}</span>
                            </div>
                        </div>`).join('')}
                    ${chargeItems.map(c => `<div class="cart-modification-row"><span class="cart-modification-prefix">+</span><span class="cart-modification-name">${c.item_desc || c.item_name}</span><span class="cart-modification-qty-spacer"></span><span class="cart-modification-price">+$${Number(c.sub_total || 0).toFixed(2)}</span></div>`).join('')}
                </div>` : '';

            return `
                <div class="cart-item-card">
                    <div class="cart-item-main">
                        <div class="cart-item-header">
                            <img src="${imageUrl}" alt="${item.display_name}" class="cart-item-image" loading="eager" fetchpriority="high" onerror="this.src='${restaurantLogo}';">
                            <div class="cart-item-details">
                                <div class="cart-item-title"><span class="cart-item-qty">${qty}x</span><span class="cart-item-name">${item.display_name}</span></div>
                                <div class="cart-item-price">$${(Number(item.unit_price ?? 0) * qty).toFixed(2)}</div>

                            </div>
                        </div>
                        ${mainRemarks.length > 0 ? `<div class="cart-item-remarks">${mainRemarks.map(r => `<span class="remark-tag">${r}</span>`).join('')}</div>` : ''}
                        ${modsHtml}
                    </div>
                    <div class="cart-item-actions">
                        <div class="cart-qty-controls">
                            <button class="cart-qty-btn" onclick="GetHomeAPI.updateQuantityBySno('${item.s_no}', -1)">-</button>
                            <span class="cart-qty-display">${qty}</span>
                            <button class="cart-qty-btn" onclick="GetHomeAPI.updateQuantityBySno('${item.s_no}', 1)">+</button>
                        </div>
                        <div class="cart-action-buttons">
                            ${!isAlacarte ? `<button class="cart-action-btn cart-edit-btn" onclick="GetHomeAPI.editItem('${item.s_no}','${item.item_no}')">Edit</button>` : ''}
                            <button class="cart-action-btn cart-remove-btn" data-sno="${item.s_no}">Remove</button>
                        </div>
                    </div>
                </div>`;
        }).join('');

        updateCartSummary(order, gstRate, serviceRate);

        requestAnimationFrame(() => {
            if (cartItemsContainer && savedScroll > 0) cartItemsContainer.scrollTop = savedScroll;
        });

    } finally {
        window.isRenderingCart = false;
        console.log('🔓 Render lock released');
    }
}


// Replace your updateBottomNavVisibility with this.
// The old version hid the nav for cartOpen — but the cart modal
// has PLACE ORDER inside it, and the nav showing/hiding while
// cart is open is irrelevant (nav is behind the modal anyway).
// Only addonOpen and successOpen should block the nav.

export function updateBottomNavVisibility() {
    const bottomNav = document.querySelector('.bottom-nav');
    if (!bottomNav) return;

    const cartOpen = window.modalState?.cartOpen || false;
    const addonOpen = window.modalState?.addonOpen || false;
    const successOpen = window.modalState?.successOpen || false;

    console.log('🔍 Bottom nav check:', { cartOpen, addonOpen, successOpen });

    // ✅ Only hide for addon or success modal
    // Cart modal is full-screen so nav is visually irrelevant,
    // but hiding it was causing PLACE ORDER to be blocked when
    // modalState got out of sync (addonOpen stuck true).
    if (cartOpen || addonOpen || successOpen) {
        bottomNav.style.display = 'none';
        bottomNav.classList.remove('show');
        console.log('🚫 Bottom nav hidden — addon/success modal open');
        return;
    }

    // No blocking modal — show if cart has items
    let hasCartItems = false;
    try {
        const orderObj = useOrder();
        const items = orderObj?.order?.sales_dtls || [];
        hasCartItems = items.some(item => item && item.item_no && item.qty > 0);
        console.log('📦 useOrder check:', { totalItems: items.length, hasValidItems: hasCartItems });
    } catch (err) {
        console.warn('⚠️ Error calling useOrder:', err);
        const cartItemsEl = document.getElementById('cartItems');
        hasCartItems = cartItemsEl && !cartItemsEl.querySelector('.empty-cart');
    }

    if (hasCartItems) {
        bottomNav.style.display = 'flex';
        bottomNav.style.zIndex = '1050';
        bottomNav.style.transform = 'translateY(0)';
        bottomNav.style.visibility = 'visible';
        bottomNav.style.opacity = '1';
        bottomNav.classList.add('show');
        bottomNav.classList.remove('hide-on-modal');
        console.log('✅ Bottom nav shown — has items');
    } else {
        bottomNav.style.display = 'none';
        bottomNav.classList.remove('show');
        console.log('🚫 Bottom nav hidden — cart empty');
    }
}

function renderEmptyCart() {
    const cartItemsContainer = document.getElementById('cartItems');
    if (!cartItemsContainer) return;

    cartItemsContainer.innerHTML = `
        <div class="empty-cart">
            <div class="empty-cart-text">Your cart is empty</div>
            <div class="empty-cart-subtext">Select items from the menu to get started!</div>
        </div>`;

    // Reset all totals to $0.00
    const totals = ['cartTotal', 'service-charge', 'gst', 'total'];
    totals.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '$0.00';
    });

    // Reset service charge rate display: E = Dine In, T = Takeaway
    const serviceChargeRateElement = document.getElementById("service-charge-rate");
    if (serviceChargeRateElement) {
        try {
            const storedServices = JSON.parse(sessionStorage.getItem("ServiceCharges") || "[]");
            const orderType = localStorage.getItem("orderType") || '';
            const isDineIn = orderType.toLowerCase() === 'dine in'
                || orderType.toLowerCase() === 'dinein'
                || orderType.toLowerCase() === 'dine-in';
            // E = Dine In, T = Takeaway
            const targetServiceType = isDineIn ? 'E' : 'T';
            const matchingService = storedServices.find(s => s.service_type === targetServiceType);
            const serviceRate = matchingService ? parseFloat(matchingService.service_value) || 10 : 10;
            serviceChargeRateElement.textContent = serviceRate;
        } catch (err) {
            console.error('❌ Failed to reset service charge rate:', err);
            serviceChargeRateElement.textContent = 10;
        }
    }

    // Reset main discount amount to $0.00
    const discountAmount = document.getElementById('discount-amount');
    if (discountAmount) discountAmount.textContent = '$0.00';

    // Reset voucher discount amount to $0.00
    const voucherDiscountAmount = document.getElementById('voucher-discount-amount');
    if (voucherDiscountAmount) voucherDiscountAmount.textContent = '$0.00';

    // Reset total discount amount to $0.00
    const totalDiscountAmount = document.getElementById('total-discount-amount');
    if (totalDiscountAmount) totalDiscountAmount.textContent = '$0.00';

    // Hide discount rows (but discount-amount-row stays visible as per your HTML)
    const voucherDiscountRow = document.getElementById('voucher-discount-row');
    if (voucherDiscountRow) voucherDiscountRow.style.display = 'none';

    const totalDiscountRow = document.getElementById('total-discount-row');
    if (totalDiscountRow) totalDiscountRow.style.display = 'none';

    // Optionally hide the main discount amount row when cart is empty
    const discountAmountRow = document.getElementById('discount-amount-row');
    if (discountAmountRow) discountAmountRow.style.display = 'none';

    // Disable checkout and empty cart buttons
    const checkoutBtn = document.getElementById('checkout-btn');
    if (checkoutBtn) checkoutBtn.disabled = true;

    const emptyCartBtn = document.getElementById('empty-cart-btn');
    if (emptyCartBtn) emptyCartBtn.disabled = true;

    // Hide bottom nav
    const bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) {
        bottomNav.classList.remove('show');
        bottomNav.style.display = 'none';
        bottomNav.style.transform = 'translateY(100%)';
    }

    // Reset menu section padding on mobile
    const menuSection = document.querySelector('.menu-section');
    if (menuSection && window.matchMedia('(max-width: 767px)').matches) {
        menuSection.style.paddingBottom = '0px';
    }
}

function showBottomNav() {
    const bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) {
        bottomNav.style.display = 'flex';
        bottomNav.style.position = 'fixed';
        bottomNav.style.bottom = '0';
        bottomNav.style.left = '0';
        bottomNav.style.right = '0';
        bottomNav.style.zIndex = '1050';
        bottomNav.classList.add('show');
        bottomNav.classList.remove('modal-open'); // ← ADD THIS
        console.log('✅ Bottom nav shown with full positioning');
    }

    const menuSection = document.querySelector('.menu-section');
    if (menuSection && window.matchMedia('(max-width: 767px)').matches) {
        menuSection.style.paddingBottom = '100px';
    }
}

function enableCartButtons() {
    const checkoutBtn = document.getElementById('checkout-btn');
    if (checkoutBtn) checkoutBtn.disabled = false;

    const emptyCartBtn = document.getElementById('empty-cart-btn');
    if (emptyCartBtn) emptyCartBtn.disabled = false;
}

function updateCartSummary(order, gstRate, serviceRate) {
    const subtotal = parseFloat(order.sub_total || 0);
    const serviceCharge = parseFloat(order.total_svc || 0);
    const gst = parseFloat(order.total_tax || 0);
    const totalDiscount = parseFloat(order.total_disc || 0);
    const finalTotal = parseFloat(order.net_amt || 0);

    const isTaxAbsorbed =
        order.absorb_tax === 'Y' ||
        order.absorb_tax === 'true' ||
        order.absorb_tax === true ||
        order.is_absorbtax === 1 ||
        order.is_absorbtax === "1" ||
        (order.sales_dtls || []).some(i =>
            i.is_absorbtax === 1 || i.is_absorbtax === '1'
        );

    const taxAbsorbInfo = order.absorb_tax_info || 'Tax Inclusive';
    const voucherCode = order.voucher_code;
    const voucherName = order.voucher_name;
    const voucherDiscount = parseFloat(order.voucher_discount || 0);
    const voucherType = order.voucher_type;
    const voucherValue = order.voucher_value;

    let discountAmount = parseFloat(order.discount_amt || 0);

    if (discountAmount === 0 && order.sales_dtls && order.sales_dtls.length > 0) {
        discountAmount = order.sales_dtls.reduce((sum, item) => {
            if (parseFloat(item.disc_value || 0) === 100) return sum;
            return sum + parseFloat(item.disc_amt || 0);
        }, 0);
    }

    const cartTotal = document.getElementById('cartTotal');
    if (cartTotal) cartTotal.textContent = `$${subtotal.toFixed(2)}`;

    // Discount amount row
    const discountAmountRow = document.getElementById('discount-amount-row');
    if (discountAmountRow) {
        discountAmountRow.style.display = discountAmount > 0 ? 'flex' : 'none';
        const discountAmountEl = document.getElementById('discount-amount');
        if (discountAmountEl) discountAmountEl.textContent = `-$${discountAmount.toFixed(2)}`;
    }

    // Voucher discount row
    const voucherDiscountRow = document.getElementById('voucher-discount-row');
    if (voucherDiscountRow) {
        if (voucherDiscount > 0 && voucherCode) {
            voucherDiscountRow.style.display = 'flex';
            const voucherDiscountAmount = document.getElementById('voucher-discount-amount');
            if (voucherDiscountAmount) voucherDiscountAmount.textContent = `-$${voucherDiscount.toFixed(2)}`;
            // ... (rest of your voucher label logic)
        } else {
            voucherDiscountRow.style.display = 'none';
        }
    }

    // Item discount row
    const totalDiscountRow = document.getElementById('total-discount-row');
    if (totalDiscountRow) {
        const itemDiscounts = totalDiscount - voucherDiscount - discountAmount;
        totalDiscountRow.style.display = itemDiscounts > 0 ? 'flex' : 'none';
        const totalDiscountAmount = document.getElementById('total-discount-amount');
        if (totalDiscountAmount) totalDiscountAmount.textContent = `-$${itemDiscounts.toFixed(2)}`;
    }

    // ============================================================
    // ✅ FIX: SERVICE CHARGE VISIBILITY LOGIC
    // ============================================================
    const serviceChargeEl = document.getElementById('service-charge');
    if (serviceChargeEl) {
        serviceChargeEl.textContent = `$${serviceCharge.toFixed(2)}`;

        // Find the parent row container to hide the entire line
        const serviceChargeRow = serviceChargeEl.closest('.cart-total-row');
        if (serviceChargeRow) {
            // Only show if service charge is greater than 0
            serviceChargeRow.style.display = serviceCharge > 0 ? 'flex' : 'none';
        }
    }
    // ============================================================

    const gstElement = document.getElementById('gst');
    if (gstElement) gstElement.textContent = `$${gst.toFixed(2)}`;

    // Tax absorption badge logic
    const gstRow = document.querySelector('#gst')?.closest('.cart-total-row');
    const gstLabelElement = gstRow?.querySelector('.cart-total-label');
    if (gstLabelElement) {
        const gstRateEl = document.getElementById('gst-rate');
        const currentRate = gstRateEl ? gstRateEl.textContent : gstRate;
        if (isTaxAbsorbed) {
            gstLabelElement.innerHTML = `GST (<span id="gst-rate">${currentRate}</span>%) <span class="tax-absorbed-badge" title="${taxAbsorbInfo}">Inclusive</span> :`;
        } else {
            gstLabelElement.innerHTML = `GST (<span id="gst-rate">${currentRate}</span>%):`;
        }
    }

    const totalEl = document.getElementById('total');
    if (totalEl) totalEl.textContent = `$${finalTotal.toFixed(2)}`;

    const gstRateEl = document.getElementById('gst-rate');
    const svcRateEl = document.getElementById('service-charge-rate');
    if (gstRateEl && !gstRateEl.textContent) gstRateEl.textContent = gstRate;
    if (svcRateEl && !svcRateEl.textContent) svcRateEl.textContent = serviceRate;
}


document.addEventListener('DOMContentLoaded', function () {
    if (window.__emptyCartModalInit) return;
    window.__emptyCartModalInit = true;

    const emptyCartBtn = document.getElementById('empty-cart-btn');
    const emptyCartModal = document.getElementById('emptyCartModalOverlay');
    const cancelBtn = document.getElementById('cancelEmptyCart');
    const confirmBtn = document.getElementById('confirmEmptyCart');

    if (!emptyCartBtn || !emptyCartModal) {
        console.error('❌ Empty cart elements not found');
        return;
    }

    /* =========================
       HELPER FUNCTIONS
    ========================= */

    function resetConfirmButton() {
        if (!confirmBtn) return;
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Empty Cart';
    }

    function openEmptyCartModal() {
        if (emptyCartModal.classList.contains('active')) return;

        emptyCartModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        resetConfirmButton();
        console.log('🗑️ Empty cart modal opened');
    }

    function closeEmptyCartModal() {
        if (!emptyCartModal.classList.contains('active')) return;

        emptyCartModal.classList.remove('active');
        document.body.style.overflow = 'auto';
        resetConfirmButton();
        console.log('❌ Empty cart modal closed');
    }

    // ✅ NEW: Complete cart state cleanup
    function clearAllCartState() {
        // Remove order from storage
        localStorage.removeItem("order");

        // Clear any voucher-related data
        if (typeof window.clearAppliedVoucher === 'function') {
            window.clearAppliedVoucher();
        }

        // Clear cart count
        if (typeof updateCartCount === 'function') {
            updateCartCount();
        }

        console.log('🧹 All cart state cleared');
    }

    // ✅ NEW: Reset cart UI to empty state
    function resetCartUI() {
        const cartItemsContainer =
            document.querySelector('.cart-items-container') ||
            document.querySelector('.cart-items') ||
            document.getElementById('cart-items') ||
            document.getElementById('cartItems');

        if (cartItemsContainer) {
            cartItemsContainer.innerHTML = `
                <div class="empty-cart">
                    <div class="empty-cart-text">Your cart is empty</div>
                    <div class="empty-cart-subtext">Select items from the menu to get started!</div>
                </div>`;
        }

        // Reset all totals
        const totalElements = [
            { id: 'cartTotal', value: '$0.00' },
            { id: 'service-charge', value: '$0.00' },
            { id: 'gst', value: '$0.00' },
            { id: 'total', value: '$0.00' }
        ];

        totalElements.forEach(({ id, value }) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });

        // Hide discount rows
        const voucherDiscountRow = document.getElementById('voucher-discount-row');
        if (voucherDiscountRow) voucherDiscountRow.style.display = 'none';

        const totalDiscountRow = document.getElementById('total-discount-row');
        if (totalDiscountRow) totalDiscountRow.style.display = 'none';

        // Disable buttons
        const checkoutBtn = document.getElementById('checkout-btn');
        if (checkoutBtn) checkoutBtn.disabled = true;

        const emptyCartBtnRef = document.getElementById('empty-cart-btn');
        if (emptyCartBtnRef) emptyCartBtnRef.disabled = true;

        // Hide bottom nav
        const bottomNav = document.querySelector('.bottom-nav');
        if (bottomNav) {
            bottomNav.classList.remove('show');
            bottomNav.style.display = 'none';
            bottomNav.style.transform = 'translateY(100%)';
        }

        // Remove mobile padding
        const menuSection = document.querySelector('.menu-section');
        if (menuSection && window.matchMedia('(max-width: 767px)').matches) {
            menuSection.style.paddingBottom = '0px';
        }

        console.log('🎨 Cart UI reset to empty state');
    }

    /* =========================
       EVENT LISTENERS
    ========================= */

    emptyCartBtn.addEventListener('click', function (e) {
        e.stopPropagation();

        // ✅ FIX: Use useOrder() consistently
        const orderObj = useOrder?.();
        if (!orderObj || !orderObj.order || !orderObj.order.sales_dtls?.length) {
            window.sokWebSocket?.showUpdateNotification?.(
                "Cart Empty",
                "Your cart is already empty"
            );
            return;
        }

        openEmptyCartModal();
    });

    cancelBtn?.addEventListener('click', function (e) {
        e.stopPropagation();
        closeEmptyCartModal();
    });

    confirmBtn?.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (confirmBtn.disabled) return;

        try {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Clearing...';

            // Get order consistently
            const orderObj = useOrder?.();
            if (!orderObj || !orderObj.order) {
                console.warn('⚠️ No order found');
                closeEmptyCartModal();
                resetConfirmButton();
                return;
            }

            const order = orderObj.order;
            const salesDtls = order.sales_dtls || [];

            if (!salesDtls.length) {
                console.warn('⚠️ No items in cart');
                closeEmptyCartModal();
                resetConfirmButton();
                return;
            }

            console.log(`🗑️ Emptying cart with ${salesDtls.length} items...`);

            // ✅ USE THE EXISTING emptyCart() FUNCTION
            const result = await emptyCart();

            if (!result.success) {
                throw new Error('Failed to empty cart');
            }

            // Complete state cleanup
            clearAllCartState();

            // Reset UI after a short delay
            await new Promise(resolve => setTimeout(resolve, 100));
            resetCartUI();

            // Success notification
            window.sokWebSocket?.showUpdateNotification?.(
                "Cart Cleared",
                "All items removed successfully"
            );

            // Close modals
            closeEmptyCartModal();

            setTimeout(() => {
                if (typeof closeCartModal === 'function') {
                    closeCartModal();
                }
            }, 300);

            console.log('✅ Cart emptied successfully');

        } catch (error) {
            console.error("❌ Error emptying cart:", error);
            window.sokWebSocket?.showUpdateNotification?.(
                "Clear Error",
                "Failed to empty cart. Please try again."
            );
            resetConfirmButton();
        }
    });

    // Click outside modal to close
    emptyCartModal.addEventListener('click', function (e) {
        if (e.target === emptyCartModal) closeEmptyCartModal();
    });

    // ESC key closes modal
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && emptyCartModal.classList.contains('active')) {
            closeEmptyCartModal();
        }
    });

    console.log('✅ Empty cart modal initialized');
});

export function showErrorModal(title, message, technicalDetails = null, onRetry = null) {
    const overlay = document.getElementById('errorModalOverlay');
    const titleEl = document.getElementById('errorModalTitle');
    const messageEl = document.getElementById('errorModalMessage');
    const detailsSection = document.getElementById('errorDetails');
    const detailsContent = document.getElementById('errorDetailsContent');
    const retryBtn = document.getElementById('retryBtn');
    const closeBtn = document.getElementById('errorCloseBtn');

    if (!overlay) {
        console.error('❌ Error modal not found in DOM');
        alert(`${title}\n\n${message}`);
        return;
    }

    // Set content
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    // Show/hide technical details
    if (detailsSection && detailsContent) {
        if (technicalDetails) {
            detailsSection.style.display = 'block';
            detailsContent.textContent = technicalDetails;
        } else {
            detailsSection.style.display = 'none';
        }
    }

    // Handle retry button (only if it exists)
    if (retryBtn) {
        if (onRetry && typeof onRetry === 'function') {
            retryBtn.style.display = 'flex';
            retryBtn.onclick = () => {
                closeErrorModal();
                onRetry();
            };
        } else {
            retryBtn.style.display = 'none';
        }
    }

    // Handle close button (only if it exists)
    if (closeBtn) {
        closeBtn.onclick = closeErrorModal;
    }

    // Show modal
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    console.log('🚨 Error modal shown:', { title, message });
}

export function closeErrorModal() {
    const overlay = document.getElementById('errorModalOverlay');
    if (!overlay) return;

    overlay.classList.remove('active');
    document.body.style.overflow = 'auto';

    // Reset details section
    const detailsSection = document.getElementById('errorDetails');
    if (detailsSection) {
        detailsSection.classList.remove('expanded');
    }

    console.log('✅ Error modal closed');
}

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('errorModalOverlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeErrorModal();
            }
        });
    }
});


export function showSuccessModal(orderDetails) {
    console.log("showSuccessModal", orderDetails);

    let sales_no, orderData, orderResult, paymentMethod, paymentAmount, transactionId;
    if (typeof orderDetails === 'object' && orderDetails.sales_no) {
        sales_no = orderDetails.sales_no;
        orderData = orderDetails.orderData;
        orderResult = orderDetails.orderResult;
        paymentMethod = orderDetails.paymentMethod;
        paymentAmount = orderDetails.paymentAmount;
        transactionId = orderDetails.transactionId;
    } else {
        sales_no = orderDetails;
    }

    const primaryColor = RESTAURANT_CONFIG?.color || '#22c55e';
    const restaurantLogo = RESTAURANT_CONFIG?.logo || '/img/default-logo.png';

    // Update order number in header
    const orderNumberEl = document.getElementById('orderNumber');
    if (orderNumberEl) {
        orderNumberEl.textContent = sales_no || `#${String(orderCounter).padStart(3, '0')}`;
    }

    // Get the scrollable body container
    const orderDetailsContainer = document.getElementById('orderDetailsContainer');
    if (!orderDetailsContainer) {
        console.error('Order details container not found');
        const modal = document.getElementById('successModal');
        modal.style.display = 'flex';
        modal.classList.add('show');
        return;
    }

    // Handle empty order data
    if (!orderData || !orderData.sales_dtls) {
        orderDetailsContainer.innerHTML = `
            <div class="order-empty-state">
                <svg class="order-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p>No order details available.</p>
            </div>
        `;
    } else {
        // Load cached menu items
        let MenuItems = [];
        try {
            const cached = getMenuItems();
            if (Array.isArray(cached)) {
                MenuItems = cached.flatMap(cat => cat.items || []);
            }
        } catch (err) {
            console.error("Failed to retrieve MenuItems:", err);
        }

        // Group items by parent_sno
        const groupedItems = new Map();
        orderData.sales_dtls.forEach(item => {
            const parentSno = String(item.parent_sno || item.s_no);
            const currentSno = String(item.s_no);

            if (parentSno === currentSno) {
                // This is a parent item
                groupedItems.set(parentSno, { parent: item, addons: [] });
            } else {
                // This is an addon
                if (!groupedItems.has(parentSno)) {
                    groupedItems.set(parentSno, { parent: null, addons: [] });
                }
                groupedItems.get(parentSno).addons.push(item);
            }
        });

        // Get rates from session storage
        const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
        const serviceRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;

        // Calculate totals
        const subtotal = parseFloat(orderData.sub_total || 0);
        const discount = parseFloat(orderData.total_disc || 0);
        const serviceCharge = parseFloat(orderData.total_svc || 0);
        const gst = parseFloat(orderData.total_tax || 0);
        const total = parseFloat(orderData.net_amt || 0);

        // Preload all images before showing modal
        const imageUrls = Array.from(groupedItems.values())
            .filter(({ parent }) => parent)
            .map(({ parent }) => getOrderItemImageUrl(parent) || restaurantLogo);

        // ✅ Get payment method display name
        const getPaymentMethodDisplay = (method) => {
            if (!method) return 'Cash';
            const methodMap = {
                'nets': 'NETS Debit',
                'nets-credit': 'NETS Credit',
                'uob': 'UOB Credit',
                'ocbc': 'OCBC Credit',
                'a930': 'A930',
                'cash': 'Cash'
            };
            return methodMap[method] || method.toUpperCase();
        };

        // ✅ Get payment icon
        const getPaymentIcon = (method) => {
            if (!method) return '💵';
            const iconMap = {
                'nets': '💳',
                'nets-credit': '💳',
                'uob': '🏛️',
                'ocbc': '🏢',
                'a930': '💰',
                'cash': '💵'
            };
            return iconMap[method] || '💳';
        };

        // Build the order details HTML
        const detailsHTML = `
            <!-- Order Info Header -->
            <div class="order-info-header" style="background: ${primaryColor};">
                <div class="order-info-row">
                    <span class="order-info-label">Date:</span>
                    <strong class="order-info-value">${orderData.doc_date ? new Date(orderData.doc_date).toLocaleString() : new Date().toLocaleString()}</strong>
                </div>
                <div class="order-info-row">
                    <span class="order-info-label">Payment:</span>
                    <strong class="order-info-value">
                        ${getPaymentIcon(paymentMethod)} ${getPaymentMethodDisplay(paymentMethod)}
                    </strong>
                </div>
                ${transactionId ? `
                    <div class="order-info-row">
                        <span class="order-info-label">Transaction ID:</span>
                        <strong class="order-info-value">${transactionId}</strong>
                    </div>
                ` : ''}
            </div>

            <!-- Order Items Section -->
            <div class="order-items-section">
                <h3 class="order-items-title">Order Items</h3>
                <div class="order-items-grid">
                    ${Array.from(groupedItems.values()).map(({ parent, addons }) => {
            if (!parent) return '';

            // Get item details
            const imageUrl = getOrderItemImageUrl(parent) || restaurantLogo;
            const itemName = parent.item_name || parent.product_name || 'Unknown Item';
            const qty = parent.qty || 1;
            const price = parseFloat(parent.sub_total || parent.amt || 0);
            const remarks = parent.remarks ? parent.remarks.trim() : '';

            // Calculate addon total
            const addonTotal = addons.reduce((sum, addon) =>
                sum + parseFloat(addon.sub_total || addon.amt || 0), 0
            );
            const totalPrice = price + addonTotal;

            return `
                            <div class="order-item-card">
                                <!-- Item Image -->
                                <div class="order-item-image">
                                    <div class="order-item-image-loader"></div>
                                    <img 
                                        src="${imageUrl}" 
                                        alt="${itemName}" 
                                        loading="eager"
                                        onload="this.style.opacity='1'; this.previousElementSibling.style.display='none';"
                                        onerror="this.onerror=null; this.src='${restaurantLogo}'; this.style.opacity='1'; this.previousElementSibling.style.display='none';" 
                                        style="opacity: 0; transition: opacity 0.3s ease-in-out;"
                                    />
                                </div>

                                <!-- Item Details -->
                                <div class="order-item-details">
                                    <!-- Item Header -->
                                    <div class="order-item-header">
                                        <div class="order-item-title">
                                            <div class="order-item-name">
                                                <span class="order-item-qty-badge" style="background:${primaryColor};">
                                                    ${qty}×
                                                </span>
                                                ${itemName}
                                            </div>
                                        </div>
                                        <div class="order-item-price" style="color:${primaryColor};">
                                            $${totalPrice.toFixed(2)}
                                        </div>
                                    </div>

                                    <!-- Item Remarks -->
                                    ${remarks ? `
                                        <div class="order-item-remarks">
                                            💬 ${remarks}
                                        </div>
                                    ` : ''}

                                    <!-- Addons -->
                                    ${addons.length > 0 ? `
                                        <div class="order-item-addons" style="border-left-color: ${primaryColor};">
                                            ${addons.map(addon => {
                const addonName = addon.item_name || addon.product_name || 'Unknown';
                const addonQty = addon.qty || 1;
                const addonPrice = parseFloat(addon.sub_total || addon.amt || 0);
                const addonRemarks = addon.remarks ? addon.remarks.trim() : '';

                return `
                                                    <div class="order-addon-item">
                                                        <span class="order-addon-prefix" style="color:${primaryColor};">+</span>
                                                        <span class="order-addon-name">
                                                            <strong>${addonName}</strong>${addonQty > 1 ? ` ×${addonQty}` : ''}
                                                        </span>
                                                        ${addonPrice > 0 ? `
                                                            <span class="order-addon-price">+$${addonPrice.toFixed(2)}</span>
                                                        ` : ''}
                                                    </div>
                                                    ${addonRemarks ? `
                                                        <div class="order-addon-remarks">💬 ${addonRemarks}</div>
                                                    ` : ''}
                                                `;
            }).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>

            <!-- Price Summary -->
            <div class="order-price-summary">
                <div class="summary-row">
                    <span class="summary-label">Subtotal:</span>
                    <span class="summary-value">$${subtotal.toFixed(2)}</span>
                </div>

                ${discount > 0 ? `
                    <div class="summary-row summary-discount">
                        <span class="summary-label">Discount:</span>
                        <span class="summary-value">−$${discount.toFixed(2)}</span>
                    </div>
                ` : ''}

                <div class="summary-row">
                    <span class="summary-label">Service Charge (${serviceRate}%):</span>
                    <span class="summary-value">$${serviceCharge.toFixed(2)}</span>
                </div>

                ${gst >= 0 ? `
                    <div class="summary-row">
                        <span class="summary-label">GST (${gstRate}%):</span>
                        <span class="summary-value">$${gst.toFixed(2)}</span>
                    </div>
                ` : ''}

                <div class="summary-row summary-total" style="border-top-color: ${primaryColor};">
                    <span class="summary-label">Total:</span>
                    <span class="summary-value" style="color: ${primaryColor};">
                        $${total.toFixed(2)}
                    </span>
                </div>

                ${paymentMethod && paymentMethod !== 'cash' ? `
                    <div class="summary-row summary-paid" style="background: ${primaryColor}15; border-color: ${primaryColor};">
                        <span class="summary-label" style="color: ${primaryColor};">
                            ${getPaymentIcon(paymentMethod)} Paid via ${getPaymentMethodDisplay(paymentMethod)}:
                        </span>
                        <span class="summary-value" style="color: ${primaryColor}; font-weight: 700;">
                            $${(paymentAmount || total).toFixed(2)}
                        </span>
                    </div>
                ` : ''}
            </div>
        `;

        orderDetailsContainer.innerHTML = detailsHTML;

        // Preload images for faster display
        preloadImages(imageUrls);
    }

    // Show modal with animation
    const modal = document.getElementById('successModal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Scroll modal body to top
    setTimeout(() => {
        orderDetailsContainer.scrollTop = 0;
    }, 50);

    // Increment order counter
    if (typeof orderCounter !== 'undefined') {
        orderCounter++;
    }

    // Prevent closing modal by clicking outside
    modal.onclick = (e) => {
        if (e.target === modal) e.stopImmediatePropagation();
    };
}


//export function showSuccessModal(orderDetails) {
//    console.log("showSuccessModal", orderDetails);

//    let sales_no, orderData, orderResult, paymentMethod, paymentAmount, transactionId;
//    if (typeof orderDetails === 'object' && orderDetails.sales_no) {
//        sales_no = orderDetails.sales_no;
//        orderData = orderDetails.orderData;
//        orderResult = orderDetails.orderResult;
//        paymentMethod = orderDetails.paymentMethod;
//        paymentAmount = orderDetails.paymentAmount;
//        transactionId = orderDetails.transactionId;
//    } else {
//        sales_no = orderDetails;
//    }

//    const primaryColor = RESTAURANT_CONFIG?.color || '#22c55e';
//    const restaurantLogo = RESTAURANT_CONFIG?.logo || '/img/default-logo.png';

//    // Update order number in header
//    const orderNumberEl = document.getElementById('orderNumber');
//    if (orderNumberEl) {
//        orderNumberEl.textContent = sales_no || `#${String(orderCounter).padStart(3, '0')}`;
//    }

//    // Get the scrollable body container
//    const orderDetailsContainer = document.getElementById('orderDetailsContainer');
//    if (!orderDetailsContainer) {
//        console.error('Order details container not found');
//        const modal = document.getElementById('successModal');
//        if (modal) {
//            modal.style.display = 'flex';
//            modal.classList.add('show');
//        }
//        return;
//    }

//    // Handle empty order data
//    if (!orderData || !orderData.sales_dtls) {
//        orderDetailsContainer.innerHTML = `
//            <div class="order-empty-state">
//                <svg class="order-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2">
//                    <circle cx="12" cy="12" r="10"></circle>
//                    <line x1="12" y1="8" x2="12" y2="12"></line>
//                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
//                </svg>
//                <p>No order details available.</p>
//            </div>
//        `;
//    } else {
//        // Load cached menu items
//        let MenuItems = [];
//        try {
//            const cached = typeof getMenuItems === 'function' ? getMenuItems() : null;
//            if (Array.isArray(cached)) {
//                MenuItems = cached.flatMap(cat => cat.items || []);
//            }
//        } catch (err) {
//            console.error("Failed to retrieve MenuItems:", err);
//        }

//        // Group items by parent_sno
//        const groupedItems = new Map();
//        orderData.sales_dtls.forEach(item => {
//            const parentSno = String(item.parent_sno || item.s_no);
//            const currentSno = String(item.s_no);

//            if (parentSno === currentSno) {
//                groupedItems.set(parentSno, { parent: item, addons: [] });
//            } else {
//                if (!groupedItems.has(parentSno)) {
//                    groupedItems.set(parentSno, { parent: null, addons: [] });
//                }
//                groupedItems.get(parentSno).addons.push(item);
//            }
//        });

//        // Get rates from storage
//        const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
//        const serviceRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;

//        // Totals
//        const subtotal = parseFloat(orderData.sub_total || 0);
//        const discount = parseFloat(orderData.total_disc || 0);
//        const serviceCharge = parseFloat(orderData.total_svc || 0);
//        const gst = parseFloat(orderData.total_tax || 0);
//        const total = parseFloat(orderData.net_amt || 0);

//        const imageUrls = Array.from(groupedItems.values())
//            .filter(({ parent }) => parent)
//            .map(({ parent }) => (typeof getOrderItemImageUrl === 'function' ? getOrderItemImageUrl(parent) : null) || restaurantLogo);

//        const getPaymentMethodDisplay = (method) => {
//            if (!method) return 'Cash';
//            const methodMap = {
//                'nets': 'NETS Debit',
//                'nets-credit': 'NETS Credit',
//                'uob': 'UOB Credit',
//                'ocbc': 'OCBC Credit',
//                'a930': 'A930',
//                'cash': 'Cash'
//            };
//            return methodMap[method] || method.toUpperCase();
//        };

//        const getPaymentIcon = (method) => {
//            if (!method) return '💵';
//            const iconMap = {
//                'nets': '💳', 'nets-credit': '💳', 'uob': '🏛️', 'ocbc': '🏢', 'a930': '💰', 'cash': '💵'
//            };
//            return iconMap[method] || '💳';
//        };

//        // Build HTML
//        const detailsHTML = `
//            <div class="order-info-header" style="background: ${primaryColor};">
//                <div class="order-info-row">
//                    <span class="order-info-label">Date:</span>
//                    <strong class="order-info-value">${orderData.doc_date ? new Date(orderData.doc_date).toLocaleString() : new Date().toLocaleString()}</strong>
//                </div>
//                <div class="order-info-row">
//                    <span class="order-info-label">Payment:</span>
//                    <strong class="order-info-value">
//                        ${getPaymentIcon(paymentMethod)} ${getPaymentMethodDisplay(paymentMethod)}
//                    </strong>
//                </div>
//                ${transactionId ? `
//                    <div class="order-info-row">
//                        <span class="order-info-label">Transaction ID:</span>
//                        <strong class="order-info-value">${transactionId}</strong>
//                    </div>
//                ` : ''}
//            </div>

//            <div class="order-items-section">
//                <h3 class="order-items-title">Order Items</h3>
//                <div class="order-items-grid">
//                    ${Array.from(groupedItems.values()).map(({ parent, addons }) => {
//            if (!parent) return '';
//            const imageUrl = (typeof getOrderItemImageUrl === 'function' ? getOrderItemImageUrl(parent) : null) || restaurantLogo;
//            const itemName = parent.item_name || parent.product_name || 'Unknown Item';
//            const qty = parent.qty || 1;
//            const price = parseFloat(parent.sub_total || parent.amt || 0);
//            const remarks = parent.remarks ? parent.remarks.trim() : '';
//            const addonTotal = addons.reduce((sum, addon) => sum + parseFloat(addon.sub_total || addon.amt || 0), 0);
//            const totalPrice = price + addonTotal;

//            return `
//                            <div class="order-item-card">
//                                <div class="order-item-image">
//                                    <div class="order-item-image-loader"></div>
//                                    <img src="${imageUrl}" alt="${itemName}" loading="eager" 
//                                         onload="this.style.opacity='1'; this.previousElementSibling.style.display='none';"
//                                         onerror="this.onerror=null; this.src='${restaurantLogo}'; this.style.opacity='1'; this.previousElementSibling.style.display='none';" 
//                                         style="opacity: 0; transition: opacity 0.3s ease-in-out;" />
//                                </div>
//                                <div class="order-item-details">
//                                    <div class="order-item-header">
//                                        <div class="order-item-title">
//                                            <div class="order-item-name">
//                                                <span class="order-item-qty-badge" style="background:${primaryColor};">${qty}×</span>
//                                                ${itemName}
//                                            </div>
//                                        </div>
//                                        <div class="order-item-price" style="color:${primaryColor};">$${totalPrice.toFixed(2)}</div>
//                                    </div>
//                                    ${remarks ? `<div class="order-item-remarks">💬 ${remarks}</div>` : ''}
//                                    ${addons.length > 0 ? `
//                                        <div class="order-item-addons" style="border-left-color: ${primaryColor};">
//                                            ${addons.map(addon => {
//                const aName = addon.item_name || addon.product_name || 'Unknown';
//                const aQty = addon.qty || 1;
//                const aPrice = parseFloat(addon.sub_total || addon.amt || 0);
//                return `
//                                                    <div class="order-addon-item">
//                                                        <span class="order-addon-prefix" style="color:${primaryColor};">+</span>
//                                                        <span class="order-addon-name"><strong>${aName}</strong>${aQty > 1 ? ` ×${aQty}` : ''}</span>
//                                                        ${aPrice > 0 ? `<span class="order-addon-price">+$${aPrice.toFixed(2)}</span>` : ''}
//                                                    </div>`;
//            }).join('')}
//                                        </div>` : ''}
//                                </div>
//                            </div>`;
//        }).join('')}
//                </div>
//            </div>

//            <div class="order-price-summary">
//                <div class="summary-row"><span class="summary-label">Subtotal:</span><span class="summary-value">$${subtotal.toFixed(2)}</span></div>
//                ${discount > 0 ? `<div class="summary-row summary-discount"><span class="summary-label">Discount:</span><span class="summary-value">−$${discount.toFixed(2)}</span></div>` : ''}
//                <div class="summary-row"><span class="summary-label">Service Charge (${serviceRate}%):</span><span class="summary-value">$${serviceCharge.toFixed(2)}</span></div>
//                ${gst >= 0 ? `<div class="summary-row"><span class="summary-label">GST (${gstRate}%):</span><span class="summary-value">$${gst.toFixed(2)}</span></div>` : ''}
//                <div class="summary-row summary-total" style="border-top-color: ${primaryColor};">
//                    <span class="summary-label">Total:</span>
//                    <span class="summary-value" style="color: ${primaryColor};">$${total.toFixed(2)}</span>
//                </div>
//            </div>
//        `;

//        orderDetailsContainer.innerHTML = detailsHTML;
//        if (typeof preloadImages === 'function') preloadImages(imageUrls);

//        // 💾 PROACTIVE CACHE SAVE
//        // Save while user is reading the receipt to give LocalStorage time to flush
//        if (typeof saveCacheBeforeRedirect === 'function') {
//            console.log("💾 Proactively saving menu cache to prevent COLD BOOT...");
//            saveCacheBeforeRedirect();
//        }
//    }

//    // Show modal
//    const modal = document.getElementById('successModal');
//    if (modal) {
//        modal.style.display = 'flex';
//        setTimeout(() => modal.classList.add('show'), 10);
//        document.body.style.overflow = 'hidden';
//        setTimeout(() => { orderDetailsContainer.scrollTop = 0; }, 50);

//        modal.onclick = (e) => { if (e.target === modal) e.stopImmediatePropagation(); };

//        // 🔄 ATTACH NEW ORDER HANDLER
//        setTimeout(() => {
//            const newOrderBtn =
//                document.getElementById('btnNewOrder') ||
//                document.getElementById('closeSuccessModal') ||
//                [...document.querySelectorAll('#successModal button')]
//                    .find(btn => btn.textContent.includes('New Order'));

//            console.log('🔘 newOrderBtn found:', newOrderBtn);
//            if (!newOrderBtn) return;

//            let secondsLeft = 4;
//            const tick = () => {
//                newOrderBtn.innerText = `Start New Order (${secondsLeft}s)`;
//            };
//            tick();

//            // ← Add these two lines
//            newOrderBtn.disabled = true;
//            newOrderBtn.classList.add('opacity-50', 'cursor-not-allowed');

//            let isCountingDown = true;  // ← add flag

//            const countdown = setInterval(() => {
//                secondsLeft--;
//                if (secondsLeft > 0) {
//                    tick();
//                } else {
//                    clearInterval(countdown);
//                    isCountingDown = false;  // ← clear flag
//                    newOrderBtn.disabled = false;
//                    newOrderBtn.classList.remove('opacity-50', 'cursor-not-allowed');
//                    newOrderBtn.click();
//                }
//            }, 1000);

//            newOrderBtn.onclick = async (e) => {
//                e.preventDefault();
//                if (isCountingDown) return;  // ← block clicks during countdown
//                clearInterval(countdown);
//                newOrderBtn.disabled = true;
//                newOrderBtn.innerText = 'Starting New Order...';
//                localStorage.setItem('kiosk_fresh_start', 'true');
//                if (typeof saveCacheBeforeRedirect === 'function') saveCacheBeforeRedirect();
//                setTimeout(() => {
//                    if (typeof startOverFromPOS === 'function') startOverFromPOS();
//                    else window.location.reload();
//                }, 100);
//            };
//        }, 150); // wait for modal DOM to fully render
//    }

//    if (typeof orderCounter !== 'undefined') orderCounter++;
//}



// Helper function to preload images with promise support
function preloadImages(urls) {
    return Promise.all(
        urls.map(url => {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(url);
                img.onerror = () => resolve(url); // Resolve anyway to not block
                img.src = url;
            });
        })
    );
}

// Helper function to safely get image URL from orderData item
export function getOrderItemImageUrl(item) {
    const restaurantLogo = RESTAURANT_CONFIG?.logo || '/img/default-logo.png';

    const wrapProxy = (url) => {
        if (!url || url.trim() === '') return null;
        if (url.startsWith('/api/GetImageProxy')) return url;
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `/api/GetImageProxy?imageUrl=${encodeURIComponent(url)}`;
    };

    // 1. Direct fields on the item (cover all possible field names)
    const directUrl = item.tqr_image_url || item.item_image || item.image || item.category_image || '';
    if (directUrl && !directUrl.includes('Logo.png')) {
        return wrapProxy(directUrl) || restaurantLogo;
    }

    // 2. Cross-reference sessionStorage MenuItems (same as cart renderer)
    try {
        const menuData = JSON.parse(sessionStorage.getItem('MenuItems') || '[]');
        const allItems = menuData.flatMap(cat => cat.items || []);
        const match = allItems.find(i =>
            i.item_no === item.item_no ||
            i.item_no === item.product_code ||
            i.product_code === item.item_no
        );
        if (match?.tqr_image_url) return wrapProxy(match.tqr_image_url) || restaurantLogo;
    } catch (e) { }

    // 3. Cross-reference sessionStorage FullItems
    try {
        const fullItems = JSON.parse(sessionStorage.getItem('FullItems') || '[]');
        const match = fullItems.find(i =>
            i.item_no === item.item_no ||
            i.product_code === item.item_no
        );
        if (match?.tqr_image_url) return wrapProxy(match.tqr_image_url) || restaurantLogo;
    } catch (e) { }

    // 4. Check window.itemImageMap (populated during menu load)
    if (window.itemImageMap?.size > 0) {
        const key = String(item.item_no || item.product_code || '');
        if (key && window.itemImageMap.has(key)) return window.itemImageMap.get(key);
    }

    // 5. Check window.menuGridItems
    if (Array.isArray(window.menuGridItems)) {
        const match = window.menuGridItems.find(i =>
            i.item_no === item.item_no || i.product_code === item.item_no
        );
        if (match?.tqr_image_url || match?.item_image) {
            return wrapProxy(match.tqr_image_url || match.item_image) || restaurantLogo;
        }
    }

    return restaurantLogo;
}

export function closeModal() {
    const modal = document.getElementById('successModal');

    // ✅ FIXED: Remove show class first for fade-out transition
    modal.classList.remove('show');

    // Wait for CSS transition to complete (300ms), then hide
    setTimeout(() => {
        modal.style.display = 'none';
        document.body.style.overflow = ''; // Re-enable scrolling
    }, 300); // Match the CSS transition duration

    // Optional: Reset any current addon parent item
    if (typeof currentAddonParentItem !== 'undefined') {
        currentAddonParentItem = null;
    }
}