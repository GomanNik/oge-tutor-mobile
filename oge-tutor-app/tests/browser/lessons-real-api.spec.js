import { expect, test } from '@playwright/test';

const localInput = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const dateOnly = date => date.toISOString().slice(0, 10);

for (const viewport of [{ width: 390, height: 844 }, { width: 1365, height: 900 }]) {
  test(`group lesson on a real API at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.skip(!process.env.LESSON_REAL_API_EMAIL || !process.env.LESSON_REAL_API_PASSWORD || !process.env.LESSON_REAL_API_STUDENT_EMAIL || !process.env.LESSON_REAL_API_STUDENT_PASSWORD,
      'Set disposable demo credentials to run the lesson smoke test.');
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const title = `Урок браузер ${viewport.width} ${Date.now()}`;
    const topic = `Группа ${viewport.width} ${Date.now()}`;
    const firstStudent = process.env.LESSON_REAL_API_STUDENT_A_NAME || 'Иван Демин';
    const secondStudent = process.env.LESSON_REAL_API_STUDENT_B_NAME || 'Мария Орлова';
    const failures = [];
    page.on('response', response => {
      if (response.url().includes('/api/v2/') && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    await page.goto('/');
    await page.getByLabel('Email').fill(process.env.LESSON_REAL_API_EMAIL);
    await page.getByLabel('Пароль').fill(process.env.LESSON_REAL_API_PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.getByRole('button', { name: 'Курсы', exact: true }).click();
    await page.getByRole('button', { name: 'Создать курс' }).click();
    const courseForm = page.getByRole('region', { name: 'Новый курс' });
    await courseForm.getByRole('combobox', { name: 'Программа' }).selectOption('legacy-program-oge-math');
    await courseForm.getByRole('combobox', { name: 'Версия' }).selectOption('legacy-version-oge-math');
    await courseForm.getByLabel('Название').fill(title);
    await courseForm.getByRole('combobox', { name: 'Формат' }).selectOption('group');
    await courseForm.getByLabel('Мест').fill('2');
    await courseForm.getByLabel('Окончание').fill(dateOnly(new Date(Date.now() + 180 * 86400000)));
    const teacherOption = courseForm.getByRole('combobox', { name: 'Участник' }).locator('option').filter({ hasText: process.env.LESSON_REAL_API_EMAIL });
    await expect(teacherOption).toHaveCount(1);
    await courseForm.getByRole('combobox', { name: 'Участник' }).selectOption(await teacherOption.getAttribute('value'));
    await courseForm.getByRole('button', { name: 'Создать курс' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.getByRole('button', { name: 'Активировать' }).click();
    const batch = page.locator('.course-batch');
    await batch.getByRole('checkbox', { name: firstStudent }).check();
    await batch.getByRole('checkbox', { name: secondStudent }).check();
    await batch.getByRole('button', { name: 'Проверить набор' }).click();
    await batch.getByRole('button', { name: 'Зачислить всех' }).click();
    await expect(page.getByText('2 / 2 мест')).toBeVisible();

    const panel = page.locator('.lesson-panel');
    await panel.getByRole('button', { name: 'Запланировать' }).click();
    const form = panel.getByRole('form', { name: 'Новое занятие' });
    await form.getByLabel('Тема').fill(topic);
    await form.getByRole('checkbox', { name: firstStudent }).check();
    await form.getByRole('checkbox', { name: secondStudent }).check();
    await form.getByLabel('Заметка для команды').fill('Только преподавателям');
    let available = false;
    for (let offset = 0; offset < 20; offset += 1) {
      const start = new Date(Date.now() + (8 + offset) * 86400000);
      start.setHours(viewport.width === 390 ? 12 : 15, 0, 0, 0);
      await form.getByLabel('Начало').fill(localInput(start));
      await form.getByLabel('Конец').fill(localInput(new Date(start.getTime() + 3600000)));
      await form.getByRole('button', { name: 'Проверить время' }).click();
      await expect(form.locator('.course-batch-preview')).toBeVisible();
      available = await form.getByText('Время свободно').count() > 0;
      if (available) break;
    }
    expect(available).toBe(true);
    await form.getByRole('button', { name: 'Запланировать' }).click();
    const row = panel.locator('.lesson-item').filter({ hasText: topic });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Подробнее' }).click();
    await expect(row.getByText(firstStudent)).toBeVisible();
    await expect(row.getByText(secondStudent)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`lesson-admin-${viewport.width}.png`) });

    await page.getByRole('button', { name: 'Выйти' }).click();
    await page.getByLabel('Email').fill(process.env.LESSON_REAL_API_STUDENT_EMAIL);
    await page.getByLabel('Пароль').fill(process.env.LESSON_REAL_API_STUDENT_PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.getByRole('button', { name: 'Курсы', exact: true }).click();
    await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    const studentRow = page.locator('.lesson-item').filter({ hasText: topic });
    await studentRow.getByRole('button', { name: 'Подробнее' }).click();
    await expect(studentRow.getByText('Моё участие')).toBeVisible();
    await expect(studentRow.getByText(secondStudent)).toHaveCount(0);
    await expect(studentRow.getByText('Только преподавателям')).toHaveCount(0);
    await expect(studentRow.getByRole('button', { name: 'Изменить' })).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`lesson-student-${viewport.width}.png`) });
    expect(failures).toEqual([]);
  });
}
