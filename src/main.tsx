import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Force clear old service workers and caches on load
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(reg => {
      reg.update();
    });
  });
  // Clear all caches to force fresh content
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(name => {
        if (name.includes('workbox') || name.includes('precache')) {
          caches.delete(name);
          console.log(`[SW] Cache cleared: ${name}`);
        }
      });
    });
  }
}

// Register service worker with auto-update
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (registration) {
      // Check for updates every 5 min (was 30)
      setInterval(() => registration.update(), 5 * 60 * 1000);
    }
  },
  onNeedRefresh() {
    // Auto-reload when new version is available
    updateSW(true);
  },
  onOfflineReady() {
    console.log("[SW] App ready offline");
  },
});

// App version for deployment verification
console.log("[Omnisync] v2.1.0 — HLS-only player");

createRoot(document.getElementById("root")!).render(<App />);
