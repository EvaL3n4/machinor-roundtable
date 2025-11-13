// Machinor Roundtable - Plot Generation Engine
import { getContext } from "../../../extensions.js";
import { generateQuietPrompt } from "../../../../script.js";
import { STIntegrationManager } from "./st-integration.js";

const PLOT_GENERATION_PROMPT = `You are a narrative architect creating compelling story hooks for immersive roleplay. Based on the character information and recent conversation context provided, generate a dynamic plot context that will drive the story forward and create engaging narrative momentum.

CHARACTER INFORMATION:
Name: {{char}}
Personality: {{personality}}
Description: {{description}}
Scenario: {{scenario}}

RECENT CONVERSATION CONTEXT:
{{recent_chat}}

TASK:
Generate a compelling plot context (2-4 sentences) that:
1. Creates dramatic tension or emotional stakes
2. Establishes clear story direction and momentum
3. Provides specific motivation for character actions
4. Sets up potential conflicts or revelations
5. Drives the narrative forward with purpose
6. Feels natural within the roleplay context

STORY DIRECTION:
{{direction}}

TONE:
Focus on bold, story-driving elements that create narrative energy. Avoid passive observations - instead create situations that demand character engagement and response.

FORMAT:
Return ONLY the plot context text, nothing else. Strong examples: "[Character realizes their secret mission puts them at odds with everything they've been taught, forcing a crucial decision between loyalty and truth]" or "[A mysterious figure from Character's past appears, carrying evidence of a conspiracy that changes everything]" or "[Character discovers the user harbors dangerous knowledge that could destroy their world, creating an impossible choice between love and duty]"

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
        console.log('[machinor-roundtable] ===== PLOT GENERATION START =====');
        console.log('[machinor-roundtable] Character:', character?.name || 'Unknown');
        console.log('[machinor-roundtable] Chat history length:', chatHistory?.length || 0);
        console.log('[machinor-roundtable] Template option present:', !!options.template);
        console.log('[machinor-roundtable] Guidance option present:', !!options.guidance);
        console.log('[machinor-roundtable] Full options:', options);
        
        // Use arc-aware generation if narrative arc is available
        if (this.narrativeArc) {
            console.log('[machinor-roundtable] Using narrative arc system');
            const result = await this.generateArcAwarePlotContext(character, chatHistory, options);
            console.log('[machinor-roundtable] Final result:', result);
            console.log('[machinor-roundtable] ===== PLOT GENERATION END (ARC) =====');
            return result;
        }
        
        console.log('[machinor-roundtable] No narrative arc - using enhanced generation');
        const result = await this.generateEnhancedPlotContext(character, chatHistory, options);
        console.log('[machinor-roundtable] Final result:', result);
        console.log('[machinor-roundtable] ===== PLOT GENERATION END (ENHANCED) =====');
        return result;
    }

    /**
     * Fallback basic plot generation (no ST integration)
     */
    async generateBasicPlotContext(character, chatHistory, options = {}) {
        try {
            const { guidance = '', template = '' } = options;
            
            // Build basic prompt
            const basicPrompt = this.buildGenerationPrompt(
                character,
                this.extractRecentContext(chatHistory),
                options.style || 'natural',
                options.intensity || 'moderate',
                options.direction || ''
            );
            
            // Add template guidance if provided
            if (guidance && template) {
                const templateGuidanceText = this.formatTemplateGuidance(template, guidance);
                const promptWithGuidance = basicPrompt + `\n\nTEMPLATE GUIDANCE:\n${templateGuidanceText}`;
                
                console.log('[machinor-roundtable] Using basic generation with template guidance:', template);
                
                const plotContext = await generateQuietPrompt({
                    quietPrompt: promptWithGuidance,
                    skipWIAN: true,
                    removeReasoning: true,
                    trimToSentence: false
                });
                
                const cleanedContext = this.cleanPlotContext(plotContext);
                return cleanedContext;
            } else {
                console.log('[machinor-roundtable] Using basic generation (no template guidance)');
                
                const plotContext = await generateQuietPrompt({
                    quietPrompt: basicPrompt,
                    skipWIAN: true,
                    removeReasoning: true,
                    trimToSentence: false
                });
                
                const cleanedContext = this.cleanPlotContext(plotContext);
                return cleanedContext;
            }
            
        } catch (error) {
            console.error('[machinor-roundtable] Basic generation failed, using fallback:', error);
            
            // Use fallback context
            const fallbackContext = this.getFallbackContext(character, options.style || 'natural');
            console.log('[machinor-roundtable] Using fallback context:', fallbackContext);
            return fallbackContext;
        }
    }

    /**
     * Generate plot using narrative arc guidance with template integration
     */
    async generateArcAwarePlotContext(character, chatHistory, options = {}) {
        const hasTemplateGuidance = options.guidance && options.template;
        
        console.log('[machinor-roundtable] === ARC-AWARE GENERATION START ===');
        console.log('[machinor-roundtable] Template guidance present:', hasTemplateGuidance);
        console.log('[machinor-roundtable] Template:', options.template || 'none');
        console.log('[machinor-roundtable] Guidance:', options.guidance || 'none');
        console.log('[machinor-roundtable] Options received:', options);
        
        if (!this.narrativeArc) {
            console.log('[machinor-roundtable] No narrative arc available, falling back to enhanced generation');
            return this.generateEnhancedPlotContext(character, chatHistory, options);
        }

        try {
            // Get plot suggestions from narrative arc system
            const arcSuggestions = this.narrativeArc.getPlotSuggestions(character, chatHistory, options);
            
            console.log('[machinor-roundtable] Arc suggestions received:', arcSuggestions);
            
            if (arcSuggestions.length > 0) {
                // Use the first suggestion for now - can be enhanced to let user choose
                const suggestion = arcSuggestions[0];
                
                console.log('[machinor-roundtable] Selected suggestion:', suggestion);
                console.log('[machinor-roundtable] Suggestion type:', suggestion.type);
                console.log('[machinor-roundtable] Suggestion text:', suggestion.text);
                
                // CRITICAL FIX: If template guidance exists, prioritize it over arc suggestions
                if (hasTemplateGuidance) {
                    console.log('[machinor-roundtable] Template guidance present - generating AI plot with template direction');
                    
                    // Build enhanced context with both arc context AND template guidance
                    const arcContext = this.buildArcContext(character, suggestion, arcSuggestions);
                    
                    // Get enhanced data from ST integration
                    const enhancedPrompt = this.buildEnhancedPrompt(
                        character,
                        this.stIntegration?.analyzeCharacterProfile(character),
                        this.stIntegration?.getWorldInfo(),
                        this.stIntegration?.getActiveCharacters(),
                        chatHistory,
                        {
                            ...options,
                            arcContext,
                            // Ensure template guidance is included
                            guidance: options.guidance,
                            template: options.template
                        }
                    );
                    
                    console.log('[machinor-roundtable] Generating AI plot with template guidance via enhanced prompt');
                    
                    // Generate plot with template guidance (this calls AI)
                    const plotContext = await generateQuietPrompt({
                        quietPrompt: enhancedPrompt,
                        skipWIAN: true,
                        removeReasoning: true,
                        trimToSentence: false
                    });
                    
                    const cleanedContext = this.cleanPlotContext(plotContext);
                    console.log('[machinor-roundtable] AI plot generated with template guidance:', cleanedContext);
                    console.log('[machinor-roundtable] === ARC-AWARE GENERATION END (TEMPLATE) ===');
                    
                    return cleanedContext;
                }
                
                // If no template guidance, check if it's a direct suggestion (arc suggestion type)
                if (suggestion.type === 'arc_suggestion' && suggestion.text) {
                    console.log('[machinor-roundtable] No template guidance - returning arc suggestion text directly:', suggestion.text);
                    console.log('[machinor-roundtable] === ARC-AWARE GENERATION END (ARC DIRECT) ===');
                    return suggestion.text;
                }
                
                // For other suggestion types, build enhanced context with arc information
                console.log('[machinor-roundtable] Non-arc suggestion type - building enhanced context');
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
                
                console.log('[machinor-roundtable] Generating AI plot with arc context via enhanced prompt');
                
                // Generate plot with arc context
                const plotContext = await generateQuietPrompt({
                    quietPrompt: enhancedPrompt,
                    skipWIAN: true,
                    removeReasoning: true,
                    trimToSentence: false
                });
                
                const cleanedContext = this.cleanPlotContext(plotContext);
                console.log('[machinor-roundtable] Arc-aware plot generated successfully:', cleanedContext);
                console.log('[machinor-roundtable] === ARC-AWARE GENERATION END (ENHANCED) ===');
                
                return cleanedContext;
            }
            
            console.log('[machinor-roundtable] No arc suggestions - falling back to enhanced generation');
            // Fall back to enhanced generation if no arc suggestions
            return this.generateEnhancedPlotContext(character, chatHistory, options);
            
        } catch (error) {
            console.error('[machinor-roundtable] Arc-aware generation failed, falling back to enhanced:', error);
            console.log('[machinor-roundtable] === ARC-AWARE GENERATION END (ERROR) ===');
            return this.generateEnhancedPlotContext(character, chatHistory, options);
        }
    }

    /**
     * Build arc context information for plot generation with enhanced multi-turn potential
     */
    buildArcContext(character, primarySuggestion, allSuggestions) {
        const context = {
            hasActiveArc: !!this.narrativeArc.currentArc,
            arcType: this.narrativeArc.currentArc?.type || null,
            arcProgress: this.narrativeArc.calculateArcProgress(),
            currentPhase: primarySuggestion.phase || null,
            suggestionType: primarySuggestion.type,
            availableChoices: allSuggestions.length,
            characterName: character?.name || 'Character'
        };

        if (this.narrativeArc.currentArc) {
            const currentArc = this.narrativeArc.currentArc;
            context.arcName = currentArc.name;
            context.currentPhaseDescription = currentArc.currentPhase?.description;
            
            // Add arc-specific guidance with stronger narrative direction
            if (currentArc.type === 'romance') {
                context.arcGuidance = 'Create emotional tension through meaningful character interactions and relationship development that builds across multiple exchanges';
            } else if (currentArc.type === 'adventure') {
                context.arcGuidance = 'Establish compelling challenges and growth opportunities that drive heroic development and quest progression';
            } else if (currentArc.type === 'mystery') {
                context.arcGuidance = 'Present intriguing clues and revelations that create suspense and drive investigation forward';
            } else if (currentArc.type === 'friendship') {
                context.arcGuidance = 'Build meaningful connections through shared experiences and mutual support that deepens bonds';
            } else if (currentArc.type === 'hero_journey') {
                context.arcGuidance = 'Create transformative moments through trials and growth that lead to heroic achievement';
            }
            
            // Add phase-specific momentum for multi-turn storylines
            context.phaseMomentum = this.generatePhaseMomentum(currentArc, context.arcProgress);
            
            // Add narrative continuity guidance
            context.continuityGuidance = this.generateContinuityGuidance(context);
        }

        return context;
    }

    /**
     * Generate phase-specific momentum for ongoing storylines
     */
    generatePhaseMomentum(currentArc, arcProgress) {
        const currentPhase = currentArc.currentPhase?.name || 'general';
        
        const momentumMap = {
            // Romance phases
            'introduction': 'Establish initial attraction and meaningful first impressions that set up future romantic development',
            'getting_to_know': 'Deepen emotional connection through revealing conversations and shared moments',
            'complication': 'Create relationship obstacles that test feelings and force characters to confront their emotions',
            'tension': 'Build romantic tension through near-misses, misunderstandings, or external pressures',
            'resolution': 'Bring romantic storylines to satisfying conclusions that reward character growth',
            
            // Adventure phases
            'call_to_adventure': 'Present compelling opportunities for heroic action and personal growth',
            'preparation': 'Show character preparation and gathering of resources for upcoming challenges',
            'challenges': 'Create obstacles that test character abilities and force creative problem-solving',
            'climax': 'Build toward major confrontations that determine the fate of the adventure',
            'resolution': 'Deliver satisfying conclusions that show character transformation and achievement',
            
            // Mystery phases
            'hook': 'Present intriguing mysteries that create immediate questions and investigation opportunities',
            'investigation': 'Provide clues and revelations that drive detective work and story progression',
            'revelation': 'Create shocking discoveries that change everything characters thought they knew',
            'confrontation': 'Build tension toward facing the truth or confronting the mystery source',
            'conclusion': 'Resolve mysteries with satisfying answers that tie up all story threads'
        };
        
        return momentumMap[currentPhase] || 'Create compelling narrative momentum that drives the story forward';
    }

    /**
     * Generate continuity guidance for multi-turn storylines
     */
    generateContinuityGuidance(context) {
        const guidance = [];
        
        // Progress-based continuity
        if (context.arcProgress < 25) {
            guidance.push('Establish foundational story elements and character motivations for long-term development');
        } else if (context.arcProgress < 50) {
            guidance.push('Build on established foundations by deepening conflicts and relationships');
        } else if (context.arcProgress < 75) {
            guidance.push('Escalate tensions toward major story climax with high stakes and urgent decisions');
        } else {
            guidance.push('Create compelling conclusions that resolve long-standing conflicts and character arcs');
        }
        
        // Character-specific continuity
        guidance.push(`Ensure all plot elements align with ${context.characterName}'s established personality and motivations`);
        
        // Story momentum continuity
        guidance.push('Create plot contexts that naturally lead to compelling follow-up scenarios in subsequent turns');
        
        return guidance.join(' ');
    }

    /**
     * Enhanced plot generation using ST integration data with template guidance
     */
    async generateEnhancedPlotContext(character, chatHistory, options = {}) {
        try {
            // Get enhanced character analysis if ST integration is available
            const characterAnalysis = this.stIntegration?.analyzeCharacterProfile(character);
            
            // Check if we have meaningful ST integration data
            const hasSTData = characterAnalysis || this.stIntegration?.getWorldInfo() || (this.stIntegration?.getActiveCharacters()?.length > 0);
            
            // If no meaningful ST data, fall back to basic generation
            if (!hasSTData) {
                console.log('[machinor-roundtable] No meaningful ST integration data, falling back to basic generation');
                return this.generateBasicPlotContext(character, chatHistory, options);
            }
            
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
            
            const hasTemplateGuidance = options.guidance && options.template;
            if (hasTemplateGuidance) {
                console.log('[machinor-roundtable] Using enhanced generation with template guidance:', options.template);
            } else {
                console.log('[machinor-roundtable] Using enhanced generation with ST integration data');
            }
            
            // Generate plot using enhanced context
            const plotContext = await generateQuietPrompt({
                quietPrompt: enhancedPrompt,
                skipWIAN: true,
                removeReasoning: true,
                trimToSentence: false
            });
            
            const cleanedContext = this.cleanPlotContext(plotContext);
            console.log('[machinor-roundtable] Enhanced plot generated successfully');
            
            return cleanedContext;
            
        } catch (error) {
            console.error('[machinor-roundtable] Enhanced generation failed, falling back to basic:', error);
            return this.generateBasicPlotContext(character, chatHistory, options);
        }
    }

    /**
     * Build enhanced prompt with ST integration data and template guidance
     */
    buildEnhancedPrompt(character, characterAnalysis, worldContext, activeCharacters, chatHistory, options = {}) {
        const { style = 'natural', intensity = 'moderate', direction = '', guidance = '', template = '', arcContext = null } = options;
        
        let prompt = PLOT_GENERATION_PROMPT;
        
        // Base character information
        prompt = prompt
            .replace('{{char}}', character.name || 'Character')
            .replace('{{personality}}', character.personality || 'Not specified')
            .replace('{{description}}', character.description || 'Not specified')
            .replace('{{scenario}}', character.scenario || 'Not specified')
            .replace('{{recent_chat}}', this.extractRecentContext(chatHistory));
        
        // Add narrative arc context if available (for compelling story continuity)
        if (arcContext && arcContext.hasActiveArc) {
            const arcText = this.formatArcContext(arcContext);
            prompt += `\n\nCURRENT STORY ARC:\n${arcText}`;
        }
        
        // Add template guidance if provided (from template selection)
        if (guidance && template) {
            const templateGuidanceText = this.formatTemplateGuidance(template, guidance);
            prompt += `\n\nTEMPLATE GUIDANCE:\n${templateGuidanceText}`;
        }
        
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
        
        // Add enhanced style and intensity guidance
        const intensityDescriptions = {
            subtle: 'lightly atmospheric, gentle undertones',
            moderate: 'noticeable narrative drive with room for natural flow',
            strong: 'compelling story momentum with clear direction',
            dramatic: 'intense plot pressure with high emotional stakes and urgent conflicts'
        };
        
        const styleDescriptions = {
            natural: 'organic story development with realistic character reactions',
            dramatic: 'high-stakes situations with intense emotional weight',
            romantic: 'deep emotional connections with relationship tension',
            mysterious: 'intriguing unknowns with suspenseful revelations',
            adventure: 'exciting challenges with heroic growth and discovery',
            comedy: 'light-hearted situations with amusing complications'
        };
        
        // Add story momentum guidance
        const momentumGuidance = this.generateMomentumGuidance(options);
        if (momentumGuidance) {
            prompt += `\n\nSTORY MOMENTUM:\n${momentumGuidance}`;
        }
        
        prompt = prompt
            .replace('{{style}}', styleDescriptions[style] || styleDescriptions.natural)
            .replace('{{intensity}}', intensityDescriptions[intensity] || intensityDescriptions.moderate)
            .replace('{{direction}}', direction || 'Let the story unfold with compelling natural progression');
        
        return prompt;
    }

    /**
     * Format template guidance for inclusion in prompts
     */
    formatTemplateGuidance(template, guidance) {
        const templateDisplayNames = {
            'meet_cute': 'Romance Template: Meet Cute',
            'adventure_begins': 'Adventure Template: Adventure Begins',
            'mystery_hook': 'Mystery Template: Mystery Hook',
            'conflict_rises': 'Conflict Template: Conflict Rises'
        };
        
        const templateName = templateDisplayNames[template] || `Template: ${template}`;
        
        // Enhanced template-specific guidance for compelling narratives
        const templateGuidance = this.getTemplateSpecificGuidance(template);
        
        return `${templateName}\n\nCore Narrative Direction: ${guidance}\n\n${templateGuidance}\n\nEXECUTION FOCUS: Create a plot context that immediately establishes dramatic tension, character motivation, and clear story momentum. This should feel like a pivotal moment that changes everything for the character.`;
    }

    /**
     * Get template-specific narrative guidance for stronger direction
     */
    getTemplateSpecificGuidance(template) {
        const guidanceMap = {
            'meet_cute': 'Create an immediate spark of connection or recognition. Focus on a moment that could change the entire relationship dynamic. Include specific details that suggest deep compatibility or irresistible attraction.',
            'adventure_begins': 'Present a compelling call to action that the character cannot ignore. Establish high stakes and exciting possibilities that create urgency and drive the narrative forward. Make the adventure feel inevitable and transformative.',
            'mystery_hook': 'Reveal a clue, secret, or unexplained event that creates urgent questions. Focus on something that suggests larger consequences and demands investigation. Create suspense that pushes the story toward revelation.',
            'conflict_rises': 'Escalate existing tensions or introduce a major obstacle that forces characters into difficult positions. Focus on conflict that creates impossible choices or high-stakes decisions. Build dramatic pressure that cannot be ignored.'
        };
        
        return guidanceMap[template] || 'Focus on creating compelling narrative momentum that drives the story forward with purpose and emotional weight.';
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
     * Format arc context for compelling story continuity
     */
    formatArcContext(arcContext) {
        let text = '';
        
        if (arcContext.arcName) {
            text += `Current arc: ${arcContext.arcName}`;
        }
        
        if (arcContext.arcProgress > 0) {
            text += `\nProgress: ${arcContext.arcProgress}% complete`;
        }
        
        if (arcContext.currentPhase) {
            text += `\nCurrent phase: ${arcContext.currentPhase}`;
        }
        
        if (arcContext.currentPhaseDescription) {
            text += `\nPhase focus: ${arcContext.currentPhaseDescription}`;
        }
        
        if (arcContext.arcGuidance) {
            text += `\nArc direction: ${arcContext.arcGuidance}`;
        }
        
        if (arcContext.availableChoices > 1) {
            text += `\nStory choices available: ${arcContext.availableChoices} options to explore`;
        }
        
        return text || 'No active story arc - focus on compelling character development.';
    }

    /**
     * Generate story momentum guidance for compelling narratives
     */
    generateMomentumGuidance(options) {
        const guidance = [];
        
        // Add momentum based on style and intensity
        if (options.style === 'dramatic' && options.intensity === 'dramatic') {
            guidance.push('Create urgent conflicts that demand immediate character response');
        } else if (options.style === 'romantic') {
            guidance.push('Build emotional tension through meaningful character interactions');
        } else if (options.style === 'adventure') {
            guidance.push('Establish compelling challenges that drive character growth');
        } else if (options.style === 'mysterious') {
            guidance.push('Plant intriguing clues that hint at larger revelations');
        }
        
        // Add arc momentum if available
        if (options.arcContext && options.arcContext.hasActiveArc) {
            const progress = options.arcContext.arcProgress || 0;
            if (progress < 30) {
                guidance.push('Early arc phase: Establish foundational story elements and character motivations');
            } else if (progress < 70) {
                guidance.push('Mid-arc phase: Escalate conflicts and deepen character relationships');
            } else {
                guidance.push('Late arc phase: Build toward climactic moments and resolution');
            }
        }
        
        // Add template momentum if available
        if (options.template && options.guidance) {
            if (options.template === 'conflict_rises') {
                guidance.push('Escalate existing tensions to create compelling dramatic pressure');
            } else if (options.template === 'adventure_begins') {
                guidance.push('Introduce exciting new possibilities that beckon character action');
            } else if (options.template === 'mystery_hook') {
                guidance.push('Present intriguing unknowns that demand investigation and discovery');
            }
        }
        
        return guidance.length > 0 ? guidance.join('\n- ') : '';
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
     * Intelligent artifact removal system that preserves good narrative content
     * Only removes known AI processing artifacts, keeps everything else as potential narrative context
     */
    cleanPlotContext(rawOutput) {
        if (!rawOutput || typeof rawOutput !== 'string') {
            return '';
        }

        console.log('[machinor-roundtable] Cleaning raw output:', rawOutput);

        let cleaned = rawOutput;

        // PHASE 1: Remove ONLY known AI processing artifacts
        // These are guaranteed to be unwanted meta-processing content
        
        // 1. Remove internal AI processing markers
        cleaned = cleaned.replace(/<breflect>[\s\S]*?<\/breflect>/gi, '');
        
        // 2. Remove AI reasoning and thought process markers
        cleaned = cleaned.replace(/\[\s*The AI (?:embodies|acts as|is playing|responds as)[\s\S]*?\]/gi, '');
        cleaned = cleaned.replace(/\[\s*AI (?:response|action|behavior)[\s\S]*?\]/gi, '');
        cleaned = cleaned.replace(/\[\s*(?:Thought|Reasoning|Planning|Processing)[:\s][\s\S]*?\]/gi, '');
        
        // 3. Remove system messages and meta-instructions
        cleaned = cleaned.replace(/Start Reply With[:\s]*/gi, '');
        cleaned = cleaned.replace(/\[\s*Start[^\]]*?\]/gi, '');
        cleaned = cleaned.replace(/\[\s*system[^\]]*?\]/gi, '');
        cleaned = cleaned.replace(/\[\s*instruction[^\]]*?\]/gi, '');
        
        // 4. Remove XML tags and malformed artifacts (SillyTavern integration issues)
        cleaned = cleaned.replace(/<\w+[^>]*>/g, ''); // Remove opening XML tags
        cleaned = cleaned.replace(/<\/\w+>/g, ''); // Remove closing XML tags
        cleaned = cleaned.replace(/<\w+\/>/g, ''); // Remove self-closing XML tags
        cleaned = cleaned.replace(/<\w+[^>]*$/g, ''); // Remove unclosed XML tags at end
        cleaned = cleaned.replace(/^[<\w+\s]*>/g, ''); // Remove leading XML artifacts
        cleaned = cleaned.replace(/<\w+[^>]*$/gm, ''); // Remove malformed XML at line ends
        
        // 5. Remove internal/meta processing markers
        cleaned = cleaned.replace(/\[\s*internal[^\]]*?\]/gi, '');
        
        // PHASE 2: Clean up formatting (keep everything else as potential narrative)
        cleaned = cleaned.replace(/^["']|["']$/g, '').trim(); // Remove surrounding quotes
        cleaned = cleaned.replace(/\n\s*\n/g, '\n').trim(); // Remove excessive line breaks
        cleaned = cleaned.replace(/\s+/g, ' '); // Normalize spaces
        
        // PHASE 3: Remove only empty brackets (content was already removed above)
        cleaned = cleaned.replace(/\[\s*\]/g, '');
        
        // PHASE 4: No validation - preserve all content after artifact removal
        // The user wants to keep original outputs rather than fallbacks
        
        // PHASE 5: Preserve bracket format if present, or add if content looks like narrative
        if (!cleaned.match(/^\[.*\]$/)) {
            // Add brackets if content looks like narrative context
            const hasNarrativeStructure =
                cleaned.match(/[A-Z][a-z]/) || // Has capitalized words (proper names or sentence start)
                cleaned.match(/(?:is|was|feels|thinks|looks|seems|appears|becomes|sees|hears|knows|believes|wants|needs|hopes|fears|hopes|wishes|dreams|remembers|forgets|decides|chooses|chooses|tries|attempts|plans|hopes|expects|awaits|waits|continues|stops|starts|begins|ends|opens|closes|moves|stands|sits|lies|lays|walks|runs|drives|flies|travels|explores|discovers|finds|searches|seeks|hunts|chases|runs|escapes|hid|hide|hides|waits|observes|watching|watches|listens|hear|hears|speaks|talks|says|answers|replies|responds|reacts|acts|behaves|changes|transforms|evolves|develops|grows|learns|studies|teaches|shows|demonstrates|explains|describes|tells|asks|questions|wonders|considers|ponders|reflects|thinks|dreams|imagines|envisions|visualizes|pictures|sees|foresees|predicts|expects|hopes|believes|trusts|depends|relies|relied|depended)/i) ||
                cleaned.match(/[.!?]/); // Has sentence punctuation
            
            if (hasNarrativeStructure) {
                cleaned = `[${cleaned}]`;
            }
        }
        
        console.log('[machinor-roundtable] Cleaned output result:', cleaned);
        return cleaned;
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
     * Get a compelling fallback context when generation fails
     */
    getFallbackContext(character, style = 'natural') {
        const styleFallbacks = {
            natural: [
                `[${character.name || 'Character'} faces a moment that could change everything, forcing them to choose between comfort and growth]`,
                `[${character.name || 'Character'} recognizes an opportunity that aligns perfectly with their deepest desires, but taking it requires courage]`,
                `[${character.name || 'Character'} encounters a situation that reveals something fundamental about their true nature]`
            ],
            dramatic: [
                `[${character.name || 'Character'} discovers a secret that threatens everything they believed about their world]`,
                `[${character.name || 'Character'} faces an impossible choice between two things they hold dear]`,
                `[${character.name || 'Character'} realizes their actions have set in motion consequences they never anticipated]`
            ],
            romantic: [
                `[${character.name || 'Character'} feels a connection that goes beyond attraction, suggesting a soul-deep recognition]`,
                `[${character.name || 'Character'} encounters someone who sees through their defenses to the person they truly are]`,
                `[${character.name || 'Character'} experiences a moment that makes them question everything they thought they wanted]`
            ],
            mysterious: [
                `[${character.name || 'Character'} uncovers a clue that suggests a much larger conspiracy than they imagined]`,
                `[${character.name || 'Character'} realizes someone they trust has been hiding dangerous secrets]`,
                `[${character.name || 'Character'} discovers that what they thought was random is actually part of an intricate plan]`
            ],
            adventure: [
                `[${character.name || 'Character'} receives a call to action that promises to test every skill they've ever learned]`,
                `[${character.name || 'Character'} faces a challenge that could establish their legend or lead to their downfall]`,
                `[${character.name || 'Character'} discovers a path forward that requires them to become someone entirely new]`
            ],
            comedy: [
                `[${character.name || 'Character'} finds themselves in a ridiculous situation that somehow reveals profound truth]`,
                `[${character.name || 'Character'} attempts to maintain dignity while chaos unfolds around them]`,
                `[${character.name || 'Character'} discovers that the most serious moments often contain the most humor]`
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