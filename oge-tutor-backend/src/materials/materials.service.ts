import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user';
import { MATERIAL_SOURCE, MATERIAL_TYPE, ROLE } from '../common/contracts';
import { forbidden, notFound, validationError } from '../common/app-error';
import { cleanText, parseTaskNumbers, requireText } from '../common/validation';
import { logDb, logDomain } from '../common/app-logger';
import { FilesService } from '../files/files.service';

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService, private readonly files: FilesService) {}

  assertTeacher(user: AuthUser) {
    if (user.role !== ROLE.TEACHER || !user.teacherId) throw forbidden();
    return user.teacherId;
  }

  async loadTopic(topicId: string) {
    return this.prisma.materialTopic.findUnique({
      where: { id: topicId },
      include: { files: { include: { file: true }, orderBy: { createdAt: 'desc' } } },
    });
  }

  async add(user: AuthUser, payload: any) {
    const teacherId = this.assertTeacher(user);
    const [taskNumber] = parseTaskNumbers([payload.taskNumber], 'taskNumber');
    const title = cleanText(payload.topicTitle) || `Задание ${taskNumber}`;
    const type = payload.type;
    if (!Object.values(MATERIAL_TYPE).includes(type)) throw validationError('Некорректный тип материала.', { type: 'invalid' });

    const topic = await this.prisma.materialTopic.upsert({
      where: { teacherId_taskNumber: { teacherId, taskNumber } },
      create: { teacherId, taskNumber, title },
      update: { title },
    });

    const item = payload.item || {};
    if (type === MATERIAL_TYPE.LINK) {
      const url = requireText(item.url || payload.url, 'url');
      const attachment = await this.prisma.materialAttachment.create({
        data: { topicId: topic.id, type, source: MATERIAL_SOURCE.LINK, title: cleanText(item.title) || url, url },
      });
      logDb('create materialAttachment', { id: attachment.id, topicId: topic.id, type });
      logDomain('material.attached', { topicId: topic.id, attachmentId: attachment.id, type });
      return this.loadTopic(topic.id);
    }

    if (type === MATERIAL_TYPE.FILE) {
      const fileId = requireText(payload.fileId || item.fileId, 'fileId');
      const file = await this.files.requireAccessibleFile(user, fileId);
      const attachment = await this.prisma.materialAttachment.create({
        data: {
          topicId: topic.id,
          type,
          source: MATERIAL_SOURCE.UPLOAD,
          title: cleanText(item.title) || file.originalName,
          url: file.url,
          fileId: file.id,
          originalName: file.originalName,
          fileName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          uploadedAt: file.uploadedAt,
        },
      });
      logDb('create materialAttachment', { id: attachment.id, topicId: topic.id, type, fileId: file.id });
      logDomain('material.attached', { topicId: topic.id, attachmentId: attachment.id, type, fileId: file.id });
      return this.loadTopic(topic.id);
    }

    const attachment = await this.prisma.materialAttachment.create({
      data: { topicId: topic.id, type, source: MATERIAL_SOURCE.LIBRARY, title: requireText(item.title || payload.title, 'title'), url: cleanText(item.url) },
    });
    logDb('create materialAttachment', { id: attachment.id, topicId: topic.id, type });
    logDomain('material.attached', { topicId: topic.id, attachmentId: attachment.id, type });
    return this.loadTopic(topic.id);
  }

  async removeFile(user: AuthUser, topicId: string, fileId: string) {
    const teacherId = this.assertTeacher(user);
    const topic = await this.prisma.materialTopic.findFirst({ where: { id: topicId, teacherId } });
    if (!topic) throw notFound('Тема материалов не найдена.');
    const item = await this.prisma.materialAttachment.findFirst({ where: { id: fileId, topicId } });
    if (!item) throw notFound('Материал не найден.');
    await this.prisma.materialAttachment.delete({ where: { id: fileId } });
    logDb('delete materialAttachment', { topicId, fileId });
    return { topicId, fileId };
  }
}
