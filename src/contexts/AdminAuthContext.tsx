import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, getAdminToken, setAdminToken, clearAdminToken } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { isLovablePreview } from '@/lib/utils';

interface AdminInfo {
  id: string;
  email: string;
}

interface AdminAuthContextType {
  isAdmin: boolean;
  admin: AdminInfo | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  setup: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextType | null>(null);

export const useAdminAuth = () => {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
};


export const AdminAuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isLovablePreview()) {
      // Check Supabase session
      const checkSession = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          // Check if user has admin role
          const { data: roles } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', session.user.id)
            .eq('role', 'admin');
          if (roles && roles.length > 0) {
            setIsAdmin(true);
            setAdmin({ id: session.user.id, email: session.user.email || '' });
          }
        }
        setLoading(false);
      };
      checkSession();
    } else {
      // Check VPS token
      const token = getAdminToken();
      if (token) {
        api('/api/channels', { method: 'GET' })
          .then(() => {
            setIsAdmin(true);
            setLoading(false);
          })
          .catch(() => {
            clearAdminToken();
            setIsAdmin(false);
            setLoading(false);
          });
      } else {
        setLoading(false);
      }
    }
  }, []);

  const login = async (email: string, password: string) => {
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { success: false, error: error.message };
        // Check admin role
        const { data: roles } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', data.user.id)
          .eq('role', 'admin');
        if (!roles || roles.length === 0) {
          await supabase.auth.signOut();
          return { success: false, error: 'No tienes permisos de administrador' };
        }
        setAdmin({ id: data.user.id, email: data.user.email || '' });
        setIsAdmin(true);
        return { success: true };
      } else {
        const resp = await api('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setAdminToken(resp.token);
        setAdmin(resp.admin);
        setIsAdmin(true);
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Error de conexión' };
    }
  };

  const setup = async (email: string, password: string) => {
    try {
      if (isLovablePreview()) {
        // Sign up
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return { success: false, error: error.message };
        if (!data.user) return { success: false, error: 'No se pudo crear el usuario' };
        
        // Sign in (auto-confirm is enabled)
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) return { success: false, error: signInError.message };
        
        // Assign admin role via edge function (bypasses RLS)
        const { data: roleResult, error: roleError } = await supabase.functions.invoke('client-auth', {
          body: { action: 'make_first_admin', user_id: data.user.id },
        });
        if (roleError) {
          console.warn('Role assign error:', roleError.message);
        }
        if (roleResult?.error) {
          console.warn('Role assign response error:', roleResult.error);
        }
        
        setAdmin({ id: data.user.id, email });
        setIsAdmin(true);
        return { success: true };
      } else {
        const resp = await api('/api/admin/setup', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setAdminToken(resp.token);
        setAdmin(resp.admin);
        setIsAdmin(true);
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Error de conexión' };
    }
  };

  const logout = () => {
    if (isLovablePreview()) {
      supabase.auth.signOut();
    }
    clearAdminToken();
    setIsAdmin(false);
    setAdmin(null);
  };

  return (
    <AdminAuthContext.Provider value={{ isAdmin, admin, loading, login, setup, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
};
