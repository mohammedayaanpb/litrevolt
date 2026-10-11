import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron', 'better-sqlite3', '@napi-rs/canvas', '@napi-rs/keyring', 'pdfjs-dist/legacy/build/pdf.mjs'],
    },
  },
});
