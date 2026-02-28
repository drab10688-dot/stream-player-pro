import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Lock, User, Loader2, Play } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import omnisyncLogo from '@/assets/omnisync-logo.png';

const SAVED_CREDS_KEY = 'omnisync_saved_credentials';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();

  // Load saved credentials and auto-login
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_CREDS_KEY);
      if (saved) {
        const { username: u, password: p } = JSON.parse(saved);
        setUsername(u || '');
        setPassword(p || '');
        setRememberMe(true);
        // Auto-login with saved credentials
        if (u && p) {
          setLoading(true);
          login(u, p).then((result) => {
            setLoading(false);
            if (!result.success) {
              localStorage.removeItem(SAVED_CREDS_KEY);
            }
          });
        }
      }
    } catch {}
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast({ title: 'Error', description: 'Ingresa usuario y contraseña', variant: 'destructive' });
      return;
    }
    setLoading(true);
    const result = await login(username.trim(), password.trim());
    setLoading(false);
    if (result.success) {
      if (rememberMe) {
        localStorage.setItem(SAVED_CREDS_KEY, JSON.stringify({ username: username.trim(), password: password.trim() }));
      } else {
        localStorage.removeItem(SAVED_CREDS_KEY);
      }
    } else {
      toast({ title: 'Acceso denegado', description: result.error || 'Credenciales incorrectas', variant: 'destructive' });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden bg-grid">
      {/* Ambient glow effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full bg-accent/5 blur-[120px]" />
        <div className="absolute top-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-primary/3 blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md px-6"
      >
        <div className="glass-strong rounded-3xl p-8 shadow-2xl">
          {/* Logo */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center mb-8"
          >
            <div className="relative mb-5">
              <div className="w-28 h-28 rounded-full overflow-hidden animate-float">
                <img src={omnisyncLogo} alt="Omnisync" className="w-full h-full object-cover" />
              </div>
              <div className="absolute inset-0 rounded-full animate-pulse-glow" />
            </div>
            <p className="text-muted-foreground text-sm mt-2 tracking-wide">Tu televisión, en todas partes</p>
          </motion.div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="relative"
            >
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="pl-11 bg-secondary/50 border-border/60 focus:border-primary/60 h-13 text-foreground placeholder:text-muted-foreground rounded-xl transition-all focus:bg-secondary/80 tv-focusable text-lg"
                maxLength={50}
                tabIndex={0}
                autoFocus
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="relative"
            >
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-11 bg-secondary/50 border-border/60 focus:border-primary/60 h-13 text-foreground placeholder:text-muted-foreground rounded-xl transition-all focus:bg-secondary/80 tv-focusable text-lg"
                maxLength={50}
                tabIndex={0}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45 }}
              className="flex items-center gap-2"
            >
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked === true)}
                className="tv-focusable"
                tabIndex={0}
              />
              <Label htmlFor="remember" className="text-sm text-muted-foreground cursor-pointer">
                Recordar credenciales
              </Label>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <Button
                type="submit"
                disabled={loading}
                tabIndex={0}
                className="w-full h-13 gradient-primary text-primary-foreground font-semibold text-base rounded-xl hover:opacity-90 transition-all glow-primary tv-focusable text-lg"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Conectar'}
              </Button>
            </motion.div>
          </form>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="flex items-center justify-center gap-2 mt-6"
          >
            <Play className="w-3 h-3 text-primary/50" />
            <p className="text-muted-foreground text-xs tracking-wider uppercase">
              TV en vivo · Series · Películas
            </p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
