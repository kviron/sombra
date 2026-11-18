import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.', import.meta.url)),base:'./',plugins:[react(),tailwind()],build:{outDir:'preview-build',assetsInlineLimit:Infinity}});
