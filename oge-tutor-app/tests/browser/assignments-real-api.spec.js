import { expect, test } from '@playwright/test';

const dateOnly = date => date.toISOString().slice(0, 10);

async function login(page, email, password) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Работы', exact: true })).toBeVisible();
}

async function teacherMode(page) {
  const contexts = page.getByRole('combobox', { name: 'Рабочее пространство и роль' });
  const option = contexts.locator('option').filter({ hasText: 'Преподаватель' }).first();
  await contexts.selectOption(await option.getAttribute('value'));
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1365, height: 900 }]) {
  test(`group assignments and materials on a real API at ${viewport.width}px`, async ({ page, context }, testInfo) => {
    test.skip(!process.env.LESSON_REAL_API_EMAIL || !process.env.LESSON_REAL_API_STUDENT_EMAIL || !process.env.LESSON_REAL_API_PASSWORD || !process.env.LESSON_REAL_API_STUDENT_PASSWORD,
      'Set disposable browser fixture credentials to run the assignment scenario.');
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    page.setDefaultTimeout(10_000);
    const courseTitle = `Работы браузер ${viewport.width} ${Date.now()}`;
    const workTitle = `Групповая работа ${viewport.width} ${Date.now()}`;
    const materialTitle = `Конспект ${viewport.width} ${Date.now()}`;
    const firstStudent = process.env.LESSON_REAL_API_STUDENT_A_NAME || 'Иван Петров';
    const secondStudent = process.env.LESSON_REAL_API_STUDENT_B_NAME || 'Мария Соколова';

    await login(page, process.env.LESSON_REAL_API_EMAIL, process.env.LESSON_REAL_API_PASSWORD);
    await page.getByRole('button', { name: 'Курсы', exact: true }).click();
    await page.getByRole('button', { name: 'Создать курс' }).click();
    const courseForm = page.getByRole('region', { name: 'Новый курс' });
    await courseForm.getByRole('combobox', { name: 'Программа' }).selectOption('legacy-program-oge-math');
    await courseForm.getByRole('combobox', { name: 'Версия' }).selectOption('legacy-version-oge-math');
    await courseForm.getByLabel('Название').fill(courseTitle);
    await courseForm.getByRole('combobox', { name: 'Формат' }).selectOption('group');
    await courseForm.getByLabel('Мест').fill('2');
    await courseForm.getByLabel('Окончание').fill(dateOnly(new Date(Date.now() + 180 * 86400000)));
    const teacherOption = courseForm.getByRole('combobox', { name: 'Участник' }).locator('option').filter({ hasText: process.env.LESSON_REAL_API_EMAIL });
    await courseForm.getByRole('combobox', { name: 'Участник' }).selectOption(await teacherOption.getAttribute('value'));
    await courseForm.getByRole('button', { name: 'Создать курс' }).click();
    await expect(page.getByRole('heading', { name: courseTitle })).toBeVisible();
    await page.getByRole('button', { name: 'Активировать' }).click();
    const batch = page.locator('.course-batch');
    await batch.getByRole('checkbox', { name: firstStudent }).check();
    await batch.getByRole('checkbox', { name: secondStudent }).check();
    await batch.getByRole('button', { name: 'Проверить набор' }).click();
    await batch.getByRole('button', { name: 'Зачислить всех' }).click();
    await expect(page.getByText('2 / 2 мест')).toBeVisible();

    await teacherMode(page);
    await page.getByRole('button', { name: 'Работы', exact: true }).click();
    await page.getByRole('button', { name: 'Создать' }).click();
    const workForm = page.getByRole('form', { name: 'Новая работа' });
    await workForm.getByLabel('Курс').selectOption({ label: courseTitle });
    await workForm.getByLabel('Название').fill(workTitle);
    await workForm.getByLabel('Условие').fill('Решите задачу и приложите объяснение.');
    await workForm.getByRole('button', { name: 'Сохранить черновик' }).click();
    await expect(page.getByRole('heading', { name: workTitle })).toBeVisible();
    const recipients = page.getByRole('group', { name: 'Получатели' });
    await recipients.getByRole('checkbox', { name: firstStudent }).check();
    await recipients.getByRole('checkbox', { name: secondStudent }).check();
    await page.getByRole('button', { name: 'Выдать работу' }).click();
    await expect(page.getByText('2', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`assignment-teacher-${viewport.width}.png`) });

    await page.getByRole('tab', { name: 'Материалы' }).click();
    await page.getByRole('button', { name: 'Создать' }).click();
    const materialForm = page.locator('.work-form').filter({ has: page.getByRole('heading', { name: 'Новый материал' }) });
    await materialForm.getByLabel('Курс и программа').selectOption({ label: courseTitle });
    await materialForm.getByLabel('Название').fill(materialTitle);
    await materialForm.getByLabel('Ссылка').fill('https://example.org/study-notes');
    await materialForm.getByRole('button', { name: 'Сохранить материал' }).click();
    await expect(page.getByRole('heading', { name: materialTitle })).toBeVisible();
    const publication = page.locator('.work-publish');
    await publication.getByLabel('Курс').selectOption({ label: courseTitle });
    await publication.getByRole('checkbox', { name: firstStudent }).check();
    await publication.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(page.locator('.work-publications')).toContainText('1 получателей');

    const studentPage = await context.newPage();
    await studentPage.setViewportSize(viewport);
    studentPage.setDefaultTimeout(10_000);
    await login(studentPage, process.env.LESSON_REAL_API_STUDENT_EMAIL, process.env.LESSON_REAL_API_STUDENT_PASSWORD);
    await studentPage.getByRole('button', { name: 'Работы', exact: true }).click();
    await studentPage.getByRole('row').filter({ hasText: workTitle }).getByRole('button', { name: 'Открыть' }).click();
    await expect(studentPage.getByRole('heading', { name: workTitle })).toBeVisible();
    await expect(studentPage.getByText(secondStudent)).toHaveCount(0);
    await studentPage.locator('.work-detail .workspace-table').getByRole('button', { name: 'Открыть' }).click();
    await studentPage.getByLabel('Ответ').fill('Моё решение групповой работы.');
    await studentPage.getByRole('button', { name: 'Сдать работу' }).click();
    await expect(studentPage.getByText('Моё решение групповой работы.')).toBeVisible();
    await studentPage.getByRole('button', { name: 'К списку' }).click();
    await studentPage.getByRole('tab', { name: 'Материалы' }).click();
    await studentPage.getByRole('row').filter({ hasText: materialTitle }).getByRole('button', { name: 'Открыть' }).click();
    await expect(studentPage.getByRole('link', { name: 'Открыть ссылку' })).toBeVisible();
    await studentPage.screenshot({ path: testInfo.outputPath(`assignment-student-${viewport.width}.png`) });
    expect(await studentPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    await page.getByRole('button', { name: 'К списку' }).click();
    await page.getByRole('tab', { name: 'Работы' }).click();
    await page.getByRole('button', { name: 'Работы', exact: true }).click();
    await page.getByRole('row').filter({ hasText: workTitle }).getByRole('button', { name: 'Открыть' }).click();
    await page.getByRole('row').filter({ hasText: firstStudent }).getByRole('button', { name: 'Открыть' }).click();
    const reviewForm = page.locator('.work-recipient-detail .work-form').filter({ hasText: 'Проверить попытку' });
    await reviewForm.getByLabel('Комментарий').fill('Решение принято.');
    await reviewForm.getByRole('button', { name: 'Сохранить проверку' }).click();
    await page.getByRole('button', { name: 'Опубликовать результат' }).click();
    await expect(page.locator('.work-review').last().locator('strong')).toHaveText('Принято');
  });
}
