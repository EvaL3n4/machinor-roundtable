// Machinor Roundtable - Plot Generation Engine
import { getContext } from "../../../extensions.js";
import { generateQuietPrompt } from "../../../../script.js";
import { STIntegrationManager } from "./st-integration.js";
import { logger } from "./logger.js";

const PLOT_GENERATION_PROMPT = `You are a Narrative Architect.Your goal is to analyze the story context and generate a plot hook for the next scene.
[System Note: Output valid JSON only.Do not output any introductory text or markdown formatting outside the JSON block.]
Based on the character information and recent conversation context provided, generate a dynamic plot hook that will drive the story forward.

CHARACTER INFORMATION:
Name: {{char}}
Personality: {{personality}}
Description: {{description}}
Scenario: {{scenario}}

RECENT CONVERSATION CONTEXT:
{{recent_chat}}

STORY DIRECTION:
{{direction}}

TONE:
Focus on bold, story - driving elements that create narrative energy.

    INSTRUCTIONS:
1. Analyze the context and character.
2. Generate a plot hook that creates dramatic tension or emotional stakes.
3. Output MUST be a valid JSON object.

JSON SCHEMA:
{
    "plot_hook": "The narrative hook text, written in the requested style (e.g., '[Character realizes...]')",
        "pacing_guidance": "Internal guidance on how this plot affects the story pacing",
            "tone_analysis": "The emotional tone of this specific hook"
}
`;

export class PlotEngine {
    /**
     * @param {STIntegrationManager|null} [stIntegration=null]
     * @param {NarrativeArcManager|null} [narrativeArc=null]
     */
    constructor(stIntegration = null, narrativeArc = null) {
        /** @type {STIntegrationManager|null} */
        this.stIntegration = stIntegration;
        /** @type {NarrativeArcManager|null} */
        this.narrativeArc = narrativeArc;
    }

    /**
     * Generate a customized plot context based on character and chat data
     * @param {Object} character - Character data
     * @param {Array} chatHistory - Recent chat messages
     * @param {Object} [options={}] - Generation options
     * @returns {Promise<{text: string, tone: string, pacing: string}|null>} Generated plot context object
     * @throws {Error} If LLM call fails or times out
     */
    async generatePlotContext(character, chatHistory, options = {}) {
        logger.log('===== PLOT GENERATION START (JSON) =====');

        const promptData = this.buildBestPrompt(character, chatHistory, options);

        try {
            logger.log('🎯 Making LLM call');

            // TIMEOUT HANDLING: Wrap LLM call with Promise.race to prevent indefinite hanging. Rejects after 45 seconds to provide user feedback and prevent UI freeze.
            const response = await Promise.race([
                generateQuietPrompt({
                    quietPrompt: promptData.prompt,
                    skipWIAN: true,
                    removeReasoning: true,
                    trimToSentence: false
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('LLM call timed out after 45s')), 45000))
            ]);

            const parsed = this.parseResponse(response);

            if (!parsed || !parsed.plot_hook) {
                throw new Error("Failed to parse valid plot hook from response");
            }

            logger.log('Final result:', parsed.plot_hook);
            logger.log('===== PLOT GENERATION END =====');

            // Return full object with text, tone, and pacing for UI insights. Consumers must handle object structure.
            return {
                text: parsed.plot_hook,
                tone: parsed.tone_analysis,
                pacing: parsed.pacing_guidance
            };

        } catch (error) {
            logger.error('LLM call failed:', error);
            toastr.error("Plot generation failed. Please try again.", "Machinor Roundtable");
            return null;
        }
    }

    /**
     * Parse the LLM response, attempting to extract JSON
     * @param {string} response - The raw LLM response
     * @returns {Object|null} The parsed JSON object or null
     */
    parseResponse(response) {
        try {
            // First attempt direct parse
            return JSON.parse(response);
        } catch (e) {
            logger.log('Direct JSON parse failed, trying extraction');
            // JSON PARSING STRATEGY: First attempt direct parse. If that fails, extract JSON from markdown-wrapped text (common LLM behavior). This handles cases where LLM adds explanatory text around the JSON.
            const firstBrace = response.indexOf('{');
            const lastBrace = response.lastIndexOf('}');

            // Strict equality check
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                const jsonString = response.substring(firstBrace, lastBrace + 1);
                try {
                    return JSON.parse(jsonString);
                } catch (e2) {
                    logger.error('Extracted JSON parse failed');
                }
            }
            return null;
        }
    }

    /**
     * Build the best possible prompt based on available data (single LLM call)
     * @param {Object} character - Character data
     * @param {Array} chatHistory - Recent chat messages
     * @param {Object} [options={}] - Generation options
     * @returns {{prompt: string}} Prompt object
     */
    buildBestPrompt(character, chatHistory, options = {}) {
        // PROMPT CONSTRUCTION: Build prompt from template with macro replacement. Conditionally append narrative arc context and world info if available. Apply style descriptions for tone guidance.
        // Replace template macros with character data, using optional chaining and nullish coalescing for safety
        let prompt = PLOT_GENERATION_PROMPT
            .replace('{{char}}', character?.name ?? 'Character')
            .replace('{{personality}}', character?.personality ?? 'Not specified')
            .replace('{{description}}', character?.description ?? 'Not specified')
            .replace('{{scenario}}', character?.scenario ?? 'Not specified')
            .replace('{{recent_chat}}', this.extractRecentContext(chatHistory));

        // Add narrative arc context if available
        // Check for null before accessing
        if (this.narrativeArc) {
            const arcContext = this.buildUnifiedArcContext(character, chatHistory, options);
            if (arcContext) {
                prompt += `\n\nSTORY ARC CONTEXT: \n${this.formatArcContext(arcContext)} `;
            }
        }

        // Add ST integration data if available
        if (this.stIntegration) {
            const worldContext = this.stIntegration.getWorldInfo();
            if (worldContext) {
                prompt += `\n\nWORLD CONTEXT: \n${this.formatWorldContext(worldContext)} `;
            }
        }

        // Apply style replacements
        const styleDescriptions = {
            natural: 'organic story development',
            dramatic: 'high-stakes situations',
            romantic: 'deep emotional connections',
            mysterious: 'intriguing unknowns',
            adventure: 'exciting challenges',
            comedy: 'light-hearted situations'
        };

        // Use optional chaining for options access
        prompt = prompt
            .replace('{{direction}}', options?.direction ?? 'Let the story unfold with compelling natural progression')
            .replace('{{style}}', styleDescriptions[options?.style] ?? 'natural');

        return { prompt };
    }

    /**
     * Extract recent chat context for plot generation
     * @param {Array} chatHistory - Chat history array
     * @param {number} [maxMessages=5] - Max messages to include
     * @returns {string} Formatted chat context
     */
    extractRecentContext(chatHistory, maxMessages = 5) {
        // Extract recent chat messages for context, formatting as 'Name: Message' pairs
        // Strict equality
        if (!chatHistory || chatHistory.length === 0) {
            return "No conversation history available.";
        }
        const recentMessages = chatHistory.slice(-maxMessages);
        return recentMessages.map(msg => {
            const name = msg.is_user ? 'You' : (msg.name ?? 'Character');
            return `${name}: ${msg.mes} `;
        }).join('\n');
    }

    /**
     * Build unified arc context
     * @param {Object} character - Character data
     * @param {Array} chatHistory - Chat history
     * @param {Object} [options={}] - Options
     * @returns {Object|null} Arc context object
     */
    buildUnifiedArcContext(character, chatHistory, options = {}) {
        if (!this.narrativeArc) return null;
        // Simplified arc context building
        return {
            hasActiveArc: !!this.narrativeArc.currentArc,
            // Optional chaining
            arcType: this.narrativeArc.currentArc?.type ?? null,
            arcProgress: this.narrativeArc.calculateArcProgress()
        };
    }

    /**
     * Format arc context for prompt
     * @param {Object|null} arcContext - Arc context object
     * @returns {string} Formatted string
     */
    formatArcContext(arcContext) {
        if (!arcContext) return '';
        return `Current Arc: ${arcContext.arcType || 'None'} \nProgress: ${arcContext.arcProgress}% `;
    }

    /**
     * Format world context for prompt
     * @param {Array|null} worldContext - World context array
     * @returns {string} Formatted string
     */
    formatWorldContext(worldContext) {
        // Strict equality check for array
        if (!Array.isArray(worldContext)) return '';
        return worldContext.map(entry => `- ${entry.name}: ${entry.content} `).join('\n');
    }
}