import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
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
  reportChannelError: (channelId: string, errorMessage: string) => void;
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

const isLovablePreview = () => {
  const host = window.location.hostname;
  return host.includes('lovable.app') || host.includes('lovable.dev') || host === 'localhost';
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [ads, setAds] = useState<AdInfo[]>([]);
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>();

  // Heartbeat - send every 2 minutes to keep connection alive
  useEffect(() => {
    if (!isLoggedIn || !client) return;

    const sendHeartbeat = async () => {
      try {
        if (isLovablePreview()) {
          await supabase.functions.invoke('client-auth', {
            body: { action: 'heartbeat', client_id: client.id, device_id: getDeviceId() },
          });
        } else {
          await fetch('/api/client/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: client.id, device_id: getDeviceId() }),
          });
        }
      } catch (err) {
        console.error('Heartbeat error:', err);
      }
    };

    // Send immediately then every 2 minutes
    sendHeartbeat();
    heartbeatRef.current = setInterval(sendHeartbeat, 2 * 60 * 1000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [isLoggedIn, client]);

  // Report channel error
  const reportChannelError = useCallback(async (channelId: string, errorMessage: string) => {
    try {
      if (isLovablePreview()) {
        await supabase.functions.invoke('client-auth', {
          body: {
            action: 'report_channel_error',
            channel_id: channelId,
            error_message: errorMessage,
            username: client?.username,
          },
        });
      } else {
        await fetch('/api/channel/report-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel_id: channelId, error_message: errorMessage, username: client?.username }),
        });
      }
    } catch (err) {
      console.error('Error reporting channel error:', err);
    }
  }, [client]);

  // Refresh channels & ads from DB
  const refreshChannels = useCallback(async () => {
    if (isLovablePreview()) {
      const { data } = await supabase
        .from('channels')
        .select('id, name, url, category, logo_url, sort_order')
        .eq('is_active', true)
        .order('sort_order');
      if (data) {
        const proxyBase = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/video-proxy`;
        const proxied = data.map((ch) => {
          if (ch.url && !ch.url.includes('youtube.com') && !ch.url.includes('youtu.be')) {
            return { ...ch, url: `${proxyBase}?url=${encodeURIComponent(ch.url)}` };
          }
          return ch;
        });
        setChannels(proxied);
      }
    } else {
      try {
        const res = await fetch('/api/channels/public');
        if (res.ok) {
          const data = await res.json();
          // YouTube keeps original URL, others use restream proxy
          // HLS channels get ?type=hls query param for player detection
          const mapped = data.map((ch: any) => ({
            ...ch,
            url: ch.url || `/api/restream/${ch.id}${ch.is_hls ? '?type=hls' : ''}`,
          }));
          setChannels(mapped);
        }
      } catch (err) {
        console.error('Error refreshing channels:', err);
      }
    }
  }, []);

  const refreshAds = useCallback(async () => {
    if (isLovablePreview()) {
      const { data } = await supabase
        .from('ads')
        .select('id, title, message, image_url')
        .eq('is_active', true);
      if (data) setAds(data);
    } else {
      try {
        const res = await fetch('/api/ads/public');
        if (res.ok) {
          const data = await res.json();
          setAds(data);
        }
      } catch (err) {
        console.error('Error refreshing ads:', err);
      }
    }
  }, []);

  // Subscribe to realtime changes when logged in
  useEffect(() => {
    if (!isLoggedIn || !isLovablePreview()) return;

    const channel = supabase
      .channel('client-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => {
        refreshChannels();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ads' }, () => {
        refreshAds();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isLoggedIn, refreshChannels, refreshAds]);

  const login = async (username: string, password: string) => {
    try {
      let data: any;

      if (isLovablePreview()) {
        const { data: fnData, error: fnError } = await supabase.functions.invoke('client-auth', {
          body: { action: 'login', username, password, device_id: getDeviceId() },
        });
        if (fnError) {
          console.error('Edge function error:', fnError);
          return { success: false, error: 'Error de conexión al servidor' };
        }
        data = fnData;
      } else {
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

      // In Lovable preview, proxy TS/stream URLs through edge function to bypass CORS
      const processedChannels = (data.channels || []).map((ch: any) => {
        if (isLovablePreview() && ch.url && !ch.url.includes('youtube.com') && !ch.url.includes('youtu.be')) {
          const proxyBase = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/video-proxy`;
          return { ...ch, url: `${proxyBase}?url=${encodeURIComponent(ch.url)}` };
        }
        return ch;
      });

      setClient(data.client);
      setChannels(processedChannels);
      setAds(data.ads || []);
      setIsLoggedIn(true);
      return { success: true };
    } catch (err) {
      console.error('Login error:', err);
      return { success: false, error: 'Error de conexión al servidor' };
    }
  };

  const logout = () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    setIsLoggedIn(false);
    setClient(null);
    setChannels([]);
    setAds([]);
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, client, channels, ads, login, logout, reportChannelError }}>
      {children}
    </AuthContext.Provider>
  );
};
