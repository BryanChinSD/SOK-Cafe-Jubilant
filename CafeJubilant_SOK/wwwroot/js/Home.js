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

import { getPriceByServiceType, applyPromotions, isAbsorbTax, getLastSNo, getNewOrder } from '../utils/pos.js'; // adjust path if needed


import {
    getItemImageUrl,
    addToCart,
    updateCartCount,
    showAddOnModalOriginal,
    groupItemsByTemperature,
    getItemTemperature,
    resolveImageUrl
} from './GetHomeAPI.js';

import { renderCartFromOrder, showErrorModal, closeErrorModal, showSuccessModal, closeModal } from '../js/renderCartFromOrder.js';


renderCartFromOrder();
updateCartCount();


// ============================================
// CONFIGURATION - Choose your modal style
// ============================================

const ADDON_MODAL_CONFIG = {
    style: 'traditional',

    // Wizard-specific settings
    wizard: {
        showProgressBar: true,
        showStepNumbers: true,
        enableBackButton: true,
        autoAdvanceOnSelection: true,
    },

    // Traditional-specific settings
    traditional: {
        collapsibleSections: true,
        stickyAddButton: true,
    }
};


// ============================================
// MENU RENDERING CONFIGURATION
// ============================================
export const MENU_CONFIG = {
    // Options: 'traditional' | 'wizard'

    //RENDERING_MODE: 'wizard',
    RENDERING_MODE: 'traditional', 
    OPTIONS: {
        showSubcategorySections: true,
        collapsibleSubcategories: true,
        startCollapsedOnMobile: false,
        sortStickyItemsFirst: true
    },
    DEBUG: {
        enabled: false,
        logRenderMode: true
    }
};

export function setMenuRenderingMode(mode) {
    if (mode !== 'wizard' && mode !== 'traditional') {
        console.error('❌ Invalid mode. Use "wizard" or "traditional"');
        return;
    }
    MENU_CONFIG.RENDERING_MODE = mode;
    console.log(`✅ Menu rendering mode set to: ${mode}`);
}

// Also expose on window for browser console access
if (typeof window !== 'undefined') {
    window.MENU_CONFIG = MENU_CONFIG;
    window.setMenuRenderingMode = setMenuRenderingMode;
}

// Move voucher banner inside cart-items for proper scrolling
document.addEventListener('DOMContentLoaded', function () {
    const voucherBanner = document.getElementById('voucherBanner');
    const cartItems = document.getElementById('cartItems');

    if (voucherBanner && cartItems && voucherBanner.parentElement !== cartItems.parentElement) {
        // Move voucher banner to be the first child of cart-items
        cartItems.parentElement.insertBefore(voucherBanner, cartItems);
    }
});

let resizeTimeout;

function autoScrollToTab(categoryCode, delay = 100) {
    if (!categoryCode) return;

    setTimeout(() => {
        // Find the active tab
        const activeTab = document.querySelector(
            `.category-tab[data-category="${categoryCode}"], ` +
            `.subcategory-tab[data-category="${categoryCode}"]`
        );

        if (!activeTab) {
            console.warn(`Tab with category code "${categoryCode}" not found`);
            return;
        }

        // Store current scroll position
        const originalScrollX = window.scrollX;
        const originalScrollY = window.scrollY;

        // Scroll the navigation container
        scrollNavigationOnly(activeTab);

        // Restore main window scroll position
        setTimeout(() => {
            if (window.scrollX !== originalScrollX || window.scrollY !== originalScrollY) {
                window.scrollTo(originalScrollX, originalScrollY);
            }
        }, 10);

        // Add visual highlight
        addTabHighlight(activeTab);
    }, delay);
}

function scrollNavigationOnly(element) {
    const navSidebar = document.querySelector('.navigation-sidebar');
    const categoryTabs = document.querySelector('.category-tabs');

    if (!navSidebar || !categoryTabs) return;

    // Determine which container to scroll
    const isVerticalScroll = categoryTabs.scrollHeight > categoryTabs.clientHeight;
    const isHorizontalScroll = navSidebar.scrollWidth > navSidebar.clientWidth;

    let container;
    let scrollAxis;

    if (isHorizontalScroll) {
        // Mobile: horizontal scroll
        container = navSidebar;
        scrollAxis = 'horizontal';
    } else if (isVerticalScroll) {
        // Desktop: vertical scroll
        container = categoryTabs;
        scrollAxis = 'vertical';
    } else {
        return; // No scrolling needed
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Check if element is fully visible
    let isVisible;
    if (scrollAxis === 'horizontal') {
        isVisible = elementRect.left >= containerRect.left &&
            elementRect.right <= containerRect.right;
    } else {
        isVisible = elementRect.top >= containerRect.top &&
            elementRect.bottom <= containerRect.bottom;
    }

    if (isVisible) return; // Already visible

    // Calculate scroll position
    let targetScroll;
    if (scrollAxis === 'horizontal') {
        const elementLeft = elementRect.left - containerRect.left + container.scrollLeft;
        const elementWidth = elementRect.width;
        const containerWidth = container.clientWidth;
        targetScroll = elementLeft - (containerWidth / 2) + (elementWidth / 2);

        // Ensure within bounds
        const maxScroll = container.scrollWidth - containerWidth;
        targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));

        smoothScrollTo(container, targetScroll, 'scrollLeft');
    } else {
        const elementTop = elementRect.top - containerRect.top + container.scrollTop;
        const elementHeight = elementRect.height;
        const containerHeight = container.clientHeight;
        targetScroll = elementTop - (containerHeight / 2) + (elementHeight / 2);

        // Ensure within bounds
        const maxScroll = container.scrollHeight - containerHeight;
        targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));

        smoothScrollTo(container, targetScroll, 'scrollTop');
    }
}

function smoothScrollTo(container, targetScroll, scrollProperty) {
    const startScroll = container[scrollProperty];
    const distance = targetScroll - startScroll;
    const duration = 300; // milliseconds
    let startTime;

    function easeInOutCubic(t) {
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function animate(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easeInOutCubic(progress);

        container[scrollProperty] = startScroll + (distance * easedProgress);

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }

    requestAnimationFrame(animate);
}


function addTabHighlight(element) {
    // Remove existing highlights
    document.querySelectorAll('.tab-highlight').forEach(el => {
        el.classList.remove('tab-highlight');
    });

    // Add highlight class
    element.classList.add('tab-highlight');

    // Remove highlight after animation
    setTimeout(() => {
        element.classList.remove('tab-highlight');
    }, 1000);
}

/**
 * Initialize auto-scroll on page load
 */
function initAutoScroll() {
    // Wait for DOM to be fully loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupAutoScroll);
    } else {
        setupAutoScroll();
    }
}

/**
 * Setup auto-scroll functionality
 */
function setupAutoScroll() {
    // Scroll to active tab on page load
    setTimeout(() => {
        const activeTab = document.querySelector(
            '.category-tab.active, .subcategory-tab.active'
        );
        if (activeTab) {
            const categoryCode = activeTab.dataset.category;
            autoScrollToTab(categoryCode);
        }
    }, 500);

    // Handle window resize
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const activeTab = document.querySelector(
                '.category-tab.active, .subcategory-tab.active'
            );
            if (activeTab) {
                const categoryCode = activeTab.dataset.category;
                autoScrollToTab(categoryCode);
            }
        }, 250);
    });

    // Listen for tab changes (if you trigger custom events)
    document.addEventListener('tabChanged', (e) => {
        if (e.detail && e.detail.categoryCode) {
            autoScrollToTab(e.detail.categoryCode);
        }
    });

    // Listen for category tabs being populated
    document.addEventListener('categoryTabsPopulated', () => {
        setTimeout(() => {
            const activeTab = document.querySelector(
                '.category-tab.active, .subcategory-tab.active'
            );
            if (activeTab) {
                const categoryCode = activeTab.dataset.category;
                autoScrollToTab(categoryCode);
            }
        }, 200);
    });
}




function scrollToTab(categoryCode) {
    autoScrollToTab(categoryCode, 50);
}
function ensureSubcategoryVisibility(categoryCode) {
    if (!categoryCode) return;

    // Find the subcategory tab if it exists
    const subcategoryTab = document.querySelector(
        `.subcategory-tab[data-category="${categoryCode}"]`
    );

    if (subcategoryTab) {
        // Get parent category tab
        const parentContainer = subcategoryTab.closest('.subcategory-container');
        const parentTab = parentContainer?.previousElementSibling;

        // Ensure parent is expanded
        if (parentContainer && !parentContainer.classList.contains('show')) {
            parentContainer.classList.add('show');
        }

        // Mark subcategory as active
        document.querySelectorAll('.subcategory-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        subcategoryTab.classList.add('active');

        // Scroll to subcategory
        setTimeout(() => {
            autoScrollToTab(categoryCode, 100);
        }, 150);
    }
}

function updateActiveTabStates(categoryCode) {
    if (!categoryCode) return;

    // Remove all active states
    document.querySelectorAll('.category-tab, .subcategory-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Find and activate the matching tab
    const matchingTab = document.querySelector(
        `.category-tab[data-category="${categoryCode}"], ` +
        `.subcategory-tab[data-category="${categoryCode}"]`
    );

    if (matchingTab) {
        matchingTab.classList.add('active');

        // If it's a subcategory, also activate parent
        if (matchingTab.classList.contains('subcategory-tab')) {
            const parentContainer = matchingTab.closest('.subcategory-container');
            const parentTab = parentContainer?.previousElementSibling;

            if (parentTab && parentTab.classList.contains('category-tab')) {
                parentTab.classList.add('active');
            }

            // Ensure subcategory container is visible
            if (parentContainer) {
                parentContainer.classList.add('show');
            }
        }
    }
}

function navigateToCategory(categoryCode) {
    if (!categoryCode) return;

    // Update active states
    updateActiveTabStates(categoryCode);

    // Scroll to tab
    setTimeout(() => {
        autoScrollToTab(categoryCode, 100);
    }, 50);
}

// Initialize on script load
initAutoScroll();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        autoScrollToTab,
        scrollToTab,
        ensureSubcategoryVisibility,
        updateActiveTabStates,
        navigateToCategory
    };
}



// ============================================
// MAIN FUNCTION - Detects and routes to correct modal
// ============================================

export function showAddOnModal(baseItem, onConfirm, addonData, remarksData = [], prefilledAddons = [], prefilledRemarks = [], editingOrderItemSNo = null) {
    // Choose which modal to display based on config
    if (ADDON_MODAL_CONFIG.style === 'wizard') {
        showWizardModal(baseItem, onConfirm, addonData, remarksData, prefilledAddons, prefilledRemarks, editingOrderItemSNo);
    } else {
        showTraditionalModal(baseItem, onConfirm, addonData, remarksData, prefilledAddons, prefilledRemarks, editingOrderItemSNo);
        scrollModalToTop();
    }
}

// ============================================
// WIZARD MODAL (Step-by-Step)
// ============================================

export function showWizardModal(
    baseItem,
    onConfirm,
    addonData,
    remarksData,
    prefilledAddons,
    prefilledRemarks,
    editingOrderItemSNo
) {
    const modal = document.getElementById('addonModal');
    const modalContent = document.getElementById('addonModalContent');

    modal.classList.remove('close');
    modal.classList.add('show');

    const bottomNav = document.querySelector('.bottom-nav');
    bottomNav.classList.remove('hidden');
    bottomNav.classList.add('show');

    window.currentBaseItemId = baseItem.item_no;
    window.editingOrderItemSNo = editingOrderItemSNo;

    const itemmasterGroups = Array.isArray(baseItem.itemmaster_menutype_grpdtls)
        ? baseItem.itemmaster_menutype_grpdtls
        : [];

    const itemmasterItems = Array.isArray(baseItem.itemmaster_menutypedtls)
        ? baseItem.itemmaster_menutypedtls
        : [];

    window.itemmasterGroups = itemmasterGroups;
    window.itemmasterItems = itemmasterItems;

    console.log('🎯 Wizard Modal Starting:', {
        item: baseItem.item_name,
        groups: itemmasterGroups.length,
        items: itemmasterItems.length,
        isEditing: !!editingOrderItemSNo,
        prefilledAddons: prefilledAddons?.length || 0,
        prefilledRemarks: prefilledRemarks?.length || 0
    });

    // ✅ SAFETY: prevent undefined
    const wizardSteps = buildWizardSteps(
        baseItem,
        itemmasterGroups,
        itemmasterItems,
        addonData
    ) || [];

    if (wizardSteps.length === 0) {
        console.error('❌ No wizard steps created! Falling back to traditional modal.');
        showTraditionalModal(
            baseItem,
            onConfirm,
            addonData,
            remarksData,
            prefilledAddons,
            prefilledRemarks,
            editingOrderItemSNo
        );
        return;
    }

    window.wizardSteps = wizardSteps;
    window.currentBaseItem = baseItem;
    window.wizardOnConfirm = onConfirm;

    if (editingOrderItemSNo && prefilledAddons?.length > 0) {
        window.wizardSelections = prefillWizardSelections(
            wizardSteps,
            prefilledAddons,
            itemmasterItems
        );

        window.selectedAddons = [...prefilledAddons];

        if (prefilledRemarks?.length > 0) {
            prefillRemarksIntoSelections(
                wizardSteps,
                prefilledRemarks,
                window.wizardSelections
            );
        }

        window.currentWizardStep = wizardSteps.length - 1;
    } else {
        window.selectedAddons = [];
        window.currentWizardStep = 0;
        window.wizardSelections = {};
    }

    renderWizardUI(
        modalContent,
        baseItem,
        wizardSteps,
        onConfirm,
        editingOrderItemSNo
    );

    setTimeout(() => {
        modal.scrollTop = 0;
        modalContent.scrollTop = 0;
    }, 0);
}


function prefillRemarksIntoSelections(wizardSteps, prefilledRemarks, wizardSelections) {
    console.log('📝 Prefilling remarks into wizard selections:', prefilledRemarks);

    prefilledRemarks.forEach(remark => {
        const remarkText = remark.remarks || remark.remarks_item_name || remark.item_name;
        const remarkGroup = remark.remarks_group || remark.modifier_name;

        console.log(`  Looking for remark: "${remarkText}" in group: "${remarkGroup}"`);

        // Find matching step
        const matchingStep = wizardSteps.find(step =>
            step.id === remarkGroup ||
            step.title === remarkGroup
        );

        if (matchingStep) {
            // Find matching option
            const matchingOption = matchingStep.options.find(opt =>
                opt.name === remarkText ||
                opt.id === remark.citem_no ||
                opt.id === remark.item_no
            );

            if (matchingOption) {
                if (matchingStep.type === 'single') {
                    wizardSelections[matchingStep.id] = matchingOption.id;
                    console.log(`  ✅ Added single selection: ${matchingOption.name}`);
                } else if (matchingStep.type === 'multiple') {
                    if (!wizardSelections[matchingStep.id]) {
                        wizardSelections[matchingStep.id] = {};
                    }
                    wizardSelections[matchingStep.id][matchingOption.id] = 1;
                    console.log(`  ✅ Added multiple selection: ${matchingOption.name}`);
                }
            }
        }
    });
}

function prefillWizardSelections(wizardSteps, prefilledAddons, itemmasterItems) {
    const selections = {};

    console.log('🔍 Prefilling wizard selections:', {
        steps: wizardSteps.length,
        addons: prefilledAddons.length,
        sampleAddons: prefilledAddons.slice(0, 3).map(a => ({
            name: a.item_name,
            id: a.item_no || a.citem_no
        }))
    });

    // Detect and set temperature FIRST
    const detectedTemp = detectTemperatureFromCartItem(prefilledAddons, itemmasterItems);
    if (detectedTemp) {
        selections.temperature = detectedTemp;
        console.log('🌡️ ✅ SET TEMPERATURE SELECTION:', detectedTemp);
    }

    wizardSteps.forEach((step, stepIndex) => {
        console.log(`\n📋 Processing step ${stepIndex + 1}: ${step.title} (type: ${step.type})`);

        if (step.id === 'temperature') {
            console.log(`  ✅ Temperature already set: ${selections.temperature || 'none'}`);
        } else {
            // Match addons to step options
            const matchedAddons = prefilledAddons.filter(addon => {
                const matchesStepId =
                    addon.category_code === step.id ||
                    addon.modifier_name === step.id ||
                    addon.remarks_group === step.id;

                const matchesOption = step.options.some(opt =>
                    opt.id === addon.item_no ||
                    opt.id === addon.citem_no ||
                    opt.name === addon.item_name ||
                    opt.name === addon.citem_name
                );

                return matchesStepId || matchesOption;
            });

            if (matchedAddons.length > 0) {
                console.log(`  Found ${matchedAddons.length} matching addons`);

                if (step.type === 'single') {
                    // ✅ Single selection - save just the ID (string)
                    const firstMatch = matchedAddons[0];
                    const matchingOption = step.options.find(opt =>
                        opt.id === firstMatch.item_no ||
                        opt.id === firstMatch.citem_no ||
                        opt.name === firstMatch.item_name ||
                        opt.name === firstMatch.citem_name
                    );

                    if (matchingOption) {
                        selections[step.id] = matchingOption.id;
                        console.log(`  ✅ Single selection: ${matchingOption.name} (ID: ${matchingOption.id})`);
                    }
                } else if (step.type === 'quantity') {
                    // ✅ Quantity selections - save as object with quantities
                    const quantities = {};

                    matchedAddons.forEach(addon => {
                        const matchingOption = step.options.find(opt =>
                            opt.id === addon.item_no ||
                            opt.id === addon.citem_no ||
                            opt.name === addon.item_name ||
                            opt.name === addon.citem_name
                        );

                        if (matchingOption) {
                            quantities[matchingOption.id] = addon.qty || 1;
                            console.log(`  ✅ Quantity: ${matchingOption.name} x${addon.qty || 1}`);
                        }
                    });

                    if (Object.keys(quantities).length > 0) {
                        selections[step.id] = quantities;
                    }
                }
            }
        }
    });

    console.log('\n✅ Final wizard selections:', selections);
    return selections;
}

function getCategoryImageFromCache(categoryCode) {
    if (!categoryCode) return '';

    try {
        // Try sessionStorage first
        const cached = sessionStorage.getItem('MenuItems');
        if (cached) {
            const menuSections = JSON.parse(cached);
            if (Array.isArray(menuSections)) {
                // Find the category section
                const category = menuSections.find(section =>
                    section.category_code === categoryCode ||
                    section.category_name === categoryCode
                );

                if (category) {
                    // Try to get image from category itself
                    if (category.tqr_image_url || category.category_image) {
                        const imageUrl = category.tqr_image_url || category.category_image;
                        console.log(`  📁 Found category image: ${imageUrl}`);
                        return imageUrl;
                    }

                    // Fallback: get image from first item in category
                    if (category.items && category.items.length > 0) {
                        const firstItemWithImage = category.items.find(item =>
                            item.tqr_image_url || item.item_image
                        );
                        if (firstItemWithImage) {
                            const imageUrl = firstItemWithImage.tqr_image_url || firstItemWithImage.item_image;
                            console.log(`  📁 Using first item image from category: ${imageUrl}`);
                            return imageUrl;
                        }
                    }
                }
            }
        }

        // Try useCache store
        if (typeof useCache !== 'undefined') {
            const cacheState = useCache.getState();
            if (cacheState?.menuItems && Array.isArray(cacheState.menuItems)) {
                const category = cacheState.menuItems.find(section =>
                    section.category_code === categoryCode ||
                    section.category_name === categoryCode
                );

                if (category?.items && category.items.length > 0) {
                    const firstItemWithImage = category.items.find(item =>
                        item.tqr_image_url || item.item_image
                    );
                    if (firstItemWithImage) {
                        const imageUrl = firstItemWithImage.tqr_image_url || firstItemWithImage.item_image;
                        console.log(`  📁 Using first item image from category (cache): ${imageUrl}`);
                        return imageUrl;
                    }
                }
            }
        }
    } catch (error) {
        console.warn('⚠️ Error getting category image:', error);
    }

    return '';
}

function getImageFromMenuCache(itemNo, itemName, categoryCode) {
    console.log(`🔍 getImageFromMenuCache called:`, { itemNo, itemName, categoryCode });

    // ✅ PRIORITY 1: Check window.itemImageMap (fastest)
    if (window.itemImageMap?.has(itemNo)) {
        const url = window.itemImageMap.get(itemNo);
        console.log(`  ✅ Found in itemImageMap: ${url}`);
        return { tqr_image_url: url, item_image: url };
    }

    // ✅ PRIORITY 2: Check window.menuGridItems
    if (window.menuGridItems?.length > 0) {
        const found = window.menuGridItems.find(item =>
            item.item_no === itemNo || item.citem_no === itemNo
        );

        if (found && (found.tqr_image_url || found.item_image)) {
            console.log(`  ✅ Found in menuGridItems:`, found.tqr_image_url || found.item_image);
            return {
                tqr_image_url: found.tqr_image_url || '',
                item_image: found.item_image || ''
            };
        }
    }

    let MenuItems = [];
    let FullItems = [];

    try {
        // ✅ PRIORITY 3: SessionStorage FullItems
        const cachedFull = sessionStorage.getItem('FullItems');
        if (cachedFull) {
            const parsed = JSON.parse(cachedFull);
            if (Array.isArray(parsed)) FullItems = parsed;
            console.log(`  📦 Loaded ${FullItems.length} items from FullItems`);
        }

        // ✅ PRIORITY 4: SessionStorage MenuItems
        const cachedMenu = sessionStorage.getItem('MenuItems');
        if (cachedMenu) {
            const parsed = JSON.parse(cachedMenu);
            if (Array.isArray(parsed)) {
                if (parsed[0]?.items) {
                    MenuItems = parsed.flatMap(section => section.items || []);
                } else {
                    MenuItems = parsed;
                }
            }
            console.log(`  📦 Loaded ${MenuItems.length} items from MenuItems`);
        }

        // ✅ PRIORITY 5: useCache
        if (MenuItems.length === 0 && typeof useCache !== 'undefined') {
            const cacheState = useCache.getState();
            if (cacheState?.menuItems && Array.isArray(cacheState.menuItems)) {
                if (cacheState.menuItems[0]?.items) {
                    MenuItems = cacheState.menuItems.flatMap(section => section.items || []);
                } else {
                    MenuItems = cacheState.menuItems;
                }
            }
            if (cacheState?.items && Array.isArray(cacheState.items)) {
                FullItems = cacheState.items;
            }
        }

        // ✅ PRIORITY 6: window.menuItems fallback
        if (MenuItems.length === 0 && window.menuItems) {
            if (Array.isArray(window.menuItems)) {
                if (window.menuItems[0]?.items) {
                    MenuItems = window.menuItems.flatMap(section => section.items || []);
                } else {
                    MenuItems = window.menuItems;
                }
            }
        }
    } catch (err) {
        console.warn('⚠️ Error accessing menu cache:', err);
    }

    const allItems = [...FullItems, ...MenuItems];
    console.log(`  📊 Total items to search: ${allItems.length}`);

    if (allItems.length === 0) {
        console.warn(`  ⚠️ No items found in any cache`);
        return { tqr_image_url: '', item_image: '' };
    }

    // Search by itemNo
    let foundItem = allItems.find(mi => mi.item_no === itemNo || mi.citem_no === itemNo);

    if (foundItem) {
        console.log(`  ✅ Found by item_no:`, foundItem.item_name, foundItem.tqr_image_url);
        return {
            tqr_image_url: foundItem.tqr_image_url || '',
            item_image: foundItem.item_image || ''
        };
    }

    // Fallback: search by name
    if (itemName) {
        const searchName = itemName.toLowerCase().trim();
        foundItem = allItems.find(mi => {
            const itemNameLower = (mi.item_name || '').toLowerCase().trim();
            const citemNameLower = (mi.citem_name || '').toLowerCase().trim();
            return itemNameLower === searchName ||
                citemNameLower === searchName ||
                itemNameLower.includes(searchName) ||
                searchName.includes(itemNameLower) ||
                citemNameLower.includes(searchName) ||
                searchName.includes(citemNameLower);
        });

        if (foundItem) {
            console.log(`  ✅ Found by name match:`, foundItem.item_name, foundItem.tqr_image_url);
            return {
                tqr_image_url: foundItem.tqr_image_url || '',
                item_image: foundItem.item_image || ''
            };
        }
    }

    console.warn(`  ❌ No image found for ${itemNo} (${itemName})`);
    return { tqr_image_url: '', item_image: '' };
}
function getMenuItemsFromCache() {
    try {
        const cached = sessionStorage.getItem('MenuItems');
        if (!cached) return [];

        const parsed = JSON.parse(cached);
        if (!Array.isArray(parsed)) return [];

        return parsed.flatMap(section =>
            (section.items || []).map(item => ({
                ...item,
                __category_code: section.category_code || section.root_category_code,
                __category_name: section.category_name || section.root_category_code
            }))
        );
    } catch (e) {
        console.warn('⚠️ Failed to read MenuItems cache:', e);
        return [];
    }
}
function resolveBaseDrinkImage(baseItem) {
    if (!baseItem) return '';

    const menuItems = getMenuItemsFromCache();
    if (!menuItems.length) return '';

    // 1️⃣ Exact item_no
    let found = menuItems.find(i =>
        i.item_no === baseItem.item_no &&
        i.tqr_image_url &&
        i.item_type === 'C'
    );
    if (found) return found.tqr_image_url;

    // 2️⃣ SKU-based (handles size variants)
    const skuMatch = baseItem.item_name?.match(/(LHO\d+)/);
    if (skuMatch) {
        found = menuItems.find(i =>
            i.sku_no === skuMatch[1] &&
            i.tqr_image_url &&
            i.item_type === 'C'
        );
        if (found) return found.tqr_image_url;
    }

    // 3️⃣ Category fallback
    return getCategoryImageFromCache(baseItem.category_code);
}

function buildWizardSteps(baseItem, itemmasterGroups, itemmasterItems, addonData) {
    const steps = [];

    itemmasterGroups = Array.isArray(itemmasterGroups) ? itemmasterGroups : [];
    itemmasterItems = Array.isArray(itemmasterItems) ? itemmasterItems : [];

    // Step 1: Temperature
    const temperatureGroups = groupItemsByTemperature(itemmasterItems) || { hot: [], iced: [] };
    const needsTemperature = temperatureGroups.hot.length > 0 && temperatureGroups.iced.length > 0;

    if (needsTemperature) {
        steps.push({
            id: 'temperature',
            title: 'Select Temperature',
            required: true,
            type: 'single',
            options: [
                { id: 'hot', name: 'HOT', icon: '🔥', temp: 'hot' },
                { id: 'iced', name: 'ICED', icon: '🧊', temp: 'iced' }
            ]
        });
    }

    // Step 2: Modifier groups
    const sortedGroups = itemmasterGroups.slice().sort((a, b) =>
        (a.item_menutype_grpdtls || 9999) - (b.item_menutype_grpdtls || 9999)
    );

    sortedGroups.forEach(group => {
        let groupItems = (typeof getAvailableModifierItems === 'function')
            ? getAvailableModifierItems(baseItem, group) || []
            : itemmasterItems.filter(item =>
                parseInt(item.level_no || 0) === parseInt(group.item_menutype_grpdtls || 0)
            );

        if (!groupItems.length) return;

        const maxQty = parseInt(group.max_qty) || 1;
        const stepType = maxQty === 1 ? 'single' : 'quantity';

        steps.push({
            id: group.modifier_name,
            title: group.modifier_name,
            required: group.is_optional !== 'Y',
            type: stepType,
            maxQty,
            temperatureDependent: needsTemperature,
            options: groupItems.map(item => {
                const itemNo = item.citem_no || item.item_no;
                const itemName = item.citem_name || item.item_name;
                const cachedImages = getImageFromMenuCache(itemNo, itemName, group.modifier_name);

                let itemTemp = getItemTemperature(item);
                if (!itemTemp && group.modifier_name === 'ICE') itemTemp = 'iced';

                // Fallback for size variants
                let finalTqrImageUrl = cachedImages.tqr_image_url || item.tqr_image_url || '';
                if (!finalTqrImageUrl && /^[LMS]-/.test(itemName)) finalTqrImageUrl = resolveBaseDrinkImage(baseItem);

                const finalItemImage = cachedImages.item_image || item.item_image || '';

                return {
                    id: itemNo,
                    name: itemName,
                    price: getPriceByServiceType(item.price_dtls?.[0]),
                    temp: itemTemp,
                    tqr_image_url: finalTqrImageUrl,
                    item_image: finalItemImage,
                    soldOut: item.isSoldOut || false
                };
            })
        });
    });

    // Step 3: Addon categories
    if (addonData?.cat_dtls && addonData?.item_dtls) {
        addonData.cat_dtls
            .filter(cat => cat.max_qty >= 0)
            .sort((a, b) => a.seq_no - b.seq_no)
            .forEach(cat => {
                const items = addonData.item_dtls.filter(i => i.category_code === cat.category_code);
                if (!items.length) return;

                const maxQty = parseInt(cat.max_qty);
                const stepType = maxQty === 1 ? 'single' : 'quantity';

                steps.push({
                    id: cat.category_code,
                    title: cat.category_name,
                    required: cat.is_optional !== 'Y',
                    type: stepType,
                    maxSelection: maxQty,
                    temperatureDependent: needsTemperature,
                    options: items.map(item => {
                        const itemNo = item.citem_no || item.item_no;
                        const itemName = item.citem_name || item.item_name;
                        const cachedImages = getImageFromMenuCache(itemNo, itemName, cat.category_code);

                        return {
                            id: itemNo,
                            name: itemName,
                            price: getPriceByServiceType(item.price_dtls?.[0]),
                            temp: getItemTemperature(item),
                            tqr_image_url: cachedImages.tqr_image_url || item.tqr_image_url || RESTAURANT_CONFIG.logo,
                            item_image: cachedImages.item_image || item.item_image || RESTAURANT_CONFIG.logo,
                            soldOut: item.isSoldOut || false
                        };
                    })
                });
            });
    }

    return steps;
}




window.getImageFromMenuCache = getImageFromMenuCache;

window.debugImageLookup = function (itemNo, itemName) {
    console.group('🖼️ Image Lookup Debug');
    console.log('Searching for:', { itemNo, itemName });

    const result = getImageFromMenuCache(itemNo, itemName);
    console.log('Result:', result);

    // Show cache stats from all sources
    let menuItems = [];

    // Check useCache
    if (typeof useCache !== 'undefined') {
        const cacheState = useCache.getState();
        if (cacheState?.menuItems) {
            if (Array.isArray(cacheState.menuItems)) {
                if (cacheState.menuItems[0]?.items) {
                    menuItems = cacheState.menuItems.flatMap(section => section.items || []);
                } else {
                    menuItems = cacheState.menuItems;
                }
            }
        }
        console.log('useCache size:', menuItems.length, 'items');
    }

    // Check window.menuItems
    if (window.menuItems) {
        let windowItems = [];
        if (Array.isArray(window.menuItems)) {
            if (window.menuItems[0]?.items) {
                windowItems = window.menuItems.flatMap(section => section.items || []);
            } else {
                windowItems = window.menuItems;
            }
        }
        console.log('window.menuItems size:', windowItems.length, 'items');
    }

    // Check sessionStorage
    const cached = sessionStorage.getItem('MenuItems');
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            let storageItems = [];
            if (Array.isArray(parsed)) {
                if (parsed[0]?.items) {
                    storageItems = parsed.flatMap(section => section.items || []);
                } else {
                    storageItems = parsed;
                }
            }
            console.log('sessionStorage size:', storageItems.length, 'items');
        } catch (e) {
            console.warn('sessionStorage parse error:', e);
        }
    }

    // Show sample items (first 3 with images)
    const itemsWithImages = menuItems
        .filter(item => item.tqr_image_url || item.item_image)
        .slice(0, 3);

    console.log('Sample items with images:', itemsWithImages.map(item => ({
        item_no: item.item_no,
        citem_no: item.citem_no,
        name: item.item_name || item.citem_name,
        tqr_image_url: item.tqr_image_url,
        item_image: item.item_image
    })));

    console.groupEnd();
};

function resolveDrinkImage({ itemNo, itemName, categoryCode }) {
    const menuItems = getMenuItemsFromCache();
    if (!menuItems.length) return '';

    // 1️⃣ Exact item_no
    let found = menuItems.find(i =>
        i.item_no === itemNo &&
        i.tqr_image_url &&
        i.item_type === 'C'
    );
    if (found) return found.tqr_image_url;

    // 2️⃣ Parent by SKU (MOST IMPORTANT)
    const skuMatch = itemName?.match(/(LHO\d+)/);
    if (skuMatch) {
        const sku = skuMatch[1];
        found = menuItems.find(i =>
            i.sku_no === sku &&
            i.tqr_image_url &&
            i.item_type === 'C'
        );
        if (found) return found.tqr_image_url;
    }

    // 3️⃣ Exact drink name (NO fuzzy)
    if (itemName) {
        const cleanName = itemName
            .replace(/^[LMS]-/, '')
            .toLowerCase()
            .trim();

        found = menuItems.find(i =>
            i.item_name?.toLowerCase().trim() === cleanName &&
            i.tqr_image_url &&
            i.item_type === 'C'
        );
        if (found) return found.tqr_image_url;
    }

    // 4️⃣ Category fallback
    return getCategoryImageFromCache(categoryCode);
}


function getItemTemperatureWithGroupContext(item, groupName) {
    // First try the existing function
    let temp = getItemTemperature(item);

    if (temp) {
        return temp;
    }

    // If no temp found, infer from group name
    const groupLower = (groupName || '').toLowerCase();

    if (groupLower.includes('ice') || groupLower.includes('iced')) {
        console.log(`  🔧 Inferring 'iced' from group name: ${groupName}`);
        return 'iced';
    }

    if (groupLower.includes('hot')) {
        console.log(`  🔧 Inferring 'hot' from group name: ${groupName}`);
        return 'hot';
    }

    return null; // Truly neutral
}

function getFilteredStepOptions(step, selectedTemperature) {
    // If no temperature dependency or no temperature selected yet, return all options
    if (!step.temperatureDependent || !selectedTemperature) {
        return step.options;
    }

    // Filter options based on temperature
    return step.options.filter(option => {
        // Keep neutral options (no temperature specified)
        if (!option.temp) {
            return true;
        }
        // Keep options that match the selected temperature
        return option.temp === selectedTemperature;
    });
}


function shouldShowStep(step, selectedTemperature) {
    // Always show temperature selection step
    if (step.id === 'temperature') {
        return true;
    }

    // ✅ NEW: Explicitly hide ICE step when HOT is selected
    if (step.id === 'ICE' && selectedTemperature === 'hot') {
        console.log('  ❌ Hiding ICE step because HOT is selected');
        return false;
    }

    // If not temperature dependent, always show
    if (!step.temperatureDependent || !selectedTemperature) {
        return true;
    }

    // Check if this step has any options available for the selected temperature
    const filteredOptions = getFilteredStepOptions(step, selectedTemperature);
    const shouldShow = filteredOptions.length > 0;

    if (!shouldShow) {
        console.log(`  ❌ Hiding step "${step.title}" - no options for ${selectedTemperature}`);
    }

    return shouldShow;
}

function getVisibleSteps() {
    if (!window.wizardSteps) return [];

    const selectedTemp = window.wizardSelections?.temperature;

    // If no temperature selected yet, show all steps
    if (!selectedTemp) {
        return window.wizardSteps;
    }

    // Filter out steps that have no options for the selected temperature
    return window.wizardSteps.filter(step => {
        return shouldShowStep(step, selectedTemp);
    });
}

window.isRestoringWizardState = false;

function renderWizardUI(container, baseItem, steps, onConfirm, editingOrderItemSNo) {
    const visibleSteps = getVisibleSteps();

    if (window.currentWizardStep >= visibleSteps.length) {
        window.currentWizardStep = visibleSteps.length - 1;
    }

    const currentStep = visibleSteps[window.currentWizardStep];
    const isLastStep = window.currentWizardStep === visibleSteps.length - 1;
    const isEditMode = !!editingOrderItemSNo;

    container.innerHTML = `
        <div class="wizard-container">
            <div class="wizard-header">
                <h2 class="wizard-title">${isEditMode ? '✏️ Edit Your Order' : 'Customize Your Order'}</h2>
                <p class="wizard-subtitle">${baseItem.item_name}</p>
            </div>
            
            ${ADDON_MODAL_CONFIG.wizard.showProgressBar ? `
            <div class="wizard-progress">
                <div class="progress-steps">
                    ${visibleSteps.map((step, index) => `
                        <div class="progress-step ${index < window.currentWizardStep ? 'completed' : ''} ${index === window.currentWizardStep ? 'active' : ''}">
                            ${index < window.currentWizardStep ? '✓' : index + 1}
                        </div>
                        ${index < visibleSteps.length - 1 ? '<div class="progress-line"></div>' : ''}
                    `).join('')}
                </div>
                <div class="progress-text">Step ${window.currentWizardStep + 1} of ${visibleSteps.length}</div>
            </div>` : ''}
            
            <div class="wizard-content">
                <h3 class="step-title">${currentStep.title}${currentStep.required ? ' *' : ''}</h3>
                ${currentStep.subtitle ? `<p class="step-subtitle">${currentStep.subtitle}</p>` : ''}
                
                <div class="step-options">
                    ${renderStepOptions(currentStep)}
                </div>
            </div>
            
            <div class="wizard-navigation">
                ${window.currentWizardStep > 0 ? `
                    <button class="wizard-btn wizard-back">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                        Back
                    </button>
                ` : '<div></div>'}
                
                <button class="wizard-btn wizard-next ${canProceedToNext(currentStep) ? '' : 'disabled'}" ${!canProceedToNext(currentStep) ? 'disabled' : ''}>
                    ${isLastStep ? (isEditMode ? 'Update Cart' : 'Add to Cart') : 'Next'}
                    ${!isLastStep ? `
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    ` : ''}
                </button>
            </div>
        </div>
    `;

    // ✅ CRITICAL: Restore selections BEFORE binding events
    console.log('🔄 Step 1: Restoring selections (before binding events)...');
    restoreStepSelections(currentStep);

    // ✅ CRITICAL: Bind events AFTER restoration
    console.log('🔗 Step 2: Binding event handlers...');
    bindWizardEvents(container, steps, baseItem, onConfirm, editingOrderItemSNo);

    // Scroll to top
    setTimeout(() => {
        const modal = document.getElementById('addonModal');
        if (modal) modal.scrollTop = 0;
        if (container) container.scrollTop = 0;
    }, 0);
}


function updateCardStyling(stepId, selectedValue, type) {
    if (type === 'single') {
        // Clear all cards
        document.querySelectorAll('.option-card').forEach(card => {
            card.classList.remove('selected');
            card.style.borderColor = '';
            card.style.backgroundColor = '';
        });

        // Highlight selected card
        const selectedCard = document.querySelector(
            `input[name="step_${stepId}"][value="${selectedValue}"]`
        )?.closest('.option-card');

        if (selectedCard) {
            selectedCard.classList.add('selected');
            selectedCard.style.borderColor = '#10b981';
            selectedCard.style.backgroundColor = '#f0fdf4';
        }
    }
}


// ============================================
// RESTORE SELECTIONS
// ============================================
function restoreStepSelections(step) {
    const saved = window.wizardSelections?.[step.id];

    if (!saved) {
        console.log(`ℹ️ No saved selections for step: ${step.title}`);
        return;
    }

    console.log(`🔄 Restoring selections for step: ${step.title}`, saved);

    window.isRestoringWizardState = true;

    try {
        if (step.type === 'single') {
            const radioInput = document.querySelector(
                `input[name="step_${step.id}"][value="${saved}"]`
            );

            if (radioInput) {
                radioInput.checked = true;

                // Update card styling
                updateCardStyling(step.id, saved, 'single');

                console.log(`  ✅ Checked radio: ${saved}`);
            } else {
                console.warn(`  ⚠️ Could not find radio for: ${saved}`);
            }
        }
        else if (step.type === 'quantity') {
            if (typeof saved === 'object') {
                Object.entries(saved).forEach(([optionId, qty]) => {
                    const optionRow = document.querySelector(`[data-option-id="${optionId}"]`);

                    if (optionRow) {
                        const qtyDisplay = optionRow.querySelector('.qty-display');
                        if (qtyDisplay) {
                            qtyDisplay.textContent = qty;

                            if (qty > 0) {
                                optionRow.style.borderColor = '#10b981';
                                optionRow.style.backgroundColor = '#f0fdf4';
                            } else {
                                optionRow.style.borderColor = '';
                                optionRow.style.backgroundColor = '';
                            }

                            console.log(`  ✅ Set quantity for ${optionId}: ${qty}`);
                        }
                    }
                });
            }
        }
        else if (step.type === 'multiple') {
            if (Array.isArray(saved)) {
                // Clear all first
                document.querySelectorAll(`input[name="step_${step.id}"]`).forEach(cb => {
                    cb.checked = false;
                    const card = cb.closest('.option-card');
                    if (card) {
                        card.classList.remove('selected');
                        card.style.borderColor = '';
                        card.style.backgroundColor = '';
                    }
                });

                // Restore saved selections
                saved.forEach(optionId => {
                    const checkbox = document.querySelector(
                        `input[name="step_${step.id}"][value="${optionId}"]`
                    );

                    if (checkbox) {
                        checkbox.checked = true;

                        const card = checkbox.closest('.option-card');
                        if (card) {
                            card.classList.add('selected');
                            card.style.borderColor = '#10b981';
                            card.style.backgroundColor = '#f0fdf4';
                        }

                        console.log(`  ✅ Checked checkbox: ${optionId}`);
                    }
                });
            }
        }

        const container = document.getElementById('addonModalContent');
        if (container) {
            updateNextButtonState(container, step);
        }
    } finally {
        setTimeout(() => {
            window.isRestoringWizardState = false;
            console.log('✅ Restoration complete, event handlers re-enabled');
        }, 50);
    }
}

window.debugWizardState = function () {
    console.group('🔍 Wizard State Debug');
    console.log('Current Step:', window.currentWizardStep);
    console.log('Total Steps:', window.wizardSteps?.length);
    console.log('Wizard Selections:', window.wizardSelections);
    console.log('Selected Addons:', window.selectedAddons);
    console.log('Editing S_NO:', window.editingOrderItemSNo);

    if (window.wizardSteps) {
        console.log('\nSteps:');
        window.wizardSteps.forEach((step, i) => {
            console.log(`  ${i + 1}. ${step.title} (${step.type})`, {
                id: step.id,
                options: step.options.length,
                required: step.required,
                selection: window.wizardSelections?.[step.id]
            });
        });
    }

    console.groupEnd();
};

window.debugWizardTemperature = function () {
    console.group('🌡️ Temperature Debug');
    console.log('Current temperature selection:', window.wizardSelections?.temperature);
    console.log('All wizard selections:', window.wizardSelections);
    console.log('Prefilled addons:', window.selectedAddons);

    if (window.wizardSteps) {
        const tempStep = window.wizardSteps.find(s => s.id === 'temperature');
        console.log('Temperature step exists:', !!tempStep);

        window.wizardSteps.forEach((step, i) => {
            console.log(`Step ${i + 1}: ${step.title}`, {
                id: step.id,
                type: step.type,
                options: step.options.length,
                hasTemp: step.options.some(opt => opt.temp),
                tempValues: [...new Set(step.options.map(opt => opt.temp).filter(Boolean))]
            });
        });
    }

    console.groupEnd();
};

window.debugTemperatureFiltering = function () {
    console.group('🌡️ Temperature Filtering Debug');
    console.log('Current temperature:', window.wizardSelections?.temperature);
    console.log('Current step:', window.currentWizardStep);

    if (window.wizardSteps && window.wizardSteps[window.currentWizardStep]) {
        const step = window.wizardSteps[window.currentWizardStep];
        console.log('Current step details:', {
            title: step.title,
            id: step.id,
            totalOptions: step.options.length,
            optionsWithTemp: step.options.filter(o => o.temp).length
        });

        console.log('Options by temperature:');
        const byTemp = {};
        step.options.forEach(opt => {
            const temp = opt.temp || 'none';
            if (!byTemp[temp]) byTemp[temp] = [];
            byTemp[temp].push(opt.name);
        });
        console.table(byTemp);
    }

    console.groupEnd();
};
function renderStepOptions(step) {
    const selectedTemp = window.wizardSelections?.temperature;

    console.log(`🎨 Rendering step "${step.title}":`, {
        stepId: step.id,
        selectedTemp,
        totalOptions: step.options.length
    });

    const filteredOptions = getFilteredStepOptions(step, selectedTemp);

    console.log(`  📊 Options: ${step.options.length} → ${filteredOptions.length} (after filtering)`);

    if (filteredOptions.length === 0) {
        return `
            <div class="text-center text-gray-500 py-8">
                <p>No options available</p>
                <p class="text-sm mt-2 text-red-500">Debug: Check step options in console</p>
            </div>
        `;
    }

    // ✅ NEW: Enhanced image processing with detailed logging
    // ✅ Enhanced image processing with detailed logging
    const optionsWithImages = filteredOptions.map((option, idx) => {
        let resolvedImage = null;

        // Log first 3 options for debugging
        if (idx < 3) {
            console.log(`  🖼️ Option ${idx + 1}: "${option.name}"`, {
                id: option.id,
                tqr_image_url: option.tqr_image_url || '(none)',
                item_image: option.item_image || '(none)'
            });
        }

        // ✅ CRITICAL: Try window.itemImageMap FIRST
        if (window.itemImageMap?.has(option.id)) {
            resolvedImage = window.itemImageMap.get(option.id);
            if (idx < 3) console.log(`    ✅ Found in itemImageMap: ${resolvedImage}`);
        }

        // ✅ Then try resolveImageUrl if available
        if (!resolvedImage && typeof resolveImageUrl === 'function' && (option.tqr_image_url || option.item_image)) {
            try {
                const mockItem = {
                    item_name: option.name,
                    tqr_image_url: option.tqr_image_url || '',
                    item_image: option.item_image || ''
                };

                if (idx < 3) {
                    console.log(`    🔧 Calling resolveImageUrl with:`, mockItem);
                }

                resolvedImage = resolveImageUrl(mockItem, null);

                if (idx < 3) {
                    console.log(`    ✅ Resolved via resolveImageUrl: ${resolvedImage}`);
                }
            } catch (error) {
                if (idx < 3) console.warn(`    ⚠️ resolveImageUrl failed:`, error);
            }
        }

        // ✅ Fallback if still no image
        if (!resolvedImage && (option.tqr_image_url || option.item_image)) {
            const imageSource = option.tqr_image_url || option.item_image || '';
            if (imageSource && imageSource.startsWith('public/upload/')) {
                resolvedImage = `/api/GetImageProxy?imageUrl=${encodeURIComponent(imageSource)}`;
                if (idx < 3) console.log(`    ✅ Fallback proxy: ${resolvedImage}`);
            } else if (imageSource) {
                resolvedImage = imageSource;
                if (idx < 3) console.log(`    ✅ Using direct URL: ${resolvedImage}`);
            }
        }

        // ✅ FINAL FALLBACK: Use restaurant logo if still no image
        if (!resolvedImage || resolvedImage.trim() === '') {
            resolvedImage = RESTAURANT_CONFIG?.logo || '/img/Harrys-Logo.jpg';
            if (idx < 3) console.log(`    ℹ️ Using logo fallback: ${resolvedImage}`);
        }

        return { ...option, image: resolvedImage };
    });
    const imagesResolved = optionsWithImages.filter(o => o.image).length;
    console.log(`  📸 Images resolved: ${imagesResolved}/${optionsWithImages.length}`);

    // Render based on step type
    if (step.type === 'single') {
        return `
            <div class="options-grid options-single">
                ${optionsWithImages.map(option => `
                    <label class="option-card ${option.soldOut ? 'opacity-50' : ''}" data-option-id="${option.id}">
                        <input type="radio" 
                               name="step_${step.id}" 
                               value="${option.id}" 
                               class="option-input"
                               ${option.soldOut ? 'disabled' : ''}>
                                ${option.icon ? `<div class="option-icon">${option.icon}</div>` : ''}
                                ${option.image ? `<img src="${option.image}" class="option-image" alt="${option.name}">` : ''}
                                <div class="option-name">${option.name}</div>
                                ${option.price > 0 ? `<div class="option-price">+$${option.price.toFixed(2)}</div>` : ''}
                                ${option.soldOut ? `<div class="text-xs text-red-500 mt-1">Sold Out</div>` : ''}
                    </label>
                `).join('')}
            </div>
        `;
    } else if (step.type === 'quantity') {
        return `
            <div class="options-list">
                ${optionsWithImages.map(option => `
                    <div class="option-row ${option.soldOut ? 'opacity-50' : ''}" data-option-id="${option.id}">
                        ${option.image ? `<img src="${option.image}" class="option-image-small" alt="${option.name}">` : ''}
                        <div class="option-info">
                            <div class="option-name">${option.name}</div>
                            ${option.price > 0 ? `<div class="option-price">+$${option.price.toFixed(2)}</div>` : ''}
                            ${option.soldOut ? `<div class="text-xs text-red-500">Sold Out</div>` : ''}
                        </div>
                        <div class="qty-controls">
                            <button class="qty-btn qty-minus" data-option-id="${option.id}" ${option.soldOut ? 'disabled' : ''}>−</button>
                            <span class="qty-display">0</span>
                            <button class="qty-btn qty-plus" data-option-id="${option.id}" ${option.soldOut ? 'disabled' : ''}>+</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } else if (step.type === 'multiple') {
        return `
            <div class="options-grid options-multiple">
                ${optionsWithImages.map(option => `
                    <label class="option-card ${option.soldOut ? 'opacity-50' : ''}" data-option-id="${option.id}">
                        <input type="checkbox" 
                               name="step_${step.id}" 
                               value="${option.id}" 
                               class="option-input"
                               ${option.soldOut ? 'disabled' : ''}>
                                ${option.image ? `<img src="${option.image}" class="option-image" alt="${option.name}">` : ''}
                                <div class="option-name">${option.name}</div>
                                ${option.price > 0 ? `<div class="option-price">+$${option.price.toFixed(2)}</div>` : ''}
                                ${option.soldOut ? `<div class="text-xs text-red-500 mt-1">Sold Out</div>` : ''}
                    </label>
                `).join('')}
            </div>
        `;
    }
}
function bindWizardEvents(container, steps, baseItem, onConfirm, editingOrderItemSNo) {
    const visibleSteps = getVisibleSteps();
    const currentStep = visibleSteps[window.currentWizardStep];

    console.log('🔧 Binding wizard events for step', window.currentWizardStep);

    // Back button
    const backBtn = container.querySelector('.wizard-back');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (window.currentWizardStep <= 0) {
                console.log('⬅️ Already at first step, cannot go back further');
                return;
            }
            console.log('⬅️ Going back from step', window.currentWizardStep);
            window.currentWizardStep--;
            renderWizardUI(container, baseItem, steps, onConfirm, editingOrderItemSNo);
            scrollModalToTop();
        });
    }

    // Next button
    const nextBtn = container.querySelector('.wizard-next');
    nextBtn.addEventListener('click', () => {
        const isLastStep = window.currentWizardStep === visibleSteps.length - 1;

        console.log('➡️ Next button clicked:', {
            currentStep: currentStep.title,
            isLastStep,
            stepIndex: window.currentWizardStep,
            visibleSteps: visibleSteps.length
        });

        saveCurrentStepSelection(currentStep, container);

        if (isLastStep) {
            console.log('🛒 Adding to cart...');
            const selectedAddons = gatherWizardSelections(steps, container);
            console.log('📦 Final selections:', selectedAddons);

            if (typeof addToCart === 'function') {
                addToCart(baseItem.item_no, selectedAddons, [], editingOrderItemSNo, true);
            }

            if (onConfirm) onConfirm(selectedAddons, []);
            closeAddonModal();
        } else {
            window.currentWizardStep++;
            console.log('➡️ Moving to step', window.currentWizardStep);
            renderWizardUI(container, baseItem, steps, onConfirm, editingOrderItemSNo);
            scrollModalToTop();
        }
    });

    // ✅ ENHANCED: Auto-advance for checkboxes and radio buttons
    container.querySelectorAll('.option-input').forEach(input => {
        input.addEventListener('change', () => {
            if (window.isRestoringWizardState) {
                console.log('⏭️ Ignoring change event during restoration');
                return;
            }

            console.log('✅ Option selected:', input.value);

            // Update visual card styling
            if (input.type === 'radio') {
                updateCardStyling(currentStep.id, input.value, 'single');

                // ✅ AUTO-ADVANCE: Radio buttons (single selection)
                if (ADDON_MODAL_CONFIG.wizard.autoAdvanceOnSelection) {
                    handleAutoAdvance(currentStep, container, input);
                }
            } else if (input.type === 'checkbox') {
                const card = input.closest('.option-card');
                if (card) {
                    if (input.checked) {
                        card.classList.add('selected');
                        card.style.borderColor = '#10b981';
                        card.style.backgroundColor = '#f0fdf4';

                        // ✅ AUTO-ADVANCE: Checkboxes (multiple selection)
                        if (ADDON_MODAL_CONFIG.wizard.autoAdvanceOnSelection) {
                            handleAutoAdvance(currentStep, container, input);
                        }
                    } else {
                        card.classList.remove('selected');
                        card.style.borderColor = '';
                        card.style.backgroundColor = '';
                    }
                }
            }

            if (currentStep.id === 'temperature') {
                console.log('🌡️ Temperature changed, will filter subsequent steps');
            }

            updateNextButtonState(container, currentStep);
        });
    });

    // Quantity controls (no auto-advance for these)
    container.querySelectorAll('.qty-minus, .qty-plus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();

            if (window.isRestoringWizardState) return;

            const optionId = btn.dataset.optionId;
            const row = container.querySelector(`.option-row[data-option-id="${optionId}"]`);
            const qtyDisplay = row.querySelector('.qty-display');
            let qty = parseInt(qtyDisplay.textContent);

            if (btn.classList.contains('qty-plus')) {
                qty++;
            } else if (btn.classList.contains('qty-minus') && qty > 0) {
                qty--;
            }

            qtyDisplay.textContent = qty;

            // Update row styling
            if (qty > 0) {
                row.style.borderColor = '#10b981';
                row.style.backgroundColor = '#f0fdf4';
            } else {
                row.style.borderColor = '';
                row.style.backgroundColor = '';
            }

            console.log('🔢 Quantity changed:', { optionId, newQty: qty });

            updateNextButtonState(container, currentStep);
        });
    });
}

function handleAutoAdvance(currentStep, container, input) {
    const visibleSteps = getVisibleSteps();
    const isLastStep = window.currentWizardStep === visibleSteps.length - 1;

    // Don't auto-advance on last step
    if (isLastStep) {
        console.log('⏹️ Last step - no auto-advance');
        return;
    }

    // For checkboxes, only advance if this makes the step valid
    if (input.type === 'checkbox') {
        // Add small delay to allow user to select multiple if desired
        // Check if step requirements are now met
        if (!canProceedToNext(currentStep, container)) {
            console.log('⏸️ Step requirements not yet met');
            return;
        }
    }

    // For radio buttons, advance immediately (single selection)
    // For checkboxes, advance after ensuring requirements are met

    console.log('⚡ Auto-advancing to next step...');

    // Save current selection
    saveCurrentStepSelection(currentStep, container);

    // Determine delay based on input type
    const delay = input.type === 'checkbox' ? 600 : 400; // Longer delay for checkboxes

    // Auto-advance after brief delay for visual feedback
    setTimeout(() => {
        // Double-check we're still on the same step (user might have clicked back)
        const currentStepIndex = window.currentWizardStep;
        const expectedStepId = visibleSteps[currentStepIndex]?.id;

        if (expectedStepId === currentStep.id) {
            window.currentWizardStep++;

            // Re-render with the updated step
            const baseItem = window.currentBaseItem || {}; // Store baseItem globally if needed
            const steps = window.wizardSteps || [];

            renderWizardUI(
                container,
                baseItem,
                steps,
                window.wizardOnConfirm, // Store onConfirm globally if needed
                window.editingOrderItemSNo
            );
            scrollModalToTop();
        } else {
            console.log('⏹️ Step changed during delay - canceling auto-advance');
        }
    }, delay);
}

function saveCurrentStepSelection(step, container) {
    if (!window.wizardSelections) {
        window.wizardSelections = {};
    }

    if (step.type === 'single') {
        const selected = container.querySelector(`input[name="step_${step.id}"]:checked`);
        if (selected) {
            window.wizardSelections[step.id] = selected.value;
            console.log('💾 Saved single selection:', step.id, selected.value);
        }
    }
    else if (step.type === 'quantity') {
        const quantities = {};
        const rows = container.querySelectorAll('.option-row');
        rows.forEach(row => {
            const qty = parseInt(row.querySelector('.qty-display').textContent);
            if (qty > 0) {
                quantities[row.dataset.optionId] = qty;
            }
        });
        window.wizardSelections[step.id] = quantities;
        console.log('💾 Saved quantity selections:', step.id, quantities);
    }
    else if (step.type === 'multiple') {
        const selected = Array.from(
            container.querySelectorAll(`input[name="step_${step.id}"]:checked`)
        ).map(input => input.value);
        window.wizardSelections[step.id] = selected;
        console.log('💾 Saved multiple selections:', step.id, selected);
    }
}

// ============================================
// UPDATE NEXT BUTTON STATE
// ============================================
function updateNextButtonState(container, step) {
    const nextBtn = container.querySelector('.wizard-next');
    if (!nextBtn) return;

    if (canProceedToNext(step, container)) {
        nextBtn.classList.remove('disabled');
        nextBtn.disabled = false;
    } else {
        nextBtn.classList.add('disabled');
        nextBtn.disabled = true;
    }
}



// ============================================
// GATHER FINAL SELECTIONS
// ============================================
function gatherWizardSelections(steps, container) {
    const selections = [];

    console.log('📦 Gathering final selections...');
    console.log('Saved selections:', window.wizardSelections);

    steps.forEach((step, index) => {
        const saved = window.wizardSelections?.[step.id];

        console.log(`Step ${index + 1} (${step.id}):`, saved);

        if (!saved) return;
        if (step.id === 'temperature') return;

        if (step.type === 'single') {
            const option = step.options.find(opt => opt.id === saved);
            if (option) {
                selections.push({
                    item_no: saved,
                    item_name: option.name,
                    qty: 1,
                    price: option.price || 0,
                    modifier_name: step.id,
                    category_code: step.id
                });
            }
        }
        else if (step.type === 'quantity') {
            if (typeof saved === 'object') {
                Object.entries(saved).forEach(([itemId, qty]) => {
                    if (qty > 0) {
                        const option = step.options.find(opt => opt.id === itemId);
                        if (option) {
                            selections.push({
                                item_no: itemId,
                                item_name: option.name,
                                qty: qty,
                                price: option.price || 0,
                                modifier_name: step.id,
                                category_code: step.id
                            });
                        }
                    }
                });
            }
        }
        else if (step.type === 'multiple') {
            if (Array.isArray(saved)) {
                saved.forEach(itemId => {
                    const option = step.options.find(opt => opt.id === itemId);
                    if (option) {
                        selections.push({
                            item_no: itemId,
                            item_name: option.name,
                            qty: 1,
                            price: option.price || 0,
                            modifier_name: step.id,
                            category_code: step.id
                        });
                    }
                });
            }
        }
    });

    console.log('✅ Final gathered selections:', selections);
    return selections;
}


function canProceedToNext(step, container = null) {
    if (!container) {
        return !step.required;
    }

    if (!step.required) return true;

    if (step.type === 'single') {
        const checked = container.querySelector(`input[name="step_${step.id}"]:checked`);
        return checked !== null;
    } else if (step.type === 'quantity') {
        const totals = Array.from(container.querySelectorAll('.option-row .qty-display'))
            .map(el => parseInt(el.textContent) || 0);
        return totals.some(qty => qty > 0);
    } else if (step.type === 'multiple') {
        return true;
    }

    return false;
}

/**
 * Pre-fills the wizard modal with existing selections when editing an item
 * @param {Array} selectedAddons - Previously selected addon items
 * @param {Array} selectedRemarks - Previously selected remarks
 * @param {Object} itemData - Full item data
 * @param {string} editingSno - S_NO of item being edited
 */
function prefillWizardModal(selectedAddons, selectedRemarks, itemData, editingSno) {
    console.log("🔧 Prefilling wizard modal for s_no:", editingSno);
    console.log("📦 Selected addons:", selectedAddons);
    console.log("💬 Selected remarks:", selectedRemarks);

    if (!window.wizardState) {
        console.warn("⚠️ Wizard state not initialized yet");
        return;
    }

    const state = window.wizardState;

    // Step 1: Pre-fill modifier groups (radio/checkbox selections)
    prefillModifierGroups(selectedRemarks, itemData);

    // Step 2: Pre-fill add-ons (quantity selections)
    prefillAddons(selectedAddons);

    // Step 3: Update wizard state with stored selections
    state.selectedAddons = [...selectedAddons];
    state.selectedRemarks = [...selectedRemarks];
    state.editingSno = editingSno;

    // Step 4: Update the UI to reflect current selections
    updateWizardUI();

    console.log("✅ Wizard modal prefilled successfully");
}

/**
 * Pre-fills modifier group selections (steps with radio buttons or checkboxes)
 */
function prefillModifierGroups(selectedRemarks, itemData) {
    if (!selectedRemarks || selectedRemarks.length === 0) {
        console.log("ℹ️ No remarks to prefill");
        return;
    }

    // Group remarks by remarks_group
    const remarksByGroup = {};
    selectedRemarks.forEach(remark => {
        const groupName = remark.remarks_group;
        if (!remarksByGroup[groupName]) {
            remarksByGroup[groupName] = [];
        }
        remarksByGroup[groupName].push(remark);
    });

    console.log("📋 Remarks grouped by group:", remarksByGroup);

    // Find and check corresponding radio buttons or checkboxes
    Object.keys(remarksByGroup).forEach(groupName => {
        const remarks = remarksByGroup[groupName];

        remarks.forEach(remark => {
            const remarkText = remark.remarks || remark.remarks_item_name;

            // Try to find radio button
            const radioInput = document.querySelector(
                `input[type="radio"][value="${remarkText}"]`
            );

            if (radioInput) {
                radioInput.checked = true;
                console.log(`✓ Checked radio for: ${remarkText}`);

                // Update wizard state
                if (window.wizardState) {
                    const currentStep = window.wizardState.currentStep;
                    window.wizardState.stepSelections[currentStep] = {
                        type: 'single',
                        value: remarkText,
                        remarkGroup: groupName
                    };
                }
            }

            // Try to find checkbox
            const checkboxInput = document.querySelector(
                `input[type="checkbox"][value="${remarkText}"]`
            );

            if (checkboxInput) {
                checkboxInput.checked = true;
                console.log(`✓ Checked checkbox for: ${remarkText}`);

                // Update wizard state
                if (window.wizardState) {
                    const currentStep = window.wizardState.currentStep;
                    if (!window.wizardState.stepSelections[currentStep]) {
                        window.wizardState.stepSelections[currentStep] = {
                            type: 'multiple',
                            values: []
                        };
                    }
                    if (!window.wizardState.stepSelections[currentStep].values.includes(remarkText)) {
                        window.wizardState.stepSelections[currentStep].values.push(remarkText);
                    }
                }
            }
        });
    });
}

/**
 * Pre-fills addon quantities in the wizard modal
 */
function prefillAddons(selectedAddons) {
    if (!selectedAddons || selectedAddons.length === 0) {
        console.log("ℹ️ No addons to prefill");
        return;
    }

    selectedAddons.forEach(addon => {
        const itemNo = addon.item_no;
        const qty = addon.qty || 1;

        // Find the quantity display and update it
        const optionRow = document.querySelector(`[data-option-id="${itemNo}"]`);

        if (optionRow) {
            const qtyDisplay = optionRow.querySelector('.qty-display');
            if (qtyDisplay) {
                qtyDisplay.textContent = qty;
                console.log(`✓ Set quantity ${qty} for addon: ${addon.item_name}`);

                // Highlight the row if quantity > 0
                if (qty > 0) {
                    optionRow.style.borderColor = '#10b981';
                    optionRow.style.backgroundColor = '#f0fdf4';
                }
            }
        } else {
            console.warn(`⚠️ Could not find addon row for item_no: ${itemNo}`);
        }
    });

    // Update wizard state
    if (window.wizardState) {
        window.wizardState.selectedAddons = [...selectedAddons];
    }
}

function updateWizardProgress() {
    if (!window.wizardState) return;

    const state = window.wizardState;
    const totalSteps = state.steps.length;
    const currentStep = state.currentStep;

    // Update progress step indicators
    document.querySelectorAll('.progress-step').forEach((step, index) => {
        if (index < currentStep) {
            step.classList.add('completed');
            step.classList.remove('active');
            step.textContent = '✓';
        } else if (index === currentStep) {
            step.classList.add('active');
            step.classList.remove('completed');
            step.textContent = index + 1;
        } else {
            step.classList.remove('completed', 'active');
            step.textContent = index + 1;
        }
    });
}

function detectTemperatureFromCartItem(prefilledAddons, itemmasterItems) {
    console.log('🌡️ Detecting temperature from cart item...');

    for (const addon of prefilledAddons) {
        const itemName = addon.item_name || addon.citem_name || '';
        const itemNo = addon.item_no || addon.citem_no;

        console.log(`  Checking addon: ${itemName} (${itemNo})`);

        // Use your existing getItemTemperature function
        const temp = getItemTemperature(addon);
        if (temp) {
            console.log(`  ✅ Detected ${temp.toUpperCase()} from addon`);
            return temp;
        }

        // Also check in itemmasterItems
        if (itemmasterItems) {
            const masterItem = itemmasterItems.find(item =>
                item.citem_no === itemNo || item.item_no === itemNo
            );

            if (masterItem) {
                const masterTemp = getItemTemperature(masterItem);
                if (masterTemp) {
                    console.log(`  ✅ Detected ${masterTemp.toUpperCase()} from master item`);
                    return masterTemp;
                }
            }
        }
    }

    console.log('  ℹ️ No temperature detected');
    return null;
}

function updateWizardSummary() {
    const summaryEl = document.querySelector('.wizard-summary');
    if (!summaryEl || !window.wizardState) return;

    const state = window.wizardState;

    // Count selected items
    const remarkCount = state.selectedRemarks.length;
    const addonCount = state.selectedAddons.filter(a => a.qty > 0).length;

    // Calculate additional cost
    let additionalCost = 0;
    state.selectedAddons.forEach(addon => {
        if (addon.qty > 0) {
            additionalCost += (addon.price || 0) * (addon.qty || 1);
        }
    });

    summaryEl.innerHTML = `
        <div class="summary-item">
            <span>Selections:</span>
            <strong>${remarkCount} options</strong>
        </div>
        <div class="summary-item">
            <span>Add-ons:</span>
            <strong>${addonCount} items</strong>
        </div>
        <div class="summary-item">
            <span>Additional:</span>
            <strong>$${additionalCost.toFixed(2)}</strong>
        </div>
    `;
}

function clearWizardSelections() {
    // Clear all radio buttons
    document.querySelectorAll('.wizard-content input[type="radio"]').forEach(input => {
        input.checked = false;
    });

    // Clear all checkboxes
    document.querySelectorAll('.wizard-content input[type="checkbox"]').forEach(input => {
        input.checked = false;
    });

    // Reset all quantity displays to 0
    document.querySelectorAll('.qty-display').forEach(display => {
        display.textContent = '0';
    });

    // Reset addon row styles
    document.querySelectorAll('.option-row').forEach(row => {
        row.style.borderColor = '#e5e7eb';
        row.style.backgroundColor = 'white';
    });

    // Clear wizard state
    if (window.wizardState) {
        window.wizardState.selectedAddons = [];
        window.wizardState.selectedRemarks = [];
        window.wizardState.stepSelections = {};
    }

    console.log("🧹 Wizard selections cleared");
}


function updateWizardUI() {
    // Update progress indicators
    updateWizardProgress();

    // Update navigation button states
    updateWizardButtons();

    // Update any summary displays
    updateWizardSummary();
}


// ============================================
// TRADITIONAL MODAL (All-in-One)
// ============================================

function showTraditionalModal(baseItem, onConfirm, addonData, remarksData, prefilledAddons, prefilledRemarks, editingOrderItemSNo) {
    showAddOnModalOriginal(baseItem, onConfirm, addonData, remarksData, prefilledAddons, prefilledRemarks, editingOrderItemSNo)
}


function checkCurrentStepSelection() {
    if (!window.wizardState) return false;

    const state = window.wizardState;
    const currentStep = state.currentStep;
    const stepData = state.steps[currentStep];

    // If step is optional, always return true
    if (stepData.optional) return true;

    // For addon steps, always allow proceed (quantity can be 0)
    if (stepData.isAddonStep) return true;

    // For single selection (radio)
    const radioChecked = document.querySelector(
        '.wizard-content input[type="radio"]:checked'
    );
    if (radioChecked) return true;

    // For multiple selection (checkbox)
    const checkboxChecked = document.querySelector(
        '.wizard-content input[type="checkbox"]:checked'
    );
    if (checkboxChecked) return true;

    return false;
}

function updateWizardButtons() {
    const backBtn = document.querySelector('.wizard-back');
    const nextBtn = document.querySelector('.wizard-next');

    if (!window.wizardState) return;

    const state = window.wizardState;
    const currentStep = state.currentStep;
    const totalSteps = state.steps.length;

    // Back button
    if (backBtn) {
        backBtn.disabled = currentStep === 0;
        backBtn.style.opacity = currentStep === 0 ? '0.5' : '1';
    }

    // Next button
    if (nextBtn) {
        const isLastStep = currentStep === totalSteps - 1;
        nextBtn.textContent = isLastStep ? 'Update Cart' : 'Next';

        // Check if current step has required selection
        const hasSelection = checkCurrentStepSelection();
        nextBtn.disabled = !hasSelection;

        if (!hasSelection) {
            nextBtn.classList.add('disabled');
        } else {
            nextBtn.classList.remove('disabled');
        }
    }
}


// ============================================
// Scroll to top helper
// ============================================
export function scrollModalToTop() {
    const modal = document.getElementById('addonModal');
    const modalContent = document.getElementById('addonModalContent');

    if (modal) {
        modal.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (modalContent) {
        modalContent.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

async function startOverFromPOS() {
    const storeName = localStorage.getItem('storename');
    const deviceId = localStorage.getItem("sok_device_id");
    console.log("🔄 Start Over triggered by POS service");

    try {
        if (typeof showToast === 'function') {
            showToast('Clearing your order...', 'info', 'Please wait', 2000);
        }

        const orderId = localStorage.getItem('currentOrderId');

        // STEP 1: Clear order on server via fetch
        if (deviceId) {
            const outlet = window.sokWebSocket?.deviceInfo?.outlet
                || localStorage.getItem("sok_location")
                || storeName;

            console.log("📤 Clearing order cache on server...", { deviceId, outlet });

            try {
                const response = await fetch(`/API/SOKOrder/${outlet}/${deviceId}/cache/clear`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" }
                });

                if (response.ok) {
                    const result = await response.json();
                    console.log("📥 Server clear response:", result);
                    if (result.success) {
                        console.log("✅ Server confirmed order cleared");
                    } else {
                        console.warn("⚠️ Server rejected clear:", result.error);
                    }
                } else {
                    const errorText = await response.text();
                    console.error("❌ Server clear failed:", response.status, errorText);
                }
            } catch (fetchError) {
                console.error("❌ Fetch error clearing cache:", fetchError);
            }
        } else {
            console.warn("⚠️ No deviceId — skipping server clear");
        }

        // STEP 2: Force clear local order state
        if (window.sokWebSocket && typeof window.sokWebSocket.clearOrderState === 'function') {
            console.log("🧹 Force clearing local order state");
            window.sokWebSocket.clearOrderState(true);
        }

        // STEP 3: Clear member info
        const memberName = localStorage.getItem('memberName');
        if (memberName) {
            console.log("👤 Logging out:", memberName);
            if (typeof showToast === 'function') {
                showToast(`Goodbye, ${memberName}!`, 'success', 'Logged Out', 1000);
            }
        }

        [
            'memberName', 'memberEmail', 'memberPhone', 'memberId',
            'memberPoints', 'currentMember', 'loggedInMember',
            'memberInfo', 'memberSession', 'memberVouchers'
        ].forEach(k => localStorage.removeItem(k));
        console.log("✅ Member info cleared");

        // STEP 4: Clear all order-related storage
        console.log("🗑️ Clearing all storage");

        [
            'currentOrderId', 'orderType', 'tableNumber',
            'orderData', 'order', 'currentOrder'
        ].forEach(k => localStorage.removeItem(k));

        sessionStorage.clear();
        console.log("✅ Storage cleared");

        if (typeof showToast === 'function') {
            showToast('Starting fresh!', 'success', 'Ready', 1000);
        }

        // ✅ STEP 4.5: Snapshot API cache into localStorage BEFORE redirect
        // Must be after all localStorage/sessionStorage clears (so order keys
        // don't pollute the snapshot) but before WebSocket disconnects.
        // apiManager.loadedData lives in memory — sessionStorage.clear() above
        // does NOT affect it, so the snapshot is always fresh from memory.
        if (typeof saveCacheBeforeRedirect === 'function') {
            saveCacheBeforeRedirect();
        } else if (typeof window.saveCacheBeforeRedirect === 'function') {
            window.saveCacheBeforeRedirect();
        } else {
            console.warn("⚠️ saveCacheBeforeRedirect not available — cold boot on next load");
        }

        // STEP 5: Disconnect WebSocket before redirect
        if (window.sokWebSocket && typeof window.sokWebSocket.disconnect === 'function') {
            console.log("🔌 Disconnecting WebSocket before redirect");
            window.sokWebSocket.disconnect();
        }

        // STEP 6: Wait and redirect
        await new Promise(resolve => setTimeout(resolve, 1500));

        console.log("🏠 Redirecting to home");
        window.location.replace(
            `/KIOSK/Home/${encodeURIComponent(storeName)}?device_id=${deviceId}`
        );

    } catch (error) {
        console.error("❌ Error in startOverFromPOS:", error);

        if (typeof showToast === 'function') {
            showToast('Restarting...', 'info', 'Please wait', 1500);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        window.location.replace(
            `/KIOSK/Home/${encodeURIComponent(storeName)}?device_id=${deviceId}`
        );
    }
}

// ============================================
// EXPORT / INITIALIZATION
// ============================================

// Make functions globally available
window.showAddOnModal = showAddOnModal;
window.ADDON_MODAL_CONFIG = ADDON_MODAL_CONFIG;


// Make available globally
window.autoScrollToTab = autoScrollToTab;
window.scrollToTab = scrollToTab;
window.ensureSubcategoryVisibility = ensureSubcategoryVisibility;
window.updateActiveTabStates = updateActiveTabStates;
window.navigateToCategory = navigateToCategory;
window.prefillWizardModal = prefillWizardModal;
window.clearWizardSelections = clearWizardSelections;
window.restoreStepSelections = restoreStepSelections;
window.renderStepOptions = renderStepOptions;
window.detectTemperatureFromCartItem = detectTemperatureFromCartItem;
window.prefillWizardSelections = prefillWizardSelections;
window.saveCurrentStepSelection = saveCurrentStepSelection;
window.getVisibleSteps = getVisibleSteps;
window.handleAutoAdvance = handleAutoAdvance;
window.startOverFromPOS = startOverFromPOS;

// ============================================
// DEBUG SCRIPT - Run this in your browser console
// ============================================

console.group('🔍 Temperature Filtering Debug');

// Check if functions exist
console.log('✓ Functions available:');
console.log('  - getVisibleSteps:', typeof window.getVisibleSteps);
console.log('  - shouldShowStep:', typeof window.shouldShowStep);
console.log('  - getFilteredStepOptions:', typeof window.getFilteredStepOptions);

// Check current state
console.log('\n📊 Current State:');
console.log('  - Current step index:', window.currentWizardStep);
console.log('  - Temperature selection:', window.wizardSelections?.temperature);
console.log('  - Total steps:', window.wizardSteps?.length);

// Check if getVisibleSteps is working
if (typeof window.getVisibleSteps === 'function') {
    const visible = window.getVisibleSteps();
    console.log('  - Visible steps:', visible.length);
    console.log('\n📋 Visible Steps List:');
    visible.forEach((step, i) => {
        console.log(`    ${i + 1}. ${step.title} (${step.id})`);
    });
} else {
    console.error('❌ getVisibleSteps function not found!');
    console.log('You need to add this function to your code.');
}

// Check all steps and their temperature dependencies
if (window.wizardSteps) {
    console.log('\n🌡️ All Steps Analysis:');
    window.wizardSteps.forEach((step, i) => {
        const hasTemp = step.options.some(opt => opt.temp);
        const temps = [...new Set(step.options.map(opt => opt.temp).filter(Boolean))];

        console.log(`  ${i + 1}. ${step.title}:`, {
            id: step.id,
            temperatureDependent: step.temperatureDependent,
            totalOptions: step.options.length,
            hasTemperatureOptions: hasTemp,
            temperatureTypes: temps,
            shouldShow: typeof window.shouldShowStep === 'function'
                ? window.shouldShowStep(step, window.wizardSelections?.temperature)
                : '(function not available)'
        });
    });
}

// Check selections
console.log('\n💾 Wizard Selections:');
console.log(window.wizardSelections);

console.groupEnd();

// ============================================
// QUICK FIX TEST
// ============================================

console.log('\n🔧 Quick Fix Test:');

if (typeof window.getVisibleSteps !== 'function') {
    console.log('❌ getVisibleSteps is missing! Adding it now...');

    window.getVisibleSteps = function () {
        if (!window.wizardSteps) return [];

        const selectedTemp = window.wizardSelections?.temperature;

        if (!selectedTemp) {
            console.log('  No temperature selected yet, showing all steps');
            return window.wizardSteps;
        }

        const filtered = window.wizardSteps.filter(step => {
            if (step.id === 'temperature') return true;
            if (!step.temperatureDependent || !selectedTemp) return true;

            const filteredOptions = step.options.filter(option => {
                if (!option.temp) return true;
                return option.temp === selectedTemp;
            });

            const shouldShow = filteredOptions.length > 0;
            console.log(`  Step "${step.title}": ${shouldShow ? '✅ SHOW' : '❌ HIDE'} (${filteredOptions.length}/${step.options.length} options)`);

            return shouldShow;
        });

        console.log(`  Result: ${filtered.length}/${window.wizardSteps.length} steps visible`);
        return filtered;
    };

    console.log('✅ getVisibleSteps function added!');
    console.log('Now test it: window.getVisibleSteps()');
}

// ============================================
// AUTOMATIC FIX
// ============================================

console.log('\n🔧 Attempting automatic fix...');

// Check if we're currently on a step that should be hidden
if (window.wizardSteps && window.wizardSelections?.temperature) {
    const currentStep = window.wizardSteps[window.currentWizardStep];
    const selectedTemp = window.wizardSelections.temperature;

    console.log(`Current step: "${currentStep.title}"`);
    console.log(`Selected temp: "${selectedTemp}"`);

    // Check if current step should be visible
    const filteredOptions = currentStep.options.filter(option => {
        if (!option.temp) return true;
        return option.temp === selectedTemp;
    });

    if (filteredOptions.length === 0 && currentStep.id !== 'temperature') {
        console.log('❌ Current step has NO options for selected temperature!');
        console.log('This step should be hidden.');

        // Find the next valid step
        const visibleSteps = window.getVisibleSteps();
        console.log('\nVisible steps should be:');
        visibleSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s.title}`));
    } else {
        console.log(`✅ Current step has ${filteredOptions.length} valid options`);
    }
}



