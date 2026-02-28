import { useState } from 'react';
import { ArrowLeft, Volume2, VolumeX, List, Search } from 'lucide-react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import VideoPlayer from '@/components/VideoPlayer';

const PlayerPage = () => {
  const navigate = useNavigate();
  const { category } = useParams();
  const location = useLocation();
  const { channels } = useAuth();

  // Get initial channel from navigation state or first channel
  const initialChannel = location.state?.channel || channels[0];
  const [selectedChannel, setSelectedChannel] = useState(initialChannel);
  const [muted, setMuted] = useState(false);
  const [showList, setShowList] = useState(true);
  const [search, setSearch] = useState('');

  const filteredChannels = channels.filter(ch =>
    ch.name.toLowerCase().includes(search.toLowerCase())
  );

  const groups = [...new Set(filteredChannels.map(ch => ch.category))];

  if (!selectedChannel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">No hay canales disponibles</p>
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
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </Button>
            <div>
              <h1 className="font-display font-semibold text-foreground">{selectedChannel.name}</h1>
              <p className="text-xs text-muted-foreground">{selectedChannel.category}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setMuted(!muted)}>
              {muted ? <VolumeX className="w-5 h-5 text-muted-foreground" /> : <Volume2 className="w-5 h-5 text-foreground" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowList(!showList)} className="lg:hidden">
              <List className="w-5 h-5 text-foreground" />
            </Button>
          </div>
        </div>

        {/* Video Player */}
        <div className="flex-1 relative bg-black min-h-[300px] lg:min-h-[500px]">
          <VideoPlayer src={selectedChannel.url} muted={muted} />
        </div>
      </div>

      {/* Channel List Sidebar */}
      <div className={`${showList ? 'block' : 'hidden'} lg:block w-full lg:w-80 border-l border-border/50 bg-card/80 backdrop-blur-xl`}>
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
                  {filteredChannels.filter(ch => ch.category === group).map(ch => (
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
      </div>
    </div>
  );
};

export default PlayerPage;
