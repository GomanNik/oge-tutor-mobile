/*
 * OGE Tutor App — domain task catalog.
 * This is a runtime domain reference, not demo seed data.
 */

export const TASKS = [
  { n: 1, title: 'Вычисления', level: 'high' },
  { n: 2, title: 'Дроби и степени', level: 'good' },
  { n: 3, title: 'Выражения', level: 'good' },
  { n: 4, title: 'Графики и функции', level: 'weak' },
  { n: 5, title: 'Уравнения', level: 'high' },
  { n: 6, title: 'Неравенства', level: 'mid' },
  { n: 7, title: 'Функции', level: 'weak' },
  { n: 8, title: 'Последовательности', level: 'good' },
  { n: 9, title: 'Статистика', level: 'mid' },
  { n: 10, title: 'Вероятность', level: 'mid' },
  { n: 11, title: 'Текстовые задачи', level: 'good' },
  { n: 12, title: 'Проценты', level: 'weak' },
  { n: 13, title: 'Практические задачи', level: 'high' },
  { n: 14, title: 'Геометрия', level: 'mid' },
  { n: 15, title: 'Треугольники', level: 'weak' },
  { n: 16, title: 'Окружность', level: 'mid' },
  { n: 17, title: 'Геометрия', level: 'weak' },
  { n: 18, title: 'Площади', level: 'good' },
  { n: 19, title: 'Утверждения', level: 'good' },
  { n: 20, title: 'Алгебра', level: 'mid' },
  { n: 21, title: 'Текстовая задача', level: 'mid' },
  { n: 22, title: 'График', level: 'weak' },
  { n: 23, title: 'Геометрическая задача', level: 'high' },
  { n: 24, title: 'Доказательство', level: 'mid' },
  { n: 25, title: 'Сложная геометрия', level: 'mid' },
];

export function getTaskByNumber(taskNumber) {
  return TASKS.find((task) => task.n === Number(taskNumber)) || null;
}

export function getTaskTitle(taskNumber) {
  return getTaskByNumber(taskNumber)?.title || `Задание ${taskNumber}`;
}
