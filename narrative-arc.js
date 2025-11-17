// Machinor Roundtable - Narrative Arc System
import { getContext } from "../../../extensions.js";
import { generateQuietPrompt } from "../../../../script.js";

/**
 * Narrative Arc Manager
 * Handles story structure templates and plot branching
 */
export class NarrativeArcManager {
    constructor(stIntegration = null) {
        this.stIntegration = stIntegration;
        this.currentArc = null;
        this.arcHistory = [];
        this.activeBranches = new Map();
        this.arcTemplates = this.initializeTemplates();
        this.storyProgress = {
            currentPhase: 'introduction',
            milestones: [],
            completedPhases: [],
            arcType: 'natural'
        };
        
        console.log('[Machinor Roundtable] Narrative Arc Manager initialized');
    }

    /**
     * Initialize story arc templates
     */
    initializeTemplates() {
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
     */
    startArc(arcType = 'natural', character = null) {
        const template = this.arcTemplates[arcType];
        if (!template) {
            console.warn(`[Machinor Roundtable] Unknown arc type: ${arcType}`);
            return false;
        }

        this.currentArc = {
            type: arcType,
            name: template.name,
            currentPhase: template.phases[0],
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

        console.log(`[Machinor Roundtable] Started ${template.name} arc with ${character?.name || 'unknown character'}`);
        return true;
    }

    /**
     * Get plot direction suggestions based on current arc state
     */
    getPlotSuggestions(character, chatHistory = [], context = {}) {
        if (!this.currentArc) {
            // Suggest arc type based on character and context
            return this.suggestArcType(character, chatHistory, context);
        }

        const suggestions = [];
        const currentPhase = this.currentArc.template.phases[this.currentArc.phaseIndex];
        const nextPhases = this.currentArc.template.phases.slice(this.currentArc.phaseIndex + 1);

        // Generate suggestions for current phase
        suggestions.push({
            type: 'phase_continuation',
            phase: currentPhase.name,
            description: `Continue ${currentPhase.description}`,
            text: this.generatePhasePlot(currentPhase, character, chatHistory),
            arcProgress: this.calculateArcProgress()
        });

        // Add branch suggestions if available
        const branches = this.currentArc.template.branching?.filter(b => b.from === currentPhase.name) || [];
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
     */
    suggestArcType(character, chatHistory, context) {
        const suggestions = [];

        // Analyze character for genre preferences
        const charAnalysis = this.stIntegration?.analyzeCharacterProfile(character);
        const personality = (character?.personality || '').toLowerCase();
        const description = (character?.description || '').toLowerCase();

        // Romance suggestions
        if (personality.includes('romantic') || personality.includes('love') || 
            description.includes('relationship') || description.includes('romance')) {
            suggestions.push({
                type: 'arc_suggestion',
                arcType: 'romance',
                name: 'Romance Arc',
                description: 'Develop a romantic relationship',
                text: '[Character feels drawn to explore deeper romantic feelings]',
                arcProgress: 0
            });
        }

        // Adventure suggestions
        if (personality.includes('brave') || personality.includes('adventurous') || 
            personality.includes('explorer') || description.includes('quest')) {
            suggestions.push({
                type: 'arc_suggestion',
                arcType: 'adventure',
                name: 'Adventure Arc',
                description: 'Embark on an exciting quest',
                text: '[Character feels called to an important adventure]',
                arcProgress: 0
            });
        }

        // Mystery suggestions
        if (personality.includes('curious') || personality.includes('detective') || 
            description.includes('mystery') || description.includes('investigate')) {
            suggestions.push({
                type: 'arc_suggestion',
                arcType: 'mystery',
                name: 'Mystery Arc',
                description: 'Solve an intriguing mystery',
                text: '[Character notices clues that suggest a larger mystery]',
                arcProgress: 0
            });
        }

        // Friendship suggestions
        if (personality.includes('friendly') || personality.includes('loyal') || 
            description.includes('friend')) {
            suggestions.push({
                type: 'arc_suggestion',
                arcType: 'friendship',
                name: 'Friendship Arc',
                description: 'Build a strong friendship',
                text: '[Character feels inclined to form a meaningful connection]',
                arcProgress: 0
            });
        }

        // Default to natural progression if no strong suggestions
        if (suggestions.length === 0) {
            suggestions.push({
                type: 'arc_suggestion',
                arcType: 'natural',
                name: 'Natural Progression',
                description: 'Let the story develop organically',
                text: '[Character continues to develop naturally within the current situation]',
                arcProgress: 0
            });
        }

        return suggestions.slice(0, 2); // Limit to 2 suggestions
    }

    /**
     * Generate plot text for a specific phase using LLM character analysis
     */
    async generatePhasePlot(phase, character, chatHistory, context = {}) {
        const characterName = character?.name || 'Character';
        const phaseName = phase.name.replace('_', ' ');
        
        // Run LLM character analysis first
        const characterAnalysis = await this.analyzeCharacterForPlot(character);
        
        // Extract recent chat context
        const recentChat = this.extractRecentContext(chatHistory);
        
        const phasePlots = {
            introduction: `[${characterName} takes in their new surroundings, aware that everything is about to change. Recent conversation suggests ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            getting_to_know: `[${characterName} discovers layers to their situation that weren't obvious at first. The conversation patterns indicate ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            complication: `[${characterName} faces an unexpected obstacle that threatens to derail their progress. Recent developments suggest ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            tension: `[${characterName} experiences mounting pressure as stakes escalate. The conversation dynamics reveal ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            resolution: `[${characterName} reaches a pivotal moment that changes everything. The ongoing dialogue points to ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            
            call_to_adventure: `[${characterName} receives an irresistible summons that promises to test everything they thought they knew about themselves. Chat context suggests ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            preparation: `[${characterName} carefully gathers what they'll need for the journey ahead, sensing that preparation now could determine success later. Recent conversation indicates ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            challenges: `[${characterName} confronts a series of trials that push them beyond their comfort zone. The ongoing dialogue reveals ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            climax: `[${characterName} faces the ultimate test that will define who they become. Recent developments point to ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            
            hook: `[${characterName} notices a detail that doesn't quite fit, suggesting something significant is about to be revealed. Chat analysis shows ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            investigation: `[${characterName} pieces together clues that paint an increasingly complex picture. Recent conversation patterns indicate ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            revelation: `[${characterName} uncovers a truth that changes their understanding of everything. The dialogue suggests ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            confrontation: `[${characterName} faces the person or truth they've been seeking. Recent developments point to ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            
            first_meeting: `[${characterName} encounters someone who immediately catches their attention in ways they didn't expect. Chat context suggests ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            bonding: `[${characterName} discovers shared interests and values that create an unexpected connection. Recent conversation indicates ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            test: `[${characterName}'s relationship faces a crucial test that reveals deeper truths. The ongoing dialogue reveals ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            growth: `[${characterName} emerges from their trials with a stronger, more authentic connection. Recent developments show ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            
            ordinary_world: `[${characterName} operates within the familiar rhythms of their established life, though subtle signs suggest change is coming. Chat analysis indicates ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            mentor: `[${characterName} encounters guidance from an unexpected source that offers new perspective. Recent conversation suggests ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            tests: `[${characterName} faces trials that reveal their true capabilities while forging important alliances. The dialogue points to ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            ordeal: `[${characterName} confronts their deepest fears and emerges transformed by the experience. Recent developments indicate ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            reward: `[${characterName} achieves something meaningful that validates their journey and growth. Chat context shows ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            return: `[${characterName} brings hard-won wisdom back to their world, forever changed by what they discovered. Recent conversation patterns suggest ${this.getContextualHint(recentChat, character, characterAnalysis)}]`
        };

        return phasePlots[phase.name] || `[${characterName} continues to develop in ways that reflect their deepest nature and current circumstances, guided by the unfolding dynamics of their situation]`;
    }

    /**
     * Extract contextual hints from recent conversation and character traits
     */
    extractRecentContext(chatHistory, maxMessages = 3) {
        if (!chatHistory || chatHistory.length === 0) return '';
        
        const recentMessages = chatHistory.slice(-maxMessages);
        return recentMessages.map(msg => {
            const speaker = msg.is_user ? 'User' : msg.name || 'Character';
            return `${speaker}: ${msg.mes}`.substring(0, 100);
        }).join(' | ');
    }

    /**
     * LLM-powered character analysis that returns simple classification labels
     * This replaces rigid keyword matching with intelligent language understanding
     */
    async analyzeCharacterForPlot(character) {
        try {
            const description = character?.description || '';
            const personality = character?.personality || '';
            const name = character?.name || 'Character';
            
            // Skip analysis if minimal character data
            if (!description && !personality) {
                return { labels: ['neutral'], confidence: 0.5 };
            }
            
            const analysisPrompt = `Analyze this character for plot generation purposes. Based on their description and personality, identify the most relevant narrative themes and character motivations.

CHARACTER: ${name}
DESCRIPTION: ${description || 'Not specified'}
PERSONALITY: ${personality || 'Not specified'}

TASK: Return a simple comma-separated list of 2-4 key labels that best describe this character's narrative potential. Choose from:
- romantic (relationships, love, attraction)
- adventurous (quests, exploration, challenges)
- mysterious (secrets, unknowns, investigation)
- conflictual (rivalry, opposition, tension)
- heroic (leadership, courage, responsibility)
- comedic (humor, lightheartedness, amusement)
- tragic (sacrifice, loss, downfall)
- philosophical (wisdom, meaning, introspection)
- supernatural (magic, mystical, otherworldly)
- social (community, relationships, bonds)

Return ONLY the labels separated by commas, nothing else. Examples:
"romantic, mysterious"
"adventurous, heroic"
"conflictual, supernatural"

CHARACTER ANALYSIS:`;

            // Use imported LLM function for character analysis
            const analysisResult = await generateQuietPrompt({
                quietPrompt: analysisPrompt,
                skipWIAN: true,
                removeReasoning: true,
                trimToSentence: false
            });
            
            // Clean and parse the result
            const cleanResult = analysisResult
                .toLowerCase()
                .replace(/[^a-z,\s]/g, '')
                .trim();
            
            const labels = cleanResult
                .split(',')
                .map(label => label.trim())
                .filter(label => label.length > 0)
                .slice(0, 4); // Limit to 4 labels max
            
            console.log(`[Narrative Arc] Character analysis for ${name}:`, labels);
            
            return {
                labels: labels.length > 0 ? labels : ['neutral'],
                confidence: labels.length > 0 ? 0.8 : 0.5
            };
            
        } catch (error) {
            console.error('[Narrative Arc] Character analysis failed:', error);
            return { labels: ['neutral'], confidence: 0.3 };
        }
    }

    /**
     * Get contextual hint based on recent chat and LLM character analysis
     */
    getContextualHint(recentChat, character, characterAnalysis = null) {
        // Use LLM analysis labels if available, fallback to neutral
        const labels = characterAnalysis?.labels || ['neutral'];
        const hints = [];
        
        // Map LLM labels to narrative hints
        const labelToHints = {
            'romantic': ['romantic tension', 'emotional connections', 'relationship dynamics'],
            'adventurous': ['thrill-seeking energy', 'quest opportunities', 'heroic challenges'],
            'mysterious': ['hidden depths', 'intriguing unknowns', 'secrets waiting to be revealed'],
            'conflictual': ['mounting tension', 'rivalry potential', 'opposition dynamics'],
            'heroic': ['leadership opportunities', 'courage-testing moments', 'responsibility pressures'],
            'comedic': ['amusing complications', 'lighthearted situations', 'humorous misunderstandings'],
            'tragic': ['sacrifice possibilities', 'loss and redemption', 'tragic consequences'],
            'philosophical': ['deep reflection', 'meaning-seeking moments', 'wisdom challenges'],
            'supernatural': ['mystical elements', 'otherworldly influences', 'magical possibilities'],
            'social': ['community bonds', 'relationship building', 'group dynamics'],
            'neutral': ['natural story progression', 'character development', 'authentic reactions']
        };
        
        // Convert labels to narrative hints
        labels.forEach(label => {
            const possibleHints = labelToHints[label] || [];
            if (possibleHints.length > 0) {
                // Add some variety by randomly selecting from available hints
                const randomHint = possibleHints[Math.floor(Math.random() * possibleHints.length)];
                hints.push(randomHint);
            }
        });
        
        // Add conversation-based dynamics
        const hasEmotional = recentChat.includes('feel') || recentChat.includes('emotion') || recentChat.includes('heart');
        const hasConflict = recentChat.includes('problem') || recentChat.includes('challenge') || recentChat.includes('difficult');
        const hasDiscovery = recentChat.includes('learn') || recentChat.includes('discover') || recentChat.includes('realize');
        const hasConnection = recentChat.includes('understand') || recentChat.includes('connect') || recentChat.includes('bond');
        
        if (hasEmotional && !hints.some(h => h.includes('emotional'))) hints.push('emotional undercurrents');
        if (hasConflict && !hints.some(h => h.includes('tension'))) hints.push('mounting tension');
        if (hasDiscovery && !hints.some(h => h.includes('reveal'))) hints.push('growing awareness');
        if (hasConnection && !hints.some(h => h.includes('relationship'))) hints.push('deepening bonds');
        
        return hints.length > 0 ? hints.slice(0, 3).join(', ') : 'complex character motivations';
    }

    /**
     * Generate plot for a specific branch option using LLM character analysis
     */
    async generateBranchPlot(branch, character, chatHistory, context = {}) {
        const characterName = character?.name || 'Character';
        
        // Run LLM character analysis first
        const characterAnalysis = await this.analyzeCharacterForPlot(character);
        
        // Extract recent chat context
        const recentChat = this.extractRecentContext(chatHistory);
        
        const branchPlots = {
            // Romance branches with contextual enhancement
            friends_to_lovers: `[${characterName} and their trusted friend share a moment that reveals deeper feelings neither expected, while recent conversation suggests ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            enemies_to_lovers: `[${characterName} discovers unexpected vulnerability in their adversary, while chat dynamics reveal ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            strangers_to_lovers: `[${characterName} encounters someone whose presence immediately shifts their world perspective, with conversation patterns indicating ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            
            // Relationship development branches
            slow_burn: `[${characterName} nurtures a connection that grows stronger with each meaningful interaction, as recent dialogue shows ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            quick_connection: `[${characterName} experiences an immediate, profound bond that transcends the ordinary, while conversation suggests ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            friendship_first: `[${characterName} builds a foundation of trust and understanding that could evolve into something deeper, as chat analysis reveals ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            
            // Conflict types with character consideration
            external_obstacle: `[${characterName} faces formidable opposition from circumstances beyond their control, while recent conversation points to ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            internal_conflict: `[${characterName} wrestles with doubts that threaten their confidence and direction, as dialogue patterns suggest ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            misunderstanding: `[${characterName} navigates a communication breakdown that threatens to derail progress, while chat context shows ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            
            // Adventure discovery types
            mysterious_map: `[${characterName} uncovers a cryptic map or clue that promises adventure and revelation, with recent conversation indicating ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            urgent_quest: `[${characterName} receives a time-sensitive call to action that cannot be ignored, as dialogue dynamics reveal ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            accidental_discovery: `[${characterName} stumbles upon something significant through pure chance, while conversation patterns suggest ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            
            // Challenge types with character awareness
            physical_trials: `[${characterName} faces demanding challenges that test their physical and mental endurance, as recent chat shows ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            moral_dilemmas: `[${characterName} must navigate complex ethical choices that reveal their core values, with conversation indicating ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            mystery_solving: `[${characterName} pieces together clues in a puzzle that will unlock deeper truths, while dialogue suggests ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            
            // Hero's journey specific branches
            refusal: `[${characterName} initially resists the call to adventure, citing familiar fears and comforts, as conversation reveals ${this.getContextualHint(recentChat, character, characterAnalysis)}]`,
            crossing_threshold: `[${characterName} commits to the journey despite uncertainty, with recent dialogue showing ${this.getContextualHint(recentChat, character, characterAnalysis)}]`
        };

        return branchPlots[branch] || `[${characterName} explores new narrative possibilities that align with their deepest motivations and current circumstances, guided by ${this.getContextualHint(recentChat, character, characterAnalysis)}]`;
    }

    /**
     * Format branch name for display
     */
    formatBranchName(branch) {
        return branch.split('_').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    /**
     * Calculate current arc progress as percentage
     */
    calculateArcProgress() {
        if (!this.currentArc) return 0;
        
        const totalPhases = this.currentArc.template.phases.length;
        const currentProgress = this.currentArc.phaseIndex / totalPhases;
        return Math.round(currentProgress * 100);
    }

    /**
     * Make a choice in the current arc
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
            console.log(`[Machinor Roundtable] Arc branch selected: ${choice.choice}`);
        }

        console.log(`[Machinor Roundtable] Arc choice made:`, choice);
        return true;
    }

    /**
     * Advance to next phase in the arc
     */
    advancePhase() {
        if (!this.currentArc) return false;

        const currentPhase = this.currentArc.template.phases[this.currentArc.phaseIndex];
        this.storyProgress.completedPhases.push(currentPhase.name);

        // Move to next phase
        this.currentArc.phaseIndex++;
        
        if (this.currentArc.phaseIndex >= this.currentArc.template.phases.length) {
            console.log(`[Machinor Roundtable] Arc completed: ${this.currentArc.name}`);
            this.arcHistory.push({ ...this.currentArc });
            this.currentArc = null;
            return true;
        }

        this.currentArc.currentPhase = this.currentArc.template.phases[this.currentArc.phaseIndex];
        this.storyProgress.currentPhase = this.currentArc.currentPhase.name;
        
        console.log(`[Machinor Roundtable] Advanced to phase: ${this.currentArc.currentPhase.name}`);
        return true;
    }

    /**
     * Get current arc status
     */
    getArcStatus() {
        return {
            hasActiveArc: !!this.currentArc,
            arcType: this.currentArc?.type || null,
            arcName: this.currentArc?.name || null,
            currentPhase: this.currentArc?.currentPhase?.name || null,
            progress: this.calculateArcProgress(),
            totalPhases: this.currentArc?.template?.phases?.length || 0,
            currentPhaseIndex: this.currentArc?.phaseIndex || 0,
            storyProgress: this.storyProgress,
            completedArcs: this.arcHistory.length
        };
    }

    /**
     * Reset arc system
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
        console.log('[Machinor Roundtable] Narrative arc system reset');
    }
}