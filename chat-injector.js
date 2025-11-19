import { getContext } from "../../../extensions.js";
import { event_types, eventSource } from "../../../../script.js";

/**
 * ChatInjector - Handles injection of plot context into SillyTavern prompts
 */
export class ChatInjector {
    constructor(plotEngine, plotPreview, stIntegration) {
        this.plotEngine = plotEngine;
        this.plotPreview = plotPreview;
        this.stIntegration = stIntegration;
        this.isInitialized = false;

        console.log('[Machinor Roundtable] ChatInjector created');
    }

    /**
     * Initialize the injector
     * Only called when chat is fully ready
     */
    initialize() {
        if (this.isInitialized) return;

        // Bind to the prompt generation event
        // This event fires before prompts are combined, allowing us to inject data
        if (typeof event_types !== 'undefined' && event_types.GENERATE_BEFORE_COMBINE_PROMPTS) {
            eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (data) => this.handleGenerationEvent(data));
            console.log('[Machinor Roundtable] ChatInjector initialized and listening for generation events');
            this.isInitialized = true;
        } else {
            console.error('[Machinor Roundtable] GENERATE_BEFORE_COMBINE_PROMPTS event type not found');
        }
    }

    /**
     * Handle the generation event
     * @param {Object} data - The generation data object
     */
    async handleGenerationEvent(data) {
        // Basic validation
        if (!this.stIntegration.isChatReady) {
            console.log('[Machinor Roundtable] Chat not ready, skipping injection');
            return;
        }

        // Skip dry runs (e.g. initial load, test messages)
        if (data?.dryRun === true) {
            console.log('[Machinor Roundtable] Skipping injection due to dry run');
            return;
        }

        // Verify this is a real user generation
        const isRealUserGeneration = (
            data &&
            (data.prompt || data.messages || data.text) &&
            (data.prompt?.trim()?.length > 0 || data.messages?.length > 0 || data.text?.trim()?.length > 0)
        );

        if (!isRealUserGeneration) {
            console.log('[Machinor Roundtable] Not a real user generation, skipping injection');
            return;
        }

        // Check frequency setting
        if (!this.shouldInjectForTurn()) {
            console.log('[Machinor Roundtable] Skipping injection due to frequency setting');
            return;
        }

        console.log('[Machinor Roundtable] 🎯 Processing generation event');

        try {
            // Update preview status
            if (this.plotPreview) {
                this.plotPreview.updateStatus('pending');
            }

            // Get active character
            const characters = this.stIntegration.getActiveCharacters();
            if (!characters || characters.length === 0) {
                console.log('[Machinor Roundtable] No active characters found');
                return;
            }
            const character = characters[0]; // Use primary character

            // Get chat history
            const chatHistory = this.getRecentChatHistory();

            // Get settings
            const settings = window.extension_settings?.['machinor-roundtable'] || {};
            const plotOptions = {
                style: settings.plotStyle || 'natural',
                intensity: settings.plotIntensity || 'moderate'
            };

            // CRITICAL FIX: Check for existing previewed plot first
            let plotContext = null;
            let isNewGeneration = true;

            if (this.plotPreview && typeof this.plotPreview.getCurrentPlot === 'function') {
                const currentPlot = this.plotPreview.getCurrentPlot();
                // If we have a plot that is ready or restored, use it instead of generating new
                if (currentPlot && currentPlot.text && (currentPlot.status === 'ready' || currentPlot.status === 'restored')) {
                    console.log('[Machinor Roundtable] ♻️ Using existing previewed plot for injection');
                    plotContext = currentPlot.text;
                    isNewGeneration = false;
                }
            }

            // If no suitable existing plot, generate a new one
            if (!plotContext) {
                console.log('[Machinor Roundtable] 🎲 Generating new plot for injection');
                plotContext = await this.plotEngine.generatePlotContext(character, chatHistory, plotOptions);
            }

            if (plotContext) {
                // Inject into the prompt
                this.injectPlotContext(data, plotContext);

                // Update preview
                if (this.plotPreview) {
                    // If we used an existing plot, just update status to injected
                    // If we generated a new one, display it as injected
                    if (isNewGeneration) {
                        this.plotPreview.displayCurrentPlot(plotContext, 'injected');
                    } else {
                        this.plotPreview.updateStatus('injected');
                    }
                }

                // Save to history
                if (window.addInjectionToHistory) {
                    window.addInjectionToHistory(plotContext, {
                        character: character.name,
                        style: plotOptions.style,
                        intensity: plotOptions.intensity
                    });
                }

                // Update plot count
                if (settings) {
                    settings.plotCount = (settings.plotCount || 0) + 1;
                    if (window.machinorRoundtable && window.machinorRoundtable.saveSettings) {
                        window.machinorRoundtable.saveSettings();
                    }
                }
            }

        } catch (error) {
            console.error('[Machinor Roundtable] Injection failed:', error);
            if (this.plotPreview) {
                this.plotPreview.updateStatus('ready');
            }
        }
    }

    /**
     * Determine if we should inject based on turn frequency
     */
    shouldInjectForTurn() {
        const settings = window.extension_settings?.['machinor-roundtable'];
        if (!settings || !settings.enabled) return false;

        const frequency = settings.frequency || 3;
        if (frequency <= 1) return true; // Every turn

        const context = getContext();
        if (!context || !context.chat) return false;

        // Count user messages to determine turn
        // We only count messages that are actually in the chat array
        const messageCount = context.chat.length;

        // Simple modulo check
        // We inject if (messageCount % frequency) === 0
        // This means we inject on the Nth message, 2Nth message, etc.
        return (messageCount % frequency) === 0;
    }

    /**
     * Inject the plot context into the generation data
     */
    injectPlotContext(data, plotContext) {
        const injectionText = `\n[Plot Guidance: ${plotContext}]\n`;

        // Method 1: Inject into system prompt if available
        // This is preferred as it's more authoritative
        if (data.system_prompt) {
            data.system_prompt += injectionText;
            console.log('[Machinor Roundtable] Injected into system prompt');
        }
        // Method 2: Inject into the last user message
        else if (data.prompt) {
            data.prompt += injectionText;
            console.log('[Machinor Roundtable] Injected into prompt string');
        }
        // Method 3: Inject into messages array (for chat completion APIs)
        else if (Array.isArray(data.messages)) {
            // Add as a system message at the end, or append to last user message
            data.messages.push({
                role: 'system',
                content: `[Plot Guidance: ${plotContext}]`
            });
            console.log('[Machinor Roundtable] Injected into messages array');
        } else {
            console.warn('[Machinor Roundtable] Could not find suitable injection point');
        }
    }

    /**
     * Get recent chat history for context
     */
    getRecentChatHistory() {
        const context = getContext();
        if (!context || !context.chat) return [];

        const limit = window.extension_settings?.['machinor-roundtable']?.historyLimit || 5;

        // Get last N messages
        // Filter out system messages or hidden messages if needed
        return context.chat.slice(-limit).map(msg => ({
            name: msg.name,
            is_user: msg.is_user,
            message: msg.message
        }));
    }
}