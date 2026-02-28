import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, getAdminToken, setAdminToken, clearAdminToken } from '@/lib/api';

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
    // Check if there's a valid token
    const token = getAdminToken();
    if (token) {
      // Validate token by making a request
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
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const data = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAdminToken(data.token);
      setAdmin(data.admin);
      setIsAdmin(true);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error de conexión' };
    }
  };

  const setup = async (email: string, password: string) => {
    try {
      const data = await api('/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAdminToken(data.token);
      setAdmin(data.admin);
      setIsAdmin(true);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error de conexión' };
    }
  };

  const logout = () => {
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
