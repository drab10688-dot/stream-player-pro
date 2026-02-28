import { motion } from 'framer-motion';
import { Play, Star, Clock, TrendingUp, Tv, Film, Radio, LogOut, Settings } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const categories = [
  { id: 'live', name: 'TV en Vivo', icon: Tv, count: 245 },
  { id: 'movies', name: 'Películas', icon: Film, count: 1820 },
  { id: 'series', name: 'Series', icon: Play, count: 530 },
  { id: 'radio', name: 'Radio', icon: Radio, count: 85 },
];

const featuredChannels = [
  { id: 1, name: 'ESPN HD', category: 'Deportes', rating: 4.8 },
  { id: 2, name: 'HBO Max', category: 'Entretenimiento', rating: 4.9 },
  { id: 3, name: 'Discovery', category: 'Documentales', rating: 4.5 },
  { id: 4, name: 'Fox Sports', category: 'Deportes', rating: 4.7 },
  { id: 5, name: 'TNT', category: 'Películas', rating: 4.6 },
  { id: 6, name: 'National Geo', category: 'Documentales', rating: 4.4 },
];

const recentChannels = [
  { id: 1, name: 'CNN en Español', time: 'Hace 2h' },
  { id: 2, name: 'ESPN HD', time: 'Hace 5h' },
  { id: 3, name: 'HBO Max', time: 'Ayer' },
];

const Dashboard = () => {
  const { username, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
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
            <span className="text-sm text-muted-foreground hidden sm:block">Hola, {username}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/admin')}
              className="text-muted-foreground hover:text-foreground"
            >
              <Settings className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              className="text-muted-foreground hover:text-destructive"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6 space-y-8">
        {/* Categories */}
        <section>
          <h2 className="font-display font-semibold text-xl text-foreground mb-4">Categorías</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {categories.map((cat, i) => (
              <motion.button
                key={cat.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => navigate(`/player/${cat.id}`)}
                className="glass rounded-xl p-4 text-left hover:border-primary/50 transition-all group cursor-pointer"
              >
                <cat.icon className="w-8 h-8 text-primary mb-3 group-hover:scale-110 transition-transform" />
                <p className="font-display font-semibold text-foreground text-sm">{cat.name}</p>
                <p className="text-muted-foreground text-xs mt-1">{cat.count} canales</p>
              </motion.button>
            ))}
          </div>
        </section>

        {/* Featured */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-accent" />
            <h2 className="font-display font-semibold text-xl text-foreground">Populares</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {featuredChannels.map((ch, i) => (
              <motion.button
                key={ch.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + i * 0.05 }}
                onClick={() => navigate(`/player/live`)}
                className="glass rounded-xl p-4 text-left hover:border-primary/50 transition-all group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center mb-3">
                  <Tv className="w-6 h-6 text-primary" />
                </div>
                <p className="font-semibold text-foreground text-sm truncate">{ch.name}</p>
                <p className="text-muted-foreground text-xs mt-1">{ch.category}</p>
                <div className="flex items-center gap-1 mt-2">
                  <Star className="w-3 h-3 text-accent fill-accent" />
                  <span className="text-xs text-accent">{ch.rating}</span>
                </div>
              </motion.button>
            ))}
          </div>
        </section>

        {/* Recent */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-muted-foreground" />
            <h2 className="font-display font-semibold text-xl text-foreground">Vistos Recientemente</h2>
          </div>
          <div className="space-y-2">
            {recentChannels.map((ch, i) => (
              <motion.button
                key={ch.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.1 }}
                onClick={() => navigate(`/player/live`)}
                className="w-full glass rounded-xl p-4 flex items-center justify-between hover:border-primary/50 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                    <Play className="w-5 h-5 text-primary" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-foreground text-sm">{ch.name}</p>
                    <p className="text-muted-foreground text-xs">{ch.time}</p>
                  </div>
                </div>
                <Play className="w-5 h-5 text-primary" />
              </motion.button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
