import { Injectable } from '@nestjs/common';
import { LearningNotification, Prisma } from '@prisma/client';
import { forbidden, notFound, validationError } from '../common/app-error';
import { WorkspaceContext } from '../workspace/workspace-context.service';
import { checkRevision } from '../assignments/work-access.service';
import { DeliveryQueryDto, MarkNotificationDto, NotificationPreferenceDto, NotificationQueryDto, ReadAllNotificationsDto, RetryDeliveryDto } from './learning.dto';
import { LearningAccessService, learningConflict, learningCursor, parseLearningCursor } from './learning-access.service';
import { legacyApiMode } from '../workspace/legacy-mode';

export const notificationDto = (row: LearningNotification) => ({ id: row.id, type: row.type, title: row.title, message: row.message,
  targetType: row.targetType, targetId: row.targetId, readAt: row.readAt, status: row.readAt ? 'read' : 'unread', revision: row.revision, createdAt: row.createdAt,
});
const changed = <T>(ctx: WorkspaceContext, item: T) => ({ item, changed: ['notifications'], requestId: ctx.requestId });

@Injectable()
export class LearningNotificationsService {
  constructor(private readonly access: LearningAccessService) {}
  private scope(ctx: WorkspaceContext) { return { workspaceId: ctx.workspaceId, recipientUserId: ctx.userId, recipientRole: ctx.role }; }
  async list(ctx: WorkspaceContext, query: NotificationQueryDto) {
    return this.access.transaction(ctx, async tx => {
      const cursor = parseLearningCursor(query.cursor);
      const asOf = new Date();
      const where: Prisma.LearningNotificationWhereInput = { ...this.scope(ctx), type: query.type,
        ...(query.status === 'all' ? {} : { readAt: query.status === 'unread' ? null : { not: null } }),
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {}),
      };
      const [rows, unreadCount] = await Promise.all([tx.learningNotification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 }), tx.learningNotification.count({ where: { ...this.scope(ctx), readAt: null } })]);
      const items = rows.slice(0, query.limit);
      return { items: items.map(notificationDto), pageInfo: { hasMore: rows.length > query.limit, nextCursor: rows.length > query.limit ? learningCursor(items[items.length - 1]) : null }, unreadCount, asOf };
    });
  }
  async mark(ctx: WorkspaceContext, id: string, body: MarkNotificationDto, revision: number) {
    return this.access.transaction(ctx, async tx => {
      const row = await tx.learningNotification.findFirst({ where: { id, ...this.scope(ctx) } });
      if (!row) throw notFound();
      checkRevision(row.revision, revision);
      if (row.legacyNotificationId && !body.read && await tx.notification.count({ where: { id: row.legacyNotificationId, status: 'resolved' } })) throw learningConflict('legacy_resolved', 'Завершённое историческое напоминание нельзя вернуть в непрочитанные.');
      const updated = await tx.learningNotification.update({ where: { id }, data: { readAt: body.read ? row.readAt || new Date() : null, revision: { increment: 1 } } });
      if (row.legacyNotificationId && legacyApiMode() !== 'disabled') await tx.notification.updateMany({ where: { id: row.legacyNotificationId, status: { not: 'resolved' } }, data: { status: body.read ? 'read' : 'unread' } });
      return changed(ctx, notificationDto(updated));
    });
  }
  async readAll(ctx: WorkspaceContext, body: ReadAllNotificationsDto) {
    const before = new Date(body.before);
    if (before.getTime() > Date.now() + 1000) throw validationError('Граница прочтения не может быть в будущем.');
    return this.access.transaction(ctx, async tx => {
      const where = { ...this.scope(ctx), readAt: null, createdAt: { lte: before } };
      const legacy = await tx.learningNotification.findMany({ where: { ...where, legacyNotificationId: { not: null } }, select: { legacyNotificationId: true } });
      const result = await tx.learningNotification.updateMany({ where, data: { readAt: new Date(), revision: { increment: 1 } } });
      if (legacyApiMode() !== 'disabled') await tx.notification.updateMany({ where: { id: { in: legacy.flatMap(n => n.legacyNotificationId ? [n.legacyNotificationId] : []) }, status: { not: 'resolved' } }, data: { status: 'read' } });
      return changed(ctx, { updatedCount: result.count });
    });
  }
  async target(ctx: WorkspaceContext, id: string) {
    return this.access.transaction(ctx, async tx => {
      const row = await tx.learningNotification.findFirst({ where: { id, ...this.scope(ctx) } });
      if (!row) throw notFound();
      return { item: await this.access.target(tx, ctx, row.targetType, row.targetId) };
    });
  }
  async preferences(ctx: WorkspaceContext) {
    return this.access.transaction(ctx, async tx => {
      const row = await tx.learningNotificationPreference.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } } });
      return { item: { emailEnabled: row?.emailEnabled || false, updatedAt: row?.updatedAt || null } };
    });
  }
  async setPreferences(ctx: WorkspaceContext, body: NotificationPreferenceDto) {
    return this.access.transaction(ctx, async tx => {
      const row = await tx.learningNotificationPreference.upsert({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } }, create: { workspaceId: ctx.workspaceId, userId: ctx.userId, emailEnabled: body.emailEnabled }, update: { emailEnabled: body.emailEnabled } });
      return changed(ctx, { emailEnabled: row.emailEnabled, updatedAt: row.updatedAt });
    });
  }
  async deliveries(ctx: WorkspaceContext, query: DeliveryQueryDto) {
    if (ctx.role !== 'admin') throw forbidden();
    return this.access.transaction(ctx, async tx => {
      const cursor = parseLearningCursor(query.cursor);
      const rows = await tx.learningDelivery.findMany({ where: { notification: { workspaceId: ctx.workspaceId }, status: query.status,
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {}),
      }, include: { notification: { select: { type: true, recipientUserId: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
      const items = rows.slice(0, query.limit);
      return { items: items.map(row => ({ id: row.id, notificationId: row.notificationId, recipientUserId: row.notification.recipientUserId, type: row.notification.type,
        status: row.status, attempts: row.attempts, availableAt: row.availableAt, lockedUntil: row.lockedUntil, lastErrorCode: row.lastErrorCode,
        provider: row.provider, deliveredAt: row.deliveredAt, revision: row.revision, createdAt: row.createdAt,
      })), pageInfo: { hasMore: rows.length > query.limit, nextCursor: rows.length > query.limit ? learningCursor(items[items.length - 1]) : null } };
    });
  }
  async retry(ctx: WorkspaceContext, id: string, body: RetryDeliveryDto, revision: number) {
    if (ctx.role !== 'admin') throw forbidden();
    if (body.reason.trim().length < 5) throw validationError('Укажите причину от 5 символов.');
    return this.access.transaction(ctx, async tx => {
      const row = await tx.learningDelivery.findFirst({ where: { id, notification: { workspaceId: ctx.workspaceId } } });
      if (!row) throw notFound();
      checkRevision(row.revision, revision);
      if (row.status !== 'failed') throw learningConflict('invalid_state', 'Повтор доступен для окончательно неудачной доставки.');
      const updated = await tx.learningDelivery.update({ where: { id }, data: { status: 'queued', attempts: 0, availableAt: new Date(), lockedUntil: null, lockToken: null, lastErrorCode: '', revision: { increment: 1 } } });
      await tx.workspaceAuditEvent.create({ data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: 'notification.delivery_retried', targetType: 'notification_delivery', targetId: id, reason: body.reason.trim(), requestId: ctx.requestId } });
      return changed(ctx, { id: updated.id, status: updated.status, revision: updated.revision });
    });
  }
}
