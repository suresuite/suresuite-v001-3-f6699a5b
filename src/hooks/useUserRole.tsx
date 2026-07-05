import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';

export type UserRole = 'super_admin' | 'admin' | 'modeler' | 'user';

export const useUserRole = () => {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);

  const role = (user?.role as UserRole) || 'user';

  useEffect(() => {
    if (!authLoading) setLoading(false);
  }, [authLoading]);

  return {
    role,
    loading,
    canModify: role === 'modeler' || role === 'admin' || role === 'super_admin',
    isSuperAdmin: role === 'super_admin',
  };
};
