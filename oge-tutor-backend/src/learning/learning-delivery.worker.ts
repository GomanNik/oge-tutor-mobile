import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { LearningDeliveryStatus } from '@prisma/client';
import { AuthMailerService } from '../auth/auth-mailer.service';
import { AppError } from '../common/app-error';
import { LearningAccessService } from './learning-access.service';
import { recordLearningDeliveryFailure } from '../observability/metrics';

export const DELIVERY_MAX_ATTEMPTS = 5;
export const deliveryBackoffMs = (attempt: number) => Math.min(3600000, 30000 * 2 ** Math.max(0, attempt - 1));
export function deliveryErrorCode(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  return typeof code === 'string' && ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EMESSAGE'].includes(code) ? code : 'delivery_failed';
}

@Injectable()
export class LearningDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LearningDeliveryWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly access: LearningAccessService, private readonly mailer: AuthMailerService, private readonly config: ConfigService) {}
  onModuleInit() {
    if (this.config.get('NODE_ENV') === 'test' || this.config.get('LEARNING_NOTIFICATIONS_WORKER_ENABLED') === 'false') return;
    this.timer = setInterval(() => { void this.runBatch().catch(() => this.logger.error('Notification delivery sweep failed.')); }, 5000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async runBatch(limit = 20) {
    if (this.running) return 0;
    this.running = true;
    let handled = 0;
    try {
      for (let i = 0; i < Math.min(50, Math.max(1, limit)); i++) {
        const token = randomUUID();
        const job = await this.access.prisma.$transaction(async tx => {
          await tx.learningDelivery.updateMany({ where: { status: 'processing', lockedUntil: { lt: new Date() }, attempts: { gte: DELIVERY_MAX_ATTEMPTS } }, data: { status: 'failed', lastErrorCode: 'lease_expired', lockToken: null, lockedUntil: null, revision: { increment: 1 } } });
          const ids = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "LearningDelivery" WHERE attempts < ${DELIVERY_MAX_ATTEMPTS} AND ((status='queued' AND "availableAt" <= NOW()) OR (status='processing' AND "lockedUntil" < NOW())) ORDER BY "availableAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
          if (!ids.length) return null;
          return tx.learningDelivery.update({ where: { id: ids[0].id }, data: { status: 'processing', attempts: { increment: 1 }, lockedUntil: new Date(Date.now() + 90000), lockToken: token, revision: { increment: 1 } }, include: { notification: { include: { recipient: true } } } });
        });
        if (!job) break;
        let status: LearningDeliveryStatus = 'skipped';
        let provider = '';
        let errorCode = '';
        try {
          const notice = job.notification;
          const preference = await this.access.prisma.learningNotificationPreference.findUnique({ where: { workspaceId_userId: { workspaceId: notice.workspaceId, userId: notice.recipientUserId } } });
          if (!preference?.emailEnabled) errorCode = 'email_disabled';
          else {
            const ctx = { userId: notice.recipientUserId, workspaceId: notice.workspaceId, role: notice.recipientRole, sessionId: '', requestId: `delivery:${job.id}` };
            try { await this.access.transaction(ctx, tx => this.access.target(tx, ctx, notice.targetType, notice.targetId)); }
            catch (error) { if (error instanceof AppError && [403, 404].includes(error.status)) errorCode = 'access_revoked'; else throw error; }
            if (!errorCode) {
              const result = await this.mailer.sendLearningNotification({ email: notice.recipient.email, notificationId: notice.id, workspaceId: notice.workspaceId, role: notice.recipientRole });
              provider = result.provider;
              status = result.status;
            }
          }
        } catch (error) {
          recordLearningDeliveryFailure();
          errorCode = deliveryErrorCode(error);
          status = job.attempts >= DELIVERY_MAX_ATTEMPTS ? 'failed' : 'queued';
        }
        await this.access.prisma.learningDelivery.updateMany({ where: { id: job.id, status: 'processing', lockToken: token }, data: {
          status, provider, lastErrorCode: errorCode, lockedUntil: null, lockToken: null,
          availableAt: status === 'queued' ? new Date(Date.now() + deliveryBackoffMs(job.attempts)) : job.availableAt,
          deliveredAt: ['sent', 'dev_preview'].includes(status) ? new Date() : null, revision: { increment: 1 },
        } });
        handled++;
      }
      return handled;
    } finally { this.running = false; }
  }
}
