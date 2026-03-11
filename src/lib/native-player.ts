import { Capacitor } from '@capacitor/core';
import VlcPlayer from '@/plugins/VlcPlayer';

/**
 * Check if we're running on Android (Capacitor native)
 */
export const isNativeAndroid = (): boolean => {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
};

/**
 * Play a video using the native VLC player (Android only).
 * Falls back silently if not on Android.
 */
export const playWithVlc = async (url: string, title?: string): Promise<boolean> => {
  if (!isNativeAndroid()) return false;
  
  try {
    await VlcPlayer.play({ url, title, autoplay: true });
    return true;
  } catch (e) {
    console.warn('[VLC] Native play failed, falling back to web player', e);
    return false;
  }
};
