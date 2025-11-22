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
     */
    onChatReady(context) {
        // Simplified: No complex polling, trust the core flags
        this.isChatReady = true;
        this.emit('chat_ready', context);
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
     */
    analyzeActiveCharacters() {
        // Placeholder for compatibility if needed, but logic is removed
    }
}