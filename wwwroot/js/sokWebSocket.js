import { useOrder, useOrderStore } from '../stores/order-store.js';
import { selectOrderType } from '../js/GetHomeAPI.js';
class SOKOrderWebSocket {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.heartbeatInterval = null;
        this.reconnectTimer = null;
        this.deviceInfo = null;
        this.pendingSync = false;
        this.isInitialLoad = true;
        this.messageQueue = [];
        this.lastUpdateTimestamp = 0;
        this.processingQueue = false;
        this.initializationAttempts = 0;
        this.maxInitializationAttempts = 3;
        this.connectionTimeout = null;
        this.isInitializing = false;

        // Constants
        this.HEARTBEAT_INTERVAL = 15000;  // 15s — safe under most 30s proxy idle timeouts
        this.BASE_RECONNECT_DELAY = 1000;
        this.MAX_RECONNECT_DELAY = 30000;
        this.SYNC_DELAY = 300;
        this.UPDATE_DEBOUNCE = 50;
        this.healthCheckInterval = null;
        this.HEALTH_CHECK_INTERVAL = 5000;
        this.initialDataLoaded = false;
        this.CONNECTION_TIMEOUT = 15000;
        this.INITIALIZATION_RETRY_DELAY = 2000;

        // ─── Session timeout constants ───────────────────────────────
        this.SESSION_INACTIVITY_MS = 120000;   //  minutes
        this.SESSION_PROMPT_TIMEOUT_MS = 30000;    // 30 s to answer the modal
        this.sessionTimer = null;                       // fires after inactivity
        this.sessionPromptTimer = null;                 // fires if user ignores modal
        this.sessionPromptCountdown = null;             // 1-s tick updating the UI
        this.sessionPromptVisible = false;              // guard duplicate modals
        this._boundActivityHandler = this._onActivity.bind(this);
        this.lastFinalizedTimestamp = 0;
        this.PROTECTION_WINDOW_MS = 15000;
    }

    markOrderFinalized() {
        this.lastFinalizedTimestamp = Date.now();
        console.log("🛡️ Cache protection activated. WebSocket recovery locked.");
    }

    // ─────────────────────────────────────────────────────────────────
    // SESSION TIMEOUT – public API
    // ─────────────────────────────────────────────────────────────────

    /** Start (or restart) the 5-minute inactivity timer. */
    startSessionTimeout() {
        if (this.sessionTimer) {
            console.log("⏱️  Session timer already running — skipping reset");
            return;
        }

        this._attachActivityListeners();
        this.sessionTimer = setTimeout(() => {
            this._showSessionPrompt();
        }, this.SESSION_INACTIVITY_MS);

        console.log("⏱️  Session timeout started (2 min)");
    }

    /** Fully stop session timeout + prompt + countdown. */
    stopSessionTimeout() {
        clearTimeout(this.sessionTimer);
        this.sessionTimer = null;

        this._clearPrompt();
        this._detachActivityListeners();
        console.log("🛑 Session timeout stopped");
    }

    notifyOrderStarted() {
        console.log("✅ Order started — starting session timeout");
        this.stopSessionTimeout(); // clear any stale timer first
        this.startSessionTimeout();
    }

    /** Reset the inactivity timer to now + 5 min (called on every user action). */
    resetSessionTimeout() {
        // Remove the guard — always restart if called
        clearTimeout(this.sessionTimer);
        this.sessionTimer = setTimeout(() => {
            this._showSessionPrompt();
        }, this.SESSION_INACTIVITY_MS);
    }

    // ─── private helpers ─────────────────────────────────────────────

    _attachActivityListeners() {
        // ❌ REMOVE this line — _boundActivityHandler is already bound in constructor
        // this._boundActivityHandler = this._onActivity.bind(this);

        ['mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove', 'scroll', 'wheel']
            .forEach(evt =>
                window.addEventListener(evt, this._boundActivityHandler, { passive: true })
            );
    }

    _detachActivityListeners() {
        ['mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove', 'scroll', 'wheel'].forEach(evt => {
            window.removeEventListener(evt, this._boundActivityHandler);
        });
    }

    /** Any user interaction → reset the 5 min timer; also dismiss prompt if visible. */
    _onActivity() {
        if (this.sessionPromptVisible) {
            this._handleSessionContinue();
            return;
        }

        const timeSinceFinalized = Date.now() - this.lastFinalizedTimestamp;
        if (timeSinceFinalized < this.PROTECTION_WINDOW_MS) {
            console.log("🛡️ Skipping activity-based recovery: Order recently finalized.");
            return;
        }

        this.resetSessionTimeout(); // ✅ underscore prefix*/
    }

    /** Show the "Still there?" modal and start the 30-s countdown. */
    _showSessionPrompt() {
        const landingOverlay = document.getElementById('landingOverlay');
        const isOnLanding = landingOverlay && !landingOverlay.classList.contains('hidden');

        if (isOnLanding) {
            console.log("⏱️ Session prompt suppressed — user is on landing page, resetting timer");
            // Clear and restart silently — no modal shown
            this.sessionTimer = null;
            this.startSessionTimeout();
            return;
        }

        if (this.sessionPromptVisible) return;


        // ── build modal DOM ────────────────────────────────────────
        const overlay = document.createElement('div');
        overlay.id = 'sok-session-overlay';
        overlay.className = 'sok-session-overlay';

        overlay.innerHTML = `
            <div class="sok-session-modal">
                <div class="sok-session-icon">⏰</div>
                <h3 class="sok-session-title">Still there?</h3>
                <p class="sok-session-message">
                    Your session will end in <span id="sok-session-countdown">30</span> seconds due to inactivity.
                </p>
                <div class="sok-session-actions">
                    <button class="sok-session-btn sok-session-btn-continue" id="sok-session-continue">
                        Yes, continue
                    </button>
                    <button class="sok-session-btn sok-session-btn-end" id="sok-session-end">
                        End session
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // ── wire buttons ───────────────────────────────────────────
        overlay.querySelector('#sok-session-continue')
            .addEventListener('click', () => this._handleSessionContinue());
        overlay.querySelector('#sok-session-end')
            .addEventListener('click', () => this._handleSessionEnd());

        // ── start 30-s countdown ──────────────────────────────────
        let remaining = Math.floor(this.SESSION_PROMPT_TIMEOUT_MS / 1000); // 30

        this.sessionPromptCountdown = setInterval(() => {
            remaining -= 1;
            const el = document.getElementById('sok-session-countdown');
            if (el) el.textContent = remaining;

            if (remaining <= 0) {
                this._handleSessionEnd();
            }
        }, 1000);

        // ── hard timeout (safety net in case setInterval drifts) ──
        this.sessionPromptTimer = setTimeout(() => {
            this._handleSessionEnd();
        }, this.SESSION_PROMPT_TIMEOUT_MS);

        console.log("⏱️  Session prompt shown – 30 s countdown");
    }

    /** User clicked "Yes, continue" (or interacted with the page). */
    _handleSessionContinue() {
        this._clearPrompt();

        // Restart the 5-min inactivity timer
        this.startSessionTimeout();

        // Make sure WebSocket is still healthy (heartbeat keeps it alive, but double-check)
        if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) {
            console.log("🔄 Session continued – reconnecting WebSocket...");
            this.initialize();
        }

        console.log("✅ Session continued by user");
    }

    /** User clicked "End session" or 30 s elapsed with no response. */
    _handleSessionEnd() {
        this._clearPrompt();
        this.stopSessionTimeout();

        const orderType = localStorage.getItem('orderType');
        const orderType_ts = localStorage.getItem('orderType_ts');

        console.log("🔌 Session ended – disconnecting WebSocket");
        this.disconnect();

        if (orderType) localStorage.setItem('orderType', orderType);
        if (orderType_ts) localStorage.setItem('orderType_ts', orderType_ts);

        startNewOrder();
    }

    /** Remove the modal DOM + clear prompt timers. */
    _clearPrompt() {
        clearTimeout(this.sessionPromptTimer);
        this.sessionPromptTimer = null;

        clearInterval(this.sessionPromptCountdown);
        this.sessionPromptCountdown = null;

        const overlay = document.getElementById('sok-session-overlay');
        if (overlay) overlay.remove();

        this.sessionPromptVisible = false;
    }

    // ─────────────────────────────────────────────────────────────────
    // EXISTING CODE (unchanged unless noted with ✅ SESSION HOOK)
    // ─────────────────────────────────────────────────────────────────

    validateDeviceInfo() {
        if (this.deviceInfo && this.deviceInfo.deviceId && this.deviceInfo.outlet) {
            console.log('✅ Using device info set directly on instance');
            return this.deviceInfo;
        }

        const storage = window.safeStorage || {
            getItem: (key) => {
                try {
                    return localStorage.getItem(key);
                } catch (e) {
                    console.warn('localStorage not available:', e.name);
                    return null;
                }
            }
        };

        const deviceId = storage.getItem("sok_device_id");
        const outlet = storage.getItem("sok_location") || storage.getItem("storename");

        if (!deviceId || !outlet) {
            console.error("❌ Missing device_id or outlet");
            console.log("📋 Available localStorage keys:", Object.keys(localStorage || {}));

            const urlDeviceId = this.getDeviceIdFromUrl();
            const urlOutlet = this.getOutletFromUrl();

            if (urlDeviceId && urlOutlet) {
                console.log("✅ Using device info from URL");
                return { deviceId: urlDeviceId, outlet: urlOutlet };
            }

            return false;
        }

        if (deviceId.trim() === '' || outlet.trim() === '' ||
            deviceId === 'undefined' || outlet === 'undefined') {
            console.error("❌ Invalid device_id or outlet values");
            return false;
        }

        return { deviceId, outlet };
    }

    getDeviceIdFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            return params.get('device_id') || params.get('deviceId');
        } catch (e) {
            console.warn('Error reading URL params:', e);
            return null;
        }
    }

    getOutletFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            return params.get('outlet') || params.get('location') || params.get('sok_location');
        } catch (e) {
            console.warn('Error reading URL params:', e);
            return null;
        }
    }

    async initialize() {
        if (this.isInitializing) {
            console.log("⏭️ Initialization already in progress");
            return;
        }

        this.isInitializing = true;

        try {
            let deviceInfo = null;

            if (this.deviceInfo && this.deviceInfo.deviceId && this.deviceInfo.outlet) {
                console.log('✅ Using device info set directly on instance (Safari compatible)');
                deviceInfo = this.deviceInfo;
            } else {
                deviceInfo = this.validateDeviceInfo();
            }

            if (!deviceInfo) {
                console.error("❌ Cannot initialize: Missing or invalid device information");
                console.log("📊 Debug info:", {
                    directDeviceInfo: this.deviceInfo,
                    localStorageDeviceId: localStorage.getItem('sok_device_id'),
                    localStorageLocation: localStorage.getItem('sok_location')
                });

                if (this.initializationAttempts < this.maxInitializationAttempts) {
                    this.initializationAttempts++;
                    console.log(`🔄 Retrying initialization (${this.initializationAttempts}/${this.maxInitializationAttempts}) in ${this.INITIALIZATION_RETRY_DELAY}ms`);

                    setTimeout(() => {
                        this.isInitializing = false;
                        this.initialize();
                    }, this.INITIALIZATION_RETRY_DELAY);
                } else {
                    console.error("❌ Max initialization attempts reached. Device info not available.");
                    this.showUpdateNotification(
                        "Connection Error",
                        "Unable to connect. Please refresh the page."
                    );
                    this.isInitializing = false;
                }
                return;
            }

            this.deviceInfo = deviceInfo;
            console.log("🔌 Initializing WebSocket:", this.deviceInfo);

            this.initializationAttempts = 0;

            await this.connectWebSocket();

        } catch (error) {
            console.error("❌ Failed to initialize:", error);

            if (this.initializationAttempts < this.maxInitializationAttempts) {
                this.initializationAttempts++;
                console.log(`🔄 Retrying after error (${this.initializationAttempts}/${this.maxInitializationAttempts})`);

                setTimeout(() => {
                    this.isInitializing = false;
                    this.initialize();
                }, this.INITIALIZATION_RETRY_DELAY);
            } else {
                this.isInitializing = false;
            }
        } finally {
            if (this.initializationAttempts >= this.maxInitializationAttempts) {
                this.isInitializing = false;
            }
        }
    }

    startHealthCheck() {
        this.stopHealthCheck();

        this.healthCheckInterval = setInterval(() => {
            if (document.hidden) return;

            if (this.isInitializing) {
                console.log("💚 Health check skipped — initialization in progress");
                return;
            }

            const isConnecting = this.ws && this.ws.readyState === WebSocket.CONNECTING;
            if (isConnecting) {
                console.log("💚 Health check skipped — connection in progress");
                return;
            }

            const isHealthy = this.ws &&
                this.ws.readyState === WebSocket.OPEN &&
                this.isConnected;

            if (!isHealthy) {
                console.warn("⚠️ Health check failed - connection not healthy");
                console.log("🔄 Attempting recovery...");

                this.isConnected = false;

                this.initialize().catch(err => {
                    console.error("❌ Recovery failed:", err);
                });
            } else {
                console.log("💚 Health check passed");
            }
        }, this.HEALTH_CHECK_INTERVAL);

        console.log("✅ Health check started");
    }

    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            console.log("🛑 Health check stopped");
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            this.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
            this.MAX_RECONNECT_DELAY
        );

        console.log(`🔁 Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.isInitializing = false;
            this.initialize();
        }, delay);
    }

    async connectWebSocket() {
        try {
            if (!this.deviceInfo?.deviceId) {
                const deviceInfo = this.validateDeviceInfo();
                if (!deviceInfo) {
                    console.error("❌ Cannot connect: deviceInfo missing or invalid");
                    throw new Error("Device information not available");
                }
                this.deviceInfo = deviceInfo;
            }

            if (this.ws) {
                const currentState = this.ws.readyState;
                console.log(`🔍 Existing WebSocket state: ${this.getReadyStateText(currentState)}`);

                if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
                    console.log("⚠️ Closing existing connection before reconnecting");

                    this.ws.onclose = null;
                    this.ws.onerror = null;
                    this.ws.onmessage = null;
                    this.ws.onopen = null;

                    try {
                        this.ws.close();
                    } catch (closeError) {
                        console.warn("⚠️ Error closing WebSocket:", closeError);
                    }

                    this.ws = null;
                    this.isConnected = false;

                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (this.connectionTimeout) {
                clearTimeout(this.connectionTimeout);
                this.connectionTimeout = null;
            }
            let wsHost = window.location.host;

            const { deviceId, outlet } = this.deviceInfo;
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

            // Use the host with port (if present)
            const host = window.location.host; // This includes port if present
            const wsUrl = `${wsProtocol}//${host}/API/ws/connect?device_id=${deviceId}&outlet=${encodeURIComponent(outlet)}&type=sok`;

            console.log("🌐 Connecting to:", wsUrl);
            console.log("🔍 Current location:", {
                hostname: window.location.hostname,
                port: window.location.port,
                host: window.location.host
            });


            //const wsUrl = `${wsProtocol}//${window.location.host}/API/ws/connect?device_id=${deviceId}&outlet=${encodeURIComponent(outlet)}&type=sok`;


            try {
                this.ws = new WebSocket(wsUrl);
            } catch (wsError) {
                console.error("❌ Failed to create WebSocket:", wsError);
                throw new Error(`WebSocket creation failed: ${wsError.message}`);
            }

            this.connectionTimeout = setTimeout(() => {
                if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                    console.error("❌ Connection timeout after 15 seconds");
                    console.log("🔍 WebSocket state at timeout:", this.getReadyStateText(this.ws.readyState));

                    this.ws.onclose = null;
                    this.ws.onerror = null;
                    this.ws.close();
                    this.ws = null;
                    this.isConnected = false;

                    //this.showUpdateNotification(
                    //    "Connection Timeout",
                    //    "Unable to connect to server. Please check your connection and try again."
                    //);

                    this.scheduleReconnect();
                }
            }, this.CONNECTION_TIMEOUT);

            

            // ── onopen ─────────────────────────────────────────────
            this.ws.onopen = () => {
                if (this.connectionTimeout) {
                    clearTimeout(this.connectionTimeout);
                    this.connectionTimeout = null;
                }

                console.log(`✅ WebSocket connected: ${deviceId}`);
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.isInitializing = false;
                this.startHeartbeat();
                this.startHealthCheck();

                const orderTypeSelection = document.getElementById('orderTypeSelection');
                if (orderTypeSelection) {
                    orderTypeSelection.style.opacity = '1';
                    orderTypeSelection.style.pointerEvents = 'auto';
                }

                if (this.messageQueue.length > 0) {
                    console.log(`📬 Processing ${this.messageQueue.length} queued messages on reconnect`);
                    this.processMessageQueue();
                }

                if (this.isInitialLoad) {
                    console.log("🎉 Initial connection - syncing");

                    setTimeout(() => {
                        this.showUpdateNotification(
                            "Connected",
                            "Successfully connected to server"
                        );
                    }, 100);

                    this.syncOrderFromCache(false);
                    this.isInitialLoad = false;
                } else {
                    console.log("🔄 Reconnected - syncing");
                    this.syncOrderFromCache(true);
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    // Any message from server = connection is alive
                    this.missedPongs = 0;

                    const message = JSON.parse(event.data);
                    const isHidden = document.hidden;

                    console.log(`📩 Message received: ${message.action} | Page hidden: ${isHidden}`);

                    if (message.action === 'cache_updated' || message.action === 'order_deleted' || message.action === 'order_item_deleted') {
                        if (isHidden) {
                            console.log(`📦 Queueing ${message.action} (page hidden)`);
                            this.messageQueue.push(message);

                            if (message.action === 'cache_updated' && message.orderData) {
                                this.updateStoreAndStorageSilently(message.orderData);
                            }
                        } else {
                            console.log(`⚡ Processing ${message.action} immediately (page visible)`);
                            this.handleMessage(message);
                        }
                    } else {
                        this.handleMessage(message);
                    }
                } catch (error) {
                    console.error("❌ Error parsing message:", error);
                }
            };

            this.ws.onerror = (error) => {
                console.error("❌ WebSocket error:", error);
                console.log("🔍 WebSocket state on error:", this.getReadyStateText(this.ws?.readyState));

                if (this.connectionTimeout) {
                    clearTimeout(this.connectionTimeout);
                    this.connectionTimeout = null;
                }
            };

            this.ws.onclose = (event) => {
                console.log(`🔌 WebSocket closed: ${event.code} - ${event.reason || 'No reason provided'}`);
                console.log(`🔍 Close details: wasClean=${event.wasClean}, code=${event.code}`);

                this.isConnected = false;
                this.isInitializing = false;
                this.stopHeartbeat();

                if (this.connectionTimeout) {
                    clearTimeout(this.connectionTimeout);
                    this.connectionTimeout = null;
                }

                // Normal close — user/app requested it, do not reconnect
                if (event.code === 1000) {
                    console.log("✅ Normal closure, not reconnecting");
                    return;
                }

                // 1006 = abnormal closure (proxy/server killed it, no close frame)
                // Reconnect immediately on the FIRST occurrence — no backoff delay
                if (event.code === 1006 && this.reconnectAttempts === 0) {
                    console.log("⚡ 1006 Abnormal Closure — reconnecting immediately");
                    this.reconnectAttempts = 1;                 // count it so next time backs off
                    this.isInitializing = false;
                    this.initialize();                          // fire right away
                    return;
                }

                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.scheduleReconnect();
                } else {
                    console.error("❌ Max reconnect attempts reached");
                    this.showUpdateNotification(
                        "Connection Lost",
                        "Unable to maintain connection. Please refresh the page."
                    );
                }
            };

        } catch (error) {
            console.error("❌ Connection error:", error);

            if (this.connectionTimeout) {
                clearTimeout(this.connectionTimeout);
                this.connectionTimeout = null;
            }

            this.isInitializing = false;
            this.scheduleReconnect();
        }
    }

    getReadyStateText(readyState) {
        const states = { 0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED' };
        return states[readyState] || 'UNKNOWN';
    }

    updateStoreAndStorageSilently(orderData) {
        try {
            console.log("💾 Updating store/localStorage silently (page hidden)");

            const { order, setOrder, setLastSNo } = useOrder();

            const hasVoucherApplied = order?.voucher_code && order?.voucher_discount;

            let finalOrderData = orderData;
            if (hasVoucherApplied) {
                console.log('⚠️ Preserving voucher during silent update');
                finalOrderData = {
                    ...orderData,
                    voucher_code: order.voucher_code,
                    voucher_name: order.voucher_name,
                    voucher_discount: order.voucher_discount,
                    total_disc: order.total_disc,
                    total_svc: order.total_svc,
                    total_tax: order.total_tax,
                    net_amt: order.net_amt,
                    final_amt: order.final_amt
                };
            }

            const salesDtls = finalOrderData.sales_dtls || [];
            const lastSNo = salesDtls.length > 0
                ? Math.max(...salesDtls.map(i => parseInt(i.s_no) || 0))
                : 0;

            setOrder(finalOrderData);
            setLastSNo(lastSNo);

            const existingCache = JSON.parse(localStorage.getItem("order") || '{}');
            localStorage.setItem("order", JSON.stringify({
                ...existingCache,
                state: { ...existingCache.state, order: finalOrderData, lastSNo },
                version: (existingCache.version || 0) + 1
            }));

            sessionStorage.setItem("pendingUIUpdate", "true");

            console.log(`✅ Silent update complete: ${salesDtls.length} items`);
        } catch (error) {
            console.error("❌ Error in silent update:", error);
        }
    }

    processMessageQueue() {
        if (this.processingQueue) {
            console.log("⏭️ Already processing queue");
            return;
        }

        if (this.messageQueue.length === 0) {
            console.log("📭 Queue is empty");
            return;
        }

        this.processingQueue = true;
        console.log(`📬 Processing ${this.messageQueue.length} queued messages`);

        try {
            const cacheUpdates = this.messageQueue.filter(m => m.action === 'cache_updated');
            const deletions = this.messageQueue.filter(m => m.action === 'order_deleted' || m.action === 'order_item_deleted');
            const others = this.messageQueue.filter(m => m.action !== 'cache_updated' && m.action !== 'order_deleted' && m.action !== 'order_item_deleted');

            this.messageQueue = [];

            console.log(`   Cache updates: ${cacheUpdates.length}`);
            console.log(`   Deletions: ${deletions.length}`);
            console.log(`   Others: ${others.length}`);

            deletions.forEach(msg => {
                console.log(`   🗑️ Processing queued: ${msg.action}`);
                this.handleMessage(msg);
            });

            others.forEach(msg => {
                console.log(`   📨 Processing queued: ${msg.action}`);
                this.handleMessage(msg);
            });

            if (cacheUpdates.length > 0) {
                const latestUpdate = cacheUpdates[cacheUpdates.length - 1];
                console.log(`   📦 Processing latest cache update (${cacheUpdates.length} total, ${cacheUpdates.length - 1} skipped)`);
                this.handleMessage(latestUpdate);
            }

            console.log("✅ Queue processing complete");
        } catch (error) {
            console.error("❌ Error processing queue:", error);
        } finally {
            this.processingQueue = false;
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.missedPongs = 0;                           // reset missed-pong counter

        this.heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                try {
                    // If we already missed 2 pongs the server is silent — force reconnect
                    if (this.missedPongs >= 2) {
                        console.warn("⚠️ 2 consecutive pongs missed — connection is dead");
                        this.stopHeartbeat();
                        this.isConnected = false;
                        this.ws.onclose = null;         // skip normal onclose logic
                        this.ws.close();
                        this.ws = null;
                        this.scheduleReconnect();
                        return;
                    }

                    this.missedPongs++;                 // assume missed until pong arrives
                    this.ws.send(JSON.stringify({
                        action: "heartbeat",
                        timestamp: new Date().toISOString()
                    }));
                    console.log(`💓 Heartbeat sent (missed pongs: ${this.missedPongs - 1})`);
                } catch (error) {
                    console.error("❌ Failed to send heartbeat:", error);
                    this.stopHeartbeat();
                }
            } else {
                console.warn("⚠️ Cannot send heartbeat - socket not open");
                this.stopHeartbeat();
            }
        }, this.HEARTBEAT_INTERVAL);

        console.log("✅ Heartbeat started (15s interval)");
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            this.missedPongs = 0;
            console.log("🛑 Heartbeat stopped");
        }
    }

    handleMessage(message) {
        switch (message.action) {
            case "connected":
                console.log("✅ Server acknowledged connection");
                break;  // ← stops it hitting default

            case "ping":
                if (this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ action: "pong", timestamp: new Date().toISOString() }));
                }
                break;

            // ✅ Clean up "Unknown Action" logs for bank responses
            case "terminal_check_started_response":
            case "payment_response_received_response":
            case "payment_failed":
            case "payment_failed_response":
                console.log(`ℹ️ Terminal Signal: ${message.action}`);
                break;

            case "cache_updated":
                this.handleCacheUpdate(message);
                break;

            case "order_deleted":
            case "cache_cleared":
                if (!window.isPaymentInProgress) {
                    this.handleOrderDeleted(message);
                }
                break;

            case "order_item_deleted":
                console.log("🗑️ Item deleted - processing...");
                this.handleItemDeleted(message);
                break;

            case "delete_item_response":
                console.log("✅ Delete response received:", message);
                this.handleDeleteResponse(message);
                break;

            case "delete_order_response":
                console.log("✅ Delete order response:", message);
                this.handleDeleteOrderResponse(message);
                break;

            case "payment_synced":
                console.log("💳 Payment synced - processing...");
                this.handlePaymentSync(message);
                break;

            case "payment_complete":
                console.log("💳 Payment complete from POS - processing...");
                this.handlePOSPaymentComplete(message);
                break;

            case "ordering_page_closed":
                console.log("🚫 Ordering page closed - processing...");
                this.handlePOSOrderingPageClosed(message);
                break;

            case "payment_page_closed":
                console.log("🚫 Payment page closed - processing...");
                this.handlePOSPaymentPageClosed(message);
                break;


            case "update_acknowledged":
                console.log("✅ Update confirmed:", message.orderId);
                break;

            case "clear_order":
                console.log("🗑️ Clear order received - processing...");
                this.handleOrderDeleted(message);
                break;

            case "set_service_type":
                console.log("🖥️ POS triggered service type selection...");
                this.handlePOSServiceTypeSelection(message);
                break;


            case "member_login": {
                const phoneNumber = message.phoneNumber;
                if (!phoneNumber) {
                    console.warn('⚠️ member_login received but no phoneNumber');
                    break;
                }
                console.log('👤 Member login synced from POS:', phoneNumber);

                const phoneInput = document.getElementById('phoneNumber');
                if (phoneInput) {
                    phoneInput.value = phoneNumber;
                }

                (async () => {
                    try {
                        // handleMemberLogin is exported to window in eber.js
                        if (typeof window.handleMemberLogin === 'function') {
                            await window.handleMemberLogin(null);
                        } else {
                            console.error('❌ window.handleMemberLogin not found');
                        }
                    } catch (err) {
                        console.error('❌ Member login sync error:', err);
                    }
                })();

                break;
            }

            case "member_auto_login":
                console.log("🚀 Member auto login from POS:", message.member);
                if (message.member) {
                    window.currentMember = message.member;
                    displayMemberBadge(message.member);
                    updateOrderWithMemberInfo(message.member);
                    updateVoucherUI();
                    showOrderTypeSelection();
                }
                break;

            case 'voucher_modal_open': {
                console.log('🎟️ [WS] Remote: open voucher modal');
                if (typeof window.openVouchersModal === 'function') {
                    window.openVouchersModal();
                }
                break;
            }

            case 'voucher_modal_close': {
                console.log('🔒 [WS] Remote: close voucher modal');
                if (typeof window.closeVouchersModal === 'function') {
                    window.closeVouchersModal();
                }
                break;
            }

            case 'voucher_modal_ack': {
                const evt = message.event;
                console.log('🔄 [WS] Voucher modal ack:', evt);
                break;
            }

            case 'voucher_filter_change': {
                const filterType = message.filterType;
                console.log('🔍 [WS] Remote: filter vouchers:', filterType);
                if (typeof window.filterVouchers === 'function') {
                    window.filterVouchers(filterType);
                }
                break;
            }

            case 'voucher_apply': {
                const { voucherCode } = message;
                console.log('💳 [WS] Remote: apply voucher:', voucherCode);
                if (typeof window.handleVoucherApply === 'function') {
                    window.handleVoucherApply(voucherCode);
                }
                break;
            }

            case 'voucher_apply_result': {
                const { success, voucherCode, voucherName, discount, error } = message;
                console.log('💳 [WS] Voucher apply result:', { success, voucherCode, discount });
                window.dispatchEvent(new CustomEvent('voucherApplyResult', {
                    detail: { success, voucherCode, voucherName, discount, error }
                }));
                break;
            }

            case 'voucher_remove': {
                const { voucherCode } = message;
                console.log('🗑️ [WS] Remote: remove voucher:', voucherCode);
                if (typeof window.removeVoucherAndRecalculate === 'function') {
                    window.removeVoucherAndRecalculate(voucherCode);
                }
                break;
            }

            case 'voucher_remove_result': {
                const { success, voucherCode, error } = message;
                console.log('🗑️ [WS] Voucher remove result:', { success, voucherCode });
                window.dispatchEvent(new CustomEvent('voucherRemoveResult', {
                    detail: { success, voucherCode, error }
                }));
                break;
            }

            case 'member_logout': {
                const { reason } = message;
                console.log('👋 [WS] Remote: member logout, reason:', reason);
                if (typeof window.logoutMember === 'function') {
                    window.logoutMember(false); // don't redirect
                }
                break;
            }

            case 'member_logout_ack': {
                const { success } = message;
                console.log('👋 [WS] Member logout ack:', success);
                window.dispatchEvent(new CustomEvent('memberLogoutAck', {
                    detail: { success }
                }));
                break;
            }

            case 'member_login_response': {
                // Kiosk confirmed the login back to POS
                const { success, memberName, memberPhone, memberId, memberPoints, memberTier, error } = data;
                console.log('👤 [WS] Member login response from kiosk:', { success, memberName });
                window.dispatchEvent(new CustomEvent('memberLoginConfirmed', {
                    detail: { success, memberName, memberPhone, memberId, memberPoints, memberTier, error }
                }));
                break;
            }

            case 'voucher_state_sync': {
                console.log('🔄 [WS] Voucher state sync');
                if (typeof window.updateVoucherUI === 'function') {
                    window.updateVoucherUI();
                }
                break;
            }

            default:
                console.log("⚠️ Unknown action:", message.action, message);
        }
    }
    async handlePOSServiceTypeSelection(message) {
        const { serviceType, language } = message;

        console.log("🖥️ POS service type selection:", { serviceType, language });

        if (!serviceType || (serviceType !== 'T' && serviceType !== 'E')) {
            console.warn("⚠️ Invalid serviceType from POS:", serviceType);
            return;
        }

        // Guard: only auto-select if customer hasn't started ordering yet
        const landingOverlay = document.getElementById("landingOverlay");
        const isLandingVisible = landingOverlay && !landingOverlay.classList.contains("hidden");

        if (!isLandingVisible) {
            console.warn("⚠️ Customer mid-order — ignoring POS service type trigger");
            return;
        }

        console.log("✅ Auto-selecting service type from POS:", serviceType);
        await selectOrderType(serviceType, language || "en");
    }

    async handlePOSOrderingPageClosed(message) {
        console.log("🚫 Processing ordering_page_closed:", message);

        const { deviceId, outlet, reason } = message;
        const myDeviceId = localStorage.getItem("sok_device_id");

        // ✅ FIX: Check storename FIRST, then sok_location
        const myOutlet = localStorage.getItem("storename") || localStorage.getItem("sok_location");

        console.log("🔍 Ordering closed comparison:", {
            message: { deviceId, outlet },
            local: { deviceId: myDeviceId, outlet: myOutlet }
        });

        // ✅ IMPROVED: Case-insensitive, trimmed comparison
        const normalizeOutlet = (str) => (str || '').trim().toLowerCase();
        const isForMyOutlet = outlet && myOutlet &&
            normalizeOutlet(outlet) === normalizeOutlet(myOutlet);

        console.log("🔍 Match check:", {
            messageOutlet: normalizeOutlet(outlet),
            myOutlet: normalizeOutlet(myOutlet),
            match: isForMyOutlet
        });

        if (isForMyOutlet) {
            console.log("✅ Ordering closed for our outlet - starting cleanup");

            // 1. Store closure information
            localStorage.setItem('ordering_page_status', 'closed');
            localStorage.setItem('ordering_closed_reason', reason || 'Ordering temporarily unavailable');
            localStorage.setItem('ordering_closed_timestamp', Date.now());

            // 2. Show notification to user
            this.showUpdateNotification(
                "⚠️ POS back to Active Orders page", ""
            );
            await startOverFromPOS();

        } else {
            console.log("⏭️ Ordering closed for different outlet, ignoring");
            console.log(`   Expected: "${myOutlet}"`);
            console.log(`   Received: "${outlet}"`);
        }
    }

    async handlePOSPaymentPageClosed(message) {
        console.log("🚫 Processing ordering_page_closed:", message);

        const { deviceId, outlet, reason } = message;
        const myDeviceId = localStorage.getItem("sok_device_id");

        // ✅ FIX: Check storename FIRST, then sok_location
        const myOutlet = localStorage.getItem("storename") || localStorage.getItem("sok_location");

        console.log("🔍 Ordering closed comparison:", {
            message: { deviceId, outlet },
            local: { deviceId: myDeviceId, outlet: myOutlet }
        });

        // ✅ IMPROVED: Case-insensitive, trimmed comparison
        const normalizeOutlet = (str) => (str || '').trim().toLowerCase();
        const isForMyOutlet = outlet && myOutlet &&
            normalizeOutlet(outlet) === normalizeOutlet(myOutlet);

        console.log("🔍 Match check:", {
            messageOutlet: normalizeOutlet(outlet),
            myOutlet: normalizeOutlet(myOutlet),
            match: isForMyOutlet
        });

        if (isForMyOutlet) {
            console.log("✅ Ordering closed for our outlet - starting cleanup");

            // 1. Store closure information
            localStorage.setItem('ordering_page_status', 'closed');
            localStorage.setItem('ordering_closed_reason', reason || 'Ordering temporarily unavailable');
            localStorage.setItem('ordering_closed_timestamp', Date.now());

            // 2. Show notification to user
            this.showUpdateNotification(
                "⚠️ POS back to order page.", ""
            );

        } else {
            console.log("⏭️ Ordering closed for different outlet, ignoring");
            console.log(`   Expected: "${myOutlet}"`);
            console.log(`   Received: "${outlet}"`);
        }
    }

    handleDeleteResponse(message) {
        console.log("🔍 Processing delete response:", message);

        if (!message.success) {
            console.error("❌ Delete failed:", message.error);
            this.showUpdateNotification("Delete Failed", message.error);
            return;
        }

        if (message.orderDeleted) {
            console.log("⚠️ Last item deleted - clearing order");
            this.clearOrderState();
            this.showUpdateNotification("Order Deleted", "Last item removed");
        } else {
            console.log("✅ Item deleted, fetching updated order...");
            setTimeout(() => this.syncOrderFromCache(false), this.SYNC_DELAY);
        }
    }

    handleDeleteOrderResponse(message) {
        console.log("🔍 Processing delete order response:", message);

        if (!message.success) {
            console.error("❌ Delete order failed:", message.error);
            this.showUpdateNotification("Delete Failed", message.error);
            return;
        }

        this.clearOrderState();
        this.showUpdateNotification("Order Deleted", "Order removed successfully");
    }

    handlePaymentSync(message) {
        console.log("💳 Processing payment sync:", message);

        // ✅ Extract metadata (where salesNo is correctly populated)
        const metadata = message.metadata || {};
        const {
            deviceId,
            orderId,
            salesNo,
            tableNo,
            orderType,
            status,
            paymentMethod,
            totalAmount,
            transactionId,
            receiptNumber
        } = metadata;

        console.log("📊 Payment sync metadata:", {
            deviceId,
            orderId,
            salesNo, // ✅ This has the correct value
            paymentMethod,
            totalAmount
        });

        // ✅ Extract and fix orderData array
        const orderDataArray = message.orderData || [];

        const paymentLedger = message.paymentLedger || [];  // ← already sent from Payment.js

        if (orderDataArray.length > 0 && paymentLedger.length > 0) {
            orderDataArray.forEach(orderData => {
                // ✅ Override DB payment info with actual ledger
                orderData.sales_payment_dtls = paymentLedger.map((p, i) => ({
                    payment_name: p.payment_name,   // "MASTER ****8784"
                    payment_type: p.payment_type,
                    s_no: i + 1,
                    tender_amt: parseFloat(p.tender_amt),
                    ref_info: p.ref_info || '',
                    currency_name: '',
                    exch_rate: 1,
                    currency_amount: 0
                }));
                console.log('✅ Fixed sales_payment_dtls from ledger:', orderData.sales_payment_dtls);
            });
        
        }
        else {
            console.warn("⚠️ No orderData or salesNo to update");
        }

        const myDeviceId = localStorage.getItem("sok_device_id");
        const myTableNo = localStorage.getItem("tableNo");

        console.log("🔍 Device comparison:", {
            message: { deviceId, tableNo },
            local: { deviceId: myDeviceId, tableNo: myTableNo }
        });

        if (deviceId === myDeviceId || tableNo === myTableNo) {
            console.log("✅ Payment sync is for our device/table");

            // ✅ Update store with corrected orderData BEFORE clearing
            if (orderDataArray.length > 0) {
                try {
                    const { setOrder, setLastSNo } = useOrder();
                    const updatedOrderData = orderDataArray[0]; // Use first order

                    console.log("💾 Updating store with payment-synced orderData:");
                    console.log(`   └─ sales_no: ${updatedOrderData.sales_no}`);
                    console.log(`   └─ server_order_id: ${updatedOrderData.server_order_id}`);
                    console.log(`   └─ net_amt: ${updatedOrderData.net_amt}`);

                    // Update Zustand store
                    setOrder(updatedOrderData);

                    const salesDtls = updatedOrderData.sales_dtls || [];
                    const lastSNo = salesDtls.length > 0
                        ? Math.max(...salesDtls.map(i => parseInt(i.s_no) || 0))
                        : 0;
                    setLastSNo(lastSNo);

                    // Update localStorage
                    const existingCache = JSON.parse(localStorage.getItem("order") || '{}');
                    localStorage.setItem("order", JSON.stringify({
                        ...existingCache,
                        state: {
                            ...existingCache.state,
                            order: updatedOrderData,
                            lastSNo
                        },
                        version: (existingCache.version || 0) + 1
                    }));

                    console.log("✅ Store and localStorage updated with sales_no");
                } catch (error) {
                    console.error("❌ Error updating store with payment sync:", error);
                }
            }

            // Now clear the order state (after saving the final version)
            this.clearOrderState();

            this.showPaymentNotification(
                "Payment Confirmed",
                `Order ${salesNo || orderId} paid via ${paymentMethod}`,
                "success"
            );

            if (typeof window.updateOrderStatus === "function") {
                window.updateOrderStatus(orderId, "paid");
            }

            window.dispatchEvent(new CustomEvent('paymentCompleted', {
                detail: {
                    orderId,
                    salesNo,
                    paymentMethod,
                    totalAmount,
                    transactionId,
                    receiptNumber,
                    orderData: orderDataArray[0] // ✅ Include corrected orderData
                }
            }));

            console.log("✅ Payment sync processed successfully");
            console.log(`   └─ Sales No: ${salesNo}`);
            console.log(`   └─ Order ID: ${orderId}`);
            console.log(`   └─ Transaction: ${transactionId}`);
        } else {
            console.log("⏭️ Payment sync for different device, ignoring");
        }
    }

    handlePOSPaymentComplete(message) {
        console.log("💳 Processing POS payment complete:", message);

        const {
            deviceId,
            orderId,
            salesNo,
            tableNo,
            orderType,
            paymentMethod,
            totalAmount,
            paidAmount,
            changeAmount,
            transactionId,
            receiptNumber
        } = message;

        // ✅ Extract and fix orderData array
        const orderDataArray = message.orderData || [];

        if (orderDataArray.length > 0 && salesNo) {
            console.log(`🔧 Fixing ${orderDataArray.length} orderData object(s) with salesNo: ${salesNo}`);
            orderDataArray.forEach((orderData, index) => {
                if (!orderData.sales_no || orderData.sales_no === "") {
                    orderData.sales_no = salesNo;
                    console.log(`✅ [${index}] Set orderData.sales_no = ${salesNo}`);
                } else {
                    console.log(`ℹ️ [${index}] orderData.sales_no already set: ${orderData.sales_no}`);
                }
            });
        } else {
            console.warn("⚠️ No orderData or salesNo to update");
        }

        const myDeviceId = localStorage.getItem("sok_device_id");
        const myTableNo = localStorage.getItem("tableNo");

        if (deviceId === myDeviceId || tableNo === myTableNo) {
            console.log("✅ POS payment is for our device/table");

            // ✅ Update store with corrected orderData BEFORE clearing
            if (orderDataArray.length > 0) {
                try {
                    const { setOrder, setLastSNo } = useOrder();
                    const updatedOrderData = orderDataArray[0];

                    console.log("💾 Updating store with POS payment orderData:");
                    console.log(`   └─ sales_no: ${updatedOrderData.sales_no}`);
                    console.log(`   └─ server_order_id: ${updatedOrderData.server_order_id}`);
                    console.log(`   └─ net_amt: ${updatedOrderData.net_amt}`);

                    setOrder(updatedOrderData);

                    const salesDtls = updatedOrderData.sales_dtls || [];
                    const lastSNo = salesDtls.length > 0
                        ? Math.max(...salesDtls.map(i => parseInt(i.s_no) || 0))
                        : 0;
                    setLastSNo(lastSNo);

                    const existingCache = JSON.parse(localStorage.getItem("order") || '{}');
                    localStorage.setItem("order", JSON.stringify({
                        ...existingCache,
                        state: {
                            ...existingCache.state,
                            order: updatedOrderData,
                            lastSNo
                        },
                        version: (existingCache.version || 0) + 1
                    }));

                    console.log("✅ Store and localStorage updated with sales_no");
                } catch (error) {
                    console.error("❌ Error updating store with POS payment:", error);
                }
            }

            this.clearOrderState();

            let paymentMessage = `Order #${salesNo || orderId}\n`;
            paymentMessage += `Payment: ${paymentMethod.toUpperCase()}\n`;
            paymentMessage += `Total: $${parseFloat(totalAmount).toFixed(2)}`;

            if (paidAmount > totalAmount) {
                paymentMessage += `\nPaid: $${parseFloat(paidAmount).toFixed(2)}`;
                paymentMessage += `\nChange: $${parseFloat(changeAmount).toFixed(2)}`;
            }

            if (transactionId) {
                paymentMessage += `\nTransaction: ${transactionId}`;
            }

            this.showPaymentNotification(
                "Payment Successful",
                paymentMessage,
                "success"
            );

            if (typeof window.updateOrderStatus === "function") {
                window.updateOrderStatus(orderId, "paid");
            }

            window.dispatchEvent(new CustomEvent('posPaymentCompleted', {
                detail: {
                    orderId,
                    salesNo,
                    paymentMethod,
                    totalAmount,
                    paidAmount,
                    changeAmount,
                    transactionId,
                    orderData: orderDataArray[0] // ✅ Include corrected orderData
                }
            }));

            console.log("✅ POS payment processed");
            console.log(`   └─ Sales No: ${salesNo}`);
            console.log(`   └─ Order ID: ${orderId}`);
            console.log(`   └─ Transaction: ${transactionId}`);
        } else {
            console.log("⏭️ POS payment for different device, ignoring");
        }
    }

    async notifyPaymentComplete(paymentData) {
        try {
            const deviceId = localStorage.getItem("sok_device_id");
            const tableNo = localStorage.getItem("tableNo");
            const orderType = localStorage.getItem("orderType");

            if (!deviceId) {
                console.error("❌ Missing device ID");
                return { success: false, error: "Device ID not found" };
            }

            const payload = {
                deviceId: deviceId,
                orderId: paymentData.orderId || paymentData.sales_no,
                salesNo: paymentData.sales_no,
                tableNo: tableNo || '',
                orderType: orderType || 'E',
                paymentMethod: paymentData.paymentMethod || 'cash',
                totalAmount: parseFloat(paymentData.totalAmount || 0),
                paidAmount: parseFloat(paymentData.paidAmount || paymentData.totalAmount || 0),
                changeAmount: parseFloat(paymentData.changeAmount || 0),
                transactionId: paymentData.transactionId || '',
                receiptNumber: paymentData.receiptNumber || paymentData.sales_no,
                orderData: paymentData.orderData || null
            };

            console.log('💳 Sending payment notification:', payload);

            const response = await fetch('/API/SOKOrder/payment-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Payment notification failed:', response.status, errorText);
                return { success: false, error: `Server error: ${response.status}` };
            }

            const result = await response.json();

            if (result.success) {
                console.log('✅ Payment notification sent successfully:', result);
                console.log(`   └─ Notified ${result.posBroadcastCount} POS device(s)`);
                console.log(`   └─ Synced to ${result.sokBroadcastCount} SOK device(s)`);

                this.showPaymentNotification("Payment Sent", "POS has been notified", "success");
                return { success: true, data: result };
            } else {
                console.error('❌ Payment notification failed:', result);
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error('❌ Error sending payment notification:', error);
            return { success: false, error: error.message };
        }
    }

    showPaymentNotification(title, message, type = "info") {
        console.log(`💳 ${title}: ${message}`);

        const toast = document.createElement('div');
        toast.className = `sok-notification payment-notification ${type}`;

        const icon = type === "success" ? "✅" : type === "error" ? "❌" : "💳";

        toast.innerHTML = `
        <div class="sok-notification-content">
            <div class="notification-icon">${icon}</div>
            <div class="notification-text">
                <strong>${title}</strong>
                <p>${message.replace(/\n/g, '<br>')}</p>
            </div>
        </div>
    `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 5000);

        toast.addEventListener('click', () => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        });
    }

    handleCacheUpdate(message) {
        // 1. INITIALIZATION PROTECTION LAYER
        // Check if we are in a 'Start Over' or 'Fresh Boot' sequence
        const isStartingOver = localStorage.getItem('pos_start_over') === 'true';
        const isWarmBoot = sessionStorage.getItem('skip_api_on_load') === 'true';
        const isInitializing = window.isFreshBoot || isStartingOver || isWarmBoot;

        if (isInitializing && message.action === 'cache_updated') {
            console.log("🚫 [WS Sync Blocked] App is initializing or starting over. Ignoring server cache to prevent state wipe.");
            return;
        }

        // 2. ACTIVE INTERACTION BLOCK
        if (window._blockWSSync) {
            console.log('🛑 [WS Sync Blocked] addToCart in progress, ignoring cache_updated');
            return;
        }

        console.log("=".repeat(60));
        console.log("📦 HANDLE CACHE UPDATE - START");
        console.log("=".repeat(60));
        console.log("📩 Message received:", JSON.stringify(message, null, 2));

        const { orderData, summary, deviceId: messageDeviceId, tableNo: messageTableNo, outlet: messageOutlet } = message;
        const myDeviceId = localStorage.getItem("sok_device_id");
        const myTableNo = localStorage.getItem("tableNo");
        const myLocation = localStorage.getItem("storename") || localStorage.getItem("sok_location");

        console.log("🔍 Comparison:", {
            message: { deviceId: messageDeviceId, tableNo: messageTableNo, outlet: messageOutlet },
            local: { deviceId: myDeviceId, tableNo: myTableNo, location: myLocation }
        });

        const isSameDevice = messageDeviceId === myDeviceId;
        const isSameTable = messageTableNo && messageTableNo === myTableNo;
        const isSameOutlet = messageOutlet && messageOutlet === myLocation;
        const shouldSync = isSameDevice || isSameTable || isSameOutlet;

        console.log("🎯 Sync Decision:", { isSameDevice, isSameTable, isSameOutlet, shouldSync });

        if (!shouldSync) {
            console.log("🚫 IGNORING - Not my device/table/outlet");
            console.log("=".repeat(60));
            return;
        }

        console.log(`✅ PROCESSING - Match found (${isSameDevice ? 'device' : isSameTable ? 'table' : 'outlet'})`);

        if (!orderData) {
            console.warn("⚠️ No orderData in message");
            console.log("=".repeat(60));
            return;
        }

        try {
            const { order, setOrder, setLastSNo } = useOrder();

            // 3. VOUCHER PRESERVATION LOGIC
            const hasVoucherApplied = order?.voucher_code && order?.voucher_discount;

            if (hasVoucherApplied) {
                console.log('⚠️ Voucher is applied locally - preserving voucher data');

                const mergedOrderData = {
                    ...orderData,
                    voucher_code: order.voucher_code,
                    voucher_name: order.voucher_name,
                    voucher_discount: order.voucher_discount,
                    total_disc: order.total_disc,
                    total_svc: order.total_svc,
                    total_tax: order.total_tax,
                    net_amt: order.net_amt,
                    final_amt: order.final_amt
                };

                const salesDtls = mergedOrderData.sales_dtls || [];
                const lastSNo = salesDtls.length > 0
                    ? Math.max(...salesDtls.map(i => parseInt(i.s_no) || 0))
                    : 0;

                console.log("💾 Updating store with voucher preservation:", {
                    itemCount: salesDtls.length, lastSNo, netAmount: mergedOrderData.net_amt
                });

                setOrder(mergedOrderData);
                setLastSNo(lastSNo);

                const existingCache = JSON.parse(localStorage.getItem("order") || '{}');
                localStorage.setItem("order", JSON.stringify({
                    ...existingCache,
                    state: { ...existingCache.state, order: mergedOrderData, lastSNo },
                    version: (existingCache.version || 0) + 1
                }));

                this.updateUIImmediate(mergedOrderData);

                const itemCount = salesDtls.filter(i => i.s_no === i.parent_sno).length;
                this.showUpdateNotification(
                    "Order Updated",
                    `${itemCount} items • $${parseFloat(order.net_amt || 0).toFixed(2)}`
                );

                this.pulseCartContainer();
                console.log("✅ Cache update processed with voucher preservation");
                console.log("=".repeat(60));
                return;
            }

            // 4. STANDARD SYNC LOGIC
            const salesDtls = orderData.sales_dtls || [];
            const lastSNo = salesDtls.length > 0
                ? Math.max(...salesDtls.map(i => parseInt(i.s_no) || 0))
                : 0;

            console.log("💾 Updating store (no voucher):", {
                itemCount: salesDtls.length, lastSNo, netAmount: orderData.net_amt
            });

            setOrder(orderData);
            setLastSNo(lastSNo);

            const existingCache = JSON.parse(localStorage.getItem("order") || '{}');
            localStorage.setItem("order", JSON.stringify({
                ...existingCache,
                state: { ...existingCache.state, order: orderData, lastSNo },
                version: (existingCache.version || 0) + 1
            }));

            this.updateUIImmediate(orderData);

            const itemCount = salesDtls.filter(i => i.s_no === i.parent_sno).length;
            this.showUpdateNotification(
                "Order Updated",
                `${itemCount} items • $${parseFloat(summary?.netAmount || orderData.net_amt || 0).toFixed(2)}`
            );

            this.pulseCartContainer();
            console.log("✅ Cache update processed successfully");
            console.log("=".repeat(60));

        } catch (error) {
            console.error("❌ Error handling cache update:", error);
            console.error("Stack:", error.stack);
            console.log("=".repeat(60));
        }
    }



    handleOrderDeleted(message) {
        console.log("🗑️ Processing order deletion:", message);

        const myDeviceId = localStorage.getItem("sok_device_id");

        if (message.deviceId && message.deviceId !== myDeviceId) {
            console.log(`🚫 Ignoring cache_cleared from different device: ${message.deviceId} (mine: ${myDeviceId})`);
            return;
        }

        console.log("🧹 Clearing order state due to deletion");
        this.clearOrderState();

        this.showUpdateNotification(
            "Order Deleted",
            `Order ${message.queueNumber || message.orderId || ''} removed`
        );

        const bottomNav = document.querySelector(".bottom-nav");
        if (bottomNav) {
            bottomNav.style.animation = "flash 0.5s ease-in-out";
        }

        console.log("✅ Order deletion handled");
    }

    handleItemDeleted(message) {
        console.log("🗑️ Processing item deletion:", message);

        const myDeviceId = localStorage.getItem("sok_device_id");

        if (message.deviceId && message.deviceId !== myDeviceId) {
            console.log(`🗑️ Item deletion from different device: ${message.deviceId}`);
        }

        if (message.orderDeleted) {
            console.log("⚠️ Order was deleted (last item)");
            this.clearOrderState();
            this.showUpdateNotification("Order Deleted", "Last item removed");
        } else {
            console.log("🔄 Item deleted, syncing order...");
            setTimeout(() => this.syncOrderFromCache(false), this.SYNC_DELAY);

            this.showUpdateNotification(
                "Item Removed",
                `${message.deletedItem?.name || 'Item'} removed • ${message.remainingItems} left`
            );
        }
    }



    async syncOrderFromCache(silent = false) {

        // === 0. BLOCK WS SYNC ON LOAD (post start-over) ===========================
        // Must be FIRST — before any other check, to prevent Cold Start wipe
        // racing against the first addToCart after a start-over reload.
        if (sessionStorage.getItem('block_ws_sync_on_load') === 'true') {
            sessionStorage.removeItem('block_ws_sync_on_load');
            console.log("⏭️ syncOrderFromCache blocked — post start-over load, skipping Cold Start wipe");
            return;
        }

        // === 0b. POS START-OVER GUARD =============================================
        if (sessionStorage.getItem('pos_start_over') === 'true') {
            console.log("⏭️ syncOrderFromCache skipped — POS start-over reload detected");
            sessionStorage.removeItem('pos_start_over');
            sessionStorage.removeItem('skip_api_on_load');
            return;
        }

        // === 1. TOP-LEVEL GUARDS ==================================================
        // ✅ FIX: Check isAddingToCart alongside _blockWSSync
        if (window._blockWSSync || window.isAddingToCart) {
            if (window.__isReload) return;
            console.log("⏸️ syncOrderFromCache blocked — addToCart in progress");
            return;
        }

        if (window._isPrintingSafeZone) {
            console.log("🛡️ Sync Blocked: Global Printing Safe Zone active. Preventing Cold Start wipe.");
            return;
        }
        if (window.isPaymentInProgress) {
            console.log("🛑 Sync blocked: Payment is currently in progress. Preserving local cart.");
            return;
        }

        const timeSinceFinalized = Date.now() - (this.lastFinalizedTimestamp || 0);
        if (timeSinceFinalized < (this.PROTECTION_WINDOW_MS || 15000)) {
            console.log("🛡️ Sync Protection: Order recently finalized. Skipping 'Fresh Boot' check.");
            return;
        }

        // HELPER: Direct localStorage access (Safe for vanilla JS / WebSockets)
        const getLocalStore = () => JSON.parse(localStorage.getItem("order") || '{}');
        const getLocalOrder = () => getLocalStore()?.state?.order || null;

        // === 2. BOOT TYPE IDENTIFICATION ==========================================
        const localOrder = getLocalOrder();
        const hasLocalItems = localOrder?.sales_dtls?.length > 0;
        const hasOrderId = !!(
            localStorage.getItem('currentOrderId') ||
            localStorage.getItem('orderId') ||
            localStorage.getItem('current_order_id')
        );
        const isWarmBoot = sessionStorage.getItem('skip_api_on_load') === 'true';

        const orderTypeSelected = !!localStorage.getItem('orderType');
        const menuVisible = !!document.querySelector('.menu-grid, .menu-container, #menuGrid');

        const isFreshBoot = !hasOrderId && !hasLocalItems;


        // === 3. FRESH BOOT & WARM BOOT LOGIC =====================================
        if (isFreshBoot) {
            if (isWarmBoot) {
                console.log("⚡ Warm boot detected: Bypassing fresh boot clear.");
                sessionStorage.removeItem('skip_api_on_load');
                return;
            }

            // ✅ FIX: Don't wipe if user already selected order type and menu is showing
            if (orderTypeSelected && menuVisible) {
                console.log("⏭️ Fresh boot clear skipped — order type selected and menu is visible");
                return;
            }

            const landingOverlay = document.getElementById('landingOverlay');
            const isOnLandingScreen = landingOverlay && !landingOverlay.classList.contains('hidden');

            if (isOnLandingScreen || window.isSelectingOrderType) {
                console.log("⏭️ Fresh boot clear skipped — landing screen or order type selection active");
                return;
            }

            if (window.isAddingToCart || window._blockWSSync) {
                console.log("🛑 Cold Start wipe BLOCKED — addToCart is in progress");
                return;
            }


            console.log("❄️ Fresh boot (Cold Start) confirmed — clearing server/local state");

            const deviceId = localStorage.getItem("sok_device_id");
            const outlet = localStorage.getItem("storename") || localStorage.getItem("sok_location");

            if (deviceId && outlet) {
                fetch(`/API/SOKOrder/${outlet}/${deviceId}/cache/clear`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                }).catch(e => console.warn("⚠️ Could not clear stale server cache:", e));
            }

            this.clearOrderState(true);
            return;
        }

        // === 4. CONCURRENCY GUARD =================================================
        if (this.pendingSync) return;
        this.pendingSync = true;

        // === 5. FETCH SERVER CACHE ================================================
        try {
            const deviceId = localStorage.getItem("sok_device_id");
            if (!deviceId) {
                console.warn("⚠️ No device ID found for sync");
                return;
            }

            console.log(`🔄 Syncing order from cache${silent ? ' (background)' : ''}...`);

            const res = await fetch(`/API/SOKOrder/order-cache/${deviceId}`, {
                method: "GET",
                headers: { "Content-Type": "application/json" }
            });

            if (!res.ok) {
                if (res.status === 404) {
                    console.log("📭 No cached order on server");
                    if (hasLocalItems) {
                        console.log(`💾 Keeping local order with ${localOrder.sales_dtls.length} items`);
                        const { default: GetHomeAPI } = await import('./GetHomeAPI.js');
                        const updater = GetHomeAPI?.updateOrderCacheOnServer || window.updateOrderCacheOnServer;
                        if (typeof updater === 'function') {
                            await updater(localOrder);
                        }
                    } else {
                        this.clearOrderState();
                    }
                } else {
                    console.error("❌ Sync failed:", res.status, res.statusText);
                }
                return;
            }

            const result = await res.json();
            let serverOrderData = result.cache?.orderData;

            if (!serverOrderData) {
                if (!hasLocalItems) {
                    console.log("📝 No local or server order - clearing state");
                    this.clearOrderState();
                }
                return;
            }

            // === 6. DATA MERGING & UI UPDATE ======================================
            const hasVoucherApplied = localOrder?.voucher_code && localOrder?.voucher_discount;
            if (hasVoucherApplied) {
                console.log('⚠️ Voucher applied locally - preserving during sync');
                serverOrderData = {
                    ...serverOrderData,
                    voucher_code: localOrder.voucher_code,
                    voucher_name: localOrder.voucher_name,
                    voucher_discount: localOrder.voucher_discount
                };
            }

            const salesDtls = serverOrderData.sales_dtls || [];
            const lastSNo = salesDtls.length > 0
                ? Math.max(...salesDtls.map(i => parseInt(i.s_no) || 0))
                : 0;

            const existingCache = getLocalStore();
            localStorage.setItem("order", JSON.stringify({
                ...existingCache,
                state: {
                    ...existingCache.state,
                    order: serverOrderData,
                    lastSNo: lastSNo
                },
                version: (existingCache.version || 0) + 1
            }));

            this.updateUIImmediate(serverOrderData);

            const itemCount = salesDtls.filter(i => i.s_no === i.parent_sno).length;
            if (!silent && itemCount > 0) {
                const displayTotal = hasVoucherApplied ? localOrder.net_amt : serverOrderData.net_amt;
                this.showUpdateNotification(
                    "Order Synced",
                    `${itemCount} items • $${parseFloat(displayTotal || 0).toFixed(2)}`
                );
                this.pulseCartContainer();
            }

            console.log(`✅ Sync complete: ${salesDtls.length} items. Focus recovered.`);

        } catch (error) {
            console.error("❌ Sync error:", error);
        } finally {
            this.pendingSync = false;
        }
    }


    updateUIImmediate(orderData) {
        console.log("🎨 IMMEDIATE UI update with order data");

        const salesDtls = orderData.sales_dtls || [];
        const itemCount = salesDtls.filter(i => i.s_no === i.parent_sno).length;

        console.log("🔢 UI Update - Items:", itemCount, "Total:", orderData.net_amt);

        const badge = document.getElementById("cartBadge");
        if (badge) {
            badge.textContent = itemCount;
            badge.style.display = itemCount > 0 ? "flex" : "none";
            console.log("✅ Cart badge updated:", itemCount);
        }

        const navSubtotal = document.getElementById("navSubtotal");
        if (navSubtotal) {
            navSubtotal.textContent = `$${parseFloat(orderData.net_amt || 0).toFixed(2)}`;
            navSubtotal.style.display = itemCount > 0 ? "block" : "none";
            console.log("✅ Nav subtotal updated:", orderData.net_amt);
        }

        this.callRenderFunctions();

        window.dispatchEvent(new CustomEvent('orderUpdated', {
            detail: { orderData, itemCount }
        }));

        this.forceRepaint();
    }

    forceRepaint() {
        const root = document.body;
        if (!root) return;

        root.style.opacity = '0.9999';
        root.offsetHeight;
        root.style.opacity = '';
    }

    callRenderFunctions() {
        try {
            if (typeof renderCartFromOrder === "function") {
                console.log("🎨 Calling renderCartFromOrder()");
                renderCartFromOrder();
            } else if (typeof window.renderCartFromOrder === "function") {
                console.log("🎨 Calling window.renderCartFromOrder()");
                window.renderCartFromOrder();
            } else {
                console.warn("⚠️ renderCartFromOrder function not found");
                window.dispatchEvent(new Event('cartNeedsRender'));
            }

            if (typeof updateCartCount === "function") {
                console.log("🎨 Calling updateCartCount()");
                updateCartCount();
            } else if (typeof window.updateCartCount === "function") {
                console.log("🎨 Calling window.updateCartCount()");
                window.updateCartCount();
            }
        } catch (error) {
            console.error("❌ Error calling render functions:", error);
        }
    }

    updateUI(orderData) {
        this.updateUIImmediate(orderData);
    }

    pulseCartContainer() {
        const badge = document.getElementById("cartBadge");
        const bottomNav = document.querySelector(".bottom-nav");

        [badge, bottomNav].forEach(element => {
            if (element) {
                element.style.animation = "none";
                setTimeout(() => {
                    element.style.animation = "pulse 0.5s ease-in-out";
                }, 10);
            }
        });
    }

    clearOrderState() {
        console.log("🧹 Clearing order state");

        try {
            const { order } = useOrder();

            // ✅ Only guard against clearing if not forced
            if (order && order.sales_dtls && order.sales_dtls.length > 0) {
                console.warn(`⚠️ Prevented clearing cart with ${order.sales_dtls.length} items`);
                console.log("💡 If you need to force clear, use clearOrderState(true)");
                return;
            }

            const { setOrder, setLastSNo, clearOrder } = useOrder();
            const emptyOrder = {
                sales_dtls: [],
                sub_total: "0.00",
                total_tax: "0.00",
                total_svc: "0.00",
                net_amt: "0.00"
            };

            if (typeof clearOrder === "function") {
                console.log("🧹 Calling clearOrder()");
                clearOrder();
            } else {
                console.log("🧹 Setting empty order");
                setOrder(emptyOrder);
                setLastSNo(0);
            }

            localStorage.removeItem("order");
            localStorage.removeItem("currentOrder");

            this.updateUIImmediate(emptyOrder);

            window.dispatchEvent(new CustomEvent('orderCleared'));

            console.log("✅ Order state cleared successfully");
        } catch (error) {
            console.error("❌ Error clearing state:", error);
        }
    }

    async clearOrderCache(force = false) {
        try {
            const deviceId = localStorage.getItem("sok_device_id");
            const location = localStorage.getItem("storename") || localStorage.getItem("sok_location");

            if (!deviceId || !location) {
                console.error("❌ Missing deviceId or location for cache clear");
                // FALLBACK: Even if we can't tell the server, we MUST clear local state
                this.clearOrderState(true);
                return false;
            }

            if (!this.deviceInfo || !this.deviceInfo.deviceId) {
                console.warn("⚠️ Device not registered yet, skipping server cache clear");
                console.log("🧹 Clearing local order state only");
                this.clearOrderState(true);
                return false;
            }

            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                console.warn("⚠️ WebSocket not connected, skipping server cache clear");
                console.log("🧹 Clearing local order state only");
                this.clearOrderState(true);
                return false;
            }

            console.log(`🗑️ Clearing order cache for device: ${deviceId}`);

            const response = await fetch(
                `/API/SOKOrder/${location}/${deviceId}/cache/clear`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" }
                }
            );

            if (response.ok) {
                const result = await response.json();
                console.log("✅ Order cache cleared on server:", result);
                this.clearOrderState(true);
                this.showUpdateNotification("Cart Cleared", "All items removed successfully");
                return true;
            } else {
                const errorText = await response.text();
                console.error("❌ Failed to clear order cache:", response.status, errorText);

                console.log("🧹 Clearing local order state anyway");
                this.clearOrderState(true);
                return false;
            }
        } catch (error) {
            console.error("❌ Error clearing order cache:", error);

            console.log("🧹 Clearing local order state anyway");
            this.clearOrderState(true);
            return false;
        }
    }

    async deleteItem(orderId, sno) {
        if (!this.isConnected) {
            console.error("❌ WebSocket not connected");
            this.showUpdateNotification("Error", "Not connected to server");
            return false;
        }

        const deviceId = localStorage.getItem("sok_device_id");

        const message = {
            action: "delete_item",
            orderId: orderId,
            sno: sno,
            deviceId: deviceId
        };

        console.log("🗑️ Sending delete item request:", message);

        try {
            this.ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error("❌ Failed to send delete request:", error);
            this.showUpdateNotification("Error", "Failed to delete item");
            return false;
        }
    }

    async deleteOrder(orderId) {
        if (!this.isConnected) {
            console.error("❌ WebSocket not connected");
            this.showUpdateNotification("Error", "Not connected to server");
            return false;
        }

        const deviceId = localStorage.getItem("sok_device_id");

        const message = {
            action: "delete_order",
            orderId: orderId,
            deviceId: deviceId
        };

        console.log("🗑️ Sending delete order request:", message);

        try {
            this.ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error("❌ Failed to send delete order request:", error);
            this.showUpdateNotification("Error", "Failed to delete order");
            return false;
        }
    }

    showUpdateNotification(title, message) {
        console.log(`🔔 ${title}: ${message}`);

        if (!document.body) {
            console.warn("⚠️ Document body not ready for notification");
            return;
        }

        const toast = document.createElement('div');
        toast.className = 'sok-notification';
        toast.innerHTML = `
            <div class="sok-notification-content">
                <strong>${title}</strong>
                <p>${message}</p>
            </div>
        `;

        document.body.appendChild(toast);

        console.log("✅ Notification added to DOM");

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                if (toast.parentNode) toast.remove();
            }, 300);
        }, 3000);

        toast.addEventListener('click', () => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                if (toast.parentNode) toast.remove();
            }, 300);
        });
    }

    // ✅ SESSION HOOK – also stop the session timer on explicit disconnect
    disconnect() {
        console.log("🔌 Disconnecting WebSocket");
        this.stopHeartbeat();
        this.stopHealthCheck();
        this.stopSessionTimeout();                      // ← stop session timer

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }

        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            this.ws.onopen = null;
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;
        this.isInitializing = false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL INSTANCE
// ─────────────────────────────────────────────────────────────────────────────
window.sokWebSocket = new SOKOrderWebSocket();

// ─────────────────────────────────────────────────────────────────────────────
// STYLES  (original + session modal)
// ─────────────────────────────────────────────────────────────────────────────
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
    /* ── existing notification styles ── */
    .sok-notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 16px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        max-width: 300px;
    }

    .sok-notification-content strong {
        display: block;
        font-size: 14px;
        margin-bottom: 4px;
    }

    .sok-notification-content p {
        margin: 0;
        font-size: 12px;
        opacity: 0.9;
    }

    .sok-notification.fade-out {
        animation: slideOut 0.3s ease-in;
    }

    .sok-notification.payment-notification {
        min-width: 320px;
        padding: 20px;
    }

    .sok-notification.payment-notification.success {
        background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
    }

    .sok-notification.payment-notification.error {
        background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%);
    }

    .sok-notification.payment-notification:hover {
        cursor: pointer;
        transform: scale(1.02);
        transition: transform 0.2s ease;
    }

    .sok-notification.payment-notification .sok-notification-content {
        display: flex;
        align-items: flex-start;
        gap: 12px;
    }

    .sok-notification.payment-notification .notification-icon {
        font-size: 24px;
        line-height: 1;
    }

    .sok-notification.payment-notification .notification-text {
        flex: 1;
    }

    .sok-notification.payment-notification .notification-text strong {
        font-size: 16px;
        margin-bottom: 6px;
    }

    .sok-notification.payment-notification .notification-text p {
        font-size: 13px;
        line-height: 1.4;
        white-space: pre-line;
    }

    @keyframes slideIn {
        from { transform: translateX(120%); opacity: 0; }
        to   { transform: translateX(0);    opacity: 1; }
    }

    @keyframes slideOut {
        from { transform: translateX(0);    opacity: 1; }
        to   { transform: translateX(120%); opacity: 0; }
    }

    @keyframes pulse {
        0%, 100% { transform: scale(1);   }
        50%      { transform: scale(1.1); }
    }

    @keyframes flash {
        0%, 100% { background-color: inherit;              }
        50%      { background-color: rgba(255,0,0,0.1);   }
    }

    /* ── session prompt overlay + modal ── */
    .sok-session-overlay {
        position: fixed;
        inset: 0;                                   /* top/right/bottom/left = 0 */
        background: rgba(0, 0, 0, 0.55);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(4px);
        animation: fadeInOverlay 0.25s ease-out;
    }

    @keyframes fadeInOverlay {
        from { opacity: 0; }
        to   { opacity: 1; }
    }

    .sok-session-modal {
        background: #fff;
        border-radius: 16px;
        padding: 36px 32px 28px;
        max-width: 380px;
        width: 90%;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
        animation: popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes popIn {
        from { transform: scale(0.85); opacity: 0; }
        to   { transform: scale(1);    opacity: 1; }
    }

    .sok-session-icon {
        font-size: 42px;
        margin-bottom: 12px;
    }

    .sok-session-title {
        margin: 0 0 8px;
        font-size: 22px;
        font-weight: 700;
        color: #1e293b;
    }

    .sok-session-message {
        margin: 0 0 24px;
        font-size: 15px;
        color: #64748b;
        line-height: 1.5;
    }

    .sok-session-message #sok-session-countdown {
        font-weight: 700;
        color: #e11d48;                             /* red when ticking */
    }

    .sok-session-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
    }

    .sok-session-btn {
        flex: 1;
        padding: 12px 0;
        border: none;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: filter 0.15s ease, transform 0.1s ease;
    }

    .sok-session-btn:active {
        transform: scale(0.95);
    }

    .sok-session-btn-continue {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
    }

    .sok-session-btn-continue:hover {
        filter: brightness(1.1);
    }

    .sok-session-btn-end {
        background: #f1f5f9;
        color: #64748b;
    }

    .sok-session-btn-end:hover {
        background: #e2e8f0;
    }
`;

if (document.head) {
    document.head.appendChild(notificationStyles);
    console.log("✅ Notification styles injected");
} else {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            document.head.appendChild(notificationStyles);
            console.log("✅ Notification styles injected (delayed)");
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
console.log("✅ WebSocket class loaded and ready");
console.log("💡 Call window.sokWebSocket.initialize() to connect");

// Timestamp of the last visibility-recovery sync — used by the focus handler
// to avoid a redundant second sync when both events fire together.
let lastVisibilityRecoveryAt = 0;

document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
        console.log("👁️ Page HIDDEN - messages will be queued");
        return;
    }

    console.log("👁️ Page NOW VISIBLE - Starting recovery sequence");

    if (!window.sokWebSocket) {
        console.warn("⚠️ sokWebSocket not initialized");
        return;
    }

    try {
        const isConnected = window.sokWebSocket.isConnected &&
            window.sokWebSocket.ws?.readyState === WebSocket.OPEN;

        // NEW LOGIC: If we are already connected, don't do a full "Recovery" 
        // that might trigger a Cold Start. Just process the queue.
        if (isConnected) {
            console.log("🟢 Connection healthy - skipping full recovery sync");
            if (window.sokWebSocket.messageQueue?.length > 0) {
                window.sokWebSocket.processMessageQueue();
            }
            return; // EXIT EARLY to protect the current print job state
        }

        // Only run this if we were actually disconnected
        console.log("🔄 Connection lost while hidden - Syncing from server (silent)...");
        await window.sokWebSocket.syncOrderFromCache(true);

        lastVisibilityRecoveryAt = Date.now();
        console.log("✅ Recovery sequence complete");

    } catch (error) {
        console.error("❌ Error in visibility recovery:", error);
    
    }
});

let focusTimeout = null;
window.addEventListener("focus", async () => {
    console.log("👁️ Window FOCUSED");

    if (focusTimeout) {
        clearTimeout(focusTimeout);
    }

    focusTimeout = setTimeout(async () => {
        if (document.hidden) {
            console.log("⏭️ Page still hidden, skipping focus handler");
            return;
        }

        // visibilitychange already did a full recovery — no need to do it again
        if (Date.now() - lastVisibilityRecoveryAt < 500) {
            console.log("⏭️ Focus skipped — visibilitychange recovery already ran");
            return;
        }

        // ← ADD THIS
        if (window._blockWSSync) {
            console.log("⏸️ Focus sync blocked — addToCart in progress");
            return;
        }

        if (!window.sokWebSocket) return;

        try {
            const isConnected = window.sokWebSocket.isConnected &&
                window.sokWebSocket.ws?.readyState === WebSocket.OPEN;

            console.log(`🔍 Focus - Connection: ${isConnected}`);

            if (!isConnected) {
                console.log("🔄 Focus - Reconnecting...");
                await window.sokWebSocket.initialize();
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (window.sokWebSocket.messageQueue.length > 0) {
                console.log(`📬 Focus - Processing ${window.sokWebSocket.messageQueue.length} queued messages`);
                window.sokWebSocket.processMessageQueue();
            }

            // Silent sync — UI is updated internally by syncOrderFromCache
            console.log("🔄 Focus - Syncing (silent)...");
            await window.sokWebSocket.syncOrderFromCache(true);

            console.log("✅ Focus recovery complete");
        } catch (error) {
            console.error("❌ Error in focus handler:", error);
        }
    }, 300);
});

window.addEventListener("beforeunload", () => {
    if (window.sokWebSocket) {
        window.sokWebSocket.disconnect();
    }
});

window.addEventListener('orderUpdated', (event) => {
    console.log("🔔 orderUpdated event received:", event.detail);
});

window.addEventListener('orderCleared', () => {
    console.log("🔔 orderCleared event received");
});

window.addEventListener('cartNeedsRender', () => {
    console.log("🔔 cartNeedsRender event - manual render");
    const cartContainer = document.getElementById('cartContainer');
    if (cartContainer && window.sokWebSocket) {
        const orderData = JSON.parse(localStorage.getItem("order") || '{}');
        if (orderData.state?.order) {
            window.sokWebSocket.updateUIImmediate(orderData.state.order);
        }
    }
});


export default window.sokWebSocket;