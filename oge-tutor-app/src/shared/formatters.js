/*
 * OGE Tutor App — formatters and domain helpers.
 * Pure helpers only: no React and no state mutation.
 */
import { HOMEWORK_STATUS, MATERIAL_SOURCE, MATERIAL_TYPE, materialTypeLabel as contractMaterialTypeLabel, normalizeHomeworkStatus } from '../api/contracts.js';
import { nowIso } from './dateTime.js';
import { EDITABLE_HOMEWORK_STATUSES, STUDENT_SUBMITTABLE_HOMEWORK_STATUSES } from './constants.js';

export function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function normalizeComparable(value) {
  return normalizeText(value).toLowerCase();
}

export function parseTaskNumberInput(raw) {
  const tokens = String(raw || '')
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const taskNumbers = [];
  const invalidTokens = [];
  const outOfRange = [];
  const duplicates = [];

  tokens.forEach((token) => {
    if (!/^\d+$/.test(token)) {
      invalidTokens.push(token);
      return;
    }

    const taskNumber = Number(token);
    if (taskNumber < 1 || taskNumber > 25) {
      outOfRange.push(taskNumber);
      return;
    }

    if (taskNumbers.includes(taskNumber)) duplicates.push(taskNumber);
    else taskNumbers.push(taskNumber);
  });

  return { taskNumbers, invalidTokens, outOfRange, duplicates };
}

export function parseTaskNumbers(raw) {
  return parseTaskNumberInput(raw).taskNumbers;
}

export function formatMaterialCount(count) {
  const value = Number(count) || 0;
  const lastDigit = value % 10;
  const lastTwoDigits = value % 100;

  if (lastDigit === 1 && lastTwoDigits !== 11) return `${value} материал`;
  if ([2, 3, 4].includes(lastDigit) && ![12, 13, 14].includes(lastTwoDigits)) return `${value} материала`;
  return `${value} материалов`;
}

export function makeTimestamp() {
  return nowIso();
}

export function isHomeworkClosed(homework) {
  return normalizeHomeworkStatus(homework?.status) === HOMEWORK_STATUS.REVIEWED;
}

export function isHomeworkEditable(homework) {
  return EDITABLE_HOMEWORK_STATUSES.includes(normalizeHomeworkStatus(homework?.status));
}

export function isHomeworkReviewable(homework) {
  return normalizeHomeworkStatus(homework?.status) === HOMEWORK_STATUS.SUBMITTED && Boolean(homework?.solutionFile);
}

export function isHomeworkWaitingStudent(homework) {
  return STUDENT_SUBMITTABLE_HOMEWORK_STATUSES.includes(normalizeHomeworkStatus(homework?.status));
}

export function canStudentSubmitHomework(homework) {
  return STUDENT_SUBMITTABLE_HOMEWORK_STATUSES.includes(normalizeHomeworkStatus(homework?.status));
}

export function homeworkStatusHint(homework) {
  const status = normalizeHomeworkStatus(homework?.status);
  if (status === HOMEWORK_STATUS.REVIEWED) return 'Проверено и закрыто: можно только просматривать.';
  if (status === HOMEWORK_STATUS.SUBMITTED) return 'Ученик отправил решение. Можно проверить работу.';
  if (status === HOMEWORK_STATUS.NEEDS_REVISION) return 'Работа возвращена ученику. Ожидается повторная отправка.';
  if (status === HOMEWORK_STATUS.OVERDUE) return 'Дедлайн прошёл, но решение ещё не отправлено.';
  return 'Домашняя работа назначена ученику.';
}

export function topicTitleFromTasks(taskNumbers) {
  return taskNumbers.length === 1 ? `Задание ${taskNumbers[0]}` : `Задания ${taskNumbers.join(', ')}`;
}

export function ensureUrlProtocol(url) {
  const cleanUrl = normalizeText(url);
  if (!cleanUrl) return '';
  return /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
}

export function isProbablyUrl(url) {
  const normalized = ensureUrlProtocol(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return Boolean(parsed.hostname && parsed.hostname.includes('.'));
  } catch {
    return false;
  }
}

export function deriveLinkTitle(url) {
  const cleanUrl = normalizeText(url);
  if (!cleanUrl) return '';
  try {
    const parsed = new URL(ensureUrlProtocol(cleanUrl));
    const host = parsed.hostname.replace(/^www\./, '');
    const pathName = parsed.pathname.replace(/^\//, '').replace(/\/$/, '');
    return pathName ? `${host}/${pathName.split('/')[0]}` : host;
  } catch {
    return cleanUrl;
  }
}

export function materialTypeLabel(type) {
  return contractMaterialTypeLabel(type);
}

export function materialIcon(type) {
  if (type === MATERIAL_TYPE.LINK) return '↗';
  if (type === MATERIAL_TYPE.LIBRARY) return '▦';
  return '↓';
}

export function materialDisplayTitle(material) {
  return normalizeText(material?.title || material?.fileName || material?.url || 'Материал');
}

export function materialSourceText(material) {
  const parts = [];

  if (material?.taskNumber) parts.push(`задание ${material.taskNumber}`);
  if (material?.topicTitle) parts.push(material.topicTitle);
  const sourceLabel = material?.source === MATERIAL_SOURCE.UPLOAD
    ? materialTypeLabel(MATERIAL_TYPE.FILE)
    : material?.source === MATERIAL_SOURCE.LINK
      ? materialTypeLabel(MATERIAL_TYPE.LINK)
      : material?.source === MATERIAL_SOURCE.LIBRARY
        ? materialTypeLabel(MATERIAL_TYPE.LIBRARY)
        : materialTypeLabel(material?.type);
  parts.push(sourceLabel);

  return parts.filter(Boolean).join(' · ');
}

export function materialActionLabel(material) {
  if (material?.type === MATERIAL_TYPE.LINK) return 'Открыть';
  if (material?.type === MATERIAL_TYPE.FILE || material?.fileId || material?.originalName) return 'Скачать';
  return 'Открыть';
}

export function materialKindLabel(material) {
  if (material?.type === MATERIAL_TYPE.LINK) return 'Ссылка';
  if (material?.type === MATERIAL_TYPE.LIBRARY) return 'Из библиотеки';
  return 'Файл';
}

export function materialKey(material) {
  const type = normalizeComparable(material?.type || 'file');
  const url = normalizeComparable(ensureUrlProtocol(material?.url || ''));
  const title = normalizeComparable(materialDisplayTitle(material));
  const taskNumber = normalizeComparable(material?.taskNumber || '');
  const topicId = normalizeComparable(material?.topicId || '');
  const libraryFileId = normalizeComparable(material?.libraryFileId || material?.fileId || material?.id || '');

  if (type === MATERIAL_TYPE.LINK) return `link:${url || title}`;
  if (type === MATERIAL_TYPE.LIBRARY) return `library:${topicId || taskNumber}:${libraryFileId || url || title}`;
  return `file:${title}`;
}

export function isSameMaterial(a, b) {
  return materialKey(a) === materialKey(b);
}

export function buildFileMaterial(fileName, file = null) {
  const cleanFileName = normalizeText(fileName || file?.name);
  return {
    type: MATERIAL_TYPE.FILE,
    source: MATERIAL_SOURCE.UPLOAD,
    title: cleanFileName,
    fileName: cleanFileName,
    originalName: file?.name || cleanFileName,
    mimeType: file?.type || 'application/octet-stream',
    size: Number(file?.size || 0),
    file: file || undefined,
  };
}

export function buildFileMaterialFromFile(file, fallbackName = '') {
  return buildFileMaterial(file?.name || fallbackName, file || null);
}

export function buildLinkMaterial(url) {
  const normalizedUrl = ensureUrlProtocol(url);
  return {
    type: MATERIAL_TYPE.LINK,
    title: deriveLinkTitle(normalizedUrl),
    url: normalizedUrl,
    source: MATERIAL_SOURCE.LINK,
  };
}

export function buildLibraryMaterial(topic, file) {
  const title = materialDisplayTitle(file);
  return {
    type: MATERIAL_TYPE.LIBRARY,
    title,
    source: MATERIAL_SOURCE.LIBRARY,
    taskNumber: topic.taskNumber,
    topicId: topic.id,
    topicTitle: topic.title,
    libraryFileId: file.id || materialKey(file),
    url: file.url || '',
    fileName: file.fileName || file.title || '',
  };
}

export function enrichLibraryFile(topic, file) {
  return {
    ...file,
    source: file.source || materialTypeLabel(file.type),
    taskNumber: file.taskNumber || topic.taskNumber,
    topicId: file.topicId || topic.id,
    topicTitle: file.topicTitle || topic.title,
  };
}
