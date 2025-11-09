// Machinor Roundtable - Plot Generation Engine
import { getContext } from "../../../extensions.js";
import { generateQuietPrompt } from "../../../../script.js";

const PLOT_GENERATION_PROMPT = `You are a plot development assistant for roleplay scenarios. Based on the character information and recent conversation context provided, generate a subtle plot context that will guide the AI model to create more engaging, character-driven responses.

CHARACTER INFORMATION:
Name: {{char}}
Personality: {{personality}}
Description: {{description}}
Scenario: {{scenario}}

RECENT CONVERSATION CONTEXT:
{{recent_chat}}

TASK:
Generate a brief, natural plot context (1-2 sentences) that:
1. Reflects the character's personality and current situation
2. Provides subtle motivation or internal conflict
3. Feels organic to the roleplay
4. Does not break the fourth wall or mention being an AI
5. Focuses on character development and relationship dynamics

FORMAT:
Return ONLY the plot context text, nothing else. Example: "[Character feels growing respect for {{user}} but struggles with their pride]" or "[Character notices something unusual but decides to observe silently]"

PLOT CONTEXT:`;

export class PlotEngine {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Generate a customized plot context based on character and chat data
     * @param {Object} character - Character data
     * @param {Array} chatHistory - Recent chat messages
     * @param {Object} options - Generation options
     * @returns {Promise<String>} Generated plot context
     */
    async generatePlotContext(character, chatHistory, options = {}) {
        const { style = 'natural', intensity = 'moderate', direction = '', template = 'universal' } = options;
        
        console.log(`[machinor-roundtable] Starting plot generation for character:`, character?.name);
        console.log(`[machinor-roundtable] Chat history length:`, chatHistory?.length);
        console.log(`[machinor-roundtable] Generation options:`, { style, intensity, direction });
        
        const cacheKey = this.generateCacheKey(character, chatHistory, template, style, intensity, direction);
        
        // Check cache first
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                console.log(`[machinor-roundtable] Using cached plot context`);
                return cached.context;
            }
            this.cache.delete(cacheKey);
        }

        try {
            const recentChat = this.extractRecentContext(chatHistory);
            console.log(`[machinor-roundtable] Extracted recent chat:`, recentChat);
            
            const prompt = this.buildGenerationPrompt(character, recentChat, style, intensity, direction);
            console.log(`[machinor-roundtable] Built generation prompt:`, prompt.substring(0, 200) + '...');
            
            // Use SillyTavern's generateQuietPrompt to use the current LLM
            // This will automatically use the same LLM as the manual generate button
            const plotContext = await generateQuietPrompt({
                quietPrompt: prompt,
                skipWIAN: true,
                removeReasoning: true,
                trimToSentence: false
            });
            
            console.log(`[machinor-roundtable] Received plot context from LLM:`, plotContext);
            
            // Clean up the response - remove any quotes or extra formatting
            const cleanedContext = plotContext.replace(/^["']|["']$/g, '').trim();
            
            console.log(`[machinor-roundtable] Cleaned plot context:`, cleanedContext);
            
            // Cache the result
            this.cache.set(cacheKey, {
                context: cleanedContext,
                timestamp: Date.now()
            });
            
            console.log(`[machinor-roundtable] Successfully generated and cached plot context`);
            return cleanedContext;
            
        } catch (error) {
            console.error(`[machinor-roundtable] Failed to generate plot context:`, error);
            console.error(`[machinor-roundtable] Error details:`, error.message, error.stack);
            
            // Show error notification
            if (typeof toastr !== 'undefined') {
                // @ts-ignore - toastr is a global library
                toastr.error(`Plot generation failed: ${error.message}. Using fallback.`, 'Machinor Roundtable');
            }
            
            // Try to use cached plot if available (even if expired)
            const similarCacheKey = Array.from(this.cache.keys()).find(key =>
                key.startsWith(`${character.name}-${character.create_date || 'unknown'}`)
            );
            
            if (similarCacheKey) {
                const cached = this.cache.get(similarCacheKey);
                console.log(`[machinor-roundtable] Using expired cached plot as fallback`);
                if (typeof toastr !== 'undefined') {
                    // @ts-ignore - toastr is a global library
                    toastr.info('Using cached plot as fallback', 'Machinor Roundtable');
                }
                return cached.context;
            }
            
            // Return a fallback context
            console.log(`[machinor-roundtable] Using fallback context`);
            return this.getFallbackContext(character, style);
        }
    }

    /**
     * Build the prompt for plot generation
     */
    buildGenerationPrompt(character, recentChat, style = 'natural', intensity = 'moderate', direction = '') {
        const intensityDescriptions = {
            subtle: 'very subtle, barely noticeable',
            moderate: 'balanced, noticeable but not overwhelming',
            strong: 'strong, clearly guiding the narrative',
            dramatic: 'dramatic, major plot-driving'
        };
        
        const styleDescriptions = {
            natural: 'natural and organic',
            dramatic: 'dramatic and intense',
            romantic: 'romantic and emotional',
            mysterious: 'mysterious and intriguing',
            adventure: 'adventurous and exciting',
            comedy: 'lighthearted and humorous'
        };

        return PLOT_GENERATION_PROMPT
            .replace('{{char}}', character.name || 'Character')
            .replace('{{personality}}', character.personality || 'Not specified')
            .replace('{{description}}', character.description || 'Not specified')
            .replace('{{scenario}}', character.scenario || 'Not specified')
            .replace('{{recent_chat}}', recentChat || 'No recent conversation')
            .replace('{{style}}', styleDescriptions[style] || 'natural')
            .replace('{{intensity}}', intensityDescriptions[intensity] || 'moderate')
            .replace('{{direction}}', direction || 'No specific direction');
    }

    /**
     * Extract recent chat context for plot generation
     */
    extractRecentContext(chatHistory, maxMessages = 5) {
        if (!chatHistory || chatHistory.length === 0) {
            return "No conversation history available.";
        }

        const recentMessages = chatHistory.slice(-maxMessages);
        return recentMessages.map(msg => {
            const name = msg.is_user ? 'You' : (msg.name || 'Character');
            return `${name}: ${msg.mes}`;
        }).join('\n');
    }

    /**
     * Generate a cache key for the current context
     */
    generateCacheKey(character, chatHistory, template, style, intensity, direction) {
        const charKey = `${character.name}-${character.create_date || 'unknown'}`;
        const chatKey = chatHistory.length > 0 ?
            `${chatHistory[chatHistory.length - 1].send_date || 'no-date'}` :
            'empty';
        const dirKey = direction ? `-${direction}` : '';
        return `${charKey}-${chatKey}-${template}-${style}-${intensity}${dirKey}`;
    }

    /**
     * Get a fallback context when generation fails
     */
    getFallbackContext(character, style = 'natural') {
        const styleFallbacks = {
            natural: [
                `[${character.name || 'Character'} is focused on the current situation]`,
                `[${character.name || 'Character'} is considering their next words carefully]`,
                `[${character.name || 'Character'} observes with interest]`
            ],
            dramatic: [
                `[${character.name || 'Character'} feels tension building]`,
                `[${character.name || 'Character'} senses something important is about to happen]`,
                `[${character.name || 'Character'} struggles with conflicting emotions]`
            ],
            romantic: [
                `[${character.name || 'Character'} feels their heart flutter]`,
                `[${character.name || 'Character'} notices how the light catches their eye]`,
                `[${character.name || 'Character'} fights the urge to move closer]`
            ],
            mysterious: [
                `[${character.name || 'Character'} notices something out of place]`,
                `[${character.name || 'Character'} feels they're being watched]`,
                `[${character.name || 'Character'} senses secrets in the air]`
            ],
            adventure: [
                `[${character.name || 'Character'} feels the call of adventure]`,
                `[${character.name || 'Character'} prepares for what's ahead]`,
                `[${character.name || 'Character'} eyes the horizon with determination]`
            ],
            comedy: [
                `[${character.name || 'Character'} fights to keep a straight face]`,
                `[${character.name || 'Character'} finds the situation amusing]`,
                `[${character.name || 'Character'} tries not to laugh]`
            ]
        };
        
        const fallbacks = styleFallbacks[style] || styleFallbacks.natural;
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    /**
     * Clear the cache
     */
    clearCache() {
        this.cache.clear();
        console.log(`[machinor-roundtable] Cache cleared`);
    }

    /**
     * Get cache size for debugging
     */
    getCacheSize() {
        return this.cache.size;
    }
}