import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Tv, Lock, User, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast({ title: 'Error', description: 'Ingresa usuario y contraseña', variant: 'destructive' });
      return;
    }
    setLoading(true);
    const result = await login(username.trim(), password.trim());
    setLoading(false);
    if (!result.success) {
      toast({ title: 'Acceso denegado', description: result.error || 'Credenciales incorrectas', variant: 'destructive' });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-72 h-72 rounded-full bg-accent/15 blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 w-full max-w-md px-6"
      >
        <div className="glass rounded-2xl p-8 shadow-2xl">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 }}
            className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mb-4 glow-primary animate-pulse-glow">
              <Tv className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">StreamBox</h1>
            <p className="text-muted-foreground text-sm mt-1">Tu entretenimiento en un solo lugar</p>
          </motion.div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="text" placeholder="Usuario" value={username} onChange={(e) => setUsername(e.target.value)}
                className="pl-10 bg-secondary border-border focus:border-primary h-12 text-foreground placeholder:text-muted-foreground" maxLength={50} />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)}
                className="pl-10 bg-secondary border-border focus:border-primary h-12 text-foreground placeholder:text-muted-foreground" maxLength={50} />
            </div>
            <Button type="submit" disabled={loading} className="w-full h-12 gradient-primary text-primary-foreground font-semibold text-base hover:opacity-90 transition-opacity">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Iniciar Sesión'}
            </Button>
          </form>

          <p className="text-center text-muted-foreground text-xs mt-6">
            Ingresa las credenciales proporcionadas por tu proveedor
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
