import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isLovablePreview = () => {
  const host = window.location.hostname;
  // Solo usar Supabase en los dominios de Lovable (preview/dev)
  // En VPS (localhost, LAN, Cloudflare tunnel, dominio propio) siempre usa API local Node.js
  return host.includes('lovable.app') || host.includes('lovable.dev') || host.includes('lovableproject.com');
};
