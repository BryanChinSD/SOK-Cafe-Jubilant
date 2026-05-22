import { COMP_CODE } from "../utils/constants.js";
import { create } from "https://esm.sh/zustand@5.0.6";
export const defaultCacheState = {
    sessionid: null,
    deliveryToken: null,
    compCode: COMP_CODE,
    systemSettings: [],     // If this is an array
    storeRegisterSettings: [], // If this is an array
    store: null,
    registers: [],          // If this is an array
    register: null,
    shifts: [],             // If this is an array
    shift: null,
    date: null,
    user: null,
    menu: null,
    menuItems: [],          // ✅ Array
    items: [],              // ✅ Array
    paymentModes: [],       // ✅ Array
    allRemarks: [],         // ✅ Array
    addons: [],             // ✅ Array
    discounts: [],          // ✅ Array
    svcs: [],               // ✅ Array
    printerSettings: JSON.parse(localStorage.getItem("RegisterSettings") || "null"),
    roles: [],              // ✅ Array
    printers: [],           // ✅ Array
    promos: [],             // ✅ Array - THIS FIXES YOUR ERROR
    settings: [],           // ✅ Array
    floorPlans: [],         // ✅ Array
    itemRemarks: [],        // ✅ Array
    printConfig: null,
    onlineSessionID: null,
    customerGroups: [],     // ✅ Array
    images: {},
    stocks: [],             // ✅ Array
    tqrInfo: null,
    langs: [],              // ✅ Array
    menuCategoryItemTranslations: [] // ✅ Array
};
const _useCacheStore = create()(
// persist(
(set, get) => (Object.assign(Object.assign({}, defaultCacheState), { setSessionid: (sessionid) => set(() => ({ sessionid })), setDeliveryToken: (deliveryToken) => set(() => ({ deliveryToken })), setCompCode: (compCode) => set(() => ({ compCode })), setSystemSettings: (systemSettings) => set(() => ({ systemSettings })), setStoreRegisterSettings: (storeRegisterSettings) => set(() => ({ storeRegisterSettings })), setStore: (store) => set(() => ({ store })), setRegisters: (registers) => set(() => ({ registers })), setRegister: (register) => set(() => ({ register })), setShifts: (shifts) => set(() => ({ shifts })), setShift: (shift) => set(() => ({ shift })), setDate: (date) => set(() => ({ date })), setUser: (user) => set(() => ({ user })), setMenu: (menu) => set(() => ({ menu })), setMenuItems: (menuItems) => set(() => ({ menuItems })), setItems: (items) => set(() => ({ items })), setPaymentModes: (paymentModes) => set(() => ({ paymentModes })), setAllRemarks: (allRemarks) => set(() => ({ allRemarks })), setAddons: (addons) => set(() => ({ addons })), setDiscounts: (discounts) => set(() => ({ discounts })), setSvcs: (svcs) => set(() => ({ svcs })), setPrinterSettings: (printerSettings) => set(() => ({ printerSettings })), setRoles: (roles) => set(() => ({ roles })), setPrinters: (printers) => set(() => ({ printers })), setPromos: (promos) => set(() => ({ promos })), setSettings: (settings) => set(() => ({ settings })), setFloorPlans: (floorPlans) => set(() => ({ floorPlans })), setItemRemarks: (itemRemarks) => set(() => ({ itemRemarks })), setPrintConfig: (printConfig) => set(() => ({ printConfig })), setOnlineSessionID: (onlineSessionID) => set(() => ({ onlineSessionID })), setCustomerGroups: (customerGroups) => set(() => ({ customerGroups })), setImage: (key, imageUrl) => set((state) => ({
        images: Object.assign(Object.assign({}, state.images), { [key]: imageUrl }),
})), setStocks: (stocks) => set(() => ({ stocks })), setTQRInfo: (tqrInfo) => set(() => ({ tqrInfo })), setLangs: (langs) => set(() => ({ langs })), setMenuCategoryItemTranslations: (menuCategoryItemTranslations) => set(() => ({ menuCategoryItemTranslations })) }))
// {
//   name: "cache",
// }
// )
);
export const useCacheStore = () => _useCacheStore((state) => state);
export const useCache = () => _useCacheStore.getState();
// In cache-store.js — add this export at the bottom

export function rehydrateCacheFromApiManager() {
    const fullItems = window.apiManager?.loadedData?.get('FullItems') ||
        JSON.parse(sessionStorage.getItem('FullItems') || '[]');

    const addOnItems = window.apiManager?.loadedData?.get('AddOnItems') ||
        JSON.parse(sessionStorage.getItem('AddOnItems') || '[]');

    const menuItems = window.apiManager?.loadedData?.get('MenuItems') ||
        JSON.parse(sessionStorage.getItem('MenuItems') || '[]');

    const stocks = window.apiManager?.loadedData?.get('stocks') ||
        JSON.parse(sessionStorage.getItem('stocks') || '[]');

    const store = window.apiManager?.loadedData?.get('store') ||
        JSON.parse(sessionStorage.getItem('store') || 'null');

    // ✅ _useCacheStore is in scope here — use setState directly on the instance
    _useCacheStore.setState({
        ...(fullItems.length && { items: fullItems }),
        ...(addOnItems.length && { addons: addOnItems }),
        ...(menuItems.length && { menuItems: menuItems }),
        ...(stocks.length && { stocks: stocks }),
        ...(store && { store: store }),
    });

    console.log('✅ Cache store re-hydrated:', {
        items: fullItems.length,
        addons: addOnItems.length,
        menuItems: menuItems.length,
        stocks: stocks.length,
    });
}