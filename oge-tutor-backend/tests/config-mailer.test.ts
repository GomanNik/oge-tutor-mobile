import { describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { validateEnv } from '../src/config/env.validation';
import { AuthMailerService } from '../src/auth/auth-mailer.service';
import { ACCESS_TOKEN_TYPE } from '../src/common/contracts';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(async () => ({ accepted: ['student@mail.ru'] })),
    })),
  },
}));

function config(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as any;
}

describe('environment validation', () => {
  it('requires production secrets and public URLs', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app',
      JWT_SECRET: 'dev-secret-change-me',
      PUBLIC_BACKEND_URL: 'https://api.example.com',
      APP_FRONTEND_URL: 'https://app.example.com',
      MAILER_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      SMTP_FROM: 'OGE Tutor <no-reply@example.com>',
    })).toThrow(/JWT_SECRET/);
  });

  it('accepts complete production SMTP configuration', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app',
      JWT_SECRET: 'safe-production-secret',
      PUBLIC_BACKEND_URL: 'https://api.example.com',
      APP_FRONTEND_URL: 'https://app.example.com',
      MAILER_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      SMTP_FROM: 'OGE Tutor <no-reply@example.com>',
    });

    expect(env.MAILER_PROVIDER).toBe('smtp');
    expect(env.SMTP_PORT).toBe(465);
    expect(env.SMTP_SECURE).toBe(true);
  });

  it('allows explicit non-production noop mailer fallback', () => {
    const env = validateEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app_test',
    });

    expect(env.MAILER_PROVIDER).toBe('noop');
    expect(env.JWT_SECRET).toBe('dev-secret-change-me');
  });
});

describe('auth mailer', () => {
  const delivery = {
    link: 'https://app.example.com/setup-password?token=secret-token',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  it('uses dev preview without SMTP outside production', async () => {
    const service = new AuthMailerService(config({ NODE_ENV: 'test', MAILER_PROVIDER: 'noop' }));

    await expect(service.sendAccessTokenLink({
      email: 'student@mail.ru',
      type: ACCESS_TOKEN_TYPE.INVITE,
      delivery,
      preview: { token: 'secret-token', ...delivery },
    })).resolves.toEqual({ status: 'dev_preview', provider: 'noop' });
  });

  it('sends invite email through SMTP provider', async () => {
    const service = new AuthMailerService(config({
      NODE_ENV: 'production',
      MAILER_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      SMTP_FROM: 'OGE Tutor <no-reply@example.com>',
    }));

    await expect(service.sendAccessTokenLink({
      email: 'student@mail.ru',
      type: ACCESS_TOKEN_TYPE.INVITE,
      delivery,
    })).resolves.toEqual({ status: 'sent', provider: 'smtp' });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      port: 587,
    }));
  });

  it('does not pretend to send mail in production noop mode', async () => {
    const service = new AuthMailerService(config({ NODE_ENV: 'production', MAILER_PROVIDER: 'noop' }));

    await expect(service.sendAccessTokenLink({
      email: 'student@mail.ru',
      type: ACCESS_TOKEN_TYPE.PASSWORD_RESET,
      delivery,
    })).rejects.toMatchObject({ code: 'service_unavailable' });
  });
});
