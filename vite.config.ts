/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { defineConfig, loadEnv } from 'vite';
import { configDefaults } from 'vitest/config';
import { bmkgProxy } from './server/bmkg.ts';
import { briefProxy } from './server/brief.ts';
import { decisionsStore } from './server/decisions.ts';
import { evidenceStore } from './server/evidence.ts';
import { firmsProxy } from './server/firmsProxy.ts';
import { receiptProxy } from './server/receipt.ts';
import { registerStore } from './server/register.ts';

// Node's fetch gives each address family 250 ms to connect; FIRMS is often slower than that from
// Asia, and without an IPv6 route the proxies then fail with "fetch failed". Allow 3 s.
setDefaultAutoSelectFamilyAttemptTimeout(3000);

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
      decisionsStore(),
      evidenceStore(),
      bmkgProxy(() => get('SIPONGI_PERMISSION')),
    ],
    worker: { format: 'es' },
    // Agent worktrees under .claude/ hold other branches' copies of the tests.
    test: { environment: 'node', exclude: [...configDefaults.exclude, '.claude/**'] },
  };
});
