import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setAdminToken } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Store, LogIn } from 'lucide-react';
import { motion } from 'framer-motion';
import omnisyncLogo from '@/assets/omnisync-logo.png';

const ResellerLogin = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast({ title: 'Error', description: 'Ingresa usuario y contraseña', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const resp = await api('/api/reseller/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
      });
      localStorage.setItem('reseller_token', resp.token);
      localStorage.setItem('reseller_info', JSON.stringify(resp.reseller));
      navigate('/reseller/panel');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background bg-grid flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="glass-strong rounded-2xl p-8 w-full max-w-sm space-y-6 border border-border/30">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full overflow-hidden mx-auto mb-3">
            <img src={omnisyncLogo} alt="Omnisync" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-bold text-gradient">Panel Reseller</h1>
          <p className="text-xs text-muted-foreground mt-1">Gestiona tus clientes</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Usuario</label>
            <Input placeholder="Tu usuario de reseller" value={username} onChange={e => setUsername(e.target.value)}
              className="bg-secondary border-border text-foreground" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Contraseña</label>
            <Input type="password" placeholder="Tu contraseña" value={password} onChange={e => setPassword(e.target.value)}
              className="bg-secondary border-border text-foreground" />
          </div>
          <Button type="submit" disabled={loading} className="w-full gradient-primary text-primary-foreground gap-2">
            {loading ? <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" /> : <LogIn className="w-4 h-4" />}
            Iniciar Sesión
          </Button>
        </form>
      </motion.div>
    </div>
  );
};

export default ResellerLogin;