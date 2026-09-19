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
  avatar_url?: string | null;
  phone?: string | null;
  is_active?: boolean;
  force_password_change?: boolean;
  password_expires_at?: string | null;
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
        console.log('[AUTH] No user data returned from authentication');
        return { success: false, error: 'Invalid email or password' };
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

      // Enrich with profile fields (display_name, avatar, is_active, password expiry, force_change)
      const { data: profile, error: profileError } = await supabase.rpc('get_my_profile');
      if (!profileError && profile && profile.length > 0) {
        const p = profile[0] as any;
        if (p.is_active === false) {
          return { success: false, error: 'Your account has been deactivated. Contact your administrator.' };
        }
        userObj.display_name = p.display_name;
        userObj.avatar_url = p.avatar_url;
        userObj.phone = p.phone;
        userObj.is_active = p.is_active;
        userObj.force_password_change = p.force_password_change;
        userObj.password_expires_at = p.password_expires_at;
      }

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
    const { data, error } = await supabase.rpc('get_my_profile');
    if (error || !data || data.length === 0) return;
    const p = data[0] as any;
    const updated: User = {
      ...user,
      name: p.name || user.name,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      phone: p.phone,
      is_active: p.is_active,
      force_password_change: p.force_password_change,
      password_expires_at: p.password_expires_at,
      role: p.role || user.role,
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
    }
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