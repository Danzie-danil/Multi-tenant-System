
import { supabase, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';
import { Auth } from './auth.js';

export const Dashboard = {
    init() {
        console.log('Dashboard Module Initialized');
        this.cacheDOM();
        this.bindEvents();
    },

    cacheDOM() {
        this.dom = {
            createBranchBtn: document.getElementById('create-branch-btn'),
            branchModal: document.getElementById('branch-modal'),
            createBranchForm: document.getElementById('create-branch-form'),
            contentArea: document.getElementById('content-area'),
            branchNameInput: document.getElementById('branch-name'),
            branchLoginIdInput: document.getElementById('branch-login-id'),
            entNameDisplay: document.getElementById('ent-name-display')
        };
        console.log('Dashboard DOM Cached:', this.dom);
    },

    bindEvents() {
        if (this.dom.createBranchBtn) {
            this.dom.createBranchBtn.addEventListener('click', () => {
                this.openCreateBranchModal();
            });
        }

        if (this.dom.createBranchForm) {
            this.dom.createBranchForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleCreateBranch();
            });
        }

        // Auto-generate Login ID when Branch Name changes (Delegated)
        document.addEventListener('input', (e) => {
            if (e.target && e.target.id === 'branch-name') {
                this.updateBranchLoginId(e.target.value);
            }
        });

        // Global click listener to close dropdowns
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown')) {
                document.querySelectorAll('.dropdown.open').forEach(d => {
                    d.classList.remove('open');
                });
            }
        });
        console.log('Branch Name Input and Dropdown listeners attached');
    },

    toggleDropdown(e, dropdownId) {
        e.stopPropagation();
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;

        // Close all other dropdowns
        document.querySelectorAll('.dropdown').forEach(d => {
            if (d.id !== dropdownId) d.classList.remove('open');
        });

        dropdown.classList.toggle('open');
    },

    toggleResetPasswordVisibility() {
        const pwdInput = document.getElementById('reset-branch-new-password');
        const btn = document.getElementById('toggle-reset-password');
        if (!pwdInput || !btn) return;

        if (pwdInput.type === 'password') {
            pwdInput.type = 'text';
            btn.textContent = 'Hide';
        } else {
            pwdInput.type = 'password';
            btn.textContent = 'Show';
        }
    },

    async copyResetPassword() {
        const pwdInput = document.getElementById('reset-branch-new-password');
        const btn = document.getElementById('copy-reset-password-btn');
        if (!pwdInput || !btn || !pwdInput.value) return;

        try {
            await navigator.clipboard.writeText(pwdInput.value);
            const originalIcon = btn.innerHTML;
            btn.innerHTML = '<span style="font-size: 0.75rem; color: var(--success); font-weight: 600;">COPIED</span>';

            // Pulse animation for success
            btn.style.transform = 'scale(1.1)';
            btn.style.borderColor = 'var(--success)';

            setTimeout(() => {
                btn.innerHTML = originalIcon;
                btn.style.transform = 'scale(1)';
                btn.style.borderColor = 'var(--border)';
            }, 1000); // Sensible duration for visual confirmation
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    },

    copyBranchDetails(branchId, btn) {
        const b = this.branches?.find(b => b.id === branchId);
        if (!b) return;

        const text = [
            `Name: ${b.name}`,
            `Login ID: ${b.branch_login_id}`,
            `Location: ${b.location || '-'}`,
            `Created: ${new Date(b.created_at).toLocaleDateString()}`
        ].join('\n');

        this._performCopy(text, btn);
    },

    copyAllBranchDetails(btn) {
        if (!this.branches || this.branches.length === 0) return;

        const text = this.branches.map(b => [
            `Name: ${b.name}`,
            `Login ID: ${b.branch_login_id}`,
            `Location: ${b.location || '-'}`,
            `Created: ${new Date(b.created_at).toLocaleDateString()}`
        ].join('\n')).join('\n\n---\n\n');

        this._performCopy(text, btn);
    },

    async _performCopy(text, btn) {
        try {
            await navigator.clipboard.writeText(text);
            const originalIcon = btn.innerHTML;
            btn.innerHTML = '<span style="font-size: 0.7rem; color: var(--success); font-weight: 700;">COPIED</span>';
            const oldWidth = btn.style.width;
            btn.style.width = 'auto';
            btn.style.padding = '0 0.5rem';

            setTimeout(() => {
                btn.innerHTML = originalIcon;
                btn.style.width = oldWidth;
                btn.style.padding = '';
            }, 1000);
        } catch (err) {
            console.error('Copy failed:', err);
            app.showToast('Failed to copy', 'error');
        }
    },

    copySuccessDetail(targetId, btn) {
        const el = document.getElementById(targetId);
        if (!el) return;

        navigator.clipboard.writeText(el.textContent);
        const originalIcon = btn.innerHTML;
        btn.innerHTML = '<span style="font-size: 0.75rem; color: var(--success); font-weight: 700;">COPIED</span>';
        btn.style.width = 'auto';
        btn.style.padding = '0 0.5rem';

        setTimeout(() => {
            btn.innerHTML = originalIcon;
            btn.style.width = '';
            btn.style.padding = '';
        }, 1000);
    },

    generateBranchPassword() {
        const num = String(this.nextBranchNumber || 1).padStart(3, '0');

        // Generate 4 random mixed case letters
        const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let randomLetters = '';
        for (let i = 0; i < 4; i++) {
            randomLetters += letters.charAt(Math.floor(Math.random() * letters.length));
        }

        // Generate 4 random digits
        const randomDigits = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

        // Format: 001-AbCd-1234
        return `${num}-${randomLetters}-${randomDigits}`;
    },

    updateBranchLoginId(name) {
        // Get first letter initials of each word
        const words = name.trim().split(/\s+/);
        const initials = words.map(w => w.charAt(0).toUpperCase()).join('');

        // Use the stored next branch number
        const num = String(this.nextBranchNumber || 1).padStart(3, '0');

        // Robust Lookup (Force fresh query)
        const input = document.getElementById('branch-login-id');
        const loginId = `BR-NO-${num}-${initials}`;

        if (input) {
            console.log(`[Dashboard] Updating Branch ID to: ${loginId}`);
            input.value = loginId;
        } else {
            console.error('[Dashboard] Branch Login ID Input NOT FOUND');
        }

        // Also auto-generate password
        const passwordInput = document.getElementById('branch-password');
        if (passwordInput && !passwordInput.dataset.userEdited) {
            passwordInput.value = this.generateBranchPassword();
        }
    },

    async openCreateBranchModal() {
        this.dom.branchModal.classList.remove('hidden');
        this.dom.branchNameInput.focus();
        // Clear any previous messages
        app.hideMessage('branch-modal-message');

        // Fetch NEXT persistent branch number
        try {
            const enterpriseId = app.state.currentProfile?.enterprise_id;
            if (enterpriseId) {
                // Use RPC to get the safe, persistent sequence number
                this.nextBranchNumber = await Auth.getNextBranchNumber(enterpriseId);
            } else {
                this.nextBranchNumber = 1;
            }
        } catch (e) {
            console.error('Error fetching branch number:', e);
            // Fallback: If RPC fails (e.g. migration not run), try to be safe or default to 1?
            // Default 1 might cause collision, so user really needs to run migration.
            this.nextBranchNumber = 1;
        }

        // Update the login ID if name is already entered
        if (this.dom.branchNameInput.value) {
            this.updateBranchLoginId(this.dom.branchNameInput.value);
        }
    },

    async handleCreateBranch() {
        const name = this.dom.branchNameInput.value.toUpperCase();
        const location = document.getElementById('branch-location').value;
        const loginId = this.dom.branchLoginIdInput.value;
        const password = document.getElementById('branch-password').value;
        const btn = this.dom.createBranchForm.querySelector('button[type="submit"]');

        try {
            btn.textContent = 'Creating...';
            btn.disabled = true;
            app.hideMessage('branch-modal-message');

            // 1. Create Branch Account (RPC)
            const enterpriseId = app.state.currentProfile.enterprise_id;

            const branchData = await Auth.createBranchAccount(
                enterpriseId,
                name,
                loginId,
                password,
                location
            );

            // Log for debugging
            console.log('Branch created:', branchData);

            // Success - Close modal and show success modal
            this.dom.branchModal.classList.add('hidden');
            this.dom.createBranchForm.reset();

            // Populate and show success modal
            document.getElementById('success-login-id').textContent = loginId;
            document.getElementById('success-password').textContent = password;
            app.openModal('branch-success-modal');

            app.showToast(`Branch "${name}" created successfully!`, 'success');
            this.loadBranches(); // Refresh list

        } catch (error) {
            console.error(error);
            app.showMessage('branch-modal-message', error.message, 'error');
        } finally {
            btn.textContent = 'Create Branch';
            btn.disabled = false;
        }
    },

    async loadBranches() {
        if (!app.state.currentProfile?.enterprise_id) return;

        this.dom.contentArea.innerHTML = '<p>Loading branches...</p>';

        const { data: branches, error } = await supabase
            .from('branches')
            .select('*')
            .eq('enterprise_id', app.state.currentProfile.enterprise_id)
            .order('created_at', { ascending: false });

        this.branches = branches || []; // Store locally for copy functions

        if (error) {
            this.dom.contentArea.innerHTML = `<p style="color: var(--danger);">Error loading branches: ${error.message}</p>`;
            return;
        }

        if (branches.length === 0) {
            this.dom.contentArea.innerHTML = `
                <div class="card" style="text-align: center; padding: 3rem;">
                    <h3>No Branches Yet</h3>
                    <p style="color: var(--text-muted);">Create your first branch to get started.</p>
                    <button class="btn-primary" style="margin-top: 1rem;" onclick="Dashboard.openCreateBranchModal()">+ Create Branch</button>
                </div>
            `;
            return;
        }

        // Render Table
        const html = `
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">My Branches (${branches.length})</h3>
                    <button class="btn-primary" style="padding: 0.5rem 1rem; font-size: 0.85rem;" onclick="Dashboard.openCreateBranchModal()">
                        + New Branch
                    </button>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Login ID</th>
                                <th>Location</th>
                                <th>Created</th>
                                <th style="display: flex; align-items: center; gap: 0.5rem; justify-content: flex-end;">
                                    ACTIONS 
                                    <button class="btn-icon" style="width: 28px; height: 28px; font-size: 0.8rem;" onclick="Dashboard.copyAllBranchDetails(this)" title="Copy All Branch Details">📋</button>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            ${branches.map(b => `
                                <tr>
                                    <td data-label="Name"><strong>${b.name}</strong></td>
                                    <td data-label="Login ID"><code>${b.branch_login_id}</code></td>
                                    <td data-label="Location">${b.location || '-'}</td>
                                    <td data-label="Created">${new Date(b.created_at).toLocaleDateString()}</td>
                                    <td data-label="Actions" style="text-align: right;">
                                        <div class="dropdown" id="actions-${b.id}">
                                            <button class="btn-ghost" style="padding: 0.4rem 1rem; border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem; margin-left: auto;" 
                                                onclick="Dashboard.toggleDropdown(event, 'actions-${b.id}')">
                                                View
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                            </button>
                                            <div class="dropdown-menu dropdown-menu-left premium-dropdown">
                                                <div class="premium-item" title="Reset Password" 
                                                    onclick="Dashboard.openResetPasswordModal('${b.id}', '${b.name.replace(/'/g, "\\'")}', '${b.branch_login_id}')">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                                    <span>Reset Pass</span>
                                                </div>
                                                <div class="premium-item" title="Copy Details" onclick="Dashboard.copyBranchDetails('${b.id}', this)">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
                                                    <span>Copy Details</span>
                                                </div>
                                                <div class="premium-item" title="Delete Branch" style="color: var(--danger) !important;"
                                                    onclick="Dashboard.openDeleteBranchModal('${b.id}', '${b.name.replace(/'/g, "\\'")}')">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                                                    <span>Delete</span>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <!-- Reset Password Modal (Injected here or handled globally) -->
            <div id="reset-branch-password-modal" class="modal-overlay hidden">
                <div class="modal-content">
                    <h3>Reset Branch Password</h3>
                    <p style="color: var(--text-muted); margin-bottom: 0.5rem;">
                        Resetting password for <strong id="reset-branch-name"></strong>.
                    </p>
                    <p style="font-size: 0.85rem; color: var(--text-dim); margin-bottom: 1rem;">
                        Login ID: <code id="reset-branch-login-id-display"></code>
                    </p>
                    <div id="reset-branch-message" class="message-box hidden"></div>
                    <form id="reset-branch-form">
                        <input type="hidden" id="reset-branch-id">
                        <div class="input-group">
                            <label>New Password</label>
                            <div style="display: flex; gap: 0.5rem; align-items: center;">
                                <div style="position: relative; flex: 1; display: flex; align-items: center;">
                                    <input type="password" id="reset-branch-new-password" required minlength="6" placeholder="Enter new password" style="width: 100%; padding-right: 3.5rem;">
                                    <button type="button" id="toggle-reset-password" class="btn-ghost" style="position: absolute; right: 0.5rem; padding: 0.25rem 0.5rem; font-size: 0.75rem; height: auto;" onclick="Dashboard.toggleResetPasswordVisibility()">
                                        Show
                                    </button>
                                </div>
                                <button type="button" id="copy-reset-password-btn" class="btn-ghost" style="padding: 0.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; min-width: 40px;" onclick="Dashboard.copyResetPassword()" title="Copy Password">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                                </button>
                            </div>
                            <small style="color: var(--text-muted);">Make sure to share this with the branch manager.</small>
                        </div>
                        <div class="flex gap-2 justify-end">
                            <button type="button" class="btn-ghost" onclick="app.closeModal('reset-branch-password-modal')">Cancel</button>
                            <button type="submit" class="btn-primary">Set Password</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        this.dom.contentArea.innerHTML = html;

        // Bind Reset Modal Logic
        setTimeout(() => {
            const resetForm = document.getElementById('reset-branch-form');
            if (resetForm) {
                resetForm.addEventListener('submit', (e) => this.handleResetPassword(e));
            }
        }, 0);
    },

    async openDeleteBranchModal(branchId, branchName) {
        // Reset Modal State
        const form = document.getElementById('verification-form');
        if (!form) return;
        form.reset();
        document.getElementById('verify-title').textContent = 'Delete Branch';
        document.getElementById('verify-message').textContent = `This action allows you to permanently delete "${branchName}". To confirm, please complete the security verification below.`;

        document.getElementById('verify-target-name').textContent = branchName;
        document.getElementById('verify-step-name').classList.remove('hidden');
        document.getElementById('verify-step-pin').classList.add('hidden');
        document.getElementById('verify-step-create-pin').classList.add('hidden');
        app.hideMessage('verify-feedback');

        const submitBtn = document.getElementById('verify-submit-btn');
        submitBtn.textContent = 'Verify Name';
        submitBtn.disabled = false;

        // Check if PIN exists
        let hasPin = false;
        try {
            hasPin = await Auth.hasSecurityPin();
        } catch (e) {
            console.error(e);
        }

        // Clone form to remove old listeners
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        // Bind Cancel Button (Fixing broken close)
        const cancelBtn = newForm.querySelector('button[data-close-modal], #verify-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                app.closeModal('verification-modal');
            });
        }

        // Bind Submit Handler
        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            this.handleSecureDeleteStep(e, branchId, branchName, hasPin);
        });

        app.openModal('verification-modal');
    },

    async handleSecureDeleteStep(e, branchId, branchName, hasPin) {
        const stepName = document.getElementById('verify-step-name');
        const stepPin = document.getElementById('verify-step-pin');
        const stepCreate = document.getElementById('verify-step-create-pin');
        const btn = document.getElementById('verify-submit-btn');

        // Step 1: Name Verification
        if (!stepName.classList.contains('hidden')) {
            const inputName = document.getElementById('verify-branch-name').value;
            if (inputName !== branchName) {
                app.showMessage('verify-feedback', 'Branch name does not match.', 'error');
                return;
            }

            // Proceed to Step 2 (Either Verify or Create)
            app.hideMessage('verify-feedback');
            stepName.classList.add('hidden');

            if (hasPin) {
                stepPin.classList.remove('hidden');
                btn.textContent = 'Verify PIN & Delete';
                setTimeout(() => document.getElementById('verify-pin').focus(), 100);
            } else {
                stepCreate.classList.remove('hidden');
                btn.textContent = 'Create PIN & Delete';
                setTimeout(() => document.getElementById('verify-create-pin').focus(), 100);
            }
            return;
        }

        // Step 2a: Existing PIN Verification & Execution
        if (!stepPin.classList.contains('hidden')) {
            const pin = document.getElementById('verify-pin').value;
            if (!pin || pin.length < 4) {
                app.showMessage('verify-feedback', 'Please enter a valid PIN.', 'error');
                return;
            }
            await this.executeDelete(branchId, pin, btn);
            return;
        }

        // Step 2b: Create PIN & Execution
        if (!stepCreate.classList.contains('hidden')) {
            const newPin = document.getElementById('verify-create-pin').value;
            const confirmPin = document.getElementById('verify-confirm-pin').value;

            if (newPin !== confirmPin) {
                app.showMessage('verify-feedback', 'PINs do not match.', 'error');
                return;
            }
            if (!/^\d{4,6}$/.test(newPin)) {
                app.showMessage('verify-feedback', 'PIN must be 4-6 digits.', 'error');
                return;
            }

            // Set PIN first
            try {
                btn.textContent = 'Setting PIN...';
                btn.disabled = true;
                await Auth.setSecurityPin(newPin, null);

                // Now Delete
                await this.executeDelete(branchId, newPin, btn);
            } catch (error) {
                console.error(error);
                app.showMessage('verify-feedback', error.message, 'error');
                btn.textContent = 'Create PIN & Delete';
                btn.disabled = false;
            }
        }
    },

    async executeDelete(branchId, pin, btn) {
        try {
            btn.textContent = 'Deleting...';
            btn.disabled = true;
            app.hideMessage('verify-feedback');

            await Auth.deleteBranch(branchId, pin);

            app.showToast('Branch deleted successfully', 'success');
            app.closeModal('verification-modal');
            this.loadBranches();

            // Refresh global state if needed
            if (app.state.currentProfile.role === 'enterprise_admin') {
                app.state.hasSecurityPin = true;
            }
        } catch (error) {
            console.error(error);
            app.showMessage('verify-feedback', error.message, 'error');
            btn.textContent = 'Retry';
            btn.disabled = false;
        }
    },

    openResetPasswordModal(branchId, branchName, branchLoginId) {
        document.getElementById('reset-branch-id').value = branchId;
        document.getElementById('reset-branch-name').textContent = branchName;
        const loginDisplay = document.getElementById('reset-branch-login-id-display');
        if (loginDisplay) loginDisplay.textContent = branchLoginId;

        document.getElementById('reset-branch-new-password').value = '';
        app.hideMessage('reset-branch-message');
        app.openModal('reset-branch-password-modal');
    },

    async handleResetPassword(e) {
        e.preventDefault();
        const branchId = document.getElementById('reset-branch-id').value;
        const newPassword = document.getElementById('reset-branch-new-password').value;
        const btn = e.target.querySelector('button[type="submit"]');

        try {
            btn.textContent = 'Updating...';
            btn.disabled = true;
            app.hideMessage('reset-branch-message');

            await Auth.resetBranchPassword(branchId, newPassword);

            // Close the reset modal
            app.closeModal('reset-branch-password-modal');

            // Show details in success modal
            const loginId = document.getElementById('reset-branch-login-id-display')?.textContent || '-';
            document.getElementById('reset-success-login-id').textContent = loginId;
            document.getElementById('reset-success-password').textContent = newPassword;

            // Open the success modal
            app.openModal('reset-success-modal');
            app.showToast('Password reset successfully!', 'success');
        } catch (error) {
            console.error(error);
            app.showMessage('reset-branch-message', error.message, 'error');
        } finally {
            btn.textContent = 'Set Password';
            btn.disabled = false;
        }
    },

    async loadStats() {
        if (!app.state.currentProfile?.enterprise_id) return;

        // Ensure stats elements exist
        const branchesStat = document.getElementById('stat-branches');
        const managersStat = document.getElementById('stat-managers');
        if (!branchesStat) return; // Not on overview page

        try {
            const { count, error } = await supabase
                .from('branches')
                .select('*', { count: 'exact', head: true })
                .eq('enterprise_id', app.state.currentProfile.enterprise_id);

            if (!error) {
                const countText = (count || 0).toString();
                branchesStat.textContent = countText;
                if (managersStat) managersStat.textContent = countText; // 1 manager per branch usually
            } else {
                console.error('Error loading stats:', error);
            }
        } catch (e) {
            console.error('Error fetching stats:', e);
        }
    }
};

window.Dashboard = Dashboard;
