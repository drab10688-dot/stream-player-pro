import React, { createContext, useContext, useState, ReactNode } from 'react';

interface AuthContextType {
  isLoggedIn: boolean;
  username: string;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

// The Xtream UI server URL is hidden here
const XTREAM_SERVER_URL = "http://your-server-url.com";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');

  const login = async (user: string, pass: string): Promise<boolean> => {
    try {
      // Xtream UI API authentication
      const response = await fetch(
        `${XTREAM_SERVER_URL}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data.user_info && data.user_info.auth === 1) {
          setIsLoggedIn(true);
          setUsername(user);
          localStorage.setItem('xtream_user', user);
          localStorage.setItem('xtream_pass', pass);
          return true;
        }
      }
      
      // For demo purposes, allow demo login
      if (user === 'demo' && pass === 'demo') {
        setIsLoggedIn(true);
        setUsername(user);
        return true;
      }
      
      return false;
    } catch {
      // For demo, allow offline login
      if (user === 'demo' && pass === 'demo') {
        setIsLoggedIn(true);
        setUsername(user);
        return true;
      }
      return false;
    }
  };

  const logout = () => {
    setIsLoggedIn(false);
    setUsername('');
    localStorage.removeItem('xtream_user');
    localStorage.removeItem('xtream_pass');
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, username, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
