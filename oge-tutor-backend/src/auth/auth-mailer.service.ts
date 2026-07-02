import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { serviceUnavailable } from '../common/app-error';
import { ACCESS_TOKEN_TYPE, AccessTokenType } from '../common/contracts';
import { isProduction } from './auth-config';
import { AccessTokenDelivery, AccessTokenPreview } from './access-token.service';

export type AccessTokenMailResult = {
  status: 'sent' | 'dev_preview';
  provider: 'smtp' | 'noop';
};

type Template = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function templateFor(type: AccessTokenType, delivery: AccessTokenDelivery): Template {
  const link = delivery.link;
  const expiresAt = new Date(delivery.expiresAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const isInvite = type === ACCESS_TOKEN_TYPE.INVITE;
  const title = isInvite ? 'Доступ к кабинету OGE Tutor' : 'Сброс пароля OGE Tutor';
  const intro = isInvite
    ? 'Преподаватель создал для вас доступ к учебному кабинету OGE Tutor.'
    : 'Мы получили запрос на смену пароля в OGE Tutor.';
  const action = isInvite ? 'Задайте пароль по ссылке:' : 'Задайте новый пароль по ссылке:';
  const note = isInvite
    ? 'Если вы не ожидали это письмо, просто проигнорируйте его.'
    : 'Если вы не запрашивали смену пароля, просто проигнорируйте это письмо.';

  return {
    subject: title,
    text: [
      title,
      '',
      intro,
      action,
      link,
      '',
      `Ссылка действует до ${expiresAt}.`,
      note,
    ].join('\n'),
    html: [
      `<p>${escapeHtml(intro)}</p>`,
      `<p>${escapeHtml(action)}</p>`,
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
      `<p>Ссылка действует до ${escapeHtml(expiresAt)}.</p>`,
      `<p>${escapeHtml(note)}</p>`,
    ].join(''),
  };
}

@Injectable()
export class AuthMailerService {
  private readonly logger = new Logger(AuthMailerService.name);

  constructor(private readonly config: ConfigService) {}

  private provider(): 'noop' | 'smtp' {
    return this.config.get<'noop' | 'smtp'>('MAILER_PROVIDER') || (isProduction(this.config) ? 'smtp' : 'noop');
  }

  private smtpTransport() {
    return nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get('SMTP_PORT') || 587),
      secure: this.config.get<boolean>('SMTP_SECURE') === true || this.config.get<string>('SMTP_SECURE') === 'true',
      auth: this.config.get<string>('SMTP_USER')
        ? {
            user: this.config.get<string>('SMTP_USER'),
            pass: this.config.get<string>('SMTP_PASS'),
          }
        : undefined,
    });
  }

  async sendAccessTokenLink(params: {
    email: string;
    type: AccessTokenType;
    delivery: AccessTokenDelivery;
    preview?: AccessTokenPreview;
  }): Promise<AccessTokenMailResult> {
    const provider = this.provider();
    if (provider !== 'smtp') {
      if (isProduction(this.config)) {
        throw serviceUnavailable('Отправка писем не настроена.', { mailer: 'not_configured' });
      }
      this.logger.debug(`Dev mailer prepared ${params.type} link for ${params.email}.`);
      return { status: 'dev_preview', provider: 'noop' };
    }

    const from = this.config.get<string>('SMTP_FROM');
    if (!from) {
      throw serviceUnavailable('Отправка писем не настроена.', { mailer: 'missing_from' });
    }

    const message = templateFor(params.type, params.delivery);
    await this.smtpTransport().sendMail({
      from,
      to: params.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    return { status: 'sent', provider: 'smtp' };
  }
}
