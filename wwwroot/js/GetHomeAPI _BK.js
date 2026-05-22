import { useCache } from '../stores/cache-store.js';
import { useOrder, useOrderStore } from '../stores/order-store.js';
import { uiTranslations } from './Translation.js';
localStorage.removeItem("orderType");
localStorage.removeItem("selectedLang");
localStorage.removeItem("selectedLanguage");
localStorage.removeItem("order");

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
    buildVisibleCategories,
    getCategories,
    getAddonItem,
    addModifierItem,
    getAvailableAddonItems,
    getAvailableModifierItems,
    addAlacarteItem,
    addItemHaveModifierOrAddon,
    changeItemQuantity,
    deleteOrderItem,
    getItemInfo,
    getStockStatus,
    translate,
    populateParentAndAddonItems,
    addAddonItem,
    changeModifierItemQty,
    clearCart
} from '../utils/tqr.js';
import { getPriceByServiceType, applyPromotions, isAbsorbTax, getLastSNo, getNewOrder, getNewOrderSOK } from '../utils/pos.js'; // adjust path if needed
import { getNowInAPIFormat } from '../utils/common.js'; // adjust path if needed


let menuItems = [];
let cart = [];
let orderCounter = 1;
let store = null;
let isMenuGridClickListenerAttached = false;
const modalContent = document.getElementById('addonModalContent');
const modal = document.getElementById('addonModal');
const storename = localStorage.getItem("strorename");
const language = localStorage.getItem('selectedLang');
const uiText = uiTranslations[language];
let gstRate = parseFloat(sessionStorage.getItem("GST"));
let serviceRate = parseFloat(sessionStorage.getItem("ServiceCharge"));
const selectedLang = sessionStorage.getItem("selectedLang");
const orderType = localStorage.getItem("orderType");
const RESTAURANT_CONFIG = {
    //color: '#5ec1ac',
    color: 'oklch(0.67 0.065 185)',
    logo: "/img/logo-Mammia.jpg",
    baseImageUrl: "/API/GetImageProxy?imageUrl="
};

window.addEventListener('DOMContentLoaded', async () => {
    try {
        initMobileOptimizations();
        await setKioskLogo(RESTAURANT_CONFIG.logo);
        await applyDynamicTheme(RESTAURANT_CONFIG.color);
        await initializeDeviceId();

        const deviceId = localStorage.getItem("sok_device_id");
        const orderType = localStorage.getItem("orderType") || "T";

        if (deviceId) {
            // Use sendBeacon for reliable delivery during page unload
            navigator.sendBeacon(
                `/API/SOKOrder/order-cache/${deviceId}?orderType=${orderType}`,
                new Blob([JSON.stringify({})], { type: 'application/json' })
            );
        }

    } catch (error) {
        console.error('Error during initialization:', error);
    }
});

class APILoadManager {
    constructor() {
        this.loadingStates = new Map();
        this.loadedData = new Map();
        this.retryAttempts = new Map();
        this.maxRetries = 2;
        this.retryDelay = 1000; // ms
        this.timeout = 10000; // 10 seconds
    }

    async loadAPI(name, loadFunction, options = {}) {
        const {
            forceReload = false,
            allowEmpty = false,
            isCritical = false
        } = options;

        // Check if already loading
        if (this.loadingStates.get(name) === 'loading') {
            console.log(`⏳ ${name} is already loading, waiting...`);
            return this.waitForLoad(name);
        }

        // Check if already loaded (unless force reload)
        if (!forceReload && this.loadedData.has(name)) {
            console.log(`✅ ${name} already loaded from cache`);
            return this.loadedData.get(name);
        }

        // Set loading state
        this.loadingStates.set(name, 'loading');
        console.log(`🔄 Loading ${name}...`);

        try {
            // Add timeout wrapper
            const data = await this.withTimeout(loadFunction(), this.timeout, name);

            // Check if data is valid
            const isEmpty = this.isDataEmpty(data);

            if (isEmpty && !allowEmpty) {
                throw new Error(`${name} returned empty data`);
            }

            // Even if empty but allowed, cache it
            this.loadedData.set(name, data || null);
            this.loadingStates.set(name, 'success');
            this.retryAttempts.delete(name);

            if (isEmpty) {
                console.warn(`⚠️ ${name} loaded but is empty (allowed)`);
            } else {
                console.log(`✅ ${name} loaded successfully`);
            }

            return data || null;

        } catch (error) {
            const errorMsg = error.message || String(error);
            console.error(`❌ Error loading ${name}:`, errorMsg);

            // Determine if we should retry
            const shouldRetry = this.shouldRetryError(error, isCritical);
            const attempts = this.retryAttempts.get(name) || 0;

            if (shouldRetry && attempts < this.maxRetries) {
                this.retryAttempts.set(name, attempts + 1);
                this.loadingStates.set(name, 'retrying');
                console.log(`🔁 Retrying ${name} (${attempts + 1}/${this.maxRetries})...`);

                // Exponential backoff
                await new Promise(resolve =>
                    setTimeout(resolve, this.retryDelay * Math.pow(2, attempts))
                );

                return this.loadAPI(name, loadFunction, options);
            }

            // Failed after retries or non-retryable error
            this.loadingStates.set(name, 'failed');

            // If not critical and allowed empty, return null instead of throwing
            if (!isCritical && allowEmpty) {
                console.warn(`⚠️ ${name} failed but not critical, continuing with null`);
                this.loadedData.set(name, null);
                return null;
            }

            throw error;
        }
    }

    withTimeout(promise, timeoutMs, name) {
        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout loading ${name} after ${timeoutMs}ms`)), timeoutMs)
            )
        ]);
    }

    isDataEmpty(data) {
        if (data === null || data === undefined) return true;
        if (Array.isArray(data) && data.length === 0) return true;
        if (typeof data === 'object' && Object.keys(data).length === 0) return true;
        return false;
    }

    shouldRetryError(error, isCritical) {
        const errorMsg = String(error.message || error).toLowerCase();

        // Don't retry on these errors
        const noRetryPatterns = [
            'timeout',
            'not found',
            '404',
            'unauthorized',
            '401',
            '403'
        ];

        if (noRetryPatterns.some(pattern => errorMsg.includes(pattern))) {
            return false;
        }

        // Retry on network errors and 500 errors for critical APIs
        if (isCritical && (errorMsg.includes('500') || errorMsg.includes('network'))) {
            return true;
        }

        // For non-critical, only retry on network errors
        return errorMsg.includes('network') || errorMsg.includes('fetch');
    }

    async waitForLoad(name, timeout = 30000) {
        const startTime = Date.now();

        while (this.loadingStates.get(name) === 'loading') {
            if (Date.now() - startTime > timeout) {
                throw new Error(`Timeout waiting for ${name} to load`);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (this.loadingStates.get(name) === 'success') {
            return this.loadedData.get(name);
        }

        throw new Error(`Failed to load ${name}`);
    }

    isLoaded(name) {
        return this.loadingStates.get(name) === 'success';
    }

    getLoadingState(name) {
        return this.loadingStates.get(name) || 'idle';
    }

    clearCache(name) {
        if (name) {
            this.loadedData.delete(name);
            this.loadingStates.delete(name);
            this.retryAttempts.delete(name);
        } else {
            this.loadedData.clear();
            this.loadingStates.clear();
            this.retryAttempts.clear();
        }
    }
}

// Create singleton instance
const apiManager = new APILoadManager();

// ============================================
// IMPROVED API LOADING FUNCTIONS
// ============================================

// Wrap existing functions with load manager
export async function loadStoreDetails() {
    return apiManager.loadAPI('store', async () => {
        const data = await fetchStoreDetails();
        return data; // Allow null
    }, { isCritical: true, allowEmpty: false });
}

export async function loadMenuItems() {
    return apiManager.loadAPI('menuItems', async () => {
        const data = await getMenuItems();
        return data;
    }, { isCritical: true, allowEmpty: false });
}

export async function loadItems() {
    return apiManager.loadAPI('items', async () => {
        const data = await getItems();
        return data;
    }, { isCritical: true, allowEmpty: false });
}

export async function loadAddons() {
    return apiManager.loadAPI('addons', async () => {
        const data = await getAddons();
        return data;
    }, { isCritical: false, allowEmpty: true }); // ✅ Not critical, allow empty
}

export async function loadItemRemarks() {
    return apiManager.loadAPI('itemRemarks', async () => {
        const data = await getItemRemarks();
        return data;
    }, { isCritical: false, allowEmpty: true }); // ✅ Not critical, allow empty
}

export async function loadPromos() {
    return apiManager.loadAPI('promos', async () => {
        const data = await getPromos();
        return data;
    }, { isCritical: false, allowEmpty: true }); // ✅ Not critical, allow empty
}

export async function loadSvcs() {
    return apiManager.loadAPI('svcs', async () => {
        const data = await getSvcs();
        return data;
    }, { isCritical: true, allowEmpty: false });
}

export async function loadLangs() {
    return apiManager.loadAPI('langs', async () => {
        const data = await getLangs();
        return data;
    }, { isCritical: false, allowEmpty: true }); // ✅ Changed: Not critical if API fails
}

export async function loadStocks() {
    return apiManager.loadAPI('stocks', async () => {
        const data = await checkStocks();
        return data;
    }, { isCritical: false, allowEmpty: true }); // ✅ Not critical, allow empty
}

// ============================================
// IMPROVED INITIALIZATION FUNCTION
// ============================================

// Replace your current initialization with this improved version
async function initializeApp() {
    console.log('🚀 Starting app initialization...');

    try {
        // PHASE 1: Wait for critical APIs first
        console.log('📊 Phase 1: Loading critical data...');
        await Promise.all([
            loadStoreDetails(),
            loadSvcs()
        ]);

        // PHASE 2: Load menu data before anything else
        console.log('📊 Phase 2: Loading menu data...');
        await Promise.all([
            loadMenuItems(),
            loadItems()
        ]);

        // PHASE 3: Load languages
        console.log('📊 Phase 3: Loading languages...');
        await loadLangs().catch(err => {
            console.warn('⚠️ Languages failed:', err.message);
        });

        // PHASE 4: Initialize UI with basic data
        console.log('📊 Phase 4: Initializing UI...');
        await loadAndRenderMenu();
        updateCartCount();

        setTimeout(() => {
            initScrollToSwitchCategory();
        }, 500);

        // PHASE 5: Load optional data in background
        console.log('📊 Phase 5: Loading optional data...');
        Promise.allSettled([
            loadAddons(),
            loadItemRemarks(),
            loadPromos(),
            loadStocks()
        ]).then(() => {
            console.log('✅ Optional data loaded');
            // Refresh menu to show addons/remarks availability
            loadAndRenderMenu();
        });

        console.log('✅ App initialization complete!');

    } catch (error) {
        console.error('❌ Critical error during initialization:', error);
        showErrorModal(
            'Failed to Load Application',
            'We encountered an error while loading essential data. Please try again or refresh the page.',
            error.message
        );
    }
}

// Remove the old init function and replace with:
(async function init() {
    await initializeApp();
})();

// ============================================
// EXPORT API MANAGER FOR DEBUGGING
// ============================================

window.apiManager = apiManager;

function hexToHSL(hex) {
    // Validate input
    if (!hex || typeof hex !== 'string') {
        console.error('Invalid hex color:', hex);
        return { h: 0, s: 0, l: 0 }; // Return default values
    }

    // Remove # if present
    hex = hex.replace('#', '');

    // Validate hex format
    if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
        console.error('Invalid hex format:', hex);
        return { h: 0, s: 0, l: 0 };
    }

    // Convert hex to RGB
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    // Find min and max values
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0, s = 0, l = (max + min) / 2;

    if (delta !== 0) {
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
        switch (max) {
            case r:
                h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / delta + 2) / 6;
                break;
            case b:
                h = ((r - g) / delta + 4) / 6;
                break;
        }
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}
function HSLToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

async function applyDynamicTheme(primaryHex) {
    if (!primaryHex || typeof primaryHex !== 'string') {
        console.error('applyDynamicTheme called with invalid color:', primaryHex);
        return;
    }

    const hsl = hexToHSL(primaryHex);
    const adjustLightness = (l, delta) => Math.max(5, Math.min(95, l + delta));

    // Generate complementary and hover tones safely
    const primaryHover = HSLToHex(hsl.h, hsl.s, adjustLightness(hsl.l, -10));
    const primaryLight = HSLToHex(hsl.h, Math.max(30, hsl.s - 25), adjustLightness(hsl.l, +20));
    const secondaryHue = (hsl.h + 150) % 360;
    const secondary = HSLToHex(secondaryHue, hsl.s, adjustLightness(hsl.l, +10));
    const secondaryForeground = HSLToHex(secondaryHue, hsl.s, adjustLightness(hsl.l, -35));

    const vars = {
        '--primary': primaryHex,
        '--primary-hover': primaryHover,
        '--primary-light': primaryLight,
        '--secondary': secondary,
        '--secondary-foreground': secondaryForeground,
        '--text-primary': hsl.l > 60 ? '#000' : '#fff',
    };

    // Apply to root
    Object.entries(vars).forEach(([key, value]) => {
        document.documentElement.style.setProperty(key, value);
    });

    console.log('🎨 Dynamic theme applied:', vars);
}


async function setKioskLogo(logoUrl) {
    const landingLogo = document.getElementById('langing-kiosk-logo');
    const kioskLogo = document.getElementById('kiosk-logo');

    if (landingLogo) {
        landingLogo.src = logoUrl;
        landingLogo.alt = 'Kiosk Logo';
    }

    if (kioskLogo) {
        kioskLogo.src = logoUrl;
        kioskLogo.alt = 'Kiosk Logo';
    }

    console.log('Logo updated:', logoUrl);

    // Wait for logos to load
    await Promise.all([
        landingLogo ? new Promise(resolve => { landingLogo.onload = resolve; }) : Promise.resolve(),
        kioskLogo ? new Promise(resolve => { kioskLogo.onload = resolve; }) : Promise.resolve()
    ]);
}


// Expose functions for onclick usage in HTML
window.GetHomeAPI = {
    selectOrderType,
    addToCart,
    removeFromCart,
    updateQuantity,
    updateQuantityBySno,
    closeModal,
    getItemInfo,
    getStockStatus,
    //removeItemByIndex,
    removeItemByLineId,
    updateQuantityByIndex,
    loadMenu
    //placeOrder
};



function normalizeMenuItems(data) {
    return data.map(section => ({
        ...section,
        category: Array.isArray(section.category) ? section.category : [],
        items: Array.isArray(section.items) ? section.items : [],
    }));
}

async function selectOrderType(type, language) {
    console.log('🎯 selectOrderType called:', { type, language });
    try {
        // ✅ STEP 1: Store order type locally
        localStorage.setItem("orderType", type);
        console.log("🎯 Order type selected:", type === "E" ? "Dine In" : "Takeaway");

        // ✅ STEP 2: Initialize SOK order with proper structure
        const { setOrder, setLastSNo } = useOrder();
        const newOrder = getNewOrder({ service_type: type });
        setOrder(newOrder);
        setLastSNo(0);
        console.log("setLastSNo(0)");
        console.log("✅ SOK order initialized:", newOrder);

        // ✅ STEP 3: Save complete order structure to server
        try {
            // ✅ Get device ID from localStorage (already set from URL)
            const deviceId = localStorage.getItem("sok_device_id") || "UNKNOWN";
            const location = localStorage.getItem("sok_location") || "Unknown";

            // Get or set default table number
            const tableNo = localStorage.getItem("tableNo") ||
                (type === "T" ? "TAKEAWAY" : deviceId); // Use device ID as table number
            localStorage.setItem("tableNo", tableNo);

            console.log('📤 Sending order:', {
                deviceId,
                location,
                tableNo,
                orderType: type
            });

            const serverResponse = await fetch('/API/SOKOrder/set-order-type', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    orderType: type,
                    tableNo: tableNo,
                    deviceId: deviceId,
                    location: location,
                    timestamp: new Date().toISOString(),
                    orderData: newOrder
                })
            });

            if (!serverResponse.ok) {
                const errorText = await serverResponse.text();
                throw new Error(`Server responded with ${serverResponse.status}: ${errorText}`);
            }

            const serverData = await serverResponse.json();
            console.log("✅ Order saved to server:", serverData);

            // Store server-generated order ID
            if (serverData.orderId) {
                localStorage.setItem("serverOrderId", serverData.orderId);
                newOrder.server_order_id = serverData.orderId;
                setOrder(newOrder);
            }
        } catch (serverError) {
            console.error("⚠️ Failed to save to server:", serverError);
        }

        const options = document.querySelectorAll('.landing-option');
        const selectedOption = document.querySelector(`.landing-option[data-type="${type}"]`);

        options.forEach(option => {
            option.style.pointerEvents = 'none';
            if (option !== selectedOption) {
                option.style.opacity = '0.4';
                option.style.transform = 'scale(0.95)';
            }
        });

        selectedOption.style.transform = 'scale(1.1)';
        selectedOption.style.borderColor = '#4ECDC4';
        selectedOption.classList.add('landing-loading');

        // Show loading message
        setTimeout(() => {
            selectedOption.innerHTML = `
                <div class="landing-option-icon">⏳</div>
                <h2 class="landing-option-title">Loading Menu...</h2>
                <p class="landing-option-desc">Preparing your ${type === 'T' ? 'takeaway' : 'dine-in'} experience</p>
                <button class="landing-option-btn" disabled>Please Wait...</button>
            `;

            // ✅ STEP 4: Load menu with better error handling
            setTimeout(async () => {
                try {
                    console.log('🔄 Loading menu for order type:', type);

                    // Load menu with selected language
                    await loadAndRenderMenu('all', language);

                    // Hide landing overlay
                    const landingOverlay = document.getElementById('landingOverlay');
                    if (landingOverlay) {
                        landingOverlay.classList.add('hidden');
                        console.log('✅ Landing overlay hidden');
                    }

                    console.log("✅ Menu loaded successfully");

                    // ✅ Force a debug check
                    setTimeout(() => {
                        console.log('🔍 Post-load debug check:');
                        debugAppState();
                    }, 1000);

                } catch (error) {
                    console.error("❌ Failed to load menu:", error);

                    // Show error to user
                    selectedOption.innerHTML = `
                        <div class="landing-option-icon">❌</div>
                        <h2 class="landing-option-title">Load Failed</h2>
                        <p class="landing-option-desc">Please try again</p>
                        <button class="landing-option-btn" onclick="window.location.reload()">
                            Retry
                        </button>
                    `;
                }
            }, 1000);
        }, 1000);
    } catch (error) {
        console.error("❌ Error in selectOrderType:", error);
        alert("Failed to initialize order. Please try again.");
    }
}


async function syncOrderCacheToServer(order) {
    try {
        // Use the real SOK device ID
        const deviceId = localStorage.getItem("sokDeviceId") || "01";
        const orderType = localStorage.getItem("orderType") || "E";

        const response = await fetch(`/API/SOKOrder/order-cache/sok/${deviceId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                orderType: orderType,
                orderData: order,   // full order object
                status: order.order_status_id || 'N'
            })
        });

        if (response.ok) {
            const result = await response.json();
            console.log("✅ Order cache synced to server:", result);
            return result;
        } else {
            const text = await response.text();
            console.error("⚠️ Server returned error:", text);
        }
    } catch (error) {
        console.error("⚠️ Failed to sync order cache:", error);
    }
}



//async function selectOrderType(type, language) {
//    console.log('🎯 selectOrderType called:', { type, language });

//    try {
//        // ✅ STEP 1: Store order type
//        localStorage.setItem("orderType", type);
//        console.log("🎯 Order type selected:", type === "E" ? "Dine In" : "Takeaway");

//        // ✅ STEP 2: Initialize SOK order
//        const { setOrder, setLastSNo } = useOrder();
//        const newOrder = getNewOrderSOK({ service_type: type });
//        setOrder(newOrder);
//        setLastSNo(0);
//        console.log("✅ SOK order initialized");

//        // ✅ STEP 3: Show loading UI
//        const options = document.querySelectorAll('.landing-option');
//        const selectedOption = document.querySelector(`.landing-option[data-type="${type}"]`);

//        options.forEach(option => {
//            option.style.pointerEvents = 'none';
//            if (option !== selectedOption) {
//                option.style.opacity = '0.4';
//                option.style.transform = 'scale(0.95)';
//            }
//        });

//        selectedOption.style.transform = 'scale(1.1)';
//        selectedOption.style.borderColor = '#4ECDC4';
//        selectedOption.classList.add('landing-loading');

//        // Show loading message
//        setTimeout(() => {
//            selectedOption.innerHTML = `
//                <div class="landing-option-icon">⏳</div>
//                <h2 class="landing-option-title">Loading Menu...</h2>
//                <p class="landing-option-desc">Preparing your ${type === 'T' ? 'takeaway' : 'dine-in'} experience</p>
//                <button class="landing-option-btn" disabled>Please Wait...</button>
//            `;

//            // ✅ STEP 4: Load menu with better error handling
//            setTimeout(async () => {
//                try {
//                    console.log('🔄 Loading menu for order type:', type);

//                    // Load menu with selected language
//                    await loadAndRenderMenu('all', language);

//                    // Hide landing overlay
//                    const landingOverlay = document.getElementById('landingOverlay');
//                    if (landingOverlay) {
//                        landingOverlay.classList.add('hidden');
//                        console.log('✅ Landing overlay hidden');
//                    }

//                    console.log("✅ Menu loaded successfully");

//                    // ✅ Force a debug check
//                    setTimeout(() => {
//                        console.log('🔍 Post-load debug check:');
//                        debugAppState();
//                    }, 1000);

//                } catch (error) {
//                    console.error("❌ Failed to load menu:", error);

//                    // Show error to user
//                    selectedOption.innerHTML = `
//                        <div class="landing-option-icon">❌</div>
//                        <h2 class="landing-option-title">Load Failed</h2>
//                        <p class="landing-option-desc">Please try again</p>
//                        <button class="landing-option-btn" onclick="window.location.reload()">
//                            Retry
//                        </button>
//                    `;
//                }
//            }, 1000);
//        }, 1000);

//    } catch (error) {
//        console.error("❌ Error in selectOrderType:", error);
//        alert("Failed to initialize order. Please try again.");
//    }
//}

// Add these to your global scope for debugging
window.debugAppState = function () {
    console.log('🔍 DEBUG APP STATE');

    const cache = useCache();
    const order = useOrder();

    console.log('📊 Cache:', {
        menuItems: cache.menuItems?.length || 0,
        menuItemsFirst: cache.menuItems?.[0],
        items: cache.items?.length || 0,
        itemsFirst: cache.items?.[0],
        addons: cache.addons?.length || 0
    });

    console.log('📦 Order:', order);

    console.log('🏗️ Building categories...');
    const categories = buildVisibleCategories();
    console.log('📋 Categories:', categories);

    console.log('🎯 DOM Elements:', {
        categoryTabs: document.querySelector('.category-tabs'),
        menuGrid: document.getElementById('menuGrid'),
        menuTitle: document.getElementById('menuTitle')
    });

    return { cache, order, categories };
};

window.forceReloadCategories = function () {
    console.log('🔄 FORCE RELOADING CATEGORIES');
    const categories = buildVisibleCategories();
    console.log('📋 Categories to load:', categories);

    if (categories && categories.length > 0) {
        populateCategoryTabs(categories);
        console.log('✅ Categories reloaded');
    } else {
        console.error('❌ No categories to load');
    }
};

//export async function loadAndRenderMenu(category = 'all') {
//    try {
//        let data = useCache().menuItems;
//        const currentOrder = useOrder().order;

//        const { addons } = useCache();
//        const { itemRemarks } = useCache();
//        const { checkStocks } = useCache();

//        if (currentOrder?.sales_dtls?.length > 0) {
//            console.log("🛒 Restoring cart from order cache");
//            currentOrder.sales_dtls.forEach(orderItem => {
//                renderCartFromOrder();
//            });
//        }

//        if (!Array.isArray(data) || data.length === 0) {
//            console.log('⏳ Cache is empty or invalid, fetching...');
//            const raw = await getMenuItems();

//            if (raw && Array.isArray(raw) && raw[0]?.output) {
//                data = normalizeMenuItems(raw[0].output);
//                useCache().setMenuItems(data);
//            } else {
//                console.error("❌ Invalid API format:", raw);
//                data = normalizeMenuItems(data || []);
//                useCache().setMenuItems(data);
//            }
//        } else {
//            console.log('✅ Loaded menu from cache');
//        }

//        // Load addons
//        if (!Array.isArray(addons) || addons.length === 0) {
//            console.log("📦 Calling getAddons()");
//            await getAddons();
//        } else {
//            console.log("✅ Addons already cached");
//        }

//        // Load item remarks
//        if (!Array.isArray(itemRemarks) || itemRemarks.length === 0) {
//            console.log("📦 Calling getItemRemarks()");
//            await getItemRemarks();

//            // ✅ refresh reference after async call
//            useCache().setItemRemarks();
//        } else {
//            console.log("✅ itemRemarks already cached");
//        }

//        // Check stocks
//        if (!Array.isArray(checkStocks) || checkStocks.length === 0) {
//            console.log("📦 Calling checkStocks");
//            await getStockStatus();
//        } else {
//            console.log("✅ checkStocks already cached");
//        }

//        // Flatten and deduplicate
//        const seen = new Set();
//        let menuItems = data.flatMap(section => section.items || []);
//        const servicetype = sessionStorage.getItem("orderType");
//        const allAddons = useCache().addons || [];
//        const allItemRemarks = useCache().itemRemarks || [];  // ✅ Consistent casing
//        const allStocks = useCache().checkStocks || [];  // ✅ Consistent casing

//        const itemNosWithAddons = new Set(allAddons.map(addon => addon.item_no));
//        const itemNosWithItemRemarks = new Set(allItemRemarks.map(remark => remark.item_no));
//        const itemNosWithStocks = new Set(allStocks.map(checkStocks => checkStocks.item_no));

//        menuItems = menuItems
//            .filter(item => {
//                if (!item?.item_no || seen.has(item.item_no)) return false;
//                seen.add(item.item_no);
//                return true;
//            })
//            .map(item => {
//                const price = parseFloat(getPriceByServiceType(item, servicetype)) || 0;
//                return {
//                    ...item,
//                    price,
//                    has_addon: itemNosWithAddons.has(item.item_no),
//                    has_remarks: itemNosWithItemRemarks.has(item.item_no),
//                    has_stocks: itemNosWithStocks.has(item.item_no),
//                };
//            });


//        const visibleCategories = buildVisibleCategories();
//        //console.log("All categories:", visibleCategories);
//        visibleCategories.forEach(cat => {
//            //console.log(cat.category_code, "hasDirectItems?", hasDirectItems(cat.category_code));
//        });
//        populateCategoryTabs(visibleCategories);

//        const menuGrid = document.getElementById('menuGrid');
//        if (!menuGrid) return;
//        menuGrid.innerHTML = '';

//        if (category === 'all') {
//            const firstCategory = visibleCategories?.[0];
//            if (firstCategory) {
//                console.log("📂 No category selected, loading first category:", firstCategory.category_code);
//                renderCategoryByCode(firstCategory.category_code);
//            } else {
//                console.warn("⚠️ No categories available to display");
//                menuGrid.innerHTML = '<p class="text-gray-500">No menu items available.</p>';
//            }
//        } else {
//            renderCategoryByCode(category);
//        }

//    } catch (error) {
//        console.error('❌ Failed to load and render menu:', error);
//    }
//}

function validateCacheBeforeRender() {
    const cache = useCache();

    if (!cache.menuItems || !Array.isArray(cache.menuItems) || cache.menuItems.length === 0) {
        console.warn('⚠️ Cache invalid, forcing reload');
        apiManager.clearCache('menuItems');
        apiManager.clearCache('items');
        return false;
    }

    return true;
}

async function loadAndRenderMenu(category = 'all', language = '') {
    console.log('🔄 loadAndRenderMenu called with:', { category, language });

    try {
        let data = useCache().menuItems;
        const { order, setLastSNo } = useOrder();

        console.log('📊 Cache state at start:', {
            menuItems: data?.length || 0,
            items: useCache().items?.length || 0,
            addons: useCache().addons?.length || 0
        });

        // ✅ CRITICAL: Ensure we have the required data
        if (!data || !Array.isArray(data) || data.length === 0) {
            console.log('🔄 Loading menu items...');
            await loadMenuItems();
            data = useCache().menuItems;
        }

        if (!useCache().items || useCache().items.length === 0) {
            console.log('🔄 Loading items...');
            await loadItems();
        }

        // ✅ BUILD CATEGORIES FIRST
        console.log('🏗️ Building visible categories...');
        const visibleCategories = buildVisibleCategories();
        console.log('📋 Visible categories built:', visibleCategories?.length, visibleCategories);

        if (!visibleCategories || visibleCategories.length === 0) {
            console.error('❌ No categories available!');
            const menuGrid = document.getElementById('menuGrid');
            if (menuGrid) {
                menuGrid.innerHTML = `
                    <div class="text-center p-8">
                        <div class="text-6xl mb-4">📂</div>
                        <p class="text-gray-600">No categories available</p>
                        <button onclick="window.debugCategories()" class="mt-4 px-4 py-2 bg-blue-500 text-white rounded">
                            Debug Categories
                        </button>
                    </div>
                `;
            }
            return;
        }

        // ✅ POPULATE CATEGORY TABS
        console.log('📂 Populating category tabs...');
        populateCategoryTabs(visibleCategories);

        const menuGrid = document.getElementById('menuGrid');
        if (!menuGrid) {
            console.error('❌ Menu grid container not found!');
            return;
        }

        // ✅ RENDER THE SELECTED CATEGORY
        if (category === 'all') {
            const firstCategory = visibleCategories?.[0];
            if (firstCategory) {
                console.log("📂 Loading first category:", firstCategory.category_code);
                renderCategoryByCode(firstCategory.category_code, language);
            } else {
                menuGrid.innerHTML = '<p class="text-gray-500">No menu items available.</p>';
            }
        } else {
            console.log("📂 Loading specified category:", category);
            renderCategoryByCode(category, language);
        }

        console.log('✅ loadAndRenderMenu completed successfully');

    } catch (error) {
        console.error('❌ Failed to load and render menu:', error);

        const menuGrid = document.getElementById('menuGrid');
        if (menuGrid) {
            menuGrid.innerHTML = `
                <div class="error-message text-center p-8">
                    <div class="text-6xl mb-4">❌</div>
                    <p class="text-lg font-semibold text-red-600 mb-2">Failed to load menu</p>
                    <p class="text-gray-600">Please refresh the page or contact support</p>
                    <button onclick="window.location.reload()" class="mt-4 px-4 py-2 bg-blue-500 text-white rounded">
                        Refresh Page
                    </button>
                </div>
            `;
        }
    }
}
// Add this function for retrying failed images
async function loadImageWithRetry(imageUrl, fallbackUrl, retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            const result = await loadImageWithValidation(imageUrl, fallbackUrl, 2000);
            if (result === imageUrl) {
                return imageUrl; // Success
            }
            console.log(`🔄 Retry ${i + 1} for image: ${imageUrl}`);
            await new Promise(resolve => setTimeout(resolve, 500 * (i + 1))); // Exponential backoff
        } catch (error) {
            console.warn(`Image load attempt ${i + 1} failed:`, error);
        }
    }
    return fallbackUrl; // All retries failed
}

// Update your image rendering to include better error handling
function createImageElement(imageUrl, altText, restaurantLogo) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = altText;
    img.loading = 'lazy';
    img.decoding = 'async';

    img.onload = function () {
        this.classList.add('loaded');
    };

    img.onerror = function () {
        console.warn('🖼️ Image failed, using fallback:', imageUrl);
        if (this.src !== restaurantLogo) {
            this.src = restaurantLogo;
        } else {
            this.style.display = 'none';
        }
    };

    return img;
}

function displayMenuItemsByCategoryCode(categoryCode) {
    const container = document.getElementById('menuGrid');
    if (!container) return;

    // Filter and deduplicate by item_no
    const seen = new Set();
    const items = menuItems
        .filter(item => item.category_code === categoryCode)
        .filter(item => {
            if (!item?.item_no || seen.has(item.item_no)) return false;
            seen.add(item.item_no);
            return true;
        });

    if (items.length === 0) {
        console.warn(`No items found for category: ${categoryCode}`);
        container.innerHTML = '<p class="text-gray-500">No items in this category.</p>';
        return;
    }
    renderMenuGrid(items);
}


function renderAllCategories() {
    const container = document.getElementById('menuGrid');
    if (!container) return;
    container.innerHTML = ''; // Clear container before rendering
    const categories = useCache().setMenuItems || [];
    categories.forEach(cat => {
        if (cat.root_category_code) {
            displayMenuItemsByCategoryCode(cat.root_category_code);
        }
    });
}
async function renderCategoryByCode(categoryCode, selectedLanguage = "") {
    const container = document.getElementById('menuGrid');
    if (!container) return;

    // ✅ SHOW ANIMATED LOADER
    container.innerHTML = `
        <div class="loader-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 400px; gap: 20px;">
            <div class="loader-spinner">
                <div class="spinner-ring"></div>
                <div class="spinner-ring"></div>
                <div class="spinner-ring"></div>
            </div>
            <p style="color: #666; font-size: 16px; font-weight: 500;">Loading ${categoryCode}...</p>
        </div>
        <style>
            .loader-spinner {
                position: relative;
                width: 60px;
                height: 60px;
            }
            
            .spinner-ring {
                position: absolute;
                width: 100%;
                height: 100%;
                border: 3px solid transparent;
                border-top-color: #3498db;
                border-radius: 50%;
                animation: spin 1.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
            }
            
            .spinner-ring:nth-child(2) {
                border-top-color: #e74c3c;
                animation-delay: -0.5s;
                width: 80%;
                height: 80%;
                top: 10%;
                left: 10%;
            }
            
            .spinner-ring:nth-child(3) {
                border-top-color: #f39c12;
                animation-delay: -1s;
                width: 60%;
                height: 60%;
                top: 20%;
                left: 20%;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .loader-container p {
                animation: pulse 1.5s ease-in-out infinite;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        </style>
    `;

    try {
        if (!categoryCode?.trim()) {
            container.innerHTML = `<p class="text-red-500">Invalid category code.</p>`;
            return;
        }

        const { menuCategoryItemTranslations, items } = useCache();

        if (!Array.isArray(items) || !items.length) {
            container.innerHTML = `<p class="text-red-500">No menu items available.</p>`;
            return;
        }

        // Get translated name
        let translatedCategoryName;
        try {
            translatedCategoryName = await getTranslatedName(categoryCode, categoryCode, selectedLanguage, "category");
        } catch (error) {
            console.warn("Category translation failed:", error);
            translatedCategoryName = categoryCode;
        }

        // Update main menu title
        const titleElement = document.getElementById("menuTitle");
        if (titleElement) {
            titleElement.innerText = translatedCategoryName;
        }

        // Filter items
        const seen = new Set();
        const code = categoryCode.trim().toLowerCase();

        const filteredItems = items.filter(item => {
            if (!item || !item.item_no || seen.has(item.item_no)) return false;
            const itemCat = String(item.category_code || "").trim().toLowerCase();
            if (!itemCat || itemCat === "null" || itemCat !== code) return false;
            seen.add(item.item_no);
            return true;
        });

        if (filteredItems.length === 0) {
            container.innerHTML = `<p class="text-gray-500">No items found in category "${translatedCategoryName}".</p>`;
            return;
        }

        // Translate items
        const translatedItems = await Promise.allSettled(
            filteredItems.map(async item => {
                try {
                    const display_name = await getTranslatedName(item.item_no, item.item_name, selectedLanguage, "item");
                    return { ...item, display_name };
                } catch (error) {
                    return { ...item, display_name: item.item_name || item.item_no };
                }
            })
        );

        const successfulItems = translatedItems
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value);

        if (successfulItems.length === 0) {
            container.innerHTML = `<p class="text-red-500">Failed to load items.</p>`;
            return;
        }

        // ✅ CLEAR LOADER AND CREATE CATEGORY SECTION
        container.innerHTML = '';

        const categorySection = document.createElement('div');
        categorySection.className = 'category-section';
        categorySection.dataset.categorySection = categoryCode;
        container.appendChild(categorySection);

        //// ✅ ADD CATEGORY TITLE
        //const categoryTitle = document.createElement('h2');
        //categoryTitle.className = 'category-section-title';
        //categoryTitle.textContent = translatedCategoryName;
        //categorySection.appendChild(categoryTitle);

        // ✅ RENDER MENU GRID (images will load here)
        try {
            await renderMenuGrid(successfulItems);
        } catch (error) {
            console.error("Rendering failed:", error);
            const errorMsg = document.createElement('p');
            errorMsg.className = 'text-red-500';
            errorMsg.textContent = `Failed to display items.`;
            categorySection.appendChild(errorMsg);
        }

    } catch (error) {
        console.error("Error in renderCategoryByCode:", error);
        container.innerHTML = `<p class="text-red-500">Error loading category: ${error.message}</p>`;
    }
}

function cleanFallbackName(fallback) {
    if (!fallback) return "Unknown Item";
    // Remove prefixes/suffixes like "BN |", "HRY2024", "NOV MBC", prices
    return fallback.split("|")[1]?.trim().replace(/HRY\d{4}.*$|NOV MBC|\$\d+\.\d+/, "")?.trim() || fallback;
}

//function renderCategoryByCode(categoryCode) {
//    const container = document.getElementById('menuGrid');
//    if (!container) return;

//    container.innerHTML = '';
//    document.getElementById("menuTitle").innerText = categoryCode;

//    const allItems = useCache().items || [];
//    const seen = new Set();
//    const code = categoryCode.trim().toLowerCase();

//    // Filter items by category code and deduplicate
//    const items = allItems.filter(item => {
//        if (!item?.item_no || seen.has(item.item_no)) return false;
//        if (typeof isMenuCategoryOrItemHidden === "function" &&
//            isMenuCategoryOrItemHidden("I", item.item_no)) return false;

//        const itemCat = (item.category_code || "").trim().toLowerCase();

//        if (itemCat !== code) return false;

//        seen.add(item.item_no);
//        return true;
//    });

//    //console.log("🟢 Items in", categoryCode, ":", items);

//    if (items.length === 0) {
//        container.innerHTML = `<p class="text-gray-500">No visible items in category "${categoryCode}".</p>`;
//        return;
//    }

//    renderMenuGrid(items);
//}


// Flag to ensure event listener is attached only once

// ✅ Global image preload cache using Map for better performance
const imagePreloadMap = new Map();
/**
 * Resolves the image URL for a menu item
 * @param {Object} item - Menu item object
 * @param {Object} menuItem - Cached menu item object
 * @returns {string} Resolved image URL
 */
function resolveImageUrl(item, menuItem) {
    let imageFilename = item.tqr_image_url ||
        item.item_image ||
        menuItem?.tqr_image_url ||
        menuItem?.item_image ||
        '';

    let imageUrl = '';

    if (imageFilename) {
        if (imageFilename.startsWith('http') || imageFilename.startsWith('blob:')) {
            imageUrl = imageFilename;
        } else if (imageFilename.startsWith('/')) {
            imageUrl = imageFilename;
        } else {
            const cleanFilename = imageFilename.split('?')[0];
            imageUrl = `${RESTAURANT_CONFIG.baseImageUrl}${cleanFilename}`;
        }
    }

    // Fallback to restaurant logo
    if (!imageUrl || imageUrl.trim() === '') {
        imageUrl = RESTAURANT_CONFIG.logo || '';
    }

    return imageUrl;
}
/**
 * Preloads images and stores them in the Map cache
 * @param {string[]} urls - Array of image URLs to preload
 * @param {string} priority - Fetch priority ('high', 'low', 'auto')
 */
function preloadImages(urls, priority = 'high') {
    urls.forEach(url => {
        if (!url || imagePreloadMap.has(url)) return;
        // Create Image object for actual loading
        const img = new Image();
        img.fetchPriority = priority;
        img.decoding = 'async';
        const loadPromise = new Promise((resolve, reject) => {
            img.onload = () => {
                imagePreloadMap.set(url, { loaded: true, success: true, image: img });
                resolve(img);
            };
            img.onerror = () => {
                imagePreloadMap.set(url, { loaded: true, success: false });
                reject(new Error(`Failed to load: ${url}`));
            };
        });
        imagePreloadMap.set(url, {
            image: img,
            promise: loadPromise,
            loaded: false
        });
        img.src = url;
    });
}
function resolveAllergenImageUrl(item, menuItem) {
    let allergenFilename = item.tqr_alergin_type ||
        menuItem?.tqr_alergin_type ||
        '';

    if (!allergenFilename || allergenFilename.trim() === '') {
        return '';
    }

    let allergenUrl = '';

    if (allergenFilename.startsWith('http') || allergenFilename.startsWith('blob:')) {
        allergenUrl = allergenFilename;
    } else if (allergenFilename.startsWith('/')) {
        allergenUrl = allergenFilename;
    } else {
        // Remove query parameters if any
        const cleanFilename = allergenFilename.split('?')[0];
        allergenUrl = `${RESTAURANT_CONFIG.baseImageUrl}${cleanFilename}`;
    }

    return allergenUrl;
}

function loadImageWithValidation(imageUrl, fallbackUrl, timeout = 3000) { // Increased to 3s
    return new Promise((resolve) => {
        // Check cache first
        const cached = imagePreloadMap.get(imageUrl);
        if (cached?.loaded && cached?.success) {
            resolve(imageUrl);
            return;
        }

        const img = new Image();
        let resolved = false;

        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                console.warn('⏱️ Image timeout:', imageUrl);
                resolve(fallbackUrl);
            }
        }, timeout);

        img.onload = () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                console.log('✅ Image loaded:', imageUrl);
                resolve(imageUrl);
            }
        };

        img.onerror = () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                console.warn('❌ Image error:', imageUrl);
                resolve(fallbackUrl);
            }
        };

        img.src = imageUrl;
    });
}


/**
 * Checks if an image is preloaded and ready
 * @param {string} url - Image URL to check
 * @returns {boolean}
 */
function isImagePreloaded(url) {
    const entry = imagePreloadMap.get(url);
    return entry?.loaded || false;
}

/**
 * Gets all image URLs from items array
 * @param {Array} items - Menu items
 * @param {Array} MenuItems - Cached menu items
 * @returns {string[]} Array of unique image URLs
 */
function extractImageUrls(items, MenuItems) {
    const urls = new Set();

    items.forEach(item => {
        const menuItem = MenuItems.find(mi => mi.item_no === item.item_no);
        const imageUrl = resolveImageUrl(item, menuItem);
        if (imageUrl) urls.add(imageUrl);
    });

    return Array.from(urls);
}

// ✅ Fast image loading with instant fallback on error
function loadImageWithFastFallback(imageUrl, fallbackUrl, timeout = 300) {
    return new Promise((resolve) => {
        const img = new Image();
        let resolved = false;

        // Fast timeout - don't wait for full network timeout
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                resolve(fallbackUrl);
            }
        }, timeout);

        img.onload = () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                resolve(imageUrl);
            }
        };

        img.onerror = () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                resolve(fallbackUrl);
            }
        };

        img.src = imageUrl;
    });
}


async function renderMenuGrid(items) {
    const container = document.getElementById('menuGrid');
    if (!container) return;

    let MenuItems = [];
    try {
        const cached = getMenuItems();
        if (Array.isArray(cached)) {
            MenuItems = cached.flatMap(category => category.items || []);
        } else {
            const stored = sessionStorage.getItem("MenuItems");
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    MenuItems = parsed.flatMap(category => category.items || []);
                }
            }
        }
    } catch (err) {
        console.error("Failed to retrieve MenuItems:", err);
    }

    const restaurantLogo = RESTAURANT_CONFIG.logo || '';

    // ✅ SHOW SKELETON LOADERS FIRST
    container.innerHTML = Array(items.length).fill(0).map(() => `
        <div class="menu-item-skeleton">
            <div class="skeleton-loader skeleton-image"></div>
            <div class="skeleton-loader skeleton-text"></div>
            <div class="skeleton-loader skeleton-text-short"></div>
            <div class="skeleton-loader skeleton-button"></div>
        </div>
    `).join('');

    // Extract all image URLs
    const imageUrls = items.map(item => {
        const menuItem = MenuItems.find(mi => mi.item_no === item.item_no);
        return resolveImageUrl(item, menuItem);
    }).filter(url => url && url !== restaurantLogo);

    const allergenUrls = items.map(item => {
        const menuItem = MenuItems.find(mi => mi.item_no === item.item_no);
        return resolveAllergenImageUrl(item, menuItem);
    }).filter(url => url && url.trim() !== '');

    const nutritionUrls = items.map(item => {
        const menuItem = MenuItems.find(mi => mi.item_no === item.item_no);
        return resolveNutritionImageUrl(item, menuItem);
    }).filter(url => url && url.trim() !== '');

    console.log('🖼️ Preloading', imageUrls.length, 'main images,', allergenUrls.length, 'allergen images, and', nutritionUrls.length, 'nutrition images...');
    preloadImages([...imageUrls, ...allergenUrls, ...nutritionUrls], 'high');

    await new Promise(resolve => setTimeout(resolve, 100));

    // Validate images in parallel
    const validatedItems = await Promise.all(
        items.map(async (item) => {
            const menuItem = MenuItems.find(mi => mi.item_no === item.item_no);
            const imageUrl = resolveImageUrl(item, menuItem);
            const allergenUrl = resolveAllergenImageUrl(item, menuItem);
            const nutritionUrl = resolveNutritionImageUrl(item, menuItem);

            const validatedUrl = await loadImageWithValidation(imageUrl, restaurantLogo, 2000);
            const validatedAllergenUrl = allergenUrl ? await loadImageWithValidation(allergenUrl, '', 2000) : '';
            const validatedNutritionUrl = nutritionUrl ? await loadImageWithValidation(nutritionUrl, '', 2000) : '';

            return {
                item,
                imageUrl: validatedUrl,
                allergenUrl: validatedAllergenUrl,
                nutritionUrl: validatedNutritionUrl
            };
        })
    );

    // ✅ RENDER WITH ACTUAL CONTENT AND LOADING CLASSES
    container.innerHTML = validatedItems.map(({ item, imageUrl, allergenUrl, nutritionUrl }, index) => {
        const id = item.item_no;
        const hasMenuTypeGrpDtls = Array.isArray(item.itemmaster_menutype_grpdtls)
            ? item.itemmaster_menutype_grpdtls.length > 0
            : Boolean(item.itemmaster_menutype_grpdtls);
        const priceObj = item?.selling_uom_dtls?.[0]?.price_dtls?.[0] || item;
        const priceValue = hasMenuTypeGrpDtls ? null : parseFloat(getPriceByServiceType(priceObj));
        const displayPrice = !isNaN(priceValue) && priceValue > 0 ? `$${priceValue.toFixed(2)}` : '';

        const loadingStrategy = index < 6 ? 'eager' : 'lazy';
        const fetchPriority = index < 6 ? 'high' : 'auto';

        // Allergen badge
        const allergenBadge = allergenUrl ? `
            <img src="${allergenUrl}" 
                 alt="Allergen information for ${item.item_name}" 
                 class="allergen-badge"
                 fetchpriority="${fetchPriority}"
                 decoding="async"
                 loading="${loadingStrategy}"
                 style="width: 32px; height: 32px; object-fit: contain; padding: 4px; border-radius: 6px;"
                 onerror="this.style.display='none';">` : '';

        // Nutrition badge
        const nutritionBadge = nutritionUrl ? `
            <img src="${nutritionUrl}" 
                 alt="Nutrition information for ${item.item_name}" 
                 class="nutrition-badge"
                 fetchpriority="${fetchPriority}"
                 decoding="async"
                 loading="${loadingStrategy}"
                 style="position: absolute; bottom: 8px; right: 1px; width: 40px; height: 40px; object-fit: contain; padding: 4px; border-radius: 6px; z-index: 10;"
                 onerror="this.style.display='none';">` : '';

        return `
          <div class="menu-item p-4 border rounded shadow" data-item-name="${item.item_name}">
            <div class="item-image">
              <div class="image-wrapper image-loading" style="position: relative; width: 100%; height: 100%; background: #f0f0f0; border-radius: var(--radius-md); overflow: hidden;">
                 <img src="${imageUrl}" 
                      alt="${item.item_name}" 
                      fetchpriority="${fetchPriority}"
                      decoding="async"
                      loading="${loadingStrategy}"
                      style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-md); display: block;"
                      onload="this.classList.add('loaded'); this.parentElement.classList.remove('image-loading');"
                      onerror="this.onerror=null; if(this.src!=='${restaurantLogo}') this.src='${restaurantLogo}'; this.parentElement.classList.remove('image-loading');">
                 ${nutritionBadge}
               </div>
            </div>
            <div class="item-info" style="position: relative;">
              <h3 class="font-semibold">${item.display_name || item.item_name}</h3>
              <div style="display: flex; align-items: flex-start; gap: 8px;">
                <p class="item-description text-sm text-gray-600" style="flex: 1;">${item.item_desc || ''}</p>
                ${allergenBadge ? `<div style="flex-shrink: 0; display: flex; align-items: center;">${allergenBadge}</div>` : ''}
              </div>
              <div class="item-footer flex justify-between items-center mt-2">
                <span class="item-price font-bold ${hasMenuTypeGrpDtls ? 'invisible' : ''}">
                  ${displayPrice}
                </span>
                <button class="add-btn bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded w-full max-w-[100px]" data-item-id="${id}">
                  Add to Cart
                </button>
              </div>
            </div>
          </div>
        `;
    }).join('');

    // Attach click listeners
    if (!isMenuGridClickListenerAttached) {
        container.addEventListener('click', (e) => {
            if (e.target.matches('button.add-btn')) {
                e.stopPropagation();
                const id = e.target.getAttribute('data-item-id');
                addToCart(id);
            }
        });
        isMenuGridClickListenerAttached = true;
    }

    if (typeof attachItemDetailHandlers === 'function') {
        attachItemDetailHandlers();
    }

    console.log('✅ Menu grid rendered with validated images');
}

// ✅ Enhanced: Add <link rel="preload"> for critical above-the-fold images
function addPreloadLinks(items, MenuItems) {
    const head = document.head;
    const existingPreloads = new Set(
        Array.from(document.querySelectorAll('link[rel="preload"][as="image"]'))
            .map(link => link.href)
    );

    // Preload first 6 images (above-the-fold)
    const criticalUrls = extractImageUrls(items.slice(0, 6), MenuItems);

    criticalUrls.forEach(imageUrl => {
        if (imageUrl && !existingPreloads.has(imageUrl)) {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = imageUrl;
            link.fetchPriority = 'high';
            head.appendChild(link);
        }
    });
}


function resolveNutritionImageUrl(item, menuItem) {
    let nutritionFilename = item.tqr_nutrition_type ||
        menuItem?.tqr_nutrition_type ||
        '';

    if (!nutritionFilename || nutritionFilename.trim() === '') {
        return '';
    }

    let nutritionUrl = '';
    if (nutritionFilename.startsWith('http') || nutritionFilename.startsWith('blob:')) {
        nutritionUrl = nutritionFilename;
    } else if (nutritionFilename.startsWith('/')) {
        nutritionUrl = nutritionFilename;
    } else {
        // Remove query parameters if any
        const cleanFilename = nutritionFilename.split('?')[0];

        // Don't encode the URL - pass it as-is
        if (cleanFilename.startsWith('public/upload/')) {
            nutritionUrl = `/API/GetImageProxy?imageUrl=${cleanFilename}`;
        } else {
            nutritionUrl = `${RESTAURANT_CONFIG.baseImageUrl}${cleanFilename}`;
        }
    }

    return nutritionUrl;
}

// ✅ Utility: Clear preload cache if needed (e.g., when menu changes)
function clearImagePreloadCache() {
    imagePreloadMap.clear();
}

// ✅ Utility: Get preload statistics
function getPreloadStats() {
    const total = imagePreloadMap.size;
    const loaded = Array.from(imagePreloadMap.values()).filter(e => e.loaded).length;
    return { total, loaded, pending: total - loaded };
}
function getTranslatedName(itemNo, fallbackName, language, type = "item") {
    const { menuCategoryItemTranslations } = useCache();
    const translations = Array.isArray(menuCategoryItemTranslations) ? menuCategoryItemTranslations : [];

    const trimmedCode = itemNo?.toString().trim().toLowerCase();
    let translation;

    if (type === "item") {
        translation = translations.find(t =>
            t.item_no?.toString().trim().toLowerCase() === trimmedCode
        );
    } else if (type === "category") {
        translation = translations.find(t =>
            t.category_code?.toString().trim().toLowerCase() === trimmedCode
        );
    }
    //console.log("translation.itemNo", itemNo);
    //console.log("translation.fallbackName", fallbackName);
    //console.log("language", language);

    if (translation?.item_name_lang?.trim()) {
        return translation.item_name_lang;
    }
    if (translation?.category_name_lang?.trim()) {
        return translation.category_name_lang;
    }

    // fallback if nothing found
    return fallbackName;
}


//async function getTranslatedName(itemNo, fallbackName, language, type = "item") {
//    await loadMenu(language);

//    const { menuCategoryItemTranslations } = useCache();
//    const translations = Array.isArray(menuCategoryItemTranslations) ? menuCategoryItemTranslations : [];

//    const trimmedItemNo = itemNo?.toString().trim();

//    // Filter all matches for the item_no
//    const matches = translations.filter(t => t.item_no?.toString().trim() === trimmedItemNo);

//    // Prefer the first “real” translation (not placeholder)
//    const translation = matches.find(t => t.item_name_lang && t.item_name_lang.trim() !== "காலை வணக்கம்")
//        || matches[0]; // fallback to first if all are placeholders

//    if (translation?.item_name_lang?.trim()) {
//        return translation.item_name_lang;
//    }

//    return fallbackName;
//}


async function loadMenu(language) {
    const { menuCategoryItemTranslations, setMenuCategoryItemTranslations } = useCache();

    if (!menuCategoryItemTranslations || menuCategoryItemTranslations.length === 0) {
        const res = await fetch(`/API/GetMenuCategoryItemTranslations?languageName=${encodeURIComponent(language)}`);
        const json = await res.json();
        setMenuCategoryItemTranslations(json || []); // populate cache
    }
}




window.getAddonsByName = function (itemName) {
    const items = useCache().items || [];

    if (!Array.isArray(items) || items.length === 0) {
        alert("No items loaded to check add-ons.");
        return;
    }

    const item = items.find(i => i.item_name?.trim() === itemName.trim());

    if (!item) {
        alert("Item not found in cache.");
        return;
    }

    if (item.is_addon_enable?.toUpperCase() === "Y") {
        alert(`Add-ons available for "${itemName}"`);
        //printAddonsForItem(itemName);
    } else {
        alert(`No add-ons available for "${itemName}"`);
    }
};

//function printAddonsForItem(itemName) {
//    const items = useCache().items || [];
//    const addonGroups = useCache().addons || []; // Already cleaned in getAddons()

//    if (!items.length) {
//        console.warn("No items found in cache");
//        return;
//    }

//    const normalizedSearch = itemName.trim().toLowerCase();
//    const item = items.find(i => i.item_name?.trim().toLowerCase() === normalizedSearch);

//    if (!item) {
//        console.log(`Item "${itemName}" not found in cache.`);
//        return;
//    }

//    const addOnName = item.add_on_name;
//    console.log(`Item found:`, item);

//    if (item.is_addon_enable?.toUpperCase() !== "Y") {
//        console.log(`No add-ons available for "${itemName}"`);
//        return;
//    }

//    if (!addonGroups.length) {
//        console.log("No add-ons found in cache.");
//        return;
//    }

//    // Match add-on groups by add_on_name
//    const matchedGroup = addonGroups.find(group => group.add_on_name === addOnName);

//    if (!matchedGroup) {
//        console.log(`No add-on group found with name "${addOnName}"`);
//        return;
//    }

//    const relatedAddons = matchedGroup.item_dtls || [];

//    if (!relatedAddons.length) {
//        console.log(`Add-on group "${addOnName}" found, but no items inside.`);
//        return;
//    }

//    console.log(`Add-ons linked to "${itemName}" (group: ${addOnName}):`);
//    relatedAddons.forEach(addon => {
//        console.log(`- ${addon.item_desc} (Item No: ${addon.item_no})`);
//    });
//}

// ✅ Category state management using Maps
const categoryStateMap = new Map();
const categoryElementMap = new Map();

/**
 * Builds a hierarchical category structure using Maps
 * @param {Array} categories - Array of category objects
 * @returns {Map} Map of root_category_code -> child categories
 */
function buildCategoryHierarchy(categories) {
    const hierarchyMap = new Map();

    categories.forEach(cat => {
        const root = cat.root_category_code;
        if (!hierarchyMap.has(root)) {
            hierarchyMap.set(root, []);
        }
        hierarchyMap.get(root).push(cat);
    });

    return hierarchyMap;
}

/**
 * Gets all items from cache safely
 * @returns {Array} Array of menu items
 */
function getCachedItems() {
    try {
        return useCache().items || [];
    } catch (e) {
        console.warn('Could not access cache items:', e);
        return [];
    }
}

/**
 * Checks if a category has visible items
 * @param {string} categoryCode - Category code to check
 * @param {Array} allItems - All menu items
 * @param {boolean} shouldFilter - Whether to apply filtering
 * @returns {boolean}
 */
function categoryHasVisibleItems(categoryCode, allItems, shouldFilter) {
    if (!shouldFilter) return true;

    const code = categoryCode.trim().toLowerCase();
    return allItems.some(item => {
        if (!item?.item_no) return false;

        try {
            if (typeof isMenuCategoryOrItemHidden === "function" &&
                isMenuCategoryOrItemHidden("I", item.item_no)) {
                return false;
            }
        } catch (e) {
            // If check fails, assume item is visible
        }

        return (item.category_code || "").trim().toLowerCase() === code;
    });
}

/**
 * Checks if category or its subcategories have items
 * @param {string} categoryCode - Category code to check
 * @param {Map} hierarchyMap - Category hierarchy map
 * @param {Array} allItems - All menu items
 * @param {boolean} shouldFilter - Whether to apply filtering
 * @returns {boolean}
 */
function categoryTreeHasItems(categoryCode, hierarchyMap, allItems, shouldFilter) {
    if (!shouldFilter) return true;

    // Check main category
    if (categoryHasVisibleItems(categoryCode, allItems, shouldFilter)) {
        return true;
    }

    // Check subcategories
    const subcategories = hierarchyMap.get(categoryCode) || [];
    return subcategories.some(subCat =>
        subCat.category_code !== 'MAIN' &&
        categoryHasVisibleItems(subCat.category_code, allItems, shouldFilter)
    );
}

/**
 * Filters categories based on item visibility
 * @param {Array} categories - Categories to filter
 * @param {Map} hierarchyMap - Category hierarchy map
 * @param {Array} allItems - All menu items
 * @param {boolean} shouldFilter - Whether to apply filtering
 * @returns {Array} Filtered categories
 */
function filterVisibleCategories(categories, hierarchyMap, allItems, shouldFilter) {
    if (!shouldFilter) return categories;

    return categories.filter(cat =>
        categoryTreeHasItems(cat.category_code, hierarchyMap, allItems, shouldFilter)
    );
}

/**
 * Gets visible subcategories for a category
 * @param {string} categoryCode - Parent category code
 * @param {Map} hierarchyMap - Category hierarchy map
 * @param {Array} allItems - All menu items
 * @param {boolean} shouldFilter - Whether to apply filtering
 * @returns {Array} Visible subcategories
 */
function getVisibleSubcategories(categoryCode, hierarchyMap, allItems, shouldFilter) {
    const subcategories = hierarchyMap.get(categoryCode) || [];

    return subcategories.filter(subCat => {
        if (subCat.category_code === 'MAIN') return false;
        return !shouldFilter || categoryHasVisibleItems(subCat.category_code, allItems, shouldFilter);
    });
}

/**
 * Creates a category button element
 * @param {Object} category - Category object
 * @param {boolean} isActive - Whether button should be active
 * @param {boolean} isSubcategory - Whether this is a subcategory
 * @returns {HTMLButtonElement}
 */
function createCategoryButton(category, isActive, isSubcategory) {
    const btn = document.createElement('button');
    btn.className = `${isSubcategory ? 'subcategory-tab' : 'category-tab'}${isActive ? ' active' : ''}`;
    btn.dataset.category = category.category_code;

    // Create container for image and text
    const container = document.createElement('div');
    container.className = isSubcategory ? 'subcategory-tab-container' : 'category-tab-container';

    // Add category image if available
    if (category.category_image) {
        const img = document.createElement('img');
        // Resolve image URL following the same pattern as menu items
        let imageUrl = category.category_image;
        // Check if it's a relative path or needs to go through proxy
        if (imageUrl && !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('data:') && !imageUrl.startsWith('/API/')) {
            // Use the same proxy pattern as menu items
            imageUrl = `/API/GetImageProxy?imageUrl=${encodeURIComponent(imageUrl)}`;
        } else if (imageUrl && !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('data:') && !imageUrl.startsWith('/API/')) {
            // Remove leading slash if present to avoid double slashes
            imageUrl = imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
            imageUrl = `${window.BASE_URL || ''}/${imageUrl}`;
        }

        img.src = imageUrl;
        img.alt = category.category_name || category.category_code;
        img.className = isSubcategory ? 'subcategory-icon' : 'category-icon';
        img.loading = 'lazy';
        img.decoding = 'async';

        img.onerror = function () {
            // Fallback to restaurant logo if category image fails
            if (RESTAURANT_CONFIG.logo && this.src !== RESTAURANT_CONFIG.logo) {
                this.src = RESTAURANT_CONFIG.logo;
            } else {
                // Hide image if logo also fails
                this.style.display = 'none';
            }
        };

        container.appendChild(img);
    } else {
        // If no category image is provided, use restaurant logo
        const img = document.createElement('img');
        img.src = RESTAURANT_CONFIG.logo;
        img.alt = category.category_name || category.category_code;
        img.className = isSubcategory ? 'subcategory-icon' : 'category-icon';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.onerror = function () {
            this.style.display = 'none';
        };
        container.appendChild(img);
    }

    // Add category name
    const nameSpan = document.createElement('span');
    nameSpan.className = isSubcategory ? 'subcategory-name' : 'category-name';
    nameSpan.textContent = category.category_name || category.category_code || '';
    container.appendChild(nameSpan);

    btn.appendChild(container);
    return btn;
}

/**
 * Creates subcategory container element
 * @param {boolean} isVisible - Whether container should be visible
 * @returns {HTMLDivElement}
 */
function createSubcategoryContainer(isVisible) {
    const container = document.createElement('div');
    container.className = `subcategory-container${isVisible ? '' : ' hidden'}`;
    return container;
}

/**
 * Resets all tab states
 * @param {HTMLElement} tabContainer - Main tab container
 */
function resetAllTabs(tabContainer) {
    tabContainer.querySelectorAll('.category-tab')
        .forEach(b => b.classList.remove('active'));
    tabContainer.querySelectorAll('.subcategory-container')
        .forEach(div => {
            div.classList.add('hidden');
            div.querySelectorAll('.subcategory-tab')
                .forEach(btn => btn.style.display = 'none');
        });
}

/**
 * Activates a category tab and its subcategories
 * @param {HTMLElement} mainBtn - Main category button
 * @param {HTMLElement} subContainer - Subcategory container
 * @param {Array} visibleSubcategories - Array of visible subcategories
 */
function activateCategoryTab(mainBtn, subContainer, visibleSubcategories) {
    mainBtn.classList.add('active', 'bg-gray-300');
    subContainer.classList.remove('hidden');
    subContainer.querySelectorAll('.subcategory-tab')
        .forEach(btn => btn.style.display = 'block');

    const firstSub = subContainer.querySelector('.subcategory-tab');
    if (firstSub && visibleSubcategories.length > 0) {
        // Has visible subcategories - activate first one
        subContainer.querySelectorAll('.subcategory-tab')
            .forEach(b => b.classList.remove('active', 'bg-gray-300'));
        firstSub.classList.add('active', 'bg-gray-300');
        renderCategoryByCode(firstSub.dataset.category);
    } else {
        // No subcategories - render main category
        renderCategoryByCode(mainBtn.dataset.category);
    }
}

/**
 * Handles empty categories state
 * @param {HTMLElement} tabContainer - Main tab container
 * @param {boolean} shouldFilter - Whether filtering was applied
 */
function handleEmptyCategories(tabContainer, shouldFilter) {
    tabContainer.style.display = "none";

    const menuTitle = document.getElementById("menuTitle");
    const menuGrid = document.getElementById("menuGrid");

    if (menuTitle) {
        menuTitle.innerText = shouldFilter
            ? "No category available"
            : "Loading categories...";
    }

    if (menuGrid) {
        menuGrid.innerHTML = shouldFilter
            ? `<p class="text-gray-500">No visible categories.</p>`
            : `<p class="text-gray-500">Loading menu items...</p>`;
    }
}

/**
 * Renders initial category on page load
 * @param {Array} mainCategories - Array of main categories
 * @param {Map} hierarchyMap - Category hierarchy map
 * @param {Array} allItems - All menu items
 * @param {boolean} shouldFilter - Whether filtering was applied
 * @param {HTMLElement} tabContainer - Main tab container
 */
function renderInitialCategory(mainCategories, hierarchyMap, allItems, shouldFilter, tabContainer) {
    if (mainCategories.length === 0) {
        const menuGrid = document.getElementById("menuGrid");
        if (menuGrid) {
            menuGrid.innerHTML = '<p class="text-gray-500">No menu items available.</p>';
        }
        return;
    }

    const firstCategory = mainCategories[0];
    const visibleSubcats = getVisibleSubcategories(
        firstCategory.category_code,
        hierarchyMap,
        allItems,
        shouldFilter
    );

    if (visibleSubcats.length > 0) {
        const firstSubcat = visibleSubcats[0];
        const firstSubBtn = tabContainer.querySelector(
            `[data-category="${firstSubcat.category_code}"]`
        );
        if (firstSubBtn) {
            firstSubBtn.classList.add('active');
        }
        console.log("📂 Auto-loading first subcategory:", firstSubcat.category_code);
        renderCategoryByCode(firstSubcat.category_code);
    } else {
        console.log("📂 Auto-loading first main category:", firstCategory.category_code);
        renderCategoryByCode(firstCategory.category_code);
    }
}
/**
 * Main function to populate category tabs
 * @param {Array} categories - Array of category objects
 */
function populateCategoryTabs(categories = []) {
    const tabContainer = document.querySelector('.category-tabs');
    if (!tabContainer) {
        console.error('❌ Category tabs container not found');
        return;
    }

    console.log('📂 populateCategoryTabs called with:', categories?.length, 'categories');
    console.log('📋 Categories data:', categories);

    // Clear previous state
    tabContainer.innerHTML = '';
    categoryStateMap.clear();
    categoryElementMap.clear();

    // ✅ FALLBACK: If no categories, try simple approach
    if (!categories || categories.length === 0) {
        console.log('🔄 No categories provided, trying fallback...');
        const fallbackCategories = buildVisibleCategoriesSimple();

        if (fallbackCategories.length === 0) {
            console.error('❌ No categories available to display');
            handleEmptyCategories(tabContainer, true);
            return;
        }
        categories = fallbackCategories;
    }

    // Get cached items for filtering
    const allItems = getCachedItems();
    const shouldFilter = allItems.length > 0;

    console.log('📊 Available items for filtering:', allItems.length);

    // Build category hierarchy
    const hierarchyMap = buildCategoryHierarchy(categories);

    // Get and filter main categories
    let mainCategories = (hierarchyMap.get('MAIN') || [])
        .filter(c => c.category_code !== 'MAIN');

    mainCategories = filterVisibleCategories(
        mainCategories,
        hierarchyMap,
        allItems,
        shouldFilter
    );

    console.log('🏠 Main categories after filtering:', mainCategories.length);

    // Handle empty state
    if (mainCategories.length === 0) {
        console.warn('⚠️ No main categories available after filtering');
        handleEmptyCategories(tabContainer, shouldFilter);
        return;
    }

    tabContainer.style.display = "";

    // Render each main category
    mainCategories.forEach((cat, idx) => {
        const isFirst = idx === 0;

        // Create main category button
        const mainBtn = createCategoryButton(cat, isFirst, false);
        const subContainer = createSubcategoryContainer(isFirst);

        // Get visible subcategories
        const visibleSubcategories = getVisibleSubcategories(
            cat.category_code,
            hierarchyMap,
            allItems,
            shouldFilter
        );

        console.log(`📁 ${cat.category_code} has ${visibleSubcategories.length} subcategories`);

        // Store state
        categoryStateMap.set(cat.category_code, {
            category: cat,
            subcategories: visibleSubcategories,
            container: subContainer,
            button: mainBtn
        });

        // Create subcategory buttons
        visibleSubcategories.forEach(subCat => {
            const subBtn = createCategoryButton(subCat, false, true);
            if (!isFirst) subBtn.style.display = 'none';

            subBtn.addEventListener('click', e => {
                e.stopPropagation();
                subContainer.querySelectorAll('.subcategory-tab')
                    .forEach(b => b.classList.remove('active'));
                subBtn.classList.add('active');
                console.log(`📂 Loading subcategory: ${subCat.category_code}`);
                renderCategoryByCode(subCat.category_code);
            });

            subContainer.appendChild(subBtn);
        });

        // Main category button click handler
        mainBtn.addEventListener('click', () => {
            resetAllTabs(tabContainer);
            activateCategoryTab(mainBtn, subContainer, visibleSubcategories);
        });

        tabContainer.appendChild(mainBtn);
        tabContainer.appendChild(subContainer);
    });

    // Render initial category
    renderInitialCategory(mainCategories, hierarchyMap, allItems, shouldFilter, tabContainer);
}

// ✅ Utility: Get current active category
function getActiveCategoryCode() {
    const activeBtn = document.querySelector('.category-tab.active, .subcategory-tab.active');
    return activeBtn?.dataset.category || null;
}

// ✅ Utility: Programmatically activate a category
function activateCategory(categoryCode) {
    const btn = categoryElementMap.get(categoryCode);
    if (btn) {
        btn.click();
        return true;
    }
    return false;
}

// ✅ Utility: Get category state
function getCategoryState(categoryCode) {
    return categoryStateMap.get(categoryCode) || null;
}

function updateTime() {
    const now = new Date();
    const el = document.getElementById('currentTime');
    if (el) el.textContent = now.toLocaleTimeString();
}

function filterItemsByCategory(items, categoryCode) {
    if (categoryCode === "all") return items;
    return items.filter(item => item.category_code === categoryCode);
}


function setupCategoryTabs(menuItems) {
    const tabButtons = document.querySelectorAll("[data-category]");

    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            const category = button.dataset.category;
            const filtered = filterItemsByCategory(menuItems, category);
            renderMenuGrid(filtered);
        });
    });
}


function setupEventListeners() {
    const checkoutBtn = document.getElementById('checkoutBtn');
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', checkout);
    }

    let inactivityTimer;
    function resetTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            if (cart.length > 0 && confirm('Clear cart due to inactivity?')) {
                cart = [];
                updateCartDisplay();
            }
        }, 300000); // 5 minutes
    }
    document.addEventListener('click', resetTimer);
    document.addEventListener('touchstart', resetTimer);
}

function removeFromCart(lineIndex) {
    if (!state?.order?.sales_dtls || lineIndex < 0 || lineIndex >= state.order.sales_dtls.length) {
        console.warn("removeFromCart: Invalid index", lineIndex);
        return;
    }

    // Remove from main sales_dtls
    state.order.sales_dtls.splice(lineIndex, 1);

    // Also keep orderItems.sales_dtls in sync
    if (state?.order?.orderItems?.orderItems?.sales_dtls) {
        state.order.orderItems.orderItems.sales_dtls.splice(lineIndex, 1);
    }

    updateCartDisplay();
}



document.addEventListener('DOMContentLoaded', () => {
    const cartItems = document.getElementById('cartItems');
    cartItems.addEventListener('click', handleRemoveClick);

    renderCartFromOrder(); // or whatever loads the cart initially
});

function updateQuantity(itemId, change) {
    const item = cart.find(i => i.item_no === itemId || i.id === itemId);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) {
            removeFromCart(itemId);
        } else {
            updateCartDisplay();
        }
    }
}

function updateCartCount() {
    const { order } = useOrderStore.getState();
    const badge = document.getElementById("cartBadge");
    const subtotalEl = document.getElementById("navSubtotal");
    const cartLabel = document.querySelector('.nav-item[onclick="toggleCart()"] .nav-label');
    const bottomNav = document.querySelector('.bottom-nav');

    if (!badge || !subtotalEl || !bottomNav) return;

    // ✅ Check if cart is empty
    const isCartEmpty = !order || !Array.isArray(order.sales_dtls) || order.sales_dtls.length === 0;

    console.log('🔄 updateCartCount - empty:', isCartEmpty);

    if (isCartEmpty) {
        // ✅ EMPTY CART: Always hide everything
        badge.style.display = "none";
        subtotalEl.style.display = "none";
        bottomNav.style.display = "none";

        if (cartLabel) {
            cartLabel.style.display = "block";
            cartLabel.textContent = "Cart";
        }

        console.log('🛒 Cart is empty - bottom nav hidden');
        return;
    }

    // ✅ CART HAS ITEMS: Show everything
    const parentCount = order.sales_dtls
        .filter(item => item.s_no === item.parent_sno)
        .length;

    const total = order.net_amt || order.total_amt || order.final_amt || order.grand_total || 0;
    const formattedTotal = `$${parseFloat(total).toFixed(2)}`;

    badge.style.display = "flex";
    badge.textContent = parentCount;
    subtotalEl.style.display = "block";
    subtotalEl.textContent = formattedTotal;
    bottomNav.style.display = "flex"; // ✅ Always show when cart has items

    if (cartLabel) {
        cartLabel.style.display = "none";
    }

    console.log('🔢 Cart has items:', {
        items: parentCount,
        total: formattedTotal,
        bottomNavVisible: true
    });
}

async function handleRemoveClick(e) {
    try {
        const target = e.target.closest('.cart-remove-btn');
        if (!target) return;

        const sNo = target.getAttribute('data-sno');
        if (!sNo) return;

        const { order } = useOrder();
        if (!order || !Array.isArray(order.sales_dtls)) return;

        console.log('🗑️ Remove button clicked for s_no:', sNo);

        // Find the order item to delete
        const orderItem = order.sales_dtls.find(item => String(item.s_no) === String(sNo));
        if (!orderItem) {
            console.error('❌ Item not found:', sNo);
            return;
        }

        // ✅ Use individual item deletion with await
        await deleteIndividualItem(orderItem);

        // ✅ Re-render UI after deletion
        setTimeout(() => {
            if (typeof renderCartFromOrder === 'function') {
                renderCartFromOrder();
            }
            if (typeof updateCartCount === 'function') {
                updateCartCount();
            }
        }, 50);

    } catch (error) {
        console.error('❌ Error in handleRemoveClick:', error);
        if (typeof renderCartFromOrder === 'function') {
            setTimeout(renderCartFromOrder, 100);
        }
    }
}


function removeItemByLineId(lineId) {
    const { order, setOrder } = useOrder();
    if (!order || !Array.isArray(order.sales_dtls)) return;

    const filteredSales = order.sales_dtls.filter(item => item.line_id !== lineId);

    const updatedOrder = {
        ...order,
        sales_dtls: filteredSales,
        orderItems: {
            orderItems: {
                sales_dtls: filteredSales
            }
        }
    };

    setOrder(updatedOrder);
    renderCartFromOrder();
}



// Additional utility function for better quantity updates
function updateQuantityByIndex(index, change) {
    const orderObj = useOrder();
    if (!orderObj || !orderObj.order) return;

    const mainSales = Array.isArray(orderObj.order?.sales_dtls) ? orderObj.order.sales_dtls : [];
    const nestedSales = Array.isArray(orderObj.orderItems?.orderItems?.sales_dtls)
        ? orderObj.orderItems.orderItems.sales_dtls
        : [];

    const allSales = [...mainSales, ...nestedSales];

    if (index < 0 || index >= allSales.length) {
        console.error('Invalid index for quantity update:', index);
        return;
    }

    const itemToUpdate = allSales[index];
    const idToUpdate = itemToUpdate.s_no || itemToUpdate.item_no;

    // Find and update in both arrays
    const mainItem = mainSales.find(item => (item.s_no || item.item_no) === idToUpdate);
    const nestedItem = nestedSales.find(item => (item.s_no || item.item_no) === idToUpdate);

    if (mainItem) {
        const newQty = Math.max(1, (mainItem.order_qty || 1) + change);
        mainItem.order_qty = newQty;

        // Recalculate sub_total
        const itemPrice = Number(mainItem.dine_in_price || mainItem.takeaway_price || mainItem.delivery_price || 0);
        const addonTotal = Array.isArray(mainItem.selectedAddons)
            ? mainItem.selectedAddons.reduce((sum, addon) => sum + (Number(addon.price || 0) * Number(addon.qty || 1)), 0)
            : 0;
        mainItem.sub_total = (itemPrice + addonTotal) * newQty;
    }

    if (nestedItem) {
        const newQty = Math.max(1, (nestedItem.order_qty || 1) + change);
        nestedItem.order_qty = newQty;

        // Recalculate sub_total for nested item too
        const itemPrice = Number(nestedItem.dine_in_price || nestedItem.takeaway_price || nestedItem.delivery_price || 0);
        const addonTotal = Array.isArray(nestedItem.selectedAddons)
            ? nestedItem.selectedAddons.reduce((sum, addon) => sum + (Number(addon.price || 0) * Number(addon.qty || 1)), 0)
            : 0;
        nestedItem.sub_total = (itemPrice + addonTotal) * newQty;
    }

    // Persist updated order
    try {
        sessionStorage.setItem("order", JSON.stringify(orderObj));
    } catch (error) {
        console.error('Error saving to sessionStorage:', error);
    }

    // Re-render cart
    renderCartFromOrder();
}


function removeItemBySno(sno, addonSnos = []) {
    const orderObj = useOrder();
    if (!orderObj || !orderObj.order) return;

    let sales = orderObj.order.sales_dtls || [];

    // Remove base item
    sales = sales.filter(item => item.s_no !== sno);

    // Remove all related addons if any
    if (addonSnos.length > 0) {
        sales = sales.filter(item => !addonSnos.includes(item.s_no));
    }

    // Persist back
    orderObj.order.sales_dtls = sales;
    try {
        sessionStorage.setItem("order", JSON.stringify(orderObj));
    } catch (err) {
        console.error("Error saving to sessionStorage:", err);
    }

    // Refresh cart
    updateCartDisplay();
}

//function renderCartFromOrder() {
//    const orderObj = useOrder();
//    const gstRate = parseFloat(sessionStorage.getItem("GST"));
//    const serviceRate = parseFloat(sessionStorage.getItem("ServiceCharge"));
//    if (!orderObj || !orderObj.order) return;

//    const salesDtls = orderObj.order.sales_dtls || [];
//    const cartItemsContainer = document.getElementById('cartItems');
//    if (!cartItemsContainer) return;

//    // Deduplicate by s_no + item_no (defensive)
//    const seen = new Set();
//    const sales = salesDtls.filter(i => {
//        const key = `${i.s_no ?? ''}-${i.item_no ?? ''}`;
//        if (seen.has(key)) return false;
//        seen.add(key);
//        return true;
//    });

//    // Base items: items without parent_sno or where parent_sno === s_no
//    const baseItems = sales.filter(i => !i.parent_sno || i.parent_sno === i.s_no);
//    const addonRecords = sales.filter(i => i.parent_sno && i.parent_sno !== i.s_no);

//    if (!baseItems.length) {
//        cartItemsContainer.innerHTML = `
//            <div class="empty-cart">
//                Your cart is empty.<br>
//                Select items from the menu to get started!
//            </div>
//        `;
//        document.getElementById('cartTotal').textContent = `$0.00`;
//        document.getElementById('service-charge').textContent = `$0.00`;
//        document.getElementById('gst').textContent = `$0.00`;
//        document.getElementById('total').textContent = `$0.00`;
//        document.getElementById('checkout-btn').disabled = true;
//        //document.getElementById("gst-rate").textContent = gstRate;
//        //document.getElementById("service-charge-rate").textContent = serviceRate;

//        return;
//    }

//    let subtotal = 0;

//    cartItemsContainer.innerHTML = baseItems.map(item => {
//        const qty = Number(item.qty || 1);
//        const basePrice = Number(item.dine_in_price ?? item.unit_price ?? 0);
//        let groupTotal = basePrice * qty;

//        // get addons: prefer item.selectedAddons if present, otherwise use addonRecords linked by parent_sno
//        const addonsSource = (Array.isArray(item.selectedAddons) && item.selectedAddons.length)
//            ? item.selectedAddons
//            : addonRecords.filter(a => a.parent_sno == item.s_no);

//        const addonHtml = (addonsSource || []).map(addon => {
//            // robust extraction of addon properties (handle both "compact" and "full" addon records)
//            const addonName = (addon.item_name || addon.citem_name || '').toString().replace(/\(\+\$\d+(\.\d+)?\)/g, '').trim();
//            const addonQty = Number(addon.qty ?? addon.quantity ?? 1);
//            const addonPrice = Number(addon.price ?? addon.unit_price ?? addon.dine_in_price ?? 0);

//            // Multiply addon price by addonQty and by base item qty (this is the important fix)
//            groupTotal += addonPrice * addonQty * qty;

//            // UX: show total count for clarity (addonQty per base item => total = addonQty * qty)
//            const totalAddonQty = addonQty * qty;
//            const qtySuffix = totalAddonQty > 1 ? ` x${totalAddonQty}` : '';

//            return `<div class="addon-line text-sm text-gray-600">+ <span class="addon-text">${addonName}${qtySuffix}</span></div>`;
//        }).join('');

//        subtotal += groupTotal;

//        return `
//            <div class="cart-item border-b py-2">
//                <div class="cart-item-info">
//                    <div class="cart-item-name font-semibold">${item.item_name}</div>
//                    <div class="cart-item-price text-gray-700">Main: $${basePrice.toFixed(2)}</div>
//                    ${addonHtml}
//                </div>
//                <div class="quantity-controls mt-2 flex items-center gap-2">
//                    <button class="qty-btn" onclick="GetHomeAPI.updateQuantityBySno('${item.s_no}', -1)">−</button>
//                    <span class="qty-display">${qty}</span>
//                    <button class="qty-btn" onclick="GetHomeAPI.updateQuantityBySno('${item.s_no}', 1)">+</button>
//                    <button class="edit-btn text-blue-600" onclick="GetHomeAPI.editItem('${item.s_no}','${item.item_no}')">Edit</button>
//                    <button class="remove-btn text-red-600" data-sno="${item.s_no}">Remove</button>
//                </div>
//            </div>`;
//    }).join('');

//    // --- Totals ---
//    const svcValue = Number(sessionStorage.getItem("ServiceCharge")) || 0;
//    const gstValue = Number(sessionStorage.getItem("GST")) || 0;

//    const serviceCharge = subtotal * (svcValue / 100);
//    const gst = (subtotal + serviceCharge) * (gstValue / 100);
//    const finalTotal = subtotal + serviceCharge + gst;

//    document.getElementById('cartTotal').textContent = `$${subtotal.toFixed(2)}`;
//    document.getElementById('service-charge').textContent = `$${serviceCharge.toFixed(2)}`;
//    document.getElementById('gst').textContent = `$${gst.toFixed(2)}`;
//    document.getElementById('total').textContent = `$${finalTotal.toFixed(2)}`;
//    document.getElementById('checkout-btn').disabled = finalTotal === 0;
//}


function updateCartDisplay() {
    renderCartFromOrder();
}

// ✅ NEW: Separate function for deleting individual items from cart
async function deleteIndividualItem(orderItem) {
    try {
        const { order, setOrder } = useOrder();
        const orderItems = order?.sales_dtls || [];

        console.log('🗑️ Deleting individual item:', {
            s_no: orderItem.s_no,
            parent_sno: orderItem.parent_sno,
            item_name: orderItem.item_name
        });

        // ✅ Prevent WebSocket double-sync
        window._manualOrderUpdate = true;

        try {
            // Remove the item itself AND all its children
            const newOrderItems = orderItems.filter(item => {
                // Delete if it's the item itself
                if (String(item.s_no) === String(orderItem.s_no)) {
                    console.log(`  🗑️ Removing: ${item.item_name} (s_no: ${item.s_no})`);
                    return false;
                }
                // Delete if it's a child of this item
                if (String(item.parent_sno) === String(orderItem.s_no)) {
                    console.log(`  🗑️ Removing child: ${item.item_name} (s_no: ${item.s_no})`);
                    return false;
                }
                // Keep all other items
                return true;
            });

            console.log('📦 Items before:', orderItems.length, 'after:', newOrderItems.length);

            // Apply promotions (if needed)
            let finalOrderItems = newOrderItems;
            if (typeof applyPromotions === 'function') {
                const { orderItems: tempOrderItems } = applyPromotions(newOrderItems, orderItem);
                finalOrderItems = tempOrderItems || newOrderItems;
            }

            // Process svc and tax
            if (typeof addTax === 'function') {
                finalOrderItems = finalOrderItems.map(item => addTax(item));
            }

            // Calculate order amounts
            let updatedOrder = { ...order, sales_dtls: finalOrderItems };
            if (typeof calcOrderAmt === 'function') {
                updatedOrder = calcOrderAmt(updatedOrder);
            } else {
                // Fallback: Manual calculation
                const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
                const serviceRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;
                const orderType = localStorage.getItem("orderType");
                const isTakeaway = orderType === "T";

                const subTotal = finalOrderItems.reduce((sum, item) =>
                    sum + parseFloat(item.sub_total || 0), 0
                );
                const totalTax = finalOrderItems.reduce((sum, item) =>
                    sum + parseFloat(item.tax_amt || 0), 0
                );
                const totalService = isTakeaway ? 0 : finalOrderItems.reduce((sum, item) =>
                    sum + parseFloat(item.svc_amt || 0), 0
                );
                const netAmount = subTotal + totalTax + totalService;

                updatedOrder.sub_total = subTotal.toFixed(2);
                updatedOrder.total_tax = totalTax.toFixed(2);
                updatedOrder.total_svc = totalService.toFixed(2);
                updatedOrder.net_amt = netAmount.toFixed(2);
            }

            console.log('💰 Updated totals:', {
                sub_total: updatedOrder.sub_total,
                total_tax: updatedOrder.total_tax,
                net_amt: updatedOrder.net_amt,
                items_remaining: updatedOrder.sales_dtls.length
            });

            // Update order state
            setOrder(updatedOrder);

            // Update localStorage
            const existingCache = JSON.parse(localStorage.getItem("order") || '{}');
            const updatedCache = {
                ...existingCache,
                state: {
                    ...existingCache.state,
                    order: updatedOrder,
                    lastSNo: updatedOrder.sales_dtls.length > 0
                        ? Math.max(...updatedOrder.sales_dtls.map(i => parseInt(i.s_no) || 0))
                        : 0
                },
                version: (existingCache.version || 0) + 1
            };
            localStorage.setItem("order", JSON.stringify(updatedCache));

            // ✅ Sync to server using common function
            console.log('📡 Syncing deletion to server...');
            const syncResult = await updateOrderCacheOnServer();

            if (!syncResult.success) {
                console.error('❌ Failed to sync deletion:', syncResult.error);
                if (typeof window.sokWebSocket?.showUpdateNotification === 'function') {
                    window.sokWebSocket.showUpdateNotification(
                        'Sync Error',
                        'Failed to sync deletion to server'
                    );
                }
            } else {
                console.log('✅ Deletion synced successfully');
            }

            console.log('✅ Individual item deleted successfully');
            return updatedOrder;

        } catch (error) {
            console.error('❌ Error in item deletion:', error);
            throw error;
        } finally {
            // Re-enable WebSocket sync
            setTimeout(() => {
                window._manualOrderUpdate = false;
            }, 100);
        }

    } catch (error) {
        console.error('❌ Error in deleteIndividualItem:', error);
        window._manualOrderUpdate = false;
        throw error;
    }
}

async function emptyCart() {
    const { order, setOrder } = useOrder();
    if (!order || !Array.isArray(order.sales_dtls) || order.sales_dtls.length === 0) {
        return { success: true }; // Already empty
    }

    try {
        window._manualOrderUpdate = true;

        // Clear all items
        const updatedOrder = { ...order, sales_dtls: [], sub_total: "0.00", total_tax: "0.00", total_svc: "0.00", net_amt: "0.00" };

        // Update state
        setOrder(updatedOrder);

        // Update localStorage cache
        const existingCache = JSON.parse(localStorage.getItem("order") || '{}');
        const updatedCache = {
            ...existingCache,
            state: { ...existingCache.state, order: updatedOrder, lastSNo: 0 },
            version: (existingCache.version || 0) + 1
        };
        localStorage.setItem("order", JSON.stringify(updatedCache));

        // Sync to server & WebSocket broadcast
        const syncResult = await updateOrderCacheOnServer();
        if (!syncResult.success) {
            console.error('❌ Failed to sync empty cart:', syncResult.error);
            return { success: false };
        }

        console.log('✅ Cart emptied and synced successfully');
        return { success: true };
    } catch (err) {
        console.error('❌ Error emptying cart:', err);
        return { success: false };
    } finally {
        setTimeout(() => { window._manualOrderUpdate = false; }, 100);
    }
}



// ✅ UPDATED: handleRemoveClick now uses deleteIndividualItem
//function handleRemoveClick(e) {
//    try {
//        const target = e.target.closest('.cart-remove-btn');
//        if (!target) return;

//        const sNo = target.getAttribute('data-sno');
//        if (!sNo) return;

//        const { order } = useOrder();
//        if (!order || !Array.isArray(order.sales_dtls)) return;

//        console.log('🗑️ Remove button clicked for s_no:', sNo);

//        // Find the order item to delete
//        const orderItem = order.sales_dtls.find(item => String(item.s_no) === String(sNo));
//        if (!orderItem) {
//            console.error('❌ Item not found:', sNo);
//            return;
//        }

//        // ✅ Use individual item deletion
//        deleteIndividualItem(orderItem);

//        // ✅ Re-render UI after deletion
//        setTimeout(() => {
//            if (typeof renderCartFromOrder === 'function') {
//                renderCartFromOrder();
//            }
//            if (typeof updateCartCount === 'function') {
//                updateCartCount();
//            }
//        }, 50);
//    } catch (error) {
//        console.error('❌ Error in handleRemoveClick:', error);
//        if (typeof renderCartFromOrder === 'function') {
//            setTimeout(renderCartFromOrder, 10);
//        }
//    }
//}

async function updateQuantityBySno(sNo, change) {
    try {
        console.log('🔄 updateQuantityBySno called:', { sNo, change });
        if (!sNo || typeof change !== 'number') {
            console.warn('Invalid parameters:', { sNo, change });
            return;
        }

        // ✅ Get fresh state from store
        const { order } = useOrder();
        if (!order || !Array.isArray(order.sales_dtls)) {
            console.warn('Invalid order structure:', order);
            return;
        }

        // Find the target item
        const orderItem = order.sales_dtls.find(item => String(item.s_no) === String(sNo));
        if (!orderItem) {
            console.warn('Order item not found for s_no:', sNo);
            return;
        }

        const currentQty = Number(orderItem.qty) || 0;
        const newQty = Math.max(0, currentQty + Number(change));
        console.log(`🔄 Updating s_no ${sNo}: ${currentQty} → ${newQty}`);

        // ✅ Verify this is a base item (not an addon)
        const isBaseItem = String(orderItem.s_no) === String(orderItem.parent_sno || orderItem.s_no);
        if (!isBaseItem) {
            console.warn('⚠️ Cannot update quantity of addon item directly:', orderItem);
            return;
        }

        // ✅ Prevent WebSocket double-sync
        window._manualOrderUpdate = true;

        try {
            // Handle deletion when qty becomes 0
            if (newQty <= 0) {
                console.log('⚠️ Quantity is 0, deleting item');

                // Call delete function with sync
                if (typeof deleteIndividualItem === 'function') {
                    await deleteIndividualItem(orderItem);
                } else if (typeof deleteOrderItem === 'function') {
                    await deleteOrderItem(orderItem);
                } else {
                    console.error('❌ No delete function available');
                    return;
                }

                // ✅ Sync deletion to server
                console.log('📡 Syncing deletion to server...');
                const syncResult = await updateOrderCacheOnServer();

                if (!syncResult.success) {
                    console.error('❌ Failed to sync deletion:', syncResult.error);
                    if (typeof window.sokWebSocket?.showUpdateNotification === 'function') {
                        window.sokWebSocket.showUpdateNotification(
                            'Sync Error',
                            'Failed to sync deletion to server'
                        );
                    }
                } else {
                    console.log('✅ Deletion synced successfully');
                }

                // ✅ Check if cart is now empty
                setTimeout(() => {
                    const { order: updatedOrder } = useOrder();
                    const remainingItems = updatedOrder?.sales_dtls?.length || 0;

                    console.log(`📊 Remaining items after deletion: ${remainingItems}`);

                    if (remainingItems === 0) {
                        console.log('🛒 Cart is now empty, showing empty state');

                        // Show empty cart state
                        if (typeof renderCartFromOrder === 'function') {
                            renderCartFromOrder();
                        }
                        if (typeof updateCartCount === 'function') {
                            updateCartCount();
                        }

                        // Show empty cart message
                        const cartItems = document.getElementById('cartItems');
                        if (cartItems) {
                            cartItems.innerHTML = `
                                <div style="text-align: center; padding: 60px 20px; color: #6b7280;">
                                    <div style="font-size: 48px; margin-bottom: 16px;">🛒</div>
                                    <p style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">Your cart is empty</p>
                                    <p style="font-size: 14px;">Add items to get started</p>
                                </div>
                            `;
                        }

                        // Disable checkout button
                        const checkoutBtn = document.getElementById('checkout-btn');
                        if (checkoutBtn) {
                            checkoutBtn.disabled = true;
                            checkoutBtn.style.opacity = '0.5';
                            checkoutBtn.style.cursor = 'not-allowed';
                        }
                    } else {
                        // Re-render cart with remaining items
                        if (typeof renderCartFromOrder === 'function') {
                            renderCartFromOrder();
                        }
                        if (typeof updateCartCount === 'function') {
                            updateCartCount();
                        }
                    }
                }, 100);

                return;
            }

            // ✅ Update quantity locally using existing function
            console.log('✅ Calling changeItemQuantity with newQty:', newQty);
            if (typeof changeItemQuantity === 'function') {
                changeItemQuantity(newQty, orderItem);
            } else {
                console.error('❌ changeItemQuantity function not found!');
                // Fallback: direct update
                orderItem.qty = newQty;
                orderItem.sub_total = (Number(orderItem.unit_price) * newQty).toFixed(2);
            }

            // ✅ Sync to server using common function
            console.log('📡 Syncing quantity update to server...');
            const syncResult = await updateOrderCacheOnServer();

            if (!syncResult.success) {
                console.error('❌ Failed to sync quantity update:', syncResult.error);
                if (typeof window.sokWebSocket?.showUpdateNotification === 'function') {
                    window.sokWebSocket.showUpdateNotification(
                        'Sync Error',
                        'Failed to sync quantity update to server'
                    );
                }
            } else {
                console.log('✅ Quantity update synced successfully');
            }

        } catch (error) {
            console.error('❌ Error in quantity update:', error);
        } finally {
            // Re-enable WebSocket sync
            setTimeout(() => {
                window._manualOrderUpdate = false;
            }, 100);
        }

        // ✅ Re-render UI
        setTimeout(() => {
            if (typeof renderCartFromOrder === 'function') {
                renderCartFromOrder();
            }
            if (typeof updateCartCount === 'function') {
                updateCartCount();
            }
        }, 50);

    } catch (error) {
        console.error('❌ Error in updateQuantityBySno:', error);
        window._manualOrderUpdate = false;

        // Try to re-render even on error
        if (typeof renderCartFromOrder === 'function') {
            setTimeout(renderCartFromOrder, 100);
        }
    }
}
// Check if an item has legitimate children (modifiers/addons)
function checkForLegitimateChildren(parentItem, allItems) {
    const parentSNo = String(parentItem.s_no);

    // Find potential children
    const potentialChildren = allItems.filter(item =>
        String(item.parent_sno) === parentSNo &&
        String(item.s_no) !== parentSNo
    );

    if (potentialChildren.length === 0) {
        return false;
    }

    // Check if parent has addons or modifiers enabled
    const parentHasAddons = parentItem.is_addon_enable?.toUpperCase() === "Y" &&
        parentItem.add_on_name &&
        parentItem.add_on_name.trim() !== '';

    const parentHasModifiers = Array.isArray(parentItem.itemmaster_menutype_grpdtls) &&
        parentItem.itemmaster_menutype_grpdtls.length > 0;

    // If parent doesn't have addons/modifiers, children are illegitimate
    if (!parentHasAddons && !parentHasModifiers) {
        console.warn(`⚠️ Item ${parentSNo} has children but no addons/modifiers enabled`);
        return false;
    }

    // Check if children are actual modifiers/addons
    const legitimateChildren = potentialChildren.filter(child => {
        // Check if child has modifier_name (indicates it's a modifier)
        const hasModifierName = child.modifier_name && child.modifier_name.trim() !== '';

        // Check if child category differs from parent (modifiers usually have different categories)
        const differentCategory = child.category_code !== parentItem.category_code;

        // Check if child was added as part of addon selection
        const isAddon = child.add_on_name || parentHasAddons;

        // A child is legitimate if it has a modifier_name OR is an addon
        const isLegitimate = hasModifierName || isAddon;

        console.log(`  🔎 Child ${child.s_no} (${child.item_name}):`, {
            hasModifierName,
            modifier_name: child.modifier_name,
            differentCategory,
            isAddon,
            isLegitimate
        });

        return isLegitimate;
    });

    console.log(`🔍 Parent ${parentSNo} analysis:`, {
        potentialChildren: potentialChildren.length,
        legitimateChildren: legitimateChildren.length,
        parentHasAddons,
        parentHasModifiers
    });

    return legitimateChildren.length > 0;
}

// Fallback function if changeItemQuantity is not available
function fallbackUpdateQuantity(sNo, newQty, orderItem, order, hasLegitimateChildren) {
    console.warn('⚠️ Using fallback update method');

    try {
        const { setOrder } = useOrder();
        const currentQty = Number(orderItem.qty) || 0;

        // Determine if this is a parent item with LEGITIMATE children
        const isParentItem = String(orderItem.s_no) === String(orderItem.parent_sno);

        console.log('🔧 Fallback update:', {
            sNo,
            isParent: isParentItem,
            hasLegitimateChildren,
            shouldUpdateChildren: isParentItem && hasLegitimateChildren
        });

        // Update sales details
        const updatedSalesDtls = order.sales_dtls.map(item => {
            const itemSNo = String(item.s_no);
            const itemParentSNo = String(item.parent_sno);
            const targetSNo = String(sNo);

            // Update the target item
            if (itemSNo === targetSNo) {
                const updatedItem = { ...item, qty: newQty };
                updatedItem.sub_total = (Number(updatedItem.unit_price) * newQty).toFixed(2);
                updatedItem.tax_amt = ((Number(updatedItem.sub_total) * Number(updatedItem.tax_rate)) / 100).toFixed(6);

                const svcRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;
                updatedItem.svc_amt = Number(updatedItem.is_apply_svc) === 1
                    ? ((Number(updatedItem.sub_total) * svcRate) / 100).toFixed(6)
                    : "0.000000";

                console.log(`✅ Updated target item ${itemSNo}: qty ${currentQty} → ${newQty}, subtotal: ${updatedItem.sub_total}`);
                return updatedItem;
            }
            // ✅ CRITICAL FIX: Only update children if they are LEGITIMATE
            else if (isParentItem && hasLegitimateChildren && itemParentSNo === targetSNo && itemSNo !== targetSNo) {
                // Double-check this specific child is legitimate
                const childHasModifierName = item.modifier_name && item.modifier_name.trim() !== '';
                const childIsAddon = item.add_on_name && item.add_on_name.trim() !== '';
                const parentHasAddons = orderItem.is_addon_enable?.toUpperCase() === "Y" && orderItem.add_on_name;

                const isLegitimateChild = childHasModifierName || childIsAddon || parentHasAddons;

                if (!isLegitimateChild) {
                    console.warn(`⚠️ Skipping illegitimate child ${itemSNo} (${item.item_name})`);
                    return item; // Don't update
                }

                const baseChildQty = Number(item.qty) / currentQty || 1;
                const childNewQty = baseChildQty * newQty;

                const updatedChild = { ...item, qty: childNewQty };
                updatedChild.sub_total = (Number(updatedChild.unit_price) * childNewQty).toFixed(2);
                updatedChild.tax_amt = ((Number(updatedChild.sub_total) * Number(updatedChild.tax_rate)) / 100).toFixed(6);

                const svcRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;
                updatedChild.svc_amt = Number(updatedChild.is_apply_svc) === 1
                    ? ((Number(updatedChild.sub_total) * svcRate) / 100).toFixed(6)
                    : "0.000000";

                console.log(`✅ Updated legitimate child ${itemSNo}: qty ${item.qty} → ${childNewQty}`);
                return updatedChild;
            }

            // Return all other items unchanged
            return item;
        });

        // Recalculate totals
        const subTotal = updatedSalesDtls.reduce((sum, item) => sum + Number(item.sub_total || 0), 0);
        const totalTax = updatedSalesDtls.reduce((sum, item) => sum + Number(item.tax_amt || 0), 0);
        const totalSvc = updatedSalesDtls.reduce((sum, item) => sum + Number(item.svc_amt || 0), 0);
        const netAmount = subTotal + totalTax + totalSvc - Number(order.total_disc || 0);

        const updatedOrder = {
            ...order,
            sales_dtls: updatedSalesDtls,
            sub_total: subTotal.toFixed(2),
            total_tax: totalTax.toFixed(6),
            total_svc: totalSvc.toFixed(6),
            net_amt: netAmount.toFixed(2)
        };

        setOrder(updatedOrder);
        console.log('✅ Fallback update completed');

    } catch (error) {
        console.error('❌ Fallback update failed:', error);
    }
}

// Usage examples
function handleIncreaseQuantity(sNo) {
    updateQuantityBySno(sNo, 1);
}

function handleDecreaseQuantity(sNo) {
    updateQuantityBySno(sNo, -1);
}

function handleRemoveItem(sNo) {
    // Set quantity to 0 to trigger deletion
    const { order } = useOrder();
    const orderItem = order?.sales_dtls?.find(item => String(item.s_no) === String(sNo));

    if (orderItem && typeof deleteOrderItem === 'function') {
        deleteOrderItem(orderItem);
    } else {
        updateQuantityBySno(sNo, -999);
    }
}

// Export for use in cart rendering
if (typeof window !== 'undefined') {
    window.updateQuantityBySno = updateQuantityBySno;
    window.handleIncreaseQuantity = handleIncreaseQuantity;
    window.handleDecreaseQuantity = handleDecreaseQuantity;
    window.handleRemoveItem = handleRemoveItem;
    window.updateCartCount = updateCartCount;

}


function renderVisibleCategorySections(categories = []) {
    const container = document.getElementById("menuGrid");
    if (!container) return;

    container.innerHTML = '';
    const rendered = new Set();

    function renderCategory(category_code) {
        if (rendered.has(category_code)) return;
        rendered.add(category_code);

        const items = getCategoryItems(category_code);
        if (!items.length) return;

        // 🔴 Skip MAIN completely
        if (category_code === "MAIN") return;

        // Category label
        const label = document.createElement("h2");
        label.className = "text-2xl font-bold text-blue-700 mt-6 mb-3 border-b pb-2";
        label.textContent = category_code; // use actual subcategory code
        container.appendChild(label);

        // Grid layout
        const grid = document.createElement("div");
        grid.className = "menu-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4";

        // ✅ Your item rendering loop here
        items.forEach(item => {
            const id = item.item_no || item.id;
            const emoji = item.emoji || "🍽️";
            const name = item.item_name || item.name || "Unnamed";
            const desc = item.item_desc || item.description || "";
            const price = parseFloat(getPriceByServiceType(item));
            const displayPrice = price > 0
                ? `$${price.toFixed(2)}`
                : `<span class="text-gray-400">Unavailable</span>`;

            const card = document.createElement("div");
            card.className = "menu-item p-4 border rounded shadow";
            card.setAttribute("onclick", `addToCart(${JSON.stringify(item).replace(/'/g, "\\'")})`);

            card.innerHTML = `
                    <div class="item-image text-2xl mb-2">${emoji}</div>
                    <div class="item-info">
                        <h3 class="font-semibold">${name}</h3>
                        <p class="item-description text-sm text-gray-600">${desc}</p>
                        <div class="item-footer flex justify-between items-center mt-2">
                            <span class="item-price font-bold">${displayPrice}</span>
                            <button class="add-btn bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded"
                                onclick="event.stopPropagation(); addToCart('${id}')">
                                Add to Cart
                            </button>
                        </div>
                    </div>
                `;

            grid.appendChild(card);
        });

        container.appendChild(grid);

        // Recursively render subcategories
        const subCategories = getCategories(category_code) || [];
        subCategories.forEach(sub => {
            if (sub?.category_code && sub.category_code !== "MAIN") {
                const isVisible = categories.some(cat =>
                    cat?.category_code === sub.category_code &&
                    cat?.root_category_code === sub.root_category_code
                );
                if (isVisible) {
                    renderCategory(sub.category_code);
                }
            }
        });
    }

    categories.forEach(cat => {
        if (cat?.category_code) {
            renderCategory(cat.category_code);
        }
    });
}



let pendingItem = null;
let selectedAddons = [];
// ✅ Generate key based on item + addon composition
function buildKey(baseItemNo, addons) {
    const addonKeys = (addons || [])
        .map(a => a.item_no)
        .sort()
        .join('|');
    return baseItemNo + '|' + addonKeys;
}
function groupOrderItems(salesDtls) {
    const groups = {};
    salesDtls.forEach(item => {
        const parent = item.parent_sno;
        if (!groups[parent]) groups[parent] = { baseItem: null, addons: [] };
        if (item.s_no === parent) {
            groups[parent].baseItem = item;
        } else {
            groups[parent].addons.push(item);
        }
    });

    // Filter out groups without a base item
    return Object.values(groups).filter(group => group.baseItem != null);
}


let isAddingToCart = false; // Optional safety lock


// Gather all selected addon items from the modal
window.GetHomeAPI = window.GetHomeAPI || {};

let lastSno = 1000;
function generateSno() { return ++lastSno; }

// Gather selected addons from modal
function gatherSelectedAddonsFromModal() {
    const modal = document.getElementById('addonModalContent');
    if (!modal) return [];
    const selectedAddons = [];

    // Handle qty-control items
    modal.querySelectorAll('.qty-control').forEach(ctrl => {
        const qtySpan = ctrl.querySelector('.qty-count');
        const qty = parseInt(qtySpan?.textContent || '0', 10);
        if (qty > 0) {
            const itemId = ctrl.dataset.itemId;
            const category = ctrl.dataset.category || '';

            // Get from data attributes (using camelCase dataset properties)
            const item_name = ctrl.dataset.itemName || '';
            const price = parseFloat(ctrl.dataset.price || '0');

            selectedAddons.push({ item_no: itemId, item_name, qty, price, category });
        }
    });

    // Handle checkbox items
    modal.querySelectorAll('input.addon-checkbox:checked, input[type="checkbox"]:checked').forEach(checkbox => {
        // Skip if already processed as a qty-control item
        if (checkbox.closest('.qty-control')) return;

        const itemId = checkbox.value;
        const category = checkbox.dataset.categoryCode || '';

        // Get from data attributes (using camelCase dataset properties)
        const item_name = checkbox.dataset.itemName || checkbox.dataset.modifierName || '';
        const price = parseFloat(checkbox.dataset.price || '0');

        let qty = 1;
        // Check for associated qty-control
        const parentLabel = checkbox.closest('.addon-label') || checkbox.parentElement;
        const qtyControl = parentLabel?.querySelector('.qty-control');
        if (qtyControl) {
            const qtySpan = qtyControl.querySelector('.qty-count');
            qty = parseInt(qtySpan?.textContent || '1', 10);
        }

        selectedAddons.push({ item_no: itemId, item_name, qty, price, category });
    });

    //console.log('Gathered addons:', selectedAddons);
    return selectedAddons;
}

function gatherSelectedRemarksFromModal() {
    const selectedRemarks = [];

    // Only gather from VISIBLE remark sections
    document.querySelectorAll('.remark-section:not([style*="display: none"]) .addon-checkbox.remark-checkbox:checked').forEach(checkbox => {
        const remarkGroup = checkbox.dataset.remarkGroup;
        const remarkText = checkbox.dataset.remarkText;
        const seqNo = checkbox.value;

        // Find which parent category this remark belongs to
        const remarkSection = checkbox.closest('.remark-section');
        const parentCategory = remarkSection?.dataset.parentCategory;

        selectedRemarks.push({
            remarks_group: remarkGroup,
            remarks: remarkText,
            remarks_item_name: remarkText,
            seq_no: seqNo,
            parent_category: parentCategory
        });
    });

    console.log('📝 Gathered remarks from modal:', selectedRemarks);
    return selectedRemarks;
}

// Helper function to create updateRemarksVisibility - place this BEFORE showAddOnModal
function createUpdateRemarksVisibilityFunction(allPossibleRemarks, itemRemarksCache) {
    return function updateRemarksVisibility() {
        const remarkSections = document.querySelectorAll('.remark-section');

        console.log('🔄 updateRemarksVisibility called');
        console.log('📝 Found remark sections:', remarkSections.length);

        // Collect all selected item numbers with their categories
        const selectedItemsByCategory = new Map();

        // Get selected addon items (checkboxes)
        document.querySelectorAll('.addon-category[data-type="addon"] .addon-checkbox:not(.remark-checkbox):checked').forEach(cb => {
            const itemNo = cb.value;
            const categoryCode = cb.dataset.categoryCode || cb.dataset.modifierName;

            if (itemNo && categoryCode) {
                if (!selectedItemsByCategory.has(categoryCode)) {
                    selectedItemsByCategory.set(categoryCode, new Set());
                }
                selectedItemsByCategory.get(categoryCode).add(itemNo);
                console.log(`➕ Addon selected: ${itemNo} in category ${categoryCode}`);
            }
        });

        // Get selected modifier items (qty > 0)
        document.querySelectorAll('.addon-category[data-type="modifier"] .qty-count').forEach(qtyEl => {
            const qty = parseInt(qtyEl.textContent, 10) || 0;
            if (qty > 0) {
                const qtyControl = qtyEl.closest('.qty-control');
                const itemNo = qtyControl?.closest('[data-item-no]')?.dataset.itemNo;
                const categoryCode = qtyControl?.dataset.category;

                if (itemNo && categoryCode) {
                    if (!selectedItemsByCategory.has(categoryCode)) {
                        selectedItemsByCategory.set(categoryCode, new Set());
                    }
                    selectedItemsByCategory.get(categoryCode).add(itemNo);
                    console.log(`➕ Modifier selected: ${itemNo} in category ${categoryCode} (qty: ${qty})`);
                }
            }
        });

        console.log('🔍 Selected items by category:', Object.fromEntries(selectedItemsByCategory));

        // Determine which remark groups should be visible for each category
        const visibleRemarksByCategory = new Map();

        selectedItemsByCategory.forEach((itemNos, categoryCode) => {
            itemNos.forEach(itemNo => {
                const itemRemarks = itemRemarksCache.find(r =>
                    r.item_no === itemNo ||
                    String(r.item_no) === String(itemNo) ||
                    String(r.item_no).trim() === String(itemNo).trim()
                );

                if (itemRemarks?.remarks_item_details) {
                    console.log(`✅ Found remarks for ${itemNo}:`, itemRemarks.remarks_item_details);

                    itemRemarks.remarks_item_details.forEach(remarkGroup => {
                        if (remarkGroup.remarks_group) {
                            if (!visibleRemarksByCategory.has(categoryCode)) {
                                visibleRemarksByCategory.set(categoryCode, new Set());
                            }
                            visibleRemarksByCategory.get(categoryCode).add(remarkGroup.remarks_group);
                            console.log(`🎯 Will show remark group "${remarkGroup.remarks_group}" for category ${categoryCode}`);
                        }
                    });
                } else {
                    console.log(`⚠️ No remarks found for: ${itemNo}`);
                }
            });
        });

        console.log('👁️ Visible remarks by category:', Object.fromEntries(visibleRemarksByCategory));

        // Show/hide remark sections
        let shownCount = 0;
        remarkSections.forEach(section => {
            const remarkGroup = section.dataset.remarkGroup;
            const parentCategory = section.dataset.parentCategory;

            const shouldBeVisible = visibleRemarksByCategory.has(parentCategory) &&
                visibleRemarksByCategory.get(parentCategory).has(remarkGroup);

            const isCurrentlyVisible = section.style.display !== 'none';

            if (shouldBeVisible) {
                section.style.display = 'block';
                shownCount++;
                console.log(`✅ SHOWING: "${remarkGroup}" for category "${parentCategory}"`);
            } else {
                if (isCurrentlyVisible) {
                    console.log(`❌ HIDING and clearing: "${remarkGroup}"`);
                    section.querySelectorAll('.addon-checkbox').forEach(cb => {
                        cb.checked = false;
                        cb.closest('.addon-label')?.classList.remove('selected');
                    });
                }
                section.style.display = 'none';
            }
        });

        console.log(`📊 Total remark sections shown: ${shownCount}/${remarkSections.length}`);

        if (typeof validateAddToCart === 'function') {
            validateAddToCart();
        }
    };
}

//function addToCart(itemId, selectedAddons = [], selectedRemarks = []) {
//    console.log('addToCart called:', itemId, selectedAddons.length, selectedRemarks.length);

//    if (isAddingToCart) {
//        console.warn('addToCart blocked: already in progress');
//        return;
//    }
//    isAddingToCart = true;
//    setTimeout(() => { isAddingToCart = false }, 500);

//    const cache = useCache() || {};
//    const { order, setOrder } = useOrder();
//    const items = cache.items || [];
//    const allItemRemarks = cache.itemRemarks || [];

//    const item = items.find(i => i.item_no === itemId || i.id === itemId);
//    if (!item) {
//        console.warn("Item not found:", itemId);
//        return;
//    }

//    const remarksEntry = allItemRemarks.find(r => r.item_no === item.item_no);
//    const hasAddons = item.is_addon_enable?.toUpperCase() === "Y";
//    const hasRemarks = Array.isArray(remarksEntry?.remarks_item_details) && remarksEntry.remarks_item_details.length > 0;

//    // Show modal if addons/remarks required
//    if ((hasAddons && selectedAddons.length === 0) || (hasRemarks && selectedRemarks.length === 0)) {
//        const addonData = hasAddons ? getAddonsByAddOnName(item.add_on_name) : { cat_dtls: [], item_dtls: [] };
//        const enrichedCatDtls = (addonData.cat_dtls || []).map(grp => ({
//            ...grp,
//            item_dtls: getAvailableAddonItems(addonData, grp)
//        }));
//        showAddOnModal(item, (chosenAddons, chosenRemarks) => {
//            addToCart(itemId, chosenAddons, chosenRemarks);
//        }, { ...addonData, cat_dtls: enrichedCatDtls }, remarksEntry ? remarksEntry.remarks_item_details : []);
//        return;
//    }

//    // Build menuItem object
//    const menuItem = {
//        ...item,
//        line_id: item.line_id || `${item.item_no}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
//        remarks: selectedRemarks.map(r => r.remarks_item_name || r.remarks || r).join(', '),
//        selectedRemarks,
//        selectedAddons
//    };

//    // Determine which function to call
//    let updatedItems;
//    if (hasAddons || selectedAddons.length > 0) {
//        updatedItems = addItemHaveModifierOrAddon([menuItem]);
//    } else {
//        console.log("Alacart Item", menuItem);
//        updatedItems = addAlacarteItem(menuItem);
//    }

//    const addedSalesDtls = updatedItems?.orderItems?.sales_dtls || updatedItems?.sales_dtls || [];
//    // Merge with existing order (instead of replacing!)
//    const mergedSalesDtls = [
//        ...(order?.sales_dtls || []),
//        ...addedSalesDtls
//    ];

//    const updatedOrder = {
//        ...order,
//        sales_dtls: mergedSalesDtls,
//        orderItems: {
//            orderItems: {
//                sales_dtls: mergedSalesDtls
//            }
//        }
//    };

//    // Update Zustand store
//    setOrder(updatedOrder);
//    renderCartFromOrder();

//    console.log(`✅ Added item ${itemId} to cart. Addons: ${selectedAddons.length}, Remarks: ${selectedRemarks.length}`);
//    console.log('🛒 Current order.sales_dtls length:', mergedSalesDtls.length);
//}

function getItemPrice(item) {
    if (!item) return 0;

    // Try top-level prices first (dine_in_price, takeaway_price, unit_price)
    const topLevelPrice = parseFloat(item.dine_in_price || item.takeaway_price || item.unit_price || 0);

    if (topLevelPrice > 0) {
        console.log(`✅ Using top-level price for ${item.item_name || item.item_no}: $${topLevelPrice}`);
        return topLevelPrice;
    }

    // If top-level prices are 0 or undefined, check selling_uom_dtls
    const sellingPrice = item.selling_uom_dtls?.[0]?.price_dtls?.[0]?.dine_in_price
        || item.selling_uom_dtls?.[0]?.price_dtls?.[0]?.takeaway_price;

    if (sellingPrice && sellingPrice > 0) {
        console.log(`✅ Using selling_uom_dtls price for ${item.item_name || item.item_no}: $${sellingPrice}`);
        return parseFloat(sellingPrice);
    }

    // Final fallback to 0
    console.warn(`⚠️ No valid price found for ${item.item_name || item.item_no}, using 0`);
    return 0;
}


function addToCart(itemId, selectedAddons = [], selectedRemarks = [], editingOrderItemSNo = null, fromModal = false) {
    console.log('addToCart called:', itemId, selectedAddons.length, selectedRemarks.length, 'editing:', editingOrderItemSNo);
    console.log('🔍 selectedRemarks received:', selectedRemarks);

    // Prevent duplicate calls
    const callId = `${itemId}_${selectedAddons.length}_${Date.now()}`;
    if (window.lastAddToCartCall === callId) return;
    window.lastAddToCartCall = callId;

    if (window.isAddingToCart) return;
    window.isAddingToCart = true;
    setTimeout(() => { window.isAddingToCart = false; }, 500);

    const cache = useCache() || {};
    const { order, setOrder, lastSNo, setLastSNo } = useOrder();
    const items = cache.items || [];
    const allItemRemarks = cache.itemRemarks || [];

    // ✅ Local takeaway flag check
    const orderType = localStorage.getItem("orderType");
    const isTakeawayLocal = orderType === "T" ? "Y" : "N";
    const isTakeawayBoolean = orderType === "T";
    const item = items.find(i => i.item_no === itemId || i.id === itemId);
    if (!item) return console.warn("Item not found:", itemId);

    const remarksEntry = allItemRemarks.find(r => r.item_no === item.item_no);
    const hasAddons = item.is_addon_enable?.toUpperCase() === "Y";
    const hasRemarks = Array.isArray(remarksEntry?.remarks_item_details) && remarksEntry.remarks_item_details.length > 0;
    const hasModifierGroups = Array.isArray(item.itemmaster_menutype_grpdtls) && item.itemmaster_menutype_grpdtls.length > 0;

    // --- Show modal if needed ---
    let showModal = false;
    if (!fromModal && !editingOrderItemSNo) {
        if ((hasAddons && selectedAddons.length === 0) ||
            (hasRemarks && selectedRemarks.length === 0) ||
            (hasModifierGroups && selectedAddons.length === 0)) {
            showModal = true;
        }
    }

    if (showModal) {
        const addonData = hasAddons ? getAddonsByAddOnName(item.add_on_name) : { cat_dtls: [], item_dtls: [] };
        const enrichedCatDtls = (addonData.cat_dtls || []).map(grp => {
            if (!grp.category_code) {
                const matchedItem = addonData.item_dtls.find(i => i.modifier_name === grp.modifier_name && i.category_code);
                if (matchedItem) grp.category_code = matchedItem.category_code;
            }
            grp.item_dtls = getAvailableAddonItems(addonData, grp);
            return grp;
        });

        showAddOnModal(item, (chosenAddons, chosenRemarks) => {
            console.log('🔍 Modal callback - chosenRemarks:', chosenRemarks);
            addToCart(itemId, chosenAddons || [], chosenRemarks || [], editingOrderItemSNo, true);
        }, { ...addonData, cat_dtls: enrichedCatDtls }, remarksEntry ? remarksEntry.remarks_item_details : []);

        return;
    }

    // Clear modal state after using it
    if (fromModal) {
        window.selectedAddons = [];
        window.currentBaseItemId = null;
        window.tempAddonCache = [];
    }

    // CRITICAL FIX: Get the maximum s_no from existing order to prevent duplicates
    const existingMaxSNo = order?.sales_dtls?.length > 0
        ? Math.max(...order.sales_dtls.map(i => parseInt(i.s_no) || 0))
        : 0;
    let newLastSNo = Math.max(
        order?.lastSNo || 0,
        order?.sales_dtls?.length > 0
            ? Math.max(...order.sales_dtls.map(i => parseInt(i.s_no) || 0))
            : 0
    );
    console.log('Starting s_no tracking - lastSNo:', lastSNo, 'existingMax:', existingMaxSNo, 'using:', newLastSNo);

    const resultItems = [];

    // **EDIT MODE HANDLING**
    if (editingOrderItemSNo) {
        console.log('EDIT MODE - Editing item s_no:', editingOrderItemSNo);

        const originalItem = order.sales_dtls.find(i => i.s_no == editingOrderItemSNo);
        if (!originalItem) {
            console.error('Original item not found for s_no:', editingOrderItemSNo);
            return;
        }

        const parentSNo = editingOrderItemSNo;

        // ✅ FIX: Create remark mapping by category AND parent_category for EDIT mode
        const remarksByCategory = {};
        const remarksByParentCategory = {};

        selectedRemarks.forEach(r => {
            const group = r.remarks_group || '';
            const parentCat = r.parent_category || '';

            if (!remarksByCategory[group]) {
                remarksByCategory[group] = [];
            }
            remarksByCategory[group].push(r);

            if (parentCat) {
                if (!remarksByParentCategory[parentCat]) {
                    remarksByParentCategory[parentCat] = [];
                }
                remarksByParentCategory[parentCat].push(r);
            }
        });

        console.log('🔍 EDIT MODE - remarksByCategory:', remarksByCategory);
        console.log('🔍 EDIT MODE - remarksByParentCategory:', remarksByParentCategory);

        const parentPrice = hasModifierGroups ? 0 : getItemPrice(item);
        const parentSubTotal = hasModifierGroups ? 0 : parentPrice * 1;

        const parentRemarks = selectedAddons.length === 0
            ? selectedRemarks
                .map(r => r.remarks_item_name || r.remarks || r.remarkText || r)
                .filter(text => text && typeof text === 'string')
                .join(', ')
            : "";

        console.log('🔍 EDIT MODE - Parent item remarks:', parentRemarks);

        const updatedParentItem = {
            ...originalItem,
            remarks: parentRemarks,
            unit_price: parentPrice,
            sub_total: parentSubTotal,
            order_datetime: originalItem.order_datetime,
        };

        resultItems.push(updatedParentItem);

        selectedAddons.forEach(addon => {
            const itemNo = addon.item_no || addon.citem_no;
            const fullAddonItem = items.find(i => i.item_no === itemNo);
            if (!fullAddonItem) return;

            const childSNo = ++newLastSNo;
            const addonQty = addon.qty || 1;
            const addonPrice = addon.price !== undefined
                ? parseFloat(addon.price)
                : getItemPrice(fullAddonItem);
            const addonSubTotal = addonQty * addonPrice;
            const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

            const addonCategory = addon.modifier_name || addon.category || fullAddonItem.category_code;
            let addonRemarks = addon.remarks || "";

            console.log(`🔍 EDIT - Processing addon: ${fullAddonItem.item_name}, category: ${addonCategory}`);

            if (remarksByParentCategory[addonCategory]) {
                addonRemarks = remarksByParentCategory[addonCategory]
                    .map(r => r.remarks_item_name || r.remarks || r.remarkText || r)
                    .filter(text => text && typeof text === 'string')
                    .join(', ');
                console.log(`🎯 EDIT - Matched "${addonCategory}" by parent_category to addon ${fullAddonItem.item_name}: "${addonRemarks}"`);
            } else {
                for (const [remarkGroup, remarks] of Object.entries(remarksByCategory)) {
                    const remarkGroupLower = remarkGroup.toLowerCase();
                    const addonCategoryLower = addonCategory.toLowerCase();

                    if (remarkGroupLower.includes(addonCategoryLower) ||
                        addonCategoryLower.includes(remarkGroupLower.split(' ')[0])) {
                        addonRemarks = remarks
                            .map(r => r.remarks_item_name || r.remarks || r.remarkText || r)
                            .filter(text => text && typeof text === 'string')
                            .join(', ');
                        console.log(`🎯 EDIT - Matched "${remarkGroup}" by name to addon ${fullAddonItem.item_name}: "${addonRemarks}"`);
                        break;
                    }
                }
            }

            if (!addonRemarks) {
                console.log(`⚠️ EDIT - NO remarks matched for addon ${fullAddonItem.item_name} (${addonCategory})`);
            }

            resultItems.push({
                s_no: childSNo,
                parent_sno: parentSNo,
                ds_no: originalItem.ds_no || 1,
                seat_no: originalItem.seat_no || 1,
                category_code: fullAddonItem.category_code || addon.category_code || addon.category,
                item_no: fullAddonItem.item_no,
                item_name: fullAddonItem.item_name,
                item_desc: fullAddonItem.item_desc || fullAddonItem.item_name,
                remarks: addonRemarks,
                qty: addonQty,
                uom: fullAddonItem.uom || "",
                uom_cf: fullAddonItem.uom_cf || 1,
                unit_price: addonPrice,
                disc_type: fullAddonItem.disc_type || "",
                disc_name: fullAddonItem.disc_name || "",
                disc_value: fullAddonItem.disc_value || 0,
                disc_amt: fullAddonItem.disc_amt || 0,
                sub_total: addonSubTotal,
                pro_disc_amt: fullAddonItem.pro_disc_amt || 0,
                svc_amt: "0.000000",
                is_apply_svc: 1,
                tax_amt: "0.000000",
                tax_rate: fullAddonItem.tax_rate || 9,
                tax_value: fullAddonItem.tax_value || 9,
                is_absorbtax: 0,
                take_away_item: isTakeawayLocal,
                order_seq: originalItem.order_seq || 1,
                order_seq_type: originalItem.order_seq_type,
                order_datetime: currentDateTime,
                print_flag: "N",
                item_kds_ready_status: "N",
                item_kds_ready_datetime: currentDateTime,
                item_kds_serve_status: "N",
                item_kds_serve_datetime: currentDateTime,
                override_f: 0,
                is_addon_enable: fullAddonItem.is_addon_enable || "",
                add_on_name: fullAddonItem.add_on_name || "",
                menu_type: fullAddonItem.menu_type || "",
                modifier_name: addon.modifier_name || addon.category || fullAddonItem.modifier_name || "",
                ref_1: "", ref_2: "", ref_3: "", ref_4: ""
            });
        });
    }
    else {
        // **NEW ITEM MODE**
        const hasProperStructure = selectedAddons.length > 0 &&
            selectedAddons[0].s_no &&
            selectedAddons[0].parent_sno;

        if (hasProperStructure) {
            const remarksByCategory = {};
            selectedRemarks.forEach(r => {
                const group = r.remarks_group || '';
                if (!remarksByCategory[group]) {
                    remarksByCategory[group] = [];
                }
                remarksByCategory[group].push(r.remarks_item_name || r.remarks || r.remarkText || r);
            });

            resultItems.push(...selectedAddons.map(addon => {
                const isParent = addon.s_no === addon.parent_sno;
                const newSNo = ++newLastSNo;

                let remarksForItem = "";

                if (!isParent) {
                    const addonCategory = addon.modifier_name || addon.category_code;

                    const matchingRemarks = selectedRemarks.filter(r => {
                        if (r.parent_category && r.parent_category === addonCategory) {
                            return true;
                        }

                        const remarkGroup = (r.remarks_group || '').toLowerCase();
                        const categoryLower = (addonCategory || '').toLowerCase();

                        return remarkGroup.includes(categoryLower) ||
                            categoryLower.includes(remarkGroup.split(' ')[0]);
                    });

                    if (matchingRemarks.length > 0) {
                        remarksForItem = matchingRemarks
                            .map(r => r.remarks_item_name || r.remarks || r.remarkText || r)
                            .filter(text => text && typeof text === 'string')
                            .join(', ');
                    }
                } else {
                    remarksForItem = "";
                }

                return {
                    ...addon,
                    s_no: newSNo,
                    parent_sno: isParent ? newSNo : (addon.parent_sno + (newSNo - addon.s_no)),
                    remarks: remarksForItem,
                    take_away_item: isTakeawayLocal
                };
            }));

        } else if (selectedAddons.length > 0) {
            const parentSNo = ++newLastSNo;
            const itemPrice = hasModifierGroups ? 0 : getItemPrice(item);

            console.log('🔍 NEW ITEM MODE - selectedRemarks received:', selectedRemarks);

            const parentItem = createSalesDtlsRecord(
                {
                    ...item,
                    qty: 1,
                    price: itemPrice,
                    remarks: ""
                },
                parentSNo,
                parentSNo,
                itemPrice
            );

            parentItem.take_away_item = isTakeawayLocal;
            resultItems.push(parentItem);

            selectedAddons.forEach(addon => {
                const itemNo = addon.item_no || addon.citem_no;
                const fullAddonItem = items.find(i => i.item_no === itemNo);
                if (!fullAddonItem) return;

                const childSNo = ++newLastSNo;
                const addonQty = addon.qty || 1;
                const addonPrice = addon.price !== undefined
                    ? parseFloat(addon.price)
                    : getItemPrice(fullAddonItem);
                const addonSubTotal = addonQty * addonPrice;

                const addonCategory = addon.modifier_name || addon.category || fullAddonItem.category_code;
                let addonRemarks = addon.remarks || "";

                console.log(`🔍 Processing addon: ${fullAddonItem.item_name}, category: ${addonCategory}`);
                console.log(`🔍 Looking for remarks with parent_category="${addonCategory}"`);

                const matchingRemarks = selectedRemarks.filter(r => {
                    console.log(`  🔎 Checking remark:`, {
                        remarks_group: r.remarks_group,
                        parent_category: r.parent_category,
                        remarks: r.remarks_item_name || r.remarks
                    });

                    if (r.parent_category && r.parent_category === addonCategory) {
                        console.log(`    ✅ MATCHED by parent_category!`);
                        return true;
                    }

                    const remarkGroup = (r.remarks_group || '').toLowerCase();
                    const categoryLower = (addonCategory || '').toLowerCase();

                    const matches = remarkGroup.includes(categoryLower) ||
                        categoryLower.includes(remarkGroup.split(' ')[0]);

                    if (matches) {
                        console.log(`    ✅ MATCHED by name matching!`);
                    }

                    return matches;
                });

                console.log(`🔍 Found ${matchingRemarks.length} matching remarks`);

                if (matchingRemarks.length > 0) {
                    addonRemarks = matchingRemarks
                        .map(r => r.remarks_item_name || r.remarks || r.remarkText || r)
                        .filter(text => text && typeof text === 'string')
                        .join(', ');
                    console.log(`🎯 Matched remarks to addon ${fullAddonItem.item_name} (${addonCategory}):`, addonRemarks);
                } else {
                    console.log(`⚠️ NO remarks matched for addon ${fullAddonItem.item_name} (${addonCategory})`);
                }

                console.log(`🔍 Final addon remarks:`, addonRemarks);

                const addonItem = createSalesDtlsRecord(
                    {
                        ...fullAddonItem,
                        qty: addonQty,
                        price: addonPrice,
                        remarks: addonRemarks,
                        modifier_name: addon.modifier_name || addon.category || fullAddonItem.modifier_name || ""
                    },
                    childSNo,
                    parentSNo,
                    addonSubTotal
                );

                addonItem.take_away_item = isTakeawayLocal;
                resultItems.push(addonItem);
            });

        } else {
            const itemSNo = ++newLastSNo;
            const itemPrice = getItemPrice(item);

            const remarksText = selectedRemarks
                .map(r => r.remarks_item_name || r.remarks || r.remarkText || r)
                .filter(text => text && typeof text === 'string')
                .join(', ');

            console.log('🔍 STANDALONE ITEM - remarks:', remarksText);

            const standaloneItem = createSalesDtlsRecord(
                {
                    ...item,
                    qty: 1,
                    price: itemPrice,
                    remarks: remarksText
                },
                itemSNo,
                itemSNo,
                itemPrice
            );

            standaloneItem.take_away_item = isTakeawayLocal;
            resultItems.push(standaloneItem);
        }
    }

    console.log('Final resultItems:', resultItems.length, 'Final newLastSNo:', newLastSNo);
    console.log('🔍 resultItems with remarks BEFORE svc adjustment:',
        resultItems.filter(i => i.remarks).map(i => ({ s_no: i.s_no, item_name: i.item_name, remarks: i.remarks }))
    );

    const resultItemsWithSvc = isTakeawayBoolean
        ? resultItems.map(it => ({ ...it, is_apply_svc: 0, svc_amt: "0.000000" }))
        : resultItems;

    console.log('🔍 resultItemsWithSvc with remarks AFTER svc adjustment:',
        resultItemsWithSvc.filter(i => i.remarks).map(i => ({ s_no: i.s_no, item_name: i.item_name, remarks: i.remarks }))
    );

    let updatedOrderItems;
    const isTakeaway = isTakeawayLocal === "Y";
    console.log("isTakeaway", isTakeaway);

    if (editingOrderItemSNo) {
        const existingSales = order.sales_dtls.filter(i =>
            i.s_no != editingOrderItemSNo && i.parent_sno != editingOrderItemSNo
        );
        updatedOrderItems = {
            orderItems: {
                ...order,
                sales_dtls: [...existingSales, ...resultItemsWithSvc]
            }
        };

        console.log('🔍 EDIT MODE - Final updatedOrderItems with remarks:',
            updatedOrderItems.orderItems.sales_dtls.filter(i => i.remarks).map(i => ({ s_no: i.s_no, item_name: i.item_name, remarks: i.remarks }))
        );

    } else if (hasModifierGroups || hasAddons) {
        console.log('🔍 BEFORE addItemHaveModifierOrAddon - items with remarks:',
            resultItemsWithSvc.filter(i => i.remarks).map(i => ({ s_no: i.s_no, item_name: i.item_name, remarks: i.remarks }))
        );

        const beforeAddonItems = structuredClone(resultItemsWithSvc);
        const addonResponse = addItemHaveModifierOrAddon(beforeAddonItems, null);
        const afterAddonItems = addonResponse?.orderItems?.sales_dtls || [];

        const mergedItems = afterAddonItems.length < beforeAddonItems.length
            ? [...afterAddonItems, ...beforeAddonItems.filter(b => !afterAddonItems.some(a => a.item_no === b.item_no && a.parent_sno === b.parent_sno))]
            : afterAddonItems;

        mergedItems.forEach(i => {
            const originalItem = beforeAddonItems.find(b => b.s_no === i.s_no);
            if (originalItem && originalItem.remarks && originalItem.remarks.trim()) {
                if (!i.remarks || i.remarks.trim() === "") {
                    i.remarks = originalItem.remarks;
                    console.log(`💬 Restored remark for s_no ${i.s_no} (${i.item_name}): "${i.remarks}"`);
                }
            }
        });

        updatedOrderItems = {
            orderItems: {
                ...addonResponse.orderItems,
                sales_dtls: mergedItems
            }
        };

        console.log('🔍 AFTER addItemHaveModifierOrAddon (remarks restored):',
            mergedItems.filter(i => i.remarks).map(i => ({ s_no: i.s_no, item_name: i.item_name, remarks: i.remarks, parent_sno: i.parent_sno }))
        );
    } else {
        updatedOrderItems = addAlacarteItem(resultItemsWithSvc[0]);
        console.log('🔍 AFTER addAlacarteItem - items with remarks:',
            updatedOrderItems?.orderItems?.sales_dtls?.filter(i => i.remarks).map(i => ({ s_no: i.s_no, item_name: i.item_name, remarks: i.remarks }))
        );
    }

    if (updatedOrderItems?.orderItems) {
        const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
        const serviceRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;

        const updatedSales = updatedOrderItems.orderItems.sales_dtls.map(item => {
            const subTotal = parseFloat(item.sub_total || 0);
            const finalTaxRate = parseFloat(item.tax_rate || item.tax_value || gstRate || 0);
            const isApplySvc = isTakeaway ? 0 : parseFloat(item.is_apply_svc || 0);
            const serviceAmt = (isApplySvc === 1 && !isNaN(subTotal) && !isNaN(serviceRate))
                ? (serviceRate * subTotal / 100)
                : 0;

            return {
                ...item,
                is_apply_svc: isApplySvc,
                tax_rate: finalTaxRate,
                tax_value: finalTaxRate,
                tax_amt: (subTotal * finalTaxRate / 100).toFixed(6),
                svc_amt: serviceAmt.toFixed(6)
            };
        });

        const subTotal = updatedSales.reduce((sum, i) => sum + parseFloat(i.sub_total || 0), 0);
        const totalTax = updatedSales.reduce((sum, i) => sum + parseFloat(i.tax_amt || 0), 0);
        const totalService = updatedSales.reduce((sum, i) => sum + parseFloat(i.svc_amt || 0), 0);
        const netAmount = subTotal + totalTax + totalService;

        const finalOrder = {
            ...order,
            ...updatedOrderItems.orderItems,
            sales_dtls: updatedSales,
            sub_total: subTotal.toFixed(2),
            total_disc: updatedOrderItems.orderItems.total_disc || "0.00",
            total_svc: totalService.toFixed(2),
            total_tax: totalTax.toFixed(2),
            round_adj_amt: updatedOrderItems.orderItems.round_adj_amt || "0.00",
            net_amt: netAmount.toFixed(2),
            lastSNo: newLastSNo
        };

        console.log('🔍 FINAL ORDER - items with remarks:',
            finalOrder.sales_dtls.filter(i => i.remarks).map(i => ({ s_no: i.s_no, item_name: i.item_name, remarks: i.remarks, parent_sno: i.parent_sno }))
        );

        setOrder(finalOrder);
        setLastSNo(newLastSNo);

        // 🆕 UPDATE CACHE ON SERVER
        updateOrderCacheOnServer(finalOrder);

        setTimeout(() => {
            renderCartFromOrder();
            updateCartCount();
        }, 10);
    }

    console.log(`UseOrder:`, useOrder());
    console.log(`Item ${editingOrderItemSNo ? "Updated" : "Added"}:`, itemId, 'Total items:', resultItems.length);
    setTimeout(() => delete window.lastAddToCartCall, 1000);
}

async function updateOrderCacheOnServer() {
    try {
        const { order } = useOrder();
        const deviceId = localStorage.getItem("sok_device_id");
        const sok_location = localStorage.getItem("sok_location") || localStorage.getItem("storename");
        const orderType = localStorage.getItem("orderType") || "takeaway";

        console.log('📤 Updating order cache on server for device:', deviceId);
        console.log('📋 Order data:', order);

        // Validate required data
        if (!deviceId) {
            console.error('❌ No device ID found');
            return { success: false, error: 'Device ID is required' };
        }
        if (!order) {
            console.error('❌ No order data found');
            return { success: false, error: 'Order data is required' };
        }

        // ✅ Sanitize the order data
        const sanitizedOrder = {
            items: order.items || [],
            subtotal: order.subtotal || 0,
            tax: order.tax || 0,
            total: order.total || 0,
            ...order
        };

        const payload = {
            orderType: orderType,
            tableNo: "",
            deviceId: deviceId,
            timestamp: new Date().toISOString(),
            orderData: sanitizedOrder,
            Location: sok_location
        };

        console.log('📦 Payload being sent:', JSON.stringify(payload, null, 2));

        const response = await fetch('/API/SOKOrder/set-order-type', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();

        // Handle errors
        if (!response.ok) {
            console.error('❌ Server error:', response.status, responseText);
            try {
                const errorJson = JSON.parse(responseText);
                console.error('❌ Validation errors:', errorJson.errors);
                return {
                    success: false,
                    error: errorJson.errors || errorJson.error || errorJson.message || `Server error: ${response.status}`,
                    validationErrors: errorJson.errors
                };
            } catch {
                return {
                    success: false,
                    error: `Server error: ${response.status} - ${responseText}`
                };
            }
        }

        // Parse successful response
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            console.error('❌ Failed to parse response:', e);
            return {
                success: false,
                error: 'Invalid JSON response from server'
            };
        }

        console.log('✅ Order cache updated successfully:', result);
        if (result.broadcasted) {
            console.log('📡 Cache update broadcasted to all clients via WebSocket');
        }

        return result;
    } catch (error) {
        console.error('❌ Error updating order cache:', error);
        return {
            success: false,
            error: error.message || 'Unknown error occurred'
        };
    }
}


// ✅ Helper function to debounce order updates
let updateTimeout;
export function debouncedUpdateOrderCache(delayMs = 500) {
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => {
        updateOrderCacheOnServer();
    }, delayMs);
}

// ✅ Function to check if cache exists
async function checkOrderCacheExists(deviceId, orderType) {
    try {
        const response = await fetch(`/API/SOKOrder/order-cache/sok/${deviceId}?orderType=${orderType}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 404) {
            return { exists: false, cache: null };
        }

        if (!response.ok) {
            console.error('Error checking cache:', response.status);
            return { exists: false, cache: null, error: response.status };
        }

        const cache = await response.json();
        return { exists: true, cache };

    } catch (error) {
        console.error('Error checking cache:', error);
        return { exists: false, cache: null, error: error.message };
    }
}

function mergeOrderState(wsState) {
    if (!wsState?.state?.order) return;

    const { order: currentOrder, setOrder, lastSNo, setLastSNo } = useOrder();
    if (!currentOrder) return;

    const incomingOrder = wsState.state.order;

    // Merge sales_dtls
    const existingSales = currentOrder.sales_dtls || [];
    const incomingSales = incomingOrder.sales_dtls || [];

    const salesMap = new Map(existingSales.map(i => [i.s_no, i]));
    const mergedSales = [...existingSales];

    incomingSales.forEach(wsItem => {
        const existingItem = salesMap.get(wsItem.s_no);
        if (existingItem) {
            // Merge: preserve hierarchy and remarks, update qty/subtotals from ws
            mergedSales[mergedSales.findIndex(i => i.s_no === wsItem.s_no)] = {
                ...existingItem,
                ...wsItem,
                remarks: wsItem.remarks || existingItem.remarks,
                sub_total: wsItem.sub_total ?? existingItem.sub_total,
                tax_amt: wsItem.tax_amt ?? existingItem.tax_amt,
                svc_amt: wsItem.svc_amt ?? existingItem.svc_amt,
                unit_price: wsItem.unit_price ?? existingItem.unit_price,
                parent_sno: wsItem.parent_sno ?? existingItem.parent_sno
            };
        } else {
            // New item, append
            mergedSales.push(wsItem);
        }
    });

    // Update lastSNo
    const maxSNo = Math.max(
        lastSNo || 0,
        ...mergedSales.map(i => parseInt(i.s_no) || 0)
    );

    // Update totals using incoming values if present, otherwise recalc from mergedSales
    const finalOrder = {
        ...currentOrder,
        ...incomingOrder, // copy top-level fields like net_amt, total_tax
        sales_dtls: mergedSales,
        lastSNo: maxSNo,
        sub_total: incomingOrder.sub_total ?? mergedSales.reduce((sum, i) => sum + parseFloat(i.sub_total || 0), 0).toFixed(2),
        total_tax: incomingOrder.total_tax ?? mergedSales.reduce((sum, i) => sum + parseFloat(i.tax_amt || 0), 0).toFixed(2),
        total_svc: incomingOrder.total_svc ?? mergedSales.reduce((sum, i) => sum + parseFloat(i.svc_amt || 0), 0).toFixed(2),
        net_amt: incomingOrder.net_amt ?? mergedSales.reduce((sum, i) => sum + parseFloat(i.sub_total || 0) + parseFloat(i.tax_amt || 0) + parseFloat(i.svc_amt || 0), 0).toFixed(2)
    };

    setOrder(finalOrder);
    setLastSNo(maxSNo);

    setTimeout(() => {
        renderCartFromOrder();
        updateCartCount();
    }, 10);

    console.log('✅ Merged WS order into current order. Total items:', mergedSales.length);
}



//function addToCart(itemId, selectedAddons = [], selectedRemarks = [], editingOrderItemSNo = null, fromModal = false) {
//    console.log('🚀 addToCart called:', itemId, selectedAddons.length, selectedRemarks.length);

//    // Prevent duplicate calls
//    const callId = `${itemId}_${selectedAddons.length}_${Date.now()}`;
//    if (window.lastAddToCartCall === callId) return;
//    window.lastAddToCartCall = callId;

//    if (window.isAddingToCart) return;
//    window.isAddingToCart = true;
//    setTimeout(() => { window.isAddingToCart = false; }, 500);

//    const cache = useCache() || {};
//    const { order, setOrder, lastSNo, setLastSNo } = useOrder();
//    const items = cache.items || [];
//    const allItemRemarks = cache.itemRemarks || [];

//    const item = items.find(i => i.item_no === itemId || i.id === itemId);
//    if (!item) return console.warn("Item not found:", itemId);

//    const remarksEntry = allItemRemarks.find(r => r.item_no === item.item_no);
//    const hasAddons = item.is_addon_enable?.toUpperCase() === "Y";
//    const hasRemarks = Array.isArray(remarksEntry?.remarks_item_details) && remarksEntry.remarks_item_details.length > 0;
//    const hasModifierGroups = Array.isArray(item.itemmaster_menutype_grpdtls) && item.itemmaster_menutype_grpdtls.length > 0;

//    // --- Show modal if needed ---
//    let showModal = false;
//    if (!fromModal) {
//        if ((hasAddons && selectedAddons.length === 0) ||
//            (hasRemarks && selectedRemarks.length === 0) ||
//            (hasModifierGroups && selectedAddons.length === 0)) {
//            showModal = true;
//        }
//    }

//    if (showModal) {
//        const addonData = hasAddons ? getAddonsByAddOnName(item.add_on_name) : { cat_dtls: [], item_dtls: [] };
//        const enrichedCatDtls = (addonData.cat_dtls || []).map(grp => {
//            if (!grp.category_code) {
//                const matchedItem = addonData.item_dtls.find(i => i.modifier_name === grp.modifier_name && i.category_code);
//                if (matchedItem) grp.category_code = matchedItem.category_code;
//            }
//            grp.item_dtls = getAvailableAddonItems(addonData, grp);
//            return grp;
//        });

//        showAddOnModal(item, (chosenAddons, chosenRemarks) => {
//            addToCart(itemId, chosenAddons || [], chosenRemarks || [], editingOrderItemSNo, true);
//        }, { ...addonData, cat_dtls: enrichedCatDtls }, remarksEntry ? remarksEntry.remarks_item_details : []);

//        return;
//    }

//    // Clear modal state after using it
//    if (fromModal) {
//        window.selectedAddons = [];
//        window.currentBaseItemId = null;
//        window.tempAddonCache = [];
//    }

//    // Get fresh lastSNo from store
//    let newLastSNo = lastSNo || 0;
//    const resultItems = [];

//    // Check if selectedAddons already has proper structure from modal (with s_no and parent_sno)
//    const hasProperStructure = selectedAddons.length > 0 &&
//        selectedAddons[0].s_no &&
//        selectedAddons[0].parent_sno;

//    if (hasProperStructure) {
//        // Items are already properly numbered from modal - just use them directly
//        // But update remarks on parent items
//        resultItems.push(...selectedAddons.map(addon => {
//            const isParent = addon.s_no === addon.parent_sno;
//            return {
//                ...addon,
//                remarks: isParent ? selectedRemarks.map(r => r.remarks_item_name || r.remarks || r).join(', ') : addon.remarks
//            };
//        }));

//        // Update newLastSNo to the highest s_no
//        newLastSNo = Math.max(...resultItems.map(item => item.s_no));

//    } else if (selectedAddons.length > 0) {
//        // No structure - need to create parent-child relationships
//        newLastSNo++;
//        const parentSNo = newLastSNo;

//        resultItems.push({
//            ...item,
//            s_no: parentSNo,
//            parent_sno: parentSNo,
//            qty: 1,
//            remarks: selectedRemarks.map(r => r.remarks_item_name || r.remarks || r).join(', ')
//        });

//        selectedAddons.forEach(addon => {
//            newLastSNo++;
//            resultItems.push({
//                ...addon,
//                s_no: newLastSNo,
//                parent_sno: parentSNo,
//                ds_no: 1,
//                seat_no: 1
//            });
//        });

//    } else {
//        // Simple alacarte item - no modifiers or addons
//        newLastSNo++;
//        resultItems.push({
//            ...item,
//            s_no: newLastSNo,
//            parent_sno: newLastSNo,
//            qty: 1,
//            remarks: selectedRemarks.map(r => r.remarks_item_name || r.remarks || r).join(', ')
//        });
//    }

//    console.log('📦 Items to add:', resultItems);

//    // --- Add items to order ---
//    let updatedOrderItems;
//    if (hasModifierGroups || hasAddons) {
//        updatedOrderItems = addItemHaveModifierOrAddon(resultItems, editingOrderItemSNo);
//    } else {
//        updatedOrderItems = addAlacarteItem(resultItems[0]);
//    }

//    // --- Update order totals ---
//    if (updatedOrderItems?.orderItems) {
//        const updatedSales = updatedOrderItems.orderItems.sales_dtls.map(item => {
//            const subTotal = parseFloat(item.sub_total || 0);
//            const finalTaxRate = parseFloat(item.tax_rate || item.tax_value || 0) || (typeof gstRate !== 'undefined' ? gstRate : 9);
//            const isApplySvc = parseFloat(item.is_apply_svc || 0);
//            const svcRate = typeof serviceRate !== 'undefined' ? serviceRate : 10;

//            // Prevent NaN in service calculation
//            const serviceAmt = (isApplySvc === 1 && !isNaN(subTotal) && !isNaN(svcRate))
//                ? (svcRate * subTotal / 100)
//                : 0;

//            return {
//                ...item,
//                tax_rate: finalTaxRate,
//                tax_value: finalTaxRate,
//                tax_amt: (subTotal * finalTaxRate / 100).toFixed(6),
//                svc_amt: serviceAmt.toFixed(6)
//            };
//        });

//        const subTotal = updatedSales.reduce((sum, i) => sum + parseFloat(i.sub_total || 0), 0);
//        const totalTax = updatedSales.reduce((sum, i) => sum + parseFloat(i.tax_amt || 0), 0);
//        const totalService = updatedSales.reduce((sum, i) => sum + parseFloat(i.svc_amt || 0), 0);
//        const netAmount = subTotal + totalTax + totalService;

//        const finalOrder = {
//            ...order,
//            ...updatedOrderItems.orderItems,
//            sales_dtls: updatedSales,
//            sub_total: subTotal.toFixed(2),
//            total_disc: updatedOrderItems.orderItems.total_disc || "0.00",
//            total_svc: totalService.toFixed(2),
//            total_tax: totalTax.toFixed(2),
//            round_adj_amt: updatedOrderItems.orderItems.round_adj_amt || "0.00",
//            net_amt: netAmount.toFixed(2),
//            lastSNo: newLastSNo
//        };

//        setOrder(finalOrder);
//        setLastSNo(newLastSNo);

//        setTimeout(() => {
//            renderCartFromOrder();
//            updateCartCount();
//        }, 10);
//    }

//    console.log(`✅ Item ${editingOrderItemSNo ? "Updated" : "Added"}:`, itemId, 'Total items:', resultItems.length, 'Remarks:', selectedRemarks.length);
//    setTimeout(() => delete window.lastAddToCartCall, 1000);
//}
// Helper function to collect selected addons from modal
function collectSelectedAddons() {
    const selectedAddons = [];
    const checkedBoxes = document.querySelectorAll('#addonModalContent .addon-checkbox:checked');

    checkedBoxes.forEach(checkbox => {
        selectedAddons.push({
            item_no: checkbox.value,
            value: checkbox.value,
            item_name: checkbox.dataset.itemName,
            data_item_name: checkbox.dataset.itemName,
            price: parseFloat(checkbox.dataset.price || 0),
            data_price: parseFloat(checkbox.dataset.price || 0),
            modifier_name: checkbox.dataset.modifierName,
            category_code: checkbox.dataset.categoryCode,
            qty: 1
        });
    });

    return selectedAddons;
}


//function addToCart(itemId, selectedAddons = [], selectedRemarks = [], editingOrderItemSNo = null) {
//    console.log('🚀 addToCart called:', itemId, selectedAddons.length, selectedRemarks.length);

//    // Prevent duplicate calls
//    const callId = `${itemId}_${selectedAddons.length}_${Date.now()}`;
//    if (window.lastAddToCartCall === callId) return;
//    window.lastAddToCartCall = callId;

//    if (isAddingToCart) return;
//    isAddingToCart = true;
//    setTimeout(() => {
//        isAddingToCart = false;
//    }, 500);

//    const cache = useCache() || {};
//    const { order, setOrder } = useOrder();
//    const items = cache.items || [];
//    const allItemRemarks = cache.itemRemarks || [];
//    const item = items.find(i => i.item_no === itemId || i.id === itemId);

//    if (!item) return console.warn("Item not found:", itemId);

//    const remarksEntry = allItemRemarks.find(r => r.item_no === item.item_no);
//    const hasAddons = item.is_addon_enable?.toUpperCase() === "Y";
//    const hasRemarks = Array.isArray(remarksEntry?.remarks_item_details) && remarksEntry.remarks_item_details.length > 0;
//    const hasModifierGroups = Array.isArray(item.itemmaster_menutype_grpdtls) && item.itemmaster_menutype_grpdtls.length > 0;

//    // Modal logic
//    const isFromModal = window.isFromAddonModal || false;
//    const showModal =
//        (hasAddons && selectedAddons.length === 0 && !editingOrderItemSNo && !isFromModal) ||
//        (hasRemarks && selectedRemarks.length === 0 && !editingOrderItemSNo && !isFromModal) ||
//        (hasModifierGroups && selectedAddons.length === 0 && !editingOrderItemSNo && !isFromModal);

//    if (showModal) {
//        const addonData = hasAddons ? getAddonsByAddOnName(item.add_on_name) : { cat_dtls: [], item_dtls: [] };

//        const enrichedCatDtls = (addonData.cat_dtls || []).map(grp => {
//            if (!grp.category_code) {
//                const matchedItem = addonData.item_dtls.find(i => i.modifier_name === grp.modifier_name && i.category_code);
//                if (matchedItem) grp.category_code = matchedItem.category_code;
//            }
//            grp.item_dtls = getAvailableAddonItems(addonData, grp);
//            return grp;
//        });

//        const filteredAddonData = {
//            ...addonData,
//            cat_dtls: enrichedCatDtls
//        };

//        showAddOnModal(
//            item,
//            (chosenAddons, chosenRemarks) => {
//                addToCart(itemId, chosenAddons, chosenRemarks, editingOrderItemSNo);
//            },
//            filteredAddonData,
//            remarksEntry ? remarksEntry.remarks_item_details : []
//        );
//        return;
//    }

//    // --- Process selectedAddons through addAddonItem ---
//    if (hasAddons && selectedAddons.length > 0) {
//        const processedAddons = [];
//        selectedAddons.forEach(addon => {
//            const grp = {
//                category_code: addon.group_code,
//                max_qty: addon.max_qty || 1
//            };
//            const { selectionItems } = addAddonItem(grp, addon, processedAddons);
//            processedAddons.length = 0;
//            processedAddons.push(...selectionItems);
//        });
//        selectedAddons = processedAddons;
//    }

//    // Prepare menu item with remarks
//    const menuItem = {
//        ...item,
//        selectedAddons,
//        selectedRemarks,
//        remarks: selectedRemarks.map(r => r.remarks_item_name || r.remarks || r).join(', ')
//    };

//    let result;
//    const currentSalesDtls = order?.sales_dtls || [];

//    // --- Helper functions for SNo ---
//    const getNextAvailableParentSNo = (salesDtls) =>
//        salesDtls.length ? Math.max(...salesDtls.map(i => parseInt(i.parent_sno))) + 1 : 1;

//    const getNextAvailableSNo = (salesDtls) =>
//        salesDtls.length ? Math.max(...salesDtls.map(i => parseInt(i.s_no))) + 1 : 1;

//    if (hasModifierGroups || (hasAddons && selectedAddons.length > 0)) {
//        // Items with modifiers or addons
//        const salesDtlsRecords = [];
//        const baseSNo = getNextAvailableSNo(currentSalesDtls);
//        const parentSNo = getNextAvailableParentSNo(currentSalesDtls);
//        const basePrice = hasModifierGroups ? 0 : parseFloat(
//            menuItem.dine_in_price ||
//            menuItem.takeaway_price ||
//            menuItem.delivery_price ||
//            menuItem.default_price ||
//            0
//        );

//        // Base item
//        salesDtlsRecords.push(createSalesDtlsRecord(menuItem, baseSNo, parentSNo, basePrice));

//        // Addon records
//        selectedAddons.forEach((addon, index) => {
//            const childSNo = baseSNo + index + 1;
//            const addonPrice = addon.price * (addon.qty || 1);
//            salesDtlsRecords.push(createSalesDtlsRecord(addon, childSNo, parentSNo, addonPrice));
//        });

//        result = addItemHaveModifierOrAddon(salesDtlsRecords, editingOrderItemSNo);
//    } else {
//        // Simple Ala Carte
//        const nextSNo = getNextAvailableSNo(currentSalesDtls);
//        menuItem.parent_sno = nextSNo;
//        menuItem.seat_no = 1;
//        result = addAlacarteItem(menuItem);
//    }

//    // --- Update order totals ---
//    if (result?.orderItems) {
//        const updatedSalesDtls = result.orderItems.sales_dtls.map(item => {
//            const subTotal = parseFloat(item.sub_total || 0);
//            const finalTaxRate = parseFloat(item.tax_rate || item.tax_value || 0) || gstRate;
//            const serviceAmt = (parseFloat(item.is_apply_svc || 0) === 1 ? serviceRate : 0) * subTotal / 100;

//            return {
//                ...item,
//                tax_rate: finalTaxRate,
//                tax_value: finalTaxRate,
//                tax_amt: (subTotal * finalTaxRate / 100).toFixed(6),
//                svc_amt: serviceAmt.toFixed(6)
//            };
//        });

//        const subTotal = updatedSalesDtls.reduce((sum, item) => sum + parseFloat(item.sub_total || 0), 0);
//        const totalTax = updatedSalesDtls.reduce((sum, item) => sum + parseFloat(item.tax_amt || 0), 0);
//        const totalService = updatedSalesDtls.reduce((sum, item) => sum + parseFloat(item.svc_amt || 0), 0);
//        const netAmount = subTotal + totalTax + totalService;

//        setOrder({
//            ...result.orderItems,
//            sales_dtls: updatedSalesDtls,
//            sub_total: subTotal.toFixed(2),
//            total_disc: result.orderItems.total_disc || "0.00",
//            total_svc: totalService.toFixed(2),
//            total_tax: totalTax.toFixed(2),
//            round_adj_amt: result.orderItems.round_adj_amt || "0.00",
//            net_amt: netAmount.toFixed(2),
//            lastSNo: Math.max(...updatedSalesDtls.map(i => parseInt(i.s_no) || 0))
//        });

//        setTimeout(() => {
//            renderCartFromOrder();
//            updateCartCount();
//        }, 10);
//    }

//    console.log(`✅ Item ${editingOrderItemSNo ? "Updated" : "Added"}:`, itemId, 'Addons:', selectedAddons.length, 'Remarks:', selectedRemarks.length);
//    setTimeout(() => delete window.lastAddToCartCall, 1000);
//}
//// Helper function to collect selected addons from modal
//function collectSelectedAddons() {
//    const selectedAddons = [];
//    const checkedBoxes = document.querySelectorAll('#addonModalContent .addon-checkbox:checked');

//    checkedBoxes.forEach(checkbox => {
//        selectedAddons.push({
//            item_no: checkbox.value,
//            value: checkbox.value,
//            item_name: checkbox.dataset.itemName,
//            data_item_name: checkbox.dataset.itemName,
//            price: parseFloat(checkbox.dataset.price || 0),
//            data_price: parseFloat(checkbox.dataset.price || 0),
//            modifier_name: checkbox.dataset.modifierName,
//            category_code: checkbox.dataset.categoryCode,
//            qty: 1
//        });
//    });

//    return selectedAddons;
//}
function createSalesDtlsRecord(itemData, sNo, parentSNo, subTotal) {
    const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Use the helper to get the correct price
    // If price is explicitly provided in itemData, use it; otherwise use helper
    const unitPrice = itemData.price !== undefined
        ? parseFloat(itemData.price)
        : getItemPrice(itemData);

    return {
        s_no: sNo,
        parent_sno: parentSNo,
        ds_no: 1,
        seat_no: 1,
        category_code: itemData.category_code || "",
        item_no: itemData.item_no,
        item_name: itemData.item_name,
        item_desc: itemData.item_desc || itemData.item_name,
        remarks: itemData.remarks || "",
        qty: itemData.qty || 1,
        uom: itemData.uom || "",
        uom_cf: itemData.uom_cf || 1,
        unit_price: unitPrice,
        disc_type: itemData.disc_type || "",
        disc_name: itemData.disc_name || "",
        disc_value: itemData.disc_value || 0,
        disc_amt: itemData.disc_amt || 0,
        sub_total: subTotal,
        pro_disc_amt: itemData.pro_disc_amt || 0,
        svc_amt: "0.000000",
        is_apply_svc: 1,
        tax_amt: "0.000000",
        tax_rate: itemData.tax_rate || 9,
        tax_value: itemData.tax_value || 9,
        is_absorbtax: 0,
        take_away_item: "N",
        order_seq: 1,
        order_seq_type: null,
        order_datetime: currentDateTime,
        print_flag: "N",
        item_kds_ready_status: "N",
        item_kds_ready_datetime: currentDateTime,
        item_kds_serve_status: "N",
        item_kds_serve_datetime: currentDateTime,
        override_f: 0,
        is_addon_enable: itemData.is_addon_enable || "",
        add_on_name: itemData.add_on_name || "",
        menu_type: itemData.menu_type || "",
        modifier_name: itemData.modifier_name || "",
        ref_1: "", ref_2: "", ref_3: "", ref_4: ""
    };
}
function pushItemToCart(item, totalPrice, mainPrice = 0, addonTotal = 0, addons = []) {
    const serializeAddons = (addonsArray) => JSON.stringify(addonsArray.map(a => a.item_no).sort());

    const newAddonsSerialized = serializeAddons(addons);

    const existingItem = cart.find(i =>
        i.item_no === item.item_no &&
        serializeAddons(i.addons || []) === newAddonsSerialized
    );

    if (existingItem) {
        existingItem.quantity += 1;
        // Optionally update price in case prices changed
        existingItem.totalPrice = existingItem.basePrice + existingItem.addonTotal;
    } else {
        cart.push({
            item_no: item.item_no,
            name: item.item_name || item.name || "Unnamed",
            quantity: 1,
            basePrice: mainPrice,
            addonTotal: addonTotal,
            totalPrice: totalPrice,
            addons: addons
        });
    }

    updateCartDisplay();
}


function getRemarksCache() {
    // Try multiple cache sources in order of reliability
    let cache = [];

    // 1. First try window.remarksCache
    if (window.remarksCache && Array.isArray(window.remarksCache)) {
        cache = window.remarksCache;
        console.log("📚 Using window.remarksCache:", cache.length, "items");
    }
    // 2. Try useCache()
    else if (typeof useCache === 'function') {
        const cacheManager = useCache();
        if (cacheManager?.getItemRemarks) {
            cache = cacheManager.getItemRemarks() || [];
            console.log("📚 Using useCache():", cache.length, "items");
        }
    }
    // 3. Fallback to sessionStorage
    else {
        const stored = sessionStorage.getItem("ItemRemarks");
        if (stored) {
            try {
                cache = JSON.parse(stored);
                console.log("📚 Using sessionStorage:", cache.length, "items");
                // Update window cache for next time
                window.remarksCache = cache;
            } catch (e) {
                console.error("❌ Failed to parse cached remarks:", e);
            }
        }
    }

    return cache;
}

// Helper function to get item image URL
function getItemImageUrl(item) {
    console.log('🖼️ === START getItemImageUrl ===');
    console.log('Item number:', item.item_no);
    console.log('Item name:', item.item_name);
    console.log('item.tqr_image_url:', item.tqr_image_url);
    console.log('item.item_image:', item.item_image);

    let imageUrl = item.tqr_image_url || item.item_image || '';
    console.log('Initial imageUrl:', imageUrl);

    // If no image URL in cart item, try to find it from sessionStorage
    if (!imageUrl || imageUrl.trim() === '') {
        console.log('⚠️ No image URL in cart item, checking sessionStorage...');
        try {
            const cachedItemsJson = sessionStorage.getItem("FullItems");
            console.log('SessionStorage FullItems exists?', !!cachedItemsJson);

            if (cachedItemsJson) {
                const cachedItems = JSON.parse(cachedItemsJson);
                console.log('Cached items count:', cachedItems?.length);
                console.log('Is array?', Array.isArray(cachedItems));

                if (Array.isArray(cachedItems)) {
                    const originalItem = cachedItems.find(i => i.item_no === item.item_no);
                    console.log('Found original item?', !!originalItem);

                    if (originalItem) {
                        console.log('Original item tqr_image_url:', originalItem.tqr_image_url);
                        console.log('Original item item_image:', originalItem.item_image);
                        imageUrl = originalItem.tqr_image_url || originalItem.item_image || '';
                        console.log('Updated imageUrl from cache:', imageUrl);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Error fetching from sessionStorage:', error);
        }
    }

    console.log('Before URL conversion:', imageUrl);
    console.log('URL variable value:', typeof URL !== 'undefined' ? URL : 'UNDEFINED');

    // Convert relative path to full URL if needed
    if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('/')) {
        imageUrl = `${URL}/${imageUrl}`;
        console.log('After URL conversion:', imageUrl);
    }

    // If still no image, use restaurant logo
    if (!imageUrl || imageUrl.trim() === '') {
        imageUrl = RESTAURANT_CONFIG.logo || '';
        console.log('Using fallback logo:', imageUrl);
    }

    console.log('✅ FINAL imageUrl:', imageUrl);
    console.log('🖼️ === END getItemImageUrl ===\n');
    return imageUrl;
}

function showAddOnModal(baseItem, onConfirm, addonData, remarksData = [], prefilledAddons = [], prefilledRemarks = [], editingOrderItemSNo = null) {
    window.currentBaseItemId = baseItem.item_no;
    window.selectedAddons = populateParentAndAddonItems(baseItem, editingOrderItemSNo);

    const itemmasterGroups = Array.isArray(baseItem.itemmaster_menutype_grpdtls) ? baseItem.itemmaster_menutype_grpdtls : [];
    const itemmasterItems = Array.isArray(baseItem.itemmaster_menutypedtls) ? baseItem.itemmaster_menutypedtls : [];

    window.itemmasterGroups = itemmasterGroups;
    window.itemmasterItems = itemmasterItems;

    if (!window.remarksCache) {
        window.remarksCache = getRemarksCache();
        console.log("🔄 Initialized window.remarksCache:", window.remarksCache?.length || 0, "items");
    }

    if (!remarksData || remarksData.length === 0) {
        const itemRemarksCache = getRemarksCache();
        const itemRemarks = itemRemarksCache.find(r =>
            r.item_no === baseItem.item_no ||
            String(r.item_no) === String(baseItem.item_no)
        );

        if (itemRemarks?.remarks_item_details) {
            remarksData = itemRemarks.remarks_item_details;
            console.log("✅ Loaded remarks from cache:", remarksData);
        } else {
            console.warn("⚠️ No remarks found for base item:", baseItem.item_no);
        }
    }



    // Translate groups
    itemmasterGroups.forEach(group => {
        if (group.group_code) {
            group.display_name = getTranslatedName(
                group.group_code,
                group.modifier_name,
                selectedLang,
                "category"
            );
        } else {
            group.display_name = group.modifier_name;
        }
    });

    // Translate items
    itemmasterItems.forEach(item => {
        item.display_name = getTranslatedName(
            item.citem_no,
            item.citem_name,
            selectedLang,
            "item"
        );
    });

    // Build comprehensive remarks map from ALL items
    const allPossibleRemarks = new Map();

    if (addonData?.item_dtls) {
        addonData.item_dtls.forEach(addon => {
            const itemRemarksCache = getRemarksCache();
            const itemRemarks = itemRemarksCache.find(r =>
                r.item_no === addon.item_no ||
                String(r.item_no) === String(addon.item_no)
            );

            if (itemRemarks?.remarks_item_details) {
                allPossibleRemarks.set(`addon_${addon.item_no}`, itemRemarks.remarks_item_details);
            }
        });
    }

    if (itemmasterItems?.length) {
        itemmasterItems.forEach(modItem => {
            const itemRemarksCache = getRemarksCache();
            const itemRemarks = itemRemarksCache.find(r =>
                r.item_no === modItem.citem_no ||
                String(r.item_no) === String(modItem.citem_no)
            );

            if (itemRemarks?.remarks_item_details) {
                allPossibleRemarks.set(`modifier_${modItem.citem_no}`, itemRemarks.remarks_item_details);
            }
        });
    }

    console.log("🗺️ All possible remarks map:", allPossibleRemarks);

    // Translate remarks
    allPossibleRemarks.forEach((remarkGroups, key) => {
        remarkGroups.forEach(group => {
            if (group.remarks_details) {
                group.remarks_details.forEach(r => {
                    r.display_name = getTranslatedName(
                        `${group.remarks_group}_${r.seq_no}`,
                        r.remarks,
                        selectedLang,
                        "item"
                    );
                });
            }
        });
    });

    // Build itemmaster section (qty controls)
    let itemmasterSection = '';
    if (itemmasterGroups.length && itemmasterItems.length) {
        const groupsArr = itemmasterGroups
            .slice()
            .sort((a, b) => (a.item_menutype_grpdtls || 9999) - (b.item_menutype_grpdtls || 9999));

        itemmasterSection = groupsArr.map(group => {
            const availableModifierItems = getAvailableModifierItems(baseItem, group);
            if (!availableModifierItems.length) return '';
            const maxQty = group.max_qty;
            const groupLimit = group.group_limit || 0;

            return `
        <div class="addon-category border border-gray-200 rounded-lg p-4 shadow-sm bg-gray-50" 
             data-category-code="${group.modifier_name}" 
             data-max-qty="${maxQty}" 
             data-group-limit="${groupLimit}"
             data-optional="${group.is_optional}"
             data-type="modifier">
            <h3 class="addon-category-title text-sm text-gray-600 mb-3 font-semibold uppercase tracking-wide flex justify-between items-center cursor-pointer">
              <span>${group.display_name} (<span class="selected-count" data-category="${group.modifier_name}">0</span> / ${maxQty})</span>
            </h3>
            <div class="addon-options-wrapper">
                <div class="addon-options grid grid-cols-1 sm:grid-cols-2 gap-3">
                    ${availableModifierItems.map(dtl => {
                const price = getPriceByServiceType(dtl.price_dtls?.[0]);
                const priceDisplay = price > 0 ? ` (+$${price.toFixed(2)})` : '';
                const soldOutText = dtl.isSoldOut ? ' (Sold Out)' : '';
                const imageUrl = getItemImageUrl(dtl);
                const restaurantLogo = RESTAURANT_CONFIG.logo || '';

                return `
                               <div class="flex justify-between items-center gap-4 p-2 border rounded bg-white" data-item-no="${dtl.citem_no}">
                                   <div class="flex items-center gap-3 flex-1">
                                       <img src="${imageUrl}" 
                                            alt="${dtl.display_name}" 
                                            class="w-16 h-16 object-cover rounded"
                                            onerror="if(this.src!=='${restaurantLogo}') this.src='${restaurantLogo}';">
                                       <div class="text-sm">
                                           <div class="font-medium">${dtl.display_name}</div>
                                           <div class="text-gray-600">${priceDisplay}${soldOutText}</div>
                                       </div>
                                   </div>
                                   <div class="qty-control flex gap-2 items-center"
                                        data-item-id="${dtl.citem_no}"
                                        data-item-name="${dtl.display_name}"
                                        data-price="${price}"
                                        data-category="${group.modifier_name}">
                                       <button type="button" class="decrement px-2 rounded bg-gray-200">−</button>
                                       <span class="qty-count w-6 text-center">0</span>
                                       <button type="button" class="increment px-2 rounded bg-gray-200">+</button>
                                   </div>
                               </div>`;
            }).join('')}
                </div>
            </div>
        </div>`;
        }).join('');
    }

    // Load add-ons data
    addonData = getAddonsByAddOnName(baseItem.add_on_name);

    // Translate addon categories
    if (addonData?.cat_dtls) {
        addonData.cat_dtls.forEach(cat => {
            if (cat.category_code) {
                cat.display_name = getTranslatedName(
                    cat.category_code,
                    cat.category_name || cat.modifier_name || cat.category_code,
                    selectedLang,
                    "category"
                );
            } else {
                cat.display_name = cat.category_name || cat.modifier_name || cat.category_code;
            }
        });
    }

    // Build addon section with embedded remarks
    let addonSection = '';
    if (addonData && addonData.cat_dtls && addonData.item_dtls) {
        const categories = addonData.cat_dtls
            .filter(cat => cat.max_qty >= 0)
            .sort((a, b) => a.seq_no - b.seq_no);

        addonSection = categories.map(cat => {
            const inputType = 'checkbox';
            const maxSelectable = cat.max_qty;
            const fieldName = `addon_${cat.category_code.replace(/\s+/g, '_')}`;
            const isOptional = cat.is_optional === 'Y';
            const options = addonData.item_dtls.filter(opt => opt.category_code === cat.category_code);

            let categoryHTML = `
        <div class="addon-category border border-gray-200 rounded-lg p-4 shadow-sm bg-gray-50"
             data-category-code="${cat.category_code}"
             data-max-selectable="${maxSelectable}"
             data-optional="${cat.is_optional || 'Y'}"
             data-type="addon">
                <h3 class="addon-category-title text-sm text-gray-600 mb-3 font-semibold uppercase tracking-wide">
                  ${cat.display_name}
                  ${maxSelectable > 0 ? `<span class="max-selection text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full ml-2">Max ${maxSelectable}</span>` : ''}
                </h3>
                <div class="addon-options-wrapper" style="display: block;">
                  <div class="addon-options grid grid-cols-1 sm:grid-cols-2 gap-3">
                    ${options.map(opt => {
                const price = parseFloat(opt.price) || 0;
                const priceDisplay = price > 0 ? ` (+${price.toFixed(2)})` : '';
                const inputName = fieldName;
                const imageUrl = getItemImageUrl(opt);
                const restaurantLogo = RESTAURANT_CONFIG.logo || '';

                return `
                        <label class="addon-label block cursor-pointer p-2 border rounded bg-white hover:bg-gray-50" data-item-no="${opt.item_no}">
                          <div class="flex items-center gap-3">
                            <input
                              type="${inputType}"
                              name="${inputName}"
                              value="${opt.item_no}"
                              data-price="${price}"
                              data-item-name="${getTranslatedName(opt.item_no, opt.item_desc, selectedLang, "item")}"
                              data-modifier-name="${cat.category_code}"
                              data-category-code="${cat.category_code}"
                              class="addon-checkbox mr-2"
                              ${!isOptional ? 'required' : ''}
                              ${opt.isSoldOut ? 'disabled' : ''}
                            />
                            <img src="${imageUrl}" 
                                 alt="${getTranslatedName(opt.item_no, opt.item_desc, selectedLang, "item")}" 
                                 class="w-16 h-16 object-cover rounded"
                                 onerror="if(this.src!=='${restaurantLogo}') this.src='${restaurantLogo}';">
                            <div class="flex-1">
                              <span class="checkbox-custom ${inputType === 'checkbox' ? 'rounded-full' : ''}"></span>
                              <div class="addon-text">
                                <div class="font-medium">${getTranslatedName(opt.item_no, opt.item_desc, selectedLang, "item")}</div>
                                <div class="text-sm text-gray-600">${priceDisplay}${opt.isSoldOut ? ' (Sold Out)' : ''}</div>
                              </div>
                            </div>
                          </div>
                        </label>`;
            }).join('')}
                  </div>
                </div>
        </div>`;

            // Add associated remarks (deduplicated by remarks_group)
            const categoryRemarksMap = new Map();
            options.forEach(opt => {
                const remarkGroups = allPossibleRemarks.get(`addon_${opt.item_no}`);
                if (remarkGroups) {
                    remarkGroups.forEach(group => {
                        if (!categoryRemarksMap.has(group.remarks_group)) {
                            categoryRemarksMap.set(group.remarks_group, group);
                        }
                    });
                }
            });

            // Append remarks HTML
            if (categoryRemarksMap.size > 0) {
                categoryRemarksMap.forEach((group, remarkGroupName) => {
                    const groupName = group.remarks_group || 'unknown_group';
                    const fieldName = `remark_${groupName.replace(/\s+/g, '_')}`;
                    const remarksList = group.remarks_details || [];
                    if (remarksList.length === 0) return;

                    const isRequired = group.remarks_group_type === 'S';

                    categoryHTML += `
            <div class="addon-category remark-section border border-gray-200 rounded-lg p-4 shadow-sm bg-gray-50 mt-3"
                 data-category-code="${groupName}"
                 data-max-selectable="1"
                 data-optional="${isRequired ? 'N' : 'Y'}"
                 data-type="remark"
                 data-remark-group="${groupName}"
                 data-parent-category="${cat.category_code}"
                 style="display: none;">
  
                <h3 class="addon-category-title text-sm text-gray-600 mb-3 font-semibold uppercase tracking-wide">
                    ${groupName}
                    <span class="max-selection text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full ml-2">
                        ${isRequired ? 'Required - Select 1' : 'Optional'}
                    </span>
                </h3>
  
                <div class="error-message text-sm text-red-600 mb-2" style="display: none;">Please select one option for this group.</div>
  
                <div class="addon-options-wrapper" style="display: block;">
                    <div class="addon-options grid grid-cols-1 sm:grid-cols-2 gap-3">
                        ${remarksList.map(item => `
                            <label class="addon-label block cursor-pointer">
                                <input 
                                    type="checkbox"
                                    name="${fieldName}"
                                    value="${item.seq_no}"
                                    data-remark-text="${item.display_name || item.remarks}"
                                    data-remark-group="${groupName}"
                                    class="addon-checkbox remark-checkbox mr-2"
                                    ${isRequired ? 'required' : ''}
                                >
                                <span class="checkbox-custom"></span>
                                <span class="addon-text">${item.display_name || item.remarks}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            </div>`;
                });
            }

            return categoryHTML;
        }).join('');
    }

    // Insert HTML into modal
    modalContent.innerHTML = `
        <div class="modal-header">
            <h2 class="modal-title">Select Add-ons for</h2>
            <p class="modal-item-name font-semibold">${baseItem.item_name}</p>
        </div>
        <form id="addonForm" class="addon-form space-y-6">
            ${itemmasterSection}
            ${addonSection}
        </form>
        <button id="confirmAddons" class="btn-add-to-cart mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 opacity-50 cursor-not-allowed" disabled>
          Add to Cart
        </button>   
        <button id="updateAddOns" class="btn-add-to-cart mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 opacity-50 cursor-not-allowed" style="display:none;">
          Update Cart
        </button>
    `;

    // Create updateRemarksVisibility function
    const itemRemarksCache = window.remarksCache || getRemarksCache();
    const updateRemarksVisibility = createUpdateRemarksVisibilityFunction(allPossibleRemarks, itemRemarksCache);

    // UNIFIED CHECKBOX LOGIC
    function bindUnifiedCheckboxLogic() {
        document.querySelectorAll('.addon-category').forEach(group => {
            const maxSelectable = parseInt(group.dataset.maxSelectable || '0', 10);
            const categoryType = group.dataset.type;
            const categoryCode = group.dataset.categoryCode;
            const optional = group.dataset.optional === 'Y';
            const isRemarkSection = categoryType === 'remark';

            const checkboxes = isRemarkSection
                ? group.querySelectorAll('.addon-checkbox.remark-checkbox')
                : group.querySelectorAll('.addon-checkbox:not(.remark-checkbox)');

            if (checkboxes.length === 0) return;

            if (optional) {
                checkboxes.forEach(input => input.removeAttribute("required"));
            }

            function updateCheckboxState() {
                const checked = Array.from(checkboxes).filter(cb => cb.checked);

                if (maxSelectable > 0 && checked.length >= maxSelectable && maxSelectable !== 1) {
                    checkboxes.forEach(cb => {
                        if (!cb.checked && !cb.disabled) cb.disabled = true;
                    });
                } else {
                    checkboxes.forEach(cb => {
                        const isSoldOut = cb.hasAttribute('disabled') && cb.dataset.soldOut === 'true';
                        if (!isSoldOut) cb.disabled = false;
                    });
                }

                checkboxes.forEach(cb => {
                    const label = cb.closest('.addon-label');
                    if (label) label.classList.toggle('selected', cb.checked);
                });
            }

            // ✅ FIXED: Single-select for max=1 (radio-button behavior)
            if (maxSelectable === 1) {
                checkboxes.forEach(checkbox => {
                    // Initialize the tracking attribute
                    if (checkbox.checked) {
                        checkbox.setAttribute('data-was-checked', 'true');
                    } else {
                        checkbox.setAttribute('data-was-checked', 'false');
                    }

                    checkbox.addEventListener('click', function (e) {
                        e.stopPropagation();

                        const wasChecked = this.getAttribute('data-was-checked') === 'true';

                        // Uncheck all checkboxes in this group first
                        checkboxes.forEach(cb => {
                            cb.checked = false;
                            cb.setAttribute('data-was-checked', 'false');
                            cb.closest('.addon-label')?.classList.remove('selected');
                        });

                        if (!wasChecked) {
                            // Check this checkbox
                            this.checked = true;
                            this.setAttribute('data-was-checked', 'true');
                            this.closest('.addon-label')?.classList.add('selected');

                            // Trigger change event for processing
                            const changeEvent = new Event('change', { bubbles: true });
                            this.dispatchEvent(changeEvent);
                        } else {
                            // Trying to uncheck the currently checked item
                            if (!optional) {
                                // Required groups must keep one selected
                                this.checked = true;
                                this.setAttribute('data-was-checked', 'true');
                                this.closest('.addon-label')?.classList.add('selected');
                                console.log(`ℹ️ Cannot uncheck required option in "${categoryCode}"`);
                            } else {
                                // Optional groups can be completely unchecked
                                this.checked = false;
                                this.setAttribute('data-was-checked', 'false');

                                // Trigger change event
                                const changeEvent = new Event('change', { bubbles: true });
                                this.dispatchEvent(changeEvent);
                            }
                        }

                        updateCheckboxState();

                        if (typeof validateAddToCart === 'function') {
                            validateAddToCart();
                        }
                    });
                });
            }

            checkboxes.forEach(cb => {
                cb.addEventListener('change', () => {
                    const isChecked = cb.checked;
                    const itemNo = cb.value;
                    const itemName = cb.dataset.itemName || cb.dataset.remarkText;
                    const price = parseFloat(cb.dataset.price || 0);

                    // Process addons
                    if (categoryType === 'addon' && categoryCode) {
                        const addonGroup = addonData?.cat_dtls?.find(
                            cat => cat.category_code === categoryCode
                        );

                        if (addonGroup) {
                            const addonItem = {
                                item_no: itemNo,
                                item_desc: itemName,
                                category_code: categoryCode,
                                price: price,
                                qty: 1
                            };

                            window.selectedAddons = window.selectedAddons || [];

                            if (isChecked) {
                                const { selectionItems, exceed } = addAddonItem(
                                    addonGroup,
                                    addonItem,
                                    window.selectedAddons
                                );

                                if (!exceed) {
                                    window.selectedAddons = selectionItems.map(item => ({
                                        ...item,
                                        parent_sno: 1,
                                        ds_no: 1,
                                        seat_no: 1
                                    }));
                                    console.log('✅ Added addon:', itemName);
                                } else {
                                    cb.checked = false;
                                    console.warn('⚠️ Addon limit exceeded');
                                }
                            } else {
                                window.selectedAddons = window.selectedAddons.filter(
                                    item => !(item.item_no === itemNo && item.category_code === categoryCode)
                                );
                                console.log('🗑️ Removed addon:', itemName);
                            }
                        }

                        updateRemarksVisibility();
                    }

                    // For remarks, just update visual state
                    if (categoryType === 'remark') {
                        console.log(`📝 Remark ${isChecked ? 'selected' : 'deselected'}:`, itemName);
                    }

                    updateCheckboxState();

                    if (typeof validateAddToCart === 'function') {
                        validateAddToCart();
                    }
                });
            });

            updateCheckboxState();
        });
    }
    function updateCategoryCount(categoryCode) {
        const category = document.querySelector(`.addon-category[data-category-code="${categoryCode}"]`);
        if (!category) return;

        const counts = [...category.querySelectorAll('.qty-count')]
            .map(el => parseInt(el.textContent, 10) || 0);
        const total = counts.reduce((a, b) => a + b, 0);

        const selectedCountEl = category.querySelector(`.selected-count[data-category="${categoryCode}"]`);
        if (selectedCountEl) selectedCountEl.textContent = total;

        const max = parseInt(category.dataset.maxQty || "0", 10);
        category.querySelectorAll('.increment').forEach(btn => {
            if (max > 0 && total >= max) {
                btn.disabled = true;
                btn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        });

        const wrapper = category.querySelector(".addon-options-wrapper");
        if (wrapper) {
            if (max > 0 && total >= max) {
                wrapper.classList.add("collapsed");
            } else {
                wrapper.classList.remove("collapsed");
            }
        }
    }

    function attachQtyControls(container) {
        const root = (typeof container === 'string') ? document.getElementById(container) : container;
        if (!root) return;

        window.selectedAddons = window.selectedAddons || [];

        root.querySelectorAll('.qty-control').forEach(control => {
            const decrementBtn = control.querySelector('.decrement');
            const incrementBtn = control.querySelector('.increment');
            const countSpan = control.querySelector('.qty-count');
            const categoryCode = control.dataset.category;
            const itemId = control.dataset.itemId;

            function updateUI(newQty) {
                countSpan.textContent = newQty;
                if (newQty <= 0) {
                    decrementBtn.disabled = true;
                    decrementBtn.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    decrementBtn.disabled = false;
                    decrementBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                }
                updateCategoryCount(categoryCode);
                updateRemarksVisibility();
            }

            function handleQtyChange(newQty) {
                updateUI(newQty);
                let selectedGroup = window.itemmasterGroups?.find(g => g.modifier_name === categoryCode);
                let selectedItem = window.itemmasterItems?.find(i => i.citem_no === itemId);

                if (selectedGroup && selectedItem) {
                    const normalizedItem = {
                        ...selectedItem,
                        citem_no: itemId,
                        citem_name: control.dataset.itemName,
                        modifier_name: selectedGroup.modifier_name || categoryCode,
                    };

                    window.selectedAddons = window.selectedAddons.map(item => ({
                        ...item,
                        parent_sno: 1,
                        ds_no: 1,
                        seat_no: 1
                    }));

                    const existingItem = window.selectedAddons.find(
                        item => item.item_no === itemId && item.modifier_name === categoryCode
                    );

                    if (existingItem && newQty > 0) {
                        const { selectionItems: updatedItems, exceed } = changeModifierItemQty(
                            newQty,
                            selectedGroup,
                            normalizedItem,
                            window.selectedAddons
                        );

                        if (!exceed) {
                            window.selectedAddons = updatedItems.map(item => ({
                                ...item,
                                parent_sno: 1,
                                ds_no: 1,
                                seat_no: 1
                            }));
                        }
                    } else if (existingItem && newQty === 0) {
                        const { selectionItems: updatedItems } = changeModifierItemQty(
                            0,
                            selectedGroup,
                            normalizedItem,
                            window.selectedAddons
                        );

                        window.selectedAddons = updatedItems.map(item => ({
                            ...item,
                            parent_sno: 1,
                            ds_no: 1,
                            seat_no: 1
                        }));
                    } else if (!existingItem && newQty > 0) {
                        const itemToAdd = {
                            ...normalizedItem,
                            qty: newQty,
                            menu_type: selectedItem.menu_type,
                            level_no: selectedItem.level_no || 0,
                        };

                        const { selectionItems: updatedItems, exceed } = addModifierItem(
                            selectedGroup,
                            itemToAdd,
                            window.selectedAddons
                        );

                        if (!exceed) {
                            window.selectedAddons = updatedItems.map(item => ({
                                ...item,
                                parent_sno: 1,
                                ds_no: 1,
                                seat_no: 1
                            }));
                        }
                    }
                }

                console.log('🎯 Selected Addons:', window.selectedAddons);
            }

            incrementBtn.addEventListener('click', () => {
                let qty = parseInt(countSpan.textContent, 10) || 0;
                handleQtyChange(qty + 1);
            });

            decrementBtn.addEventListener('click', () => {
                let qty = parseInt(countSpan.textContent, 10) || 0;
                handleQtyChange(Math.max(0, qty - 1));
            });

            updateUI(parseInt(countSpan.textContent, 10) || 0);
        });
    }

    function bindCollapseToggles() {
        document.querySelectorAll(".addon-category-title").forEach(title => {
            title.addEventListener("click", () => {
                const group = title.closest(".addon-category");
                const wrapper = group.querySelector(".addon-options-wrapper");
                if (!wrapper) return;

                const isCurrentlyCollapsed = group.classList.contains("collapsed");

                if (isCurrentlyCollapsed) {
                    group.classList.remove("collapsed");
                    wrapper.classList.remove("collapsed");
                    wrapper.style.display = 'block';
                } else {
                    group.classList.add("collapsed");
                    wrapper.classList.add("collapsed");
                    wrapper.style.display = 'none';
                }
            });
        });
    }

    function autoCollapseOnMaxQty() {
        const categories = document.querySelectorAll('.addon-category');

        categories.forEach(category => {
            const maxQty = parseInt(category.dataset.maxQty || '0', 10);
            if (maxQty <= 0) return;

            const qtyCounts = category.querySelectorAll('.qty-count');
            const totalQty = Array.from(qtyCounts).reduce((sum, qtySpan) =>
                sum + (parseInt(qtySpan.textContent || '0', 10)), 0
            );

            const wrapper = category.querySelector('.addon-options-wrapper');
            if (!wrapper) return;

            if (totalQty >= maxQty) {
                category.classList.add('collapsed');
                wrapper.classList.add('collapsed');
                wrapper.style.display = 'none';
            } else if (totalQty > 0) {
                category.classList.remove('collapsed');
                wrapper.classList.remove('collapsed');
                wrapper.style.display = 'block';
            }
        });
    }

    function initAddonModal() {
        document.querySelectorAll('.addon-category').forEach(cat => {
            const categoryCode = cat.dataset.categoryCode;
            updateCategoryCount(categoryCode);
        });

        attachQtyControls(document.getElementById('addonModalContent'));
        bindUnifiedCheckboxLogic();
        bindCollapseToggles();
        autoCollapseOnMaxQty();

        // Initialize remarks visibility on load
        updateRemarksVisibility();
    }

    initAddonModal();

    // Show modal
    modal.style.display = 'flex';
    modal.onclick = (e) => { if (e.target === modal) closeAddonModal(); };

    // ✅ Hide bottom nav when addon modal opens
    const bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) {
        bottomNav.style.display = 'none';
    }

    document.body.style.overflow = 'hidden';


    if (typeof validateAddonSelections === 'function') {
        validateAddonSelections();
    }

    // Confirm button handler
    document.getElementById('confirmAddons').addEventListener('click', () => {
        if (!validateAndSubmit()) {
            return;
        }

        // Gather remarks and addons
        const selectedRemarks = gatherSelectedRemarksFromModal();
        const selectedAddons = gatherSelectedAddonsFromModal();

        console.log("📦 Confirmed Addons:", selectedAddons);
        console.log("💬 Confirmed Remarks:", selectedRemarks);

        // Pass to addToCart
        addToCart(window.currentBaseItemId, selectedAddons, selectedRemarks, null, true);

        if (typeof onConfirm === 'function') {
            onConfirm(selectedAddons, selectedRemarks);
        }

        closeAddonModal();
    });

    // Update button handler (for edit mode)
    const updateBtn = document.getElementById('updateAddOns');
    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            if (!validateAndSubmit()) return;

            const selectedRemarks = gatherSelectedRemarksFromModal();
            const selectedAddons = gatherSelectedAddonsFromModal();

            console.log("📦 Updated Addons:", selectedAddons);
            console.log("💬 Updated Remarks:", selectedRemarks);

            // ✅ Mark as editing mode before closing
            window.modalState.updateState({ editingMode: true });

            addToCart(window.currentBaseItemId, selectedAddons, selectedRemarks, editingOrderItemSNo, true);

            if (typeof onConfirm === 'function') {
                onConfirm(selectedAddons, selectedRemarks);
            }

            closeAddonModal();
        });
    }
}

//function showAddOnModal(baseItem, onConfirm, addonData, remarksData = [], prefilledAddons = [], prefilledRemarks = [], editingOrderItemSNo = null) {
//    window.currentBaseItemId = baseItem.item_no;
//    window.selectedAddons = populateParentAndAddonItems(baseItem, editingOrderItemSNo);

//    const itemmasterGroups = Array.isArray(baseItem.itemmaster_menutype_grpdtls) ? baseItem.itemmaster_menutype_grpdtls : [];
//    const itemmasterItems = Array.isArray(baseItem.itemmaster_menutypedtls) ? baseItem.itemmaster_menutypedtls : [];

//    window.itemmasterGroups = itemmasterGroups;
//    window.itemmasterItems = itemmasterItems;


//    if (!remarksData || remarksData.length === 0) {
//        const itemRemarksCache = window.remarksCache || [];
//        const itemRemarks = itemRemarksCache.find(r => r.item_no === baseItem.item_no);

//        if (itemRemarks && itemRemarks.remarks_item_details) {
//            remarksData = itemRemarks.remarks_item_details;
//            console.log("✅ Loaded remarks from cache for:", baseItem.item_no, remarksData);
//        }
//    }

//    console.log("Group object:", itemmasterGroups[0]);
//    console.log("Item object:", itemmasterItems[0]);
//    console.log("Remark object:", remarksData[0]);

//    // ✅ Only translate groups if they have a proper group_code that exists in translations
//    itemmasterGroups.forEach(group => {
//        if (group.group_code) {
//            group.display_name = getTranslatedName(
//                group.group_code,
//                group.modifier_name,
//                selectedLang,
//                "category"
//            );
//        } else {
//            // Keep original modifier_name if no group_code
//            group.display_name = group.modifier_name;
//        }
//    });

//    // ✅ Translate items (this should work)
//    itemmasterItems.forEach(item => {
//        item.display_name = getTranslatedName(
//            item.citem_no,
//            item.citem_name,
//            selectedLang,
//            "item"
//        );
//    });

//    // ✅ Translate remarks if they exist
//    if (Array.isArray(remarksData) && remarksData.length > 0) {
//        remarksData.forEach(r => {
//            r.display_name = getTranslatedName(
//                r.remark_no,
//                r.remark_name || r.remarkName,
//                selectedLang,
//                "item"
//            );
//        });
//    }

//    // Build remarks section
//    let remarksSection = '';
//    if (remarksData?.length) {
//        remarksSection = remarksData.map(group => {
//            const groupName = group.remarks_group || 'unknown_group';
//            const fieldName = `addon_${groupName.replace(/\s+/g, '_')}`;
//            const remarksList = group.remarks_details || [];
//            if (!remarksList.length) return '';

//            return `
//            <div class="addon-category border border-gray-200 rounded-lg p-4 shadow-sm bg-gray-50"
//                 data-category-code="${groupName}"
//                 data-max-selectable="1"
//                 data-optional="${group.remarks_group_type === 'S' ? 'N' : 'Y'}"
//                 data-type="remark">

//                <h3 class="addon-category-title text-sm text-gray-600 mb-3 font-semibold uppercase tracking-wide">
//                    ${groupName}
//                </h3>

//                <div class="error-message text-sm text-red-600 hidden mb-2">Please select one option for this group.</div>

//                <div class="addon-options-wrapper" style="display: block;">
//                    <div class="addon-options grid grid-cols-1 sm:grid-cols-2 gap-3">
//                        ${remarksList.map(item => `
//                            <label class="addon-label block cursor-pointer">
//                                <input 
//                                    type="checkbox"
//                                    name="${fieldName}"
//                                    value="${item.seq_no}"
//                                    data-remark-text="${item.remarks}"
//                                    class="addon-checkbox mr-2"
//                                    required
//                                >
//                                <span class="checkbox-custom"></span>
//                                <span class="addon-text">${item.remarks}</span>
//                            </label>
//                        `).join('')}
//                    </div>
//                </div>
//            </div>`;
//        }).join('');
//    }

//    // Build itemmaster section (qty controls)
//    let itemmasterSection = '';
//    if (itemmasterGroups.length && itemmasterItems.length) {
//        const groupsArr = itemmasterGroups
//            .slice()
//            .sort((a, b) => (a.item_menutype_grpdtls || 9999) - (b.item_menutype_grpdtls || 9999));

//        itemmasterSection = groupsArr.map(group => {
//            const availableModifierItems = getAvailableModifierItems(baseItem, group);
//            if (!availableModifierItems.length) return '';
//            const maxQty = group.max_qty;
//            const groupLimit = group.group_limit || 0;

//            return `
//        <div class="addon-category border border-gray-200 rounded-lg p-4 shadow-sm bg-gray-50" 
//             data-category-code="${group.modifier_name}" 
//             data-max-qty="${maxQty}" 
//             data-group-limit="${groupLimit}"
//             data-optional="${group.is_optional}">
//            <h3 class="addon-category-title text-sm text-gray-600 mb-3 font-semibold uppercase tracking-wide flex justify-between items-center cursor-pointer">
//              <span>${group.display_name} (<span class="selected-count" data-category="${group.modifier_name}">0</span> / ${maxQty})</span>
//            </h3>
//            <div class="addon-options-wrapper">
//                <div class="addon-options grid grid-cols-1 sm:grid-cols-2 gap-3">
//                    ${availableModifierItems.map(dtl => {
//                const price = getPriceByServiceType(dtl.price_dtls?.[0]);
//                const priceDisplay = price > 0 ? ` (+$${price.toFixed(2)})` : '';
//                const soldOutText = dtl.isSoldOut ? ' (Sold Out)' : '';
//                return `
//                               <div class="flex justify-between items-center gap-4">
//                                   <div class="text-sm">${dtl.display_name}${priceDisplay}${soldOutText}</div>
//                                   <div class="qty-control flex gap-2 items-center"
//                                        data-item-id="${dtl.citem_no}"
//                                        data-item-name="${dtl.display_name}"
//                                        data-price="${price}"
//                                        data-category="${group.modifier_name}">
//                                       <button type="button" class="decrement px-2 rounded bg-gray-200">−</button>
//                                       <span class="qty-count w-6 text-center">0</span>
//                                       <button type="button" class="increment px-2 rounded bg-gray-200">+</button>
//                                   </div>
//                               </div>`;
//            }).join('')}
//                </div>
//            </div>
//        </div>`;
//        }).join('');
//    }

//    // Load add-ons data fresh by add_on_name
//    // Load add-ons data fresh by add_on_name
//    addonData = getAddonsByAddOnName(baseItem.add_on_name);

//    // ✅ Translate addon categories (same pattern as itemmasterGroups)
//    if (addonData?.cat_dtls) {
//        addonData.cat_dtls.forEach(cat => {
//            if (cat.category_code) {
//                cat.display_name = getTranslatedName(
//                    cat.category_code,
//                    cat.category_name || cat.modifier_name || cat.category_code,
//                    selectedLang,
//                    "category"
//                );
//            } else {
//                // Keep original category_name if no category_code
//                cat.display_name = cat.category_name || cat.modifier_name || cat.category_code;
//            }
//        });
//    }

//    // Build addon section (checkboxes)
//    let addonSection = '';
//    if (addonData && addonData.cat_dtls && addonData.item_dtls) {
//        const categories = addonData.cat_dtls
//            .filter(cat => cat.max_qty >= 0)
//            .sort((a, b) => a.seq_no - b.seq_no);

//        addonSection = categories.map(cat => {
//            const inputType = 'checkbox';
//            const maxSelectable = cat.max_qty;
//            const fieldName = `addon_${cat.category_code.replace(/\s+/g, '_')}`;
//            const isOptional = cat.is_optional === 'Y';
//            const options = addonData.item_dtls.filter(opt => opt.category_code === cat.category_code);

//            return `
//        <div class="addon-category border border-gray-200 rounded-lg p-4 shadow-sm bg-gray-50"
//             data-category-code="${cat.category_code}"
//             data-max-selectable="${maxSelectable}"
//             data-optional="${cat.is_optional || 'Y'}"
//             data-type="addon">
//                <h3 class="addon-category-title text-sm text-gray-600 mb-3 font-semibold uppercase tracking-wide">
//                  ${cat.display_name}
//                </h3>
//                <div class="addon-options-wrapper" style="display: block;">
//                  <div class="addon-options grid grid-cols-1 sm:grid-cols-2 gap-3">
//                    ${options.map(opt => {
//                const price = parseFloat(opt.price) || 0;
//                const priceDisplay = price > 0 ? ` (+$${price.toFixed(2)})` : '';
//                const inputName = fieldName;

//                return `
//                        <label class="addon-label block cursor-pointer">
//                          <input
//                            type="${inputType}"
//                            name="${inputName}"
//                            value="${opt.item_no}"
//                            data-price="${price}"
//                            data-item-name="${getTranslatedName(opt.item_no, opt.item_desc, selectedLang, "item")}"
//                            data-modifier-name="${cat.category_code}"
//                            data-category-code="${cat.category_code}"
//                            class="addon-checkbox mr-2"
//                            ${!isOptional ? 'required' : ''}
//                            ${opt.isSoldOut ? 'disabled' : ''}
//                          />
//                          <span class="checkbox-custom ${inputType === 'checkbox' ? 'rounded-full' : ''}"></span>
//                          <span class="addon-text">
//                            ${getTranslatedName(opt.item_no, opt.item_desc, selectedLang, "item")}
//                            ${priceDisplay}${opt.isSoldOut ? ' (Sold Out)' : ''}
//                          </span>
//                        </label>`;
//            }).join('')}
//                  </div>
//                </div>
//        </div>`;
//        }).join('');
//    }
//    // Insert HTML into modal
//    modalContent.innerHTML = `
//        <div class="modal-header">
//            <h2 class="modal-title">Select Add-ons for</h2>
//            <p class="modal-item-name font-semibold">${baseItem.item_name}</p>
//        </div>
//        <form id="addonForm" class="addon-form space-y-6">
//            ${itemmasterSection}
//            ${addonSection}
//            ${remarksSection}
//        </form>
//        <button id="confirmAddons" class="btn-add-to-cart mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 opacity-50 cursor-not-allowed" disabled>
//          Add to Cart
//        </button>   
//        <button id="updateAddOns" class="btn-add-to-cart mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 opacity-50 cursor-not-allowed" style="display:none;">
//          Update Cart
//        </button>
//    `;

//    // UNIFIED CHECKBOX LOGIC - Handles both addons and remarks
//    function bindUnifiedCheckboxLogic() {
//        document.querySelectorAll('.addon-category').forEach(group => {
//            const maxSelectable = parseInt(group.dataset.maxSelectable || '0', 10);
//            const categoryType = group.dataset.type; // 'addon', 'remark', or undefined
//            const categoryCode = group.dataset.categoryCode;
//            const optional = group.dataset.optional === 'Y';
//            const checkboxes = group.querySelectorAll('.addon-checkbox');

//            if (checkboxes.length === 0) return;

//            // Remove required if optional
//            if (optional) {
//                checkboxes.forEach(input => input.removeAttribute("required"));
//            }

//            function updateCheckboxState() {
//                const checked = Array.from(checkboxes).filter(cb => cb.checked);

//                // Enforce max selectable limit
//                if (maxSelectable > 0 && checked.length >= maxSelectable) {
//                    checkboxes.forEach(cb => {
//                        if (!cb.checked && !cb.disabled) cb.disabled = true;
//                    });
//                    group.classList.add('collapsed');
//                } else {
//                    checkboxes.forEach(cb => {
//                        // Only re-enable if not sold out
//                        const isSoldOut = cb.hasAttribute('disabled') && cb.dataset.soldOut === 'true';
//                        if (!isSoldOut) cb.disabled = false;
//                    });
//                    group.classList.remove('collapsed');
//                }

//                // Sync label styling
//                checkboxes.forEach(cb => {
//                    const label = cb.closest('.addon-label');
//                    if (label) label.classList.toggle('selected', cb.checked);
//                });
//            }

//            // Single-select behavior for max=1 (radio-like)
//            if (maxSelectable === 1) {
//                checkboxes.forEach(checkbox => {
//                    checkbox.addEventListener('change', () => {
//                        if (checkbox.checked) {
//                            checkboxes.forEach(cb => {
//                                if (cb !== checkbox) cb.checked = false;
//                            });
//                        } else {
//                            if (!optional) {
//                                checkbox.checked = true;
//                            }
//                        }
//                    });
//                });
//            }

//            // Main checkbox change handler
//            checkboxes.forEach(cb => {
//                cb.addEventListener('change', () => {
//                    const isChecked = cb.checked;
//                    const itemNo = cb.value;
//                    const itemName = cb.dataset.itemName || cb.dataset.remarkText;
//                    const price = parseFloat(cb.dataset.price || 0);

//                    // Process addons through addAddonItem (not remarks)
//                    if (categoryType === 'addon' && categoryCode) {
//                        const addonGroup = addonData?.cat_dtls?.find(
//                            cat => cat.category_code === categoryCode
//                        );

//                        if (addonGroup) {
//                            const addonItem = {
//                                item_no: itemNo,
//                                item_desc: itemName,
//                                category_code: categoryCode,
//                                price: price,
//                                qty: 1
//                            };

//                            window.selectedAddons = window.selectedAddons || [];

//                            if (isChecked) {
//                                const { selectionItems, exceed } = addAddonItem(
//                                    addonGroup,
//                                    addonItem,
//                                    window.selectedAddons
//                                );

//                                if (!exceed) {
//                                    window.selectedAddons = selectionItems.map(item => ({
//                                        ...item,
//                                        parent_sno: 1,
//                                        ds_no: 1,
//                                        seat_no: 1
//                                    }));
//                                    console.log('✅ Added addon:', itemName);
//                                } else {
//                                    cb.checked = false;
//                                    console.warn('⚠️ Addon limit exceeded for:', categoryCode);
//                                }
//                            } else {
//                                window.selectedAddons = window.selectedAddons.filter(
//                                    item => !(item.item_no === itemNo && item.category_code === categoryCode)
//                                );
//                                console.log('🗑️ Removed addon:', itemName);
//                            }

//                            console.log('📦 Current selectedAddons:', window.selectedAddons);
//                        }
//                    }

//                    updateCheckboxState();
//                    if (typeof validateAddToCart === 'function') {
//                        validateAddToCart();
//                    }
//                });
//            });

//            updateCheckboxState();
//        });
//    }

//    function updateCategoryCount(categoryCode) {
//        const category = document.querySelector(`.addon-category[data-category-code="${categoryCode}"]`);
//        if (!category) return;

//        const counts = [...category.querySelectorAll('.qty-count')]
//            .map(el => parseInt(el.textContent, 10) || 0);
//        const total = counts.reduce((a, b) => a + b, 0);

//        const selectedCountEl = category.querySelector(`.selected-count[data-category="${categoryCode}"]`);
//        if (selectedCountEl) selectedCountEl.textContent = total;

//        const max = parseInt(category.dataset.maxQty || "0", 10);
//        category.querySelectorAll('.increment').forEach(btn => {
//            if (max > 0 && total >= max) {
//                btn.disabled = true;
//                btn.classList.add('opacity-50', 'cursor-not-allowed');
//            } else {
//                btn.disabled = false;
//                btn.classList.remove('opacity-50', 'cursor-not-allowed');
//            }
//        });

//        const wrapper = category.querySelector(".addon-options-wrapper");
//        if (wrapper) {
//            if (max > 0 && total >= max) {
//                wrapper.classList.add("collapsed");
//            } else {
//                wrapper.classList.remove("collapsed");
//            }
//        }
//    }

//    function attachQtyControls(container) {
//        const root = (typeof container === 'string') ? document.getElementById(container) : container;
//        if (!root) return;

//        function normalizeItem(item) {
//            return {
//                ...item,
//                itemmaster_menutype_grpdtls: Array.isArray(item?.itemmaster_menutype_grpdtls)
//                    ? item.itemmaster_menutype_grpdtls
//                    : [],
//                itemmaster_menutypedtls: Array.isArray(item?.itemmaster_menutypedtls)
//                    ? item.itemmaster_menutypedtls
//                    : []
//            };
//        }

//        const normalizedBaseItem = normalizeItem(baseItem);
//        window.selectedAddons = window.selectedAddons || [];

//        root.querySelectorAll('.qty-control').forEach(control => {
//            const decrementBtn = control.querySelector('.decrement');
//            const incrementBtn = control.querySelector('.increment');
//            const countSpan = control.querySelector('.qty-count');
//            const categoryCode = control.dataset.category;
//            const itemId = control.dataset.itemId;

//            function updateUI(newQty) {
//                countSpan.textContent = newQty;
//                if (newQty <= 0) {
//                    decrementBtn.disabled = true;
//                    decrementBtn.classList.add('opacity-50', 'cursor-not-allowed');
//                } else {
//                    decrementBtn.disabled = false;
//                    decrementBtn.classList.remove('opacity-50', 'cursor-not-allowed');
//                }
//                updateCategoryCount(categoryCode);
//            }

//            function handleQtyChange(newQty) {
//                updateUI(newQty);
//                let selectedGroup = window.itemmasterGroups?.find(g => g.modifier_name === categoryCode);
//                let selectedItem = window.itemmasterItems?.find(i => i.citem_no === itemId);

//                if (selectedGroup && selectedItem) {
//                    const normalizedItem = {
//                        ...selectedItem,
//                        citem_no: itemId,
//                        citem_name: control.dataset.itemName,
//                        modifier_name: selectedGroup.modifier_name || categoryCode,
//                    };

//                    window.selectedAddons = window.selectedAddons.map(item => ({
//                        ...item,
//                        parent_sno: 1,
//                        ds_no: 1,
//                        seat_no: 1
//                    }));

//                    const existingItem = window.selectedAddons.find(
//                        item => item.item_no === itemId && item.modifier_name === categoryCode
//                    );

//                    if (existingItem && newQty > 0) {
//                        const { selectionItems: updatedItems, exceed } = changeModifierItemQty(
//                            newQty,
//                            selectedGroup,
//                            normalizedItem,
//                            window.selectedAddons
//                        );

//                        if (!exceed) {
//                            window.selectedAddons = updatedItems.map(item => ({
//                                ...item,
//                                parent_sno: 1,
//                                ds_no: 1,
//                                seat_no: 1
//                            }));
//                        }
//                    } else if (existingItem && newQty === 0) {
//                        const { selectionItems: updatedItems } = changeModifierItemQty(
//                            0,
//                            selectedGroup,
//                            normalizedItem,
//                            window.selectedAddons
//                        );

//                        window.selectedAddons = updatedItems.map(item => ({
//                            ...item,
//                            parent_sno: 1,
//                            ds_no: 1,
//                            seat_no: 1
//                        }));
//                    } else if (!existingItem && newQty > 0) {
//                        const itemToAdd = {
//                            ...normalizedItem,
//                            qty: newQty,
//                            menu_type: selectedItem.menu_type,
//                            level_no: selectedItem.level_no || 0,
//                        };

//                        const { selectionItems: updatedItems, exceed } = addModifierItem(
//                            selectedGroup,
//                            itemToAdd,
//                            window.selectedAddons
//                        );

//                        if (!exceed) {
//                            window.selectedAddons = updatedItems.map(item => ({
//                                ...item,
//                                parent_sno: 1,
//                                ds_no: 1,
//                                seat_no: 1
//                            }));
//                        }
//                    }
//                }

//                console.log('🎯 Selected Addons:', window.selectedAddons);
//            }

//            incrementBtn.addEventListener('click', () => {
//                let qty = parseInt(countSpan.textContent, 10) || 0;
//                handleQtyChange(qty + 1);
//            });

//            decrementBtn.addEventListener('click', () => {
//                let qty = parseInt(countSpan.textContent, 10) || 0;
//                handleQtyChange(Math.max(0, qty - 1));
//            });

//            updateUI(parseInt(countSpan.textContent, 10) || 0);
//        });
//    }

//    function bindCollapseToggles() {
//        document.querySelectorAll(".addon-category-title").forEach(title => {
//            title.addEventListener("click", () => {
//                const group = title.closest(".addon-category");
//                const wrapper = group.querySelector(".addon-options-wrapper");
//                if (!wrapper) return;

//                const isCurrentlyCollapsed = group.classList.contains("collapsed");

//                if (isCurrentlyCollapsed) {
//                    group.classList.remove("collapsed");
//                    wrapper.classList.remove("collapsed");
//                    wrapper.style.display = 'block';
//                } else {
//                    group.classList.add("collapsed");
//                    wrapper.classList.add("collapsed");
//                    wrapper.style.display = 'none';
//                }
//            });
//        });
//    }

//    function autoCollapseOnMaxQty() {
//        const categories = document.querySelectorAll('.addon-category');

//        categories.forEach(category => {
//            const maxQty = parseInt(category.dataset.maxQty || '0', 10);
//            if (maxQty <= 0) return;

//            const qtyCounts = category.querySelectorAll('.qty-count');
//            const totalQty = Array.from(qtyCounts).reduce((sum, qtySpan) =>
//                sum + (parseInt(qtySpan.textContent || '0', 10)), 0
//            );

//            const wrapper = category.querySelector('.addon-options-wrapper');
//            if (!wrapper) return;

//            if (totalQty >= maxQty) {
//                category.classList.add('collapsed');
//                wrapper.classList.add('collapsed');
//                wrapper.style.display = 'none';
//            } else if (totalQty > 0) {
//                category.classList.remove('collapsed');
//                wrapper.classList.remove('collapsed');
//                wrapper.style.display = 'block';
//            }
//        });
//    }

//    function initAddonModal() {
//        document.querySelectorAll('.addon-category').forEach(cat => {
//            const categoryCode = cat.dataset.categoryCode;
//            updateCategoryCount(categoryCode);
//        });

//        attachQtyControls(document.getElementById('addonModalContent'));
//        bindUnifiedCheckboxLogic();
//        bindCollapseToggles();
//        autoCollapseOnMaxQty();
//    }

//    initAddonModal();

//    // Show modal
//    modal.style.display = 'flex';
//    modal.onclick = (e) => { if (e.target === modal) closeAddonModal(); };

//    if (typeof validateAddonSelections === 'function') {
//        validateAddonSelections();
//    }

//    // Confirm button handler
//    document.getElementById('confirmAddons').addEventListener('click', () => {
//        // Validate before proceeding
//        if (!validateAndSubmit()) {
//            return; // Stop if validation fails
//        }

//        const selectedRemarks = gatherSelectedRemarksFromModal();
//        const selectedAddons = gatherSelectedAddonsFromModal();

//        console.log("📦 Confirmed Addons:", selectedAddons);
//        console.log("💬 Confirmed Remarks:", selectedRemarks);

//        addToCart(window.currentBaseItemId, selectedAddons, selectedRemarks, null, true);

//        if (typeof onConfirm === 'function') {
//            onConfirm(selectedAddons, selectedRemarks);
//        }

//        closeAddonModal();
//    });
//}

function updateCategoryCount(categoryCode) {
    const category = document.querySelector(`.addon-category[data-category-code="${categoryCode}"]`);
    if (!category) return;

    const counts = [...category.querySelectorAll('.qty-count')]
        .map(el => parseInt(el.textContent, 10) || 0);
    const total = counts.reduce((a, b) => a + b, 0);

    const selectedCountEl = category.querySelector(`.selected-count[data-category="${categoryCode}"]`);
    if (selectedCountEl) selectedCountEl.textContent = total;

    const max = parseInt(category.dataset.maxQty || "0", 10);

    category.querySelectorAll('.increment').forEach(btn => {
        if (max > 0 && total >= max) {
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    });

    const wrapper = category.querySelector(".addon-options-wrapper");
    if (wrapper) {
        if (max > 0 && total >= max) {
            wrapper.classList.add("collapsed");
        } else {
            wrapper.classList.remove("collapsed");
        }
    }
}

function attachQtyControls(container) {
    const root = (typeof container === 'string') ? document.getElementById(container) : container;
    if (!root) return;

    root.querySelectorAll('.qty-control').forEach(control => {
        const decrementBtn = control.querySelector('.decrement');
        const incrementBtn = control.querySelector('.increment');
        const countSpan = control.querySelector('.qty-count');
        const categoryCode = control.dataset.category;
        const itemId = control.dataset.itemId;

        function updateUI(newQty) {
            countSpan.textContent = newQty;

            if (newQty <= 0) {
                decrementBtn.disabled = true;
                decrementBtn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                decrementBtn.disabled = false;
                decrementBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }

            updateCategoryCount(categoryCode);

            // Trigger validation after UI update
            if (typeof validateAddToCart === 'function') {
                validateAddToCart();
            }
        }

        function handleQtyChange(newQty) {
            updateUI(newQty);

            let selectedGroup = window.itemmasterGroups?.find(g => g.modifier_name === categoryCode);
            let selectedItem = window.itemmasterItems?.find(i => i.citem_no === itemId);

            if (selectedGroup && selectedItem) {
                const normalizedItem = {
                    ...selectedItem,
                    citem_no: itemId,
                    citem_name: control.dataset.itemName,
                    modifier_name: selectedGroup.modifier_name || categoryCode,
                };

                window.selectedAddons = window.selectedAddons.map(item => ({
                    ...item,
                    parent_sno: 1,
                    ds_no: 1,
                    seat_no: 1
                }));

                const existingItem = window.selectedAddons.find(
                    item => item.item_no === itemId && item.modifier_name === categoryCode
                );

                if (existingItem && newQty > 0) {
                    const { selectionItems: updatedItems, exceed } = changeModifierItemQty(
                        newQty,
                        selectedGroup,
                        normalizedItem,
                        window.selectedAddons
                    );

                    if (!exceed) {
                        window.selectedAddons = updatedItems.map(item => ({
                            ...item,
                            parent_sno: 1,
                            ds_no: 1,
                            seat_no: 1
                        }));
                    }
                } else if (existingItem && newQty === 0) {
                    const { selectionItems: updatedItems } = changeModifierItemQty(
                        0,
                        selectedGroup,
                        normalizedItem,
                        window.selectedAddons
                    );

                    window.selectedAddons = updatedItems.map(item => ({
                        ...item,
                        parent_sno: 1,
                        ds_no: 1,
                        seat_no: 1
                    }));
                } else if (!existingItem && newQty > 0) {
                    const itemToAdd = {
                        ...normalizedItem,
                        qty: newQty,
                        menu_type: selectedItem.menu_type,
                        level_no: selectedItem.level_no || 0,
                    };

                    const { selectionItems: updatedItems, exceed } = addModifierItem(
                        selectedGroup,
                        itemToAdd,
                        window.selectedAddons
                    );

                    if (!exceed) {
                        window.selectedAddons = updatedItems.map(item => ({
                            ...item,
                            parent_sno: 1,
                            ds_no: 1,
                            seat_no: 1
                        }));
                    }
                }
            }

            console.log('🎯 Selected Addons:', window.selectedAddons);
        }

        incrementBtn.addEventListener('click', () => {
            let qty = parseInt(countSpan.textContent, 10) || 0;
            handleQtyChange(qty + 1);
        });

        decrementBtn.addEventListener('click', () => {
            let qty = parseInt(countSpan.textContent, 10) || 0;
            handleQtyChange(Math.max(0, qty - 1));
        });

        updateUI(parseInt(countSpan.textContent, 10) || 0);
    });
}

function bindCollapseToggles() {
    document.querySelectorAll(".addon-category-title").forEach(title => {
        title.addEventListener("click", () => {
            const group = title.closest(".addon-category");
            const wrapper = group.querySelector(".addon-options-wrapper");
            if (!wrapper) return;

            const isCurrentlyCollapsed = group.classList.contains("collapsed");

            if (isCurrentlyCollapsed) {
                group.classList.remove("collapsed");
                wrapper.classList.remove("collapsed");
                wrapper.style.display = 'block';
            } else {
                group.classList.add("collapsed");
                wrapper.classList.add("collapsed");
                wrapper.style.display = 'none';
            }
        });
    });
}

function autoCollapseOnMaxQty() {
    const categories = document.querySelectorAll('.addon-category');

    categories.forEach(category => {
        const maxQty = parseInt(category.dataset.maxQty || '0', 10);
        if (maxQty <= 0) return;

        const qtyCounts = category.querySelectorAll('.qty-count');
        const totalQty = Array.from(qtyCounts).reduce(
            (sum, qtySpan) => sum + (parseInt(qtySpan.textContent || '0', 10)),
            0
        );

        const wrapper = category.querySelector('.addon-options-wrapper');
        if (!wrapper) return;

        if (totalQty >= maxQty) {
            category.classList.add('collapsed');
            wrapper.classList.add('collapsed');
            wrapper.style.display = 'none';
        } else if (totalQty > 0) {
            category.classList.remove('collapsed');
            wrapper.classList.remove('collapsed');
            wrapper.style.display = 'block';
        }
    });
}

// ============================================
// PREFILL LOGIC FOR EDIT MODE
// ============================================

function prefillEditData(prefilledAddons, prefilledRemarks, addonData) {
    console.log('🔄 Prefilling edit data...', { prefilledAddons, prefilledRemarks });

    if (prefilledAddons?.length) {
        prefilledAddons.forEach(addon => {
            console.log('🔍 Processing addon:', addon);

            // Try to find as qty control first (itemmaster items)
            let qtyControl = document.querySelector(
                `.qty-control[data-item-id="${addon.item_no}"]`
            );

            if (qtyControl) {
                // This is an itemmaster item with quantity controls
                const qtySpan = qtyControl.querySelector('.qty-count');
                const decrementBtn = qtyControl.querySelector('.decrement');

                if (qtySpan) {
                    const qty = addon.qty || 0;
                    qtySpan.textContent = qty;

                    // Update button states
                    if (qty > 0) {
                        decrementBtn.disabled = false;
                        decrementBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                    }

                    const categoryCode = qtyControl.dataset.category;
                    if (categoryCode) {
                        updateCategoryCount(categoryCode);
                    }

                    console.log('✅ Prefilled qty control:', addon.item_no, qty);
                }
            } else {
                // This is an addon checkbox - try to find it by item_no only
                let checkbox = document.querySelector(
                    `.addon-checkbox[value="${addon.item_no}"]`
                );

                if (checkbox) {
                    console.log('📌 Found checkbox for:', addon.item_no, 'disabled:', checkbox.disabled);

                    if (!checkbox.disabled) {
                        checkbox.checked = true;

                        // Get category info from checkbox
                        const categoryCode = checkbox.dataset.categoryCode;
                        const price = parseFloat(checkbox.dataset.price || 0);
                        const itemName = checkbox.dataset.itemName;

                        console.log('📦 Checkbox data:', { categoryCode, price, itemName });

                        // Manually add to selectedAddons if using addAddonItem
                        if (categoryCode && addonData?.cat_dtls) {
                            const addonGroup = addonData.cat_dtls.find(
                                cat => cat.category_code === categoryCode
                            );

                            if (addonGroup) {
                                const addonItem = {
                                    item_no: addon.item_no,
                                    item_desc: itemName,
                                    category_code: categoryCode,
                                    price: price,
                                    qty: 1
                                };

                                window.selectedAddons = window.selectedAddons || [];
                                const { selectionItems, exceed } = addAddonItem(
                                    addonGroup,
                                    addonItem,
                                    window.selectedAddons
                                );

                                if (!exceed) {
                                    window.selectedAddons = selectionItems.map(item => ({
                                        ...item,
                                        parent_sno: 1,
                                        ds_no: 1,
                                        seat_no: 1
                                    }));
                                    console.log('✅ Added to selectedAddons:', addon.item_no);
                                }
                            }
                        }

                        // Update UI state
                        const label = checkbox.closest('.addon-label');
                        if (label) label.classList.add('selected');

                        console.log('✅ Prefilled addon checkbox:', addon.item_no);
                    } else {
                        console.warn('⚠️ Checkbox is disabled:', addon.item_no);
                    }
                } else {
                    console.warn('⚠️ Checkbox not found for:', addon.item_no);
                }
            }
        });
    }

    // Prefill remarks
    if (prefilledRemarks?.length) {
        prefilledRemarks.forEach(remark => {
            let checkbox = document.querySelector(
                `.addon-checkbox[data-remark-text="${remark.remarks}"]`
            );

            if (!checkbox && remark.seq_no) {
                checkbox = document.querySelector(
                    `.addon-checkbox[value="${remark.seq_no}"]`
                );
            }

            if (checkbox && !checkbox.disabled) {
                checkbox.checked = true;
                const label = checkbox.closest('.addon-label');
                if (label) label.classList.add('selected');
                console.log('✅ Prefilled remark:', remark.remarks);
            } else {
                console.warn('⚠️ Remark checkbox not found or disabled:', remark.remarks);
            }
        });
    }

    console.log('🎯 Final selectedAddons after prefill:', window.selectedAddons);

    // Re-run validation after prefilling
    if (typeof validateAddToCart === 'function') {
        setTimeout(() => validateAddToCart(), 50);
    }
}


//function attachQtyControls(container, baseItem) {
//    const root = (typeof container === 'string') ? document.getElementById(container) : container;
//    if (!root) return;

//    function normalizeItem(item) {
//        return {
//            ...item,
//            itemmaster_menutype_grpdtls: Array.isArray(item?.itemmaster_menutype_grpdtls)
//                ? item.itemmaster_menutype_grpdtls
//                : [],
//            itemmaster_menutypedtls: Array.isArray(item?.itemmaster_menutypedtls)
//                ? item.itemmaster_menutypedtls
//                : []
//        };
//    }

//    const normalizedBaseItem = normalizeItem(baseItem);

//    // ✅ make sure we have a global selectedAddons array
//    window.selectedAddons = window.selectedAddons || [];

//    root.querySelectorAll('.qty-control').forEach(control => {
//        const decrementBtn = control.querySelector('.decrement');
//        const incrementBtn = control.querySelector('.increment');
//        const countSpan = control.querySelector('.qty-count');
//        const categoryCode = control.dataset.category;
//        const itemId = control.dataset.itemId;

//        function updateUI(newQty) {
//            countSpan.textContent = newQty;
//            if (newQty <= 0) {
//                decrementBtn.disabled = true;
//                decrementBtn.classList.add('opacity-50', 'cursor-not-allowed');
//            } else {
//                decrementBtn.disabled = false;
//                decrementBtn.classList.remove('opacity-50', 'cursor-not-allowed');
//            }
//            updateCategoryCount(categoryCode);
//        }

//        window.tempAddonCache = window.tempAddonCache || [];

//        function handleQtyChange(newQty) {
//            updateUI(newQty);

//            let selectedGroup = window.itemmasterGroups?.find(g => g.modifier_name === categoryCode);
//            let selectedItem = window.itemmasterItems?.find(i => i.citem_no === itemId);

//            if (selectedGroup && selectedItem) {
//                const normalizedItem = {
//                    ...selectedItem,
//                    citem_no: itemId,
//                    citem_name: control.dataset.itemName,
//                    modifier_name: selectedGroup.modifier_name || categoryCode,
//                };

//                const existingItem = window.selectedAddons.find(
//                    item => item.item_no === itemId && item.modifier_name === categoryCode
//                );

//                if (existingItem && newQty > 0) {
//                    const { selectionItems: updatedItems, exceed } = changeModifierItemQty(
//                        newQty,
//                        selectedGroup,
//                        normalizedItem,
//                        window.selectedAddons
//                    );

//                    if (!exceed) {
//                        // 🔹 enforce linkage
//                        window.selectedAddons = updatedItems.map(a => ({
//                            ...a,
//                            parent_sno: normalizedBaseItem.s_no || 1,
//                            ds_no: normalizedBaseItem.ds_no || 1,
//                            seat_no: normalizedBaseItem.seat_no || 1,
//                        }));
//                    }
//                } else if (existingItem && newQty === 0) {
//                    const { selectionItems: updatedItems } = changeModifierItemQty(
//                        0,
//                        selectedGroup,
//                        normalizedItem,
//                        window.selectedAddons
//                    );

//                    window.selectedAddons = updatedItems.map(a => ({
//                        ...a,
//                        parent_sno: normalizedBaseItem.s_no || 1,
//                        ds_no: normalizedBaseItem.ds_no || 1,
//                        seat_no: normalizedBaseItem.seat_no || 1,
//                    }));
//                } else if (!existingItem && newQty > 0) {
//                    const itemToAdd = {
//                        ...normalizedItem,
//                        qty: newQty,
//                        menu_type: selectedItem.menu_type || "C",
//                        level_no: selectedItem.level_no || 0,
//                        parent_sno: normalizedBaseItem.s_no || 1,  // 🔹 new
//                        ds_no: normalizedBaseItem.ds_no || 1,      // 🔹 new
//                        seat_no: normalizedBaseItem.seat_no || 1,  // 🔹 new
//                    };

//                    const { selectionItems: updatedItems, exceed } = addModifierItem(
//                        selectedGroup,
//                        itemToAdd,
//                        window.selectedAddons
//                    );

//                    if (!exceed) {
//                        window.selectedAddons = updatedItems.map(a => ({
//                            ...a,
//                            parent_sno: normalizedBaseItem.s_no || 1,
//                            ds_no: normalizedBaseItem.ds_no || 1,
//                            seat_no: normalizedBaseItem.seat_no || 1,
//                        }));
//                    }
//                }
//            } else {
//                console.warn(`⚠️ Item ${itemId} in category ${categoryCode} not found in itemmaster data.`);
//            }

//            // Update cache
//            const cacheKey = `${normalizedBaseItem.item_no}_${itemId}`;
//            const existingIndex = window.tempAddonCache?.findIndex(c => c.cacheKey === cacheKey);

//            if (existingIndex >= 0) {
//                window.tempAddonCache[existingIndex] = {
//                    cacheKey,
//                    selectionItems: window.selectedAddons,
//                    exceed: false
//                };
//            } else {
//                window.tempAddonCache = window.tempAddonCache || [];
//                window.tempAddonCache.push({
//                    cacheKey,
//                    selectionItems: window.selectedAddons,
//                    exceed: false
//                });
//            }

//            console.log('🎯 Selected Addons (proper flow):', window.selectedAddons);
//        }

//        incrementBtn.addEventListener('click', () => {
//            let qty = parseInt(countSpan.textContent, 10) || 0;
//            handleQtyChange(qty + 1);
//        });

//        decrementBtn.addEventListener('click', () => {
//            let qty = parseInt(countSpan.textContent, 10) || 0;
//            handleQtyChange(Math.max(0, qty - 1));
//        });

//        updateUI(parseInt(countSpan.textContent, 10) || 0);
//    });
//}


//document.getElementById('confirmAddons').addEventListener('click', () => {
//    if (!validateAddToCart()) return;

//    const selectedAddons = [];
//    const selectedRemarks = [];

//    // 1. Collect remarks first
//    addonForm.querySelectorAll('.addon-category[data-max-selectable="1"] input[type="checkbox"]:checked').forEach(input => {
//        if (input.dataset.remarkText) {
//            selectedRemarks.push({
//                remarks: input.dataset.remarkText,
//                seq_no: input.value
//            });
//        }
//    });

//    // 2. Collect qty-controlled items (modifier groups)
//    addonForm.querySelectorAll('.qty-control').forEach(control => {
//        const qty = parseInt(control.querySelector('.qty-count').textContent, 10) || 0;
//        if (qty <= 0) return;

//        const itemId = control.dataset.itemId;
//        const price = parseFloat(control.dataset.price) || 0;
//        const modifierName = control.dataset.category || '';
//        const itemName = control.dataset.itemName || 'Unnamed';

//        selectedAddons.push({
//            item_no: itemId,
//            price: price,
//            modifier_name: modifierName,
//            qty: qty,
//            item_name: itemName,
//            group_code: ''
//        });
//    });

//    // 3. Collect checkbox addons (not remarks)
//    addonForm.querySelectorAll('.addon-category input[type="checkbox"]:checked').forEach(input => {
//        const itemNo = input.value;
//        const price = parseFloat(input.dataset.price) || 0;
//        const modifierName = input.dataset.modifierName || '';
//        const itemName = input.dataset.itemName || input.closest('label')?.querySelector('.addon-text')?.textContent?.replace(/\s*\(.*\)/, '').trim() || 'Unnamed';
//        selectedAddons.push({
//            item_no: itemNo,
//            price: price,
//            modifier_name: modifierName,
//            qty: 1,
//            item_name: itemName,
//            group_code: input.dataset.categoryCode || ''
//        });
//    });

//    console.log("Selected addons:", selectedAddons);
//    console.log("Selected remarks:", selectedRemarks);

//    onConfirm(selectedAddons, selectedRemarks);
//    closeAddonModal();
//});


//function attachQtyControls(container) {
//    // make sure container is an element, not a string
//    const root = (typeof container === 'string') ? document.getElementById(container) : container;
//    if (!root) return;

//    root.querySelectorAll('.qty-control').forEach(control => {
//        const decrementBtn = control.querySelector('.decrement');
//        const incrementBtn = control.querySelector('.increment');
//        const countSpan = control.querySelector('.qty-count');
//        const categoryCode = control.dataset.category;
//        const itemId = control.dataset.itemId;

//        function updateUI(newQty) {
//            countSpan.textContent = newQty;

//            if (newQty <= 0) {
//                decrementBtn.disabled = true;
//                decrementBtn.classList.add('opacity-50', 'cursor-not-allowed');
//            } else {
//                decrementBtn.disabled = false;
//                decrementBtn.classList.remove('opacity-50', 'cursor-not-allowed');
//            }

//            updateCategoryCount(categoryCode);
//        }

//        incrementBtn.addEventListener('click', () => {
//            let qty = parseInt(countSpan.textContent, 10) || 0;
//            const newQty = qty + 1;
//            updateUI(newQty);

//            if (typeof addModifierItem === 'function') {
//                let selectedAddons = gatherSelectedAddonsFromModal();

//                // normalize qty before passing (scale by main item qty)
//                selectedAddons = selectedAddons.map(addon => ({
//                    ...addon,
//                    qty: addon.qty * newQty
//                }));

//                const selectedGroup = itemmasterGroups.find(g => g.group_name === categoryCode);

//                // ✅ get full structured item from group
//                const selectedItem = selectedGroup?.itemmaster_menutypedtls?.find(
//                    i => i.citem_no === itemId
//                );

//                const enrichedItem = { ...selectedItem, qty: newQty };

//                addModifierItem(selectedGroup, enrichedItem, selectedAddons);

//                if (selectedGroup && selectedItem) {
//                    // ✅ update qty inside selectedItem before passing
//                    const enrichedItem = { ...selectedItem, qty: newQty };

//                    addModifierItem(selectedGroup, enrichedItem, selectedAddons);
//                }
//            }
//        });

//        decrementBtn.addEventListener('click', () => {
//            let qty = parseInt(countSpan.textContent, 10) || 0;
//            const newQty = Math.max(0, qty - 1); // prevent negative
//            updateUI(newQty);

//            if (typeof addModifierItem === 'function') {
//                let selectedAddons = gatherSelectedAddonsFromModal();

//                // normalize qty before passing (scale by main item qty)
//                selectedAddons = selectedAddons.map(addon => ({
//                    ...addon,
//                    qty: addon.qty * newQty
//                }));

//                const selectedGroup = itemmasterGroups.find(g => g.group_name === categoryCode);

//                // ✅ get full structured item from group
//                const selectedItem = selectedGroup?.itemmaster_menutypedtls?.find(
//                    i => i.citem_no === itemId
//                );

//                if (selectedGroup && selectedItem) {
//                    // ✅ update qty inside selectedItem before passing
//                    const enrichedItem = { ...selectedItem, qty: newQty };

//                    addModifierItem(selectedGroup, enrichedItem, selectedAddons);
//                }
//            }
//        });


//        // initialize UI
//        updateUI(parseInt(countSpan.textContent, 10) || 0);
//    });
//}

//document.getElementById('confirmAddons').addEventListener('click', () => {
//    if (!validateAddToCart()) return;

//    const addonData = getAddonsByAddOnName(window.currentBaseItemAddOnName || '');
//    const selectedAddons = [];
//    const selectedRemarks = [];

//    // Collect selected remarks
//    // Collect selected addons from checkboxes
//    addonForm.querySelectorAll('input[type="checkbox"]:checked').forEach(input => {
//        const itemNo = input.value;
//        const price = parseFloat(input.dataset.price) || 0;
//        const modifierName = input.dataset.modifierName || '';
//        const groupCode = input.dataset.categoryCode || '';
//        const itemName = input.closest('label')?.querySelector('.addon-text')?.textContent?.trim() || 'Unnamed';

//        // Check if this checkbox already exists in selectedAddons (avoid duplicates)
//        if (!selectedAddons.some(a => a.item_no === itemNo)) {
//            selectedAddons.push({
//                item_no: itemNo,
//                price,
//                modifier_name: modifierName,
//                qty: 1, // checkboxes default to 1, you can extend if needed
//                item_name: itemName,
//                group_code: groupCode,
//            });
//        }
//    });


//    function findAddonItemName(itemNo) {
//        let item = addonData?.item_dtls?.find(i => i.item_no === itemNo);
//        if (item) return item.item_name || item.item_desc || 'Unnamed';
//        if (typeof itemmasterItems !== 'undefined') {
//            item = itemmasterItems.find(i => i.citem_no === itemNo);
//            if (item) return item.citem_name || 'Unnamed';
//        }
//        return 'Unnamed';
//    }

//    // Collect all addons dynamically with qty
//    addonForm.querySelectorAll('.qty-control').forEach(control => {
//        const qty = parseInt(control.querySelector('.qty-count').textContent, 10) || 0;
//        if (qty <= 0) return;

//        const itemId = control.dataset.itemId;
//        const modifierName = control.dataset.category || '';
//        const groupCode = control.dataset.categoryCode || '';

//        const matchedItem = addonData?.item_dtls?.find(i => i.item_no === itemId)
//            || (typeof itemmasterItems !== 'undefined' && itemmasterItems.find(i => i.citem_no === itemId));

//        if (!matchedItem) return;

//        const priceDetails = matchedItem.price_dtls?.[0] || { default_price: parseFloat(matchedItem.price) || 0 };
//        const price = getPriceByServiceType(priceDetails, ''); // pass your current service type

//        const itemName = matchedItem?.item_name || matchedItem?.citem_name || findAddonItemName(itemId);

//        selectedAddons.push({
//            item_no: itemId,
//            price,
//            modifier_name: modifierName,
//            qty,
//            item_name: itemName,
//            group_code: groupCode,
//        });
//    });



//    // Collect checked addons (checkbox/radio) with dynamic qty if exists
//    addonForm.querySelectorAll('input[type="checkbox"]:checked').forEach(input => {
//        if (input.dataset.isAddon !== 'true') return; // skip remarks
//        const itemNo = input.value;
//        const qty = parseInt(input.dataset.qty || '1', 10) || 1; // read qty if provided
//        const price = parseFloat(input.dataset.price) || 0;
//        const modifierName = input.dataset.modifierName || '';
//        const groupCode = input.dataset.categoryCode || '';
//        const itemName = findAddonItemName(itemNo);

//        selectedAddons.push({
//            item_no: itemNo,
//            price,
//            modifier_name: modifierName,
//            qty,
//            item_name: input.closest('label')?.querySelector('.addon-text')?.textContent?.trim() || itemName,
//            group_code: groupCode,
//        });
//    });

//    if (selectedAddons.length === 0) {
//        selectedAddons.push({
//            item_no: window.currentBaseItemId,
//            price: baseItem.price_dtls?.[0]?.dine_in_price || 0,
//            modifier_name: '',  // no modifier
//            qty: 1,
//            item_name: baseItem.item_name || 'Unnamed',
//            group_code: '',
//        });
//    }


//    console.log("✅ Add-to-Cart:", selectedAddons, "Remarks:", selectedRemarks);

//    addToCart(window.currentBaseItemId, selectedAddons, selectedRemarks);
//    onConfirm(selectedAddons, selectedRemarks);
//    closeAddonModal();
//});

function updateButtonsForGroup(category) {
    const container = document.getElementById('addonModalContent');
    const allControls = container.querySelectorAll(`.qty-control[data-category="${category}"]`);
    const groupContainer = container.querySelector(`.addon-category[data-category-code="${category}"]`);
    const wrapperInner = groupContainer.querySelector('.addon-options-wrapper');

    const groupData = window.currentAddonData?.cat_dtls?.find(g => g.category_code === category);

    const maxQty = groupData?.max_qty || Infinity;
    const groupLimit = groupData?.group_limit || Infinity;
    const maxPerItem = groupData?.max_per_item || Infinity;

    let currentTotalQty = 0;
    let uniqueSelectedCount = 0;

    allControls.forEach(ctrl => {
        const qty = parseInt(ctrl.querySelector('.qty-count').textContent, 10);
        if (qty > 0) uniqueSelectedCount++;
        currentTotalQty += qty;
    });

    allControls.forEach(ctrl => {
        const btnInc = ctrl.querySelector('.increment');
        const btnDec = ctrl.querySelector('.decrement');
        const qty = parseInt(ctrl.querySelector('.qty-count').textContent, 10);
        const itemId = ctrl.dataset.itemId;

        const isCurrentItemSelected = qty > 0;

        const willExceedUnique = uniqueSelectedCount >= groupLimit && !isCurrentItemSelected;
        const willExceedTotalQty = currentTotalQty >= maxQty;
        const willExceedItem = qty >= maxPerItem;

        btnInc.disabled = willExceedItem || willExceedTotalQty || willExceedUnique;
        btnDec.disabled = qty === 0;

        // 🔹 Hook into addModifierItem when qty > 0
        if (qty > 0 && typeof addModifierItem === "function") {
            const modifierItem = {
                citem_no: itemId,
                citem_name: ctrl.dataset.itemName,
                uom: ctrl.dataset.uom || "UNIT",
                uom_cf: 1,
                qty
            };

            const grp = {
                modifier_name: ctrl.dataset.category || "",
                price_per: groupData?.price_per || 100
            };

            const selectionItems = window.cache?.pendingCartItem
                ? [...window.cache.pendingCartItem]
                : [];

            const { modiferItem, exceed } = addModifierItem(grp, modifierItem, selectionItems);

            if (!exceed && modiferItem) {
                const idx = selectionItems.findIndex(
                    i => i.item_no === modiferItem.item_no && i.parent_sno === modiferItem.parent_sno
                );
                if (idx >= 0) {
                    selectionItems[idx] = modiferItem;
                } else {
                    selectionItems.push(modiferItem);
                }
                window.cache.pendingCartItem = selectionItems;
            }
        }
    });

    // Collapse/expand category when max reached
    if (currentTotalQty >= maxQty) {
        if (wrapperInner.style.display !== 'none') {
            wrapperInner.style.display = 'none';
            groupContainer.classList.add('collapsed');
            groupContainer.querySelector('.addon-category-title')?.classList.add('collapsed');

            const nextGroup = groupContainer.nextElementSibling;
            if (nextGroup?.classList.contains('addon-category')) {
                nextGroup.scrollIntoView({ behavior: 'smooth' });
            }
        }
    } else {
        wrapperInner.style.display = '';
        groupContainer.classList.remove('collapsed');
        groupContainer.querySelector('.addon-category-title')?.classList.remove('collapsed');
    }
}


//function updateButtonsForGroup(category) {
//    const container = document.getElementById('addonModalContent');
//    const allControls = container.querySelectorAll(`.qty-control[data-category="${category}"]`);
//    const groupContainer = container.querySelector(`.addon-category[data-category-code="${category}"]`);
//    const wrapperInner = groupContainer.querySelector('.addon-options-wrapper');

//    const groupData = window.currentAddonData?.cat_dtls?.find(g => g.category_code === category);

//    const maxQty = groupData?.max_qty || Infinity;
//    const groupLimit = groupData?.group_limit || Infinity;
//    const maxPerItem = groupData?.max_per_item || Infinity;

//    let currentTotalQty = 0;
//    let uniqueSelectedCount = 0;

//    allControls.forEach(ctrl => {
//        const qty = parseInt(ctrl.querySelector('.qty-count').textContent, 10);
//        if (qty > 0) uniqueSelectedCount++;
//        currentTotalQty += qty;
//    });

//    allControls.forEach(ctrl => {
//        const btnInc = ctrl.querySelector('.increment');
//        const btnDec = ctrl.querySelector('.decrement');
//        const qty = parseInt(ctrl.querySelector('.qty-count').textContent, 10);
//        const itemId = ctrl.dataset.itemId;

//        const isCurrentItemSelected = qty > 0;

//        const willExceedUnique = uniqueSelectedCount >= groupLimit && !isCurrentItemSelected;
//        const willExceedTotalQty = currentTotalQty >= maxQty;
//        const willExceedItem = qty >= maxPerItem;

//        btnInc.disabled = willExceedItem || willExceedTotalQty || willExceedUnique;
//        btnDec.disabled = qty === 0;

//        // Any other updates you have for increment buttons...
//    });

//    // Show/hide collapse based on currentTotalQty
//    if (currentTotalQty >= maxQty) {
//        if (wrapperInner.style.display !== 'none') {
//            wrapperInner.style.display = 'none';
//            groupContainer.classList.add('collapsed');
//            groupContainer.querySelector('.addon-category-title')?.classList.add('collapsed');

//            const nextGroup = groupContainer.nextElementSibling;
//            if (nextGroup?.classList.contains('addon-category')) {
//                nextGroup.scrollIntoView({ behavior: 'smooth' });
//            }
//        }
//    } else {
//        wrapperInner.style.display = '';
//        groupContainer.classList.remove('collapsed');
//        groupContainer.querySelector('.addon-category-title')?.classList.remove('collapsed');
//    }
//}

function validateAddonSelections() {
    const form = document.getElementById('addonForm');
    if (!form) {
        console.error('Form element not found');
        return;
    }
    const confirmBtn = document.getElementById('confirmAddons');

    // Check if all addon categories (not remarks) are optional
    const addonCategories = form.querySelectorAll('.addon-category[data-type="addon"]');
    const allOptional = Array.from(addonCategories).every(category =>
        category.dataset.optional === 'Y'
    );

    // Check if user has selected any addons
    const selectedAddonInputs = form.querySelectorAll('.addon-category[data-type="addon"] input[type="checkbox"]:checked, .addon-category[data-type="addon"] input[type="radio"]:checked');
    const hasSelectedAddons = selectedAddonInputs.length > 0;

    // FIRST PRIORITY: If all optional and nothing selected, allow add to cart
    if (allOptional && !hasSelectedAddons) {
        confirmBtn.disabled = false;
        confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        return;
    }

    // SECOND: If user selected something, begin validation
    if (hasSelectedAddons) {
        let canAddToCart = true;

        // Check each selected addon to see if it has required remarks
        selectedAddonInputs.forEach(input => {
            const categoryCode = input.dataset.categoryCode;

            // Find associated remark section for this category
            const remarkSection = form.querySelector(`.remark-section[data-parent-category="${categoryCode}"]`);

            if (remarkSection) {
                const isRemarkRequired = remarkSection.dataset.optional === 'N';
                const remarkGroup = remarkSection.dataset.remarkGroup;

                // Check if remark section is visible (should be shown when addon is selected)
                const isVisible = remarkSection.style.display !== 'none';

                if (isRemarkRequired && isVisible) {
                    // Check if user has selected a remark for this group
                    const hasRemarkSelected = form.querySelector(`.remark-checkbox[data-remark-group="${remarkGroup}"]:checked`);

                    if (!hasRemarkSelected) {
                        canAddToCart = false;
                    }
                }
            }
        });

        // Also check if there are any required addon groups from window.currentAddonData
        if (window.currentAddonData?.cat_dtls) {
            const requiredGroups = window.currentAddonData.cat_dtls.filter(group => group.is_optional === "N");

            if (requiredGroups.length > 0) {
                const selectedAddons = [];
                form.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked').forEach(input => {
                    selectedAddons.push({
                        modifier_name: input.dataset.modifierName || ''
                    });
                });

                const missingGroups = requiredGroups.filter(group => {
                    const groupName = (group.modifier_name || '').trim();
                    return !selectedAddons.some(addon => (addon.modifier_name || '').trim() === groupName);
                });

                if (missingGroups.length > 0) {
                    canAddToCart = false;
                }
            }
        }

        confirmBtn.disabled = !canAddToCart;

        if (canAddToCart) {
            confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
            confirmBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
        return;
    }

    // If we reach here with required categories and nothing selected
    if (!allOptional) {
        confirmBtn.disabled = true;
        confirmBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        // All optional, nothing selected - should already be handled above
        confirmBtn.disabled = false;
        confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

// Assume modal and modalContent are globals or defined outside:

function validateAddToCart() {
    const allGroups = modalContent.querySelectorAll('.addon-category');
    let isValid = true;
    const errors = [];

    allGroups.forEach(group => {
        const categoryCode = group.dataset.categoryCode;
        const categoryType = group.dataset.type; // 'addon', 'remark', or undefined
        const isOptional = group.dataset.optional === 'Y';
        const maxQty = parseInt(group.dataset.maxQty || '0', 10);
        const maxSelectable = parseInt(group.dataset.maxSelectable || '0', 10);

        // Get category title for error messages
        const titleElement = group.querySelector('.addon-category-title');
        const categoryTitle = titleElement?.textContent?.trim() || categoryCode;

        // Get error message element
        const errorMessage = group.querySelector('.error-message');

        // CRITICAL: Skip hidden remark sections (they'll be validated only when visible)
        const isHidden = window.getComputedStyle(group).display === 'none' ||
            group.style.display === 'none';

        if (isHidden) {
            return; // Skip validation for hidden groups
        }

        // Skip validation if optional
        if (isOptional) {
            if (errorMessage) errorMessage.classList.add('hidden');
            return;
        }

        let hasSelection = false;
        let errorText = '';

        // VALIDATION TYPE 1: Checkbox selections (addons & remarks)
        const checkboxes = group.querySelectorAll('.addon-checkbox');
        if (checkboxes.length > 0) {
            const checkedCount = Array.from(checkboxes).filter(cb => cb.checked && !cb.disabled).length;
            hasSelection = checkedCount > 0;

            if (!hasSelection) {
                errorText = maxSelectable === 1
                    ? 'Please select one option for this group.'
                    : 'Please select at least one option for this group.';
            }
        }

        // VALIDATION TYPE 2: Quantity controls (modifiers/itemmaster)
        // Only validate if no checkboxes were found (to avoid double validation)
        if (checkboxes.length === 0 && maxQty > 0) {
            const qtyControls = group.querySelectorAll('.qty-count');
            const totalQty = Array.from(qtyControls).reduce((sum, span) =>
                sum + (parseInt(span.textContent || '0', 10)), 0
            );

            hasSelection = totalQty > 0;

            if (!hasSelection) {
                errorText = `Please select at least one item for this group (max ${maxQty}).`;
            }
        }

        // VALIDATION TYPE 3: If group has qty controls but no max_qty set, check group_limit
        if (checkboxes.length === 0 && maxQty === 0) {
            const qtyControls = group.querySelectorAll('.qty-count');
            if (qtyControls.length > 0) {
                const totalQty = Array.from(qtyControls).reduce((sum, span) =>
                    sum + (parseInt(span.textContent || '0', 10)), 0
                );

                hasSelection = totalQty > 0;

                if (!hasSelection) {
                    errorText = 'Please select at least one item for this group.';
                }
            }
        }

        // Apply validation result for required groups
        if (!hasSelection && !isOptional) {
            if (errorMessage) {
                errorMessage.textContent = errorText;
                errorMessage.classList.remove('hidden');
            }

            // Extract just the category name without count info
            const cleanTitle = categoryTitle.split('(')[0].trim();
            errors.push(`${cleanTitle}: ${errorText}`);
            isValid = false;
        } else {
            // Clear error state if valid
            if (errorMessage) {
                errorMessage.classList.add('hidden');
            }
        }
    });

    // Check if all addon categories are optional and nothing is selected
    const addonCategories = modalContent.querySelectorAll('.addon-category[data-type="addon"]');
    const allAddonsOptional = Array.from(addonCategories).every(cat => cat.dataset.optional === 'Y');
    const hasAnyAddonSelection = modalContent.querySelectorAll('.addon-category[data-type="addon"] input[type="checkbox"]:checked, .addon-category[data-type="addon"] input[type="radio"]:checked').length > 0;

    // If all addons are optional and nothing selected, allow proceed
    if (allAddonsOptional && !hasAnyAddonSelection) {
        isValid = true;
        errors.length = 0; // Clear any errors
    }

    // Scroll to first error if validation fails
    if (!isValid) {
        const firstInvalid = modalContent.querySelector('.addon-category.error-border');
        if (firstInvalid) {
            firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        console.warn('⚠️ Validation failed:', errors);
    } else {
        console.log('✅ All required selections validated');
    }

    // Update Confirm/Update button state
    const confirmBtn = modalContent.querySelector('#confirmAddons');
    const updateBtn = modalContent.querySelector('#updateAddOns');

    [confirmBtn, updateBtn].forEach(btn => {
        if (btn) {
            const isVisible = window.getComputedStyle(btn).display !== 'none';
            if (isVisible) {
                btn.disabled = !isValid;
                btn.classList.toggle('opacity-50', !isValid);
                btn.classList.toggle('cursor-not-allowed', !isValid);

                if (isValid) {
                    btn.classList.remove('opacity-50', 'cursor-not-allowed');
                    btn.classList.add('hover:bg-green-700');
                } else {
                    btn.classList.add('opacity-50', 'cursor-not-allowed');
                    btn.classList.remove('hover:bg-green-700');
                }
            }
        }
    });

    return isValid;
}

// Helper function for form submission with validation
function validateAndSubmit(callback) {
    const isValid = validateAddToCart();

    if (!isValid) {
        // Show toast notification
        showValidationToast('Please complete all required selections');
        return false;
    }

    if (typeof callback === 'function') {
        callback();
    }

    return true;
}

// Toast notification for validation errors
function showValidationToast(message) {
    const existingToast = document.getElementById('validation-toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'validation-toast';
    toast.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-all duration-300';
    toast.textContent = message;
    toast.style.opacity = '0';

    document.body.appendChild(toast);

    // Fade in
    setTimeout(() => { toast.style.opacity = '1'; }, 10);

    // Fade out and remove
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Initialize validation styles
function initValidationStyles() {
    if (document.getElementById('validation-styles')) return;

    const validationStyles = `
        .error-border {
            border-color: #DC2626 !important;
            border-width: 2px !important;
        }

        .error-message {
            color: #DC2626;
            font-size: 0.875rem;
            margin-top: 0.25rem;
            margin-bottom: 0.5rem;
        }

        .error-message.hidden {
            display: none;
        }

        

        
    `;

    const styleElement = document.createElement('style');
    styleElement.id = 'validation-styles';
    styleElement.textContent = validationStyles;
    document.head.appendChild(styleElement);
}

// Call this when initializing the modal
initValidationStyles();


function setupValidationListeners() {
    const form = modalContent.querySelector('#addonForm');
    if (!form) return;

    form.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', validateAddToCart);
    });

    validateAddToCart(); // Initial validation state
}

function setupConfirmButtonListener(onConfirm) {
    modalContent.querySelector('#confirmAddons').addEventListener('click', () => {
        const form = modalContent.querySelector('#addonForm');
        const selectedAddons = [];
        const selectedRemarks = [];

        form.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked').forEach(input => {
            selectedAddons.push({
                item_no: input.value,
                modifier_name: input.dataset.modifierName || '',
                price: parseFloat(input.dataset.price) || 0,
                qty: 1,
                item_name: input.closest('label')?.querySelector('.addon-text')?.textContent.trim() || 'Unnamed',
                group_code: input.closest('.addon-category')?.dataset.categoryCode || '',
            });
        });

        // Call your addToCart logic
        addToCart(window.currentBaseItemId, selectedAddons);
        if (typeof onConfirm === 'function') {
            onConfirm(selectedAddons, selectedRemarks);
        }

        closeAddonModal();
    });
}

GetHomeAPI.editItem = function (sno, item_no) {
    const { order } = useOrder();
    if (!order) return console.warn("No order found");

    const salesDtls = order.sales_dtls || [];
    const clickedItem = salesDtls.find(i => i.s_no == sno);
    if (!clickedItem) return console.warn("Item not found in cart:", sno);

    const cache = useCache() || {};
    const items = cache.items || [];

    // ✅ Use window.remarksCache instead of cache.itemRemarks
    const allItemRemarks = window.remarksCache || cache.itemRemarks || [];

    console.log("📚 Available item remarks config:", allItemRemarks.length, "items");

    const fullItemData = item_no
        ? items.find(i => i.item_no === item_no)
        : clickedItem;
    if (!fullItemData) return console.warn("Item not found in catalog:", item_no);

    console.log("🔍 Editing item s_no:", sno, "item_no:", fullItemData.item_no);

    // Gather child addons (items with same parent_sno)
    const selectedAddons = clickedItem.selectedAddons?.length
        ? clickedItem.selectedAddons
        : salesDtls.filter(i =>
            String(i.parent_sno) === String(clickedItem.s_no) &&
            String(i.s_no) !== String(clickedItem.s_no)
        );

    // ✅ NEW: Enrich addons with correct prices from catalog
    selectedAddons.forEach(addon => {
        const fullAddonItem = items.find(i => i.item_no === addon.item_no);
        if (fullAddonItem) {
            // Use helper to get correct price (checks both top-level and selling_uom_dtls)
            const correctPrice = getItemPrice(fullAddonItem);

            // Update addon object with correct price
            addon.price = correctPrice;
            addon.unit_price = correctPrice;

            // Also ensure qty is set
            if (!addon.qty) addon.qty = 1;

            console.log(`💰 Enriched addon ${addon.item_name}: $${correctPrice} (qty: ${addon.qty})`);
        }
    });

    console.log("📋 Current addons with enriched prices:", selectedAddons);

    // 🎯 Extract remarks from child items AND main item itself
    const selectedRemarks = [];

    console.log("🔍 Starting remark extraction from", selectedAddons.length, "addons");
    console.log("📚 Available item remarks config:", allItemRemarks.map(r => r.item_no));

    // ✅ FIRST: Check if the main item itself has remarks
    if (clickedItem.remarks && clickedItem.remarks.trim()) {
        console.log("📝 Main item has remarks:", clickedItem.remarks);

        const mainItemRemarksData = allItemRemarks.find(r =>
            r.item_no === clickedItem.item_no ||
            String(r.item_no) === String(clickedItem.item_no)
        );

        if (mainItemRemarksData?.remarks_item_details) {
            mainItemRemarksData.remarks_item_details.forEach(remarkGroup => {
                const remarkGroupName = remarkGroup.remarks_group;
                const remarkTexts = clickedItem.remarks.split(',').map(r => r.trim());

                remarkTexts.forEach(remarkText => {
                    const remarkDetail = remarkGroup.remarks_details?.find(rd => {
                        const rdRemarks = (rd.remarks || '').trim().toLowerCase();
                        const rdItemName = (rd.remarks_item_name || '').trim().toLowerCase();
                        const searchText = remarkText.toLowerCase();
                        return rdRemarks === searchText || rdItemName === searchText;
                    });

                    if (remarkDetail) {
                        selectedRemarks.push({
                            remarks_group: remarkGroupName,
                            remarks: remarkDetail.remarks || remarkDetail.remarks_item_name,
                            remarks_item_name: remarkDetail.remarks_item_name || remarkDetail.remarks,
                            seq_no: remarkDetail.seq_no,
                            parent_category: clickedItem.category_code || clickedItem.modifier_name
                        });
                        console.log("✅ Extracted main item remark:", remarkText);
                    }
                });
            });
        }
    }

    // ✅ THEN: Process child addon items
    selectedAddons.forEach(addon => {
        console.log(`\n📦 Processing addon:`, {
            item_name: addon.item_name,
            item_no: addon.item_no,
            category_code: addon.category_code,
            modifier_name: addon.modifier_name,
            remarks: addon.remarks,
            price: addon.price,
            unit_price: addon.unit_price
        });

        if (addon.remarks && addon.remarks.trim()) {
            // Get the addon's category - CRITICAL: must match modal's data-parent-category
            const addonCategory = addon.category_code || addon.modifier_name;

            // Find the remark configuration for this addon item
            const itemRemarksData = allItemRemarks.find(r =>
                r.item_no === addon.item_no ||
                String(r.item_no) === String(addon.item_no)
            );

            if (!itemRemarksData) {
                console.warn(`⚠️ No remark config found for addon item: ${addon.item_no}`);
                return;
            }

            console.log(`✅ Found remark config for ${addon.item_no}:`, itemRemarksData);

            if (itemRemarksData?.remarks_item_details) {
                itemRemarksData.remarks_item_details.forEach(remarkGroup => {
                    const remarkGroupName = remarkGroup.remarks_group;

                    console.log(`  📋 Processing remark group: "${remarkGroupName}"`);

                    // Split multiple remarks if they were joined with comma
                    const remarkTexts = addon.remarks.split(',').map(r => r.trim());

                    remarkTexts.forEach(remarkText => {
                        console.log(`    🔍 Looking for remark text: "${remarkText}"`);

                        // Find the matching remark detail
                        const remarkDetail = remarkGroup.remarks_details?.find(rd => {
                            const rdRemarks = (rd.remarks || '').trim().toLowerCase();
                            const rdItemName = (rd.remarks_item_name || '').trim().toLowerCase();
                            const searchText = remarkText.toLowerCase();

                            const match = rdRemarks === searchText || rdItemName === searchText;
                            if (match) {
                                console.log(`    ✓ Found match in remarks_details:`, rd);
                            }
                            return match;
                        });

                        if (remarkDetail) {
                            const extractedRemark = {
                                remarks_group: remarkGroupName,
                                remarks: remarkDetail.remarks || remarkDetail.remarks_item_name,
                                remarks_item_name: remarkDetail.remarks_item_name || remarkDetail.remarks,
                                seq_no: remarkDetail.seq_no,
                                parent_category: addonCategory // ✅ CRITICAL: Must match modal's data-parent-category
                            };

                            selectedRemarks.push(extractedRemark);

                            console.log(`    ✅ Extracted remark:`, extractedRemark);
                        } else {
                            console.warn(`    ⚠️ Could not find remark detail for "${remarkText}" in group "${remarkGroupName}"`);
                            console.log(`    Available remarks in this group:`, remarkGroup.remarks_details?.map(rd => rd.remarks));
                        }
                    });
                });
            }
        }
    });

    console.log("\n💬 Final extracted remarks:", JSON.stringify(selectedRemarks, null, 2));

    // Build addon data
    const hasAddons = fullItemData.is_addon_enable?.toUpperCase() === "Y";
    const hasModifierGroups = Array.isArray(fullItemData.itemmaster_menutype_grpdtls)
        && fullItemData.itemmaster_menutype_grpdtls.length > 0;

    // ✅ Use window.remarksCache for remarksEntry too
    const remarksEntry = allItemRemarks.find(r => r.item_no === fullItemData.item_no);

    console.log("📝 Remarks entry for main item:", remarksEntry ? "Found" : "Not found");
    console.log("🔧 Item type:", {
        hasAddons,
        hasModifierGroups,
        add_on_name: fullItemData.add_on_name
    });

    const addonData = hasAddons
        ? getAddonsByAddOnName(fullItemData.add_on_name)
        : { cat_dtls: [], item_dtls: [] };

    const enrichedCatDtls = (addonData.cat_dtls || []).map(grp => {
        if (!grp.category_code) {
            const matchedItem = addonData.item_dtls.find(
                i => i.modifier_name === grp.modifier_name && i.category_code
            );
            if (matchedItem) grp.category_code = matchedItem.category_code;
        }
        return { ...grp, item_dtls: getAvailableAddonItems(addonData, grp) };
    });

    const filteredAddonData = { ...addonData, cat_dtls: enrichedCatDtls };

    // ✅ Close cart modal and hide bottom nav BEFORE showing addon modal
    const cartModal = document.getElementById('cartModal');
    const cartOverlay = document.getElementById('cartModalOverlay');
    const bottomNav = document.querySelector('.bottom-nav');

    if (cartModal) {
        cartModal.classList.remove('active');
        cartModal.style.display = 'none';
    }

    if (cartOverlay) {
        cartOverlay.classList.remove('active');
        cartOverlay.style.display = 'none';
    }

    if (bottomNav) {
        bottomNav.style.display = 'none';
    }

    console.log("🎬 Opening addon modal with:", {
        baseItem: fullItemData.item_name,
        addonsCount: selectedAddons.length,
        remarksCount: selectedRemarks.length,
        editingOrderItemSNo: sno
    });

    // Show modal
    showAddOnModal(
        fullItemData,
        null,
        filteredAddonData,
        remarksEntry ? remarksEntry.remarks_item_details : [],
        selectedAddons,
        selectedRemarks,
        sno // This is the editing s_no
    );

    // ✅ Prefill modal with extracted data
    setTimeout(() => {
        console.log("🔄 Prefilling modal with:", {
            selectedAddons: selectedAddons.length,
            selectedRemarks: selectedRemarks.length
        });
        prefillAddonModal(selectedAddons, selectedRemarks, fullItemData, sno);
    }, 100);
};

// ✅ NEW FUNCTION: Handle closing addon modal and restoring cart
function closeAddonModalAndRestoreCart() {
    const addonModal = document.getElementById('addonModal');
    const addonOverlay = document.getElementById('addonModalOverlay');

    // Close addon modal
    if (addonModal) {
        addonModal.classList.remove('active');
        addonModal.style.display = 'none';
    }

    if (addonOverlay) {
        addonOverlay.classList.remove('active');
        addonOverlay.style.display = 'none';
    }

    // ✅ If we were editing (not adding new), restore cart modal
    if (window.currentEditingSno) {
        console.log('🔄 Restoring cart modal after edit');

        const cartModal = document.getElementById('cartModal');
        const cartOverlay = document.getElementById('cartModalOverlay');
        const bottomNav = document.querySelector('.bottom-nav');

        if (cartModal) {
            cartModal.classList.add('active');
            cartModal.style.display = 'block';
        }

        if (cartOverlay) {
            cartOverlay.classList.add('active');
            cartOverlay.style.display = 'block';
        }

        if (bottomNav) {
            bottomNav.style.display = 'flex';
        }

        document.body.style.overflow = 'hidden'; // Keep scroll locked while cart is open

        // Clear edit mode flag
        window.currentEditingSno = null;
    } else {
        // If adding new item (not editing), just show bottom nav and unlock scroll
        console.log('✅ Closing addon modal (new item flow)');

        const bottomNav = document.querySelector('.bottom-nav');
        if (bottomNav) {
            bottomNav.style.display = 'flex';
        }

        document.body.style.overflow = 'auto';
    }
}

function prefillAddonModal(selectedAddons, selectedRemarks, fullItemData, editingSno) {
    const modal = document.getElementById("addonModalContent");
    if (!modal) {
        console.warn("Modal not ready, retrying...");
        return setTimeout(() => prefillAddonModal(selectedAddons, selectedRemarks, fullItemData, editingSno), 50);
    }

    console.log("🎨 Prefilling modal with", selectedAddons.length, "addons");
    console.log("💬 Prefilling with", selectedRemarks.length, "remarks");
    console.log("📦 Selected remarks data:", JSON.stringify(selectedRemarks, null, 2));

    // Prefill checkbox addons
    selectedAddons.forEach(addon => {
        const itemNo = addon.item_no || addon.citem_no;
        const checkbox = modal.querySelector(`input[type="checkbox"][value="${itemNo}"]`);

        if (checkbox && !checkbox.checked) {
            console.log("✓ Checking addon checkbox:", itemNo, addon.item_name);
            checkbox.click();
        } else if (!checkbox) {
            console.warn("⚠️ Checkbox not found for addon:", itemNo, addon.item_name);
        }
    });

    // Prefill qty-controls (if any)
    selectedAddons.forEach(addon => {
        const itemNo = addon.item_no || addon.citem_no;
        const ctrl = modal.querySelector(`.qty-control[data-item-id="${itemNo}"]`);

        if (!ctrl) return;

        const incrementBtn = ctrl.querySelector(".increment");
        let currentQty = Number(ctrl.querySelector(".qty-count")?.textContent) || 0;

        while (currentQty < addon.qty && incrementBtn) {
            incrementBtn.click();
            currentQty++;
        }
        console.log("✓ Set qty for:", itemNo, "to", addon.qty);
    });

    // ✅ IMPROVED: Prefill remarks with multiple fallback strategies
    console.log("\n🎯 Starting remark prefill...");
    console.log("Remarks to prefill:", JSON.stringify(selectedRemarks, null, 2));

    // First, let's see what's available in the modal
    console.log("\n📋 Available remark sections in modal:");
    modal.querySelectorAll('.remark-section').forEach(section => {
        console.log(`  - Section:`, {
            categoryCode: section.dataset.categoryCode,
            parentCategory: section.dataset.parentCategory,
            remarkGroup: section.dataset.remarkGroup,
            type: section.dataset.type
        });

        const checkboxes = section.querySelectorAll('input.remark-checkbox');
        console.log(`    Checkboxes (${checkboxes.length}):`, Array.from(checkboxes).map(cb => ({
            value: cb.value,
            remarkText: cb.getAttribute('data-remark-text'),
            remarkGroup: cb.getAttribute('data-remark-group')
        })));
    });

    selectedRemarks.forEach((remark, index) => {
        const remarkText = remark.remarks || remark.remarks_item_name;
        const parentCategory = remark.parent_category;
        const remarkGroup = remark.remarks_group;

        console.log(`\n🔍 [${index + 1}/${selectedRemarks.length}] Prefilling remark:`, {
            text: remarkText,
            parentCategory: parentCategory,
            remarkGroup: remarkGroup,
            fullRemark: remark
        });

        // Strategy 1: Find by parent category and remark group
        let remarkSection = modal.querySelector(
            `.remark-section[data-parent-category="${parentCategory}"][data-remark-group="${remarkGroup}"]`
        );

        if (remarkSection) {
            console.log(`✅ Found section with Strategy 1 (parent-category + remark-group)`);
        }

        // Strategy 2: If not found, try by remark group only
        if (!remarkSection) {
            console.log(`❌ Strategy 1 failed, trying Strategy 2 (remark-group only)...`);
            remarkSection = modal.querySelector(
                `.remark-section[data-remark-group="${remarkGroup}"]`
            );

            if (remarkSection) {
                console.log(`✅ Found section with Strategy 2 (remark-group only)`);
                console.log(`   Section has parent-category: "${remarkSection.dataset.parentCategory}"`);
            }
        }

        // If still not found, log all available sections
        if (!remarkSection) {
            console.error(`❌ Could not find remark section!`);
            console.error(`   Searching for: parentCategory="${parentCategory}", remarkGroup="${remarkGroup}"`);
            console.error(`   Available sections:`);
            modal.querySelectorAll('.remark-section').forEach(section => {
                console.error(`     - parentCategory="${section.dataset.parentCategory}", remarkGroup="${section.dataset.remarkGroup}"`);
            });
            return;
        }

        console.log(`📦 Using section:`, {
            categoryCode: remarkSection.dataset.categoryCode,
            parentCategory: remarkSection.dataset.parentCategory,
            remarkGroup: remarkSection.dataset.remarkGroup
        });

        // Find the checkbox with matching remark text
        let checkbox = remarkSection.querySelector(
            `input.remark-checkbox[data-remark-text="${remarkText}"]`
        );

        if (checkbox) {
            console.log(`✅ Found checkbox with exact match`);
        }

        // Fallback: try case-insensitive match
        if (!checkbox) {
            console.log(`❌ Exact match failed, trying case-insensitive match...`);
            const allCheckboxes = remarkSection.querySelectorAll('input.remark-checkbox');
            console.log(`   Searching among ${allCheckboxes.length} checkboxes`);

            allCheckboxes.forEach(cb => {
                const cbText = cb.getAttribute('data-remark-text');
                console.log(`   Comparing: "${cbText}" vs "${remarkText}"`);

                if (cbText && cbText.toLowerCase() === remarkText.toLowerCase()) {
                    checkbox = cb;
                    console.log(`   ✅ Case-insensitive match found!`);
                }
            });
        }

        if (checkbox) {
            if (!checkbox.checked) {
                console.log(`✅ Checking remark checkbox: "${remarkText}"`);
                checkbox.click();
                console.log(`   Checkbox is now checked:`, checkbox.checked);
            } else {
                console.log(`ℹ️ Checkbox was already checked`);
            }
        } else {
            console.error(`❌ Could not find checkbox for remark text: "${remarkText}"`);
            console.error(`   Available checkboxes in this section:`);
            remarkSection.querySelectorAll('input.remark-checkbox').forEach(cb => {
                console.error(`     - "${cb.getAttribute('data-remark-text')}" (value: ${cb.value})`);
            });
        }
    });

    // Expand all addon categories
    modal.querySelectorAll(".addon-options-wrapper").forEach(wrapper => {
        wrapper.classList.remove("collapsed");
        wrapper.style.display = "block";
    });

    modal.querySelectorAll(".addon-category").forEach(cat => {
        cat.classList.remove("collapsed");
    });

    // Set modal title
    const titleEl = modal.querySelector(".modal-item-name");
    if (titleEl) titleEl.textContent = fullItemData.item_name;

    // Setup update button
    const updateBtn = modal.querySelector("#updateAddOns");
    if (updateBtn) {
        updateBtn.style.display = "inline-block";
        updateBtn.classList.remove("opacity-50", "cursor-not-allowed");
        updateBtn.disabled = false;

        const newUpdateBtn = updateBtn.cloneNode(true);
        updateBtn.parentNode.replaceChild(newUpdateBtn, updateBtn);

        newUpdateBtn.onclick = () => {
            const chosenAddons = gatherSelectedAddonsFromModal();
            const chosenRemarks = gatherSelectedRemarksFromModal();

            console.log("🔄 Updating cart item", editingSno);
            console.log("📦 Chosen addons:", chosenAddons);
            console.log("💬 Chosen remarks:", chosenRemarks);

            addToCart(
                fullItemData.item_no,
                chosenAddons,
                chosenRemarks,
                editingSno,
                true
            );

            closeAddonModal();
        };
    }

    // Hide confirm button
    const confirmBtn = modal.querySelector("#confirmAddons");
    if (confirmBtn) confirmBtn.style.display = "none";

    console.log("✅ Modal prefilled successfully");
}


function preloadCartImages(items, MenuItems) {
    const imageUrls = items.map(item => {
        const menuItem = MenuItems.find(mi => mi.item_no === item.item_no);
        return resolveImageUrl(item, menuItem);
    }).filter(url => url && url !== RESTAURANT_CONFIG.logo);

    // Preload with high priority
    if (imageUrls.length > 0) {
        preloadImages(imageUrls, 'high');
    }
}
function renderCartFromOrder() {
    console.log('🔄 renderCartFromOrder called');

    const orderObj = useOrder();
    const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
    const serviceRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;

    if (!orderObj || !orderObj.order) return;

    const order = orderObj.order;
    const salesDtls = order.sales_dtls || [];
    const cartItemsContainer = document.getElementById('cartItems');
    if (!cartItemsContainer) return;

    // Retrieve and flatten MenuItems for image fallback
    let MenuItems = [];
    try {
        const cached = getMenuItems();
        if (Array.isArray(cached)) {
            MenuItems = cached.flatMap(category => category.items || []);
        } else {
            const stored = sessionStorage.getItem("MenuItems");
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    MenuItems = parsed.flatMap(category => category.items || []);
                }
            }
        }
    } catch (err) {
        console.error("Failed to retrieve MenuItems:", err);
        MenuItems = [];
    }

    const seen = new Set();
    const sales = salesDtls.filter(i => {
        const key = `${i.s_no ?? ''}-${i.item_no ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Translate item names
    sales.forEach(item => {
        item.display_name = getTranslatedName(
            item.item_no,
            item.item_desc || item.item_name,
            selectedLang,
            "item"
        );
    });

    const baseItems = sales.filter(i => {
        const sNo = String(i.s_no);
        const parentSno = String(i.parent_sno || i.s_no);
        return sNo === parentSno;
    });

    const addonRecords = sales.filter(i => {
        const sNo = String(i.s_no);
        const parentSno = String(i.parent_sno || i.s_no);
        return sNo !== parentSno;
    });

    // ✅ EMPTY CART CHECK
    if (!baseItems.length) {
        cartItemsContainer.innerHTML = `
        <div class="empty-cart">
            <div class="empty-cart-text">Your cart is empty</div>
            <div class="empty-cart-subtext">Select items from the menu to get started!</div>
        </div>`;

        document.getElementById('cartTotal').textContent = `$0.00`;
        document.getElementById('service-charge').textContent = `$0.00`;
        document.getElementById('gst').textContent = `$0.00`;
        document.getElementById('total').textContent = `$0.00`;
        document.getElementById('checkout-btn').disabled = true;

        const emptyCartBtn = document.getElementById('empty-cart-btn');
        if (emptyCartBtn) emptyCartBtn.disabled = true;

        // ✅ Hide bottom nav completely
        const bottomNav = document.querySelector('.bottom-nav');
        if (bottomNav) {
            bottomNav.classList.remove('show');
            bottomNav.style.display = 'none';
            bottomNav.style.transform = 'translateY(100%)'; // Ensure hidden off-screen
        }

        // ✅ MOBILE: Remove extra space under menu
        const menuSection = document.querySelector('.menu-section');
        if (menuSection && window.matchMedia('(max-width: 767px)').matches) {
            menuSection.style.paddingBottom = '0px';
        }

        return;
    }



    // ✅ SHOW BOTTOM NAV
    // ✅ SHOW BOTTOM NAV WHEN CART HAS ITEMS
    const bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) {
        bottomNav.classList.add('show');
        bottomNav.style.display = 'flex';
        bottomNav.style.transform = 'translateY(0)';
    }

    // ✅ MOBILE: Restore menu-section padding
    const menuSection = document.querySelector('.menu-section');
    if (menuSection && window.matchMedia('(max-width: 767px)').matches) {
        menuSection.style.paddingBottom = '100px';
    }


    // ✅ PRELOAD IMAGES
    if (baseItems.length > 0) {
        preloadCartImages(baseItems, MenuItems);
    }

    // ✅ RENDER CART ITEMS
    cartItemsContainer.innerHTML = baseItems.map(item => {
        const qty = Number(item.qty || 1);
        const childItems = addonRecords.filter(a => String(a.parent_sno) === String(item.s_no));

        // ✅ IMAGE URL LOGIC
        const menuItem = MenuItems.find(mi => mi.item_no === item.item_no);
        const imageUrl = resolveImageUrl(item, menuItem);
        const restaurantLogo = RESTAURANT_CONFIG.logo || '';

        // Determine item type
        const isModifierSet = Array.isArray(item.itemmaster_menutype_grpdtls)
            ? item.itemmaster_menutype_grpdtls.length > 0
            : Boolean(item.itemmaster_menutype_grpdtls);

        const isAddonSet = item.add_on_name && item.add_on_name.trim().toUpperCase() === 'ADD ON';

        let displayPrice = 0;
        let mainItemPrice = 0;

        if (isModifierSet) {
            displayPrice = childItems.reduce((sum, child) => sum + Number(child.sub_total ?? 0), 0);
            mainItemPrice = 0;
        } else if (isAddonSet) {
            const basePrice = item.selling_uom_dtls?.[0]?.price_dtls?.[0]?.dine_in_price
                || item.selling_uom_dtls?.[0]?.price_dtls?.[0]?.takeaway_price
                || Number(item.sub_total ?? 0);

            mainItemPrice = Number(basePrice);
            displayPrice = mainItemPrice + childItems.reduce((sum, child) => sum + Number(child.sub_total ?? 0), 0);
        } else {
            displayPrice = Number(item.sub_total ?? 0);
            displayPrice += childItems.reduce((sum, child) => sum + Number(child.sub_total ?? 0), 0);
            mainItemPrice = displayPrice;
        }

        const isAlacarte = childItems.length === 0;

        const mainRemarks = (item.remarks && item.remarks.trim())
            ? item.remarks.split(',').map(r => r.trim()).filter(r => r)
            : [];

        const childGroups = childItems.map(child => {
            const childName = child.display_name || '';
            const childQty = Number(child.qty ?? 1);
            const childPrice = Number(child.sub_total ?? 0);
            const childRemarks = (child.remarks && child.remarks.trim())
                ? child.remarks.split(',').map(r => r.trim()).filter(r => r)
                : [];
            return { name: childName, qty: childQty, price: childPrice, remarks: childRemarks };
        });

        const mainItemPriceHtml = isAddonSet && childItems.length > 0 ? `
            <div class="cart-main-item-price">
                <div class="cart-modification-row">
                    <span class="cart-modification-name" style="font-weight: 500;">Base Item</span>
                    <span class="cart-modification-qty-spacer"></span>
                    <span class="cart-modification-price">$${mainItemPrice.toFixed(2)}</span>
                </div>
            </div>` : '';

        const modificationsHtml = childGroups.length > 0 ? `
            <div class="cart-modifications">
                ${mainItemPriceHtml}
                ${childGroups.map(child => `
                    <div class="cart-modification-item">
                        <div class="cart-modification-row">
                            <span class="cart-modification-prefix">+</span>
                            <span class="cart-modification-name">${child.name}</span>
                            ${child.qty > 1 ? `<span class="cart-modification-qty">×${child.qty}</span>` : `<span class="cart-modification-qty-spacer"></span>`}
                            <span class="cart-modification-price">+$${child.price > 0 ? child.price.toFixed(2) : '0.00'}</span>
                        </div>
                        ${child.remarks.length > 0 ? `<div class="cart-modification-remarks">${child.remarks.map(r => `<span class="remark-tag">${r}</span>`).join('')}</div>` : ''}
                    </div>
                `).join('')}
            </div>` : '';

        const mainRemarksHtml = mainRemarks.length > 0 ? `
            <div class="cart-item-remarks">
                ${mainRemarks.map(r => `<span class="remark-tag">${r}</span>`).join('')}
            </div>` : '';

        const editButtonHtml = !isAlacarte
            ? `<button class="cart-action-btn cart-edit-btn" onclick="GetHomeAPI.editItem('${item.s_no}','${item.item_no}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                Edit
            </button>` : '';

        return `
            <div class="cart-item-card">
                <div class="cart-item-main">
                    <div class="cart-item-header">
                        <img src="${imageUrl}" 
                             alt="${item.display_name}" 
                             class="cart-item-image"
                             loading="eager"
                             fetchpriority="high"
                             decoding="async"
                             onerror="if(this.src!=='${restaurantLogo}') this.src='${restaurantLogo}'; else this.style.display='none';">
                        <div class="cart-item-details">
                            <div class="cart-item-title">
                                <span class="cart-item-qty">${qty}x</span>
                                <span class="cart-item-name">${item.display_name}</span>
                            </div>
                            <div class="cart-item-price">$${displayPrice.toFixed(2)}</div>
                        </div>
                    </div>
                    ${mainRemarksHtml}
                    ${modificationsHtml}
                </div>
                <div class="cart-item-actions">
                    <div class="cart-qty-controls">
                        <button class="cart-qty-btn" onclick="GetHomeAPI.updateQuantityBySno('${item.s_no}', -1)">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                        <span class="cart-qty-display">${qty}</span>
                        <button class="cart-qty-btn" onclick="GetHomeAPI.updateQuantityBySno('${item.s_no}', 1)">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="cart-action-buttons">
                        ${editButtonHtml}
                        <button class="cart-action-btn cart-remove-btn" data-sno="${item.s_no}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                            Remove
                        </button>
                    </div>
                </div>
            </div>`;
    }).join('');

    const subtotal = parseFloat(order.sub_total || 0);
    const serviceCharge = parseFloat(order.total_svc || 0);
    const gst = parseFloat(order.total_tax || 0);
    const finalTotal = parseFloat(order.net_amt || 0);

    document.getElementById('cartTotal').textContent = `$${subtotal.toFixed(2)}`;
    document.getElementById('service-charge').textContent = `$${serviceCharge.toFixed(2)}`;
    document.getElementById('gst').textContent = `$${gst.toFixed(2)}`;
    document.getElementById('total').textContent = `$${finalTotal.toFixed(2)}`;
    document.getElementById('checkout-btn').disabled = finalTotal === 0;

    // Enable/disable empty cart button based on cart contents
    const emptyCartBtn = document.getElementById('empty-cart-btn');
    if (emptyCartBtn) {
        emptyCartBtn.disabled = finalTotal === 0;
    }

    const gstRateEl = document.getElementById('gst-rate');
    const svcRateEl = document.getElementById('service-charge-rate');
    if (gstRateEl) gstRateEl.textContent = gstRate;
    if (svcRateEl) svcRateEl.textContent = serviceRate;
}

window.renderCartFromOrder = renderCartFromOrder;
window.updateOrderCacheOnServer = updateOrderCacheOnServer;
window.updateQuantityBySno = updateQuantityBySno;
window.deleteIndividualItem = deleteIndividualItem;
window.handleRemoveClick = handleRemoveClick;

console.log('✅ CRUD functions with server sync loaded');

function validateGroupsBeforeAddToCart() {
    let allGroupsValid = true;

    itemmasterGroups.forEach(group => {
        const groupName = group.modifier_name;
        const isOptional = group.is_optional === 'Y';

        const allControls = container.querySelectorAll(`.qty-control[data-category="${groupName}"]`);

        let groupTotalQty = 0;
        for (const control of allControls) {
            const qty = parseInt(control.querySelector('.qty-count')?.textContent || '0', 10);
            groupTotalQty += qty;
        }

        if (!isOptional && groupTotalQty === 0) {
            // Group is required but nothing selected
            allGroupsValid = false;
        }
    });

    // Enable or disable Add to Cart
    const addToCartBtn = document.getElementById('addToCartBtn');
    if (addToCartBtn) {
        addToCartBtn.disabled = !allGroupsValid;
        addToCartBtn.classList.toggle('opacity-50', !allGroupsValid); // optional: visual cue
    }
}
function highlightInvalidGroups() {
    itemmasterGroups.forEach(group => {
        const groupName = group.modifier_name;
        const isOptional = group.is_optional === 'Y';

        const allControls = container.querySelectorAll(`.qty-control[data-category="${groupName}"]`);
        let totalQty = 0;

        for (const control of allControls) {
            const qty = parseInt(control.querySelector('.qty-count')?.textContent || '0', 10);
            totalQty += qty;
        }

        const titleEl = document.querySelector(`.addon-category-title[data-category="${groupName}"]`);
        if (!isOptional && totalQty === 0 && titleEl) {
            titleEl.classList.add('text-red-600'); // or add border, warning icon, etc.
        } else {
            titleEl?.classList.remove('text-red-600');
        }
    });
}

function updateButtonStates(control, quantity) {
    const decrementBtn = control.querySelector('.decrement');
    const incrementBtn = control.querySelector('.increment');
    const category = control.dataset.category;

    if (decrementBtn) {
        decrementBtn.disabled = quantity <= 0;
        decrementBtn.classList.toggle('opacity-50', quantity <= 0);
        decrementBtn.classList.toggle('cursor-not-allowed', quantity <= 0);
    }

    if (incrementBtn) {
        const categoryEl = control.closest('.addon-category');
        const maxQty = parseInt(categoryEl?.dataset.maxQty || '0');
        const currentTotal = calculateCategoryTotal(category);

        const disableIncrement = maxQty > 0 && currentTotal >= maxQty && quantity === 0;
        incrementBtn.disabled = disableIncrement;
        incrementBtn.classList.toggle('opacity-50', disableIncrement);
        incrementBtn.classList.toggle('cursor-not-allowed', disableIncrement);
    }
}

// Helper function to calculate category total
function calculateCategoryTotal(category) {
    if (!window.qtyMap || !window.qtyMap[category]) return 0;
    return Object.values(window.qtyMap[category]).reduce((sum, qty) => sum + qty, 0);
}

// Helper function to update category total display
function updateCategoryTotal(category, modal) {
    let totalQty = 0;

    // Find all quantity controls for this category
    modal.querySelectorAll(`.qty-control[data-category="${category}"]`).forEach(ctrl => {
        const qtySpan = ctrl.querySelector('.qty-count');
        const qty = parseInt(qtySpan?.textContent || '0', 10);
        totalQty += qty;
    });

    // Update the category counter
    const counterSpan = modal.querySelector(`.selected-count[data-category="${category}"]`);
    if (counterSpan) {
        counterSpan.textContent = totalQty;
    }

    // Get category limits
    const categoryDiv = modal.querySelector(`[data-category-code="${category}"]`);
    const maxQty = parseInt(categoryDiv?.dataset.maxQty || '999', 10);
    const groupLimit = parseInt(categoryDiv?.dataset.groupLimit || '0', 10);

    console.log(`📊 Category ${category}: ${totalQty}/${maxQty} selected`);

    // Update button states based on limits
    modal.querySelectorAll(`.qty-control[data-category="${category}"]`).forEach(ctrl => {
        const qtySpan = ctrl.querySelector('.qty-count');
        const currentQty = parseInt(qtySpan?.textContent || '0', 10);
        const incrementBtn = ctrl.querySelector('.increment');
        const decrementBtn = ctrl.querySelector('.decrement');

        // Handle increment button state
        if (incrementBtn) {
            const canIncrement = (totalQty < maxQty) && (groupLimit === 0 || currentQty < groupLimit);

            if (canIncrement) {
                incrementBtn.disabled = false;
                incrementBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                incrementBtn.classList.add('bg-gray-200');
            } else {
                incrementBtn.disabled = true;
                incrementBtn.classList.add('opacity-50', 'cursor-not-allowed');
                incrementBtn.classList.remove('bg-gray-200');
            }
        }

        // Handle decrement button state
        if (decrementBtn) {
            if (currentQty > 0) {
                decrementBtn.disabled = false;
                decrementBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                decrementBtn.classList.add('bg-gray-200');
            } else {
                decrementBtn.disabled = true;
                decrementBtn.classList.add('opacity-50', 'cursor-not-allowed');
                decrementBtn.classList.remove('bg-gray-200');
            }
        }
    });
}
// Helper function to update all categories
function updateAllCategories(modal) {
    const categories = modal.querySelectorAll('.addon-category');
    categories.forEach(categoryEl => {
        const categoryCode = categoryEl.dataset.categoryCode;
        if (categoryCode) {
            updateCategoryTotal(categoryCode, modal);
        }
    });
}

// Example usage with event listeners
function setupAddonControls(modal) {
    modal.addEventListener('click', function (e) {
        if (e.target.classList.contains('increment') || e.target.classList.contains('decrement')) {
            e.preventDefault();

            const button = e.target;
            const qtyControl = button.closest('.qty-control');
            const qtySpan = qtyControl.querySelector('.qty-count');
            const category = qtyControl.dataset.category;

            let currentQty = parseInt(qtySpan.textContent, 10) || 0;

            if (button.classList.contains('increment') && !button.disabled) {
                qtySpan.textContent = currentQty + 1;
            } else if (button.classList.contains('decrement') && !button.disabled && currentQty > 0) {
                qtySpan.textContent = currentQty - 1;
            }

            // Update the category after quantity change
            updateCategoryTotal(category, modal);
        }
    });
}



let currentAddonParentItem = null;

function confirmAddonSelection() {
    const selectedAddons = Array.from(
        document.querySelectorAll('.addon-checkbox:checked')
    ).map(cb => ({
        item_no: cb.value,
        price: parseFloat(cb.dataset.price),
        name: cb.dataset.name
    }));

    // 📝 Get any remarks currently selected in modal (if available)
    const selectedRemarks = window.selectedRemarks || []; // or your actual variable
    const remarksText = selectedRemarks.map(r => r.remark_name).join(", ");

    if (currentAddonParentItem) {
        const price = parseFloat(getPriceByServiceType(currentAddonParentItem));

        // ✅ Inject remarks directly into parent before passing to cart
        const parentWithRemarks = {
            ...currentAddonParentItem,
            remarks: remarksText
        };

        pushItemToCart(parentWithRemarks, price, selectedAddons);
    }

    closeAddonModal();
}


function getAddonsByAddOnName(addOnName) {
    const addonGroups = useCache().addons || [];
    return addonGroups.find(g => g.add_on_name === addOnName) || null;
}

function getCategoryItems(category_code) {
    const menuSections = useCache((state) => state.setMenuItems);
    if (!Array.isArray(menuSections)) return [];

    const allItems = menuSections.flatMap(section => section.items || []);

    const seen = new Set();
    return allItems.filter(item => {
        if (!item || typeof item !== 'object') return false;
        if (!item.category_code || !item.item_no) return false;
        if (parseFloat(item.price) <= 0) return false;

        // Remove hidden items if needed
        if (typeof isMenuCategoryOrItemHidden === "function" &&
            isMenuCategoryOrItemHidden("I", item.item_no)) return false;

        if (item.category_code !== category_code) return false;

        if (seen.has(item.item_no)) return false;  // skip duplicates
        seen.add(item.item_no);
        return true;
    });
}

function hasDirectItems(category_code) {
    const menuSections = useCache().menuItems || [];
    const section = menuSections.find(s => s.root_category_code === category_code);
    if (!section || !Array.isArray(section.items)) return false;

    // Filter visible, non-zero-price items
    const visibleItems = section.items.filter(item => {
        if (!item) return false;
        if (parseFloat(item.price) <= 0) return false;
        if (typeof isMenuCategoryOrItemHidden === 'function' && isMenuCategoryOrItemHidden('I', item.item_no)) return false;
        return true;
    });

    return visibleItems.length > 0;
}




document.addEventListener("DOMContentLoaded", () => {
    let langName = document.getElementById("currentLanguage");

    document.addEventListener("click", async function (e) {
        if (e.target.closest(".language-option")) {
            const option = e.target.closest(".language-option");
            //langName = option.getAttribute("ids"); // e.g. "English", "Tamil"

            updateCartTranslations(langName);
            console.log("🌐 Switching language to:", langName);

            // Load translations
            const result = await getMenuCategoryItemTranslations({ info: { language_name: langName } });

            // ✅ Guard against undefined
            if (window.languageSystem?.processTranslations) {
                window.languageSystem.processTranslations(langName, result);
            } else {
                console.warn("⚠️ window.languageSystem not found, skipping processTranslations");
            }

            // Refresh category tabs
            const categories = useCache().categories || [];
            await populateCategoryTabs(categories, langName);

            // Refresh menu grid for first category
            const firstCategory = categories[0];
            if (firstCategory) renderCategoryByCode(firstCategory.category_code, langName);

            console.log("✅ Language switch complete!");
        }
    });
});


document.querySelectorAll('.landing-option').forEach(option => {
    option.addEventListener("click", () => {
        localStorage.setItem('orderType', option.dataset.type);
        selectOrderType(option.dataset.type, document.getElementById("currentLanguage").innerText);
        console.log(document.getElementById("currentLanguage").innerText)
    });
});

function updateCartTranslations(langName) {
    const t = uiTranslations[langName];

    if (!t) return; // fallback if language not found

    // Header
    document.querySelector(".cart-header h2").textContent = t.yourOrder;

    // Empty cart message
    const emptyCart = document.querySelector(".empty-cart");
    if (emptyCart) {
        emptyCart.innerHTML = `${t.emptyCart}<br>${t.selectItems}`;
    }

    // Labels
    document.querySelector(".subtotal .cart-total-label").textContent = t.subtotal + ":";
    document.querySelector("#service-charge").closest(".cart-total-row").querySelector(".cart-total-label").childNodes[0].textContent = t.serviceCharge + " (";
    document.querySelector("#gst").closest(".cart-total-row").querySelector(".cart-total-label").childNodes[0].textContent = t.gst + " (";
    document.querySelector(".final-total .cart-total-label").textContent = t.total + ":";

    // Button
    document.querySelector("#checkout-btn").textContent = t.placeOrder;
}

document.getElementById('checkout-btn').addEventListener('click', async function () {
    console.log('Checkout button clicked');
    // ✅ Get order from useOrder store instead of localStorage
    const { order } = useOrder();
    if (!order || !order.sales_dtls || order.sales_dtls.length === 0) {
        console.error('No items in order');
        showErrorModal(
            'Empty Cart',
            'Your cart is empty. Please add items before checking out.'
        );
        return;
    }
    try {
        // Convert order to JSON for API
        const orderJson = JSON.stringify({ state: { order } });
        console.log("Sending order to API:", orderJson);
        const result = await postOrder(orderJson);
        if (result.success && result.response && result.response.length > 0) {
            const orderResult = result.response[0];
            if (orderResult.result === "SUCCESS") {
                console.log('✅ Order successful:', orderResult);
                // ✅ Keep reference to orderData BEFORE clearing
                const orderDataForModal = JSON.parse(JSON.stringify(order)); // Deep clone
                // Clear the cart and localStorage
                cart = [];
                localStorage.removeItem("order");
                // Clear Zustand store
                const { setOrder } = useOrder();
                const orderType = localStorage.getItem("orderType");
                const newOrder = getNewOrderSOK({ service_type: orderType });
                setOrder(newOrder);
                // Update displays
                clearCart();
                renderCartFromOrder();
                updateCartCount();
                // Close cart modal
                closeCartModal();
                // ✅ Show success modal with complete order details
                showSuccessModal({
                    sales_no: orderResult.sales_no,
                    orderData: orderDataForModal,  // Pass the cloned order data
                    orderResult: orderResult
                });
                console.log('✅ Order completed successfully');
            } else {
                console.error('❌ Order failed:', orderResult);
                showErrorModal(
                    'Order Failed',
                    orderResult.information || 'Unknown error occurred while processing your order.',
                    JSON.stringify(orderResult, null, 2),
                    () => document.getElementById('checkout-btn').click() // Retry callback
                );
            }
        } else {
            console.error('❌ Invalid API response:', result);
            showErrorModal(
                'Server Error',
                'Invalid response from server. Please try again later.',
                JSON.stringify(result, null, 2),
                () => document.getElementById('checkout-btn').click() // Retry callback
            );
        }
    } catch (error) {
        console.error('❌ Checkout error:', error);
        showErrorModal(
            'Checkout Error',
            error.message || 'An unexpected error occurred during checkout. Please try again.',
            `${error.name}: ${error.message}\n\nStack: ${error.stack}`,
            () => document.getElementById('checkout-btn').click() // Retry callback
        );
    }
});

// ============================================
// EMPTY CART FUNCTIONALITY (CONSOLIDATED)
// ============================================

document.addEventListener('DOMContentLoaded', function () {
    const emptyCartBtn = document.getElementById('empty-cart-btn');
    const emptyCartModal = document.getElementById('emptyCartModalOverlay');
    const cancelBtn = document.getElementById('cancelEmptyCart');
    const confirmBtn = document.getElementById('confirmEmptyCart');

    if (!emptyCartBtn || !emptyCartModal) {
        console.error('❌ Empty cart elements not found');
        return;
    }

    // Show confirmation modal
    emptyCartBtn.addEventListener('click', function () {
        console.log('🗑️ Empty cart button clicked');

        const order = localStorage.getItem("order");
        if (!order) {
            console.log('Cart is already empty');
            if (typeof window.sokWebSocket?.showUpdateNotification === 'function') {
                window.sokWebSocket.showUpdateNotification(
                    "Cart Empty",
                    "Your cart is already empty"
                );
            }
            return;
        }

        emptyCartModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    });

    // Cancel empty cart
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            console.log('❌ Empty cart cancelled by user');
            emptyCartModal.classList.remove('active');
            document.body.style.overflow = 'auto';
        });
    }

    // Confirm empty cart
    if (confirmBtn) {
        confirmBtn.addEventListener('click', async function () {
            console.log('🔄 Starting cart clear via modal...');

            const loadingBtn = confirmBtn;
            const originalText = loadingBtn.textContent;

            try {
                loadingBtn.disabled = true;
                loadingBtn.textContent = 'Clearing...';

                const { order } = useOrder();
                if (!order || !Array.isArray(order.sales_dtls) || order.sales_dtls.length === 0) {
                    console.log('Cart is already empty');
                    return;
                }

                // Delete all items one by one using existing deleteIndividualItem
                for (const item of [...order.sales_dtls]) {
                    await deleteIndividualItem(item);
                }

                // Close modal and show success
                emptyCartModal.classList.remove('active');
                document.body.style.overflow = 'auto';
                closeCartModal();

                console.log("🎉 Cart cleared via modal successfully");

            } catch (error) {
                console.error("❌ Error emptying cart via modal:", error);

                if (typeof window.sokWebSocket?.showUpdateNotification === 'function') {
                    window.sokWebSocket.showUpdateNotification(
                        "Clear Error",
                        "Failed to empty cart. Please try again."
                    );
                }

                alert("An error occurred while emptying the cart.");
            } finally {
                loadingBtn.disabled = false;
                loadingBtn.textContent = originalText;
            }
        });

    }

    // Close overlay
    emptyCartModal.addEventListener('click', function (e) {
        if (e.target === emptyCartModal) {
            emptyCartModal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    });
});


// ============================================
// ERROR MODAL SYSTEM
// ============================================

function showErrorModal(title, message, technicalDetails = null, onRetry = null) {
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

function closeErrorModal() {
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

// Close on overlay click
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
function showSuccessModal(orderDetails) {
    // Handle both old (just sales number) and new (full details) formats
    let sales_no, orderData, orderResult;

    if (typeof orderDetails === 'object' && orderDetails.sales_no) {
        sales_no = orderDetails.sales_no;
        orderData = orderDetails.orderData;
        orderResult = orderDetails.orderResult;
    } else {
        sales_no = orderDetails;
    }

    // ✅ Get dynamic colors from config
    const primaryColor = RESTAURANT_CONFIG?.color || '#22c55e';
    const restaurantLogo = RESTAURANT_CONFIG?.logo || '';

    // Update the order number
    document.getElementById('orderNumber').textContent = sales_no || `#${String(orderCounter).padStart(3, '0')}`;

    // Get order details container
    const orderDetailsContainer = document.getElementById('orderDetailsContainer');

    if (!orderDetailsContainer) {
        console.error('Order details container not found');
        document.getElementById('successModal').style.display = 'flex';
        return;
    }

    // Populate order details if we have the data
    if (orderData && orderData.sales_dtls) {
        const orderDate = orderData.doc_date ?
            new Date(orderData.doc_date).toLocaleString('en-US', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }) :
            new Date().toLocaleString('en-US', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

        // Retrieve MenuItems for image URLs
        let MenuItems = [];
        try {
            const cached = getMenuItems();
            if (Array.isArray(cached)) {
                MenuItems = cached.flatMap(category => category.items || []);
            } else {
                const stored = sessionStorage.getItem("MenuItems");
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed)) {
                        MenuItems = parsed.flatMap(category => category.items || []);
                    }
                }
            }
        } catch (err) {
            console.error("Failed to retrieve MenuItems:", err);
        }

        // Helper function to get item image
        function getItemImage(item) {
            const menuItem = MenuItems.find(mi => mi.item_no === item.item_no);
            let imageUrl = item.tqr_image_url ||
                item.item_image ||
                menuItem?.tqr_image_url ||
                menuItem?.item_image ||
                '';

            if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('blob:')) {
                if (!imageUrl.startsWith('/')) {
                    const cleanFilename = imageUrl.split('?')[0];
                    imageUrl = `${RESTAURANT_CONFIG?.baseImageUrl || ''}${cleanFilename}`;
                }
            }

            return imageUrl || restaurantLogo;
        }

        // Group items by parent_sno
        const groupedItems = new Map();
        orderData.sales_dtls.forEach(item => {
            const parentSno = String(item.parent_sno || item.s_no);
            const currentSno = String(item.s_no);

            if (parentSno === currentSno) {
                groupedItems.set(parentSno, { parent: item, addons: [] });
            } else {
                if (!groupedItems.has(parentSno)) {
                    groupedItems.set(parentSno, { parent: null, addons: [] });
                }
                groupedItems.get(parentSno).addons.push(item);
            }
        });

        const gstRate = parseFloat(sessionStorage.getItem("GST")) || 9;
        const serviceRate = parseFloat(sessionStorage.getItem("ServiceCharge")) || 10;

        const subtotal = parseFloat(orderData.sub_total || 0);
        const discount = parseFloat(orderData.total_disc || 0);
        const serviceCharge = parseFloat(orderData.total_svc || 0);
        const gst = parseFloat(orderData.total_tax || 0);
        const total = parseFloat(orderData.net_amt || 0);

        const summaryHTML = `
            <div class="order-price-summary">
                <div class="summary-row">
                    <span class="summary-label">Subtotal:</span>
                    <span class="summary-value">$${subtotal.toFixed(2)}</span>
                </div>

                ${discount > 0 ? `
                <div class="summary-row summary-discount">
                    <span class="summary-label">Discount:</span>
                    <span class="summary-value">−$${discount.toFixed(2)}</span>
                </div>` : ''}

                <div class="summary-row">
                    <span class="summary-label">Service Charge (${serviceRate}%):</span>
                    <span class="summary-value">$${serviceCharge.toFixed(2)}</span>
                </div>

                ${gst >= 0 ? `
                <div class="summary-row">
                    <span class="summary-label">GST (${gstRate}%):</span>
                    <span class="summary-value">$${gst.toFixed(2)}</span>
                </div>` : ''}

                <div class="summary-row summary-total" style="border-top-color: ${primaryColor};">
                    <span class="summary-label">Total:</span>
                    <span class="summary-value" style="color: ${primaryColor};">
                        $${total.toFixed(2)}
                    </span>
                </div>
            </div>
        `;



        const detailsHTML = `
            <!-- Order Info Header -->
            <div class="order-info-header" style="background: ${primaryColor};">
                <div class="order-info-row">
                    <span class="order-info-label">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        Date:
                    </span>
                    <strong class="order-info-value">${orderDate}</strong>
                </div>
                <div class="order-info-row">
                    <span class="order-info-label">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                            <line x1="1" y1="10" x2="23" y2="10"></line>
                        </svg>
                        Payment:
                    </span>
                    <strong class="order-info-value">QLUB</strong>
                </div>
            </div>

            <!-- Order Items Section -->
            <div class="order-items-section">
                <h3 class="order-items-title">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${primaryColor}" stroke-width="2">
                        <rect x="3" y="3" width="7" height="7"></rect>
                        <rect x="14" y="3" width="7" height="7"></rect>
                        <rect x="14" y="14" width="7" height="7"></rect>
                        <rect x="3" y="14" width="7" height="7"></rect>
                    </svg>
                    Order Items
                </h3>
                <div class="order-items-grid">
                    ${Array.from(groupedItems.values()).map(({ parent, addons }) => {
            if (!parent) return '';

            const imageUrl = getItemImage(parent);
            const itemName = parent.item_name || parent.product_name || 'Unknown Item';
            const qty = parent.qty || 1;
            const price = parseFloat(parent.sub_total || parent.amt || 0);
            const remarks = parent.remarks ? parent.remarks.trim() : '';

            const addonTotal = addons.reduce((sum, addon) =>
                sum + parseFloat(addon.sub_total || addon.amt || 0), 0
            );
            const totalPrice = price + addonTotal;

            return `
                            <div class="order-item-card">
                                <div class="order-item-image">
                                    <img src="${imageUrl}" alt="${itemName}"
                                         onerror="if(this.src!=='${restaurantLogo}') this.src='${restaurantLogo}'; else this.style.display='none';" />
                                </div>
                                <div class="order-item-details">
                                    <div class="order-item-header">
                                        <div class="order-item-title">
                                            <div class="order-item-name">
                                                <span class="order-item-qty-badge" style="background: ${primaryColor};">${qty}×</span>
                                                ${itemName}
                                            </div>
                                        </div>
                                        <div class="order-item-price" style="color: ${primaryColor};">
                                            $${totalPrice.toFixed(2)}
                                        </div>
                                    </div>

                                    ${addons.length > 0 ? `
                                        <div class="order-item-base-price">
                                            Base: $${price.toFixed(2)}
                                        </div>
                                    ` : ''}

                                    ${remarks ? `
                                        <div class="order-item-remarks">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                            </svg>
                                            ${remarks}
                                        </div>
                                    ` : ''}

                                    ${addons.length > 0 ? `
                                        <div class="order-item-addons" style="border-left: 2px solid ${primaryColor};">
                                            ${addons.map(addon => {
                const addonName = addon.item_name || addon.product_name || 'Unknown';
                const addonQty = addon.qty || 1;
                const addonPrice = parseFloat(addon.sub_total || addon.amt || 0);
                const addonRemarks = addon.remarks ? addon.remarks.trim() : '';

                return `
                                                    <div class="order-addon-item">
                                                        <div class="order-addon-content">
                                                            <span class="order-addon-prefix" style="color: ${primaryColor};">+</span>
                                                            <strong class="order-addon-name">${addonName}</strong>${addonQty > 1 ? `<span class="order-addon-qty"> ×${addonQty}</span>` : ''}
                                                            ${addonRemarks ? `
                                                                <div class="order-addon-remarks">
                                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                                                    </svg>
                                                                    ${addonRemarks}
                                                                </div>
                                                            ` : ''}
                                                        </div>
                                                        ${addonPrice > 0 ? `
                                                            <span class="order-addon-price">+$${addonPrice.toFixed(2)}</span>
                                                        ` : ''}
                                                    </div>
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

            ${summaryHTML}
        `;

        orderDetailsContainer.innerHTML = detailsHTML;
    } else {
        orderDetailsContainer.innerHTML = `
            <div class="order-empty-state">
                <svg class="order-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                No order details available.
            </div>
        `;
    }

    // Display modal
    document.getElementById('successModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Increment order counter
    if (typeof orderCounter !== 'undefined') {
        orderCounter++;
    }
}

export function closeModal() {
    document.getElementById('successModal').style.display = 'none';

    // Optional: Reset any current addon parent item
    if (typeof currentAddonParentItem !== 'undefined') {
        currentAddonParentItem = null;
    }
}




function initMobileOptimizations() {
    // Detect if mobile
    const isMobile = window.innerWidth <= 992;

    if (isMobile) {
        // Force bottom nav visibility
        const bottomNav = document.querySelector('.bottom-nav');
        if (bottomNav && cart.length > 0) {
            bottomNav.style.display = 'flex';
        }

        // Disable hover effects on mobile
        document.body.classList.add('mobile-device');
    }

    // Handle orientation changes
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            updateCartCount();
            renderCartFromOrder();
        }, 200);
    });
}


function initMobileCategoryTabs() {
    // Only run on mobile
    if (window.innerWidth > 992) return;

    const sidebar = document.querySelector('.navigation-sidebar');
    const categoryTabs = document.querySelectorAll('.category-tab');

    if (!sidebar || categoryTabs.length === 0) return;

    console.log('📱 Initializing mobile category tabs');

    function scrollToActiveTab() {
        const activeTab = sidebar.querySelector('.category-tab.active');
        if (!activeTab) return;

        const sidebarWidth = sidebar.offsetWidth;
        const tabLeft = activeTab.offsetLeft;
        const tabWidth = activeTab.offsetWidth;

        // Calculate scroll position to center the active tab
        const scrollPosition = tabLeft - (sidebarWidth / 2) + (tabWidth / 2);

        sidebar.scrollTo({
            left: scrollPosition,
            behavior: 'smooth'
        });

        console.log('📍 Scrolled to active tab:', activeTab.textContent.trim());
    }


    let startX = 0;
    let scrollLeft = 0;
    let isDown = false;

    sidebar.addEventListener('mousedown', (e) => {
        isDown = true;
        sidebar.style.cursor = 'grabbing';
        startX = e.pageX - sidebar.offsetLeft;
        scrollLeft = sidebar.scrollLeft;
    });

    sidebar.addEventListener('mouseleave', () => {
        isDown = false;
        sidebar.style.cursor = 'grab';
    });

    sidebar.addEventListener('mouseup', () => {
        isDown = false;
        sidebar.style.cursor = 'grab';
    });

    sidebar.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - sidebar.offsetLeft;
        const walk = (x - startX) * 2;
        sidebar.scrollLeft = scrollLeft - walk;
    });

    // Touch events for mobile
    let touchStartX = 0;
    let touchScrollLeft = 0;

    sidebar.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].pageX - sidebar.offsetLeft;
        touchScrollLeft = sidebar.scrollLeft;
    });

    sidebar.addEventListener('touchmove', (e) => {
        const x = e.touches[0].pageX - sidebar.offsetLeft;
        const walk = (x - touchStartX) * 2;
        sidebar.scrollLeft = touchScrollLeft - walk;
    });

    // ============================================
    // SCROLL INDICATORS (OPTIONAL)
    // ============================================
    function updateScrollIndicators() {
        const scrollLeft = sidebar.scrollLeft;
        const scrollWidth = sidebar.scrollWidth;
        const clientWidth = sidebar.clientWidth;

        // Add shadow on left if scrolled
        if (scrollLeft > 10) {
            sidebar.style.boxShadow = 'inset 10px 0 10px -10px rgba(0,0,0,0.3), 0 2px 8px rgba(0, 0, 0, 0.1)';
        }
        // Add shadow on right if not at end
        else if (scrollLeft + clientWidth < scrollWidth - 10) {
            sidebar.style.boxShadow = 'inset -10px 0 10px -10px rgba(0,0,0,0.3), 0 2px 8px rgba(0, 0, 0, 0.1)';
        }
        // No shadow if at boundaries
        else {
            sidebar.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        }
    }

    sidebar.addEventListener('scroll', updateScrollIndicators);

    // ============================================
    // INITIALIZE ON LOAD
    // ============================================
    setTimeout(() => {
        scrollToActiveTab();
        updateScrollIndicators();
    }, 100);

    console.log('✅ Mobile category tabs initialized');
}

// ============================================
// SNAP SCROLLING TO NEAREST TAB (OPTIONAL)
// ============================================
function initSnapScrolling() {
    if (window.innerWidth > 992) return;

    const sidebar = document.querySelector('.navigation-sidebar');
    if (!sidebar) return;

    let scrollTimeout;

    sidebar.addEventListener('scroll', function () {
        // Clear previous timeout
        clearTimeout(scrollTimeout);

        // Set timeout to snap after scrolling stops
        scrollTimeout = setTimeout(() => {
            const tabs = sidebar.querySelectorAll('.category-tab');
            const sidebarRect = sidebar.getBoundingClientRect();
            const sidebarCenter = sidebarRect.left + sidebarRect.width / 2;

            let closestTab = null;
            let closestDistance = Infinity;

            // Find the tab closest to center
            tabs.forEach(tab => {
                const tabRect = tab.getBoundingClientRect();
                const tabCenter = tabRect.left + tabRect.width / 2;
                const distance = Math.abs(tabCenter - sidebarCenter);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestTab = tab;
                }
            });

            // Snap to closest tab
            if (closestTab) {
                const tabLeft = closestTab.offsetLeft;
                const tabWidth = closestTab.offsetWidth;
                const scrollPosition = tabLeft - (sidebarRect.width / 2) + (tabWidth / 2);

                sidebar.scrollTo({
                    left: scrollPosition,
                    behavior: 'smooth'
                });
            }
        }, 150); // Delay after scroll stops
    });
}

// ============================================
// KEYBOARD NAVIGATION (ACCESSIBILITY)
// ============================================
function initKeyboardNavigation() {
    if (window.innerWidth > 992) return;

    const categoryTabs = document.querySelectorAll('.category-tab');

    categoryTabs.forEach((tab, index) => {
        tab.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' && index > 0) {
                e.preventDefault();
                categoryTabs[index - 1].focus();
                categoryTabs[index - 1].click();
            } else if (e.key === 'ArrowRight' && index < categoryTabs.length - 1) {
                e.preventDefault();
                categoryTabs[index + 1].focus();
                categoryTabs[index + 1].click();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                tab.click();
            }
        });
    });
}

// ============================================
// INITIALIZE ON DOM READY
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    initMobileCategoryTabs();
    initSnapScrolling();
    initKeyboardNavigation();
});

// Re-initialize on window resize
let resizeTimeout;
window.addEventListener('resize', function () {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        initMobileCategoryTabs();
        initSnapScrolling();
        initKeyboardNavigation();
    }, 250);
});

// ============================================
// AUTO-SCROLL CAROUSEL (AUTO SWITCH CATEGORIES)
// ============================================
let autoScrollInterval = null;
let autoScrollEnabled = false;
const AUTO_SCROLL_DELAY = 5000; // 5 seconds per category

function startAutoScroll() {
    if (window.innerWidth > 992) return;

    const categoryTabs = document.querySelectorAll('.category-tab');
    if (categoryTabs.length === 0) return;

    let currentIndex = 0;

    // Find current active tab index
    categoryTabs.forEach((tab, index) => {
        if (tab.classList.contains('active')) {
            currentIndex = index;
        }
    });

    console.log('🔄 Auto-scroll started');
    autoScrollEnabled = true;

    autoScrollInterval = setInterval(() => {
        // Move to next tab
        currentIndex = (currentIndex + 1) % categoryTabs.length;

        // Click the next tab
        categoryTabs[currentIndex].click();

        console.log(`📱 Auto-switched to: ${categoryTabs[currentIndex].textContent.trim()}`);
    }, AUTO_SCROLL_DELAY);
}

function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
        autoScrollEnabled = false;
        console.log('⏸️ Auto-scroll stopped');
    }
}


window.mobileCategoryTabs = {
    init: initMobileCategoryTabs,
    scrollToActive: function () {
        const sidebar = document.querySelector('.navigation-sidebar');
        const activeTab = sidebar?.querySelector('.category-tab.active');
        if (activeTab) {
            const sidebarWidth = sidebar.offsetWidth;
            const tabLeft = activeTab.offsetLeft;
            const tabWidth = activeTab.offsetWidth;
            const scrollPosition = tabLeft - (sidebarWidth / 2) + (tabWidth / 2);

            sidebar.scrollTo({
                left: scrollPosition,
                behavior: 'smooth'
            });
        }
    },
    startAutoScroll: startAutoScroll,
    stopAutoScroll: stopAutoScroll,
    //pauseAutoScroll: pauseAutoScroll,
    isAutoScrollEnabled: function () {
        return autoScrollEnabled;
    }
};

function getDeviceIdFromUrl() {
    const path = window.location.pathname;
    const search = window.location.search;

    console.log('🔍 Parsing URL:', window.location.href);
    console.log('📍 Path:', path);
    console.log('📍 Search params:', search);

    // OPTION 1: Query parameter (?device_id=01) - HIGHEST PRIORITY
    const urlParams = new URLSearchParams(search);
    const deviceIdFromQuery = urlParams.get('device_id');

    if (deviceIdFromQuery && deviceIdFromQuery.trim() !== '') {
        console.log('✅ Device ID from query parameter:', deviceIdFromQuery);
        // Store immediately
        localStorage.setItem('sok_device_id', deviceIdFromQuery);
        return deviceIdFromQuery;
    }

    // OPTION 2: Check localStorage (might have been set earlier)
    const storedDeviceId = localStorage.getItem('sok_device_id');
    if (storedDeviceId && storedDeviceId.trim() !== '' && !storedDeviceId.startsWith('KIOSK_')) {
        console.log('✅ Device ID from localStorage:', storedDeviceId);
        return storedDeviceId;
    }

    // OPTION 3: Path parameter (/Jewel/01)
    const pathParts = path.split('/').filter(part => part.trim() !== '');
    // Structure: ['KIOSK', 'Home', 'Jewel', '01']

    if (pathParts.length >= 4) {
        const lastPart = pathParts[3];

        // Check if it contains device_id= (Option 3)
        if (lastPart.includes('device_id=')) {
            const deviceId = lastPart.split('=')[1];
            console.log('✅ Device ID from path (format: device_id=XX):', deviceId);
            localStorage.setItem('sok_device_id', deviceId);
            return deviceId;
        }

        // Otherwise, treat as direct device ID (Option 2)
        console.log('✅ Device ID from path:', lastPart);
        localStorage.setItem('sok_device_id', lastPart);
        return lastPart;
    }

    console.warn('⚠️ No device ID found in URL');
    return null;
}
// ✅ Get SOK location from URL
function getSokLocationFromUrl() {
    const path = window.location.pathname;
    const pathParts = path.split('/').filter(part => part.trim() !== '');

    // Structure: ['KIOSK', 'Home', 'Jewel', ...]
    // Index 0: KIOSK, Index 1: Home, Index 2: Location

    if (pathParts.length >= 3) {
        const location = pathParts[2]; // "Jewel"
        console.log('✅ SOK Location from URL:', location);
        return location;
    }

    console.warn('⚠️ No location found in URL');
    return 'Unknown Location';
}

// ✅ Parse all URL info at once
function parseKioskUrl() {
    const deviceId = getDeviceIdFromUrl();
    const location = getSokLocationFromUrl();

    const urlInfo = {
        deviceId: deviceId || 'UNKNOWN',
        location: location || 'Unknown',
        fullUrl: window.location.href,
        isValid: !!(deviceId && location)
    };

    console.log('📍 Parsed Kiosk URL:', urlInfo);
    return urlInfo;
}


async function initializeDeviceId() {
    // --- Step 1: Get or generate device ID ---
    let deviceId = getDeviceIdFromUrl();
    if (!deviceId) deviceId = localStorage.getItem("sok_device_id");
    if (!deviceId) {
        deviceId = `KIOSK_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log('🆕 Generated fallback device ID:', deviceId);
    } else {
        console.log('✅ Using device ID from URL or localStorage:', deviceId);
    }
    if (window.sokWebSocket) {
        console.log('✅ sokWebSocket already initialized, skipping duplicate');
        return deviceId;
    }
    // --- Step 2: Get location/type from URL ---
    const location = getSokLocationFromUrl();

    // Store in localStorage
    localStorage.setItem("sok_device_id", deviceId);
    localStorage.setItem("sok_location", location);

    // --- Step 3: Register device with server ---
    try {
        const response = await fetch('/API/RemoteControl/register-device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId,
                deviceName: `Kiosk ${location} - ${deviceId}`,
                location,
                registeredAt: new Date().toISOString()
            })
        });

        if (response.ok) {
            const result = await response.json();
            console.log('✅ Device registered:', result);
            if (result.device) localStorage.setItem("sok_device_info", JSON.stringify(result.device));
        } else {
            const errorText = await response.text();
            console.error('❌ Device registration failed:', errorText);
        }
    } catch (error) {
        console.error('❌ Error registering device:', error);
    }

    return deviceId;
}

