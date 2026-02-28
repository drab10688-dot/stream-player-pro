import React, { createContext, useContext, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ClientInfo {
  id: string;
  username: string;
  max_screens: number;
  expiry_date: string;
}

interface ChannelInfo {
  id: string;
  name: string;
  url: string;
  category: string;
  logo_url: string | null;
  sort_order: number;
}

interface AdInfo {
  id: string;
  title: string;
  message: string;
  image_url: string | null;
}

interface AuthContextType {
  isLoggedIn: boolean;
  client: ClientInfo | null;
  channels: ChannelInfo[];
  ads: AdInfo[];
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

const getDeviceId = () => {
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('device_id', id);
  }
  return id;
};

// Detectar automáticamente si estamos en Lovable Cloud o en un servidor local/VPS.
const isLovableCloud = typeof window !== 'undefined' && (
  window.location.hostname.includes('lovable.app') || 
  window.location.hostname.includes('lovableproject.com')
);
const LOCAL_API_URL = import.meta.env.VITE_LOCAL_API_URL || '';
const useLocalApi = !isLovableCloud || !!LOCAL_API_URL;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [ads, setAds] = useState<AdInfo[]>([]);

  const login = async (username: string, password: string) => {
    try {
      let data: any;

      if (useLocalApi) {
        // Modo local/VPS: llamar a la API Node.js (relativa o absoluta)
        const baseUrl = LOCAL_API_URL || '';
        const response = await fetch(`${baseUrl}/api/client/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, device_id: getDeviceId() }),
        });
        data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.error || 'Error de conexión' };
        }
      } else {
        // Modo Cloud: usar edge function
        const result = await supabase.functions.invoke('client-auth', {
          body: { action: 'login', username, password, device_id: getDeviceId() }
        });

        console.log('client-auth result:', JSON.stringify(result.data), 'error:', result.error);

        if (result.error) {
          // Check if the error response contains data with an error message
          const errMsg = (result.error as any)?.message || 'Error de conexión';
          return { success: false, error: errMsg };
        }
        data = result.data;
        if (!data || data.error) {
          return { success: false, error: data?.error || 'Respuesta inválida del servidor' };
        }
      }

      setClient(data.client);
      setChannels(data.channels || []);
      setAds(data.ads || []);
      setIsLoggedIn(true);
      return { success: true };
    } catch {
      return { success: false, error: 'Error de conexión al servidor' };
    }
  };

  const logout = () => {
    setIsLoggedIn(false);
    setClient(null);
    setChannels([]);
    setAds([]);
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, client, channels, ads, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
