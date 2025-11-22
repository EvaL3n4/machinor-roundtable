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
    constructor(stIntegration = null, narrativeArc = null) {
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
        logger.log('===== PLOT GENERATION START (JSON) =====');

        const promptData = this.buildBestPrompt(character, chatHistory, options);

        try {
            logger.log('🎯 Making LLM call');

            // Wrap LLM call with timeout to prevent hanging
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

            // Return full object for UI insights, consumers must handle it
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
     */
    parseResponse(response) {
        try {
            // First try direct parse
            return JSON.parse(response);
        } catch (e) {
            logger.log('Direct JSON parse failed, trying extraction');
            // Try to extract JSON object if wrapped in text or markdown
            const firstBrace = response.indexOf('{');
            const lastBrace = response.lastIndexOf('}');

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
     */
    buildBestPrompt(character, chatHistory, options = {}) {
        let prompt = PLOT_GENERATION_PROMPT
            .replace('{{char}}', character.name || 'Character')
            .replace('{{personality}}', character.personality || 'Not specified')
            .replace('{{description}}', character.description || 'Not specified')
            .replace('{{scenario}}', character.scenario || 'Not specified')
            .replace('{{recent_chat}}', this.extractRecentContext(chatHistory));

        // Add narrative arc context if available
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

        prompt = prompt
            .replace('{{direction}}', options.direction || 'Let the story unfold with compelling natural progression')
            .replace('{{style}}', styleDescriptions[options.style] || 'natural');

        return { prompt };
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
            return `${name}: ${msg.mes} `;
        }).join('\n');
    }

    /**
     * Build unified arc context
     */
    buildUnifiedArcContext(character, chatHistory, options = {}) {
        if (!this.narrativeArc) return null;
        // Simplified arc context building
        return {
            hasActiveArc: !!this.narrativeArc.currentArc,
            arcType: this.narrativeArc.currentArc?.type || null,
            arcProgress: this.narrativeArc.calculateArcProgress()
        };
    }

    formatArcContext(arcContext) {
        if (!arcContext) return '';
        return `Current Arc: ${arcContext.arcType || 'None'} \nProgress: ${arcContext.arcProgress}% `;
    }

    formatWorldContext(worldContext) {
        if (!Array.isArray(worldContext)) return '';
        return worldContext.map(entry => `- ${entry.name}: ${entry.content} `).join('\n');
    }
}