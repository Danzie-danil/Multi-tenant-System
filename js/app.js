

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
        activeModal: null
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
        const container = document.getElementById('toast-container');
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

    async init() {
        console.log('BMS Initializing...');
        this.initTheme(); // Load saved theme preference
        this.cacheDOM();
        this.bindEvents();

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
                window.history.replaceState({ page: 'home' }, '', '?page=home');

                this.renderDashboard();
            } else {
                // Show auth view if not logged in
                if (this.dom.authView) {
                    this.dom.authView.style.display = '';
                    this.dom.authView.classList.remove('hidden');
                }
                document.body.classList.add('loaded');
            }
        } catch (error) {
            console.error('Auth Init Error:', error);
            // Show auth view on error
            if (this.dom.authView) {
                this.dom.authView.style.display = '';
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
                btn.textContent = 'Signing in...';
                btn.disabled = true;
                this.hideMessage('auth-message');

                const { user, profile } = await Auth.login(email, password);

                this.state.currentUser = user;
                this.state.currentProfile = profile;
                await this.loadSettingsFromData(); // Apply user's saved theme
                this.showToast('Login successful!', 'success');
                this.renderDashboard();
            } catch (error) {
                console.error(error);
                this.showMessage('auth-message', error.message, 'error');
            } finally {
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
                btn.textContent = 'Verifying...';
                btn.disabled = true;
                this.hideMessage('auth-message');

                const { id, name, enterprise_id, api_token, role } = await Auth.loginBranch(loginId, password);

                this.state.currentUser = { id: id, role: 'branch_manager' }; // Mock user object
                this.state.currentProfile = Auth.profile;

                await this.loadSettingsFromData();
                this.showToast(`Welcome back, ${name}!`, 'success');
                this.renderDashboard();
            } catch (error) {
                console.error(error);
                // Friendly error for branches
                const message = "Invalid ID or Password. Please contact your admin for a new password.";
                this.showMessage('auth-message', message, 'error');
            } finally {
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

    loadPage(page, isTopLevel = false, skipHistory = false, skipBrowserPush = false) {
        const profile = this.state.currentProfile;
        const role = profile?.role === 'enterprise_admin' ? 'admin' : 'branch';

        // Browser History Integration
        if (!skipBrowserPush) {
            const url = `?page=${page}`;
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
            <div class="stat-value">${this.formatCurrency(0)}</div>
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
            const initialPage = new URLSearchParams(window.location.search).get('page') || 'home';

            // Standardize routing: ALWAYS use loadPage to ensure title, sidebar, and history sync
            this.loadPage(initialPage, true, true, true);
        }
    }
};

// Expose to window for inline calls
window.app = app;

// Initialize
document.addEventListener('DOMContentLoaded', () => app.init());
