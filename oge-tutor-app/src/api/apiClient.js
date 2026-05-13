/*
 * OGE Tutor App — API adapter factory.
 * Real backend is the default production path. Mock backend is allowed only by explicit VITE_USE_MOCK=true.
 */
import { createHttpBackend } from './httpClient.js';
import { createMockBackend } from './mockBackend.js';

function isEnabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

export function createApiClient() {
  const env = import.meta.env || {};
  const baseUrl = String(env.VITE_API_BASE_URL || '').trim();
  const useMock = isEnabled(env.VITE_USE_MOCK);

  if (baseUrl) return createHttpBackend(baseUrl);
  if (useMock) return createMockBackend();

  throw new Error('Не задан VITE_API_BASE_URL. Для локального mock-режима явно установите VITE_USE_MOCK=true.');
}
