import { expect, test } from '@playwright/test';

test('admin workflow on a real API', async ({ page }) => {
  test.skip(!process.env.REAL_API_EMAIL || !process.env.REAL_API_PASSWORD, 'Set disposable test credentials to run the real API smoke test.');
  const email = `browser-${Date.now()}@test.local`;
  const code = `browser-${Date.now()}`;
  const failures = [];
  page.on('response', response => {
    if (response.url().includes('/api/v2/') && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');
  await page.getByLabel('Email').fill(process.env.REAL_API_EMAIL);
  await page.getByLabel('Пароль').fill(process.env.REAL_API_PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('tab', { name: 'Участники' })).toBeVisible();
  await expect(page.getByText(process.env.REAL_API_EMAIL)).toBeVisible();

  await page.getByRole('tab', { name: 'Приглашения' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Отправить приглашение' }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole('tab', { name: 'Аудит' }).click();
  await expect(page.getByText('invitation.created')).toBeVisible();

  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  await page.getByLabel('Код').fill(code);
  await page.getByLabel('Название').fill('Браузерная проверка');
  await page.getByRole('button', { name: 'Создать предмет' }).click();
  await expect(page.getByText('Браузерная проверка')).toBeVisible();
  expect(failures).toEqual([]);
});
