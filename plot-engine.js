// Machinor Roundtable - Plot Generation Engine
import { getContext } from "../../../extensions.js";
import { generateQuietPrompt } from "../../../../script.js";
import { STIntegrationManager } from "./st-integration.js";

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
    constructor(stIntegration = null, narrativeArc = null) {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.stIntegration = stIntegration;
        this.narrativeArc = narrativeArc;
    }

    /**
     * Generate a customized plot context based on character and chat data
     * @param {Object} character - Character data
     * @param {Array} chatHistory - Recent chat messages
     * @param {Object} options - Generation options
     * @returns {Promise<String>} Generated plot context
     */
    async generatePlotContext(character, chatHistory, options = {}) {
        // Use arc-aware generation if narrative arc is available
        if (this.narrativeArc) {
            return this.generateArcAwarePlotContext(character, chatHistory, options);
        }
        
        // Fall back to enhanced generation if no narrative arc
        return this.generateEnhancedPlotContext(character, chatHistory, options);
    }

    /**
     * Generate plot using narrative arc guidance
     */
    async generateArcAwarePlotContext(character, chatHistory, options = {}) {
        if (!this.narrativeArc) {
            console.log('[machinor-roundtable] No narrative arc available, falling back to enhanced generation');
            return this.generateEnhancedPlotContext(character, chatHistory, options);
        }

        try {
            // Get plot suggestions from narrative arc system
            const arcSuggestions = this.narrativeArc.getPlotSuggestions(character, chatHistory, options);
            
            if (arcSuggestions.length > 0) {
                // Use the first suggestion for now - can be enhanced to let user choose
                const suggestion = arcSuggestions[0];
                
                console.log('[machinor-roundtable] Using arc-aware generation:', suggestion);
                
                // If it's a direct suggestion (arc suggestion type), use it
                if (suggestion.type === 'arc_suggestion' && suggestion.text) {
                    return suggestion.text;
                }
                
                // For other types, build enhanced context with arc information
                const arcContext = this.buildArcContext(character, suggestion, arcSuggestions);
                
                // Get enhanced data from ST integration
                const enhancedPrompt = this.buildEnhancedPrompt(
                    character,
                    this.stIntegration?.analyzeCharacterProfile(character),
                    this.stIntegration?.getWorldInfo(),
                    this.stIntegration?.getActiveCharacters(),
                    chatHistory,
                    { ...options, arcContext }
                );
                
                // Generate plot with arc context
                const plotContext = await generateQuietPrompt({
                    quietPrompt: enhancedPrompt,
                    skipWIAN: true,
                    removeReasoning: true,
                    trimToSentence: false
                });
                
                const cleanedContext = plotContext.replace(/^["']|["']$/g, '').trim();
                console.log('[machinor-roundtable] Arc-aware plot generated successfully');
                
                return cleanedContext;
            }
            
            // Fall back to enhanced generation if no arc suggestions
            return this.generateEnhancedPlotContext(character, chatHistory, options);
            
        } catch (error) {
            console.error('[machinor-roundtable] Arc-aware generation failed, falling back:', error);
            return this.generateEnhancedPlotContext(character, chatHistory, options);
        }
    }

    /**
     * Build arc context information for plot generation
     */
    buildArcContext(character, primarySuggestion, allSuggestions) {
        const context = {
            hasActiveArc: !!this.narrativeArc.currentArc,
            arcType: this.narrativeArc.currentArc?.type || null,
            arcProgress: this.narrativeArc.calculateArcProgress(),
            currentPhase: primarySuggestion.phase || null,
            suggestionType: primarySuggestion.type,
            availableChoices: allSuggestions.length
        };

        if (this.narrativeArc.currentArc) {
            const currentArc = this.narrativeArc.currentArc;
            context.arcName = currentArc.name;
            context.currentPhaseDescription = currentArc.currentPhase?.description;
            
            // Add arc-specific guidance
            if (currentArc.type === 'romance') {
                context.arcGuidance = 'Focus on emotional connection and relationship development';
            } else if (currentArc.type === 'adventure') {
                context.arcGuidance = 'Emphasize challenges, growth, and heroic elements';
            } else if (currentArc.type === 'mystery') {
                context.arcGuidance = 'Include clues, investigation, and revelation elements';
            } else if (currentArc.type === 'friendship') {
                context.arcGuidance = 'Highlight connection, support, and mutual growth';
            } else if (currentArc.type === 'hero_journey') {
                context.arcGuidance = 'Include transformation, trials, and return with wisdom';
            }
        }

        return context;
    }

    /**
     * Enhanced plot generation using ST integration data
     */
    async generateEnhancedPlotContext(character, chatHistory, options = {}) {
        if (!this.stIntegration) {
            console.log('[machinor-roundtable] No ST integration available, falling back to basic generation');
            return this.generatePlotContext(character, chatHistory, options);
        }

        try {
            // Get enhanced character analysis
            const characterAnalysis = this.stIntegration.analyzeCharacterProfile(character);
            
            // Get world context if available
            const worldContext = this.stIntegration.getWorldInfo();
            
            // Get active characters (for multi-character scenarios)
            const activeCharacters = this.stIntegration.getActiveCharacters();
            
            // Build enhanced prompt with all available data
            const enhancedPrompt = this.buildEnhancedPrompt(
                character,
                characterAnalysis,
                worldContext,
                activeCharacters,
                chatHistory,
                options
            );
            
            console.log('[machinor-roundtable] Using enhanced generation with ST integration data');
            
            // Generate plot using enhanced context
            const plotContext = await generateQuietPrompt({
                quietPrompt: enhancedPrompt,
                skipWIAN: true,
                removeReasoning: true,
                trimToSentence: false
            });
            
            const cleanedContext = plotContext.replace(/^["']|["']$/g, '').trim();
            console.log('[machinor-roundtable] Enhanced plot generated successfully');
            
            return cleanedContext;
            
        } catch (error) {
            console.error('[machinor-roundtable] Enhanced generation failed, falling back:', error);
            return this.generatePlotContext(character, chatHistory, options);
        }
    }

    /**
     * Build enhanced prompt with ST integration data
     */
    buildEnhancedPrompt(character, characterAnalysis, worldContext, activeCharacters, chatHistory, options = {}) {
        const { style = 'natural', intensity = 'moderate', direction = '' } = options;
        
        let prompt = PLOT_GENERATION_PROMPT;
        
        // Base character information
        prompt = prompt
            .replace('{{char}}', character.name || 'Character')
            .replace('{{personality}}', character.personality || 'Not specified')
            .replace('{{description}}', character.description || 'Not specified')
            .replace('{{scenario}}', character.scenario || 'Not specified')
            .replace('{{recent_chat}}', this.extractRecentContext(chatHistory));
        
        // Add enhanced character analysis if available
        if (characterAnalysis) {
            const analysisText = this.formatCharacterAnalysis(characterAnalysis);
            prompt += `\n\nCHARACTER ANALYSIS:\n${analysisText}`;
        }
        
        // Add world context if available
        if (worldContext && Object.keys(worldContext).some(key => worldContext[key]?.length > 0)) {
            const worldText = this.formatWorldContext(worldContext);
            prompt += `\n\nWORLD CONTEXT:\n${worldText}`;
        }
        
        // Add multi-character context if applicable
        if (activeCharacters.length > 1) {
            const multiCharText = this.formatMultiCharacterContext(character, activeCharacters);
            prompt += `\n\nGROUP DYNAMICS:\n${multiCharText}`;
        }
        
        // Add style and intensity
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
        
        prompt = prompt
            .replace('{{style}}', styleDescriptions[style] || 'natural')
            .replace('{{intensity}}', intensityDescriptions[intensity] || 'moderate')
            .replace('{{direction}}', direction || 'No specific direction');
        
        return prompt;
    }

    /**
     * Format character analysis for inclusion in prompts
     */
    formatCharacterAnalysis(analysis) {
        let text = '';
        
        if (analysis.traits?.length > 0) {
            text += `Personality traits: ${analysis.traits.join(', ')}\n`;
        }
        
        if (analysis.motivations?.length > 0) {
            text += `Core motivations: ${analysis.motivations.join(', ')}\n`;
        }
        
        if (analysis.fears?.length > 0) {
            text += `Fears/concerns: ${analysis.fears.join(', ')}\n`;
        }
        
        if (analysis.arcPotential) {
            text += `Development potential: ${analysis.arcPotential}\n`;
        }
        
        return text || 'No additional character analysis available.';
    }

    /**
     * Format world context for inclusion in prompts
     */
    formatWorldContext(worldContext) {
        let text = '';
        
        if (worldContext.locations?.length > 0) {
            text += `Notable locations: ${worldContext.locations.map(l => l.name).join(', ')}\n`;
        }
        
        if (worldContext.organizations?.length > 0) {
            text += `Organizations/groups: ${worldContext.organizations.map(o => o.name).join(', ')}\n`;
        }
        
        if (worldContext.items?.length > 0) {
            text += `Important items: ${worldContext.items.map(i => i.name).join(', ')}\n`;
        }
        
        if (worldContext.lore?.length > 0) {
            text += `World lore: ${worldContext.lore.length} entries available\n`;
        }
        
        if (worldContext.rules?.length > 0) {
            text += `World rules: ${worldContext.rules.length} rules established\n`;
        }
        
        return text || 'No specific world context available.';
    }

    /**
     * Format multi-character context
     */
    formatMultiCharacterContext(currentCharacter, activeCharacters) {
        const others = activeCharacters.filter(c => c !== currentCharacter);
        if (others.length === 0) return 'Single character scenario.';
        
        let text = `Group includes ${others.length} other characters: `;
        text += others.map(c => c.name).join(', ');
        
        // Add simple group dynamics
        const roles = others.map(c => c.groupRole).filter(Boolean);
        if (roles.length > 0) {
            text += `\nGroup roles: ${roles.join(', ')}`;
        }
        
        return text;
    }

    /**
     * Build the prompt for plot generation (enhanced version)
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