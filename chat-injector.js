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
        this.isGeneratingPlot = false;

        console.log('[Machinor Roundtable] ChatInjector created');
    }

    /**
     * Initialize the injector
     * Only called when chat is fully ready
     */
    initialize() {
        if (this.isInitialized) {
            console.log('[Machinor Roundtable] ChatInjector already initialized');
            return;
        }

        console.log('[Machinor Roundtable] ChatInjector initializing...');

        // Bind to the prompt generation event
        // GENERATE_AFTER_DATA fires after the prompt is constructed for all APIs (including OpenAI)
        if (typeof event_types !== 'undefined' && event_types.GENERATE_AFTER_DATA) {
            console.log('[Machinor Roundtable] Registering GENERATE_AFTER_DATA listener');
            eventSource.on(event_types.GENERATE_AFTER_DATA, (data, dryRun) => this.handleGenerationEvent(data, dryRun));
            console.log('[Machinor Roundtable] ChatInjector initialized and listening for generation events');
            this.isInitialized = true;
        } else {
            console.error('[Machinor Roundtable] GENERATE_AFTER_DATA event type not found', {
                event_types_defined: typeof event_types !== 'undefined',
                event_name: event_types?.GENERATE_AFTER_DATA
            });
        }
    }

    /**
     * Handle the generation event
     * @param {Object} data - The generation data object
     */
    async handleGenerationEvent(data, dryRun) {
        // 0. RECURSION GUARD
        if (this.isGeneratingPlot) {
            // Do not log here to avoid spamming the console during the loop (if it were to happen)
            return;
        }

        console.log('[Machinor Roundtable] handleGenerationEvent triggered', {
            dryRun: dryRun,
            isChatReady: this.stIntegration.isChatReady,
            hasPrompt: !!data.prompt,
            hasInput: !!data.input,
            keys: Object.keys(data)
        });

        // 1. Check if extension is enabled globally
        if (!this.isExtensionEnabled()) {
            // Only log if we are in a state where we might expect it to work, to avoid spam
            // But for debugging, we log.
            console.log('[Machinor Roundtable] Extension disabled in settings, skipping injection');
            return;
        }

        // Basic validation
        if (!this.stIntegration.isChatReady) {
            console.log('[Machinor Roundtable] Chat not ready, skipping injection');
            return;
        }

        // Skip dry runs (e.g. initial load, test messages)
        if (dryRun) {
            console.log('[Machinor Roundtable] Skipping injection due to dry run');
            return;
        }

        // Verify this is a real user generation
        const isRealUserGeneration = (
            data &&
            (data.prompt || data.input)
        );

        if (!isRealUserGeneration) {
            console.log('[Machinor Roundtable] Not a real user generation (no prompt/input), skipping injection', data);
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

            // Logic:
            // 1. If we have a PENDING plot (ready/restored), use it (Manual Override).
            // 2. Else if we SHOULD generate (Frequency Trigger), generate NEW.
            // 3. Else if we have an EXISTING plot (Injected), reuse it.
            // 4. Else (No plot at all), generate NEW (First Run).

            let plotContext = null;
            let isNewGeneration = false;
            const shouldRefresh = this.shouldGenerateForTurn();

            console.log('[Machinor Roundtable] Generation check:', { shouldRefresh });

            // CRITICAL FIX: Check preview FIRST, before any generation decision
            let previewPlot = null;
            if (this.plotPreview && typeof this.plotPreview.getCurrentPlot === 'function') {
                previewPlot = this.plotPreview.getCurrentPlot();
                console.log('[Machinor Roundtable] 🔍 Preview check:', {
                    hasPreview: !!previewPlot,
                    hasText: !!previewPlot?.text,
                    status: previewPlot?.status,
                    textPreview: previewPlot?.text?.substring(0, 50) + '...'
                });
            } else {
                console.log('[Machinor Roundtable] ⚠️ Preview not available or getCurrentPlot not defined');
            }

            if (previewPlot && previewPlot.text) {
                // Preview has a plot - decide whether to use it or generate new
                const isReadyOrRestored = previewPlot.status === 'ready' || previewPlot.status === 'restored';

                if (isReadyOrRestored) {
                    // Manual override or restored from storage - always use
                    console.log('[Machinor Roundtable] ♻️ Using pending previewed plot (Manual/Restored)');
                    plotContext = previewPlot.text;
                    isNewGeneration = false;
                } else if (shouldRefresh) {
                    // Frequency trigger - generate new even if we have old plot
                    console.log('[Machinor Roundtable] 🔄 Frequency trigger hit, ignoring old plot');
                    // plotContext remains null, forcing generation below
                } else {
                    // No trigger, just reuse existing plot
                    console.log('[Machinor Roundtable] ♻️ Reusing previous plot (Frequency skip)');
                    plotContext = previewPlot.text;
                    isNewGeneration = false;
                }
            } else {
                // No plot in preview - check if we should generate
                if (shouldRefresh || !previewPlot) {
                    console.log('[Machinor Roundtable] 📝 No preview plot available, will generate');
                    // plotContext remains null, forcing generation below
                } else {
                    console.log('[Machinor Roundtable] ⚠️ Preview exists but no text, skipping injection');
                    // Don't generate, don't inject
                    return;
                }
            }

            // If no suitable existing plot, generate a new one
            if (!plotContext) {
                console.log('[Machinor Roundtable] 🎲 Generating new plot (Triggered or Fallback)');

                // SET FLAG TO PREVENT RECURSION
                this.isGeneratingPlot = true;
                try {
                    plotContext = await this.plotEngine.generatePlotContext(character, chatHistory, plotOptions);

                    // Handle object return from PlotEngine
                    if (plotContext && typeof plotContext === 'object') {
                        plotContext = plotContext.text;
                    }
                } finally {
                    // ALWAYS CLEAR FLAG
                    this.isGeneratingPlot = false;
                }
            }

            if (!plotContext) {
                console.log('[machinor-roundtable] No plot context generated, skipping injection');
                this.isGeneratingPlot = false;
                return;
            }
            if (plotContext) {
                console.log('[Machinor Roundtable] Plot context ready:', plotContext);
                // Inject into the prompt
                this.injectPlotContext(data, plotContext);

                // Update preview
                if (this.plotPreview) {
                    if (isNewGeneration) {
                        this.plotPreview.displayCurrentPlot(plotContext, 'injected');
                    } else {
                        // Just ensure status is updated if we reused it
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

                // Update plot count ONLY if we actually generated a new one?
                // Or count every injection? Usually "plot count" implies generation tokens used.
                // Let's count only new generations.
                // Update counters and save settings
                if (settings) {
                    if (isNewGeneration) {
                        // Reset counter on generation
                        settings.turnsSinceLastGeneration = 0;
                        settings.plotCount = (settings.plotCount || 0) + 1;
                        console.log('[Machinor Roundtable] Generation complete, counter reset to 0');
                    } else {
                        // Increment counter if we didn't generate
                        // Note: We increment even if we injected an existing plot
                        settings.turnsSinceLastGeneration = (settings.turnsSinceLastGeneration || 0) + 1;
                        console.log(`[Machinor Roundtable] Turn complete, counter incremented to ${settings.turnsSinceLastGeneration}`);
                    }

                    if (window.machinorRoundtable && window.machinorRoundtable.saveSettings) {
                        window.machinorRoundtable.saveSettings();
                    }
                }
            } else {
                console.warn('[Machinor Roundtable] Failed to get plot context');
            }

        } catch (error) {
            console.error('[Machinor Roundtable] Injection failed:', error);
            if (this.plotPreview) {
                this.plotPreview.updateStatus('ready');
            }
        }
    }

    /**
     * Check if the extension is enabled in settings
     */
    isExtensionEnabled() {
        // Try global settings first
        let settings = window.extension_settings?.['machinor-roundtable'];

        // Fallback to checking if we can access settings via a global instance if it exists
        if (!settings && window.machinorRoundtable) {
            settings = window.machinorRoundtable.settings;
        }

        if (!settings) {
            console.log('[Machinor Roundtable] Settings not found in extension_settings or global instance');
            return false;
        }

        // Default to true if enabled is undefined, or check explicit false
        return settings.enabled !== false;
    }

    /**
     * Determine if we should GENERATE a new plot based on turn frequency
     * Uses dedicated counter for reliability
     */
    shouldGenerateForTurn() {
        let settings = window.extension_settings?.['machinor-roundtable'];

        // Fallback to global instance if needed
        if (!settings && window.machinorRoundtable) {
            console.warn('[Machinor Roundtable] Settings not found in extension_settings, using global instance');
            settings = window.machinorRoundtable.settings;
        }

        if (!settings) {
            console.warn('[Machinor Roundtable] Settings completely missing in shouldGenerateForTurn, defaulting to FALSE');
            return false; // Safer default to prevent unwanted overwrites
        }

        const frequency = settings.frequency || 3;
        if (frequency <= 1) return true; // Every turn

        // Use dedicated counter instead of chat length
        const currentTurns = settings.turnsSinceLastGeneration || 0;

        console.log(`[Machinor Roundtable] Frequency check: ${currentTurns}/${frequency} turns (Settings found: ${!!settings})`);

        // Generate if we've reached or exceeded the frequency target
        return currentTurns >= frequency;
    }

    /**
     * Inject the plot context into the generation data
     */
    injectPlotContext(data, plotContext) {
        const injectionText = `\n[Plot Guidance: ${plotContext}]\n`;
        console.log('[Machinor Roundtable] Attempting injection with text length:', injectionText.length);

        // Handle OpenAI / Chat Completion (prompt is array of messages)
        if (Array.isArray(data.prompt)) {
            // Add as a system message at the end
            // Note: ST usually puts system prompt first, but for immediate guidance, end might be better?
            // Or we can append to the last user message if we want to be subtle.
            // Let's add a new system message at the end to ensure it's seen as recent context.

            data.prompt.push({
                role: 'system',
                content: `[Plot Guidance: ${plotContext}]`
            });
            console.log('[Machinor Roundtable] Injected into messages array (OpenAI/Chat). New length:', data.prompt.length);
        }
        // Handle Text Completion (prompt is string)
        else if (typeof data.prompt === 'string') {
            const originalLength = data.prompt.length;
            data.prompt += injectionText;
            console.log(`[Machinor Roundtable] Injected into prompt string (Text Completion). Length: ${originalLength} -> ${data.prompt.length}`);
        }
        // Handle NovelAI (uses 'input' instead of 'prompt' sometimes?)
        else if (typeof data.input === 'string') {
            const originalLength = data.input.length;
            data.input += injectionText;
            console.log(`[Machinor Roundtable] Injected into input string (NovelAI). Length: ${originalLength} -> ${data.input.length}`);
        }
        else {
            console.warn('[Machinor Roundtable] Could not find suitable injection point in data', Object.keys(data));
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