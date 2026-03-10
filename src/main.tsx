import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// Register service worker with auto-update (works in PWA + Capacitor APK)
registerSW({
  onRegisteredSW(swUrl, registration) {
    // Check for updates every 30 min
    if (registration) {
      setInterval(() => {
        registration.update();
      }, 30 * 60 * 1000);
    }
  },
  onOfflineReady() {
    console.log("App lista para uso offline");
  },
});

createRoot(document.getElementById("root")!).render(<App />);
