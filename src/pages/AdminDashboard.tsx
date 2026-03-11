import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayoutDashboard, Globe, Settings, Activity, LogOut, Users, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ErrorBoundary from '@/components/ErrorBoundary';
import DashboardOverview from '@/components/admin/DashboardOverview';
import TunnelManager from '@/components/admin/TunnelManager';
import XtreamConfig from '@/components/admin/XtreamConfig';
import ProxyStatus from '@/components/admin/ProxyStatus';
import ShieldClientsManager from '@/components/admin/ShieldClientsManager';
import ShieldViewers from '@/components/admin/ShieldViewers';
import ChangePasswordDialog from '@/components/admin/ChangePasswordDialog';
import omnisyncLogo from '@/assets/omnisync-logo.png';

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
              <h1 className="font-bold text-lg text-gradient tracking-tight">Omnisync Shield</h1>
              <p className="text-[10px] text-muted-foreground -mt-0.5 tracking-wider uppercase">Xtream UI Proxy</p>
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
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="glass-strong border border-border/30 p-1 flex flex-wrap h-auto gap-1">
            <TabsTrigger value="overview" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <LayoutDashboard className="w-4 h-4" /> Resumen
            </TabsTrigger>
            <TabsTrigger value="tunnel" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Globe className="w-4 h-4" /> Túnel
            </TabsTrigger>
            <TabsTrigger value="clients" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Users className="w-4 h-4" /> Clientes
            </TabsTrigger>
            <TabsTrigger value="viewers" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Eye className="w-4 h-4" /> Conectados
            </TabsTrigger>
            <TabsTrigger value="proxy" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Activity className="w-4 h-4" /> Proxy
            </TabsTrigger>
            <TabsTrigger value="xtream" className="gap-2 data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Settings className="w-4 h-4" /> Xtream UI
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" forceMount className="data-[state=inactive]:hidden"><ErrorBoundary><DashboardOverview /></ErrorBoundary></TabsContent>
          <TabsContent value="tunnel" forceMount className="data-[state=inactive]:hidden"><ErrorBoundary><TunnelManager /></ErrorBoundary></TabsContent>
          <TabsContent value="clients" forceMount className="data-[state=inactive]:hidden"><ErrorBoundary><ShieldClientsManager /></ErrorBoundary></TabsContent>
          <TabsContent value="viewers" forceMount className="data-[state=inactive]:hidden"><ErrorBoundary><ShieldViewers /></ErrorBoundary></TabsContent>
          <TabsContent value="proxy" forceMount className="data-[state=inactive]:hidden"><ErrorBoundary><ProxyStatus /></ErrorBoundary></TabsContent>
          <TabsContent value="xtream" forceMount className="data-[state=inactive]:hidden"><ErrorBoundary><XtreamConfig /></ErrorBoundary></TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminDashboard;
