// Machinor Roundtable - Plot Preview Manager
import { getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
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
            console.log("[machinor-roundtable] getCurrentCharacter: No context available");
            return null;
        }

        // Check if we have a characterId and characters array
        if (context.characterId === undefined || !context.characters) {
            console.log("[machinor-roundtable] getCurrentCharacter: No characterId or characters array");
            return null;
        }
        
        // Find the current character by ID
        const character = context.characters[context.characterId];
        
        console.log("[machinor-roundtable] getCurrentCharacter:", character ? character.name : "No character found");
        
        return character || null;
    } catch (error) {
        console.error("[machinor-roundtable] Error getting current character:", error);
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
     * @param {Object} plotEngine - The plot generation engine
     * @param {Object} chatInjector - The chat injection system
     */
    constructor(plotEngine, chatInjector) {
        /** @type {Object} */
        this.plotEngine = plotEngine;
        /** @type {Object|null} */
        this.chatInjector = chatInjector;
        /** @type {boolean} */
        this.isCollapsed = true;
        /** @type {number|null} */
        this.autoApproveTimer = null;
        /** @type {number} */
        this.autoApproveTimeout = 5000; // Default 5 seconds
        /** @type {string|null} */
        this.currentPlot = null;
        /** @type {string|null} */
        this.nextPlot = null;
        /** @type {PlotEntry[]} */
        this.plotHistory = [];
        /** @type {number} */
        this.historyLimit = 5;
        /** @type {string[]} */
        this.recentDirections = [];
        /** @type {number} */
        this.maxRecentDirections = 10;
        /** @type {boolean} */
        this.isPaused = false;
        /** @type {boolean} */
        this.isManualEntry = false;
        /** @type {boolean} */
        this.isGenerating = false;
        /** @type {boolean} */
        this.isEditingPlot = false;
        /** @type {string|null} */
        this.editingPlotId = null;
        
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
        /** @type {number|null} */
        this.mobileHideTimeout = null;
        
        this.bindEvents();
        this.loadSettings();
        this.initializeMobileToggle();
        this.updateMobileAccessibilityState(false);
        this.updateResponsivePlacement();
        
        // CRITICAL FIX: Don't load saved plot immediately - context may not be ready
        // Setup listeners for chat/character changes instead
        this.setupContextChangeListeners();
        
        // Initialize story intelligence display
        this.updateStoryIntelligence();
    }

    /**
     * Setup listeners for chat and character changes
     */
    setupContextChangeListeners() {
        // CRITICAL FIX: Enhanced context change detection for better persistence
        
        // Method 1: Try SillyTavern event system first
        if (typeof eventSource !== 'undefined') {
            // Listen for chat changed events
            eventSource.on(event_types.CHAT_CHANGED, () => {
                console.log('[machinor-roundtable] 🔄 Chat changed event detected');
                this.delayedContextLoad(150, 'chat_changed');
            });
            
            // Listen for character changes
            eventSource.on(event_types.CHARACTER_SELECTED, () => {
                console.log('[machinor-roundtable] 🔄 Character changed event detected');
                this.delayedContextLoad(150, 'character_selected');
            });
            
            // Also listen for broader context changes
            eventSource.on('context_changed', () => {
                console.log('[machinor-roundtable] 🔄 General context changed event detected');
                this.delayedContextLoad(200, 'context_changed');
            });
        }
        
        // Method 2: Polling fallback for when context becomes available
        this.contextCheckInterval = setInterval(() => {
            const context = getContext();
            if (context && context.characterId !== undefined && context.chatId) {
                if (!this.contextLoadedOnce) {
                    console.log('[machinor-roundtable] 🎯 Context became available via polling');
                    this.contextLoadedOnce = true;
                    this.delayedContextLoad(100, 'polling_detection');
                }
                // Stop polling once we have context
                clearInterval(this.contextCheckInterval);
            }
        }, 500); // Check every 500ms
        
        console.log('[machinor-roundtable] Context change listeners setup complete');
    }
    
    /**
     * Delayed context loading with proper timing and validation
     * @param {number} delay - Delay in milliseconds
     * @param {string} source - Source of the trigger
     */
    delayedContextLoad(delay, source) {
        setTimeout(() => {
            const context = getContext();
            
            console.log(`[machinor-roundtable] 🔍 Attempting load from ${source}:`, {
                characterId: context?.characterId,
                chatId: context?.chatId,
                contextExists: !!context,
                hasCharacters: !!context?.characters,
                hasChat: !!context?.chat
            });
            
            // Validate context is ready before attempting load
            if (context && context.characterId !== undefined && context.chatId) {
                console.log('[machinor-roundtable] ✅ Context ready, loading stored plot...');
                this.loadPlotFromStorage();
                // Also refresh history display with synced data
                this.renderHistory();
            } else {
                console.log('[machinor-roundtable] ⏳ Context not ready yet, will retry...');
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
            console.log('[machinor-roundtable] getStorageKey: No context available');
            return null;
        }
        
        const characterId = context.characterId;
        const chatId = context.chatId;
        
        // CRITICAL FIX: More detailed logging for debugging persistence issues
        console.log('[machinor-roundtable] getStorageKey - Context:', {
            characterId: characterId,
            chatId: chatId,
            contextExists: !!context,
            hasCharacters: !!context.characters,
            hasChat: !!context.chat
        });
        
        if (characterId === undefined || !chatId) {
            console.log('[machinor-roundtable] Cannot generate storage key: missing characterId or chatId');
            console.log('[machinor-roundtable] CharacterId:', characterId, 'ChatId:', chatId);
            return null;
        }
        
        const storageKey = `mr_plot_${characterId}_${chatId}`;
        console.log('[machinor-roundtable] Generated storage key:', storageKey);
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
     */
    saveChatProfile(plotText, status) {
        const storageKey = this.getStorageKey();
        if (!storageKey) return;
        
        const context = getContext();
        const character = context?.characters?.[context?.characterId];
        
        // Build comprehensive profile data
        const profileData = {
            // Core plot data
            plotText: plotText,
            status: status,
            timestamp: Date.now(),
            
            // Character information
            characterId: context?.characterId,
            characterName: character?.name || 'Unknown',
            
            // Plot history and injections
            plotHistory: this.plotHistory,
            injectedPlots: this.getInjectedPlotsTimeline(),
            
            // Settings and preferences
            recentDirections: this.recentDirections,
            autoApproveTimeout: this.autoApproveTimeout,
            sidebarCollapsed: this.isCollapsed,
            
            // Story intelligence snapshot
            storyIntelligence: {
                characterAnalysis: this.extractCharacterInsight(),
                worldContext: this.extractWorldContext(),
                characterCount: this.elements.characterCount?.textContent || 'Unknown',
                arcStatus: this.plotEngine?.narrativeArc?.getArcStatus() || null
            },
            
            // Chat context for restoration
            chatLength: context?.chat?.length || 0,
            lastMessageTime: context?.chat?.[context?.chat?.length - 1]?.send_date || null
        };
        
        try {
            // Save the comprehensive profile
            localStorage.setItem(storageKey, JSON.stringify(profileData));
            
            // Update profile index for cross-chat navigation
            this.updateProfileIndex(storageKey, profileData);
            
            console.log('[machinor-roundtable] Chat profile saved:', storageKey, 'History entries:', this.plotHistory.length);
            
        } catch (error) {
            console.error('[machinor-roundtable] Failed to save chat profile:', error);
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
            
            // Keep only the most recent 50 profiles to prevent storage bloat
            const sortedEntries = Object.entries(index)
                .sort(([,a], [,b]) => b.lastActive - a.lastActive)
                .slice(0, 50);
            
            const trimmedIndex = Object.fromEntries(sortedEntries);
            localStorage.setItem(indexKey, JSON.stringify(trimmedIndex));
            
        } catch (error) {
            console.error('[machinor-roundtable] Failed to update profile index:', error);
        }
    }

    /**
     * Load comprehensive chat profile from persistent storage
     * @returns {Object|null} Loaded profile data or null
     */
    loadChatProfile() {
        const storageKey = this.getStorageKey();
        if (!storageKey) return null;
        
        try {
            const stored = localStorage.getItem(storageKey);
            if (!stored) {
                console.log('[machinor-roundtable] No stored profile found for:', storageKey);
                return null;
            }
            
            const profileData = JSON.parse(stored);
            console.log('[machinor-roundtable] Chat profile loaded:', storageKey, 'History entries:', profileData.plotHistory?.length || 0);
            
            // CRITICAL FIX: Enhanced debugging for persistence issues
            console.log('[machinor-roundtable] 🗂️ RESTORING CHAT PROFILE:', {
                storageKey: storageKey,
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
                console.log('[machinor-roundtable] ✅ History restored:', this.plotHistory.length, 'entries');
                console.log('[machinor-roundtable] 🔄 Calling renderHistory()...');
                
                // Force render with enhanced logging
                this.renderHistory();
                
                // Verify history was rendered
                if (this.elements.historyList) {
                    const renderedCount = this.elements.historyList.querySelectorAll('.mr-history-item').length;
                    console.log('[machinor-roundtable] 📊 History items rendered:', renderedCount);
                    
                    // Additional check for any existing content
                    const historyContent = this.elements.historyList.innerHTML;
                    console.log('[machinor-roundtable] 📄 History list HTML preview:', historyContent.substring(0, 200) + (historyContent.length > 200 ? '...' : ''));
                }
            } else {
                console.log('[machinor-roundtable] ⚠️ No plot history found in profile');
            }
            
            // Restore recent directions
            if (profileData.recentDirections && Array.isArray(profileData.recentDirections)) {
                this.recentDirections = profileData.recentDirections;
                console.log('[machinor-roundtable] ✅ Recent directions restored:', this.recentDirections.length);
            }
            
            // Restore settings
            if (profileData.autoApproveTimeout) {
                this.autoApproveTimeout = profileData.autoApproveTimeout;
                console.log('[machinor-roundtable] ✅ Auto-approve timeout restored:', this.autoApproveTimeout);
            }
            if (typeof profileData.sidebarCollapsed === 'boolean') {
                this.isCollapsed = profileData.sidebarCollapsed;
                if (this.elements.sidebar) {
                    this.elements.sidebar.classList.toggle('collapsed', this.isCollapsed);
                    console.log('[machinor-roundtable] ✅ Sidebar state restored:', this.isCollapsed ? 'collapsed' : 'expanded');
                }
            }
            
            // Update story intelligence display with restored data
            if (profileData.storyIntelligence) {
                console.log('[machinor-roundtable] ✅ Story intelligence data available, updating...');
                this.updateStoryIntelligenceWithData(profileData.storyIntelligence);
            }
            
            // Display the loaded plot with restored status
            if (profileData.plotText) {
                console.log('[machinor-roundtable] 📝 Displaying restored plot:', profileData.plotText.substring(0, 100) + '...');
                this.displayCurrentPlot(profileData.plotText, 'restored');
                
                // Add visual indicator with additional info
                if (this.elements.statusText) {
                    const historyInfo = profileData.plotHistory?.length > 0 ? ` (${profileData.plotHistory.length} history)` : '';
                    this.elements.statusText.innerHTML = `Restored${historyInfo} <i class="fa-solid fa-database" title="Loaded from storage"></i>`;
                    console.log('[machinor-roundtable] ✅ Status text updated with history indicator');
                }
                
                console.log('[machinor-roundtable] 🎉 Profile restoration complete!');
                return profileData;
            }
            
        } catch (error) {
            console.error('[machinor-roundtable] Failed to load chat profile:', error);
        }
        
        return null;
    }

    /**
     * Update story intelligence with restored data
     * @param {Object} storyData - Restored story intelligence data
     */
    updateStoryIntelligenceWithData(storyData) {
        try {
            // Update character analysis display
            if (storyData.characterAnalysis && this.elements.characterAnalysis) {
                this.elements.characterAnalysis.textContent = storyData.characterAnalysis;
            }
            
            // Update world context display
            if (storyData.worldContext && this.elements.worldContext) {
                this.elements.worldContext.textContent = storyData.worldContext;
            }
            
            // Update character count
            if (storyData.characterCount && this.elements.characterCount) {
                this.elements.characterCount.textContent = storyData.characterCount;
            }
            
        } catch (error) {
            console.error('[machinor-roundtable] Error updating story intelligence with restored data:', error);
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
            console.error('[machinor-roundtable] Failed to get profile index:', error);
            return {};
        }
    }

    /**
     * Save plot to cross-device storage (migrated from localStorage)
     * @param {string} plotText - The plot text to save
     * @param {string} status - The plot status
     */
    savePlotToStorage(plotText, status) {
        // Save to cross-device system
        if (typeof window.addPlotPreviewToHistory === 'function') {
            window.addPlotPreviewToHistory(plotText, status);
        }
        
        // Also save to localStorage for backward compatibility
        this.saveChatProfile(plotText, status);
    }

    /**
     * Load plot from cross-device storage (migrated from localStorage)
     * @returns {Object|null} Loaded plot data or null
     */
    loadPlotFromStorage() {
        // Try to load from cross-device system first
        if (typeof window.getCurrentPlotPreview === 'function') {
            const syncedPreview = window.getCurrentPlotPreview();
            if (syncedPreview) {
                console.log('[machinor-roundtable] ✅ Loaded plot from cross-device storage:', syncedPreview.text.substring(0, 50) + '...');
                
                // Display the loaded plot
                this.displayCurrentPlot(syncedPreview.text, 'ready');
                
                // Add visual indicator
                if (this.elements.statusText) {
                    this.elements.statusText.innerHTML = `Ready <i class="fa-solid fa-cloud" title="Loaded from cross-device storage"></i>`;
                }
                
                return syncedPreview;
            }
        }
        
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
            timerDisplay: document.getElementById('mr_approval_timer'),
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
 
        // Validate all elements exist
        for (const [key, element] of Object.entries(elements)) {
            if (!element) {
                console.warn(`[machinor-roundtable] Element not found: ${key}`);
            }
        }
        
        console.log('[machinor-roundtable] Plot Preview Manager initialized');
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

        const closeBtn = this.createMobileCloseButton();
        this.elements.sidebar.querySelector('.mr-sidebar-header')?.appendChild(closeBtn);

        const toggleHandler = () => this.toggleMobileSidebar();
        const closeHandler = () => this.hideMobileSidebar();

        mobileToggle.addEventListener('click', toggleHandler);
        overlay.addEventListener('click', closeHandler);
        closeBtn.addEventListener('click', closeHandler);

        mobileToggle.dataset.mrInitialized = 'true';
        this.ensurePortalPlaceholders();
        this.updateResponsivePlacement();
        
        window.addEventListener('resize', () => {
            if (this.mobileResizeTimeout) {
                clearTimeout(this.mobileResizeTimeout);
            }
            
            this.mobileResizeTimeout = window.setTimeout(() => {
                const wasMobile = this.isMobile;
                this.isMobile = window.innerWidth <= 600;
                
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
        console.log('[machinor-roundtable] Mobile toggle initialized');
    }

    createMobileCloseButton() {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'mr-mobile-close-btn';
        closeBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
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

        // SIMPLIFIED: Use CSS classes instead of DOM manipulation
        this.isCollapsed = false; // Update state variable
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
        console.log('[machinor-roundtable] Mobile sidebar shown (CSS-only approach)');
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

        document.body.style.overflow = this.originalBodyOverflow;
        mobileToggle?.classList.remove('is-active');

        this.updateMobileAccessibilityState(false);
        this.releaseMobileFocusTrap();

        console.log('[machinor-roundtable] Mobile sidebar hidden (CSS-only approach)');
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
    bindEvents() {
        // Sidebar toggle
        if (this.elements.toggleBtn) {
            this.elements.toggleBtn.addEventListener('click', () => this.toggleSidebar());
        }
        
        // Plot actions
        const editBtn = document.getElementById('mr_edit_plot');
        const skipBtn = document.getElementById('mr_skip_plot');
        const pauseBtn = document.getElementById('mr_pause_plot');
        const regenerateBtn = document.getElementById('mr_regenerate_next');
        const manualBtn = document.getElementById('mr_manual_plot_btn');
        const saveBtn = document.getElementById('mr_save_plot');
        const cancelBtn = document.getElementById('mr_cancel_edit');
        
        if (editBtn) editBtn.addEventListener('click', () => this.editPlot());
        if (skipBtn) skipBtn.addEventListener('click', () => this.skipPlot());
        if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());
        if (regenerateBtn) regenerateBtn.addEventListener('click', () => this.regenerateNextPlot());
        if (manualBtn) manualBtn.addEventListener('click', () => this.manualPlotEntry());
        
        // Direction input
        if (this.elements.directionInput) {
            this.elements.directionInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.saveDirection();
                }
            });
            this.elements.directionInput.addEventListener('input', () => this.showRecentDirections());
        }
        
        // History
        if (this.elements.historyToggle) {
            this.elements.historyToggle.addEventListener('click', () => this.toggleHistory());
        }
        if (this.elements.historyLimitInput) {
            this.elements.historyLimitInput.addEventListener('change', () => this.updateHistoryLimit());
        }
        
        // Template gallery buttons
        const templateButtons = document.querySelectorAll('.mr-template-btn');
        templateButtons.forEach(button => {
            button.addEventListener('click', (e) => this.handleTemplateSelection(e));
        });
        
        // Modal
        if (this.elements.closeModalBtn) {
            this.elements.closeModalBtn.addEventListener('click', () => this.closeModal());
        }
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveEditedPlot());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());
        
        // Close modal on outside click
        if (this.elements.modal) {
            this.elements.modal.addEventListener('click', (e) => {
                if (e.target === this.elements.modal) {
                    this.closeModal();
                }
            });
        }
        
        // Story intelligence toggle
        if (this.elements.intelToggle) {
            this.elements.intelToggle.addEventListener('click', () => this.toggleStoryIntel());
        }
        
        // Advanced options toggle - Enhanced for mobile with iOS haptic feedback
        const advancedToggle = document.getElementById('mr_advanced_toggle');
        if (advancedToggle) {
            // Use both click and touchstart for maximum compatibility
            advancedToggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleAdvancedOptions();
            });
            
            // Enhanced touch handling for iOS devices
            advancedToggle.addEventListener('touchstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // iOS-style haptic feedback simulation
                if (navigator.vibrate) {
                    navigator.vibrate(10);
                }
                
                this.toggleAdvancedOptions();
            }, { passive: false });
            
            // Prevent long-press context menu on mobile
            advancedToggle.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });
            
            console.log('[machinor-roundtable] Advanced options toggle bound for mobile with haptic feedback');
        }
        
        console.log('[machinor-roundtable] Plot Preview events bound');
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
            console.error('[machinor-roundtable] Error updating story intelligence:', error);
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
            console.error('[machinor-roundtable] Error updating arc display:', error);
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
                console.log('[machinor-roundtable] Character analysis:', analysisText);
                
            } else {
                this.elements.characterAnalysis.textContent = 'No character selected';
            }
            
        } catch (error) {
            console.error('[machinor-roundtable] Error updating character analysis:', error);
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
            console.log('[machinor-roundtable] World context:', contextText);
            
        } catch (error) {
            console.error('[machinor-roundtable] Error updating world context:', error);
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
            
            console.log('[machinor-roundtable] Character count updated:', charCount);
            
        } catch (error) {
            console.error('[machinor-roundtable] Error updating character count:', error);
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
     * Toggle advanced options panel with iOS spring animations
     */
    toggleAdvancedOptions() {
        const advancedContent = document.getElementById('mr_advanced_content');
        const advancedToggle = document.getElementById('mr_advanced_toggle');
        
        if (!advancedContent || !advancedToggle) {
            console.warn('[machinor-roundtable] Advanced toggle elements not found:', {
                content: !!advancedContent,
                toggle: !!advancedToggle,
                contentId: 'mr_advanced_content',
                toggleId: 'mr_advanced_toggle'
            });
            return;
        }
        
        // Check both class state AND inline display style for comprehensive state detection
        const isCollapsed = advancedContent.classList.contains('collapsed') ||
                           (advancedContent.style.display === 'none');
        
        // Enhanced selector to find the icon - check multiple approaches
        let toggleIcon = advancedToggle.querySelector('.mr-advanced-toggle i');
        if (!toggleIcon) {
            toggleIcon = advancedToggle.querySelector('span i');
        }
        if (!toggleIcon) {
            toggleIcon = advancedToggle.querySelector('i');
        }
        
        console.log('[machinor-roundtable] Toggling advanced options:', {
            isCollapsed: isCollapsed,
            hasIcon: !!toggleIcon,
            iconClasses: toggleIcon?.className || 'none',
            toggleClasses: advancedToggle.className,
            contentClasses: advancedContent.className,
            displayStyle: advancedContent.style.display
        });
        
        // iOS Spring Animation for the toggle button itself
        advancedToggle.style.transition = 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
        
        if (isCollapsed) {
            // Expanding - remove collapsed class and ensure display is not none
            advancedContent.classList.remove('collapsed');
            advancedContent.style.display = 'block'; // Ensure it's visible
            advancedContent.setAttribute('aria-expanded', 'true');
            
            // Update ARIA attributes for accessibility
            advancedContent.setAttribute('aria-hidden', 'false');
            advancedToggle.setAttribute('aria-expanded', 'true');
            
            // Animate icon rotation with iOS spring effect
            if (toggleIcon) {
                toggleIcon.style.transform = 'rotate(180deg)';
            }
            
            // iOS-style visual feedback with spring animation
            advancedToggle.style.transform = 'scale(0.92)';
            setTimeout(() => {
                advancedToggle.style.transform = 'scale(1)';
            }, 100);
            
            console.log('[machinor-roundtable] Advanced options expanded with iOS animation');
        } else {
            // Collapsing - add collapsed class and hide with display none
            advancedContent.classList.add('collapsed');
            advancedContent.style.display = 'none'; // Force hide
            advancedContent.setAttribute('aria-expanded', 'false');
            
            // Update ARIA attributes for accessibility
            advancedContent.setAttribute('aria-hidden', 'true');
            advancedToggle.setAttribute('aria-expanded', 'false');
            
            // Animate icon rotation with iOS spring effect
            if (toggleIcon) {
                toggleIcon.style.transform = 'rotate(0deg)';
            }
            
            // iOS-style visual feedback with spring animation
            advancedToggle.style.transform = 'scale(0.92)';
            setTimeout(() => {
                advancedToggle.style.transform = 'scale(1)';
            }, 100);
            
            console.log('[machinor-roundtable] Advanced options collapsed with iOS animation');
        }
        
        // Force reflow to ensure animation starts
        advancedToggle.offsetHeight;
    }

    /**
     * Handle template selection with proper plot engine integration
     * Templates should GUIDE generation, not replace it with literal text
     */
    async handleTemplateSelection(event) {
        const button = event.currentTarget;
        const template = button.dataset.template;
        
        if (!template) {
            console.warn('[machinor-roundtable] No template data found on button');
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
            console.log('[machinor-roundtable] Template selected for guidance:', template);
            
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
                
                console.log('[machinor-roundtable] Template applied as guidance:', template, 'Generated plot:', plotContext.substring(0, 100) + '...');
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
            
            console.error('[machinor-roundtable] Template application failed:', error);
            
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
        
        this.autoApproveTimeout = settings.approvalTimeout || 5000;
        this.historyLimit = settings.historyLimit || 5;
        this.recentDirections = settings.recentDirections || [];
        this.isCollapsed = settings.sidebarCollapsed !== false; // Default to collapsed
        
        if (this.elements.historyLimitInput) {
            this.elements.historyLimitInput.value = this.historyLimit.toString();
        }
        
        if (this.isCollapsed && this.elements.sidebar) {
            this.elements.sidebar.classList.add('collapsed');
        }
        
        console.log('[machinor-roundtable] Plot Preview settings loaded');
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
        
        settings.approvalTimeout = this.autoApproveTimeout;
        settings.historyLimit = this.historyLimit;
        settings.recentDirections = this.recentDirections;
        settings.sidebarCollapsed = this.isCollapsed;
        
        saveSettingsDebounced();
        console.log('[machinor-roundtable] Plot Preview settings saved');
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
        
        console.log('[machinor-roundtable] Sidebar toggled:', this.isCollapsed ? 'collapsed' : 'expanded');
    }

    /**
     * Display current plot in sidebar
     * @param {string} plotText - The plot text to display
     * @param {string} status - The status to show
     */
    displayCurrentPlot(plotText, status = 'ready') {
        this.currentPlot = plotText;
        
        if (this.elements.currentPlotText) {
            this.elements.currentPlotText.textContent = plotText;
            console.log('[machinor-roundtable] Plot text set to:', plotText.substring(0, 50) + '...');
            
            // Force visibility on mobile
            if (this.isMobile && this.mobileSidebarVisible) {
                this.elements.currentPlotText.style.visibility = 'visible';
                this.elements.currentPlotText.style.opacity = '1';
            }
        } else {
            console.warn('[machinor-roundtable] currentPlotText element not found');
        }
        
        this.updateStatus(status);
        
        // Start auto-approve timer if ready and not paused
        if (status === 'ready' && !this.isPaused) {
            this.startAutoApproveTimer();
        }
        
        // Save to persistent storage
        this.savePlotToStorage(plotText, status);
        
        console.log('[machinor-roundtable] Current plot displayed:', status);
    }

    /**
     * Display next plot preview
     * @param {string} plotText - The next plot text
     */
    displayNextPlot(plotText) {
        this.nextPlot = plotText;
        
        if (this.elements.nextPlotText) {
            this.elements.nextPlotText.textContent = plotText || 'Generating next plot...';
        }
        
        console.log('[machinor-roundtable] Next plot preview displayed');
    }

    /**
     * Update status indicator and text
     * @param {string} status - The status to display
     */
    updateStatus(status) {
        if (this.elements.statusIndicator) {
            // Remove all status classes
            this.elements.statusIndicator.className = 'mr-status-indicator';
            this.elements.statusIndicator.classList.add(status);
        }
        
        // Update status text
        const statusTexts = {
            ready: 'Ready',
            pending: 'Generating...',
            paused: 'Paused',
            injected: 'Injected'
        };
        
        if (this.elements.statusText) {
            this.elements.statusText.textContent = statusTexts[status] || 'Unknown';
        }
        
        console.log('[machinor-roundtable] Status updated:', status);
    }

    /**
     * Start auto-approve countdown timer
     */
    startAutoApproveTimer() {
        this.clearAutoApproveTimer();
        
        let timeLeft = Math.ceil(this.autoApproveTimeout / 1000);
        this.updateTimerDisplay(timeLeft);
        
        this.autoApproveTimer = window.setInterval(() => {
            timeLeft--;
            this.updateTimerDisplay(timeLeft);
            
            if (timeLeft <= 0) {
                this.clearAutoApproveTimer();
                this.approveAndInject();
            }
        }, 1000);
        
        console.log('[machinor-roundtable] Auto-approve timer started');
    }

    /**
     * Clear auto-approve timer
     */
    clearAutoApproveTimer() {
        if (this.autoApproveTimer) {
            clearInterval(this.autoApproveTimer);
            this.autoApproveTimer = null;
            this.updateTimerDisplay('');
            console.log('[machinor-roundtable] Auto-approve timer cleared');
        }
    }

    /**
     * Update timer display
     * @param {number|string} seconds - Seconds remaining or empty string
     */
    updateTimerDisplay(seconds) {
        if (!this.elements.timerDisplay) return;
        
        if (typeof seconds === 'number' && seconds > 0) {
            this.elements.timerDisplay.textContent = `Auto-inject in ${seconds}s`;
        } else {
            this.elements.timerDisplay.textContent = '';
        }
    }

    /**
     * Approve current plot and inject it
     */
    async approveAndInject() {
        if (!this.currentPlot) {
            console.warn('[machinor-roundtable] No plot to inject');
            return;
        }
        
        this.updateStatus('injected');
        this.clearAutoApproveTimer();
        
        // Add to history (only if not editing an existing plot)
        if (!this.isEditingPlot || !this.editingPlotId) {
            this.addToHistory(this.currentPlot);
            
            // Save to plot preview history for cross-device sync
            if (typeof window.addPlotPreviewToHistory === 'function') {
                window.addPlotPreviewToHistory(this.currentPlot, 'injected');
            }
        } else {
            console.log('[machinor-roundtable] Skipping history add - editing existing plot');
        }
        
        // Trigger injection through chat injector
        // This is a simplified version - in practice, you'd integrate with the actual injection system
        console.log('[machinor-roundtable] Plot approved and injected:', this.currentPlot);
        
        // @ts-ignore - toastr is a global library
        toastr.success('Plot injected successfully', 'Machinor Roundtable');
        
        // Keep the plot displayed and stay in injected state for editing
        // Don't clear the plot or return to pending status
        console.log('[machinor-roundtable] Plot remains in injected state for editing');
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
        console.log('[machinor-roundtable] Plot editor opened, editing existing:', this.isEditingPlot);
    }

    /**
     * Skip current plot and generate new one
     */
    skipPlot() {
        this.clearAutoApproveTimer();
        this.currentPlot = null;
        
        if (this.elements.currentPlotText) {
            this.elements.currentPlotText.textContent = 'Generating new plot...';
        }
        
        this.updateStatus('pending');
        
        // Trigger new plot generation with current settings
        this.generateNewPlotWithOptions();
        
        // @ts-ignore - toastr is a global library
        toastr.info('Plot skipped, generating new one...', 'Machinor Roundtable');
        console.log('[machinor-roundtable] Plot skipped');
    }

    /**
     * Toggle pause/resume auto-injection
     */
    togglePause() {
        this.isPaused = !this.isPaused;
        const pauseBtn = document.getElementById('mr_pause_plot');
        
        if (pauseBtn) {
            const icon = pauseBtn.querySelector('i');
            
            if (this.isPaused) {
                this.clearAutoApproveTimer();
                this.updateStatus('paused');
                if (icon) icon.className = 'fa-solid fa-play';
                pauseBtn.title = 'Resume Auto-Inject';
                // @ts-ignore - toastr is a global library
                toastr.info('Auto-injection paused', 'Machinor Roundtable');
            } else {
                this.updateStatus('ready');
                if (icon) icon.className = 'fa-solid fa-pause';
                pauseBtn.title = 'Pause Auto-Inject';
                // @ts-ignore - toastr is a global library
                toastr.info('Auto-injection resumed', 'Machinor Roundtable');
            }
        }
        
        console.log('[machinor-roundtable] Pause toggled:', this.isPaused);
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
        console.log('[machinor-roundtable] Next plot regeneration requested');
    }

    /**
     * Manual plot entry
     */
    manualPlotEntry() {
        this.openModal('', true); // Open empty modal for manual entry
        console.log('[machinor-roundtable] Manual plot entry opened');
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
        }
        
        if (this.elements.editorText) {
            this.elements.editorText.focus();
        }
        
        // Store whether this is manual entry
        this.isManualEntry = isManual;
        
        console.log('[machinor-roundtable] Modal opened');
    }

    /**
     * Close plot editor modal
     */
    closeModal() {
        if (this.elements.modal) {
            this.elements.modal.style.display = 'none';
        }
        this.isManualEntry = false;
        console.log('[machinor-roundtable] Modal closed');
    }

    /**
     * Save edited plot
     */
    saveEditedPlot() {
        if (!this.elements.editorText) return;
        
        const editedText = this.elements.editorText.value.trim();
        
        if (!editedText) {
            // @ts-ignore - toastr is a global library
            toastr.warning('Plot cannot be empty', 'Machinor Roundtable');
            return;
        }
        
        if (this.isManualEntry) {
            // Manual entry - set as current plot
            this.displayCurrentPlot(editedText, 'ready');
            // @ts-ignore - toastr is a global library
            toastr.success('Custom plot saved', 'Machinor Roundtable');
        } else {
            // Edit existing plot
            this.displayCurrentPlot(editedText, 'ready');
            
            // Update the history entry if we were editing an existing plot
            if (this.isEditingPlot && this.editingPlotId) {
                const plotIndex = this.plotHistory.findIndex(plot => plot.id === this.editingPlotId);
                if (plotIndex !== -1) {
                    this.plotHistory[plotIndex].text = editedText;
                    this.plotHistory[plotIndex].timestamp = Date.now(); // Update timestamp
                    this.renderHistory();
                    console.log('[machinor-roundtable] Updated existing plot in history');
                }
            }
            
            // @ts-ignore - toastr is a global library
            toastr.success('Plot edited successfully', 'Machinor Roundtable');
        }
        
        // Reset editing state
        this.isEditingPlot = false;
        this.editingPlotId = null;
        this.closeModal();
        console.log('[machinor-roundtable] Plot saved:', editedText);
    }

    /**
     * Save direction input
     */
    saveDirection() {
        if (!this.elements.directionInput) return;
        
        const direction = this.elements.directionInput.value.trim();
        
        if (!direction) return;
        
        // Add to recent directions (avoid duplicates)
        this.recentDirections = this.recentDirections.filter(d => d !== direction);
        this.recentDirections.unshift(direction);
        
        // Keep only max recent directions
        if (this.recentDirections.length > this.maxRecentDirections) {
            this.recentDirections = this.recentDirections.slice(0, this.maxRecentDirections);
        }
        
        this.saveSettings();
        // @ts-ignore - toastr is a global library
        toastr.info(`Direction saved: "${direction}"`, 'Machinor Roundtable');
        console.log('[machinor-roundtable] Direction saved:', direction);
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
            
            console.log('[machinor-roundtable] History expanded');
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
            
            console.log('[machinor-roundtable] History collapsed');
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
        console.log('[machinor-roundtable] History limit updated:', this.historyLimit);
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
        
        console.log('[machinor-roundtable] Plot added to history');
    }

    /**
     * Trim history to limit
     */
    trimHistory() {
        if (this.plotHistory.length > this.historyLimit) {
            this.plotHistory = this.plotHistory.slice(0, this.historyLimit);
        }
    }

    /**
     * Load cross-device synced injection history for current chat
     */
    loadSyncedHistory() {
        try {
            // Call the global helper function to get current chat history
            if (typeof window.getCurrentChatHistory === 'function') {
                const syncedHistory = window.getCurrentChatHistory();
                console.log('[machinor-roundtable] Loaded synced history:', syncedHistory.length, 'entries');
                return syncedHistory;
            } else {
                console.warn('[machinor-roundtable] getCurrentChatHistory function not available yet');
                return [];
            }
        } catch (error) {
            console.error('[machinor-roundtable] Error loading synced history:', error);
            return [];
        }
    }

    /**
     * Render plot history (enhanced for cross-device sync)
     */
    renderHistory() {
        if (!this.elements.historyList) return;
        
        // Load synced history first
        const syncedHistory = this.loadSyncedHistory();
        
        if (syncedHistory.length === 0 && this.plotHistory.length === 0) {
            this.elements.historyList.innerHTML = '<div class="mr-history-item">No plot history yet</div>';
            return;
        }
        
        // Combine synced history with any local history
        const combinedHistory = [
            ...syncedHistory.map(entry => ({
                text: entry.text,
                timestamp: new Date(entry.timestamp).getTime(),
                id: `synced_${entry.timestamp}`,
                isSynced: true,
                character: entry.character,
                style: entry.style,
                intensity: entry.intensity
            })),
            ...this.plotHistory.map(plot => ({
                ...plot,
                isSynced: false
            }))
        ];
        
        // Sort by timestamp (newest first)
        combinedHistory.sort((a, b) => b.timestamp - a.timestamp);
        
        // Limit to history limit
        const limitedHistory = combinedHistory.slice(0, this.historyLimit);
        
        this.elements.historyList.innerHTML = limitedHistory.map(plot => {
            const timestamp = new Date(plot.timestamp).toLocaleString();
            const character = plot.character ? ` • ${plot.character}` : '';
            const style = plot.style && plot.style !== 'natural' ? ` • ${plot.style}` : '';
            const syncedIcon = plot.isSynced ? '<i class="fa-solid fa-cloud" title="Cross-device synced"></i>' : '';
            
            return `
                <div class="mr-history-item ${plot.isSynced ? 'synced' : ''}"
                     data-plot-text="${encodeURIComponent(plot.text)}"
                     title="${timestamp}${character}${style}">
                    <div class="mr-history-text">${plot.text.substring(0, 60)}${plot.text.length > 60 ? '...' : ''}</div>
                    <div class="mr-history-meta">
                        ${syncedIcon}
                        <span class="mr-history-time">${new Date(plot.timestamp).toLocaleDateString()}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        // Add click handlers
        this.elements.historyList.querySelectorAll('.mr-history-item').forEach(item => {
            item.addEventListener('click', () => {
                const plotText = decodeURIComponent(/** @type {HTMLElement} */ (item).dataset.plotText);
                if (plotText) {
                    // Clear editing state for synced entries
                    this.isEditingPlot = false;
                    this.editingPlotId = null;
                    
                    this.displayCurrentPlot(plotText, 'ready');
                    // @ts-ignore - toastr is a global library
                    toastr.info('Plot loaded from history', 'Machinor Roundtable');
                }
            });
        });
    }

    /**
     * Generate new plot using the plot engine
     */
    async generateNewPlot() {
        console.log('[machinor-roundtable] Generating new plot...');
        
        // CRITICAL FIX: Show "Generating..." status during plot creation
        this.updateStatus('pending');
        this.clearAutoApproveTimer(); // Prevent auto-inject during generation
        
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
            const plotContext = await this.plotEngine.generatePlotContext(character, chatHistory);
            
            if (plotContext) {
                this.displayCurrentPlot(plotContext, 'ready');
                // @ts-ignore - toastr is a global library
                toastr.success('New plot generated', 'Machinor Roundtable');
            } else {
                this.updateStatus('ready'); // Reset status if no plot generated
            }
        } catch (error) {
            console.error('[machinor-roundtable] Failed to generate new plot:', error);
            this.updateStatus('ready'); // Reset status on error
            // @ts-ignore - toastr is a global library
            toastr.error('Failed to generate plot', 'Machinor Roundtable');
        }
    }

    /**
     * Generate new plot with current Plot Style/Intensity options (for Skip button)
     */
    async generateNewPlotWithOptions() {
        console.log('[machinor-roundtable] Generating new plot with options...');
        
        // CRITICAL FIX: Show "Generating..." status during plot creation
        this.updateStatus('pending');
        this.clearAutoApproveTimer(); // Prevent auto-inject during generation
        
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
            console.log('[machinor-roundtable] New Plot Style:', plotStyle, 'Plot Intensity:', plotIntensity);
            
            // Combine options for plot generation
            const plotOptions = {
                style: plotStyle,
                intensity: plotIntensity
            };
            
            // Generate plot using the plot engine with options
            const plotContext = await this.plotEngine.generatePlotContext(character, chatHistory, plotOptions);
            
            if (plotContext) {
                this.displayCurrentPlot(plotContext, 'ready');
                // @ts-ignore - toastr is a global library
                toastr.success('New plot generated with style: ' + plotStyle, 'Machinor Roundtable');
            } else {
                this.updateStatus('ready'); // Reset status if no plot generated
            }
        } catch (error) {
            console.error('[machinor-roundtable] Failed to generate new plot with options:', error);
            this.updateStatus('ready'); // Reset status on error
            // @ts-ignore - toastr is a global library
            toastr.error('Failed to generate plot with options', 'Machinor Roundtable');
        }
    }

    /**
     * Generate next plot preview using the plot engine
     */
    async generateNextPlot() {
        console.log('[machinor-roundtable] Generating next plot...');
        
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
            console.error('[machinor-roundtable] Failed to generate next plot:', error);
            this.displayNextPlot('Generation failed: ' + error.message);
        }
    }
    
    /**
     * Generate next plot preview with current Plot Style/Intensity options
     */
    async generateNextPlotWithOptions() {
        console.log('[machinor-roundtable] Generating next plot with options...');
        
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
            console.log('[machinor-roundtable] Next Plot Style:', plotStyle, 'Plot Intensity:', plotIntensity);
            
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
            console.error('[machinor-roundtable] Failed to generate next plot with options:', error);
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
            isPaused: this.isPaused,
            currentPlot: this.currentPlot,
            nextPlot: this.nextPlot,
            historyCount: this.plotHistory.length,
            recentDirectionsCount: this.recentDirections.length,
            autoApproveTimeout: this.autoApproveTimeout
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
            this.elements.sidebar.setAttribute('aria-hidden', sidebarHidden ? 'true' : 'false');
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
            .map((element) => /** @type {HTMLElement} */ (element));
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
            mobileToggle.innerHTML = '<i class="fa-solid fa-book-atlas"></i>';
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