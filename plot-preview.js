// Machinor Roundtable - Plot Preview Manager
import { getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { logger } from "./logger.js";
import { escapeHtml, sanitizePlotText, sanitizeDirection, createErrorHandler } from './security-utils.js';

// @ts-ignore - eventSource is a global
const eventSource = window.eventSource;
// @ts-ignore - event_types is a global
const event_types = window.event_types;

// @ts-ignore - toastr is a global library
const toastr = window.toastr;

/**
 * Gets the current character from SillyTavern context
 * @returns {Object|null} The current character object or null if no character is selected
 */
function getCurrentCharacter() {
    try {
        const context = getContext();
        if (!context) {
            logger.log("getCurrentCharacter: No context available");
            return null;
        }

        // Check if we have a characterId and characters array
        if (context.characterId === undefined || !context.characters) {
            logger.log("getCurrentCharacter: No characterId or characters array");
            return null;
        }

        // Find the current character by ID
        const character = context.characters[context.characterId];

        logger.log("getCurrentCharacter:", character ? character.name : "No character found");

        return character || null;
    } catch (error) {
        logger.error("Error getting current character:", error);
        return null;
    }
}

/**
 * @typedef {Object} PlotEntry
 * @property {string} text - The plot text
 * @property {number} timestamp - When the plot was created
 * @property {string} id - Unique identifier
 */

/**
 * @typedef {Object} PlotPreviewElements
 * @property {HTMLElement} sidebar
 * @property {HTMLElement} toggleBtn
 * @property {HTMLElement} statusIndicator
 * @property {HTMLElement} statusText
 * @property {HTMLElement} timerDisplay
 * @property {HTMLElement} currentPlotText
 * @property {HTMLElement} nextPlotText
 * @property {HTMLInputElement} directionInput
 * @property {HTMLElement} recentDirectionsList
 * @property {HTMLElement} historyList
 * @property {HTMLInputElement} historyLimitInput
 * @property {HTMLElement} historyToggle
 * @property {HTMLElement} historyContent
 * @property {HTMLElement} modal
 * @property {HTMLTextAreaElement} editorText
 * @property {HTMLElement} closeModalBtn
 */

export class PlotPreviewManager {
    /**
     * @param {PlotEngine} plotEngine - The plot generation engine
     * @param {ChatInjector|null} chatInjector - The chat injection system
     */
    constructor(plotEngine, chatInjector) {
        /** @type {PlotEngine} */
        this.plotEngine = plotEngine;
        /** @type {ChatInjector|null} */
        this.chatInjector = chatInjector;
        /** @type {boolean} */
        this.isCollapsed = true;
        /** @type {string|null} */
        this.currentPlot = null;
        /** @type {string|null} */
        this.nextPlot = null;
        /** @type {Array<PlotEntry>} */
        this.plotHistory = [];
        /** @type {number} */
        this.historyLimit = 5;
        /** @type {string[]} */
        this.recentDirections = [];
        /** @type {number} */
        this.maxRecentDirections = 10;
        /** @type {boolean} */
        this.isManualEntry = false;
        /** @type {boolean} */
        this.isGenerating = false;
        /** @type {boolean} */
        this.isEditingPlot = false;
        /** @type {string|null} */
        this.editingPlotId = null;

        // CRITICAL: Deferred initialization flag to prevent startup interference
        /** @type {boolean} */
        this.isInitialized = false;
        /** @type {boolean} */
        this.contextLoadedOnce = false;
        /** @type {number|null} */
        this.contextCheckInterval = null;
        /** @type {boolean} */
        this.isDestroyed = false;

        /** @type {Map<string, Function>} */
        this.eventListenerRefs = new Map();
        /** @type {WeakMap<Element, Function>} */
        this.domListenerRefs = new WeakMap();

        // Story intelligence data
        /** @type {Object|null} */
        this.storyIntelligence = null;
        /** @type {Object|null} */
        this.arcStatus = null;
        /** @type {Object|null} */
        this.characterAnalysis = null;

        /** @type {PlotPreviewElements} */
        this.elements = this.initializeElements();
        /** @type {boolean} */
        this.isMobile = window.innerWidth <= 768;
        /** @type {boolean} */
        this.mobileSidebarVisible = false;
        const mobileToggleElement = document.getElementById('mr_mobile_toggle');

        /** @type {HTMLElement|null} */
        this.mobileOverlay = null;
        /** @type {number|null} */
        this.mobileResizeTimeout = null;
        /** @type {HTMLElement|null} */
        this.mobilePortalContainer = null;
        /** @type {HTMLElement|null} */
        this.sidebarPlaceholder = null;
        /** @type {HTMLElement|null} */
        this.togglePlaceholder = null;
        /** @type {HTMLElement|null} */
        this.sidebarOriginalParent = this.elements.sidebar?.parentElement || null;
        /** @type {Node|null} */
        this.sidebarNextSibling = this.elements.sidebar?.nextSibling || null;
        /** @type {HTMLElement|null} */
        this.toggleOriginalParent = mobileToggleElement ? mobileToggleElement.parentElement : null;
        /** @type {Node|null} */
        this.toggleNextSibling = mobileToggleElement ? mobileToggleElement.nextSibling : null;
        /** @type {(event: KeyboardEvent) => void | null} */
        this.mobileFocusTrapHandler = null;
        /** @type {HTMLElement|null} */
        this.previouslyFocusedElement = null;
        /** @type {string} */
        this.originalBodyOverflow = '';

        this.bindEvents();
        this.loadSettings();
        this.initializeMobileToggle();
        this.updateMobileAccessibilityState(false);
        this.updateResponsivePlacement();

        // CRITICAL FIX: Don't start context listeners immediately
        // Wait for deferredInit() to be called by ST integration after grace period
        logger.log('Plot Preview constructed, waiting for deferred initialization...');

        // Show skeleton loading state immediately
        this.showSkeletonState();

        // CRITICAL FIX: Don't update story intelligence during initialization
        // It will be updated after the first context load
        // this.updateStoryIntelligence();
    }

    /**
     * Show skeleton/loading state while waiting for chat to be ready
     */
    showSkeletonState() {
        // Disable action buttons during loading
        this.setButtonsEnabled(false);

        if (this.elements.currentPlotText) {
            // Use safe DOM creation instead of innerHTML
            this.elements.currentPlotText.textContent = '';
            
            const container = document.createElement('div');
            container.className = 'mr-skeleton-container';
            container.style.padding = '0';
            
            const content = document.createElement('div');
            content.className = 'mr-skeleton-content';
            
            // Create 4 skeleton lines
            for (let i = 0; i < 4; i++) {
                const line = document.createElement('div');
                line.className = i === 2 ? 'mr-skeleton-text short' : 'mr-skeleton-text';
                content.appendChild(line);
            }
            
            container.appendChild(content);
            this.elements.currentPlotText.appendChild(container);
        }
        
        if (this.elements.statusText) {
            this.elements.statusText.textContent = 'Initializing... ';
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-spinner fa-spin';
            this.elements.statusText.appendChild(icon);
        }
    }

    /**
     * Enable or disable action buttons
     * @param {boolean} enabled - Whether buttons should be enabled
     */
    setButtonsEnabled(enabled) {
        const editBtn = document.getElementById('mr_edit_plot');
        const skipBtn = document.getElementById('mr_skip_plot');

        if (editBtn) {
            editBtn.disabled = !enabled;
            editBtn.style.opacity = enabled ? '1' : '0.5';
            editBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        }
        if (skipBtn) {
            skipBtn.disabled = !enabled;
            skipBtn.style.opacity = enabled ? '1' : '0.5';
            skipBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        }
    }

    /**
     * Show skeleton/loading state for history section
     */
    showHistorySkeleton() {
        if (!this.elements.historyList) return;

        // Clear existing content
        this.elements.historyList.textContent = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'mr-history-skeleton';
        wrapper.style.padding = '8px 0';
        
        const createSkeletonItem = (delay) => {
            const item = document.createElement('div');
            item.className = 'mr-skeleton-history-item';
            item.style.cssText = `
                width: 100%;
                height: 60px;
                background: linear-gradient(90deg, rgba(255,105,180,0.06) 0%, rgba(218,112,214,0.10) 50%, rgba(255,105,180,0.06) 100%);
                background-size: 200% 100%;
                animation: shimmer 2s infinite ${delay};
                border-radius: 8px;
                margin-bottom: 8px;
            `;
            return item;
        };

        wrapper.appendChild(createSkeletonItem('0s'));
        wrapper.appendChild(createSkeletonItem('0.15s'));
        wrapper.appendChild(createSkeletonItem('0.3s'));
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes shimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }
        `;
        
        wrapper.appendChild(style);
        this.elements.historyList.appendChild(wrapper);
    }

    /**
     * Deferred initialization - called by ST integration after grace period
     * This prevents extension activity during SillyTavern's startup sequence
     * @returns {void}
     */
    deferredInit() {
        // Defer initialization until chat is ready to avoid premature DOM access
        if (this.isInitialized) {
            logger.log('Plot Preview already initialized, reloading for new chat...');
            // Even though we're initialized, we should reload the profile for the new chat
            this.delayedContextLoad(200, 'deferred_init_reload');
            return;
        }

        this.isInitialized = true;
        logger.log('🚀 Plot Preview deferred initialization starting...');

        // Now it's safe to start context listeners
        this.setupContextChangeListeners();
    }

    /**
     * Setup listeners for chat and character changes
     * @returns {void}
     */
    setupContextChangeListeners() {
        if (this.isDestroyed) return;

        // CRITICAL FIX: Listen to MESSAGE_SENT/RECEIVED instead of CHAT_CHANGED
        // This ensures we only load AFTER SillyTavern has saved the chat

        // ROBUST APPROACH: Multiple event listeners + polling fallback
        // CRITICAL: Event listeners are only activated AFTER initial load to prevent race conditions
        const activateEventListeners = () => {
            if (this.isDestroyed) return;
            
            try {
                if (typeof eventSource !== 'undefined') {
                    // Define handlers
                    const onMessageSent = () => {
                        logger.log('📨 Message sent event detected');
                        this.delayedContextLoad(300, 'message_sent');
                    };

                    const onMessageReceived = () => {
                        logger.log('📬 Message received event detected');
                        this.delayedContextLoad(300, 'message_received');
                    };

                    const onChatChanged = () => {
                        logger.log('🔄 Chat changed event detected');
                        this.delayedContextLoad(200, 'chat_changed');
                    };

                    const onCharacterSelected = () => {
                        logger.log('👤 Character selected event detected');
                        this.delayedContextLoad(150, 'character_selected');
                    };

                    // Register and store references for cleanup
                    eventSource.on(event_types.MESSAGE_SENT, onMessageSent);
                    this.eventListenerRefs.set('eventSource_MESSAGE_SENT', onMessageSent);

                    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
                    this.eventListenerRefs.set('eventSource_MESSAGE_RECEIVED', onMessageReceived);

                    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
                    this.eventListenerRefs.set('eventSource_CHAT_CHANGED', onChatChanged);

                    eventSource.on(event_types.CHARACTER_SELECTED, onCharacterSelected);
                    this.eventListenerRefs.set('eventSource_CHARACTER_SELECTED', onCharacterSelected);

                    logger.log('✅ Event listeners activated');
                }
            } catch (error) {
                logger.error('Error activating context listeners:', error);
            }
        };

        // Polling fallback for initial page load
        // Event listeners are NOT active during this phase to prevent conflicts
        // Poll for context changes every 2 seconds to detect chat/character switches
        this.contextCheckInterval = setInterval(() => {
            if (this.isDestroyed) {
                if (this.contextCheckInterval) clearInterval(this.contextCheckInterval);
                return;
            }

            const context = getContext();

            // Wait for character ID and chat ID (chat array can be empty for new chats)
            if (context && context.characterId !== undefined && context.chatId) {
                if (!this.contextLoadedOnce) {
                    logger.log('🎯 Context fully ready via polling (Initial Load)');
                    this.contextLoadedOnce = true;

                    // Give ST time to complete its initial save, then activate event listeners
                    setTimeout(() => {
                        if (this.isDestroyed) return;

                        const loadedPlot = this.loadPlotFromStorage();

                        // CRITICAL FIX: Check for plotText (not text) since loadChatProfile returns { plotText, ... }
                        if (!loadedPlot || !loadedPlot.plotText) {
                            logger.log('No stored plot found, resetting to ready state');
                            this.updateStatus('ready');
                            if (this.elements.currentPlotText) {
                                this.elements.currentPlotText.textContent = 'No plot generated yet. Start chatting or use Skip, or Generate Plot Now.';
                                this.elements.currentPlotText.className = 'mr-placeholder-text';
                            }
                            // Re-enable buttons for empty state
                            this.setButtonsEnabled(true);
                        } else {
                            logger.log('✅ Plot already loaded from storage, skipping reset');
                        }

                        this.renderHistory();
                        logger.log('✅ Initial load complete, activating event listeners...');
                        activateEventListeners();
                    }, 1500); // Extended delay for initial load
                }
                // Stop polling once we've initiated the load
                if (this.contextCheckInterval) clearInterval(this.contextCheckInterval);
            }
        }, 500); // Check every 500ms

        logger.log('Context change listeners setup complete (will activate after initial load)');
    }

    /**
     * Delayed context loading with proper timing and validation
     * @param {number} delay - Delay in milliseconds
     * @param {string} source - Source of the trigger
     * @returns {void}
     * @throws {Error} If context loading fails
     */
    delayedContextLoad(delay, source) {
        setTimeout(() => {
            const context = getContext();

            logger.log(`🔍 Attempting load from ${source}:`, {
                characterId: context?.characterId,
                chatId: context?.chatId,
                contextExists: !!context,
                hasCharacters: !!context?.characters,
                hasChat: !!context?.chat
            });

            // Validate context is ready before attempting load
            if (context && context.characterId !== undefined && context.chatId) {
                logger.log('✅ Context ready, loading stored plot...');

                // If this is a chat change, clear current state first AND show loading skeletons
                if (source.includes('chat_changed') || source.includes('character_selected') || source.includes('deferred_init_reload')) {
                    logger.log('🔄 Chat/Character switch detected - resetting state');
                    this.plotHistory = [];
                    this.currentPlot = null;
                    this.updateStatus('pending');
                    // Show skeletons while loading
                    this.showSkeletonState();
                    this.showHistorySkeleton();
                }

                // Load the plot profile for this chat
                // Try loading from settings first, fall back to localStorage for backward compatibility
                const loadedProfile = this.loadPlotFromStorage();

                // Explicitly render history (loadChatProfile already does this, but ensure it's called)
                if (!loadedProfile || !loadedProfile.plotText) {
                    logger.log('No plot for this chat, showing empty state');
                    if (this.elements.currentPlotText) {
                        this.elements.currentPlotText.textContent = 'No plot generated yet. Start chatting or use Manual Trigger.';
                        this.elements.currentPlotText.className = 'mr-placeholder-text';
                    }
                    this.updateStatus('ready');
                    // Re-enable buttons for empty state
                    this.setButtonsEnabled(true);
                }

                // Always render history to ensure it's up to date
                this.renderHistory();
            } else {
                logger.log('⏳ Context not ready yet, will retry...');
                // If context still not ready, try again with longer delay
                this.delayedContextLoad(500, `${source}_retry`);
            }
        }, delay);
    }

    /**
     * Generate a storage key based on current character and chat
     * @returns {string|null} Storage key or null if no character/chat
     */
    getStorageKey() {
        const context = getContext();
        if (!context) {
            logger.log('getStorageKey: No context available');
            return null;
        }

        const characterId = context.characterId;
        const chatId = context.chatId;

        // CRITICAL FIX: More detailed logging for debugging persistence issues
        logger.log('getStorageKey - Context:', {
            characterId: characterId,
            chatId: chatId,
            contextExists: !!context,
            hasCharacters: !!context.characters,
            hasChat: !!context.chat
        });

        if (characterId === undefined || !chatId) {
            logger.warn('Cannot generate storage key: missing characterId or chatId');
            logger.warn('CharacterId:', characterId, 'ChatId:', chatId);
            return null;
        }

        const storageKey = `mr_plot_${characterId}_${chatId}`;
        logger.log('Generated storage key:', storageKey);
        return storageKey;
    }

    /**
     * Generate a profile index key for cross-chat navigation
     * @returns {string|null} Profile index key or null
     */
    getProfileIndexKey() {
        return 'mr_profile_index';
    }

    /**
     * Save comprehensive chat profile to persistent storage
     * @param {string} plotText - The plot text to save
     * @param {string} status - The plot status
     * @returns {void}
     */
    saveChatProfile(plotText, status) {
        if (this.isDestroyed) return;

        const storageKey = this.getStorageKey();
        if (!storageKey) return;

        const context = getContext();
        // Use optional chaining for safe access
        const character = context?.characters?.[context?.characterId];

        // CRITICAL: Load existing profile to preserve fields
        let existingProfile = null;
        // Add optional chaining for settings access
        if (window.machinorRoundtable?.settings?.previewHistories && context?.chatId) {
            existingProfile = window.machinorRoundtable.settings.previewHistories[context.chatId];
        }

        // DEBUG: Log current state before building profile
        logger.log('📊 Pre-save state:', {
            thisPlotHistoryLength: this.plotHistory?.length || 0,
            existingPlotHistoryLength: existingProfile?.plotHistory?.length || 0,
            currentPlot: plotText?.substring(0, 30) + '...',
            status: status
        });

        // Build profile with defensive field preservation
        const profileData = {
            // Preserve all existing data first
            ...existingProfile,

            // Core plot data (always update)
            plotText: plotText,
            status: status,
            timestamp: Date.now(),

            // Character info (update if available, otherwise preserve)
            characterId: context?.characterId,
            characterName: character?.name || existingProfile?.characterName || 'Unknown',

            // Plot history - prefer current if it has entries, otherwise preserve existing
            plotHistory: (this.plotHistory && this.plotHistory.length > 0)
                ? this.plotHistory
                : (existingProfile?.plotHistory || []),
            injectedPlots: this.getInjectedPlotsTimeline(),

            // Settings (update if available, otherwise preserve)
            // Use nullish coalescing
            recentDirections: this.recentDirections?.length > 0
                ? this.recentDirections
                : (existingProfile?.recentDirections ?? []),
            sidebarCollapsed: this.isCollapsed,

            // Story intelligence (preserve existing if new values are null/empty)
            storyIntelligence: (() => {
                // Start with existing intelligence
                const intelligence = { ...(existingProfile?.storyIntelligence || {}) };

                // Only update fields if we have actual DOM content (not fallbacks)
                // Use optional chaining for DOM access
                const characterAnalysisEl = this.elements.characterAnalysis?.textContent;
                if (characterAnalysisEl && characterAnalysisEl !== 'No character data' && characterAnalysisEl !== 'Character data unavailable') {
                    intelligence.characterAnalysis = characterAnalysisEl;
                }

                const worldContextEl = this.elements.worldContext?.textContent;
                if (worldContextEl && worldContextEl !== 'No world data' && worldContextEl !== 'World data unavailable') {
                    intelligence.worldContext = worldContextEl;
                }

                const characterCountEl = this.elements.characterCount?.textContent;
                if (characterCountEl && characterCountEl !== 'Unknown') {
                    intelligence.characterCount = characterCountEl;
                }

                // Arc status - only if we have a plot engine and it returns data
                const arcStatus = this.plotEngine?.narrativeArc?.getArcStatus();
                if (arcStatus) {
                    intelligence.arcStatus = arcStatus;
                }

                // Tone and pacing - only if DOM elements exist and have content
                const toneEl = document.getElementById('mr_tone_analysis');
                if (toneEl?.textContent && toneEl.textContent.trim()) {
                    intelligence.tone = toneEl.textContent;
                }

                const pacingEl = document.getElementById('mr_pacing_guidance');
                if (pacingEl?.textContent && pacingEl.textContent.trim()) {
                    intelligence.pacing = pacingEl.textContent;
                }

                return intelligence;
            })(),

            // Chat context (update if available)
            chatLength: context?.chat?.length || existingProfile?.chatLength || 0,
            lastMessageTime: context?.chat?.[context?.chat?.length - 1]?.send_date || existingProfile?.lastMessageTime || null
        };

        // DEBUG: Log what we're about to save
        logger.log('🔍 SAVING PROFILE DATA:', {
            plotText: profileData.plotText?.substring(0, 50) + '...',
            status: profileData.status,
            plotHistoryCount: profileData.plotHistory?.length || 0,
            recentDirectionsCount: profileData.recentDirections?.length || 0,
            hasStoryIntelligence: !!profileData.storyIntelligence,
            preservedFromExisting: !!existingProfile
        });

        try {
            // 1. Sync to Settings (Primary Source of Truth)
            // This must happen FIRST to ensure data is persisted to the server/settings
            if (window.machinorRoundtable && typeof window.machinorRoundtable.syncPlotToSettings === 'function') {
                const context = getContext();
                if (context && context.chatId) {
                    window.machinorRoundtable.syncPlotToSettings(context.chatId, profileData);
                    logger.log('✅ Profile synced to settings (Primary)');
                }
            }

            // 2. Save to LocalStorage (Fallback/Cache only)
            try {
                localStorage.setItem(storageKey, JSON.stringify(profileData));
                logger.log('✅ Profile saved to LocalStorage (Fallback)');
                
                // Update profile index for cross-chat navigation
                this.updateProfileIndex(storageKey, profileData);
            } catch (e) {
                if (e.name === 'QuotaExceededError') {
                    logger.warn('LocalStorage quota exceeded. Attempting cleanup...');
                    // Try to clean up old entries
                    this.cleanupStorage();
                    // Retry save once
                    try {
                        localStorage.setItem(storageKey, JSON.stringify(profileData));
                        logger.log('✅ Profile saved to LocalStorage after cleanup');
                        this.updateProfileIndex(storageKey, profileData);
                    } catch (retryError) {
                        logger.error('Failed to save even after cleanup:', retryError);
                        // @ts-ignore
                        if (window.toastr) window.toastr.warning('Browser storage full - some history may not be cached offline', 'Machinor Roundtable');
                    }
                } else {
                    throw e;
                }
            }

        } catch (error) {
            logger.error('Failed to save chat profile:', error);
        }
    }

    /**
     * Check storage quota and cleanup if needed
     */
    cleanupStorage() {
        try {
            const indexKey = this.getProfileIndexKey();
            const storedIndex = localStorage.getItem(indexKey);
            if (!storedIndex) return;

            const index = JSON.parse(storedIndex);
            
            // Sort by last active (oldest first)
            const sortedEntries = Object.entries(index)
                .sort(([, a], [, b]) => a.lastActive - b.lastActive);
                
            // Remove oldest 20%
            const toRemove = sortedEntries.slice(0, Math.ceil(sortedEntries.length * 0.2));
            
            toRemove.forEach(([key]) => {
                localStorage.removeItem(key);
                delete index[key];
                logger.log('Cleaned up old storage entry:', key);
            });
            
            localStorage.setItem(indexKey, JSON.stringify(index));
        } catch (error) {
            logger.error('Storage cleanup failed:', error);
        }
    }

    /**
     * Update profile index for cross-chat navigation
     * @param {string} storageKey - The profile storage key
     * @param {Object} profileData - The profile data
     */
    updateProfileIndex(storageKey, profileData) {
        try {
            const indexKey = this.getProfileIndexKey();
            let index = {};

            // Load existing index
            const storedIndex = localStorage.getItem(indexKey);
            if (storedIndex) {
                index = JSON.parse(storedIndex);
            }

            // Update or add profile entry
            index[storageKey] = {
                characterId: profileData.characterId,
                characterName: profileData.characterName,
                lastActive: profileData.timestamp,
                plotHistoryCount: profileData.plotHistory?.length || 0,
                injectedPlotsCount: profileData.injectedPlots?.length || 0,
                chatLength: profileData.chatLength
            };

            // Keep only the most recent 30 profiles (reduced from 50) to prevent storage bloat
            const sortedEntries = Object.entries(index)
                .sort(([, a], [, b]) => b.lastActive - a.lastActive)
                .slice(0, 30);

            const trimmedIndex = Object.fromEntries(sortedEntries);
            localStorage.setItem(indexKey, JSON.stringify(trimmedIndex));
            
            // Clean up removed keys from storage
            const currentKeys = new Set(Object.keys(trimmedIndex));
            Object.keys(index).forEach(key => {
                if (!currentKeys.has(key)) {
                    localStorage.removeItem(key);
                }
            });

        } catch (error) {
            logger.error('Failed to update profile index:', error);
        }
    }

    /**
     * Load comprehensive chat profile from persistent storage
     * @returns {Object|null} Loaded profile data or null
     */
    loadChatProfile() {
        // Since we're now using chatLoaded event, the chat is guaranteed to be ready
        // We only need to verify we have a storage key
        const storageKey = this.getStorageKey();
        if (!storageKey) {
            logger.log('⚠️ No storage key available (no chat/character selected)');
            return null;
        }

        // CRITICAL FIX: Prioritize Synced History (Settings) over LocalStorage
        // This ensures cross-device consistency and prevents data loss on cache clear
        let profileData = null;
        let source = 'unknown';

        // 1. Try Synced History (Primary)
        if (window.machinorRoundtable && window.machinorRoundtable.settings && window.machinorRoundtable.settings.previewHistories) {
            const context = getContext();
            if (context && context.chatId) {
                const syncedProfile = window.machinorRoundtable.settings.previewHistories[context.chatId];
                if (syncedProfile) {
                    profileData = syncedProfile;
                    source = 'synced_history';
                    logger.log('🔄 Loaded profile from Synced History (Primary)');
                }
            }
        }

        // 2. Try LocalStorage (Fallback)
        if (!profileData) {
            try {
                const stored = localStorage.getItem(storageKey);
                if (stored) {
                    profileData = JSON.parse(stored);
                    source = 'local_storage';
                    logger.log('⚠️ Loaded profile from LocalStorage (Fallback - Sync missing)');
                }
            } catch (e) {
                logger.error('Failed to parse LocalStorage profile:', e);
            }
        }

        if (!profileData) {
            logger.log('No stored profile found for:', storageKey);
            return null;
        }

        logger.log('✅ Chat profile loaded:', storageKey, 'Source:', source);

        try {
            // CRITICAL FIX: Enhanced debugging for persistence issues
            logger.log('🗂️ RESTORING CHAT PROFILE:', {
                storageKey: storageKey,
                source: source,
                hasPlotHistory: !!(profileData.plotHistory && Array.isArray(profileData.plotHistory)),
                plotHistoryLength: profileData.plotHistory?.length || 0,
                hasElements: {
                    historyList: !!this.elements.historyList,
                    statusText: !!this.elements.statusText,
                    sidebar: !!this.elements.sidebar
                }
            });

            // Restore plot history
            if (profileData.plotHistory && Array.isArray(profileData.plotHistory)) {
                this.plotHistory = profileData.plotHistory;
                logger.log('✅ History restored:', this.plotHistory.length, 'entries');
                logger.log('🔄 Calling renderHistory()...');

                // Force render with enhanced logging
                this.renderHistory();

                // Verify history was rendered
                if (this.elements.historyList) {
                    const renderedCount = this.elements.historyList.querySelectorAll('.mr-history-item').length;
                    logger.log('📊 History items rendered:', renderedCount);

                    // Additional check for any existing content
                    const historyContent = this.elements.historyList.innerHTML;
                    logger.log('📄 History list HTML preview:', historyContent.substring(0, 200) + (historyContent.length > 200 ? '...' : ''));
                }
            } else {
                logger.log('⚠️ No plot history found in profile');
            }

            // Restore recent directions
            if (profileData.recentDirections && Array.isArray(profileData.recentDirections)) {
                this.recentDirections = profileData.recentDirections;
                logger.log('✅ Recent directions restored:', this.recentDirections.length);
            }

            // Restore settings
            if (profileData.autoApproveTimeout) {
                this.autoApproveTimeout = profileData.autoApproveTimeout;
                logger.log('✅ Auto-approve timeout restored:', this.autoApproveTimeout);
            }
            if (typeof profileData.sidebarCollapsed === 'boolean') {
                this.isCollapsed = profileData.sidebarCollapsed;
                if (this.elements.sidebar) {
                    this.elements.sidebar.classList.toggle('collapsed', this.isCollapsed);
                    logger.log('✅ Sidebar state restored:', this.isCollapsed ? 'collapsed' : 'expanded');
                }
            }

            // Update story intelligence display with restored data
            if (profileData.storyIntelligence) {
                logger.log('✅ Story intelligence data available, updating...');
                this.updateStoryIntelligenceWithData(profileData.storyIntelligence);
            }

            // Display the loaded plot with restored status
            if (profileData.plotText) {
                logger.log('📝 Displaying restored plot:', profileData.plotText.substring(0, 100) + '...');
                // CRITICAL FIX: Skip save during restoration to prevent chat corruption
                this.displayCurrentPlot(profileData.plotText, 'restored', true);

                // Add visual indicator with additional info
                if (this.elements.statusText) {
                    const historyInfo = profileData.plotHistory?.length > 0 ? ` (${profileData.plotHistory.length} history)` : '';
                    this.elements.statusText.textContent = `Restored${historyInfo} `;
                    
                    const icon = document.createElement('i');
                    icon.className = 'fa-solid fa-database';
                    icon.title = 'Loaded from storage';
                    this.elements.statusText.appendChild(icon);
                    
                    logger.log('✅ Status text updated with history indicator');
                }

                logger.log('🎉 Profile restoration complete!');
                return profileData;
            }

        } catch (error) {
            logger.error('Failed to load chat profile:', error);
        }

        return null;
    }

    /**
     * Update story intelligence with data from profile
     * @param {Object} data - The story intelligence data
     */
    updateStoryIntelligenceWithData(data) {
        if (!data) return;

        try {
            // Update arc status if available
            if (data.arcStatus) {
                if (this.elements.arcType) this.elements.arcType.textContent = data.arcStatus.arcName || 'Natural Progression';
                if (this.elements.arcPercentage) this.elements.arcPercentage.textContent = `${data.arcStatus.progress || 0}%`;
                if (this.elements.arcFill) this.elements.arcFill.style.width = `${data.arcStatus.progress || 0}%`;
                if (this.elements.arcPhase) this.elements.arcPhase.textContent = this.formatPhaseName(data.arcStatus.currentPhase || 'Not started');

                if (this.elements.arcProgress) {
                    this.elements.arcProgress.style.display = data.arcStatus.hasActiveArc ? 'block' : 'none';
                }
            }

            // Update character analysis
            if (data.characterAnalysis && this.elements.characterAnalysis) {
                this.elements.characterAnalysis.textContent = data.characterAnalysis;
            }

            // Update world context
            if (data.worldContext && this.elements.worldContext) {
                this.elements.worldContext.textContent = data.worldContext;
            }

            // Update character count
            if (data.characterCount && this.elements.characterCount) {
                this.elements.characterCount.textContent = data.characterCount;
            }

            // CRITICAL FIX: Restore Tone and Pacing
            if (data.tone) {
                const toneEl = document.getElementById('mr_tone_analysis');
                if (toneEl) toneEl.textContent = data.tone;
            }

            if (data.pacing) {
                const pacingEl = document.getElementById('mr_pacing_guidance');
                if (pacingEl) pacingEl.textContent = data.pacing;
            }

            logger.log('Story intelligence updated from profile data');

        } catch (error) {
            logger.error('Error updating story intelligence from data:', error);
        }
    }

    /**
     * Update story intelligence with new insights
     * @param {Object} insights - The insights object from plot generation
     */
    updateInsightsDisplay(insights) {
        try {
            if (!insights) return;

            // Update Tone
            const toneEl = document.getElementById('mr_tone_analysis');
            if (toneEl && insights.tone) {
                toneEl.textContent = insights.tone;
                // Add tooltip or color coding based on tone if desired
            }

            // Update Pacing
            const pacingEl = document.getElementById('mr_pacing_guidance');
            if (pacingEl && insights.pacing) {
                pacingEl.textContent = insights.pacing;
            }

            logger.log('Updated insights display:', insights);

        } catch (error) {
            logger.error('Error updating insights display:', error);
        }
    }

    /**
     * Get injected plots timeline for profile tracking
     * @returns {Array} Array of injected plot entries
     */
    getInjectedPlotsTimeline() {
        // This would track actual plot injections - for now, return empty array
        // In a full implementation, this would be populated when plots are actually injected into chat
        return [];
    }

    /**
     * Extract character insight for profile storage
     * @returns {string} Character analysis text
     */
    extractCharacterInsight() {
        return this.elements.characterAnalysis?.textContent || 'No character data';
    }

    /**
     * Extract world context for profile storage
     * @returns {string} World context text
     */
    extractWorldContext() {
        return this.elements.worldContext?.textContent || 'No world data';
    }

    /**
     * Get profile index for cross-chat navigation
     * @returns {Object} Profile index object
     */
    getProfileIndex() {
        try {
            const indexKey = this.getProfileIndexKey();
            const storedIndex = localStorage.getItem(indexKey);
            return storedIndex ? JSON.parse(storedIndex) : {};
        } catch (error) {
            logger.error('Failed to get profile index:', error);
            return {};
        }
    }

    /**
     * Save plot to cross-device storage (migrated from localStorage)
     * @param {string} plotText - The plot text to save
     * @param {string} status - The plot status
     * @param {boolean} skipSave - If true, skip saving (for initial load restoration)
     */
    savePlotToStorage(plotText, status, skipSave = false) {
        // CRITICAL FIX: Don't save during initial load restoration to prevent chat corruption
        if (skipSave) {
            logger.log('Skipping save (initial load restoration)');
            return;
        }

        // Delegate to saveChatProfile which handles both Sync (Primary) and Local (Secondary)
        this.saveChatProfile(plotText, status);
    }

    /**
     * Get the current plot data for injection
     * @returns {Object|null} { text, status } or null
     */
    getCurrentPlot() {
        if (!this.currentPlot) return null;

        // Determine status from UI if possible, or use internal tracking
        let status = 'unknown';
        if (this.elements.statusText) {
            const text = this.elements.statusText.textContent?.toLowerCase() || '';
            if (text.includes('ready')) status = 'ready';
            else if (text.includes('injected')) status = 'injected';
            else if (text.includes('restored')) status = 'restored';
            else if (text.includes('pending')) status = 'pending';
        }

        return {
            text: this.currentPlot,
            status: status
        };
    }

    /**
     * Load plot from cross-device storage (migrated from localStorage)
     * @returns {Object|null} Loaded plot data or null
     */
    loadPlotFromStorage() {
        // Fallback to localStorage system
        return this.loadChatProfile();
    }

    /**
     * Initialize DOM elements
     * @returns {PlotPreviewElements}
     */
    initializeElements() {
        const elements = {
            sidebar: document.getElementById('mr_plot_sidebar'),
            toggleBtn: document.getElementById('mr_toggle_sidebar'),
            statusIndicator: document.getElementById('mr_status_indicator'),
            statusText: document.getElementById('mr_status_text'),
            currentPlotText: document.getElementById('mr_current_plot_text'),
            nextPlotText: document.getElementById('mr_next_plot_text'),
            directionInput: /** @type {HTMLInputElement} */ (document.getElementById('mr_plot_direction')),
            recentDirectionsList: document.getElementById('mr_recent_directions'),
            historyList: document.getElementById('mr_history_list'),
            historyLimitInput: /** @type {HTMLInputElement} */ (document.getElementById('mr_history_limit')),
            historyToggle: document.getElementById('mr_history_toggle'),
            historyContent: document.getElementById('mr_history_content'),
            modal: document.getElementById('mr_plot_editor_modal'),
            editorText: /** @type {HTMLTextAreaElement} */ (document.getElementById('mr_plot_editor_text')),
            closeModalBtn: document.getElementById('mr_close_modal'),

            // New story intelligence elements
            arcProgress: document.getElementById('mr_arc_progress'),
            arcType: document.getElementById('mr_arc_type'),
            arcFill: document.getElementById('mr_arc_fill'),
            arcPhase: document.getElementById('mr_arc_phase'),
            arcPercentage: document.getElementById('mr_arc_percentage'),
            storyIntel: document.getElementById('mr_story_intel'),
            intelToggle: document.getElementById('mr_intel_toggle'),
            intelContent: document.getElementById('mr_intel_content'),
            characterAnalysis: document.getElementById('mr_character_analysis'),
            worldContext: document.getElementById('mr_world_context'),
            characterCount: document.getElementById('mr_character_count'),

            // Template gallery elements
            templateGallery: document.getElementById('mr_template_gallery'),
            templateToggle: document.getElementById('mr_template_toggle'),
            templateContent: document.getElementById('mr_template_content'),
            categoryTabs: document.getElementById('mr_category_tabs'),
            templatesList: document.getElementById('mr_templates_list'),
            tabButtons: document.querySelectorAll('.mr-tab-btn'),
            templateItems: document.querySelectorAll('.mr-template-item'),
            templateSelectButtons: document.querySelectorAll('.mr-template-select')
        };

        if (elements.sidebar) {
            elements.sidebar.setAttribute('role', 'complementary');
            elements.sidebar.setAttribute('aria-modal', 'false');
            elements.sidebar.setAttribute('aria-label', 'Machinor Roundtable plot preview');
        }

        // Validate all elements exist (removed timerDisplay from validation)
        for (const [key, element] of Object.entries(elements)) {
            if (!element) {
                logger.warn(`Element not found: ${key}`);
            }
        }

        logger.log('Plot Preview Manager initialized');
        return elements;
    }

    /**
     * Initialize mobile toggle functionality
     */
    initializeMobileToggle() {
        const mobileToggle = document.getElementById('mr_mobile_toggle');
        if (!mobileToggle || !this.elements.sidebar) return;
        if (mobileToggle.dataset.mrInitialized) return;

        mobileToggle.setAttribute('aria-controls', 'mr_plot_sidebar');
        mobileToggle.setAttribute('aria-expanded', 'false');
        mobileToggle.setAttribute('aria-label', 'Toggle Plot Preview');

        let overlay = document.querySelector('.mr-mobile-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'mr-mobile-overlay mobile-hidden';
            overlay.setAttribute('role', 'presentation');
            document.body.appendChild(overlay);
        }
        this.mobileOverlay = /** @type {HTMLElement} */ (overlay);

        // Connect the close button in HTML instead of creating one dynamically
        const closeBtn = document.getElementById('mr_mobile_close');

        const toggleHandler = () => this.toggleMobileSidebar();
        const closeHandler = () => this.hideMobileSidebar();

        mobileToggle.addEventListener('click', toggleHandler);
        overlay.addEventListener('click', closeHandler);
        
        if (closeBtn) {
            closeBtn.addEventListener('click', closeHandler);
        }

        mobileToggle.dataset.mrInitialized = 'true';
        this.ensurePortalPlaceholders();
        this.updateResponsivePlacement();

        window.addEventListener('resize', () => {
            if (this.mobileResizeTimeout) {
                clearTimeout(this.mobileResizeTimeout);
            }

            this.mobileResizeTimeout = window.setTimeout(() => {
                const wasMobile = this.isMobile;
                this.isMobile = window.innerWidth <= 768;

                if (wasMobile && !this.isMobile && this.mobileSidebarVisible) {
                    this.hideMobileSidebar(true);
                }

                this.updateResponsivePlacement();

                if (!this.isMobile) {
                    this.updateMobileAccessibilityState(false);
                    document.body.style.overflow = '';
                } else {
                    this.updateMobileAccessibilityState(this.mobileSidebarVisible);
                }
            }, 150);
        });

        this.addTouchGestures();

        // Show mobile toggle after positioning (fixes visual flashing)
        setTimeout(() => {
            mobileToggle.style.opacity = '1';
        }, 100);

        logger.log('Mobile toggle initialized');
    }

    createMobileCloseButton() {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'mr-mobile-close-btn';
        
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-times';
        closeBtn.appendChild(icon);
        
        closeBtn.setAttribute('aria-label', 'Close Plot Preview');
        return closeBtn;
    }

    toggleMobileSidebar() {
        if (this.mobileSidebarVisible) {
            this.hideMobileSidebar();
        } else {
            this.showMobileSidebar();
        }
    }

    showMobileSidebar() {
        if (this.mobileSidebarVisible || !this.isMobile || !this.elements.sidebar || !this.mobileOverlay) return;

        this.mobileSidebarVisible = true;
        const mobileToggle = document.getElementById('mr_mobile_toggle');
        this.previouslyFocusedElement = mobileToggle || (document.activeElement instanceof HTMLElement ? document.activeElement : null);

        // Use CSS classes - full screen approach avoids positioning conflicts
        this.isCollapsed = false;
        this.elements.sidebar.classList.remove('collapsed');
        this.elements.sidebar.classList.remove('mobile-hidden');
        this.elements.sidebar.classList.add('mobile-visible');
        this.mobileOverlay.classList.remove('mobile-hidden');
        this.mobileOverlay.classList.add('mobile-visible');

        this.originalBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        mobileToggle?.classList.add('is-active');

        this.updateMobileAccessibilityState(true);
        this.applyMobileFocusTrap();
        logger.log('Mobile sidebar shown (full screen)');
    }

    hideMobileSidebar(skipAnimation = false) {
        if (!this.mobileSidebarVisible || !this.elements.sidebar || !this.mobileOverlay) return;

        this.mobileSidebarVisible = false;
        const mobileToggle = document.getElementById('mr_mobile_toggle');

        // SIMPLIFIED: Use CSS classes for all state changes
        this.elements.sidebar.classList.remove('mobile-visible');
        this.elements.sidebar.classList.add('mobile-hidden');
        this.mobileOverlay.classList.remove('mobile-visible');
        this.mobileOverlay.classList.add('mobile-hidden');

        // Clear inline styles to prevent desktop interference
        if (this.elements.sidebar.style.position) {
            this.elements.sidebar.style.position = '';
            this.elements.sidebar.style.bottom = '';
            this.elements.sidebar.style.left = '';
            this.elements.sidebar.style.top = '';
            this.elements.sidebar.style.transform = '';
            this.elements.sidebar.style.width = '';
            this.elements.sidebar.style.maxWidth = '';
        }

        document.body.style.overflow = this.originalBodyOverflow;
        mobileToggle?.classList.remove('is-active');

        this.updateMobileAccessibilityState(false);
        this.releaseMobileFocusTrap();

        logger.log('Mobile sidebar hidden (CSS-only approach)');
    }


    /**
     * Add touch gesture support for mobile
     */
    addTouchGestures() {
        if (!this.elements.sidebar) return;

        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;

        // Touch start
        this.elements.sidebar.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        });

        // Touch end
        this.elements.sidebar.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].clientX;
            touchEndY = e.changedTouches[0].clientY;

            // Calculate swipe distance
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);

            // Check if it's a horizontal swipe (more horizontal than vertical)
            if (absX > absY && absX > 50) {
                // Swipe left to close
                if (deltaX < -30 && this.mobileSidebarVisible) {
                    this.hideMobileSidebar();
                }
            }
        });
    }

    /**
     * Bind event listeners
     */
    /**
     * Helper: Debounce function for UI performance
     */
    _debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    bindEvents() {
        const addListener = (element, type, handler) => {
            if (element) {
                element.addEventListener(type, handler);
                // Store reference if element is a DOM node we track
                if (this.domListenerRefs) {
                    // For simplicity in destroy(), we'll remove all listeners from elements we know about
                    // This weakmap approach is a bit complex for simple cleanup,
                    // so we'll primarily rely on the destroy method explicitly removing from known elements
                    // and clearing the main container if possible, but since these are specific elements:
                    
                    // We'll store the remove function in a map for the element+type if needed,
                    // but for now let's just use the explicit removal in destroy() which is cleaner for static elements.
                    // The eventListenerRefs map will hold the handlers so we can pass them to removeEventListener.
                    const key = `dom_${element.id || element.className}_${type}`;
                    this.eventListenerRefs.set(key, { element, type, handler });
                }
            }
        };

        // Sidebar toggle
        if (this.elements.toggleBtn) {
            const handler = () => this.toggleSidebar();
            addListener(this.elements.toggleBtn, 'click', handler);
        }

        // Plot actions
        const editBtn = document.getElementById('mr_edit_plot');
        const skipBtn = document.getElementById('mr_skip_plot');
        const regenerateBtn = document.getElementById('mr_regenerate_next');
        const manualBtn = document.getElementById('mr_manual_plot_btn');
        const saveBtn = document.getElementById('mr_save_plot');
        const cancelBtn = document.getElementById('mr_cancel_edit');

        if (editBtn) addListener(editBtn, 'click', () => this.editPlot());
        if (skipBtn) addListener(skipBtn, 'click', () => this.skipPlot());
        if (regenerateBtn) addListener(regenerateBtn, 'click', () => this.regenerateNextPlot());
        if (manualBtn) addListener(manualBtn, 'click', () => this.manualPlotEntry());

        // Direction input
        if (this.elements.directionInput) {
            const keypressHandler = (e) => {
                if (e.key === 'Enter') {
                    this.saveDirection();
                }
            };
            addListener(this.elements.directionInput, 'keypress', keypressHandler);
            
            // Debounce input events to avoid excessive DOM updates
            const debouncedShowDirections = this._debounce(() => this.showRecentDirections(), 300);
            addListener(this.elements.directionInput, 'input', debouncedShowDirections);
        }

        // History
        if (this.elements.historyToggle) {
            addListener(this.elements.historyToggle, 'click', () => this.toggleHistory());
        }
        if (this.elements.historyLimitInput) {
            addListener(this.elements.historyLimitInput, 'change', () => this.updateHistoryLimit());
        }

        // Template gallery buttons
        const templateButtons = document.querySelectorAll('.mr-template-btn');
        templateButtons.forEach((button, index) => {
            const handler = (e) => this.handleTemplateSelection(e);
            // Store with unique key
            const key = `dom_template_btn_${index}_click`;
            if (button) {
                button.addEventListener('click', handler);
                this.eventListenerRefs.set(key, { element: button, type: 'click', handler });
            }
        });

        // Modal
        if (this.elements.closeModalBtn) {
            addListener(this.elements.closeModalBtn, 'click', () => this.closeModal());
        }
        if (saveBtn) addListener(saveBtn, 'click', () => this.saveEditedPlot());
        if (cancelBtn) addListener(cancelBtn, 'click', () => this.closeModal());

        // Close modal on outside click
        if (this.elements.modal) {
            const modalClickHandler = (e) => {
                if (e.target === this.elements.modal) {
                    this.closeModal();
                }
            };
            addListener(this.elements.modal, 'click', modalClickHandler);
        }

        // Story intelligence toggle
        if (this.elements.intelToggle) {
            addListener(this.elements.intelToggle, 'click', () => this.toggleStoryIntel());
        }

        logger.log('Plot Preview events bound');
    }

    /**
     * Update story intelligence display
     */
    updateStoryIntelligence() {
        try {
            // Update arc status
            this.updateArcDisplay();

            // Update character analysis
            this.updateCharacterAnalysis();

            // Update world context
            this.updateWorldContext();

            // Update character count
            this.updateCharacterCount();

        } catch (error) {
            logger.error('Error updating story intelligence:', error);
        }
    }

    /**
     * Update arc progress display
     */
    updateArcDisplay() {
        if (!this.elements.arcType || !this.elements.arcFill) return;

        try {
            // Get arc status from plot engine if available
            const arcStatus = this.plotEngine?.narrativeArc?.getArcStatus();

            if (arcStatus) {
                // Update arc type
                const arcName = arcStatus.arcName || 'Natural Progression';
                this.elements.arcType.textContent = arcName;

                // Update progress
                const progress = arcStatus.progress || 0;
                this.elements.arcFill.style.width = `${progress}%`;
                this.elements.arcPercentage.textContent = `${progress}%`;

                // Update current phase
                const phase = arcStatus.currentPhase || 'Not started';
                this.elements.arcPhase.textContent = this.formatPhaseName(phase);

                // Show/hide arc progress
                if (this.elements.arcProgress) {
                    this.elements.arcProgress.style.display = arcStatus.hasActiveArc ? 'block' : 'none';
                }
            } else {
                // Hide arc progress if no active arc
                if (this.elements.arcProgress) {
                    this.elements.arcProgress.style.display = 'none';
                }
            }

        } catch (error) {
            logger.error('Error updating arc display:', error);
        }
    }

    /**
     * Update character analysis display with enhanced data extraction
     */
    updateCharacterAnalysis() {
        if (!this.elements.characterAnalysis) return;

        try {
            const context = getContext();
            const currentChar = context?.characters?.[context?.characterId];

            if (currentChar) {
                let analysisText = '';

                // Try ST integration first
                if (this.plotEngine?.stIntegration) {
                    const analysis = this.plotEngine.stIntegration.analyzeCharacterProfile(currentChar);

                    if (analysis) {
                        if (analysis.traits?.length > 0) {
                            analysisText += `Traits: ${analysis.traits.slice(0, 3).join(', ')}`;
                        }
                        if (analysis.arcPotential) {
                            analysisText += analysisText ? ' | ' : '';
                            analysisText += `Arc: ${analysis.arcPotential}`;
                        }
                    }
                }

                // Fallback: Extract basic info from character object
                if (!analysisText) {
                    const traits = [];

                    // Extract personality traits from description/personality
                    const personalityText = (currentChar.personality || '').toLowerCase();
                    const descriptionText = (currentChar.description || '').toLowerCase();
                    const combinedText = `${personalityText} ${descriptionText}`;

                    // Look for common personality indicators
                    if (combinedText.includes('confident') || combinedText.includes('bold')) traits.push('Confident');
                    if (combinedText.includes('shy') || combinedText.includes('quiet') || combinedText.includes('reserved')) traits.push('Reserved');
                    if (combinedText.includes('witty') || combinedText.includes('funny') || combinedText.includes('humorous')) traits.push('Witty');
                    if (combinedText.includes('mysterious') || combinedText.includes('enigmatic')) traits.push('Mysterious');
                    if (combinedText.includes('caring') || combinedText.includes('kind') || combinedText.includes('gentle')) traits.push('Caring');
                    if (combinedText.includes('strong') || combinedText.includes('brave') || combinedText.includes('fierce')) traits.push('Strong');
                    if (combinedText.includes('intelligent') || combinedText.includes('smart') || combinedText.includes('clever')) traits.push('Intelligent');

                    // Extract character name characteristics
                    if (currentChar.name) {
                        const charName = currentChar.name.toLowerCase();
                        if (charName.includes('mage') || charName.includes('wizard') || charName.includes('sorcerer')) traits.push('Magical');
                        if (charName.includes('knight') || charName.includes('warrior') || charName.includes('fighter')) traits.push('Martial');
                        if (charName.includes('priest') || charName.includes('cleric') || charName.includes('healer')) traits.push('Healing');
                    }

                    if (traits.length > 0) {
                        analysisText = `Traits: ${traits.slice(0, 3).join(', ')}`;
                    } else {
                        analysisText = `Character: ${currentChar.name || 'Unnamed'}`;
                    }
                }

                this.elements.characterAnalysis.textContent = analysisText;
                logger.log('Character analysis:', analysisText);

            } else {
                this.elements.characterAnalysis.textContent = 'No character selected';
            }

        } catch (error) {
            logger.error('Error updating character analysis:', error);
            this.elements.characterAnalysis.textContent = 'Character data unavailable';
        }
    }

    /**
     * Update world context display with enhanced data extraction
     */
    updateWorldContext() {
        if (!this.elements.worldContext) return;

        try {
            let contextText = '';

            // Try ST integration first
            if (this.plotEngine?.stIntegration) {
                const worldInfo = this.plotEngine.stIntegration.getWorldInfo();

                if (worldInfo && Object.keys(worldInfo).length > 0) {
                    let totalEntries = 0;

                    // Count world info entries
                    Object.values(worldInfo).forEach(category => {
                        if (Array.isArray(category)) {
                            totalEntries += category.length;
                        }
                    });

                    contextText = `${totalEntries} world entries`;

                    // Add specific categories if available
                    if (worldInfo.locations?.length > 0) {
                        contextText += `, ${worldInfo.locations.length} locations`;
                    }
                    if (worldInfo.organizations?.length > 0) {
                        contextText += `, ${worldInfo.organizations.length} groups`;
                    }
                }
            }

            // Fallback: Extract context from available sources
            if (!contextText) {
                const context = getContext();
                const chat = context?.chat || [];

                // Analyze chat for world context
                let locationMentions = 0;
                let characterMentions = 0;
                const locationKeywords = ['room', 'house', 'forest', 'city', 'town', 'castle', 'tavern', 'market', 'street', 'garden', 'hall'];
                const characterKeywords = ['knight', 'mage', 'merchant', 'guard', 'noble', 'villager'];

                chat.slice(-20).forEach(msg => { // Analyze last 20 messages
                    const text = (msg.mes || '').toLowerCase();
                    locationKeywords.forEach(keyword => {
                        if (text.includes(keyword)) locationMentions++;
                    });
                    characterKeywords.forEach(keyword => {
                        if (text.includes(keyword)) characterMentions++;
                    });
                });

                if (locationMentions > 0 || characterMentions > 0) {
                    contextText = `Chat context: ${locationMentions} locations, ${characterMentions} characters mentioned`;
                } else {
                    contextText = 'Active chat context detected';
                }
            }

            this.elements.worldContext.textContent = contextText || 'No world context available';
            logger.log('World context:', contextText);

        } catch (error) {
            logger.error('Error updating world context:', error);
            this.elements.worldContext.textContent = 'World context unavailable';
        }
    }

    /**
     * Update character count display with enhanced detection
     */
    updateCharacterCount() {
        if (!this.elements.characterCount) return;

        try {
            // Try chat injector first
            const activeCharacters = this.chatInjector?.getActiveCharacters() || [];

            if (activeCharacters.length > 0) {
                if (activeCharacters.length === 1) {
                    this.elements.characterCount.textContent = 'Single character';
                } else {
                    this.elements.characterCount.textContent = `${activeCharacters.length} characters in group`;
                }
                return;
            }

            // Fallback: Analyze chat for character count
            const context = getContext();
            const chat = context?.chat || [];

            if (chat.length === 0) {
                this.elements.characterCount.textContent = 'No chat yet';
                return;
            }

            // Count unique speakers in recent chat
            const recentMessages = chat.slice(-20);
            const speakers = new Set();

            recentMessages.forEach(msg => {
                if (!msg.is_user && msg.name) {
                    speakers.add(msg.name);
                }
            });

            const charCount = speakers.size;

            if (charCount === 0) {
                this.elements.characterCount.textContent = 'No characters detected';
            } else if (charCount === 1) {
                this.elements.characterCount.textContent = 'Single character';
            } else {
                this.elements.characterCount.textContent = `${charCount} characters active`;
            }

            logger.log('Character count updated:', charCount);

        } catch (error) {
            logger.error('Error updating character count:', error);
            this.elements.characterCount.textContent = 'Character count unavailable';
        }
    }

    /**
     * Toggle story intelligence panel
     */
    toggleStoryIntel() {
        if (!this.elements.intelContent || !this.elements.intelToggle) return;

        const isCollapsed = this.elements.intelContent.classList.contains('collapsed');

        if (isCollapsed) {
            this.elements.intelContent.classList.remove('collapsed');
            this.elements.intelToggle.querySelector('i').className = 'fa-solid fa-chevron-up';
        } else {
            this.elements.intelContent.classList.add('collapsed');
            this.elements.intelToggle.querySelector('i').className = 'fa-solid fa-chevron-down';
        }
    }

    /**
     * Handle template selection with proper plot engine integration
     * Templates should GUIDE generation, not replace it with literal text
     */
    async handleTemplateSelection(event) {
        const button = event.currentTarget;
        const template = button.dataset.template;

        if (!template) {
            logger.warn('No template data found on button');
            return;
        }

        // Clear any existing states from other template buttons
        document.querySelectorAll('.mr-template-btn').forEach(btn => {
            btn.classList.remove('success', 'error');
        });

        // Add loading state
        button.classList.add('loading');
        button.style.pointerEvents = 'none';

        try {
            logger.log('Template selected for guidance:', template);

            // Get current character and context for generation
            const character = getCurrentCharacter();

            if (!character) {
                throw new Error('No character selected');
            }

            const chatHistory = this.getRecentChatHistory();

            // Convert template to guidance for the plot engine
            const templateGuidance = this.getTemplateGuidance(template);

            // Generate plot using the plot engine with template guidance
            const plotContext = await this.plotEngine.generatePlotContext(character, chatHistory, {
                guidance: templateGuidance,
                template: template
            });

            // Remove loading state
            button.classList.remove('loading');
            button.style.pointerEvents = 'auto';

            // Add success state
            button.classList.add('success');

            if (plotContext) {
                // Display the GENERATED plot (not literal template text)
                this.displayCurrentPlot(plotContext, 'ready');

                // Show success message
                // @ts-ignore - toastr is a global library
                toastr.success(`Template "${template}" guiding plot generation`, 'Machinor Roundtable');

                logger.log('Template applied as guidance:', template, 'Generated plot:', plotContext.substring(0, 100) + '...');
            } else {
                throw new Error('No plot context generated');
            }

            // Remove success state after 2 seconds
            setTimeout(() => {
                button.classList.remove('success');
            }, 2000);

        } catch (error) {
            // Handle errors
            button.classList.remove('loading');
            button.style.pointerEvents = 'auto';
            button.classList.add('error');

            logger.error('Template application failed:', error);

            // @ts-ignore - toastr is a global library
            toastr.error(`Failed to apply template "${template}": ${error.message}`, 'Machinor Roundtable');

            // Remove error state after 3 seconds
            setTimeout(() => {
                button.classList.remove('error');
            }, 3000);
        }
    }

    /**
     * Convert template selection to guidance for plot generation
     * @param {string} template - The selected template
     * @returns {string} Guidance text for plot generation
     */
    getTemplateGuidance(template) {
        const templateGuidanceMap = {
            'meet_cute': 'Focus on a charming first encounter that could develop into romance. Emphasize the initial spark of attraction and emotional connection between characters.',
            'adventure_begins': 'Introduce an exciting quest or journey. Create anticipation and establish the stakes of the adventure that lies ahead.',
            'mystery_hook': 'Introduce an intriguing mystery or puzzle. Create questions that need answers and build suspense around the unknown.',
            'conflict_rises': 'Escalate existing tensions or introduce new obstacles. Build dramatic tension and create challenges for characters to overcome.'
        };

        return templateGuidanceMap[template] || `Apply the ${template} narrative template to guide plot development in an interesting direction.`;
    }

    /**
     * Format phase name for display
     */
    formatPhaseName(phase) {
        return phase.split('_').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    /**
     * Load settings from extension settings
     */
    loadSettings() {
        const context = getContext();

        // Ensure extension_settings exists
        if (!context.extension_settings) {
            context.extension_settings = {};
        }

        // Ensure machinor_roundtable settings exist
        if (!context.extension_settings.machinor_roundtable) {
            context.extension_settings.machinor_roundtable = {};
        }

        const settings = context.extension_settings.machinor_roundtable;

        this.historyLimit = settings.historyLimit || 5;
        this.recentDirections = settings.recentDirections || [];
        this.isCollapsed = settings.sidebarCollapsed !== false; // Default to collapsed

        if (this.elements.historyLimitInput) {
            this.elements.historyLimitInput.value = this.historyLimit.toString();
        }

        if (this.isCollapsed && this.elements.sidebar) {
            this.elements.sidebar.classList.add('collapsed');
        }

        logger.log('Plot Preview settings loaded (removed auto-approve timeout)');
    }

    /**
     * Save settings to extension settings
     */
    saveSettings() {
        const context = getContext();

        // Ensure extension_settings exists
        if (!context.extension_settings) {
            context.extension_settings = {};
        }


        // Ensure machinor_roundtable settings exist
        if (!context.extension_settings.machinor_roundtable) {
            context.extension_settings.machinor_roundtable = {};
        }

        const settings = context.extension_settings.machinor_roundtable;

        settings.historyLimit = this.historyLimit;
        settings.recentDirections = this.recentDirections;
        settings.sidebarCollapsed = this.isCollapsed;

        // CRITICAL FIX: Don't call saveSettingsDebounced during load sequence
        // Extension settings are auto-saved by SillyTavern, calling this causes conflicts
        // saveSettingsDebounced();
        logger.log('Plot Preview settings updated (settings auto-save handled by ST)');
    }

    /**
     * Toggle sidebar collapse/expand
     */
    toggleSidebar() {
        if (this.isMobile) {
            this.toggleMobileSidebar();
            return;
        }

        this.isCollapsed = !this.isCollapsed;

        if (this.elements.sidebar) {
            this.elements.sidebar.classList.toggle('collapsed', this.isCollapsed);
        }

        this.saveSettings();
        this.updateMobileAccessibilityState(this.mobileSidebarVisible);

        // Update toggle button icon
        if (this.elements.toggleBtn) {
            const icon = this.elements.toggleBtn.querySelector('i');
            if (icon) {
                if (this.isCollapsed) {
                    icon.className = 'fa-solid fa-chevron-right';
                } else {
                    icon.className = 'fa-solid fa-chevron-left';
                }
            }
        }

        logger.log('Sidebar toggled:', this.isCollapsed ? 'collapsed' : 'expanded');
    }

    /**
     * Display current plot with enhanced visual feedback
     * @param {string|Object} plotText - The plot text to display
     * @param {string} [status='ready'] - The plot status (ready, pending, injected, restored)
     * @param {boolean} [skipSave=false] - Skip saving to storage (used during restoration)
     * @returns {void}
     */
    displayCurrentPlot(plotText, status = 'ready', skipSave = false) {
        // Re-enable buttons when plot is displayed
        this.setButtonsEnabled(true);
        
        // Handle object input (e.g. from generatePlotContext)
        const text = typeof plotText === 'object' ? plotText.text : plotText;
        this.currentPlot = text;

        if (this.elements.currentPlotText) {
            this.elements.currentPlotText.textContent = text;
            // Optional chaining for safety
            logger.log('Plot text set to:', text?.substring(0, 50) + '...');

            // Force visibility on mobile
            if (this.isMobile && this.mobileSidebarVisible) {
                this.elements.currentPlotText.style.visibility = 'visible';
                this.elements.currentPlotText.style.opacity = '1';
            }
        } else {
            logger.warn('currentPlotText element not found');
        }

        this.updateStatus(status);

        // Save to persistent storage (skip if this is initial load restoration)
        this.savePlotToStorage(text, status, skipSave);

        logger.log('Current plot displayed:', status);
    }

    /**
     * Display next plot preview
     * @param {string} plotText - The next plot text
     * @returns {void}
     */
    displayNextPlot(plotText) {
        this.nextPlot = plotText;

        if (this.elements.nextPlotText) {
            this.elements.nextPlotText.textContent = plotText || 'Generating next plot...';
        }

        logger.log('Next plot preview displayed');
    }

    /**
     * Update status indicator and text
     * @param {string} status - The status to display
     * @returns {void}
     */
    updateStatus(status) {
        if (this.elements.statusIndicator) {
            // Remove all status classes
            this.elements.statusIndicator.className = 'mr-status-indicator';
            this.elements.statusIndicator.classList.add(status);
        }

        // Update status text (removed paused state)
        const statusTexts = {
            ready: 'Ready',
            pending: 'Generating...',
            injected: 'Injected'
        };

        if (this.elements.statusText) {
            this.elements.statusText.textContent = statusTexts[status] || 'Unknown';
        }

        logger.log('Status updated:', status);
    }

    /**
     * Approve current plot and prepare for injection
     */
    async approveAndInject() {
        if (!this.currentPlot) {
            logger.warn('No plot to inject');
            return;
        }

        this.updateStatus('injected');

        // Add to history (only if not editing an existing plot)
        if (!this.isEditingPlot || !this.editingPlotId) {
            this.addToHistory(this.currentPlot);
        } else {
            logger.log('Skipping history add - editing existing plot');
        }

        // Save the injected state and history to storage (Lazy Sync)
        this.saveChatProfile(this.currentPlot, 'injected');

        logger.log('Plot approved and prepared for injection:', this.currentPlot);

        // @ts-ignore - toastr is a global library
        toastr.success('Plot prepared - will inject on next generation', 'Machinor Roundtable');

        logger.log('Plot remains in injected state for editing');
    }

    /**
     * Edit current plot (inline or modal)
     */
    editPlot() {
        if (!this.currentPlot) {
            // @ts-ignore - toastr is a global library
            toastr.warning('No plot to edit', 'Machinor Roundtable');
            return;
        }

        // Check if current plot is in history
        const existingPlot = this.plotHistory.find(plot => plot.text === this.currentPlot);

        // Set editing state
        this.isEditingPlot = !!existingPlot;
        this.editingPlotId = existingPlot ? existingPlot.id : null;

        // For now, open modal - could add inline editing later
        this.openModal(this.currentPlot);
        logger.log('Plot editor opened, editing existing:', this.isEditingPlot);
    }

    /**
     * Skip current plot and generate new one
     */
    skipPlot() {
        this.currentPlot = null;

        if (this.elements.currentPlotText) {
            this.elements.currentPlotText.textContent = 'Generating new plot...';
        }

        this.updateStatus('pending');

        // Trigger new plot generation with current settings
        this.generateNewPlotWithOptions();

        // @ts-ignore - toastr is a global library
        toastr.info('Plot skipped, generating new one...', 'Machinor Roundtable');
        logger.log('Plot skipped');
    }

    /**
     * Regenerate next plot preview
     */
    regenerateNextPlot() {
        if (this.elements.nextPlotText) {
            this.elements.nextPlotText.textContent = 'Regenerating next plot...';
        }

        // Trigger regeneration with current settings
        this.generateNextPlotWithOptions();
        // @ts-ignore - toastr is a global library
        toastr.info('Regenerating next plot...', 'Machinor Roundtable');
        logger.log('Next plot regeneration requested');
    }

    /**
     * Manual plot entry
     */
    manualPlotEntry() {
        this.openModal('', true); // Open empty modal for manual entry
        logger.log('Manual plot entry opened');
    }

    /**
     * Open plot editor modal
     * @param {string} plotText - Text to edit
     * @param {boolean} isManual - Whether this is manual entry
     */
    openModal(plotText = '', isManual = false) {
        if (this.elements.editorText) {
            this.elements.editorText.value = plotText;
        }

        if (this.elements.modal) {
            this.elements.modal.style.display = 'block';

            // Ensure proper z-index for mobile - higher than plot preview
            if (this.isMobile) {
                this.elements.modal.style.zIndex = '5000';
            }
        }

        if (this.elements.editorText) {
            this.elements.editorText.focus();
        }

        // Store whether this is manual entry
        this.isManualEntry = isManual;

        logger.log('Modal opened');
    }

    /**
     * Close plot editor modal
     */
    closeModal() {
        if (this.elements.modal) {
            this.elements.modal.style.display = 'none';
        }
        this.isManualEntry = false;
        logger.log('Modal closed');
    }

    /**
     * Save edited plot
     */
    saveEditedPlot() {
        if (!this.elements.editorText) return;

        const editedText = this.elements.editorText.value.trim();
        const sanitized = sanitizePlotText(editedText);

        if (!sanitized) {
            // @ts-ignore - toastr is a global library
            toastr.warning('Plot cannot be empty or invalid', 'Machinor Roundtable');
            return;
        }
        
        // Use sanitized text
        const textToSave = sanitized;

        if (this.isManualEntry) {
            // Manual entry - set as current plot
            this.displayCurrentPlot(textToSave, 'ready');
            // @ts-ignore - toastr is a global library
            toastr.success('Custom plot saved', 'Machinor Roundtable');
        } else {
            // Edit existing plot
            this.displayCurrentPlot(textToSave, 'ready');

            // Update the history entry if we were editing an existing plot
            if (this.isEditingPlot && this.editingPlotId) {
                const plotIndex = this.plotHistory.findIndex(plot => plot.id === this.editingPlotId);
                if (plotIndex !== -1) {
                    this.plotHistory[plotIndex].text = textToSave;
                    this.plotHistory[plotIndex].timestamp = Date.now(); // Update timestamp
                    this.renderHistory();
                    logger.log('Updated existing plot in history');
                }
            }

            // @ts-ignore - toastr is a global library
            toastr.success('Plot edited successfully', 'Machinor Roundtable');
        }

        // Reset editing state
        this.isEditingPlot = false;
        this.editingPlotId = null;
        this.closeModal();
        logger.log('Plot saved:', textToSave);
    }

    /**
     * Save direction input
     */
    saveDirection() {
        if (!this.elements.directionInput) return;

        const direction = this.elements.directionInput.value.trim();
        const sanitized = sanitizeDirection(direction);

        if (!sanitized) return;

        // Add to recent directions (avoid duplicates)
        this.recentDirections = this.recentDirections.filter(d => d !== sanitized);
        this.recentDirections.unshift(sanitized);

        // Keep only max recent directions
        if (this.recentDirections.length > this.maxRecentDirections) {
            this.recentDirections = this.recentDirections.slice(0, this.maxRecentDirections);
        }

        this.saveSettings();
        // @ts-ignore - toastr is a global library
        toastr.info(`Direction saved`, 'Machinor Roundtable');
        logger.log('Direction saved:', sanitized);
    }

    /**
     * Show recent directions dropdown
     */
    showRecentDirections() {
        if (this.recentDirections.length === 0) return;

        // This is a simplified version - in practice, you'd show a dropdown
        const directionsList = this.recentDirections.slice(0, 3).join(', ');

        if (this.elements.recentDirectionsList) {
            this.elements.recentDirectionsList.textContent = `Recent: ${directionsList}`;
        }
    }

    /**
     * Toggle plot history visibility with iOS spring animations
     */
    toggleHistory() {
        if (!this.elements.historyContent || !this.elements.historyToggle) return;

        const isCollapsed = this.elements.historyContent.classList.contains('collapsed');
        const icon = this.elements.historyToggle.querySelector('i');

        if (isCollapsed) {
            // Expanding - remove collapsed class
            this.elements.historyContent.classList.remove('collapsed');

            // Update ARIA attributes
            this.elements.historyContent.setAttribute('aria-hidden', 'false');
            this.elements.historyToggle.setAttribute('aria-expanded', 'true');

            // Spring animation for icon rotation
            if (icon) {
                icon.style.transform = 'rotate(180deg)';
            }

            // Visual feedback with spring effect
            this.elements.historyToggle.style.transform = 'scale(0.98)';
            setTimeout(() => {
                this.elements.historyToggle.style.transform = 'scale(1)';
            }, 150);

            logger.log('History expanded');
        } else {
            // Collapsing - add collapsed class
            this.elements.historyContent.classList.add('collapsed');

            // Update ARIA attributes
            this.elements.historyContent.setAttribute('aria-hidden', 'true');
            this.elements.historyToggle.setAttribute('aria-expanded', 'false');

            // Spring animation for icon rotation
            if (icon) {
                icon.style.transform = 'rotate(0deg)';
            }

            // Visual feedback with spring effect
            this.elements.historyToggle.style.transform = 'scale(0.98)';
            setTimeout(() => {
                this.elements.historyToggle.style.transform = 'scale(1)';
            }, 150);

            logger.log('History collapsed');
        }
    }

    /**
     * Update history limit
     */
    updateHistoryLimit() {
        if (!this.elements.historyLimitInput) return;

        this.historyLimit = parseInt(this.elements.historyLimitInput.value) || 5;
        this.trimHistory();
        this.saveSettings();
        logger.log('History limit updated:', this.historyLimit);
    }

    /**
     * Add plot to history
     */
    addToHistory(plotText) {
        const plotEntry = {
            text: plotText,
            timestamp: Date.now(),
            id: Date.now().toString()
        };

        this.plotHistory.unshift(plotEntry);
        this.trimHistory();
        this.renderHistory();

        // CRITICAL FIX: Save and Sync Profile immediately after updating history
        // This ensures the new history entry is persisted to settings/sync
        this.saveChatProfile(this.currentPlot, this.currentStatus);

        logger.log('Plot added to history and profile synced');
    }

    /**
     * Trim history to limit
     * Trim history to configured limit, keeping most recent entries
     * @returns {void}
     */
    trimHistory() {
        if (this.plotHistory.length > this.historyLimit) {
            this.plotHistory = this.plotHistory.slice(0, this.historyLimit);
        }
    }

    /**
     * Render plot history
     * @returns {void}
     */
    renderHistory() {
        if (!this.elements.historyList) return;

        // Clear existing content first
        this.elements.historyList.textContent = '';

        // Use ONLY this.plotHistory (loaded from previewHistories)
        if (!this.plotHistory || this.plotHistory.length === 0) {
            const emptyItem = document.createElement('div');
            emptyItem.className = 'mr-history-item';
            emptyItem.textContent = 'No plot history yet';
            this.elements.historyList.appendChild(emptyItem);
            return;
        }

        // Sort by timestamp (newest first)
        const sortedHistory = [...this.plotHistory].sort((a, b) => b.timestamp - a.timestamp);

        // Limit to history limit
        const limitedHistory = sortedHistory.slice(0, this.historyLimit);

        limitedHistory.forEach(plot => {
            const timestamp = new Date(plot.timestamp).toLocaleString();
            const character = plot.character ? ` • ${plot.character}` : '';
            const style = plot.style && plot.style !== 'natural' ? ` • ${plot.style}` : '';
            
            const item = document.createElement('div');
            item.className = 'mr-history-item';
            // Use optional chaining for safety
            item.dataset.plotText = encodeURIComponent(plot.text);
            item.dataset.plotId = plot.id;
            item.title = `${timestamp}${character}${style}`;
            
            const textDiv = document.createElement('div');
            textDiv.className = 'mr-history-text';
            // Use escapeHtml explicitly or textContent implicitly (DOM method is safe)
            // Add null check before substring
            textDiv.textContent = (plot.text?.substring(0, 60) || '') + (plot.text?.length > 60 ? '...' : '');
            
            const metaDiv = document.createElement('div');
            metaDiv.className = 'mr-history-meta';
            
            const timeSpan = document.createElement('span');
            timeSpan.className = 'mr-history-time';
            timeSpan.textContent = new Date(plot.timestamp).toLocaleDateString();
            
            metaDiv.appendChild(timeSpan);
            item.appendChild(textDiv);
            item.appendChild(metaDiv);
            
            // Add click handler directly
            item.addEventListener('click', () => {
                const plotText = decodeURIComponent(item.dataset.plotText);
                if (plotText) {
                    // Clear editing state
                    this.isEditingPlot = false;
                    this.editingPlotId = null;

                    this.displayCurrentPlot(plotText, 'ready');
                    // @ts-ignore - toastr is a global library
                    toastr.info('Plot loaded from history', 'Machinor Roundtable');
                }
            });
            
            this.elements.historyList.appendChild(item);
        });
    }

    /**
     * Generate new plot using the plot engine
     */
    async generateNewPlot() {
        logger.log('Generating new plot...');
        const errorHandler = createErrorHandler('generateNewPlot');

        // CRITICAL FIX: Show "Generating..." status during plot creation
        this.updateStatus('pending');

        try {
            // Use the imported helper functions
            const character = getCurrentCharacter();

            if (!character) {
                this.updateStatus('ready'); // Reset status on error
                // @ts-ignore - toastr is a global library
                toastr.warning('No character selected', 'Machinor Roundtable');
                return;
            }

            const chatHistory = this.getRecentChatHistory();

            // Generate plot using the plot engine
            const plotResult = await this.plotEngine.generatePlotContext(character, chatHistory);

            if (plotResult) {
                const text = typeof plotResult === 'object' ? plotResult.text : plotResult;

                // CRITICAL FIX: Update insights BEFORE displaying plot
                // This ensures DOM has the data when saveChatProfile is called
                if (typeof plotResult === 'object' && plotResult.tone) {
                    this.updateInsightsDisplay(plotResult);
                }

                this.displayCurrentPlot(text, 'generated');

                // Add to history immediately when generated
                this.addToHistory(text);

                // @ts-ignore - toastr is a global library
                toastr.success('New plot generated', 'Machinor Roundtable');
            } else {
                this.updateStatus('ready'); // Reset status if no plot generated
            }
        } catch (error) {
            this.updateStatus('ready'); // Reset status on error
            errorHandler(error, 'Failed to generate plot');
        }
    }

    /**
     * Generate new plot with current Plot Style/Intensity options (for Skip button)
     */
    async generateNewPlotWithOptions() {
        logger.log('Generating new plot with options...');
        const errorHandler = createErrorHandler('generateNewPlotWithOptions');

        // CRITICAL FIX: Show "Generating..." status during plot creation
        this.updateStatus('pending');

        try {
            // Use the imported helper functions
            const character = getCurrentCharacter();

            if (!character) {
                this.updateStatus('ready'); // Reset status on error
                // @ts-ignore - toastr is a global library
                toastr.warning('No character selected', 'Machinor Roundtable');
                return;
            }

            const chatHistory = this.getRecentChatHistory();

            // Get Plot Style and Intensity from settings
            const plotStyle = $('#mr_plot_style').val() || 'natural';
            const plotIntensity = $('#mr_plot_intensity').val() || 'moderate';
            logger.log('New Plot Style:', plotStyle, 'Plot Intensity:', plotIntensity);

            // Combine options for plot generation
            const plotOptions = {
                style: plotStyle,
                intensity: plotIntensity
            };

            // Generate plot using the plot engine with options
            const plotResult = await this.plotEngine.generatePlotContext(character, chatHistory, plotOptions);

            if (plotResult) {
                const text = typeof plotResult === 'object' ? plotResult.text : plotResult;

                // CRITICAL FIX: Update insights BEFORE displaying plot
                // This ensures DOM has the data when saveChatProfile is called
                if (typeof plotResult === 'object' && plotResult.tone) {
                    this.updateInsightsDisplay(plotResult);
                }

                this.displayCurrentPlot(text, 'generated');

                // Add to history immediately when generated
                this.addToHistory(text);

                // @ts-ignore - toastr is a global library
                toastr.success('New plot generated with style: ' + plotStyle, 'Machinor Roundtable');
            } else {
                this.updateStatus('ready'); // Reset status if no plot generated
            }
        } catch (error) {
            this.updateStatus('ready'); // Reset status on error
            errorHandler(error, 'Failed to generate plot with options');
        }
    }

    /**
     * Generate next plot preview using the plot engine
     */
    async generateNextPlot() {
        logger.log('Generating next plot...');

        try {
            // Use the imported helper functions
            const character = getCurrentCharacter();

            if (!character) {
                this.displayNextPlot('No character selected');
                return;
            }

            const chatHistory = this.getRecentChatHistory();

            // Generate plot using the plot engine
            const plotContext = await this.plotEngine.generatePlotContext(character, chatHistory);

            if (plotContext) {
                this.displayNextPlot(plotContext);
                // @ts-ignore - toastr is a global library
                toastr.info('Next plot preview generated', 'Machinor Roundtable');
            } else {
                this.displayNextPlot('No plot generated');
            }
        } catch (error) {
            logger.error('Failed to generate next plot:', error);
            this.displayNextPlot('Generation failed: ' + error.message);
        }
    }

    /**
     * Generate next plot preview with current Plot Style/Intensity options
     */
    async generateNextPlotWithOptions() {
        logger.log('Generating next plot with options...');
        const errorHandler = createErrorHandler('generateNextPlotWithOptions');

        try {
            // Use the imported helper functions
            const character = getCurrentCharacter();

            if (!character) {
                this.displayNextPlot('No character selected');
                return;
            }

            const chatHistory = this.getRecentChatHistory();

            // Get Plot Style and Intensity from settings
            const plotStyle = $('#mr_plot_style').val() || 'natural';
            const plotIntensity = $('#mr_plot_intensity').val() || 'moderate';
            logger.log('Next Plot Style:', plotStyle, 'Plot Intensity:', plotIntensity);

            // Combine options for plot generation
            const plotOptions = {
                style: plotStyle,
                intensity: plotIntensity
            };

            // Generate plot using the plot engine with options
            const plotContext = await this.plotEngine.generatePlotContext(character, chatHistory, plotOptions);

            if (plotContext) {
                this.displayNextPlot(plotContext);
                // @ts-ignore - toastr is a global library
                toastr.info('Next plot preview generated with style: ' + plotStyle, 'Machinor Roundtable');
            } else {
                this.displayNextPlot('No plot generated');
            }
        } catch (error) {
            errorHandler(error);
            this.displayNextPlot('Generation failed: ' + error.message);
        }
    }

    /**
     * Get recent chat history for context (helper method)
     */
    getRecentChatHistory() {
        const context = getContext();
        const chat = context.chat;

        if (!chat || chat.length === 0) {
            return [];
        }

        // Get the last 10 messages for context
        return chat.slice(-10).map(msg => ({
            name: msg.name,
            mes: msg.mes,
            is_user: msg.is_user,
            send_date: msg.send_date
        }));
    }

    /**
     * Get current status for debugging
     */
    getStatus() {
        return {
            isCollapsed: this.isCollapsed,
            currentPlot: this.currentPlot,
            nextPlot: this.nextPlot,
            historyCount: this.plotHistory.length,
            recentDirectionsCount: this.recentDirections.length
        };
    }

    /**
     * Update ARIA state for mobile sidebar controls
     * @param {boolean} isVisible
     */
    updateMobileAccessibilityState(isVisible) {
        const mobileToggle = document.getElementById('mr_mobile_toggle');
        const sidebarHidden = this.isMobile ? !isVisible : this.isCollapsed;

        if (this.elements.sidebar) {
            // CRITICAL FIX: For desktop, apply aria-hidden to the inner content, not the container
            // This prevents the toggle button (which is in the container) from being hidden while focused
            if (!this.isMobile) {
                const innerContent = this.elements.sidebar.querySelector('.mr-sidebar-inner');
                if (innerContent) {
                    innerContent.setAttribute('aria-hidden', sidebarHidden ? 'true' : 'false');
                }
                // Ensure container is always visible to AT unless mobile
                this.elements.sidebar.removeAttribute('aria-hidden');
            } else {
                // For mobile, the whole sidebar is a modal, so hiding it is correct
                this.elements.sidebar.setAttribute('aria-hidden', sidebarHidden ? 'true' : 'false');
            }

            if (this.isMobile) {
                this.elements.sidebar.setAttribute('role', 'dialog');
                this.elements.sidebar.setAttribute('aria-modal', isVisible ? 'true' : 'false');
            } else {
                this.elements.sidebar.setAttribute('role', 'complementary');
                this.elements.sidebar.setAttribute('aria-modal', 'false');
            }
        }

        if (mobileToggle) {
            mobileToggle.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
        }

        if (this.elements.toggleBtn) {
            const expanded = this.isMobile ? isVisible : !this.isCollapsed;
            this.elements.toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }

        if (this.mobileOverlay) {
            this.mobileOverlay.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
        }

        document.body.dataset.mrMobileDrawerOpen = isVisible ? 'true' : 'false';
    }

    /**
     * Return focusable elements inside the mobile drawer.
     * @returns {HTMLElement[]}
     */
    getMobileFocusableElements() {
        if (!this.elements.sidebar) {
            return [];
        }

        const selector = 'a[href], area[href], button:not([disabled]):not([aria-hidden="true"]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
        const elements = this.elements.sidebar.querySelectorAll(selector);
        return Array.from(elements)
            .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
            .map((element) => /** @type {HTMLElement} */(element));
    }

    /**
     * Trap keyboard focus inside the mobile drawer while open.
     */
    applyMobileFocusTrap() {
        if (!this.isMobile || !this.mobileSidebarVisible) {
            return;
        }

        const focusable = this.getMobileFocusableElements();
        if (focusable.length > 0) {
            focusable[0].focus({ preventScroll: true });
        } else if (this.elements.sidebar) {
            this.elements.sidebar.setAttribute('tabindex', '-1');
            this.elements.sidebar.focus({ preventScroll: true });
        }

        if (this.mobileFocusTrapHandler) {
            document.removeEventListener('keydown', this.mobileFocusTrapHandler, true);
        }

        this.mobileFocusTrapHandler = (event) => {
            if (!this.mobileSidebarVisible) {
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                this.hideMobileSidebar();
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const currentFocusable = this.getMobileFocusableElements();
            if (currentFocusable.length === 0) {
                event.preventDefault();
                if (this.elements.sidebar) {
                    this.elements.sidebar.focus({ preventScroll: true });
                }
                return;
            }

            const first = currentFocusable[0];
            const last = currentFocusable[currentFocusable.length - 1];
            const activeElement = document.activeElement;

            // Type guard to ensure activeElement is an HTMLElement
            const isActiveElementInFocusable = activeElement instanceof HTMLElement && currentFocusable.includes(activeElement);

            if (event.shiftKey) {
                if (activeElement === first || !isActiveElementInFocusable) {
                    event.preventDefault();
                    last.focus({ preventScroll: true });
                }
            } else if (activeElement === last || !isActiveElementInFocusable) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };

        document.addEventListener('keydown', this.mobileFocusTrapHandler, true);
    }

    /**
     * Release the mobile focus trap and restore focus.
     */
    releaseMobileFocusTrap() {
        if (this.mobileFocusTrapHandler) {
            document.removeEventListener('keydown', this.mobileFocusTrapHandler, true);
            this.mobileFocusTrapHandler = null;
        }

        if (this.elements.sidebar && this.elements.sidebar.getAttribute('tabindex') === '-1') {
            this.elements.sidebar.removeAttribute('tabindex');
        }

        const fallbackToggle = document.getElementById('mr_mobile_toggle');
        const target = this.previouslyFocusedElement && document.body.contains(this.previouslyFocusedElement)
            ? this.previouslyFocusedElement
            : fallbackToggle;

        if (target && typeof target.focus === 'function') {
            target.focus({ preventScroll: true });
        }

        this.previouslyFocusedElement = null;
    }

    /**
     * Ensure a reusable mobile portal container exists
     * @returns {HTMLElement|null}
     */
    ensureMobilePortalContainer() {
        if (!this.mobilePortalContainer || !this.mobilePortalContainer.isConnected) {
            let container = /** @type {HTMLElement|null} */ (document.querySelector('.mr-mobile-portal'));
            if (!container) {
                container = document.createElement('div');
                container.className = 'mr-mobile-portal';
            }

            if (!container.parentElement) {
                document.body.appendChild(container);
            }

            this.mobilePortalContainer = container;
        }

        if (this.mobilePortalContainer) {
            this.mobilePortalContainer.style.pointerEvents = this.mobileSidebarVisible ? 'auto' : 'none';
            this.mobilePortalContainer.style.transform = 'none';

            if (this.mobileOverlay && this.mobileOverlay.parentElement !== this.mobilePortalContainer) {
                this.mobilePortalContainer.appendChild(this.mobileOverlay);
            }
        }

        return this.mobilePortalContainer;
    }

    /**
     * Ensure placeholder nodes exist for restoring elements
     * @param {HTMLElement|null} sidebar
     * @param {HTMLElement|null} mobileToggle
     */
    ensurePortalPlaceholders(sidebar = this.elements.sidebar, mobileToggle = document.getElementById('mr_mobile_toggle')) {
        if (!sidebar || !mobileToggle) {
            return;
        }

        if (!this.sidebarPlaceholder) {
            this.sidebarPlaceholder = document.createElement('div');
            this.sidebarPlaceholder.className = 'mr-portal-placeholder';
            this.sidebarPlaceholder.style.display = 'none';
        }

        if (!this.sidebarPlaceholder.parentElement && this.sidebarOriginalParent) {
            this.sidebarOriginalParent.insertBefore(this.sidebarPlaceholder, this.sidebarNextSibling || null);
        }

        if (!this.togglePlaceholder) {
            this.togglePlaceholder = document.createElement('div');
            this.togglePlaceholder.className = 'mr-portal-placeholder';
            this.togglePlaceholder.style.display = 'none';
        }

        if (!this.togglePlaceholder.parentElement && this.toggleOriginalParent) {
            this.toggleOriginalParent.insertBefore(this.togglePlaceholder, this.toggleNextSibling || null);
        }
    }

    /**
     * Move sidebar, toggle, and overlay into or out of the mobile portal
     */
    updateResponsivePlacement() {
        const sidebar = this.elements.sidebar;
        let mobileToggle = /** @type {HTMLElement|null} */ (document.getElementById('mr_mobile_toggle'));
        const leftSendForm = document.getElementById('leftSendForm');

        if (!sidebar) {
            return;
        }
        if (!mobileToggle) {
            mobileToggle = document.createElement('div');
            mobileToggle.id = 'mr_mobile_toggle';
            mobileToggle.className = 'mr-mobile-toggle';
            
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-book-atlas';
            mobileToggle.appendChild(icon);
            
            this.initializeMobileToggle();
        }

        this.ensurePortalPlaceholders(sidebar, mobileToggle);

        if (this.isMobile) {
            const portal = this.ensureMobilePortalContainer();
            if (!portal) {
                return;
            }

            portal.style.pointerEvents = this.mobileSidebarVisible ? 'auto' : 'none';
            portal.style.transform = 'none';

            if (sidebar.parentElement !== portal) {
                portal.appendChild(sidebar);
            }
            if (leftSendForm && mobileToggle.parentElement !== leftSendForm) {
                leftSendForm.prepend(mobileToggle);
            }

            if (this.mobileOverlay) {
                if (this.mobileSidebarVisible) {
                    this.mobileOverlay.classList.add('mobile-visible');
                    this.mobileOverlay.classList.remove('mobile-hidden');
                } else {
                    this.mobileOverlay.classList.add('mobile-hidden');
                    this.mobileOverlay.classList.remove('mobile-visible');
                }
            }

            if (this.mobileSidebarVisible) {
                sidebar.classList.add('mobile-visible');
                sidebar.classList.remove('mobile-hidden');
            } else {
                sidebar.classList.add('mobile-hidden');
                sidebar.classList.remove('mobile-visible');
            }
        } else {
            if (this.sidebarPlaceholder?.parentElement && sidebar.parentElement !== this.sidebarPlaceholder.parentElement) {
                this.sidebarPlaceholder.parentElement.insertBefore(sidebar, this.sidebarPlaceholder);
            } else if (this.sidebarOriginalParent) {
                this.sidebarOriginalParent.insertBefore(sidebar, this.sidebarNextSibling || null);
            }

            sidebar.classList.remove('mobile-visible', 'mobile-hidden');

            if (this.togglePlaceholder?.parentElement && mobileToggle.parentElement !== this.togglePlaceholder.parentElement) {
                this.togglePlaceholder.parentElement.insertBefore(mobileToggle, this.togglePlaceholder);
            } else if (this.toggleOriginalParent) {
                this.toggleOriginalParent.insertBefore(mobileToggle, this.toggleNextSibling || null);
            }

            if (this.mobileOverlay && this.mobileOverlay.parentElement !== document.body) {
                document.body.appendChild(this.mobileOverlay);
            }
            if (this.mobileOverlay) {
                this.mobileOverlay.classList.add('mobile-hidden');
                this.mobileOverlay.classList.remove('mobile-visible');
            }

            if (this.mobilePortalContainer) {
                this.mobilePortalContainer.style.pointerEvents = 'none';
                this.mobilePortalContainer.style.transform = 'none';
            }
        }
    }
}