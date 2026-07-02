/*
 * OGE Tutor App — teacher student access UI tests.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_STATUS } from '../src/api/contracts.js';
import { CreateStudent, StudentCard } from '../src/teacher/TeacherStudents.jsx';

const invitePreview = {
  link: 'http://localhost:8080/setup-password?token=invite-token',
  token: 'invite-token',
  expiresAt: '2026-07-09T00:00:00.000Z',
};

function student(overrides = {}) {
  return {
    id: 'student-1',
    teacherId: 'teacher-1',
    role: 'student',
    name: 'Student One',
    email: 'student1@example.com',
    grade: '9 класс',
    goal: 'ОГЭ на 5',
    note: 'Acceptance note',
    avatar: '',
    bg: '',
    access: ACCESS_STATUS.INVITE_SENT,
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

afterEach(() => cleanup());

describe('teacher student access UI', () => {
  it('shows dev invite preview after creating a student without auto-closing the form', async () => {
    const onBack = vi.fn();
    const createStudent = vi.fn(async () => ({ invite: invitePreview }));
    render(React.createElement(CreateStudent, { actions: { createStudent }, onBack }));

    fireEvent.change(screen.getByLabelText('Имя ученика'), { target: { value: 'Student One' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student1@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать доступ' }));

    await waitFor(() => expect(createStudent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Student One',
      email: 'student1@example.com',
    })));
    expect(await screen.findByText('Dev-ссылка приглашения')).toBeTruthy();
    expect(screen.getByText(invitePreview.link)).toBeTruthy();
    expect(screen.getByText(invitePreview.token)).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('shows refreshed access preview on the student access tab', async () => {
    const resendStudentInvite = vi.fn(async () => ({ invite: invitePreview }));
    render(React.createElement(StudentCard, {
      data: {
        students: [student()],
        lessons: [],
        homeworks: [],
        materials: [],
        notifications: [],
      },
      actions: { resendStudentInvite },
      studentId: 'student-1',
      openMode: vi.fn(),
      openHomework: vi.fn(),
      openLesson: vi.fn(),
      onBack: vi.fn(),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Доступ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить приглашение' }));

    await waitFor(() => expect(resendStudentInvite).toHaveBeenCalledWith('student-1'));
    expect(await screen.findByText('Ссылка приглашения обновлена.')).toBeTruthy();
    expect(screen.getByText(invitePreview.link)).toBeTruthy();
  });
});
