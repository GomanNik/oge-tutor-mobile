import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { MATERIAL_SOURCE, MATERIAL_TYPE, ROLE } from '../common/contracts';
import { forbidden, validationError } from '../common/app-error';
import { cleanText, requireText } from '../common/validation';
import { logDb, logDomain } from '../common/app-logger';

const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/', 'text/plain', 'application/vnd.openxmlformats-officedocument', 'application/msword'];

type AttachmentLike = Record<string, any>;

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async saveUploadedFile(user: AuthUser, file: Express.Multer.File, _meta: { title?: string; context?: string } = {}) {
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

    const publicBase = cleanText(this.config.get<string>('PUBLIC_BACKEND_URL')) || `http://localhost:${this.config.get('PORT') || 3000}`;
    const url = `${publicBase.replace(/\/$/, '')}/uploads/${storedName}`;

    const resource = await this.prisma.fileResource.create({
      data: {
        ownerId: user.id,
        originalName: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
        url,
        storagePath,
      },
    });
    logDb('create fileResource', { id: resource.id, ownerId: user.id, size: resource.size });
    logDomain('file.uploaded', { fileId: resource.id, ownerId: user.id, originalName: resource.originalName, size: resource.size });
    return resource;
  }

  async requireFile(id: string) {
    const file = await this.prisma.fileResource.findUnique({ where: { id } });
    if (!file) throw validationError('Загруженный файл не найден.', { fileId: 'not_found' });
    return file;
  }

  async requireAccessibleFile(user: AuthUser, id: string) {
    const file = await this.requireFile(id);
    if (!file.ownerId) return file;
    if (file.ownerId === user.id) return file;

    if (user.role === ROLE.TEACHER && user.teacherId) {
      const studentOwner = await this.prisma.studentProfile.findFirst({
        where: { userId: file.ownerId, teacherId: user.teacherId },
        select: { id: true },
      });
      if (studentOwner) return file;
    }

    throw forbidden('Недостаточно прав для доступа к файлу.');
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
        const file = await this.requireAccessibleFile(user, fileId);
        normalized.push({
          id: cleanText(item.id),
          type: MATERIAL_TYPE.FILE,
          source: MATERIAL_SOURCE.UPLOAD,
          title: cleanText(item.title) || file.originalName,
          url: file.url,
          fileId: file.id,
          originalName: file.originalName,
          fileName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          uploadedAt: file.uploadedAt.toISOString(),
          fileResource: this.mapFile(file),
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
      url: file.url,
      uploadedAt: file.uploadedAt.toISOString(),
    };
  }
}
