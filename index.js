// Import from SillyTavern core
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { PlotEngine } from "./plot-engine.js";
import { ChatInjector } from "./chat-injector.js";
import { PlotPreviewManager } from "./plot-preview.js";
import { STIntegrationManager } from "./st-integration.js";
import { NarrativeArcManager } from "./narrative-arc.js";
import { logger } from "./logger.js";
import { validateNumericInput, createErrorHandler, ALLOWED_STYLES, ALLOWED_INTENSITIES } from "./security-utils.js";

const extensionName = "machinor-roundtable";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// Default Settings
const defaultSettings = {
    enabled: false,
    debugMode: false,
    currentTemplate: "universal-development",
    frequency: 3,
    historyLimit: 5,
    plotStyle: 'natural',
    plotIntensity: 'moderate',
    previewHistories: {},
    plotCount: 0
};

/**
 * MachinorCore - Centralized Extension Manager
 * Handles lifecycle, initialization, and component coordination
 */
class MachinorCore {
    constructor() {
        /** @type {Object} */
        this.components = {
            stIntegration: null,
            plotEngine: null,
            chatInjector: null,
            plotPreview: null,
            narrativeArc: null
        };
        /** @type {boolean} */
        this.isInitializing = true;
        /** @type {Object} */
        this.settings = { ...defaultSettings };
        /** @type {Array<{selector: string, event: string, handler: Function}>} */
        this.jQueryEventRefs = [];
    }

    /**
     * Initialize the extension
     * @returns {Promise<void>} Resolves when initialization is complete
     * @throws {Error} If initialization fails
     */
    async initialize() {
        const errorHandler = createErrorHandler('MachinorCore.initialize');
        logger.log(`Initializing MachinorCore...`);

        try {
            // 1. Load UI Resources
            await this.loadResources();

            // 2. Load Settings
            this.loadSettings();

            // 3. Initialize Components
            // COMPONENT INITIALIZATION: Create components in dependency order. STIntegration first (no deps), then NarrativeArc (needs STIntegration), then PlotEngine (needs both), then PlotPreview and ChatInjector. Resolve circular dependencies after creation.
            this.initializeComponents();

            // 4. Bind UI Events
            this.bindEvents();

            // 5. Start Integration
            // Optional chaining
            await this.components.stIntegration?.initialize();

            logger.log(`MachinorCore initialization complete`);
            this.isInitializing = false;

        } catch (error) {
            errorHandler(error, 'Initialization failed');
        }
    }

    /**
     * Load HTML and CSS resources
     * @returns {Promise<void>}
     * @throws {Error} If resource loading fails
     */
    async loadResources() {
        try {
            const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
            $("#extensions_settings2").append(settingsHtml);

            const plotPreviewHtml = await $.get(`${extensionFolderPath}/plot-preview.html`);
            $('body').append(plotPreviewHtml);

            const plotPreviewCss = await $.get(`${extensionFolderPath}/plot-preview.css`);
            $('<style>').text(plotPreviewCss).appendTo('head');

            const settingsCss = await $.get(`${extensionFolderPath}/settings.css`);
            $('<style>').text(settingsCss).appendTo('head');

            const sidebar = document.getElementById('mr_plot_sidebar');
            if (sidebar) sidebar.classList.add('collapsed');
        } catch (error) {
            logger.error('Failed to load resources:', error);
            // @ts-ignore - toastr is a global library
            if (window.toastr) window.toastr.error('Failed to load extension resources', 'Machinor Roundtable');
        }
    }

    /**
     * Initialize core logic components
     * @returns {void}
     */
    initializeComponents() {
        this.components.stIntegration = new STIntegrationManager();
        this.components.narrativeArc = new NarrativeArcManager(this.components.stIntegration);

        this.components.plotEngine = new PlotEngine(
            this.components.stIntegration,
            this.components.narrativeArc
        );

        this.components.plotPreview = new PlotPreviewManager(
            this.components.plotEngine,
            null
        );

        this.components.chatInjector = new ChatInjector(
            this.components.plotEngine,
            this.components.plotPreview,
            this.components.stIntegration
        );

        // Resolve Circular Dependencies
        // Optional chaining
        if (this.components.plotPreview) {
            this.components.plotPreview.chatInjector = this.components.chatInjector;
        }
        // stIntegration does not need references to other components

        // Subscribe to Chat Readiness
        // Optional chaining
        this.components.stIntegration?.on('chat_ready', (context) => {
            logger.log(`Core received chat_ready event`);
            this.onChatReady(context);
        });
    }

    /**
     * Handle chat ready event
     * @param {Object} context - The chat context
     * @returns {void}
     */
    onChatReady(context) {
        logger.log(`onChatReady triggered`);
        // CHAT READY EVENT FLOW: STIntegrationManager emits 'chat_ready' when SillyTavern core is fully loaded. This triggers ChatInjector initialization and PlotPreview deferred init.
        if (this.components.chatInjector) {
            logger.log(`Calling chatInjector.initialize()`);
            this.components.chatInjector.initialize();
        } else {
            logger.error(`chatInjector component missing!`);
        }
        if (this.components.plotPreview) {
            this.components.plotPreview.deferredInit();
        }
    }

    /**
     * Load settings from SillyTavern storage
     * @returns {void}
     */
    loadSettings() {
        try {
            logger.log(`Loading settings...`);
            extension_settings[extensionName] = extension_settings[extensionName] || {};
            if (Object.keys(extension_settings[extensionName]).length === 0) {
                logger.log(`Initializing default settings`);
                Object.assign(extension_settings[extensionName], defaultSettings);
            }
            this.settings = extension_settings[extensionName];
            
            // Initialize logger debug mode from settings
            logger.setDebugMode(this.settings.debugMode);
            
            logger.log(`Settings loaded:`, this.settings);
            this.updateSettingsUI();
        } catch (error) {
            logger.error('Failed to load settings:', error);
            // Fallback to defaults if corrupted
            this.settings = { ...defaultSettings };
        }
    }

    /**
     * Update UI elements with current settings
     * @returns {void}
     */
    updateSettingsUI() {
        // Use nullish coalescing for boolean flags
        $("#mr_enabled").prop("checked", this.settings.enabled ?? false);
        $("#mr_debug").prop("checked", this.settings.debugMode ?? false);
        $("#mr_frequency").val(this.settings.frequency ?? 3);
        $("#mr_history_limit").val(this.settings.historyLimit ?? 5);
        $("#mr_plot_style").val(this.settings.plotStyle || 'natural');
        $("#mr_plot_intensity").val(this.settings.plotIntensity || 'moderate');
        $("#mr_plot_count").text(this.settings.plotCount || 0);

        // Update frequency counter display
        // Display current turn progress vs frequency target for user visibility
        const currentTurns = this.settings.turnsSinceLastGeneration || 0;
        const frequency = this.settings.frequency ?? 3;
        $("#mr_turn_progress").text(`${currentTurns} / ${frequency}`);
    }

    /**
     * Save settings safely
     * @returns {void}
     */
    saveSettings() {
        if (this.isInitializing) return;
        try {
            extension_settings[extensionName] = this.settings;
            saveSettingsDebounced();
        } catch (error) {
            logger.error('Failed to save settings:', error);
        }
    }

    /**
     * Bind UI events
     * @returns {void}
     */
    bindEvents() {
        // SETTINGS BINDING: Store jQuery event references for cleanup. Each binding validates input and saves with debounce.
        const bind = (selector, event, handler) => {
            $(selector).on(event, handler);
            this.jQueryEventRefs.push({ selector, event, handler });
        };

        bind("#mr_enabled", "input", (e) => {
            this.settings.enabled = $(e.target).prop("checked");
            this.saveSettings();
        });

        bind("#mr_debug", "input", (e) => {
            this.settings.debugMode = $(e.target).prop("checked");
            logger.setDebugMode(this.settings.debugMode);
            this.saveSettings();
        });

        bind("#mr_frequency", "input", (e) => {
            const val = $(e.target).val();
            this.settings.frequency = validateNumericInput(val, 1, 100, 3);
            this.saveSettings();
            this.updateSettingsUI(); // Update progress display immediately
        });

        bind("#mr_reset_counter", "click", () => {
            this.settings.turnsSinceLastGeneration = 0;
            this.saveSettings();
            this.updateSettingsUI();
            // @ts-ignore - toastr is a global library
            if (window.toastr) window.toastr.success('Frequency counter reset to 0', 'Machinor Roundtable');
        });

        bind("#mr_history_limit", "input", (e) => {
            const val = $(e.target).val();
            this.settings.historyLimit = validateNumericInput(val, 1, 50, 5);
            this.saveSettings();
        });

        bind("#mr_plot_style", "change", (e) => {
            const val = $(e.target).val();
            if (ALLOWED_STYLES.includes(val)) {
                this.settings.plotStyle = val;
                this.saveSettings();
            } else {
                // Reset if invalid
                $(e.target).val(this.settings.plotStyle || 'natural');
                // @ts-ignore
                if (window.toastr) window.toastr.warning('Invalid plot style', 'Machinor Roundtable');
            }
        });

        bind("#mr_plot_intensity", "change", (e) => {
            const val = $(e.target).val();
            if (ALLOWED_INTENSITIES.includes(val)) {
                this.settings.plotIntensity = val;
                this.saveSettings();
            } else {
                // Reset if invalid
                $(e.target).val(this.settings.plotIntensity || 'moderate');
                // @ts-ignore
                if (window.toastr) window.toastr.warning('Invalid plot intensity', 'Machinor Roundtable');
            }
        });

        bind("#mr_manual_trigger", "click", () => this.manualTrigger());
        bind("#mr_reset_settings", "click", () => this.resetSettings());
    }

    /**
     * Manual trigger handler
     * @returns {Promise<void>}
     */
    async manualTrigger() {
        const errorHandler = createErrorHandler('manualTrigger');

        if (!this.settings.enabled) {
            // @ts-ignore
            if (window.toastr) window.toastr.warning("Enable the extension first", "Machinor Roundtable");
            return;
        }

        // Optional chaining
        const character = this.components.stIntegration?.getActiveCharacters()[0];
        if (!character) {
            // @ts-ignore
            if (window.toastr) window.toastr.warning("No character selected", "Machinor Roundtable");
            return;
        }

        // Optional chaining
        this.components.plotPreview?.updateStatus('pending');

        try {
            // Optional chaining
            const chatHistory = this.components.chatInjector?.getRecentChatHistory() || [];

            // Set recursion guard on injector to prevent it from reacting to our own generation events
            // RECURSION GUARD: Set isGeneratingPlot flag to prevent ChatInjector from reacting to our manual generation event. Always cleared in finally block.
            if (this.components.chatInjector) {
                this.components.chatInjector.isGeneratingPlot = true;
            }

            // Optional chaining
            const plotContext = await this.components.plotEngine?.generatePlotContext(
                character,
                chatHistory,
                {
                    style: this.settings.plotStyle,
                    intensity: this.settings.plotIntensity
                }
            );

            // Optional chaining
            this.components.plotPreview?.displayCurrentPlot(plotContext, 'ready');

            this.settings.plotCount = (this.settings.plotCount || 0) + 1;
            this.saveSettings();
            this.updateSettingsUI();

            // Note: Plot is displayed as current. User can approve/inject to add to history.

        } catch (error) {
            // Optional chaining
            this.components.plotPreview?.updateStatus('ready');
            errorHandler(error, "Failed to generate plot");
        } finally {
            // Always clear recursion guard
            if (this.components.chatInjector) {
                this.components.chatInjector.isGeneratingPlot = false;
            }
        }
    }

    /**
     * Reset settings handler
     * @returns {void}
     */
    resetSettings() {
        if (confirm("Reset all Machinor Roundtable settings?")) {
            this.settings = { ...defaultSettings };
            this.saveSettings();
            this.updateSettingsUI();
            toastr.info("Settings reset", "Machinor Roundtable");
        }
    }
    /**
     * Sync plot data to settings (Lazy/Debounced)
     * @param {string} chatId - The chat ID
     * @param {Object} profileData - The full profile data to sync
     * @returns {void}
     */
    syncPlotToSettings(chatId, profileData) {
        if (!chatId || !profileData) return;

        // Ensure previewHistories exists
        this.settings.previewHistories = this.settings.previewHistories || {};

        // Implement LRU for previewHistories (keep 50 most recent)
        // LRU CACHE: Keep 50 most recent chat profiles by timestamp. Evict oldest when limit reached to prevent unbounded growth.
        const histories = this.settings.previewHistories;
        const keys = Object.keys(histories);
        
        if (keys.length >= 50 && !histories[chatId]) {
            // Need to evict oldest
            this.trimPreviewHistories();
        }

        // Update the setting with full profile
        this.settings.previewHistories[chatId] = {
            ...profileData,
            timestamp: Date.now()
        };

        // Periodically check storage health
        if (Math.random() < 0.1) { // 10% chance on sync
            this.checkStorageHealth();
        }

        // Save with debounce
        this.saveSettings();
    }

    /**
     * Trim preview histories to keep most recent 50
     * @returns {void}
     */
    trimPreviewHistories() {
        try {
            const histories = this.settings.previewHistories;
            if (!histories) return;

            const entries = Object.entries(histories);
            if (entries.length <= 50) return;

            // Sort by timestamp descending (newest first)
            entries.sort(([, a], [, b]) => (b.timestamp || 0) - (a.timestamp || 0));

            // Keep top 50
            const keptEntries = entries.slice(0, 50);
            const evictedCount = entries.length - 50;

            this.settings.previewHistories = Object.fromEntries(keptEntries);
            
            logger.log(`[Machinor Roundtable] Trimmed ${evictedCount} old chat histories from settings`);
        } catch (error) {
            logger.error('Error trimming preview histories:', error);
        }
    }

    /**
     * Check storage health and warn if close to limit
     * @returns {void}
     */
    checkStorageHealth() {
        try {
            // Rough estimation of storage usage for this extension
            const json = JSON.stringify(this.settings);
            const sizeBytes = new Blob([json]).size;
            const sizeMB = sizeBytes / (1024 * 1024);
            
            // Typical localStorage limit is ~5MB, but we share it with ST and other extensions
            // Warn if we're using > 2MB ourselves
            // STORAGE HEALTH: Monitor extension storage usage. Warn if > 2MB and trigger aggressive cleanup to prevent localStorage exhaustion.
            if (sizeMB > 2) {
                logger.warn(`[Machinor Roundtable] High storage usage: ${sizeMB.toFixed(2)}MB`);
                // Trigger aggressive cleanup
                this.trimPreviewHistories();
            }
        } catch (error) {
            logger.error('Error checking storage health:', error);
        }
    }

    /**
     * Destroy/cleanup method
     * @returns {void}
     */
    destroy() {
        logger.log('[Machinor Roundtable] Destroying MachinorCore...');

        // 1. Destroy components
        // Optional chaining for safe destruction
        this.components.plotPreview?.destroy();
        this.components.chatInjector?.destroy();
        this.components.stIntegration?.destroy();
        
        // 2. Cleanup jQuery events
        this.jQueryEventRefs.forEach(({ selector, event, handler }) => {
            try {
                $(selector).off(event, handler);
            } catch (e) {
                // Ignore errors if element doesn't exist
            }
        });
        this.jQueryEventRefs = [];

        // 3. Clear references
        this.components = {};
        
        // 4. Remove global reference
        if (window.machinorRoundtable === this) {
            delete window.machinorRoundtable;
        }

        logger.log('[Machinor Roundtable] MachinorCore destroyed');
    }
}

// Initialize
jQuery(async () => {
    // Initialize
    const machinorCore = new MachinorCore();
    window.machinorRoundtable = machinorCore; // Expose globally
    await machinorCore.initialize();
});