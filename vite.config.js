import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/haoyi.li/',
  plugins: [react()],
});
