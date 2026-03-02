import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tv, Users, Megaphone, Store, LogOut, LayoutDashboard, Bell, Activity, Globe, Radio, Bug, Package, HardDrive, Film, Tv2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AdminStats from '@/components/admin/AdminStats';
import ChannelsManager from '@/components/admin/ChannelsManager';
import ClientsManager from '@/components/admin/ClientsManager';
import AdsManager from '@/components/admin/AdsManager';
import ResellersManager from '@/components/admin/ResellersManager';
import ExpirationAlerts from '@/components/admin/ExpirationAlerts';
import ChannelMonitor from '@/components/admin/ChannelMonitor';
import TunnelManager from '@/components/admin/TunnelManager';
import StreamMonitor from '@/components/admin/StreamMonitor';
import StreamDiagnostics from '@/components/admin/StreamDiagnostics';
import PlansManager from '@/components/admin/PlansManager';
import BackupManager from '@/components/admin/BackupManager';
import VodManager from '@/components/admin/VodManager';
import SeriesManager from '@/components/admin/SeriesManager';
import ActiveViewers from '@/components/admin/ActiveViewers';
import omnisyncLogo from '@/assets/omnisync-logo.png';
import ChangePasswordDialog from '@/components/admin/ChangePasswordDialog';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { isAdmin, loading, logout } = useAdminAuth();

  useEffect(() => {
    if (!loading && !isAdmin) {
      navigate('/admin');
    }
  }, [loading, isAdmin, navigate]);

  const handleLogout = () => {
    logout();
    navigate('/admin');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background bg-grid">
      <header className="sticky top-0 z-50 glass-strong border-b border-primary/5">
        <div className="container flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full overflow-hidden">
              <img src={omnisyncLogo} alt="Omnisync" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-gradient tracking-tight">Omnisync</h1>
              <p className="text-[10px] text-muted-foreground -mt-0.5 tracking-wider uppercase">Admin Panel</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ChangePasswordDialog />
            <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground hover:text-destructive">
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6">
        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="glass-strong border border-border/30 p-1 flex flex-wrap h-auto gap-1">
            <TabsTrigger value="dashboard" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <LayoutDashboard className="w-4 h-4" /> Dashboard
            </TabsTrigger>
            <TabsTrigger value="channels" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Tv className="w-4 h-4" /> Canales
            </TabsTrigger>
            <TabsTrigger value="clients" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Users className="w-4 h-4" /> Clientes
            </TabsTrigger>
            <TabsTrigger value="resellers" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Store className="w-4 h-4" /> Resellers
            </TabsTrigger>
            <TabsTrigger value="ads" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Megaphone className="w-4 h-4" /> Publicidad
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Bell className="w-4 h-4" /> Alertas
            </TabsTrigger>
            <TabsTrigger value="monitor" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Activity className="w-4 h-4" /> Monitoreo
            </TabsTrigger>
            <TabsTrigger value="tunnel" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Globe className="w-4 h-4" /> Túnel
            </TabsTrigger>
            <TabsTrigger value="streams" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Radio className="w-4 h-4" /> Streams
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Bug className="w-4 h-4" /> Diagnóstico
            </TabsTrigger>
            <TabsTrigger value="plans" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Package className="w-4 h-4" /> Planes
            </TabsTrigger>
            <TabsTrigger value="backups" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <HardDrive className="w-4 h-4" /> Backups
            </TabsTrigger>
            <TabsTrigger value="vod" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Film className="w-4 h-4" /> Películas
            </TabsTrigger>
            <TabsTrigger value="series" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Tv2 className="w-4 h-4" /> Series
            </TabsTrigger>
            <TabsTrigger value="viewers" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Eye className="w-4 h-4" /> Espectadores
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard"><AdminStats /></TabsContent>
          <TabsContent value="channels"><ChannelsManager /></TabsContent>
          <TabsContent value="clients"><ClientsManager /></TabsContent>
          <TabsContent value="resellers"><ResellersManager /></TabsContent>
          <TabsContent value="ads"><AdsManager /></TabsContent>
          <TabsContent value="alerts"><ExpirationAlerts /></TabsContent>
          <TabsContent value="monitor"><ChannelMonitor /></TabsContent>
          <TabsContent value="tunnel"><TunnelManager /></TabsContent>
          <TabsContent value="streams"><StreamMonitor /></TabsContent>
          <TabsContent value="diagnostics"><StreamDiagnostics /></TabsContent>
          <TabsContent value="plans"><PlansManager /></TabsContent>
          <TabsContent value="backups"><BackupManager /></TabsContent>
          <TabsContent value="vod"><VodManager /></TabsContent>
          <TabsContent value="series"><SeriesManager /></TabsContent>
          <TabsContent value="viewers"><ActiveViewers /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminDashboard;
