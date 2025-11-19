// Import from SillyTavern core
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { PlotEngine } from "./plot-engine.js";
import { ChatInjector } from "./chat-injector.js";
import { PlotPreviewManager } from "./plot-preview.js";
import { STIntegrationManager } from "./st-integration.js";
import { NarrativeArcManager } from "./narrative-arc.js";

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
    chatHistories: {},
    previewHistories: {},
    plotCount: 0
};

/**
 * MachinorCore - Centralized Extension Manager
 * Handles lifecycle, initialization, and component coordination
 */
class MachinorCore {
    constructor() {
        this.components = {
            stIntegration: null,
            plotEngine: null,
            chatInjector: null,
            plotPreview: null,
            narrativeArc: null
        };
        this.isInitializing = true;
        this.settings = { ...defaultSettings };
    }

    /**
     * Initialize the extension
     */
    async initialize() {
        console.log(`[${extensionName}] Initializing MachinorCore...`);

        try {
            // 1. Load UI Resources
            await this.loadResources();

            // 2. Load Settings
            this.loadSettings();

            // 3. Initialize Components
            this.initializeComponents();

            // 4. Bind UI Events
            this.bindEvents();

            // 5. Start Integration
            await this.components.stIntegration.initialize();

            console.log(`[${extensionName}] MachinorCore initialization complete`);
            this.isInitializing = false;

        } catch (error) {
            console.error(`[${extensionName}] Initialization failed:`, error);
        }
    }

    /**
     * Load HTML and CSS resources
     */
    async loadResources() {
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
    }

    /**
     * Initialize core logic components
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
        this.components.plotPreview.chatInjector = this.components.chatInjector;
        // stIntegration does not need references to other components

        // Subscribe to Chat Readiness
        this.components.stIntegration.on('chat_ready', (context) => {
            console.log(`[${extensionName}] Core received chat_ready event`);
            this.onChatReady(context);
        });
    }

    /**
     * Handle chat ready event
     */
    onChatReady(context) {
        if (this.components.chatInjector) {
            this.components.chatInjector.initialize();
        }
        if (this.components.plotPreview) {
            this.components.plotPreview.deferredInit();
        }
    }

    /**
     * Load settings from SillyTavern storage
     */
    loadSettings() {
        extension_settings[extensionName] = extension_settings[extensionName] || {};
        if (Object.keys(extension_settings[extensionName]).length === 0) {
            Object.assign(extension_settings[extensionName], defaultSettings);
        }
        this.settings = extension_settings[extensionName];
        this.updateSettingsUI();
    }

    /**
     * Update UI elements with current settings
     */
    updateSettingsUI() {
        $("#mr_enabled").prop("checked", this.settings.enabled);
        $("#mr_debug").prop("checked", this.settings.debugMode);
        $("#mr_frequency").val(this.settings.frequency || 3);
        $("#mr_history_limit").val(this.settings.historyLimit || 5);
        $("#mr_plot_style").val(this.settings.plotStyle || 'natural');
        $("#mr_plot_intensity").val(this.settings.plotIntensity || 'moderate');
        $("#mr_plot_count").text(this.settings.plotCount || 0);
    }

    /**
     * Save settings safely
     */
    saveSettings() {
        if (this.isInitializing) return;
        extension_settings[extensionName] = this.settings;
        saveSettingsDebounced();
    }

    /**
     * Bind UI events
     */
    bindEvents() {
        $("#mr_enabled").on("input", (e) => {
            this.settings.enabled = $(e.target).prop("checked");
            this.saveSettings();
        });

        $("#mr_debug").on("input", (e) => {
            this.settings.debugMode = $(e.target).prop("checked");
            this.saveSettings();
        });

        $("#mr_frequency").on("input", (e) => {
            this.settings.frequency = parseInt($(e.target).val()) || 3;
            this.saveSettings();
        });

        $("#mr_history_limit").on("input", (e) => {
            this.settings.historyLimit = parseInt($(e.target).val()) || 5;
            this.saveSettings();
        });

        $("#mr_plot_style").on("change", (e) => {
            this.settings.plotStyle = $(e.target).val();
            this.saveSettings();
        });

        $("#mr_plot_intensity").on("change", (e) => {
            this.settings.plotIntensity = $(e.target).val();
            this.saveSettings();
        });

        $("#mr_manual_trigger").on("click", () => this.manualTrigger());
        $("#mr_reset_settings").on("click", () => this.resetSettings());
    }

    /**
     * Manual trigger handler
     */
    async manualTrigger() {
        if (!this.settings.enabled) {
            toastr.warning("Enable the extension first", "Machinor Roundtable");
            return;
        }

        const character = this.components.stIntegration.getActiveCharacters()[0];
        if (!character) {
            toastr.warning("No character selected", "Machinor Roundtable");
            return;
        }

        this.components.plotPreview.updateStatus('pending');

        try {
            const chatHistory = this.components.chatInjector.getRecentChatHistory();
            const plotContext = await this.components.plotEngine.generatePlotContext(
                character,
                chatHistory,
                {
                    style: this.settings.plotStyle,
                    intensity: this.settings.plotIntensity
                }
            );

            this.components.plotPreview.displayCurrentPlot(plotContext, 'ready');

            this.settings.plotCount = (this.settings.plotCount || 0) + 1;
            this.saveSettings();
            this.updateSettingsUI();

            // Note: Plot is displayed as current. User can approve/inject to add to history.

        } catch (error) {
            console.error(`[${extensionName}] Manual trigger failed:`, error);
            this.components.plotPreview.updateStatus('ready');
            toastr.error("Failed to generate plot", "Machinor Roundtable");
        }
    }

    /**
     * Reset settings handler
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
     * @param {Object} plotData - The plot data to sync
     */
    syncPlotToSettings(chatId, plotData) {
        if (!chatId || !plotData) return;

        // Ensure previewHistories exists
        this.settings.previewHistories = this.settings.previewHistories || {};

        // Update the setting
        this.settings.previewHistories[chatId] = {
            ...plotData,
            timestamp: Date.now()
        };

        // Save with debounce
        this.saveSettings();
    }
}

// Global Helpers (Legacy Support)
window.getCurrentChatId = () => {
    const context = getContext();
    return context?.chatId || null;
};

window.addInjectionToHistory = (plotContext, metadata = {}) => {
    const core = window.machinorRoundtable;
    if (!core) return;

    const chatId = window.getCurrentChatId();
    if (!chatId) return;

    const history = core.settings.chatHistories[chatId] || [];
    history.unshift({
        text: plotContext,
        timestamp: new Date().toISOString(),
        ...metadata
    });

    if (history.length > core.settings.historyLimit) {
        history.length = core.settings.historyLimit;
    }

    core.settings.chatHistories[chatId] = history;
    core.saveSettings();
};

window.getCurrentChatHistory = () => {
    const core = window.machinorRoundtable;
    const chatId = window.getCurrentChatId();
    return (core && chatId) ? (core.settings.chatHistories[chatId] || []) : [];
};

window.clearCurrentChatHistory = () => {
    const core = window.machinorRoundtable;
    const chatId = window.getCurrentChatId();
    if (core && chatId && core.settings.chatHistories[chatId]) {
        delete core.settings.chatHistories[chatId];
        core.saveSettings();
    }
};

// Initialize
jQuery(async () => {
    const core = new MachinorCore();
    window.machinorRoundtable = core;
    await core.initialize();
});