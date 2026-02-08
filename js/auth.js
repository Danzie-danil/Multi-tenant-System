import { supabase, updateSupabaseClient, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';

export const Auth = {
    user: null, // Enterprise User
    profile: null,
    branch: null, // Branch User
    isRecoveryMode: false,

    async init() {
        // 1. Check Enterprise Session
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            this.user = session.user;
            await this.loadProfile(this.user.id);
        }

        // 2. Check Branch Session (Token)
        const branchToken = localStorage.getItem('bms-branch-token');
        if (branchToken && !this.user) {
            // Configure client with token
            updateSupabaseClient({ 'x-branch-token': branchToken });

            // Validate token and get branch data
            const { data, error } = await supabase
                .from('branches')
                .select('*')
                .eq('api_token', branchToken)
                .single();

            if (data && !error) {
                this.branch = data;
                // Mock profile for branch user to work with existing UI
                this.profile = {
                    id: data.id,
                    full_name: data.name,
                    role: 'branch_manager',
                    enterprise_id: data.enterprise_id,
                    branch_id: data.id,
                    branch_login_id: data.branch_login_id,
                    theme: data.theme,
                    currency: data.currency
                };
            } else {
                // Invalid or expired token
                localStorage.removeItem('bms-branch-token');
                updateSupabaseClient({}); // Reset headers
            }
        }

        // Listen for auth changes (Enterprise)
        supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                this.isRecoveryMode = true;
                if (window.app && window.app.showPasswordUpdateForm) {
                    window.app.showPasswordUpdateForm();
                }
                return;
            }

            if (session) {
                this.user = session.user;
                this.branch = null; // Clear branch session if enterprise logs in
                localStorage.removeItem('bms-branch-token');
                if (!this.profile || this.profile.role === 'branch_manager') await this.loadProfile(this.user.id);
            } else if (!this.branch) {
                // Only clear if not in branch mode
                this.user = null;
                this.profile = null;
            }
        });

        if (this.user) return this.user;
        if (this.branch) return { id: this.branch.id, role: 'branch_manager' };
        return null;
    },

    async loginBranch(loginId, password) {
        const { data, error } = await supabase.rpc('login_branch', {
            p_login_id: loginId,
            p_password: password
        });

        if (error) throw error;
        if (!data) throw new Error('Invalid Branch ID or Password');

        // Persist session first to allow RLS access
        localStorage.setItem('bms-branch-token', data.api_token);
        updateSupabaseClient({ 'x-branch-token': data.api_token });

        // Fetch FULL branch details (RPC missing some fields like branch_login_id, theme)
        const { data: fullBranch, error: fetchError } = await supabase
            .from('branches')
            .select('*')
            .eq('id', data.id)
            .single();

        if (fetchError || !fullBranch) {
            // Fallback to partial data if fetch fails
            this.branch = data;
            this.profile = {
                id: data.id,
                full_name: data.name,
                role: 'branch_manager',
                enterprise_id: data.enterprise_id,
                branch_id: data.id,
                branch_login_id: loginId, // Fallback to input
                theme: 'light',
                currency: 'TZS'
            };
        } else {
            this.branch = fullBranch;
            this.profile = {
                id: fullBranch.id,
                full_name: fullBranch.name,
                role: 'branch_manager',
                enterprise_id: fullBranch.enterprise_id,
                branch_id: fullBranch.id,
                branch_login_id: fullBranch.branch_login_id,
                theme: fullBranch.theme,
                currency: fullBranch.currency
            };
        }

        return this.branch;
    },

    async createBranchAccount(enterpriseId, name, loginId, password, location) {
        const { data, error } = await supabase.rpc('create_branch_account', {
            p_enterprise_id: enterpriseId,
            p_name: name,
            p_login_id: loginId,
            p_password: password,
            p_location: location
        });

        if (error) throw error;
        return data;
    },

    async getNextBranchNumber(enterpriseId) {
        const { data, error } = await supabase.rpc('get_next_branch_number', {
            p_enterprise_id: enterpriseId
        });
        if (error) throw error;
        return data;
    },

    async logout() {
        if (this.user) {
            await supabase.auth.signOut();
        }

        // Clear Branch Session
        this.branch = null;
        this.profile = null;
        localStorage.removeItem('bms-branch-token');
        updateSupabaseClient({}); // Reset headers

        // Show auth view before page may reload
        const authView = document.getElementById('auth-view');
        if (authView) {
            authView.style.display = '';
            authView.classList.remove('hidden');
        }

        return true;
    },

    async updatePassword(newPassword) {
        if (this.branch) throw new Error("Not supported for branches yet");
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        this.isRecoveryMode = false;
        return true;
    },

    async loadProfile(userId) {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (!error && data) {
            this.profile = data;
        }
        return data;
    },

    async registerEnterprise(email, password, businessName) {
        // 1. SignUp
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password
        });
        if (authError) throw authError;

        if (!authData.user) throw new Error("Registration failed.");

        // Check if session is missing (Email Confirmation enabled)
        if (authData.user && !authData.session) {
            return { user: authData.user, confirmationRequired: true };
        }

        // Insert into Enterprises
        const { data: entData, error: entError } = await supabase
            .from('enterprises')
            .insert([{
                owner_id: authData.user.id,
                name: businessName
            }])
            .select()
            .single();

        if (entError) throw entError;

        // Insert into Profiles
        const { error: profError } = await supabase
            .from('profiles')
            .insert([{
                id: authData.user.id,
                role: 'enterprise_admin',
                enterprise_id: entData.id,
                full_name: 'Admin'
            }]);

        if (profError) throw profError;

        return { user: authData.user, enterprise: entData };
    },

    async login(identifier, password) {
        // Standard Email Login
        const { data, error } = await supabase.auth.signInWithPassword({
            email: identifier,
            password
        });

        if (error) throw error;

        await this.loadProfile(data.user.id);
        return { user: data.user, profile: this.profile };
    },

    async sendPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin,
        });
        if (error) throw error;
        return true;
    },

    async updateProfile(updates) {
        if (this.branch) throw new Error("Profile updates not supported for branches yet");
        if (!this.user) throw new Error("Not logged in");

        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', this.user.id)
            .select()
            .single();

        if (error) throw error;
        this.profile = data;
        return data;
    },

    async updateEnterprise(updates) {
        if (!this.profile?.enterprise_id) throw new Error("No Enterprise ID found");

        const { data, error } = await supabase
            .from('enterprises')
            .update(updates)
            .eq('id', this.profile.enterprise_id)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async updateBranch(branchId, updates) {
        // Use RPC for updating settings to handle custom auth
        const { data, error } = await supabase.rpc('update_branch_settings', {
            p_branch_id: branchId,
            p_currency: updates.currency || null,
            p_theme: updates.theme || null
        });

        if (error) throw error;
        // RPC returns the updated row as a single object (data is the row)
        // Ensure data is structured correctly if it's nested
        this.branch = { ...this.branch, ...data }; // Update local state

        // CRITICAL: Also update the mock profile used by the UI
        if (this.profile && this.profile.id === branchId) {
            this.profile.theme = data.theme;
            this.profile.currency = data.currency;
        }

        return data;
    },

    async resetBranchPassword(branchId, newPassword) {
        if (!this.profile?.enterprise_id) throw new Error("No Enterprise ID found");

        const { data, error } = await supabase.rpc('reset_branch_password', {
            p_branch_id: branchId,
            p_new_password: newPassword,
            p_enterprise_id: this.profile.enterprise_id
        });

        if (error) throw error;
        return data;
    },

    async deleteBranch(branchId, pin) {
        if (!this.profile?.enterprise_id) throw new Error("No Enterprise ID found");

        const { error } = await supabase.rpc('delete_branch', {
            p_branch_id: branchId,
            p_enterprise_id: this.profile.enterprise_id,
            p_pin: pin
        });

        if (error) throw error;
        return true;
    },

    async setSecurityPin(newPin, oldPin = null) {
        const { error } = await supabase.rpc('set_security_pin', {
            p_new_pin: newPin,
            p_old_pin: oldPin
        });
        if (error) throw error;
        return true;
    },

    async verifySecurityPin(pin) {
        const { data, error } = await supabase.rpc('verify_security_pin', {
            p_pin: pin
        });
        if (error) throw error;
        return data; // true/false
    },

    async hasSecurityPin() {
        if (!this.profile?.enterprise_id) return false;

        const { data, error } = await supabase
            .from('enterprises')
            .select('security_pin_hash')
            .eq('id', this.profile.enterprise_id)
            .single();

        if (error) return false;
        return !!data.security_pin_hash;
    },

    // NEW: Recovery/Completion function
    async completeEnterpriseSetup(businessName, adminName = 'Admin') {
        const user = (await supabase.auth.getUser()).data.user;
        if (!user) throw new Error("Not logged in");

        // Insert into Enterprises
        const { data: entData, error: entError } = await supabase
            .from('enterprises')
            .insert([{
                owner_id: user.id,
                name: businessName
            }])
            .select()
            .single();

        if (entError) throw entError;

        // Insert into Profiles
        const { error: profError } = await supabase
            .from('profiles')
            .insert([{
                id: user.id,
                role: 'enterprise_admin',
                enterprise_id: entData.id,
                full_name: adminName
            }]);

        if (profError) throw profError;

        await this.loadProfile(user.id);
        return entData;
    },

    // Legacy helper
    getBranchEmail(branchLoginId) {
        return `${branchLoginId}@bms.local`;
    }
};
