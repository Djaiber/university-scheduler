import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@us/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts') },
  },
  server: {
    port: 5173,
    // En desarrollo la API corre en :3000; en AWS CloudFront enruta /v1/* al ALB (mismo origen)
    proxy: { '/v1': 'http://localhost:3000' },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
});
