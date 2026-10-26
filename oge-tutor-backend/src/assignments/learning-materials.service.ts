import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { forbidden, notFound, validationError } from '../common/app-error';
import { WorkspaceContext } from '../workspace/workspace-context.service';
import { CreateLearningMaterialDto, MaterialQueryDto, PublishMaterialDto, UpdateLearningMaterialDto, WorkReasonDto } from './assignments.dto';
import { checkRevision, fileDto, WorkAccessService, workConflict, WorkTx } from './work-access.service';
import { LearningEventsService } from '../learning/learning-events.service';
import { legacyReadOnly } from '../workspace/legacy-mode';

const include = { file: true, programVersion: { include: { program: { include: { subject: true } } } } } satisfies Prisma.LearningMaterialInclude;
type Row = Prisma.LearningMaterialGetPayload<{ include: typeof include }>;
const dto = (row: Row) => ({ id: row.id, programVersionId: row.programVersionId, programName: row.programVersion.program.name, subjectName: row.programVersion.program.subject.name, taskDefinitionIds: row.taskDefinitionIds, title: row.title, description: row.description, url: row.url, file: row.file ? fileDto(row.file) : null, legacy: Boolean(row.legacyAttachmentId), legacyReadOnly: legacyReadOnly(row.legacyAttachmentId), legacyState: row.legacyAttachmentId ? row.legacyState : undefined, revision: row.revision, archivedAt: row.archivedAt, createdAt: row.createdAt });
const changed = <T>(ctx: WorkspaceContext, item: T) => ({ item, changed: ['materials'], requestId: ctx.requestId });

@Injectable()
export class LearningMaterialsService {
  constructor(private readonly access: WorkAccessService, private readonly learning: LearningEventsService) {}
  private scope(ctx: WorkspaceContext): Prisma.LearningMaterialWhereInput {
    if (ctx.role === 'student') return { workspaceId: ctx.workspaceId, archivedAt: null, publications: { some: { revokedAt: null, course: { status: 'active' }, recipients: { some: { enrollment: { status: 'active', membership: { userId: ctx.userId } } } } } } };
    return { workspaceId: ctx.workspaceId, ...(ctx.role === 'teacher' ? { OR: [{ createdByUserId: ctx.userId }, { publications: { some: { revokedAt: null, course: this.access.teacherScope(ctx) } } }] } : {}) };
  }
  private async visible(tx: WorkTx, ctx: WorkspaceContext, id: string) {
    const row = await tx.learningMaterial.findFirst({ where: { id, ...this.scope(ctx) }, include });
    if (!row) throw notFound();
    return row;
  }
  private async editable(tx: WorkTx, ctx: WorkspaceContext, id: string) {
    if (ctx.role === 'student') throw forbidden();
    const row = await this.visible(tx, ctx, id);
    if (ctx.role !== 'admin' && row.createdByUserId !== ctx.userId) throw forbidden();
    if (legacyReadOnly(row.legacyAttachmentId)) throw workConflict('legacy_material_read_only', 'Исторический материал редактируется в прежнем кабинете.');
    return row;
  }
  private source(fileId?: string | null, url?: string) {
    if (Boolean(fileId) === Boolean(url)) throw validationError('Укажите ровно один источник: файл или ссылку.');
    if (url) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw validationError('Некорректная ссылка.'); }
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw validationError('Разрешены только HTTP(S)-ссылки без пароля.');
    }
  }
  async list(ctx: WorkspaceContext, query: MaterialQueryDto) {
    return this.access.transaction(ctx, async tx => {
      const where: Prisma.LearningMaterialWhereInput = { AND: [this.scope(ctx), { archivedAt: query.status === 'archived' ? { not: null } : null, programVersionId: query.programVersionId, ...(query.taskDefinitionId ? { taskDefinitionIds: { has: query.taskDefinitionId } } : {}), ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}), ...(query.courseId ? { publications: { some: { courseId: query.courseId, revokedAt: null } } } : {}) }] };
      const [rows, total] = await Promise.all([tx.learningMaterial.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.pageSize, skip: (query.page - 1) * query.pageSize }), tx.learningMaterial.count({ where })]);
      return { items: rows.map(dto), total, page: query.page, pageSize: query.pageSize };
    });
  }
  async get(ctx: WorkspaceContext, id: string) {
    return this.access.transaction(ctx, async tx => {
      const row = await this.visible(tx, ctx, id);
      const publications = await tx.materialPublication.findMany({ where: { materialId: id, ...(ctx.role === 'student' ? { revokedAt: null, course: { status: 'active' }, recipients: { some: { enrollment: { status: 'active', membership: { userId: ctx.userId } } } } } : ctx.role === 'teacher' ? { course: this.access.teacherScope(ctx) } : {}) }, include: { recipients: { where: ctx.role === 'student' ? { enrollment: { membership: { userId: ctx.userId } } } : {} } }, orderBy: { publishedAt: 'desc' }, take: 100 });
      const publicationCount = ctx.role === 'student' ? 0 : await tx.materialPublication.count({ where: { materialId: id } });
      const canManage = ctx.role !== 'student' && !legacyReadOnly(row.legacyAttachmentId) && (ctx.role === 'admin' || row.createdByUserId === ctx.userId);
      return { item: { ...dto(row), canEdit: canManage && !row.archivedAt && !publicationCount, canArchive: canManage && !row.archivedAt, publications: publications.map(p => ({ id: p.id, courseId: p.courseId, lessonId: p.lessonId, revision: p.revision, publishedAt: p.publishedAt, revokedAt: p.revokedAt, recipientEnrollmentIds: p.recipients.map(r => r.enrollmentId) })) } };
    });
  }
  async create(ctx: WorkspaceContext, body: CreateLearningMaterialDto, key: string) {
    return this.access.transaction(ctx, async tx => {
      if (ctx.role === 'student') throw forbidden();
      return this.access.once(tx, ctx, 'materials', key, body, async () => {
        const version = await tx.programVersion.findFirst({ where: { id: body.programVersionId, status: 'published', program: { OR: [{ workspaceId: null }, { workspaceId: ctx.workspaceId }] } } });
        if (!version) throw validationError('Опубликованная версия программы недоступна.');
        await this.access.tasks(tx, version.id, body.taskDefinitionIds);
        this.source(body.fileId, body.url);
        await this.access.ownFiles(tx, ctx, body.fileId ? [body.fileId] : [], 'material');
        const row = await tx.learningMaterial.create({ data: { workspaceId: ctx.workspaceId, programVersionId: version.id, taskDefinitionIds: body.taskDefinitionIds, title: body.title.trim(), description: body.description.trim(), fileId: body.fileId, url: body.url || '', createdByUserId: ctx.userId }, include });
        await this.access.audit(tx, ctx, 'material', row.id, 'material.created');
        return changed(ctx, dto(row));
      });
    });
  }
  async update(ctx: WorkspaceContext, id: string, body: UpdateLearningMaterialDto, revision: number) {
    return this.access.transaction(ctx, async tx => {
      const row = await this.editable(tx, ctx, id);
      checkRevision(row.revision, revision);
      if (row.archivedAt || await tx.materialPublication.count({ where: { materialId: id } })) throw workConflict('immutable_material', 'Опубликованный материал не меняется. Создайте новую версию материала.');
      if (!Object.keys(body).length) throw validationError('Нет изменений.');
      const fileId = body.url ? null : body.fileId || row.fileId;
      const url = body.fileId ? '' : body.url ?? row.url;
      this.source(fileId, url);
      if (body.fileId && body.fileId !== row.fileId) await this.access.ownFiles(tx, ctx, [body.fileId], 'material');
      if (body.taskDefinitionIds) await this.access.tasks(tx, row.programVersionId, body.taskDefinitionIds);
      const updated = await tx.learningMaterial.update({ where: { id }, data: { title: body.title?.trim(), description: body.description?.trim(), taskDefinitionIds: body.taskDefinitionIds, fileId, url, revision: { increment: 1 } }, include });
      await this.access.audit(tx, ctx, 'material', id, 'material.updated');
      return changed(ctx, dto(updated));
    });
  }
  async publish(ctx: WorkspaceContext, id: string, body: PublishMaterialDto, revision: number, key: string) {
    return this.access.transaction(ctx, async tx => {
      const row = await this.visible(tx, ctx, id);
      if (legacyReadOnly(row.legacyAttachmentId)) throw workConflict('legacy_material_read_only', 'Исторический материал публикуется в прежнем кабинете.');
      const course = await this.access.editor(tx, ctx, body.courseId);
      return this.access.once(tx, ctx, `materials:${id}:publish`, key, { ...body, revision }, async () => {
        checkRevision(row.revision, revision);
        if (row.archivedAt || course.status !== 'active' || course.programVersionId !== row.programVersionId) throw workConflict('invalid_state', 'Материал и активный курс должны иметь одну версию программы.');
        await this.access.recipients(tx, course.id, body.recipientEnrollmentIds);
        if (body.lessonId) {
          const lesson = await tx.lesson.findFirst({ where: { id: body.lessonId, courseId: course.id, status: { not: 'canceled' } }, include: { participants: true } });
          if (!lesson || body.recipientEnrollmentIds.some(id => !lesson.participants.some(p => p.enrollmentId === id))) throw validationError('Получатели должны участвовать в выбранном занятии этого курса.');
        }
        if (await tx.materialPublication.count({ where: { materialId: id, courseId: course.id, lessonId: body.lessonId || null, revokedAt: null, recipients: { some: { enrollmentId: { in: body.recipientEnrollmentIds } } } } })) throw workConflict('duplicate_publication', 'Один из получателей уже имеет такую публикацию.');
        const publication = await tx.materialPublication.create({ data: { materialId: id, courseId: course.id, lessonId: body.lessonId } });
        await tx.materialPublicationRecipient.createMany({ data: body.recipientEnrollmentIds.map(enrollmentId => ({ publicationId: publication.id, courseId: course.id, enrollmentId })) });
        const updated = await tx.learningMaterial.update({ where: { id }, data: { revision: { increment: 1 } }, include });
        await this.access.audit(tx, ctx, 'material', id, 'material.published', { courseId: course.id, enrollmentIds: body.recipientEnrollmentIds });
        await this.learning.notifyEnrollments(tx, ctx, `material-publication:${publication.id}`, course.id, body.recipientEnrollmentIds, 'material.published', { type: 'material', id }, 'Опубликован учебный материал');
        return changed(ctx, dto(updated));
      });
    });
  }
  async revoke(ctx: WorkspaceContext, id: string, publicationId: string, body: WorkReasonDto, revision: number) {
    return this.access.transaction(ctx, async tx => {
      const row = await this.visible(tx, ctx, id);
      if (legacyReadOnly(row.legacyAttachmentId)) throw workConflict('legacy_material_read_only', 'Исторический материал управляется в прежнем кабинете.');
      const publication = await tx.materialPublication.findFirst({ where: { id: publicationId, materialId: id } });
      if (!publication) throw notFound();
      await this.access.editor(tx, ctx, publication.courseId);
      checkRevision(publication.revision, revision);
      if (publication.revokedAt) throw workConflict('invalid_state', 'Публикация уже отозвана.');
      await tx.materialPublication.update({ where: { id: publicationId }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
      const updated = await tx.learningMaterial.update({ where: { id }, data: { revision: { increment: 1 } }, include });
      await this.access.audit(tx, ctx, 'material_publication', publicationId, 'material.publication_revoked', {}, body.reason.trim());
      const recipients = await tx.materialPublicationRecipient.findMany({ where: { publicationId } });
      await this.learning.notifyEnrollments(tx, ctx, `material-publication:${publicationId}:revoked`, publication.courseId, recipients.map(r => r.enrollmentId), 'material.revoked', { type: 'material', id }, 'Отозван доступ к материалу');
      return changed(ctx, dto(updated));
    });
  }
  async archive(ctx: WorkspaceContext, id: string, body: WorkReasonDto, revision: number) {
    return this.access.transaction(ctx, async tx => {
      const row = await this.editable(tx, ctx, id);
      checkRevision(row.revision, revision);
      if (row.archivedAt) throw workConflict('invalid_state', 'Материал уже в архиве.');
      const publications = await tx.materialPublication.findMany({ where: { materialId: id, revokedAt: null }, include: { recipients: true } });
      await tx.materialPublication.updateMany({ where: { materialId: id, revokedAt: null }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
      const updated = await tx.learningMaterial.update({ where: { id }, data: { archivedAt: new Date(), revision: { increment: 1 } }, include });
      await this.access.audit(tx, ctx, 'material', id, 'material.archived', {}, body.reason.trim());
      for (const publication of publications) await this.learning.notifyEnrollments(tx, ctx, `material:${id}:archived`, publication.courseId, publication.recipients.map(r => r.enrollmentId), 'material.archived', { type: 'material', id }, 'Материал перенесён в архив');
      return changed(ctx, dto(updated));
    });
  }
}
