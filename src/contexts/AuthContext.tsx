import React, { createContext, useContext, useState, ReactNode } from 'react';

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

// API base URL: vacío = relativo al mismo servidor (VPS/local)
const API_BASE = import.meta.env.VITE_LOCAL_API_URL || '';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [ads, setAds] = useState<AdInfo[]>([]);

  const login = async (username: string, password: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/client/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, device_id: getDeviceId() }),
      });
      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Credenciales inválidas' };
      }

      if (data.error) {
        return { success: false, error: data.error };
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
