import { useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Lock, Mail, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);

    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        
        // Try to make first admin
        if (data.user) {
          await supabase.functions.invoke('client-auth', {
            body: { action: 'make_first_admin', user_id: data.user.id }
          });
        }
        
        toast({ title: 'Cuenta creada', description: 'Ahora inicia sesión' });
        setIsSignup(false);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const { data: roles } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', data.user.id);

        if (!roles || roles.length === 0) {
          await supabase.auth.signOut();
          toast({ title: 'Sin permisos', description: 'No tienes rol de administrador', variant: 'destructive' });
          setLoading(false);
          return;
        }

        navigate('/admin/panel');
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-1/3 right-1/4 w-96 h-96 rounded-full bg-accent/20 blur-[120px]" />
      </div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-md px-6">
        <div className="glass rounded-2xl p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl gradient-accent flex items-center justify-center mb-4">
              <Shield className="w-8 h-8 text-accent-foreground" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">Panel Admin</h1>
            <p className="text-muted-foreground text-sm mt-1">Gestión del sistema IPTV</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="pl-10 bg-secondary border-border focus:border-accent h-12 text-foreground placeholder:text-muted-foreground" />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)}
                className="pl-10 bg-secondary border-border focus:border-accent h-12 text-foreground placeholder:text-muted-foreground" />
            </div>
            <Button type="submit" disabled={loading} className="w-full h-12 gradient-accent text-accent-foreground font-semibold">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : isSignup ? 'Crear Cuenta Admin' : 'Ingresar'}
            </Button>
          </form>

          <button onClick={() => setIsSignup(!isSignup)}
            className="w-full text-center text-sm text-muted-foreground mt-4 hover:text-foreground transition-colors">
            {isSignup ? 'Ya tengo cuenta' : 'Crear primera cuenta admin'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default AdminLogin;
