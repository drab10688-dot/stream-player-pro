import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, X, Bell, Search, Play } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import omnisyncLogo from '@/assets/omnisync-logo.png';

const Dashboard = () => {
  const { client, channels, ads, logout } = useAuth();
  const navigate = useNavigate();
  const [showAd, setShowAd] = useState(true);
  const [currentAd, setCurrentAd] = useState(0);
  const [search, setSearch] = useState('');

  const categories = [...new Set(channels.map(ch => ch.category))];

  const filteredChannels = channels.filter(ch =>
    ch.name.toLowerCase().includes(search.toLowerCase())
  );

  const channelsByCategory = categories
    .map(cat => ({
      name: cat,
      channels: filteredChannels.filter(ch => ch.category === cat),
    }))
    .filter(g => g.channels.length > 0);

  const activeAd = ads.length > 0 ? ads[currentAd % ads.length] : null;

  return (
    <div className="min-h-screen bg-background bg-grid">
      {/* Ad Banner */}
      <AnimatePresence>
        {showAd && activeAd && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="gradient-accent overflow-hidden"
          >
            <div className="container px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
                <Bell className="w-4 h-4 text-accent-foreground shrink-0" />
                <span className="font-semibold text-accent-foreground text-sm">{activeAd.title}</span>
                <span className="text-accent-foreground/80 text-sm ml-1 hidden sm:inline">{activeAd.message}</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowAd(false)} className="text-accent-foreground/60 hover:text-accent-foreground shrink-0 h-7 w-7">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-50 glass-strong border-b border-primary/5">
        <div className="container flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full overflow-hidden">
              <img src={omnisyncLogo} alt="Omnisync" className="w-full h-full object-cover" />
            </div>
            <h1 className="font-bold text-lg text-gradient tracking-tight">Omnisync</h1>
          </div>

          <div className="flex-1 max-w-xs mx-4 hidden md:block">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar canal..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-secondary/40 border-border/40 h-9 text-sm text-foreground placeholder:text-muted-foreground rounded-xl"
                maxLength={50}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/40 border border-border/30">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-sm text-muted-foreground">{client?.username}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={logout} className="text-muted-foreground hover:text-destructive h-9 w-9">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile search */}
      <div className="md:hidden px-4 pt-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar canal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-secondary/40 border-border/40 h-10 text-foreground placeholder:text-muted-foreground rounded-xl"
            maxLength={50}
          />
        </div>
      </div>

      <main className="container px-4 py-6 space-y-8">
        {channels.length === 0 ? (
          <div className="glass-strong rounded-2xl p-12 text-center">
            <div className="w-20 h-20 rounded-full overflow-hidden mx-auto mb-4 opacity-40">
              <img src={omnisyncLogo} alt="" className="w-full h-full object-cover" />
            </div>
            <h2 className="font-semibold text-xl text-foreground mb-2">Sin canales disponibles</h2>
            <p className="text-muted-foreground">No hay canales asignados a tu cuenta aún.</p>
          </div>
        ) : (
          channelsByCategory.map((group, gi) => (
            <motion.section
              key={group.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.1 }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-1 h-6 rounded-full gradient-primary" />
                <h2 className="font-semibold text-lg text-foreground">{group.name}</h2>
                <span className="text-xs text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">{group.channels.length}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 sm:gap-4">
                {group.channels.map((ch, i) => (
                  <motion.button
                    key={ch.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.02 }}
                    tabIndex={0}
                    onClick={() => navigate(`/player/${ch.category}`, { state: { channel: ch } })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/player/${ch.category}`, { state: { channel: ch } }); }}
                    className="group glass-strong rounded-2xl p-4 sm:p-5 2xl:p-6 text-left hover:border-primary/30 transition-all duration-300 cursor-pointer relative overflow-hidden tv-focusable"
                  >
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-primary/5 to-transparent" />
                    <div className="relative">
                      <div className="w-14 h-14 sm:w-16 sm:h-16 2xl:w-20 2xl:h-20 rounded-xl bg-secondary/60 flex items-center justify-center mb-3 overflow-hidden group-hover:scale-105 transition-transform duration-300">
                        {ch.logo_url ? (
                          <img src={ch.logo_url} alt={ch.name} className="w-full h-full object-cover rounded-xl" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <Play className="w-6 h-6 sm:w-7 sm:h-7 2xl:w-8 2xl:h-8 text-primary" />
                        )}
                      </div>
                      <p className="font-medium text-foreground text-sm sm:text-base 2xl:text-lg truncate">{ch.name}</p>
                      <p className="text-muted-foreground text-xs sm:text-sm mt-1 truncate">{ch.category}</p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.section>
          ))
        )}
      </main>
    </div>
  );
};

export default Dashboard;
