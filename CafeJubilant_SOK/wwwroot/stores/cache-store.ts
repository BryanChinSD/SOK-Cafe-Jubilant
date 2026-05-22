import { COMP_CODE } from "../utils/constants";
import create from "https://cdn.skypack.dev/zustand@5.0.6";
import { persist } from "zustand/middleware";

export type CacheState = {
    sessionid: string;
    deliveryToken: string;
    compCode: string;
    systemSettings: any[];
    storeRegisterSettings: any[];
    store: any;
    registers: any[];
    register: any;
    shifts: any[];
    shift: any;
    date: string;
    user: any;
    menu: any[];
    menuItems: any[];
    items: any[];
    paymentModes: any[];
    allRemarks: any[];
    addons: any[];
    discounts: any[];
    svcs: any[];
    printerSettings: any[];
    roles: any[];
    printers: any[];
    promos: any[];
    settings: any[];
    floorPlans: any[];
    itemRemarks: any[];
    printConfig: any;
    onlineSessionID: string;
    customerGroups: any[];
    images: Record<string, string>;
    stocks: any[];
    tqrInfo: any;
    langs: any[];
    menuCategoryItemTranslations: Record<string, string>;
};

export const defaultCacheState = {
    sessionid: null,
    deliveryToken: null,
    compCode: COMP_CODE,
    systemSettings: null,
    storeRegisterSettings: null,
    store: null,
    registers: null,
    register: null,
    shifts: null,
    shift: null,
    date: null,
    user: null,
    menu: null,
    menuItems: null,
    items: null,
    paymentModes: null,
    allRemarks: null,
    addons: null,
    discounts: null,
    svcs: null,
    printerSettings: null,
    roles: null,
    printers: null,
    promos: null,
    settings: null,
    floorPlans: null,
    itemRemarks: null,
    printConfig: null,
    onlineSessionID: null,
    customerGroups: null,
    images: {},
    stocks: null,
    tqrInfo: null,
};

export type CacheActions = {
    setSessionid: (sessionid: string) => void;
    setDeliveryToken: (deliveryToken: string) => void;
    setCompCode: (compCode: string) => void;
    setSystemSettings: (systemSettings: any[]) => void;
    setStoreRegisterSettings: (storeRegisterSettings: any[]) => void;
    setStore: (store: any) => void;
    setRegisters: (registers: any[]) => void;
    setRegister: (register: any) => void;
    setShifts: (shifts: any[]) => void;
    setShift: (shift: any) => void;
    setDate: (date: string) => void;
    setUser: (user: any) => void;
    setMenu: (menu: any[]) => void;
    setMenuItems: (menuItems: any[]) => void;
    setItems: (items: any[]) => void;
    setPaymentModes: (paymentModes: any[]) => void;
    setAllRemarks: (allRemarks: any[]) => void;
    setAddons: (addons: any[]) => void;
    setDiscounts: (discounts: any[]) => void;
    setSvcs: (svcs: any[]) => void;
    setPrinterSettings: (printerSettings: any[]) => void;
    setRoles: (roles: any[]) => void;
    setPrinters: (printers: any[]) => void;
    setPromos: (promos: any[]) => void;
    setSettings: (settings: any[]) => void;
    setFloorPlans: (floorPlans: any[]) => void;
    setItemRemarks: (itemRemarks: any[]) => void;
    setPrintConfig: (printConfig: any) => void;
    setOnlineSessionID: (onlineSessionID: string) => void;
    setCustomerGroups: (customerGroups: any[]) => void;
    setImage: (key: string, imageUrl: string) => void;
    setStocks: (stocks: any[]) => void;
    setTQRInfo: (tqrInfo: any) => void;
};

export type CacheStore = CacheState & CacheActions;

const _useCacheStore = create<CacheStore>()(
    // persist(
    (set, get) => ({
        ...defaultCacheState,
        setSessionid: (sessionid) => set(() => ({ sessionid })),
        setDeliveryToken: (deliveryToken) => set(() => ({ deliveryToken })),
        setCompCode: (compCode) => set(() => ({ compCode })),
        setSystemSettings: (systemSettings) => set(() => ({ systemSettings })),
        setStoreRegisterSettings: (storeRegisterSettings) =>
            set(() => ({ storeRegisterSettings })),
        setStore: (store) => set(() => ({ store })),
        setRegisters: (registers) => set(() => ({ registers })),
        setRegister: (register) => set(() => ({ register })),
        setShifts: (shifts) => set(() => ({ shifts })),
        setShift: (shift) => set(() => ({ shift })),
        setDate: (date) => set(() => ({ date })),
        setUser: (user) => set(() => ({ user })),
        setMenu: (menu) => set(() => ({ menu })),
        setMenuItems: (menuItems) => set(() => ({ menuItems })),
        setItems: (items) => set(() => ({ items })),
        setPaymentModes: (paymentModes) => set(() => ({ paymentModes })),
        setAllRemarks: (allRemarks) => set(() => ({ allRemarks })),
        setAddons: (addons) => set(() => ({ addons })),
        setDiscounts: (discounts) => set(() => ({ discounts })),
        setSvcs: (svcs) => set(() => ({ svcs })),
        setPrinterSettings: (printerSettings) => set(() => ({ printerSettings })),
        setRoles: (roles) => set(() => ({ roles })),
        setPrinters: (printers) => set(() => ({ printers })),
        setPromos: (promos) => set(() => ({ promos })),
        setSettings: (settings) => set(() => ({ settings })),
        setFloorPlans: (floorPlans) => set(() => ({ floorPlans })),
        setItemRemarks: (itemRemarks) => set(() => ({ itemRemarks })),
        setPrintConfig: (printConfig) => set(() => ({ printConfig })),
        setOnlineSessionID: (onlineSessionID) => set(() => ({ onlineSessionID })),
        setCustomerGroups: (customerGroups) => set(() => ({ customerGroups })),
        setImage: (key, imageUrl) =>
            set((state) => ({
                images: { ...state.images, [key]: imageUrl },
            })),
        setStocks: (stocks) => set(() => ({ stocks })),
        setTQRInfo: (tqrInfo) => set(() => ({ tqrInfo })),
        setLangs: (langs) => set(() => ({ langs })),
        setMenuCategoryItemTranslations: (menuCategoryItemTranslations) =>
            set(() => ({ menuCategoryItemTranslations })),
    })
    // {
    //   name: "cache",
    // }
    // )
);

export const useCacheStore = () => _useCacheStore((state) => state);
export const useCache = () => _useCacheStore.getState();
