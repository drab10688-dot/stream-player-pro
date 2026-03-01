import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isLovablePreview = () => {
  const host = window.location.hostname;
  return host.includes('lovable.app') || host.includes('lovable.dev') || host.includes('lovableproject.com') || host === 'localhost';
};
