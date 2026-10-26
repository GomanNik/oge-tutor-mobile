export type LegacyApiMode = 'enabled' | 'read_only' | 'disabled';
export function parseLegacyApiMode(value?: string): LegacyApiMode {
  const mode = value || 'enabled';
  if (!['enabled', 'read_only', 'disabled'].includes(mode)) throw new Error('LEGACY_API_MODE must be enabled, read_only or disabled.');
  return mode as LegacyApiMode;
}
export const legacyApiMode = () => parseLegacyApiMode(process.env.LEGACY_API_MODE);
export const legacyReadOnly = (isLegacy: unknown) => Boolean(isLegacy) && legacyApiMode() !== 'disabled';
export function isLegacyRoute(path: string) {
  return /^\/(auth|bootstrap|teacher|students|lessons|homeworks|files|materials|notifications|catalog)(\/|$)/.test(path);
}
export function isLegacyRequestAllowed(path: string, method: string, mode: LegacyApiMode) {
  if (!isLegacyRoute(path) || mode === 'enabled') return true;
  if (mode === 'disabled') return false;
  return ['GET', 'HEAD', 'OPTIONS'].includes(method) || path.startsWith('/auth/');
}
