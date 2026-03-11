import { registerPlugin } from '@capacitor/core';

export interface VlcPlayerPlugin {
  play(options: { url: string; title?: string; autoplay?: boolean }): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  isPlaying(): Promise<{ playing: boolean }>;
  setVolume(options: { volume: number }): Promise<void>;
}

const VlcPlayer = registerPlugin<VlcPlayerPlugin>('VlcPlayer');

export default VlcPlayer;
