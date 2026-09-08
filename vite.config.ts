import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// This experience is deliberately local and static: no hosted runtime or accounts.
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: '127.0.0.1', port: 3000, strictPort: true,
    watch: {
      useFsEvents: false, usePolling: true, interval: 500,
      ignored: ['**/design/**', '**/research/**', '**/assets-source/**', '**/backups/**', '**/dist/**'],
    },
  },
  // Keep static export here so hosts do not mistake this Vinext app for Next.js.
  plugins: [vinext({ nextConfig: { output: 'export' } })],
});
