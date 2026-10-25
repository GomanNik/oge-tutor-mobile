import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { FILE_SCOPE, FileScope, MATERIAL_SOURCE, MATERIAL_TYPE, ROLE } from '../common/contracts';
import { forbidden, notFound, validationError } from '../common/app-error';
import { cleanText, requireText } from '../common/validation';
import { buildFileDownloadUrl } from './file-url';
import { detectUploadType } from './file-content';
import { uploadDirectory, uploadLimit } from './upload-config';

type AttachmentLike = Record<string, any>;

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private uploadScope(user: AuthUser, context = ''): FileScope {
    const normalized = cleanText(context).toLowerCase();
    if (normalized === 'homework-submission') return FILE_SCOPE.PRIVATE_SUBMISSION;
    if (user.role === ROLE.TEACHER && normalized) return FILE_SCOPE.TEACHER_MATERIAL;
    return FILE_SCOPE.PRIVATE_UPLOAD;
  }

  async saveUploadedFile(user: AuthUser, file: Express.Multer.File, meta: { title?: string; context?: string; workspaceId?: string } = {}, db: Pick<PrismaService, 'fileResource'> = this.prisma) {
    if (!file) throw validationError('Выберите файл.', { file: 'required' });
    if (!file.path) throw validationError('Upload must be streamed to disk.', { file: 'invalid_upload' });
    let storagePath: string | undefined;
    try {
      const { size } = await fs.promises.stat(file.path);
      if (size > uploadLimit(this.config)) throw validationError('Файл слишком большой.', { file: 'too_large' });
      if (!size) throw validationError('Файл пуст.', { file: 'empty' });
      const detected = await detectUploadType(file.path, file.originalname);
      const absoluteDir = uploadDirectory(this.config);
      await fs.promises.mkdir(absoluteDir, { recursive: true });
      storagePath = path.join(absoluteDir, `${randomUUID()}.${detected.ext}`);
      await fs.promises.rename(file.path, storagePath);
      const digest = createHash('sha256');
      for await (const chunk of fs.createReadStream(storagePath)) digest.update(chunk);
      const fileId = randomUUID();
      const url = buildFileDownloadUrl(this.config, fileId);
      return await db.fileResource.create({
      data: {
        id: fileId,
        ownerId: user.id,
        scope: this.uploadScope(user, meta.context),
        originalName: file.originalname,
        mimeType: detected.mime,
        size,
        url,
        storagePath,
        workspaceId: meta.workspaceId,
        checksum: digest.digest('hex'),
      },
      });
    } catch (error) {
      if (storagePath) await fs.promises.rm(storagePath, { force: true });
      throw error;
    } finally {
      await fs.promises.rm(file.path, { force: true });
    }
  }

  async removeStoredFile(storagePath: string) {
    await fs.promises.rm(storagePath, { force: true });
  }

  async requireFile(id: string) {
    const file = await this.prisma.fileResource.findUnique({ where: { id } });
    if (!file) throw validationError('Загруженный файл не найден.', { fileId: 'not_found' });
    return file;
  }

  async markFileScope(id: string, scope: FileScope, db: any = this.prisma) {
    return db.fileResource.update({ where: { id }, data: { scope } });
  }

  async requireAttachableFile(user: AuthUser, id: string) {
    const file = await this.requireFile(id);
    if (file.workspaceId) throw forbidden('Файл доступен только через API пространства.');
    if (file.ownerId !== user.id) throw forbidden('Можно прикреплять только собственные файлы.');
    if (file.scope === FILE_SCOPE.PRIVATE_SUBMISSION) {
      throw forbidden('Файл решения нельзя прикреплять как материал.');
    }
    return file;
  }

  async requireAccessibleFile(user: AuthUser, id: string) {
    return this.requireDownloadAccess(user, id);
  }

  private async requireDownloadAccess(user: AuthUser, id: string) {
    const file = await this.requireFile(id);
    if (file.workspaceId) throw forbidden('Файл доступен только через API пространства.');
    if (file.ownerId === user.id) return file;

    if (user.role === ROLE.TEACHER && user.teacherId) {
      const studentOwner = await this.prisma.studentProfile.findFirst({
        where: { userId: file.ownerId, teacherId: user.teacherId },
        select: { id: true },
      });
      if (studentOwner) return file;
    }

    if (user.role === ROLE.STUDENT) {
      if (await this.studentCanAccessAssignedFile(user, file.id)) return file;
    }

    throw forbidden('Недостаточно прав для доступа к файлу.');
  }

  private fileIdInAttachments(items: unknown, fileId: string): boolean {
    return Array.isArray(items) && items.some((item: any) => cleanText(item?.fileId || item?.fileResource?.id) === fileId);
  }

  private async studentCanAccessAssignedFile(user: AuthUser, fileId: string): Promise<boolean> {
    if (!user.studentId) return false;
    const student = await this.prisma.studentProfile.findFirst({
      where: { id: user.studentId, userId: user.id },
      select: { id: true, teacherId: true },
    });
    if (!student) return false;

    const [lessons, homeworks] = await Promise.all([
      this.prisma.lesson.findMany({
        where: { studentId: student.id },
        select: { focusTaskNumbers: true, materials: true },
      }),
      this.prisma.homework.findMany({
        where: { studentId: student.id },
        select: { taskNumbers: true, materials: true, reviewMaterials: true },
      }),
    ]);

    const embedded = [
      ...lessons.flatMap((lesson: any) => [lesson.materials]),
      ...homeworks.flatMap((homework: any) => [homework.materials, homework.reviewMaterials]),
    ].some((items) => this.fileIdInAttachments(items, fileId));
    if (embedded) return true;

    const taskNumbers = [...new Set([
      ...lessons.flatMap((lesson: any) => lesson.focusTaskNumbers || []),
      ...homeworks.flatMap((homework: any) => homework.taskNumbers || []),
    ])];
    if (!taskNumbers.length) return false;

    const assignedMaterial = await this.prisma.materialAttachment.findFirst({
      where: {
        fileId,
        topic: {
          teacherId: student.teacherId,
          taskNumber: { in: taskNumbers },
        },
      },
      select: { id: true },
    });
    return Boolean(assignedMaterial);
  }

  async requireDownloadableFile(user: AuthUser, id: string) {
    const file = await this.requireAccessibleFile(user, id);
    if (!fs.existsSync(file.storagePath)) throw notFound('Файл не найден в хранилище.');
    return file;
  }

  async normalizeEmbeddedAttachments(user: AuthUser, attachments: unknown, field = 'materials') {
    if (attachments === undefined || attachments === null || attachments === '') return [];
    if (!Array.isArray(attachments)) throw validationError('Материалы должны быть массивом.', { [field]: 'invalid' });

    const normalized = [];
    for (const [index, raw] of attachments.entries()) {
      if (!raw || typeof raw !== 'object') {
        throw validationError('Некорректное вложение материала.', { [`${field}.${index}`]: 'invalid' });
      }
      const item = raw as AttachmentLike;
      const type = cleanText(item.type || (item.fileId || item.fileResource?.id ? MATERIAL_TYPE.FILE : item.url ? MATERIAL_TYPE.LINK : MATERIAL_TYPE.LIBRARY));

      if (type === MATERIAL_TYPE.FILE) {
        const fileId = requireText(item.fileId || item.fileResource?.id, `${field}.${index}.fileId`);
        const file = await this.requireAttachableFile(user, fileId);
        await this.markFileScope(file.id, FILE_SCOPE.TEACHER_MATERIAL);
        const mappedFile = this.mapFile(file);
        normalized.push({
          id: cleanText(item.id),
          type: MATERIAL_TYPE.FILE,
          source: MATERIAL_SOURCE.UPLOAD,
          title: cleanText(item.title) || file.originalName,
          url: mappedFile.url,
          fileId: file.id,
          originalName: file.originalName,
          fileName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          uploadedAt: file.uploadedAt.toISOString(),
          fileResource: mappedFile,
        });
        continue;
      }

      if (type === MATERIAL_TYPE.LINK) {
        const url = requireText(item.url, `${field}.${index}.url`);
        normalized.push({
          id: cleanText(item.id),
          type: MATERIAL_TYPE.LINK,
          source: MATERIAL_SOURCE.LINK,
          title: cleanText(item.title) || url,
          url,
        });
        continue;
      }

      if (type === MATERIAL_TYPE.LIBRARY) {
        normalized.push({
          id: cleanText(item.id),
          type: MATERIAL_TYPE.LIBRARY,
          source: cleanText(item.source) || MATERIAL_SOURCE.LIBRARY,
          title: requireText(item.title, `${field}.${index}.title`),
          url: cleanText(item.url),
          fileId: cleanText(item.fileId),
        });
        continue;
      }

      throw validationError('Некорректный тип материала.', { [`${field}.${index}.type`]: 'invalid' });
    }

    return normalized;
  }

  mapFile(file: any) {
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      url: buildFileDownloadUrl(this.config, file.id),
      uploadedAt: file.uploadedAt.toISOString(),
    };
  }
}
