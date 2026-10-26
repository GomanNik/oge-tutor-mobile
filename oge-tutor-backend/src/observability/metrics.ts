import { Controller, Get, Header, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/public.decorator';
import { notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';

const counters = { loginFailures: 0, accessDenials: 0, outboxDeliveryFailures: 0, learningDeliveryFailures: 0 };

export function recordHttpFailure(path: string, status: number) {
  if (status === 401 && (path === '/auth/login' || path === '/api/v2/auth/login')) counters.loginFailures += 1;
  if (status === 403 && path.startsWith('/api/v2/')) counters.accessDenials += 1;
}

export function recordOutboxDeliveryFailure() {
  counters.outboxDeliveryFailures += 1;
}
export function recordLearningDeliveryFailure() { counters.learningDeliveryFailures += 1; }

function equalToken(provided: string, configured: string) {
  const actual = Buffer.from(provided);
  const expected = Buffer.from(configured);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

@ApiExcludeController()
@Public()
@Controller('internal/metrics')
export class MetricsController {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(@Headers('authorization') authorization?: string) {
    const configured = this.config.get<string>('METRICS_TOKEN');
    if (!configured || !authorization?.startsWith('Bearer ') || !equalToken(authorization.slice(7), configured)) throw notFound();
    const [queued, failed, learningQueued, learningFailed, oldest] = await Promise.all([
      this.prisma.workspaceEmailOutbox.count({ where: { sentAt: null, canceledAt: null } }),
      this.prisma.workspaceEmailOutbox.count({ where: { sentAt: null, canceledAt: null, invitation: { deliveryStatus: 'failed' } } }),
      this.prisma.learningDelivery.count({ where: { status: { in: ['queued', 'processing'] } } }),
      this.prisma.learningDelivery.count({ where: { status: 'failed' } }),
      this.prisma.learningDelivery.findFirst({ where: { status: { in: ['queued', 'processing'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    return [
      '# TYPE oge_login_failures_total counter',
      `oge_login_failures_total ${counters.loginFailures}`,
      '# TYPE oge_access_denials_total counter',
      `oge_access_denials_total ${counters.accessDenials}`,
      '# TYPE oge_invitation_delivery_failures_total counter',
      `oge_invitation_delivery_failures_total ${counters.outboxDeliveryFailures}`,
      '# TYPE oge_invitation_outbox_queued gauge',
      `oge_invitation_outbox_queued ${queued}`,
      '# TYPE oge_invitation_outbox_failed gauge',
      `oge_invitation_outbox_failed ${failed}`,
      '# TYPE oge_learning_delivery_failures_total counter',
      `oge_learning_delivery_failures_total ${counters.learningDeliveryFailures}`,
      '# TYPE oge_learning_delivery_queued gauge',
      `oge_learning_delivery_queued ${learningQueued}`,
      '# TYPE oge_learning_delivery_failed gauge',
      `oge_learning_delivery_failed ${learningFailed}`,
      '# TYPE oge_learning_delivery_oldest_seconds gauge',
      `oge_learning_delivery_oldest_seconds ${oldest ? Math.max(0, Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000)) : 0}`,
      '',
    ].join('\n');
  }
}
