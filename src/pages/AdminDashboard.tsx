import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, LogOut, Tv, Users, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ChannelsManager from '@/components/admin/ChannelsManager';
import ClientsManager from '@/components/admin/ClientsManager';
import AdsManager from '@/components/admin/AdsManager';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/admin');
        return;
      }
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      if (!roles || roles.length === 0) {
        toast({ title: 'Sin permisos', variant: 'destructive' });
        await supabase.auth.signOut();
        navigate('/admin');
        return;
      }
      setLoading(false);
    };
    checkAdmin();
  }, [navigate, toast]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/admin');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 glass border-b border-border/50">
        <div className="container flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl gradient-accent flex items-center justify-center">
              <Shield className="w-5 h-5 text-accent-foreground" />
            </div>
            <h1 className="font-display font-bold text-lg text-foreground">Admin Panel</h1>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground hover:text-destructive">
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="container px-4 py-6">
        <Tabs defaultValue="channels" className="space-y-6">
          <TabsList className="glass border border-border/50 p-1">
            <TabsTrigger value="channels" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Tv className="w-4 h-4" /> Canales
            </TabsTrigger>
            <TabsTrigger value="clients" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Users className="w-4 h-4" /> Clientes
            </TabsTrigger>
            <TabsTrigger value="ads" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Megaphone className="w-4 h-4" /> Publicidad
            </TabsTrigger>
          </TabsList>

          <TabsContent value="channels"><ChannelsManager /></TabsContent>
          <TabsContent value="clients"><ClientsManager /></TabsContent>
          <TabsContent value="ads"><AdsManager /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminDashboard;
