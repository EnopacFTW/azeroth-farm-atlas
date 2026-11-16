/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Tauri expects a fixed port in dev and no clearing of its console output.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1', watch: { ignored: ['**/src-tauri/**', '**/data-raw/**', '**/tests/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
