// Machinor Roundtable - Plot Preview Manager
import { getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// @ts-ignore - toastr is a global library
const toastr = window.toastr;

/**
 * Gets the current character from SillyTavern context
 * @returns {Object|null} The current character object or null if no character is selected
 */
function getCurrentCharacter() {
    try {
        const context = getContext();
        if (!context) {
            console.log("[machinor-roundtable] getCurrentCharacter: No context available");
            return null;
        }

        // Check if we have a characterId and characters array
        if (context.characterId === undefined || !context.characters) {
            console.log("[machinor-roundtable] getCurrentCharacter: No characterId or characters array");
            return null;
        }
        
        // Find the current character by ID
        const character = context.characters[context.characterId];
        
        console.log("[machinor-roundtable] getCurrentCharacter:", character ? character.name : "No character found");
        
        return character || null;
    } catch (error) {
        console.error("[machinor-roundtable] Error getting current character:", error);
        return null;
    }
}

/**
 * @typedef {Object} PlotEntry
 * @property {string} text - The plot text
 * @property {number} timestamp - When the plot was created
 * @property {string} id - Unique identifier
 */

/**
 * @typedef {Object} PlotPreviewElements
 * @property {HTMLElement} sidebar
 * @property {HTMLElement} toggleBtn
 * @property {HTMLElement} statusIndicator
 * @property {HTMLElement} statusText
 * @property {HTMLElement} timerDisplay
 * @property {HTMLElement} currentPlotText
 * @property {HTMLElement} nextPlotText
 * @property {HTMLInputElement} directionInput
 * @property {HTMLElement} recentDirectionsList
 * @property {HTMLElement} historyList
 * @property {HTMLInputElement} historyLimitInput
 * @property {HTMLElement} historyToggle
 * @property {HTMLElement} historyContent
 * @property {HTMLElement} modal
 * @property {HTMLTextAreaElement} editorText
 * @property {HTMLElement} closeModalBtn
 */

export class PlotPreviewManager {
    /**
     * @param {Object} plotEngine - The plot generation engine
     * @param {Object} chatInjector - The chat injection system
     */
    constructor(plotEngine, chatInjector) {
        /** @type {Object} */
        this.plotEngine = plotEngine;
        /** @type {Object|null} */
        this.chatInjector = chatInjector;
        /** @type {boolean} */
        this.isCollapsed = true;
        /** @type {number|null} */
        this.autoApproveTimer = null;
        /** @type {number} */
        this.autoApproveTimeout = 5000; // Default 5 seconds
        /** @type {string|null} */
        this.currentPlot = null;
        /** @type {string|null} */
        this.nextPlot = null;
        /** @type {PlotEntry[]} */
        this.plotHistory = [];
        /** @type {number} */
        this.historyLimit = 5;
        /** @type {string[]} */
        this.recentDirections = [];
        /** @type {number} */
        this.maxRecentDirections = 10;
        /** @type {boolean} */
        this.isPaused = false;
        /** @type {boolean} */
        this.isManualEntry = false;
        /** @type {boolean} */
        this.isGenerating = false;
        
        /** @type {PlotPreviewElements} */
        this.elements = this.initializeElements();
        /** @type {boolean} */
        this.isMobile = window.innerWidth <= 768;
        /** @type {boolean} */
        this.mobileSidebarVisible = false;
        const mobileToggleElement = document.getElementById('mr_mobile_toggle');
        
        /** @type {HTMLElement|null} */
        this.mobileOverlay = null;
        /** @type {number|null} */
        this.mobileResizeTimeout = null;
        /** @type {HTMLElement|null} */
        this.mobilePortalContainer = null;
        /** @type {HTMLElement|null} */
        this.sidebarPlaceholder = null;
        /** @type {HTMLElement|null} */
        this.togglePlaceholder = null;
        /** @type {HTMLElement|null} */
        this.sidebarOriginalParent = this.elements.sidebar?.parentElement || null;
        /** @type {Node|null} */
        this.sidebarNextSibling = this.elements.sidebar?.nextSibling || null;
        /** @type {HTMLElement|null} */
        this.toggleOriginalParent = mobileToggleElement ? mobileToggleElement.parentElement : null;
        /** @type {Node|null} */
        this.toggleNextSibling = mobileToggleElement ? mobileToggleElement.nextSibling : null;
        /** @type {(event: KeyboardEvent) => void | null} */
        this.mobileFocusTrapHandler = null;
        /** @type {HTMLElement|null} */
        this.previouslyFocusedElement = null;
        /** @type {string} */
        this.originalBodyOverflow = '';
        /** @type {number|null} */
        this.mobileHideTimeout = null;
        
        this.bindEvents();
        this.loadSettings();
        this.initializeMobileToggle();
        this.updateMobileAccessibilityState(false);
        this.updateResponsivePlacement();
    }

    /**
     * Initialize DOM elements
     * @returns {PlotPreviewElements}
     */
    initializeElements() {
        const elements = {
            sidebar: document.getElementById('mr_plot_sidebar'),
            toggleBtn: document.getElementById('mr_toggle_sidebar'),
            statusIndicator: document.getElementById('mr_status_indicator'),
            statusText: document.getElementById('mr_status_text'),
            timerDisplay: document.getElementById('mr_approval_timer'),
            currentPlotText: document.getElementById('mr_current_plot_text'),
            nextPlotText: document.getElementById('mr_next_plot_text'),
            directionInput: /** @type {HTMLInputElement} */ (document.getElementById('mr_plot_direction')),
            recentDirectionsList: document.getElementById('mr_recent_directions'),
            historyList: document.getElementById('mr_history_list'),
            historyLimitInput: /** @type {HTMLInputElement} */ (document.getElementById('mr_history_limit')),
            historyToggle: document.getElementById('mr_history_toggle'),
            historyContent: document.getElementById('mr_history_content'),
            modal: document.getElementById('mr_plot_editor_modal'),
            editorText: /** @type {HTMLTextAreaElement} */ (document.getElementById('mr_plot_editor_text')),
            closeModalBtn: document.getElementById('mr_close_modal')
        };

        if (elements.sidebar) {
            elements.sidebar.setAttribute('role', 'complementary');
            elements.sidebar.setAttribute('aria-modal', 'false');
            elements.sidebar.setAttribute('aria-label', 'Machinor Roundtable plot preview');
        }
 
        // Validate all elements exist
        for (const [key, element] of Object.entries(elements)) {
            if (!element) {
                console.warn(`[machinor-roundtable] Element not found: ${key}`);
            }
        }
        
        console.log('[machinor-roundtable] Plot Preview Manager initialized');
        return elements;
    }

    /**
     * Initialize mobile toggle functionality
     */
    initializeMobileToggle() {
        const mobileToggle = document.getElementById('mr_mobile_toggle');
        if (!mobileToggle || !this.elements.sidebar) return;
        if (mobileToggle.dataset.mrInitialized) return;

        mobileToggle.setAttribute('aria-controls', 'mr_plot_sidebar');
        mobileToggle.setAttribute('aria-expanded', 'false');
        mobileToggle.setAttribute('aria-label', 'Toggle Plot Preview');

        let overlay = document.querySelector('.mr-mobile-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'mr-mobile-overlay mobile-hidden';
            overlay.setAttribute('role', 'presentation');
            document.body.appendChild(overlay);
        }
        this.mobileOverlay = /** @type {HTMLElement} */ (overlay);

        const closeBtn = this.createMobileCloseButton();
        this.elements.sidebar.querySelector('.mr-sidebar-header')?.appendChild(closeBtn);

        const toggleHandler = () => this.toggleMobileSidebar();
        const closeHandler = () => this.hideMobileSidebar();

        mobileToggle.addEventListener('click', toggleHandler);
        overlay.addEventListener('click', closeHandler);
        closeBtn.addEventListener('click', closeHandler);

        mobileToggle.dataset.mrInitialized = 'true';
        this.ensurePortalPlaceholders();
        this.updateResponsivePlacement();
        
        window.addEventListener('resize', () => {
            if (this.mobileResizeTimeout) {
                clearTimeout(this.mobileResizeTimeout);
            }
            
            this.mobileResizeTimeout = window.setTimeout(() => {
                const wasMobile = this.isMobile;
                this.isMobile = window.innerWidth <= 600;
                
                if (wasMobile && !this.isMobile && this.mobileSidebarVisible) {
                    this.hideMobileSidebar(true);
                }
                
                this.updateResponsivePlacement();
                
                if (!this.isMobile) {
                    this.updateMobileAccessibilityState(false);
                    document.body.style.overflow = '';
                } else {
                    this.updateMobileAccessibilityState(this.mobileSidebarVisible);
                }
            }, 150);
        });
        
        this.addTouchGestures();
        console.log('[machinor-roundtable] Mobile toggle initialized');
    }

    createMobileCloseButton() {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'mr-mobile-close-btn';
        closeBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
        closeBtn.setAttribute('aria-label', 'Close Plot Preview');
        return closeBtn;
    }

    toggleMobileSidebar() {
        if (this.mobileSidebarVisible) {
            this.hideMobileSidebar();
        } else {
            this.showMobileSidebar();
        }
    }

    showMobileSidebar() {
        if (this.mobileSidebarVisible || !this.isMobile || !this.elements.sidebar || !this.mobileOverlay) return;

        this.mobileSidebarVisible = true;
        const mobileToggle = document.getElementById('mr_mobile_toggle');
        this.previouslyFocusedElement = mobileToggle || (document.activeElement instanceof HTMLElement ? document.activeElement : null);

        const portal = this.ensureMobilePortalContainer();
        portal.style.pointerEvents = 'auto';

        // CRITICAL: Remove collapsed state completely for mobile
        this.isCollapsed = false; // Update state variable
        this.elements.sidebar.classList.remove('collapsed');
        this.elements.sidebar.classList.remove('mobile-hidden');
        this.elements.sidebar.classList.add('mobile-visible');
        this.mobileOverlay.classList.remove('mobile-hidden');
        this.mobileOverlay.classList.add('mobile-visible');

        this.originalBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        mobileToggle?.classList.add('is-active');

        // DEBUG: Log the current state
        console.log('[machinor-roundtable] Mobile sidebar opening - collapsed state:', this.isCollapsed);
        console.log('[machinor-roundtable] Sidebar classes:', this.elements.sidebar.className);

        // Force content to be visible and properly rendered
        if (this.elements.currentPlotText) {
            console.log('[machinor-roundtable] Current plot text content:', this.elements.currentPlotText.textContent);
            console.log('[machinor-roundtable] Current plot text display:', window.getComputedStyle(this.elements.currentPlotText).display);
            
            // Force visibility and layout
            this.elements.currentPlotText.style.visibility = 'visible';
            this.elements.currentPlotText.style.opacity = '1';
            this.elements.currentPlotText.style.display = 'block';
        }

        // Ensure all content sections are visible
        const contentSections = this.elements.sidebar.querySelectorAll('.mr-current-plot, .mr-next-plot, .mr-plot-history');
        contentSections.forEach(section => {
            if (section instanceof HTMLElement) {
                section.style.visibility = 'visible';
                section.style.opacity = '1';
                section.style.display = 'block';
            }
        });

        // Force the sidebar content container to be visible
        const contentContainer = this.elements.sidebar.querySelector('.mr-sidebar-content');
        if (contentContainer instanceof HTMLElement) {
            contentContainer.style.visibility = 'visible';
            contentContainer.style.opacity = '1';
            contentContainer.style.display = 'flex';
            contentContainer.style.height = 'auto';
            contentContainer.style.minHeight = '200px'; // Ensure minimum height
        }

        // Force reflow to ensure proper layout
        this.elements.sidebar.offsetHeight;

        this.updateMobileAccessibilityState(true);
        this.applyMobileFocusTrap();
        console.log('[machinor-roundtable] Mobile sidebar shown with content verification');
    }

    hideMobileSidebar(skipAnimation = false) {
        if (!this.mobileSidebarVisible || !this.elements.sidebar || !this.mobileOverlay) return;

        this.mobileSidebarVisible = false;
        const mobileToggle = document.getElementById('mr_mobile_toggle');
        const portal = this.ensureMobilePortalContainer();

        this.elements.sidebar.classList.remove('mobile-visible');
        this.elements.sidebar.classList.add('mobile-hidden');
        this.mobileOverlay.classList.remove('mobile-visible');
        this.mobileOverlay.classList.add('mobile-hidden');

        document.body.style.overflow = this.originalBodyOverflow;
        mobileToggle?.classList.remove('is-active');

        this.updateMobileAccessibilityState(false);
        this.releaseMobileFocusTrap();

        if (skipAnimation) {
            portal.style.pointerEvents = 'none';
        } else {
            const onTransitionEnd = (event) => {
                if (event.target === this.elements.sidebar && event.propertyName === 'opacity' && !this.mobileSidebarVisible) {
                    portal.style.pointerEvents = 'none';
                    this.elements.sidebar.removeEventListener('transitionend', onTransitionEnd);
                }
            };
            this.elements.sidebar.addEventListener('transitionend', onTransitionEnd);
        }

        console.log('[machinor-roundtable] Mobile sidebar hidden');
    }


    /**
     * Add touch gesture support for mobile
     */
    addTouchGestures() {
        if (!this.elements.sidebar) return;
        
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;
        
        // Touch start
        this.elements.sidebar.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        });
        
        // Touch end
        this.elements.sidebar.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].clientX;
            touchEndY = e.changedTouches[0].clientY;
            
            // Calculate swipe distance
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);
            
            // Check if it's a horizontal swipe (more horizontal than vertical)
            if (absX > absY && absX > 50) {
                // Swipe left to close
                if (deltaX < -30 && this.mobileSidebarVisible) {
                    this.hideMobileSidebar();
                }
            }
        });
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Sidebar toggle
        if (this.elements.toggleBtn) {
            this.elements.toggleBtn.addEventListener('click', () => this.toggleSidebar());
        }
        
        // Plot actions
        const editBtn = document.getElementById('mr_edit_plot');
        const skipBtn = document.getElementById('mr_skip_plot');
        const pauseBtn = document.getElementById('mr_pause_plot');
        const regenerateBtn = document.getElementById('mr_regenerate_next');
        const manualBtn = document.getElementById('mr_manual_plot_btn');
        const saveBtn = document.getElementById('mr_save_plot');
        const cancelBtn = document.getElementById('mr_cancel_edit');
        
        if (editBtn) editBtn.addEventListener('click', () => this.editPlot());
        if (skipBtn) skipBtn.addEventListener('click', () => this.skipPlot());
        if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());
        if (regenerateBtn) regenerateBtn.addEventListener('click', () => this.regenerateNextPlot());
        if (manualBtn) manualBtn.addEventListener('click', () => this.manualPlotEntry());
        
        // Direction input
        if (this.elements.directionInput) {
            this.elements.directionInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.saveDirection();
                }
            });
            this.elements.directionInput.addEventListener('input', () => this.showRecentDirections());
        }
        
        // History
        if (this.elements.historyToggle) {
            this.elements.historyToggle.addEventListener('click', () => this.toggleHistory());
        }
        if (this.elements.historyLimitInput) {
            this.elements.historyLimitInput.addEventListener('change', () => this.updateHistoryLimit());
        }
        
        // Modal
        if (this.elements.closeModalBtn) {
            this.elements.closeModalBtn.addEventListener('click', () => this.closeModal());
        }
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveEditedPlot());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());
        
        // Close modal on outside click
        if (this.elements.modal) {
            this.elements.modal.addEventListener('click', (e) => {
                if (e.target === this.elements.modal) {
                    this.closeModal();
                }
            });
        }
        
        console.log('[machinor-roundtable] Plot Preview events bound');
    }

    /**
     * Load settings from extension settings
     */
    loadSettings() {
        const context = getContext();
        
        // Ensure extension_settings exists
        if (!context.extension_settings) {
            context.extension_settings = {};
        }
        
        // Ensure machinor_roundtable settings exist
        if (!context.extension_settings.machinor_roundtable) {
            context.extension_settings.machinor_roundtable = {};
        }
        
        const settings = context.extension_settings.machinor_roundtable;
        
        this.autoApproveTimeout = settings.approvalTimeout || 5000;
        this.historyLimit = settings.historyLimit || 5;
        this.recentDirections = settings.recentDirections || [];
        this.isCollapsed = settings.sidebarCollapsed !== false; // Default to collapsed
        
        if (this.elements.historyLimitInput) {
            this.elements.historyLimitInput.value = this.historyLimit.toString();
        }
        
        if (this.isCollapsed && this.elements.sidebar) {
            this.elements.sidebar.classList.add('collapsed');
        }
        
        console.log('[machinor-roundtable] Plot Preview settings loaded');
    }

    /**
     * Save settings to extension settings
     */
    saveSettings() {
        const context = getContext();
        
        // Ensure extension_settings exists
        if (!context.extension_settings) {
            context.extension_settings = {};
        }
        
        // Ensure machinor_roundtable settings exist
        if (!context.extension_settings.machinor_roundtable) {
            context.extension_settings.machinor_roundtable = {};
        }
        
        const settings = context.extension_settings.machinor_roundtable;
        
        settings.approvalTimeout = this.autoApproveTimeout;
        settings.historyLimit = this.historyLimit;
        settings.recentDirections = this.recentDirections;
        settings.sidebarCollapsed = this.isCollapsed;
        
        saveSettingsDebounced();
        console.log('[machinor-roundtable] Plot Preview settings saved');
    }

    /**
     * Toggle sidebar collapse/expand
     */
    toggleSidebar() {
        if (this.isMobile) {
            this.toggleMobileSidebar();
            return;
        }
        
        this.isCollapsed = !this.isCollapsed;
        
        if (this.elements.sidebar) {
            this.elements.sidebar.classList.toggle('collapsed', this.isCollapsed);
        }
        
        this.saveSettings();
        this.updateMobileAccessibilityState(this.mobileSidebarVisible);
        
        // Update toggle button icon
        if (this.elements.toggleBtn) {
            const icon = this.elements.toggleBtn.querySelector('i');
            if (icon) {
                if (this.isCollapsed) {
                    icon.className = 'fa-solid fa-chevron-right';
                } else {
                    icon.className = 'fa-solid fa-chevron-left';
                }
            }
        }
        
        console.log('[machinor-roundtable] Sidebar toggled:', this.isCollapsed ? 'collapsed' : 'expanded');
    }

    /**
     * Display current plot in sidebar
     * @param {string} plotText - The plot text to display
     * @param {string} status - The status to show
     */
    displayCurrentPlot(plotText, status = 'ready') {
        this.currentPlot = plotText;
        
        if (this.elements.currentPlotText) {
            this.elements.currentPlotText.textContent = plotText;
            console.log('[machinor-roundtable] Plot text set to:', plotText.substring(0, 50) + '...');
            
            // Force visibility on mobile
            if (this.isMobile && this.mobileSidebarVisible) {
                this.elements.currentPlotText.style.visibility = 'visible';
                this.elements.currentPlotText.style.opacity = '1';
            }
        } else {
            console.warn('[machinor-roundtable] currentPlotText element not found');
        }
        
        this.updateStatus(status);
        
        // Start auto-approve timer if ready and not paused
        if (status === 'ready' && !this.isPaused) {
            this.startAutoApproveTimer();
        }
        
        console.log('[machinor-roundtable] Current plot displayed:', status);
    }

    /**
     * Display next plot preview
     * @param {string} plotText - The next plot text
     */
    displayNextPlot(plotText) {
        this.nextPlot = plotText;
        
        if (this.elements.nextPlotText) {
            this.elements.nextPlotText.textContent = plotText || 'Generating next plot...';
        }
        
        console.log('[machinor-roundtable] Next plot preview displayed');
    }

    /**
     * Update status indicator and text
     * @param {string} status - The status to display
     */
    updateStatus(status) {
        if (this.elements.statusIndicator) {
            // Remove all status classes
            this.elements.statusIndicator.className = 'mr-status-indicator';
            this.elements.statusIndicator.classList.add(status);
        }
        
        // Update status text
        const statusTexts = {
            ready: 'Ready',
            pending: 'Generating...',
            paused: 'Paused',
            injected: 'Injected'
        };
        
        if (this.elements.statusText) {
            this.elements.statusText.textContent = statusTexts[status] || 'Unknown';
        }
        
        console.log('[machinor-roundtable] Status updated:', status);
    }

    /**
     * Start auto-approve countdown timer
     */
    startAutoApproveTimer() {
        this.clearAutoApproveTimer();
        
        let timeLeft = Math.ceil(this.autoApproveTimeout / 1000);
        this.updateTimerDisplay(timeLeft);
        
        this.autoApproveTimer = window.setInterval(() => {
            timeLeft--;
            this.updateTimerDisplay(timeLeft);
            
            if (timeLeft <= 0) {
                this.clearAutoApproveTimer();
                this.approveAndInject();
            }
        }, 1000);
        
        console.log('[machinor-roundtable] Auto-approve timer started');
    }

    /**
     * Clear auto-approve timer
     */
    clearAutoApproveTimer() {
        if (this.autoApproveTimer) {
            clearInterval(this.autoApproveTimer);
            this.autoApproveTimer = null;
            this.updateTimerDisplay('');
            console.log('[machinor-roundtable] Auto-approve timer cleared');
        }
    }

    /**
     * Update timer display
     * @param {number|string} seconds - Seconds remaining or empty string
     */
    updateTimerDisplay(seconds) {
        if (!this.elements.timerDisplay) return;
        
        if (typeof seconds === 'number' && seconds > 0) {
            this.elements.timerDisplay.textContent = `Auto-inject in ${seconds}s`;
        } else {
            this.elements.timerDisplay.textContent = '';
        }
    }

    /**
     * Approve current plot and inject it
     */
    async approveAndInject() {
        if (!this.currentPlot) {
            console.warn('[machinor-roundtable] No plot to inject');
            return;
        }
        
        this.updateStatus('injected');
        this.clearAutoApproveTimer();
        
        // Add to history
        this.addToHistory(this.currentPlot);
        
        // Trigger injection through chat injector
        // This is a simplified version - in practice, you'd integrate with the actual injection system
        console.log('[machinor-roundtable] Plot approved and injected:', this.currentPlot);
        
        // @ts-ignore - toastr is a global library
        toastr.success('Plot injected successfully', 'Machinor Roundtable');
        
        // Keep the plot displayed and stay in injected state for editing
        // Don't clear the plot or return to pending status
        console.log('[machinor-roundtable] Plot remains in injected state for editing');
    }

    /**
     * Edit current plot (inline or modal)
     */
    editPlot() {
        if (!this.currentPlot) {
            // @ts-ignore - toastr is a global library
            toastr.warning('No plot to edit', 'Machinor Roundtable');
            return;
        }
        
        // For now, open modal - could add inline editing later
        this.openModal(this.currentPlot);
        console.log('[machinor-roundtable] Plot editor opened');
    }

    /**
     * Skip current plot and generate new one
     */
    skipPlot() {
        this.clearAutoApproveTimer();
        this.currentPlot = null;
        
        if (this.elements.currentPlotText) {
            this.elements.currentPlotText.textContent = 'Generating new plot...';
        }
        
        this.updateStatus('pending');
        
        // Trigger new plot generation
        this.generateNewPlot();
        
        // @ts-ignore - toastr is a global library
        toastr.info('Plot skipped, generating new one...', 'Machinor Roundtable');
        console.log('[machinor-roundtable] Plot skipped');
    }

    /**
     * Toggle pause/resume auto-injection
     */
    togglePause() {
        this.isPaused = !this.isPaused;
        const pauseBtn = document.getElementById('mr_pause_plot');
        
        if (pauseBtn) {
            const icon = pauseBtn.querySelector('i');
            
            if (this.isPaused) {
                this.clearAutoApproveTimer();
                this.updateStatus('paused');
                if (icon) icon.className = 'fa-solid fa-play';
                pauseBtn.title = 'Resume Auto-Inject';
                // @ts-ignore - toastr is a global library
                toastr.info('Auto-injection paused', 'Machinor Roundtable');
            } else {
                this.updateStatus('ready');
                if (icon) icon.className = 'fa-solid fa-pause';
                pauseBtn.title = 'Pause Auto-Inject';
                // @ts-ignore - toastr is a global library
                toastr.info('Auto-injection resumed', 'Machinor Roundtable');
            }
        }
        
        console.log('[machinor-roundtable] Pause toggled:', this.isPaused);
    }

    /**
     * Regenerate next plot preview
     */
    regenerateNextPlot() {
        if (this.elements.nextPlotText) {
            this.elements.nextPlotText.textContent = 'Regenerating next plot...';
        }
        
        // Trigger regeneration
        this.generateNextPlot();
        // @ts-ignore - toastr is a global library
        toastr.info('Regenerating next plot...', 'Machinor Roundtable');
        console.log('[machinor-roundtable] Next plot regeneration requested');
    }

    /**
     * Manual plot entry
     */
    manualPlotEntry() {
        this.openModal('', true); // Open empty modal for manual entry
        console.log('[machinor-roundtable] Manual plot entry opened');
    }

    /**
     * Open plot editor modal
     * @param {string} plotText - Text to edit
     * @param {boolean} isManual - Whether this is manual entry
     */
    openModal(plotText = '', isManual = false) {
        if (this.elements.editorText) {
            this.elements.editorText.value = plotText;
        }
        
        if (this.elements.modal) {
            this.elements.modal.style.display = 'block';
        }
        
        if (this.elements.editorText) {
            this.elements.editorText.focus();
        }
        
        // Store whether this is manual entry
        this.isManualEntry = isManual;
        
        console.log('[machinor-roundtable] Modal opened');
    }

    /**
     * Close plot editor modal
     */
    closeModal() {
        if (this.elements.modal) {
            this.elements.modal.style.display = 'none';
        }
        this.isManualEntry = false;
        console.log('[machinor-roundtable] Modal closed');
    }

    /**
     * Save edited plot
     */
    saveEditedPlot() {
        if (!this.elements.editorText) return;
        
        const editedText = this.elements.editorText.value.trim();
        
        if (!editedText) {
            // @ts-ignore - toastr is a global library
            toastr.warning('Plot cannot be empty', 'Machinor Roundtable');
            return;
        }
        
        if (this.isManualEntry) {
            // Manual entry - set as current plot
            this.displayCurrentPlot(editedText, 'ready');
            // @ts-ignore - toastr is a global library
            toastr.success('Custom plot saved', 'Machinor Roundtable');
        } else {
            // Edit existing plot
            this.displayCurrentPlot(editedText, 'ready');
            // @ts-ignore - toastr is a global library
            toastr.success('Plot edited successfully', 'Machinor Roundtable');
        }
        
        this.closeModal();
        console.log('[machinor-roundtable] Plot saved:', editedText);
    }

    /**
     * Save direction input
     */
    saveDirection() {
        if (!this.elements.directionInput) return;
        
        const direction = this.elements.directionInput.value.trim();
        
        if (!direction) return;
        
        // Add to recent directions (avoid duplicates)
        this.recentDirections = this.recentDirections.filter(d => d !== direction);
        this.recentDirections.unshift(direction);
        
        // Keep only max recent directions
        if (this.recentDirections.length > this.maxRecentDirections) {
            this.recentDirections = this.recentDirections.slice(0, this.maxRecentDirections);
        }
        
        this.saveSettings();
        // @ts-ignore - toastr is a global library
        toastr.info(`Direction saved: "${direction}"`, 'Machinor Roundtable');
        console.log('[machinor-roundtable] Direction saved:', direction);
    }

    /**
     * Show recent directions dropdown
     */
    showRecentDirections() {
        if (this.recentDirections.length === 0) return;
        
        // This is a simplified version - in practice, you'd show a dropdown
        const directionsList = this.recentDirections.slice(0, 3).join(', ');
        
        if (this.elements.recentDirectionsList) {
            this.elements.recentDirectionsList.textContent = `Recent: ${directionsList}`;
        }
    }

    /**
     * Toggle plot history visibility
     */
    toggleHistory() {
        if (!this.elements.historyContent || !this.elements.historyToggle) return;
        
        this.elements.historyContent.classList.toggle('collapsed');
        const icon = this.elements.historyToggle.querySelector('i');
        
        if (this.elements.historyContent.classList.contains('collapsed')) {
            if (icon) icon.className = 'fa-solid fa-chevron-down';
        } else {
            if (icon) icon.className = 'fa-solid fa-chevron-up';
        }
    }

    /**
     * Update history limit
     */
    updateHistoryLimit() {
        if (!this.elements.historyLimitInput) return;
        
        this.historyLimit = parseInt(this.elements.historyLimitInput.value) || 5;
        this.trimHistory();
        this.saveSettings();
        console.log('[machinor-roundtable] History limit updated:', this.historyLimit);
    }

    /**
     * Add plot to history
     */
    addToHistory(plotText) {
        const plotEntry = {
            text: plotText,
            timestamp: Date.now(),
            id: Date.now().toString()
        };
        
        this.plotHistory.unshift(plotEntry);
        this.trimHistory();
        this.renderHistory();
        
        console.log('[machinor-roundtable] Plot added to history');
    }

    /**
     * Trim history to limit
     */
    trimHistory() {
        if (this.plotHistory.length > this.historyLimit) {
            this.plotHistory = this.plotHistory.slice(0, this.historyLimit);
        }
    }

    /**
     * Render plot history
     */
    renderHistory() {
        if (!this.elements.historyList) return;
        
        if (this.plotHistory.length === 0) {
            this.elements.historyList.innerHTML = '<div class="mr-history-item">No plot history yet</div>';
            return;
        }
        
        this.elements.historyList.innerHTML = this.plotHistory.map(plot => `
            <div class="mr-history-item" data-plot-id="${plot.id}" title="${new Date(plot.timestamp).toLocaleString()}">
                ${plot.text.substring(0, 60)}${plot.text.length > 60 ? '...' : ''}
            </div>
        `).join('');
        
        // Add click handlers
        this.elements.historyList.querySelectorAll('.mr-history-item').forEach(item => {
            item.addEventListener('click', () => {
                const plotId = /** @type {HTMLElement} */ (item).dataset.plotId;
                const plot = this.plotHistory.find(p => p.id === plotId);
                if (plot) {
                    this.displayCurrentPlot(plot.text, 'ready');
                    // @ts-ignore - toastr is a global library
                    toastr.info('Plot loaded from history', 'Machinor Roundtable');
                }
            });
        });
    }

    /**
     * Generate new plot using the plot engine
     */
    async generateNewPlot() {
        console.log('[machinor-roundtable] Generating new plot...');
        
        try {
            // Use the imported helper functions
            const character = getCurrentCharacter();
            
            if (!character) {
                // @ts-ignore - toastr is a global library
                toastr.warning('No character selected', 'Machinor Roundtable');
                return;
            }
            
            const chatHistory = this.getRecentChatHistory();
            
            // Generate plot using the plot engine
            const plotContext = await this.plotEngine.generatePlotContext(character, chatHistory);
            
            if (plotContext) {
                this.displayCurrentPlot(plotContext, 'ready');
                // @ts-ignore - toastr is a global library
                toastr.success('New plot generated', 'Machinor Roundtable');
            }
        } catch (error) {
            console.error('[machinor-roundtable] Failed to generate new plot:', error);
            // @ts-ignore - toastr is a global library
            toastr.error('Failed to generate plot', 'Machinor Roundtable');
        }
    }

    /**
     * Generate next plot preview using the plot engine
     */
    async generateNextPlot() {
        console.log('[machinor-roundtable] Generating next plot...');
        
        try {
            // Use the imported helper functions
            const character = getCurrentCharacter();
            
            if (!character) {
                this.displayNextPlot('No character selected');
                return;
            }
            
            const chatHistory = this.getRecentChatHistory();
            
            // Generate plot using the plot engine
            const plotContext = await this.plotEngine.generatePlotContext(character, chatHistory);
            
            if (plotContext) {
                this.displayNextPlot(plotContext);
                // @ts-ignore - toastr is a global library
                toastr.info('Next plot preview generated', 'Machinor Roundtable');
            }
        } catch (error) {
            console.error('[machinor-roundtable] Failed to generate next plot:', error);
            this.displayNextPlot('Generation failed');
        }
    }

    /**
     * Get recent chat history for context (helper method)
     */
    getRecentChatHistory() {
        const context = getContext();
        const chat = context.chat;
        
        if (!chat || chat.length === 0) {
            return [];
        }

        // Get the last 10 messages for context
        return chat.slice(-10).map(msg => ({
            name: msg.name,
            mes: msg.mes,
            is_user: msg.is_user,
            send_date: msg.send_date
        }));
    }

    /**
     * Get current status for debugging
     */
    getStatus() {
        return {
            isCollapsed: this.isCollapsed,
            isPaused: this.isPaused,
            currentPlot: this.currentPlot,
            nextPlot: this.nextPlot,
            historyCount: this.plotHistory.length,
            recentDirectionsCount: this.recentDirections.length,
            autoApproveTimeout: this.autoApproveTimeout
        };
    }

    /**
     * Update ARIA state for mobile sidebar controls
     * @param {boolean} isVisible
     */
    updateMobileAccessibilityState(isVisible) {
        const mobileToggle = document.getElementById('mr_mobile_toggle');
        const sidebarHidden = this.isMobile ? !isVisible : this.isCollapsed;

        if (this.elements.sidebar) {
            this.elements.sidebar.setAttribute('aria-hidden', sidebarHidden ? 'true' : 'false');
            if (this.isMobile) {
                this.elements.sidebar.setAttribute('role', 'dialog');
                this.elements.sidebar.setAttribute('aria-modal', isVisible ? 'true' : 'false');
            } else {
                this.elements.sidebar.setAttribute('role', 'complementary');
                this.elements.sidebar.setAttribute('aria-modal', 'false');
            }
        }

        if (mobileToggle) {
            mobileToggle.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
        }

        if (this.elements.toggleBtn) {
            const expanded = this.isMobile ? isVisible : !this.isCollapsed;
            this.elements.toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }

        if (this.mobileOverlay) {
            this.mobileOverlay.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
        }

        document.body.dataset.mrMobileDrawerOpen = isVisible ? 'true' : 'false';
    }

    /**
     * Return focusable elements inside the mobile drawer.
     * @returns {HTMLElement[]}
     */
    getMobileFocusableElements() {
        if (!this.elements.sidebar) {
            return [];
        }

        const selector = 'a[href], area[href], button:not([disabled]):not([aria-hidden="true"]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
        const elements = this.elements.sidebar.querySelectorAll(selector);
        return Array.from(elements)
            .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
            .map((element) => /** @type {HTMLElement} */ (element));
    }

    /**
     * Trap keyboard focus inside the mobile drawer while open.
     */
    applyMobileFocusTrap() {
        if (!this.isMobile || !this.mobileSidebarVisible) {
            return;
        }

        const focusable = this.getMobileFocusableElements();
        if (focusable.length > 0) {
            focusable[0].focus({ preventScroll: true });
        } else if (this.elements.sidebar) {
            this.elements.sidebar.setAttribute('tabindex', '-1');
            this.elements.sidebar.focus({ preventScroll: true });
        }

        if (this.mobileFocusTrapHandler) {
            document.removeEventListener('keydown', this.mobileFocusTrapHandler, true);
        }

        this.mobileFocusTrapHandler = (event) => {
            if (!this.mobileSidebarVisible) {
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                this.hideMobileSidebar();
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const currentFocusable = this.getMobileFocusableElements();
            if (currentFocusable.length === 0) {
                event.preventDefault();
                if (this.elements.sidebar) {
                    this.elements.sidebar.focus({ preventScroll: true });
                }
                return;
            }

            const first = currentFocusable[0];
            const last = currentFocusable[currentFocusable.length - 1];
            const activeElement = document.activeElement;

            // Type guard to ensure activeElement is an HTMLElement
            const isActiveElementInFocusable = activeElement instanceof HTMLElement && currentFocusable.includes(activeElement);
            
            if (event.shiftKey) {
                if (activeElement === first || !isActiveElementInFocusable) {
                    event.preventDefault();
                    last.focus({ preventScroll: true });
                }
            } else if (activeElement === last || !isActiveElementInFocusable) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };

        document.addEventListener('keydown', this.mobileFocusTrapHandler, true);
    }

    /**
     * Release the mobile focus trap and restore focus.
     */
    releaseMobileFocusTrap() {
        if (this.mobileFocusTrapHandler) {
            document.removeEventListener('keydown', this.mobileFocusTrapHandler, true);
            this.mobileFocusTrapHandler = null;
        }

        if (this.elements.sidebar && this.elements.sidebar.getAttribute('tabindex') === '-1') {
            this.elements.sidebar.removeAttribute('tabindex');
        }

        const fallbackToggle = document.getElementById('mr_mobile_toggle');
        const target = this.previouslyFocusedElement && document.body.contains(this.previouslyFocusedElement)
            ? this.previouslyFocusedElement
            : fallbackToggle;

        if (target && typeof target.focus === 'function') {
            target.focus({ preventScroll: true });
        }

        this.previouslyFocusedElement = null;
    }
    
    /**
     * Ensure a reusable mobile portal container exists
     * @returns {HTMLElement|null}
     */
    ensureMobilePortalContainer() {
        if (!this.mobilePortalContainer || !this.mobilePortalContainer.isConnected) {
            let container = /** @type {HTMLElement|null} */ (document.querySelector('.mr-mobile-portal'));
            if (!container) {
                container = document.createElement('div');
                container.className = 'mr-mobile-portal';
            }
            
            if (!container.parentElement) {
                document.body.appendChild(container);
            }
            
            this.mobilePortalContainer = container;
        }

        if (this.mobilePortalContainer) {
            this.mobilePortalContainer.style.pointerEvents = this.mobileSidebarVisible ? 'auto' : 'none';
            this.mobilePortalContainer.style.transform = 'none';

            if (this.mobileOverlay && this.mobileOverlay.parentElement !== this.mobilePortalContainer) {
                this.mobilePortalContainer.appendChild(this.mobileOverlay);
            }
        }
        
        return this.mobilePortalContainer;
    }
    
    /**
     * Ensure placeholder nodes exist for restoring elements
     * @param {HTMLElement|null} sidebar
     * @param {HTMLElement|null} mobileToggle
     */
    ensurePortalPlaceholders(sidebar = this.elements.sidebar, mobileToggle = document.getElementById('mr_mobile_toggle')) {
        if (!sidebar || !mobileToggle) {
            return;
        }
        
        if (!this.sidebarPlaceholder) {
            this.sidebarPlaceholder = document.createElement('div');
            this.sidebarPlaceholder.className = 'mr-portal-placeholder';
            this.sidebarPlaceholder.style.display = 'none';
        }
        
        if (!this.sidebarPlaceholder.parentElement && this.sidebarOriginalParent) {
            this.sidebarOriginalParent.insertBefore(this.sidebarPlaceholder, this.sidebarNextSibling || null);
        }
        
        if (!this.togglePlaceholder) {
            this.togglePlaceholder = document.createElement('div');
            this.togglePlaceholder.className = 'mr-portal-placeholder';
            this.togglePlaceholder.style.display = 'none';
        }
        
        if (!this.togglePlaceholder.parentElement && this.toggleOriginalParent) {
            this.toggleOriginalParent.insertBefore(this.togglePlaceholder, this.toggleNextSibling || null);
        }
    }
    
    /**
     * Move sidebar, toggle, and overlay into or out of the mobile portal
     */
    updateResponsivePlacement() {
        const sidebar = this.elements.sidebar;
        let mobileToggle = /** @type {HTMLElement|null} */ (document.getElementById('mr_mobile_toggle'));
        const leftSendForm = document.getElementById('leftSendForm');
        
        if (!sidebar) {
            return;
        }
        if (!mobileToggle) {
            mobileToggle = document.createElement('div');
            mobileToggle.id = 'mr_mobile_toggle';
            mobileToggle.className = 'mr-mobile-toggle';
            mobileToggle.innerHTML = '<i class="fa-solid fa-book-atlas"></i>';
            this.initializeMobileToggle();
        }
        
        this.ensurePortalPlaceholders(sidebar, mobileToggle);
        
        if (this.isMobile) {
            const portal = this.ensureMobilePortalContainer();
            if (!portal) {
                return;
            }
            
            portal.style.pointerEvents = this.mobileSidebarVisible ? 'auto' : 'none';
            portal.style.transform = 'none';
            
            if (sidebar.parentElement !== portal) {
                portal.appendChild(sidebar);
            }
            if (leftSendForm && mobileToggle.parentElement !== leftSendForm) {
                leftSendForm.prepend(mobileToggle);
            }

            if (this.mobileOverlay) {
                if (this.mobileSidebarVisible) {
                    this.mobileOverlay.classList.add('mobile-visible');
                    this.mobileOverlay.classList.remove('mobile-hidden');
                } else {
                    this.mobileOverlay.classList.add('mobile-hidden');
                    this.mobileOverlay.classList.remove('mobile-visible');
                }
            }

            if (this.mobileSidebarVisible) {
                sidebar.classList.add('mobile-visible');
                sidebar.classList.remove('mobile-hidden');
            } else {
                sidebar.classList.add('mobile-hidden');
                sidebar.classList.remove('mobile-visible');
            }
        } else {
            if (this.sidebarPlaceholder?.parentElement && sidebar.parentElement !== this.sidebarPlaceholder.parentElement) {
                this.sidebarPlaceholder.parentElement.insertBefore(sidebar, this.sidebarPlaceholder);
            } else if (this.sidebarOriginalParent) {
                this.sidebarOriginalParent.insertBefore(sidebar, this.sidebarNextSibling || null);
            }
            
            sidebar.classList.remove('mobile-visible', 'mobile-hidden');
            
            if (this.togglePlaceholder?.parentElement && mobileToggle.parentElement !== this.togglePlaceholder.parentElement) {
                this.togglePlaceholder.parentElement.insertBefore(mobileToggle, this.togglePlaceholder);
            } else if (this.toggleOriginalParent) {
                this.toggleOriginalParent.insertBefore(mobileToggle, this.toggleNextSibling || null);
            }
            
            if (this.mobileOverlay && this.mobileOverlay.parentElement !== document.body) {
                document.body.appendChild(this.mobileOverlay);
            }
            if (this.mobileOverlay) {
                this.mobileOverlay.classList.add('mobile-hidden');
                this.mobileOverlay.classList.remove('mobile-visible');
            }
            
            if (this.mobilePortalContainer) {
                this.mobilePortalContainer.style.pointerEvents = 'none';
                this.mobilePortalContainer.style.transform = 'none';
            }
        }
    }
}