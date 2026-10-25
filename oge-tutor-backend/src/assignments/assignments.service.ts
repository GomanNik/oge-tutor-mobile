import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { forbidden, notFound, validationError } from '../common/app-error';
import { WorkspaceContext } from '../workspace/workspace-context.service';
import { AssignmentQueryDto, AssignmentRecipientsDto, CreateAssignmentDto, CreateReviewDto, SubmitAssignmentDto, UpdateAssignmentDto, UpdateRecipientDto, WorkPageDto, WorkReasonDto } from './assignments.dto';
import { checkRevision, fileDto, TaskSnapshot, WorkAccessService, workConflict, WorkTx } from './work-access.service';

const include = { course: { select: { title: true, workspaceId: true, programVersionId: true, status: true } }, files: { include: { file: true } } } satisfies Prisma.AssignmentInclude;
type Row = Prisma.AssignmentGetPayload<{ include: typeof include }>;
const recipientInclude = { enrollment: { include: { membership: { include: { user: { select: { displayName: true } } } } } } } satisfies Prisma.AssignmentRecipientInclude;
type Recipient = Prisma.AssignmentRecipientGetPayload<{ include: typeof recipientInclude }>;
const reviewInclude = { files: { include: { file: true } } } satisfies Prisma.AssignmentReviewInclude;
const submissionInclude = { files: { include: { file: true } }, reviews: { include: reviewInclude, orderBy: { number: 'asc' as const } } } satisfies Prisma.AssignmentSubmissionInclude;
const header = (row: Row, ctx: WorkspaceContext) => ({ id: row.id, courseId: row.courseId, courseTitle: row.course.title, programVersionId: row.course.programVersionId, title: row.title, instructions: row.instructions, taskDefinitionIds: row.taskDefinitionIds, tasks: row.taskSnapshot, dueAt: row.dueAt, status: row.status, revision: row.revision, publishedAt: row.publishedAt, closedAt: row.closedAt, closeReason: row.closeReason, legacy: Boolean(row.legacyHomeworkId), ...(row.legacyHomeworkId && ctx.role !== 'admin' ? { legacyState: row.legacyState, legacyMaterials: row.legacyMaterials } : {}), files: row.files.map(f => fileDto(f.file)) });
const recipientDto = (row: Recipient, ctx: WorkspaceContext) => ({ id: row.id, assignmentId: row.assignmentId, enrollmentId: row.enrollmentId, dueAt: row.dueAt, status: row.status, reason: row.reason, revision: row.revision, overdue: ['assigned', 'needs_revision'].includes(row.status) && row.dueAt < new Date(), ...(ctx.role === 'student' ? {} : { displayName: row.enrollment.membership.displayNameOverride || row.enrollment.membership.user.displayName }) });
const reviewDto = (row: Prisma.AssignmentReviewGetPayload<{ include: typeof reviewInclude }>) => ({ id: row.id, submissionId: row.submissionId, number: row.number, revision: row.revision, status: row.status, decision: row.decision, comment: row.comment, scores: row.scores, reason: row.reason, reviewerUserId: row.reviewerUserId, source: row.source, createdAt: row.createdAt, publishedAt: row.publishedAt, legacyMaterials: row.legacyMaterials, files: row.files.map(f => fileDto(f.file)) });
const changed = <T>(ctx: WorkspaceContext, item: T) => ({ item, changed: ['assignments'], requestId: ctx.requestId });

@Injectable()
export class AssignmentsService {
  constructor(private readonly access: WorkAccessService) {}

  private scope(ctx: WorkspaceContext): Prisma.AssignmentWhereInput {
    if (ctx.role === 'teacher') return { course: this.access.teacherScope(ctx) };
    return { course: { workspaceId: ctx.workspaceId }, ...(ctx.role === 'student' ? { status: { not: 'draft' }, publishedAt: { not: null }, recipients: { some: { enrollment: { membership: { userId: ctx.userId } } } } } : {}) };
  }
  private async visible(tx: WorkTx, ctx: WorkspaceContext, id: string) {
    const row = await tx.assignment.findFirst({ where: { id, ...this.scope(ctx) }, include });
    if (!row) throw notFound();
    return row;
  }
  private async editable(tx: WorkTx, ctx: WorkspaceContext, id: string, privateWork = false) {
    const row = await this.visible(tx, ctx, id);
    await this.access.editor(tx, ctx, row.courseId, privateWork);
    if (row.legacyHomeworkId) throw workConflict('legacy_assignment_read_only', 'Историческая работа редактируется в прежнем кабинете.');
    return row;
  }

  async list(ctx: WorkspaceContext, query: AssignmentQueryDto) {
    return this.access.transaction(ctx, async tx => {
      const where: Prisma.AssignmentWhereInput = { AND: [this.scope(ctx), { courseId: query.courseId, status: query.status, ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}) }] };
      const [rows, total] = await Promise.all([tx.assignment.findMany({ where, include, orderBy: [{ dueAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.assignment.count({ where })]);
      return { items: rows.map(row => header(row, ctx)), total, page: query.page, pageSize: query.pageSize };
    });
  }
  async get(ctx: WorkspaceContext, id: string) {
    return this.access.transaction(ctx, async tx => {
      const row = await this.visible(tx, ctx, id);
      const canReview = ctx.role !== 'student' && Boolean(await tx.course.findFirst({ where: { id: row.courseId, ...this.access.teacherScope(ctx) }, select: { id: true } }));
      return { item: { ...header(row, ctx), canReview } };
    });
  }
  async create(ctx: WorkspaceContext, body: CreateAssignmentDto, key: string) {
    return this.access.transaction(ctx, async tx => {
      const course = await this.access.editor(tx, ctx, body.courseId);
      return this.access.once(tx, ctx, 'assignments', key, body, async () => {
        if (course.status !== 'active') throw workConflict('course_not_active', 'Нужен активный курс.');
        const tasks = await this.access.tasks(tx, course.programVersionId, body.taskDefinitionIds);
        await this.access.ownFiles(tx, ctx, body.fileIds, 'material');
        const row = await tx.assignment.create({ data: { courseId: course.id, title: body.title.trim(), instructions: body.instructions.trim(), taskDefinitionIds: body.taskDefinitionIds, taskSnapshot: tasks, dueAt: this.access.future(body.dueAt), createdByUserId: ctx.userId, files: { create: body.fileIds.map(fileId => ({ fileId })) } }, include });
        await this.access.audit(tx, ctx, 'assignment', row.id, 'assignment.created', { courseId: course.id });
        return changed(ctx, header(row, ctx));
      });
    });
  }
  async update(ctx: WorkspaceContext, id: string, body: UpdateAssignmentDto, revision: number) {
    return this.access.transaction(ctx, async tx => {
      const row = await this.editable(tx, ctx, id);
      checkRevision(row.revision, revision);
      if (row.status !== 'draft') throw workConflict('immutable_assignment', 'После публикации содержание не меняется. Создайте новую работу.');
      if (!Object.keys(body).length) throw validationError('Нет изменений.');
      const tasks = body.taskDefinitionIds ? await this.access.tasks(tx, row.course.programVersionId, body.taskDefinitionIds) : undefined;
      if (body.fileIds) {
        await this.access.ownFiles(tx, ctx, body.fileIds.filter(id => !row.files.some(link => link.fileId === id)), 'material');
        await tx.assignmentFile.deleteMany({ where: { assignmentId: id } });
        await tx.assignmentFile.createMany({ data: body.fileIds.map(fileId => ({ assignmentId: id, fileId })) });
      }
      const updated = await tx.assignment.update({ where: { id }, data: { title: body.title?.trim(), instructions: body.instructions?.trim(), taskDefinitionIds: body.taskDefinitionIds, taskSnapshot: tasks, dueAt: body.dueAt ? this.access.future(body.dueAt) : undefined, revision: { increment: 1 } }, include });
      await this.access.audit(tx, ctx, 'assignment', id, 'assignment.updated');
      return changed(ctx, header(updated, ctx));
    });
  }

  async publish(ctx: WorkspaceContext, id: string, body: AssignmentRecipientsDto, revision: number, key: string, add = false) {
    return this.access.transaction(ctx, async tx => {
      const row = await this.editable(tx, ctx, id);
      return this.access.once(tx, ctx, `assignments:${id}:${add ? 'recipients' : 'publish'}`, key, { ...body, revision }, async () => {
        checkRevision(row.revision, revision);
        if (row.status !== (add ? 'published' : 'draft') || row.course.status !== 'active') throw workConflict('invalid_state', 'Работу сейчас нельзя опубликовать.');
        this.access.future(row.dueAt);
        await this.access.recipients(tx, row.courseId, body.recipientEnrollmentIds);
        if (add && await tx.assignmentRecipient.count({ where: { assignmentId: id, enrollmentId: { in: body.recipientEnrollmentIds } } })) throw workConflict('duplicate_recipient', 'Один из учеников уже получил эту работу.');
        await tx.assignmentRecipient.createMany({ data: body.recipientEnrollmentIds.map(enrollmentId => ({ assignmentId: id, courseId: row.courseId, enrollmentId, dueAt: row.dueAt })) });
        const updated = await tx.assignment.update({ where: { id }, data: { status: 'published', publishedAt: row.publishedAt || new Date(), revision: { increment: 1 } }, include });
        await this.access.audit(tx, ctx, 'assignment', id, add ? 'assignment.recipients_added' : 'assignment.published', { enrollmentIds: body.recipientEnrollmentIds });
        return changed(ctx, header(updated, ctx));
      });
    });
  }
  async close(ctx: WorkspaceContext, id: string, body: WorkReasonDto, revision: number, archive = false) {
    return this.access.transaction(ctx, async tx => {
      const row = await this.editable(tx, ctx, id);
      checkRevision(row.revision, revision);
      if (archive ? !['draft', 'closed'].includes(row.status) : row.status !== 'published') throw workConflict('invalid_state', 'Недопустимый переход работы.');
      if (archive && await tx.assignmentRecipient.count({ where: { assignmentId: id, status: 'submitted' } })) throw workConflict('pending_reviews', 'Сначала проверьте сданные работы.');
      await tx.assignmentRecipient.updateMany({ where: { assignmentId: id, status: { in: ['assigned', 'needs_revision'] } }, data: { status: 'closed', reason: body.reason.trim(), revision: { increment: 1 } } });
      const updated = await tx.assignment.update({ where: { id }, data: { status: archive ? 'archived' : 'closed', closedAt: row.closedAt || new Date(), closeReason: body.reason.trim(), revision: { increment: 1 } }, include });
      await this.access.audit(tx, ctx, 'assignment', id, archive ? 'assignment.archived' : 'assignment.closed', {}, body.reason.trim());
      return changed(ctx, header(updated, ctx));
    });
  }
  async recipients(ctx: WorkspaceContext, id: string, query: WorkPageDto) {
    return this.access.transaction(ctx, async tx => {
      await this.visible(tx, ctx, id);
      const where: Prisma.AssignmentRecipientWhereInput = { assignmentId: id, ...(ctx.role === 'student' ? { enrollment: { membership: { userId: ctx.userId } } } : {}) };
      const [rows, total] = await Promise.all([tx.assignmentRecipient.findMany({ where, include: recipientInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.assignmentRecipient.count({ where })]);
      return { items: rows.map(row => recipientDto(row, ctx)), total, page: query.page, pageSize: query.pageSize };
    });
  }
  private async recipient(tx: WorkTx, ctx: WorkspaceContext, id: string, privateWork = false) {
    const row = await tx.assignmentRecipient.findFirst({ where: { id, assignment: this.scope(ctx), ...(ctx.role === 'student' ? { enrollment: { membership: { userId: ctx.userId } } } : {}) }, include: { ...recipientInclude, assignment: { include } } });
    if (!row) throw notFound();
    if (privateWork && ctx.role !== 'student') await this.access.editor(tx, ctx, row.courseId, true);
    return row;
  }
  async updateRecipient(ctx: WorkspaceContext, assignmentId: string, id: string, body: UpdateRecipientDto, revision: number) {
    return this.access.transaction(ctx, async tx => {
      const assignment = await this.editable(tx, ctx, assignmentId);
      const row = await this.recipient(tx, ctx, id);
      if (row.assignmentId !== assignmentId) throw notFound();
      checkRevision(row.revision, revision);
      if (assignment.status !== 'published') throw workConflict('invalid_state', 'Работа закрыта.');
      if (!body.dueAt && !body.status) throw validationError('Нет изменений.');
      if (['submitted', 'reviewed'].includes(row.status)) throw workConflict('invalid_state', 'Сданную работу нужно проверить; результат меняется новой проверкой.');
      if (body.status === 'assigned' && !['exempted', 'closed'].includes(row.status)) throw workConflict('invalid_state', 'Повторное открытие доступно для закрытого или освобождённого получателя.');
      if (body.status === 'assigned') await this.access.recipients(tx, row.courseId, [row.enrollmentId]);
      const updated = await tx.assignmentRecipient.update({ where: { id }, data: { status: body.status, dueAt: body.dueAt ? this.access.future(body.dueAt) : undefined, reason: body.reason.trim(), revision: { increment: 1 } }, include: recipientInclude });
      await this.access.audit(tx, ctx, 'assignment_recipient', id, 'assignment.recipient_updated', { status: updated.status, dueAt: updated.dueAt.toISOString() }, body.reason.trim());
      return changed(ctx, recipientDto(updated, ctx));
    });
  }
  async submissions(ctx: WorkspaceContext, id: string, query: WorkPageDto) {
    return this.access.transaction(ctx, async tx => {
      const recipient = await this.recipient(tx, ctx, id, true);
      const [rows, total] = await Promise.all([tx.assignmentSubmission.findMany({ where: { recipientId: id }, include: submissionInclude, orderBy: { attempt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.assignmentSubmission.count({ where: { recipientId: id } })]);
      return { items: rows.map(row => ({ id: row.id, recipientId: row.recipientId, attempt: row.attempt, text: row.text, contentSnapshot: row.contentSnapshot, submittedAt: row.submittedAt, late: row.submittedAt > recipient.dueAt, files: row.files.map(f => fileDto(f.file)), reviews: row.reviews.filter(review => ctx.role !== 'student' || review.status === 'published').map(reviewDto) })), total, page: query.page, pageSize: query.pageSize };
    });
  }
  async submit(ctx: WorkspaceContext, id: string, body: SubmitAssignmentDto, revision: number, key: string) {
    return this.access.transaction(ctx, async tx => {
      if (ctx.role !== 'student') throw forbidden();
      const row = await this.recipient(tx, ctx, id, true);
      return this.access.once(tx, ctx, `recipients:${id}:submit`, key, { ...body, revision }, async () => {
        checkRevision(row.revision, revision);
        if (row.assignment.legacyHomeworkId) throw workConflict('legacy_assignment_read_only', 'Историческая работа сдаётся в прежнем кабинете.');
        if (row.assignment.status !== 'published' || row.assignment.course.status !== 'active' || !['assigned', 'needs_revision'].includes(row.status)) throw workConflict('invalid_state', 'Сейчас работу нельзя сдать.');
        await this.access.recipients(tx, row.courseId, [row.enrollmentId]);
        if (!body.text.trim() && !body.fileIds.length) throw validationError('Добавьте текст или файл решения.');
        await this.access.ownFiles(tx, ctx, body.fileIds, 'submission');
        const attempt = (await tx.assignmentSubmission.count({ where: { recipientId: id } })) + 1;
        const submission = await tx.assignmentSubmission.create({ data: { recipientId: id, attempt, text: body.text.trim(), contentSnapshot: { title: row.assignment.title, instructions: row.assignment.instructions, tasks: row.assignment.taskSnapshot, fileIds: row.assignment.files.map(f => f.fileId), dueAt: row.dueAt.toISOString() }, files: { create: body.fileIds.map(fileId => ({ fileId })) } } });
        const updated = await tx.assignmentRecipient.update({ where: { id }, data: { status: 'submitted', revision: { increment: 1 } }, include: recipientInclude });
        await this.access.audit(tx, ctx, 'assignment_submission', submission.id, 'assignment.submitted', { recipientId: id, attempt });
        return changed(ctx, recipientDto(updated, ctx));
      });
    });
  }

  private validateScores(body: CreateReviewDto, tasks: TaskSnapshot[]) {
    if (body.decision === 'rework' && !body.comment.trim()) throw validationError('Укажите, что нужно доработать.');
    for (const score of body.scores) {
      const task = tasks.find(t => t.id === score.taskDefinitionId);
      const maximum = score.criterionCode ? task?.criteria.find(c => c.code === score.criterionCode)?.maxScore : task?.maxScore;
      if (maximum === null || maximum === undefined || score.score > maximum || (!score.criterionCode && task?.criteria.length)) throw validationError('Баллы должны соответствовать критериям опубликованной работы.');
    }
    for (const task of tasks) {
      const scores = body.scores.filter(s => s.taskDefinitionId === task.id);
      if (task.criteria.length && scores.length && scores.length !== task.criteria.length) throw validationError('Для оцениваемого задания заполните все критерии.');
      if (task.maxScore !== null && scores.reduce((sum, s) => sum + s.score, 0) > task.maxScore) throw validationError('Сумма баллов превышает максимум задания.');
    }
  }
  private async reviewTarget(tx: WorkTx, ctx: WorkspaceContext, submissionId: string) {
    if (ctx.role === 'student') throw forbidden();
    const submission = await tx.assignmentSubmission.findUnique({ where: { id: submissionId }, include: { reviews: { orderBy: { number: 'desc' } } } });
    if (!submission) throw notFound();
    const recipient = await this.recipient(tx, ctx, submission.recipientId, true);
    if (recipient.assignment.legacyHomeworkId) throw workConflict('legacy_assignment_read_only', 'Историческая проверка выполняется в прежнем кабинете.');
    return { submission, recipient };
  }
  async createReview(ctx: WorkspaceContext, submissionId: string, body: CreateReviewDto, revision: number, key: string) {
    return this.access.transaction(ctx, async tx => {
      const { submission, recipient } = await this.reviewTarget(tx, ctx, submissionId);
      return this.access.once(tx, ctx, `submissions:${submissionId}:reviews`, key, { ...body, revision }, async () => {
        checkRevision(recipient.revision, revision);
        const latest = await tx.assignmentSubmission.findFirst({ where: { recipientId: recipient.id }, orderBy: { attempt: 'desc' } });
        if (latest?.id !== submissionId || !['submitted', 'reviewed', 'needs_revision'].includes(recipient.status) || recipient.assignment.status === 'archived') throw workConflict('invalid_state', 'Проверять можно последнюю попытку незархивированной работы.');
        if (submission.reviews.some(r => r.status === 'draft')) throw workConflict('review_draft_exists', 'Сначала завершите имеющийся черновик проверки.');
        if (submission.reviews.length && !body.reason?.trim()) throw validationError('Укажите причину исправления проверки.');
        this.validateScores(body, recipient.assignment.taskSnapshot as TaskSnapshot[]);
        await this.access.ownFiles(tx, ctx, body.fileIds, 'material');
        const review = await tx.assignmentReview.create({ data: { submissionId, number: (submission.reviews[0]?.number || 0) + 1, decision: body.decision, comment: body.comment.trim(), scores: body.scores.map(s => ({ ...s })), reason: body.reason?.trim() || '', reviewerUserId: ctx.userId, files: { create: body.fileIds.map(fileId => ({ fileId })) } }, include: reviewInclude });
        await tx.assignmentRecipient.update({ where: { id: recipient.id }, data: { revision: { increment: 1 } } });
        await this.access.audit(tx, ctx, 'assignment_review', review.id, 'assignment.review_drafted', { submissionId, number: review.number });
        return changed(ctx, reviewDto(review));
      });
    });
  }
  async updateReview(ctx: WorkspaceContext, id: string, body: CreateReviewDto, revision: number) {
    return this.access.transaction(ctx, async tx => {
      const review = await tx.assignmentReview.findUnique({ where: { id } });
      if (!review) throw notFound();
      const { recipient } = await this.reviewTarget(tx, ctx, review.submissionId);
      checkRevision(review.revision, revision);
      if (review.status !== 'draft') throw workConflict('immutable_review', 'Опубликованную проверку можно исправить только новой ревизией.');
      this.validateScores(body, recipient.assignment.taskSnapshot as TaskSnapshot[]);
      if (review.number > 1 && !body.reason?.trim()) throw validationError('Укажите причину исправления.');
      const existingFiles = await tx.assignmentReviewFile.findMany({ where: { reviewId: id }, select: { fileId: true } });
      await this.access.ownFiles(tx, ctx, body.fileIds.filter(fileId => !existingFiles.some(link => link.fileId === fileId)), 'material');
      await tx.assignmentReviewFile.deleteMany({ where: { reviewId: id } });
      const updated = await tx.assignmentReview.update({ where: { id }, data: { decision: body.decision, comment: body.comment.trim(), scores: body.scores.map(s => ({ ...s })), reason: body.reason?.trim() || '', reviewerUserId: ctx.userId, revision: { increment: 1 }, files: { create: body.fileIds.map(fileId => ({ fileId })) } }, include: reviewInclude });
      await this.access.audit(tx, ctx, 'assignment_review', id, 'assignment.review_updated');
      return changed(ctx, reviewDto(updated));
    });
  }
  async publishReview(ctx: WorkspaceContext, id: string, revision: number, key: string) {
    return this.access.transaction(ctx, async tx => {
      const review = await tx.assignmentReview.findUnique({ where: { id } });
      if (!review) throw notFound();
      const { recipient } = await this.reviewTarget(tx, ctx, review.submissionId);
      return this.access.once(tx, ctx, `reviews:${id}:publish`, key, { revision }, async () => {
        checkRevision(review.revision, revision);
        const latest = await tx.assignmentSubmission.findFirst({ where: { recipientId: recipient.id }, orderBy: { attempt: 'desc' } });
        if (review.status !== 'draft' || latest?.id !== review.submissionId || recipient.assignment.status === 'archived') throw workConflict('invalid_state', 'Проверка больше не актуальна.');
        if (review.decision === 'rework' && (recipient.assignment.status !== 'published' || recipient.assignment.course.status !== 'active' || recipient.enrollment.status !== 'active')) throw workConflict('invalid_state', 'Для доработки нужны открытая работа, активные курс и зачисление.');
        const updated = await tx.assignmentReview.update({ where: { id }, data: { status: 'published', publishedAt: new Date(), revision: { increment: 1 } }, include: reviewInclude });
        await tx.assignmentRecipient.update({ where: { id: recipient.id }, data: { status: review.decision === 'accepted' ? 'reviewed' : 'needs_revision', revision: { increment: 1 } } });
        await this.access.audit(tx, ctx, 'assignment_review', id, 'assignment.review_published', { submissionId: review.submissionId, recipientId: recipient.id, number: review.number, decision: review.decision });
        return changed(ctx, reviewDto(updated));
      });
    });
  }
}
