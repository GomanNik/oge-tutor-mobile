import { ConfigService } from '@nestjs/config';

const DEV_JWT_SECRET = 'dev-secret-change-me';

export function isProduction(config: ConfigService): boolean {
  return config.get<string>('NODE_ENV') === 'production';
}

export function getJwtSecret(config: ConfigService): string {
  const configured = config.get<string>('JWT_SECRET')?.trim();
  if (configured) return configured;
  if (isProduction(config)) {
    throw new Error('JWT_SECRET must be configured in production.');
  }
  return DEV_JWT_SECRET;
}

export function getJwtExpiresIn(config: ConfigService): string {
  return config.get<string>('JWT_EXPIRES_IN') || '7d';
}
