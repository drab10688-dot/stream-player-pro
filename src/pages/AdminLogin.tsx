import { useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Lock, Mail, Loader2, Globe } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/contexts/AdminAuthContext';

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { login, setup } = useAdminAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);

    try {
      const result = isSignup
        ? await setup(email.trim(), password.trim())
        : await login(email.trim(), password.trim());

      if (!result.success) {
        toast({ title: 'Error', description: result.error, variant: 'destructive' });
      } else {
        if (isSignup) {
          toast({ title: 'Admin creado', description: 'Sesión iniciada' });
        }
        navigate('/admin/panel');
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error de conexión', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-1/3 right-1/4 w-96 h-96 rounded-full bg-accent/5 blur-[120px]" />
      </div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-md px-6">
        <div className="glass rounded-2xl p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mb-4 relative">
              <Shield className="w-8 h-8 text-primary-foreground" />
              <Globe className="w-4 h-4 text-primary-foreground absolute -bottom-1 -right-1 bg-accent rounded-full p-0.5" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Omnisync Shield</h1>
            <p className="text-muted-foreground text-sm mt-1">Panel de Proxy para Xtream UI</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="pl-10 bg-secondary border-border focus:border-primary h-12 text-foreground placeholder:text-muted-foreground" />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)}
                className="pl-10 bg-secondary border-border focus:border-primary h-12 text-foreground placeholder:text-muted-foreground" />
            </div>
            <Button type="submit" disabled={loading} className="w-full h-12 gradient-primary text-primary-foreground font-semibold">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : isSignup ? 'Crear Primer Admin' : 'Ingresar'}
            </Button>
          </form>

          <button onClick={() => setIsSignup(!isSignup)}
            className="w-full text-center text-sm text-muted-foreground mt-4 hover:text-foreground transition-colors">
            {isSignup ? 'Ya tengo cuenta' : 'Crear primera cuenta admin'}
          </button>
        </div>

        <p className="text-center text-[10px] text-muted-foreground/50 mt-4">
          Proxy seguro para Xtream UI con ocultamiento de IP vía Cloudflare
        </p>
      </motion.div>
    </div>
  );
};

export default AdminLogin;
