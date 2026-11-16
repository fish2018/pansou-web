import { test, expect, type Page } from '@playwright/test';

const items = Array.from({ length: 26 }, (_, index) => ({
  id: `film-${index}`, title: `推荐作品 ${index}`, original_title: `Original ${index}`,
  year: 2026, genres: [index % 2 ? '悬疑' : '科幻'],
  douban_rating: index === 1 ? 0 : 8.7, douban_votes: index === 1 ? 0 : 12500,
  // A score from a different provider must never replace an absent Douban score.
  vote_average: 9.9, overview: `作品 ${index} 的完整故事简介。`,
  metadata_source: 'douban', douban_url: 'https://movie.douban.com/subject/1292052/',
  reason: '近期热门'
}));
const responseMeta = { updated_at: '2026-11-13T08:00:00Z', stale: false, tmdb_configured: false };
const recommendationPage = (url: URL, pool = items) => {
  const genre = url.searchParams.get('genre');
  const filtered = pool.filter(item => !genre || item.genres.includes(genre));
  const size = Number(url.searchParams.get('page_size')) || 12;
  const page = Math.min(Math.max(1, Number(url.searchParams.get('page')) || 1), Math.max(1, Math.ceil(filtered.length / size)));
  return { ...responseMeta, items: filtered.slice((page - 1) * size, page * size),
    total: filtered.length, catalog_total: pool.length, page, page_size: size,
    has_more: page * size < filtered.length, genres: [...new Set(pool.flatMap(item => item.genres))] };
};
const payload = recommendationPage(new URL('http://fixture.test/'));

async function mockHealth(page: Page) {
  await page.route('**/api/health', route => route.fulfill({ json: {
    status: 'ok', channels: ['test-channel'], plugins: [], plugin_count: 0,
    plugins_enabled: true, auth_enabled: false
  } }));
}

test('推荐分类、类型和换批可用，评分来源与无评分准确', async ({ page }) => {
  await mockHealth(page);
  const requested: URL[] = [];
  await page.route('**/api/discover?**', route => {
    const url = new URL(route.request().url()); requested.push(url);
    return route.fulfill({ json: recommendationPage(url) });
  });
  await page.goto('/');
  await expect(page.locator('.recommendation-card')).toHaveCount(12);
  await expect(page.locator('.recommendation-card').nth(0)).toContainText('豆瓣 8.7');
  await expect(page.locator('.recommendation-card').nth(1)).toContainText('暂无评分');
  await expect(page.locator('.recommendation-card').nth(1)).not.toContainText('9.9');
  expect(requested[0].searchParams.get('page')).toBe('1');
  expect(requested[0].searchParams.get('page_size')).toBe('12');
  await page.getByRole('button', { name: '换一批' }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 12');
  expect(requested.at(-1)?.searchParams.get('page')).toBe('2');
  await page.getByRole('button', { name: '换一批' }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 24');
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await expect(page.locator('.pool-size')).toContainText('26 部');
  await page.getByRole('button', { name: '换一批' }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 0');
  expect(requested.map(url => url.searchParams.get('page'))).toEqual(['1', '2', '3']);
  await page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '悬疑', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 1');
  await expect(page.locator('.recommendation-card')).toHaveCount(12);
  expect(requested.at(-1)?.searchParams.get('genre')).toBe('悬疑');
  expect(requested.at(-1)?.searchParams.get('page')).toBe('1');
  await page.getByRole('button', { name: '换一批' }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 25');
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
  await page.getByRole('group', { name: '作品分类' }).getByRole('button', { name: '电视剧', exact: true }).click();
  await expect.poll(() => requested.at(-1)?.searchParams.get('category')).toBe('tv');
  expect(requested.at(-1)?.searchParams.get('page')).toBe('1');
  await page.getByRole('group', { name: '推荐栏目' }).getByRole('button', { name: '口碑佳作' }).click();
  await expect.poll(() => requested.at(-1)?.searchParams.get('collection')).toBe('top');
  expect(requested.at(-1)?.searchParams.get('page')).toBe('1');
  await page.reload();
  await expect(page.getByRole('group', { name: '作品分类' }).getByRole('button', { name: '电视剧', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '悬疑', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('推荐仅请求一页，全池总数与跨页类型均由服务端提供', async ({ page }) => {
  await mockHealth(page);
  const pool = Array.from({ length: 4000 }, (_, index) => ({ ...items[0], id: `large-${index}`,
    title: `完整片单 ${index}`, genres: [index === 3999 ? '纪录' : '科幻'] }));
  const requested: URL[] = [];
  await page.route('**/api/discover?**', route => {
    const url = new URL(route.request().url()); requested.push(url);
    const response = recommendationPage(url, pool);
    // 筛选由服务端基于完整资料完成；当前页字段缺失也应照常显示匹配项。
    if (url.searchParams.get('genre')) response.items = response.items.map(item => ({ ...item, genres: [] }));
    return route.fulfill({ json: response });
  });
  await page.goto('/');
  await expect(page.locator('.recommendation-card')).toHaveCount(12);
  await expect(page.locator('.pool-size')).toContainText('4,000 部');
  await expect(page.locator('.card-meta').filter({ hasText: '纪录' })).toHaveCount(0);
  const documentary = page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '纪录', exact: true });
  await expect(documentary).toBeVisible();
  await documentary.click();
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
  await expect(page.locator('.title-button')).toHaveText('完整片单 3999');
  await expect(documentary).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '科幻', exact: true })).toBeVisible();
  expect(requested).toHaveLength(2);
  expect(requested.every(url => url.searchParams.get('page_size') === '12')).toBe(true);
  expect(requested.at(-1)?.searchParams.get('page')).toBe('1');
  expect(requested.at(-1)?.searchParams.get('genre')).toBe('纪录');
});

test('推荐换批慢或失败保留已有卡片，重试成功且切回时立即复用缓存', async ({ page }) => {
  await mockHealth(page);
  let pageTwoRequests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested: URL[] = [];
  await page.route('**/api/discover?**', async route => {
    const url = new URL(route.request().url()); requested.push(url);
    if (url.searchParams.get('page') === '2') {
      pageTwoRequests++;
      if (pageTwoRequests === 1) { await gate; return route.fulfill({ status: 503, json: {} }); }
    }
    return route.fulfill({ json: recommendationPage(url) });
  });
  await page.goto('/');
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 0');
  await page.getByRole('button', { name: '换一批', exact: true }).click();
  await expect.poll(() => pageTwoRequests).toBe(1);
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 0');
  await expect(page.locator('.recommendation-card')).toHaveCount(12);
  await expect(page.locator('.recommendation-skeleton')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '换一批', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('.refresh-status')).toContainText('继续显示当前片单');
  await page.getByRole('button', { name: '换一批', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 12');
  await page.getByRole('button', { name: '换一批', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 24');
  const requestsBeforeCachedPage = requested.length;
  await page.getByRole('button', { name: '换一批', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 0');
  await expect(page.locator('.recommendation-skeleton')).toHaveCount(0);
  expect(requested).toHaveLength(requestsBeforeCachedPage);
});

test('随便看看每次从服务端全池重新取第一页，轮询和类型条件保持一致', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  await page.addInitScript(() => localStorage.setItem('pansou_discover_preferences', JSON.stringify({ category: 'movie', collection: 'random', genre: '科幻' })));
  const requested: URL[] = [];
  await page.route('**/api/discover?**', route => {
    const url = new URL(route.request().url()); requested.push(url);
    return route.fulfill({ json: { ...payload, total: 4000,
      items: [{ ...items[0], title: `全池随机 ${requested.length}`, id: `random-${requested.length}` }] } });
  });
  await page.goto('/');
  await expect(page.locator('.title-button')).toHaveText('全池随机 1');
  await expect(page.locator('.pool-size')).toContainText('4,000 部');
  await page.getByRole('button', { name: '换一批', exact: true }).click();
  await expect(page.locator('.title-button')).toHaveText('全池随机 2');
  await page.clock.fastForward(60_001);
  await expect(page.locator('.title-button')).toHaveText('全池随机 3');
  expect(requested).toHaveLength(3);
  expect(requested.every(url => url.searchParams.get('collection') === 'random'
    && url.searchParams.get('page') === '1' && url.searchParams.get('page_size') === '12'
    && url.searchParams.get('genre') === '科幻')).toBe(true);
});

test('详情原名搜索沿用网盘和高级筛选，返回推荐保留结果', async ({ page }) => {
  await mockHealth(page);
  await page.route('**/api/discover?**', route => route.fulfill({ json: payload }));
  await page.addInitScript(() => localStorage.setItem('pansou_disk_types', '["quark"]'));
  await page.route('**/api/search?**', route => route.fulfill({ json: {
    code: 0, data: { total: 1, merged_by_type: { quark: [{ url: 'https://pan.quark.cn/s/example', note: 'FOUND_RESOURCE', source: 'test' }] } }
  } }));
  await page.goto('/');
  await page.getByTitle('高级筛选').click();
  await page.getByPlaceholder('高码 hdr 4k').fill('4k');
  await page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('作品资料：豆瓣');
  await expect(page.getByRole('dialog')).toContainText('作品 0 的完整故事简介。');
  const request = page.waitForRequest('**/api/search?**');
  await page.getByRole('button', { name: '用原名搜索', exact: true }).click();
  const url = new URL((await request).url());
  expect(url.searchParams.get('kw')).toBe('Original 0');
  expect(url.searchParams.get('channels')).toBe('test-channel');
  expect(url.searchParams.get('cloud_types')).toBe('quark');
  expect(JSON.parse(url.searchParams.get('filter')!)).toEqual({ include: ['4k'] });
  await expect(page.locator('.discover')).toBeHidden();
  await expect(page.getByText('FOUND_RESOURCE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← 返回推荐' }).click();
  await expect(page.locator('.discover')).toBeVisible();
  await page.getByRole('button', { name: '查看搜索结果 →' }).click();
  await expect(page.getByText('FOUND_RESOURCE', { exact: true })).toBeVisible();
});

test('推荐搜索遵守禁用网盘的校验，保持推荐可见', async ({ page }) => {
  await mockHealth(page);
  await page.route('**/api/discover?**', route => route.fulfill({ json: payload }));
  await page.addInitScript(() => localStorage.setItem('pansou_disk_types', '[]'));
  let searches = 0;
  await page.route('**/api/search?**', route => { searches++; return route.fulfill({ json: {} }); });
  await page.goto('/');
  await page.getByRole('button', { name: '搜索《推荐作品 0》资源', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('至少选择一种网盘类型');
  expect(searches).toBe(0);
  await expect(page.locator('.discover')).toBeVisible();
});

test('推荐失败可重试且不阻止手动搜索', async ({ page }) => {
  await mockHealth(page);
  let failed = true;
  await page.route('**/api/discover?**', route => route.fulfill(failed
    ? { status: 503, json: {} } : { json: payload }));
  await page.route('**/api/search?**', route => route.fulfill({ json: { code: 0, data: { total: 0 } } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '重试加载推荐' })).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: '重试加载推荐' }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(12);
  const input = page.getByPlaceholder('搜索资源、电影、音乐、软件...');
  await input.fill('test');
  await input.press('Enter');
  await expect(page.getByText('未找到相关资源')).toBeVisible();
});

test('手机推荐可以滚动到底部，搜索后仍使用固定结果布局', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockHealth(page);
  await page.route('**/api/discover?**', route => route.fulfill({ json: payload }));
  await page.route('**/api/search?**', route => route.fulfill({ json: { code: 0, data: { total: 0 } } }));
  await page.goto('/');
  await expect(page.locator('.recommendation-card')).toHaveCount(12);
  const layout = await page.locator('.main-content').evaluate(main => ({
    scrollable: main.scrollHeight > main.clientHeight,
    overflow: getComputedStyle(main).overflowY,
    horizontal: document.documentElement.scrollWidth > window.innerWidth
  }));
  expect(layout).toEqual({ scrollable: true, overflow: 'auto', horizontal: false });
  await page.locator('.discover-footer').scrollIntoViewIfNeeded();
  await expect(page.locator('.discover-footer')).toBeInViewport();
  await page.locator('.main-content').evaluate(main => main.scrollTop = 0);
  await page.getByRole('button', { name: '搜索《推荐作品 0》资源', exact: true }).click();
  await expect(page.locator('.main-content')).not.toHaveClass(/recommendations-main/);
  await expect(page.locator('.search-results-block')).toBeVisible();
  expect(await page.locator('.search-results-block').evaluate(block => block.clientHeight)).toBeGreaterThan(300);
});

test('认证海报使用 bearer，缺失海报保留占位', async ({ page }) => {
  await mockHealth(page);
  await page.addInitScript(() => localStorage.setItem('auth_token', 'test-token'));
  let authorization = '';
  await page.route('**/api/discover/poster?**', route => {
    authorization = route.request().headers().authorization;
    return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDpsAAAAASUVORK5CYII=', 'base64') });
  });
  await page.route('**/api/discover?**', route => route.fulfill({ json: {
    ...payload, items: [{ ...items[0], poster_url: '/api/discover/poster?url=https%3A%2F%2Fimg1.doubanio.com%2Fview%2Fphoto%2Fs_ratio_poster%2Fpublic%2Fp1.jpg' }, items[1]]
  } }));
  await page.goto('/');
  await expect(page.getByAltText('推荐作品 0海报')).toHaveAttribute('src', /^blob:/);
  expect(authorization).toBe('Bearer test-token');
  await expect(page.locator('.recommendation-card').nth(1).getByLabel('暂无海报')).toBeVisible();
});

test('详情按实际媒体类型惰性加载，完整资料失败仍能搜索', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  await page.route('**/api/discover?**', route => route.fulfill({ json: {
    ...payload, items: [{ ...items[0], id: '12345', media_type: 'movie', overview: '' }]
  } }));
  let requests = 0;
  let subjectFailed = false;
  await page.route('**/api/discover/subject?**', async route => {
    requests++;
    expect(new URL(route.request().url()).searchParams.get('media_type')).toBe('movie');
    await new Promise(resolve => setTimeout(resolve, 100));
    return route.fulfill(subjectFailed ? { status: 503, json: {} } : { json: {
      ...items[0], id: '12345', media_type: 'movie', overview: '从豆瓣取得的完整真实简介'
    } });
  });
  await page.route('**/api/search?**', route => route.fulfill({ json: { code: 0, data: { total: 0 } } }));
  await page.goto('/');
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
  expect(requests).toBe(0);
  await page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('从豆瓣取得的完整真实简介');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('从豆瓣取得的完整真实简介');
  expect(requests).toBe(1);
  await page.keyboard.press('Escape');
  await page.clock.setSystemTime(Date.now() + 24 * 60 * 60_000 + 1000);
  await page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByRole('dialog')).toContainText('从豆瓣取得的完整真实简介');
  await page.keyboard.press('Escape');
  subjectFailed = true;
  await page.reload();
  await page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('完整资料暂不可用');
  await page.getByRole('dialog').getByRole('button', { name: '搜索资源', exact: true }).click();
  await expect(page.getByText('未找到相关资源')).toBeVisible();
});

test('每分钟后台更新保留卡片、类型筛选和合法分页', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  const longerItems = Array.from({ length: 50 }, (_, index) => ({ ...items[index % items.length], id: `film-${index}`, title: `推荐作品 ${index}` }));
  const updatedItems = [...longerItems.slice(4), ...longerItems.slice(0, 4)].map(item => ({ ...item, title: item.title.replace('推荐', '更新') }));
  let requests = 0;
  const requested: URL[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/discover?**', async route => {
    requests++;
    const url = new URL(route.request().url()); requested.push(url);
    if (requests > 3) await gate;
    return route.fulfill({ json: { ...recommendationPage(url, requests <= 3 ? longerItems : updatedItems),
      updated_at: requests <= 3 ? payload.updated_at : '2026-11-15T09:00:00Z' } });
  });
  await page.goto('/');
  await page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '悬疑', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 1');
  await page.getByRole('button', { name: '换一批', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 25');
  await page.locator('.recommendation-card').first().evaluate(card => card.setAttribute('data-retained', 'yes'));
  await page.clock.fastForward(60_001);
  await expect.poll(() => requests).toBe(4);
  expect(requested.at(-1)?.searchParams.get('page')).toBe('2');
  expect(requested.at(-1)?.searchParams.get('genre')).toBe('悬疑');
  expect(requested.at(-1)?.searchParams.get('page_size')).toBe('12');
  await expect(page.locator('.recommendation-card')).toHaveCount(12);
  await expect(page.locator('.recommendation-card').first()).toHaveAttribute('data-retained', 'yes');
  await expect(page.locator('.recommendation-skeleton')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '换一批', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('.title-button').first()).toHaveText('更新作品 29');
  await expect(page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '悬疑', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.discover-footer')).toContainText('片单更新于');
  await expect(page.locator('.discover-footer')).toContainText('每分钟检查更新');
  await expect(page.getByRole('button', { name: '换一批', exact: true })).toBeEnabled();
  await page.clock.fastForward(60_001);
  await expect.poll(() => requests).toBe(5);
  expect(requested.at(-1)?.searchParams.get('page')).toBe('2');
});

test('后台标签页和搜索结果页暂停检查，返回推荐时补查', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  let requests = 0;
  await page.route('**/api/discover?**', route => { requests++; return route.fulfill({ json: payload }); });
  await page.route('**/api/search?**', route => route.fulfill({ json: { code: 0, data: { total: 0 } } }));
  await page.goto('/');
  await expect(page.locator('.recommendation-card')).toHaveCount(12);
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }));
  await page.clock.fastForward(120_001);
  expect(requests).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByRole('button', { name: '换一批', exact: true })).toBeEnabled();
  const input = page.getByPlaceholder('搜索资源、电影、音乐、软件...');
  await input.fill('test'); await input.press('Enter');
  await expect(page.getByText('未找到相关资源')).toBeVisible();
  await page.clock.fastForward(120_001);
  expect(requests).toBe(2);
  await page.getByRole('button', { name: '← 返回推荐' }).click();
  await expect.poll(() => requests).toBe(3);
  await expect(page.locator('.recommendation-card')).toHaveCount(12);
});

test('手动刷新慢或失败时保留片单并禁止重复提交', async ({ page }) => {
  await mockHealth(page);
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/discover?**', async route => {
    requests++;
    if (requests > 1) { await gate; return route.fulfill({ status: 503, json: {} }); }
    return route.fulfill({ json: { ...payload, items: items.slice(0, 2) } });
  });
  await page.goto('/');
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await page.getByRole('button', { name: '换一批', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await expect(page.locator('.recommendation-skeleton')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '换一批', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('.refresh-status')).toContainText('继续显示当前片单');
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '换一批', exact: true })).toBeEnabled();
  expect(requests).toBe(2);
});

test('切回过期栏目时先显示缓存，再更新片单', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  let movieRequests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/discover?**', async route => {
    const category = new URL(route.request().url()).searchParams.get('category');
    if (category === 'movie') {
      movieRequests++;
      if (movieRequests > 1) await gate;
      return route.fulfill({ json: { ...payload, items: [{ ...items[0], title: movieRequests > 1 ? '更新后的电影' : '缓存的电影' }] } });
    }
    return route.fulfill({ json: { ...payload, items: [{ ...items[1], title: '电视剧推荐' }] } });
  });
  await page.goto('/');
  await expect(page.locator('.title-button').first()).toHaveText('缓存的电影');
  const categories = page.getByRole('group', { name: '作品分类' });
  await categories.getByRole('button', { name: '电视剧', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('电视剧推荐');
  await page.clock.setSystemTime(Date.now() + 61_000);
  await categories.getByRole('button', { name: '电影', exact: true }).click();
  await expect.poll(() => movieRequests).toBe(2);
  await expect(page.locator('.title-button').first()).toHaveText('缓存的电影');
  await expect(page.locator('.recommendation-skeleton')).toHaveCount(0);
  release();
  await expect(page.locator('.title-button').first()).toHaveText('更新后的电影');
});

test('自动更新不打断详情，关闭后应用服务端新排序并修正越界分页', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  let requests = 0;
  const requested: URL[] = [];
  await page.route('**/api/discover?**', route => {
    requests++;
    const url = new URL(route.request().url()); requested.push(url);
    const updated = items.slice(0, 5).reverse();
    return route.fulfill({ json: { ...recommendationPage(url, requests > 2 ? updated : items),
      updated_at: requests > 2 ? '2026-11-15T09:00:00Z' : payload.updated_at } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '换一批', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 12');
  await page.getByRole('button', { name: '查看《推荐作品 12》详情', exact: true }).click();
  await page.clock.fastForward(60_001);
  await expect.poll(() => requests).toBe(3);
  await expect(page.locator('.refresh-status')).toContainText('每分钟检查更新');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('推荐作品 12');
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 12');
  await page.keyboard.press('Escape');
  await expect(page.locator('.title-button').first()).toHaveText('推荐作品 4');
  await expect(page.locator('.recommendation-card')).toHaveCount(5);
  await page.clock.fastForward(60_001);
  await expect.poll(() => requests).toBe(4);
  expect(requested.at(-1)?.searchParams.get('page')).toBe('1');
});

test('自动片单评分更新后再次开详情不会退回旧缓存评分', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  let listRequests = 0;
  let subjectRequests = 0;
  const film = { ...items[0], id: '12345', media_type: 'movie' };
  await page.route('**/api/discover?**', route => {
    listRequests++;
    return route.fulfill({ json: { ...payload, items: [{ ...film,
      douban_rating: listRequests > 1 ? 9.1 : 8.7,
      douban_votes: listRequests > 1 ? 13000 : 12500
    }] } });
  });
  await page.route('**/api/discover/subject?**', route => {
    subjectRequests++;
    return route.fulfill({ json: { ...film, overview: '已经缓存的完整作品简介', douban_rating: 8.5, douban_votes: 12000 } });
  });
  await page.goto('/');
  const openDetails = page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true });
  await openDetails.click();
  await expect(page.getByRole('dialog')).toContainText('已经缓存的完整作品简介');
  await expect(page.getByRole('dialog').locator('.rating-number')).toHaveText('8.7');
  await page.keyboard.press('Escape');
  await page.clock.fastForward(60_001);
  await expect(page.locator('.card-rating')).toContainText('豆瓣 9.1');
  await openDetails.click();
  await expect(page.getByRole('dialog').locator('.rating-number')).toHaveText('9.1');
  await expect(page.getByRole('dialog').locator('.detail-votes')).toContainText('13,000');
  await expect(page.getByRole('dialog')).toContainText('已经缓存的完整作品简介');
  expect(subjectRequests).toBe(1);
});

test('首次详情请求返回服务端旧缓存时保留片单评分，缺失评分才补全', async ({ page }) => {
  await mockHealth(page);
  const film = { ...items[0], id: '12345', media_type: 'movie', douban_rating: 9.1, douban_votes: 13000 };
  const unrated = { ...film, id: '12346', title: '暂无评分作品', douban_rating: null, douban_votes: null };
  await page.route('**/api/discover?**', route => route.fulfill({ json: { ...payload, items: [film, unrated] } }));
  await page.route('**/api/discover/subject?**', route => {
    const id = new URL(route.request().url()).searchParams.get('id');
    return route.fulfill({ json: { ...film, id, title: id === film.id ? film.title : unrated.title,
      overview: '服务端缓存的完整简介', douban_rating: 8.5, douban_votes: 12000 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('服务端缓存的完整简介');
  await expect(page.getByRole('dialog').locator('.rating-number')).toHaveText('9.1');
  await expect(page.getByRole('dialog').locator('.detail-votes')).toContainText('13,000');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查看《暂无评分作品》详情', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.rating-number')).toHaveText('8.5');
  await expect(page.getByRole('dialog').locator('.detail-votes')).toContainText('12,000');
});

test('片单已含完整新鲜详情时立即展示且不重复请求', async ({ page }) => {
  await mockHealth(page);
  let subjectRequests = 0;
  await page.route('**/api/discover?**', route => route.fulfill({ json: {
    ...payload, items: [{ ...items[0], id: '12345', media_type: 'movie', details_cached: true,
      overview: '片单已带完整作品简介，无需再次等待网络。' }]
  } }));
  await page.route('**/api/discover/subject?**', route => {
    subjectRequests++;
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('片单已带完整作品简介，无需再次等待网络。');
  await expect(page.getByRole('dialog').locator('.rating-number')).toHaveText('8.7');
  await expect(page.getByRole('dialog').getByText('正在加载作品详情…')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('片单已带完整作品简介，无需再次等待网络。');
  expect(subjectRequests).toBe(0);
});

test('详情首次增强为 TMDB、已配置 TMDB 或列表使用 TMDB 时均显示署名', async ({ page }) => {
  await mockHealth(page);
  let mode = 'douban';
  const film = { ...items[0], id: '12345', media_type: 'movie' };
  await page.route('**/api/discover?**', route => route.fulfill({ json: {
    ...payload, tmdb_configured: mode === 'configured',
    items: [{ ...film, metadata_source: mode === 'listed' ? 'tmdb' : 'douban' }]
  } }));
  await page.route('**/api/discover/subject?**', route => route.fulfill({ json: {
    ...film, metadata_source: 'tmdb', overview: '首次从 TMDB 增强的完整资料'
  } }));
  await page.goto('/');
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
  await expect(page.locator('.tmdb-attribution')).toHaveCount(0);
  await page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('首次从 TMDB 增强的完整资料');
  await expect(page.getByRole('dialog').locator('.metadata-source')).toContainText('作品资料：TMDB');
  await expect(page.locator('.tmdb-attribution')).toContainText('This product uses the TMDB API but is not endorsed or certified by TMDB.');
  await expect(page.locator('.tmdb-attribution').getByRole('link', { name: 'TMDB 官网' })).toHaveAttribute('href', 'https://www.themoviedb.org/');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tmdb-attribution')).toHaveCount(0);
  for (mode of ['configured', 'listed']) {
    await page.reload();
    await expect(page.locator('.recommendation-card')).toHaveCount(1);
    await expect(page.locator('.tmdb-attribution')).toBeVisible();
    await expect(page.locator('.tmdb-attribution').getByAltText('TMDB')).toHaveAttribute('src', '/tmdb-logo.svg');
  }
});

test('启用 TMDB 后旧豆瓣详情只缓存五秒，增强后的 TMDB 详情继续复用长缓存', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  const film = { ...items[0], id: '12345', media_type: 'movie' };
  await page.route('**/api/discover?**', route => route.fulfill({ json: {
    ...payload, tmdb_configured: true, items: [film]
  } }));
  let requests = 0;
  await page.route('**/api/discover/subject?**', route => {
    requests++;
    return route.fulfill({ json: { ...film,
      metadata_source: requests === 1 ? 'douban' : 'tmdb',
      overview: requests === 1 ? '后台增强前的豆瓣详情' : '后台增强后的 TMDB 详情'
    } });
  });
  await page.goto('/');
  const openDetails = page.getByRole('button', { name: '查看《推荐作品 0》详情', exact: true });
  await openDetails.click();
  await expect(page.getByRole('dialog')).toContainText('后台增强前的豆瓣详情');
  await page.keyboard.press('Escape');
  await openDetails.click();
  await expect(page.getByRole('dialog')).toContainText('后台增强前的豆瓣详情');
  expect(requests).toBe(1);
  await page.keyboard.press('Escape');
  await page.clock.fastForward(5_001);
  await openDetails.click();
  await expect(page.getByRole('dialog')).toContainText('后台增强后的 TMDB 详情');
  await expect(page.getByRole('dialog').locator('.metadata-source')).toContainText('作品资料：TMDB');
  expect(requests).toBe(2);
  await page.keyboard.press('Escape');
  await page.clock.setSystemTime(Date.now() + 6 * 60 * 60_000);
  await openDetails.click();
  await expect(page.getByRole('dialog')).toContainText('后台增强后的 TMDB 详情');
  expect(requests).toBe(2);
});

test('TMDB 电影与剧集使用各自详情 ID，缺少豆瓣关联时不显示评分或豆瓣链接', async ({ page }) => {
  await mockHealth(page);
  const films = [
    { ...items[0], id: 'tmdb:movie:123', title: '目录中的电影', media_type: 'tv',
      metadata_source: 'tmdb', douban_rating: null, douban_votes: null, douban_url: undefined, overview: '' },
    { ...items[0], id: 'tmdb:tv:123', title: '目录中的剧集', media_type: undefined, year: undefined,
      metadata_source: 'tmdb', douban_rating: null, douban_votes: null, douban_url: undefined, overview: '' }
  ];
  await page.route('**/api/discover?**', route => route.fulfill({ json: {
    ...payload, tmdb_configured: true, items: films
  } }));
  const requested: URL[] = [];
  await page.route('**/api/discover/subject?**', route => {
    const url = new URL(route.request().url()); requested.push(url);
    const film = films.find(item => item.id === url.searchParams.get('id'))!;
    return route.fulfill({ json: { ...film, overview: `${film.title}的完整简介` } });
  });
  await page.goto('/');
  await expect(page.locator('.card-rating')).toHaveText(['暂无评分', '暂无评分']);
  await expect(page.locator('.recommendation-card').nth(1).locator('.card-year')).toHaveText('年份待补充');
  await expect(page.locator('.recommendation-card').nth(1).getByLabel('暂无海报')).toBeVisible();
  for (const film of films) {
    await page.getByRole('button', { name: `查看《${film.title}》详情`, exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(`${film.title}的完整简介`);
    await expect(page.getByRole('dialog').locator('.detail-rating')).toHaveText('暂无评分');
    await expect(page.getByRole('dialog').getByRole('link', { name: '在豆瓣查看' })).toHaveCount(0);
    await expect(page.getByRole('dialog').locator('.metadata-source')).toHaveText('作品资料：TMDB');
    await page.keyboard.press('Escape');
  }
  expect(requested.map(url => [url.searchParams.get('id'), url.searchParams.get('media_type')]))
    .toEqual([['tmdb:movie:123', 'movie'], ['tmdb:tv:123', 'tv']]);
  await page.route('**/api/search?**', route => route.fulfill({ json: { code: 0, data: { total: 0 } } }));
  const resourceRequest = page.waitForRequest('**/api/search?**');
  await page.getByRole('button', { name: '搜索《目录中的剧集》资源', exact: true }).click();
  expect(new URL((await resourceRequest).url()).searchParams.get('kw')).toBe('目录中的剧集');
});

test('不支持的目录 ID 不请求详情，失败的 TMDB 详情保留资源搜索且不提示豆瓣链接', async ({ page }) => {
  await mockHealth(page);
  const films = [
    { ...items[0], id: 'tmdb:person:123', title: '非作品目录 ID', douban_url: undefined },
    { ...items[0], id: 'tmdb:movie:0', title: '无效目录 ID', douban_url: undefined },
    { ...items[0], id: 'tmdb:tv:123', title: '详情暂缺剧集', metadata_source: 'tmdb', douban_url: undefined }
  ];
  await page.route('**/api/discover?**', route => route.fulfill({ json: { ...payload, items: films } }));
  let requests = 0;
  await page.route('**/api/discover/subject?**', route => {
    requests++;
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/');
  for (const film of films.slice(0, 2)) {
    await page.getByRole('button', { name: `查看《${film.title}》详情`, exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading')).toHaveText(film.title);
    await page.keyboard.press('Escape');
  }
  expect(requests).toBe(0);
  await page.getByRole('button', { name: '查看《详情暂缺剧集》详情', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('完整资料暂不可用，你仍可以搜索资源。');
  expect(requests).toBe(1);
  await expect(page.getByRole('dialog')).not.toContainText('豆瓣查看');
  await expect(page.getByRole('dialog').getByRole('button', { name: '搜索资源', exact: true })).toBeVisible();
});

const catalogItems = Array.from({ length: 74 }, (_, index) => ({
  ...items[index % items.length], id: `library-${index}`, title: `片库作品 ${index}`
}));
const catalogPage = (page: number) => ({ ...payload,
  items: catalogItems.slice((page - 1) * 24, page * 24),
  total: catalogItems.length, catalog_total: catalogItems.length,
  page, page_size: 24, has_more: page * 24 < catalogItems.length,
  genres: ['悬疑', '科幻', '纪录'], years: ['2026', '2024', '1999'], indexing: true
});
const libraryTopPager = (page: Page) => page.getByRole('navigation', { name: '片库分页（顶部）', exact: true });
const yearFilter = (page: Page) => page.getByRole('group', { name: '作品年份', exact: true });
const mainYears = (page: Page) => yearFilter(page).locator('.year-options').first();
const moreYears = (page: Page) => page.getByRole('group', { name: '全部年份', exact: true });

test('全目录同步显示收录和资料进度，空目录与重试状态仍可查看', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  let stage = 'indexing';
  let indexed = 1234567;
  let hydrated = 2048;
  let syncError: string | undefined;
  await page.route('**/api/discover?**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.searchParams.get('collection') === 'library' ? {
      ...catalogPage(1), items: indexed ? catalogPage(1).items : [],
      catalog_sync: { enabled: true, stage, indexed, hydrated, error: syncError }
    } : payload });
  });
  await page.goto('/');
  await expect(page.locator('.catalog-sync-status')).toHaveCount(0);
  await page.getByRole('button', { name: '影视片库', exact: true }).click();
  await expect(page.locator('.catalog-sync-status')).toHaveText('影视目录已收录 1,234,567 部 · 资料已补齐 2,048 部 · 同步进行中');
  await expect(page.locator('.catalog-summary')).toContainText('片库持续补充中');
  stage = 'hydrating';
  hydrated = 4096;
  await page.clock.fastForward(60_001);
  await expect(page.locator('.catalog-sync-status')).toContainText('资料已补齐 4,096 部 · 正在补充资料');
  stage = 'paused';
  await page.clock.fastForward(60_001);
  await expect(page.locator('.catalog-sync-status')).toContainText('目录同步已暂停');
  stage = 'ready';
  await page.clock.fastForward(60_001);
  await expect(page.locator('.catalog-sync-status')).toContainText('每日自动更新');
  stage = 'indexing';
  indexed = hydrated = 0;
  syncError = 'private diagnostic must not be displayed';
  await page.clock.fastForward(60_001);
  await expect(page.locator('.recommendation-card')).toHaveCount(0);
  await expect(page.locator('.catalog-sync-status')).toHaveText('影视目录已收录 0 部 · 资料已补齐 0 部 · 同步暂缓，稍后自动重试');
  await expect(page.locator('.discover')).not.toContainText(syncError);
});

test('片库按真实总数翻页，可浏览超过单批的作品且末页不循环', async ({ page }) => {
  await mockHealth(page);
  const requested: URL[] = [];
  await page.route('**/api/discover?**', route => {
    const url = new URL(route.request().url());
    requested.push(url);
    return route.fulfill({ json: url.searchParams.get('collection') === 'library'
      ? catalogPage(Number(url.searchParams.get('page'))) : payload });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '影视片库', exact: true }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(24);
  await expect(page.locator('.catalog-summary')).toContainText('已收录 74 部');
  await expect(page.locator('.catalog-summary')).toContainText('片库持续补充中');
  await expect(libraryTopPager(page)).toContainText('第 1 / 4 页');
  await expect(libraryTopPager(page).getByRole('button', { name: '上一页' })).toBeDisabled();
  for (const index of [2, 3, 4]) {
    await libraryTopPager(page).getByRole('button', { name: '下一页' }).click();
    await expect(libraryTopPager(page)).toContainText(`第 ${index} / 4 页`);
    await expect(page.locator('.title-button').first()).toHaveText(`片库作品 ${(index - 1) * 24}`);
  }
  await expect(page.locator('.recommendation-card')).toHaveCount(2);
  await expect(libraryTopPager(page).getByRole('button', { name: '下一页' })).toBeDisabled();
  const libraryRequests = requested.filter(url => url.searchParams.get('collection') === 'library');
  expect(libraryRequests.map(url => url.searchParams.get('page'))).toEqual(['1', '2', '3', '4']);
  expect(libraryRequests.every(url => url.searchParams.get('page_size') === '24')).toBe(true);
  await libraryTopPager(page).getByRole('button', { name: '上一页' }).click();
  await expect(page.locator('.title-button').first()).toHaveText('片库作品 48');
});

test('片库类型来自全库，服务端筛选与片名查询不触发资源搜索', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  const requested: URL[] = [];
  let resourceSearches = 0;
  await page.route('**/api/search?**', route => { resourceSearches++; return route.fulfill({ json: {} }); });
  await page.route('**/api/discover?**', route => {
    const url = new URL(route.request().url());
    requested.push(url);
    if (url.searchParams.get('collection') !== 'library') return route.fulfill({ json: payload });
    if (url.searchParams.get('genre') || url.searchParams.get('q')) {
      const empty = url.searchParams.get('q') === '未收录的作品';
      return route.fulfill({ json: { ...catalogPage(1),
        items: empty ? [] : [{ ...catalogItems[0], title: '服务端匹配的作品', genres: [] }],
        total: empty ? 0 : 1, has_more: false
      } });
    }
    return route.fulfill({ json: catalogPage(Number(url.searchParams.get('page'))) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '影视片库', exact: true }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(24);
  await libraryTopPager(page).getByRole('button', { name: '下一页' }).click();
  await expect(libraryTopPager(page)).toContainText('第 2 / 4 页');
  // 当前页没有纪录类型，但全库 facet 提供该类型；未知 genres 不应被前端二次过滤。
  await page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '纪录', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('服务端匹配的作品');
  expect(requested.at(-1)?.searchParams.get('genre')).toBe('纪录');
  expect(requested.at(-1)?.searchParams.get('page')).toBe('1');
  await expect(page.locator('.catalog-summary')).toContainText('找到 1 部');
  await expect(page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '纪录', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const input = page.getByRole('search', { name: '片库内查找' }).getByRole('searchbox');
  await input.fill('Original 0'); await input.press('Enter');
  await expect.poll(() => requested.at(-1)?.searchParams.get('q')).toBe('Original 0');
  await expect(page.locator('.title-button').first()).toHaveText('服务端匹配的作品');
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(input).toHaveValue('');
  // 清空可以立即复用之前的筛选缓存，下一次自动检查须使用清空后的条件。
  await page.clock.fastForward(60_001);
  await expect.poll(() => requested.at(-1)?.searchParams.has('q')).toBe(false);
  await expect(page.getByRole('button', { name: '查找片库', exact: true })).toBeEnabled();
  await input.fill('未收录的作品'); await input.press('Enter');
  await expect(page.getByText('未找到匹配的已收录作品', { exact: true })).toBeVisible();
  await expect(page.locator('.catalog-summary')).toContainText('已收录 74 部');
  await expect(page.locator('.catalog-summary')).toContainText('找到 0 部');
  expect(resourceSearches).toBe(0);
  await expect(page.getByPlaceholder('搜索资源、电影、音乐、软件...')).toHaveValue('');
});

test('片库翻页失败保留原页，重试成功后每分钟只刷新当前页', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  let pageTwoRequests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/discover?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('collection') !== 'library') return route.fulfill({ json: payload });
    const number = Number(url.searchParams.get('page'));
    if (number === 2) {
      pageTwoRequests++;
      if (pageTwoRequests === 1) { await gate; return route.fulfill({ status: 503, json: {} }); }
    }
    return route.fulfill({ json: { ...catalogPage(number),
      items: catalogPage(number).items.map(item => ({ ...item, title: pageTwoRequests > 2 ? `${item.title} 已更新` : item.title }))
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '影视片库', exact: true }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(24);
  await libraryTopPager(page).getByRole('button', { name: '下一页' }).click();
  await expect.poll(() => pageTwoRequests).toBe(1);
  await expect(page.locator('.title-button').first()).toHaveText('片库作品 0');
  await expect(libraryTopPager(page)).toContainText('第 1 / 4 页');
  await expect(libraryTopPager(page).getByRole('button', { name: '下一页' })).toBeDisabled();
  await expect(page.locator('.recommendation-skeleton')).toHaveCount(0);
  release();
  await expect(page.locator('.refresh-status')).toContainText('继续显示当前片单');
  await libraryTopPager(page).getByRole('button', { name: '下一页' }).click();
  await expect(libraryTopPager(page)).toContainText('第 2 / 4 页');
  await expect(page.locator('.title-button').first()).toHaveText('片库作品 24');
  await page.clock.fastForward(60_001);
  await expect.poll(() => pageTwoRequests).toBe(3);
  await expect(page.locator('.title-button').first()).toHaveText('片库作品 24 已更新');
  await expect(libraryTopPager(page)).toContainText('第 2 / 4 页');
});

test('片库年份使用全库选项，组合类型和片名查询并重置页码', async ({ page }) => {
  await mockHealth(page);
  const requested: URL[] = [];
  await page.route('**/api/discover?**', route => {
    const url = new URL(route.request().url());
    requested.push(url);
    if (url.searchParams.get('collection') !== 'library') return route.fulfill({ json: payload });
    const response = { ...catalogPage(Number(url.searchParams.get('page'))),
      years: ['1999', '2026', '2024', '2024', 'unknown', '0', '0000'] };
    const year = url.searchParams.get('year');
    if (year || url.searchParams.get('q')) return route.fulfill({ json: {
      ...response, items: [{ ...catalogItems[0], year: year === 'unknown' ? '' : year || '1999',
        title: year === 'unknown' ? '待补年份作品' : year === '2024' ? '2024 年匹配作品' : '不限年份匹配作品', genres: [] }],
      total: 1, has_more: false
    } });
    return route.fulfill({ json: response });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '影视片库', exact: true }).click();
  await expect(mainYears(page).getByRole('button')).toHaveText(['全部', '2026', '2024', '90年代', '更多年份']);
  await libraryTopPager(page).getByRole('button', { name: '下一页' }).click();
  await expect(libraryTopPager(page)).toContainText('第 2 / 4 页');
  await mainYears(page).getByRole('button', { name: '2024', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('2024 年匹配作品');
  expect(requested.at(-1)?.searchParams.get('page')).toBe('1');
  expect(requested.at(-1)?.searchParams.get('year')).toBe('2024');
  await expect(page.locator('.card-year').first()).toHaveText('2024 年');
  await expect(page.locator('.catalog-summary')).toContainText('找到 1 部');
  // 服务器可能使用已补充的元数据匹配；前端不根据当前页字段再筛一次。
  await page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '纪录', exact: true }).click();
  await expect.poll(() => requested.at(-1)?.searchParams.get('genre')).toBe('纪录');
  await expect(page.getByRole('button', { name: '查找片库', exact: true })).toBeEnabled();
  const input = page.getByRole('search', { name: '片库内查找' }).getByRole('searchbox');
  await input.fill('Original'); await input.press('Enter');
  await expect.poll(() => requested.at(-1)?.searchParams.get('q')).toBe('Original');
  expect(requested.at(-1)?.searchParams.get('year')).toBe('2024');
  expect(requested.at(-1)?.searchParams.get('genre')).toBe('纪录');
  await expect(page.locator('.title-button').first()).toHaveText('2024 年匹配作品');
  await yearFilter(page).getByRole('button', { name: '更多年份', exact: true }).click();
  await moreYears(page).getByRole('button', { name: '年份待补充', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('待补年份作品');
  expect(requested.at(-1)?.searchParams.get('year')).toBe('unknown');
  await expect(page.locator('.card-year').first()).toHaveText('年份待补充');
  await mainYears(page).getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('不限年份匹配作品');
  expect(requested.at(-1)?.searchParams.has('year')).toBe(false);
  expect(requested.at(-1)?.searchParams.get('q')).toBe('Original');
  await mainYears(page).getByRole('button', { name: '2024', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('2024 年匹配作品');
  await page.getByRole('group', { name: '作品分类' }).getByRole('button', { name: '电视剧', exact: true }).click();
  await expect.poll(() => requested.at(-1)?.searchParams.get('category')).toBe('tv');
  expect(requested.at(-1)?.searchParams.has('year')).toBe(false);
  expect(requested.at(-1)?.searchParams.has('genre')).toBe(false);
  expect(requested.at(-1)?.searchParams.has('q')).toBe(false);
  expect(requested.at(-1)?.searchParams.get('page')).toBe('1');
  await expect(mainYears(page).getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(moreYears(page)).toHaveCount(0);
});

test('年份请求慢或失败保留当前片单，自动重试使用当前年份条件', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  let unknownRequests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/discover?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('collection') !== 'library') return route.fulfill({ json: payload });
    if (url.searchParams.get('year') === 'unknown') {
      unknownRequests++;
      if (unknownRequests === 1) { await gate; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: { ...catalogPage(1),
        items: [{ ...catalogItems[0], year: '', title: '未知年份作品' }, { ...catalogItems[1], year: 0 }],
        total: 2, has_more: false } });
    }
    return route.fulfill({ json: url.searchParams.get('year') === '2024'
      ? { ...catalogPage(1), items: [{ ...catalogItems[0], year: '2024', title: '已显示的 2024 年作品' }], total: 1, has_more: false }
      : catalogPage(1) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '影视片库', exact: true }).click();
  await mainYears(page).getByRole('button', { name: '2024', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('已显示的 2024 年作品');
  await yearFilter(page).getByRole('button', { name: '更多年份', exact: true }).click();
  await moreYears(page).getByRole('button', { name: '年份待补充', exact: true }).click();
  await expect.poll(() => unknownRequests).toBe(1);
  await expect(page.locator('.title-button').first()).toHaveText('已显示的 2024 年作品');
  await expect(page.locator('.recommendation-skeleton')).toHaveCount(0);
  await expect(page.locator('.catalog-summary')).toContainText('找到 1 部');
  release();
  await expect(page.locator('.refresh-status')).toContainText('继续显示当前片单');
  await page.clock.fastForward(60_001);
  await expect.poll(() => unknownRequests).toBe(2);
  await expect(page.locator('.title-button').first()).toHaveText('未知年份作品');
  await expect(page.locator('.card-year')).toHaveText(['年份待补充', '年份待补充']);
  await expect(page.locator('.catalog-summary')).toContainText('找到 2 部');
  await expect(mainYears(page).getByRole('button', { name: '年份待补充', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '查看《未知年份作品》详情', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.detail-meta')).toContainText('年份待补充');
});

test('年份标签按实际收录提供年代范围，组合查询与自动刷新保留闭区间', async ({ page }) => {
  await page.clock.install();
  await mockHealth(page);
  const requested: URL[] = [];
  await page.route('**/api/discover?**', route => {
    const url = new URL(route.request().url()); requested.push(url);
    if (url.searchParams.get('collection') !== 'library') return route.fulfill({ json: payload });
    const response = { ...catalogPage(Number(url.searchParams.get('page'))),
      years: ['2026', '2024', '2020', '2019', '2011', '2009', '2000', '1999', '1989', '1979', '1950', '1800', '1799', '2999'] };
    if (url.searchParams.has('year_from')) return route.fulfill({ json: { ...response,
      items: [{ ...catalogItems[0], title: '年代范围内作品', year: '2008' }], total: 1, has_more: false } });
    return route.fulfill({ json: response });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '影视片库', exact: true }).click();
  await expect(mainYears(page).getByRole('button')).toHaveText([
    '全部', '2026', '2024', '2020', '2010–2019', '2000–2009', '90年代', '80年代', '更早', '更多年份'
  ]);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await libraryTopPager(page).getByRole('button', { name: '下一页' }).click();
  await expect(libraryTopPager(page)).toContainText('第 2 / 4 页');
  await mainYears(page).getByRole('button', { name: '2000–2009', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('年代范围内作品');
  expect(requested.at(-1)?.searchParams.get('page')).toBe('1');
  expect(requested.at(-1)?.searchParams.get('year_from')).toBe('2000');
  expect(requested.at(-1)?.searchParams.get('year_to')).toBe('2009');
  expect(requested.at(-1)?.searchParams.has('year')).toBe(false);
  await page.getByRole('group', { name: '作品类型', exact: true }).getByRole('button', { name: '科幻', exact: true }).click();
  await expect.poll(() => requested.at(-1)?.searchParams.get('genre')).toBe('科幻');
  await expect(page.getByRole('button', { name: '查找片库', exact: true })).toBeEnabled();
  const input = page.getByRole('search', { name: '片库内查找' }).getByRole('searchbox');
  await input.fill('Original'); await input.press('Enter');
  await expect.poll(() => requested.at(-1)?.searchParams.get('q')).toBe('Original');
  await expect(page.getByRole('button', { name: '查找片库', exact: true })).toBeEnabled();
  const beforeRefresh = requested.length;
  await page.clock.fastForward(60_001);
  await expect.poll(() => requested.length).toBeGreaterThan(beforeRefresh);
  await expect.poll(() => requested.at(-1)?.searchParams.get('year_from')).toBe('2000');
  expect(requested.at(-1)?.searchParams.get('year_to')).toBe('2009');
  expect(requested.at(-1)?.searchParams.get('genre')).toBe('科幻');
  expect(requested.at(-1)?.searchParams.get('q')).toBe('Original');
  await expect(mainYears(page).getByRole('button', { name: '2000–2009', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await mainYears(page).getByRole('button', { name: '2024', exact: true }).click();
  await expect.poll(() => requested.at(-1)?.searchParams.get('year')).toBe('2024');
  expect(requested.at(-1)?.searchParams.has('year_from')).toBe(false);
  expect(requested.at(-1)?.searchParams.has('year_to')).toBe(false);
});

test('更多年份按年代展开，键盘选中旧年份后收起仍显示当前条件', async ({ page }, testInfo) => {
  await mockHealth(page);
  const requested: URL[] = [];
  await page.route('**/api/discover?**', route => {
    const url = new URL(route.request().url()); requested.push(url);
    return route.fulfill({ json: url.searchParams.get('collection') === 'library'
      ? { ...catalogPage(1), years: ['2026', '2024', '2020', '2019', '2011', '2009', '1999', '1997', '1989', '1979', '1950'] }
      : payload });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '影视片库', exact: true }).click();
  const toggle = yearFilter(page).getByRole('button', { name: '更多年份', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus(); await page.keyboard.press('Enter');
  const expandedToggle = yearFilter(page).getByRole('button', { name: '收起年份', exact: true });
  await expect(expandedToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(expandedToggle).toHaveAttribute('aria-controls', 'library-more-years');
  await expect(moreYears(page).getByRole('group', { name: '1990年代', exact: true }).getByRole('button')).toHaveText(['1999', '1997']);
  await expect(moreYears(page).getByRole('button', { name: '1998', exact: true })).toHaveCount(0);
  const oldYear = moreYears(page).getByRole('button', { name: '1997', exact: true });
  await oldYear.focus(); await page.keyboard.press('Space');
  await expect.poll(() => requested.at(-1)?.searchParams.get('year')).toBe('1997');
  await expandedToggle.click();
  await expect(moreYears(page)).toHaveCount(0);
  await expect(mainYears(page).getByRole('button', { name: '1997', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(mainYears(page).getByRole('button', { name: '90年代', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.catalog-filters').screenshot({ path: testInfo.outputPath('desktop-year-filter.png') });
});

test('320px年份筛选自然换行，年代和精确年可直接触摸且没有横向滚动', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 320, height: 844 }, hasTouch: true, isMobile: true });
  const touchPage = await context.newPage();
  await mockHealth(touchPage);
  const requested: URL[] = [];
  await touchPage.route('**/api/discover?**', route => {
    const url = new URL(route.request().url()); requested.push(url);
    return route.fulfill({ json: url.searchParams.get('collection') === 'library'
      ? { ...catalogPage(1), years: ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2009', '1999', '1989', '1979', '1950'] }
      : payload });
  });
  await touchPage.goto('/');
  await touchPage.getByRole('button', { name: '影视片库', exact: true }).tap();
  await expect(yearFilter(touchPage)).toBeVisible();
  const dimensions = await mainYears(touchPage).evaluate(element => ({
    overflow: element.scrollWidth > element.clientWidth,
    minHeight: Math.min(...[...element.querySelectorAll('button')].map(button => button.getBoundingClientRect().height)),
    rows: new Set([...element.querySelectorAll('button')].map(button => Math.round(button.getBoundingClientRect().top))).size
  }));
  expect(dimensions.overflow).toBe(false);
  expect(dimensions.minHeight).toBeGreaterThanOrEqual(44);
  expect(dimensions.rows).toBeGreaterThan(1);
  await mainYears(touchPage).getByRole('button', { name: '90年代', exact: true }).tap();
  await expect.poll(() => requested.at(-1)?.searchParams.get('year_from')).toBe('1990');
  expect(requested.at(-1)?.searchParams.get('year_to')).toBe('1999');
  await yearFilter(touchPage).getByRole('button', { name: '更多年份', exact: true }).tap();
  await moreYears(touchPage).getByRole('button', { name: '1950', exact: true }).tap();
  await expect.poll(() => requested.at(-1)?.searchParams.get('year')).toBe('1950');
  await yearFilter(touchPage).getByRole('button', { name: '收起年份', exact: true }).tap();
  await expect(mainYears(touchPage).getByRole('button', { name: '1950', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await touchPage.locator('.main-content').evaluate(main => main.scrollWidth > main.clientWidth)).toBe(false);
  expect(await touchPage.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await touchPage.locator('.catalog-filters').screenshot({ path: testInfo.outputPath('mobile-year-filter.png') });
  await context.close();
});

test('手机五分类和五栏目不撑宽页面，纪录片也可打开片库', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mockHealth(page);
  const requested: URL[] = [];
  await page.route('**/api/discover?**', route => {
    const url = new URL(route.request().url()); requested.push(url);
    return route.fulfill({ json: url.searchParams.get('collection') === 'library' ? catalogPage(1) : payload });
  });
  await page.goto('/');
  await page.getByRole('group', { name: '作品分类' }).getByRole('button', { name: '纪录片', exact: true }).click();
  await expect.poll(() => requested.at(-1)?.searchParams.get('category')).toBe('documentary');
  await page.getByRole('button', { name: '影视片库', exact: true }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(24);
  await expect(page.getByRole('search', { name: '片库内查找' })).toBeVisible();
  await expect(yearFilter(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(await page.locator('.main-content').evaluate(main => main.scrollWidth > main.clientWidth)).toBe(false);
  await expect(libraryTopPager(page)).toBeVisible();
  expect(requested.at(-1)?.searchParams.get('category')).toBe('documentary');
});
