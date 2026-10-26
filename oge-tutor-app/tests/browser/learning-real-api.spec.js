import { expect, test } from '@playwright/test';

let studentAccount;

async function login(page, email, password) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Прогресс', exact: true })).toBeVisible();
}

for (const width of [390, 1365]) {
  test(`progress corrections and notifications on a real API at ${width}px`, async ({ page, context, request }, testInfo) => {
    test.skip(!process.env.LEARNING_REAL_API_EMAIL || !process.env.LEARNING_REAL_API_STUDENT_EMAIL || !process.env.LEARNING_REAL_API_PASSWORD || !process.env.LEARNING_REAL_API_STUDENT_PASSWORD, 'Disposable learning fixture credentials are required.');
    test.setTimeout(90_000);
    page.setDefaultTimeout(10_000);
    await page.setViewportSize({ width, height: 900 });
    const apiBase = (process.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
    if (!studentAccount) {
      const authResponse = await request.post(`${apiBase}/api/v2/auth/login`, { data: { email: process.env.LEARNING_REAL_API_STUDENT_EMAIL, password: process.env.LEARNING_REAL_API_STUDENT_PASSWORD } });
      expect(authResponse.ok()).toBeTruthy();
      studentAccount = await authResponse.json();
    }
    const account = studentAccount;
    const workspace = account.contexts.find(c => c.legacyRole === 'student');
    const headers = { Authorization: `Bearer ${account.session.token}`, 'X-Active-Role': 'student' };
    const coursesResponse = await request.get(`${apiBase}/api/v2/workspaces/${workspace.workspaceId}/courses`, { headers });
    const course = (await coursesResponse.json()).items.find(c => c.legacy);
    expect(course).toBeTruthy();
    const marker = `Оценка браузер ${width} ${Date.now()}`;
    const privateComment = `Личная заметка ${width} ${Date.now()}`;
    const publicComment = `Опубликовано ${width} ${Date.now()}`;
    await login(page, process.env.LEARNING_REAL_API_EMAIL, process.env.LEARNING_REAL_API_PASSWORD);
    const contextSelect = page.getByRole('combobox', { name: 'Рабочее пространство и роль' });
    await contextSelect.selectOption(`${workspace.workspaceId}:teacher`);
    await page.getByRole('button', { name: 'Прогресс', exact: true }).click();
    await page.getByRole('combobox', { name: 'Курс', exact: true }).selectOption(course.id);
    await expect(page.getByRole('button', { name: 'Оценить', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Оценить', exact: true }).first().click();
    let form = page.getByRole('form', { name: 'Новая оценка' });
    await form.getByRole('textbox', { name: 'Основание', exact: true }).fill(marker);
    await form.getByRole('textbox', { name: 'Комментарий', exact: true }).fill(privateComment);
    await form.getByRole('combobox', { name: 'Уровень', exact: true }).selectOption('weak');
    await form.getByRole('button', { name: 'Сохранить оценку', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.locator('.learning-event').getByText(privateComment, { exact: true })).toBeVisible();
    const studentPage = await context.newPage();
    studentPage.setDefaultTimeout(10_000);
    await studentPage.setViewportSize({ width, height: 900 });
    await login(studentPage, process.env.LEARNING_REAL_API_STUDENT_EMAIL, process.env.LEARNING_REAL_API_STUDENT_PASSWORD);
    await studentPage.getByRole('button', { name: 'Прогресс', exact: true }).click();
    await studentPage.getByRole('combobox', { name: 'Курс', exact: true }).selectOption(course.id);
    await expect(studentPage.getByRole('heading', { name: 'История', exact: true })).toBeVisible();
    await expect(studentPage.getByText(privateComment, { exact: true })).toHaveCount(0);
    const event = page.locator('.learning-event').filter({ hasText: marker }).first();
    await event.getByRole('button', { name: 'Исправить', exact: true }).click();
    form = page.getByRole('form', { name: 'Исправление оценки' });
    await form.getByRole('combobox', { name: 'Видимость', exact: true }).selectOption('published');
    await form.getByRole('combobox', { name: 'Уровень', exact: true }).selectOption('strong');
    await form.getByRole('textbox', { name: 'Комментарий', exact: true }).fill(publicComment);
    await form.getByRole('textbox', { name: 'Причина исправления', exact: true }).fill('Проверка завершена и опубликована');
    await form.getByRole('button', { name: 'Сохранить исправление', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.locator('.learning-event').getByText(publicComment, { exact: true })).toBeVisible();
    await studentPage.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(studentPage.getByText(publicComment, { exact: true })).toBeVisible();
    await expect(studentPage.getByText(privateComment, { exact: true })).toHaveCount(0);
    await studentPage.getByRole('heading', { name: 'Прогресс', exact: true }).scrollIntoViewIfNeeded();
    await studentPage.screenshot({ path: testInfo.outputPath(`progress-${width}.png`) });
    expect(await studentPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await studentPage.getByRole('button', { name: 'Уведомления', exact: true }).click();
    const emailPreference = studentPage.getByRole('checkbox', { name: 'Получать email', exact: true });
    await expect(emailPreference).not.toBeChecked();
    await emailPreference.click();
    await expect(emailPreference).toBeEnabled();
    await expect(emailPreference).toBeChecked();
    await emailPreference.click();
    await expect(emailPreference).toBeEnabled();
    await expect(emailPreference).not.toBeChecked();
    const notice = studentPage.locator('.learning-notice').filter({ hasText: 'Обновлён прогресс по курсу' }).first();
    await expect(notice).toBeVisible();
    await studentPage.screenshot({ path: testInfo.outputPath(`notifications-${width}.png`) });
    await notice.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(studentPage.getByRole('heading', { name: 'Прогресс', exact: true })).toBeVisible();
    await expect(studentPage.getByText(publicComment, { exact: true })).toBeVisible();
    await studentPage.getByRole('button', { name: 'Уведомления', exact: true }).click();
    await studentPage.locator('.learning-notice').first().getByRole('button', { name: 'Не прочитано', exact: true }).click();
    await studentPage.getByRole('button', { name: 'Прочитать всё', exact: true }).click();
    await studentPage.getByRole('combobox', { name: 'Статус', exact: true }).selectOption('unread');
    await expect(studentPage.getByText('Уведомлений нет.', { exact: true })).toBeVisible();
    expect(await studentPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await studentPage.close();
    await page.getByRole('combobox', { name: 'Рабочее пространство и роль' }).selectOption(`${workspace.workspaceId}:admin`);
    await page.getByRole('button', { name: 'Уведомления', exact: true }).click();
    await page.getByRole('tab', { name: 'Доставка', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: 'Попытки', exact: true })).toBeVisible();
    await expect(page.getByRole('table').getByText('progress.updated', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(privateComment, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`deliveries-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
