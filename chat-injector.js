import { getContext } from "../../../extensions.js";
import { event_types, eventSource } from "../../../../script.js";
import { logger } from "./logger.js";
import { createErrorHandler } from './security-utils.js';

/**
 * ChatInjector - Handles injection of plot context into SillyTavern prompts
 */
export class ChatInjector {
    /**
     * @param {PlotEngine} plotEngine
     * @param {PlotPreviewManager} plotPreview
     * @param {STIntegrationManager} stIntegration
     */
    constructor(plotEngine, plotPreview, stIntegration) {
        /** @type {PlotEngine} */
        this.plotEngine = plotEngine;
        /** @type {PlotPreviewManager} */
        this.plotPreview = plotPreview;
        /** @type {STIntegrationManager} */
        this.stIntegration = stIntegration;
        /** @type {boolean} */
        this.isInitialized = false;
        /** @type {boolean} */
        this.isGeneratingPlot = false;
        /** @type {boolean} */
        this.isDestroyed = false;
        
        /** @type {Function|null} */
        this.eventListenerRef = null;

        logger.log('ChatInjector created');
    }

    /**
     * Initialize the injector
     * Only called when chat is fully ready
     * @returns {void}
     */
    initialize() {
        if (this.isDestroyed) return;

        if (this.isInitialized) {
            logger.log('ChatInjector already initialized');
            return;
        }

        logger.log('ChatInjector initializing...');

        // Bind to the prompt generation event
        // GENERATE_AFTER_DATA fires after the prompt is constructed for all APIs (including OpenAI)
        if (typeof event_types !== 'undefined' && event_types.GENERATE_AFTER_DATA) {
            logger.log('Registering GENERATE_AFTER_DATA listener');
            
            // Store bound function reference for cleanup
            // Store bound function reference for proper cleanup in destroy()
            this.eventListenerRef = (data, dryRun) => this.handleGenerationEvent(data, dryRun);
            
            eventSource.on(event_types.GENERATE_AFTER_DATA, this.eventListenerRef);
            logger.log('ChatInjector initialized and listening for generation events');
            this.isInitialized = true;
        } else {
            // Optional chaining for safety
            logger.error('GENERATE_AFTER_DATA event type not found', {
                event_types_defined: typeof event_types !== 'undefined',
                event_name: event_types?.GENERATE_AFTER_DATA
            });
        }
    }

    /**
     * Destroy/cleanup method
     * @returns {void}
     */
    destroy() {
        if (this.isDestroyed) return;
        this.isDestroyed = true;

        logger.log('[Machinor Roundtable] Destroying ChatInjector...');

        // Cleanup event listener
        // Optional chaining
        if (this.eventListenerRef && typeof eventSource !== 'undefined' && event_types?.GENERATE_AFTER_DATA) {
            eventSource.off(event_types.GENERATE_AFTER_DATA, this.eventListenerRef);
            this.eventListenerRef = null;
        }

        this.isInitialized = false;
        this.isGeneratingPlot = false;
        
        logger.log('[Machinor Roundtable] ChatInjector destroyed');
    }

    /**
     * Handle the generation event
     * @param {Object} data - The generation data object
     * @param {boolean} dryRun - Whether this is a dry run (test)
     * @returns {Promise<void>}
     */
    async handleGenerationEvent(data, dryRun) {
        if (this.isDestroyed) return;

        const errorHandler = createErrorHandler('handleGenerationEvent');
        
        // 0. RECURSION GUARD
        // RECURSION GUARD: Prevent infinite loop if our plot generation triggers another GENERATE_AFTER_DATA event. This flag is set before calling plotEngine.generatePlotContext() and cleared in finally block.
        if (this.isGeneratingPlot) {
            // Do not log here to avoid spamming the console during the loop (if it were to happen)
            return;
        }

        logger.log('handleGenerationEvent triggered', {
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
            logger.log('Extension disabled in settings, skipping injection');
            return;
        }

        // Basic validation
        if (!this.stIntegration.isChatReady) {
            logger.log('Chat not ready, skipping injection');
            return;
        }

        // Skip dry runs (e.g. initial load, test messages)
        if (dryRun) {
            logger.log('Skipping injection due to dry run');
            return;
        }

        // Verify this is a real user generation
        // Strict equality not needed here as we check truthiness
        const isRealUserGeneration = (
            data &&
            (data.prompt || data.input)
        );

        if (!isRealUserGeneration) {
            logger.log('Not a real user generation (no prompt/input), skipping injection', data);
            return;
        }

        logger.log('🎯 Processing generation event');

        try {
            // Update preview status
            if (this.plotPreview) {
                this.plotPreview.updateStatus('pending');
            }

            // Get active character
            const characters = this.stIntegration.getActiveCharacters();
            if (!characters || characters.length === 0) {
                logger.log('No active characters found');
                return;
            }
            const character = characters[0]; // Use primary character

            // Get chat history
            const chatHistory = this.getRecentChatHistory();

            // Get settings
            // Optional chaining
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
            let isNewGeneration = true;

            // Prevent recursion - if our system prompt is already in the prompt, don't trigger another generation
            // RECURSION PREVENTION: Check if our system prompt signature ('Narrative Architect') is already in the prompt. If found, skip generation to avoid duplicate injections.
            let hasSystemPrompt = false;
            if (Array.isArray(data.prompt)) {
                hasSystemPrompt = data.prompt.some(msg => msg.content && msg.content.includes('Narrative Architect'));
            } else if (typeof data.prompt === 'string') {
                hasSystemPrompt = data.prompt.includes('Narrative Architect');
            }

            if (hasSystemPrompt) {
                logger.log('Skipping generation - system prompt detected');
                return;
            }

            // Check if we should generate a new plot
            const shouldGenerate = await this.shouldGenerateForTurn(data);

            logger.log('Generation check:', { shouldRefresh: shouldGenerate });

            // CRITICAL FIX: Check preview FIRST, before any generation decision
            let previewPlot = null;
            if (this.plotPreview && typeof this.plotPreview.getCurrentPlot === 'function') {
                previewPlot = this.plotPreview.getCurrentPlot();
                logger.log('🔍 Preview check:', {
                    hasPreview: !!previewPlot,
                    hasText: !!previewPlot?.text,
                    status: previewPlot?.status,
                    textPreview: previewPlot?.text?.substring(0, 50) + '...'
                });
            } else {
                logger.log('⚠️ Preview not available or getCurrentPlot not defined');
            }

            if (previewPlot && previewPlot.text) {
                // Preview has a plot - decide whether to use it or generate new
                // Strict equality
                const isReadyOrRestored = previewPlot.status === 'ready' || previewPlot.status === 'restored';

                if (isReadyOrRestored) {
                    // Manual override or restored from storage - always use
                    // MANUAL OVERRIDE: If preview has 'ready' or 'restored' status, always use it regardless of frequency. This allows user-approved plots to take precedence.
                    logger.log('♻️ Using pending previewed plot (Manual/Restored)');
                    plotContext = previewPlot.text;
                    isNewGeneration = false;
                } else if (shouldGenerate) {
                    // Frequency trigger - generate new even if we have old plot
                    logger.log('🔄 Frequency trigger hit, ignoring old plot');
                    // plotContext remains null, forcing generation below
                } else {
                    // No trigger, just reuse existing plot
                    logger.log('♻️ Reusing previous plot (Frequency skip)');
                    plotContext = previewPlot.text;
                    isNewGeneration = false;
                }
            } else {
                // No plot in preview - check if we should generate
                if (shouldGenerate || !previewPlot) {
                    logger.log('📝 No preview plot available, will generate');
                    // plotContext remains null, forcing generation below
                } else {
                    logger.log('⚠️ Preview exists but no text, skipping injection');
                    // Don't generate, don't inject
                    return;
                }
            }

            // If no suitable existing plot, generate a new one
            if (!plotContext) {
                logger.log('🎲 Generating new plot (Triggered or Fallback)');

                // SET FLAG TO PREVENT RECURSION
                this.isGeneratingPlot = true;
                try {
                    plotContext = await this.plotEngine.generatePlotContext(character, chatHistory, plotOptions);

                    // Handle object return from PlotEngine
                    if (plotContext && typeof plotContext === 'object') {
                        plotContext = plotContext.text;
                    }
                } catch (err) {
                    // Handle generation error separately
                    logger.error('Plot generation failed inside handler:', err);
                    if (this.plotPreview) {
                        this.plotPreview.updateStatus('ready');
                    }
                    return;
                } finally {
                    // ALWAYS CLEAR FLAG
                    this.isGeneratingPlot = false;
                }
            }

            if (!plotContext) {
                logger.log('No plot context generated, skipping injection');
                this.isGeneratingPlot = false;
                return;
            }
            
            if (plotContext) {
                logger.log('Plot context ready:', plotContext);
                
                try {
                    // Gather insights from DOM if not passed (for reused plots)
                    const insights = {};
                    if (this.plotPreview && this.plotPreview.elements) {
                        const toneEl = document.getElementById('mr_tone_analysis');
                        const pacingEl = document.getElementById('mr_pacing_guidance');
                        
                        if (toneEl && toneEl.textContent && toneEl.textContent !== 'Neutral') {
                            insights.tone = toneEl.textContent;
                        }
                        if (pacingEl && pacingEl.textContent && pacingEl.textContent !== 'Standard') {
                            insights.pacing = pacingEl.textContent;
                        }
                    }

                    // Inject into the prompt
                    this.injectPlotContext(data, plotContext, insights);

                    // Update preview
                    if (this.plotPreview) {
                        if (isNewGeneration) {
                            this.plotPreview.displayCurrentPlot(plotContext, 'injected');
                        } else {
                            // Just ensure status is updated if we reused it
                            this.plotPreview.updateStatus('injected');
                        }
                    }

                    // Save to history via PlotPreviewManager (syncs to settings)
                    if (this.plotPreview && typeof this.plotPreview.addToHistory === 'function') {
                        // Only add if this is a new generation (avoid duplicates)
                        if (isNewGeneration) {
                            this.plotPreview.addToHistory(plotContext);
                        }
                    }

                    // Update counters and save settings
                    if (settings) {
                        if (isNewGeneration) {
                            // Reset counter on generation
                            // COUNTER UPDATE: Reset to 0 on new generation, increment on reuse. This tracks turns since last generation for frequency control.
                            settings.turnsSinceLastGeneration = 0;
                            settings.plotCount = (settings.plotCount || 0) + 1;
                            logger.log('Generation complete, counter reset to 0');
                        } else {
                            // Increment counter if we didn't generate
                            // Note: We increment even if we injected an existing plot
                            const current = settings.turnsSinceLastGeneration || 0;
                            settings.turnsSinceLastGeneration = current + 1;
                            logger.log(`Turn complete, counter incremented to ${settings.turnsSinceLastGeneration}`);
                        }

                        if (window.machinorRoundtable && window.machinorRoundtable.saveSettings) {
                            window.machinorRoundtable.saveSettings();
                        }
                    }
                } catch (injectError) {
                    logger.error('Error during injection/update phase:', injectError);
                    // Don't throw, just log, as we might have partially succeeded
                }
            } else {
                logger.warn('Failed to get plot context');
            }

        } catch (error) {
            errorHandler(error, 'Injection process failed');
            if (this.plotPreview) {
                this.plotPreview.updateStatus('ready');
            }
        }
    }

    /**
     * Check if the extension is enabled in settings
     * @returns {boolean}
     */
    isExtensionEnabled() {
        // Try global settings first
        // Optional chaining
        let settings = window.extension_settings?.['machinor-roundtable'];

        // Fallback to checking if we can access settings via a global instance if it exists
        if (!settings && window.machinorRoundtable) {
            settings = window.machinorRoundtable.settings;
        }

        if (!settings) {
            logger.log('Settings not found in extension_settings or global instance');
            return false;
        }

        // Default to true if enabled is undefined, or check explicit false
        // Strict equality
        return settings.enabled !== false;
    }

    /**
     * Determine if we should GENERATE a new plot based on turn frequency
     * Uses dedicated counter for reliability
     * @returns {boolean}
     */
    shouldGenerateForTurn() {
        try {
            // Optional chaining
            let settings = window.extension_settings?.['machinor-roundtable'];

            // Fallback to global instance if needed
            if (!settings && window.machinorRoundtable) {
                // No warning needed - this is standard behavior now
                settings = window.machinorRoundtable.settings;
            }

            if (!settings) {
                logger.warn('Settings completely missing in shouldGenerateForTurn, defaulting to FALSE');
                return false; // Safer default to prevent unwanted overwrites
            }

            // Nullish coalescing
            const frequency = settings.frequency ?? 3;
            
            // Validation
            if (typeof frequency !== 'number' || frequency < 1) {
                logger.warn('Invalid frequency setting:', frequency);
                return false;
            }

            if (frequency <= 1) return true; // Every turn

            // Use dedicated counter instead of chat length
            // FREQUENCY LOGIC: Use dedicated turnsSinceLastGeneration counter instead of chat length. Counter increments on each generation event when not generating, resets to 0 when new plot is generated. This ensures reliable frequency control independent of chat history changes.
            const currentTurns = settings.turnsSinceLastGeneration ?? 0;

            logger.log(`Frequency check: ${currentTurns}/${frequency} turns (Settings found: ${!!settings})`);

            // Generate if we've reached or exceeded the frequency target
            return currentTurns >= frequency;
        } catch (error) {
            logger.error('Error in shouldGenerateForTurn:', error);
            return false;
        }
    }

    /**
     * Inject the plot context into the generation data
     * @param {Object} data - The generation data object
     * @param {string} plotContext - The context string to inject
     * @param {Object} [insights={}] - Optional insights (tone, pacing)
     * @returns {void}
     */
    injectPlotContext(data, plotContext, insights = {}) {
        try {
            if (!data || typeof data !== 'object') {
                logger.error('Invalid data object for injection');
                return;
            }
            
            if (!plotContext || typeof plotContext !== 'string' || plotContext.trim().length === 0) {
                logger.warn('Empty plot context, skipping injection');
                return;
            }

            let injectionText = `\n[Plot Guidance: ${plotContext}`;
            
            // Merge Tone and Pacing if available
            if (insights.tone) {
                injectionText += ` | Tone: ${insights.tone}`;
            }
            if (insights.pacing) {
                injectionText += ` | Pacing: ${insights.pacing}`;
            }
            
            injectionText += `]\n`;

            logger.log('Attempting injection with text length:', injectionText.length);

            // MULTI-API INJECTION: Handle different prompt formats: OpenAI (array of message objects), Text Completion (string), NovelAI (input field). Each API requires different injection approach.
            // Handle OpenAI / Chat Completion (prompt is array of messages)
            if (Array.isArray(data.prompt)) {
                // Add as a system message at the end
                data.prompt.push({
                    role: 'system',
                    content: injectionText.trim()
                });
                logger.log('Injected into messages array (OpenAI/Chat). New length:', data.prompt.length);
            }
            // Handle Text Completion (prompt is string)
            else if (typeof data.prompt === 'string') {
                const originalLength = data.prompt.length;
                data.prompt += injectionText;
                logger.log(`Injected into prompt string (Text Completion). Length: ${originalLength} -> ${data.prompt.length}`);
            }
            // Handle NovelAI (uses 'input' instead of 'prompt' sometimes?)
            else if (typeof data.input === 'string') {
                const originalLength = data.input.length;
                data.input += injectionText;
                logger.log(`Injected into input string (NovelAI). Length: ${originalLength} -> ${data.input.length}`);
            }
            else {
                logger.warn('Could not find suitable injection point in data', Object.keys(data));
            }
        } catch (error) {
            logger.error('Error injecting plot context:', error);
        }
    }

    /**
     * Get recent chat history for context
     * @returns {Array<{name: string, is_user: boolean, message: string}>}
     */
    getRecentChatHistory() {
        try {
            const context = getContext();
            if (!context || !context.chat) return [];

            // Optional chaining
            const limit = window.extension_settings?.['machinor-roundtable']?.historyLimit ?? 5;
            
            // Validate limit
            const safeLimit = Math.max(1, Math.min(limit, 100));

            // Get last N messages
            // Filter out system messages or hidden messages if needed
            return context.chat.slice(-safeLimit).map(msg => ({
                name: msg.name,
                is_user: msg.is_user,
                message: msg.message
            }));
        } catch (error) {
            logger.error('Error getting chat history:', error);
            return [];
        }
    }
}