/*
 * OGE Tutor App — mock backend seed data.
 * Demo users and sample entities live here only for the development mock backend. Runtime UI must never import this file.
 */
import { ACCESS_STATUS, HOMEWORK_STATUS, LESSON_SOURCE, LESSON_STATUS, MATERIAL_SOURCE, MATERIAL_TYPE, NOTIFICATION_STATUS, NOTIFICATION_TYPE, PROGRESS_COVERAGE_STATUS, PROGRESS_MASTERY_LEVEL, PROGRESS_SOURCE, ROLE, SUBMISSION_STATUS } from '../api/contracts.js';
import { getDefaultNotifications } from '../profile/profileOptions.js';

export const DEMO_PASSWORD = '123456';

const TEACHER_ID = 't-1';


function progressEntry(taskNumber, coverageStatus, masteryLevel = null, extra = {}) {
  return {
    taskNumber,
    coverageStatus,
    masteryLevel,
    lessonCount: extra.lessonCount || 0,
    lastLessonId: extra.lastLessonId || '',
    lastActivityAt: extra.lastActivityAt || '',
    lastAssessedAt: extra.lastAssessedAt || '',
    source: extra.source || PROGRESS_SOURCE.MANUAL,
    teacherComment: extra.teacherComment || '',
    recommendedAction: extra.recommendedAction || '',
    history: extra.history || [],
  };
}

function assessmentEvent(id, taskNumber, lessonId, createdAt) {
  return {
    id,
    type: 'lesson_completed',
    source: PROGRESS_SOURCE.LESSON_COMPLETED,
    taskNumber,
    lessonId,
    coverageStatus: PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED,
    masteryLevel: null,
    comment: '',
    createdAt,
  };
}

function fileAttachment(id, title, extra = {}) {
  return {
    id,
    type: MATERIAL_TYPE.FILE,
    source: MATERIAL_SOURCE.UPLOAD,
    title,
    fileName: title,
    originalName: title,
    fileId: `file-${id}`,
    mimeType: title.endsWith('.png') ? 'image/png' : 'application/pdf',
    size: extra.size || 0,
    url: extra.url || `/mock-files/${encodeURIComponent(title)}`,
    uploadedAt: extra.uploadedAt || '2026-05-01T09:00:00.000Z',
  };
}

function libraryAttachment(id, taskNumber, topicTitle, title) {
  return {
    id,
    type: MATERIAL_TYPE.LIBRARY,
    source: MATERIAL_SOURCE.LIBRARY,
    title,
    taskNumber,
    topicTitle,
    libraryFileId: id,
    fileName: title,
  };
}

function linkAttachment(id, title, url) {
  return {
    id,
    type: MATERIAL_TYPE.LINK,
    source: MATERIAL_SOURCE.LINK,
    title,
    url,
  };
}

export const INITIAL_DATA = {
  teacher: {
    id: TEACHER_ID,
    name: 'Анна Сергеева',
    email: 'teacher@mail.ru',
    role: ROLE.TEACHER,
    avatar: 'owl',
    bg: 'blue',
    createdAt: '2026-04-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:00:00.000Z',
    settings: { notifications: getDefaultNotifications(ROLE.TEACHER) },
  },
  students: [
    {
      id: 's-1', teacherId: TEACHER_ID, name: 'Иван Петров', email: 'ivan@mail.ru', grade: '9 класс', goal: 'ОГЭ на 4',
      role: ROLE.STUDENT, avatar: 'bear', bg: 'blue', access: ACCESS_STATUS.ACTIVE,
      progressByTask: [
        progressEntry(1, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.STRONG, { lastAssessedAt: '2026-05-05T11:00:00.000Z', source: PROGRESS_SOURCE.DIAGNOSTIC }),
        progressEntry(2, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.GOOD, { lastAssessedAt: '2026-05-05T11:00:00.000Z', source: PROGRESS_SOURCE.DIAGNOSTIC }),
        progressEntry(3, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.GOOD, { lastAssessedAt: '2026-05-05T11:00:00.000Z', source: PROGRESS_SOURCE.DIAGNOSTIC }),
        progressEntry(4, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.WEAK, { lastAssessedAt: '2026-05-10T18:00:00.000Z', source: PROGRESS_SOURCE.HOMEWORK_RESULT, teacherComment: 'Ошибается при чтении графиков.', recommendedAction: 'Дать короткую подборку по графикам.' }),
        progressEntry(5, PROGRESS_COVERAGE_STATUS.IN_PROGRESS, null, { lessonCount: 1, lastLessonId: 'l-1', lastActivityAt: '2026-05-12T16:00:00.000Z', source: PROGRESS_SOURCE.LESSON_COMPLETED }),
        progressEntry(7, PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED, null, { lessonCount: 2, lastLessonId: 'l-1', lastActivityAt: '2026-05-12T16:00:00.000Z', source: PROGRESS_SOURCE.LESSON_COMPLETED, history: [assessmentEvent('pe-s1-7-l1', 7, 'l-1', '2026-05-12T16:00:00.000Z')] }),
        progressEntry(17, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.WEAK, { lessonCount: 1, lastLessonId: 'l-4', lastActivityAt: '2026-05-08T16:00:00.000Z', lastAssessedAt: '2026-05-10T18:00:00.000Z', source: PROGRESS_SOURCE.HOMEWORK_RESULT, teacherComment: 'Нужно аккуратнее работать с углами.', recommendedAction: 'Повторить окружность и углы.' }),
      ], note: 'Сильнее алгебра, геометрию нужно держать отдельным фокусом.',
      createdAt: '2026-04-02T08:00:00.000Z', updatedAt: '2026-05-10T08:00:00.000Z',
      settings: { notifications: getDefaultNotifications(ROLE.STUDENT) },
    },
    {
      id: 's-2', teacherId: TEACHER_ID, name: 'Мария Соколова', email: 'maria@mail.ru', grade: '9 класс', goal: 'ОГЭ на 5',
      role: ROLE.STUDENT, avatar: 'cat', bg: 'rose', access: ACCESS_STATUS.ACTIVE,
      progressByTask: [
        progressEntry(1, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.STRONG, { lastAssessedAt: '2026-05-06T11:00:00.000Z', source: PROGRESS_SOURCE.DIAGNOSTIC }),
        progressEntry(2, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.STRONG, { lastAssessedAt: '2026-05-06T11:00:00.000Z', source: PROGRESS_SOURCE.DIAGNOSTIC }),
        progressEntry(6, PROGRESS_COVERAGE_STATUS.ASSESSMENT_NEEDED, null, { lessonCount: 1, lastLessonId: 'l-2', lastActivityAt: '2026-05-14T15:30:00.000Z', source: PROGRESS_SOURCE.LESSON_COMPLETED, history: [assessmentEvent('pe-s2-6-l2', 6, 'l-2', '2026-05-14T15:30:00.000Z')] }),
        progressEntry(7, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.GOOD, { lessonCount: 1, lastLessonId: 'l-2', lastActivityAt: '2026-05-14T15:30:00.000Z', lastAssessedAt: '2026-05-14T16:00:00.000Z', source: PROGRESS_SOURCE.MANUAL }),
        progressEntry(8, PROGRESS_COVERAGE_STATUS.IN_PROGRESS, null, { lessonCount: 1, lastLessonId: 'l-2', lastActivityAt: '2026-05-14T15:30:00.000Z', source: PROGRESS_SOURCE.LESSON_COMPLETED }),
        progressEntry(15, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.WEAK, { lastAssessedAt: '2026-05-09T10:00:00.000Z', source: PROGRESS_SOURCE.DIAGNOSTIC, recommendedAction: 'Вернуться к треугольникам после задания 8.' }),
      ], note: 'Хороший темп. Нужно подтянуть задания второй части.',
      createdAt: '2026-04-03T08:00:00.000Z', updatedAt: '2026-05-10T08:00:00.000Z',
      settings: { notifications: getDefaultNotifications(ROLE.STUDENT) },
    },
    {
      id: 's-3', teacherId: TEACHER_ID, name: 'Артём Иванов', email: 'artem@mail.ru', grade: '9 класс', goal: 'Закрыть базу',
      role: ROLE.STUDENT, avatar: 'fox', bg: 'amber', access: ACCESS_STATUS.INVITE_SENT,
      progressByTask: [
        progressEntry(1, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.MEDIUM, { lastAssessedAt: '2026-05-03T09:00:00.000Z', source: PROGRESS_SOURCE.DIAGNOSTIC }),
        progressEntry(4, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.WEAK, { lastAssessedAt: '2026-05-03T09:00:00.000Z', source: PROGRESS_SOURCE.DIAGNOSTIC }),
        progressEntry(12, PROGRESS_COVERAGE_STATUS.ASSESSED, PROGRESS_MASTERY_LEVEL.WEAK, { lastAssessedAt: '2026-05-07T09:00:00.000Z', source: PROGRESS_SOURCE.HOMEWORK_RESULT }),
        progressEntry(21, PROGRESS_COVERAGE_STATUS.IN_PROGRESS, null, { lessonCount: 1, lastLessonId: 'l-3', lastActivityAt: '2026-05-15T17:00:00.000Z', source: PROGRESS_SOURCE.LESSON_COMPLETED }),
      ], note: 'Есть риск по дедлайнам. Нужен короткий план на неделю.',
      createdAt: '2026-04-04T08:00:00.000Z', updatedAt: '2026-05-10T08:00:00.000Z',
      settings: { notifications: getDefaultNotifications(ROLE.STUDENT) },
    },
  ],
  lessons: [
    { id: 'l-1', teacherId: TEACHER_ID, studentId: 's-1', startAt: '2026-05-12T15:00:00.000Z', endAt: '2026-05-12T16:00:00.000Z', timezone: 'Europe/Moscow', durationMinutes: 60, topic: 'Уравнения и неравенства', focusTaskNumbers: [5, 7], status: LESSON_STATUS.PLANNED, source: LESSON_SOURCE.MANUAL, note: '', materials: [libraryAttachment('la-1', 7, 'Неравенства', 'Неравенства: Правила.pdf'), linkAttachment('la-2', 'Видеоразбор к уроку', 'https://example.com/lesson')], createdAt: '2026-05-01T08:00:00.000Z', updatedAt: '2026-05-01T08:00:00.000Z' },
    { id: 'l-2', teacherId: TEACHER_ID, studentId: 's-2', startAt: '2026-05-14T14:30:00.000Z', endAt: '2026-05-14T15:30:00.000Z', timezone: 'Europe/Moscow', durationMinutes: 60, topic: 'Задания 6–8', focusTaskNumbers: [6, 7, 8], status: LESSON_STATUS.RESCHEDULED, source: LESSON_SOURCE.MANUAL, note: 'Перенесли с 13 мая по просьбе ученика.', materials: [], createdAt: '2026-05-01T08:00:00.000Z', updatedAt: '2026-05-10T08:00:00.000Z' },
    { id: 'l-3', teacherId: TEACHER_ID, studentId: 's-3', startAt: '2026-05-15T16:00:00.000Z', endAt: '2026-05-15T17:00:00.000Z', timezone: 'Europe/Moscow', durationMinutes: 60, topic: 'Текстовые задачи', focusTaskNumbers: [21], status: LESSON_STATUS.PLANNED, source: LESSON_SOURCE.MANUAL, note: '', materials: [], createdAt: '2026-05-01T08:00:00.000Z', updatedAt: '2026-05-01T08:00:00.000Z' },
    { id: 'l-4', teacherId: TEACHER_ID, studentId: 's-1', startAt: '2026-05-08T15:00:00.000Z', endAt: '2026-05-08T16:00:00.000Z', timezone: 'Europe/Moscow', durationMinutes: 60, topic: 'Геометрия', focusTaskNumbers: [17], completedAt: '2026-05-08T16:00:00.000Z', completionComment: 'Повторили окружность и углы.', status: LESSON_STATUS.COMPLETED, source: LESSON_SOURCE.MANUAL, note: '', materials: [libraryAttachment('la-3', 17, 'Геометрия', 'Геометрия: Разбор задания 17.pdf')], createdAt: '2026-05-01T08:00:00.000Z', updatedAt: '2026-05-08T16:00:00.000Z' },
  ],
  materials: [
    { id: 'm-1', taskNumber: 1, title: 'Вычисления', files: [fileAttachment('mf-1', 'Теория.pdf'), fileAttachment('mf-2', 'Тренировка.pdf')] },
    { id: 'm-4', taskNumber: 4, title: 'Графики и функции', files: [fileAttachment('mf-3', 'Теория.pdf'), fileAttachment('mf-4', 'Разбор типовых задач.pdf'), fileAttachment('mf-5', 'Практика.png')] },
    { id: 'm-7', taskNumber: 7, title: 'Неравенства', files: [fileAttachment('mf-6', 'Правила.pdf'), fileAttachment('mf-7', 'Задания.pdf')] },
    { id: 'm-12', taskNumber: 12, title: 'Проценты', files: [fileAttachment('mf-8', 'Краткая теория.pdf'), fileAttachment('mf-9', 'Типовые ошибки.pdf')] },
    { id: 'm-17', taskNumber: 17, title: 'Геометрия', files: [fileAttachment('mf-10', 'Окружность.pdf'), fileAttachment('mf-11', 'Разбор задания 17.pdf')] },
    { id: 'm-22', taskNumber: 22, title: 'График', files: [fileAttachment('mf-12', 'Графики в задачах.pdf')] },
  ],
  homeworks: [
    {
      id: 'hw-1', teacherId: TEACHER_ID, studentId: 's-1', title: 'Вариант 7: задания 1–5', topic: 'Задания 1, 2, 3, 4, 5', taskNumbers: [1, 2, 3, 4, 5],
      assignedAt: '2026-05-10T08:00:00.000Z', dueAt: '2026-05-15T20:59:00.000Z', status: HOMEWORK_STATUS.SUBMITTED, description: 'Решить задания 1–5 из варианта и загрузить фото или PDF с решением.',
      solutionFile: 'variant-7-solution.pdf', submittedAt: '2026-05-14T15:40:00.000Z', reviewedAt: '', closedAt: '',
      attempts: [{ id: 'att-1', homeworkId: 'hw-1', studentId: 's-1', file: 'variant-7-solution.pdf', fileResource: fileAttachment('sf-1', 'variant-7-solution.pdf', { uploadedAt: '2026-05-14T15:40:00.000Z' }), submittedAt: '2026-05-14T15:40:00.000Z', reviewStatus: SUBMISSION_STATUS.SUBMITTED }],
      teacherComment: '',
      materials: [libraryAttachment('ha-1', 1, 'Задания 1–5', 'Теория по заданиям 1–5'), fileAttachment('ha-2', 'Пример оформления решения.pdf')],
      reviewMaterials: [], createdAt: '2026-05-10T08:00:00.000Z', updatedAt: '2026-05-14T15:40:00.000Z',
    },
    {
      id: 'hw-2', teacherId: TEACHER_ID, studentId: 's-1', title: 'Геометрия: задание 17', topic: 'Задание 17', taskNumbers: [17],
      assignedAt: '2026-05-08T08:00:00.000Z', dueAt: '2026-05-10T20:59:00.000Z', status: HOMEWORK_STATUS.REVIEWED, description: 'Повторить свойства окружности и решить подборку задач по геометрии.',
      solutionFile: 'geometry-17.pdf', submittedAt: '2026-05-10T16:15:00.000Z', reviewedAt: '2026-05-10T18:00:00.000Z', closedAt: '2026-05-10T18:00:00.000Z',
      attempts: [{ id: 'att-2', homeworkId: 'hw-2', studentId: 's-1', file: 'geometry-17.pdf', fileResource: fileAttachment('sf-2', 'geometry-17.pdf', { uploadedAt: '2026-05-10T16:15:00.000Z' }), submittedAt: '2026-05-10T16:15:00.000Z', reviewedAt: '2026-05-10T18:00:00.000Z', reviewStatus: SUBMISSION_STATUS.REVIEWED }],
      teacherComment: 'Хорошо оформлено. В третьей задаче нужно аккуратнее подписывать углы.',
      materials: [libraryAttachment('ha-3', 17, 'Геометрия', 'Окружность и углы')],
      reviewMaterials: [linkAttachment('ha-4', 'Видеоразбор ошибки', 'https://example.com/review')], createdAt: '2026-05-08T08:00:00.000Z', updatedAt: '2026-05-10T18:00:00.000Z',
    },
    {
      id: 'hw-3', teacherId: TEACHER_ID, studentId: 's-3', title: 'Текстовые задачи', topic: 'Задание 21', taskNumbers: [21],
      assignedAt: '2026-05-11T08:00:00.000Z', dueAt: '2026-05-18T20:59:00.000Z', status: HOMEWORK_STATUS.OVERDUE, description: 'Переделать задачи на движение и проценты.',
      solutionFile: '', submittedAt: '', reviewedAt: '', closedAt: '', attempts: [], teacherComment: '',
      materials: [fileAttachment('ha-5', 'Алгоритм решения текстовых задач.pdf')],
      reviewMaterials: [], createdAt: '2026-05-11T08:00:00.000Z', updatedAt: '2026-05-11T08:00:00.000Z',
    },
    {
      id: 'hw-4', teacherId: TEACHER_ID, studentId: 's-2', title: 'Задания 6–8', topic: 'Задания 6, 7, 8', taskNumbers: [6, 7, 8],
      assignedAt: '2026-05-11T08:00:00.000Z', dueAt: '2026-05-14T20:59:00.000Z', status: HOMEWORK_STATUS.ASSIGNED, description: 'Тренировка заданий первой части по функциям и неравенствам.',
      solutionFile: '', submittedAt: '', reviewedAt: '', closedAt: '', attempts: [], teacherComment: '',
      materials: [libraryAttachment('ha-6', 7, 'Неравенства', 'Неравенства')],
      reviewMaterials: [], createdAt: '2026-05-11T08:00:00.000Z', updatedAt: '2026-05-11T08:00:00.000Z',
    },
  ],
  notifications: [
    { id: 'ntf-1', type: NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED, status: NOTIFICATION_STATUS.UNREAD, teacherId: TEACHER_ID, studentId: 's-1', taskNumber: 7, lessonId: 'l-1', title: 'Оцените освоение задания 7', message: 'После занятия по заданию 7 нужно выставить уровень освоения для Ивана Петрова.', createdAt: '2026-05-12T16:00:00.000Z', resolvedAt: '' },
    { id: 'ntf-2', type: NOTIFICATION_TYPE.PROGRESS_ASSESSMENT_REQUIRED, status: NOTIFICATION_STATUS.UNREAD, teacherId: TEACHER_ID, studentId: 's-2', taskNumber: 6, lessonId: 'l-2', title: 'Оцените освоение задания 6', message: 'После занятия по заданию 6 нужно выставить уровень освоения для Марии Соколовой.', createdAt: '2026-05-14T15:30:00.000Z', resolvedAt: '' },
  ],
};
