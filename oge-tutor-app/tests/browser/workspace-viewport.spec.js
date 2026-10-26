import { expect, test } from '@playwright/test';

const context = { workspaceId: 'workspace-a', name: 'Учебный центр', status: 'active', legacyRole: null, roles: ['admin'] };
const user = { id: 'admin-a', email: 'admin@test.local', displayName: 'Администратор', catalogManage: false };
const member = { id: 'member-a', userId: 'admin-a', email: user.email, displayName: user.displayName, roles: ['admin'], status: 'active', revision: 0 };

async function stubApi(page) {
  await page.route('**/api/v2/**', route => {
    const { pathname } = new URL(route.request().url());
    let body;
    if (pathname === '/api/v2/runtime') body = { apiVersion: 2, legacyApiMode: 'enabled', legacyDataRetained: true };
    else if (pathname === '/api/v2/auth/login') body = { session: { token: 'browser-test-token' }, user, contexts: [context] };
    else if (pathname === '/api/v2/me') body = { item: user };
    else if (pathname === '/api/v2/me/workspaces') body = { items: [context] };
    else if (pathname.endsWith('/members')) body = { items: [member], pageInfo: { hasMore: false, nextCursor: null } };
    else if (pathname.endsWith('/invitations') || pathname.endsWith('/audit-events')) body = { items: [], pageInfo: { hasMore: false, nextCursor: null } };
    else if (pathname === '/api/v2/subjects' || pathname === '/api/v2/programs') body = { items: [], total: 0, page: 1, pageSize: 25 };
    else body = { code: 'not_found', message: 'Not found', requestId: 'browser-test' };
    return route.fulfill({ status: body.code ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function noHorizontalOverflow(page) {
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(width.content, `Horizontal overflow: ${JSON.stringify(width)}`).toBeLessThanOrEqual(width.viewport + 1);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1365, height: 900 }]) {
  test(`admin and catalog fit ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await stubApi(page);
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email')).toBeFocused();
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Пароль').fill('browser-test-password');
    await page.getByRole('button', { name: 'Войти' }).press('Enter');
    await expect(page.getByText('Учебный центр', { exact: true })).toBeVisible();
    await expect(page.getByText(user.email)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Открыть' })).toBeInViewport();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`members-${viewport.width}.png`), fullPage: true });

    await page.getByRole('tab', { name: 'Приглашения' }).click();
    await expect(page.getByRole('button', { name: 'Отправить приглашение' })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole('tab', { name: 'Аудит' }).click();
    await noHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Каталог', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Предметы' })).toBeVisible();
    const tabBoxes = await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().toJSON()));
    expect(tabBoxes.every((box, index) => index === 0 || box.left >= tabBoxes[index - 1].right)).toBe(true);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`catalog-${viewport.width}.png`), fullPage: true });
  });
}

test('invitation token is removed from address bar', async ({ page }) => {
  await page.goto('/workspace-invite?token=browser-secret');
  await expect(page).toHaveURL('http://127.0.0.1:5199/workspace-invite');
  await expect(page.getByRole('heading', { name: 'Приглашение' })).toBeVisible();
});
