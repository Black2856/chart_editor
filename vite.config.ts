/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: './',
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
