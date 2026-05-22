import dayjs from "https://esm.sh/dayjs";
import { useCache } from "../stores/cache-store.js";
import { useOrderStore, useOrder } from "../stores/order-store.js";
import { getNowInAPIFormat, getCookie, setCookie, same } from '../utils/common.js';

// Dynamic API base configuration
const getApiBase = () => {
    return window.location.origin + '/API';
};

const API_BASE = getApiBase();

console.log('🔧 Fixed API Base URL:', API_BASE);

// ─── FIX 2: Module-level translation cache keyed by language name ───────────
// Prevents GetMenuCategoryItemTranslations from being called more than once
// per language per session regardless of how many callers invoke it.
const translationsCache = new Map();

// ─── FIX 4: Promise-ref pattern for getLangs ────────────────────────────────
// Replaces the boolean `langsLoaded` flag. All concurrent callers share the
// same in-flight Promise so only one network request is ever made.
let langsPromise = null;

// Enhanced fetch with better error handling
async function apiFetch(endpoint, options = {}) {
    try {
        const url = `${API_BASE}${endpoint}`;
        console.log(`🔄 API Call: ${url}`);

        const response = await fetch(url, {
            credentials: 'include',
            ...options
        });

        console.log(`📡 Response Status: ${response.status} for ${endpoint}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`🚨 API Error (${endpoint}):`, error);
        throw error;
    }
}

// Function to extract clean store name from URL
function getCleanStoreName() {
    const currentPath = window.location.pathname;
    console.log('🔍 Analyzing URL for store name:', currentPath);

    const match = currentPath.match(/\/(?:kiosk|KIOSK)\/home\/([^\/]+)/i);
    if (match && match[1]) {
        let storeName = match[1];

        // Decode once
        storeName = decodeURIComponent(storeName);

        // Handle double-encoded case
        if (storeName.includes('%')) {
            try {
                storeName = decodeURIComponent(storeName);
                console.log('⚠️ Double-encoded URL detected and fixed');
            } catch (e) {
                console.warn('⚠️ Could not double-decode, using single decode');
            }
        }

        console.log('✅ Store name extracted from path (decoded):', storeName);
        return storeName;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const storeFromQuery = urlParams.get('store');
    if (storeFromQuery) {
        console.log('✅ Store name from query parameter:', storeFromQuery);
        return storeFromQuery;
    }

    const storedStore = localStorage.getItem('storeName');
    if (storedStore) {
        console.log('✅ Store name from localStorage:', storedStore);
        return storedStore;
    }

    throw new Error(`Cannot determine store name from URL: ${window.location.href}`);
}

function fullyDecodeURIComponent(str) {
    let decoded = str;
    let prevDecoded = '';
    while (decoded !== prevDecoded) {
        prevDecoded = decoded;
        try {
            decoded = decodeURIComponent(decoded);
        } catch (e) {
            break;
        }
    }
    return decoded;
}

function getCleanStoreNameRobust() {
    const currentPath = window.location.pathname;
    console.log('🔍 Analyzing URL for store name:', currentPath);

    const match = currentPath.match(/\/(?:kiosk|KIOSK)\/home\/([^\/]+)/i);
    if (match && match[1]) {
        const storeName = fullyDecodeURIComponent(match[1]);
        console.log('✅ Store name extracted from path (fully decoded):', storeName);
        return storeName;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const storeFromQuery = urlParams.get('store');
    if (storeFromQuery) return storeFromQuery;

    const storedStore = localStorage.getItem('storeName');
    if (storedStore) return storedStore;

    throw new Error(`Cannot determine store name from URL: ${window.location.href}`);
}

// Fetch and cache store details
export async function fetchStoreDetails(retryCount = 0) {
    const MAX_RETRIES = 2;
    const storeName = getCleanStoreName();

    try {
        console.log('🛍️ Fetching store details for:', storeName);

        const apiUrl = `/GetStore?storename=${encodeURIComponent(storeName)}`;
        console.log('🔄 API Call:', `${API_BASE}${apiUrl}`);

        const response = await apiFetch(apiUrl);   // assuming apiFetch returns the full parsed body

        // --- More flexible response parsing (handle different possible shapes) ---
        let store = null;

        if (response?.data?.[0]?.output?.[0]) {
            store = response.data[0].output[0];
        } else if (response?.data?.[0]) {
            store = response.data[0];
        } else if (response?.store || response?.data) {
            store = response.store || response.data;
        } else if (Array.isArray(response) && response.length > 0) {
            store = response[0];
        }

        if (!store || (typeof store === 'object' && Object.keys(store).length === 0)) {
            console.warn("⚠️ Store data returned but appears empty");
            throw new Error(`No valid store data found for "${storeName}"`);
        }

        // Cache it
        localStorage.setItem("storename", storeName);
        sessionStorage.setItem("store", JSON.stringify(store));
        useCache().setStore(store);
        useCache().setDate(getNowInAPIFormat());

        console.log("✅ Store loaded and cached successfully:", store.storename || store.name || store.StoreName || "Unknown");

        return store;

    } catch (err) {
        console.error(`🚨 Failed to fetch store details (attempt ${retryCount + 1}):`, err);

        // Retry logic for transient errors (including 500)
        if (retryCount < MAX_RETRIES) {
            const delay = 800 * (retryCount + 1);   // 800ms, 1600ms
            console.log(`🔁 Retrying store fetch in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchStoreDetails(retryCount + 1);
        }

        // Final failure
        const errorMsg = err.message || err.status
            ? `HTTP ${err.status || 'Unknown'} - ${err.message || 'Server error'}`
            : 'Unknown error while loading store';

        console.error('❌ All store fetch retries failed:', errorMsg);

        // Optional: Show user-friendly modal
        showErrorModal?.(
            'Cannot Load Store',
            `Failed to load store "${storeName}". Please check if the backend is running and the store exists.`,
            errorMsg
        );

        throw new Error(`Store load failed: ${errorMsg}`);
    }
}

export async function getCashReconStatus() {
    try {
        const data = await apiFetch('/GetCashReconStatus');
        console.log('✅ CashReconStatus loaded:', data);
        return data;
    } catch (err) {
        console.error('🚨 Failed to fetch CashReconStatus:', err);
        throw err;
    }
}

export async function getMenuItems(forceRefresh = false) {
    try {
        // ✅ Serve from memory cache when caller does not require a fresh fetch
        if (!forceRefresh) {
            const cached = useCache().menuItems;
            if (cached?.length) {
                console.log(`✅ getMenuItems: returning ${cached.length} sections from cache`);
                return cached;
            }

            // Fall back to sessionStorage if memory cache is cold
            const sessionCached = sessionStorage.getItem('MenuItems');
            if (sessionCached) {
                try {
                    const parsed = JSON.parse(sessionCached);
                    if (parsed?.length) {
                        console.log(`✅ getMenuItems: returning ${parsed.length} sections from sessionStorage`);
                        useCache().setMenuItems(parsed);
                        return parsed;
                    }
                } catch (e) {
                    console.warn('⚠️ Could not parse sessionStorage MenuItems:', e);
                }
            }
        }

        //// ✅ Only reaches here when forceRefresh=true or both caches are empty
        //sessionStorage.removeItem('MenuItems');
        const timestamp = new Date().getTime();
        console.log(`🔄 Fetching menu with cache-bust: ${timestamp}`);

        const data = await apiFetch(`/GetPOSMenuButton?_=${timestamp}`);
        const MenuItems = data?.data?.[0]?.output ?? [];

        console.log(`✅ API returned ${MenuItems.length} sections`);

        const firstItemWithImage = MenuItems
            .flatMap(section => section.items || [])
            .find(item => item.tqr_image_url);
        if (firstItemWithImage) {
            console.log('📸 First image from API:', firstItemWithImage.tqr_image_url);
        }

        sessionStorage.setItem("MenuItems", JSON.stringify(MenuItems));
        useCache().setMenuItems(MenuItems);

        return MenuItems;

    } catch (err) {
        console.error('🚨 Failed to fetch menu items:', err);
        return null;
    }
}



// Fetch and cache full item list
export async function getItems(params = {}) {
    try {
        const data = await apiFetch('/GetPosFullItemList');

        const itemsArray = data?.data?.[0]?.output || [];
        sessionStorage.setItem("FullItems", JSON.stringify(itemsArray));
        sessionStorage.setItem("GST", JSON.stringify(itemsArray[0]?.tax_value || 0));

        const gstElement = document.getElementById("gst-rate");
        if (gstElement) {
            gstElement.textContent = JSON.stringify(itemsArray[0]?.tax_value || 0);
        }

        useCache().setItems(itemsArray);
        console.log("✅ Items loaded and cached (array only):", itemsArray);
        return itemsArray;
    } catch (err) {
        console.error('🚨 Failed to fetch items:', err);
        return null;
    }
}

// Fetch and cache add-ons
export async function getAddons(params = {}) {
    try {
        const data = await apiFetch('/GetStoreAddonDtls');

        const addonList = data?.data?.[0]?.output || [];
        sessionStorage.setItem("AddOnItems", JSON.stringify(addonList));
        useCache().setAddons(addonList);

        console.log("✅ Addons loaded and cached:", addonList);
        return addonList;

    } catch (err) {
        console.error('🚨 Failed to fetch addons:', err);
        return null;
    }
}

// Fetch and cache item remarks
export async function getItemRemarks(params = {}) {
    try {
        const data = await apiFetch('/getItemRemarks');
        const itemRemarks = data?.output || [];

        sessionStorage.setItem("ItemRemarks", JSON.stringify(itemRemarks));
        window.remarksCache = itemRemarks;

        if (typeof useCache === 'function') {
            useCache().setItemRemarks?.(itemRemarks);
        }

        console.log("✅ ItemRemarks loaded and cached:", itemRemarks.length, "items");
        return itemRemarks;

    } catch (err) {
        console.error('🚨 Failed to fetch ItemRemarks:', err);

        const cached = sessionStorage.getItem("ItemRemarks");
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                window.remarksCache = parsed;
                console.log("🔄 Using cached remarks from sessionStorage");
                return parsed;
            } catch (e) {
                console.error("❌ Failed to parse cached remarks:", e);
            }
        }

        return [];
    }
}

export async function getItemRemarksByType(params = {}) {
    try {
        const data = await apiFetch('/GetRemarksByType');
        const itemRemarks = data?.output || [];

        sessionStorage.setItem("AllRemarks", JSON.stringify(itemRemarks));
        window.remarksCache = itemRemarks;

        if (typeof useCache === 'function') {
            useCache().setAllRemarks?.(itemRemarks);
        }

        console.log("✅ ItemRemarks loaded and cached:", itemRemarks.length, "items");
        return itemRemarks;

    } catch (err) {
        console.error('🚨 Failed to fetch ItemRemarks:', err);

        const cached = sessionStorage.getItem("AllRemarks");
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                window.remarksCache = parsed;
                console.log("🔄 Using cached all remarks from sessionStorage");
                return parsed;
            } catch (e) {
                console.error("❌ Failed to parse cached all remarks:", e);
            }
        }

        return [];
    }
}

export async function getPromos(params = {}) {
    try {
        const { sessionid, store, setPromos } = useCache();
        const data = await apiFetch('/getPromos');

        const promoItems = data?.output || [];
        setPromos(promoItems);
        sessionStorage.setItem("PromotionItems", JSON.stringify(promoItems));
        console.log("✅ PromotionItems loaded and cached:", promoItems);
        return promoItems;

    } catch (err) {
        console.error('🚨 Failed to fetch PromotionItems:', err);
        return null;
    }
}

export async function getSvcs(params = {}) {
    try {
        const { setSvcs } = useCache();
        const data = await apiFetch('/getSvcs');

        const svcs = data?.data || [];
        setSvcs(svcs);
        sessionStorage.setItem("ServiceCharges", JSON.stringify(svcs));

        console.log("✅ serviceCharges loaded and cached:", svcs);
        return svcs;
    } catch (err) {
        console.error('🚨 Failed to fetch service charges:', err);
        return null;
    }
}

// ─── FIX 4: getLangs — Promise-ref pattern ───────────────────────────────────
// All concurrent callers share the same in-flight Promise.
// On success the result is permanently cached (langsPromise stays set).
// On error langsPromise is reset to null so a genuine retry is possible,
// but a rapid second call during the same failure won't fire a second request.
export async function getLangs(params = {}) {
    if (langsPromise) {
        console.log("⚠️ getLangs already called, awaiting shared promise");
        return langsPromise;
    }

    langsPromise = (async () => {
        console.log("🔥 getLangs() triggered once");

        try {
            sessionStorage.setItem("selectedLang", "English");
            const { setLangs } = useCache();

            const data = await apiFetch('/getLangs');
            const svcsLangs = Array.isArray(data?.data) ? data.data : [];

            const languageDiv = document.getElementById("languageOptions");
            if (languageDiv) {
                const languageOptionsHTML = svcsLangs.map(lang => {
                    const langCode = generateLanguageCode(lang.language_name);
                    const isDefault = lang.is_default === 1 ? 'active' : '';
                    return `
                      <div class="language-option ${isDefault}" data-lang="${langCode}" ids="${lang.language_name}" onclick="selectLanguage('${langCode}', '${lang.language_name}')">
                          <option value="${lang.language_name}">${lang.language_name}</option>
                      </div>`;
                }).join('');
                languageDiv.innerHTML = languageOptionsHTML;
            }

            setLangs(svcsLangs);
            localStorage.setItem("serviceLanguages", JSON.stringify(svcsLangs));

            const defaultLang = svcsLangs.find(lang => lang.is_default === 1);

            if (defaultLang) {
                const defaultCode = generateLanguageCode(defaultLang.language_name);
                const defaultName = defaultLang.language_name;
                const savedLang = localStorage.getItem('currentLanguage');

                if (savedLang) {
                    try {
                        const { code, name } = JSON.parse(savedLang);
                        // ✅ FIX 1: selectLanguage() already calls getMenuCategoryItemTranslations()
                        // internally, so we must NOT call it again here.
                        selectLanguage(code, name);
                        console.log("✅ Loaded saved language:", name);
                    } catch (err) {
                        console.error("❌ Failed to parse saved language, using default");
                        selectLanguage(defaultCode, defaultName);
                    }
                } else {
                    // ✅ FIX 1: only selectLanguage() — no extra translation call
                    selectLanguage(defaultCode, defaultName);
                    console.log("✅ Using default language:", defaultName);
                }
            }

            console.log("✅ Languages loaded from API:", svcsLangs);
            return svcsLangs;

        } catch (err) {
            console.error("🚨 Failed to fetch languages:", err);
            // ✅ FIX 4: reset so a genuine retry is allowed after an actual failure,
            // but concurrent callers during the same request are not affected.
            langsPromise = null;
            throw err;
        }
    })();

    return langsPromise;
}

// ─── FIX 1 + 2: selectLanguage — single translation call, no duplicate ───────
function selectLanguage(code, name) {
    console.log("Selecting language:", code, name);

    localStorage.setItem('currentLanguage', JSON.stringify({ code, name }));

    document.querySelectorAll('.language-option').forEach(opt => {
        opt.classList.remove('active');
    });
    document.querySelector(`[data-lang="${code}"]`)?.classList.add('active');

    sessionStorage.setItem("selectedLang", name);

    // ✅ This is the ONLY place getMenuCategoryItemTranslations is called for
    // language selection. getLangs() must NOT call it again after selectLanguage().
    if (name) {
        getMenuCategoryItemTranslations(name);
    }
}

export const checkStocks = async (params) => {
    params = params || {};
    const { setStocks } = useCache();
    const check = params.info?.check !== undefined ? params.info.check : true;
    const sales_dtls = params.info?.sales_dtls || [];

    const data = await apiFetch('/checkStocks');

    const stocks = Array.isArray(data?.data?.[0]?.output)
        ? data.data[0].output
        : [];

    let valid = true;
    let unavailableItems = [];

    if (stocks.length && check) {
        const orderItemsWithQty = [];
        sales_dtls.forEach((item) => {
            const existingItem = orderItemsWithQty.find((collapsed) =>
                collapsed.item_name?.toLowerCase() === item.item_name?.toLowerCase()
            );
            if (existingItem) {
                existingItem.qty = parseFloat(existingItem.qty) + parseFloat(item.qty);
            } else {
                orderItemsWithQty.push({
                    item_name: item.item_name,
                    item_desc: item.item_desc,
                    item_category: item.item_category,
                    qty: item.qty,
                });
            }
        });

        orderItemsWithQty.forEach((item) => {
            const stock = stocks.find(
                (s) =>
                    s.avl_type?.toLowerCase() === "c" &&
                    s.item_category?.toLowerCase() === item.item_category?.toLowerCase()
            );
            if (stock) {
                if (bool(stock.is_soldout)) {
                    valid = false;
                    unavailableItems.push({
                        item_name: item.item_name,
                        item_desc: item.item_desc,
                        bal_qty: 0,
                        is_soldout: true,
                    });
                } else if (
                    bool(stock.is_avl_limit_check) &&
                    parseFloat(item.qty) > parseFloat(stock.bal_qty)
                ) {
                    valid = false;
                    unavailableItems.push({
                        item_name: item.item_name,
                        item_desc: item.item_desc,
                        bal_qty: stock.bal_qty,
                        is_avl_limit_check: true,
                    });
                }
            }
        });
    }

    setStocks(stocks);
    sessionStorage.setItem("stocks", JSON.stringify(stocks));
    return { stocks, valid, unavailableItems };
};

// ─── FIX 2: getMenuCategoryItemTranslations — cache guard by language ─────────
// A module-level Map means any second (or third) call for the same language
// returns the already-fetched result immediately without hitting the network.
export const getMenuCategoryItemTranslations = async (languageName) => {
    const { setMenuCategoryItemTranslations } = useCache();

    const langName = typeof languageName === 'string'
        ? languageName
        : languageName?.info?.language_name;

    if (!langName) {
        console.error("❌ No language name provided for translations");
        return { translations: [], map: {} };
    }

    // ✅ Return cached result if this language was already fetched
    if (translationsCache.has(langName)) {
        console.log(`✅ Translations cache hit for: ${langName}`);
        return translationsCache.get(langName);
    }

    let translations = [];
    let map = {};

    try {
        const data = await apiFetch(`/GetMenuCategoryItemTranslations?languageName=${encodeURIComponent(langName)}`);

        console.log("Translation API response:", data);

        if (data) {
            translations = data?.data || [];
        }

        sessionStorage.setItem("MenuCategoryItemTranslation", JSON.stringify(translations));
        setMenuCategoryItemTranslations(translations);

        translations.forEach((row) => {
            if (row?.item_no && row?.item_name_lang) {
                map[row.item_no] = row.item_name_lang;
            }
            if (row?.category_code && row?.category_name_lang) {
                map[row.category_code] = row.category_name_lang;
            }
        });

        console.log("✅ Translations loaded for language:", langName, translations.length, "items");

    } catch (err) {
        console.error("⚠️ Exception fetching translations", { languageName: langName, error: err });
    }

    const result = { translations, map };

    // ✅ Store in module cache so any future call returns immediately
    translationsCache.set(langName, result);

    return result;
};

function clone(obj) {
    if (obj === undefined || obj === null) return obj;
    return JSON.parse(JSON.stringify(obj));
}

export async function getShift(params = {}) {
    try {
        const data = await apiFetch('/GetPosShift');
        console.log("getShift Data", data);

        const shift = data?.data?.[0]?.default_shift || null;

        if (shift) {
            useCache().setShift(shift);
            console.log("✅ Shift loaded and cached:", shift);
        } else {
            console.warn("⚠️ No valid shift data found in response");
        }

        return shift;

    } catch (err) {
        console.error("🚨 Failed to fetch Shift:", err);
        return null;
    }
}

export async function GetDeviceSession(params = {}) {
    try {
        const data = await apiFetch('/GetDeviceSession');

        const getDeviceSession = data?.data?.[0]?.output || [];
        useCache().setSessionid(getDeviceSession);

        console.log("✅ Device session loaded and cached:", getDeviceSession);
        return getDeviceSession;

    } catch (err) {
        console.error('🚨 Failed to fetch Device Session:', err);
        return null;
    }
}

export async function postOrder(params) {
    console.log('postOrder started', { params });

    const { sessionid, store, register, date, svcs } = useCache();
    console.log('Cache data retrieved:', {
        sessionid,
        storeName: store?.store_name,
        registerName: register?.register_name,
        date,
        svcsCount: svcs?.length
    });

    // Step 1: Get current order
    let { order } = useOrder();
    if (params?.info?.order) order = params.info.order;
    order = clone(order);

    // Step 2: Stock validation
    const { valid, unavailableItems } = await checkStocks({
        info: { sales_dtls: order?.sales_dtls }
    });
    if (!valid) {
        console.error('Stock validation failed', unavailableItems);
        return { success: false, response: unavailableItems };
    }

    // Step 3: Determine action
    let action = order?.sales_no ? 'update' : 'create';
    if (!order.sales_no) order.doc_date = getNowInAPIFormat();

    // Step 4: Add metadata to each sales item
    const now = getNowInAPIFormat();
    order.sales_dtls = (order.sales_dtls || []).map(item => ({
        ...item,
        c_userid: item.c_userid || 'WEBORDER',
        c_date: item.c_date || now,
        m_userid: item.m_userid || 'WEBORDER',
        m_date: item.m_date || now
    }));

    // Step 5: Prepare service details dynamically
    const sales_service_dtls = [];
    const mainService = svcs?.find(s => s.service_type === order?.service_type);
    if (mainService) {
        const svc = clone(mainService);
        delete svc.comp_code;
        svc.sales_amt = order?.sub_total || 0;
        svc.service_amt = (order.sales_dtls || [])
            .filter(i => i.take_away_item !== 'Y')
            .reduce((sum, i) => sum + parseFloat(i.svc_amt || 0), 0);
        sales_service_dtls.push(svc);
    }

    const takeAwayItems = order.sales_dtls.filter(i => i.take_away_item === 'Y');
    if (takeAwayItems.length > 0) {
        const takeSvc = svcs?.find(s => s.service_type === 'T');
        if (takeSvc) {
            const ta = clone(takeSvc);
            delete ta.comp_code;
            ta.sales_amt = order?.sub_total || 0;
            ta.service_amt = takeAwayItems.reduce((sum, i) => sum + parseFloat(i.svc_amt || 0), 0);
            sales_service_dtls.push(ta);
        }
    }
    order.sales_service_dtls = sales_service_dtls;

    // Step 6: Device session & try count
    let token = getCookie('token');
    let tryCount = parseInt(getCookie('try-count') || 0);
    if (!token) {
        try {
            const sessionData = await apiFetch('/GetDeviceSession');
            token = getCookie('token') || '';
            tryCount = parseInt(getCookie('try-count') || 0);
        } catch (err) {
            console.warn('Failed to fetch device session', err);
        }
    }

    // Step 7: Shift
    const shift = await getShift();

    // Step 8: Prepare payment details dynamically
    const sales_payment_dtls = [];

    if (params?.paymentLedger?.length > 0) {
        // Use actual payment ledger with real terminal ref_info (ECN)
        params.paymentLedger.forEach((p, i) => {
            sales_payment_dtls.push({
                payment_type: p.payment_type || 'R',
                payment_name: p.payment_name,
                s_no: i + 1,
                tender_amt: p.tender_amt,
                ref_info: p.ref_info || '',
                currency_name: p.currency_name || '',
                exch_rate: p.exch_rate || '1',
                currency_amount: p.currency_amount || '0.00',
                ...(p.terminal ? { terminal: p.terminal } : {})
            });
        });
    } else if (order.net_amt) {
        // Fallback — generate ref_info if no ledger provided
        const refInfo = getNowInAPIFormat().replace(/[/ :]/g, '');
        const paymentName = params?.paymentName || 'NETS';
        sales_payment_dtls.push({
            payment_type: 'R',
            payment_name: paymentName,
            s_no: 1,
            tender_amt: order.net_amt,
            ref_info: refInfo,
            currency_name: '',
            exch_rate: '1',
            currency_amount: '0.00'
        });
    }

    // Step 9: Final payload structure for backend
    const payloadOrder = {
        ...order,
        action,
        try_count: tryCount,
        device_id: '',
        order_mode: 'PayFirst',
        comp_code: store?.comp_code,
        store_name: store?.store_name,
        storename: store?.store_name,
        register_name: 'POS01',
        registername: 'POS01',
        shift_code: shift,
        shiftcode: shift,
        order_from: 'SOK',
        c_userid: 'WEBORDER',
        c_date: now,
        m_userid: 'WEBORDER',
        m_date: now,
        sales_payment_dtls,
        order_status_id: 'P',
        order_status_desc: 'Paid',
        kitchen_status_id: 'P',
        kitchen_status_desc: '',
        table_no: '',
        no_of_pax: 1,
        remarks: ''
    };

    // Convert to URL-encoded format
    const jsondata = JSON.stringify([payloadOrder]);

    // Create URLSearchParams for form-urlencoded
    const formData = new URLSearchParams();
    formData.append('jsondata', jsondata);

    console.log('Final formatted payload (form-urlencoded):', formData.toString());

    // Step 10: Send POST request with application/x-www-form-urlencoded
    try {
        const res = await fetch(`${API_BASE}/SendPostCartItem`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString(),
            credentials: 'include'
        });

        console.log('Response status:', res.status);
        console.log('Response ok:', res.ok);

        const json = await res.json();
        console.log('API response:', json);

        // sales_no is at root level of response, not nested in data
        const salesNo = json?.sales_no
            ?? json?.data?.[0]?.output?.[0]?.sales_no
            ?? null;

        console.log('✅ salesNo extracted:', salesNo);

        return {
            success: json?.message?.toUpperCase() === 'SUCCESS',
            salesNo,
            response: json?.data ?? null,
        };
    } catch (err) {
        console.error('Error posting order', err);
        return { success: false, response: null, error: err.message };
    }
}

export async function getPrintData(salesNo) {
    try {
        console.log('📦 Fetching print data for:', salesNo);

        const res = await fetch(
            `${API_BASE}/GetPrintData?salesno=${encodeURIComponent(salesNo)}`,
            { credentials: 'include' }
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        console.log('📦 GetPrintData response:', json);
        console.log('🔍 Print shape check:', {
            salesno: json?.salesno,
            kitchenKeys: json?.kitchen ? Object.keys(json.kitchen) : null,
            receiptKeys: json?.receipt ? Object.keys(json.receipt) : null,
            kitchenDataLen: json?.kitchen?.data?.length ?? 'N/A',
            receiptDataLen: json?.receipt?.data?.length ?? 'N/A',
        });

        // kitchen shape: { data: [{ output: [{ sales_dtls, printer_name, ... }] }] }
        const kprintData = json?.kitchen?.data ?? [];
        const kprintOrder = kprintData[0]?.output?.[0] ?? null;

        // receipt shape: { data: [{ output: [{ sales_dtls, ... }] }] }
        const receiptData = json?.receipt?.data ?? [];
        const receiptRecord = receiptData[0]?.output?.[0] ?? null;

        let receiptSalesDtls = [];
        if (receiptRecord?.sales_dtls) {
            try {
                receiptSalesDtls = typeof receiptRecord.sales_dtls === 'string'
                    ? JSON.parse(receiptRecord.sales_dtls)
                    : receiptRecord.sales_dtls;
            } catch (e) {
                console.warn('⚠️ Failed to parse receipt sales_dtls:', e);
            }
        }

        console.log('📦 kprint order:', kprintOrder?.sales_no,
            '| items:', kprintOrder?.sales_dtls?.length ?? 0);
        console.log('📦 receipt items:', receiptSalesDtls.length);

        return { kprintOrder, receiptRecord, receiptSalesDtls };

    } catch (err) {
        console.warn('⚠️ getPrintData failed (non-fatal):', err.message);
        return { kprintOrder: null, receiptRecord: null, receiptSalesDtls: [] };
    }
}


export async function getPrintConfig() {
    try {
        const response = await fetch('/API/GetPrintConfig', {
            credentials: 'include'
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const config = await response.json();

        if (!config?.Kitchen) {
            console.warn('⚠️ getPrintConfig: Kitchen missing in response', config);
            return null;
        }

        useCache().setPrintConfig(config);
        console.log('✅ printConfig loaded. Kitchen:', !!config.Kitchen, '| Receipt:', !!config.Receipt);
        return config;

    } catch (err) {
        console.error('🚨 Failed to fetch PrintConfig:', err);
        return null;
    }
}



export async function getStoreRegisterSettings(params = {}) {
    try {
        const data = await apiFetch('/GetStoreRegisterSettings');
        const settings = data?.data || [];
        //localStorage.setItem("RegisterSettings", JSON.stringify(settings));
        useCache().setPrinterSettings(settings);
        console.log("✅ StoreRegisterSettings loaded and cached:", settings);

        await getPrintConfig();

        return settings;
    } catch (err) {
        console.error('🚨 Failed to fetch StoreRegisterSettings:', err);
        return null;
    }
}


export async function getStoreRegisterPrinter(params = {}) {
    try {
        const data = await apiFetch('/GetStoreRegisterPrinter');
        const settings = Array.isArray(data) ? data : data?.data || [];
        localStorage.setItem("RegisterSettings", JSON.stringify(settings));
        useCache().setStoreRegisterSettings(settings);
        console.log("✅ StoreRegisterSettings loaded and cached:", settings);
        await getPrintConfig();
        return settings;
    } catch (err) {
        console.error('🚨 Failed to fetch StoreRegisterSettings:', err);
        return null;
    }
}

// Helper function for language code generation
function generateLanguageCode(languageName) {
    return languageName.toLowerCase().replace(/\s+/g, '-');
}

// Helper function for boolean conversion
function bool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
    if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
    if (typeof value === 'number') return value === 1;
    return false;
}

// Initialize with environment info
console.log('🔍 Environment Info:', {
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    origin: window.location.origin,
    fullUrl: window.location.href,
    API_BASE: API_BASE,
    detectedStoreName: getCleanStoreName()
});

