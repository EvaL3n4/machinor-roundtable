// Machinor Roundtable - Backend Client API
// Provides communication layer between extension and backend server

import { getContext } from "../../../extensions.js";

class MachinorBackendClient {
    constructor() {
        // Detect environment and setup appropriate URLs
        this.detectEnvironmentAndSetupUrls();
        
        this.backend = null;
        this.websocket = null;
        this.userId = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.messageHandlers = new Map();
        this.profileSubscriptions = new Set();
        
        // Try to start backend automatically
        this.autoStartBackend();
    }

    /**
     * Detect current environment and setup URLs accordingly
     */
    detectEnvironmentAndSetupUrls() {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const currentOrigin = window.location.origin;
        
        console.log('[Machinor Backend] 🔍 Environment detection:', {
            hostname,
            protocol,
            currentOrigin
        });
        
        // Detect if we're behind a reverse proxy
        const isLocalDevelopment = hostname === 'localhost' ||
                                  hostname === '127.0.0.1' ||
                                  hostname === '0.0.0.0';
        
        if (isLocalDevelopment) {
            // Local development - use direct localhost connection
            this.baseUrl = `http://localhost:8765`;
            this.wsUrl = `ws://localhost:8765/websocket`;
            console.log('[Machinor Backend] 🏠 Local development mode - using direct localhost connection');
        } else {
            // Behind reverse proxy - use path routing through existing proxy
            this.baseUrl = `/api/backend`;
            this.wsUrl = `/websocket`;
            console.log('[Machinor Backend] 🌐 Reverse proxy mode - using path routing');
        }
        
        console.log('[Machinor Backend] 📍 Backend URLs configured:', {
            baseUrl: this.baseUrl,
            wsUrl: this.wsUrl
        });
    }

    /**
     * Automatically start the backend server if not running
     */
    async autoStartBackend() {
        try {
            console.log('[Machinor Backend] Checking if backend is running...');
            
            // Check if backend is already running
            const isRunning = await this.checkBackendStatus();
            if (isRunning) {
                console.log('[Machinor Backend] ✅ Backend already running');
                await this.connectWebSocket();
                return;
            }

            // Try to start backend server
            console.log('[Machinor Backend] 🚀 Starting backend server...');
            
            if (typeof require !== 'undefined') {
                // In Node.js context (extension folder)
                const { startMachinorBackend } = await import('./backend-server.js');
                this.backend = await startMachinorBackend();
                console.log('[Machinor Backend] ✅ Backend server started successfully');
                
                // Wait a moment for server to fully initialize
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Try to connect
                await this.connectWebSocket();
            } else {
                console.warn('[Machinor Backend] Cannot start backend - Node.js not available');
                this.setupFallbackMode();
            }
            
        } catch (error) {
            console.error('[Machinor Backend] ❌ Failed to start backend:', error);
            this.setupFallbackMode();
        }
    }

    /**
     * Check if backend server is running
     */
    async checkBackendStatus() {
        try {
            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const response = await fetch(`${this.baseUrl}/api/health`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            const data = await response.json();
            return data.status === 'healthy';
        } catch (error) {
            console.log('[Machinor Backend] Health check failed:', error.message);
            return false;
        }
    }

    /**
     * Setup fallback mode when backend is unavailable
     */
    setupFallbackMode() {
        console.log('[Machinor Backend] 🔄 Setting up fallback mode (localStorage only)');
        this.isConnected = false;
        this.setupLocalStorageFallback();
    }

    /**
     * Connect WebSocket for real-time sync
     */
    async connectWebSocket() {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            console.log('[Machinor Backend] WebSocket already connected');
            return;
        }

        try {
            this.getUserId(); // Ensure we have user ID
            
            const wsUrl = `${this.wsUrl}?userId=${encodeURIComponent(this.userId)}`;
            console.log(`[Machinor Backend] 🔗 Connecting to WebSocket: ${wsUrl}`);
            
            this.websocket = new WebSocket(wsUrl);
            
            // Add timeout for WebSocket connection
            const connectionTimeout = setTimeout(() => {
                if (this.websocket && this.websocket.readyState === WebSocket.CONNECTING) {
                    console.log('[Machinor Backend] WebSocket connection timeout');
                    this.websocket.close();
                }
            }, 5000);
            
            this.websocket.onopen = () => {
                clearTimeout(connectionTimeout);
                console.log('[Machinor Backend] ✅ WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                
                // Notify listeners of connection status
                this.emit('connection_status', { connected: true });
                
                // Send presence notification
                this.sendWebSocketMessage({
                    type: 'broadcast_presence',
                    userId: this.userId
                });
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    console.error('[Machinor Backend] WebSocket message parse error:', error);
                }
            };
            
            this.websocket.onclose = (event) => {
                clearTimeout(connectionTimeout);
                console.log('[Machinor Backend] ❌ WebSocket connection closed:', event.code, event.reason);
                this.isConnected = false;
                this.emit('connection_status', { connected: false, code: event.code, reason: event.reason });
                
                // Attempt to reconnect (but not on timeout or normal closure)
                if (event.code !== 1000 && event.code !== 1006) {
                    this.attemptReconnect();
                }
            };
            
            this.websocket.onerror = (error) => {
                clearTimeout(connectionTimeout);
                console.error('[Machinor Backend] WebSocket error:', error);
                this.emit('connection_status', { connected: false, error: error });
            };
            
        } catch (error) {
            console.error('[Machinor Backend] Failed to connect WebSocket:', error);
            this.setupFallbackMode();
        }
    }

    /**
     * Attempt to reconnect WebSocket
     */
    async attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[Machinor Backend] Max reconnect attempts reached, using fallback mode');
            this.setupFallbackMode();
            return;
        }
        
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
        
        console.log(`[Machinor Backend] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(async () => {
            try {
                await this.connectWebSocket();
            } catch (error) {
                console.error('[Machinor Backend] Reconnect failed:', error);
            }
        }, delay);
    }

    /**
     * Get user ID from SillyTavern context
     */
    getUserId() {
        if (this.userId) return this.userId;
        
        const context = getContext();
        // Extract user identifier from context or generate one
        this.userId = context?.user?.id || context?.userId || `user_${Date.now()}`;
        
        console.log(`[Machinor Backend] User ID: ${this.userId}`);
        return this.userId;
    }

    /**
     * Generate profile ID based on context
     */
    getProfileId() {
        const context = getContext();
        const userId = this.getUserId();
        const characterId = context?.characterId;
        const chatId = context?.chatId;
        
        if (!characterId || !chatId) {
            console.warn('[Machinor Backend] Cannot generate profile ID: missing context');
            return null;
        }
        
        return `${userId}_${characterId}_${chatId}`;
    }

    /**
     * Save plot profile to backend
     */
    async saveProfile(profileData) {
        const context = getContext();
        const userId = this.getUserId();
        const profileId = this.getProfileId();
        
        console.log(`[Machinor Backend] 🔍 SAVING PROFILE:`, {
            profileId,
            userId,
            characterId: context?.characterId,
            chatId: context?.chatId,
            isConnected: this.isConnected,
            baseUrl: this.baseUrl
        });
        
        if (!profileId) {
            console.warn('[Machinor Backend] Cannot save profile: missing profile ID');
            return this.saveProfileToLocalStorage(profileData);
        }
        
        const payload = {
            userId: userId,
            characterId: context.characterId,
            chatId: context.chatId,
            profile: {
                ...profileData,
                characterName: context?.characters?.[context?.characterId]?.name || 'Unknown'
            }
        };
        
        console.log(`[Machinor Backend] 📦 Save payload:`, payload);
        
        try {
            if (this.isConnected) {
                // Save to backend via HTTP with timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                
                try {
                    const response = await fetch(`${this.baseUrl}/api/profiles`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload),
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    console.log(`[Machinor Backend] 📡 Save response status:`, response.status);
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    const result = await response.json();
                    console.log(`[Machinor Backend] ✅ Profile saved to server:`, result);
                    
                    // Broadcast update to other devices via WebSocket
                    this.sendWebSocketMessage({
                        type: 'profile_update',
                        userId: userId,
                        data: {
                            profileId: result.profileId,
                            profileData: profileData
                        }
                    });
                    
                    // Also save to localStorage as backup
                    this.saveProfileToLocalStorage(profileData);
                    
                    return result;
                    
                } catch (fetchError) {
                    clearTimeout(timeoutId);
                    throw fetchError;
                }
                
            } else {
                console.log('[Machinor Backend] Not connected, saving to localStorage');
                return this.saveProfileToLocalStorage(profileData);
            }
            
        } catch (error) {
            console.error('[Machinor Backend] Save profile error:', error.message);
            console.log('[Machinor Backend] Falling back to localStorage');
            // Fallback to localStorage on error
            return this.saveProfileToLocalStorage(profileData);
        }
    }

    /**
     * Load plot profile from backend
     */
    async loadProfile() {
        const profileId = this.getProfileId();
        
        console.log(`[Machinor Backend] 🔍 LOADING PROFILE:`, {
            profileId,
            userId: this.userId,
            isConnected: this.isConnected,
            baseUrl: this.baseUrl
        });
        
        if (!profileId) {
            console.warn('[Machinor Backend] Cannot load profile: missing profile ID');
            return this.loadProfileFromLocalStorage();
        }
        
        try {
            if (this.isConnected) {
                // Subscribe to real-time updates for this profile
                this.sendWebSocketMessage({
                    type: 'subscribe_profile',
                    userId: this.userId,
                    data: { profileId }
                });
                
                // Load specific profile from backend with timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                
                try {
                    const url = `${this.baseUrl}/api/profiles?profileId=${encodeURIComponent(profileId)}&userId=${encodeURIComponent(this.userId)}`;
                    console.log(`[Machinor Backend] 🔗 Fetching: ${url}`);
                    
                    const response = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    const result = await response.json();
                    console.log(`[Machinor Backend] 📦 Server response:`, result);
                    
                    // Find specific profile
                    const profile = result.profiles?.find(p => p.id === profileId);
                    
                    if (profile) {
                        console.log(`[Machinor Backend] ✅ Profile loaded from server: ${profileId}`);
                        return this.transformProfileFromDB(profile);
                    } else {
                        console.log(`[Machinor Backend] Profile not found on server for profileId: ${profileId}`);
                        console.log(`[Machinor Backend] Available profiles:`, result.profiles?.map(p => p.id));
                        return this.loadProfileFromLocalStorage();
                    }
                    
                } catch (fetchError) {
                    clearTimeout(timeoutId);
                    throw fetchError;
                }
                
            } else {
                console.log('[Machinor Backend] Not connected, loading from localStorage');
                return this.loadProfileFromLocalStorage();
            }
            
        } catch (error) {
            console.error('[Machinor Backend] Load profile error:', error.message);
            console.log('[Machinor Backend] Falling back to localStorage');
            return this.loadProfileFromLocalStorage();
        }
    }

    /**
     * Send WebSocket message
     */
    sendWebSocketMessage(message) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(message));
        } else {
            console.warn('[Machinor Backend] Cannot send WebSocket message: not connected');
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleWebSocketMessage(message) {
        const { type, profileId, data, userId } = message;
        
        console.log(`[Machinor Backend] 📨 WebSocket message: ${type}`, { profileId, userId });
        
        // Only process messages for current user
        if (userId && userId !== this.userId) {
            return;
        }
        
        switch (type) {
            case 'connection_confirmed':
                console.log(`[Machinor Backend] ✅ Connected to server as user: ${data.userId}`);
                break;
                
            case 'profile_updated':
                if (profileId === this.getProfileId()) {
                    console.log(`[Machinor Backend] 🔄 Profile updated from another device`);
                    this.emit('profile_updated', { profileId, data, source: 'websocket' });
                }
                break;
                
            case 'user_presence':
                console.log(`[Machinor Backend] 👤 User ${data.userId} is ${data.status}`);
                this.emit('user_presence', data);
                break;
                
            case 'profile_data':
                console.log(`[Machinor Backend] 📊 Received profile data for: ${profileId}`);
                this.emit('profile_loaded', { profileId, data });
                break;
                
            case 'server_status':
                console.log(`[Machinor Backend] Server status: ${data.status}`);
                break;
                
            case 'error':
                console.error(`[Machinor Backend] Server error: ${message.message}`);
                break;
                
            default:
                console.log(`[Machinor Backend] Unknown WebSocket message type: ${type}`);
        }
    }

    /**
     * Setup localStorage fallback
     */
    setupLocalStorageFallback() {
        // Profile data can still be saved/loaded from localStorage
        // This is handled by the legacy methods below
        console.log('[Machinor Backend] 🔄 Using localStorage fallback mode');
    }

    /**
     * Save profile to localStorage (fallback)
     */
    saveProfileToLocalStorage(profileData) {
        const profileId = this.getProfileId();
        if (!profileId) return null;
        
        try {
            localStorage.setItem(`mr_plot_${profileId}`, JSON.stringify(profileData));
            console.log(`[Machinor Backend] 💾 Profile saved to localStorage: ${profileId}`);
            return { success: true, profileId, source: 'localStorage' };
        } catch (error) {
            console.error('[Machinor Backend] localStorage save error:', error);
            return null;
        }
    }

    /**
     * Load profile from localStorage (fallback)
     */
    loadProfileFromLocalStorage() {
        const profileId = this.getProfileId();
        if (!profileId) return null;
        
        try {
            const stored = localStorage.getItem(`mr_plot_${profileId}`);
            if (stored) {
                const profileData = JSON.parse(stored);
                console.log(`[Machinor Backend] 💾 Profile loaded from localStorage: ${profileId}`);
                return profileData;
            }
        } catch (error) {
            console.error('[Machinor Backend] localStorage load error:', error);
        }
        
        return null;
    }

    /**
     * Transform profile data from database format
     */
    transformProfileFromDB(dbProfile) {
        return {
            id: dbProfile.id,
            userId: dbProfile.user_id,
            characterId: dbProfile.character_id,
            characterName: dbProfile.character_name,
            chatId: dbProfile.chat_id,
            title: dbProfile.title,
            
            currentPlot: {
                text: dbProfile.current_plot,
                status: dbProfile.current_status,
                timestamp: new Date(dbProfile.current_timestamp).getTime(),
                options: dbProfile.current_options || {}
            },
            
            settings: {
                autoApproveTimeout: dbProfile.auto_approve_timeout,
                historyLimit: dbProfile.history_limit,
                recentDirections: dbProfile.recent_directions || [],
                sidebarCollapsed: !!dbProfile.sidebar_collapsed,
                plotStyle: dbProfile.plot_style,
                plotIntensity: dbProfile.plot_intensity
            },
            
            storyIntelligence: {
                characterAnalysis: dbProfile.character_analysis,
                worldContext: dbProfile.world_context,
                arcStatus: dbProfile.arc_status || {},
                characterCount: dbProfile.character_count
            },
            
            plotHistory: dbProfile.plotHistory || [],
            version: dbProfile.version,
            lastModified: new Date(dbProfile.last_modified).getTime(),
            source: 'server'
        };
    }

    /**
     * Event emitter for client messages
     */
    on(event, handler) {
        if (!this.messageHandlers.has(event)) {
            this.messageHandlers.set(event, new Set());
        }
        this.messageHandlers.get(event).add(handler);
    }

    /**
     * Get diagnostic information for troubleshooting
     */
    getDiagnostics() {
        const status = this.getConnectionStatus();
        
        return {
            ...status,
            userAgent: navigator.userAgent,
            protocol: window.location.protocol,
            hostname: window.location.hostname,
            port: window.location.port,
            pathname: window.location.pathname,
            timestamp: new Date().toISOString(),
            websocketState: this.websocket?.readyState,
            reconnectAttempts: this.reconnectAttempts
        };
    }

    /**
     * Test backend connectivity
     */
    async testConnection() {
        console.log('[Machinor Backend] 🔍 Testing backend connectivity...');
        
        try {
            // Test HTTP endpoint
            const healthStatus = await this.checkBackendStatus();
            console.log('[Machinor Backend] Health check result:', healthStatus);
            
            // Test WebSocket connection
            const wsStatus = this.websocket?.readyState;
            console.log('[Machinor Backend] WebSocket state:', wsStatus);
            
            // Get diagnostic info
            const diagnostics = this.getDiagnostics();
            console.log('[Machinor Backend] 🔧 Diagnostics:', diagnostics);
            
            return {
                http: healthStatus,
                websocket: wsStatus === WebSocket.OPEN,
                diagnostics: diagnostics
            };
            
        } catch (error) {
            console.error('[Machinor Backend] Connection test failed:', error);
            return {
                http: false,
                websocket: false,
                error: error.message
            };
        }
    }

    /**
     * Remove event listener
     */
    off(event, handler) {
        const handlers = this.messageHandlers.get(event);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    /**
     * Emit event to listeners
     */
    emit(event, data) {
        const handlers = this.messageHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`[Machinor Backend] Event handler error for ${event}:`, error);
                }
            });
        }
    }

    /**
     * Get connection status
     */
    getConnectionStatus() {
        return {
            connected: this.isConnected,
            userId: this.userId,
            websocketReady: this.websocket?.readyState === WebSocket.OPEN,
            serverAvailable: !!this.backend
        };
    }

    /**
     * Manual connection retry
     */
    async reconnect() {
        console.log('[Machinor Backend] 🔄 Manual reconnect attempt');
        this.reconnectAttempts = 0;
        await this.connectWebSocket();
    }

    /**
     * Shutdown client
     */
    shutdown() {
        console.log('[Machinor Backend] 🔄 Shutting down client...');
        
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        
        if (this.backend) {
            this.backend.shutdown();
            this.backend = null;
        }
        
        this.messageHandlers.clear();
        this.isConnected = false;
    }
}

// Export for use in extension
export { MachinorBackendClient };

// Global instance for extension use
let backendClientInstance = null;

/**
 * Get or create backend client instance
 */
export function getBackendClient() {
    if (!backendClientInstance) {
        backendClientInstance = new MachinorBackendClient();
    }
    return backendClientInstance;
}

/**
 * Shutdown backend client
 */
export function shutdownBackendClient() {
    if (backendClientInstance) {
        backendClientInstance.shutdown();
        backendClientInstance = null;
    }
}