import {backendPreview} from './backend-preview.ts';
import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: {
    watch: {ignored: ['**/target/**', '**/data/**', '**/shots/**', '**/node_modules/**']},
    proxy: {'/api': 'http://127.0.0.1:3847'},
  },
  preview: {proxy: {'/api': 'http://127.0.0.1:3847'}},
  plugins: [backendPreview(), react(), tailwindcss()],
  resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
  base: './',
  build: {
    outDir: 'dist',
    rolldownOptions: {input: ['index.html', 'direct-message-popup.html']},
  },
});
