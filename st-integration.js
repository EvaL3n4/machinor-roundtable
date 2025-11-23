// Machinor Roundtable - SillyTavern Deep Integration Module
import { getContext } from "../../../extensions.js";
import { eventSource, event_types, this_chid, characters, chat, isChatSaving, chat_metadata } from "../../../../script.js";
import { logger } from "./logger.js";
import { createErrorHandler } from './security-utils.js';

/**
 * SillyTavern Integration Manager
 * Handles deep integration with SillyTavern's core features
 */
export class STIntegrationManager {
    constructor() {
        /** @type {Object|null} */
        this.worldInfo = null;
        /** @type {string|null} */
        this.currentWorldId = null;
        /** @type {boolean} */
        this.multiCharacterMode = false;
        /** @type {Map} */
        this.characterRelationships = new Map();
        /** @type {Object|null} */
        this.contextData = null;
        /** @type {boolean} */
        this.isChatReady = false;
        /** @type {boolean} */
        this.isDestroyed = false;

        // Event emitters for internal extension communication
        /** @type {Map<string, Array<Function>>} */
        this.eventListeners = new Map();
        
        /** @type {Map<string, Function>} */
        this.eventListenerRefs = new Map();

        logger.log('ST Integration Manager initialized');
    }

    /**
     * Initialize ST integration and start listening to events
     * @returns {Promise<void>} Resolves when initial setup is complete
     * @throws {Error} If initialization fails
     */
    async initialize() {
        if (this.isDestroyed) return;

        const errorHandler = createErrorHandler('STIntegrationManager.initialize');
        try {
            this.setupEventListeners();
            logger.log('ST Integration initialized');

            // Check initial state
            this.checkChatReadiness('Initial Load');
        } catch (error) {
            errorHandler(error, 'Integration initialization failed');
        }
    }

    /**
     * Destroy/cleanup method
     * Cleans up event listeners and resets internal state
     * @returns {void}
     */
    destroy() {
        if (this.isDestroyed) return;
        this.isDestroyed = true;

        logger.log('Destroying STIntegrationManager...');

        // 1. Remove EventSource Listeners
        if (typeof eventSource !== 'undefined' && eventSource.off) {
            for (const [key, handler] of this.eventListenerRefs.entries()) {
                // The key is the event name
                eventSource.off(key, handler);
                logger.log(`Removed eventSource listener: ${key}`);
            }
        }
        this.eventListenerRefs.clear();

        // 2. Clear Internal Listeners
        this.eventListeners.clear();

        // 3. Reset State
        this.isChatReady = false;
        this.worldInfo = null;
        this.contextData = null;
        this.characterRelationships.clear();

        logger.log('STIntegrationManager destroyed');
    }

    /**
     * Subscribe to internal events
     * @param {string} event - Event name (e.g., 'chat_ready')
     * @param {Function} callback - Callback function
     * @returns {void}
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
     * @returns {void}
     */
    emit(event, data) {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(callback => callback(data));
        }
    }

    /**
     * Setup event listeners for ST integration
     * Registers handlers for character, chat, world, and ID changes
     * @returns {void}
     */
    setupEventListeners() {
        if (this.isDestroyed) return;

        const errorHandler = createErrorHandler('setupEventListeners');
        if (typeof eventSource !== 'undefined') {
            
            const onCharacterSelected = (data) => {
                if (this.isDestroyed) return;
                try {
                    logger.log('Character changed, refreshing data...');
                    this.loadWorldInfo();
                    this.analyzeActiveCharacters();
                } catch (error) {
                    errorHandler(error);
                }
            };

            const onChatChanged = (data) => {
                if (this.isDestroyed) return;
                try {
                    logger.log('Chat changed, updating context...');
                    this.loadWorldInfo();

                    // If we weren't ready (e.g. ignored empty chat), check again now that content might be here
                    if (!this.isChatReady) {
                        this.checkChatReadiness('Chat Changed');
                    }
                } catch (error) {
                    errorHandler(error);
                }
            };

            const onWorldChanged = (data) => {
                if (this.isDestroyed) return;
                try {
                    logger.log('World changed, reloading world info...');
                    this.worldInfo = null;
                    this.currentWorldId = null;
                    this.loadWorldInfo();
                } catch (error) {
                    errorHandler(error);
                }
            };

            const onChatIdChanged = (chatId) => {
                if (this.isDestroyed) return;
                try {
                    logger.log('Chat ID changed:', chatId);
                    this.isChatReady = false; // Reset ready state
                    // Emitting 'manager:chat_id_changed' to avoid conflict with ST core event
                    this.emit('manager:chat_id_changed', chatId);
                    this.checkChatReadiness('Chat ID Changed');
                } catch (error) {
                    errorHandler(error);
                }
            };

            const onChatLoaded = () => {
                if (this.isDestroyed) return;
                try {
                    logger.log('Chat loaded event received');
                    this.checkChatReadiness('Chat Loaded Event');
                } catch (error) {
                    errorHandler(error);
                }
            };

            // Listen for character changes
            eventSource.on('character_selected', onCharacterSelected);
            this.eventListenerRefs.set('character_selected', onCharacterSelected);

            // Listen for chat changes
            eventSource.on('chat_changed', onChatChanged);
            this.eventListenerRefs.set('chat_changed', onChatChanged);

            // Listen for world changes
            eventSource.on('world_changed', onWorldChanged);
            this.eventListenerRefs.set('world_changed', onWorldChanged);

            // Listen for chat load events
            eventSource.on('chat_id_changed', onChatIdChanged);
            this.eventListenerRefs.set('chat_id_changed', onChatIdChanged);

            if (typeof event_types !== 'undefined' && event_types.CHAT_LOADED) {
                eventSource.on(event_types.CHAT_LOADED, onChatLoaded);
                this.eventListenerRefs.set(event_types.CHAT_LOADED, onChatLoaded);
            }
        }
    }

    /**
     * Check if chat is fully ready and loaded
     * @param {string} [source='Check'] - Optional source identifier for debugging
     * @returns {void}
     */
    checkChatReadiness(source = 'Check') {
        // Use a microtask to allow current stack to finish
        // Defer check to next microtask to ensure all synchronous operations complete
        queueMicrotask(() => {
            try {
                const context = getContext();

                // Validation
                if (!context) {
                    logger.warn('Context unavailable during readiness check');
                    this.isChatReady = false;
                    return;
                }

                // Ignore empty chats (initial load dummy chat)
                // Skip initial load dummy chat (empty chat array) to avoid premature initialization
                if (context.chat && context.chat.length === 0) {
                    logger.log(`⏳ Ignoring empty chat (${source})`);
                    this.isChatReady = false;
                    return;
                }

                // Robust check using core variables
                // Validate core SillyTavern state: character loaded, chat array exists, not saving, metadata valid
                const isCoreReady =
                    typeof this_chid !== 'undefined' &&
                    characters?.[this_chid] !== undefined &&
                    Array.isArray(chat) &&
                    !isChatSaving &&
                    chat_metadata &&
                    chat_metadata.integrity;

                if (isCoreReady && context.chatId && context.characterId !== undefined) {
                    if (!this.isChatReady) {
                        logger.log(`✅ Core ready (${source}). ID:`, context.chatId);
                        this.onChatReady(context);
                    }
                } else {
                    logger.log(`⏳ Chat not ready (${source})`);
                    this.isChatReady = false;
                }
            } catch (error) {
                logger.error('Error checking chat readiness:', error);
                this.isChatReady = false;
            }
        });
    }

    /**
     * Called when chat is confirmed ready
     * @param {Object} context - The chat context
     * @returns {void}
     */
    onChatReady(context) {
        // Simplified: No complex polling, trust the core flags
        this.isChatReady = true;
        this.emit('chat_ready', context);
    }

    /**
     * Load world info from the current context
     * @returns {Object|null} The loaded world info object or null
     * @throws {Error} If loading fails
     */
    loadWorldInfo() {
        try {
            const context = getContext();
            if (!context) return null;

            this.contextData = context;

            if (context.worlds && context.worldInfo) {
                // Validate structure
                if (typeof context.worldInfo === 'object') {
                    this.worldInfo = context.worldInfo;
                    this.currentWorldId = context.worldId || context.world_name;
                } else {
                    logger.warn('Invalid worldInfo structure');
                    this.worldInfo = null;
                }
            }

            return this.worldInfo;
        } catch (error) {
            logger.error('Error loading world info:', error);
            return null;
        }
    }

    /**
     * Get current world info for plot generation
     * Returns raw active entries without rigid categorization
     * @returns {Array<{name: string, content: string}>|null} Array of world info entries or null
     */
    getWorldInfo() {
        try {
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
                    if (!entry) return;

                    // Handle both direct content strings and object structures
                    // Handle both direct content strings and nested object structures from different ST versions
                    const content = typeof entry === 'string' ? entry : (entry.content ?? entry.entry ?? '');
                    const name = entry.name ?? key;

                    if (content && typeof content === 'string' && content.length > 0) {
                        activeEntries.push({
                            name: name,
                            content: content
                        });
                    }
                } catch (err) {
                    logger.warn('Error processing world info entry:', key, err);
                }
            });

            return activeEntries.length > 0 ? activeEntries : null;
        } catch (error) {
            logger.error('Error in getWorldInfo:', error);
            return null;
        }
    }

    /**
     * Enhanced character detection for multi-character scenarios
     * @returns {Array<Object>} List of active characters
     */
    getActiveCharacters() {
        try {
            const context = getContext();
            if (!context) return [];

            const characters = [];

            // Check for group chat
            if (context.groupId && context.groups && context.characters) {
                this.multiCharacterMode = true;
                const group = context.groups.find(g => g.id === context.groupId);
                if (group && Array.isArray(group.members)) {
                    group.members.forEach(memberId => {
                        try {
                            const character = context.characters.find(c => c.avatar === memberId);
                            if (character) {
                                characters.push({
                                    ...character,
                                    isGroupMember: true,
                                    groupRole: this.getCharacterGroupRole(character, group)
                                });
                            }
                        } catch (charError) {
                            logger.warn('Error processing group member:', memberId);
                        }
                    });
                }
            } else {
                this.multiCharacterMode = false;
                // Optional chaining for safety
                const currentChar = context.characters?.[context.characterId];
                if (currentChar) {
                    characters.push({
                        ...currentChar,
                        isGroupMember: false
                    });
                }
            }

            return characters;
        } catch (error) {
            logger.error('Error in getActiveCharacters:', error);
            return [];
        }
    }

    /**
     * Determine character role within a group
     * @param {Object} character - Character object
     * @param {Object} group - Group object
     * @returns {string} Role ('leader', 'supporter', 'mentor', 'member')
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