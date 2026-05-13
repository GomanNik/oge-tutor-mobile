/*
 * OGE Tutor App — shared profile options.
 * One editable source for profile icons, backgrounds, role labels and notification settings.
 */
import { PROFILE_ICONS } from '../shared/avatarCatalog.js';

export { PROFILE_ICONS };

export const PROFILE_BACKGROUNDS = [
  {
    id: 'blue',
    label: 'Синий',
    tone: 'blue',
    solid: '#2563eb',
    soft: '#eff6ff',
    text: '#1d4ed8',
  },
  {
    id: 'violet',
    label: 'Фиолетовый',
    tone: 'violet',
    solid: '#7c3aed',
    soft: '#f5f3ff',
    text: '#6d28d9',
  },
  {
    id: 'emerald',
    label: 'Зелёный',
    tone: 'emerald',
    solid: '#059669',
    soft: '#ecfdf5',
    text: '#047857',
  },
  {
    id: 'rose',
    label: 'Розовый',
    tone: 'rose',
    solid: '#f43f5e',
    soft: '#fff1f2',
    text: '#be123c',
  },
  {
    id: 'amber',
    label: 'Тёплый',
    tone: 'amber',
    solid: '#f59e0b',
    soft: '#fffbeb',
    text: '#b45309',
  },
  {
    id: 'slate',
    label: 'Графит',
    tone: 'slate',
    solid: '#1e293b',
    soft: '#f1f5f9',
    text: '#334155',
  },
];

export const ROLE_LABELS = {
  student: 'Ученик',
  teacher: 'Преподаватель',
};

export const NOTIFICATION_SETTINGS = {
  student: [
    {
      id: 'lessonReminders',
      icon: '📅',
      title: 'Напоминания об уроках',
      description: 'Перед ближайшим занятием',
      defaultEnabled: true,
    },
    {
      id: 'homeworkDeadlines',
      icon: '📝',
      title: 'Дедлайны ДЗ',
      description: 'Когда срок сдачи близко',
      defaultEnabled: true,
    },
    {
      id: 'homeworkReviewed',
      icon: '✓',
      title: 'Результат проверки',
      description: 'Когда преподаватель проверил работу',
      defaultEnabled: true,
    },
    {
      id: 'newMaterials',
      icon: '📚',
      title: 'Новые материалы',
      description: 'Когда добавлены материалы к уроку или ДЗ',
      defaultEnabled: true,
    },
  ],
  teacher: [
    {
      id: 'submittedSolutions',
      icon: '📤',
      title: 'Новые решения',
      description: 'Когда ученик сдал домашнюю работу',
      defaultEnabled: true,
    },
    {
      id: 'lessonReminders',
      icon: '📅',
      title: 'Напоминания об уроках',
      description: 'Перед занятием по расписанию',
      defaultEnabled: true,
    },
    {
      id: 'overdueHomework',
      icon: '!',
      title: 'Просроченные ДЗ',
      description: 'Контроль работ после дедлайна',
      defaultEnabled: true,
    },
    {
      id: 'studentAccessProblems',
      icon: '🔐',
      title: 'Доступ учеников',
      description: 'Если ученик не установил пароль',
      defaultEnabled: true,
    },
  ],
};

export function getProfileIcon(iconId) {
  return PROFILE_ICONS.find((item) => item.id === iconId || item.icon === iconId) || PROFILE_ICONS[0];
}

export function getProfileBackground(backgroundId) {
  return PROFILE_BACKGROUNDS.find((item) => item.id === backgroundId) || PROFILE_BACKGROUNDS[0];
}

export function getDefaultNotifications(role) {
  return Object.fromEntries(
    (NOTIFICATION_SETTINGS[role] || []).map((item) => [item.id, item.defaultEnabled])
  );
}

export function normalizeProfile(profile, role) {
  const defaultNotifications = getDefaultNotifications(role);
  const settings = profile?.settings || {};
  return {
    ...profile,
    role,
    avatar: profile?.avatar || PROFILE_ICONS[0].id,
    bg: profile?.bg || PROFILE_BACKGROUNDS[0].id,
    settings: {
      ...settings,
      notifications: {
        ...defaultNotifications,
        ...(settings.notifications || {}),
      },
    },
  };
}
