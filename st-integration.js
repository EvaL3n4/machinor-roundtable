// Machinor Roundtable - SillyTavern Deep Integration Module
import { getContext } from "../../../extensions.js";

/**
 * SillyTavern Integration Manager
 * Handles deep integration with SillyTavern's core features
 */
export class STIntegrationManager {
    constructor() {
        this.worldInfo = null;
        this.currentWorldId = null;
        this.multiCharacterMode = false;
        this.characterRelationships = new Map();
        this.contextData = null;
        
        console.log('[Machinor Roundtable] ST Integration Manager initialized');
    }

    /**
     * Initialize ST integration and start listening to events
     */
    initialize() {
        this.loadWorldInfo();
        this.setupEventListeners();
        console.log('[Machinor Roundtable] ST Integration initialized');
    }

    /**
     * Load world info from the current context
     */
    loadWorldInfo() {
        try {
            const context = getContext();
            if (!context) {
                console.log('[Machinor Roundtable] No context available for world info');
                return null;
            }

            this.contextData = context;
            
            // Check if world info is available in the context
            if (context.worlds && context.worldInfo) {
                this.worldInfo = context.worldInfo;
                this.currentWorldId = context.worldId || context.world_name;
                console.log('[Machinor Roundtable] World info loaded:', {
                    worldId: this.currentWorldId,
                    infoEntries: this.worldInfo ? Object.keys(this.worldInfo).length : 0
                });
            }

            // Check for world info in global SillyTavern object
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                const stContext = SillyTavern.getContext();
                if (stContext && stContext.worlds) {
                    console.log('[Machinor Roundtable] Found worlds in ST context:', Object.keys(stContext.worlds));
                }
            }

            return this.worldInfo;
        } catch (error) {
            console.error('[Machinor Roundtable] Error loading world info:', error);
            return null;
        }
    }

    /**
     * Get current world info for plot generation
     */
    getWorldInfo() {
        if (!this.worldInfo) {
            this.loadWorldInfo();
        }
        
        if (!this.worldInfo || Object.keys(this.worldInfo).length === 0) {
            return null;
        }

        // Convert world info to a readable format for plot generation
        const worldContext = {
            locations: [],
            items: [],
            organizations: [],
            lore: [],
            characters: [],
            rules: []
        };

        // Parse world info entries
        Object.entries(this.worldInfo).forEach(([key, entry]) => {
            try {
                const info = typeof entry === 'string' ? JSON.parse(entry) : entry;
                
                // Categorize world info entries
                if (info.content) {
                    const content = info.content.toLowerCase();
                    const entryKey = key.toLowerCase();
                    
                    // Simple categorization based on content and key
                    if (content.includes('location') || content.includes('place') || 
                        entryKey.includes('location') || entryKey.includes('place')) {
                        worldContext.locations.push({
                            name: info.name || key,
                            description: info.content,
                            key: key
                        });
                    } else if (content.includes('item') || content.includes('object') ||
                              entryKey.includes('item') || entryKey.includes('object')) {
                        worldContext.items.push({
                            name: info.name || key,
                            description: info.content,
                            key: key
                        });
                    } else if (content.includes('organization') || content.includes('group') ||
                              entryKey.includes('organization') || entryKey.includes('group')) {
                        worldContext.organizations.push({
                            name: info.name || key,
                            description: info.content,
                            key: key
                        });
                    } else if (content.includes('lore') || content.includes('history') ||
                              entryKey.includes('lore') || entryKey.includes('history')) {
                        worldContext.lore.push({
                            name: info.name || key,
                            description: info.content,
                            key: key
                        });
                    } else if (content.includes('rule') || content.includes('law') ||
                              entryKey.includes('rule') || entryKey.includes('law')) {
                        worldContext.rules.push({
                            name: info.name || key,
                            description: info.content,
                            key: key
                        });
                    }
                }
            } catch (parseError) {
                console.warn('[Machinor Roundtable] Could not parse world info entry:', key, parseError);
            }
        });

        console.log('[Machinor Roundtable] World context compiled:', {
            locations: worldContext.locations.length,
            items: worldContext.items.length,
            organizations: worldContext.organizations.length,
            lore: worldContext.lore.length,
            rules: worldContext.rules.length
        });

        return worldContext;
    }

    /**
     * Enhanced character detection for multi-character scenarios
     */
    getActiveCharacters() {
        const context = getContext();
        if (!context) return [];

        const characters = [];
        
        // Check for group chat
        if (context.groupId && context.groups && context.characters) {
            this.multiCharacterMode = true;
            
            // Find the current group
            const group = context.groups.find(g => g.id === context.groupId);
            if (group && group.members) {
                // Get all characters in the group
                group.members.forEach(memberId => {
                    const character = context.characters.find(c => c.avatar === memberId);
                    if (character) {
                        characters.push({
                            ...character,
                            isGroupMember: true,
                            groupRole: this.getCharacterGroupRole(character, group)
                        });
                    }
                });
            }
        } else {
            // Single character mode
            this.multiCharacterMode = false;
            const currentChar = context.characters?.[context.characterId];
            if (currentChar) {
                characters.push({
                    ...currentChar,
                    isGroupMember: false
                });
            }
        }

        console.log('[Machinor Roundtable] Active characters:', {
            count: characters.length,
            isGroup: this.multiCharacterMode,
            characterNames: characters.map(c => c.name)
        });

        return characters;
    }

    /**
     * Determine character role within a group
     */
    getCharacterGroupRole(character, group) {
        // Simple role detection based on character properties
        if (character.personality) {
            const personality = character.personality.toLowerCase();
            if (personality.includes('leader') || personality.includes('leader')) {
                return 'leader';
            } else if (personality.includes('follower') || personality.includes('support')) {
                return 'supporter';
            } else if (personality.includes('wise') || personality.includes('mentor')) {
                return 'mentor';
            }
        }
        
        return 'member';
    }

    /**
     * Deep character profile analysis
     */
    analyzeCharacterProfile(character) {
        if (!character) return null;

        const analysis = {
            traits: this.extractPersonalityTraits(character),
            backstory: this.extractBackstory(character),
            motivations: this.extractMotivations(character),
            fears: this.extractFears(character),
            speechPattern: this.analyzeSpeechPattern(character),
            relationships: this.getCharacterRelationships(character),
            arcPotential: this.assessArcPotential(character)
        };

        console.log(`[Machinor Roundtable] Character analysis for ${character.name}:`, {
            traits: analysis.traits.length,
            backstory: analysis.backstory.length,
            motivations: analysis.motivations.length,
            arcPotential: analysis.arcPotential
        });

        return analysis;
    }

    /**
     * Extract personality traits from character data
     */
    extractPersonalityTraits(character) {
        const traits = [];
        
        if (character.personality) {
            // Parse personality description for traits
            const personalityText = character.personality.toLowerCase();
            const commonTraits = [
                'kind', 'cruel', 'brave', 'cowardly', 'loyal', 'betrayer',
                'mysterious', 'outgoing', 'shy', 'confident', 'intelligent',
                'wise', 'foolish', 'patient', 'impatient', 'generous', 'selfish',
                'honest', 'deceitful', 'optimistic', 'pessimistic', 'calm', 'anxious',
                'creative', 'practical', 'dreamer', 'realist'
            ];

            commonTraits.forEach(trait => {
                if (personalityText.includes(trait)) {
                    traits.push(trait);
                }
            });
        }

        return traits;
    }

    /**
     * Extract backstory elements
     */
    extractBackstory(character) {
        const backstory = [];
        
        if (character.description) {
            // Look for backstory indicators
            const description = character.description.toLowerCase();
            const backstoryPatterns = [
                /was\s+(\w+)/g,
                /used\s+to\s+(\w+)/g,
                /formerly\s+(\w+)/g,
                /worked\s+as\s+(\w+)/g,
                /came\s+from\s+(\w+)/g,
                /lost\s+(\w+)/g,
                /found\s+(\w+)/g
            ];

            backstoryPatterns.forEach(pattern => {
                let match;
                while ((match = pattern.exec(description)) !== null) {
                    backstory.push(match[0]);
                }
            });
        }

        return backstory;
    }

    /**
     * Extract character motivations
     */
    extractMotivations(character) {
        const motivations = [];
        
        if (character.personality || character.description) {
            const text = `${character.personality || ''} ${character.description || ''}`.toLowerCase();
            const motivationKeywords = [
                'want', 'desire', 'need', 'goal', 'ambition', 'dream',
                'seek', 'search', 'pursue', 'achieve', 'prove', 'protect',
                'avenge', 'save', 'help', 'serve', 'rule', 'lead'
            ];

            motivationKeywords.forEach(keyword => {
                if (text.includes(keyword)) {
                    motivations.push(keyword);
                }
            });
        }

        return motivations;
    }

    /**
     * Extract character fears
     */
    extractFears(character) {
        const fears = [];
        
        if (character.personality || character.description) {
            const text = `${character.personality || ''} ${character.description || ''}`.toLowerCase();
            const fearKeywords = [
                'fear', 'afraid', 'scared', 'terrified', 'hate', 'avoid',
                'dread', 'worried', 'anxious', 'panic', 'frightened'
            ];

            fearKeywords.forEach(keyword => {
                if (text.includes(keyword)) {
                    fears.push(keyword);
                }
            });
        }

        return fears;
    }

    /**
     * Analyze speech pattern indicators
     */
    analyzeSpeechPattern(character) {
        const pattern = {
            formality: 'unknown',
            emotion: 'neutral',
            complexity: 'medium'
        };

        if (character.personality) {
            const personality = character.personality.toLowerCase();
            
            // Formality detection
            if (personality.includes('formal') || personality.includes('proper')) {
                pattern.formality = 'formal';
            } else if (personality.includes('casual') || personality.includes('relaxed')) {
                pattern.formality = 'casual';
            }

            // Emotional tone detection
            if (personality.includes('cheerful') || personality.includes('happy')) {
                pattern.emotion = 'positive';
            } else if (personality.includes('gloomy') || personality.includes('sad')) {
                pattern.emotion = 'negative';
            } else if (personality.includes('angry') || personality.includes('hostile')) {
                pattern.emotion = 'aggressive';
            }

            // Complexity detection
            if (personality.includes('simple') || personality.includes('direct')) {
                pattern.complexity = 'simple';
            } else if (personality.includes('complex') || personality.includes('detailed')) {
                pattern.complexity = 'complex';
            }
        }

        return pattern;
    }

    /**
     * Get character relationships (placeholder for future relationship tracking)
     */
    getCharacterRelationships(character) {
        const key = character.avatar || character.name;
        return this.characterRelationships.get(key) || {};
    }

    /**
     * Assess character arc potential
     */
    assessArcPotential(character) {
        let score = 0;
        
        if (character.personality) score += 1;
        if (character.description) score += 2;
        if (character.backstory) score += 2;
        if (character.scenario) score += 1;
        
        // Higher score means more development potential
        if (score >= 5) return 'high';
        if (score >= 3) return 'medium';
        return 'low';
    }

    /**
     * Setup event listeners for ST integration
     */
    setupEventListeners() {
        if (typeof eventSource !== 'undefined') {
            // Listen for character changes
            eventSource.on('character_selected', (data) => {
                console.log('[Machinor Roundtable] Character changed, refreshing data...');
                this.loadWorldInfo();
                this.analyzeActiveCharacters();
            });

            // Listen for chat changes
            eventSource.on('chat_changed', (data) => {
                console.log('[Machinor Roundtable] Chat changed, updating context...');
                this.loadWorldInfo();
            });

            // Listen for world changes
            eventSource.on('world_changed', (data) => {
                console.log('[Machinor Roundtable] World changed, reloading world info...');
                this.worldInfo = null;
                this.currentWorldId = null;
                this.loadWorldInfo();
            });
        }

        console.log('[Machinor Roundtable] ST event listeners setup complete');
    }

    /**
     * Analyze all active characters
     */
    analyzeActiveCharacters() {
        const characters = this.getActiveCharacters();
        const analysis = {};
        
        characters.forEach(character => {
            analysis[character.avatar || character.name] = this.analyzeCharacterProfile(character);
        });

        console.log('[Machinor Roundtable] Active characters analyzed:', analysis);
        return analysis;
    }

    /**
     * Get integration status for debugging
     */
    getStatus() {
        const context = getContext();
        return {
            worldInfoAvailable: !!this.worldInfo,
            currentWorldId: this.currentWorldId,
            multiCharacterMode: this.multiCharacterMode,
            contextAvailable: !!context,
            hasWorlds: !!(context?.worlds),
            hasGroupId: !!(context?.groupId),
            activeCharacters: this.getActiveCharacters().length
        };
    }
}