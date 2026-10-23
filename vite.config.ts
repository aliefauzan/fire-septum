/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { briefProxy } from './server/brief.ts';
import { firmsProxy } from './server/firmsProxy.ts';
import { receiptProxy } from './server/receipt.ts';
import { registerStore } from './server/register.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const get = (k: string) => env[k] || process.env[k];
  return {
    plugins: [
      react(),
      firmsProxy(() => get('FIRMS_MAP_KEY')),
      briefProxy(() => ({ baseUrl: get('LLM_BASE_URL'), apiKey: get('LLM_API_KEY'), model: get('LLM_MODEL') })),
      receiptProxy(() => get('RECEIPT_ED25519_KEY')),
      registerStore(),
    ],
    worker: { format: 'es' },
    test: { environment: 'node' },
  };
});
