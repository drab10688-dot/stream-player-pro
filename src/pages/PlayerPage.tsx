import { useState, useEffect, useRef, useCallback } from 'react';
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
  const [showList, setShowList] = useState(false); // Hidden by default now
  const [search, setSearch] = useState('');
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();

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

  // Auto-hide controls after 4 seconds of inactivity
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!showList) setShowControls(false);
    }, 4000);
  }, [showList]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [resetHideTimer]);

  // Show controls when sidebar is open
  useEffect(() => {
    if (showList) {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      resetHideTimer();
    }
  }, [showList, resetHideTimer]);

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
    <div
      className="min-h-screen bg-black flex flex-col lg:flex-row relative"
      onMouseMove={resetHideTimer}
      onTouchStart={resetHideTimer}
    >
      {/* Player Area - Full screen */}
      <div className="flex-1 flex flex-col relative">
        {/* Top bar - Transparent, auto-hide */}
        <div
          className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/70 to-transparent transition-all duration-500 ${
            showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="h-10 w-10 rounded-xl hover:bg-white/10 text-white">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="w-7 h-7 rounded-full overflow-hidden">
              {selectedChannel.logo_url ? (
                <img
                  src={selectedChannel.logo_url}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).src = omnisyncLogo; }}
                />
              ) : (
                <img src={omnisyncLogo} alt="" className="w-full h-full object-cover" />
              )}
            </div>
            <div>
              <h1 className="font-semibold text-base text-white">{selectedChannel.name}</h1>
              <p className="text-xs text-white/60">{selectedChannel.category}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setMuted(!muted)} className="h-10 w-10 rounded-xl hover:bg-white/10 text-white">
              {muted ? <VolumeX className="w-5 h-5 text-white/60" /> : <Volume2 className="w-5 h-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowList(!showList)}
              className="h-10 w-10 rounded-xl hover:bg-white/10 text-white"
            >
              <List className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Video Player - Full area */}
        <div className="flex-1 relative bg-black min-h-[100vh] lg:min-h-0">
          <VideoPlayer src={selectedChannel.url} muted={muted} />

          {/* Ad Banner - Fixed bottom, auto-hide with controls */}
          {currentAd && (
            <div
              className={`absolute bottom-0 left-0 right-0 bg-gradient-to-r from-black/90 via-black/80 to-black/90 backdrop-blur-sm border-t border-primary/20 px-4 py-2.5 flex items-center gap-3 z-10 transition-all duration-500 ${
                showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'
              }`}
            >
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

      {/* Channel List Sidebar - Overlay style */}
      <div
        className={`fixed lg:absolute right-0 top-0 bottom-0 w-80 z-30 bg-background/95 backdrop-blur-xl border-l border-border/30 transition-transform duration-300 ${
          showList ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-border/30 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar canal..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-secondary/40 border-border/40 h-10 text-foreground text-sm placeholder:text-muted-foreground rounded-xl"
              maxLength={50}
            />
          </div>
          <Button variant="ghost" size="icon" onClick={() => setShowList(false)} className="h-10 w-10 rounded-xl shrink-0">
            <ArrowLeft className="w-4 h-4 text-foreground rotate-180" />
          </Button>
        </div>
        <ScrollArea className="h-[calc(100vh-80px)]">
          <div className="p-3 space-y-1">
            {filteredChannels.map(ch => (
              <button
                key={ch.id}
                tabIndex={0}
                onClick={() => {
                  setSelectedChannel(ch);
                  setShowList(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setSelectedChannel(ch);
                    setShowList(false);
                  }
                }}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 text-left tv-focusable ${
                  selectedChannel.id === ch.id
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-secondary/40 border border-transparent'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden ${
                  selectedChannel.id === ch.id ? 'bg-primary/20' : 'bg-secondary/60'
                }`}>
                  {ch.logo_url ? (
                    <img
                      src={ch.logo_url}
                      alt=""
                      className="w-full h-full object-cover rounded-lg"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        img.style.display = 'none';
                        if (img.nextElementSibling) (img.nextElementSibling as HTMLElement).style.display = 'block';
                      }}
                    />
                  ) : null}
                  <Play
                    className={`w-3.5 h-3.5 ${selectedChannel.id === ch.id ? 'text-primary' : 'text-muted-foreground'} ${ch.logo_url ? 'hidden' : ''}`}
                  />
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

      {/* Overlay backdrop when sidebar open on mobile */}
      {showList && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setShowList(false)}
        />
      )}
    </div>
  );
};

export default PlayerPage;
