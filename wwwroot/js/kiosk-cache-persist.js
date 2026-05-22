// ─── kiosk-cache-persist.js ──────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_KEY = 'kiosk_api_cache';

export const PERSIST_KEYS = [
    'menuItems', 'MenuItems',
    'items', 'FullItems',
    'addons', 'AddOnItems',
    'itemRemarks', 'ItemRemarks',
    'promos', 'PromotionItems',
    'svcs', 'ServiceCharges',
    'langs',
    'stocks',
    'registerSettings',
    'store'
];

const ORDER_STATE_KEYS = [
    'orderType',
    'orderType_ts',
    'sok_device_id',
    'storename',
    'sok_location',
    'selectedLang',
    'paymentModes',
    'printConfig',
    'sok_device_info',
    'storeKitchenPrinters',
    'storeRegisterSettings',
    'AvailablePOSMenuItems'
];

// ─── Guardian ────────────────────────────────────────────────────────────────
// Runs immediately — intercepts localStorage at the browser API level
// Nothing in any file can wipe orderType after this runs

(function guardOrderType() {
    // ✅ Prevent double-patching if module is evaluated twice
    if (window.__orderTypeGuardianActive) {
        console.log('🛡️ orderType guardian already active, skipping');
        return;
    }
    window.__orderTypeGuardianActive = true;

    const WATCH_KEY = 'orderType';
    let _lastKnownValue = localStorage.getItem(WATCH_KEY);

    const _originalSetItem = localStorage.setItem.bind(localStorage);
    const _originalRemoveItem = localStorage.removeItem.bind(localStorage);
    const _originalClear = localStorage.clear.bind(localStorage);

    localStorage.setItem = function (key, value) {
        _originalSetItem(key, value);
        if (key === WATCH_KEY) {
            _lastKnownValue = value;
            console.log(`🔒 orderType guardian updated: "${value}"`);
        }
    };

    localStorage.removeItem = function (key) {
        if (key === WATCH_KEY && _lastKnownValue) {
            console.warn(`🛡️ Blocked removal of orderType — preserved: "${_lastKnownValue}"`);
            return; // Block silently
        }
        _originalRemoveItem(key);
    };

    localStorage.clear = function () {
        // Snapshot before wipe
        _lastKnownValue = _originalSetItem ? localStorage.getItem(WATCH_KEY) : _lastKnownValue;
        const ts = localStorage.getItem('orderType_ts');
        _originalClear();
        // Restore immediately
        if (_lastKnownValue) {
            _originalSetItem(WATCH_KEY, _lastKnownValue);
            _originalSetItem('orderType_ts', ts || Date.now().toString());
            console.warn(`🛡️ orderType restored after localStorage.clear: "${_lastKnownValue}"`);
        }
    };

    console.log(`🛡️ orderType guardian active | current value: "${_lastKnownValue ?? 'none'}"`);
})();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _saveOrderStateKeys() {
    const saved = {};
    ORDER_STATE_KEYS.forEach(key => {
        const val = localStorage.getItem(key);
        if (val !== null) saved[key] = val;
    });
    return saved;
}

function _restoreOrderStateKeys(saved = {}) {
    const entries = Object.entries(saved);
    if (entries.length === 0) return;
    entries.forEach(([key, val]) => {
        localStorage.setItem(key, val);
        console.log(`🔒 [OrderState] Restored: ${key} = ${val}`);
    });
    console.log(`✅ Order state keys restored (${entries.length}): ${Object.keys(saved).join(', ')}`);
}
// ─── Public API ──────────────────────────────────────────────────────────────

export function saveCacheBeforeRedirect() {
    const mgr = window.apiManager;
    const snapshot = {
        savedAt: Date.now(),
        data: {},
        orderState: {},
        version: "1.0"
    };
    let saved = 0;

    console.log('💾 Starting Cache Persistence...');

    // 1. Capture critical device/order keys first
    ORDER_STATE_KEYS.forEach(key => {
        const val = localStorage.getItem(key);
        if (val !== null) {
            snapshot.orderState[key] = val;
            console.log(`🔒 [OrderState] Captured: ${key} = ${val}`);
        }
    });

    // 2. Capture menu/API data
    for (const key of PERSIST_KEYS) {
        let value = null;

        if (mgr?.loadedData?.has?.(key)) {
            value = mgr.loadedData.get(key);
        }
        if (!value) {
            const raw = sessionStorage.getItem(key);
            if (raw) try { value = JSON.parse(raw); } catch (e) { }
        }
        if (!value) {
            const raw = sessionStorage.getItem(key.toLowerCase());
            if (raw) try { value = JSON.parse(raw); } catch (e) { }
        }

        if (value) {
            snapshot.data[key] = value;
            saved++;
            console.log(`📡 [Cache] Captured: ${key}`);
        }
    }

    const hasAnything = saved > 0 || Object.keys(snapshot.orderState).length > 0;
    if (!hasAnything) {
        console.warn('⚠️ No data found to persist');
        return 0;
    }

    try {
        const serialized = JSON.stringify(snapshot);
        localStorage.setItem(CACHE_KEY, serialized);

        const verify = localStorage.getItem(CACHE_KEY);
        if (verify) {
            console.log(`✅ CACHE VERIFIED: ${saved} menu keys + ${Object.keys(snapshot.orderState).length} state keys | ${(serialized.length / 1024).toFixed(2)} KB`);
        } else {
            console.error("❌ CRITICAL: localStorage.setItem failed to persist data!");
        }
        return saved;
    } catch (e) {
        console.error("❌ QuotaExceededError: Cache data too large for localStorage!", e);

        // ✅ Fallback: at least save the small orderState keys directly
        ORDER_STATE_KEYS.forEach(key => {
            const val = snapshot.orderState[key];
            if (val !== null && val !== undefined) localStorage.setItem(key, val);
        });
        console.warn('⚠️ Fell back to direct orderState key preservation');
        return 0;
    }
}

export function restoreCacheAfterReload() {
    console.log('🔄 restoreCacheAfterReload() started');

    const isFreshStart = localStorage.getItem('kiosk_fresh_start');
    if (isFreshStart === 'true') {
        console.log("🔄 Fresh start detected after payment - using Warm Boot path");
        localStorage.removeItem('kiosk_fresh_start');
        const cachedMenu = localStorage.getItem('menu_cache');
        if (cachedMenu) return JSON.parse(cachedMenu);
    }

    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
        console.log('ℹ️ No persisted cache found');
        return 0;
    }

    // Parse first — don't remove yet
    let snapshot;
    try {
        snapshot = JSON.parse(raw);
    } catch (e) {
        console.warn('⚠️ Could not parse cache snapshot');
        localStorage.removeItem(CACHE_KEY);
        return 0;
    }

    if (
        localStorage.getItem('pos_start_over') === 'true' ||
        sessionStorage.getItem('pos_start_over') === 'true'
    ) {
        console.log("🔄 [StartOver] Skipping orderType restore — user must pick fresh");
        // Wipe orderType from snapshot so the landing screen forces selection
        if (snapshot.orderState) {
            snapshot.orderState.orderType = '';
            snapshot.orderState.orderType_ts = '';
        }
        // Consume the flag — don't let it linger across multiple loads
        localStorage.removeItem('pos_start_over');
        sessionStorage.removeItem('pos_start_over');
    }

    // _restoreOrderStateKeys runs after — orderType will be '' which is safe
    if (snapshot.orderState && Object.keys(snapshot.orderState).length > 0) {
        _restoreOrderStateKeys(snapshot.orderState);
    }

    // ✅ STEP 2: Now safe to remove the raw cache
    localStorage.removeItem(CACHE_KEY);

    // ✅ STEP 3: TTL check — orderState already restored so early return is safe
    const age = Date.now() - (snapshot.savedAt || 0);
    if (age > CACHE_TTL_MS) {
        console.log(`⏱️ Cache expired (age: ${Math.round(age / 60000)}min) — menu data skipped, orderState preserved`);
        return 0;
    }

    // ✅ STEP 4: Restore menu/API data into apiManager
	const mgr = window.apiManager;
	if (!mgr?.loadedData) {
	    console.warn('⚠️ apiManager not ready — menu data skipped, orderState already preserved');
	    return 0;
	}
	
	let restored = 0;
	for (const [key, value] of Object.entries(snapshot.data || {})) {
	    if (value && (Array.isArray(value) || typeof value === 'object')) {
	        mgr.loadedData.set(key, value);
	        if (mgr.loadingStates) mgr.loadingStates.set(key, 'success');
	        try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { }
	        restored++;
	        console.log(`✅ Restored: ${key} (${Array.isArray(value) ? value.length : 'object'})`);
	
	        // ✅ Prime window.remarksCache immediately on restore so getRemarksCache()
	        // finds it without needing apiManager or useCache() to be fully ready
	        if ((key === 'ItemRemarks' || key === 'itemRemarks') && Array.isArray(value) && value.length > 0) {
	            window.remarksCache = value;
	            console.log(`✅ window.remarksCache primed from restore: ${value.length} items`);
	        }
	    }
	}
	
	if (restored > 0) {
	    window.isInitialized = true;
	    window.isInitializing = false;
	    window.__appInitialized = true;
	    window.__isWarmBoot = true;
	
	    // ✅ Also sync itemRemarks into cache store now that it's restored
	    // This covers the gap where rehydrateCacheFromApiManager doesn't include it
	    try {
	        const remarks = mgr.loadedData.get('ItemRemarks') ?? mgr.loadedData.get('itemRemarks');
	        if (remarks?.length > 0 && typeof _useCacheStore !== 'undefined') {
	            _useCacheStore.getState()?.setItemRemarks?.(remarks);
	            console.log(`✅ cache-store itemRemarks synced: ${remarks.length} items`);
	        }
	    } catch (e) {
	        console.warn('⚠️ Could not sync itemRemarks to cache-store:', e.message);
	    }
	
	    console.log(`🎉 Successfully restored ${restored} API entries and marked app as initialized`);
	}

    // ✅ Final verification log
    console.log('📊 Cache store re-hydrated:', {
        menuKeys: restored,
        orderType: localStorage.getItem('orderType'),
        deviceId: localStorage.getItem('sok_device_id'),
        storename: localStorage.getItem('storename'),
    });

    return restored;
}

export function clearPersistedCache() {
    // ✅ Preserve ORDER_STATE_KEYS even when explicitly clearing cache
    const preserved = _saveOrderStateKeys();
    localStorage.removeItem(CACHE_KEY);
    _restoreOrderStateKeys(preserved);
    console.log('🗑️ Persisted cache cleared (orderState preserved)');
}

// Expose globally
window.saveCacheBeforeRedirect = saveCacheBeforeRedirect;
window.restoreCacheAfterReload = restoreCacheAfterReload;
window.clearPersistedCache = clearPersistedCache;