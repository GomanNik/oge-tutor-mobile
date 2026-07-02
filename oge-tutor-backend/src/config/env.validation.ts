type RawEnv = Record<string, unknown>;

const DEV_JWT_SECRET = 'dev-secret-change-me';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function optionalText(env: RawEnv, key: string): string | undefined {
  const value = text(env[key]);
  return value || undefined;
}

function requireText(env: RawEnv, key: string): string {
  const value = optionalText(env, key);
  if (!value) throw new Error(`${key} must be configured.`);
  return value;
}

function requireUrl(env: RawEnv, key: string): string {
  const value = requireText(env, key);
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:', 'postgresql:', 'postgres:'].includes(parsed.protocol)) {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error(`${key} must be a valid URL.`);
  }
  return value.replace(/\/$/, '');
}

function requireHttpUrl(env: RawEnv, key: string): string {
  const value = requireText(env, key);
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new Error(`${key} must be a valid http(s) URL.`);
  }
  return value.replace(/\/$/, '');
}

function numberWithDefault(env: RawEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = optionalText(env, key);
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export function isProductionEnv(env: RawEnv): boolean {
  return text(env.NODE_ENV) === 'production';
}

export function validateEnv(env: RawEnv) {
  const nodeEnv = optionalText(env, 'NODE_ENV') || 'development';
  const production = nodeEnv === 'production';
  const mailerProvider = optionalText(env, 'MAILER_PROVIDER') || (production ? 'smtp' : 'noop');

  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test or production.');
  }
  if (!['noop', 'smtp'].includes(mailerProvider)) {
    throw new Error('MAILER_PROVIDER must be noop or smtp.');
  }

  const databaseUrl = requireUrl(env, 'DATABASE_URL');
  const jwtSecret = production ? requireText(env, 'JWT_SECRET') : optionalText(env, 'JWT_SECRET') || DEV_JWT_SECRET;
  if (production && jwtSecret === DEV_JWT_SECRET) {
    throw new Error('JWT_SECRET must not use the development fallback in production.');
  }

  const publicBackendUrl = production
    ? requireHttpUrl(env, 'PUBLIC_BACKEND_URL')
    : (optionalText(env, 'PUBLIC_BACKEND_URL') || 'http://localhost:3000').replace(/\/$/, '');
  const appFrontendUrl = production
    ? requireHttpUrl(env, 'APP_FRONTEND_URL')
    : (optionalText(env, 'APP_FRONTEND_URL') || optionalText(env, 'FRONTEND_ORIGIN') || 'http://localhost:5173').replace(/\/$/, '');

  const smtpHost = optionalText(env, 'SMTP_HOST');
  const smtpUser = optionalText(env, 'SMTP_USER');
  const smtpPass = optionalText(env, 'SMTP_PASS');
  const smtpFrom = optionalText(env, 'SMTP_FROM');
  const smtpPort = numberWithDefault(env, 'SMTP_PORT', 587, 1, 65535);
  const smtpSecure = optionalText(env, 'SMTP_SECURE') === 'true';

  if (production && mailerProvider !== 'smtp') {
    throw new Error('MAILER_PROVIDER=smtp is required in production.');
  }
  if (mailerProvider === 'smtp') {
    if (!smtpHost) throw new Error('SMTP_HOST must be configured when MAILER_PROVIDER=smtp.');
    if (!smtpFrom) throw new Error('SMTP_FROM must be configured when MAILER_PROVIDER=smtp.');
    if (production && !smtpUser) throw new Error('SMTP_USER must be configured in production SMTP mode.');
    if (production && !smtpPass) throw new Error('SMTP_PASS must be configured in production SMTP mode.');
    if ((smtpUser && !smtpPass) || (!smtpUser && smtpPass)) {
      throw new Error('SMTP_USER and SMTP_PASS must be configured together.');
    }
  }

  return {
    ...env,
    NODE_ENV: nodeEnv,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: optionalText(env, 'JWT_EXPIRES_IN') || '7d',
    PORT: numberWithDefault(env, 'PORT', 3000, 1, 65535),
    PUBLIC_BACKEND_URL: publicBackendUrl,
    APP_FRONTEND_URL: appFrontendUrl,
    FRONTEND_ORIGIN: optionalText(env, 'FRONTEND_ORIGIN') || appFrontendUrl,
    UPLOAD_DIR: optionalText(env, 'UPLOAD_DIR') || 'uploads',
    MAX_UPLOAD_BYTES: numberWithDefault(env, 'MAX_UPLOAD_BYTES', 15 * 1024 * 1024, 1, 100 * 1024 * 1024),
    MAILER_PROVIDER: mailerProvider,
    SMTP_HOST: smtpHost,
    SMTP_PORT: smtpPort,
    SMTP_USER: smtpUser,
    SMTP_PASS: smtpPass,
    SMTP_FROM: smtpFrom,
    SMTP_SECURE: smtpSecure,
  };
}
