import { defineConfig } from 'vite';

export default defineConfig({
  base: '/meshlang/',
  build: {
    target: 'ES2022',
    outDir: 'docs',
  },
});
