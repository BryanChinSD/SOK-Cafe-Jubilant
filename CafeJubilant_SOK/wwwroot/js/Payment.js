import { useCache } from '../stores/cache-store.js';
import { useOrder, useOrderStore } from '../stores/order-store.js';
import { uiTranslations } from './Translation.js';
import React from "https://esm.sh/react";
import { ChevronLeft } from "https://esm.sh/lucide-react";

import {
    handleMemberLogin,
    clearSessionOnPageLoad,
    attachOrderTypeHandlers,
    handleOrderTypeSelection,
    proceedAsGuest,
    showOrderTypeSelection
} from '../utils/eber.js';

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
    postOrder,
    getPrintData
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

import { getPriceByServiceType, applyPromotions, getNewOrder, getNewOrderSOK, addTax, calcOrderAmt } from '../utils/pos.js';

import {
    getItemImageUrl,
    addToCart,
    updateCartCount,
    showAddOnModalOriginal,
    groupItemsByTemperature,
    getItemTemperature,
    resolveImageUrl
} from './GetHomeAPI.js';

import { renderCartFromOrder, showErrorModal, closeErrorModal, showSuccessModal, closeModal } from './renderCartFromOrder.js';
import { kitchenPrint, receiptPrint } from '../js/Printing.js';
import { KITCHEN_PRINT_TYPE, RECEIPT_PRINT_TYPE } from '../utils/constants.js';
import { getNowInAPIFormat } from '../utils/common.js';

let menuItems = [];
let cart = [];

// =============================================================================
// PAYMENT STATE
// =============================================================================
let currentPaymentController = null;
let isPaymentInProgress = false;
let _paymentModes = null;
let _paymentGroups = null;
let paymentCancelled = false;

const STORAGE_KEY_MODES = 'paymentModes';
const STORAGE_KEY_GROUPS = 'paymentGroups';

let totalPaymentAmount = 0;
let remainingAmount = 0;
let selectedPaymentMethod = '';
let paymentLedger = [];




// =============================================================================
// PAYMENT CONFIG
// =============================================================================
const PAYMENT_CONFIG = {
    methods: [
        {
            enabled: true,
            id: 'card',
            label: 'Card Payment',
            desc: 'Debit or Credit Card',
            icon: '💳',
            brands: [
                { alt: 'VISA', sources: ['/img/visa.jpg', 'https://upload.wikimedia.org/wikipedia/commons/5/5e/Visa_Inc._logo.svg'] },
                { alt: 'Mastercard', sources: ['/img/master.jpg', 'https://upload.wikimedia.org/wikipedia/commons/2/2a/Mastercard-logo.svg'] },
                { alt: 'AMEX', sources: ['/img/AMEX.JPG', 'https://upload.wikimedia.org/wikipedia/commons/3/30/American_Express_logo.svg'] },
                { alt: 'Google Pay', sources: ['/img/googlepay-logo.png', 'https://developers.google.com/static/pay/api/images/brand-guidelines/google-pay-mark.png'] },
                { alt: 'Apple Pay', sources: ['/img/applepay-logo.png', 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Apple_Pay_logo.svg'] },
            ],
            apiNames: ['CREDIT CARD', 'VISA', 'Mastercard'],
            fallback: { payment_type: 'R', payment_name: 'CREDIT CARD', terminaltype: 'UOB', is_direct_pay: 0, ref_3: '' }
        },
        {
            enabled: true,
            id: 'nets_debit',
            label: 'NETS',
            desc: 'Pay with NETS debit',
            icon: '',
            brands: [
                { alt: 'NETS', sources: ['/img/enets.png', 'https://upload.wikimedia.org/wikipedia/commons/0/06/Nets_Logo.svg'] },
            ],
            apiNames: ['NETS'],
            fallback: { payment_type: 'R', payment_name: 'NETS', terminaltype: 'NETS', is_direct_pay: 0, ref_3: '' }
        },
        //,
        //{
        //    enabled: true,
        //    id: 'crm_points',
        //    label: 'Redeem Points',
        //    desc: 'Use your CRM reward points',
        //    icon: '🎯',
        //    brands: [],
        //    apiNames: ['CRM POINT'],
        //    fallback: { payment_type: 'P', payment_name: 'CRM POINT', terminaltype: 'NONE', is_direct_pay: 0, ref_3: '' }
        //},
    ],
    splitPayment: true,
    currencySymbol: '$',
};


// =============================================================================
// BRAND IMAGE FALLBACK
// =============================================================================

window.handleBrandImgError = function (img) {
    const sources = img.dataset.fallbacks ? img.dataset.fallbacks.split('||') : [];
    const currentSrc = img.src;
    const nextIdx = sources.findIndex(s => currentSrc.endsWith(s) || currentSrc === s) + 1;
    if (nextIdx > 0 && nextIdx < sources.length) {
        img.src = sources[nextIdx];
    } else {
        img.style.display = 'none';
    }
};

function _buildBrandImg(brand) {
    if (!brand.sources?.length) return '';
    const fallbacks = brand.sources.join('||');
    return `<img
        src="${brand.sources[0]}"
        alt="${brand.alt}"
        class="card-brand-logo"
        data-fallbacks="${fallbacks}"
        onerror="handleBrandImgError(this)"
        loading="lazy"
    >`;
}


// =============================================================================
// PAYMENT MODES — FETCH / CACHE / RESOLVE
// =============================================================================

async function fetchPaymentModes() {
    const cached = localStorage.getItem(STORAGE_KEY_MODES);
    if (cached) {
        _paymentModes = JSON.parse(cached);
        _paymentGroups = JSON.parse(localStorage.getItem(STORAGE_KEY_GROUPS) || '{}');
        console.log('✅ Payment modes from localStorage', {
            modes: Object.keys(_paymentModes).length,
            groups: Object.keys(_paymentGroups).length
        });
        return _paymentModes;
    }

    try {
        const response = await fetch('/api/payment-modes');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        const groups = result?.data?.data?.[0]?.output?.output ?? [];

        _paymentGroups = {};
        groups.forEach(group => {
            _paymentGroups[group.payment_info] = group.pymt_type_details;
        });

        const flat = {};
        groups.forEach(group => {
            (group.pymt_type_details || []).forEach(mode => {
                flat[mode.payment_name.trim().toLowerCase()] = mode;
            });
        });

        _paymentModes = flat;
        localStorage.setItem(STORAGE_KEY_MODES, JSON.stringify(flat));
        localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(_paymentGroups));

        console.log(`✅ Payment modes fetched: ${Object.keys(flat).length} modes`);
        return flat;

    } catch (err) {
        console.error('❌ fetchPaymentModes failed:', err);
        return {};
    }
}

function clearPaymentModesCache() {
    _paymentModes = null;
    _paymentGroups = null;
    localStorage.removeItem(STORAGE_KEY_MODES);
    localStorage.removeItem(STORAGE_KEY_GROUPS);
    console.log('🗑️ Payment modes cache cleared');
}

function resolveConfigEntry(entry) {
    if (!_paymentModes) {
        const cached = localStorage.getItem(STORAGE_KEY_MODES);
        if (cached) _paymentModes = JSON.parse(cached);
    }
    if (_paymentModes) {
        for (const name of entry.apiNames) {
            const mode = _paymentModes[name.trim().toLowerCase()];
            if (mode) {
                console.log(`✅ [${entry.id}] → ${mode.payment_name} (${mode.payment_type})`);
                return mode;
            }
        }
    }
    console.warn(`⚠️ [${entry.id}] → fallback used`);
    return entry.fallback;
}

function resolvePaymentMode(paymentMethodName) {
    const key = (paymentMethodName || '').trim().toLowerCase();

    if (!_paymentModes) {
        const cached = localStorage.getItem(STORAGE_KEY_MODES);
        if (cached) _paymentModes = JSON.parse(cached);
    }

    if (_paymentModes) {
        if (_paymentModes[key]) return _paymentModes[key];
        const fuzzy = Object.values(_paymentModes).find(m =>
            m.payment_name.toLowerCase().includes(key) ||
            key.includes(m.payment_name.toLowerCase())
        );
        if (fuzzy) return fuzzy;
    }

    const defaults = {
        'cash': { payment_type: 'C', payment_name: 'CASH' },
        'nets': { payment_type: 'R', payment_name: 'NETS' },
        'nets-debit': { payment_type: 'R', payment_name: 'NETS' },
        'nets-credit': { payment_type: 'R', payment_name: 'NETS' },
        'card': { payment_type: 'R', payment_name: 'CREDIT CARD' },
        'paynow': { payment_type: 'C', payment_name: 'PayNow' },
        'visa': { payment_type: 'R', payment_name: 'VISA' },
        'mastercard': { payment_type: 'R', payment_name: 'Mastercard' },
        'amex': { payment_type: 'R', payment_name: 'AMEX' },
        'credit_card': { payment_type: 'R', payment_name: 'CREDIT CARD' },
        'credit card': { payment_type: 'R', payment_name: 'CREDIT CARD' },
        'debit_card': { payment_type: 'R', payment_name: 'NETS' },
        'debit card': { payment_type: 'R', payment_name: 'NETS' },
        'alipay': { payment_type: 'R', payment_name: 'ALIPAY' },
        'wechat': { payment_type: 'R', payment_name: 'WeChat Pay' },
        'grabpay': { payment_type: 'O', payment_name: 'GRAB FOOD' },
    };
    return defaults[key] ?? { payment_type: 'R', payment_name: paymentMethodName || 'UNKNOWN' };
}


// =============================================================================
// UTILITY HELPERS
// =============================================================================

function getOrderId(order) {
    if (!order) return null;
    let id = order.server_order_id || order.sales_no || order.orderId;
    if (id === '') id = null;
    return id;
}

function sendWebSocketMessage(message) {
    if (window.sokWebSocket?.ws?.readyState === WebSocket.OPEN) {
        window.sokWebSocket.ws.send(JSON.stringify(message));
        return true;
    }
    console.warn('⚠️ WebSocket not available');
    return false;
}


// =============================================================================
// WEBSOCKET NOTIFICATIONS
// =============================================================================

function sendPaymentModalNotification(action, amount = null) {
    try {
        const { order } = useOrder();
        sendWebSocketMessage({
            action,
            deviceId: localStorage.getItem('sok_device_id'),
            orderId: getOrderId(order),
            tableNo: '',
            orderType: localStorage.getItem('orderType'),
            amount: amount ? parseFloat(amount) : 0,
            itemCount: order?.sales_dtls?.length || 0,
            timestamp: new Date().toISOString()
        });
    } catch (e) { console.error('❌ sendPaymentModalNotification:', e); }
}

function sendPaymentInitiatedNotification(method, amount) {
    try {
        const { order } = useOrder();
        sendWebSocketMessage({
            action: 'payment_initiated',
            deviceId: localStorage.getItem('sok_device_id'),
            tableNo: '',
            //tableNo: localStorage.getItem('tableNo'),
            orderType: localStorage.getItem('orderType'),
            paymentMethod: method,
            amount: parseFloat(amount),
            orderId: getOrderId(order),
            timestamp: new Date().toISOString()
        });
    } catch (e) { console.error('❌ sendPaymentInitiatedNotification:', e); }
}

function sendTerminalCheckStartedNotification(method, amount) {
    try {
        const { order } = useOrder();
        sendWebSocketMessage({
            action: 'terminal_check_started',
            deviceId: localStorage.getItem('sok_device_id'),
            tableNo: '',
            //tableNo: localStorage.getItem('tableNo'),
            paymentMethod: method,
            amount: parseFloat(amount),
            orderId: getOrderId(order),
            timestamp: new Date().toISOString()
        });
    } catch (e) { console.error('❌ sendTerminalCheckStartedNotification:', e); }
}

function sendPaymentResponseReceivedNotification(paymentResult) {
    try {
        const { order } = useOrder();
        sendWebSocketMessage({
            action: 'payment_response_received',
            deviceId: localStorage.getItem('sok_device_id'),
            tableNo: '',
            //tableNo: localStorage.getItem('tableNo'),
            orderId: getOrderId(order),
            responseCode: paymentResult.responseCode || paymentResult.responce_code || paymentResult.ResponceCode,
            paymentResult,
            timestamp: new Date().toISOString()
        });
    } catch (e) { console.error('❌ sendPaymentResponseReceivedNotification:', e); }
}
function sendPaymentSuccessNotification(paymentResult) {
    try {
        const { order } = useOrder();
        const transactionId = paymentResult?.approval_code    // already parsed object
            || paymentResult?.approvalCode_Raw?.split('\u0000').pop()?.trim()
            || paymentResult?.rrN_Raw?.split('\u0000').pop()?.trim()
            || '';

        const enrichedOrder = order ? {
            ...order,
            // ← sales_no not available yet here — use existing order id
            sales_no: order.sales_no || order.server_order_id || '',
            doc_date: order.doc_date ? getNowInAPIFormat(order.doc_date.substring(0, 10).replace(/-/g, '/')) : getNowInAPIFormat(),
            m_date: getNowInAPIFormat(),
            c_date: order.c_date ? getNowInAPIFormat(order.c_date.substring(0, 10).replace(/-/g, '/')) : getNowInAPIFormat(),
            order_status_id: 'P', order_status_desc: 'Paid',
            kitchen_status_id: 'P', kitchen_status_desc: '',
            total_tender_amt: parseFloat(totalPaymentAmount).toFixed(2),
            change_amt: '0.00',
            sales_payment_dtls: paymentLedger,
            SalesPaymentDtls: paymentLedger.map((p, i) => ({
                PaymentCode: p.PaymentCode || p.payment_name,
                PaymentAmt: parseFloat(p.PaymentAmt || p.tender_amt),
                PaymentType: p.payment_type || '',
                SNo: i + 1,
                TenderAmt: parseFloat(p.tender_amt),
                RefInfo: p.ref_info || '',
            }))
        } : null;

        sendWebSocketMessage({
            action: 'payment_success',
            deviceId: localStorage.getItem('sok_device_id'),
            tableNo: '',
            //tableNo: localStorage.getItem('tableNo'),
            orderId: getOrderId(order),
            paymentMethod: selectedPaymentMethod,
            amount: totalPaymentAmount,
            transactionId,
            paymentLedger,
            orderData: enrichedOrder,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error('❌ sendPaymentSuccessNotification:', e);
    }
}
function sendPaymentFailedNotification(errorMessage, paymentResult) {
    try {
        const { order } = useOrder();
        sendWebSocketMessage({
            action: 'payment_failed',
            deviceId: localStorage.getItem('sok_device_id'),
            tableNo: '',
            //tableNo: localStorage.getItem('tableNo'),
            orderId: getOrderId(order),
            paymentMethod: selectedPaymentMethod,
            amount: totalPaymentAmount,
            errorMessage,
            paymentResult,
            timestamp: new Date().toISOString()
        });
    } catch (e) { console.error('❌ sendPaymentFailedNotification:', e); }
}

function sendOrderSubmittingNotification() {
    try {
        const { order } = useOrder();
        sendWebSocketMessage({
            action: 'order_submitting',
            deviceId: localStorage.getItem('sok_device_id'),
            tableNo: '',
            //tableNo: localStorage.getItem('tableNo'),
            orderId: getOrderId(order),
            paymentMethod: paymentLedger.map(p => p.payment_name).join(' + '),
            paymentLedger,
            amount: totalPaymentAmount,
            timestamp: new Date().toISOString()
        });
    } catch (e) { console.error('❌ sendOrderSubmittingNotification:', e); }
}


// =============================================================================
// DOM READY
// =============================================================================

function _attachCheckoutHandler() {
    // 1. Remove any old global listeners to prevent double-firing
    document.removeEventListener('click', handleGlobalCheckoutClick);

    // 2. Attach a fresh delegated listener
    document.addEventListener('click', handleGlobalCheckoutClick);

    return true;
}

async function handleGlobalCheckoutClick(e) {
    const btn = e.target.closest('#checkout-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    window.isPaymentInProgress = true;

    try {
        const localStore = JSON.parse(localStorage.getItem("order") || '{}');
        const order = localStore?.state?.order;

        if (!order?.sales_dtls?.length) {
            window.isPaymentInProgress = false;
            return;
        }

        // ✅ Block checkout if orderType is empty or not set
        const orderType = (localStorage.getItem('orderType') || '').trim();
        if (!orderType) {
            window.isPaymentInProgress = false;
            console.warn('⚠️ Checkout blocked — orderType is empty');
            showToast('Please select Dine In or Takeaway before checkout.', 'warning', 'Order Type Required', 4000);
            showOrderTypeSelection(); // bring back the selection screen
            return;
        }

        if (typeof fetchPaymentModes === 'function') await fetchPaymentModes();

        const totalAmount = parseFloat(order.net_amt || 0);
        if (totalAmount <= 0) {
            window.isPaymentInProgress = false;
            return;
        }

        if (typeof openPaymentModal === 'function') {
            openPaymentModal(totalAmount);
        }

    } catch (err) {
        window.isPaymentInProgress = false;
        console.error('❌ Checkout delegation error:', err);
    }
}
document.addEventListener('DOMContentLoaded', async function () {
    fetchPaymentModes()
        .then(() => console.log('✅ Payment modes ready'))
        .catch(err => console.error('❌ fetchPaymentModes failed:', err));

    if (!_attachCheckoutHandler()) {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (_attachCheckoutHandler()) {
                clearInterval(interval);
            } else if (attempts >= 20) {
                clearInterval(interval);
                console.error('❌ checkout-btn never appeared after 10s');
            }
        }, 500);
    }

    const modal = document.getElementById('paymentMethodModal');
    if (modal) {
        modal.addEventListener('click', e => { if (e.target === modal) closePaymentModal(); });
        modal.style.display = 'none';
    }

    _injectCRMStyles();
});


// =============================================================================
// OPEN / RENDER / CLOSE MODAL
// =============================================================================

window.openPaymentModal = async function (amount) {
    console.log('🔓 openPaymentModal called with:', amount);
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        console.error('❌ Invalid amount:', amount);
        return;
    }

    // 🛡️ Block WS sync from wiping the cart while payment modal is open
    window.isPaymentInProgress = true;

    totalPaymentAmount = parsedAmount;
    remainingAmount = parsedAmount;
    paymentLedger = [];
    await fetchPaymentModes();
    _renderPaymentModal();
};
function _renderPaymentModal() {
    const modal = document.getElementById('paymentMethodModal');
    if (!modal) { console.error('❌ paymentMethodModal not found'); return; }

    const displayEl = document.getElementById('paymentAmountDisplay');
    if (displayEl) displayEl.textContent = `${PAYMENT_CONFIG.currencySymbol}${remainingAmount.toFixed(2)}`;

    const container = document.getElementById('paymentMethodsContainer');
    if (!container) { console.error('❌ paymentMethodsContainer not found'); return; }

    const ledgerHtml = (PAYMENT_CONFIG.splitPayment && paymentLedger.length > 0) ? `
        <div class="payment-ledger mb-3 p-2"
             style="background:#f8f9fa; border-radius:8px; font-size:13px; border:1px solid #dee2e6;">
            <strong>Payments Received</strong>
            <table class="w-100 mt-1">
                ${paymentLedger.map((p, i) => `
                    <tr>
                        <td>${i + 1}. ${p.payment_name}</td>
                        <td class="text-end">${PAYMENT_CONFIG.currencySymbol}${parseFloat(p.tender_amt).toFixed(2)}</td>
                        <td style="width:30px; text-align:right;">
                            <span style="cursor:pointer; color:#dc3545; font-weight:bold;"
                                  onclick="removeLedgerEntry(${i})">✕</span>
                        </td>
                    </tr>`).join('')}
            </table>
            <hr class="my-1"/>
            <div class="d-flex justify-content-between fw-bold">
                <span>Remaining</span>
                <span style="color:#dc3545;">${PAYMENT_CONFIG.currencySymbol}${remainingAmount.toFixed(2)}</span>
            </div>
        </div>` : '';

    const activeEntries = PAYMENT_CONFIG.methods.filter(e => e.enabled);

    const cardsHtml = activeEntries.map(entry => {
        const mode = resolveConfigEntry(entry);

        const brandsHtml = entry.brands.length
            ? `<div class="payment-card-brands">${entry.brands.map(b => _buildBrandImg(b)).join('')}</div>`
            : '';

        const iconHtml = entry.icon ? `<span class="payment-icon-large">${entry.icon}</span>` : '';

        // ✅ Use double quotes inside the onclick to avoid breaking the template literal
        const terminaltype = mode.terminaltype ?? entry.fallback.terminaltype;
        const ref3 = mode.ref_3 ?? entry.fallback.ref_3 ?? '';

        return `
            <div class="payment-method-card-single"
                 onclick="selectAndPay(
                     '${mode.payment_name}',
                     '${mode.payment_type}',
                     ${mode.is_direct_pay ?? 0},
                     '${terminaltype}',
                     '${ref3}'
                 )">
                ${brandsHtml}
                <div class="payment-method-content-single">
                    <div class="payment-method-name-single">${iconHtml}${entry.label}</div>
                    <div class="payment-method-desc-single">${entry.desc}</div>
                </div>
            </div>`;
    }).join('');

    container.innerHTML = ledgerHtml + `
        <div class="payment-methods-label">Payment Method</div>
        <div class="payment-methods-container">${cardsHtml}</div>
    `;

    modal.style.display = 'flex';
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    console.log(`✅ Payment modal rendered | $${remainingAmount} remaining | ${activeEntries.length} methods`);
    sendPaymentModalNotification('payment_modal_opened', remainingAmount);
}

window.removeLedgerEntry = function (index) {
    const removed = paymentLedger.splice(index, 1)[0];
    remainingAmount = parseFloat((remainingAmount + parseFloat(removed.tender_amt)).toFixed(2));
    console.log(`↩️ Removed ${removed.payment_name} $${removed.tender_amt} — remaining: $${remainingAmount}`);
    _renderPaymentModal();
};

window.closePaymentModal = function (isSuccess = false) {
    const modal = document.getElementById('paymentMethodModal');
    if (modal) {
        modal.classList.remove('show');
        modal.style.display = 'none';
        document.body.style.overflow = '';
        sendPaymentModalNotification('payment_modal_closed', remainingAmount);
    }
    if (!isSuccess) {
        window.isPaymentInProgress = false;
    }
};

window.hidePaymentProcessing = function () {
    ['paymentProcessingModal', 'paymentMethodModal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.remove('show'); el.style.display = 'none'; }
    });
    document.body.style.overflow = '';
    document.body.style.position = '';
};

window.retryPayment = function () {
    if (currentPaymentController) {
        try { currentPaymentController.abort(); } catch (e) { }
        currentPaymentController = null;
    }
    selectedPaymentMethod = '';
    isPaymentInProgress = false;
    hidePaymentProcessing();

    const { order } = useOrder();
    const amount = parseFloat(order?.net_amt || 0);
    if (amount > 0) {
        setTimeout(() => openPaymentModal(amount), 200);
    } else {
        showErrorModal('Error', 'Unable to process payment. Please refresh the page.');
    }
};


// =============================================================================
// PARTIAL AMOUNT PROMPT
// =============================================================================

function promptPartialAmount(method, paymentType, isDirectPay, terminalType, ref3) {
    const processingModal = document.getElementById('paymentProcessingModal');
    if (!processingModal) return;

    processingModal.style.display = 'flex';
    processingModal.classList.add('show');
    document.body.style.overflow = 'hidden';

    document.querySelector('.payment-processing-content').innerHTML = `
        <div class="payment-result-icon">💵</div>
        <h3 class="payment-processing-title">${method}</h3>
        <p class="payment-processing-message">Remaining: <strong>$${remainingAmount.toFixed(2)}</strong></p>
        <p style="font-size:13px; color:#666;">Enter amount to apply (leave as-is for full remaining)</p>
        <input id="partialAmtInput" type="number" inputmode="decimal"
               value="${remainingAmount.toFixed(2)}"
               min="0.01" max="${remainingAmount.toFixed(2)}" step="0.01"
               style="padding:12px; font-size:18px; width:100%; margin:10px 0;
                      border:2px solid #ccc; border-radius:8px; text-align:center;" />
        <div class="d-flex gap-2 justify-content-center mt-2">
            <button class="btn btn-primary px-4"
                    onclick="confirmPartialAmount('${method}','${paymentType}',${isDirectPay},'${terminalType}','${ref3}')">
                Confirm
            </button>
            <button class="btn btn-secondary px-4" onclick="cancelPayment()">Cancel</button>
        </div>`;
    setTimeout(() => document.getElementById('partialAmtInput')?.select(), 100);
}


(function installBypass() {
    window._originalSelectAndPay = window.selectAndPay;

    window.selectAndPay = async function (method, paymentType, isDirectPay, terminalType, ref3) {
        console.warn('🚧 BYPASS: intercepted selectAndPay', { method, paymentType, remainingAmount });

        const modal = document.getElementById('paymentMethodModal');
        if (modal) { modal.classList.remove('show'); modal.style.display = 'none'; document.body.style.overflow = ''; }

        try {
            showProcessingModal('💳', 'NETS Bypass', `Recording NETS $${remainingAmount}...`);
            await _recordTender('NETS', 'R', remainingAmount, 'NETS');
            console.log('✅ Bypass: NETS recorded for', remainingAmount);
        } catch (err) {
            console.error('❌ Bypass failed:', err);
            showPaymentError('Bypass failed: ' + err.message);
        }
    };

    console.log('🚧 NETS Bypass installed. Run window.restorePayment() to undo.');
})();

window.restorePayment = function () {
    if (window._originalSelectAndPay) {
        window.selectAndPay = window._originalSelectAndPay;
        console.log('✅ selectAndPay restored.');
    }
};




window.confirmPartialAmount = async function (method, paymentType, isDirectPay, terminalType, ref3) {
    const input = document.getElementById('partialAmtInput');
    const entered = parseFloat(input?.value || remainingAmount);
    if (!entered || entered <= 0) { alert('Please enter a valid amount.'); return; }
    if (entered > remainingAmount + 0.001) {
        alert(`Amount cannot exceed remaining balance of $${remainingAmount.toFixed(2)}.`);
        return;
    }

    const processingModal = document.getElementById('paymentProcessingModal');
    if (processingModal) { processingModal.classList.remove('show'); processingModal.style.display = 'none'; }

    try {
        await _processTender(method, paymentType, isDirectPay, terminalType, ref3, Math.min(entered, remainingAmount));
    } finally {
        isPaymentInProgress = false;  // ✅ released here
        currentPaymentController = null;
    }
};



////// =============================================================================
////// SELECT AND PAY
////// =============================================================================

//window.selectAndPay = async function (method, paymentType = null, isDirectPay = 1, terminalType = 'UOB', ref3 = '') {
//    if (isPaymentInProgress) { console.warn('⚠️ Payment already in progress'); return; }
//    isPaymentInProgress = true;
//    paymentCancelled = false;  // ✅ reset on new attempt

//    try {
//        if (!paymentType) {
//            const resolved = resolvePaymentMode(method);
//            paymentType = resolved.payment_type;
//            terminalType = resolved.terminaltype || 'NONE';
//        }

//        if (!remainingAmount || remainingAmount <= 0) {
//            showPaymentError('Invalid payment amount. Please try again.');
//            isPaymentInProgress = false;  // ✅ reset on early exit
//            return;
//        }

//        if (currentPaymentController) {
//            try { currentPaymentController.abort(); } catch (e) { }
//            currentPaymentController = null;
//        }

//        const modal = document.getElementById('paymentMethodModal');
//        if (modal) { modal.classList.remove('show'); modal.style.display = 'none'; document.body.style.overflow = ''; }

//        sendPaymentInitiatedNotification(method, remainingAmount);

//        if (paymentType === 'R' || paymentType === 'P') {
//            // ✅ Do NOT await — flag stays true until terminal fully done
//            _processTender(method, paymentType, isDirectPay, terminalType, ref3, remainingAmount)
//                .catch(err => {
//                    console.error('❌ _processTender unhandled:', err);
//                    sendPaymentFailedNotification(err.message, { error: err.name });
//                    window.cancelPayment();
//                })
//                .finally(() => {
//                    isPaymentInProgress = false;  // ✅ released only after terminal done
//                    currentPaymentController = null;
//                });
//            return;  // ✅ exits try block WITHOUT resetting flag
//        }

//        promptPartialAmount(method, paymentType, isDirectPay, terminalType, ref3);
//        // flag stays true — confirmPartialAmount will reset it

//    } catch (error) {
//        console.error('❌ selectAndPay error:', error);
//        isPaymentInProgress = false;  // ✅ reset on error only
//        currentPaymentController = null;
//    }
//    // ✅ No finally block
//};


// =============================================================================
// PROCESS TENDER
// =============================================================================

async function _processTender(method, paymentType, isDirectPay, terminalType, ref3, tenderAmt) {
    console.log(`💳 _processTender: ${method} | type:${paymentType} | amt:${tenderAmt}`);
    //sendPaymentInitiatedNotification(method, tenderAmt);
    try {
        if (paymentType === 'C' && terminalType === 'NONE') {
            showProcessingModal('💵', `Processing ${method}`, 'Please collect from customer...');
            await _recordTender(method, paymentType, tenderAmt, '');
            return;
        }
        if (paymentType === 'P') {
            await handleCRMPointsPayment(method, tenderAmt);
            return;
        }
        if (paymentType === 'V') {
            if (ref3 === 'R') {
                await handleVoucherPayment(method, tenderAmt);
            } else {
                showProcessingModal('🎫', 'Applying Voucher', `Applying ${method}...`);
                await _recordTender(method, paymentType, tenderAmt, '');
            }
            return;
        }
        if (paymentType === 'O') {
            showProcessingModal('🌐', 'Online Payment', `Recording ${method}...`);
            await _recordTender(method, paymentType, tenderAmt, '');
            return;
        }
        if (paymentType === 'M') {
            showProcessingModal('👤', 'Membership Payment', `Applying ${method}...`);
            await _recordTender(method, paymentType, tenderAmt, '');
            return;
        }
        if (paymentType === 'R') {
            let result;
            try {
                result = await _callCardTerminal(method, tenderAmt, terminalType);
            } catch (err) {
                console.warn('⚠️ _processTender caught terminal error, cancelling:', err.message);
                sendPaymentFailedNotification(err.message, { error: err.name });
                window.cancelPayment();
                return;
            }
            if (result === null) return;
            // ✅ _callCardTerminal already handled _recordTender internally
            // ✅ Just send the notification, don't call _recordTender again
            sendPaymentResponseReceivedNotification(result);
            sendPaymentSuccessNotification(result);
            return;
        }
        throw new Error(`Unhandled payment type: ${paymentType}`);
    } catch (err) {
        console.error('❌ _processTender error:', err);
        sendPaymentFailedNotification(err.message, { error: err.name });
        window.cancelPayment(); // Always cancel, never show error UI
    }
}

// =============================================================================
// RECORD TENDER → LEDGER
// =============================================================================

async function _recordTender(method, type, amount, refInfo, terminalData = null) {
    const tender = {
        payment_type: type,
        payment_name: method,                                    // "MASTER"
        s_no: paymentLedger.length + 1,
        tender_amt: parseFloat(amount).toFixed(2),
        ref_info: [
            refInfo || terminalData?.approval_code || terminalData?.rrn || '',
            terminalData?.card_number || ''                      // ✅ "****8784"
        ].filter(Boolean).join(' '),                             // "260331064944 ****8784"
        currency_name: '',
        exch_rate: '1',
        currency_amount: '0.00',
        terminal: terminalData ? {
            card_number: terminalData.card_number || '',
            response_desc: 'APPROVED',
            display: terminalData.display_name || terminalData.display || method
        } : null
    };
    paymentLedger.push(tender);
    remainingAmount = parseFloat((remainingAmount - amount).toFixed(2));
    if (remainingAmount <= 0.01) {
        await completeOrderAfterPayment();
    } else {
        _renderPaymentModal();
    }
}

async function completeOrder() {
    showProcessingModal('📝', 'Finalizing Order', 'Saving to system...');
    sendOrderSubmittingNotification();

    const { order } = useOrder();

    // 🛡️ FIX: Ensure register and device data exists to prevent 500 Forbidden
    const deviceId = localStorage.getItem('sok_device_id') || "01";
    const registerName = localStorage.getItem('registerName') || "POS01";

    const finalOrder = {
        ...order,
        device_id: deviceId,
        register_name: registerName,
        sales_payment_dtls: paymentLedger,
        order_status_id: 'P',
        order_status_desc: 'Paid'
    };

    try {
        const result = await postOrder({ jsondata: JSON.stringify([finalOrder]) });

        if (result && result.status) {
            console.log("✅ Order Saved Successfully");

            // Notify other services (KDS/Signage)
            await notifyPaymentComplete({
                ...finalOrder,
                sales_no: result.salesNo || finalOrder.order_id
            });

            showSuccessModal('Order Successful', `Your order number is ${result.salesNo || 'being printed'}`);
            setTimeout(() => {
                clearCart();
                window.location.reload();
            }, 3000);
        } else {
            throw new Error(result?.error || "Failed to save order");
        }
    } catch (err) {
        console.error("❌ Order save failed:", err);
        showErrorModal('System Error', 'Payment was successful, but we could not save the order. Please show your receipt to staff.');
    }
}

// =============================================================================
// CARD TERMINAL
// =============================================================================

async function _callCardTerminal(method, amount, terminalType) {
    showProcessingModal('💳', 'Processing Card Payment', 'Please present your card to the terminal');
    const orderType = localStorage.getItem('orderType') || "T";
    const activeMethod = (terminalType === 'UOB') ? 'UOB' : method;

    let apiEndpoint;
    if (activeMethod.toLowerCase() === 'nets') {
        apiEndpoint = '/API/Payment/nets';
    } else if (terminalType === 'UOB') {
        apiEndpoint = '/API/Payment/uob';
    } else if (terminalType === 'OCBC') {
        apiEndpoint = '/API/Payment/ocbc';
    } else {
        apiEndpoint = '/API/Payment/nets-credit';
    }

    sendTerminalCheckStartedNotification(activeMethod, amount);
    currentPaymentController = new AbortController();
    const timeoutId = setTimeout(() => currentPaymentController.abort(), 120000); // 120s — give terminal enough time

    try {
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: currentPaymentController.signal,
            body: JSON.stringify({
                payment: { tenderAmt: parseFloat(amount), paymentName: activeMethod, sNo: 0, refInfo: "NA" },
                oldECN: ""
            })
        });
        clearTimeout(timeoutId);

        // Always parse body first — needed to extract terminal error message on failure
        const result = await response.json();

        if (!response.ok) {
            const terminalData = result?.result || {};
            const responseCode = terminalData?.ResponseCode || terminalData?.responseCode || '';
            const rawMessage =
                terminalData?.ResponseDesc ||
                terminalData?.responseDesc ||
                terminalData?.ResponceInfo ||
                result?.message ||
                '';

            let userMessage;
            if (responseCode === 'NA' || rawMessage.includes('Transaction Not Available')) {
                userMessage = 'Payment timed out at terminal. Please present your card promptly and try again.';
            } else if (rawMessage.includes('FileNotFoundException') || rawMessage.includes('COM')) {
                userMessage = 'Payment terminal not detected. Please check the terminal connection.';
            } else if (rawMessage.includes('MAXIMUM_TRY_FAILLED_NACK') || rawMessage.includes('NACK')) {
                userMessage = 'Terminal is not responding. Please restart the terminal and try again.';
            } else if (rawMessage.includes('SerialPort') || rawMessage.includes('IOException')) {
                userMessage = 'Terminal communication error. Please check the terminal.';
            } else {
                userMessage = rawMessage || `Terminal error (${response.status})`;
            }

            throw new Error(userMessage);
        }

        const hwData = result.result || result;
        const isSuccessful =
            hwData.responseCode === "00" ||
            hwData.ResponceCode === "00" ||
            result.success === true;

        if (isSuccessful) {
            const parsedData = parseTerminalResponse(hwData);

            // ✅ NETS — always record as NETS, skip brand resolution entirely
            if (terminalType === 'NETS') {
                sendPaymentResponseReceivedNotification(hwData);
                await _recordTender('NETS', 'R', amount, parsedData.ref_info, parsedData);
                return parsedData;
            }

            // Card terminals (UOB/OCBC) — resolve brand from terminal response
            const resolvedMode = resolvePaymentMode(parsedData.card_issuer);
            const masterName = resolvedMode?.payment_name || method;
            parsedData.payment_name = masterName;
            parsedData.display_name = parsedData.card_number
                ? `${masterName} ${parsedData.card_number}`
                : masterName;

            console.log('💳 Master name:', masterName, '| Display:', parsedData.display_name);
            sendPaymentResponseReceivedNotification(hwData);
            await _recordTender(masterName, 'R', amount, parsedData.ref_info, parsedData);
            return parsedData;

        } else {
            // Declined — response was 200 OK but ResponseCode != "00"
            const declineReason =
                hwData?.ResponseDesc ||
                hwData?.responseDesc ||
                hwData?.ResponceInfo ||
                "Transaction Declined";
            throw new Error(declineReason);
        }

    } catch (fetchErr) {
        clearTimeout(timeoutId);

        let title = 'Payment Failed';
        let userMessage = fetchErr.message;

        if (fetchErr.name === 'AbortError') {
            title = 'Payment Timed Out';
            userMessage = 'No response from terminal after 2 minutes. Please try again.';
        } else if (fetchErr.message === 'Failed to fetch') {
            title = 'Connection Error';
            userMessage = 'Unable to reach payment terminal. Please check the connection.';
        } else if (fetchErr.message.includes('timed out at terminal')) {
            title = 'Payment Timed Out';
        } else if (fetchErr.message.includes('not detected')) {
            title = 'Terminal Not Connected';
        } else if (fetchErr.message.includes('not responding')) {
            title = 'Terminal Not Responding';
        }

        console.warn(`⚠️ [${terminalType}] ${title}: ${fetchErr.message}`);

        hideProcessingModal();
        showAlertModal('❌', title, userMessage); // replace with your actual modal function

        paymentCancelled = true;
        window.cancelPayment();
        return null;
    }
}


function parseTerminalResponse(result) {
    // --- Raw extractions ---
    const cardNumberRaw = result.cardNumber_Raw || result.pan || result.Pan || '';
    const issuerRaw = result.issuerName_Raw || result.cardLabel || result.CardLabel || '';
    const approvalCode = result.approvalCode_Raw?.split('\u0000').pop()?.trim() || '';
    const ecn = result.ecn || result.s_ECN || result.r_ECN || '';
    const rrn = result.rrN_Raw?.split('\u0000').pop()?.trim() || '';
    const invoiceNo = result.invoiceNumber_Raw?.split('\u0000').pop()?.trim() || '';
    const terminalId = result.terminalID_Raw?.split('\u0000').pop()?.trim() || '';
    const merchantId = result.merchantID_Raw?.split('\u0000').pop()?.trim() || '';
    const batchNo = result.batchNumber_Raw?.split('\u0000').pop()?.trim() || '';
    const txnDate = result.transactionDate_Raw?.split('\u0000').pop()?.trim() || '';
    const txnTime = result.transactionTime_Raw?.split('\u0000').pop()?.trim() || '';
    const gateway = result.terminaL_TYPE || '';
    const responseDesc = result.responseDesc || result.responseCode || '';

    // --- Brand + Mask ---
    // Priority: payment.PaymentName (set by backend) → issuerRaw → fallback
    const brandSource = result.paymentName || result.PaymentName || issuerRaw || '';
    const brand = normalizeBrand(brandSource) || 'CARD';
    const masked = maskCard(cardNumberRaw);

    // e.g. "VISA ****1234"  or just "VISA" if no card number available
    const displayName = masked ? `${brand} ${masked}` : brand;

    return {
        ref_info: approvalCode || rrn || invoiceNo || '',  // ✅ no more "Q"
        ecn, rrn,
        approval_code: approvalCode,
        invoice_no: invoiceNo,
        card_number: masked || cardNumberRaw,
        card_issuer: brand,
        card_type: result.cardType_Raw || brand,
        payment_name: displayName,
        terminal_id: terminalId,
        merchant_id: merchantId,
        batch_no: batchNo,
        gateway,
        txn_date: txnDate,
        txn_time: txnTime,
        response_desc: responseDesc,
        display: [
            displayName,
            approvalCode ? `Approval: ${approvalCode}` : null,
            rrn ? `RRN: ${rrn}` : null,
        ].filter(Boolean).join(' | ')
    };
}



// =============================================================================
// CRM POINTS
// =============================================================================

// ── Styles (injected once) ────────────────────────────────────────────────────
function _injectCRMStyles() {
    if (document.getElementById('crm-pts-styles')) return;
    const s = document.createElement('style');
    s.id = 'crm-pts-styles';
    s.textContent = `
        .crm-panel { animation: crmIn .2s ease; }
        @keyframes crmIn {
            from { opacity:0; transform:translateY(6px); }
            to   { opacity:1; transform:translateY(0); }
        }

        /* Member card */
        .crm-member-card {
            display:flex; align-items:center; gap:12px;
            background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
            border-radius:14px; padding:14px 16px; color:#fff; margin-bottom:14px;
        }
        .crm-avatar {
            width:42px; height:42px; border-radius:50%;
            background:rgba(255,255,255,.12);
            display:flex; align-items:center; justify-content:center;
            font-size:20px; flex-shrink:0;
        }
        .crm-member-details { flex:1; min-width:0; }
        .crm-member-name  { font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .crm-member-tier  { font-size:11px; font-weight:600; color:#f0c060; text-transform:uppercase; letter-spacing:.5px; margin-top:2px; }
        .crm-pts-bubble   { text-align:center; background:rgba(255,255,255,.12); border-radius:10px; padding:6px 14px; flex-shrink:0; }
        .crm-pts-num      { display:block; font-size:22px; font-weight:800; line-height:1; }
        .crm-pts-lbl      { font-size:10px; opacity:.7; text-transform:uppercase; letter-spacing:.5px; }

        /* Rate pill */
        .crm-rate-pill {
            display:flex; align-items:center; gap:6px;
            background:#f3f4ff; border:1px solid #dde0ff;
            border-radius:8px; padding:7px 12px;
            font-size:12px; color:#555; margin-bottom:16px;
        }
        .crm-rate-pill strong { color:#1a1a2e; }

        /* Input */
        .crm-input-label { display:block; font-size:11px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:.6px; margin-bottom:7px; }
        .crm-input-row   { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
        .crm-step {
            width:46px; height:46px; border-radius:10px; border:1.5px solid #ddd;
            background:#fff; font-size:22px; font-weight:300; color:#333;
            cursor:pointer; display:flex; align-items:center; justify-content:center;
            flex-shrink:0; transition:background .12s; user-select:none;
        }
        .crm-step:active { background:#f0f0f0; transform:scale(.95); }
        .crm-field-wrap  { flex:1; position:relative; }
        .crm-field {
            width:100%; height:46px; border:1.5px solid #ddd; border-radius:10px;
            padding:0 36px 0 14px; font-size:20px; font-weight:700;
            color:#1a1a2e; text-align:center; box-sizing:border-box; outline:none;
            transition:border-color .18s; -moz-appearance:textfield;
        }
        .crm-field::-webkit-inner-spin-button,
        .crm-field::-webkit-outer-spin-button { -webkit-appearance:none; }
        .crm-field:focus { border-color:#1a1a2e; }
        .crm-field.ok    { border-color:#22c55e; background:#f0fff4; }
        .crm-field.err   { border-color:#ef4444; background:#fff5f5; }
        .crm-unit { position:absolute; right:10px; top:50%; transform:translateY(-50%); font-size:11px; font-weight:700; color:#bbb; pointer-events:none; }

        /* Quick btns */
        .crm-quick { display:flex; gap:6px; margin-bottom:14px; }
        .crm-q {
            flex:1; height:32px; border-radius:8px; border:1.5px solid #ddd;
            background:#fff; font-size:12px; font-weight:600; color:#555;
            cursor:pointer; transition:all .13s;
        }
        .crm-q:hover  { border-color:#1a1a2e; color:#1a1a2e; }
        .crm-q.active { background:#1a1a2e; color:#fff; border-color:#1a1a2e; }
        .crm-q.max    { border-color:#1a1a2e; color:#1a1a2e; font-weight:700; }

        /* Summary */
        .crm-summary { background:#f8f8f8; border-radius:10px; padding:12px 14px; margin-bottom:12px; }
        .crm-row { display:flex; justify-content:space-between; align-items:center; padding:3px 0; }
        .crm-row-lbl { font-size:13px; color:#666; }
        .crm-row-val { font-size:15px; font-weight:700; color:#1a1a2e; }
        .crm-row.divider { border-top:1px solid #e8e8e8; margin-top:6px; padding-top:8px; }
        .crm-row.divider .crm-row-val { font-size:18px; color:#d04000; }

        /* Error */
        .crm-err { background:#fff5f5; border:1px solid #fca5a5; border-radius:8px; padding:8px 12px; font-size:12px; color:#dc2626; margin-bottom:10px; display:none; }

        /* Confirm */
        .crm-confirm {
            width:100%; height:52px; border-radius:12px; border:none;
            background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
            color:#fff; font-size:16px; font-weight:700;
            cursor:pointer; letter-spacing:.3px; transition:all .18s;
        }
        .crm-confirm:disabled { opacity:.3; cursor:not-allowed; }
        .crm-confirm:not(:disabled):hover { opacity:.88; box-shadow:0 4px 18px rgba(26,26,46,.3); }
        .crm-confirm:not(:disabled):active { transform:scale(.98); }
    `;
    document.head.appendChild(s);
}

// ── Session config (set when panel opens) ────────────────────────────────────
let _crmCfg = null;

function _crmBuildConfig(tenderAmt) {
    const cache = useCache();
    const raw = cache?.memberRawData;
    if (!raw) return null;

    const pc = raw.list_point_conversion;
    const set = pc?.setting;
    if (!pc) return null;

    const rateTo = parseFloat(set?.conversion_ratio_to_amount ?? 0.01);
    const rateFrom = parseFloat(set?.conversion_ratio_from_points ?? 1);
    const rate = rateTo / rateFrom; // $ per point

    const maxAmt = Math.min(
        parseFloat(pc.point_conversion_max_redeem_amount ?? 0),
        tenderAmt
    );
    const maxPts = Math.floor(maxAmt / rate);
    const available = raw.points?.[0]?.points ?? cache?.memberInfo?.points ?? 0;

    return {
        memberName: raw.display_name ?? cache?.memberInfo?.name ?? 'Member',
        memberTier: raw.member_tiers?.[0]?.name ?? cache?.memberInfo?.tier ?? '',
        available,
        rate,
        maxPts,
        maxAmt,
        tenderAmt,
        minPts: parseInt(set?.min_allowed_points ?? 1),
        memberId: raw.id,
        storeName: localStorage.getItem('storename') ?? ''
    };
}

function _crmRenderPanel(cfg) {
    const pcts = [25, 50, 75, 100];
    const quickBtns = pcts.map(p => {
        const pts = Math.min(Math.floor(cfg.maxPts * p / 100), cfg.maxPts);
        return `<button class="crm-q" data-pts="${pts}" onclick="window._crmSet(${pts})">${p}%</button>`;
    }).join('') +
        `<button class="crm-q max" data-pts="${cfg.maxPts}" onclick="window._crmSet(${cfg.maxPts})">Max</button>`;

    return `
    <div class="crm-panel">
        <div class="crm-member-card">
            <div class="crm-avatar">👤</div>
            <div class="crm-member-details">
                <div class="crm-member-name">${cfg.memberName}</div>
                ${cfg.memberTier ? `<div class="crm-member-tier">${cfg.memberTier}</div>` : ''}
            </div>
            <div class="crm-pts-bubble">
                <span class="crm-pts-num">${cfg.available.toLocaleString()}</span>
                <span class="crm-pts-lbl">pts</span>
            </div>
        </div>

        <div class="crm-rate-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
            100 pts = $1.00 &nbsp;|&nbsp;
            Max redeemable: <strong>$${cfg.maxAmt.toFixed(2)}</strong> (${cfg.maxPts.toLocaleString()} pts)
        </div>

        <label class="crm-input-label">Points to redeem</label>
        <div class="crm-input-row">
            <button class="crm-step" onclick="window._crmAdj(-100)">−</button>
            <div class="crm-field-wrap">
                <input id="crmPtsField" type="number" class="crm-field"
                       value="0" min="0" max="${cfg.maxPts}" step="1"
                       oninput="window._crmInput(this.value)" />
                <span class="crm-unit">pts</span>
            </div>
            <button class="crm-step" onclick="window._crmAdj(100)">+</button>
        </div>

        <div class="crm-quick">${quickBtns}</div>

        <div class="crm-summary">
            <div class="crm-row">
                <span class="crm-row-lbl">Points value</span>
                <span class="crm-row-val" id="crmDollarVal">$0.00</span>
            </div>
            <div class="crm-row divider">
                <span class="crm-row-lbl">Remaining to pay</span>
                <span class="crm-row-val" id="crmRemaining">$${cfg.tenderAmt.toFixed(2)}</span>
            </div>
        </div>

        <div class="crm-err" id="crmErr"></div>

        <button class="crm-confirm" id="crmConfirmBtn" disabled onclick="window._crmConfirm()">
            Redeem Points
        </button>
        <button class="btn btn-link w-100 mt-2" style="font-size:13px;color:#888;"
                onclick="cancelPayment()">Cancel</button>
    </div>`;
}

// ── Live update ───────────────────────────────────────────────────────────────
function _crmRefresh(pts) {
    if (!_crmCfg) return;
    const cfg = _crmCfg;
    const dollarVal = parseFloat((pts * cfg.rate).toFixed(2));
    const remaining = Math.max(0, cfg.tenderAmt - dollarVal);

    const dollarEl = document.getElementById('crmDollarVal');
    const remEl = document.getElementById('crmRemaining');
    const errEl = document.getElementById('crmErr');
    const confirmBtn = document.getElementById('crmConfirmBtn');
    const field = document.getElementById('crmPtsField');

    if (dollarEl) dollarEl.textContent = `$${dollarVal.toFixed(2)}`;
    if (remEl) remEl.textContent = `$${remaining.toFixed(2)}`;
    if (errEl) errEl.style.display = 'none';

    let errMsg = '';
    if (pts > 0) {
        if (pts > cfg.available) errMsg = `You only have ${cfg.available.toLocaleString()} points`;
        else if (pts > cfg.maxPts) errMsg = `Max is ${cfg.maxPts.toLocaleString()} pts ($${cfg.maxAmt.toFixed(2)})`;
        else if (pts < cfg.minPts) errMsg = `Minimum is ${cfg.minPts} point${cfg.minPts > 1 ? 's' : ''}`;
        else if (dollarVal > cfg.tenderAmt) errMsg = `Exceeds order total ($${cfg.tenderAmt.toFixed(2)})`;
    }

    const valid = pts > 0 && !errMsg;
    if (field) { field.classList.toggle('ok', valid); field.classList.toggle('err', pts > 0 && !!errMsg); }
    if (errEl && errMsg) { errEl.textContent = errMsg; errEl.style.display = 'block'; }

    if (confirmBtn) {
        confirmBtn.disabled = !valid;
        confirmBtn.textContent = valid
            ? `Redeem ${pts.toLocaleString()} pts  →  -$${dollarVal.toFixed(2)}`
            : 'Redeem Points';
    }
}

window._crmInput = v => _crmRefresh(parseInt(v, 10) || 0);
window._crmAdj = d => {
    const f = document.getElementById('crmPtsField');
    if (!f || !_crmCfg) return;
    const next = Math.max(0, Math.min((parseInt(f.value, 10) || 0) + d, _crmCfg.maxPts));
    f.value = next;
    _crmRefresh(next);
};
window._crmSet = pts => {
    const f = document.getElementById('crmPtsField');
    if (!f || !_crmCfg) return;
    const clamped = Math.min(pts, _crmCfg.maxPts);
    f.value = clamped;
    _crmRefresh(clamped);
    document.querySelectorAll('.crm-q').forEach(b =>
        b.classList.toggle('active', parseInt(b.dataset.pts) === clamped)
    );
};


window._crmConfirm = async function () {
    if (!_crmCfg) return;

    const pts = parseInt(document.getElementById('crmPtsField')?.value || 0, 10);
    if (!pts || pts <= 0) return;

    const errEl = document.getElementById('crmErr');
    if (errEl) { errEl.style.display = 'none'; }

    if (pts > _crmCfg.available) {
        if (errEl) { errEl.textContent = `Insufficient points. Available: ${_crmCfg.available}`; errEl.style.display = 'block'; }
        return;
    }

    const dollarVal = parseFloat((pts * _crmCfg.rate).toFixed(2));
    const transactionNo = `TXN-${Date.now()}`;
    const btn = document.getElementById('crmConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

    try {
        const res = await fetch('/api/eber/integration/issue_point', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eberpayload: {
                    user_id: _crmCfg.memberId,
                    transaction_no: transactionNo,
                    custom_store_id: _crmCfg.storeName,
                    amount: dollarVal,
                    point_conversion_points: pts,          // ✅ deducts points
                    notify: true,
                    custom_staff_id: 'WEBORDER',
                    unique_type: 'evolut',
                    create: 1,
                }
            })
        });

        const data = await res.json();

        // ✅ correct status check for issue_point response
        if (!res.ok || data.status === false) {
            throw new Error(data?.message || `HTTP ${res.status}`);
        }

        // ✅ correct path for transaction_no
        const ref = data?.transaction?.transaction_no ?? transactionNo;

        console.log('✅ EBER points redeemed:', {
            pts,
            dollarVal,
            ref,
            newBalance: data.point_balance,
            totalDeducted: data.total_deducted_points
        });

        await _recordTender('CRM POINT', 'P', dollarVal, ref);

    } catch (err) {
        console.error('❌ CRM redemption error:', err);
        if (errEl) { errEl.textContent = `Redemption failed: ${err.message}`; errEl.style.display = 'block'; }
        if (btn) { btn.disabled = false; btn.textContent = 'Redeem Points'; }
    }
};


// ── Entry point called by _processTender ─────────────────────────────────────
async function handleCRMPointsPayment(method, tenderAmt) {
    const processingModal = document.getElementById('paymentProcessingModal');
    if (!processingModal) return;

    processingModal.style.display = 'flex';
    processingModal.classList.add('show');
    document.body.style.overflow = 'hidden';

    const content = document.querySelector('.payment-processing-content');
    if (!content) return;

    const cfg = _crmBuildConfig(tenderAmt);

    if (!cfg) {
        // ── No member in cache — fall back to phone lookup ────────────────
        content.innerHTML = `
            <div class="payment-result-icon">🎯</div>
            <h3 class="payment-processing-title">Redeem CRM Points</h3>
            <p class="payment-processing-message">Remaining: <strong>$${parseFloat(tenderAmt).toFixed(2)}</strong></p>
            <p style="font-size:13px;color:#888;margin-bottom:8px;">No member logged in. Enter phone to look up.</p>
            <input id="crmPhoneInput" type="tel" inputmode="numeric" placeholder="8-digit phone number"
                   style="padding:12px;font-size:16px;width:100%;margin:8px 0;
                          border:1.5px solid #ddd;border-radius:10px;text-align:center;box-sizing:border-box;" />
            <div class="d-flex gap-2 justify-content-center mt-2">
                <button class="btn btn-primary px-4"
                        onclick="window._crmLookup('${method}', ${tenderAmt})">Look Up Member</button>
                <button class="btn btn-secondary px-4" onclick="cancelPayment()">Cancel</button>
            </div>`;
        setTimeout(() => document.getElementById('crmPhoneInput')?.focus(), 100);
        return;
    }

    _crmCfg = cfg;
    content.innerHTML = _crmRenderPanel(cfg);
}

// ── Phone lookup fallback ─────────────────────────────────────────────────────
window._crmLookup = async function (method, tenderAmt) {
    const phone = document.getElementById('crmPhoneInput')?.value?.trim();
    if (!phone) { alert('Please enter a phone number.'); return; }

    const content = document.querySelector('.payment-processing-content');
    if (content) {
        content.innerHTML = `
            <div class="payment-spinner">
                <div class="payment-spinner-circle"></div>
                <div class="payment-spinner-icon">🔍</div>
            </div>
            <h3 class="payment-processing-title">Looking up member…</h3>`;
    }

    try {
        const res = await fetch(`/api/eber/user/show?phone=${encodeURIComponent(phone)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queryString: '' })
        });
        const data = await res.json();
        if (!data?.success || !data?.member_found) throw new Error(data?.error || 'Member not found');

        // Populate cache so _crmBuildConfig can read it
        const cache = useCache();
        cache.memberRawData = data.raw_data;
        cache.memberInfo = data.member;

        const cfg = _crmBuildConfig(tenderAmt);
        if (!cfg) throw new Error('Could not load point conversion data');

        _crmCfg = cfg;
        if (content) content.innerHTML = _crmRenderPanel(cfg);

    } catch (err) {
        console.error('❌ CRM lookup error:', err);
        const c = document.querySelector('.payment-processing-content');
        if (c) {
            c.innerHTML = `
                <div class="payment-result-icon error">❌</div>
                <h3 class="payment-processing-title">Member Not Found</h3>
                <p class="payment-processing-message">${err.message}</p>
                <button class="payment-result-btn" onclick="cancelPayment()">Back</button>`;
        }
    }
};


// =============================================================================
// VOUCHER
// =============================================================================

async function handleVoucherPayment(method, paymentAmount) {
    const processingModal = document.getElementById('paymentProcessingModal');
    if (!processingModal) return;

    processingModal.style.display = 'flex';
    processingModal.classList.add('show');
    document.body.style.overflow = 'hidden';

    document.querySelector('.payment-processing-content').innerHTML = `
        <div class="payment-result-icon">🎫</div>
        <h3 class="payment-processing-title">${method}</h3>
        <p class="payment-processing-message">Amount: <strong>$${parseFloat(paymentAmount).toFixed(2)}</strong></p>
        <p>Scan or enter voucher / gift card code</p>
        <input id="voucherCode" type="text" placeholder="Voucher Code"
               style="padding:12px; font-size:16px; width:100%; margin:12px 0;
                      border:1px solid #ccc; border-radius:8px;" />
        <div class="d-flex gap-2 justify-content-center mt-2">
            <button class="btn btn-primary px-4" onclick="confirmVoucher('${method}',${paymentAmount})">
                Apply Voucher
            </button>
            <button class="btn btn-secondary px-4" onclick="cancelPayment()">Cancel</button>
        </div>`;
    setTimeout(() => document.getElementById('voucherCode')?.focus(), 100);
}

window.confirmVoucher = async function (method, paymentAmount) {
    const code = document.getElementById('voucherCode')?.value?.trim();
    if (!code) { alert('Please enter a voucher code.'); return; }

    showProcessingModal('⏳', 'Validating Voucher...', 'Please wait...');

    try {
        const res = await fetch('/api/crm/voucher/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voucherCode: code, paymentName: method, amount: paymentAmount })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Invalid voucher');
        await _recordTender(method, 'V', paymentAmount, code);
    } catch (err) {
        console.error('❌ Voucher validation failed:', err);
        showPaymentError(`Voucher error: ${err.message}`);
    }
};


// =============================================================================
// COMPLETE ORDER
// =============================================================================
async function completeOrderAfterPayment() {
    console.log('🎉 Completing order. Ledger:', paymentLedger);

    try {
        // ── 🔒 SNAPSHOT ALL MUTABLE STATE FIRST (before any await or reset) ──
        const { order } = useOrder();
        const orderSnapshot = order ? JSON.parse(JSON.stringify(order)) : null;
        const crmCfgSnapshot = _crmCfg ? { ..._crmCfg } : null;
        const ledgerSnapshot = paymentLedger.map(p => ({ ...p }));

        sendOrderSubmittingNotification();

        // ── 1. Build payment details ─────────────────────────────────────────
        const salesPaymentDtls = ledgerSnapshot.map((p, i) => ({
            PaymentCode: p.PaymentCode || p.payment_name,
            PaymentAmt: parseFloat(p.PaymentAmt || p.tender_amt) || 0,
            PaymentType: p.payment_type || '',
            SNo: i + 1,
            TenderAmt: parseFloat(p.tender_amt) || 0,
            RefInfo: p.ref_info || '',
        }));

        // ── 2. Post order → get SAL number ───────────────────────────────────
        const result = await postOrder({
            orderSnapshot,
            paymentName: ledgerSnapshot.map(p => p.payment_name).join('+'),
            paymentType: ledgerSnapshot[0]?.payment_type || 'C',
            paymentLedger: ledgerSnapshot,
            salesPaymentDtls,
            paymentResult: { ResponseCode: '00' }
        });

        if (!result.success && !result.salesNo) {
            console.error('❌ postOrder failed:', result.response);
            showPaymentError('Order submission failed. Please contact staff.');
            return;
        }

        const sales_no = result.salesNo
            || result.response?.[0]?.output?.[0]?.sales_no
            || result.response?.[0]?.sales_no
            || 'Unknown';

        const transactionId = ledgerSnapshot.map(p => p.ref_info).filter(Boolean).join(',');
        const paymentLabel = ledgerSnapshot.map(p => p.payment_name).join(' + ');

        // ── 3. Build enriched order object ───────────────────────────────────
        const enrichedOrder = orderSnapshot ? {
            ...orderSnapshot,
            sales_no,
            order_status_id: 'P', order_status_desc: 'Paid',
            kitchen_status_id: 'P', kitchen_status_desc: '',
            total_tender_amt: parseFloat(totalPaymentAmount).toFixed(2),
            change_amt: '0.00',
            sales_payment_dtls: ledgerSnapshot,
            SalesPaymentDtls: salesPaymentDtls
        } : null;

        // ── 4. UI Transition: Show success IMMEDIATELY ───────────────────────
        const processingModal = document.getElementById('paymentProcessingModal');
        if (processingModal) {
            processingModal.classList.remove('show');
            processingModal.style.display = 'none';
        }

        showSuccessModal({
            sales_no,
            orderData: enrichedOrder,
            orderResult: result.response,
            paymentMethod: paymentLabel,
            paymentAmount: totalPaymentAmount,
            paymentLedger: ledgerSnapshot,
            transactionId
        });

        // ── 5. Reset global payment state ────────────────────────────────────
        const finalizedTotal = totalPaymentAmount; // Local copy for bg tasks
        selectedPaymentMethod = '';
        totalPaymentAmount = 0;
        remainingAmount = 0;
        paymentLedger = [];
        isPaymentInProgress = false;
        _crmCfg = null;
        console.log('✅ Payment state reset. Proceeding with background tasks...');

        // ─────────────────────────────────────────────────────────────────────
        // FIRE-AND-FORGET BACKGROUND TASKS
        // User is already on success screen — nothing here blocks the UI
        // ─────────────────────────────────────────────────────────────────────
        (async () => {
            try {
                const cache = useCache();

                // ── A. WARM BOOT RE-HYDRATION ─────────────────────────────────
                if (!cache.printerSettings || cache.printerSettings.length === 0) {
                    const localPrinters = localStorage.getItem('storeKitchenPrinters');
                    if (localPrinters) {
                        const parsed = JSON.parse(localPrinters);
                        console.log("🛠️ [Warm Boot] Hydrating cache from localStorage:", parsed.length);
                        cache.setPrinterSettings(parsed);
                    }
                }

                //// ── B. EBER Points Issuance ───────────────────────────────────
                try {
                    const vendorInfo = orderSnapshot?.customer?.vendor_info ?? cache?.memberRawData;
                    if (vendorInfo?.id) {
                        const crmEntry = ledgerSnapshot.find(p => p.payment_name?.toUpperCase() === 'CRM POINT');
                        const nowInUtc = new Date().toISOString().replace('T', ' ').substring(0, 19);

                        fetch('/api/eber/integration/issue_point', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                eberpayload: {
                                    email: vendorInfo.email,
                                    phone: vendorInfo.phone,
                                    user_id: vendorInfo.id,
                                    amount: orderSnapshot?.net_amt,
                                    transaction_no: sales_no,
                                    custom_store_id: localStorage.getItem('storename') ?? '',
                                    item_data_json: JSON.stringify((orderSnapshot?.sales_dtls || []).map(item => ({
                                        name: item.item_name,
                                        total_amount: item.sub_total,
                                        quantity: item.qty
                                    }))),
                                    utc_transaction_created_at: nowInUtc,
                                    point_conversion_points: crmEntry
                                        ? Math.round(parseFloat(crmEntry.tender_amt) / (crmCfgSnapshot?.rate ?? 0.01))
                                        : 0,
                                    unique_type: 'evolut',
                                    create: 1
                                }
                            })
                        }).catch(e => console.warn('⚠️ EBER Points failed:', e.message));
                    }
                } catch (e) {
                    console.warn('⚠️ EBER setup error:', e.message);
                }

                // ── C. System Notifications ───────────────────────────────────
                notifyPaymentComplete({
                    orderId: sales_no,
                    sales_no,
                    paymentMethod: paymentLabel,
                    totalAmount: finalizedTotal,
                    transactionId,
                    orderData: enrichedOrder
                }).catch(e => console.warn('⚠️ notifyPaymentComplete error:', e.message));

                sendWebSocketMessage({
                    action: 'order_complete',
                    deviceId: localStorage.getItem('sok_device_id'),
                    tableNo: localStorage.getItem('tableNo'),
                    salesNo: sales_no,
                    paymentLedger: ledgerSnapshot,
                    totalAmount: finalizedTotal,
                    timestamp: new Date().toISOString()
                });

                // ── D. Printing Operations ────────────────────────────────────
                try {
                    const { kprintOrder, receiptRecord, receiptSalesDtls, kprintItems } = await getPrintData(sales_no);

                    console.log('📦 kprint order:', kprintOrder?.sales_no, '| items:', kprintItems?.length ?? 0);
                    console.log('📦 receipt items:', receiptSalesDtls?.length);

                    // 1. Receipt
                    const receiptOrder = {
                        ...(enrichedOrder ?? {}),
                        ...(receiptRecord ?? {}),
                        sales_dtls: receiptSalesDtls?.length > 0
                            ? receiptSalesDtls
                            : (enrichedOrder?.sales_dtls ?? []),
                        sales_service_dtls: receiptRecord?.sales_service_dtls?.length > 0
                            ? receiptRecord.sales_service_dtls
                            : (enrichedOrder?.sales_service_dtls ?? []),
                        sales_payment_dtls: enrichedOrder?.sales_payment_dtls?.length > 0
                            ? enrichedOrder.sales_payment_dtls
                            : (receiptRecord?.sales_payment_dtls ?? [])
                    };

                    console.log('🧾 [RECEIPT] Firing... items:', receiptOrder.sales_dtls?.length);
                    try {
                        const p = receiptPrint('RECEIPT', [receiptOrder], '0', 'R1');
                        if (p?.catch) p.catch(e => console.error('❌ [RECEIPT] Print failed:', e));
                    } catch (err) {
                        console.error('❌ [RECEIPT] Execution error:', err);
                    }



                    // 2. Kitchen
                    if (!kprintOrder || !kprintItems?.length) {
                        console.warn('⚠️ [KITCHEN] No items found — skipping');
                    } else {
                        const settings = cache?.printerSettings?.length > 0
                            ? cache.printerSettings
                            : JSON.parse(localStorage.getItem('storeKitchenPrinters') || '[]');

                        const printerGroups = kprintItems.reduce((acc, item) => {
                            const mapping = settings.find(p => p.setting_code === item.printer_name);
                            const targetPrinter = mapping?.setting_value;

                            // Only add if mapped and not already in this group (deduplicate by s_no)
                            if (item.printer_name && targetPrinter) {
                                if (!acc[targetPrinter]) acc[targetPrinter] = [];
                                if (!acc[targetPrinter].find(i => i.s_no === item.s_no)) {
                                    acc[targetPrinter].push(item);
                                }
                            }

                            // If child, inject into parent's printer group if different and mapped
                            if (item.s_no !== item.parent_sno) {
                                const parent = kprintItems.find(p => p.s_no === item.parent_sno);
                                const parentPrinter = settings.find(p => p.setting_code === parent?.printer_name)?.setting_value;
                                if (parentPrinter && parentPrinter !== targetPrinter) {
                                    if (!acc[parentPrinter]) acc[parentPrinter] = [];
                                    if (!acc[parentPrinter].find(i => i.s_no === item.s_no)) {
                                        acc[parentPrinter].push({ ...item });
                                    }
                                }
                            }

                            return acc;
                        }, {});

                        console.log('🖨️ [KITCHEN] Printer groups:', Object.entries(printerGroups)
                            .map(([code, items]) => `${code}(${items.length})`).join(', '));

                        for (const [pCode, items] of Object.entries(printerGroups)) {
                            try {
                                console.log(`🔥 [KITCHEN] Firing [${pCode}] | Items:`, items.map(i => i.item_name));
                                kitchenPrint(
                                    'KITCHEN',
                                    [{ ...kprintOrder, sales_dtls: items.map(i => ({ ...i, printer_name: pCode })) }],
                                    '0',
                                    pCode,
                                    null,
                                    kprintItems
                                );
                            } catch (err) {
                                console.error(`❌ [KITCHEN] Fire failed for [${pCode}]:`, err);
                            }
                            await new Promise(resolve => setTimeout(resolve, 400));
                        }
                    }

                } catch (printErr) {
                    console.error('❌ [PRINTING] getPrintData failed:', printErr);
                }

            } catch (bgErr) {
                console.error('❌ Background Task Error:', bgErr);
            }
        })();

    } catch (error) {
        console.error('❌ completeOrderAfterPayment Critical Error:', error);
        showPaymentError('An error occurred. Please contact staff.');
    }
}


// =============================================================================
// PAYMENT COMPLETE HTTP
// =============================================================================

async function notifyPaymentComplete(paymentData) {
    try {
        let sanitizedOrderData = null;
        if (paymentData.orderData) {
            sanitizedOrderData = {
                ...paymentData.orderData,
                // 🔥 FIX 1: Explicitly stringify tips_amt and other numeric strings
                tips_amt: String(paymentData.orderData.tips_amt || "0.00"),
                change_amt: String(paymentData.orderData.change_amt || "0.00"),
                sub_total: String(paymentData.orderData.sub_total || "0.00"),
                net_amt: String(paymentData.orderData.net_amt || "0.00"),
                total_tax: String(paymentData.orderData.total_tax || "0.00"),
                total_tender_amt: String(paymentData.orderData.total_tender_amt || "0.00"),

                // FIX 2: Ensure is_absorbtax is a number/int for the backend
                sales_dtls: paymentData.orderData.sales_dtls?.map(item => ({
                    ...item,
                    is_absorbtax: item.is_absorbtax === true ? 1 :
                        (item.is_absorbtax === false ? 0 : item.is_absorbtax),
                    // Also stringify item-level numeric values if your DTO requires it
                    unit_price: String(item.unit_price || "0.00"),
                    sub_total: String(item.sub_total || "0.00")
                }))
            };
        }

        const payload = {
            // 🔥 FIX 3: If 'request' fails, try 'Request' (Capital R) to match C# property naming
            request: 'payment_complete',
            deviceId: localStorage.getItem('sok_device_id') || '01',
            orderId: paymentData.orderId || paymentData.sales_no,
            salesNo: paymentData.sales_no,
            tableNo: paymentData.orderData?.table_no || '',
            orderType: localStorage.getItem('orderType') || 'T',
            paymentMethod: paymentData.paymentMethod || 'NETS',
            totalAmount: parseFloat(paymentData.totalAmount || 0),
            paidAmount: parseFloat(paymentData.paidAmount || 0),
            changeAmount: String(paymentData.changeAmount || '0.00'),
            transactionId: paymentData.transactionId || '',
            receiptNumber: paymentData.receiptNumber || paymentData.sales_no,
            orderData: sanitizedOrderData
        };

        console.log('📤 Sending sanitized payment payload:', payload);

        const response = await fetch('/API/SOKOrder/payment-complete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        // Parse response safely
        const result = await response.json().catch(() => ({}));

        if (response.ok) {
            console.log('✅ Payment notification sent:', result);
            return { success: true, data: result };
        } else {
            console.error('❌ Server Rejected Request (400/500):', result);
            return { success: false, error: result };
        }
    } catch (error) {
        console.error('❌ notifyPaymentComplete Network error:', error);
        return { success: false, error: error.message };
    }
}

// =============================================================================
// UI HELPERS
// =============================================================================

function showProcessingModal(icon, title, message) {
    const modal = document.getElementById('paymentProcessingModal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    const content = document.querySelector('.payment-processing-content');
    if (content) {
        content.innerHTML = `
            <div class="payment-spinner">
                <div class="payment-spinner-circle"></div>
                <div class="payment-spinner-icon">${icon}</div>
            </div>
            <h3 class="payment-processing-title">${title}</h3>
            <p class="payment-processing-message">${message}</p>
            <p class="payment-processing-hint">Please wait, do not refresh the page...</p>`;
    }
}

// In your WebSocket handler or error showing function
function showPaymentError(message) {
    // 1. ADD THIS GUARD:
    // If the order was already posted successfully in the last few seconds,
    // ignore any late "Failure" messages from the terminal.
    if (isPaymentInProgress === false && paymentLedger.length === 0) {
        console.warn("⚠️ Ignoring late 'Payment Failed' message because order is already complete.");
        return;
    }

    // Existing error logic...
    const container = document.getElementById('paymentProcessingModal');
    if (container) {
        container.innerHTML = `
            <div class="payment-processing-content">
                <div class="payment-result-icon error">❌</div>
                <h3 class="payment-processing-title">Payment Failed</h3>
                <p class="payment-processing-message">${message}</p>
                <button class="payment-result-btn" onclick="retryPayment()">Try Again</button>
            </div>`;
    }
}

window.cancelPayment = function () {
    paymentCancelled = true;
    isPaymentInProgress = false;  // ✅ always reset on cancel
    _crmCfg = null;

    if (currentPaymentController) {
        try { currentPaymentController.abort(); } catch (e) { }
        currentPaymentController = null;
    }

    const modal = document.getElementById('paymentProcessingModal');
    if (modal) { modal.classList.remove('show'); modal.style.display = 'none'; }
    document.body.style.overflow = '';

    if (remainingAmount > 0.009 && totalPaymentAmount > 0) {
        _renderPaymentModal();
        const payModal = document.getElementById('paymentMethodModal');
        if (payModal) { payModal.style.display = 'flex'; payModal.classList.add('show'); document.body.style.overflow = 'hidden'; }
    }
};

// =============================================================================
// WEBSOCKET INCOMING
// =============================================================================
window.sokWebSocket.onMessage = function (msg) {
    if (!msg || !msg.action) return;

    switch (msg.action) {
        case 'PAYMENT_RESPONSE': {
            if (!isPaymentInProgress || paymentCancelled) {
                console.warn('⚠️ Ignoring stale PAYMENT_RESPONSE');
                break;
            }
            const responseCode = msg.responseCode || msg.responce_code || msg.ResponceCode || '99';
            if (responseCode === '00') {
                const parsed = parseTerminalResponse(msg);
                _recordTender(parsed.payment_name || selectedPaymentMethod, 'R', remainingAmount, parsed.ref_info, parsed);
            } else {
                const errorMsg = msg.responseMessage || msg.responseDesc || 'Payment failed';
                showPaymentError(errorMsg);
                sendPaymentFailedNotification(errorMsg, msg);
            }
            break;
        }

        case 'TERMINAL_ERROR':
            console.error('❌ Terminal error:', msg.errorMessage);
            showPaymentError(msg.errorMessage || 'Terminal error occurred.');
            break;

        default:
            console.log('📡 WS message:', msg.action);
    }
};


// =============================================================================
// GLOBAL HANDLERS
// =============================================================================

window.onPaymentSuccess = async function (paymentResult) {
    const parsed = parseTerminalResponse(paymentResult);
    const resolvedMode = resolvePaymentMode(parsed.card_issuer);
    const correctPaymentName = resolvedMode?.payment_name || parsed.card_issuer || selectedPaymentMethod;
    const displayName = parsed.card_number ? `${correctPaymentName} ${parsed.card_number}` : correctPaymentName;
    parsed.payment_name = displayName;
    await _recordTender(displayName, 'R', remainingAmount, parsed.ref_info, parsed);
};

window.onPaymentFailure = function (error) {
    console.error('❌ Payment failed:', error);
    if (typeof closePaymentModal === 'function') closePaymentModal();
    showErrorModal('Payment Failed', error.message || 'Payment could not be processed. Please try again.');
};

function normalizeBrand(raw) {
    if (!raw) return null;
    const s = raw.trim().toUpperCase();
    if (s.includes('VISA')) return 'VISA';
    if (s.includes('MASTER')) return 'Mastercard';
    if (s.includes('AMEX') || s.includes('AMERICAN')) return 'AMEX';
    if (s.includes('JCB')) return 'JCB';
    if (s.includes('UNIONPAY') || s.includes('UNION')) return 'UnionPay';
    if (s.includes('ALIPAY')) return 'Alipay';
    if (s.includes('NETS')) return 'NETS';
    return raw.trim(); // return as-is if unrecognized
}

function maskCard(cardRaw) {
    if (!cardRaw) return null;
    const digits = cardRaw.replace(/\u0000/g, '').replace(/\D/g, '');
    const last4 = digits.length >= 4 ? digits.slice(-4) : digits;
    return last4 ? `****${last4}` : null;
}




window.clearPaymentModesCache = clearPaymentModesCache;
window.fetchPaymentModes = fetchPaymentModes;
window.resolvePaymentMode = resolvePaymentMode;

window.debugPayment = function () {
    console.group('💳 Payment Debug');
    console.log('_paymentModes count    :', Object.keys(_paymentModes || {}).length);
    console.log('_paymentGroups keys    :', Object.keys(_paymentGroups || {}));
    console.log('totalPaymentAmount     :', totalPaymentAmount);
    console.log('remainingAmount        :', remainingAmount);
    console.log('paymentLedger          :', paymentLedger);
    console.log('isPaymentInProgress    :', isPaymentInProgress);
    console.log('selectedMethod         :', selectedPaymentMethod);
    console.log('crmCfg                 :', _crmCfg);
    console.log('localStorage modes     :', !!localStorage.getItem(STORAGE_KEY_MODES));
    console.log('localStorage groups    :', !!localStorage.getItem(STORAGE_KEY_GROUPS));
    console.log('checkout-btn           :', !!document.getElementById('checkout-btn'));
    console.log('paymentMethodModal     :', !!document.getElementById('paymentMethodModal'));
    console.log('paymentMethodsContainer:', !!document.getElementById('paymentMethodsContainer'));
    console.log('paymentProcessingModal :', !!document.getElementById('paymentProcessingModal'));
    console.groupEnd();
};
