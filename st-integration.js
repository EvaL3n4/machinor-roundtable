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
        this.chatInjector = null; // Will be set later
        this.plotPreview = null; // Will be set later
        this.isChatReady = false;

        console.log('[Machinor Roundtable] ST Integration Manager initialized');
    }

    /**
     * Initialize ST integration and start listening to events
     */
    initialize() {
        // Don't load world info immediately - it will be loaded lazily when needed
        // This prevents early getContext() calls that might interfere with ST initialization
        this.setupEventListeners();
        console.log('[Machinor Roundtable] ST Integration initialized');
    }

    /**
     * Set the chat injector to be initialized when chat is ready
     * @param {Object} chatInjector - The ChatInjector instance
     */
    setChatInjector(chatInjector) {
        this.chatInjector = chatInjector;
        console.log('[Machinor Roundtable] ChatInjector registered with ST Integration');
    }

    /**
     * Set the plot preview to be initialized when chat is ready
     * @param {Object} plotPreview - The PlotPreviewManager instance
     */
    setPlotPreview(plotPreview) {
        this.plotPreview = plotPreview;
        console.log('[Machinor Roundtable] PlotPreview registered with ST Integration');
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

            // CRITICAL FIX: Listen for chat load events to manage readiness state
            eventSource.on('chat_id_changed', (chatId) => {
                console.log('[Machinor Roundtable] Chat ID changed:', chatId);
                // Trigger readiness check which will call onChatReady when ready
                this.checkChatReadiness('Chat ID Changed');
            });

            // Also listen for the generic chat_loaded event if available
            if (typeof event_types !== 'undefined' && event_types.CHAT_LOADED) {
                eventSource.on(event_types.CHAT_LOADED, () => {
                    console.log('[Machinor Roundtable] Chat loaded event received');
                    this.checkChatReadiness();
                });
            }
        }

        console.log('[Machinor Roundtable] ST event listeners setup complete');

        // Start passive readiness check - will poll until chat is fully ready
        // This doesn't interfere with ST, it just waits patiently
        this.checkChatReadiness('Initial Load');
    }

    /**
     * Check if chat is fully ready and loaded
     * @param {string} source - Optional source identifier for debugging
     */
    checkChatReadiness(source = 'Initial Check') {
        // Reset state initially
        this.isChatReady = false;

        // Use a small timeout to allow ST to finish its internal processing
        setTimeout(() => {
            const context = getContext();

            // Robust check using core variables directly where possible
            const checks = {
                this_chid: typeof this_chid !== 'undefined',
                character: characters[this_chid] !== undefined,
                chat: Array.isArray(chat),
                notSaving: !isChatSaving,
                metadata: chat_metadata !== undefined && chat_metadata !== null,
                integrity: chat_metadata?.integrity !== undefined
            };
            const isCoreReady = Object.values(checks).every(v => v);

            // Check if we have a valid chat ID and character
            if (isCoreReady && context && context.chatId && context.characterId !== undefined) {
                this.isChatReady = true;
                console.log('[Machinor Roundtable] ✅ Chat is ready. ID:', context.chatId);
                this.onChatReady(context);
            } else {
                // Log which specific check is failing
                const failedChecks = Object.entries(checks).filter(([k, v]) => !v).map(([k]) => k);
                console.log(`[Machinor Roundtable] ⏳ Chat not ready (${source}). Waiting for: ${failedChecks.join(', ')}`);

                // Poll a few times if not ready yet (useful for initial load)
                let attempts = 0;
                const maxAttempts = 60; // Increased to 30s to handle slow cold loads
                const pollInterval = setInterval(() => {
                    attempts++;
                    const updatedContext = getContext();

                    const isNowReady =
                        typeof this_chid !== 'undefined' &&
                        characters[this_chid] !== undefined &&
                        Array.isArray(chat) &&
                        !isChatSaving &&
                        chat_metadata && chat_metadata.integrity &&
                        updatedContext &&
                        updatedContext.chatId &&
                        updatedContext.characterId !== undefined;

                    if (isNowReady) {
                        this.onChatReady(updatedContext);
                        clearInterval(pollInterval);
                    } else if (attempts >= maxAttempts) {
                        console.log('[Machinor Roundtable] ❌ Chat readiness check timed out');
                        clearInterval(pollInterval);
                        // Even if polling times out, we still set ready when chat_id_changed fires
                        return;
                    }
                }, 500);
            }
        }, 200);
    }

    /**
     * Called when chat is confirmed ready
     * Uses stability checking instead of fixed timeout
     */
    onChatReady(context) {
        this.isChatReady = true;
        console.log('[Machinor Roundtable] ✅ Chat detected. ID:', context.chatId);

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
                        this.initializeComponents();
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
            if (!this.chatInjector?.initializationTimestamp) {
                clearInterval(stabilityCheck);
                console.warn(`[Machinor Roundtable] ⚠️ Stability timeout reached after 10s with ${messageCount} messages - initializing anyway`);
                this.initializeComponents();
            }
        }, 10000);
    }

    /**
     * Initialize all extension components
     * Called once chat is confirmed stable
     */
    initializeComponents() {
        // Initialize ChatInjector
        if (this.chatInjector) {
            console.log('[Machinor Roundtable] 🚀 Initializing ChatInjector (stability-based)');
            this.chatInjector.initialize();
        } else {
            console.warn('[Machinor Roundtable] ⚠️ ChatInjector not set, cannot initialize');
        }

        // Initialize PlotPreview
        if (this.plotPreview && typeof this.plotPreview.deferredInit === 'function') {
            console.log('[Machinor Roundtable] 🚀 Initializing PlotPreview (stability-based)');
            this.plotPreview.deferredInit();
        } else {
            console.warn('[Machinor Roundtable] ⚠️ PlotPreview not set or deferredInit not available');
        }
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
            isChatReady: this.isChatReady,
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