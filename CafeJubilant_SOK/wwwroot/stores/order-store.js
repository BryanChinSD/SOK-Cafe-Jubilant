// ✅ Import Zustand + middleware with React 18 dependency
import { create } from "https://esm.sh/zustand@4.4.7";
import { persist } from "https://esm.sh/zustand@4.4.7/middleware";

// ✅ Define the default state
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

// ✅ Create Zustand store (no double invocation)
const _useOrderStore = create(
    persist(
        (set) => ({
            ...defaultOrderState,

            // ✅ FIXED: setOrder now auto-syncs lastSNo
            setOrder: (order) => {
                // Calculate maxSNo from the order
                const maxSNo = order?.sales_dtls?.length > 0
                    ? Math.max(
                        order.lastSNo || 0,
                        ...order.sales_dtls.map(i => parseInt(i.s_no) || 0)
                    )
                    : 0;

                console.log('🔄 setOrder called - syncing lastSNo to:', maxSNo);

                // Update both order and lastSNo together
                set({
                    order: { ...order, lastSNo: maxSNo },
                    lastSNo: maxSNo
                });
            },
            resetOrder: () => set({ ...defaultOrderState }),

            setSelectedOrderItemSNo: (selectedOrderItemSNo) => set({ selectedOrderItemSNo }),
            setNonClosedOrders: (nonClosedOrders) => set({ nonClosedOrders }),
            setNonClosedOrdersApiAbortController: (nonClosedOrdersApiAbortController) => set({ nonClosedOrdersApiAbortController }),
            setDeliveryOrders: (deliveryOrders) => set({ deliveryOrders }),
            setDeliveryOrdersApiAbortController: (deliveryOrdersApiAbortController) => set({ deliveryOrdersApiAbortController }),
            setTqrOrdersApiAbortController: (tqrOrdersApiAbortController) => set({ tqrOrdersApiAbortController }),
            setLastSNo: (lastSNo) => set({ lastSNo }),
            setOriOrder: (oriOrder) => set({ oriOrder }),
            setOrderSeq: (orderSeq) => set({ orderSeq }),
            setUnableToOrder: (unableToOrder) => set({ unableToOrder }),
            setQr: (qr) => set({ qr }),
            setSelectedFloorPlan: (selectedFloorPlan) => set({ selectedFloorPlan }),
            setActiveOrdersView: (activeOrdersView) => set({ activeOrdersView }),
            setProcessedTQROrders: (processedTQROrders) => set({ processedTQROrders }),
            setPreorder: (preorder) => set({ preorder }),
        }),
        {
            name: "order", // storage key
            partialize: (state) => ({
                order: state.order,
                lastSNo: state.lastSNo  // ✅ Also persist lastSNo
            }),
        }
    )
);

export const useOrderStore = _useOrderStore;
export const useOrder = () => _useOrderStore.getState();

window._useOrderStore = _useOrderStore;
window.useOrderStore = _useOrderStore;