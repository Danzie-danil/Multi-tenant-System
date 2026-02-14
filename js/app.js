

import { Auth } from './auth.js';
import { Dashboard } from './dashboard.js';
import { AutoSave, supabase } from './supabase.js';



const app = {
    state: {
        currentUser: null,
        currentProfile: null,
        currentView: 'auth', // 'auth' | 'dashboard'
        authMode: 'login',   // 'login' | 'register' | 'reset'
        theme: 'light',      // 'dark' | 'light'
        theme: 'light',      // 'dark' | 'light'
        currentCurrency: 'TZS',
        activeModal: null,
        idb: null,
        idbReady: false,
        idbCache: {},
        idbQueue: [],
        pagination: {}
    },

    // Theme Management
    getTheme() {
        return localStorage.getItem('bms-theme') || 'light';
    },

    setTheme(theme, saveToCloud = false) {
        this.state.theme = theme;
        localStorage.setItem('bms-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);

        // Update all theme switches in the DOM
        const themeToggles = document.querySelectorAll('#theme-toggle-btn, .theme-switch-input');
        themeToggles.forEach(toggle => {
            if (toggle.type === 'checkbox') {
                toggle.checked = (theme === 'light');
            }
        });

        // Save to cloud if user is logged in
        if (saveToCloud && this.state.currentUser) {
            this.saveThemeToCloud(theme);
        }
    },

    async saveThemeToCloud(theme) {
        try {
            const profile = this.state.currentProfile;
            if (profile && profile.role === 'branch_manager') {
                // Determine ID (branch_id in mock profile or profile.id which is same)
                await Auth.updateBranch(profile.id, { theme });
            } else if (profile) {
                await Auth.updateProfile({ theme: theme });
            }
            console.log('Theme saved to cloud:', theme);
        } catch (error) {
            console.error('Failed to save theme to cloud:', error);
        }
    },

    toggleTheme() {
        const newTheme = this.state.theme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme, true); // Save to cloud
        return newTheme;
    },

    initTheme() {
        const savedTheme = this.getTheme();
        this.setTheme(savedTheme);
    },

    // Load theme & currency from data (called after login)
    async loadSettingsFromData() {
        const profile = this.state.currentProfile;
        if (!profile) return;

        // Load Theme from Profile
        if (profile?.theme) {
            this.setTheme(profile.theme);
            localStorage.setItem('bms-theme', profile.theme);
        }

        // Load Currency from Enterprise or Branch
        try {
            let entId = profile.enterprise_id;

            // Fetch enterprise settings manually since profile doesn't have it
            if (entId) {
                const { data, error } = await supabase
                    .from('enterprises')
                    .select('currency')
                    .eq('id', entId)
                    .maybeSingle();

                if (!error && data) {
                    this.state.currentCurrency = data.currency || 'TZS';
                }
            }
        } catch (e) {
            console.error("Error loading enterprise settings:", e);
        }

        // Check Security PIN Status (Admin & Branch)
        if (profile.role === 'enterprise_admin' || profile.role === 'branch_manager') {
            try {
                this.state.hasSecurityPin = await Auth.hasSecurityPin();
            } catch (e) {
                console.error("Error checking PIN status:", e);
                this.state.hasSecurityPin = false;
            }
        }
    },

    // Helper to format currency
    formatCurrency(amount) {
        const currency = this.state.currentCurrency || 'TZS';
        let isoCurrency = currency;

        // Map common display codes to ISO codes if needed (legacy support)
        if (currency === 'KSH') isoCurrency = 'KES';
        if (currency === 'TSH') isoCurrency = 'TZS';

        const formatter = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: isoCurrency,
        });

        return formatter.format(amount || 0);
    },

    formatStatValue(amount) {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(Math.round(amount || 0));
    },

    mergeRowsById(primary = [], secondary = []) {
        const merged = [];
        const seen = new Set();
        const addRow = (row) => {
            if (!row) return;
            const rowId = row.id;
            if (rowId) {
                if (seen.has(rowId)) return;
                seen.add(rowId);
            }
            merged.push(row);
        };
        primary.forEach(addRow);
        secondary.forEach(addRow);
        return merged;
    },

    getTodayWindowValue(items = [], getTime, getValue, windowMs = 24 * 60 * 60 * 1000) {
        const list = Array.isArray(items) ? items : [];
        const now = Date.now();
        const nowDate = new Date(now);
        const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
        const rollingStart = now - windowMs;
        const timeFn = typeof getTime === 'function' ? getTime : (item) => item?.createdAt || now;
        const valueFn = typeof getValue === 'function' ? getValue : () => 1;
        let todayTotal = 0;
        let rollingTotal = 0;

        list.forEach((item) => {
            const time = new Date(timeFn(item) || now).getTime();
            const value = Number(valueFn(item) || 0);
            // Relaxed check: allow future timestamps for "today" to handle clock skew
            if (time >= startOfToday) {
                todayTotal += value;
            }
            if (time >= rollingStart && time <= now) {
                rollingTotal += value;
            }
        });

        return todayTotal || rollingTotal;
    },

    calculateSalesProfitStats(sales = [], products = []) {
        const productCostMap = new Map(products.map(product => [product.id, Number(product.costPrice || 0)]));
        let grossProfit = 0;

        sales.forEach((sale) => {
            const cost = productCostMap.get(sale.productId) || 0;
            const price = Number(sale.price || 0);
            const quantity = Number(sale.quantity || 0);
            const profit = (price - cost) * quantity;
            grossProfit += profit;
        });

        const todaysProfit = this.getTodayWindowValue(
            sales,
            (sale) => sale.createdAt || Date.now(),
            (sale) => {
                const cost = productCostMap.get(sale.productId) || 0;
                const price = Number(sale.price || 0);
                const quantity = Number(sale.quantity || 0);
                return (price - cost) * quantity;
            }
        );

        return { grossProfit, todaysProfit };
    },

    // Premium Card Loader
    getLoaderHTML() {
        return `
            <div class="card-loader" role="status" aria-label="Loading">
              <div class="uv-topbar">
                <span class="uv-dot"></span>
                <span class="uv-dot"></span>
                <span class="uv-dot"></span>
                <div class="uv-url"></div>
              </div>

              <div class="uv-body">
                <div class="uv-row uv-h1"></div>
                <div class="uv-row"></div>
                <div class="uv-row"></div>
                <div class="uv-row uv-short"></div>

                <div class="uv-trace" aria-hidden="true"></div>

                <div class="uv-loading">
                  <span>Loading</span>
                  <span class="uv-ell">…</span>
                </div>
              </div>
            </div>
        `;
    },

    // Toast Notification System
    showToast(message, type = 'info', duration = 1500) {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container); // Ensure it exists
        }

        // Check for Dock Intersection (Branch + Operations)
        const isBranch = this.state.currentProfile?.role === 'branch_manager';
        const currentPage = this.state.history[this.state.historyIndex] || 'home';
        if (isBranch && currentPage === 'operations') {
            container.classList.add('dock-safe');
        } else {
            container.classList.remove('dock-safe');
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span>${message}</span>
            <span class="toast-close">&times;</span>
        `;

        toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
        container.appendChild(toast);

        setTimeout(() => toast.remove(), duration);
    },

    // Rich Notification System (Bottom Center / Top Center)
    showNotification(title, content, type = 'success', duration = 5000) {
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            container.className = 'notification-container';
            document.body.appendChild(container);
        }

        // Check for Dock Intersection (Branch + Operations)
        const isBranch = this.state.currentProfile?.role === 'branch_manager';
        const currentPage = this.state.history[this.state.historyIndex] || 'home';
        if (isBranch && currentPage === 'operations') {
            container.classList.add('dock-safe');
        } else {
            container.classList.remove('dock-safe');
        }

        const note = document.createElement('div');
        note.className = 'notification-card';
        note.innerHTML = `
            <div style="display: flex; align-items: start; justify-content: space-between;">
                <h4 style="margin: 0; font-size: 0.95rem; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 0.5rem;">
                    ${type === 'success' ? '<span style="color: var(--success);">✓</span>' : ''}
                    ${title}
                </h4>
                <button class="btn-ghost" style="padding: 0.2rem; height: auto;" onclick="this.closest('.notification-card').remove()">×</button>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;">
                ${content}
            </div>
            <div style="height: 3px; background: var(--bg-surface-hover); width: 100%; border-radius: 2px; margin-top: 0.5rem; overflow: hidden;">
                <div style="height: 100%; background: var(--primary); width: 100%; animation: noteTimer ${duration}ms linear forwards;"></div>
            </div>
        `;

        container.appendChild(note);

        // Auto remove
        setTimeout(() => {
            note.classList.add('hiding');
            setTimeout(() => note.remove(), 300);
        }, duration);
    },

    // Inline Message Box
    showMessage(elementId, message, type = 'info') {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = message;
            el.className = `message-box ${type}`;
        }
    },

    hideMessage(elementId) {
        const el = document.getElementById(elementId);
        if (el) el.classList.add('hidden');
    },

    // Modal Helpers
    // Modal Helpers - with History support for back button
    openModal(modalId) {
        const el = document.getElementById(modalId);
        if (el && this.state.activeModal !== modalId) {
            el.classList.remove('hidden');
            this.state.activeModal = modalId;

            // Push state so back button closes modal
            const currentState = window.history.state || {};
            const newState = { ...currentState, modal: modalId };
            window.history.pushState(newState, '', '');
        }
    },

    closeModal(modalId) {
        // If this modal is the current history state, go back
        if (window.history.state && window.history.state.modal === modalId) {
            window.history.back();
        } else {
            // Fallback for programmatically closed modals not in history
            document.getElementById(modalId)?.classList.add('hidden');
            this.state.activeModal = null;
        }
    },

    // Password Update Form (after clicking reset link)
    showPasswordUpdateForm() {
        // Make sure we show the auth view
        this.dom.dashboardShell?.classList.add('hidden');
        this.dom.authView?.classList.remove('hidden');
        document.body.classList.add('loaded');

        // Hide all forms and show update password form
        this.dom.loginForm?.classList.add('hidden');
        this.dom.registerForm?.classList.add('hidden');
        this.dom.resetForm?.classList.add('hidden');

        // Hide tabs during password update
        document.querySelector('.auth-tabs')?.classList.add('hidden');

        // Show update password form
        let updateForm = document.getElementById('update-password-form');
        if (!updateForm) {
            // Create the form dynamically
            const formHtml = `
                <form id="update-password-form" class="auth-form">
                    <h2 class="gradient-text" style="text-align: center; margin-bottom: 0.5rem;">Set New Password</h2>
                    <p style="color: var(--text-muted); text-align: center; margin-bottom: 1.5rem; font-size: 0.9rem;">
                        Enter your new password below.
                    </p>
                    <div id="update-password-message" class="message-box hidden"></div>
                    <div class="input-group">
                        <label for="new-password">New Password</label>
                        <input type="password" id="new-password" placeholder="Enter new password" required minlength="6">
                    </div>
                    <div class="input-group">
                        <label for="confirm-password">Confirm Password</label>
                        <input type="password" id="confirm-password" placeholder="Confirm new password" required minlength="6">
                    </div>
                    <button type="submit" class="btn-primary">Update Password →</button>
                </form>
            `;

            const authCard = document.querySelector('.auth-card');
            authCard.insertAdjacentHTML('beforeend', formHtml);
            updateForm = document.getElementById('update-password-form');

            // Bind submit handler
            updateForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const newPassword = document.getElementById('new-password').value;
                const confirmPassword = document.getElementById('confirm-password').value;
                const btn = updateForm.querySelector('button[type="submit"]');

                if (newPassword !== confirmPassword) {
                    this.showMessage('update-password-message', 'Passwords do not match!', 'error');
                    return;
                }

                try {
                    btn.textContent = 'Updating...';
                    btn.disabled = true;
                    this.hideMessage('update-password-message');

                    await Auth.updatePassword(newPassword);

                    this.showToast('Password updated successfully!', 'success');

                    // Clean up and return to login
                    updateForm.remove();
                    document.querySelector('.auth-tabs')?.classList.remove('hidden');
                    this.switchAuthMode('login');
                    this.showMessage('auth-message', 'Password updated! You can now log in with your new password.', 'success');

                } catch (error) {
                    console.error(error);
                    this.showMessage('update-password-message', error.message, 'error');
                    btn.textContent = 'Update Password →';
                    btn.disabled = false;
                }
            });
        }

        updateForm.classList.remove('hidden');
    },

    showConfirmModal(message, onConfirm) {
        // Remove existing confirm modal if any
        document.querySelectorAll('.confirm-modal-popup').forEach(el => el.remove());

        const popup = document.createElement('div');
        popup.className = 'confirm-modal-popup';
        popup.innerHTML = `
            <div class="confirm-modal-overlay"></div>
            <div class="confirm-modal-dialog">
                <div class="confirm-modal-message">${message}</div>
                <div class="confirm-modal-actions">
                    <button class="btn-ghost confirm-modal-cancel">Cancel</button>
                    <button class="btn-primary confirm-modal-confirm" style="background: var(--accent, #ef4444);">Delete</button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);

        // Styles for the modal (dynamically added if keyframe verify fails, but simple check)
        if (!document.getElementById('confirm-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'confirm-modal-styles';
            style.textContent = `
                .confirm-modal-popup { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; isolation: isolate; }
                .confirm-modal-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); z-index: -1; animation: fadeIn 0.2s ease-out; }
                .confirm-modal-dialog { background: var(--bg-card, #fff); border: 1px solid var(--border-color); padding: 1.5rem; border-radius: 1rem; width: 90%; max-width: 400px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); transform-origin: center bottom; }
                .confirm-modal-message { font-size: 1.1rem; color: var(--text-main); margin-bottom: 1.5rem; text-align: center; font-weight: 500; }
                .confirm-modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
                .confirm-modal-actions button { flex: 1; justify-content: center; }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
            `;
            document.head.appendChild(style);
        }

        const close = () => popup.remove();

        popup.querySelector('.confirm-modal-overlay').addEventListener('click', close);
        popup.querySelector('.confirm-modal-cancel').addEventListener('click', close);
        popup.querySelector('.confirm-modal-confirm').addEventListener('click', () => {
            close();
            if (onConfirm) onConfirm();
        });
    },

    /**
     * Block all native browser dialogs (prompt, alert, confirm).
     * Call once at startup. Any future code that accidentally calls
     * these will get a console warning and a safe no-op return.
     */
    blockBrowserPrompts() {
        const noop = (type) => (...args) => {
            console.warn(`[BMS] Blocked browser ${type}(). Use inline UI instead.`, ...args);
            return type === 'confirm' ? false : null;
        };
        window.prompt = noop('prompt');
        window.alert = noop('alert');
        window.confirm = noop('confirm');
    },

    async init() {
        console.log('BMS Initializing...');
        this.blockBrowserPrompts();
        this.initTheme(); // Load saved theme preference
        this.cacheDOM();
        this.bindEvents();
        await this.initIndexedDB();

        // Hide auth view initially to prevent flash
        if (this.dom.authView) {
            this.dom.authView.style.display = 'none';
        }

        try {
            const user = await Auth.init();
            if (user) {
                this.state.currentUser = user;
                this.state.currentProfile = Auth.profile;
                await this.loadSettingsFromData(); // Apply user's saved theme & currency

                // Set initial history state to current page (home) so popstate works
                const existingUrlPage = new URLSearchParams(window.location.search).get('page');
                if (!existingUrlPage) {
                    const rolePrefix = this.getRolePrefix(this.state.currentProfile);
                    const urlPage = this.toRoleUrlPage(rolePrefix, 'home');
                    window.history.replaceState({ page: 'home' }, '', `?page=${urlPage}`);
                }

                this.renderDashboard();
            } else {
                // Show auth view if not logged in
                this.setTheme('light'); // Enforce light theme on auth
                if (this.dom.authView) {
                    this.dom.authView.style.display = '';
                    this.dom.authView.classList.remove('hidden');

                    // Set URL to ?page=auth if not already set or clean
                    const params = new URLSearchParams(window.location.search);
                    if (!params.has('page') || params.get('page') !== 'auth') {
                        const url = new URL(window.location);
                        url.searchParams.set('page', 'auth');
                        window.history.replaceState({ page: 'auth' }, '', url);
                    }
                }
                document.body.classList.add('loaded');
            }
        } catch (error) {
            console.error('Auth Init Error:', error);
            // Show auth view on error
            this.setTheme('light'); // Enforce light theme on error
            if (this.dom.authView) {
                this.dom.authView.style.display = '';
                this.dom.authView.classList.remove('hidden');
            }
            document.body.classList.add('loaded');
        }

        // Hide loading screen after auth check
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('hidden');
        }

        // Global click listener for closing interactive cards & handling external links
        document.addEventListener('click', (e) => {
            const welcomeCard = document.querySelector('.welcome-card');
            if (welcomeCard && welcomeCard.classList.contains('expanded')) {
                // Check if click is outside the card
                if (!welcomeCard.contains(e.target)) {
                    welcomeCard.classList.remove('expanded');
                }
            }

            // External Key Handler (WebView Optimization)
            const link = e.target.closest('a');
            if (link && !link.getAttribute('target') && link.hostname !== window.location.hostname && link.hostname.length > 0) {
                e.preventDefault();
                window.open(link.href, '_blank', 'noopener,noreferrer');
            }
        });
    },

    // ── Round Favicon Helper ──
    async setRoundFavicon(imageUrl) {
        try {
            // Force reload by adding timestamp
            const nocacheUrl = `${imageUrl}?v=${Date.now()}`;
            console.log('[BMS] Generating round favicon from:', nocacheUrl);

            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = nocacheUrl;

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = (e) => reject(new Error('Image load failed'));
            });

            const size = 96; // Standard size
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            // Draw circle clip
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
            ctx.closePath();
            ctx.clip();

            // Draw image resized to fit
            ctx.drawImage(img, 0, 0, size, size);

            const dataUrl = canvas.toDataURL('image/png');

            // Remove ALL existing icons to force browser update
            const existingLinks = document.querySelectorAll("link[rel*='icon']");
            existingLinks.forEach(el => el.remove());

            // Create fresh link
            const link = document.createElement('link');
            link.type = 'image/png';
            link.rel = 'icon';
            link.href = dataUrl;
            document.head.appendChild(link);

            console.log('[BMS] Round favicon updated successfully');
        } catch (e) {
            console.warn('[BMS] Failed to generate round favicon:', e);
        }
    },

    cacheDOM() {
        this.dom = {
            app: document.getElementById('app'),
            authView: document.getElementById('auth-view'),
            dashboardShell: document.getElementById('dashboard-shell'),
            loginForm: document.getElementById('login-form'),
            branchLoginForm: document.getElementById('branch-login-form'),
            registerForm: document.getElementById('register-form'),
            resetForm: document.getElementById('reset-form'),
            authTabs: document.querySelectorAll('.auth-tabs button'),
            pageTitle: document.getElementById('page-title'),
            contentArea: document.getElementById('content-area'),
            userName: document.getElementById('user-name'),
            userRole: document.getElementById('user-role'),
            logoutBtn: document.getElementById('logout-btn'),
            forgotPasswordLink: document.getElementById('forgot-password-link'),
            branchForgotPasswordLink: document.getElementById('branch-forgot-password-link'),
            branchResetInfo: document.getElementById('branch-reset-info'),
            backToLoginLink: document.getElementById('back-to-login-link'),
            branchBackToLoginBtn: document.getElementById('branch-back-to-login'),
            sidebar: document.getElementById('main-sidebar'),
            sidebarNav: document.getElementById('sidebar-nav'),
            sidebarOverlay: document.getElementById('sidebar-overlay'),
            mobileMenuBtn: document.getElementById('mobile-menu-btn'),
            quickLogoutBtn: document.getElementById('quick-logout-btn'),
            passwordToggles: document.querySelectorAll('.password-toggle')
        };
    },

    bindEvents() {
        // Auth Tab Switching
        this.dom.authTabs.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.target.getAttribute('data-mode');
                if (mode) this.switchAuthMode(mode);
            });
        });

        // Forgot Password Link
        if (this.dom.forgotPasswordLink) {
            this.dom.forgotPasswordLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchAuthMode('reset');
            });
        }

        // Branch Forgot Password Link
        if (this.dom.branchForgotPasswordLink) {
            this.dom.branchForgotPasswordLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchAuthMode('branch-reset-info');
            });
        }

        // Back to Login Link
        if (this.dom.backToLoginLink) {
            this.dom.backToLoginLink.addEventListener('click', (e) => {
                e.preventDefault();
                // If we were on branch-reset-info, go to branch-login
                // Actually, back-to-login-link is only in the admin reset form.
                this.switchAuthMode('login');
            });
        }

        // Branch Back to Login Button
        if (this.dom.branchBackToLoginBtn) {
            this.dom.branchBackToLoginBtn.addEventListener('click', () => {
                this.switchAuthMode('branch-login');
            });
        }

        // Login
        this.dom.loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-id').value;
            const password = document.getElementById('login-password').value;
            const btn = e.target.querySelector('button[type="submit"]');

            try {
                // Show Global Loader & Hide Auth Card
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen) loadingScreen.classList.remove('hidden');
                if (this.dom.authView) this.dom.authView.classList.add('hidden');

                this.hideMessage('auth-message');

                const { user, profile } = await Auth.login(email, password);

                this.state.currentUser = user;
                this.state.currentProfile = profile;
                await this.loadSettingsFromData(); // Apply user's saved theme
                this.showToast('Login successful!', 'success');
                this.renderDashboard();

                // Hide loader only on success (Dashboard will take over)
                if (loadingScreen) loadingScreen.classList.add('hidden');

            } catch (error) {
                console.error(error);
                // Restore Auth View on Error
                if (this.dom.authView) this.dom.authView.classList.remove('hidden');
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen) loadingScreen.classList.add('hidden');

                this.showMessage('auth-message', error.message, 'error');
                btn.textContent = 'Sign In';
                btn.disabled = false;
            }
        });

        // Branch Login
        this.dom.branchLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loginId = document.getElementById('branch-login-id').value;
            const password = document.getElementById('branch-login-password').value;
            const btn = e.target.querySelector('button[type="submit"]');

            try {
                // Show Global Loader & Hide Auth Card
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen) loadingScreen.classList.remove('hidden');
                if (this.dom.authView) this.dom.authView.classList.add('hidden');

                this.hideMessage('auth-message');

                const { id, name, enterprise_id, api_token, role } = await Auth.loginBranch(loginId, password);

                this.state.currentUser = { id: id, role: 'branch_manager' }; // Mock user object
                this.state.currentProfile = Auth.profile;

                await this.loadSettingsFromData();
                this.showToast(`Welcome back, ${name}!`, 'success');
                this.renderDashboard();

                // Hide loader only on success
                if (loadingScreen) loadingScreen.classList.add('hidden');

            } catch (error) {
                console.error(error);
                // Restore Auth View on Error
                if (this.dom.authView) this.dom.authView.classList.remove('hidden');
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen) loadingScreen.classList.add('hidden');

                // Friendly error for branches
                const message = "Invalid ID or Password. Please contact your admin for a new password.";
                this.showMessage('auth-message', message, 'error');

                btn.textContent = 'Branch Login →';
                btn.disabled = false;
            }
        });

        // Register
        this.dom.registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            const btn = e.target.querySelector('button[type="submit"]');

            try {
                btn.textContent = 'Creating Account...';
                btn.disabled = true;
                this.hideMessage('auth-message');

                const result = await Auth.registerEnterprise(email, password, name);

                if (result.confirmationRequired) {
                    this.showMessage('auth-message', 'Registration successful! Please check your email to confirm your account before logging in.', 'success');
                } else {
                    this.showMessage('auth-message', 'Enterprise registered! You can now log in.', 'success');
                }

                this.switchAuthMode('login');
            } catch (error) {
                console.error(error);
                this.showMessage('auth-message', error.message, 'error');
            } finally {
                btn.textContent = 'Create Account';
                btn.disabled = false;
            }
        });

        // Password Reset
        this.dom.resetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('reset-email').value;
            const btn = e.target.querySelector('button[type="submit"]');

            try {
                btn.textContent = 'Sending...';
                btn.disabled = true;
                this.hideMessage('auth-message');

                await Auth.sendPasswordReset(email);
                this.showMessage('auth-message', 'Password reset link sent! Please check your email.', 'success');

            } catch (error) {
                console.error(error);
                this.showMessage('auth-message', error.message, 'error');
            } finally {
                btn.textContent = 'Send Reset Link';
                btn.disabled = false;
            }
        });

        // Logout
        if (this.dom.logoutBtn) {
            this.dom.logoutBtn.addEventListener('click', async () => {
                await Auth.logout();
                this.logout();
                this.showToast('Logged out successfully', 'info');
            });
        }

        if (this.dom.quickLogoutBtn) {
            this.dom.quickLogoutBtn.addEventListener('click', async () => {
                await Auth.logout();
                this.logout();
                this.showToast('Logged out successfully', 'info');
            });
        }

        // Sidebar Navigation
        document.querySelectorAll('.sidebar-nav .nav-item[data-page]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = e.target.getAttribute('data-page');
                if (page) this.loadPage(page);

                // Update active state
                document.querySelectorAll('.sidebar-nav .nav-item').forEach(l => l.classList.remove('active'));
                e.target.classList.add('active');
            });
        });

        // Modal Close Buttons
        document.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.getAttribute('data-close-modal');
                this.closeModal(modalId);
            });
        });

        // Copy Buttons
        document.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-copy');
                const target = document.getElementById(targetId);
                if (target) {
                    navigator.clipboard.writeText(target.textContent);
                    const originalText = btn.textContent;
                    btn.textContent = '✓';
                    setTimeout(() => btn.textContent = originalText, 1500);
                    this.showToast('Copied to clipboard!', 'success', 2000);
                }
            });
        });

        // Mobile Sidebar Toggle
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        const sidebar = document.getElementById('main-sidebar');
        const overlay = document.getElementById('sidebar-overlay');

        if (mobileMenuBtn && sidebar && overlay) {
            // Toggle sidebar
            mobileMenuBtn.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                overlay.classList.toggle('active');
            });

            // Close on overlay click
            overlay.addEventListener('click', () => {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
            });

            // Close on nav item click (mobile)
            document.querySelectorAll('.sidebar-nav .nav-item').forEach(link => {
                link.addEventListener('click', () => {
                    if (window.innerWidth <= 768) {
                        sidebar.classList.remove('open');
                        overlay.classList.remove('active');
                    }
                });
            });
        }

        // Initialize History State
        this.state.history = ['home']; // Default start page
        this.state.historyIndex = 0;

        // Equalize the binding
        document.getElementById('nav-smart-btn')?.addEventListener('click', () => this.handleSmartNav());

        // Sidebar Navigation
        this.dom.sidebarNav.addEventListener('click', (e) => {
            const link = e.target.closest('.nav-item');
            if (link) {
                e.preventDefault();
                const page = link.dataset.page;
                if (page) {
                    this.loadPage(page); // Add to history (nav controls will appear)
                    // Close sidebar on mobile
                    if (window.innerWidth <= 768) {
                        this.dom.sidebar.classList.remove('open');
                        this.dom.sidebarOverlay.classList.remove('active');
                    }
                }
            }
        });

        // Quick Theme Toggle in Top Bar
        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        if (themeToggleBtn) {
            // Checkbox logic: checked = light mode
            themeToggleBtn.checked = (this.state.theme === 'light');

            themeToggleBtn.addEventListener('change', () => {
                const newTheme = themeToggleBtn.checked ? 'light' : 'dark';
                this.setTheme(newTheme, true);
                this.showToast(`Switched to ${newTheme} mode`, 'success', 2000);
            });
        }

        // Password Visibility Toggles
        document.querySelectorAll('.password-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = btn.getAttribute('data-target');
                const input = document.getElementById(targetId);
                if (input) {
                    const isPassword = input.type === 'password';
                    input.type = isPassword ? 'text' : 'password';

                    if (isPassword) {
                        // Switch to "Hide" (Eye Slash - meaning "Click to Hide", shows Slash) 
                        // Or wait, if I can see password, I want to hide it.
                        // Standard: Eye = Show, Eye Slash = Hide (or "Hidden")
                        // When visible (text), show Eye Slash (to hide).
                        // When hidden (password), show Eye (to show).

                        // Input is now TEXT (Visible). Show Eye Slash.
                        btn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                            </svg>
                        `;
                    } else {
                        // Input is now PASSWORD (Hidden). Show Eye.
                        btn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        `;
                    }
                }
            });
        });

        // Bind Nav Controls
        // Browser Back/Forward Handling
        // Browser Back/Forward Handling
        window.addEventListener('popstate', (event) => {
            // 1. Modal Handling
            const closingModal = this.state.activeModal && (!event.state || event.state.modal !== this.state.activeModal);

            if (closingModal) {
                document.getElementById(this.state.activeModal)?.classList.add('hidden');
                this.state.activeModal = null;
            }

            if (event.state && event.state.modal && event.state.modal !== this.state.activeModal) {
                const el = document.getElementById(event.state.modal);
                if (el) {
                    el.classList.remove('hidden');
                    this.state.activeModal = event.state.modal;
                }
            }

            if (event.state && event.state.page) {
                const newPage = event.state.page;

                // Optimization: If page is same, don't reload (just modal change)
                const currentPage = this.state.history[this.state.historyIndex];
                if (newPage === currentPage && (closingModal || (event.state && event.state.modal))) {
                    return;
                }

                // Sync Internal History Index
                // Check if we went back
                if (this.state.historyIndex > 0 && this.state.history[this.state.historyIndex - 1] === newPage) {
                    this.state.historyIndex--;
                }
                // Check if we went forward
                else if (this.state.historyIndex < this.state.history.length - 1 && this.state.history[this.state.historyIndex + 1] === newPage) {
                    this.state.historyIndex++;
                }
                // If it's a jump or unknown, we just load the page. 
                // Ideally we should rebuild history but for simple back/forward this is enough.

                this.loadPage(newPage, false, true, true); // skipInternal=true, skipBrowser=true
            } else {
                // Handle null state (e.g. back to initial entry point)
                // Default to home or check URL
                this.loadPage('home', false, true, true);
            }
        });

        this.bindNavControls();
    },

    switchAuthMode(mode) {
        this.state.authMode = mode;
        const tabs = this.dom.authTabs;
        const tabContainer = document.querySelector('.auth-tabs');

        // Hide all forms and info cards
        this.dom.loginForm.classList.add('hidden');
        this.dom.branchLoginForm.classList.add('hidden');
        this.dom.registerForm.classList.add('hidden');
        this.dom.resetForm.classList.add('hidden');
        if (this.dom.branchResetInfo) this.dom.branchResetInfo.classList.add('hidden');
        this.hideMessage('auth-message');

        // Reset tab states & visibility
        tabContainer?.classList.remove('hidden');
        tabs.forEach(t => t.classList.remove('active'));

        if (mode === 'login') {
            this.dom.loginForm.classList.remove('hidden');
            if (tabs[0]) tabs[0].classList.add('active');
        } else if (mode === 'branch-login') {
            this.dom.branchLoginForm.classList.remove('hidden');
            if (tabs[1]) tabs[1].classList.add('active');
        } else if (mode === 'register') {
            this.dom.registerForm.classList.remove('hidden');
            if (tabs[2]) tabs[2].classList.add('active');
        } else if (mode === 'reset') {
            this.dom.resetForm.classList.remove('hidden');
        } else if (mode === 'branch-reset-info') {
            // Hide the tabs to prevent jumping during info view
            tabContainer?.classList.add('hidden');
            this.dom.branchResetInfo.classList.remove('hidden');
        }
    },

    // Navigation Configuration
    navConfig: {
        admin: [
            { id: 'home', icon: '◈', label: 'Home' },
            { id: 'branches', icon: '◉', label: 'Branches' },
            { id: 'workspace', icon: '⚡', label: 'Workspace' },
            { id: 'analytics', icon: '◆', label: 'Analytics' },
            { id: 'profile', icon: '👤', label: 'Profile' }
        ],
        branch: [
            { id: 'home', icon: '◈', label: 'Home' },
            { id: 'operations', icon: '⚡', label: 'Operations' },
            { id: 'profile', icon: '👤', label: 'Profile' }
        ]
    },

    renderSidebar() {
        const navContainer = document.getElementById('sidebar-nav');
        if (!navContainer) return;

        const profile = this.state.currentProfile;
        const role = profile?.role === 'enterprise_admin' ? 'admin' : 'branch';
        const items = this.navConfig[role] || [];

        navContainer.innerHTML = items.map(item => `
            <a href="#" class="nav-item ${this.state.history[this.state.historyIndex] === item.id ? 'active' : ''}" data-page="${item.id}">
                <span>${item.icon}</span> ${item.label}
            </a>
        `).join('');
    },

    getRolePrefix(profile = this.state.currentProfile) {
        return profile?.role === 'enterprise_admin' ? 'enterprise' : 'branch';
    },

    toRoleUrlPage(rolePrefix, page) {
        return `${rolePrefix}-${page}`;
    },

    parseRoleUrlPage(urlPage) {
        if (!urlPage) return null;
        const [prefix, ...rest] = urlPage.split('-');
        if (prefix !== 'enterprise' && prefix !== 'branch') return null;
        return { prefix, page: rest.join('-') || 'home' };
    },

    getBranchStorageKey(segment) {
        const profile = this.state.currentProfile;
        const branchId = profile?.branch_id || profile?.id || 'unknown';
        return `bms-branch-${branchId}-${segment}`;
    },

    async initIndexedDB() {
        if (!('indexedDB' in window)) return;
        try {
            const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('bms-app', 1);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('branchData')) {
                        db.createObjectStore('branchData', { keyPath: 'key' });
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            this.state.idb = db;
            this.state.idbReady = true;
            const queue = [...this.state.idbQueue];
            this.state.idbQueue = [];
            await Promise.all(queue.map(item => this.idbSet(item.key, item.value)));
        } catch (error) {
            console.error('IndexedDB init failed:', error);
            this.state.idbReady = false;
        }
    },

    idbGet(key) {
        if (!this.state.idbReady || !this.state.idb) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            const tx = this.state.idb.transaction('branchData', 'readonly');
            const store = tx.objectStore('branchData');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : null);
            request.onerror = () => reject(request.error);
        });
    },

    idbSet(key, value) {
        if (!this.state.idbReady || !this.state.idb) {
            this.state.idbQueue.push({ key, value });
            return Promise.resolve(false);
        }
        return new Promise((resolve, reject) => {
            const tx = this.state.idb.transaction('branchData', 'readwrite');
            const store = tx.objectStore('branchData');
            const request = store.put({ key, value });
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    },

    readBranchData(segment, fallback = []) {
        const key = this.getBranchStorageKey(segment);
        if (this.state.idbCache[key]) {
            const cached = this.state.idbCache[key];
            return Array.isArray(cached) ? [...cached] : cached;
        }
        const raw = localStorage.getItem(key);
        if (!raw) {
            if (this.state.idbReady) {
                this.idbGet(key).then((value) => {
                    if (!value) return;
                    this.state.idbCache[key] = value;
                    localStorage.setItem(key, JSON.stringify(value));
                }).catch(() => { });
            }
            return Array.isArray(fallback) ? [...fallback] : fallback;
        }
        try {
            const parsed = JSON.parse(raw);
            this.state.idbCache[key] = parsed;
            if (this.state.idbReady) {
                this.idbSet(key, parsed).catch(() => { });
            }
            return Array.isArray(parsed) ? parsed : fallback;
        } catch (e) {
            return Array.isArray(fallback) ? [...fallback] : fallback;
        }
    },

    writeBranchData(segment, data) {
        const key = this.getBranchStorageKey(segment);
        const value = data || [];
        localStorage.setItem(key, JSON.stringify(value));
        this.state.idbCache[key] = value;
        this.idbSet(key, value).catch(() => { });
    },

    getPaginationState(key) {
        if (!this.state.pagination[key]) {
            this.state.pagination[key] = { page: 1, pageSize: 10 };
        }
        return this.state.pagination[key];
    },

    setPaginationPage(key, page) {
        const state = this.getPaginationState(key);
        state.page = Math.max(1, page);
    },

    paginateList(list, key, pageSize = 10) {
        const state = this.getPaginationState(key);
        state.pageSize = pageSize;
        const totalItems = list.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        if (state.page > totalPages) state.page = totalPages;
        const start = (state.page - 1) * pageSize;
        const items = list.slice(start, start + pageSize);
        return { items, page: state.page, totalPages, totalItems, pageSize };
    },

    renderPaginationControls(key, page, totalPages) {
        if (totalPages <= 1) return '';
        const prevDisabled = page <= 1 ? 'disabled' : '';
        const nextDisabled = page >= totalPages ? 'disabled' : '';
        return `
            <div class="pagination-controls">
                <button class="btn-ghost" data-page-key="${key}" data-page-action="prev" ${prevDisabled}>Prev</button>
                <div class="pagination-info">Page ${page} of ${totalPages}</div>
                <button class="btn-ghost" data-page-key="${key}" data-page-action="next" ${nextDisabled}>Next</button>
            </div>
        `;
    },

    bindPaginationControls(container, key, totalPages, onChange) {
        container.querySelectorAll(`[data-page-key="${key}"]`).forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-page-action');
                const state = this.getPaginationState(key);
                const nextPage = action === 'next' ? state.page + 1 : state.page - 1;
                const clamped = Math.min(Math.max(1, nextPage), totalPages);
                if (clamped === state.page) return;
                this.setPaginationPage(key, clamped);
                onChange();
            });
        });
    },

    generateId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    },

    mapProductFromDb(row) {
        return {
            id: row.id,
            name: row.name,
            itemType: row.item_type || 'product',
            categoryId: row.category_id,
            costPrice: Number(row.cost_price || 0),
            sellingPrice: Number(row.selling_price || 0),
            unit: row.unit || '',
            stock: row.stock === null || row.stock === undefined ? null : Number(row.stock),
            lowStock: row.low_stock === null || row.low_stock === undefined ? null : Number(row.low_stock),
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapProductToDb(product) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            name: product.name,
            item_type: product.itemType,
            category_id: product.categoryId,
            cost_price: product.costPrice,
            selling_price: product.sellingPrice,
            unit: product.unit || null,
            stock: product.itemType === 'service' ? null : product.stock,
            low_stock: product.itemType === 'service' ? null : product.lowStock
        };
    },

    async fetchBranchProducts() {
        const profile = this.state.currentProfile;
        if (!profile?.branch_id && !profile?.id) return this.readBranchData('products', []);

        try {
            const { data, error } = await supabase
                .from('products')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            const mapped = (data || []).map(row => this.mapProductFromDb(row));
            this.writeBranchData('products', mapped);
            return mapped;
        } catch (error) {
            console.error('Failed to fetch products:', error);
            return this.readBranchData('products', []);
        }
    },

    async createBranchProduct(product) {
        const payload = this.mapProductToDb(product);
        const { data, error } = await supabase
            .from('products')
            .insert(payload)
            .select()
            .single();
        if (error) throw error;
        const mapped = this.mapProductFromDb(data);
        const current = this.readBranchData('products', []);
        this.writeBranchData('products', [mapped, ...current]);
        return mapped;
    },

    async upsertBranchProduct(product) {
        const payload = { ...this.mapProductToDb(product), id: product.id };
        const { data, error } = await supabase
            .from('products')
            .upsert(payload)
            .select()
            .single();
        if (error) throw error;
        const mapped = this.mapProductFromDb(data);
        const current = this.readBranchData('products', []);
        const updated = current.map(p => p.id === mapped.id ? mapped : p);
        if (!updated.find(p => p.id === mapped.id)) updated.unshift(mapped);
        this.writeBranchData('products', updated);
        return mapped;
    },

    async deleteBranchProduct(productId) {
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', productId);
        if (error) throw error;
        const current = this.readBranchData('products', []);
        this.writeBranchData('products', current.filter(p => p.id !== productId));
        return true;
    },

    async fetchBranchRows(table, storageKey, mapper) {
        try {
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            const mapped = mapper ? (data || []).map(row => mapper(row)) : (data || []);
            this.writeBranchData(storageKey, mapped);
            return mapped;
        } catch (error) {
            console.error(`Failed to fetch ${table}:`, error);
            return this.readBranchData(storageKey, []);
        }
    },

    async createBranchRow(table, storageKey, payload, mapper) {
        const { data, error } = await supabase
            .from(table)
            .insert(payload)
            .select()
            .single();
        if (error) throw error;
        const mapped = mapper ? mapper(data) : data;
        const current = this.readBranchData(storageKey, []);
        this.writeBranchData(storageKey, [mapped, ...current]);
        return mapped;
    },

    async upsertBranchRow(table, storageKey, payload, mapper) {
        const { data, error } = await supabase
            .from(table)
            .upsert(payload)
            .select()
            .single();
        if (error) throw error;
        const mapped = mapper ? mapper(data) : data;
        const current = this.readBranchData(storageKey, []);
        const updated = current.map(item => item.id === mapped.id ? mapped : item);
        if (!updated.find(item => item.id === mapped.id)) updated.unshift(mapped);
        this.writeBranchData(storageKey, updated);
        return mapped;
    },

    async deleteBranchRow(table, storageKey, id) {
        const { error } = await supabase
            .from(table)
            .delete()
            .eq('id', id);
        if (error) throw error;
        const current = this.readBranchData(storageKey, []);
        this.writeBranchData(storageKey, current.filter(item => item.id !== id));
        return true;
    },

    mapCategoryFromDb(row) {
        return {
            id: row.id,
            name: row.name,
            description: row.description || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapCategoryToDb(category) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            name: category.name,
            description: category.description || null
        };
    },

    fetchBranchCategories() {
        return this.fetchBranchRows('categories', 'categories', (row) => this.mapCategoryFromDb(row));
    },

    createBranchCategory(category) {
        return this.createBranchRow('categories', 'categories', this.mapCategoryToDb(category), (row) => this.mapCategoryFromDb(row));
    },

    upsertBranchCategory(category) {
        const payload = { ...this.mapCategoryToDb(category), id: category.id };
        return this.upsertBranchRow('categories', 'categories', payload, (row) => this.mapCategoryFromDb(row));
    },

    deleteBranchCategory(categoryId) {
        return this.deleteBranchRow('categories', 'categories', categoryId);
    },

    mapCustomerFromDb(row) {
        return {
            id: row.id,
            name: row.name,
            phone: row.phone || '',
            email: row.email || '',
            address: row.address || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapCustomerToDb(customer) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            name: customer.name,
            phone: customer.phone || null,
            email: customer.email || null,
            address: customer.address || null
        };
    },

    fetchBranchCustomers() {
        return this.fetchBranchRows('customers', 'customers', (row) => this.mapCustomerFromDb(row));
    },

    createBranchCustomer(customer) {
        return this.createBranchRow('customers', 'customers', this.mapCustomerToDb(customer), (row) => this.mapCustomerFromDb(row));
    },

    upsertBranchCustomer(customer) {
        const payload = { ...this.mapCustomerToDb(customer), id: customer.id };
        return this.upsertBranchRow('customers', 'customers', payload, (row) => this.mapCustomerFromDb(row));
    },

    deleteBranchCustomer(customerId) {
        return this.deleteBranchRow('customers', 'customers', customerId);
    },

    mapSaleFromDb(row) {
        return {
            id: row.id,
            productId: row.product_id,
            productName: row.product_name || '',
            categoryId: row.category_id,
            categoryName: row.category_name || '',
            itemType: row.item_type || 'product',
            price: Number(row.price || 0),
            quantity: Number(row.quantity || 0),
            total: Number(row.total || 0),
            customerId: row.customer_id,
            customerName: row.customer_name || '',
            note: row.note || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapSaleToDb(sale) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            product_id: sale.productId || null,
            product_name: sale.productName || null,
            category_id: sale.categoryId || null,
            category_name: sale.categoryName || null,
            item_type: sale.itemType || 'product',
            price: sale.price || 0,
            quantity: sale.quantity || 0,
            total: sale.total || 0,
            customer_id: sale.customerId || null,
            customer_name: sale.customerName || null,
            note: sale.note || null
        };
    },

    async fetchBranchSales(page = 1, pageSize = 10, startDate = null, endDate = null) {
        try {
            const from = (page - 1) * pageSize;
            const to = from + pageSize - 1;

            let query = supabase
                .from('sales')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .range(from, to);

            // Apply filters if provided
            if (startDate) query = query.gte('created_at', startDate.toISOString());
            if (endDate) query = query.lte('created_at', endDate.toISOString());

            const { data, count, error } = await query;
            if (error) throw error;

            const items = (data || []).map(row => this.mapSaleFromDb(row));

            // NOTE: We do NOT cache sales list locally anymore to prevent storage quota issues
            // this.writeBranchData('sales', mapped); 

            return { items, count: count || 0 };
        } catch (error) {
            console.error('Failed to fetch sales page:', error);
            // Return empty structure on error to prevent UI crash
            return { items: [], count: 0 };
        }
    },

    createBranchSale(sale) {
        return this.createBranchRow('sales', 'sales', this.mapSaleToDb(sale), (row) => this.mapSaleFromDb(row));
    },

    upsertBranchSale(sale) {
        const payload = { ...this.mapSaleToDb(sale), id: sale.id };
        return this.upsertBranchRow('sales', 'sales', payload, (row) => this.mapSaleFromDb(row));
    },

    deleteBranchSale(saleId) {
        return this.deleteBranchRow('sales', 'sales', saleId);
    },

    mapExpenseFromDb(row) {
        return {
            id: row.id,
            title: row.title,
            category: row.category || '',
            amount: Number(row.amount || 0),
            note: row.note || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapExpenseToDb(expense) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            title: expense.title,
            category: expense.category || null,
            amount: expense.amount || 0,
            note: expense.note || null
        };
    },

    fetchBranchExpenses() {
        return this.fetchBranchRows('expenses', 'expenses', (row) => this.mapExpenseFromDb(row));
    },

    createBranchExpense(expense) {
        return this.createBranchRow('expenses', 'expenses', this.mapExpenseToDb(expense), (row) => this.mapExpenseFromDb(row));
    },

    upsertBranchExpense(expense) {
        const payload = { ...this.mapExpenseToDb(expense), id: expense.id };
        return this.upsertBranchRow('expenses', 'expenses', payload, (row) => this.mapExpenseFromDb(row));
    },

    deleteBranchExpense(expenseId) {
        return this.deleteBranchRow('expenses', 'expenses', expenseId);
    },

    mapIncomeFromDb(row) {
        return {
            id: row.id,
            title: row.title,
            source: row.source || '',
            amount: Number(row.amount || 0),
            note: row.note || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapIncomeToDb(entry) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            title: entry.title,
            source: entry.source || null,
            amount: entry.amount || 0,
            note: entry.note || null
        };
    },

    fetchBranchIncome() {
        return this.fetchBranchRows('income', 'income', (row) => this.mapIncomeFromDb(row));
    },

    createBranchIncome(entry) {
        return this.createBranchRow('income', 'income', this.mapIncomeToDb(entry), (row) => this.mapIncomeFromDb(row));
    },

    upsertBranchIncome(entry) {
        const payload = { ...this.mapIncomeToDb(entry), id: entry.id };
        return this.upsertBranchRow('income', 'income', payload, (row) => this.mapIncomeFromDb(row));
    },

    deleteBranchIncome(entryId) {
        return this.deleteBranchRow('income', 'income', entryId);
    },

    mapNoteFromDb(row) {
        return {
            id: row.id,
            title: row.title,
            details: row.details || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapNoteToDb(note) {
        const profile = this.state.currentProfile;

        // Debugging for FK violation
        if (!profile) {
            console.error('[BMS] mapNoteToDb: No profile found!');
            throw new Error("User profile missing. Please log in again.");
        }

        let branchId = profile.branch_id;

        // If undefined (e.g. Admin), try to fall back to ID if it looks like a branch context, 
        // but explicit check prevents Admin ID being sent as Branch ID
        if (!branchId && profile.role === 'branch_manager') {
            branchId = profile.id;
        }

        if (!branchId) {
            console.error('[BMS] mapNoteToDb: No valid branch_id found for role:', profile.role);
            // If Admin, we cannot insert without a target branch. 
            // For now, throw specific error to help diagnosis.
            if (profile.role === 'enterprise_admin') {
                throw new Error("Admins cannot add notes directly. Please log in as the Branch Manager.");
            }
            throw new Error("Missing Branch ID context.");
        }

        return {
            branch_id: branchId,
            title: note.title,
            details: note.details || null
        };
    },

    fetchBranchNotes() {
        return this.fetchBranchRows('notes', 'notes', (row) => this.mapNoteFromDb(row));
    },

    async createBranchNote(note) {
        try {
            return await this.createBranchRow('notes', 'notes', this.mapNoteToDb(note), (row) => this.mapNoteFromDb(row));
        } catch (error) {
            console.error('[BMS] createBranchNote error:', error);

            // Fallback: Try without details if schema mismatch suspected
            if (error.message && (error.message.includes('details') || error.message.includes('schema'))) {
                console.warn('[BMS] Schema mismatch for notes (details column). Retrying without details...');
                const payload = this.mapNoteToDb(note);
                delete payload.details;
                return await this.createBranchRow('notes', 'notes', payload, (row) => this.mapNoteFromDb(row));
            }
            throw error;
        }
    },

    async upsertBranchNote(note) {
        try {
            const payload = { ...this.mapNoteToDb(note), id: note.id };
            return await this.upsertBranchRow('notes', 'notes', payload, (row) => this.mapNoteFromDb(row));
        } catch (error) {
            console.error('[BMS] upsertBranchNote error:', error);

            if (error.message && (error.message.includes('details') || error.message.includes('schema'))) {
                console.warn('[BMS] Schema mismatch for notes (details column). Retrying without details...');
                const payload = { ...this.mapNoteToDb(note), id: note.id };
                delete payload.details;
                return await this.upsertBranchRow('notes', 'notes', payload, (row) => this.mapNoteFromDb(row));
            }
            throw error;
        }
    },

    deleteBranchNote(noteId) {
        return this.deleteBranchRow('notes', 'notes', noteId);
    },

    mapInventoryFromDb(row) {
        return {
            id: row.id,
            productId: row.product_id,
            type: row.type,
            quantity: Number(row.quantity || 0),
            note: row.note || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapInventoryToDb(entry) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            product_id: entry.productId || null,
            type: entry.type,
            quantity: entry.quantity || 0,
            note: entry.note || null
        };
    },

    fetchBranchInventory() {
        return this.fetchBranchRows('inventory_movements', 'inventory', (row) => this.mapInventoryFromDb(row));
    },

    createBranchInventory(entry) {
        return this.createBranchRow('inventory_movements', 'inventory', this.mapInventoryToDb(entry), (row) => this.mapInventoryFromDb(row));
    },

    upsertBranchInventory(entry) {
        const payload = { ...this.mapInventoryToDb(entry), id: entry.id };
        return this.upsertBranchRow('inventory_movements', 'inventory', payload, (row) => this.mapInventoryFromDb(row));
    },

    deleteBranchInventory(entryId) {
        return this.deleteBranchRow('inventory_movements', 'inventory', entryId);
    },

    mapInvoiceFromDb(row) {
        return {
            id: row.id,
            invoiceNumber: row.invoice_number,
            customerId: row.customer_id,
            customerName: row.customer_name || '',
            amount: Number(row.amount || 0),
            status: row.status || 'unpaid',
            dueDate: row.due_date || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapInvoiceToDb(invoice) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            invoice_number: invoice.invoiceNumber,
            customer_id: invoice.customerId || null,
            customer_name: invoice.customerName || null,
            amount: invoice.amount || 0,
            status: invoice.status || 'unpaid',
            due_date: invoice.dueDate || null
        };
    },

    fetchBranchInvoices() {
        return this.fetchBranchRows('invoices', 'invoices', (row) => this.mapInvoiceFromDb(row));
    },

    createBranchInvoice(invoice) {
        return this.createBranchRow('invoices', 'invoices', this.mapInvoiceToDb(invoice), (row) => this.mapInvoiceFromDb(row));
    },

    upsertBranchInvoice(invoice) {
        const payload = { ...this.mapInvoiceToDb(invoice), id: invoice.id };
        return this.upsertBranchRow('invoices', 'invoices', payload, (row) => this.mapInvoiceFromDb(row));
    },

    deleteBranchInvoice(invoiceId) {
        return this.deleteBranchRow('invoices', 'invoices', invoiceId);
    },

    mapReportFromDb(row) {
        return {
            id: row.id,
            type: row.type,
            period: row.period,
            note: row.note || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapReportToDb(report) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            type: report.type,
            period: report.period,
            note: report.note || null
        };
    },

    fetchBranchReports() {
        return this.fetchBranchRows('reports', 'reports', (row) => this.mapReportFromDb(row));
    },

    createBranchReport(report) {
        return this.createBranchRow('reports', 'reports', this.mapReportToDb(report), (row) => this.mapReportFromDb(row));
    },

    upsertBranchReport(report) {
        const payload = { ...this.mapReportToDb(report), id: report.id };
        return this.upsertBranchRow('reports', 'reports', payload, (row) => this.mapReportFromDb(row));
    },

    deleteBranchReport(reportId) {
        return this.deleteBranchRow('reports', 'reports', reportId);
    },

    mapLoanFromDb(row) {
        return {
            id: row.id,
            borrower: row.borrower,
            amount: Number(row.amount || 0),
            interest: Number(row.interest || 0),
            status: row.status || 'active',
            dueDate: row.due_date || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapLoanToDb(loan) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            borrower: loan.borrower,
            amount: loan.amount || 0,
            interest: loan.interest || 0,
            status: loan.status || 'active',
            due_date: loan.dueDate || null
        };
    },

    fetchBranchLoans() {
        return this.fetchBranchRows('loans', 'loans', (row) => this.mapLoanFromDb(row));
    },

    createBranchLoan(loan) {
        return this.createBranchRow('loans', 'loans', this.mapLoanToDb(loan), (row) => this.mapLoanFromDb(row));
    },

    upsertBranchLoan(loan) {
        const payload = { ...this.mapLoanToDb(loan), id: loan.id };
        return this.upsertBranchRow('loans', 'loans', payload, (row) => this.mapLoanFromDb(row));
    },

    deleteBranchLoan(loanId) {
        return this.deleteBranchRow('loans', 'loans', loanId);
    },

    mapAssetFromDb(row) {
        return {
            id: row.id,
            name: row.name,
            value: Number(row.value || 0),
            purchaseDate: row.purchase_date || '',
            condition: row.condition || '',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapAssetToDb(asset) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            name: asset.name,
            value: asset.value || 0,
            purchase_date: asset.purchaseDate || null,
            condition: asset.condition || null
        };
    },

    fetchBranchAssets() {
        return this.fetchBranchRows('assets', 'assets', (row) => this.mapAssetFromDb(row));
    },

    createBranchAsset(asset) {
        return this.createBranchRow('assets', 'assets', this.mapAssetToDb(asset), (row) => this.mapAssetFromDb(row));
    },

    upsertBranchAsset(asset) {
        const payload = { ...this.mapAssetToDb(asset), id: asset.id };
        return this.upsertBranchRow('assets', 'assets', payload, (row) => this.mapAssetFromDb(row));
    },

    deleteBranchAsset(assetId) {
        return this.deleteBranchRow('assets', 'assets', assetId);
    },

    mapMaintenanceFromDb(row) {
        return {
            id: row.id,
            title: row.title,
            asset: row.asset || '',
            cost: Number(row.cost || 0),
            status: row.status || 'scheduled',
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        };
    },

    mapMaintenanceToDb(task) {
        const profile = this.state.currentProfile;
        return {
            branch_id: profile?.branch_id || profile?.id,
            title: task.title,
            asset: task.asset || null,
            cost: task.cost || 0,
            status: task.status || 'scheduled'
        };
    },

    fetchBranchMaintenance() {
        return this.fetchBranchRows('maintenance', 'maintenance', (row) => this.mapMaintenanceFromDb(row));
    },

    createBranchMaintenance(task) {
        return this.createBranchRow('maintenance', 'maintenance', this.mapMaintenanceToDb(task), (row) => this.mapMaintenanceFromDb(row));
    },

    upsertBranchMaintenance(task) {
        const payload = { ...this.mapMaintenanceToDb(task), id: task.id };
        return this.upsertBranchRow('maintenance', 'maintenance', payload, (row) => this.mapMaintenanceFromDb(row));
    },

    deleteBranchMaintenance(taskId) {
        return this.deleteBranchRow('maintenance', 'maintenance', taskId);
    },

    adjustStatFontSizes() {
        if (window.innerWidth > 768) return; // Only on mobile

        const statValues = document.querySelectorAll('.stat-value');
        statValues.forEach(el => {
            const container = el.closest('.stat-card');
            if (!container) return;

            // Initial reset to base mobile size defined in CSS (1.5rem = 24px)
            // Using a slightly more conservative starting point for logic
            let fontSize = 24;
            el.style.fontSize = fontSize + 'px';

            const maxWidth = container.clientWidth - parseInt(window.getComputedStyle(container).paddingLeft) - parseInt(window.getComputedStyle(container).paddingRight);

            // Loop to shrink font until it fits
            while (el.scrollWidth > maxWidth && fontSize > 10) {
                fontSize -= 0.5;
                el.style.fontSize = fontSize + 'px';
            }
        });
    },

    bindCollapseControls(container = document) {
        container.querySelectorAll('[data-collapse-target]').forEach(btn => {
            const targetId = btn.getAttribute('data-collapse-target');
            const target = document.getElementById(targetId);
            if (target) {
                const isHidden = target.classList.contains('hidden');
                btn.classList.toggle('collapse-hint', isHidden);
            }
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-collapse-target');
                const target = document.getElementById(targetId);
                if (!target) return;
                const isHidden = target.classList.contains('hidden');
                if (isHidden) {
                    target.classList.remove('hidden');
                } else {
                    target.classList.add('hidden');
                }
                const openText = btn.getAttribute('data-collapse-open-text') || 'Create';
                const closeText = btn.getAttribute('data-collapse-close-text') || 'Close';
                btn.textContent = isHidden ? closeText : openText;
                btn.classList.toggle('collapse-hint', !isHidden);
            });
        });
    },

    loadPage(page, isTopLevel = false, skipHistory = false, skipBrowserPush = false) {
        const profile = this.state.currentProfile;
        const role = profile?.role === 'enterprise_admin' ? 'admin' : 'branch';

        // ── STRICT RBAC CHECK ──
        // Only allow pages explicitly defined in navConfig for this role.
        // Also allow 'settings' as it is a valid internal redirect to 'profile'.
        const allowedPages = this.navConfig[role]?.map(p => p.id) || [];
        // Note: 'home' is implicitly allowed, but usually in navConfig anyway.
        if (page !== 'home' && !allowedPages.includes(page) && page !== 'settings') {
            console.warn(`[Security] Access denied: Role '${role}' cannot access page '${page}'. Redirecting to home.`);
            return this.loadPage('home', true, false, false);
        }
        // ── END RBAC CHECK ──

        const rolePrefix = this.getRolePrefix(profile);

        // Browser History Integration
        if (!skipBrowserPush) {
            const urlPage = this.toRoleUrlPage(rolePrefix, page);
            const url = `?page=${urlPage}`;
            // Avoid pushing duplicate state if we're already ON this page (e.g. initial load)
            if (!window.history.state || window.history.state.page !== page) {
                window.history.pushState({ page: page }, '', url);
            } else {
                window.history.replaceState({ page: page }, '', url); // Ensure URL is correct
            }
        }
        if (!skipHistory) {
            if (isTopLevel) {
                // Reset History for Top Level Navigation
                this.state.history = [page];
                this.state.historyIndex = 0;
            } else {
                // Inner Navigation - Add to History
                // Remove any forward history if we diverge
                if (this.state.historyIndex < this.state.history.length - 1) {
                    this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
                }
                this.state.history.push(page);
                this.state.historyIndex++;
            }
        }

        this.updateNavControls();

        // Update Sidebar Active State
        // Re-render sidebar to ensure correct active state logic if needed, 
        // or just update classes if DOM exists.
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.page === page);
        });

        const navItem = this.navConfig[role]?.find(i => i.id === page);
        this.dom.pageTitle.textContent = navItem ? navItem.label : (page.charAt(0).toUpperCase() + page.slice(1));

        // Cleanup Operations Dock if exists (it's appended to body now)
        const existingDock = document.getElementById('ops-dock');
        if (existingDock) existingDock.remove();

        // Immediately show loading skeleton with animation (instant feedback on click)
        this.dom.contentArea.innerHTML = `
            <div class="page-enter" style="padding: 1rem;">
                <div class="skeleton-block" style="height: 2rem; width: 40%; margin-bottom: 1.5rem;"></div>
                <div class="skeleton-block" style="height: 8rem; margin-bottom: 1rem;"></div>
                <div class="skeleton-block" style="height: 8rem;"></div>
            </div>
        `;

        // Page Loading Logic
        if (page === 'branches') {
            if (role === 'admin') Dashboard.loadBranches();
        } else if (page === 'home') {
            this.renderHome();
            if (role === 'admin') Dashboard.loadStats();
        } else if (page === 'settings') {
            this.loadPage('profile', false, true, true); // Redirect to profile
        } else if (page === 'workspace') {
            const title = role === 'admin' ? 'Workspace Module' : 'Products Module';
            this.dom.contentArea.innerHTML = `<div class="card page-enter"><h3>${title}</h3><p class="text-muted">Coming Soon...</p></div>`;
        } else if (page === 'sales') {
            this.dom.contentArea.innerHTML = `<div class="card page-enter"><h3>Sales Module</h3><p class="text-muted">Coming Soon...</p></div>`;
        } else if (page === 'profile') {
            this.renderProfile();
        } else if (page === 'analytics') {
            this.dom.contentArea.innerHTML = `<div class="card page-enter"><h3>Analytics Module</h3><p class="text-muted">Coming Soon...</p></div>`;
        } else if (page === 'operations') {
            this.renderOperations();
        }

        // Run font resizing after content is likely rendered
        // Give enough time for DOM to stabilize and for currency formatting to complete
        setTimeout(() => this.adjustStatFontSizes(), 50);
    },

    renderOperations() {
        this.dom.pageTitle.textContent = 'Operations';

        // Dock Items Definition
        this.dockItems = [
            { id: 'sales', icon: '💰', label: 'Sales', active: true },
            { id: 'expenses', icon: '💸', label: 'Expenses' },
            { id: 'income', icon: '📈', label: 'Income' },
            { id: 'notes', icon: '📝', label: 'Notes' },
            { id: 'inventory', icon: '📦', label: 'Inventory' },
            { id: 'products', icon: '🛍️', label: 'Products' },
            { id: 'customers', icon: '👥', label: 'Customers' },
            { id: 'categories', icon: '🏷️', label: 'Categories' },
            { id: 'invoices', icon: '🧾', label: 'Inv & Rec' },
            { id: 'reports', icon: '📊', label: 'Reports' },
            { id: 'loans', icon: '🏦', label: 'Loans' },
            { id: 'assets', icon: '🏢', label: 'Assets' },
            { id: 'maintenance', icon: '🔧', label: 'Maint.' }
        ];

        // Main Container
        this.dom.contentArea.innerHTML = `
            <div id="ops-canvas" class="action-canvas page-enter">
                <div style="text-align: center; margin-top: 10%;">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">⚡</div>
                    <h3>Select an Operation</h3>
                    <p class="text-muted">Choose a tool from the dock below to get started.</p>
                </div>
            </div>
        `;

        // Render Dock Container (empty initially)
        // Ensure old dock is removed first
        const existingDock = document.getElementById('ops-dock');
        if (existingDock) existingDock.remove();

        const dockHTML = `<div class="dock-container" id="ops-dock"></div>`;
        document.body.insertAdjacentHTML('beforeend', dockHTML);

        // Initial Render
        this.renderDockItems();

        // Bind Resize Listener for Dynamic Dock
        // Debounce resize to avoid excessive calculations
        let resizeTimeout;
        this.state.dockResizeListener = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                // Only re-render if we are still on the operations page
                if (document.getElementById('ops-dock')) {
                    this.renderDockItems();
                }
            }, 100);
        };
        window.removeEventListener('resize', this.state.dockResizeListener); // Remove old reference if exists? 
        // Better way: store listener in state and remove it in loadPage cleanup logic. 
        // For now, simple add.
        window.addEventListener('resize', this.state.dockResizeListener);

        this.bindDockEvents();
    },

    renderDockItems() {
        const dockContainer = document.getElementById('ops-dock');
        if (!dockContainer) return;

        const width = window.innerWidth;
        let visibleCount = 4; // Mobile default (4 + Menu)

        if (width > 1200) {
            visibleCount = 10; // Large screens
        } else if (width > 900) {
            visibleCount = 8; // Desktop
        } else if (width > 700) {
            visibleCount = 6; // Tablet
        }

        // If all items fit, show them all and hide menu
        if (this.dockItems.length <= visibleCount) {
            const html = this.dockItems.map(item => this.renderDockItem(item.id, item.icon, item.label, item.active || false)).join('');
            dockContainer.innerHTML = html;
            return;
        }

        // Otherwise, split items and insert menu in the center
        const visibleItems = this.dockItems.slice(0, visibleCount);
        const overflowItems = this.dockItems.slice(visibleCount);

        const midInfo = Math.ceil(visibleItems.length / 2);
        const leftItems = visibleItems.slice(0, midInfo);
        const rightItems = visibleItems.slice(midInfo);

        let html = leftItems.map(item => this.renderDockItem(item.id, item.icon, item.label, item.active || false)).join('');

        // Render Menu Button with Overflow Items
        const menuItemsHTML = overflowItems.map(item => this.renderMoreItem(item.id, item.icon, item.label)).join('');

        html += `
            <div class="dock-item" id="dock-more-btn">
                <div class="dock-icon" style="background: var(--text-main); color: var(--bg-surface);">▦</div>
                <span class="dock-label">Menu</span>
                <div class="dock-more-menu" id="dock-menu">
                    ${menuItemsHTML}
                </div>
            </div>
        `;

        html += rightItems.map(item => this.renderDockItem(item.id, item.icon, item.label, item.active || false)).join('');

        dockContainer.innerHTML = html;

        // Ensure active state is preserved correctly? 
        // Logic handles 'active' property from dockItems.
        // But clicking updates active class. 
        // On re-render, we lose active class!
        // We should sync 'active' state from current DOM or state before re-rendering?
        // Or update dockItems array when an item is clicked.
        // Let's rely on simple re-render for now, active state might be lost on resize.
        // To fix: update this.dockItems active property in setActiveOp.
    },

    renderDockItem(id, icon, label, isActive) {
        return `
            <div class="dock-item ${isActive ? '' : ''}" data-op="${id}">
                <div class="dock-icon">${icon}</div>
                <span class="dock-label">${label}</span>
            </div>
        `;
    },

    renderMoreItem(id, icon, label) {
        return `
            <div class="more-item" data-op="${id}">
                <div style="font-size: 1.5rem;">${icon}</div>
                <span style="font-size: 0.8rem;">${label}</span>
            </div>
        `;
    },

    bindDockEvents() {
        const dockContainer = document.getElementById('ops-dock');
        if (!dockContainer) return;

        // Use delegation for dock items and menu items
        // This ensures listeners work even after innerHTML is updated by resize
        dockContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.dock-item[data-op]');
            const moreItem = e.target.closest('.more-item[data-op]');
            const moreBtn = e.target.closest('#dock-more-btn');
            const menu = document.getElementById('dock-menu');
            const canvas = document.getElementById('ops-canvas');

            // 1. Main Dock Items
            if (item) {
                this.setActiveOp(item.dataset.op, canvas);
                // Visual Update
                document.querySelectorAll('.dock-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            }

            // 2. More Menu Items
            if (moreItem) {
                e.stopPropagation();
                this.setActiveOp(moreItem.dataset.op, canvas);
                if (menu) menu.classList.remove('open');
                // Visual Update for Parent 'Menu' Item?
                document.querySelectorAll('.dock-item').forEach(i => i.classList.remove('active'));
                const menuParent = document.getElementById('dock-more-btn');
                if (menuParent) menuParent.classList.add('active');
            }

            // 3. Toggle Menu
            if (moreBtn && !e.target.closest('.dock-more-menu')) {
                if (menu) menu.classList.toggle('open');
            }
        });

        // Close menu when clicking outside (Global)
        // Manage listener to prevent duplicates on re-render
        if (this.state.dockGlobalListener) {
            document.removeEventListener('click', this.state.dockGlobalListener);
        }

        this.state.dockGlobalListener = (e) => {
            const moreBtn = document.getElementById('dock-more-btn');
            const menu = document.getElementById('dock-menu');
            // Only run if elements exist and click is OUTSIDE
            if (moreBtn && menu && menu.classList.contains('open')) {
                if (!moreBtn.contains(e.target) && !menu.contains(e.target)) {
                    menu.classList.remove('open');
                }
            }
        };
        document.addEventListener('click', this.state.dockGlobalListener);
    },

    setActiveOp(opId, canvas) {
        if (!canvas) return;

        if (opId === 'sales') {
            this.renderSalesModule(canvas);
            return;
        }

        if (opId === 'expenses') {
            this.renderExpensesModule(canvas);
            return;
        }

        if (opId === 'income') {
            this.renderIncomeModule(canvas);
            return;
        }

        if (opId === 'notes') {
            this.renderNotesModule(canvas);
            return;
        }

        if (opId === 'customers') {
            this.renderCustomersModule(canvas);
            return;
        }

        if (opId === 'invoices') {
            this.renderInvoicesModule(canvas);
            return;
        }

        if (opId === 'reports') {
            this.renderReportsModule(canvas);
            return;
        }

        if (opId === 'loans') {
            this.renderLoansModule(canvas);
            return;
        }

        if (opId === 'assets') {
            this.renderAssetsModule(canvas);
            return;
        }

        if (opId === 'maintenance') {
            this.renderMaintenanceModule(canvas);
            return;
        }

        if (opId === 'categories') {
            this.renderCategoriesModule(canvas);
            return;
        }

        if (opId === 'products') {
            this.renderProductsModule(canvas);
            return;
        }

        if (opId === 'inventory') {
            this.renderInventoryModule(canvas);
            return;
        }

        let content = '';
        const title = opId.charAt(0).toUpperCase() + opId.slice(1);

        content = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h3>${title} Module</h3>
                    <button class="btn-ghost">Action</button>
                </div>
                <div class="card" style="min-height: 400px; display: flex; align-items: center; justify-content: center; background: var(--bg-surface-elevated);">
                    <div style="text-align: center;">
                        <span style="font-size: 3rem; opacity: 0.5;">${this.getOpIcon(opId)}</span>
                        <p class="text-muted" style="margin-top: 1rem;">${title} Canvas - Ready for Implementation</p>
                    </div>
                </div>
            </div>
        `;

        canvas.innerHTML = content;
    },

    async renderCategoriesModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();
        const [categories, products] = await Promise.all([
            this.fetchBranchCategories(),
            this.fetchBranchProducts()
        ]);
        const { items: pagedCategories, page: categoriesPage, totalPages: categoriesPages } = this.paginateList(categories, 'categories', 10);
        const rows = pagedCategories.map(cat => {
            const count = products.filter(p => p.categoryId === cat.id).length;
            return `
                <tr>
                    <td data-label="Category"><strong>${cat.name}</strong></td>
                    <td data-label="Description">${cat.description || '-'}</td>
                    <td data-label="Products">${count}</td>
                    <td data-label="Actions" style="text-align: right;">
                        <button class="btn-ghost" data-category-delete="${cat.id}">Delete</button>
                    </td>
                </tr>
            `;
        }).join('');

        canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Categories</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Create groups for your products</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Category</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-category-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-category-body" class="hidden">
                        <div id="ops-categories-message" class="message-box hidden"></div>
                        <form id="ops-category-form" class="auth-form" style="max-width: 100%;">
                        <div class="input-group">
                            <label>Category Name</label>
                            <input type="text" id="category-name" placeholder="e.g. Beverages" required>
                        </div>
                        <div class="input-group">
                            <label>Description</label>
                            <input type="text" id="category-desc" placeholder="Optional short description">
                        </div>
                        <button type="submit" class="btn-primary" style="width: auto;">Add Category</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Category List</h4>
                    </div>
                    ${categories.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No categories yet. Add your first one above.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Description</th>
                                        <th>Products</th>
                                        <th style="text-align: right;">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('categories', categoriesPage, categoriesPages)}
                    `}
                </div>
            </div>
        `;

        setTimeout(() => {
            this.bindCollapseControls(canvas);
            this.bindPaginationControls(canvas, 'categories', categoriesPages, () => this.renderCategoriesModule(canvas));
            const form = document.getElementById('ops-category-form');
            if (form) {
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    this.hideMessage('ops-categories-message');
                    const name = document.getElementById('category-name').value.trim();
                    const description = document.getElementById('category-desc').value.trim();
                    if (!name) {
                        this.showMessage('ops-categories-message', 'Category name is required.', 'error');
                        return;
                    }
                    const exists = categories.some(c => c.name.toLowerCase() === name.toLowerCase());
                    if (exists) {
                        this.showMessage('ops-categories-message', 'Category already exists.', 'error');
                        return;
                    }
                    const submitBtn = form.querySelector('button[type="submit"]');
                    if (submitBtn) {
                        submitBtn.textContent = 'Saving...';
                        submitBtn.disabled = true;
                    }
                    try {
                        await this.createBranchCategory({ name, description });
                        this.showToast('Category added', 'success');
                        this.renderCategoriesModule(canvas);
                    } catch (error) {
                        console.error('Failed to save category:', error);
                        this.showMessage('ops-categories-message', error.message || 'Failed to save category.', 'error');
                    } finally {
                        if (submitBtn) {
                            submitBtn.textContent = 'Add Category';
                            submitBtn.disabled = false;
                        }
                    }
                });
            }

            document.querySelectorAll('[data-category-delete]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.getAttribute('data-category-delete');
                    const used = products.some(p => p.categoryId === id);
                    if (used) {
                        this.showToast('Remove products in this category first', 'error');
                        return;
                    }
                    this.promptPinVerification(async () => {
                        try {
                            await this.deleteBranchCategory(id);
                            this.showToast('Category removed', 'info');
                            this.renderCategoriesModule(canvas);
                        } catch (error) {
                            console.error('Failed to delete category:', error);
                            this.showToast('Failed to delete category', 'error');
                        }
                    });
                });
            });
        }, 0);
    },

    renderProductsModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        Promise.all([this.fetchBranchCategories(), this.fetchBranchProducts()]).then(([categories, products]) => {
            const options = categories.map(cat => `<option value="${cat.id}">${cat.name}</option>`).join('');
            const { items: pagedProducts, page: productsPage, totalPages: productsPages } = this.paginateList(products, 'products', 10);
            const rows = pagedProducts.map(product => {
                const category = categories.find(c => c.id === product.categoryId);
                const itemType = product.itemType || 'product';
                const stockValue = itemType === 'service' ? '-' : (product.stock ?? 0);
                const lowStockValue = itemType === 'service' ? '-' : (product.lowStock ?? '-');
                return `
                    <tr>
                        <td data-label="Product"><strong>${product.name}</strong></td>
                        <td data-label="Category">${category ? category.name : '-'}</td>
                        <td data-label="Type">${itemType}</td>
                        <td data-label="Cost">${this.formatCurrency(product.costPrice || 0)}</td>
                        <td data-label="Selling">${this.formatCurrency(product.sellingPrice || 0)}</td>
                        <td data-label="Stock">${stockValue}</td>
                        <td data-label="Low Stock">${lowStockValue}</td>
                        <td data-label="Actions" style="text-align: right;">
                            <button class="btn-ghost" data-product-delete="${product.id}">Delete</button>
                        </td>
                    </tr>
                `;
            }).join('');

            canvas.innerHTML = `
                <div class="page-enter">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                        <div>
                            <h3>Products</h3>
                            <div class="text-muted" style="font-size: 0.85rem;">Create and manage your product catalog</div>
                        </div>
                    </div>

                    <div class="card" style="margin-bottom: 1.5rem;">
                        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                            <h4 class="card-title">New Product</h4>
                            <button type="button" class="btn-ghost" data-collapse-target="ops-product-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                        </div>
                        <div id="ops-product-body" class="hidden">
                            <div id="ops-products-message" class="message-box hidden"></div>
                            <form id="ops-product-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Product Name</label>
                                <input type="text" id="product-name" placeholder="e.g. Cola 500ml" required>
                            </div>
                            <div class="input-group">
                                <label>Item Type</label>
                                <select id="product-type" class="input-field">
                                    <option value="product" selected>Product</option>
                                    <option value="service">Service</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label>Category</label>
                                <select id="product-category" class="input-field">
                                    <option value="" disabled selected>${categories.length === 0 ? 'Add or create category' : 'Select category'}</option>
                                    ${options}
                                    <option value="__new__">+ Create new category</option>
                                </select>
                            </div>
                            <div id="product-new-category" class="hidden" style="display: grid; gap: 1rem;">
                                <div class="input-group">
                                    <label>New Category Name</label>
                                    <input type="text" id="product-new-category-name" placeholder="e.g. Beverages">
                                </div>
                                <div class="input-group">
                                    <label>New Category Description</label>
                                    <input type="text" id="product-new-category-desc" placeholder="Optional short description">
                                </div>
                            </div>
                            <div class="input-group">
                                <label>Cost Price</label>
                                <input type="number" id="product-cost" min="0" step="0.01" placeholder="0.00" required>
                            </div>
                            <div class="input-group">
                                <label>Selling Price</label>
                                <input type="number" id="product-selling" min="0" step="0.01" placeholder="0.00" required>
                            </div>
                            <div class="input-group">
                                <label>Unit</label>
                                <input type="text" id="product-unit" placeholder="e.g. bottle, pack">
                            </div>
                            <div class="input-group" id="product-stock-group">
                                <label>Opening Stock</label>
                                <input type="number" id="product-stock" min="0" step="1" placeholder="0">
                            </div>
                            <div class="input-group" id="product-low-group">
                                <label>Low Stock Alert</label>
                                <input type="number" id="product-low" min="0" step="1" placeholder="5" value="5">
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Add Product</button>
                            </form>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header">
                            <h4 class="card-title">Product List</h4>
                        </div>
                        ${products.length === 0 ? `
                            <div class="text-muted" style="padding: 1rem;">No products yet. Add your first product above.</div>
                        ` : `
                            <div class="table-container">
                                <table class="data-table">
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Category</th>
                                            <th>Type</th>
                                            <th>Cost</th>
                                            <th>Selling</th>
                                            <th>Stock</th>
                                            <th>Low Stock</th>
                                            <th style="text-align: right;">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${rows}
                                    </tbody>
                                </table>
                            </div>
                            ${this.renderPaginationControls('products', productsPage, productsPages)}
                        `}
                    </div>
                </div>
            `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'products', productsPages, () => this.renderProductsModule(canvas));
                const typeSelect = document.getElementById('product-type');
                const categorySelect = document.getElementById('product-category');
                const newCategoryWrap = document.getElementById('product-new-category');
                const stockGroup = document.getElementById('product-stock-group');
                const lowGroup = document.getElementById('product-low-group');
                const applyTypeState = () => {
                    const typeValue = typeSelect ? typeSelect.value : 'product';
                    const isService = typeValue === 'service';
                    if (stockGroup) stockGroup.style.display = isService ? 'none' : '';
                    if (lowGroup) lowGroup.style.display = isService ? 'none' : '';
                };
                if (typeSelect) {
                    applyTypeState();
                    typeSelect.addEventListener('change', applyTypeState);
                }

                const applyCategoryState = () => {
                    if (!newCategoryWrap || !categorySelect) return;
                    if (categorySelect.value === '__new__') {
                        newCategoryWrap.classList.remove('hidden');
                    } else {
                        newCategoryWrap.classList.add('hidden');
                    }
                };
                if (categorySelect) {
                    applyCategoryState();
                    categorySelect.addEventListener('change', applyCategoryState);
                }

                const form = document.getElementById('ops-product-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-products-message');
                        const name = document.getElementById('product-name').value.trim();
                        const categoryId = document.getElementById('product-category').value;
                        const itemType = document.getElementById('product-type').value;
                        const costPrice = Number(document.getElementById('product-cost').value);
                        const sellingPrice = Number(document.getElementById('product-selling').value);
                        const unit = document.getElementById('product-unit').value.trim();
                        const stockValue = document.getElementById('product-stock').value;
                        const lowValue = document.getElementById('product-low').value;
                        const stock = itemType === 'service' ? null : Number(stockValue || 0);
                        const lowStock = itemType === 'service' ? null : Number(lowValue || 5);

                        if (!name) {
                            this.showMessage('ops-products-message', 'Product name is required.', 'error');
                            return;
                        }
                        let finalCategoryId = categoryId;

                        if (!categoryId) {
                            this.showMessage('ops-products-message', 'Select a category first.', 'error');
                            return;
                        }

                        if (categoryId === '__new__') {
                            const newCategoryName = document.getElementById('product-new-category-name').value.trim();
                            const newCategoryDesc = document.getElementById('product-new-category-desc').value.trim();
                            if (!newCategoryName) {
                                this.showMessage('ops-products-message', 'Enter a new category name.', 'error');
                                return;
                            }
                            const exists = categories.some(c => c.name.toLowerCase() === newCategoryName.toLowerCase());
                            if (exists) {
                                this.showMessage('ops-products-message', 'Category already exists.', 'error');
                                return;
                            }
                            try {
                                const createdCategory = await this.createBranchCategory({ name: newCategoryName, description: newCategoryDesc });
                                finalCategoryId = createdCategory.id;
                            } catch (error) {
                                console.error('Failed to save category:', error);
                                this.showMessage('ops-products-message', error.message || 'Failed to save category.', 'error');
                                return;
                            }
                        }
                        if (!itemType) {
                            this.showMessage('ops-products-message', 'Select an item type.', 'error');
                            return;
                        }
                        if (Number.isNaN(costPrice) || costPrice < 0) {
                            this.showMessage('ops-products-message', 'Cost price must be 0 or more.', 'error');
                            return;
                        }
                        if (Number.isNaN(sellingPrice) || sellingPrice < 0) {
                            this.showMessage('ops-products-message', 'Selling price must be 0 or more.', 'error');
                            return;
                        }
                        if (itemType === 'product') {
                            if (Number.isNaN(stock) || stock < 0) {
                                this.showMessage('ops-products-message', 'Opening stock must be 0 or more.', 'error');
                                return;
                            }
                            if (Number.isNaN(lowStock) || lowStock < 0) {
                                this.showMessage('ops-products-message', 'Low stock must be 0 or more.', 'error');
                                return;
                            }
                        }

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            const newProduct = {
                                name,
                                itemType,
                                categoryId: finalCategoryId,
                                costPrice,
                                sellingPrice,
                                unit,
                                stock,
                                lowStock: itemType === 'product' ? lowStock : null
                            };
                            await this.createBranchProduct(newProduct);
                            this.showToast('Product added', 'success');
                            this.renderProductsModule(canvas);
                        } catch (error) {
                            console.error('Failed to save product:', error);
                            this.showMessage('ops-products-message', error.message || 'Failed to save product.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Add Product';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }

                document.querySelectorAll('[data-product-delete]').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.getAttribute('data-product-delete');
                        this.promptPinVerification(async () => {
                            try {
                                await this.deleteBranchProduct(id);
                                const inventory = this.readBranchData('inventory', []);
                                const updatedInventory = inventory.filter(i => i.productId !== id);
                                this.writeBranchData('inventory', updatedInventory);
                                this.showToast('Product removed', 'info');
                                this.renderProductsModule(canvas);
                            } catch (error) {
                                console.error('Failed to delete product:', error);
                                this.showToast('Failed to delete product', 'error');
                            }
                        });
                    });
                });
            }, 0);
        });
    },

    renderInventoryModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        Promise.all([
            this.fetchBranchProducts(),
            this.fetchBranchCategories(),
            this.fetchBranchInventory()
        ]).then(([products, categories, inventory]) => {
            const stockProducts = products.filter(p => (p.itemType || 'product') === 'product');
            const options = stockProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            const { items: pagedMovements, page: movementsPage, totalPages: movementsPages } = this.paginateList(inventory, 'inventory-movements', 10);
            const { items: pagedStock, page: stockPage, totalPages: stockPages } = this.paginateList(stockProducts, 'inventory-stock', 10);
            const rows = pagedMovements.map(item => {
                const product = products.find(p => p.id === item.productId);
                const qty = item.type === 'in' ? `+${item.quantity}` : `-${item.quantity}`;
                return `
                    <tr>
                        <td data-label="Date">${new Date(item.createdAt).toLocaleString()}</td>
                        <td data-label="Product">${product ? product.name : '-'}</td>
                        <td data-label="Type">${item.type === 'in' ? 'Stock In' : 'Stock Out'}</td>
                        <td data-label="Qty">${qty}</td>
                        <td data-label="Note">${item.note || '-'}</td>
                    </tr>
                `;
            }).join('');

            const stockRows = pagedStock.map(product => `
                <tr>
                    <td data-label="Product"><strong>${product.name}</strong></td>
                    <td data-label="Category">${(categories.find(c => c.id === product.categoryId) || {}).name || '-'}</td>
                    <td data-label="Stock">${product.stock ?? 0}</td>
                    <td data-label="Low Stock">${product.lowStock ?? '-'}</td>
                </tr>
            `).join('');

            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Inventory</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Track stock movements and levels</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">Stock Movement</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-inventory-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-inventory-body" class="hidden">
                        <div id="ops-inventory-message" class="message-box hidden"></div>
                        <form id="ops-inventory-form" class="auth-form" style="max-width: 100%;">
                        <div class="input-group">
                            <label>Product</label>
                            <select id="inventory-product" class="input-field" ${stockProducts.length === 0 ? 'disabled' : ''}>
                                <option value="" disabled selected>${stockProducts.length === 0 ? 'Add products first' : 'Select product'}</option>
                                ${options}
                            </select>
                        </div>
                        <div class="input-group">
                            <label>Type</label>
                            <select id="inventory-type" class="input-field" ${stockProducts.length === 0 ? 'disabled' : ''}>
                                <option value="in">Stock In</option>
                                <option value="out">Stock Out</option>
                            </select>
                        </div>
                        <div class="input-group">
                            <label>Quantity</label>
                            <input type="number" id="inventory-qty" min="1" step="1" placeholder="1" required ${stockProducts.length === 0 ? 'disabled' : ''}>
                        </div>
                        <div class="input-group">
                            <label>Note</label>
                            <input type="text" id="inventory-note" placeholder="Optional reference">
                        </div>
                        <button type="submit" class="btn-primary" style="width: auto;" ${stockProducts.length === 0 ? 'disabled' : ''}>Save Movement</button>
                        </form>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header">
                        <h4 class="card-title">Current Stock</h4>
                    </div>
                    ${stockProducts.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No stock items yet. Add products to track stock.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Product</th>
                                        <th>Category</th>
                                        <th>Stock</th>
                                        <th>Low Stock</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${stockRows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('inventory-stock', stockPage, stockPages)}
                    `}
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Recent Movements</h4>
                    </div>
                    ${inventory.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No stock movements yet.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Product</th>
                                        <th>Type</th>
                                        <th>Qty</th>
                                        <th>Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('inventory-movements', movementsPage, movementsPages)}
                    `}
                </div>
            </div>
        `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'inventory-stock', stockPages, () => this.renderInventoryModule(canvas));
                this.bindPaginationControls(canvas, 'inventory-movements', movementsPages, () => this.renderInventoryModule(canvas));
                const form = document.getElementById('ops-inventory-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-inventory-message');
                        const productId = document.getElementById('inventory-product').value;
                        const type = document.getElementById('inventory-type').value;
                        const quantity = Number(document.getElementById('inventory-qty').value);
                        const note = document.getElementById('inventory-note').value.trim();

                        if (!productId) {
                            this.showMessage('ops-inventory-message', 'Select a product first.', 'error');
                            return;
                        }
                        if (Number.isNaN(quantity) || quantity <= 0) {
                            this.showMessage('ops-inventory-message', 'Quantity must be at least 1.', 'error');
                            return;
                        }

                        const targetProduct = products.find(p => p.id === productId);
                        if (!targetProduct) {
                            this.showMessage('ops-inventory-message', 'Product not found.', 'error');
                            return;
                        }
                        const nextStock = type === 'in' ? (targetProduct.stock || 0) + quantity : (targetProduct.stock || 0) - quantity;
                        if (nextStock < 0) {
                            this.showMessage('ops-inventory-message', 'Not enough stock for this action.', 'error');
                            return;
                        }

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            const updatedProduct = { ...targetProduct, stock: nextStock };
                            await this.upsertBranchProduct(updatedProduct);
                            await this.createBranchInventory({ productId, type, quantity, note });
                            this.showToast('Inventory updated', 'success');
                            this.renderInventoryModule(canvas);
                        } catch (error) {
                            console.error('Failed to update inventory:', error);
                            this.showMessage('ops-inventory-message', error.message || 'Failed to update inventory.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Save Movement';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }
            }, 0);
        });
    },

    // ── Receipt generator (IMG or PDF) ──
    _generateReceipt(sale, format) {
        const prof = this.state.currentProfile;
        const branchName = prof?.branchName || prof?.branch_name || prof?.full_name || 'Business';
        const biz = { address: prof?.address || '', phone: prof?.phone || '', email: prof?.email || '' };
        const dateObj = new Date(sale.createdAt);
        const dateStr = dateObj.toISOString().slice(0, 10);
        const timeStr = dateObj.toLocaleTimeString();
        const transId = 'S-' + (sale.id || Date.now()).toString().slice(-13);
        const totalFormatted = this.formatCurrency(sale.total || 0);
        const priceFormatted = this.formatCurrency(sale.price || 0);
        const subtotalFormatted = this.formatCurrency(sale.total || 0);

        // Build receipt DOM (hidden)
        const receiptDiv = document.createElement('div');
        receiptDiv.id = 'receipt-render-target';
        receiptDiv.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;';
        receiptDiv.innerHTML = `
<div style="width:320px;font-family:'Courier New',Courier,monospace;background:#fff;color:#000;padding:0;">
    <div style="width:100%;overflow:hidden;line-height:0;">
        <svg width="320" height="14" viewBox="0 0 320 14" style="display:block;">
            <path d="M0 14 ${Array.from({ length: 32 }, (_, i) => `L${i * 10 + 5} 0 L${(i + 1) * 10} 14`).join(' ')}" fill="#000"/>
        </svg>
    </div>
    <div style="padding:16px 20px 8px;">
        <div style="text-align:center;margin-bottom:8px;">
            <div style="font-size:17px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">${branchName}</div>
            ${biz.address ? `<div style="font-size:11px;margin-top:4px;">${biz.address}</div>` : ''}
            ${biz.phone ? `<div style="font-size:11px;">Tel: ${biz.phone}</div>` : ''}
            ${biz.email ? `<div style="font-size:11px;">Email: ${biz.email}</div>` : ''}
        </div>
        <div style="border-top:2px solid #000;margin:10px 0;"></div>
        <div style="text-align:center;font-size:15px;font-weight:bold;margin:8px 0;">SALES RECEIPT</div>
        <div style="border-top:1px solid #000;margin:8px 0;"></div>
        <div style="font-size:12px;line-height:1.7;">
            <div>Date: ${dateStr}</div>
            <div>Time: ${timeStr}</div>
            <div>Customer: ${(sale.customerName || 'WALK IN').toUpperCase()}</div>
        </div>
        <div style="border-top:1px solid #000;margin:8px 0;"></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;margin-bottom:4px;">
            <span style="flex:2;">ITEM/DESCRIPTION</span>
            <span style="flex:0.5;text-align:right;">QTY</span>
            <span style="flex:1;text-align:right;">PRICE</span>
        </div>
        <div style="font-size:12px;margin-bottom:2px;">${sale.productName || '-'}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;">
            <span style="flex:2;"></span>
            <span style="flex:0.5;text-align:right;">${sale.quantity}</span>
            <span style="flex:1;text-align:right;">${priceFormatted}</span>
        </div>
        <div style="height:16px;"></div>
        <div style="border-top:1px solid #000;margin:8px 0;"></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
            <span>Subtotal:</span><span>${subtotalFormatted}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:bold;margin-bottom:8px;">
            <span>TOTAL:</span><span>${totalFormatted}</span>
        </div>
        <div style="font-size:12px;margin-bottom:4px;">Payment: Cash</div>
        <div style="border-top:1px solid #000;margin:10px 0;"></div>
        <div style="text-align:center;font-size:12px;line-height:1.6;margin-bottom:8px;">
            <div style="font-weight:bold;">Thank you for your business!</div>
            <div>Visit us again</div>
        </div>
        <div style="border-top:1px dashed #000;margin:8px 0;"></div>
        <div style="text-align:center;font-size:10px;color:#444;margin-bottom:8px;">Trans ID: ${transId}</div>
    </div>
    <div style="width:100%;overflow:hidden;line-height:0;">
        <svg width="320" height="14" viewBox="0 0 320 14" style="display:block;">
            <path d="M0 0 ${Array.from({ length: 32 }, (_, i) => `L${i * 10 + 5} 14 L${(i + 1) * 10} 0`).join(' ')}" fill="#000"/>
        </svg>
    </div>
</div>`;
        document.body.appendChild(receiptDiv);
        const target = receiptDiv.querySelector('div');

        // ── Load a CDN script dynamically ──
        const loadScript = (url) => new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = res;
            s.onerror = rej;
            document.head.appendChild(s);
        });

        if (format === 'print') {
            // ── Print via new window ──
            const printWin = window.open('', '_blank');
            if (printWin) {
                printWin.document.write(`
                    <html>
                        <head>
                            <title>Receipt ${transId}</title>
                            <style>
                                html, body { height: 100%; margin: 0; }
                                body { display: flex; justify-content: center; align-items: center; background: #fff; }
                                @media print { 
                                    @page { margin: 0; size: auto; } 
                                    html, body { height: 100%; margin: 0; }
                                    body { display: flex; justify-content: center; align-items: center; }
                                }
                            </style>
                        </head>
                        <body>
                            ${receiptDiv.innerHTML}
                            <script>
                                setTimeout(() => {
                                    window.print();
                                    window.close();
                                }, 300);
                            </script>
                        </body>
                    </html>
                `);
                printWin.document.close();
                receiptDiv.remove();
                return;
            } else {
                this.showToast('Popup blocked. Please allow popups to print.', 'error');
                receiptDiv.remove();
                return;
            }
        }

        if (format === 'pdf') {
            // ── PDF via jsPDF ──
            const doPdf = async () => {
                try {
                    const cvs = await window.html2canvas(target, { scale: 2, backgroundColor: '#fff' });
                    const imgData = cvs.toDataURL('image/png');
                    const pxW = cvs.width;
                    const pxH = cvs.height;
                    const mmW = (pxW / 2) * 0.264583;
                    const mmH = (pxH / 2) * 0.264583;
                    const { jsPDF } = window.jspdf;
                    const pdf = new jsPDF({ unit: 'mm', format: [mmW, mmH] });
                    pdf.addImage(imgData, 'PNG', 0, 0, mmW, mmH);
                    pdf.save(`receipt-${transId}.pdf`);
                    this.showToast('PDF receipt downloaded', 'success');
                } catch (err) {
                    console.error(err);
                    this.showToast('Failed to generate PDF', 'error');
                } finally {
                    receiptDiv.remove();
                }
            };
            const needed = [];
            if (!window.html2canvas) needed.push(loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'));
            if (!window.jspdf) needed.push(loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'));
            Promise.all(needed).then(doPdf).catch(() => {
                receiptDiv.remove();
                this.showToast('Failed to load PDF library', 'error');
            });
        } else {
            // ── Image via html2canvas ──
            const doImg = () => {
                window.html2canvas(target, { scale: 2, backgroundColor: '#fff' }).then(cvs => {
                    const link = document.createElement('a');
                    link.download = `receipt-${transId}.png`;
                    link.href = cvs.toDataURL('image/png');
                    link.click();
                    receiptDiv.remove();
                    this.showToast('Image receipt downloaded', 'success');
                }).catch(err => {
                    console.error(err);
                    receiptDiv.remove();
                    this.showToast('Failed to generate image', 'error');
                });
            };
            if (window.html2canvas) {
                doImg();
            } else {
                loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js')
                    .then(doImg)
                    .catch(() => {
                        receiptDiv.remove();
                        this.showToast('Failed to load image library', 'error');
                    });
            }
        }
    },

    // ── PIN Verification Modal ──
    promptPinVerification(onSuccess) {
        if (!this.state.hasSecurityPin) {
            // Force user to set PIN if not set
            this.showConfirmModal(
                "Security PIN is not set. You must set a PIN to perform this action. Go to Profile?",
                () => this.loadPage('profile')
            );
            return;
        }

        // Remove existing
        document.querySelectorAll('.pin-verify-popup').forEach(el => el.remove());

        const popup = document.createElement('div');
        popup.className = 'pin-verify-popup';
        popup.innerHTML = `
            <div class="pin-verify-overlay"></div>
            <div class="pin-verify-dialog">
                <div style="font-weight:600;font-size:1.1rem;margin-bottom:1rem;text-align:center;">Security Check</div>
                <div style="margin-bottom:1rem;">
                    <input type="password" class="input-field pin-input" placeholder="Enter Security PIN" maxlength="6" style="text-align:center;letter-spacing:4px;font-size:1.2rem;">
                    <div class="pin-error" style="color:var(--accent);font-size:0.85rem;margin-top:0.5rem;text-align:center;min-height:1.2em;"></div>
                </div>
                <div style="display:flex;gap:0.75rem;">
                    <button class="btn-ghost pin-cancel" style="flex:1;">Cancel</button>
                    <button class="btn-primary pin-confirm" style="flex:1;">Verify</button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);

        const input = popup.querySelector('.pin-input');
        const errorEl = popup.querySelector('.pin-error');
        const close = () => popup.remove();

        // Focus input
        setTimeout(() => input.focus(), 50);

        const verify = async () => {
            const pin = input.value.trim();
            if (!pin) return;

            errorEl.textContent = 'Verifying...';
            try {
                const isValid = await Auth.verifySecurityPin(pin);
                if (isValid) {
                    close();
                    onSuccess();
                } else {
                    errorEl.textContent = 'Incorrect PIN';
                    input.value = '';
                    input.focus();
                }
            } catch (err) {
                console.error(err);
                errorEl.textContent = 'Error verifying PIN';
            }
        };

        popup.querySelector('.pin-verify-overlay').addEventListener('click', close);
        popup.querySelector('.pin-cancel').addEventListener('click', close);
        popup.querySelector('.pin-confirm').addEventListener('click', verify);
        input.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') verify();
        });
    },

    renderSalesModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        const state = this.getPaginationState('sales');
        const currentPage = state.page || 1;
        const pageSize = 10;

        // Filter for "Recent Sales" list to show only today's sales
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        Promise.all([
            this.fetchBranchCategories(),
            this.fetchBranchProducts(),
            this.fetchBranchCustomers(),
            this.fetchBranchSales(currentPage, pageSize, todayStart, null)
        ]).then(([categories, products, customers, salesData]) => {
            const customerOptions = customers.map(cust => `<option value="${cust.id}">${cust.name}</option>`).join('');

            // Handle server-side filtering results
            const salesList = salesData.items || [];
            const totalItems = salesData.count || 0;
            const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

            // Update stats immediately (server-side calculation)
            this.updateSalesStats(canvas);

            // Use original UI row generation
            const saleColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
            const rows = salesList.map((sale, idx) => {
                const color = saleColors[idx % saleColors.length];
                const dateStr = new Date(sale.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
                const timeStr = new Date(sale.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                const product = products.find(p => p.id === sale.productId);
                const costPrice = product ? Number(product.costPrice || 0) : 0;
                const profit = (Number(sale.price || 0) - costPrice) * Number(sale.quantity || 0);
                const profitColor = profit > 0 ? '#22c55e' : '#ef4444';
                const profitLabel = (profit >= 0 ? '+' : '') + this.formatCurrency(profit);
                const saleJson = encodeURIComponent(JSON.stringify(sale));
                return `
                <div class="sale-item" style="border-left: 4px solid ${color};" data-sale-id="${sale.id}" data-sale="${saleJson}">
                    <div class="sale-item-header">
                        <span class="sale-item-title">${sale.productName || 'Unknown'}</span>
                        <span class="sale-item-badge" style="background: ${profitColor}18; color: ${profitColor};">Profit: ${profitLabel}</span>
                    </div>
                    <div class="sale-item-subtitle">
                        ${sale.quantity} × ${this.formatCurrency(sale.price || 0)} · ${sale.categoryName || 'Uncategorized'}<br>
                        ${sale.customerName || 'Walk-in'} · ${dateStr}, ${timeStr}
                    </div>
                    <div class="sale-item-actions">
                        <button class="sale-action-btn sale-action-edit" data-action="edit" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            Edit
                        </button>
                        <button class="sale-action-btn sale-action-delete" data-action="delete" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            Delete
                        </button>
                        <button class="sale-action-btn sale-action-print" data-action="print" title="Download Receipt">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Receipt
                        </button>
                        <button class="sale-action-btn sale-action-copy" data-action="copy" title="Copy">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                            Copy
                        </button>
                    </div>
                </div>
            `;
            }).join('');

            // Restore original HTML layout
            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Sales</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Record sales and track totals (Today)</div>
                    </div>
                </div>

                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Today's Profit</div>
                        <div class="stat-value">Loading...</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Gross Profit</div>
                        <div class="stat-value">Loading...</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Sale</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-sales-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-sales-body" class="hidden">
                        <div id="ops-sales-message" class="message-box hidden"></div>
                        <form id="ops-sales-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Product</label>
                                <select id="sale-product" class="input-field">
                                    <option value="" disabled selected>Select product</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label>Selling Price</label>
                                <input type="number" id="sale-price" min="0" step="0.01" placeholder="0.00" readonly>
                            </div>
                            <div class="input-group">
                                <label>Quantity</label>
                                <input type="number" id="sale-qty" min="1" step="1" placeholder="1" value="1">
                            </div>
                            <div class="input-group">
                                <label>Line Total</label>
                                <input type="text" id="sale-total" value="${this.formatCurrency(0)}" readonly>
                            </div>
                            <div class="input-group">
                                <label>Customer</label>
                                <select id="sale-customer" class="input-field">
                                    <option value="">Walk-in Customer</option>
                                    ${customerOptions}
                                </select>
                            </div>
                            <div class="input-group">
                                <label>Note</label>
                                <input type="text" id="sale-note" placeholder="Optional note">
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Add Sale</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Recent Sales</h4>
                    </div>
                    ${salesList.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No sales recorded yet.</div>
                    ` : `
                        <div class="sale-list-wrapper">
                            <div class="sale-items-list" id="sale-list-scroll-target">
                                ${rows}
                            </div>
                            <div class="sale-list-controls">
                                <button class="sale-scroll-btn" id="sale-scroll-up" title="Previous">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                                </button>
                                <button class="sale-scroll-btn" id="sale-scroll-down" title="Next">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                </button>
                            </div>
                        </div>
                        <div style="margin-top: 1rem;">
                           ${this.renderPaginationControls('sales', currentPage, totalPages)}
                        </div>
                    `}
                </div>
            </div>
        `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'sales', totalPages, () => this.renderSalesModule(canvas));

                // Scroll Controls
                const scrollList = document.getElementById('sale-list-scroll-target');
                const btnUp = document.getElementById('sale-scroll-up');
                const btnDown = document.getElementById('sale-scroll-down');

                if (scrollList && btnUp && btnDown) {
                    const scrollAmount = () => scrollList.clientHeight; // Scroll by one item height

                    btnUp.addEventListener('click', () => {
                        scrollList.scrollBy({ top: -scrollAmount(), behavior: 'smooth' });
                    });

                    btnDown.addEventListener('click', () => {
                        scrollList.scrollBy({ top: scrollAmount(), behavior: 'smooth' });
                    });
                }

                // Restore Product Select Interaction
                const productSelect = document.getElementById('sale-product');
                const priceInput = document.getElementById('sale-price');
                const qtyInput = document.getElementById('sale-qty');
                const totalInput = document.getElementById('sale-total');
                const quickAddValue = '__quick_add_product__';

                const refreshProducts = (selectedId = '') => {
                    if (!productSelect) return;
                    const options = products.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
                    productSelect.innerHTML = `
                        <option value="" disabled ${selectedId ? '' : 'selected'}>Select product</option>
                        ${options}
                        <option value="${quickAddValue}">+ Add & Save New Product</option>
                    `;
                    if (selectedId) {
                        productSelect.value = selectedId;
                    }
                    if (priceInput) priceInput.value = '';
                    if (totalInput) totalInput.value = this.formatCurrency(0);
                };

                const updateTotals = () => {
                    const productId = productSelect ? productSelect.value : '';
                    if (productId === quickAddValue) return;
                    const quantity = Number(qtyInput ? qtyInput.value : 0);
                    const product = products.find(p => p.id === productId);
                    const price = product ? Number(product.sellingPrice || 0) : 0;
                    if (priceInput) priceInput.value = price ? price : 0;
                    const total = quantity > 0 ? price * quantity : 0;
                    if (totalInput) totalInput.value = this.formatCurrency(total);
                };

                // Restore Quick Add Logic
                const handleQuickAdd = () => {
                    if (!productSelect) return;
                    this.hideMessage('ops-sales-message');
                    productSelect.value = '';

                    // Remove any existing inline quick-add card
                    const existing = document.getElementById('inline-quick-add-card');
                    if (existing) existing.remove();

                    // Build inline form card
                    const card = document.createElement('div');
                    card.id = 'inline-quick-add-card';
                    card.className = 'inline-quick-add';
                    card.innerHTML = `
                        <div class="inline-quick-add-header">
                            <span>New Product</span>
                            <button type="button" class="inline-quick-add-close" id="qa-cancel" title="Cancel">&times;</button>
                        </div>
                        <div id="qa-message" class="message-box hidden"></div>
                        <div class="input-group">
                            <label>Product Name *</label>
                            <input type="text" id="qa-name" class="input-field" placeholder="e.g. Widget" autofocus>
                        </div>
                        <div class="inline-quick-add-row">
                            <div class="input-group">
                                <label>Selling Price *</label>
                                <input type="number" id="qa-sell" class="input-field" min="0" step="0.01" value="0">
                            </div>
                            <div class="input-group">
                                <label>Cost Price</label>
                                <input type="number" id="qa-cost" class="input-field" min="0" step="0.01" value="0">
                            </div>
                            <div class="input-group">
                                <label>Stock</label>
                                <input type="number" id="qa-stock" class="input-field" min="0" step="1" value="0">
                            </div>
                        </div>
                        <div class="inline-quick-add-actions">
                            <button type="button" class="btn-primary" id="qa-save" style="width:auto;">Save Product</button>
                            <button type="button" class="btn-ghost" id="qa-cancel-btn" style="width:auto;">Cancel</button>
                        </div>
                    `;

                    // Insert right after the product select's .input-group
                    const productGroup = productSelect.closest('.input-group');
                    productGroup.insertAdjacentElement('afterend', card);

                    // Animate in
                    requestAnimationFrame(() => card.classList.add('open'));

                    // Focus the name input
                    const nameInput = card.querySelector('#qa-name');
                    if (nameInput) nameInput.focus();

                    const removeCard = () => {
                        card.classList.remove('open');
                        card.addEventListener('transitionend', () => card.remove(), { once: true });
                        // Fallback removal if no transition fires
                        setTimeout(() => { if (card.parentNode) card.remove(); }, 350);
                        refreshProducts();
                    };

                    // Cancel buttons
                    card.querySelector('#qa-cancel').addEventListener('click', removeCard);
                    card.querySelector('#qa-cancel-btn').addEventListener('click', removeCard);

                    // Save button
                    card.querySelector('#qa-save').addEventListener('click', async () => {
                        const name = (card.querySelector('#qa-name').value || '').trim();
                        const sellingPrice = Number(card.querySelector('#qa-sell').value || 0);
                        const costPrice = Number(card.querySelector('#qa-cost').value || 0);
                        const stock = Number(card.querySelector('#qa-stock').value || 0);

                        if (!name) {
                            this.showMessage('qa-message', 'Product name is required.', 'error');
                            return;
                        }
                        if (Number.isNaN(sellingPrice) || sellingPrice < 0) {
                            this.showMessage('qa-message', 'Selling price must be a valid number.', 'error');
                            return;
                        }

                        const saveBtn = card.querySelector('#qa-save');
                        saveBtn.textContent = 'Saving...';
                        saveBtn.disabled = true;

                        try {
                            const created = await this.createBranchProduct({
                                name,
                                itemType: 'product',
                                categoryId: null,
                                costPrice: Number.isNaN(costPrice) ? 0 : costPrice,
                                sellingPrice,
                                unit: '',
                                stock: Number.isNaN(stock) ? 0 : stock,
                                lowStock: 5
                            });
                            products.unshift(created);
                            this.showToast('Product added', 'success');
                            card.remove();
                            refreshProducts(created.id);
                            updateTotals();
                        } catch (error) {
                            console.error('Failed to add product:', error);
                            this.showMessage('qa-message', error.message || 'Failed to add product.', 'error');
                            saveBtn.textContent = 'Save Product';
                            saveBtn.disabled = false;
                        }
                    });
                };

                refreshProducts();

                if (productSelect) {
                    productSelect.addEventListener('change', async () => {
                        if (productSelect.value === quickAddValue) {
                            await handleQuickAdd();
                            return;
                        }
                        updateTotals();
                    });
                }

                if (qtyInput) {
                    qtyInput.addEventListener('input', () => updateTotals());
                    if (!qtyInput.value) qtyInput.value = 1;
                }

                const form = document.getElementById('ops-sales-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-sales-message');
                        const productId = productSelect ? productSelect.value : '';
                        const quantity = Number(qtyInput ? qtyInput.value : 0);
                        const customerId = document.getElementById('sale-customer').value;
                        const note = document.getElementById('sale-note').value.trim();

                        if (!productId) {
                            this.showMessage('ops-sales-message', 'Select a product first.', 'error');
                            return;
                        }
                        if (Number.isNaN(quantity) || quantity <= 0) {
                            this.showMessage('ops-sales-message', 'Quantity must be at least 1.', 'error');
                            return;
                        }

                        const product = products.find(p => p.id === productId);
                        if (!product) {
                            this.showMessage('ops-sales-message', 'Product not found.', 'error');
                            return;
                        }

                        if ((product.itemType || 'product') === 'product') {
                            const nextStock = (product.stock || 0) - quantity;
                            if (nextStock < 0) {
                                this.showMessage('ops-sales-message', 'Not enough stock for this sale.', 'error');
                                return;
                            }
                        }

                        const category = categories.find(c => c.id === product.categoryId);
                        const customer = customers.find(c => c.id === customerId);
                        const price = Number(product.sellingPrice || 0);
                        const total = price * quantity;

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            if ((product.itemType || 'product') === 'product') {
                                const nextStock = (product.stock || 0) - quantity;
                                await this.upsertBranchProduct({ ...product, stock: nextStock });
                            }

                            await this.createBranchSale({
                                productId,
                                productName: product.name,
                                categoryId: product.categoryId,
                                categoryName: category ? category.name : null,
                                itemType: product.itemType || 'product',
                                price,
                                quantity,
                                total,
                                customerId: customerId || null,
                                customerName: customer ? customer.name : null,
                                note
                            });
                            this.showToast('Sale recorded', 'success');
                            this.renderSalesModule(canvas);

                            // Optimization: In server-side pagination, simpler to just re-render or do nothing, 
                            // as next fetch will get stats. 
                            // But we call updateSalesStats above to refresh them.
                        } catch (error) {
                            console.error('Failed to record sale:', error);
                            this.showMessage('ops-sales-message', error.message || 'Failed to record sale.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Add Sale';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }

                // ── Sale card action handlers (Event Delegation) ──
                // Restore Receipt Popup Logic
                const pageContainer = canvas.querySelector('.page-enter');

                if (pageContainer) {
                    pageContainer.addEventListener('click', async (e) => {
                        const btn = e.target.closest('.sale-action-btn');
                        if (!btn) return;

                        e.stopPropagation();
                        const card = btn.closest('.sale-item');
                        if (!card) return;

                        const saleId = card.dataset.saleId;
                        const sale = JSON.parse(decodeURIComponent(card.dataset.sale));
                        const action = btn.dataset.action;

                        // ── DELETE ──
                        if (action === 'delete') {
                            this.promptPinVerification(async () => {
                                try {
                                    await this.deleteBranchSale(saleId);
                                    if (card) card.remove();
                                    this.showToast('Sale deleted', 'success');
                                    this.updateSalesStats(canvas); // Update stats via RPC
                                } catch (error) {
                                    console.error('Failed to delete sale:', error);
                                    this.showToast('Failed to delete sale', 'error');
                                }
                            });
                        }

                        // ── COPY ──
                        if (action === 'copy') {
                            const text = [
                                `Product: ${sale.productName || 'Unknown'}`,
                                `Category: ${sale.categoryName || '-'}`,
                                `Qty: ${sale.quantity}`,
                                `Price: ${this.formatStatValue(sale.price || 0)}`,
                                `Total: ${this.formatStatValue(sale.total || 0)}`,
                                `Customer: ${sale.customerName || 'Walk-in'}`,
                                `Note: ${sale.note || '-'}`,
                                `Date: ${new Date(sale.createdAt).toLocaleString()}`
                            ].join('\n');
                            try {
                                await navigator.clipboard.writeText(text);
                                this.showToast('Copied to clipboard', 'success');
                            } catch {
                                this.showToast('Copy failed', 'error');
                            }
                        }

                        // ── RECEIPT (IMG / PDF choice) - SAVED FROM DELETION ──
                        if (action === 'print') {
                            // Remove any existing receipt popup
                            document.querySelectorAll('.receipt-format-popup').forEach(el => el.remove());

                            const popup = document.createElement('div');
                            popup.className = 'receipt-format-popup';
                            popup.innerHTML = `
                                <div class="receipt-format-overlay"></div>
                                <div class="receipt-format-dialog">
                                    <div style="font-weight:600;font-size:0.95rem;margin-bottom:0.75rem;text-align:center;">Download Receipt As</div>
                                    <div style="display:flex;gap:0.75rem;">
                                        <button class="btn-primary receipt-fmt-btn" data-fmt="img" style="flex:1;display:flex;align-items:center;justify-content:center;gap:0.4rem;">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                                            Image
                                        </button>
                                        <button class="btn-primary receipt-fmt-btn" data-fmt="pdf" style="flex:1;display:flex;align-items:center;justify-content:center;gap:0.4rem;background:var(--accent,#ef4444);">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                                            PDF
                                        </button>
                                    </div>
                                    <div style="text-align:center;margin-top:1rem;margin-bottom:0.25rem;">
                                        <a href="#" class="receipt-fmt-print" style="color:var(--text-main);text-decoration:none;font-size:0.9rem;border-bottom:1px solid currentColor;opacity:0.8;">Print Receipt</a>
                                    </div>
                                    <button class="btn-ghost receipt-fmt-cancel" style="width:100%;margin-top:0.5rem;font-size:0.8rem;">Cancel</button>
                                </div>
                            `;
                            document.body.appendChild(popup);

                            // Close handler
                            const closePopup = () => popup.remove();
                            popup.querySelector('.receipt-format-overlay').addEventListener('click', closePopup);
                            popup.querySelector('.receipt-fmt-cancel').addEventListener('click', closePopup);

                            // Print handler
                            popup.querySelector('.receipt-fmt-print').addEventListener('click', (e) => {
                                e.preventDefault();
                                closePopup();
                                this._generateReceipt(sale, 'print');
                            });

                            // Format click handler
                            popup.querySelectorAll('.receipt-fmt-btn').forEach(fmtBtn => {
                                fmtBtn.addEventListener('click', () => {
                                    const fmt = fmtBtn.dataset.fmt;
                                    closePopup();
                                    this._generateReceipt(sale, fmt);
                                });
                            });
                        }

                        // ── EDIT ──
                        if (action === 'edit') {
                            this.showEditSaleModal(sale, products, customers, categories, () => this.renderSalesModule(canvas));
                        }
                    });
                }
            }, 0);
        });
    },




    async updateSalesStats(canvas, salesOverride = null, productsOverride = null) {
        if (!canvas) return;

        // Use server-side aggregation for performance
        try {
            const profile = this.state.currentProfile;
            const branchId = profile?.branch_id || profile?.id;

            // Calculate start of today in local time, then convert to ISO for server
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const { data, error } = await supabase.rpc('get_branch_sales_stats', {
                p_branch_id: branchId,
                p_today_start: today.toISOString()
            });

            if (error) throw error;

            if (data && data.length > 0) {
                const stats = data[0];
                const statValues = canvas.querySelectorAll('.stat-value');
                if (statValues.length >= 2) {
                    statValues[0].textContent = this.formatStatValue(stats.todays_profit || 0);
                    statValues[1].textContent = this.formatStatValue(stats.gross_profit || 0);
                    if (this.adjustStatFontSizes) this.adjustStatFontSizes(canvas);
                }
            }
        } catch (error) {
            console.warn('Server-side stats failed (likely SQL function missing), falling back to client-side calc:', error);
            // Fallback: Client-side calculation (only works for loaded data)
            // Since we don't load all data anymore, this will be inaccurate for Gross Profit but ok for what we have.
            const products = productsOverride || this.readBranchData('products', []);
            // Use whatever sales are passed or empty (dangerous for gross profit)
            const sales = salesOverride || [];
            const { grossProfit, todaysProfit } = this.calculateSalesProfitStats(sales, products);

            const statValues = canvas.querySelectorAll('.stat-value');
            if (statValues.length >= 2) {
                // Mark as partial/estimate?
                statValues[0].textContent = this.formatStatValue(todaysProfit);
                statValues[1].textContent = this.formatStatValue(grossProfit);
            }
        }
    },

    // ── Edit Sale Modal ──
    showEditSaleModal(sale, products, customers, categories, onSuccess) {
        // Remove existing
        document.querySelectorAll('.edit-sale-modal').forEach(el => el.remove());

        const customerOpts = customers.map(c =>
            `<option value="${c.id}" ${c.id === sale.customerId ? 'selected' : ''}>${c.name}</option>`
        ).join('');

        const popup = document.createElement('div');
        popup.className = 'edit-sale-modal';
        popup.style.cssText = `
            position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.2s ease;
        `;
        popup.innerHTML = `
            <div class="edit-sale-overlay" style="position:absolute;inset:0;background:rgba(0,0,0,0.5);"></div>
            <div class="edit-sale-dialog" style="
                background:var(--bg-surface); width:90%; max-width:400px; border-radius:12px;
                box-shadow:0 10px 25px rgba(0,0,0,0.2); overflow:hidden; transform:translateY(10px); transition:transform 0.2s ease;
            ">
                <div style="padding:1.25rem; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0; font-size:1.1rem;">Edit Sale</h3>
                    <button class="btn-ghost edit-close" style="padding:0.4rem;">&times;</button>
                </div>
                <div style="padding:1.25rem;">
                    <div style="margin-bottom:1rem;">
                        <label style="display:block; font-size:0.85rem; color:var(--text-muted); margin-bottom:0.4rem;">Product</label>
                        <input type="text" class="input-field" value="${sale.productName || 'Unknown'}" readonly style="background:var(--bg-surface-elevated); opacity:0.8;">
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-bottom:1rem;">
                        <div>
                            <label style="display:block; font-size:0.85rem; color:var(--text-muted); margin-bottom:0.4rem;">Quantity</label>
                            <input type="number" class="input-field edit-qty" value="${sale.quantity}" min="1" step="1">
                        </div>
                        <div>
                            <label style="display:block; font-size:0.85rem; color:var(--text-muted); margin-bottom:0.4rem;">Price</label>
                            <input type="number" class="input-field edit-price" value="${sale.price}" min="0" step="0.01">
                        </div>
                    </div>
                    <div style="margin-bottom:1rem;">
                        <label style="display:block; font-size:0.85rem; color:var(--text-muted); margin-bottom:0.4rem;">Customer</label>
                        <select class="input-field edit-customer">
                            <option value="" ${!sale.customerId ? 'selected' : ''}>Walk-in Customer</option>
                            ${customerOpts}
                        </select>
                    </div>
                    <div>
                        <label style="display:block; font-size:0.85rem; color:var(--text-muted); margin-bottom:0.4rem;">Note</label>
                        <input type="text" class="input-field edit-note" value="${sale.note || ''}" placeholder="Optional note">
                    </div>
                    <div class="edit-error" style="color:var(--accent); font-size:0.85rem; margin-top:0.8rem; min-height:1.2em; display:none;"></div>
                </div>
                <div style="padding:1.25rem; border-top:1px solid var(--border); display:flex; gap:0.75rem; justify-content:flex-end;">
                    <button class="btn-ghost edit-cancel-btn">Cancel</button>
                    <button class="btn-primary edit-save-btn">Save Changes</button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);

        // Animation in
        requestAnimationFrame(() => {
            popup.style.opacity = '1';
            popup.querySelector('.edit-sale-dialog').style.transform = 'translateY(0)';
        });

        // Handlers
        const close = () => {
            popup.style.opacity = '0';
            popup.querySelector('.edit-sale-dialog').style.transform = 'translateY(10px)';
            setTimeout(() => popup.remove(), 200);
        };

        const showError = (msg) => {
            const el = popup.querySelector('.edit-error');
            el.textContent = msg;
            el.style.display = 'block';
        };

        popup.querySelector('.edit-sale-overlay').addEventListener('click', close);
        popup.querySelector('.edit-close').addEventListener('click', close);
        popup.querySelector('.edit-cancel-btn').addEventListener('click', close);

        popup.querySelector('.edit-save-btn').addEventListener('click', async () => {
            const btn = popup.querySelector('.edit-save-btn');
            const newQty = Number(popup.querySelector('.edit-qty').value);
            const newPrice = Number(popup.querySelector('.edit-price').value);
            const newCustomerId = popup.querySelector('.edit-customer').value || null;
            const newCustomer = customers.find(c => c.id === newCustomerId);
            const newNote = popup.querySelector('.edit-note').value.trim();

            if (newQty <= 0) { showError('Quantity must be at least 1'); return; }
            if (newPrice < 0) { showError('Price cannot be negative'); return; }

            btn.textContent = 'Saving...';
            btn.disabled = true;

            try {
                await this.upsertBranchSale({
                    ...sale,
                    quantity: newQty,
                    price: newPrice,
                    total: newQty * newPrice,
                    customerId: newCustomerId,
                    customerName: newCustomer ? newCustomer.name : null,
                    note: newNote
                });
                this.showToast('Sale updated', 'success');
                close();
                onSuccess();
            } catch (err) {
                console.error(err);
                showError('Failed to update sale');
                btn.textContent = 'Save Changes';
                btn.disabled = false;
            }
        });
    },

    // ── Expense-category dropdown helpers ──
    _defaultExpenseCategories: ['Rent', 'Utilities', 'Salaries', 'Transport', 'Supplies', 'Marketing', 'Maintenance', 'Insurance', 'Taxes', 'Other'],

    _getExpenseCategoryKey() {
        const bid = this.state.currentProfile?.branchId || 'global';
        return `bms-expense-categories-${bid}`;
    },

    getExpenseCategories() {
        const custom = JSON.parse(localStorage.getItem(this._getExpenseCategoryKey()) || '[]');
        const merged = [...this._defaultExpenseCategories];
        custom.forEach(c => { if (!merged.includes(c)) merged.push(c); });
        return merged;
    },

    addExpenseCategory(name) {
        const custom = JSON.parse(localStorage.getItem(this._getExpenseCategoryKey()) || '[]');
        if (!custom.includes(name)) {
            custom.push(name);
            localStorage.setItem(this._getExpenseCategoryKey(), JSON.stringify(custom));
        }
    },

    renderExpensesModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        this.fetchBranchExpenses().then((expenses) => {
            const { items: pagedExpenses, page: expensesPage, totalPages: expensesPages } = this.paginateList(expenses, 'expenses', 10);
            const categories = this.getExpenseCategories();
            const quickAddVal = '__quick_add_expense_cat__';
            const categoryOptions = categories.map(c => `<option value="${c}">${c}</option>`).join('');
            const rows = pagedExpenses.map(expense => {
                const expenseJson = encodeURIComponent(JSON.stringify(expense));
                return `
                <tr class="expense-item" data-expense-id="${expense.id}" data-expense="${expenseJson}">
                    <td data-label="Date">${new Date(expense.createdAt).toLocaleString()}</td>
                    <td data-label="Title">${expense.title}</td>
                    <td data-label="Category">${expense.category || '-'}</td>
                    <td data-label="Amount">${this.formatCurrency(expense.amount || 0)}</td>
                    <td data-label="Note">${expense.note || '-'}</td>
                    <td data-label="Actions">
                         <div style="display:flex;gap:0.5rem;justify-content:flex-end;">
                            <button class="btn-ghost expense-action-btn" data-action="edit" title="Edit" style="padding:0.2rem 0.4rem;">
                                <span>✏️</span>
                            </button>
                            <button class="btn-ghost expense-action-btn" data-action="tag" title="Tag" style="padding:0.2rem 0.4rem;">
                                <span>📌</span>
                            </button>
                            <button class="btn-ghost expense-action-btn" data-action="delete" title="Delete" style="color:var(--danger);padding:0.2rem 0.4rem;">
                                <span>🗑️</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            }).join('');

            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Expenses</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Track spending and operational costs</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Expense</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-expense-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-expense-body" class="hidden">
                        <div id="ops-expense-message" class="message-box hidden"></div>
                        <form id="ops-expense-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Title</label>
                                <input type="text" id="expense-title" placeholder="e.g. Rent" required>
                            </div>
                            <div class="input-group">
                                <label>Category</label>
                                <select id="expense-category" class="input-field">
                                    <option value="" disabled selected>Select category</option>
                                    ${categoryOptions}
                                    <option value="${quickAddVal}">+ Add New Category</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label>Amount</label>
                                <input type="number" id="expense-amount" min="0" step="0.01" placeholder="0.00" required>
                            </div>
                            <div class="input-group">
                                <label>Note</label>
                                <input type="text" id="expense-note" placeholder="Optional note">
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Add Expense</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Recent Expenses</h4>
                    </div>
                    ${expenses.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No expenses recorded yet.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Title</th>
                                        <th>Category</th>
                                        <th>Amount</th>
                                        <th>Note</th>
                                        <th style="text-align:right;">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('expenses', expensesPage, expensesPages)}
                    `}
                </div>
            </div>
        `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'expenses', expensesPages, () => this.renderExpensesModule(canvas));

                // ── Expense-category inline quick-add ──
                const catSelect = document.getElementById('expense-category');
                if (catSelect) {
                    const refreshCatOptions = (selected = '') => {
                        const cats = this.getExpenseCategories();
                        const opts = cats.map(c => `<option value="${c}">${c}</option>`).join('');
                        catSelect.innerHTML = `
                            <option value="" disabled ${selected ? '' : 'selected'}>Select category</option>
                            ${opts}
                            <option value="${quickAddVal}">+ Add New Category</option>
                        `;
                        if (selected) catSelect.value = selected;
                    };

                    catSelect.addEventListener('change', () => {
                        if (catSelect.value !== quickAddVal) return;
                        catSelect.value = '';

                        const existing = document.getElementById('inline-quick-add-exp-cat');
                        if (existing) existing.remove();

                        const card = document.createElement('div');
                        card.id = 'inline-quick-add-exp-cat';
                        card.className = 'inline-quick-add';
                        card.innerHTML = `
                            <div class="inline-quick-add-header">
                                <span>New Category</span>
                                <button type="button" class="inline-quick-add-close" id="ec-cancel" title="Cancel">&times;</button>
                            </div>
                            <div class="input-group">
                                <label>Category Name</label>
                                <input type="text" id="ec-name" class="input-field" placeholder="e.g. Office Supplies" autofocus>
                            </div>
                            <div class="inline-quick-add-actions">
                                <button type="button" class="btn-primary" id="ec-save" style="width:auto;">Save</button>
                                <button type="button" class="btn-ghost" id="ec-cancel-btn" style="width:auto;">Cancel</button>
                            </div>
                        `;
                        catSelect.closest('.input-group').insertAdjacentElement('afterend', card);
                        requestAnimationFrame(() => card.classList.add('open'));
                        const nameIn = card.querySelector('#ec-name');
                        if (nameIn) nameIn.focus();

                        const removeCard = () => {
                            card.classList.remove('open');
                            card.addEventListener('transitionend', () => card.remove(), { once: true });
                            setTimeout(() => { if (card.parentNode) card.remove(); }, 350);
                            refreshCatOptions();
                        };
                        card.querySelector('#ec-cancel').addEventListener('click', removeCard);
                        card.querySelector('#ec-cancel-btn').addEventListener('click', removeCard);
                        card.querySelector('#ec-save').addEventListener('click', () => {
                            const name = (card.querySelector('#ec-name').value || '').trim();
                            if (!name) return;
                            this.addExpenseCategory(name);
                            card.remove();
                            refreshCatOptions(name);
                            this.showToast('Category added', 'success');
                        });
                    });
                }

                const form = document.getElementById('ops-expense-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-expense-message');
                        const title = document.getElementById('expense-title').value.trim();
                        const catEl = document.getElementById('expense-category');
                        const category = (catEl && catEl.value !== quickAddVal) ? catEl.value : '';
                        const amount = Number(document.getElementById('expense-amount').value);
                        const note = document.getElementById('expense-note').value.trim();

                        if (!title) {
                            this.showMessage('ops-expense-message', 'Expense title is required.', 'error');
                            return;
                        }
                        if (Number.isNaN(amount) || amount < 0) {
                            this.showMessage('ops-expense-message', 'Amount must be 0 or more.', 'error');
                            return;
                        }

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            await this.createBranchExpense({ title, category, amount, note });
                            this.showToast('Expense added', 'success');
                            this.renderExpensesModule(canvas);
                        } catch (error) {
                            console.error('Failed to save expense:', error);
                            this.showMessage('ops-expense-message', error.message || 'Failed to save expense.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Add Expense';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }

                // Event Delegation for Expense Actions
                const tableContainer = canvas.querySelector('.table-container');
                if (tableContainer) {
                    tableContainer.addEventListener('click', async (e) => {
                        const btn = e.target.closest('.expense-action-btn');
                        if (!btn) return;

                        e.stopPropagation();
                        const row = btn.closest('.expense-item');
                        const expenseId = row.dataset.expenseId;
                        const expense = JSON.parse(decodeURIComponent(row.dataset.expense));
                        const action = btn.dataset.action;

                        if (action === 'delete') {
                            this.promptPinVerification(async () => {
                                try {
                                    await this.deleteBranchExpense(expenseId);
                                    row.remove();
                                    this.showToast('Expense deleted', 'success');
                                } catch (error) {
                                    console.error('Failed to delete expense:', error);
                                    this.showToast('Failed to delete expense', 'error');
                                }
                            });
                        }

                        if (action === 'edit') {
                            this.showEditExpenseModal(expense, () => this.renderExpensesModule(canvas));
                        }

                        if (action === 'tag') {
                            this.showToast('Tags coming soon!', 'info');
                        }
                    });
                }
            }, 0);
        });
    },

    showEditExpenseModal(expense, onSuccess) {
        const existing = document.getElementById('edit-expense-modal');
        if (existing) existing.remove();

        const categories = this.getExpenseCategories();
        const categoryOptions = categories.map(c => `<option value="${c}" ${c === expense.category ? 'selected' : ''}>${c}</option>`).join('');

        const modalHTML = `
            <div id="edit-expense-modal" class="modal-overlay">
                <div class="modal-content" style="max-width: 500px; width: 90%;">
                    <div class="card-header">
                        <h3 class="card-title">Edit Expense</h3>
                        <button class="btn-ghost close-modal-btn">&times;</button>
                    </div>
                    <div id="edit-expense-message" class="message-box hidden"></div>
                    <form id="edit-expense-form" style="margin-top: 1rem;">
                        <input type="hidden" id="edit-expense-id" value="${expense.id}">
                        <div class="input-group">
                            <label>Title</label>
                            <input type="text" id="edit-expense-title" value="${expense.title}" required>
                        </div>
                        <div class="input-group">
                            <label>Category</label>
                            <select id="edit-expense-category" class="input-field">
                                <option value="" disabled>Select category</option>
                                ${categoryOptions}
                            </select>
                        </div>
                        <div class="input-group">
                            <label>Amount</label>
                            <input type="number" id="edit-expense-amount" value="${expense.amount}" min="0" step="0.01" required>
                        </div>
                        <div class="input-group">
                            <label>Note</label>
                            <input type="text" id="edit-expense-note" value="${expense.note || ''}" placeholder="Optional note">
                        </div>
                        <div class="modal-actions" style="display: flex; gap: 1rem; margin-top: 1.5rem;">
                            <button type="button" class="btn-ghost close-modal-btn" style="flex:1">Cancel</button>
                            <button type="submit" class="btn-primary" style="flex:1">Save Changes</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('edit-expense-modal');
        const form = document.getElementById('edit-expense-form');

        const close = () => modal.remove();
        modal.querySelectorAll('.close-modal-btn').forEach(b => b.addEventListener('click', close));
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            this.hideMessage('edit-expense-message');

            const title = document.getElementById('edit-expense-title').value.trim();
            const category = document.getElementById('edit-expense-category').value;
            const amount = Number(document.getElementById('edit-expense-amount').value);
            const note = document.getElementById('edit-expense-note').value.trim();

            if (!title) {
                this.showMessage('edit-expense-message', 'Title is required', 'error');
                return;
            }
            if (Number.isNaN(amount) || amount < 0) {
                this.showMessage('edit-expense-message', 'Amount must be valid', 'error');
                return;
            }

            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.textContent = 'Saving...';
            submitBtn.disabled = true;

            try {
                await this.upsertBranchExpense({ ...expense, title, category, amount, note });
                this.showToast('Expense updated', 'success');
                close();
                if (onSuccess) onSuccess();
            } catch (error) {
                console.error(error);
                this.showMessage('edit-expense-message', 'Failed to update expense', 'error');
                submitBtn.textContent = 'Save Changes';
                submitBtn.disabled = false;
            }
        });
    },

    // ── Income-source dropdown helpers ──
    _defaultIncomeSources: ['Sales Revenue', 'Service Income', 'Freelance', 'Investments', 'Rental Income', 'Commissions', 'Grants', 'Donations', 'Interest', 'Other'],

    _getIncomeSourceKey() {
        const bid = this.state.currentProfile?.branchId || 'global';
        return `bms-income-sources-${bid}`;
    },

    getIncomeSources() {
        const custom = JSON.parse(localStorage.getItem(this._getIncomeSourceKey()) || '[]');
        const merged = [...this._defaultIncomeSources];
        custom.forEach(s => { if (!merged.includes(s)) merged.push(s); });
        return merged;
    },

    addIncomeSource(name) {
        const custom = JSON.parse(localStorage.getItem(this._getIncomeSourceKey()) || '[]');
        if (!custom.includes(name)) {
            custom.push(name);
            localStorage.setItem(this._getIncomeSourceKey(), JSON.stringify(custom));
        }
    },

    renderIncomeModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        this.fetchBranchIncome().then((incomeEntries) => {
            const { items: pagedIncome, page: incomePage, totalPages: incomePages } = this.paginateList(incomeEntries, 'income', 10);
            const sources = this.getIncomeSources();
            const quickAddVal = '__quick_add_income_src__';
            const sourceOptions = sources.map(s => `<option value="${s}">${s}</option>`).join('');
            const rows = pagedIncome.map(entry => `
                <tr>
                    <td data-label="Date">${new Date(entry.createdAt).toLocaleString()}</td>
                    <td data-label="Title">${entry.title}</td>
                    <td data-label="Source">${entry.source || '-'}</td>
                    <td data-label="Amount">${this.formatCurrency(entry.amount || 0)}</td>
                    <td data-label="Note">${entry.note || '-'}</td>
                </tr>
            `).join('');

            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Income</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Track extra income streams</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Income</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-income-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-income-body" class="hidden">
                        <div id="ops-income-message" class="message-box hidden"></div>
                        <form id="ops-income-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Title</label>
                                <input type="text" id="income-title" placeholder="e.g. Service income" required>
                            </div>
                            <div class="input-group">
                                <label>Source</label>
                                <select id="income-source" class="input-field">
                                    <option value="" disabled selected>Select source</option>
                                    ${sourceOptions}
                                    <option value="${quickAddVal}">+ Add New Source</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label>Amount</label>
                                <input type="number" id="income-amount" min="0" step="0.01" placeholder="0.00" required>
                            </div>
                            <div class="input-group">
                                <label>Note</label>
                                <input type="text" id="income-note" placeholder="Optional note">
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Add Income</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Recent Income</h4>
                    </div>
                    ${incomeEntries.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No income entries recorded yet.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Title</th>
                                        <th>Source</th>
                                        <th>Amount</th>
                                        <th>Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('income', incomePage, incomePages)}
                    `}
                </div>
            </div>
        `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'income', incomePages, () => this.renderIncomeModule(canvas));

                // ── Income-source inline quick-add ──
                const srcSelect = document.getElementById('income-source');
                if (srcSelect) {
                    const refreshSrcOptions = (selected = '') => {
                        const srcs = this.getIncomeSources();
                        const opts = srcs.map(s => `<option value="${s}">${s}</option>`).join('');
                        srcSelect.innerHTML = `
                            <option value="" disabled ${selected ? '' : 'selected'}>Select source</option>
                            ${opts}
                            <option value="${quickAddVal}">+ Add New Source</option>
                        `;
                        if (selected) srcSelect.value = selected;
                    };

                    srcSelect.addEventListener('change', () => {
                        if (srcSelect.value !== quickAddVal) return;
                        srcSelect.value = '';

                        const existing = document.getElementById('inline-quick-add-inc-src');
                        if (existing) existing.remove();

                        const card = document.createElement('div');
                        card.id = 'inline-quick-add-inc-src';
                        card.className = 'inline-quick-add';
                        card.innerHTML = `
                            <div class="inline-quick-add-header">
                                <span>New Source</span>
                                <button type="button" class="inline-quick-add-close" id="is-cancel" title="Cancel">&times;</button>
                            </div>
                            <div class="input-group">
                                <label>Source Name</label>
                                <input type="text" id="is-name" class="input-field" placeholder="e.g. Consulting" autofocus>
                            </div>
                            <div class="inline-quick-add-actions">
                                <button type="button" class="btn-primary" id="is-save" style="width:auto;">Save</button>
                                <button type="button" class="btn-ghost" id="is-cancel-btn" style="width:auto;">Cancel</button>
                            </div>
                        `;
                        srcSelect.closest('.input-group').insertAdjacentElement('afterend', card);
                        requestAnimationFrame(() => card.classList.add('open'));
                        const nameIn = card.querySelector('#is-name');
                        if (nameIn) nameIn.focus();

                        const removeCard = () => {
                            card.classList.remove('open');
                            card.addEventListener('transitionend', () => card.remove(), { once: true });
                            setTimeout(() => { if (card.parentNode) card.remove(); }, 350);
                            refreshSrcOptions();
                        };
                        card.querySelector('#is-cancel').addEventListener('click', removeCard);
                        card.querySelector('#is-cancel-btn').addEventListener('click', removeCard);
                        card.querySelector('#is-save').addEventListener('click', () => {
                            const name = (card.querySelector('#is-name').value || '').trim();
                            if (!name) return;
                            this.addIncomeSource(name);
                            card.remove();
                            refreshSrcOptions(name);
                            this.showToast('Source added', 'success');
                        });
                    });
                }

                const form = document.getElementById('ops-income-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-income-message');
                        const title = document.getElementById('income-title').value.trim();
                        const srcEl = document.getElementById('income-source');
                        const source = (srcEl && srcEl.value !== quickAddVal) ? srcEl.value : '';
                        const amount = Number(document.getElementById('income-amount').value);
                        const note = document.getElementById('income-note').value.trim();

                        if (!title) {
                            this.showMessage('ops-income-message', 'Income title is required.', 'error');
                            return;
                        }
                        if (Number.isNaN(amount) || amount < 0) {
                            this.showMessage('ops-income-message', 'Amount must be 0 or more.', 'error');
                            return;
                        }

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            await this.createBranchIncome({ title, source, amount, note });
                            this.showToast('Income added', 'success');
                            this.renderIncomeModule(canvas);
                        } catch (error) {
                            console.error('Failed to save income:', error);
                            this.showMessage('ops-income-message', error.message || 'Failed to save income.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Add Income';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }
            }, 0);
        });
    },

    renderNotesModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        this.fetchBranchNotes().then((notes) => {
            const { items: pagedNotes, page: notesPage, totalPages: notesPages } = this.paginateList(notes, 'notes', 10);

            // New Card-based Layout
            const noteCards = pagedNotes.map(note => {
                const dateStr = new Date(note.createdAt).toLocaleString();
                const noteJson = encodeURIComponent(JSON.stringify(note));

                return `
                <div class="item" data-note-id="${note.id}" data-note="${noteJson}">
                    <div class="note-preview" style="cursor: pointer;" title="Open note">
                        <div class="item-title" style="margin-bottom: 4px;">${note.title || (note.details ? (note.details.split('\n')[0].substring(0, 50) + (note.details.length > 50 ? '...' : '')) : 'Untitled Note')}</div>
                        <div class="item-subtitle" style="margin-bottom: 0;">${dateStr}</div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 12px; border-top: 1px solid var(--border); padding-top: 8px;">
                        <button class="btn-ghost note-action-btn" data-action="edit" title="Edit Note" style="padding: 4px 8px; font-size: 0.85rem; color: var(--text-main);">
                            <span style="margin-right: 4px;">✏️</span> Edit
                        </button>
                        <button class="btn-ghost note-action-btn" data-action="tag" title="Add Tag" style="padding: 4px 8px; font-size: 0.85rem; color: var(--text-main);">
                            <span style="margin-right: 4px;">📌</span> Tag
                        </button>
                        <div style="flex:1;"></div>
                        <button class="btn-ghost note-action-btn" data-action="delete" title="Delete Note" style="padding: 4px 8px; font-size: 0.85rem; color: var(--danger);">
                            <span style="margin-right: 4px;">🗑️</span> Delete
                        </button>
                    </div>
                    <div class="tags-scroll" style="margin-top: 6px; touch-action: pan-x;">
                        <!-- Placeholder for tags -->
                        ${note.tags ? note.tags.map(tag => `<span class="tag-badge" style="background-color:rgba(78, 205, 196, 0.22);border:1px solid rgb(78, 205, 196);color:#1a1a1a;padding:4px 8px;border-radius:12px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;">${tag}</span>`).join('') : ''}
                    </div>
                </div>
                `;
            }).join('');

            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Notes</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Quick notes for daily operations</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Note</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-notes-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-notes-body" class="hidden">
                        <div id="ops-notes-message" class="message-box hidden"></div>
                        <form id="ops-notes-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Title</label>
                                <input type="text" id="note-title" placeholder="e.g. Delivery reminder" required>
                            </div>
                            <div class="input-group">
                                <label>Details</label>
                                <textarea id="note-details" class="input-field" rows="3" placeholder="Optional details"></textarea>
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Add Note</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Recent Notes</h4>
                    </div>
                    ${notes.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No notes yet.</div>
                    ` : `
                        <div class="notes-list-container" style="display: flex; flex-direction: column; gap: 1rem; padding: 1rem;">
                            ${noteCards}
                        </div>
                        ${this.renderPaginationControls('notes', notesPage, notesPages)}
                    `}
                </div>
            </div>
            `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'notes', notesPages, () => this.renderNotesModule(canvas));

                // Form Handler
                const form = document.getElementById('ops-notes-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-notes-message');
                        const title = document.getElementById('note-title').value.trim();
                        const details = document.getElementById('note-details').value.trim();
                        if (!title) {
                            this.showMessage('ops-notes-message', 'Note title is required.', 'error');
                            return;
                        }

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            await this.createBranchNote({ title, details });
                            this.showToast('Note added', 'success');
                            this.renderNotesModule(canvas);
                        } catch (error) {
                            console.error('Failed to save note:', error);
                            let msg = error.message || 'Failed to save note.';
                            if (msg.includes('schema') || msg.includes('details')) {
                                msg += ' (Database schema update required. Please run sql/fix_notes_details.sql)';
                            }
                            this.showMessage('ops-notes-message', msg, 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Add Note';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }

                // Event Delegation for Note Actions
                const listContainer = canvas.querySelector('.notes-list-container');
                if (listContainer) {
                    listContainer.addEventListener('click', async (e) => {
                        // Handle Preview Click (bubbling from .note-preview)
                        const preview = e.target.closest('.note-preview');
                        if (preview) {
                            const card = preview.closest('.item');
                            const note = JSON.parse(decodeURIComponent(card.dataset.note));
                            this.showNotePreviewModal(note);
                            return;
                        }

                        // Handle Actions
                        const btn = e.target.closest('.note-action-btn');
                        if (!btn) return;

                        e.stopPropagation();
                        const card = btn.closest('.item');
                        const noteId = card.dataset.noteId;
                        const note = JSON.parse(decodeURIComponent(card.dataset.note));
                        const action = btn.dataset.action;

                        if (action === 'delete') {
                            this.promptPinVerification(async () => {
                                try {
                                    await this.deleteBranchNote(noteId);
                                    card.remove();
                                    this.showToast('Note deleted', 'success');
                                    // Optional: Refresh if pagination needs update, or just remove from DOM
                                    // this.renderNotesModule(canvas); 
                                } catch (error) {
                                    console.error('Failed to delete note:', error);
                                    this.showToast('Failed to delete note', 'error');
                                }
                            });
                        }

                        if (action === 'edit') {
                            this.showEditNoteModal(note, () => this.renderNotesModule(canvas));
                        }

                        if (action === 'tag') {
                            this.showToast('Tags coming soon!', 'info');
                            // Placeholder for openItemTagsModal
                        }
                    });
                }

            }, 0);
        });
    },

    showNotePreviewModal(note) {
        // Create a detailed modal with inline edit capability
        const existing = document.getElementById('note-preview-modal');
        if (existing) existing.remove();

        const dateStr = new Date(note.createdAt).toLocaleString();

        // Initial State (View Mode)
        const modalHTML = `
            <div id="note-preview-modal" class="modal-overlay">
                <div class="modal-content" style="max-width: 900px; width: 90%;">
                    <!-- Header -->
                    <div class="card-header" style="display:flex; justify-content:space-between; align-items: flex-start; border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 1rem;">
                        <div style="flex: 1; padding-right: 1rem;">
                            <!-- View Mode Title -->
                            <h3 id="np-view-title" style="margin:0; font-size: 1.25rem;">${note.title}</h3>
                            <div id="np-view-date" class="text-muted" style="font-size: 0.85rem; margin-top: 4px;">${dateStr}</div>
                            
                            <!-- Edit Mode Title Input (Hidden) -->
                            <div id="np-edit-title-group" class="hidden" style="margin-bottom: 0.5rem;">
                                <label style="font-size: 0.75rem; color: var(--text-muted);">Title</label>
                                <input type="text" id="np-edit-title" class="input-field" value="${note.title}" style="font-size: 1.1rem; font-weight: 600;">
                            </div>
                        </div>
                        
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            <button id="np-toggle-edit" class="btn-ghost" style="padding: 6px 12px; display: flex; align-items: center; gap: 6px;">
                                <span>✏️</span> Edit
                            </button>
                            <button class="btn-ghost close-modal-btn" style="padding: 6px;">&times;</button>
                        </div>
                    </div>

                    <!-- Body -->
                    <div style="min-height: 200px;">
                        <!-- View Mode Body -->
                        <div id="np-view-body" style="white-space: pre-wrap; line-height: 1.6; color: var(--text-main);">
                            ${note.details || '<em class="text-muted">No additional details</em>'}
                        </div>

                        <!-- Edit Mode Body (Hidden) -->
                        <div id="np-edit-body-group" class="hidden" style="height: 100%;">
                             <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 4px;">Content</label>
                            <textarea id="np-edit-details" class="input-field" style="width: 100%; height: 300px; resize: vertical; font-family: inherit; line-height: 1.5;">${note.details || ''}</textarea>
                        </div>
                    </div>

                    <!-- Footer (View Mode only, Edit actions are in header/toggle) -->
                    <div id="np-footer" class="modal-actions" style="border-top: 1px solid var(--border); margin-top: 1.5rem; padding-top: 1rem; text-align: right;">
                        <button class="btn-primary close-modal-btn">Close</button>
                    </div>
                </div>
            </div>
         `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('note-preview-modal');
        const toggleBtn = document.getElementById('np-toggle-edit');

        // Elements
        const viewTitle = document.getElementById('np-view-title');
        const viewDate = document.getElementById('np-view-date');
        const editTitleGroup = document.getElementById('np-edit-title-group');
        const editTitleInput = document.getElementById('np-edit-title');

        const viewBody = document.getElementById('np-view-body');
        const editBodyGroup = document.getElementById('np-edit-body-group');
        const editBodyInput = document.getElementById('np-edit-details');

        const footer = document.getElementById('np-footer');

        let isEditing = false;

        // Toggle Logic
        toggleBtn.addEventListener('click', async () => {
            if (!isEditing) {
                // Switch to Edit Mode
                isEditing = true;

                // UI Updates
                viewTitle.classList.add('hidden');
                viewDate.classList.add('hidden');
                editTitleGroup.classList.remove('hidden');

                viewBody.classList.add('hidden');
                editBodyGroup.classList.remove('hidden');

                footer.classList.add('hidden');

                toggleBtn.innerHTML = '<span>💾</span> Save';
                toggleBtn.classList.remove('btn-ghost');
                toggleBtn.classList.add('btn-primary');

                editTitleInput.focus();

            } else {
                // Save Changes
                const newTitle = editTitleInput.value.trim();
                const newDetails = editBodyInput.value.trim();

                if (!newTitle) {
                    this.showToast('Title is required', 'error');
                    return;
                }

                toggleBtn.disabled = true;
                toggleBtn.innerHTML = 'Saving...';

                try {
                    await this.upsertBranchNote({ ...note, title: newTitle, details: newDetails });
                    this.showToast('Note updated', 'success');

                    // Update Local Data & UI
                    note.title = newTitle;
                    note.details = newDetails;

                    viewTitle.textContent = newTitle;
                    viewBody.textContent = newDetails || 'No additional details'; // Simple text update, losing <em> but acceptable
                    if (!newDetails) viewBody.innerHTML = '<em class="text-muted">No additional details</em>';

                    // Revert to View Mode
                    isEditing = false;

                    viewTitle.classList.remove('hidden');
                    viewDate.classList.remove('hidden');
                    editTitleGroup.classList.add('hidden');

                    viewBody.classList.remove('hidden');
                    editBodyGroup.classList.add('hidden');

                    footer.classList.remove('hidden');

                    toggleBtn.innerHTML = '<span>✏️</span> Edit';
                    toggleBtn.classList.remove('btn-primary');
                    toggleBtn.classList.add('btn-ghost');
                    toggleBtn.disabled = false;

                    // Refresh Background List (if possible)
                    const canvas = document.querySelector('#main-content-canvas'); // Hypothetical selector
                    if (canvas) this.renderNotesModule(canvas); // Attempt refresh, might need correct selector
                    // For now, reload whole module if we can find the canvas, or just let the next render handle it.
                    const activeCanvas = document.querySelector('.page-container');
                    if (activeCanvas) this.renderNotesModule(activeCanvas);

                } catch (error) {
                    console.error(error);
                    this.showToast('Failed to save changes', 'error');
                    toggleBtn.disabled = false;
                    toggleBtn.innerHTML = '<span>💾</span> Save';
                }
            }
        });

        const close = () => {
            if (isEditing) {
                if (!confirm('Discard unsaved changes?')) return;
            }
            modal.remove();
        };

        modal.querySelectorAll('.close-modal-btn').forEach(b => b.addEventListener('click', close));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
    },

    showEditNoteModal(note, onSuccess) {
        const existing = document.getElementById('edit-note-modal');
        if (existing) existing.remove();

        const modalHTML = `
            <div id="edit-note-modal" class="modal-overlay">
                <div class="modal-content" style="max-width: 700px; width: 90%;">
                    <div class="card-header">
                        <h3 class="card-title">Edit Note</h3>
                        <button class="btn-ghost close-modal-btn">&times;</button>
                    </div>
                    <div id="edit-note-message" class="message-box hidden"></div>
                    <form id="edit-note-form" style="margin-top: 1rem;">
                        <input type="hidden" id="edit-note-id" value="${note.id}">
                        <div class="input-group">
                            <label>Title</label>
                            <input type="text" id="edit-note-title" value="${note.title}" required>
                        </div>
                        <div class="input-group">
                            <label>Details</label>
                            <textarea id="edit-note-details" class="input-field" rows="5">${note.details || ''}</textarea>
                        </div>
                        <div class="modal-actions" style="display: flex; gap: 1rem; margin-top: 1.5rem;">
                            <button type="button" class="btn-ghost close-modal-btn" style="flex:1">Cancel</button>
                            <button type="submit" class="btn-primary" style="flex:1">Save Changes</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('edit-note-modal');
        const form = document.getElementById('edit-note-form');

        const close = () => modal.remove();
        modal.querySelectorAll('.close-modal-btn').forEach(b => b.addEventListener('click', close));
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            this.hideMessage('edit-note-message');

            const title = document.getElementById('edit-note-title').value.trim();
            const details = document.getElementById('edit-note-details').value.trim();

            if (!title) {
                this.showMessage('edit-note-message', 'Title is required', 'error');
                return;
            }

            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.textContent = 'Saving...';
            submitBtn.disabled = true;

            try {
                await this.upsertBranchNote({ ...note, title, details });
                this.showToast('Note updated', 'success');
                close();
                if (onSuccess) onSuccess();
            } catch (error) {
                console.error(error);
                this.showMessage('edit-note-message', 'Failed to update note', 'error');
                submitBtn.textContent = 'Save Changes';
                submitBtn.disabled = false;
            }
        });
    },

    renderCustomersModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        this.fetchBranchCustomers().then((customers) => {
            const { items: pagedCustomers, page: customersPage, totalPages: customersPages } = this.paginateList(customers, 'customers', 10);
            const rows = pagedCustomers.map(customer => `
                <tr>
                    <td data-label="Name">${customer.name}</td>
                    <td data-label="Phone">${customer.phone || '-'}</td>
                    <td data-label="Email">${customer.email || '-'}</td>
                    <td data-label="Address">${customer.address || '-'}</td>
                </tr>
            `).join('');

            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Customers</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Manage customer contacts</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Customer</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-customers-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-customers-body" class="hidden">
                        <div id="ops-customers-message" class="message-box hidden"></div>
                        <form id="ops-customers-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Customer Name</label>
                                <input type="text" id="customer-name" placeholder="e.g. John Doe" required>
                            </div>
                            <div class="input-group">
                                <label>Phone</label>
                                <input type="text" id="customer-phone" placeholder="Optional">
                            </div>
                            <div class="input-group">
                                <label>Email</label>
                                <input type="email" id="customer-email" placeholder="Optional">
                            </div>
                            <div class="input-group">
                                <label>Address</label>
                                <input type="text" id="customer-address" placeholder="Optional">
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Add Customer</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Customer List</h4>
                    </div>
                    ${customers.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No customers added yet.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Phone</th>
                                        <th>Email</th>
                                        <th>Address</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('customers', customersPage, customersPages)}
                    `}
                </div>
            </div>
        `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'customers', customersPages, () => this.renderCustomersModule(canvas));
                const form = document.getElementById('ops-customers-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-customers-message');
                        const name = document.getElementById('customer-name').value.trim();
                        const phone = document.getElementById('customer-phone').value.trim();
                        const email = document.getElementById('customer-email').value.trim();
                        const address = document.getElementById('customer-address').value.trim();
                        if (!name) {
                            this.showMessage('ops-customers-message', 'Customer name is required.', 'error');
                            return;
                        }

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            await this.createBranchCustomer({ name, phone, email, address });
                            this.showToast('Customer added', 'success');
                            this.renderCustomersModule(canvas);
                        } catch (error) {
                            console.error('Failed to save customer:', error);
                            this.showMessage('ops-customers-message', error.message || 'Failed to save customer.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Add Customer';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }
            }, 0);
        });
    },

    renderInvoicesModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        Promise.all([this.fetchBranchInvoices(), this.fetchBranchCustomers()]).then(([invoices, customers]) => {
            const customerOptions = customers.map(cust => `<option value="${cust.id}">${cust.name}</option>`).join('');
            const { items: pagedInvoices, page: invoicesPage, totalPages: invoicesPages } = this.paginateList(invoices, 'invoices', 10);
            const rows = pagedInvoices.map(inv => `
                <tr>
                    <td data-label="Date">${new Date(inv.createdAt).toLocaleString()}</td>
                    <td data-label="Invoice">${inv.invoiceNumber}</td>
                    <td data-label="Customer">${inv.customerName || '-'}</td>
                    <td data-label="Amount">${this.formatCurrency(inv.amount || 0)}</td>
                    <td data-label="Status">${inv.status}</td>
                </tr>
            `).join('');

            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Invoices & Receivables</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Track customer invoices</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Invoice</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-invoices-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-invoices-body" class="hidden">
                        <div id="ops-invoices-message" class="message-box hidden"></div>
                        <form id="ops-invoices-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Invoice Number</label>
                                <input type="text" id="invoice-number" placeholder="e.g. INV-001" required>
                            </div>
                            <div class="input-group">
                                <label>Customer</label>
                                <select id="invoice-customer" class="input-field">
                                    <option value="">Select customer</option>
                                    ${customerOptions}
                                </select>
                            </div>
                            <div class="input-group">
                                <label>Amount</label>
                                <input type="number" id="invoice-amount" min="0" step="0.01" placeholder="0.00" required>
                            </div>
                            <div class="input-group">
                                <label>Status</label>
                                <select id="invoice-status" class="input-field">
                                    <option value="unpaid" selected>Unpaid</option>
                                    <option value="paid">Paid</option>
                                    <option value="partial">Partially Paid</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label>Due Date</label>
                                <input type="date" id="invoice-due">
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Add Invoice</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Recent Invoices</h4>
                    </div>
                    ${invoices.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No invoices yet.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Invoice</th>
                                        <th>Customer</th>
                                        <th>Amount</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('invoices', invoicesPage, invoicesPages)}
                    `}
                </div>
            </div>
        `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'invoices', invoicesPages, () => this.renderInvoicesModule(canvas));
                const form = document.getElementById('ops-invoices-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-invoices-message');
                        const invoiceNumber = document.getElementById('invoice-number').value.trim();
                        const customerId = document.getElementById('invoice-customer').value;
                        const amount = Number(document.getElementById('invoice-amount').value);
                        const status = document.getElementById('invoice-status').value;
                        const dueDate = document.getElementById('invoice-due').value;
                        if (!invoiceNumber) {
                            this.showMessage('ops-invoices-message', 'Invoice number is required.', 'error');
                            return;
                        }
                        if (Number.isNaN(amount) || amount < 0) {
                            this.showMessage('ops-invoices-message', 'Amount must be 0 or more.', 'error');
                            return;
                        }
                        const customer = customers.find(c => c.id === customerId);

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            await this.createBranchInvoice({
                                invoiceNumber,
                                customerId: customerId || null,
                                customerName: customer ? customer.name : null,
                                amount,
                                status,
                                dueDate
                            });
                            this.showToast('Invoice added', 'success');
                            this.renderInvoicesModule(canvas);
                        } catch (error) {
                            console.error('Failed to save invoice:', error);
                            this.showMessage('ops-invoices-message', error.message || 'Failed to save invoice.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Add Invoice';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }
            }, 0);
        });
    },

    renderReportsModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        this.fetchBranchReports().then((reports) => {
            const { items: pagedReports, page: reportsPage, totalPages: reportsPages } = this.paginateList(reports, 'reports', 10);
            const rows = pagedReports.map(report => `
                <tr>
                    <td data-label="Date">${new Date(report.createdAt).toLocaleString()}</td>
                    <td data-label="Type">${report.type}</td>
                    <td data-label="Period">${report.period}</td>
                    <td data-label="Note">${report.note || '-'}</td>
                </tr>
            `).join('');

            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Reports</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Save report requests for quick access</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Report Request</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-reports-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-reports-body" class="hidden">
                        <div id="ops-reports-message" class="message-box hidden"></div>
                        <form id="ops-reports-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Report Type</label>
                                <select id="report-type" class="input-field">
                                    <option value="sales">Sales</option>
                                    <option value="inventory">Inventory</option>
                                    <option value="expenses">Expenses</option>
                                    <option value="income">Income</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label>Period</label>
                                <select id="report-period" class="input-field">
                                    <option value="today">Today</option>
                                    <option value="week">This Week</option>
                                    <option value="month" selected>This Month</option>
                                    <option value="quarter">This Quarter</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label>Note</label>
                                <input type="text" id="report-note" placeholder="Optional note">
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Save Report</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Recent Reports</h4>
                    </div>
                    ${reports.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No reports saved yet.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Type</th>
                                        <th>Period</th>
                                        <th>Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('reports', reportsPage, reportsPages)}
                    `}
                </div>
            </div>
        `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'reports', reportsPages, () => this.renderReportsModule(canvas));
                const form = document.getElementById('ops-reports-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-reports-message');
                        const type = document.getElementById('report-type').value;
                        const period = document.getElementById('report-period').value;
                        const note = document.getElementById('report-note').value.trim();

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            await this.createBranchReport({ type, period, note });
                            this.showToast('Report saved', 'success');
                            this.renderReportsModule(canvas);
                        } catch (error) {
                            console.error('Failed to save report:', error);
                            this.showMessage('ops-reports-message', error.message || 'Failed to save report.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Save Report';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }
            }, 0);
        });
    },

    renderLoansModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        this.fetchBranchLoans().then((loans) => {
            const { items: pagedLoans, page: loansPage, totalPages: loansPages } = this.paginateList(loans, 'loans', 10);
            const rows = pagedLoans.map(loan => `
                <tr>
                    <td data-label="Date">${new Date(loan.createdAt).toLocaleString()}</td>
                    <td data-label="Borrower">${loan.borrower}</td>
                    <td data-label="Amount">${this.formatCurrency(loan.amount || 0)}</td>
                    <td data-label="Status">${loan.status}</td>
                    <td data-label="Due">${loan.dueDate || '-'}</td>
                </tr>
            `).join('');

            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Loans</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Track loans and repayments</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Loan</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-loans-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-loans-body" class="hidden">
                        <div id="ops-loans-message" class="message-box hidden"></div>
                        <form id="ops-loans-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Borrower</label>
                                <input type="text" id="loan-borrower" placeholder="e.g. Client name" required>
                            </div>
                            <div class="input-group">
                                <label>Amount</label>
                                <input type="number" id="loan-amount" min="0" step="0.01" placeholder="0.00" required>
                            </div>
                            <div class="input-group">
                                <label>Interest (%)</label>
                                <input type="number" id="loan-interest" min="0" step="0.01" placeholder="Optional">
                            </div>
                            <div class="input-group">
                                <label>Status</label>
                                <select id="loan-status" class="input-field">
                                    <option value="active" selected>Active</option>
                                    <option value="cleared">Cleared</option>
                                    <option value="overdue">Overdue</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label>Due Date</label>
                                <input type="date" id="loan-due">
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Add Loan</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Recent Loans</h4>
                    </div>
                    ${loans.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No loans recorded yet.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Borrower</th>
                                        <th>Amount</th>
                                        <th>Status</th>
                                        <th>Due</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('loans', loansPage, loansPages)}
                    `}
                </div>
            </div>
        `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'loans', loansPages, () => this.renderLoansModule(canvas));
                const form = document.getElementById('ops-loans-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-loans-message');
                        const borrower = document.getElementById('loan-borrower').value.trim();
                        const amount = Number(document.getElementById('loan-amount').value);
                        const interest = Number(document.getElementById('loan-interest').value || 0);
                        const status = document.getElementById('loan-status').value;
                        const dueDate = document.getElementById('loan-due').value;

                        if (!borrower) {
                            this.showMessage('ops-loans-message', 'Borrower is required.', 'error');
                            return;
                        }
                        if (Number.isNaN(amount) || amount < 0) {
                            this.showMessage('ops-loans-message', 'Amount must be 0 or more.', 'error');
                            return;
                        }

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            await this.createBranchLoan({ borrower, amount, interest, status, dueDate });
                            this.showToast('Loan added', 'success');
                            this.renderLoansModule(canvas);
                        } catch (error) {
                            console.error('Failed to save loan:', error);
                            this.showMessage('ops-loans-message', error.message || 'Failed to save loan.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Add Loan';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }
            }, 0);
        });
    },

    renderAssetsModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        this.fetchBranchAssets().then((assets) => {
            const { items: pagedAssets, page: assetsPage, totalPages: assetsPages } = this.paginateList(assets, 'assets', 10);
            const rows = pagedAssets.map(asset => `
                <tr>
                    <td data-label="Name">${asset.name}</td>
                    <td data-label="Value">${this.formatCurrency(asset.value || 0)}</td>
                    <td data-label="Purchased">${asset.purchaseDate || '-'}</td>
                    <td data-label="Condition">${asset.condition || '-'}</td>
                </tr>
            `).join('');

            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Assets</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Keep track of branch assets</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Asset</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-assets-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-assets-body" class="hidden">
                        <div id="ops-assets-message" class="message-box hidden"></div>
                        <form id="ops-assets-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Asset Name</label>
                                <input type="text" id="asset-name" placeholder="e.g. Delivery Bike" required>
                            </div>
                            <div class="input-group">
                                <label>Value</label>
                                <input type="number" id="asset-value" min="0" step="0.01" placeholder="0.00" required>
                            </div>
                            <div class="input-group">
                                <label>Purchase Date</label>
                                <input type="date" id="asset-date">
                            </div>
                            <div class="input-group">
                                <label>Condition</label>
                                <input type="text" id="asset-condition" placeholder="Optional">
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Add Asset</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Assets List</h4>
                    </div>
                    ${assets.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No assets recorded yet.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Value</th>
                                        <th>Purchased</th>
                                        <th>Condition</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('assets', assetsPage, assetsPages)}
                    `}
                </div>
            </div>
        `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'assets', assetsPages, () => this.renderAssetsModule(canvas));
                const form = document.getElementById('ops-assets-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-assets-message');
                        const name = document.getElementById('asset-name').value.trim();
                        const value = Number(document.getElementById('asset-value').value);
                        const purchaseDate = document.getElementById('asset-date').value;
                        const condition = document.getElementById('asset-condition').value.trim();
                        if (!name) {
                            this.showMessage('ops-assets-message', 'Asset name is required.', 'error');
                            return;
                        }
                        if (Number.isNaN(value) || value < 0) {
                            this.showMessage('ops-assets-message', 'Value must be 0 or more.', 'error');
                            return;
                        }

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            await this.createBranchAsset({ name, value, purchaseDate, condition });
                            this.showToast('Asset added', 'success');
                            this.renderAssetsModule(canvas);
                        } catch (error) {
                            console.error('Failed to save asset:', error);
                            this.showMessage('ops-assets-message', error.message || 'Failed to save asset.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Add Asset';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }
            }, 0);
        });
    },

    renderMaintenanceModule(canvas) {
        canvas.innerHTML = this.getLoaderHTML();

        this.fetchBranchMaintenance().then((maintenance) => {
            const { items: pagedMaintenance, page: maintenancePage, totalPages: maintenancePages } = this.paginateList(maintenance, 'maintenance', 10);
            const rows = pagedMaintenance.map(entry => `
                <tr>
                    <td data-label="Date">${new Date(entry.createdAt).toLocaleString()}</td>
                    <td data-label="Title">${entry.title}</td>
                    <td data-label="Asset">${entry.asset || '-'}</td>
                    <td data-label="Cost">${this.formatCurrency(entry.cost || 0)}</td>
                    <td data-label="Status">${entry.status}</td>
                </tr>
            `).join('');

            canvas.innerHTML = `
            <div class="page-enter">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h3>Maintenance</h3>
                        <div class="text-muted" style="font-size: 0.85rem;">Log maintenance tasks</div>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 1.5rem;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 class="card-title">New Maintenance</h4>
                        <button type="button" class="btn-ghost" data-collapse-target="ops-maintenance-body" data-collapse-open-text="Create" data-collapse-close-text="Close">Create</button>
                    </div>
                    <div id="ops-maintenance-body" class="hidden">
                        <div id="ops-maintenance-message" class="message-box hidden"></div>
                        <form id="ops-maintenance-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>Task Title</label>
                                <input type="text" id="maintenance-title" placeholder="e.g. Generator service" required>
                            </div>
                            <div class="input-group">
                                <label>Asset</label>
                                <input type="text" id="maintenance-asset" placeholder="Optional">
                            </div>
                            <div class="input-group">
                                <label>Cost</label>
                                <input type="number" id="maintenance-cost" min="0" step="0.01" placeholder="0.00">
                            </div>
                            <div class="input-group">
                                <label>Status</label>
                                <select id="maintenance-status" class="input-field">
                                    <option value="scheduled" selected>Scheduled</option>
                                    <option value="in-progress">In Progress</option>
                                    <option value="completed">Completed</option>
                                </select>
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Add Task</button>
                        </form>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title">Recent Maintenance</h4>
                    </div>
                    ${maintenance.length === 0 ? `
                        <div class="text-muted" style="padding: 1rem;">No maintenance tasks yet.</div>
                    ` : `
                        <div class="table-container">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Title</th>
                                        <th>Asset</th>
                                        <th>Cost</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rows}
                                </tbody>
                            </table>
                        </div>
                        ${this.renderPaginationControls('maintenance', maintenancePage, maintenancePages)}
                    `}
                </div>
            </div>
        `;

            setTimeout(() => {
                this.bindCollapseControls(canvas);
                this.bindPaginationControls(canvas, 'maintenance', maintenancePages, () => this.renderMaintenanceModule(canvas));
                const form = document.getElementById('ops-maintenance-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        this.hideMessage('ops-maintenance-message');
                        const title = document.getElementById('maintenance-title').value.trim();
                        const asset = document.getElementById('maintenance-asset').value.trim();
                        const cost = Number(document.getElementById('maintenance-cost').value || 0);
                        const status = document.getElementById('maintenance-status').value;
                        if (!title) {
                            this.showMessage('ops-maintenance-message', 'Task title is required.', 'error');
                            return;
                        }
                        if (Number.isNaN(cost) || cost < 0) {
                            this.showMessage('ops-maintenance-message', 'Cost must be 0 or more.', 'error');
                            return;
                        }

                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) {
                            submitBtn.textContent = 'Saving...';
                            submitBtn.disabled = true;
                        }

                        try {
                            await this.createBranchMaintenance({ title, asset, cost, status });
                            this.showToast('Maintenance added', 'success');
                            this.renderMaintenanceModule(canvas);
                        } catch (error) {
                            console.error('Failed to save maintenance:', error);
                            this.showMessage('ops-maintenance-message', error.message || 'Failed to save maintenance.', 'error');
                        } finally {
                            if (submitBtn) {
                                submitBtn.textContent = 'Add Task';
                                submitBtn.disabled = false;
                            }
                        }
                    });
                }
            }, 0);
        });
    },

    getOpIcon(id) {
        const icons = {
            sales: '💰', expenses: '💸', income: '📈', notes: '📝',
            inventory: '📦', products: '🛍️', workspace: '🛍️', customers: '👥', categories: '🏷️',
            invoices: '🧾', reports: '📊', loans: '🏦', assets: '🏢',
            invoices: '🧾', reports: '📊', loans: '🏦', assets: '🏢',
            maintenance: '🔧'
        };
        return icons[id] || '⚡';
    },

    updateNavControls() {
        const container = document.getElementById('nav-controls');
        const backBtn = document.getElementById('nav-back');
        const fwdBtn = document.getElementById('nav-forward');

        if (!container || !backBtn || !fwdBtn) return;

        // Logic: Show container if we have ANY history (index > 0 or could go forward)
        // Actually, user wants it to act like browser nav.
        const canBack = this.state.historyIndex > 0 || (this.state.history.length > 0 && this.state.history[this.state.historyIndex] !== 'home');
        const canForward = this.state.historyIndex < this.state.history.length - 1;

        // If we are deep in stack, show controls
        if (this.state.history.length > 1 || canBack) {
            container.classList.remove('hidden');
            // Small delay to allow display:block to apply before opacity transition
            setTimeout(() => container.classList.add('visible'), 10);
        } else {
            container.classList.remove('visible');
            setTimeout(() => container.classList.add('hidden'), 300);
        }

        backBtn.disabled = !canBack;
        fwdBtn.disabled = !canForward;
    },

    bindNavControls() {
        const backBtn = document.getElementById('nav-back');
        const fwdBtn = document.getElementById('nav-forward');

        if (backBtn) backBtn.addEventListener('click', () => this.goBack());
        if (fwdBtn) fwdBtn.addEventListener('click', () => this.goForward());
    },

    goBack() {
        if (this.state.historyIndex > 0) {
            window.history.back();
        } else if (this.state.history.length > 0 && this.state.history[this.state.historyIndex] !== 'home') {
            this.loadPage('home', true); // Reset to home
        }
    },

    goForward() {
        if (this.state.historyIndex < this.state.history.length - 1) {
            window.history.forward();
        }
    },

    renderProfile() {
        const profile = this.state.currentProfile;
        const role = profile?.role === 'enterprise_admin' ? 'admin' : 'branch';
        const user = this.state.currentUser;

        // Validating if we have profile data
        const displayName = profile?.full_name || 'User';
        const displayRole = role === 'admin' ? 'Enterprise Admin' : 'Branch Manager';
        const displayEmail = user?.email || (role === 'branch' ? `${profile?.id || 'branch'}@bms` : 'N/A');

        let content = `
            <div class="card page-enter" style="max-width: 800px; margin: 0 auto; padding: 2rem;">
                <div class="card-header" style="text-align: center; display: block; padding-bottom: 2rem; border-bottom: 1px solid var(--border); margin-bottom: 2rem;">
                    <div style="font-size: 4rem; margin-bottom: 1rem; animation: float 6s ease-in-out infinite;">👤</div>
                    <h2 class="gradient-text" style="font-size: 2rem; margin-bottom: 0.5rem;">${displayName}</h2>
                    <span class="badge ${role === 'admin' ? 'badge-primary' : 'badge-secondary'}" style="font-size: 0.9rem; padding: 0.4rem 1rem;">
                        ${displayRole}
                    </span>
                    ${role === 'branch' ? `<div style="margin-top: 0.5rem; color: var(--text-muted); font-size: 0.9rem;">Branch ID: ${profile.branch_login_id || 'N/A'}</div>` : ''}
                </div>

                <div style="display: grid; gap: 2rem;">
        `;

        // 1. Appearance (Theme)
        content += `
            <div class="settings-section">
                <h4 style="color: var(--text-main); margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">Appearance</h4>
                <div class="settings-row">
                    <div>
                        <div style="font-weight: 500;">Theme</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">Switch between dark and light mode</div>
                    </div>
                    <div class="theme-buttons">
                        <label class="theme-switch" title="Toggle theme">
                            <input type="checkbox" class="theme-switch-input" ${this.state.theme === 'light' ? 'checked' : ''}>
                            <span class="theme-slider"></span>
                        </label>
                    </div>
                </div>
            </div>
        `;

        // 2. Regional (Currency)
        content += `
            <div class="settings-section">
                <h4 style="color: var(--text-main); margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">Regional Settings</h4>
                <div class="settings-row">
                   <div>
                        <div style="font-weight: 500;">Currency</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">Default currency for transactions</div>
                   </div>
                   <select id="settings-currency" class="input-field" style="min-width: 120px;">
                        <option value="TZS" ${this.state.currentCurrency === 'TZS' ? 'selected' : ''}>TZS (Tanzanian Shilling)</option>
                        <option value="USD" ${this.state.currentCurrency === 'USD' ? 'selected' : ''}>USD (US Dollar)</option>
                        <option value="EUR" ${this.state.currentCurrency === 'EUR' ? 'selected' : ''}>EUR (Euro)</option>
                        <option value="GBP" ${this.state.currentCurrency === 'GBP' ? 'selected' : ''}>GBP (British Pound)</option>
                        <option value="KES" ${this.state.currentCurrency === 'KES' ? 'selected' : ''}>KES (Kenyan Shilling)</option>
                        <option value="UGX" ${this.state.currentCurrency === 'UGX' ? 'selected' : ''}>UGX (Ugandan Shilling)</option>
                        <option value="RWF" ${this.state.currentCurrency === 'RWF' ? 'selected' : ''}>RWF (Rwandan Franc)</option>
                        <option value="ZAR" ${this.state.currentCurrency === 'ZAR' ? 'selected' : ''}>ZAR (South African Rand)</option>
                        <option value="NGN" ${this.state.currentCurrency === 'NGN' ? 'selected' : ''}>NGN (Nigerian Naira)</option>
                        <option value="GHS" ${this.state.currentCurrency === 'GHS' ? 'selected' : ''}>GHS (Ghanaian Cedi)</option>
                        <option value="AED" ${this.state.currentCurrency === 'AED' ? 'selected' : ''}>AED (UAE Dirham)</option>
                        <option value="INR" ${this.state.currentCurrency === 'INR' ? 'selected' : ''}>INR (Indian Rupee)</option>
                        <option value="CNY" ${this.state.currentCurrency === 'CNY' ? 'selected' : ''}>CNY (Chinese Yuan)</option>
                        <option value="JPY" ${this.state.currentCurrency === 'JPY' ? 'selected' : ''}>JPY (Japanese Yen)</option>
                        <option value="CAD" ${this.state.currentCurrency === 'CAD' ? 'selected' : ''}>CAD (Canadian Dollar)</option>
                        <option value="AUD" ${this.state.currentCurrency === 'AUD' ? 'selected' : ''}>AUD (Australian Dollar)</option>
                   </select>
                </div>
            </div>
        `;

        // 2.5. Business Details (for receipts) — read from profile state (Supabase-backed)
        content += `
            <div class="settings-section">
                <h4 style="color: var(--text-main); margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">Business Details</h4>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">Used on printed receipts</p>
                <div id="biz-details-message" class="message-box hidden"></div>
                <form id="biz-details-form" class="auth-form" style="max-width: 100%;">
                    <div class="input-group">
                        <label>Address</label>
                        <input type="text" id="biz-address" class="input-field" value="${profile?.address || ''}" placeholder="e.g. 123 Business St, City" disabled>
                    </div>
                    <div class="input-group">
                        <label>Phone</label>
                        <input type="text" id="biz-phone" class="input-field" value="${profile?.phone || ''}" placeholder="e.g. +123 456 789" disabled>
                    </div>
                    <div class="input-group">
                        <label>Email</label>
                        <input type="email" id="biz-email" class="input-field" value="${profile?.email || ''}" placeholder="youremail@domain.co" disabled>
                    </div>
                    <div style="display:flex;gap:1rem;">
                        <button type="button" id="biz-edit-btn" class="btn-secondary" style="width: auto;">Edit Details</button>
                        <button type="submit" id="biz-save-btn" class="btn-primary" style="width: auto; display: none;">Save Details</button>
                    </div>
                </form>
            </div>
        `;

        // 3. Profile Info (Admin Only Edit)
        if (role === 'admin') {
            content += `
            <div class="settings-section">
                <h4 style="color: var(--text-main); margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">Profile Information</h4>
                <div id="profile-message" class="message-box hidden"></div>
                <form id="profile-form" class="auth-form" style="max-width: 100%;">
                    <div class="input-group">
                        <label>Display Name</label>
                        <input type="text" id="settings-name" value="${profile?.full_name || ''}" required>
                    </div>
                    <div class="input-group">
                        <label>Email</label>
                        <input type="text" value="${displayEmail}" disabled style="opacity: 0.7;">
                    </div>
                    <button type="submit" class="btn-primary" style="width: auto;">Save Changes</button>
                </form>
            </div>
            `;
        }

        // 4. Security
        content += `
            <div class="settings-section">
                <h4 style="color: var(--text-main); margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">Security</h4>
        `;

        // 4.1 Change Password (Admin Only)
        if (role === 'admin') {
            content += `
                <div class="collapsible-section" style="border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; margin-bottom: 1rem;">
                     <div id="password-section-header" class="collapsible-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--bg-glass);">
                        <span style="font-weight: 500;">Change Password</span>
                        <span>▼</span>
                     </div>
                     <div id="password-section-content" class="collapsible-content hidden" style="padding: 1rem; border-top: 1px solid var(--border);">
                        <div id="security-message" class="message-box hidden"></div>
                        <form id="security-form" class="auth-form" style="max-width: 100%;">
                            <div class="input-group">
                                <label>New Password</label>
                                <div class="password-wrapper">
                                    <input type="password" id="sec-new-password" required minlength="6">
                                    <button type="button" class="password-toggle" data-target="sec-new-password" tabindex="-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                            <circle cx="12" cy="12" r="3"></circle>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                             <div class="input-group">
                                <label>Confirm Password</label>
                                <div class="password-wrapper">
                                    <input type="password" id="sec-confirm-password" required minlength="6">
                                    <button type="button" class="password-toggle" data-target="sec-confirm-password" tabindex="-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                            <circle cx="12" cy="12" r="3"></circle>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <button type="submit" class="btn-primary" style="width: auto;">Update Password</button>
                        </form>
                    </div>
                </div>
            `;
        }

        // 4.2 Security PIN (Admin & Branch)
        content += `
                <div class="collapsible-section" style="border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden;">
                     <div id="pin-section-header" class="collapsible-header" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--bg-glass);">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <span style="font-weight: 500;">Security PIN</span>
                            <span class="badge ${this.state.hasSecurityPin ? 'badge-success' : 'badge-warning'}" style="font-size: 0.7rem;">
                                ${this.state.hasSecurityPin ? 'Active' : 'Not Set'}
                            </span>
                        </div>
                        <span>▼</span>
                     </div>
                     <div id="pin-section-content" class="collapsible-content hidden" style="padding: 1rem; border-top: 1px solid var(--border);">
                        <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem;">
                            Used for sensitive actions like deleting ${role === 'admin' ? 'branches' : 'sales'}.
                        </p>
                        <div id="pin-message" class="message-box hidden"></div>
                        <form id="pin-form" class="auth-form" style="max-width: 100%;">
                            ${this.state.hasSecurityPin ? `
                                <div class="input-group">
                                    <label>Current PIN</label>
                                    <input type="password" id="pin-old" required maxlength="6" placeholder="Enter current PIN" autocomplete="off">
                                </div>
                            ` : ''}
                            
                            <div class="input-group">
                                <label>${this.state.hasSecurityPin ? 'New PIN' : 'Create PIN'}</label>
                                <input type="password" id="pin-new" required maxlength="6" minlength="4" placeholder="Enter 4-6 digit PIN" autocomplete="off">
                            </div>
                            
                            <div class="input-group">
                                <label>Confirm PIN</label>
                                <input type="password" id="pin-confirm" required maxlength="6" minlength="4" placeholder="Confirm PIN" autocomplete="off">
                            </div>

                            <button type="submit" class="btn-primary" style="width: auto;">
                                ${this.state.hasSecurityPin ? 'Update PIN' : 'Set PIN'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        `;

        content += `</div></div>`; // Close grid and card

        this.dom.contentArea.innerHTML = content;

        // Bind Events (setTimeout 0)
        // Bind Events (setTimeout 0)
        setTimeout(() => {
            // Profile Switch Logic
            document.querySelectorAll(".theme-switch-input").forEach(toggle => {
                toggle.addEventListener("change", () => {
                    const newTheme = toggle.checked ? "light" : "dark";
                    if (this.state.theme !== newTheme) {
                        this.setTheme(newTheme, true);
                        this.showToast(`Switched to ${newTheme} mode`, "success");
                    }
                });
            });

            // Currency
            const currencySelect = document.getElementById("settings-currency");
            if (currencySelect) {
                currencySelect.addEventListener("change", async (e) => {
                    const newCurrency = e.target.value;
                    try {
                        e.target.disabled = true;
                        if (role === "admin") {
                            await Auth.updateEnterprise({ currency: newCurrency });
                        } else {
                            await Auth.updateBranch(profile.id, { currency: newCurrency });
                        }

                        if (!this.state.currentProfile) this.state.currentProfile = {};
                        this.state.currentProfile.currency = newCurrency;
                        this.state.currentCurrency = newCurrency;
                        this.showToast(`Currency updated to ${newCurrency}`, "success");
                    } catch (err) {
                        console.error(err);
                        this.showToast("Failed to update currency", "error");
                        e.target.value = this.state.currentCurrency || "TZS";
                    } finally {
                        e.target.disabled = false;
                    }
                });
            }

            // Business Details form handler (Secure Edit)
            const bizForm = document.getElementById('biz-details-form');
            if (bizForm) {
                const editBtn = document.getElementById('biz-edit-btn');
                const saveBtn = document.getElementById('biz-save-btn');
                const inputs = bizForm.querySelectorAll('input');

                // Edit Button Handler
                editBtn.addEventListener('click', () => {
                    this.promptPinVerification(() => {
                        inputs.forEach(inp => inp.disabled = false);
                        editBtn.style.display = 'none';
                        saveBtn.style.display = 'inline-block';
                        inputs[0].focus();
                    });
                });

                bizForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const addr = document.getElementById('biz-address').value.trim();
                    const phone = document.getElementById('biz-phone').value.trim();
                    const email = document.getElementById('biz-email').value.trim();

                    saveBtn.textContent = 'Saving...';
                    saveBtn.disabled = true;
                    try {
                        if (role === 'admin') {
                            await Auth.updateEnterprise({ address: addr, phone, email });
                        } else {
                            await Auth.updateBranch(profile.id, { address: addr, phone, email });
                        }
                        // Sync state
                        if (this.state.currentProfile) {
                            this.state.currentProfile.address = addr;
                            this.state.currentProfile.phone = phone;
                            this.state.currentProfile.email = email;
                        }
                        this.showToast('Business details saved', 'success');

                        // Re-lock
                        inputs.forEach(inp => inp.disabled = true);
                        saveBtn.style.display = 'none';
                        editBtn.style.display = 'inline-block';
                    } catch (err) {
                        console.error(err);
                        this.showToast('Failed to save details', 'error');
                    } finally {
                        saveBtn.textContent = 'Save Details';
                        saveBtn.disabled = false;
                    }
                });
            }

            // Admin Logic
            if (role === "admin") {
                // AutoSave
                const nameInput = document.getElementById("settings-name");
                if (nameInput && window.AutoSave) {
                    AutoSave.attachToInput(nameInput, async () => {
                        const newName = nameInput.value.trim();
                        if (!newName) return;
                        await Auth.updateProfile({ full_name: newName });
                        this.state.currentProfile.full_name = newName;
                        if (this.dom.userName) this.dom.userName.textContent = newName;
                    }, { key: "profile-name", delay: 500, showIndicator: true });
                }

                // Profile Form
                const profileForm = document.getElementById("profile-form");
                if (profileForm) {
                    profileForm.addEventListener("submit", async (e) => {
                        e.preventDefault();
                        const name = document.getElementById("settings-name").value;
                        const btn = profileForm.querySelector("button");
                        try {
                            btn.textContent = "Saving...";
                            btn.disabled = true;
                            await Auth.updateProfile({ full_name: name });
                            this.state.currentProfile.full_name = name;
                            this.showToast("Profile updated!", "success");
                        } catch (err) {
                            this.showToast(err.message, "error");
                        } finally {
                            btn.textContent = "Save Changes";
                            btn.disabled = false;
                        }
                    });
                }

                // Password Form
                const secForm = document.getElementById("security-form");
                if (secForm) {
                    secForm.addEventListener("submit", async (e) => {
                        e.preventDefault();
                        const p1 = document.getElementById("sec-new-password").value;
                        const p2 = document.getElementById("sec-confirm-password").value;
                        if (p1 !== p2) {
                            this.showMessage("security-message", "Passwords do not match", "error");
                            return;
                        }
                        const btn = secForm.querySelector("button[type='submit']");
                        try {
                            btn.disabled = true;
                            btn.textContent = "Updating...";
                            await Auth.updatePassword(p1);
                            this.showMessage("security-message", "Password updated!", "success");
                            secForm.reset();
                            setTimeout(() => this.hideMessage("security-message"), 2000);

                            setTimeout(() => {
                                const pwdContent = document.getElementById("password-section-content");
                                const pwdHeader = document.getElementById("password-section-header");
                                if (pwdContent && pwdHeader) {
                                    pwdContent.classList.add("hidden");
                                    pwdHeader.querySelector("span:last-child").textContent = "?";
                                }
                            }, 3500);
                        } catch (err) {
                            this.showMessage("security-message", err.message, "error");
                        } finally {
                            btn.disabled = false;
                            btn.textContent = "Update Password";
                        }
                    });
                }

                const pwdHeader = document.getElementById("password-section-header");
                const pwdContent = document.getElementById("password-section-content");
                if (pwdHeader && pwdContent) {
                    pwdHeader.addEventListener("click", () => {
                        pwdContent.classList.toggle("hidden");
                        pwdHeader.querySelector("span:last-child").textContent = pwdContent.classList.contains("hidden") ? "?" : "?";
                        if (!pwdContent.classList.contains("hidden")) {
                            setTimeout(() => pwdContent.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
                        }
                    });
                }
            }

            // Shared Logic
            document.querySelectorAll(".password-toggle").forEach(toggleBtn => {
                toggleBtn.addEventListener("click", function () {
                    const targetId = this.getAttribute("data-target");
                    const passwordInput = document.getElementById(targetId);
                    const svg = this.querySelector("svg");
                    if (passwordInput.type === "password") {
                        passwordInput.type = "text";
                        svg.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`;
                    } else {
                        passwordInput.type = "password";
                        svg.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
                    }
                });
            });

            const pinHeader = document.getElementById("pin-section-header");
            const pinContent = document.getElementById("pin-section-content");
            if (pinHeader && pinContent) {
                pinHeader.addEventListener("click", () => {
                    pinContent.classList.toggle("hidden");
                    pinHeader.querySelector("span:last-child").textContent = pinContent.classList.contains("hidden") ? "?" : "?";
                    if (!pinContent.classList.contains("hidden")) {
                        setTimeout(() => pinContent.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
                    }
                });
            }

            const pinForm = document.getElementById("pin-form");
            if (pinForm) {
                pinForm.addEventListener("submit", async (e) => {
                    e.preventDefault();
                    this.hideMessage("pin-message");

                    const btn = pinForm.querySelector("button[type='submit']");
                    const oldPinInput = document.getElementById("pin-old");
                    const oldPin = oldPinInput ? oldPinInput.value : null;
                    const newPin = document.getElementById("pin-new").value;
                    const confirmPin = document.getElementById("pin-confirm").value;

                    if (newPin !== confirmPin) {
                        this.showMessage("pin-message", "PINs do not match!", "error");
                        return;
                    }

                    if (newPin.length < 4) {
                        this.showMessage("pin-message", "PIN must be 4-6 digits.", "error");
                        return;
                    }

                    try {
                        btn.textContent = "Saving...";
                        btn.disabled = true;

                        await Auth.setSecurityPin(newPin, oldPin);

                        this.state.hasSecurityPin = true;
                        this.showToast("Security PIN updated!", "success");

                        const badge = document.querySelector("#pin-section-header .badge");
                        if (badge) {
                            badge.className = "badge badge-success";
                            badge.textContent = "Active";
                        }

                        setTimeout(() => this.renderProfile(), 1000);

                    } catch (err) {
                        console.error(err);
                        this.showMessage("pin-message", err.message, "error");
                        btn.textContent = "Retry";
                        btn.disabled = false;
                    }
                });
            }
        }, 0);

    },

    resetState() {
        this.state.currentUser = null;
        this.state.currentProfile = null;
        this.state.history = ['home'];
        this.state.historyIndex = 0;
        this.state.currentCurrency = 'TZS'; // Default back
        // We keep 'theme' as it is device preference

        // Clear any specific local storage if needed
        // localStorage.removeItem('some-user-specific-key');
    },

    logout() {
        this.resetState();
        this.dom.authView.classList.remove('hidden');
        this.dom.dashboardShell.classList.add('hidden');
        document.body.classList.add('loaded');
        document.documentElement.classList.remove('app-mode'); // Reset fonts

        // Reset View State
        if (this.dom.contentArea) this.dom.contentArea.innerHTML = '';
        if (this.dom.sidebarNav) this.dom.sidebarNav.innerHTML = ''; // Clear dynamic sidebar
        if (this.dom.userName) this.dom.userName.textContent = '';
        if (this.dom.userRole) this.dom.userRole.textContent = '';

        // Hide nav buttons
        const navBar = document.getElementById('app-nav-bar');
        if (navBar) navBar.classList.add('hidden');

        // Cleanup Operations Dock
        const existingDock = document.getElementById('ops-dock');
        if (existingDock) existingDock.remove();

        // Clear URL (remove ?page=...) and set to auth
        const url = new URL(window.location);
        url.searchParams.set('page', 'auth');
        window.history.replaceState(null, '', url);

        // Auto-refresh to clear console/state
        localStorage.removeItem('bms-theme');
        window.location.reload();
    },

    renderHome() {
        const profile = this.state.currentProfile;
        if (profile?.role === 'enterprise_admin') {
            this.dom.contentArea.innerHTML = `
                <div class="welcome-card card page-enter" onclick="event.stopPropagation(); this.classList.toggle('expanded')" style="animation-delay: 0.05s; margin-bottom: 2rem; cursor: pointer; transition: all 0.3s ease;">
                    <div class="card-header" style="border-bottom: none; padding-bottom: 0;">
                        <h3 class="card-title">Welcome back, ${profile.full_name || 'Admin'}!</h3>
                        <span class="hint-text mobile-hint" style="font-size: 0.7rem; color: var(--text-muted); float: right;">Click for Options</span>
                        <span class="hint-text desktop-hint" style="font-size: 0.7rem; color: var(--text-muted); float: right;">Hover Me</span>
                    </div>
                    <div class="welcome-content" style="overflow: hidden; max-height: 0; transition: max-height 0.4s ease-out;">
                        <p style="color: var(--text-muted); margin-bottom: 1.5rem; margin-top: 1rem; padding: 0 1.5rem;">
                            Manage your enterprise branches and staff from this dashboard. 
                            Create new branches, monitor performance, and oversee operations.
                        </p>
                        <div class="flex gap-2" style="padding: 0 1.5rem 1.5rem 1.5rem;">
                            <button class="btn-primary" onclick="event.stopPropagation(); app.loadPage('branches')">
                                View Branches →
                            </button>
                            <button class="btn-ghost" onclick="event.stopPropagation(); if(window.Dashboard) { window.Dashboard.openCreateBranchModal(); } else { console.error('Dashboard module not loaded'); }">
                                + New Branch
                            </button>
                        </div>
                    </div>
                </div>

    <div class="stats-grid page-enter">
        <div class="stat-card">
            <div class="stat-label">Total Branches</div>
            <div class="stat-value" id="stat-branches">--</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Active Managers</div>
            <div class="stat-value" id="stat-managers">--</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">This Month</div>
            <div class="stat-value">${this.formatStatValue(0)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Growth</div>
            <div class="stat-value">+0%</div>
        </div>
    </div>

`;
        } else {
            this.dom.contentArea.innerHTML = `
                <div class="card page-enter">
                    <div class="card-header">
                        <h3 class="card-title">Branch Dashboard</h3>
                    </div>
                    <p style="color: var(--text-muted);">Welcome to <strong style="color: var(--text-main);">${profile?.full_name || 'your branch'}</strong>.</p>
                    <p style="color: var(--text-muted);">Access your tasks and sales using the sidebar navigation.</p>
                </div>
            `;
        }
    },

    renderDashboard() { // Line ~1216
        this.dom.authView.classList.add('hidden');
        this.dom.dashboardShell.classList.remove('hidden');
        document.body.classList.add('loaded');
        document.documentElement.classList.add('app-mode'); // Enable larger fonts

        const profile = this.state.currentProfile;

        // Render Sidebar based on role
        this.renderSidebar();

        // Ensure sidebar is closed on mobile by default
        if (window.innerWidth <= 768 && this.dom.sidebar) {
            this.dom.sidebar.classList.remove('open');
            this.dom.sidebarOverlay?.classList.remove('active');
        }

        // Missing Profile Handling
        if (!profile) {
            this.dom.contentArea.innerHTML = `
                <div class="card page-enter" style="max-width: 500px; margin: 2rem auto;">
                    <div class="card-header">
                        <h3 class="card-title">Complete Your Setup</h3>
                    </div>
                    <div id="setup-message" class="message-box hidden"></div>
                    <form id="setup-form" class="auth-form">
                        <p style="color: var(--text-muted);">Please finalize your account details.</p>
                        <div class="input-group">
                            <label>Your Name</label>
                            <input type="text" id="setup-admin-name" required placeholder="John Doe">
                        </div>
                        <div class="input-group">
                            <label>Enterprise Name</label>
                            <input type="text" id="setup-name" required placeholder="My Business Name">
                        </div>
                        <button type="submit" class="btn-primary">Finalize Setup →</button>
                    </form>
                </div>
            `;

            setTimeout(() => {
                const setupForm = document.getElementById('setup-form');
                if (setupForm) {
                    setupForm.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const adminName = document.getElementById('setup-admin-name').value;
                        const enterpriseName = document.getElementById('setup-name').value;
                        const btn = e.target.querySelector('button');
                        try {
                            btn.textContent = 'Saving...';
                            btn.disabled = true;
                            await Auth.completeEnterpriseSetup(enterpriseName, adminName);
                            this.showToast('Setup Complete!', 'success');
                            window.location.reload();
                        } catch (err) {
                            this.showMessage('setup-message', err.message, 'error');
                            btn.textContent = 'Finalize Setup →';
                            btn.disabled = false;
                        }
                    });
                }
            }, 0);
            return;
        }

        if (this.dom.userName) this.dom.userName.textContent = profile.full_name || 'User';
        if (this.dom.userRole) this.dom.userRole.textContent = profile.role === 'enterprise_admin' ? 'Enterprise Admin' : 'Branch Manager';

        // Initial Routing based on URL or Default
        // Remove hash handling for now to simplify
        // const initialPage = window.location.hash.slice(1) || 'home';

        // Wait for Auth to complete before routing
        // Initialize Dashboard Logic (Stats, etc)
        this.initDashboardModule();

        // Ensure stat fonts are correct on initial render
        setTimeout(() => this.adjustStatFontSizes(), 200);

        // Listen for history popstate
        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.page) {
                this.loadPage(e.state.page, false);
            }
        });
    },

    // Initialize Dashboard Module
    // This part was moved from the original renderDashboard to be called after profile is loaded
    // and before rendering the specific dashboard content.
    initDashboardModule() {
        const profile = this.state.currentProfile;
        if (Dashboard) {
            Dashboard.init();

            // Detect initial page from URL or default to home
            const rolePrefix = this.getRolePrefix(profile);
            const urlPage = new URLSearchParams(window.location.search).get('page');
            const parsed = this.parseRoleUrlPage(urlPage);
            let initialPage;
            let normalizedUrlPage;

            if (parsed) {
                if (parsed.prefix !== rolePrefix) {
                    initialPage = 'home';
                    normalizedUrlPage = this.toRoleUrlPage(rolePrefix, 'home');
                } else {
                    initialPage = parsed.page || 'home';
                    normalizedUrlPage = this.toRoleUrlPage(rolePrefix, initialPage);
                }
            } else {
                initialPage = urlPage || 'home';
                normalizedUrlPage = this.toRoleUrlPage(rolePrefix, initialPage);
            }

            if (normalizedUrlPage && normalizedUrlPage !== urlPage) {
                window.history.replaceState({ page: initialPage }, '', `?page=${normalizedUrlPage}`);
            }

            // Standardize routing: ALWAYS use loadPage to ensure title, sidebar, and history sync
            this.loadPage(initialPage, true, true, true);
        }
    }
};

// Expose to window for inline calls
window.app = app;

// Initialize
document.addEventListener('DOMContentLoaded', () => app.init());
