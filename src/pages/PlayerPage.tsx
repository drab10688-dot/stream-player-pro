import { useState, useEffect } from 'react';
import { ArrowLeft, Volume2, VolumeX, List, Search, Play, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import VideoPlayer from '@/components/VideoPlayer';
import { useLocation } from 'react-router-dom';
import omnisyncLogo from '@/assets/omnisync-logo.png';

const PlayerPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { channels, ads } = useAuth();

  const initialChannel = location.state?.channel || channels[0];
  const [selectedChannel, setSelectedChannel] = useState(initialChannel);
  const [muted, setMuted] = useState(false);
  const [showList, setShowList] = useState(true);
  const [search, setSearch] = useState('');
  const [currentAdIndex, setCurrentAdIndex] = useState(0);

  const activeAds = ads.filter(ad => ad.title || ad.message);
  const currentAd = activeAds.length > 0 ? activeAds[currentAdIndex % activeAds.length] : null;

  // Rotate ads every 15 seconds
  useEffect(() => {
    if (activeAds.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentAdIndex(prev => (prev + 1) % activeAds.length);
    }, 15000);
    return () => clearInterval(interval);
  }, [activeAds.length]);

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
        <div className="flex items-center justify-between px-4 py-3 glass-strong border-b border-primary/5">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="h-10 w-10 rounded-xl hover:bg-secondary/60">
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </Button>
            <div className="w-7 h-7 rounded-full overflow-hidden">
              <img src={omnisyncLogo} alt="" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="font-semibold text-base text-foreground">{selectedChannel.name}</h1>
              <p className="text-xs text-muted-foreground">{selectedChannel.category}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setMuted(!muted)} className="h-10 w-10 rounded-xl">
              {muted ? <VolumeX className="w-5 h-5 text-muted-foreground" /> : <Volume2 className="w-5 h-5 text-foreground" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowList(!showList)} className="lg:hidden h-10 w-10 rounded-xl">
              <List className="w-5 h-5 text-foreground" />
            </Button>
          </div>
        </div>

        {/* Video Player */}
        <div className="flex-1 relative bg-black min-h-[300px] lg:min-h-[500px]">
          <VideoPlayer src={selectedChannel.url} muted={muted} />
          
          {/* Ad Banner - Fixed bottom */}
          {currentAd && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-black/90 via-black/80 to-black/90 backdrop-blur-sm border-t border-primary/20 px-4 py-2.5 flex items-center gap-3 z-10">
              <Bell className="w-4 h-4 text-primary shrink-0 animate-pulse" />
              <div className="flex items-center gap-2 overflow-hidden flex-1">
                <span className="font-semibold text-primary text-sm shrink-0">{currentAd.title}</span>
                <span className="text-white/70 text-sm truncate">{currentAd.message}</span>
              </div>
              {activeAds.length > 1 && (
                <span className="text-white/30 text-xs shrink-0">{(currentAdIndex % activeAds.length) + 1}/{activeAds.length}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Channel List Sidebar */}
      <div className={`${showList ? 'block' : 'hidden'} lg:block w-full lg:w-80 border-l border-border/30 glass-strong`}>
        <div className="p-4 border-b border-border/30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar canal..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-secondary/40 border-border/40 h-10 text-foreground text-sm placeholder:text-muted-foreground rounded-xl"
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
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 text-left ${
                  selectedChannel.id === ch.id
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-secondary/40 border border-transparent'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  selectedChannel.id === ch.id ? 'bg-primary/20' : 'bg-secondary/60'
                }`}>
                  {ch.logo_url ? (
                    <img src={ch.logo_url} alt="" className="w-full h-full object-cover rounded-lg" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <Play className={`w-3.5 h-3.5 ${selectedChannel.id === ch.id ? 'text-primary' : 'text-muted-foreground'}`} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className={`text-sm font-medium block truncate ${selectedChannel.id === ch.id ? 'text-primary' : 'text-foreground'}`}>
                    {ch.name}
                  </span>
                  <span className="text-xs text-muted-foreground truncate block">{ch.category}</span>
                </div>
                {selectedChannel.id === ch.id && (
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};

export default PlayerPage;
