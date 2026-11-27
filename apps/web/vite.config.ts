import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Tải trước font Inter (latin + tiếng Việt) song song với CSS → chữ không nhảy font khi mở trang */
function preloadFonts(): Plugin {
  return {
    name: 'mexo-preload-fonts',
    apply: 'build',
    transformIndexHtml(_html, ctx) {
      if (!ctx.bundle) return [];
      return Object.keys(ctx.bundle)
        .filter((f) => /inter-(latin|latin-ext|vietnamese)-wght-normal-[^/]+\.woff2$/.test(f))
        .map((f) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${f}`, crossorigin: '' }, injectTo: 'head' as const }));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFonts()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_URL || 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
