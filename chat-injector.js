// Machinor Roundtable - Chat Injection System
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
        this.injectionCounter = 0;
        this.lastInjectionTurn = 0;
        this.isProcessing = false;
    }

    /**
     * Initialize the injection system
     */
    initialize() {
        // Listen for chat generation events
        eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, this.handlePreGeneration.bind(this));
        
        // Listen for message sent events to track conversation turns
        eventSource.on(event_types.MESSAGE_SENT, this.handleMessageSent.bind(this));
        
        // ST Integration Events
        this.setupSTIntegrationEvents();
        
        console.log(`[machinor-roundtable] Chat injector initialized with ST integration`);
    }

    /**
     * Setup ST integration event listeners
     */
    setupSTIntegrationEvents() {
        // Listen for character changes
        eventSource.on('character_selected', (data) => {
            console.log(`[machinor-roundtable] Character changed, resetting injection tracking`);
            this.reset();
            
            // Refresh plot engine with new character context if available
            if (this.plotEngine?.stIntegration) {
                this.plotEngine.stIntegration.analyzeActiveCharacters();
            }
        });

        // Listen for chat changes
        eventSource.on('chat_changed', (data) => {
            console.log(`[machinor-roundtable] Chat changed, clearing plot cache`);
            this.reset();
            
            // Clear plot cache and refresh context
            if (this.plotEngine?.clearCache) {
                this.plotEngine.clearCache();
            }
        });

        // Listen for group changes (important for multi-character scenarios)
        eventSource.on('group_changed', (data) => {
            console.log(`[machinor-roundtable] Group changed, updating multi-character context`);
            this.reset();
        });

        // Listen for world changes (if using world info)
        if (typeof eventSource.on === 'function' && eventSource.listenerCount) {
            eventSource.on('world_changed', (data) => {
                console.log(`[machinor-roundtable] World changed, refreshing integration data`);
                if (this.plotEngine?.stIntegration) {
                    this.plotEngine.stIntegration.loadWorldInfo();
                }
            });
        }

        console.log(`[machinor-roundtable] ST integration events setup complete`);
    }

    /**
     * Handle pre-generation event to inject plot context
     */
    async handlePreGeneration(data) {
        const context = getContext();
        const settings = context.extension_settings?.machinor_roundtable;
        
        console.log('[machinor-roundtable] handlePreGeneration called, enabled:', settings?.enabled);
        
        if (!settings?.enabled) {
            console.log('[machinor-roundtable] Extension disabled, skipping injection');
            return; // Extension is disabled
        }

        if (this.isProcessing) {
            console.log(`[machinor-roundtable] Already processing, skipping injection`);
            return;
        }

        try {
            this.isProcessing = true;
            console.log('[machinor-roundtable] Starting injection process...');
            
            // Check if we should inject based on frequency
            if (!this.shouldInject(settings.injectionFrequency)) {
                console.log(`[machinor-roundtable] Skipping injection - frequency not met`);
                this.isProcessing = false;
                return;
            }

            // Get character data
            const character = this.getCurrentCharacter();
            if (!character) {
                console.log(`[machinor-roundtable] No character selected, skipping injection`);
                this.isProcessing = false;
                return;
            }

            // Get recent chat history
            const chatHistory = this.getRecentChatHistory();
            console.log('[machinor-roundtable] Chat history length:', chatHistory.length);
            
            // Generate plot context
            console.log(`[machinor-roundtable] Generating plot context for injection...`);
            const plotContext = await this.plotEngine.generatePlotContext(character, chatHistory);
            
            if (!plotContext || plotContext.trim() === '') {
                console.error(`[machinor-roundtable] Generated plot context is empty`);
                this.isProcessing = false;
                return;
            }

            console.log('[machinor-roundtable] Plot context generated:', plotContext);
            
            // Inject the plot context
            this.injectPlotContext(data, plotContext, settings.debugMode);
            
            // Update injection tracking
            this.lastInjectionTurn = this.injectionCounter;
            
            // Update plot preview status if available
            if (this.plotPreview) {
                this.plotPreview.displayCurrentPlot(plotContext, 'injected');
            }
            
            console.log(`[machinor-roundtable] Plot context injected successfully`);
            
        } catch (error) {
            console.error(`[machinor-roundtable] Failed to inject plot context:`, error);
            
            // Show error notification
            if (typeof toastr !== 'undefined') {
                // @ts-ignore - toastr is a global library
                toastr.error(`Plot injection failed: ${error.message}`, 'Machinor Roundtable');
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Handle message sent events to track conversation turns
     */
    handleMessageSent(data) {
        if (data.is_user) {
            this.injectionCounter++;
            console.log(`[machinor-roundtable] User message sent - turn count: ${this.injectionCounter}`);
        }
    }

    /**
     * Check if we should inject based on frequency settings
     */
    shouldInject(frequency) {
        const exchangesSinceLastInjection = this.injectionCounter - this.lastInjectionTurn;
        return exchangesSinceLastInjection >= frequency;
    }

    /**
     * Get the current character data (enhanced for multi-character support)
     */
    getCurrentCharacter() {
        const context = getContext();
        
        // Check if we're in a group chat
        if (context.groupId) {
            // For group chats, try to focus on the most active character or first character
            const group = context.groups?.find(g => g.id === context.groupId);
            if (group && group.members.length > 0) {
                // For now, focus on the first character - can be enhanced later
                const mainCharId = group.members[0];
                const character = context.characters?.find(c => c.avatar === mainCharId);
                
                if (character && extension_settings[extensionName]?.debugMode) {
                    debugLog(`Group chat detected, focusing on character: ${character.name}`);
                }
                
                return character;
            }
        }
        
        // Regular character chat
        const singleChar = context.character;
        if (singleChar && extension_settings[extensionName]?.debugMode) {
            debugLog(`Single character chat: ${singleChar.name}`);
        }
        
        return singleChar;
    }

    /**
     * Get all active characters in current context (for multi-character scenarios)
     */
    getActiveCharacters() {
        const context = getContext();
        
        if (!context) return [];
        
        const characters = [];
        
        // Check if we're in a group chat
        if (context.groupId && context.groups && context.characters) {
            const group = context.groups.find(g => g.id === context.groupId);
            if (group && group.members) {
                group.members.forEach(memberId => {
                    const character = context.characters.find(c => c.avatar === memberId);
                    if (character) {
                        characters.push({
                            ...character,
                            isGroupMember: true,
                            groupPosition: group.members.indexOf(memberId)
                        });
                    }
                });
            }
        } else {
            // Single character scenario
            if (context.character) {
                characters.push({
                    ...context.character,
                    isGroupMember: false
                });
            }
        }
        
        if (extension_settings[extensionName]?.debugMode) {
            debugLog(`Active characters: ${characters.length}`, characters.map(c => c.name));
        }
        
        return characters;
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
     */
    injectPlotContext(data, plotContext, debugMode) {
        // Create a system message with the plot context
        const systemMessage = {
            role: "system",
            content: plotContext
        };

        // Add to the prompt if it exists
        if (data.prompt) {
            // Insert the plot context before the main prompt
            data.prompt = `${plotContext}\n\n${data.prompt}`;
        } else if (data.messages && Array.isArray(data.messages)) {
            // For message-based APIs, insert as a system message
            data.messages.unshift(systemMessage);
        }

        // Log injection for debugging
        console.log(`[machinor-roundtable] Injected plot context:`, plotContext);
        
        if (debugMode) {
            this.showDebugNotification(plotContext);
        }
        
        // Update plot preview if available
        if (this.plotPreview) {
            this.plotPreview.displayCurrentPlot(plotContext, 'injected');
        }
    }

    /**
     * Show debug notification when in debug mode
     */
    showDebugNotification(plotContext) {
        // @ts-ignore
        toastr.info(
            `Plot context injected: "${plotContext}"`,
            "Machinor Roundtable - Debug",
            { timeOut: 5000 }
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
     * Reset injection tracking
     */
    reset() {
        this.injectionCounter = 0;
        this.lastInjectionTurn = 0;
        this.manualPlotContext = null;
        this.forceInjectNext = false;
        console.log(`[machinor-roundtable] Injection tracking reset`);
    }

    /**
     * Get current status for debugging
     */
    getStatus() {
        return {
            injectionCounter: this.injectionCounter,
            lastInjectionTurn: this.lastInjectionTurn,
            exchangesSinceLastInjection: this.injectionCounter - this.lastInjectionTurn,
            isProcessing: this.isProcessing,
            cacheSize: this.plotEngine.getCacheSize()
        };
    }
}