// Machinor Roundtable - SillyTavern Deep Integration Module
import { getContext } from "../../../extensions.js";
import { eventSource, event_types, this_chid, characters, chat, isChatSaving, chat_metadata } from "../../../../script.js";

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
        this.isChatReady = false;

        // Event emitters for internal extension communication
        this.eventListeners = new Map();

        console.log('[Machinor Roundtable] ST Integration Manager initialized');
    }

    /**
     * Initialize ST integration and start listening to events
     * @returns {Promise<void>} Resolves when initial setup is complete
     */
    async initialize() {
        this.setupEventListeners();
        console.log('[Machinor Roundtable] ST Integration initialized');

        // Check initial state
        this.checkChatReadiness('Initial Load');
    }

    /**
     * Subscribe to internal events
     * @param {string} event - Event name (e.g., 'chat_ready')
     * @param {Function} callback - Callback function
     */
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }

    /**
     * Emit internal event
     * @param {string} event - Event name
     * @param {any} data - Event data
     */
    emit(event, data) {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(callback => callback(data));
        }
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

            // Listen for chat load events
            eventSource.on('chat_id_changed', (chatId) => {
                console.log('[Machinor Roundtable] Chat ID changed:', chatId);
                this.isChatReady = false; // Reset ready state
                this.checkChatReadiness('Chat ID Changed');
            });

            if (typeof event_types !== 'undefined' && event_types.CHAT_LOADED) {
                eventSource.on(event_types.CHAT_LOADED, () => {
                    console.log('[Machinor Roundtable] Chat loaded event received');
                    this.checkChatReadiness('Chat Loaded Event');
                });
            }
        }
    }

    /**
     * Check if chat is fully ready and loaded
     * @param {string} source - Optional source identifier for debugging
     */
    /**
     * Check if chat is fully ready and loaded
     * @param {string} source - Optional source identifier for debugging
     */
    checkChatReadiness(source = 'Check') {
        // Use a microtask to allow current stack to finish
        queueMicrotask(() => {
            const context = getContext();

            // Robust check using core variables
            const isCoreReady =
                typeof this_chid !== 'undefined' &&
                characters[this_chid] !== undefined &&
                Array.isArray(chat) &&
                !isChatSaving &&
                chat_metadata &&
                chat_metadata.integrity;

            if (isCoreReady && context && context.chatId && context.characterId !== undefined) {
                if (!this.isChatReady) {
                    // Don't set isChatReady to true yet, wait for stability
                    console.log(`[Machinor Roundtable] ✅ Core ready (${source}). ID:`, context.chatId);
                    this.onChatReady(context);
                }
            } else {
                console.log(`[Machinor Roundtable] ⏳ Chat not ready (${source})`);
                this.isChatReady = false;
            }
        });
    }

    /**
     * Called when chat is confirmed ready
     * Uses stability checking instead of fixed timeout
     */
    onChatReady(context) {
        // Start stability checking instead of fixed timeout
        this.waitForChatStability();
    }

    /**
     * Wait for chat to be fully loaded and stable before initializing
     * Polls context.chat and waits for message count to stabilize
     */
    waitForChatStability() {
        let lastMessageCount = -1;
        let stableCount = 0;
        const STABLE_CHECKS_REQUIRED = 3; // Messages must be stable for 3 checks
        const CHECK_INTERVAL = 300; // Check every 300ms

        const stabilityCheck = setInterval(() => {
            // Use direct chat array access for more reliability
            const currentMessageCount = Array.isArray(chat) ? chat.length : 0;

            // Empty chat means ST is still in preload phase
            if (currentMessageCount === 0) {
                console.log('[Machinor Roundtable] ⏳ Chat empty, waiting for messages to load...');
                lastMessageCount = 0;
                stableCount = 0;
                return;
            }

            // Check if message count is stable (hasn't changed)
            if (currentMessageCount === lastMessageCount) {
                stableCount++;
                console.log(`[Machinor Roundtable] 📊 Chat stable: ${currentMessageCount} messages (check ${stableCount}/${STABLE_CHECKS_REQUIRED})`);

                // If stable for required number of checks, we're good to go
                if (stableCount >= STABLE_CHECKS_REQUIRED) {
                    clearInterval(stabilityCheck);
                    console.log('[Machinor Roundtable] ✅ Chat fully loaded and stable with', currentMessageCount, 'messages');

                    // Small buffer to ensure any final saves complete
                    setTimeout(() => {
                        this.isChatReady = true;
                        this.emit('chat_ready', getContext());
                    }, 200);
                }
            } else {
                // Count changed, chat is still loading
                console.log(`[Machinor Roundtable] 📈 Chat loading: ${currentMessageCount} messages (was ${lastMessageCount})`);
                lastMessageCount = currentMessageCount;
                stableCount = 0;
            }
        }, CHECK_INTERVAL);

        // Absolute safety timeout after 10 seconds
        setTimeout(() => {
            const context = getContext();
            const messageCount = context?.chat?.length || 0;

            // Only initialize if we haven't already
            if (!this.isChatReady) {
                clearInterval(stabilityCheck);
                console.warn(`[Machinor Roundtable] ⚠️ Stability timeout reached after 10s with ${messageCount} messages - initializing anyway`);
                this.isChatReady = true;
                this.emit('chat_ready', context);
            }
        }, 10000);
    }

    /**
     * Load world info from the current context
     */
    loadWorldInfo() {
        try {
            const context = getContext();
            if (!context) return null;

            this.contextData = context;

            if (context.worlds && context.worldInfo) {
                this.worldInfo = context.worldInfo;
                this.currentWorldId = context.worldId || context.world_name;
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

                    if (content.includes('location') || content.includes('place') ||
                        entryKey.includes('location') || entryKey.includes('place')) {
                        worldContext.locations.push({ name: info.name || key, description: info.content });
                    } else if (content.includes('item') || content.includes('object') ||
                        entryKey.includes('item') || entryKey.includes('object')) {
                        worldContext.items.push({ name: info.name || key, description: info.content });
                    } else if (content.includes('organization') || content.includes('group') ||
                        entryKey.includes('organization') || entryKey.includes('group')) {
                        worldContext.organizations.push({ name: info.name || key, description: info.content });
                    } else if (content.includes('lore') || content.includes('history') ||
                        entryKey.includes('lore') || entryKey.includes('history')) {
                        worldContext.lore.push({ name: info.name || key, description: info.content });
                    } else if (content.includes('rule') || content.includes('law') ||
                        entryKey.includes('rule') || entryKey.includes('law')) {
                        worldContext.rules.push({ name: info.name || key, description: info.content });
                    }
                }
            } catch (parseError) {
                // Ignore parsing errors
            }
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
            const group = context.groups.find(g => g.id === context.groupId);
            if (group && group.members) {
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
            this.multiCharacterMode = false;
            const currentChar = context.characters?.[context.characterId];
            if (currentChar) {
                characters.push({
                    ...currentChar,
                    isGroupMember: false
                });
            }
        }

        return characters;
    }

    /**
     * Determine character role within a group
     */
    getCharacterGroupRole(character, group) {
        if (character.personality) {
            const personality = character.personality.toLowerCase();
            if (personality.includes('leader')) return 'leader';
            if (personality.includes('follower') || personality.includes('support')) return 'supporter';
            if (personality.includes('wise') || personality.includes('mentor')) return 'mentor';
        }
        return 'member';
    }

    /**
     * Deep character profile analysis
     */
    analyzeCharacterProfile(character) {
        if (!character) return null;

        return {
            traits: this.extractPersonalityTraits(character),
            backstory: this.extractBackstory(character),
            motivations: this.extractMotivations(character),
            fears: this.extractFears(character),
            speechPattern: this.analyzeSpeechPattern(character),
            relationships: this.getCharacterRelationships(character),
            arcPotential: this.assessArcPotential(character)
        };
    }

    extractPersonalityTraits(character) {
        const traits = [];
        if (character.personality) {
            const personalityText = character.personality.toLowerCase();
            const commonTraits = ['kind', 'cruel', 'brave', 'cowardly', 'loyal', 'betrayer', 'mysterious', 'outgoing', 'shy', 'confident', 'intelligent', 'wise', 'foolish', 'patient', 'impatient', 'generous', 'selfish', 'honest', 'deceitful', 'optimistic', 'pessimistic', 'calm', 'anxious', 'creative', 'practical', 'dreamer', 'realist'];
            commonTraits.forEach(trait => {
                if (personalityText.includes(trait)) traits.push(trait);
            });
        }
        return traits;
    }

    extractBackstory(character) {
        const backstory = [];
        if (character.description) {
            const description = character.description.toLowerCase();
            const patterns = [/was\s+(\w+)/g, /used\s+to\s+(\w+)/g, /formerly\s+(\w+)/g, /worked\s+as\s+(\w+)/g, /came\s+from\s+(\w+)/g, /lost\s+(\w+)/g, /found\s+(\w+)/g];
            patterns.forEach(pattern => {
                let match;
                while ((match = pattern.exec(description)) !== null) {
                    backstory.push(match[0]);
                }
            });
        }
        return backstory;
    }

    extractMotivations(character) {
        const motivations = [];
        if (character.personality || character.description) {
            const text = `${character.personality || ''} ${character.description || ''}`.toLowerCase();
            const keywords = ['want', 'desire', 'need', 'goal', 'ambition', 'dream', 'seek', 'search', 'pursue', 'achieve', 'prove', 'protect', 'avenge', 'save', 'help', 'serve', 'rule', 'lead'];
            keywords.forEach(keyword => {
                if (text.includes(keyword)) motivations.push(keyword);
            });
        }
        return motivations;
    }

    extractFears(character) {
        const fears = [];
        if (character.personality || character.description) {
            const text = `${character.personality || ''} ${character.description || ''}`.toLowerCase();
            const keywords = ['fear', 'afraid', 'scared', 'terrified', 'hate', 'avoid', 'dread', 'worried', 'anxious', 'panic', 'frightened'];
            keywords.forEach(keyword => {
                if (text.includes(keyword)) fears.push(keyword);
            });
        }
        return fears;
    }

    analyzeSpeechPattern(character) {
        const pattern = { formality: 'unknown', emotion: 'neutral', complexity: 'medium' };
        if (character.personality) {
            const p = character.personality.toLowerCase();
            if (p.includes('formal') || p.includes('proper')) pattern.formality = 'formal';
            else if (p.includes('casual') || p.includes('relaxed')) pattern.formality = 'casual';

            if (p.includes('cheerful') || p.includes('happy')) pattern.emotion = 'positive';
            else if (p.includes('gloomy') || p.includes('sad')) pattern.emotion = 'negative';
            else if (p.includes('angry') || p.includes('hostile')) pattern.emotion = 'aggressive';

            if (p.includes('simple') || p.includes('direct')) pattern.complexity = 'simple';
            else if (p.includes('complex') || p.includes('detailed')) pattern.complexity = 'complex';
        }
        return pattern;
    }

    getCharacterRelationships(character) {
        const key = character.avatar || character.name;
        return this.characterRelationships.get(key) || {};
    }

    assessArcPotential(character) {
        let score = 0;
        if (character.personality) score += 1;
        if (character.description) score += 2;
        if (character.backstory) score += 2;
        if (character.scenario) score += 1;
        if (score >= 5) return 'high';
        if (score >= 3) return 'medium';
        return 'low';
    }

    analyzeActiveCharacters() {
        const characters = this.getActiveCharacters();
        const analysis = {};
        characters.forEach(character => {
            analysis[character.avatar || character.name] = this.analyzeCharacterProfile(character);
        });
        return analysis;
    }
}