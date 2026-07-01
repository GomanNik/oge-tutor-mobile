export const API_TOKEN_KEY = 'oge-tutor-api-token';

export function getStoredApiToken() {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(API_TOKEN_KEY) || '';
}
