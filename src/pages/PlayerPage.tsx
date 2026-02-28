import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Volume2, VolumeX, List, Search, Play, Bell, Hash, Menu, ChevronUp, ChevronDown } from 'lucide-react';
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
  const { channels, ads, reportChannelError } = useAuth();

  const initialChannel = location.state?.channel || channels[0];
  const [selectedChannel, setSelectedChannel] = useState(initialChannel);
  const [muted, setMuted] = useState(false);
  const [showList, setShowList] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [numberBuffer, setNumberBuffer] = useState('');
  const [showNumberOverlay, setShowNumberOverlay] = useState(false);
  const [channelIndicator, setChannelIndicator] = useState<{ name: string; num: number } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const numberTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const channelListRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const activeAds = ads.filter(ad => ad.title || ad.message);
  const currentAd = activeAds.length > 0 ? activeAds[currentAdIndex % activeAds.length] : null;

  const currentIndex = channels.findIndex(ch => ch.id === selectedChannel?.id);

  // Show channel change indicator
  const showChannelChange = useCallback((channel: typeof channels[0], idx: number) => {
    setChannelIndicator({ name: channel.name, num: idx + 1 });
    setTimeout(() => setChannelIndicator(null), 2500);
  }, []);

  // Change channel helper
  const changeChannel = useCallback((channel: typeof channels[0]) => {
    setSelectedChannel(channel);
    setShowList(false);
    setShowSearch(false);
    setSearch('');
    const idx = channels.findIndex(ch => ch.id === channel.id);
    showChannelChange(channel, idx);
    // Auto-hide controls after channel selection
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 2500);
  }, [channels, showChannelChange]);

  // Rotate ads
  useEffect(() => {
    if (activeAds.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentAdIndex(prev => (prev + 1) % activeAds.length);
    }, 15000);
    return () => clearInterval(interval);
  }, [activeAds.length]);

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!showList && !showSearch) setShowControls(false);
    }, 4000);
  }, [showList, showSearch]);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [resetHideTimer]);

  useEffect(() => {
    if (showList || showSearch) {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      resetHideTimer();
    }
  }, [showList, showSearch, resetHideTimer]);

  useEffect(() => {
    if (showSearch) setTimeout(() => searchInputRef.current?.focus(), 100);
  }, [showSearch]);

  // Navigate to channel by number
  const goToChannelByNumber = useCallback((num: string) => {
    const idx = parseInt(num, 10) - 1;
    if (idx >= 0 && idx < channels.length) {
      changeChannel(channels[idx]);
    }
    setNumberBuffer('');
    setTimeout(() => setShowNumberOverlay(false), 800);
  }, [channels, changeChannel]);

  // Touch/swipe handling for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    // Only vertical swipe (ignore horizontal)
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) {
        // Swipe up → next channel
        const nextIdx = currentIndex < channels.length - 1 ? currentIndex + 1 : 0;
        changeChannel(channels[nextIdx]);
      } else {
        // Swipe down → prev channel
        const prevIdx = currentIndex > 0 ? currentIndex - 1 : channels.length - 1;
        changeChannel(channels[prevIdx]);
      }
    } else if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
      // Tap → toggle controls
      resetHideTimer();
    }
  }, [currentIndex, channels, changeChannel, resetHideTimer]);

  // Keyboard / remote control navigation
  useEffect(() => {
    if (showSearch) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key) && !showList) {
        e.preventDefault();
        resetHideTimer();
        const newBuffer = numberBuffer + e.key;
        setNumberBuffer(newBuffer);
        setShowNumberOverlay(true);
        if (numberTimerRef.current) clearTimeout(numberTimerRef.current);
        numberTimerRef.current = setTimeout(() => goToChannelByNumber(newBuffer), 1500);
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
        case 'ChannelUp':
          e.preventDefault();
          resetHideTimer();
          if (!showList) {
            const prevIdx = currentIndex > 0 ? currentIndex - 1 : channels.length - 1;
            changeChannel(channels[prevIdx]);
          }
          break;
        case 'ArrowDown':
        case 'ChannelDown':
          e.preventDefault();
          resetHideTimer();
          if (!showList) {
            const nextIdx = currentIndex < channels.length - 1 ? currentIndex + 1 : 0;
            changeChannel(channels[nextIdx]);
          }
          break;
        case 'ArrowLeft':
          if (!showList && !showSearch) {
            e.preventDefault();
            resetHideTimer();
            setMuted(true);
          }
          break;
        case 'ArrowRight':
          if (!showList && !showSearch) {
            e.preventDefault();
            resetHideTimer();
            setMuted(false);
          }
          break;
        case 'Enter':
        case ' ':
          if (!showList && !showSearch) {
            e.preventDefault();
            resetHideTimer();
            setShowControls(prev => !prev);
          }
          break;
        case 'Escape':
        case 'Backspace':
          if (showSearch) {
            setShowSearch(false);
            setSearch('');
          } else if (showList) {
            setShowList(false);
          } else {
            navigate('/channels');
          }
          e.preventDefault();
          break;
        case 'l': case 'L':
          if (!showSearch) { e.preventDefault(); setShowList(!showList); }
          break;
        case 's': case 'S': case 'f': case 'F':
          if (!showList) { e.preventDefault(); setShowSearch(!showSearch); }
          break;
        case 'm': case 'M':
          e.preventDefault(); setMuted(!muted); resetHideTimer();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (numberTimerRef.current) clearTimeout(numberTimerRef.current);
    };
  }, [showList, showSearch, currentIndex, channels, muted, numberBuffer, navigate, resetHideTimer, goToChannelByNumber, changeChannel]);

  const filteredChannels = channels.filter(ch =>
    ch.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectFromSearch = (ch: typeof channels[0]) => {
    changeChannel(ch);
    setShowSearch(false);
    setSearch('');
  };

  if (!selectedChannel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-xl">No hay canales disponibles</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-black flex flex-col lg:flex-row relative touch-pan-y"
      onMouseMove={resetHideTimer}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Player Area */}
      <div className="flex-1 flex flex-col relative">
        {/* Top bar */}
        <div
          className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 sm:px-5 py-3 sm:py-4 bg-gradient-to-b from-black/80 to-transparent transition-all duration-500 ${
            showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/channels')} className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl hover:bg-white/10 text-white tv-focusable" tabIndex={0}>
              <Menu className="w-5 h-5 sm:w-6 sm:h-6" />
            </Button>
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full overflow-hidden">
              {selectedChannel.logo_url ? (
                <img src={selectedChannel.logo_url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = omnisyncLogo; }} />
              ) : (
                <img src={omnisyncLogo} alt="" className="w-full h-full object-cover" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white/50 text-xs sm:text-sm font-mono bg-white/10 px-1.5 sm:px-2 py-0.5 rounded">{currentIndex + 1}</span>
                <h1 className="font-semibold text-sm sm:text-lg 2xl:text-xl text-white truncate max-w-[150px] sm:max-w-none">{selectedChannel.name}</h1>
              </div>
              <p className="text-xs sm:text-sm text-white/60">{selectedChannel.category}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setShowSearch(!showSearch)} className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl hover:bg-white/10 text-white tv-focusable" tabIndex={0}>
              <Search className="w-5 h-5 sm:w-6 sm:h-6" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setMuted(!muted)} className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl hover:bg-white/10 text-white tv-focusable" tabIndex={0}>
              {muted ? <VolumeX className="w-5 h-5 sm:w-6 sm:h-6 text-white/60" /> : <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowList(!showList)} className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl hover:bg-white/10 text-white tv-focusable" tabIndex={0}>
              <List className="w-5 h-5 sm:w-6 sm:h-6" />
            </Button>
          </div>
        </div>

        {/* Channel change indicator */}
        {channelIndicator && (
          <div className="absolute top-20 sm:top-24 left-1/2 -translate-x-1/2 z-30 animate-channel-change">
            <div className="bg-black/85 backdrop-blur-md rounded-2xl px-6 sm:px-8 py-4 sm:py-5 flex items-center gap-4 border border-white/10 shadow-2xl">
              <span className="text-primary text-2xl sm:text-4xl 2xl:text-5xl font-bold font-mono">{channelIndicator.num}</span>
              <div className="w-px h-8 bg-white/20" />
              <span className="text-white text-base sm:text-xl 2xl:text-2xl font-medium truncate max-w-[200px] sm:max-w-[300px]">{channelIndicator.name}</span>
            </div>
          </div>
        )}

        {/* Number input overlay */}
        {showNumberOverlay && (
          <div className="absolute top-20 sm:top-24 right-6 z-30 bg-black/85 backdrop-blur-md rounded-2xl px-6 sm:px-8 py-4 sm:py-5 flex items-center gap-3 border border-white/10 shadow-2xl">
            <Hash className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            <span className="text-white text-3xl sm:text-4xl 2xl:text-5xl font-bold font-mono tracking-wider">{numberBuffer || '_'}</span>
          </div>
        )}

        {/* Search overlay */}
        {showSearch && (
          <div className="absolute top-16 sm:top-20 left-0 right-0 z-30 px-3 sm:px-4 pt-2">
            <div className="max-w-lg mx-auto bg-black/90 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
              <div className="p-3 sm:p-4 flex items-center gap-2">
                <Search className="w-4 h-4 sm:w-5 sm:h-5 text-white/50 shrink-0" />
                <Input
                  ref={searchInputRef}
                  placeholder="Buscar canal por nombre..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowSearch(false); setSearch(''); }
                    if (e.key === 'Enter' && filteredChannels.length > 0) selectFromSearch(filteredChannels[0]);
                  }}
                  className="bg-transparent border-none text-white placeholder:text-white/40 h-10 sm:h-11 text-base sm:text-lg focus-visible:ring-0"
                  maxLength={50}
                />
                <Button variant="ghost" size="sm" onClick={() => { setShowSearch(false); setSearch(''); }} className="text-white/50 hover:text-white h-10 w-10 tv-focusable">
                  ✕
                </Button>
              </div>
              {search && (
                <div className="border-t border-white/10 max-h-72 overflow-y-auto">
                  {filteredChannels.length === 0 ? (
                    <p className="text-white/40 text-sm sm:text-base text-center py-6">No se encontraron canales</p>
                  ) : (
                    filteredChannels.slice(0, 15).map((ch) => (
                      <button
                        key={ch.id}
                        onClick={() => selectFromSearch(ch)}
                        className="w-full flex items-center gap-3 px-4 py-3 sm:py-3.5 hover:bg-white/10 transition-colors text-left tv-focusable"
                        tabIndex={0}
                      >
                        <span className="text-white/30 text-xs sm:text-sm font-mono w-7">{channels.indexOf(ch) + 1}</span>
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded overflow-hidden shrink-0">
                          {ch.logo_url ? (
                            <img src={ch.logo_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-white/10 flex items-center justify-center">
                              <Play className="w-3 h-3 text-white/40" />
                            </div>
                          )}
                        </div>
                        <span className="text-white text-sm sm:text-base truncate">{ch.name}</span>
                        <span className="text-white/30 text-xs sm:text-sm ml-auto">{ch.category}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mobile channel navigation hints */}
        <div className={`absolute right-3 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-1 transition-opacity duration-500 sm:hidden ${showControls ? 'opacity-60' : 'opacity-0'}`}>
          <ChevronUp className="w-5 h-5 text-white/50" />
          <span className="text-white/40 text-[10px] font-mono">{currentIndex + 1}/{channels.length}</span>
          <ChevronDown className="w-5 h-5 text-white/50" />
        </div>

        {/* Video Player */}
        <div className="flex-1 relative bg-black min-h-[100vh] lg:min-h-0">
          <VideoPlayer
            src={selectedChannel.url}
            channelId={selectedChannel.id}
            muted={muted}
            onError={(msg) => reportChannelError(selectedChannel.id, msg)}
          />

          {/* Ad Banner */}
          {currentAd && (
            <div
              className={`absolute bottom-0 left-0 right-0 bg-gradient-to-r from-black/90 via-black/80 to-black/90 backdrop-blur-sm border-t border-primary/20 px-4 sm:px-6 py-2.5 sm:py-3 flex items-center gap-3 z-10 transition-all duration-500 ${
                showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'
              }`}
            >
              <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-primary shrink-0 animate-pulse" />
              <div className="flex items-center gap-2 overflow-hidden flex-1">
                <span className="font-semibold text-primary text-sm sm:text-base shrink-0">{currentAd.title}</span>
                <span className="text-white/70 text-sm sm:text-base truncate">{currentAd.message}</span>
              </div>
              {activeAds.length > 1 && (
                <span className="text-white/30 text-xs shrink-0">{(currentAdIndex % activeAds.length) + 1}/{activeAds.length}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Channel List Sidebar */}
      <div
        ref={channelListRef}
        className={`fixed lg:absolute right-0 top-0 bottom-0 w-80 sm:w-96 z-30 bg-background/95 backdrop-blur-xl border-l border-border/30 transition-transform duration-300 ${
          showList ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-3 sm:p-4 border-b border-border/30 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar canal..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-secondary/40 border-border/40 h-11 sm:h-12 text-foreground text-sm sm:text-base placeholder:text-muted-foreground rounded-xl"
              maxLength={50}
            />
          </div>
          <Button variant="ghost" size="icon" onClick={() => setShowList(false)} className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl shrink-0 tv-focusable">
            <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-foreground rotate-180" />
          </Button>
        </div>
        <ScrollArea className="h-[calc(100vh-80px)]">
          <div className="p-2 sm:p-3 space-y-1">
            {filteredChannels.map((ch) => (
              <button
                key={ch.id}
                tabIndex={0}
                onClick={() => { changeChannel(ch); setShowList(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { changeChannel(ch); setShowList(false); } }}
                className={`w-full flex items-center gap-3 px-3 py-3 sm:py-3.5 rounded-xl transition-all duration-200 text-left tv-focusable ${
                  selectedChannel.id === ch.id
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-secondary/40 border border-transparent'
                }`}
              >
                <span className="text-muted-foreground text-xs sm:text-sm font-mono w-6 text-right shrink-0">{channels.indexOf(ch) + 1}</span>
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden ${
                  selectedChannel.id === ch.id ? 'bg-primary/20' : 'bg-secondary/60'
                }`}>
                  {ch.logo_url ? (
                    <img src={ch.logo_url} alt="" className="w-full h-full object-cover rounded-lg" onError={(e) => { const img = e.target as HTMLImageElement; img.style.display = 'none'; }} />
                  ) : null}
                  <Play className={`w-4 h-4 ${selectedChannel.id === ch.id ? 'text-primary' : 'text-muted-foreground'} ${ch.logo_url ? 'hidden' : ''}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className={`text-sm sm:text-base font-medium block truncate ${selectedChannel.id === ch.id ? 'text-primary' : 'text-foreground'}`}>
                    {ch.name}
                  </span>
                  <span className="text-xs sm:text-sm text-muted-foreground truncate block">{ch.category}</span>
                </div>
                {selectedChannel.id === ch.id && (
                  <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse shrink-0" />
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Overlay backdrop */}
      {showList && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setShowList(false)} />
      )}
    </div>
  );
};

export default PlayerPage;
