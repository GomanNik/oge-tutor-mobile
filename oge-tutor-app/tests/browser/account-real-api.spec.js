import { expect, test } from '@playwright/test';

for (const width of [390, 1365]) {
  test(`account recovery and session revocation on a real API at ${width}px`, async ({ page }, testInfo) => {
    test.skip(!process.env.ACCOUNT_REAL_API_EMAIL || !process.env.ACCOUNT_REAL_API_PASSWORD || process.env.CUTOVER_REAL_API === 'true', 'Disposable account fixture is required.');
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Забыли пароль?', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill(process.env.ACCOUNT_REAL_API_EMAIL);
    await page.getByRole('button', { name: 'Восстановить доступ', exact: true }).click();
    await page.getByRole('link', { name: 'Открыть ссылку восстановления', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Новый пароль', exact: true })).toBeVisible();
    const password = `Block7-Reset-${width}!`;
    await page.getByLabel('Новый пароль', { exact: true }).fill(password);
    await page.getByLabel('Повтор пароля', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Пароль сохранён', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ко входу', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill(process.env.ACCOUNT_REAL_API_EMAIL);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('button', { name: 'Аккаунт', exact: true }).click();
    const name = `Профиль ${width} ${Date.now()}`;
    await page.getByLabel('Имя', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Сохранить имя', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Сохранено.');
    await page.screenshot({ path: testInfo.outputPath(`account-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByLabel('Текущий пароль', { exact: true }).fill('wrong-current-password');
    await page.getByLabel('Новый пароль', { exact: true }).fill(process.env.ACCOUNT_REAL_API_PASSWORD);
    await page.getByLabel('Повтор пароля', { exact: true }).fill(process.env.ACCOUNT_REAL_API_PASSWORD);
    await page.getByRole('button', { name: 'Сменить пароль и завершить сессии', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Неверный текущий пароль.');
    await page.getByLabel('Текущий пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Сменить пароль и завершить сессии', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Вход в кабинет', exact: true })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(process.env.ACCOUNT_REAL_API_EMAIL);
    await page.getByLabel('Пароль', { exact: true }).fill(process.env.ACCOUNT_REAL_API_PASSWORD);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('button', { name: 'Сверка данных', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Сверка данных', exact: true })).toBeVisible();
    await expect(page.getByText('Связи данных согласованы', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`release-status-${width}.png`) });
  });
}
