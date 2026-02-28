import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Star, Clock, TrendingUp, Tv, Film, Radio, LogOut, X, Bell } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const Dashboard = () => {
  const { client, channels, ads, logout } = useAuth();
  const navigate = useNavigate();
  const [showAd, setShowAd] = useState(true);
  const [currentAd, setCurrentAd] = useState(0);

  const categories = [...new Set(channels.map(ch => ch.category))];
  const channelsByCategory = categories.map(cat => ({
    name: cat,
    channels: channels.filter(ch => ch.category === cat),
  }));

  const activeAd = ads.length > 0 ? ads[currentAd % ads.length] : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Ad Banner */}
      <AnimatePresence>
        {showAd && activeAd && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="gradient-accent overflow-hidden"
          >
            <div className="container px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
                <Bell className="w-4 h-4 text-accent-foreground shrink-0" />
                <div>
                  <span className="font-semibold text-accent-foreground text-sm">{activeAd.title}</span>
                  <span className="text-accent-foreground/80 text-sm ml-2">{activeAd.message}</span>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowAd(false)} className="text-accent-foreground/60 hover:text-accent-foreground shrink-0">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-border/50">
        <div className="container flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center">
              <Tv className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="font-display font-bold text-lg text-foreground">StreamBox</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {client?.username}
            </span>
            <Button variant="ghost" size="icon" onClick={logout} className="text-muted-foreground hover:text-destructive">
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6 space-y-8">
        {channels.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center">
            <Tv className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-display font-semibold text-xl text-foreground mb-2">Sin canales disponibles</h2>
            <p className="text-muted-foreground">No hay canales asignados a tu cuenta aún.</p>
          </div>
        ) : (
          channelsByCategory.map((group) => (
            <section key={group.name}>
              <h2 className="font-display font-semibold text-xl text-foreground mb-4">{group.name}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {group.channels.map((ch, i) => (
                  <motion.button
                    key={ch.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => navigate(`/player/${ch.category}`, { state: { channel: ch } })}
                    className="glass rounded-xl p-4 text-left hover:border-primary/50 transition-all group cursor-pointer"
                  >
                    <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center mb-3">
                      <Tv className="w-6 h-6 text-primary" />
                    </div>
                    <p className="font-semibold text-foreground text-sm truncate">{ch.name}</p>
                    <p className="text-muted-foreground text-xs mt-1">{ch.category}</p>
                  </motion.button>
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
};

export default Dashboard;
