import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OrderState = {
    order: any;
    selectedOrderItemSNo: number;
    nonClosedOrders: any[];
    nonClosedOrdersApiAbortController: AbortController | null;
    deliveryOrders: any[];
    deliveryOrdersApiAbortController: AbortController | null;
    tqrOrdersApiAbortController: AbortController | null;
    lastSNo: number;
    oriOrder: any;
    orderSeq: number;
    unableToOrder: boolean;
    qr: any;
    selectedFloorPlan: any;
    activeOrdersView: string;
    processedTQROrders: any[];
    preorder: any;
};

export const defaultOrderState = {
    order: null,
    selectedOrderItemSNo: null,
    nonClosedOrders: [],
    nonClosedOrdersApiAbortController: null,
    deliveryOrders: [],
    deliveryOrdersApiAbortController: null,
    tqrOrdersApiAbortController: null,
    lastSNo: 0,
    oriOrder: null,
    orderSeq: 1,
    unableToOrder: true,
    qr: null,
    selectedFloorPlan: null,
    activeOrdersView: null,
    processedTQROrders: [],
    preorder: null,
};

export type OrderActions = {
    setOrder: (order: any) => void;
    setSelectedOrderItemSNo: (selectedOrderItemSNo: number) => void;
    setNonClosedOrders: (nonClosedOrders: any[]) => void;
    setNonClosedOrdersApiAbortController: (
        nonClosedOrdersApiAbortController: AbortController | null
    ) => void;
    setDeliveryOrders: (prevDeliveryOrders: any[]) => void;
    setDeliveryOrdersApiAbortController: (
        deliveryOrdersApiAbortController: AbortController | null
    ) => void;
    setTqrOrdersApiAbortController: (
        tqrOrdersApiAbortController: AbortController | null
    ) => void;
    setLastSNo: (lastSNo: number) => void;
    setOriOrder: (originalOrder: any) => void;
    setOrderSeq: (orderSeq: number) => void;
    setUnableToOrder: (unableToOrder: boolean) => void;
    setQr: (qr: any) => void;
    setSelectedFloorPlan: (selectedFloorPlan: any) => void;
    setActiveOrdersView: (activeOrdersView: "list" | "floorplan") => void;
    setProcessedTQROrders: (processedTQROrders: string[]) => void;
    setPreorder: (preorder: any) => void;
};

export type OrderStore = OrderState & OrderActions;

const _useOrderStore = create<OrderStore>()(
    persist(
        (set) => ({
            ...defaultOrderState,
            setOrder: (order) => set(() => ({ order })),
            setSelectedOrderItemSNo: (selectedOrderItemSNo) =>
                set(() => ({ selectedOrderItemSNo })),
            setNonClosedOrders: (nonClosedOrders) => set(() => ({ nonClosedOrders })),
            setNonClosedOrdersApiAbortController: (
                nonClosedOrdersApiAbortController
            ) => set(() => ({ nonClosedOrdersApiAbortController })),
            setDeliveryOrders: (deliveryOrders) => set(() => ({ deliveryOrders })),
            setDeliveryOrdersApiAbortController: (deliveryOrdersApiAbortController) =>
                set(() => ({ deliveryOrdersApiAbortController })),
            setTqrOrdersApiAbortController: (tqrOrdersApiAbortController) =>
                set(() => ({ tqrOrdersApiAbortController })),
            setLastSNo: (lastSNo) => set(() => ({ lastSNo })),
            setOriOrder: (oriOrder) => set(() => ({ oriOrder })),
            setOrderSeq: (orderSeq) => set(() => ({ orderSeq })),
            setUnableToOrder: (unableToOrder) => set(() => ({ unableToOrder })),
            setQr: (qr) => set(() => ({ qr })),
            setSelectedFloorPlan: (selectedFloorPlan) =>
                set(() => ({ selectedFloorPlan })),
            setActiveOrdersView: (activeOrdersView) =>
                set(() => ({ activeOrdersView })),
            setProcessedTQROrders: (processedTQROrders) =>
                set(() => ({ processedTQROrders })),
            setPreorder: (preorder) => set(() => ({ preorder })),
        }),
        {
            name: "order",
            partialize: (state) => ({
                order: state.order,
            }),
        }
    )
);

export const useOrderStore = () => _useOrderStore((state) => state);
export const useOrder = () => _useOrderStore.getState();
