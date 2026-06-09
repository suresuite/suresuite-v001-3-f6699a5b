import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type UserRole = 'admin' | 'modeler' | 'user';

export const useUserRole = () => {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);

  // Use role directly from auth context since it's already fetched during login
  const role = (user?.role as UserRole) || 'user';

  useEffect(() => {
    // Set loading to false once auth is complete
    if (!authLoading) {
      setLoading(false);
    }
  }, [authLoading]);

  return { role, loading, canModify: role === 'modeler' || role === 'admin' };
};