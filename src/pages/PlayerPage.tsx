import { useState } from 'react';
import { ArrowLeft, Volume2, VolumeX, List, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import VideoPlayer from '@/components/VideoPlayer';
import { useLocation } from 'react-router-dom';

const PlayerPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { channels } = useAuth();

  const initialChannel = location.state?.channel || channels[0];
  const [selectedChannel, setSelectedChannel] = useState(initialChannel);
  const [muted, setMuted] = useState(false);
  const [showList, setShowList] = useState(true);
  const [search, setSearch] = useState('');

  const filteredChannels = channels.filter(ch =>
    ch.name.toLowerCase().includes(search.toLowerCase())
  );

  if (!selectedChannel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-xl">No hay canales disponibles</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">
      {/* Player Area */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 glass border-b border-border/50">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="h-12 w-12">
              <ArrowLeft className="w-6 h-6 text-foreground" />
            </Button>
            <div>
              <h1 className="font-display font-semibold text-lg text-foreground">{selectedChannel.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setMuted(!muted)} className="h-12 w-12">
              {muted ? <VolumeX className="w-6 h-6 text-muted-foreground" /> : <Volume2 className="w-6 h-6 text-foreground" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowList(!showList)} className="lg:hidden h-12 w-12">
              <List className="w-6 h-6 text-foreground" />
            </Button>
          </div>
        </div>

        {/* Video Player */}
        <div className="flex-1 relative bg-black min-h-[300px] lg:min-h-[500px]">
          <VideoPlayer src={selectedChannel.url} muted={muted} />
        </div>
      </div>

      {/* Channel List Sidebar - Simple flat list, no categories */}
      <div className={`${showList ? 'block' : 'hidden'} lg:block w-full lg:w-80 border-l border-border/50 bg-card/80 backdrop-blur-xl`}>
        <div className="p-4 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Buscar canal..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 bg-secondary border-border h-12 text-foreground text-base placeholder:text-muted-foreground"
              maxLength={50}
            />
          </div>
        </div>
        <ScrollArea className="h-[calc(100vh-130px)]">
          <div className="p-3 space-y-1">
            {filteredChannels.map(ch => (
              <button
                key={ch.id}
                onClick={() => setSelectedChannel(ch)}
                className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl transition-all text-left ${
                  selectedChannel.id === ch.id
                    ? 'bg-primary/15 border-2 border-primary/40'
                    : 'hover:bg-secondary border-2 border-transparent'
                }`}
              >
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${selectedChannel.id === ch.id ? 'bg-primary animate-pulse' : 'bg-muted-foreground/30'}`} />
                <span className={`text-base font-medium ${selectedChannel.id === ch.id ? 'text-primary font-bold' : 'text-foreground'}`}>
                  {ch.name}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};

export default PlayerPage;
