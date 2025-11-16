// Import from SillyTavern core
import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { PlotEngine } from "./plot-engine.js";
import { ChatInjector } from "./chat-injector.js";
import { PlotPreviewManager } from "./plot-preview.js";
import { STIntegrationManager } from "./st-integration.js";
import { NarrativeArcManager } from "./narrative-arc.js";
/**
 * Gets the current character from SillyTavern context
 * @returns {Object|null} The current character object or null if no character is selected
 */
function getCurrentCharacter() {
    try {
        const context = getContext();
        if (!context) {
            debugLog("getCurrentCharacter: No context available");
            return null;
        }

        if (extension_settings[extensionName]?.debugMode) {
            debugLog("Full context object:", context);
            debugLog("Current characterId:", context.characterId);
            if (context.characters) {
                debugLog("Available character avatars:", context.characters.map(c => c.avatar));
            }
        }
        
        // Check if we have a characterId and characters array
        if (context.characterId === undefined || !context.characters) {
            debugLog("getCurrentCharacter: No characterId or characters array");
            return null;
        }
        
        // Find the current character by ID
        const character = context.characters[context.characterId];
        
        debugLog("getCurrentCharacter:", character ? character.name : "No character found");
        
        return character || null;
    } catch (error) {
        console.error(`[${extensionName}] Error getting current character:`, error);
        return null;
    }
}

/**
 * Gets the current LLM settings from SillyTavern context
 * @returns {Object} Object containing mainApi and other relevant settings
 */
function getCurrentLLMSettings() {
    try {
        // Get context from the imported getContext function
        const context = getContext();
        
        if (!context) {
            console.warn(`[${extensionName}] No context available for LLM settings`);
            return {
                mainApi: null,
                chatCompletionSettings: null,
                textCompletionSettings: null
            };
        }
        
        // Access the global SillyTavern object for complete settings
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const stContext = SillyTavern.getContext();
            if (stContext) {
                const settings = {
                    mainApi: stContext.mainApi,
                    chatCompletionSettings: stContext.chatCompletionSettings,
                    textCompletionSettings: stContext.textCompletionSettings
                };
                
                if (extension_settings[extensionName]?.debugMode) {
                    console.log(`[${extensionName}] getCurrentLLMSettings:`, settings);
                }
                
                return settings;
            }
        }
        
        // Fallback: try to get from context directly
        const fallbackSettings = {
            mainApi: context.mainApi || null,
            chatCompletionSettings: context.chatCompletionSettings || null,
            textCompletionSettings: context.textCompletionSettings || null
        };
        
        if (extension_settings[extensionName]?.debugMode) {
            console.log(`[${extensionName}] getCurrentLLMSettings (fallback):`, fallbackSettings);
        }
        
        return fallbackSettings;
        
    } catch (error) {
        console.error(`[${extensionName}] Error getting LLM settings:`, error);
        return {
            mainApi: null,
            chatCompletionSettings: null,
            textCompletionSettings: null
        };
    }
}

/**
 * Debug logging helper that only logs when debug mode is enabled
 * @param {string} message - The message to log
 * @param {any} data - Optional data to log
 */
function debugLog(message, data = null) {
    if (extension_settings[extensionName]?.debugMode) {
        if (data !== null) {
            console.log(`[${extensionName}] ${message}`, data);
        } else {
            console.log(`[${extensionName}] ${message}`);
        }
    }
}

/**
 * Get current chat ID for history storage
 * @returns {string|null} Current chat ID or null if not available
 */
function getCurrentChatId() {
    try {
        const context = getContext();
        if (!context) {
            return null;
        }
        
        // Try to get chat ID from context
        if (context.chatId) {
            return String(context.chatId);
        }
        
        // Fallback: try to construct ID from available data
        if (context.chat) {
            return `chat_${context.chat.length}_${context.chat[0]?.send_date || 'unknown'}`;
        }
        
        // Last resort: use a default for single-chats
        if (context.characterId !== undefined && context.characters) {
            const char = context.characters[context.characterId];
            return `char_${char?.avatar || 'unknown'}_default`;
        }
        
        return null;
    } catch (error) {
        console.error(`[${extensionName}] Error getting chat ID:`, error);
        return null;
    }
}

/**
 * Add injection to history for cross-device sync
 * @param {string} plotContext - The plot context that was injected
 * @param {Object} metadata - Additional metadata about the injection
 */
function addInjectionToHistory(plotContext, metadata = {}) {
    try {
        const chatId = getCurrentChatId();
        if (!chatId) {
            debugLog("No chat ID available, cannot save injection history");
            return;
        }
        
        // Initialize chatHistories if not exists
        extension_settings[extensionName].chatHistories = extension_settings[extensionName].chatHistories || {};
        extension_settings[extensionName].chatHistories[chatId] = extension_settings[extensionName].chatHistories[chatId] || [];
        
        // Create history entry
        const historyEntry = {
            text: plotContext,
            timestamp: new Date().toISOString(),
            character: metadata.character || 'Unknown Character',
            style: metadata.style || 'natural',
            intensity: metadata.intensity || 'moderate'
        };
        
        // Add to history
        extension_settings[extensionName].chatHistories[chatId].unshift(historyEntry);
        
        // Enforce history limit
        const historyLimit = extension_settings[extensionName].historyLimit || 5;
        if (extension_settings[extensionName].chatHistories[chatId].length > historyLimit) {
            extension_settings[extensionName].chatHistories[chatId] = extension_settings[extensionName].chatHistories[chatId].slice(0, historyLimit);
        }
        
        // Save settings
        saveSettingsDebounced();
        debugLog(`Saved injection to history for chat ${chatId}:`, historyEntry);
        
    } catch (error) {
        console.error(`[${extensionName}] Error adding injection to history:`, error);
    }
}

/**
 * Get injection history for current chat
 * @returns {Array} Array of injection history entries for current chat
 */
function getCurrentChatHistory() {
    try {
        const chatId = getCurrentChatId();
        if (!chatId) {
            return [];
        }
        
        const histories = extension_settings[extensionName].chatHistories || {};
        return histories[chatId] || [];
    } catch (error) {
        console.error(`[${extensionName}] Error getting chat history:`, error);
        return [];
    }
}

/**
 * Clear injection history for current chat
 */
function clearCurrentChatHistory() {
    try {
        const chatId = getCurrentChatId();
        if (!chatId) {
            debugLog("No chat ID available, cannot clear history");
            return;
        }
        
        if (extension_settings[extensionName].chatHistories && extension_settings[extensionName].chatHistories[chatId]) {
            delete extension_settings[extensionName].chatHistories[chatId];
            saveSettingsDebounced();
            debugLog(`Cleared injection history for chat ${chatId}`);
        }
    } catch (error) {
        console.error(`[${extensionName}] Error clearing chat history:`, error);
    }
}

// Make functions globally accessible for cross-file communication
// CRITICAL FIX: Expose extension_settings globally for consistent access across all modules
window.extension_settings = extension_settings;
window.getCurrentChatId = getCurrentChatId;
window.addInjectionToHistory = addInjectionToHistory;
window.getCurrentChatHistory = getCurrentChatHistory;
window.clearCurrentChatHistory = clearCurrentChatHistory;

/**
 * Save plot preview to history for cross-device sync
 * @param {string} plotText - The plot text to save
 * @param {string} status - The plot status
 */
function addPlotPreviewToHistory(plotText, status = 'ready') {
    try {
        const chatId = getCurrentChatId();
        if (!chatId) {
            debugLog("No chat ID available, cannot save plot preview history");
            return;
        }
        
        // Initialize previewHistories if not exists
        extension_settings[extensionName].previewHistories = extension_settings[extensionName].previewHistories || {};
        extension_settings[extensionName].previewHistories[chatId] = extension_settings[extensionName].previewHistories[chatId] || [];
        
        // Create preview entry
        const previewEntry = {
            text: plotText,
            status: status,
            timestamp: new Date().toISOString(),
            id: Date.now().toString()
        };
        
        // Add to preview history
        extension_settings[extensionName].previewHistories[chatId].unshift(previewEntry);
        
        // Enforce history limit
        const historyLimit = extension_settings[extensionName].historyLimit || 5;
        if (extension_settings[extensionName].previewHistories[chatId].length > historyLimit) {
            extension_settings[extensionName].previewHistories[chatId] = extension_settings[extensionName].previewHistories[chatId].slice(0, historyLimit);
        }
        
        // Save settings
        saveSettingsDebounced();
        debugLog(`Saved plot preview to history for chat ${chatId}`);
        
    } catch (error) {
        console.error(`[${extensionName}] Error saving plot preview to history:`, error);
    }
}

/**
 * Get plot preview history for current chat
 * @returns {Array} Array of plot preview history entries for current chat
 */
function getCurrentPlotPreviewHistory() {
    try {
        const chatId = getCurrentChatId();
        if (!chatId) {
            return [];
        }
        
        const histories = extension_settings[extensionName].previewHistories || {};
        return histories[chatId] || [];
    } catch (error) {
        console.error(`[${extensionName}] Error getting plot preview history:`, error);
        return [];
    }
}

/**
 * Load the most recent plot preview for current chat
 * @returns {Object|null} Most recent plot preview or null
 */
function getCurrentPlotPreview() {
    try {
        const history = getCurrentPlotPreviewHistory();
        return history.length > 0 ? history[0] : null;
    } catch (error) {
        console.error(`[${extensionName}] Error getting current plot preview:`, error);
        return null;
    }
}

// Make preview functions globally accessible
window.addPlotPreviewToHistory = addPlotPreviewToHistory;
window.getCurrentPlotPreviewHistory = getCurrentPlotPreviewHistory;
window.getCurrentPlotPreview = getCurrentPlotPreview;

// Extension name MUST match folder name
const extensionName = "machinor-roundtable";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// @ts-ignore - toastr is a global library
const toastr = window.toastr;

// Initialize core components
let plotEngine = null;
let chatInjector = null;
let plotPreview = null;
let stIntegration = null;
let narrativeArc = null;

/**
 * Default settings for the extension
 * Now simplified: only inject when user generates (no frequency logic)
 */
const defaultSettings = {
    enabled: false,
    debugMode: false,
    currentTemplate: "universal-development",
    // Cross-device synced injection history
    chatHistories: {} // { [chatId]: [{text, timestamp, character, style, intensity}] }
};

// Extension initialization
jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);
    
    try {
        // Load HTML from file
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        
        // Append to settings panel (right column for UI extensions)
        $("#extensions_settings2").append(settingsHtml);
        
        // Load plot preview HTML
        const plotPreviewHtml = await $.get(`${extensionFolderPath}/plot-preview.html`);
        $('body').append(plotPreviewHtml);
        
        // Load CSS for modern styling
        const plotPreviewCss = await $.get(`${extensionFolderPath}/plot-preview.css`);
        $('<style>').text(plotPreviewCss).appendTo('head');
        
        const settingsCss = await $.get(`${extensionFolderPath}/settings.css`);
        $('<style>').text(settingsCss).appendTo('head');
        
        // Ensure sidebar starts collapsed
        const sidebar = document.getElementById('mr_plot_sidebar');
        if (sidebar) {
            sidebar.classList.add('collapsed');
        }
        
        // Load saved settings
        loadSettings();
        
        // Initialize core components
        initializeCore();
        
        // Bind UI events
        bindEvents();
        
        console.log(`[${extensionName}] ✅ Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] ❌ Failed to load:`, error);
    }
});

/**
 * Initialize core components
 */
function initializeCore() {
    try {
        // Initialize SillyTavern integration first
        stIntegration = new STIntegrationManager();
        stIntegration.initialize();
        console.log(`[${extensionName}] ST Integration manager initialized`);
        
        // Initialize narrative arc manager with ST integration
        narrativeArc = new NarrativeArcManager(stIntegration);
        console.log(`[${extensionName}] Narrative Arc manager initialized`);
        
        // Initialize plot engine with ST integration and narrative arc
        plotEngine = new PlotEngine(stIntegration, narrativeArc);
        console.log(`[${extensionName}] Plot engine initialized`);
        
        // Initialize plot preview manager first (no dependencies)
        plotPreview = new PlotPreviewManager(plotEngine, null);
        console.log(`[${extensionName}] Plot preview manager initialized`);
        
        // Initialize chat injector with plot engine and preview
        chatInjector = new ChatInjector(plotEngine, plotPreview);
        chatInjector.initialize();
        console.log(`[${extensionName}] Chat injector initialized`);
        
        // Set up cross-references
        plotPreview.chatInjector = chatInjector;
        
    } catch (error) {
        console.error(`[${extensionName}] Failed to initialize core components:`, error);
    }
}

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    
    // Update UI elements
    $("#mr_enabled").prop("checked", extension_settings[extensionName].enabled);
    $("#mr_debug").prop("checked", extension_settings[extensionName].debugMode);
    $("#mr_history_limit").val(extension_settings[extensionName].historyLimit || 5);
    $("#mr_plot_style").val(extension_settings[extensionName].plotStyle || 'natural');
    $("#mr_plot_intensity").val(extension_settings[extensionName].plotIntensity || 'moderate');
    
    console.log(`[${extensionName}] Settings loaded:`, extension_settings[extensionName]);
}

function bindEvents() {
    console.log(`[${extensionName}] Starting to bind events...`);
    
    // Check if elements exist before binding
    const elements = {
        mr_enabled: $("#mr_enabled"),
        mr_debug: $("#mr_debug"),
        mr_history_limit: $("#mr_history_limit"),
        mr_plot_style: $("#mr_plot_style"),
        mr_plot_intensity: $("#mr_plot_intensity"),
        mr_manual_trigger: $("#mr_manual_trigger"),
        mr_clear_cache: $("#mr_clear_cache"),
        mr_reset_settings: $("#mr_reset_settings")
    };
    
    console.log(`[${extensionName}] Elements found:`, {
        mr_enabled: elements.mr_enabled.length,
        mr_debug: elements.mr_debug.length,
        mr_history_limit: elements.mr_history_limit.length,
        mr_plot_style: elements.mr_plot_style.length,
        mr_plot_intensity: elements.mr_plot_intensity.length,
        mr_manual_trigger: elements.mr_manual_trigger.length,
        mr_clear_cache: elements.mr_clear_cache.length,
        mr_reset_settings: elements.mr_reset_settings.length
    });
    
    // Enable/disable toggle
    if (elements.mr_enabled.length > 0) {
        elements.mr_enabled.on("input", onEnabledToggle);
        console.log(`[${extensionName}] Bound mr_enabled event`);
    } else {
        console.error(`[${extensionName}] mr_enabled element not found!`);
    }
    
    // Debug mode toggle
    if (elements.mr_debug.length > 0) {
        elements.mr_debug.on("input", onDebugToggle);
        console.log(`[${extensionName}] Bound mr_debug event`);
    } else {
        console.error(`[${extensionName}] mr_debug element not found!`);
    }
    
    // History limit input
    if (elements.mr_history_limit.length > 0) {
        elements.mr_history_limit.on("input", onHistoryLimitChange);
        console.log(`[${extensionName}] Bound mr_history_limit event`);
    } else {
        console.error(`[${extensionName}] mr_history_limit element not found!`);
    }
    
    // Plot style change
    if (elements.mr_plot_style.length > 0) {
        elements.mr_plot_style.on("change", onPlotStyleChange);
        console.log(`[${extensionName}] Bound mr_plot_style event`);
    } else {
        console.error(`[${extensionName}] mr_plot_style element not found!`);
    }
    
    // Plot intensity change
    if (elements.mr_plot_intensity.length > 0) {
        elements.mr_plot_intensity.on("change", onPlotIntensityChange);
        console.log(`[${extensionName}] Bound mr_plot_intensity event`);
    } else {
        console.error(`[${extensionName}] mr_plot_intensity element not found!`);
    }
    
    // Manual trigger button
    if (elements.mr_manual_trigger.length > 0) {
        elements.mr_manual_trigger.on("click", onManualTrigger);
        console.log(`[${extensionName}] Bound mr_manual_trigger event`);
    } else {
        console.error(`[${extensionName}] mr_manual_trigger element not found!`);
    }
    
    // Clear cache button
    if (elements.mr_clear_cache.length > 0) {
        elements.mr_clear_cache.on("click", onClearCache);
        console.log(`[${extensionName}] Bound mr_clear_cache event`);
    } else {
        console.error(`[${extensionName}] mr_clear_cache element not found!`);
    }
    
    // Reset settings button
    if (elements.mr_reset_settings.length > 0) {
        elements.mr_reset_settings.on("click", onResetSettings);
        console.log(`[${extensionName}] Bound mr_reset_settings event`);
    } else {
        console.error(`[${extensionName}] mr_reset_settings element not found!`);
    }
    
    console.log(`[${extensionName}] All events bound successfully`);
}

function onEnabledToggle(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].enabled = value;
    // CRITICAL FIX: Update global reference to maintain consistency
    window.extension_settings = extension_settings;
    saveSettingsDebounced();
    console.log(`[${extensionName}] Enabled:`, value);
}

function onDebugToggle(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].debugMode = value;
    // CRITICAL FIX: Update global reference to maintain consistency
    window.extension_settings = extension_settings;
    saveSettingsDebounced();
    console.log(`[${extensionName}] Debug mode:`, value);
}

function onHistoryLimitChange(event) {
    const value = parseInt($(event.target).val()) || 5;
    extension_settings[extensionName].historyLimit = value;
    // CRITICAL FIX: Update global reference to maintain consistency
    window.extension_settings = extension_settings;
    saveSettingsDebounced();
    console.log(`[${extensionName}] History limit set to:`, value);
}

function onPlotStyleChange(event) {
    const value = $(event.target).val() || 'natural';
    extension_settings[extensionName].plotStyle = value;
    // CRITICAL FIX: Update global reference to maintain consistency
    window.extension_settings = extension_settings;
    saveSettingsDebounced();
    console.log(`[${extensionName}] Plot style set to:`, value);
}

function onPlotIntensityChange(event) {
    const value = $(event.target).val() || 'moderate';
    extension_settings[extensionName].plotIntensity = value;
    // CRITICAL FIX: Update global reference to maintain consistency
    window.extension_settings = extension_settings;
    saveSettingsDebounced();
    console.log(`[${extensionName}] Plot intensity set to:`, value);
}

function onClearCache() {
    console.log(`[${extensionName}] Clear cache button clicked`);
    
    if (!plotEngine) {
        console.log(`[${extensionName}] Plot engine not initialized`);
        // @ts-ignore - toastr is a global library
        toastr.error("Extension not fully initialized", "Machinor Roundtable");
        return;
    }
    
    plotEngine.clearCache();
    updateStatusDisplay();
    
    // @ts-ignore - toastr is a global library
    toastr.info("Plot cache cleared", "Machinor Roundtable");
    console.log(`[${extensionName}] Cache cleared successfully`);
}

function onResetSettings() {
    console.log(`[${extensionName}] Reset settings button clicked`);
    
    // Confirm with user
    if (confirm("Are you sure you want to reset all Machinor Roundtable settings to defaults?")) {
        // Reset to defaults
        extension_settings[extensionName] = { ...defaultSettings };
        saveSettingsDebounced();
        
        // Reload UI
        loadSettings();
        updateStatusDisplay();
        
        // @ts-ignore - toastr is a global library
        toastr.info("Settings reset to defaults", "Machinor Roundtable");
        console.log(`[${extensionName}] Settings reset to defaults`);
    } else {
        console.log(`[${extensionName}] Reset cancelled by user`);
    }
}

function updateStatusDisplay() {
    if (plotEngine) {
        const cacheSize = plotEngine.getCacheSize();
        $("#mr_cache_size").text(cacheSize);
        console.log(`[${extensionName}] Updated cache size display:`, cacheSize);
    }
    
    const plotCount = extension_settings[extensionName].plotCount || 0;
    $("#mr_plot_count").text(plotCount);
    console.log(`[${extensionName}] Updated plot count display:`, plotCount);
}

function onManualTrigger() {
    if (!extension_settings[extensionName].enabled) {
        // @ts-ignore - toastr is a global library
        toastr.warning("Enable the extension first", "Machinor Roundtable");
        return;
    }
    
    if (!plotPreview) {
        // @ts-ignore - toastr is a global library
        toastr.error("Extension not fully initialized", "Machinor Roundtable");
        return;
    }
    
    console.log(`[${extensionName}] Manual trigger activated`);
    
    // Generate a plot and display it in preview
    generateAndDisplayPlot();
}

/**
 * Generate a plot and display it in the preview
 */
async function generateAndDisplayPlot() {
    debugLog("Starting generateAndDisplayPlot function");
    
    try {
        // CRITICAL FIX: Set pending status first to show "Generating..." during async operation
        if (plotPreview && typeof plotPreview.updateStatus === 'function') {
            plotPreview.updateStatus('pending');
            plotPreview.clearAutoApproveTimer(); // Prevent auto-inject during generation
            debugLog("✅ Set pending status for plot generation");
        } else {
            debugLog("⚠️ plotPreview not available for status update");
        }
        
        // Use the new helper to get current character
        const character = getCurrentCharacter();
        debugLog("Character detection result:", character ? character.name : "No character");
        
        if (!character) {
            debugLog("No character selected, showing warning");
            // Reset status on error
            if (plotPreview && typeof plotPreview.updateStatus === 'function') {
                plotPreview.updateStatus('ready');
            }
            // @ts-ignore - toastr is a global library
            toastr.warning("No character selected", "Machinor Roundtable");
            return;
        }
        
        debugLog("Getting recent chat history...");
        // Get recent chat history
        const chatHistory = chatInjector.getRecentChatHistory();
        debugLog(`Got chat history with ${chatHistory?.length || 0} messages`);
        
        // Get current LLM settings
        const llmSettings = getCurrentLLMSettings();
        debugLog("Current LLM settings:", llmSettings);
        
        // Get Plot Style and Intensity from settings
        const plotStyle = $('#mr_plot_style').val() || 'natural';
        const plotIntensity = $('#mr_plot_intensity').val() || 'moderate';
        debugLog("Plot Style:", plotStyle, "Plot Intensity:", plotIntensity);
        
        // Combine all options for plot generation
        const plotOptions = {
            ...llmSettings,
            style: plotStyle,
            intensity: plotIntensity
        };
        debugLog("Combined plot options:", plotOptions);
        
        debugLog("Calling plotEngine.generatePlotContext...");
        // Generate plot context with character, settings, and LLM settings
        const plotContext = await plotEngine.generatePlotContext(character, chatHistory, plotOptions);
        debugLog("Received plot context:", plotContext);
        
        debugLog("Displaying plot in preview...");
        // Display in plot preview
        plotPreview.displayCurrentPlot(plotContext, 'ready');
        
        // Update plot count
        extension_settings[extensionName].plotCount = (extension_settings[extensionName].plotCount || 0) + 1;
        saveSettingsDebounced();
        updateStatusDisplay();
        
        // Save to injection history for cross-device sync
        addInjectionToHistory(plotContext, {
            character: character?.name || 'Unknown Character',
            style: plotStyle,
            intensity: plotIntensity
        });
        
        // Save to plot preview history for cross-device sync
        addPlotPreviewToHistory(plotContext, 'ready');
        
        // @ts-ignore - toastr is a global library
        toastr.info("Plot generated and ready for preview", "Machinor Roundtable");
        debugLog("Plot generated and displayed in preview successfully");
        
    } catch (error) {
        console.error(`[${extensionName}] Failed to generate plot:`, error);
        console.error(`[${extensionName}] Error details:`, error.message, error.stack);
        
        // CRITICAL FIX: Reset status to ready on any error
        if (plotPreview && typeof plotPreview.updateStatus === 'function') {
            plotPreview.updateStatus('ready');
            debugLog("✅ Reset status to ready after error");
        }
        
        // @ts-ignore - toastr is a global library
        toastr.error("Failed to generate plot: " + error.message, "Machinor Roundtable");
    }
}