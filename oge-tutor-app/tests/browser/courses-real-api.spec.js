import { expect, test } from '@playwright/test';

async function assertNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const container = document.querySelector('.workspace-page');
    const viewport = document.documentElement.clientWidth;
    const previousScrollLeft = container.scrollLeft;
    container.scrollLeft = 0;
    document.documentElement.scrollLeft = 0;
    const offenders = [...container.querySelectorAll('*')].map(element => ({
      tag: element.tagName.toLowerCase(), className: typeof element.className === 'string' ? element.className : '',
      label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 35) || '',
      right: Math.round(element.getBoundingClientRect().right),
    })).filter(item => item.right > viewport + 1).sort((a, b) => b.right - a.right).slice(0, 8);
    return { viewport, content: Math.max(document.documentElement.scrollWidth, container.scrollWidth), containerWidth: container.clientWidth, previousScrollLeft, offenders };
  });
  expect(widths.content, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport + 1);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1365, height: 900 }]) {
  test(`course workflow on a real API at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.skip(!process.env.COURSE_REAL_API_EMAIL || !process.env.COURSE_REAL_API_PASSWORD, 'Set disposable course fixture credentials to run the real API smoke test.');
    await page.setViewportSize(viewport);
    const title = `Группа браузер ${viewport.width} ${Date.now()}`;
    const failures = [];
    page.on('response', response => {
      if (response.url().includes('/api/v2/') && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });

    await page.goto('/');
    await page.getByLabel('Email').fill(process.env.COURSE_REAL_API_EMAIL);
    await page.getByLabel('Пароль').fill(process.env.COURSE_REAL_API_PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('button', { name: 'Курсы', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Курсы', exact: true }).click();
    await page.getByRole('button', { name: 'Создать курс' }).click();
    const form = page.getByRole('region', { name: 'Новый курс' });
    await form.getByRole('combobox', { name: 'Программа' }).selectOption('legacy-program-oge-math');
    await form.getByRole('combobox', { name: 'Версия' }).selectOption('legacy-version-oge-math');
    await form.getByLabel('Название').fill(title);
    await form.getByRole('combobox', { name: 'Формат' }).selectOption('group');
    await form.getByLabel('Мест').fill('2');
    await form.getByLabel('Окончание').fill('2027-06-01');
    await form.getByRole('combobox', { name: 'Участник' }).selectOption({ label: 'Анна Сергеева · teacher@mail.ru' });
    await form.getByRole('button', { name: 'Создать курс' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.getByRole('button', { name: 'Активировать' }).click();
    await expect(page.getByText('Активен', { exact: true })).toBeVisible();

    const batch = page.locator('.course-batch');
    await batch.getByRole('checkbox', { name: 'Иван Петров' }).check();
    await batch.getByRole('checkbox', { name: 'Мария Соколова' }).check();
    await batch.getByRole('button', { name: 'Проверить набор' }).click();
    await expect(batch.getByText('Можно применить')).toBeVisible();
    await batch.getByRole('button', { name: 'Зачислить всех' }).click();
    await expect(page.getByText('2 / 2 мест')).toBeVisible();
    await expect(page.locator('.course-detail').getByRole('row', { name: /Иван Петров/ })).toBeVisible();
    await expect(page.locator('.course-detail').getByRole('row', { name: /Мария Соколова/ })).toBeVisible();
    await page.locator('.course-detail').getByRole('row', { name: /Иван Петров/ }).getByRole('button', { name: 'Изменить' }).click();
    const enrollmentEditor = page.locator('.course-edit-enrollment');
    await enrollmentEditor.getByLabel('Цель').fill('Решать задачи каждый день');
    await enrollmentEditor.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.locator('.course-detail').getByRole('row', { name: /Иван Петров/ })).toContainText('Решать задачи каждый день');
    await assertNoHorizontalOverflow(page);
    await page.locator('.workspace-page').evaluate(element => element.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`course-admin-${viewport.width}.png`) });

    await page.getByRole('button', { name: 'Выйти' }).click();
    await page.getByLabel('Email').fill('ivan@mail.ru');
    await page.getByLabel('Пароль').fill(process.env.COURSE_REAL_API_PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText(title)).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: title });
    await row.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Моё участие' })).toBeVisible();
    await expect(page.locator('.course-detail').getByText('Мария Соколова')).toHaveCount(0);
    await expect(page.getByText('2 / 2 мест')).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    await page.locator('.workspace-page').evaluate(element => element.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`course-student-${viewport.width}.png`) });
    expect(failures).toEqual([]);
  });
}
