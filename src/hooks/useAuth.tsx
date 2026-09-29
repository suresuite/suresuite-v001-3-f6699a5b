// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { mintAndVerifySession } from '@/lib/auth/sessionMint';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  organization: string;
  display_name?: string | null;
  /** A token of `AVATAR_COLORS`; the image upload is retired (D206). */
  avatar_color?: string | null;
  phone?: string | null;
  is_active?: boolean;
  force_password_change?: boolean;
  password_expires_at?: string | null;
  password_changed_at?: string | null;
  /** Computed on the database clock when the row was read (D206). */
  password_expired?: boolean;
  /** The policy, `password_max_age()`, in days (D206). */
  password_max_age_days?: number | null;
}

/**
 * The account row's fields as `get_my_profile` returns them. The user is NAMED: the
 * browser calls as `anon`, and the GUC `set_current_user_context` sets is LOCAL to its
 * own request, so a call that named nobody resolved nobody and raised
 * `not_authenticated` for everyone — which is how forced and expired password changes
 * went unenforced (PLAN.md §4 D206).
 */
async function readProfile(userId: string) {
  const { data, error } = await supabase.rpc('get_my_profile', { p_user_id: userId });
  if (error) return { profile: null, error };
  const p = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!p) return { profile: null, error: { message: 'no account row' } };
  return {
    profile: {
      name: p.name as string | null,
      role: p.role as string | null,
      organization: p.organization as string | null,
      display_name: p.display_name as string | null,
      avatar_color: p.avatar_color as string | null,
      phone: p.phone as string | null,
      is_active: p.is_active as boolean,
      force_password_change: p.force_password_change as boolean,
      password_expires_at: p.password_expires_at as string | null,
      password_changed_at: p.password_changed_at as string | null,
      password_expired: p.password_expired as boolean,
      password_max_age_days: p.password_max_age_days as number | null,
    },
    error: null,
  };
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(() => {
    console.log('[AUTH] Initializing from localStorage');
    try {
      const stored = localStorage.getItem('auth_user');
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('[AUTH] Failed to parse stored user on init:', error);
      localStorage.removeItem('auth_user');
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  const login = async (email: string, password: string) => {
    try {
      setLoading(true);
      console.log('[AUTH] Starting login process for:', email);
      
      // Call our custom authentication function
      const { data, error } = await supabase.rpc('authenticate_approved_user', {
        user_email: email,
        user_password: password
      });

      console.log('[AUTH] Authentication response:', { data, error });

      if (error) {
        console.error('[AUTH] Authentication error:', error);
        return { success: false, error: 'Invalid email or password' };
      }

      if (!data || data.length === 0) {
        // The server returns no row for a wrong password AND for a suspended account
        // (PLAN.md §4 D205) and does not say which, so the message may not either.
        console.log('[AUTH] No user data returned from authentication');
        return { success: false, error: 'Invalid email or password, or the account is suspended. Contact your administrator if this persists.' };
      }

      const userData = data[0];
      console.log('[AUTH] User data from DB:', userData);
      
      // Set user context for RLS policies
      const { error: contextError } = await supabase.rpc('set_current_user_context', {
        user_id: userData.user_id,
        user_email: email
      });

      if (contextError) {
        console.error('[AUTH] Error setting user context:', contextError);
        return { success: false, error: 'Authentication setup failed' };
      }
      
      // Fetch user's organization (non-blocking)
      const { data: orgData, error: orgError } = await supabase
        .from('approved_users')
        .select('organization')
        .eq('id', userData.user_id)
        .maybeSingle();
      
      if (orgError) {
        console.warn('[AUTH] Organization lookup failed, defaulting:', orgError);
      }
      
      const userObj: User = {
        id: userData.user_id,
        name: userData.user_name || 'User',
        email: email,
        role: userData.user_role || 'user',
        organization: orgData?.organization || 'default_org'
      };

      console.log('[AUTH] Created user object:', userObj);

      // The account row: deactivation, forced change and password expiry. FAIL CLOSED —
      // an unreadable row used to be skipped silently, which is exactly how none of the
      // three was ever enforced (D206).
      const { profile, error: profileError } = await readProfile(userData.user_id);
      if (!profile) {
        console.error('[AUTH] Account status could not be read:', profileError);
        return { success: false, error: 'Could not verify your account status. Please try again.' };
      }
      if (profile.is_active === false) {
        return { success: false, error: 'Your account has been deactivated. Contact your administrator.' };
      }
      Object.assign(userObj, profile, {
        name: profile.name || userObj.name,
        role: profile.role || userObj.role,
        organization: profile.organization || userObj.organization,
      });

      setUser(userObj);
      localStorage.setItem('auth_user', JSON.stringify(userObj));
      console.log('[AUTH] User stored in localStorage');

      // WP 7.1 stage 1b — ask for a real session BESIDE the one above, never instead of it.
      //
      // OFF by default (`SESSION_MINT_DEFAULT`), and a no-op until somebody sets
      // `SUPABASE_JWT_SECRET` as a function secret. When it does run it mints a token whose
      // `sub` is this user's id and asks the database who it thinks is acting — the only
      // evidence stage 1b can produce, because no gate in this repository can mint a token
      // PostgREST accepts (PLAN.md §14, WP 7.1 stage 1b).
      //
      // Deliberately AFTER the login has been recorded and deliberately awaited only for
      // its outcome: `mintAndVerifySession` never throws, and this block returns success
      // whatever it reports. A session experiment must not be able to cost somebody their
      // login, which is the property that makes stages 1a and 1b safe to merge.
      try {
        const minted = await mintAndVerifySession(email, password, userData.user_id);
        if (minted.state === 'confirmed') {
          console.log('[AUTH] session minted and the database agrees:', minted.resolved);
        } else if (minted.state === 'mismatch') {
          console.error(
            '[AUTH] session minted but the database resolved somebody else — stage 1b is NOT working:',
            minted,
          );
        } else if (minted.state !== 'disabled') {
          console.log('[AUTH] session not minted:', minted.state);
        }
      } catch (mintError) {
        // Unreachable by contract; here because "never throws" is a claim about a module
        // somebody may later edit, and this is the login path.
        console.warn('[AUTH] session mint threw, which it should not:', mintError);
      }

      return { success: true };
    } catch (error) {
      console.error('[AUTH] Login error:', error);
      return { success: false, error: 'Login failed. Please try again.' };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    console.log('[AUTH] Logging out user');
    setUser(null);
    localStorage.removeItem('auth_user');
  };

  const refreshProfile = async () => {
    if (!user?.id) return;
    const { profile, error } = await readProfile(user.id);
    if (!profile) {
      console.warn('[AUTH] Profile refresh failed; keeping the last known account state:', error);
      return;
    }
    if (profile.is_active === false) {
      await logout();
      return;
    }
    const updated: User = {
      ...user,
      ...profile,
      name: profile.name || user.name,
      role: profile.role || user.role,
      organization: profile.organization || user.organization,
    };
    setUser(updated);
    localStorage.setItem('auth_user', JSON.stringify(updated));
  };

  useEffect(() => {
    // State initialized synchronously from localStorage
    console.log('[AUTH] AuthProvider mounted. User present:', !!user);
    
    // If user exists in localStorage, set context for RLS
    if (user?.id && user?.email) {
      supabase.rpc('set_current_user_context', {
        user_id: user.id,
        user_email: user.email
      }).then(({ error }) => {
        if (error) {
          console.error('[AUTH] Error setting user context on mount:', error);
        }
      });
      // A stored session carries the account state from its sign-in. Re-read it, so a
      // reset, a deactivation or an expiry since then is enforced on reload too.
      refreshProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per signed-in user
  }, [user?.id, user?.email]);

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshProfile, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};