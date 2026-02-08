
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

        // Auto-generate Login ID when Branch Name changes
        if (this.dom.branchNameInput) {
            ['input', 'keyup', 'change'].forEach(evt => {
                this.dom.branchNameInput.addEventListener(evt, (e) => {
                    this.updateBranchLoginId(e.target.value);
                });
            });
            console.log('Branch Name Input listeners attached');
        } else {
            console.error('Branch Name Input NOT found during bindEvents');
        }
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

        // Format: BR-NO-001-INITIALS
        this.dom.branchLoginIdInput.value = `BR-NO-${num}-${initials}`;

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
        const name = this.dom.branchNameInput.value;
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
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Login ID</th>
                                <th>Location</th>
                                <th>Created</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${branches.map(b => `
                                <tr>
                                    <td data-label="Name"><strong>${b.name}</strong></td>
                                    <td data-label="Login ID"><code>${b.branch_login_id}</code></td>
                                    <td data-label="Location">${b.location || '-'}</td>
                                    <td data-label="Created">${new Date(b.created_at).toLocaleDateString()}</td>
                                    <td data-label="Action">
                                        <button class="btn-ghost" style="padding: 0.2rem 0.6rem; font-size: 0.8rem;" 
                                            onclick="Dashboard.openResetPasswordModal('${b.id}', '${b.name.replace(/'/g, "\\'")}')">
                                            Reset Pass
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <!-- Reset Password Modal (Injected here or handled globally) -->
            <div id="reset-branch-password-modal" class="modal hidden">
                <div class="modal-content">
                    <h3>Reset Branch Password</h3>
                    <p style="color: var(--text-muted); margin-bottom: 1rem;">
                        Set a new password for <strong id="reset-branch-name"></strong>.
                    </p>
                    <div id="reset-branch-message" class="message-box hidden"></div>
                    <form id="reset-branch-form">
                        <input type="hidden" id="reset-branch-id">
                        <div class="input-group">
                            <label>New Password</label>
                            <input type="text" id="reset-branch-new-password" required minlength="6" placeholder="Enter new password">
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

    openResetPasswordModal(branchId, branchName) {
        document.getElementById('reset-branch-id').value = branchId;
        document.getElementById('reset-branch-name').textContent = branchName;
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

            app.showToast('Password reset successfully!', 'success');
            app.closeModal('reset-branch-password-modal');
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
