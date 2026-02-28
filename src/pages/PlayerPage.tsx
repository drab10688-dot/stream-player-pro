import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Volume2, VolumeX, Maximize, List, Search } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

const mockChannels = [
  { id: 1, name: 'ESPN HD', group: 'Deportes', url: '' },
  { id: 2, name: 'Fox Sports', group: 'Deportes', url: '' },
  { id: 3, name: 'ESPN 2', group: 'Deportes', url: '' },
  { id: 4, name: 'HBO Max', group: 'Entretenimiento', url: '' },
  { id: 5, name: 'TNT', group: 'Entretenimiento', url: '' },
  { id: 6, name: 'CNN en Español', group: 'Noticias', url: '' },
  { id: 7, name: 'Discovery Channel', group: 'Documentales', url: '' },
  { id: 8, name: 'National Geographic', group: 'Documentales', url: '' },
  { id: 9, name: 'Cartoon Network', group: 'Infantil', url: '' },
  { id: 10, name: 'Disney Channel', group: 'Infantil', url: '' },
  { id: 11, name: 'AMC', group: 'Películas', url: '' },
  { id: 12, name: 'Star Channel', group: 'Películas', url: '' },
];

const PlayerPage = () => {
  const navigate = useNavigate();
  const { category } = useParams();
  const [selectedChannel, setSelectedChannel] = useState(mockChannels[0]);
  const [muted, setMuted] = useState(false);
  const [showList, setShowList] = useState(true);
  const [search, setSearch] = useState('');

  const filteredChannels = mockChannels.filter(ch =>
    ch.name.toLowerCase().includes(search.toLowerCase())
  );

  const groups = [...new Set(filteredChannels.map(ch => ch.group))];

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">
      {/* Player Area */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 glass border-b border-border/50">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </Button>
            <div>
              <h1 className="font-display font-semibold text-foreground">{selectedChannel.name}</h1>
              <p className="text-xs text-muted-foreground">{selectedChannel.group}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setMuted(!muted)}>
              {muted ? <VolumeX className="w-5 h-5 text-muted-foreground" /> : <Volume2 className="w-5 h-5 text-foreground" />}
            </Button>
            <Button variant="ghost" size="icon">
              <Maximize className="w-5 h-5 text-foreground" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowList(!showList)} className="lg:hidden">
              <List className="w-5 h-5 text-foreground" />
            </Button>
          </div>
        </div>

        {/* Video Player */}
        <div className="flex-1 relative bg-black flex items-center justify-center min-h-[300px] lg:min-h-[500px]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center"
          >
            <div className="w-20 h-20 rounded-full gradient-primary flex items-center justify-center mx-auto mb-4 animate-pulse-glow cursor-pointer">
              <Play className="w-10 h-10 text-primary-foreground ml-1" />
            </div>
            <p className="text-foreground font-display font-semibold text-lg">{selectedChannel.name}</p>
            <p className="text-muted-foreground text-sm mt-1">Selecciona un canal para reproducir</p>
            <p className="text-muted-foreground text-xs mt-3 opacity-60">
              Conecta tu servidor Xtream UI para ver contenido en vivo
            </p>
          </motion.div>
        </div>
      </div>

      {/* Channel List Sidebar */}
      <motion.div
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: showList ? 0 : 300, opacity: showList ? 1 : 0 }}
        className={`${showList ? 'block' : 'hidden'} lg:block w-full lg:w-80 border-l border-border/50 bg-card/80 backdrop-blur-xl`}
      >
        <div className="p-4 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar canal..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-secondary border-border h-10 text-foreground placeholder:text-muted-foreground"
              maxLength={50}
            />
          </div>
        </div>
        <ScrollArea className="h-[calc(100vh-130px)]">
          <div className="p-3 space-y-4">
            {groups.map(group => (
              <div key={group}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">{group}</p>
                <div className="space-y-1">
                  {filteredChannels.filter(ch => ch.group === group).map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => setSelectedChannel(ch)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left ${
                        selectedChannel.id === ch.id
                          ? 'bg-primary/10 border border-primary/30'
                          : 'hover:bg-secondary'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full ${selectedChannel.id === ch.id ? 'bg-primary animate-pulse' : 'bg-muted-foreground/30'}`} />
                      <span className={`text-sm ${selectedChannel.id === ch.id ? 'text-primary font-semibold' : 'text-foreground'}`}>
                        {ch.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </motion.div>
    </div>
  );
};

export default PlayerPage;
