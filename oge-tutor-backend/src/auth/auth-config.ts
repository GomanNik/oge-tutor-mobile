import { ConfigService } from '@nestjs/config';

const DEV_JWT_SECRET = 'dev-secret-change-me';
type JwtDurationUnit =
  | 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'
  | 'Msec' | 'Msecs' | 'Millisecond' | 'Milliseconds'
  | 'Sec' | 'Secs' | 'Second' | 'Seconds'
  | 'Min' | 'Mins' | 'Minute' | 'Minutes'
  | 'Hr' | 'Hrs' | 'Hour' | 'Hours'
  | 'Day' | 'Days' | 'Week' | 'Weeks'
  | 'Yr' | 'Yrs' | 'Year' | 'Years';
type JwtExpiresIn = number | `${number}` | `${number}${JwtDurationUnit}` | `${number} ${JwtDurationUnit}`;

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

export function getJwtExpiresIn(config: ConfigService): JwtExpiresIn {
  const configured = config.get<string | number>('JWT_EXPIRES_IN') || '7d';
  if (typeof configured === 'number') return configured;
  const seconds = Number(configured);
  if (Number.isInteger(seconds) && seconds > 0) return seconds;
  return configured as JwtExpiresIn;
}
