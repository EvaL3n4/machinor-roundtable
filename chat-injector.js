/**
 * Machinor Roundtable - Simple Plot Context Injection System
 * 
 * ARCHITECTURE: Only injects plot context when user generates a prompt.
 * No frequency logic, no manual injection, no complex loading checks.
 * Simply: Listen → Generate → Inject → Done
 */

import { getContext } from "../../../extensions.js";
// @ts-ignore
import { eventSource, event_types, saveChatConditional } from "../../../../script.js";

// @ts-ignore - toastr is a global library
const toastr = window.toastr;

// Debug logging helper
function debugLog(message, data = null) {
    console.log(`[machinor-roundtable] ${message}`, data || '');
}

export class ChatInjector {
    constructor(plotEngine, plotPreview = null) {
        this.plotEngine = plotEngine;
        this.plotPreview = plotPreview;
        this.isProcessing = false;
        this.turnCounter = 0;
        this.lastGenerationTurn = 0;
    }

    /**
     * Initialize the injection system
     * Simple setup - just listens for generation events
     */
    initialize() {
        console.log('[machinor-roundtable] 🔧 Initializing simple plot injection system');
        
        // Check if eventSource and event_types are available
        if (!eventSource || !event_types) {
            console.error('[machinor-roundtable] ❌ eventSource or event_types not available');
            return;
        }
        
        // Listen for the generation event - this is when user is sending a prompt
        eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, this.handleGenerationEvent.bind(this));
        
        console.log('[machinor-roundtable] ✅ Simple injection system initialized - will inject on every generation');
        console.log('[machinor-roundtable] Event listener bound to:', event_types.GENERATE_BEFORE_COMBINE_PROMPTS);
    }

    /**
     * Handle generation event - implements frequency-based plot generation
     */
    async handleGenerationEvent(data) {
        const context = getContext();
        const settings = window.extension_settings?.['machinor-roundtable'];
        
        console.log('[machinor-roundtable] 🎯 Generation event received - checking if injection should occur');
        
        const isRealUserGeneration = (
            data &&
            (data.prompt || data.messages || data.text) &&
            (data.prompt?.trim()?.length > 0 || data.messages?.length > 0 || data.text?.trim()?.length > 0)
        );
        
        if (!isRealUserGeneration) {
            console.log('[machinor-roundtable] 🔍 Not a real user generation (likely chat loading), skipping injection');
            return;
        }
        
        console.log('[machinor-roundtable] ✅ Confirmed real user generation - proceeding with injection');
        console.log('[machinor-roundtable] Settings check:', settings);
        
        if (!settings?.enabled) {
            console.log('[machinor-roundtable] Extension disabled, skipping injection');
            return;
        }

        if (this.isProcessing) {
            console.log('[machinor-roundtable] Already processing, skipping to avoid duplicates');
            return;
        }

        // NEW: Frequency-based generation logic
        this.turnCounter++;
        const frequency = settings.frequency || 3; // Default to every 3 turns
        const shouldGenerateNew = (this.turnCounter - this.lastGenerationTurn) >= frequency;
        
        if (!shouldGenerateNew) {
            console.log(`[machinor-roundtable] ⏭️ Skipping generation - only every ${frequency} turns (currently turn ${this.turnCounter})`);
            return;
        }
        
        console.log(`[machinor-roundtable] 🎯 Generating new plot on turn ${this.turnCounter} (frequency: ${frequency})`);

        try {
            this.isProcessing = true;
            console.log('[machinor-roundtable] Starting plot context injection...');

            const character = this.getCurrentCharacter();
            if (!character) {
                console.log('[machinor-roundtable] No character selected, skipping injection');
                return;
            }

            const chatHistory = this.getRecentChatHistory();
            console.log('[machinor-roundtable] Chat history length:', chatHistory.length);
            
            console.log('[machinor-roundtable] Generating plot context...');
            let plotContext;
            try {
                plotContext = await this.plotEngine.generatePlotContext(character, chatHistory);
            } catch (error) {
                console.error('[machinor-roundtable] Failed to generate plot context:', error);
                return;
            }
            
            if (!plotContext || plotContext.trim() === '') {
                console.error('[machinor-roundtable] Generated plot context is empty');
                return;
            }

            console.log('[machinor-roundtable] Plot context generated, length:', plotContext.length);
            
            // Update turn counter for last generation
            this.lastGenerationTurn = this.turnCounter;
            
            const injectionSuccess = this.injectPlotContext(data, plotContext, settings.debugMode);
            
            if (injectionSuccess) {
                console.log('[machinor-roundtable] ✅ Plot context successfully injected');
                
                if (this.plotPreview && typeof this.plotPreview.displayCurrentPlot === 'function') {
                    this.plotPreview.displayCurrentPlot(plotContext, 'injected');
                    console.log('[machinor-roundtable] ✅ Plot preview updated');
                }
                
                if (typeof window.addInjectionToHistory === 'function') {
                    window.addInjectionToHistory(plotContext, {
                        character: character?.name || 'Unknown Character',
                        style: settings.plotStyle || 'natural',
                        intensity: settings.plotIntensity || 'moderate'
                    });
                    console.log('[machinor-roundtable] ✅ Injection saved to history');
                }
            } else {
                console.error('[machinor-roundtable] ❌ Plot context injection failed');
            }
            
        } catch (error) {
            console.error('[machinor-roundtable] Failed to inject plot context:', error);
            
            if (typeof toastr !== 'undefined') {
                toastr.error(`Plot injection failed: ${error.message}`, 'Machinor Roundtable');
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Get the current character data
     * FIX: Use consistent character detection method like index.js
     */
    getCurrentCharacter() {
        try {
            const context = getContext();
            if (!context) {
                console.log('[machinor-roundtable] getCurrentCharacter: No context available');
                return null;
            }

            console.log('[machinor-roundtable] getCurrentCharacter: Context check', {
                hasCharacterId: context.characterId !== undefined,
                hasCharacters: !!context.characters,
                groupId: context.groupId
            });
            
            // Check if we have a characterId and characters array
            if (context.characterId === undefined || !context.characters) {
                console.log('[machinor-roundtable] getCurrentCharacter: No characterId or characters array');
                return null;
            }
            
            // Find the current character by ID (same method as index.js)
            const character = context.characters[context.characterId];
            
            console.log('[machinor-roundtable] getCurrentCharacter:', character ? character.name : "No character found");
            
            return character || null;
        } catch (error) {
            console.error('[machinor-roundtable] Error getting current character:', error);
            return null;
        }
    }

    /**
     * Get recent chat history for context
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
     * Inject plot context into the generation data
     * Enhanced to handle multiple SillyTavern data structures
     */
    injectPlotContext(data, plotContext, debugMode) {
        console.log('[machinor-roundtable] Starting plot context injection...');
        console.log('[machinor-roundtable] Data structure before injection:', {
            hasPrompt: !!data.prompt,
            hasMessages: !!data.messages,
            hasChat: !!data.chat,
            promptLength: data.prompt ? data.prompt.length : 0,
            messagesLength: data.messages ? data.messages.length : 0,
            keys: Object.keys(data || {})
        });

        // Method 1: Try to inject into prompt field (SillyTavern's preferred method)
        if (data.prompt && typeof data.prompt === 'string') {
            const originalPrompt = data.prompt;
            data.prompt = `${plotContext}\n\n${data.prompt}`;
            
            console.log(`[machinor-roundtable] ✅ Successfully injected into prompt field`);
            console.log(`[machinor-roundtable] Original prompt length: ${originalPrompt.length}`);
            console.log(`[machinor-roundtable] New prompt length: ${data.prompt.length}`);
            console.log(`[machinor-roundtable] Plot context added at the beginning`);
            
            if (debugMode) {
                this.showDebugNotification(`Injected ${plotContext.length} chars into prompt`);
            }
            
            return true;
        }

        // Method 2: Fallback for message-based APIs
        if (data.messages && Array.isArray(data.messages)) {
            const systemMessage = {
                role: "system",
                content: plotContext
            };
            data.messages.unshift(systemMessage);
            
            console.log(`[machinor-roundtable] ✅ Successfully injected as system message`);
            console.log(`[machinor-roundtable] Messages array length: ${data.messages.length}`);
            
            if (debugMode) {
                this.showDebugNotification(`Added system message with ${plotContext.length} chars`);
            }
            
            return true;
        }

        // Method 3: Handle chat-based structures
        if (data.chat && typeof data.chat === 'object') {
            // SillyTavern might use different data structures
            if (data.chat.prompt) {
                const originalPrompt = data.chat.prompt;
                data.chat.prompt = `${plotContext}\n\n${data.chat.prompt}`;
                
                console.log(`[machinor-roundtable] ✅ Successfully injected into chat.prompt`);
                return true;
            }
        }

        // Method 4: Last resort - try to modify data directly
        if (typeof data === 'object' && data !== null) {
            console.log('[machinor-roundtable] 🔄 Attempting direct data modification...');
            
            // Try common prompt fields
            const promptFields = ['prompt', 'text', 'content', 'message'];
            for (const field of promptFields) {
                if (data[field] && typeof data[field] === 'string') {
                    const originalValue = data[field];
                    data[field] = `${plotContext}\n\n${data[field]}`;
                    console.log(`[machinor-roundtable] ✅ Successfully injected into data.${field}`);
                    return true;
                }
            }
        }

        console.error('[machinor-roundtable] ❌ Unable to inject plot context - no suitable data structure found');
        console.error('[machinor-roundtable] Available data structure:', JSON.stringify(data, null, 2));
        
        if (debugMode) {
            this.showDebugNotification('Injection failed - no suitable data structure');
        }
        
        return false; // Indicate failure
    }

    /**
     * Show debug notification when in debug mode
     */
    showDebugNotification(plotContext) {
        // @ts-ignore
        toastr.info(
            `Plot context injected: "${plotContext.substring(0, 50)}..."`,
            "Machinor Roundtable - Debug",
            { timeOut: 3000 }
        );
    }

    /**
     * Set the plot preview manager
     * @param {Object} plotPreview - The plot preview manager instance
     */
    setPlotPreview(plotPreview) {
        this.plotPreview = plotPreview;
        console.log(`[machinor-roundtable] Plot preview manager set`);
    }

    /**
     * Reset injection tracking (simplified)
     */
    reset() {
        this.isProcessing = false;
        console.log(`[machinor-roundtable] Simple injection reset`);
    }

    /**
     * Get current status for debugging
     */
    getStatus() {
        return {
            isProcessing: this.isProcessing,
            cacheSize: this.plotEngine.getCacheSize()
        };
    }
}