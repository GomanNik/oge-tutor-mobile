import { expect, test } from '@playwright/test';

const localInput = (days, hour) => {
  const date = new Date(Date.now() + days * 86400000); date.setHours(hour, 0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
async function login(page, email, password) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Расписание', exact: true })).toBeVisible();
}
for (const width of [390, 1365]) {
  test(`imported course workflows after cutover real API at ${width}px`, async ({ page, context, request }, testInfo) => {
    test.skip(process.env.CUTOVER_REAL_API !== 'true' || !process.env.SERIES_REAL_API_EMAIL || !process.env.SERIES_REAL_API_STUDENT_EMAIL, 'A retired disposable backend is required.');
    test.setTimeout(90000);
    const apiBase = (process.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
    const runtime = await request.get(`${apiBase}/api/v2/runtime`);
    expect((await runtime.json()).legacyApiMode).toBe('disabled');
    expect((await request.get(`${apiBase}/bootstrap`)).status()).toBe(410);
    await page.setViewportSize({ width, height: 900 });
    await login(page, process.env.SERIES_REAL_API_EMAIL, process.env.SERIES_REAL_API_PASSWORD);
    const selector = page.getByRole('combobox', { name: 'Рабочее пространство и роль' });
    const teacherOption = await selector.locator('option').evaluateAll(options => options.find(option => option.value.endsWith(':teacher')).value);
    await selector.selectOption(teacherOption);
    await expect(page.getByRole('button', { name: 'Открыть учебный кабинет', exact: true })).toHaveCount(0);
    const legacyCourse = page.getByRole('row').filter({ hasText: 'ОГЭ математика' });
    await legacyCourse.getByRole('button', { name: 'Открыть', exact: true }).click();
    await page.getByRole('button', { name: 'Запланировать', exact: true }).click();
    const form = page.getByRole('form', { name: 'Новое занятие', exact: true });
    const marker = `Урок после переключения ${width} ${Date.now()}`;
    const offset = width === 390 ? 40 : 50;
    await form.getByLabel('Тема', { exact: true }).fill(marker);
    await form.getByLabel('Начало', { exact: true }).fill(localInput(offset, 14));
    await form.getByLabel('Конец', { exact: true }).fill(localInput(offset, 15));
    await form.getByRole('checkbox', { name: 'Ученик серии', exact: true }).check();
    await form.getByRole('button', { name: 'Проверить время', exact: true }).click();
    await expect(form.getByText('Время свободно', { exact: true })).toBeVisible();
    await form.getByRole('button', { name: 'Запланировать', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`imported-course-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const student = await context.newPage();
    await student.setViewportSize({ width, height: 900 });
    await login(student, process.env.SERIES_REAL_API_STUDENT_EMAIL, process.env.SERIES_REAL_API_PASSWORD);
    await student.getByRole('button', { name: 'Расписание', exact: true }).click();
    await expect(student.getByText(marker, { exact: true })).toBeVisible();
    await expect(student.getByRole('tab', { name: 'Серии', exact: true })).toHaveCount(0);
    expect(await student.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await student.screenshot({ path: testInfo.outputPath(`retired-student-${width}.png`) });
    await student.close();
    await selector.selectOption(teacherOption.replace(/:teacher$/, ':admin'));
    await page.getByRole('button', { name: 'Сверка данных', exact: true }).click();
    await expect(page.getByText('v2, старый API отключён', { exact: false })).toBeVisible();
    await expect(page.getByText('Связи данных согласованы', { exact: true })).toBeVisible();
  });
}
