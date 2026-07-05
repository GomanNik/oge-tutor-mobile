/*
 * OGE Tutor App — frontend product flow regression tests.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_STATUS, HOMEWORK_STATUS, LESSON_SOURCE, LESSON_STATUS, MATERIAL_SOURCE, MATERIAL_TYPE, TEACHER_ROUTE } from '../src/api/contracts.js';
import { NotificationInbox } from '../src/shared/NotificationsScreen.jsx';
import ProfileScreen from '../src/profile/ProfileScreen.jsx';
import { CreateHomework } from '../src/teacher/TeacherHomework.jsx';
import TeacherHome from '../src/teacher/TeacherHome.jsx';
import { CreateLesson, LessonDetail } from '../src/teacher/TeacherLessons.jsx';
import { MaterialsList } from '../src/teacher/TeacherMaterials.jsx';
import { StudentCard } from '../src/teacher/TeacherStudents.jsx';
import { StudentProgress } from '../src/student/StudentProgress.jsx';

function isoOffset(days, hour = 10) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function baseStudent(overrides = {}) {
  return {
    id: 's-1',
    teacherId: 't-1',
    role: 'student',
    name: 'Иван Петров',
    email: 'ivan@example.com',
    grade: '9 класс',
    goal: 'ОГЭ на 4',
    note: '',
    avatar: 'bear',
    bg: 'blue',
    access: ACCESS_STATUS.ACTIVE,
    settings: {},
    progressByTask: [],
    weak: [],
    coveragePercent: 0,
    masteryPercent: 0,
    progress: 0,
    primaryScore: 0,
    predictedMark: 2,
    ...overrides,
  };
}

function baseData(overrides = {}) {
  const materialFile = {
    id: 'mf-1',
    type: MATERIAL_TYPE.FILE,
    source: MATERIAL_SOURCE.UPLOAD,
    title: 'Теория.pdf',
    fileName: 'Теория.pdf',
    originalName: 'Теория.pdf',
    fileId: 'file-mf-1',
    url: '/files/file-mf-1/download',
  };
  return {
    teacher: { id: 't-1', name: 'Анна', email: 'teacher@example.com', avatar: 'owl', bg: 'blue', settings: {} },
    students: [baseStudent()],
    lessons: [{
      id: 'l-1',
      teacherId: 't-1',
      studentId: 's-1',
      topic: 'Графики',
      focusTaskNumbers: [4],
      startAt: isoOffset(1),
      endAt: isoOffset(1, 11),
      timezone: 'Europe/Moscow',
      durationMinutes: 60,
      status: LESSON_STATUS.PLANNED,
      source: LESSON_SOURCE.MANUAL,
      materials: [{ type: MATERIAL_TYPE.LIBRARY, libraryFileId: 'mf-1', title: 'Теория.pdf' }],
      createdAt: isoOffset(-2),
      updatedAt: isoOffset(-2),
    }],
    homeworks: [{
      id: 'hw-1',
      teacherId: 't-1',
      studentId: 's-1',
      title: 'Графики: тренировка',
      topic: 'Задание 4',
      taskNumbers: [4],
      dueAt: isoOffset(3),
      assignedAt: isoOffset(-1),
      status: HOMEWORK_STATUS.ASSIGNED,
      description: 'Решить подборку.',
      materials: [],
      reviewMaterials: [],
      attempts: [],
      solutionFile: '',
    }],
    materials: [{ id: 'm-4', taskNumber: 4, title: 'Графики', files: [materialFile] }],
    notifications: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('redesigned teacher product flows', () => {
  it('answers what the teacher should do today on the dashboard', () => {
    const today = new Date();
    today.setHours(18, 0, 0, 0);
    const data = baseData({
      lessons: [{
        ...baseData().lessons[0],
        startAt: today.toISOString(),
        endAt: new Date(today.getTime() + 60 * 60 * 1000).toISOString(),
      }],
    });

    render(React.createElement(TeacherHome, {
      data,
      notifications: [],
      openStudent: vi.fn(),
      openLesson: vi.fn(),
      openHomework: vi.fn(),
      openMode: vi.fn(),
      navigate: vi.fn(),
    }));

    expect(screen.getByText('1 занятие в расписании')).toBeTruthy();
    expect(screen.getByText('Ближайшее занятие')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Проверить работы' })).toBeTruthy();
  });

  it('opens lesson and homework creation with student context from the student card', () => {
    const openMode = vi.fn();
    render(React.createElement(StudentCard, {
      data: baseData(),
      actions: {},
      studentId: 's-1',
      openMode,
      openHomework: vi.fn(),
      openLesson: vi.fn(),
      onBack: vi.fn(),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Создать урок' }));
    expect(openMode).toHaveBeenCalledWith('create-lesson', TEACHER_ROUTE.SCHEDULE, { studentId: 's-1' });

    fireEvent.click(screen.getByRole('button', { name: 'Выдать ДЗ' }));
    expect(openMode).toHaveBeenCalledWith('create-homework', TEACHER_ROUTE.HOMEWORK, { studentId: 's-1' });
  });

  it('preselects the student in lesson and homework forms', () => {
    const data = baseData();
    render(React.createElement(CreateLesson, { data, actions: { createLesson: vi.fn() }, context: { studentId: 's-1' }, onBack: vi.fn() }));
    expect(screen.getByLabelText('Ученик').value).toBe('s-1');
    cleanup();

    render(React.createElement(CreateHomework, { data, actions: { createHomework: vi.fn() }, context: { studentId: 's-1', taskNumbers: [4] }, onBack: vi.fn() }));
    expect(screen.getByLabelText('Ученик').value).toBe('s-1');
    expect(screen.getByLabelText('Номера заданий').value).toBe('4');
    expect(screen.getByRole('button', { name: 'Выдать ДЗ' }).disabled).toBe(true);
  });

  it('keeps future lessons from being marked completed in one click', () => {
    const data = baseData();
    render(React.createElement(LessonDetail, { data, actions: {}, lessonId: 'l-1', onBack: vi.fn(), openMode: vi.fn() }));
    expect(screen.getByRole('button', { name: 'Проведён' }).disabled).toBe(true);
    expect(screen.getByText(/Будущий урок нельзя отметить проведённым/)).toBeTruthy();
  });

  it('shows material detail actions and usage without exposing technical URLs as row text', () => {
    render(React.createElement(MaterialsList, {
      data: baseData(),
      actions: { removeMaterialFile: vi.fn(), updateMaterialFile: vi.fn() },
      openUpload: vi.fn(),
      openLesson: vi.fn(),
      openHomework: vi.fn(),
      openStudent: vi.fn(),
    }));

    fireEvent.click(screen.getByText('Графики'));
    fireEvent.click(screen.getByText('Теория.pdf'));

    expect(screen.getByRole('button', { name: 'Скачать' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Редактировать' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Заменить файл' })).toBeTruthy();
    expect(screen.getByText(/Урок/)).toBeTruthy();
    expect(screen.queryByText(/\/files\/file-mf-1\/download/)).toBeNull();
  });

  it('renders notification inbox entries as actionable rows', () => {
    const onOpen = vi.fn();
    render(React.createElement(NotificationInbox, {
      notifications: [{ id: 'n-1', type: 'homework_submitted', title: 'Работа ждёт проверки', message: 'Иван · Графики', tone: 'amber', homeworkId: 'hw-1' }],
      onOpen,
    }));

    fireEvent.click(screen.getByRole('button', { name: /Работа ждёт проверки/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ homeworkId: 'hw-1' }));
  });

  it('keeps profile/account actions clickable', () => {
    render(React.createElement(ProfileScreen, {
      profile: { id: 't-1', name: 'Анна', email: 'teacher@example.com', avatar: 'owl', bg: 'blue', settings: {} },
      role: 'teacher',
      onSaveVisual: vi.fn(),
      onSaveAccount: vi.fn(),
      onSaveSecurity: vi.fn(),
      onSaveNotifications: vi.fn(),
      onLogout: vi.fn(),
    }));

    fireEvent.click(screen.getByRole('button', { name: /Настройки аккаунта/ }));
    expect(screen.getByLabelText('Email для входа')).toBeTruthy();
    expect(screen.getByLabelText('Текущий пароль')).toBeTruthy();
  });

  it('shows honest progress empty state for students without assessed weak tasks', () => {
    render(React.createElement(StudentProgress, {
      student: baseStudent(),
      homeworks: [],
      materials: [],
      openWeakTask: vi.fn(),
    }));

    expect(screen.getByText('Слабых заданий нет')).toBeTruthy();
    expect(screen.getByText(/Серые задания ещё не проходили/)).toBeTruthy();
  });
});
