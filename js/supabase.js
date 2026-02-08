
// We rely on the Supabase CDN script in index.html exposing 'supabase' globally
// <script src="https://unpkg.com/@supabase/supabase-js@2"></script>

const createClient = window.supabase ? window.supabase.createClient : null;

if (!createClient) {
    console.error('Supabase client not loaded from CDN');
    alert('Critical Error: Supabase client failed to load. Please check your connection.');
}

export const SUPABASE_URL = 'https://zoxdjcxsiwlqfvqncihj.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpveGRqY3hzaXdscWZ2cW5jaWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDcyOTYsImV4cCI6MjA4NTg4MzI5Nn0.V81UxddNtZZd_9SprdiJqjEhM2jRcgNHvGO-1hOzlmY';

export let supabase = createClient ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

export const updateSupabaseClient = (customHeaders = {}) => {
    if (!createClient) return;
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: {
            headers: customHeaders
        }
    });
};

export const DB = {
    async getProfile(userId) {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        return { data, error };
    }
};

// ============================================
// AUTO-SAVE UTILITY
// Provides debounced auto-save with visual feedback
// ============================================

export const AutoSave = {
    saveQueue: new Map(),
    indicators: new Map(),

    /**
     * Debounce utility function
     * @param {Function} func - Function to debounce
     * @param {number} delay - Delay in milliseconds
     * @returns {Function} Debounced function
     */
    debounce(func, delay = 500) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    },

    /**
     * Create or get save indicator element
     * @param {HTMLElement} targetElement - Element to attach indicator to
     * @param {string} indicatorId - Unique ID for the indicator
     * @returns {HTMLElement} Indicator element
     */
    getIndicator(targetElement, indicatorId) {
        if (this.indicators.has(indicatorId)) {
            return this.indicators.get(indicatorId);
        }

        const indicator = document.createElement('span');
        indicator.className = 'autosave-indicator';
        indicator.id = `indicator-${indicatorId}`;
        indicator.style.cssText = `
            margin-left: 0.5rem;
            font-size: 0.85rem;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;

        // Insert after the target element
        if (targetElement.parentNode) {
            targetElement.parentNode.insertBefore(indicator, targetElement.nextSibling);
        }

        this.indicators.set(indicatorId, indicator);
        return indicator;
    },

    /**
     * Show save status
     * @param {string} indicatorId - ID of the indicator
     * @param {string} status - Status: 'saving', 'saved', 'error'
     * @param {string} message - Optional custom message
     */
    showStatus(indicatorId, status, message = null) {
        const indicator = this.indicators.get(indicatorId);
        if (!indicator) return;

        const statusConfig = {
            saving: { icon: '🔄', text: 'Saving...', color: 'var(--text-muted)' },
            saved: { icon: '✓', text: 'Saved', color: 'var(--success)' },
            error: { icon: '⚠️', text: 'Failed', color: 'var(--danger)' }
        };

        const config = statusConfig[status] || statusConfig.saved;
        indicator.innerHTML = `<span style="color: ${config.color};">${config.icon} ${message || config.text}</span>`;
        indicator.style.opacity = '1';

        // Auto-hide 'saved' status after 2 seconds
        if (status === 'saved') {
            setTimeout(() => {
                indicator.style.opacity = '0';
            }, 2000);
        }
    },

    /**
     * Hide save status
     * @param {string} indicatorId - ID of the indicator
     */
    hideStatus(indicatorId) {
        const indicator = this.indicators.get(indicatorId);
        if (indicator) {
            indicator.style.opacity = '0';
        }
    },

    /**
     * Auto-save handler with debouncing
     * @param {string} key - Unique key for this save operation
     * @param {Function} saveFunction - Async function to execute the save
     * @param {HTMLElement} targetElement - Element to attach indicator to
     * @param {number} delay - Debounce delay in milliseconds
     * @returns {Function} Debounced save function
     */
    createAutoSave(key, saveFunction, targetElement, delay = 500) {
        const indicatorId = `autosave-${key}`;

        // Create indicator if target element is provided
        if (targetElement) {
            this.getIndicator(targetElement, indicatorId);
        }

        const debouncedSave = this.debounce(async () => {
            try {
                if (targetElement) {
                    this.showStatus(indicatorId, 'saving');
                }

                await saveFunction();

                if (targetElement) {
                    this.showStatus(indicatorId, 'saved');
                }
            } catch (error) {
                console.error(`Auto-save failed for ${key}:`, error);
                if (targetElement) {
                    this.showStatus(indicatorId, 'error', error.message);
                }
            }
        }, delay);

        return debouncedSave;
    },

    /**
     * Immediate save (no debouncing)
     * @param {string} key - Unique key for this save operation
     * @param {Function} saveFunction - Async function to execute the save
     * @param {HTMLElement} targetElement - Optional element to attach indicator to
     */
    async saveImmediate(key, saveFunction, targetElement = null) {
        const indicatorId = `autosave-${key}`;

        try {
            if (targetElement) {
                this.getIndicator(targetElement, indicatorId);
                this.showStatus(indicatorId, 'saving');
            }

            await saveFunction();

            if (targetElement) {
                this.showStatus(indicatorId, 'saved');
            }
        } catch (error) {
            console.error(`Immediate save failed for ${key}:`, error);
            if (targetElement) {
                this.showStatus(indicatorId, 'error', error.message);
            }
        }
    },

    /**
     * Attach auto-save to an input element
     * @param {HTMLInputElement} input - Input element to monitor
     * @param {Function} saveFunction - Function that returns the save promise
     * @param {Object} options - Configuration options
     */
    attachToInput(input, saveFunction, options = {}) {
        const {
            key = input.id || input.name,
            delay = 500,
            showIndicator = true,
            events = ['input']
        } = options;

        const saveHandler = this.createAutoSave(
            key,
            saveFunction,
            showIndicator ? input : null,
            delay
        );

        events.forEach(eventType => {
            input.addEventListener(eventType, saveHandler);
        });

        // Also save on blur as a fallback
        input.addEventListener('blur', saveHandler);
    },

    /**
     * Attach immediate save to a select/checkbox/radio element
     * @param {HTMLElement} element - Element to monitor
     * @param {Function} saveFunction - Function that returns the save promise
     * @param {Object} options - Configuration options
     */
    attachToControl(element, saveFunction, options = {}) {
        const {
            key = element.id || element.name,
            showIndicator = true
        } = options;

        element.addEventListener('change', async () => {
            await this.saveImmediate(
                key,
                saveFunction,
                showIndicator ? element : null
            );
        });
    }
};

// Expose to window for inline usage
window.AutoSave = AutoSave;
