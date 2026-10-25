import { Injectable, Logger } from '@nestjs/common';
import { access as diskAccess } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../common/current-user';
import { notFound, validationError } from '../common/app-error';
import { FilesService } from '../files/files.service';
import { WorkspaceContext } from '../workspace/workspace-context.service';
import { fileDto, WorkAccessService, workConflict, WorkTx } from './work-access.service';

@Injectable()
export class WorkFilesService {
  private readonly logger = new Logger(WorkFilesService.name);
  constructor(private readonly access: WorkAccessService, private readonly files: FilesService) {}

  async upload(ctx: WorkspaceContext, user: AuthUser, file: Express.Multer.File) {
    let path: string | undefined;
    try {
      return await this.access.transaction(ctx, async tx => {
        const saved = await this.files.saveUploadedFile(user, file, { workspaceId: ctx.workspaceId, context: ctx.role === 'student' ? 'homework-submission' : 'material' }, tx);
        path = saved.storagePath;
        await this.access.audit(tx, ctx, 'file', saved.id, 'file.uploaded', { size: saved.size, mimeType: saved.mimeType });
        return { item: fileDto(saved), changed: ['files'], requestId: ctx.requestId };
      });
    } catch (error) { if (path) await this.files.removeStoredFile(path); throw error; }
  }

  private async visible(tx: WorkTx, ctx: WorkspaceContext, id: string) {
    const file = await tx.fileResource.findUnique({ where: { id } });
    if (!file || file.workspaceId && file.workspaceId !== ctx.workspaceId) throw notFound();
    const own = file.workspaceId === ctx.workspaceId && file.ownerId === ctx.userId
      && (ctx.role === 'student' ? file.scope === 'private_submission' : file.scope !== 'private_submission');
    if (own) return file;
    const ownRecipient = { enrollment: { membership: { userId: ctx.userId } } };
    const course = ctx.role === 'admin' ? { workspaceId: ctx.workspaceId } : this.access.teacherScope(ctx);
    const assignment: Prisma.AssignmentWhereInput = ctx.role === 'student'
      ? { course: { workspaceId: ctx.workspaceId }, publishedAt: { not: null }, recipients: { some: ownRecipient } }
      : { course };
    if (await tx.assignmentFile.count({ where: { fileId: id, assignment } })) return file;
    const privateRecipient: Prisma.AssignmentRecipientWhereInput = ctx.role === 'student'
      ? { ...ownRecipient, assignment: { course: { workspaceId: ctx.workspaceId }, publishedAt: { not: null } } }
      : { assignment: { course: this.access.teacherScope(ctx) } };
    if (await tx.assignmentSubmissionFile.count({ where: { fileId: id, submission: { recipient: privateRecipient } } })) return file;
    if (await tx.assignmentReviewFile.count({ where: { fileId: id, review: { ...(ctx.role === 'student' ? { status: 'published' } : {}), submission: { recipient: privateRecipient } } } })) return file;
    const material: Prisma.LearningMaterialWhereInput = ctx.role === 'student' ? {
      workspaceId: ctx.workspaceId, archivedAt: null,
      publications: { some: { revokedAt: null, course: { status: 'active' }, recipients: { some: { enrollment: { status: 'active', membership: { userId: ctx.userId } } } } } },
    } : {
      workspaceId: ctx.workspaceId, ...(ctx.role === 'admin' ? {} : { OR: [{ createdByUserId: ctx.userId }, { publications: { some: { revokedAt: null, course: this.access.teacherScope(ctx) } } }] }),
    };
    if (await tx.learningMaterial.count({ where: { fileId: id, ...material } })) return file;
    throw notFound();
  }

  async download(ctx: WorkspaceContext, id: string) {
    const file = await this.access.transaction(ctx, tx => this.visible(tx, ctx, id));
    try { await diskAccess(file.storagePath); } catch { throw notFound('Файл отсутствует в хранилище.'); }
    return file;
  }

  async remove(ctx: WorkspaceContext, id: string) {
    const file = await this.access.transaction(ctx, async tx => {
      const row = await tx.fileResource.findFirst({ where: { id, workspaceId: ctx.workspaceId, ownerId: ctx.userId }, include: { _count: { select: { assignmentFiles: true, submissionFiles: true, reviewFiles: true, learningMaterials: true, submissions: true, attachments: true } } } });
      if (!row) throw notFound();
      if (Object.values(row._count).some(count => count > 0)) throw workConflict('file_in_use', 'Файл используется в работе, попытке, проверке или материале.');
      if (!row.storagePath) throw validationError('Некорректный путь файла.');
      await tx.fileResource.delete({ where: { id } });
      await this.access.audit(tx, ctx, 'file', id, 'file.deleted');
      return row;
    });
    try { await this.files.removeStoredFile(file.storagePath); }
    catch { this.logger.error(`Orphaned storage file after deletion: ${file.id}`); }
    return { item: { id }, changed: ['files'], requestId: ctx.requestId };
  }
}
