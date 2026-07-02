import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import process from 'node:process';
import { URL } from 'node:url';

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const baseUrl = String(env.VITE_API_BASE_URL || '').trim();
  const useMock = String(env.VITE_USE_MOCK || '').toLowerCase() === 'true';

  if (command === 'build') {
    if (!baseUrl || !isHttpUrl(baseUrl)) {
      throw new Error('VITE_API_BASE_URL must be a valid http(s) URL for production builds.');
    }
    if (useMock) {
      throw new Error('VITE_USE_MOCK=true is not allowed for production builds.');
    }
  }

  return {
    plugins: [react()],
  };
});
