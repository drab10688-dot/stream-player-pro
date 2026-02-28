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
    // crypto.randomUUID() solo funciona en HTTPS/localhost
    // Fallback para HTTP en VPS
    try {
      id = crypto.randomUUID();
    } catch {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }
    localStorage.setItem('device_id', id);
  }
  return id;
};

// Detectar entorno automáticamente por hostname
const isLovablePreview = () => {
  const host = window.location.hostname;
  return host.includes('lovable.app') || host.includes('lovable.dev') || host === 'localhost';
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [ads, setAds] = useState<AdInfo[]>([]);

  const login = async (username: string, password: string) => {
    try {
      let data: any;

      if (isLovablePreview()) {
        // Lovable Cloud: usar edge function
        const { data: fnData, error: fnError } = await supabase.functions.invoke('client-auth', {
          body: { action: 'login', username, password, device_id: getDeviceId() },
        });
        if (fnError) {
          console.error('Edge function error:', fnError);
          return { success: false, error: 'Error de conexión al servidor' };
        }
        data = fnData;
      } else {
        // VPS: usar API local relativa (Nginx proxy)
        const response = await fetch('/api/client/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, device_id: getDeviceId() }),
        });
        
        const contentType = response.headers.get('content-type');
        if (!contentType?.includes('application/json')) {
          const text = await response.text();
          console.error('API response not JSON:', response.status, text.substring(0, 200));
          return { success: false, error: `Error del servidor (${response.status})` };
        }
        
        data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.error || 'Credenciales inválidas' };
        }
      }

      if (data.error) {
        return { success: false, error: data.error };
      }

      setClient(data.client);
      setChannels(data.channels || []);
      setAds(data.ads || []);
      setIsLoggedIn(true);
      return { success: true };
    } catch (err) {
      console.error('Login error:', err);
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
