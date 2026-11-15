import {backendPreview} from './backend-preview.ts';
import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({server:{watch:{ignored:['**/target/**','**/data/**','**/shots/**','**/.npm-cache/**']},proxy:{'/api':'http://127.0.0.1:3847'}},preview:{proxy:{'/api':'http://127.0.0.1:3847'}},plugins:[backendPreview(),react(),tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./ui',import.meta.url))}},base:'./',build:{outDir:'dist'}});
