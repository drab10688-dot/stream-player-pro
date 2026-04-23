import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isLovablePreview = () => {
  const host = window.location.hostname;
  const port = window.location.port;
  const explicitLocalApi = import.meta.env.VITE_LOCAL_API_URL;

  if (explicitLocalApi) return false;

  // En preview interno del editor (vite :8080) usamos backend Cloud.
  // En panel desplegado detrás de Nginx/túnel/dominio propio siempre usamos la API local del VPS.
  return (host.includes('lovable.app') || host.includes('lovable.dev') || host.includes('lovableproject.com')) && port === '8080';
};
