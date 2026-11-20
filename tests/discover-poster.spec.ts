import { test, expect, type Page, type Request, type Route } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDpsAAAAASUVORK5CYII=', 'base64');
const poster = (id: string) => `/api/discover/poster?url=${encodeURIComponent(`https://img1.doubanio.com/view/photo/s_ratio_poster/public/${id}.jpg`)}`;
const idOf = (request: Request) => new URL(new URL(request.url()).searchParams.get('url')!).pathname.split('/').at(-1)!.replace('.jpg', '');
const films = (prefix: string, count = 12) => Array.from({ length: count }, (_, index) => ({
  id: `${prefix}-${index}`, title: `${prefix}作品 ${index}`, year: '2024',
  poster_url: poster(`${prefix}-${index}`), genres: ['剧情'], douban_rating: 8.5, douban_votes: 1000
}));

async function mockLists(page: Page, select = (category: string) => films(category)) {
  await page.route('**/api/health', route => route.fulfill({ json: {
    status: 'ok', channels: [], plugins: [], plugins_enabled: true, auth_enabled: false
  } }));
  await page.route('**/api/discover?**', route => {
    const items = select(new URL(route.request().url()).searchParams.get('category') || 'movie');
    return route.fulfill({ json: { items, total: items.length, page: 1, page_size: 12, has_more: false, genres: ['剧情'] } });
  });
}

async function allPostersVisible(page: Page) {
  await page.addInitScript(() => {
    class Observer {
      private connected = true;
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) { queueMicrotask(() => { if (this.connected) this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }); }
      unobserve() {}
      disconnect() { this.connected = false; }
    }
    window.IntersectionObserver = Observer as unknown as typeof IntersectionObserver;
  });
}

function holdPosters(page: Page) {
  const started: string[] = [];
  const cancelled: string[] = [];
  const active = new Set<Request>();
  const release: Array<() => void> = [];
  const releaseCancelled = new Map<Request, () => void>();
  let maximum = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname !== '/api/discover/poster') return;
    active.add(request);
    maximum = Math.max(maximum, active.size);
  });
  page.on('requestfinished', request => active.delete(request));
  page.on('requestfailed', request => {
    if (active.delete(request)) cancelled.push(idOf(request));
    releaseCancelled.get(request)?.();
    releaseCancelled.delete(request);
  });
  const handler = async (route: Route) => {
    started.push(idOf(route.request()));
    await new Promise<void>(resolve => { release.push(resolve); releaseCancelled.set(route.request(), resolve); });
    await route.fulfill({ contentType: 'image/png', body: png }).catch(() => {});
    releaseCancelled.delete(route.request());
  };
  return { started, cancelled, handler, active, maximum: () => maximum, releaseAll: () => release.splice(0).forEach(resolve => resolve()) };
}

test('海报最多两个并发，慢海报不延迟新列表，换分类取消旧排队与活跃请求', async ({ page }) => {
  await allPostersVisible(page);
  await mockLists(page);
  const held = holdPosters(page);
  await page.route('**/api/discover/poster?**', held.handler);
  try {
    await page.goto('/');
    await expect(page.locator('.recommendation-card')).toHaveCount(12);
    await expect.poll(() => held.started.length).toBe(2);
    await page.waitForTimeout(100);
    expect(held.started).toEqual(['movie-0', 'movie-1']);
    await page.getByRole('group', { name: '作品分类', exact: true }).getByRole('button', { name: '电视剧', exact: true }).click();
    await expect(page.locator('.title-button').first()).toHaveText('tv作品 0');
    await expect.poll(() => held.cancelled.filter(id => id.startsWith('movie-')).length).toBe(2);
    await expect.poll(() => held.started.filter(id => id.startsWith('tv-')).length).toBe(2);
    expect(held.started.filter(id => id.startsWith('movie-'))).toHaveLength(2);
    expect(held.maximum()).toBeLessThanOrEqual(2);
    // The new title is visible even while both new poster requests remain held.
    expect(held.active.size).toBe(2);
    await expect(page.locator('.recommendation-card img')).toHaveCount(0);
  } finally { held.releaseAll(); }
});

test('视口外不请求，滚动后才取海报，真实 blob 图像可解码并在卸载时释放', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLists(page);
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    (window as any).__revokedPosters = [];
    URL.revokeObjectURL = value => { (window as any).__revokedPosters.push(value); original(value); };
  });
  const requested: string[] = [];
  await page.route('**/api/discover/poster?**', route => {
    requested.push(idOf(route.request()));
    return route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.goto('/');
  await expect(page.locator('.recommendation-card')).toHaveCount(12);
  await page.waitForTimeout(100);
  expect(requested).not.toContain('movie-11');
  const last = page.locator('.recommendation-card').last();
  await last.scrollIntoViewIfNeeded();
  await expect.poll(() => requested.includes('movie-11')).toBe(true);
  const image = last.getByRole('img');
  await expect(image).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  const blobUrl = await image.getAttribute('src');
  await page.locator('.main-content').evaluate(main => { main.scrollTop = 0; });
  await page.getByRole('group', { name: '作品分类', exact: true }).getByRole('button', { name: '电视剧', exact: true }).click();
  await expect(page.locator('.title-button').first()).toHaveText('tv作品 0');
  await expect.poll(() => page.evaluate(value => (window as any).__revokedPosters.includes(value), blobUrl)).toBe(true);
});

test('滚出视口会取消未完成海报，重新进入可重试', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLists(page);
  const held = holdPosters(page);
  await page.route('**/api/discover/poster?**', held.handler);
  try {
    await page.goto('/');
    const first = page.locator('.recommendation-card').first();
    await first.scrollIntoViewIfNeeded();
    await expect.poll(() => held.started.includes('movie-0')).toBe(true);
    await page.locator('.recommendation-card').last().scrollIntoViewIfNeeded();
    await expect.poll(() => held.cancelled.includes('movie-0')).toBe(true);
    // Return to the top without exposing the following row, whose held posters
    // could otherwise legitimately take both slots before the first row enters.
    await page.locator('.main-content').evaluate(main => { main.scrollTop = 0; });
    await expect.poll(() => held.started.filter(id => id === 'movie-0').length).toBe(2);
    expect(held.maximum()).toBeLessThanOrEqual(2);
  } finally { held.releaseAll(); }
});

test('认证只随同源 API 海报发送，外部海报保留原生懒加载', async ({ page }) => {
  await allPostersVisible(page);
  await page.addInitScript(() => localStorage.setItem('auth_token', 'poster-test-token'));
  const items = films('auth', 3);
  items[1].poster_url = 'https://image.tmdb.org/t/p/w342/poster-test.jpg';
  await mockLists(page, () => items);
  let localAuthorization = '';
  let externalAuthorization: string | undefined;
  await page.route('**/api/discover/poster?**', route => {
    localAuthorization = route.request().headers().authorization;
    return route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.route('https://image.tmdb.org/**', route => {
    externalAuthorization = route.request().headers().authorization;
    return route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.goto('/');
  const local = page.getByAltText('auth作品 0海报');
  await expect(local).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => local.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(localAuthorization).toBe('Bearer poster-test-token');
  const external = page.getByAltText('auth作品 1海报');
  await external.scrollIntoViewIfNeeded();
  await expect.poll(() => external.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(externalAuthorization).toBeUndefined();
  await expect(external).toHaveAttribute('loading', 'lazy');
  await expect(external).toHaveAttribute('fetchpriority', 'low');
});

test('卡片复用时更换海报源会取消旧请求并显示新图', async ({ page }) => {
  await allPostersVisible(page);
  await mockLists(page);
  await page.unroute('**/api/discover?**');
  await page.route('**/api/discover?**', route => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page')) || 1;
    return route.fulfill({ json: {
      items: [{ ...films('stable', 1)[0], poster_url: poster(`version-${pageNumber}`) }],
      total: 24, page: pageNumber, page_size: 12, has_more: pageNumber === 1, genres: ['剧情']
    } });
  });
  const held = holdPosters(page);
  await page.route('**/api/discover/poster?**', route => idOf(route.request()) === 'version-1'
    ? held.handler(route) : route.fulfill({ contentType: 'image/png', body: png }));
  try {
    await page.goto('/');
    await expect.poll(() => held.started.includes('version-1')).toBe(true);
    await page.locator('.discover-poster').evaluate(el => el.setAttribute('data-reused', 'true'));
    await page.getByRole('button', { name: '换一批', exact: true }).click();
    await expect(page.locator('.discover-poster')).toHaveAttribute('data-reused', 'true');
    await expect.poll(() => held.cancelled.includes('version-1')).toBe(true);
    const image = page.getByAltText('stable作品 0海报');
    await expect(image).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  } finally { held.releaseAll(); }
});

test('没有 IntersectionObserver 时仍能加载，并保持两个请求上限', async ({ page }) => {
  await page.addInitScript(() => { (window as any).IntersectionObserver = undefined; });
  await mockLists(page, () => films('fallback', 3));
  const held = holdPosters(page);
  await page.route('**/api/discover/poster?**', held.handler);
  try {
    await page.goto('/');
    await expect.poll(() => held.started.length).toBe(2);
    expect(held.maximum()).toBeLessThanOrEqual(2);
    held.releaseAll();
    await expect(page.getByAltText('fallback作品 0海报')).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => held.started.length).toBe(3);
    held.releaseAll();
    await expect(page.getByAltText('fallback作品 2海报')).toHaveAttribute('src', /^blob:/);
  } finally { held.releaseAll(); }
});
