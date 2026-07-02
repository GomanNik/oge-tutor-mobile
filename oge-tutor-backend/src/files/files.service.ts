import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { FILE_SCOPE, FileScope, MATERIAL_SOURCE, MATERIAL_TYPE, ROLE } from '../common/contracts';
import { forbidden, notFound, validationError } from '../common/app-error';
import { cleanText, requireText } from '../common/validation';
import { buildFileDownloadUrl } from './file-url';

const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/', 'text/plain', 'application/vnd.openxmlformats-officedocument', 'application/msword'];

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

  async saveUploadedFile(user: AuthUser, file: Express.Multer.File, meta: { title?: string; context?: string } = {}) {
    if (!file) throw validationError('Выберите файл.', { file: 'required' });
    const maxBytes = Number(this.config.get('MAX_UPLOAD_BYTES') || 15 * 1024 * 1024);
    if (file.size > maxBytes) throw validationError('Файл слишком большой.', { file: 'too_large' });
    if (file.mimetype && !ALLOWED_MIME_PREFIXES.some((prefix) => file.mimetype.startsWith(prefix))) {
      throw validationError('Тип файла не поддерживается.', { file: 'unsupported_type' });
    }

    const uploadDir = this.config.get<string>('UPLOAD_DIR') || 'uploads';
    const absoluteDir = path.resolve(process.cwd(), uploadDir);
    fs.mkdirSync(absoluteDir, { recursive: true });
    const safeExt = path.extname(file.originalname).replace(/[^.a-zA-Z0-9]/g, '') || '';
    const storedName = `${randomUUID()}${safeExt}`;
    const storagePath = path.join(absoluteDir, storedName);
    fs.writeFileSync(storagePath, file.buffer);

    const fileId = randomUUID();
    const url = buildFileDownloadUrl(this.config, fileId);

    return this.prisma.fileResource.create({
      data: {
        id: fileId,
        ownerId: user.id,
        scope: this.uploadScope(user, meta.context),
        originalName: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
        url,
        storagePath,
      },
    });
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
