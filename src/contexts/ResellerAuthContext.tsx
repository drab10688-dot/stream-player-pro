import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '@/lib/api';

interface ResellerInfo {
  id: string;
  name: string;
  username: string;
  max_clients: number;
  commission_percent: number;
  client_count: number;
}

interface ResellerAuthContextType {
  isReseller: boolean;
  reseller: ResellerInfo | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const ResellerAuthContext = createContext<ResellerAuthContextType | null>(null);

export const useResellerAuth = () => {
  const ctx = useContext(ResellerAuthContext);
  if (!ctx) throw new Error('useResellerAuth must be used within ResellerAuthProvider');
  return ctx;
};

const getResellerToken = () => localStorage.getItem('reseller_token');
const setResellerToken = (token: string) => localStorage.setItem('reseller_token', token);
const clearResellerToken = () => localStorage.removeItem('reseller_token');

export const resellerApi = async (path: string, options: RequestInit = {}) => {
  const token = getResellerToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const envBase = import.meta.env.VITE_LOCAL_API_URL || '';
  const base = (typeof window !== 'undefined' && window.location.protocol === 'https:' && envBase.startsWith('http://')) ? '' : envBase;

  const response = await fetch(`${base}${path}`, { ...options, headers });
  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Error del servidor (${response.status}): ${text.substring(0, 200)}`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
};

export const resellerApiGet = (path: string) => resellerApi(path, { method: 'GET' });
export const resellerApiPost = (path: string, body: any) => resellerApi(path, { method: 'POST', body: JSON.stringify(body) });
export const resellerApiPut = (path: string, body: any) => resellerApi(path, { method: 'PUT', body: JSON.stringify(body) });
export const resellerApiDelete = (path: string) => resellerApi(path, { method: 'DELETE' });

export const ResellerAuthProvider = ({ children }: { children: ReactNode }) => {
  const [isReseller, setIsReseller] = useState(false);
  const [reseller, setReseller] = useState<ResellerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getResellerToken();
    if (token) {
      resellerApiGet('/api/reseller/me')
        .then((data) => {
          setReseller(data);
          setIsReseller(true);
        })
        .catch(() => {
          clearResellerToken();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const resp = await api('/api/reseller/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setResellerToken(resp.token);
      setReseller(resp.reseller);
      setIsReseller(true);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error de conexión' };
    }
  };

  const logout = () => {
    clearResellerToken();
    setIsReseller(false);
    setReseller(null);
  };

  return (
    <ResellerAuthContext.Provider value={{ isReseller, reseller, loading, login, logout }}>
      {children}
    </ResellerAuthContext.Provider>
  );
};
