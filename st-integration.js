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

                // If we weren't ready (e.g. ignored empty chat), check again now that content might be here
                if (!this.isChatReady) {
                    this.checkChatReadiness('Chat Changed');
                }
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

            // Ignore empty chats (initial load dummy chat)
            if (context && context.chat && context.chat.length === 0) {
                console.log(`[Machinor Roundtable] ⏳ Ignoring empty chat (${source})`);
                this.isChatReady = false;
                return;
            }

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
     * Returns raw active entries without rigid categorization
     */
    getWorldInfo() {
        if (!this.worldInfo) {
            this.loadWorldInfo();
        }

        if (!this.worldInfo || Object.keys(this.worldInfo).length === 0) {
            return null;
        }

        const activeEntries = [];

        // Simply collect all active world info entries
        Object.entries(this.worldInfo).forEach(([key, entry]) => {
            try {
                // Handle both direct content strings and object structures
                const content = typeof entry === 'string' ? entry : (entry.content || entry.entry || '');
                const name = entry.name || key;

                if (content && content.length > 0) {
                    activeEntries.push({
                        name: name,
                        content: content
                    });
                }
            } catch (err) {
                console.warn('[Machinor Roundtable] Error processing world info entry:', key, err);
            }
        });

        return activeEntries.length > 0 ? activeEntries : null;
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
     * PERFORMANCE: Character analysis methods removed
     * These methods performed expensive text analysis that didn't significantly
     * improve plot quality. The LLM can intuit character traits from the
     * {{description}} and {{personality}} macros provided in the prompt.
     * 
     * Removed methods:
     * - analyzeCharacterProfile()
     * - extractPersonalityTraits()
     * - extractBackstory()
     * - extractMotivations()
     * - extractFears()
     * - analyzeSpeechPattern()
     * - getCharacterRelationships()
     * - assessArcPotential()
     * - analyzeActiveCharacters()
     */
}