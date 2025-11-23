// Machinor Roundtable - Narrative Arc System
import { getContext } from "../../../extensions.js";
import { generateQuietPrompt } from "../../../../script.js";
import { logger } from "./logger.js";

/**
 * Narrative Arc Manager
 * Handles story structure templates and plot branching
 */
export class NarrativeArcManager {
    /**
     * @param {STIntegrationManager|null} [stIntegration=null]
     */
    constructor(stIntegration = null) {
        /** @type {STIntegrationManager|null} */
        this.stIntegration = stIntegration;
        /** @type {Object|null} */
        this.currentArc = null;
        /** @type {Array<Object>} */
        this.arcHistory = [];
        /** @type {Map} */
        this.activeBranches = new Map();
        /** @type {Object} */
        this.arcTemplates = this.initializeTemplates();
        /** @type {Object} */
        this.storyProgress = {
            currentPhase: 'introduction',
            milestones: [],
            completedPhases: [],
            arcType: 'natural'
        };

        logger.log('Narrative Arc Manager initialized');
    }

    /**
     * Initialize story arc templates
     * @returns {Object} The arc templates object
     */
    initializeTemplates() {
        // Arc templates define story phases with weights and branching options. Each phase has a name, description, and weight (relative importance).
        return {
            romance: {
                name: 'Romance Arc',
                phases: [
                    { name: 'introduction', description: 'Meeting and initial attraction', weight: 20 },
                    { name: 'getting_to_know', description: 'Developing relationship', weight: 25 },
                    { name: 'complication', description: 'Conflict or obstacle', weight: 20 },
                    { name: 'tension', description: 'Emotional climax', weight: 20 },
                    { name: 'resolution', description: 'Relationship resolution', weight: 15 }
                ],
                branching: [
                    { from: 'introduction', options: ['friends_to_lovers', 'enemies_to_lovers', 'strangers_to_lovers'] },
                    { from: 'getting_to_know', options: ['slow_burn', 'quick_connection', 'friendship_first'] },
                    { from: 'complication', options: ['external_obstacle', 'internal_conflict', 'misunderstanding'] }
                ]
            },
            adventure: {
                name: 'Adventure Arc',
                phases: [
                    { name: 'call_to_adventure', description: 'The quest begins', weight: 15 },
                    { name: 'preparation', description: 'Gathering resources/companions', weight: 20 },
                    { name: 'challenges', description: 'Obstacles and trials', weight: 30 },
                    { name: 'climax', description: 'Major confrontation', weight: 25 },
                    { name: 'resolution', description: 'Victory and return', weight: 10 }
                ],
                branching: [
                    { from: 'call_to_adventure', options: ['mysterious_map', 'urgent_quest', 'accidental_discovery'] },
                    { from: 'challenges', options: ['physical_trials', 'moral_dilemmas', 'mystery_solving'] }
                ]
            },
            mystery: {
                name: 'Mystery Arc',
                phases: [
                    { name: 'hook', description: 'Mystery introduced', weight: 15 },
                    { name: 'investigation', description: 'Gathering clues', weight: 35 },
                    { name: 'revelation', description: 'Key discovery', weight: 25 },
                    { name: 'confrontation', description: 'Confronting the truth', weight: 15 },
                    { name: 'conclusion', description: 'Case solved', weight: 10 }
                ],
                branching: [
                    { from: 'hook', options: ['crime_scene', 'missing_person', 'strange_event'] },
                    { from: 'investigation', options: ['detective_work', 'interviews', 'forensic_analysis'] }
                ]
            },
            friendship: {
                name: 'Friendship Arc',
                phases: [
                    { name: 'first_meeting', description: 'Characters meet', weight: 25 },
                    { name: 'bonding', description: 'Getting to know each other', weight: 30 },
                    { name: 'test', description: 'Friendship tested', weight: 25 },
                    { name: 'growth', description: 'Stronger bond', weight: 20 }
                ],
                branching: [
                    { from: 'first_meeting', options: ['unlikely_meeting', 'forced_together', 'mutual_interest'] },
                    { from: 'bonding', options: ['shared_interests', 'helping_each_other', 'adventure_together'] }
                ]
            },
            hero_journey: {
                name: "Hero's Journey",
                phases: [
                    { name: 'ordinary_world', description: 'Normal life', weight: 10 },
                    { name: 'call_to_adventure', description: 'Called to action', weight: 15 },
                    { name: 'refusal', description: 'Initial hesitation', weight: 5 },
                    { name: 'mentor', description: 'Guidance received', weight: 10 },
                    { name: 'crossing_threshold', description: 'Commit to journey', weight: 15 },
                    { name: 'tests', description: 'Trials and allies', weight: 20 },
                    { name: 'ordeal', description: 'Major crisis', weight: 15 },
                    { name: 'reward', description: 'Achievement', weight: 5 },
                    { name: 'return', description: 'Return transformed', weight: 5 }
                ]
            }
        };
    }

    /**
     * Start a new narrative arc
     * @param {string} [arcType='natural'] - The type of arc to start
     * @param {Object|null} [character=null] - The character associated with the arc
     * @returns {boolean} True if arc started successfully
     */
    startArc(arcType = 'natural', character = null) {
        const template = this.arcTemplates[arcType];
        if (!template) {
            logger.warn(`Unknown arc type: ${arcType}`);
            return false;
        }

        // Safe access to first phase
        const firstPhase = template.phases?.[0];
        if (!firstPhase) {
            logger.warn(`Template ${arcType} has no phases`);
            return false;
        }

        this.currentArc = {
            type: arcType,
            name: template.name,
            currentPhase: firstPhase,
            phaseIndex: 0,
            template: template,
            character: character,
            startTime: Date.now(),
            choices: [],
            branch: null
        };

        this.storyProgress = {
            currentPhase: template.phases[0].name,
            milestones: [],
            completedPhases: [],
            arcType: arcType
        };

        logger.log(`Started ${template.name} arc with ${character?.name || 'unknown character'}`);
        return true;
    }

    /**
     * Get plot direction suggestions based on current arc state
     * @param {Object} character - The character object
     * @param {Array} [chatHistory=[]] - Recent chat history
     * @param {Object} [context={}] - Additional context
     * @returns {Array<Object>} List of suggestion objects
     */
    getPlotSuggestions(character, chatHistory = [], context = {}) {
        if (!this.currentArc) {
            // Suggest arc type based on character and context
            return this.suggestArcType(character, chatHistory, context);
        }

        const suggestions = [];
        // Optional chaining for safety
        const phases = this.currentArc.template?.phases || [];
        const currentPhase = phases[this.currentArc.phaseIndex];
        
        if (!currentPhase) return [];

        const nextPhases = phases.slice(this.currentArc.phaseIndex + 1);

        // Generate suggestions for current phase
        suggestions.push({
            type: 'phase_continuation',
            phase: currentPhase.name,
            description: `Continue ${currentPhase.description}`,
            text: this.generatePhasePlot(currentPhase, character, chatHistory),
            arcProgress: this.calculateArcProgress()
        });

        // Add branch suggestions if available
        const branches = this.currentArc.template?.branching?.filter(b => b.from === currentPhase.name) || [];
        branches.forEach(branch => {
            branch.options.forEach(option => {
                suggestions.push({
                    type: 'branching',
                    branch: option,
                    description: `Try ${this.formatBranchName(option)}`,
                    text: this.generateBranchPlot(option, character, chatHistory),
                    arcProgress: this.calculateArcProgress()
                });
            });
        });

        // Add next phase suggestion
        if (nextPhases.length > 0) {
            suggestions.push({
                type: 'next_phase',
                phase: nextPhases[0].name,
                description: `Move to ${nextPhases[0].description}`,
                text: this.generatePhasePlot(nextPhases[0], character, chatHistory),
                arcProgress: this.calculateArcProgress()
            });
        }

        return suggestions.slice(0, 3); // Limit to 3 suggestions
    }

    /**
     * Suggest appropriate arc type based on character and context
     * Simplified to avoid rigid guessing based on keywords
     * @param {Object} character - The character object
     * @param {Array} chatHistory - Recent chat history
     * @param {Object} context - Additional context
     * @returns {Array<Object>} List of arc suggestion objects
     */
    suggestArcType(character, chatHistory, context) {
        // Return generic suggestions that allow natural development
        return [
            {
                type: 'arc_suggestion',
                arcType: 'natural',
                name: 'Natural Progression',
                description: 'Let the story develop organically based on current events',
                text: '[Character continues to develop naturally within the current situation]',
                arcProgress: 0
            },
            {
                type: 'arc_suggestion',
                arcType: 'hero_journey',
                name: "Hero's Journey",
                description: 'A classic structure of departure, initiation, and return',
                text: '[Character feels called to embark on a transformative journey]',
                arcProgress: 0
            }
        ];
    }

    /**
     * Generate plot text for a specific phase using simplified context
     * @param {Object} phase - The phase object
     * @param {Object} character - The character object
     * @param {Array} chatHistory - Recent chat history
     * @param {Object} [context={}] - Additional context
     * @returns {string} The generated plot text
     */
    generatePhasePlot(phase, character, chatHistory, context = {}) {
        // Generate phase-specific plot text using character name and recent conversation context for dynamic, contextual suggestions
        // Use nullish coalescing and optional chaining
        const characterName = character?.name ?? 'Character';
        const phaseName = phase.name.replace('_', ' ');

        // Extract recent chat context
        const recentChat = this.extractRecentContext(chatHistory);
        const contextualHint = this.getContextualHint(recentChat);

        const phasePlots = {
            introduction: `[${characterName} takes in their new surroundings, aware that everything is about to change. Recent conversation suggests ${contextualHint}]`,
            getting_to_know: `[${characterName} discovers layers to their situation that weren't obvious at first. The conversation patterns indicate ${contextualHint}]`,
            complication: `[${characterName} faces an unexpected obstacle that threatens to derail their progress. Recent developments suggest ${contextualHint}]`,
            tension: `[${characterName} experiences mounting pressure as stakes escalate. The conversation dynamics reveal ${contextualHint}]`,
            resolution: `[${characterName} reaches a pivotal moment that changes everything. The ongoing dialogue points to ${contextualHint}]`,

            call_to_adventure: `[${characterName} receives an irresistible summons that promises to test everything they thought they knew about themselves. Chat context suggests ${contextualHint}]`,
            preparation: `[${characterName} carefully gathers what they'll need for the journey ahead, sensing that preparation now could determine success later. Recent conversation indicates ${contextualHint}]`,
            challenges: `[${characterName} confronts a series of trials that push them beyond their comfort zone. The ongoing dialogue reveals ${contextualHint}]`,
            climax: `[${characterName} faces the ultimate test that will define who they become. Recent developments point to ${contextualHint}]`,

            hook: `[${characterName} notices a detail that doesn't quite fit, suggesting something significant is about to be revealed. Chat analysis shows ${contextualHint}]`,
            investigation: `[${characterName} pieces together clues that paint an increasingly complex picture. Recent conversation patterns indicate ${contextualHint}]`,
            revelation: `[${characterName} uncovers a truth that changes their understanding of everything. The dialogue suggests ${contextualHint}]`,
            confrontation: `[${characterName} faces the person or truth they've been seeking. Recent developments point to ${contextualHint}]`,

            first_meeting: `[${characterName} encounters someone who immediately catches their attention in ways they didn't expect. Chat context suggests ${contextualHint}]`,
            bonding: `[${characterName} discovers shared interests and values that create an unexpected connection. Recent conversation indicates ${contextualHint}]`,
            test: `[${characterName}'s relationship faces a crucial test that reveals deeper truths. The ongoing dialogue reveals ${contextualHint}]`,
            growth: `[${characterName} emerges from their trials with a stronger, more authentic connection. Recent developments show ${contextualHint}]`,

            ordinary_world: `[${characterName} operates within the familiar rhythms of their established life, though subtle signs suggest change is coming. Chat analysis indicates ${contextualHint}]`,
            mentor: `[${characterName} encounters guidance from an unexpected source that offers new perspective. Recent conversation suggests ${contextualHint}]`,
            tests: `[${characterName} faces trials that reveal their true capabilities while forging important alliances. The dialogue points to ${contextualHint}]`,
            ordeal: `[${characterName} confronts their deepest fears and emerges transformed by the experience. Recent developments indicate ${contextualHint}]`,
            reward: `[${characterName} achieves something meaningful that validates their journey and growth. Chat context shows ${contextualHint}]`,
            return: `[${characterName} brings hard-won wisdom back to their world, forever changed by what they discovered. Recent conversation patterns suggest ${contextualHint}]`
        };

        return phasePlots[phase.name] || `[${characterName} continues to develop in ways that reflect their deepest nature and current circumstances, guided by the unfolding dynamics of their situation]`;
    }

    /**
     * Extract contextual hints from recent conversation
     * @param {Array} chatHistory - Recent chat history
     * @param {number} [maxMessages=3] - Maximum messages to analyze
     * @returns {string} Extracted context string
     */
    extractRecentContext(chatHistory, maxMessages = 3) {
        if (!chatHistory || chatHistory.length === 0) return '';

        const recentMessages = chatHistory.slice(-maxMessages);
        return recentMessages.map(msg => {
            // Nullish coalescing
            const speaker = msg.is_user ? 'User' : (msg.name ?? 'Character');
            return `${speaker}: ${msg.mes}`.substring(0, 100);
        }).join(' | ');
    }

    /**
     * Get contextual hint based on recent chat
     * @param {string} recentChat - The extracted recent chat context
     * @returns {string} A contextual hint string
     */
    getContextualHint(recentChat) {
        // Extract conversation dynamics from recent chat to enhance plot suggestions with relevant context
        const hints = [];

        // Add conversation-based dynamics
        const hasEmotional = recentChat.includes('feel') || recentChat.includes('emotion') || recentChat.includes('heart');
        const hasConflict = recentChat.includes('problem') || recentChat.includes('challenge') || recentChat.includes('difficult');
        const hasDiscovery = recentChat.includes('learn') || recentChat.includes('discover') || recentChat.includes('realize');
        const hasConnection = recentChat.includes('understand') || recentChat.includes('connect') || recentChat.includes('bond');

        if (hasEmotional) hints.push('emotional undercurrents');
        if (hasConflict) hints.push('mounting tension');
        if (hasDiscovery) hints.push('growing awareness');
        if (hasConnection) hints.push('deepening bonds');

        return hints.length > 0 ? hints.slice(0, 3).join(', ') : 'complex character motivations';
    }

    /**
     * Generate plot for a specific branch option using simplified context
     * @param {string} branch - The branch key
     * @param {Object} character - The character object
     * @param {Array} chatHistory - Recent chat history
     * @param {Object} [context={}] - Additional context
     * @returns {string} The generated plot text
     */
    generateBranchPlot(branch, character, chatHistory, context = {}) {
        // Generate branch-specific plot text that incorporates character traits and conversation dynamics
        // Nullish coalescing
        const characterName = character?.name ?? 'Character';

        // Extract recent chat context
        const recentChat = this.extractRecentContext(chatHistory);
        const contextualHint = this.getContextualHint(recentChat);

        const branchPlots = {
            // Romance branches with contextual enhancement
            friends_to_lovers: `[${characterName} and their trusted friend share a moment that reveals deeper feelings neither expected, while recent conversation suggests ${contextualHint}]`,
            enemies_to_lovers: `[${characterName} discovers unexpected vulnerability in their adversary, while chat dynamics reveal ${contextualHint}]`,
            strangers_to_lovers: `[${characterName} encounters someone whose presence immediately shifts their world perspective, with conversation patterns indicating ${contextualHint}]`,

            // Relationship development branches
            slow_burn: `[${characterName} nurtures a connection that grows stronger with each meaningful interaction, as recent dialogue shows ${contextualHint}]`,
            quick_connection: `[${characterName} experiences an immediate, profound bond that transcends the ordinary, while conversation suggests ${contextualHint}]`,
            friendship_first: `[${characterName} builds a foundation of trust and understanding that could evolve into something deeper, as chat analysis reveals ${contextualHint}]`,

            // Conflict types with character consideration
            external_obstacle: `[${characterName} faces formidable opposition from circumstances beyond their control, while recent conversation points to ${contextualHint}]`,
            internal_conflict: `[${characterName} wrestles with doubts that threaten their confidence and direction, as dialogue patterns suggest ${contextualHint}]`,
            misunderstanding: `[${characterName} navigates a communication breakdown that threatens to derail progress, while chat context shows ${contextualHint}]`,

            // Adventure discovery types
            mysterious_map: `[${characterName} uncovers a cryptic map or clue that promises adventure and revelation, with recent conversation indicating ${contextualHint}]`,
            urgent_quest: `[${characterName} receives a time-sensitive call to action that cannot be ignored, as dialogue dynamics reveal ${contextualHint}]`,
            accidental_discovery: `[${characterName} stumbles upon something significant through pure chance, while conversation patterns suggest ${contextualHint}]`,

            // Challenge types with character awareness
            physical_trials: `[${characterName} faces demanding challenges that test their physical and mental endurance, as recent chat shows ${contextualHint}]`,
            moral_dilemmas: `[${characterName} must navigate complex ethical choices that reveal their core values, with conversation indicating ${contextualHint}]`,
            mystery_solving: `[${characterName} pieces together clues in a puzzle that will unlock deeper truths, while dialogue suggests ${contextualHint}]`,

            // Hero's journey specific branches
            refusal: `[${characterName} initially resists the call to adventure, citing familiar fears and comforts, as conversation reveals ${contextualHint}]`,
            crossing_threshold: `[${characterName} commits to the journey despite uncertainty, with recent dialogue showing ${contextualHint}]`
        };

        return branchPlots[branch] || `[${characterName} explores new narrative possibilities that align with their deepest motivations and current circumstances, guided by ${contextualHint}]`;
    }

    /**
     * Format branch name for display
     * @param {string} branch - The raw branch name
     * @returns {string} Formatted display name
     */
    formatBranchName(branch) {
        return branch.split('_').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    /**
     * Calculate current arc progress as percentage
     * @returns {number} Progress percentage (0-100)
     */
    calculateArcProgress() {
        // Calculate progress as percentage based on current phase index vs total phases
        if (!this.currentArc) return 0;

        // Optional chaining
        const totalPhases = this.currentArc.template?.phases?.length || 1;
        const currentProgress = this.currentArc.phaseIndex / totalPhases;
        return Math.round(currentProgress * 100);
    }

    /**
     * Make a choice in the current arc
     * @param {Object} choice - The choice object
     * @returns {boolean} True if choice was processed
     */
    makeChoice(choice) {
        if (!this.currentArc) return false;

        this.currentArc.choices.push({
            type: choice.type,
            choice: choice.choice,
            timestamp: Date.now()
        });

        // Handle different choice types
        if (choice.type === 'branching' && choice.choice) {
            this.currentArc.branch = choice.choice;
            logger.log(`Arc branch selected: ${choice.choice}`);
        }

        logger.log(`Arc choice made:`, choice);
        return true;
    }

    /**
     * Advance to next phase in the arc
     * @returns {boolean} True if phase advanced or arc completed
     */
    advancePhase() {
        if (!this.currentArc) return false;

        const phases = this.currentArc.template?.phases || [];
        const currentPhase = phases[this.currentArc.phaseIndex];
        
        if (currentPhase) {
            this.storyProgress.completedPhases.push(currentPhase.name);
        }

        // Move to next phase
        this.currentArc.phaseIndex++;

        if (this.currentArc.phaseIndex >= phases.length) {
            logger.log(`Arc completed: ${this.currentArc.name}`);
            this.arcHistory.push({ ...this.currentArc });
            this.currentArc = null;
            return true;
        }

        this.currentArc.currentPhase = phases[this.currentArc.phaseIndex];
        this.storyProgress.currentPhase = this.currentArc.currentPhase.name;

        logger.log(`Advanced to phase: ${this.currentArc.currentPhase.name}`);
        return true;
    }

    /**
     * Get current arc status
     * @returns {Object} Status object
     */
    getArcStatus() {
        return {
            hasActiveArc: !!this.currentArc,
            // Optional chaining and nullish coalescing
            arcType: this.currentArc?.type ?? null,
            arcName: this.currentArc?.name ?? null,
            currentPhase: this.currentArc?.currentPhase?.name ?? null,
            progress: this.calculateArcProgress(),
            totalPhases: this.currentArc?.template?.phases?.length ?? 0,
            currentPhaseIndex: this.currentArc?.phaseIndex ?? 0,
            storyProgress: this.storyProgress,
            completedArcs: this.arcHistory.length
        };
    }

    /**
     * Reset arc system
     * @returns {void}
     */
    reset() {
        this.currentArc = null;
        this.arcHistory = [];
        this.activeBranches.clear();
        this.storyProgress = {
            currentPhase: 'introduction',
            milestones: [],
            completedPhases: [],
            arcType: 'natural'
        };
        logger.log('Narrative arc system reset');
    }
}