import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "omnisync-icon-192.png", "omnisync-icon-512.png"],
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/~oauth/],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            // API calls (Supabase / backend)
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
              networkTimeoutSeconds: 5,
            },
          },
          {
            // Channel logos and poster images
            urlPattern: /\.(png|jpg|jpeg|webp|gif|svg)(\?.*)?$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "image-cache",
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts / external fonts
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "font-cache",
              expiration: { maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Local API (VPS Node.js backend) — channels list, auth, etc.
            urlPattern: /\/api\//i,
            handler: "NetworkFirst",
            options: {
              cacheName: "local-api",
              expiration: { maxEntries: 50, maxAgeSeconds: 600 },
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "Omnisync TV",
        short_name: "Omnisync",
        description: "Tu televisión, en todas partes",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "landscape",
        scope: "/",
        start_url: "/",
        categories: ["entertainment", "video"],
        icons: [
          {
            src: "/omnisync-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/omnisync-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/omnisync-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
