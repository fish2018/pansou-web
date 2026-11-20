<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import axios from 'axios';
import { getDiscover, getDiscoverSubject, type DiscoverCategory, type DiscoverCollection, type DiscoverItem, type DiscoverQuery, type DiscoverResponse } from '@/api/discover';
import DiscoverPoster from '@/components/DiscoverPoster.vue';

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const emit = defineEmits<{ (e: 'search', keyword: string): void }>();
const categories: Array<{ value: DiscoverCategory; label: string }> = [
  { value: 'movie', label: '电影' }, { value: 'tv', label: '电视剧' },
  { value: 'animation', label: '动漫' }, { value: 'variety', label: '综艺' },
  { value: 'documentary', label: '纪录片' }
];
const collections: Array<{ value: DiscoverCollection; label: string; description: string }> = [
  { value: 'hot', label: '近期热门', description: '从近期受关注的影视作品中，发现大家正在关注的好故事。' },
  { value: 'top', label: '口碑佳作', description: '按豆瓣评分与评价人数挑选，找一部值得慢慢看的作品。' },
  { value: 'new', label: '新片新剧', description: '按上映、开播时间发现新作品；评分未形成时显示暂无评分。' },
  { value: 'random', label: '随便看看', description: '换一个方向，给下一部好作品留一点偶遇的空间。' },
  { value: 'library', label: '影视片库', description: '浏览已收录的影视作品，按年份、类型和片名缩小范围。' }
];
const PREFERENCE_KEY = 'pansou_discover_preferences';
let saved: Partial<{ category: DiscoverCategory; collection: DiscoverCollection; genre: string }> = {};
try { saved = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || '{}') || {}; } catch {}
const category = ref<DiscoverCategory>(categories.some(item => item.value === saved.category) ? saved.category! : 'movie');
const collection = ref<DiscoverCollection>(collections.some(item => item.value === saved.collection) ? saved.collection! : 'hot');
const genre = ref(collection.value !== 'library' && typeof saved.genre === 'string' ? saved.genre : '');
const isLibrary = computed(() => collection.value === 'library');
const libraryPage = ref(1);
const recommendationPage = ref(1);
const libraryQuery = ref('');
const libraryYear = ref('');
const moreYearsOpen = ref(false);
const queryInput = ref('');
const displayedLibraryFilter = ref({ q: '', genre: '', year: '' });
const data = ref<DiscoverResponse | null>(null);
const loading = ref(false);
const refreshing = ref(false);
const refreshFailed = ref(false);
const error = ref('');
const selected = ref<DiscoverItem | null>(null);
const detailsLoading = ref(false);
const detailsFailed = ref(false);
const dialog = ref<HTMLDialogElement | null>(null);
const LIST_CACHE_TTL = 60_000;
const SUBJECT_CACHE_TTL = 24 * 60 * 60_000;
const cache = new Map<string, { response: DiscoverResponse; expiresAt: number }>();
const subjectCache = new Map<string, { item: DiscoverItem; expiresAt: number }>();
const lastChecked = new Map<string, number>();
let displayedKey = '';
let displayedContext = '';
let pendingData: DiscoverResponse | null = null;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let controller: AbortController | undefined;
let subjectController: AbortController | undefined;
const pageSize = 12;
const requestQuery = computed<DiscoverQuery>(() => {
  if (!isLibrary.value) return {
    page: recommendationPage.value, page_size: pageSize,
    genre: genre.value || undefined
  };
  const range = /^range:(\d{4}):(\d{4})$/.exec(libraryYear.value);
  return {
    page: libraryPage.value, page_size: 24,
    genre: genre.value || undefined,
    ...(range ? { year_from: range[1], year_to: range[2] } : { year: libraryYear.value || undefined }),
    q: libraryQuery.value || undefined
  };
});
const requestKey = computed(() => JSON.stringify([category.value, collection.value, requestQuery.value]));
const displayedPage = computed(() => data.value?.page || 1);
const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / (data.value?.page_size || 24))));
const catalogTotal = computed(() => data.value?.catalog_total ?? data.value?.total ?? 0);
const sourceWarning = computed(() => typeof data.value?.warning === 'string' ? data.value.warning.trim() : '');
const catalogSync = computed(() => data.value?.catalog_sync?.enabled ? data.value.catalog_sync : null);
const catalogSyncLabel = computed(() => {
  const status = catalogSync.value;
  if (!status) return '';
  if (status.stage === 'paused') return '目录同步已暂停';
  if (status.stage === 'error' || status.error) return '同步暂缓，稍后自动重试';
  if (status.stage === 'hydrating') return '正在补充资料';
  if (status.stage === 'updating') return '正在更新目录';
  return ['ready', 'idle', 'complete', 'completed'].includes(status.stage) ? '每日自动更新' : '同步进行中';
});
const countLabel = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0).toLocaleString('zh-CN');
const currentYear = new Date().getUTCFullYear();
const currentDecade = Math.floor(currentYear / 10) * 10;
const availableYears = computed(() => [...new Set((Array.isArray(data.value?.years) ? data.value.years : [])
  .filter(value => typeof value === 'string' && /^\d{4}$/.test(value) && Number(value) >= 1800 && Number(value) <= currentYear))]
  .sort((left, right) => Number(right) - Number(left)));
const recentYears = computed(() => availableYears.value.filter(year => Number(year) >= currentDecade));
const yearRanges = computed(() => {
  const ranges: Array<{ value: string; label: string }> = [];
  for (let start = currentDecade - 10; start >= 1980; start -= 10) {
    const end = start + 9;
    if (availableYears.value.some(year => Number(year) >= start && Number(year) <= end)) {
      ranges.push({ value: `range:${start}:${end}`, label: start < 2000 ? `${start % 100}年代` : `${start}–${end}` });
    }
  }
  if (availableYears.value.some(year => Number(year) < 1980)) ranges.push({ value: 'range:1800:1979', label: '更早' });
  return ranges;
});
const yearGroups = computed(() => {
  const groups = new Map<number, string[]>();
  for (const year of availableYears.value) {
    const decade = Math.floor(Number(year) / 10) * 10;
    if (!groups.has(decade)) groups.set(decade, []);
    groups.get(decade)!.push(year);
  }
  return [...groups].map(([decade, years]) => ({ label: `${decade}年代`, years }));
});
const selectedExtraYear = computed(() => libraryYear.value === 'unknown' ? '年份待补充'
  : /^\d{4}$/.test(libraryYear.value) && !recentYears.value.includes(libraryYear.value) ? libraryYear.value : '');
const availableGenres = computed(() => Array.isArray(data.value?.genres)
  ? data.value.genres.filter(value => typeof value === 'string' && value.trim()) : []);
const visibleItems = computed(() => data.value?.items || []);
const currentCollection = computed(() => collections.find(item => item.value === collection.value)!);
const updatedLabel = computed(() => {
  const value = data.value?.updated_at;
  if (!value) return '';
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
});
const hasTMDBMetadata = computed(() => data.value?.tmdb_configured === true
  || selected.value?.metadata_source === 'tmdb'
  || visibleItems.value.some(item => item.metadata_source === 'tmdb'));

const applyData = (response: DiscoverResponse) => {
  data.value = response;
  if (isLibrary.value) displayedLibraryFilter.value = { q: libraryQuery.value, genre: genre.value, year: libraryYear.value };
  const requestedPage = isLibrary.value ? libraryPage : recommendationPage;
  if (Number.isInteger(response.page) && response.page! > 0 && requestedPage.value !== response.page) {
    // 片单缩小时沿用服务端修正后的页码，后续轮询也检查正在显示的这一批。
    requestedPage.value = response.page!;
    displayedKey = requestKey.value;
    cache.set(displayedKey, { response, expiresAt: Date.now() + LIST_CACHE_TTL });
    lastChecked.set(displayedKey, Date.now());
  }
  if (genre.value && !availableGenres.value.includes(genre.value)) genre.value = '';
};

const load = async (refresh = false, background = false) => {
  if (background && refreshing.value) return;
  controller?.abort();
  const key = requestKey.value;
  const context = `${category.value}:${collection.value}`;
  const sameContext = displayedContext === context;
  const changedSelection = displayedKey !== key;
  const cached = cache.get(key);
  if (changedSelection) {
    pendingData = null;
    displayedKey = key;
    if (cached) applyData(cached.response);
    else if (!sameContext) data.value = null;
    displayedContext = context;
  }
  error.value = '';
  refreshFailed.value = false;
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    loading.value = false;
    refreshing.value = false;
    return;
  }
  // 已有片单继续显示，慢请求或临时失败不打断浏览。
  loading.value = !data.value;
  refreshing.value = true;
  lastChecked.set(key, Date.now());
  controller = new AbortController();
  const signal = controller.signal;
  try {
    const response = await getDiscover(category.value, collection.value, signal, requestQuery.value);
    if (signal.aborted) return;
    cache.set(key, { response, expiresAt: Date.now() + LIST_CACHE_TTL });
    if (background && dialog.value?.open && data.value) {
      // 详情打开时保留背后的卡片顺序；评分与真实更新时间仍可更新。
      pendingData = response;
      const latest = new Map(response.items.map(item => [item.id, item]));
      data.value = { ...response, items: data.value.items.map(item => latest.get(item.id) || item) };
    } else {
      pendingData = null;
      applyData(response);
    }
  } catch (cause) {
    if (signal.aborted || axios.isCancel(cause)) return;
    if (data.value) refreshFailed.value = true;
    else error.value = '推荐暂时未能加载，请稍后重试。你也可以直接在上方搜索。';
  } finally {
    if (!signal.aborted) loading.value = refreshing.value = false;
  }
};

const checkForUpdates = () => {
  if (!props.active || document.visibilityState !== 'visible' || refreshing.value) return;
  const key = requestKey.value;
  if (Date.now() - (lastChecked.get(key) || 0) < LIST_CACHE_TTL) return;
  void load(true, true);
};

watch([category, collection], (_, previous) => {
  libraryPage.value = 1;
  recommendationPage.value = 1;
  libraryQuery.value = queryInput.value = '';
  libraryYear.value = '';
  moreYearsOpen.value = false;
  if (isLibrary.value || previous?.[1] === 'library') genre.value = '';
}, { flush: 'sync' });
watch(requestKey, () => { void load(); }, { immediate: true });
watch(() => props.active, active => { if (active) checkForUpdates(); });
watch([category, collection, genre], () => {
  try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ category: category.value, collection: collection.value, genre: isLibrary.value ? '' : genre.value })); } catch {}
});
watch(genre, () => { recommendationPage.value = libraryPage.value = 1; }, { flush: 'sync' });
watch(libraryYear, () => { libraryPage.value = 1; }, { flush: 'sync' });

const submitLibrarySearch = () => {
  const query = queryInput.value.trim();
  if (libraryQuery.value === query && libraryPage.value === 1) { void load(true); return; }
  libraryPage.value = 1;
  libraryQuery.value = query;
};
const clearLibrarySearch = () => { queryInput.value = ''; submitLibrarySearch(); };
const goToPage = (page: number) => {
  if (refreshing.value || page < 1) return;
  if (libraryPage.value === page) { void load(true); return; }
  libraryPage.value = page;
};

const nextBatch = () => {
  if (refreshing.value) return;
  if (collection.value === 'random') { void load(true); return; }
  const nextPage = data.value?.has_more ? displayedPage.value + 1 : 1;
  if (recommendationPage.value === nextPage) { void load(true); return; }
  recommendationPage.value = nextPage;
};

const rating = (item: DiscoverItem) => typeof item.douban_rating === 'number'
  && Number.isFinite(item.douban_rating) && item.douban_rating > 0 && item.douban_rating <= 10
  && item.douban_votes !== 0 ? item.douban_rating.toFixed(1) : null;
const votes = (item: DiscoverItem) => typeof item.douban_votes === 'number' && item.douban_votes > 0
  ? new Intl.NumberFormat('zh-CN').format(item.douban_votes) : '';
const genres = (item: DiscoverItem) => Array.isArray(item.genres) ? item.genres.filter(value => typeof value === 'string') : [];
const yearLabel = (item: DiscoverItem) => {
  const year = String(item.year ?? '').trim();
  return /^\d{4}$/.test(year) && Number(year) > 0 ? `${year} 年` : '年份待补充';
};
const doubanUrl = (item: DiscoverItem) => {
  try {
    const url = new URL(item.douban_url || '');
    return url.protocol === 'https:' && (url.hostname === 'douban.com' || url.hostname.endsWith('.douban.com')) ? url.href : '';
  } catch { return ''; }
};

const mergeSubject = (item: DiscoverItem, subject: DiscoverItem): DiscoverItem => ({
  ...item, ...subject,
  // 服务端详情也可能来自旧缓存；片单已有评分优先，详情只补缺失值。
  douban_rating: item.douban_rating ?? subject.douban_rating,
  douban_votes: item.douban_votes ?? subject.douban_votes
});

const showDetails = async (item: DiscoverItem) => {
  subjectController?.abort();
  detailsFailed.value = false;
  detailsLoading.value = false;
  selected.value = item;
  await nextTick();
  dialog.value?.showModal();
  if (item.details_cached === true) return;
  const id = String(item.id);
  const tmdb = /^tmdb:(movie|tv):[1-9]\d*$/.exec(id);
  if (!/^\d+$/.test(id) && !tmdb) return;
  const mediaType = tmdb ? tmdb[1] as 'movie' | 'tv' : item.media_type || (category.value === 'movie' ? 'movie' : 'tv');
  const key = `${mediaType}:${id}`;
  const cached = subjectCache.get(key);
  if (cached) {
    selected.value = mergeSubject(item, cached.item);
    if (cached.expiresAt > Date.now()) return;
  }
  subjectController = new AbortController();
  const signal = subjectController.signal;
  detailsLoading.value = true;
  try {
    const subject = await getDiscoverSubject(id, mediaType, signal);
    if (signal.aborted) return;
    const pendingDetails = subject.details_cached === false
      || (data.value?.tmdb_configured === true && subject.metadata_source !== 'tmdb');
    const ttl = pendingDetails ? 5_000 : SUBJECT_CACHE_TTL;
    subjectCache.set(key, { item: subject, expiresAt: Date.now() + ttl });
    selected.value = mergeSubject(item, subject);
  } catch {
    if (!signal.aborted) detailsFailed.value = true;
  } finally { if (!signal.aborted) detailsLoading.value = false; }
};
const closeDetails = () => dialog.value?.close();
const handleDetailsClose = () => {
  subjectController?.abort();
  selected.value = null;
  detailsLoading.value = false;
  if (pendingData) {
    applyData(pendingData);
    pendingData = null;
  }
};
const searchFor = (keyword: string) => {
  closeDetails();
  emit('search', keyword);
};
onMounted(() => {
  refreshTimer = setInterval(checkForUpdates, LIST_CACHE_TTL);
  document.addEventListener('visibilitychange', checkForUpdates);
  window.addEventListener('focus', checkForUpdates);
});
onUnmounted(() => {
  clearInterval(refreshTimer);
  document.removeEventListener('visibilitychange', checkForUpdates);
  window.removeEventListener('focus', checkForUpdates);
  controller?.abort();
  subjectController?.abort();
  closeDetails();
});
</script>

<template>
  <section class="discover" aria-labelledby="discover-heading">
    <header class="discover-heading">
      <div>
        <span class="discover-eyebrow"><span aria-hidden="true">✦</span> 给观影一点灵感</span>
        <h2 id="discover-heading">发现下一部好作品</h2>
        <p>电影、剧集、动漫、综艺与纪录片，选好再搜。</p>
      </div>
      <span class="rating-source"><span aria-hidden="true">豆</span> 豆瓣评分参考</span>
    </header>

    <div class="discover-filters">
      <div class="category-tabs" role="group" aria-label="作品分类">
        <button v-for="item in categories" :key="item.value" type="button" :aria-pressed="category === item.value" :class="{ active: category === item.value }" @click="category = item.value">{{ item.label }}</button>
      </div>
      <div class="collection-tabs" role="group" aria-label="推荐栏目">
        <button v-for="item in collections" :key="item.value" type="button" :aria-pressed="collection === item.value" :class="{ active: collection === item.value }" @click="collection = item.value">{{ item.label }}</button>
      </div>
    </div>

    <div class="catalog-filters" :class="{ 'library-filters': isLibrary }">
      <div v-if="availableGenres.length" class="genre-filter" role="group" aria-label="作品类型">
        <span class="genre-label">类型</span>
        <div class="genre-options"><button type="button" :aria-pressed="!genre" :class="{ active: !genre }" @click="genre = ''">全部</button><button v-for="value in availableGenres" :key="value" type="button" :aria-pressed="genre === value" :class="{ active: genre === value }" @click="genre = value">{{ value }}</button></div>
      </div>
      <div v-if="isLibrary" class="library-year-filter" role="group" aria-label="作品年份">
        <span class="genre-label">年份</span>
        <div class="year-filter-body">
          <div class="year-options">
            <button type="button" :aria-pressed="!libraryYear" :class="{ active: !libraryYear }" @click="libraryYear = ''">全部</button>
            <button v-for="year in recentYears" :key="year" type="button" :aria-pressed="libraryYear === year" :class="{ active: libraryYear === year }" @click="libraryYear = year">{{ year }}</button>
            <button v-for="range in yearRanges" :key="range.value" type="button" :aria-pressed="libraryYear === range.value" :class="{ active: libraryYear === range.value }" @click="libraryYear = range.value">{{ range.label }}</button>
            <button v-if="selectedExtraYear" type="button" aria-pressed="true" class="active selected-extra-year" @click="moreYearsOpen = true">{{ selectedExtraYear }}</button>
            <button type="button" class="more-years-button" :aria-expanded="moreYearsOpen" aria-controls="library-more-years" @click="moreYearsOpen = !moreYearsOpen">{{ moreYearsOpen ? '收起年份' : '更多年份' }}<svg :class="{ expanded: moreYearsOpen }" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
          </div>
          <div v-if="moreYearsOpen" id="library-more-years" class="more-years-panel" role="group" aria-label="全部年份">
            <div v-for="group in yearGroups" :key="group.label" class="year-decade-group" role="group" :aria-label="group.label">
              <span class="year-decade-label">{{ group.label }}</span>
              <div class="year-options"><button v-for="year in group.years" :key="year" type="button" :aria-pressed="libraryYear === year" :class="{ active: libraryYear === year }" @click="libraryYear = year">{{ year }}</button></div>
            </div>
            <div class="year-decade-group"><span class="year-decade-label">其他</span><div class="year-options"><button type="button" :aria-pressed="libraryYear === 'unknown'" :class="{ active: libraryYear === 'unknown' }" @click="libraryYear = 'unknown'">年份待补充</button></div></div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="isLibrary" class="library-toolbar">
      <form class="library-search" role="search" aria-label="片库内查找" @submit.prevent="submitLibrarySearch">
        <label for="library-query" class="sr-only">片库片名</label>
        <input id="library-query" v-model="queryInput" type="search" placeholder="输入中文名或原名，在片库中查找" autocomplete="off" />
        <button type="submit" class="library-search-submit" :disabled="refreshing">查找片库</button>
        <button v-if="queryInput || libraryQuery" type="button" class="library-clear" @click="clearLibrarySearch">清空</button>
      </form>
      <p class="library-search-hint">查找作品信息后，点击卡片上的「搜索资源」查找网盘资源。</p>
      <p v-if="catalogSync" class="library-search-hint">输入 3 字及以上可匹配片名任意位置，短关键词按片名开头匹配。</p>
      <p v-if="data" class="catalog-summary" aria-live="polite">
        <span>当前分类已收录 <strong>{{ catalogTotal.toLocaleString('zh-CN') }}</strong> 部</span>
        <span v-if="displayedLibraryFilter.q || displayedLibraryFilter.genre || displayedLibraryFilter.year"> · 找到 {{ (data.total || 0).toLocaleString('zh-CN') }} 部</span>
        <span v-if="data.indexing"> · 片库持续补充中</span>
      </p>
    </div>

    <div class="discover-subheading">
      <div><p>{{ currentCollection.description }}</p><p v-if="data && !isLibrary" class="pool-size">本栏 {{ (data.total || 0).toLocaleString('zh-CN') }} 部 · 每批 {{ pageSize }} 部</p></div>
      <nav v-if="isLibrary && data && (data.total || 0) > 0" class="library-pagination" aria-label="片库分页（顶部）">
        <button type="button" :disabled="refreshing || displayedPage <= 1" @click="goToPage(displayedPage - 1)">上一页</button>
        <span>第 {{ displayedPage }} / {{ totalPages }} 页</span>
        <button type="button" :disabled="refreshing || !data.has_more" @click="goToPage(displayedPage + 1)">下一页</button>
      </nav>
      <button v-else-if="!isLibrary" class="batch-button" type="button" :disabled="refreshing" @click="nextBatch"><svg :class="{ spinning: refreshing }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17" stroke-linecap="round"/></svg>换一批</button>
    </div>

    <p v-if="sourceWarning" class="source-warning" role="status">{{ sourceWarning }}</p>

    <div v-if="loading" class="recommendation-grid" aria-label="正在加载推荐" aria-busy="true">
      <div v-for="index in (isLibrary ? 24 : pageSize)" :key="index" class="recommendation-skeleton" aria-hidden="true"><div class="skeleton-poster"/><div class="skeleton-line"/><div class="skeleton-line short"/></div>
    </div>
    <div v-else-if="error" class="discover-empty" role="status">
      <span class="empty-symbol" aria-hidden="true">◌</span><h3>片单稍后就来</h3><p>{{ error }}</p>
      <button class="secondary-button" type="button" @click="load(true)">重试加载推荐</button>
    </div>
    <div v-else-if="!visibleItems.length" class="discover-empty" role="status">
      <span class="empty-symbol" aria-hidden="true">◌</span><h3>{{ isLibrary ? '未找到匹配的已收录作品' : '这个片单暂时没有作品' }}</h3><p>{{ isLibrary ? '试试其他片名、年份、类型或分类。片库仍在补充，暂未匹配不代表没有这部作品。' : '试试其他分类或栏目，也可以直接搜索片名。' }}</p>
      <button class="secondary-button" type="button" @click="load(true)">重新加载</button>
    </div>
    <div v-else class="recommendation-grid">
      <article v-for="(item, index) in visibleItems" :key="item.id || `${item.title}-${index}`" class="recommendation-card">
        <button type="button" class="poster-button" :aria-label="`查看《${item.title}》详情`" @click="showDetails(item)">
          <DiscoverPoster :src="item.poster_url" :title="item.title" />
          <span class="poster-shade" aria-hidden="true"/>
          <span class="recommendation-reason">{{ item.reason || currentCollection.label }}</span>
          <span v-if="rating(item)" class="poster-rating"><span aria-hidden="true">★</span> {{ rating(item) }}</span>
        </button>
        <div class="card-body">
          <button type="button" class="title-button" @click="showDetails(item)"><h3 :title="item.title">{{ item.title }}</h3></button>
          <p class="card-meta"><span class="card-year">{{ yearLabel(item) }}</span><span v-if="genres(item).length"> · {{ genres(item).slice(0, 2).join(' / ') }}</span></p>
          <p class="card-rating" :class="{ unrated: !rating(item) }"><span>{{ rating(item) ? `豆瓣 ${rating(item)}` : '暂无评分' }}</span><span v-if="rating(item) && votes(item)" class="card-votes">{{ votes(item) }} 人评价</span></p>
          <p class="card-overview">{{ item.overview || '查看作品详情，或直接搜索资源。' }}</p>
          <button type="button" class="search-resource" :aria-label="`搜索《${item.title}》资源`" @click="searchFor(item.title)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4" stroke-linecap="round"/></svg>搜索资源</button>
        </div>
      </article>
    </div>

    <nav v-if="isLibrary && data && (data.total || 0) > 0" class="library-pagination library-pagination-bottom" aria-label="片库分页（底部）">
      <button type="button" :disabled="refreshing || displayedPage <= 1" @click="goToPage(displayedPage - 1)">上一页</button>
      <span>第 {{ displayedPage }} / {{ totalPages }} 页</span>
      <button type="button" :disabled="refreshing || !data.has_more" @click="goToPage(displayedPage + 1)">下一页</button>
    </nav>

    <footer v-if="data && (visibleItems.length || (isLibrary && catalogSync))" class="discover-footer">
      <span>评分来自豆瓣，未评分作品显示「暂无评分」。推荐作品的资源需搜索后确认。</span>
      <span v-if="isLibrary && catalogSync" class="catalog-sync-status" aria-live="polite">影视目录已收录 {{ countLabel(catalogSync.indexed) }} 部 · 资料已补齐 {{ countLabel(catalogSync.hydrated) }} 部 · {{ catalogSyncLabel }}</span>
      <span v-if="updatedLabel">片单更新于 {{ updatedLabel }}{{ data.stale ? ' · 使用最近可用片单' : '' }}</span>
      <span class="refresh-status">{{ refreshing ? '正在检查片单更新…' : refreshFailed ? '暂未更新，继续显示当前片单；稍后自动重试。' : '浏览时每分钟检查更新，片单按来源定期刷新。' }}</span>
      <p v-if="hasTMDBMetadata" class="tmdb-attribution"><a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" aria-label="TMDB 官网"><img src="/tmdb-logo.svg" alt="TMDB" width="80" height="11" /></a><span>部分海报与资料来自 TMDB。This product uses the TMDB API but is not endorsed or certified by TMDB.</span></p>
    </footer>

    <dialog ref="dialog" class="discover-detail-dialog" aria-labelledby="discover-detail-title" @click="($event.target === $event.currentTarget) && closeDetails()" @close="handleDetailsClose">
      <div v-if="selected" class="detail-content">
        <button type="button" class="detail-close" aria-label="关闭作品详情" autofocus @click="closeDetails">×</button>
        <div class="detail-poster"><DiscoverPoster :src="selected.poster_url" :title="selected.title" /></div>
        <div class="detail-info">
          <span class="discover-eyebrow">{{ selected.reason || currentCollection.label }}</span>
          <h2 id="discover-detail-title">{{ selected.title }}</h2>
          <p v-if="selected.original_title && selected.original_title !== selected.title" class="original-title">{{ selected.original_title }}</p>
          <p class="detail-meta">{{ yearLabel(selected) }}<span v-if="genres(selected).length"> · {{ genres(selected).join(' / ') }}</span></p>
          <p class="detail-rating"><span v-if="rating(selected)" class="rating-number">{{ rating(selected) }}</span><span>{{ rating(selected) ? '豆瓣评分' : '暂无评分' }}</span><span v-if="rating(selected) && votes(selected)" class="detail-votes">{{ votes(selected) }} 人评价</span></p>
          <p class="detail-overview">{{ selected.overview || '暂无作品简介。' }}</p>
          <p v-if="detailsLoading" class="detail-status" role="status">正在加载作品详情…</p>
          <p v-else-if="detailsFailed" class="detail-status">完整资料暂不可用，你仍可以搜索资源{{ doubanUrl(selected) ? '或前往豆瓣查看' : '' }}。</p>
          <p class="metadata-source">作品资料：{{ selected.metadata_source === 'tmdb' ? 'TMDB' : '豆瓣' }}<a v-if="doubanUrl(selected)" :href="doubanUrl(selected)" target="_blank" rel="noopener noreferrer">在豆瓣查看 ↗</a></p>
          <div class="detail-actions"><button type="button" class="search-resource" @click="searchFor(selected.title)">搜索资源</button><button v-if="selected.original_title && selected.original_title !== selected.title" type="button" class="secondary-button" @click="searchFor(selected.original_title)">用原名搜索</button></div>
        </div>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.discover { max-width: 1200px; margin: 0 auto; padding: 0.75rem 0 1.5rem; }
.source-warning { margin-bottom: 1rem; padding: 0.75rem 1rem; border-radius: 0.5rem; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); font-size: 0.8125rem; line-height: 1.6; }
.discover-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.75rem; }
.discover-eyebrow { display: inline-flex; align-items: center; gap: 0.4rem; color: hsl(var(--primary)); font-size: 0.75rem; letter-spacing: 0.08em; font-weight: 600; }
.discover-eyebrow > span { font-size: 1rem; }
.discover-heading h2 { margin: 0.4rem 0 0.45rem; font-size: 1.8rem; line-height: 1.3; font-weight: 700; letter-spacing: -0.04em; }
.discover-heading p { color: hsl(var(--muted-foreground)); font-size: 0.875rem; }
.rating-source { display: flex; align-items: center; gap: 0.45rem; font-size: 0.75rem; color: hsl(var(--muted-foreground)); white-space: nowrap; }
.rating-source > span { display: grid; place-items: center; width: 1.5rem; height: 1.5rem; color: #fff; background: #25864a; border-radius: 0.4rem; font-size: 0.875rem; font-weight: 600; }
.discover-filters { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid hsl(var(--border)); }
.category-tabs { display: flex; gap: 0.25rem; padding: 0.25rem; min-width: 0; overflow-x: auto; border-radius: 0.65rem; background: hsl(var(--muted)); scrollbar-width: thin; }
.category-tabs button { padding: 0.5rem 1rem; border-radius: 0.45rem; font-size: 0.875rem; color: hsl(var(--muted-foreground)); white-space: nowrap; transition: background 0.15s, color 0.15s; }
.category-tabs button.active { background: hsl(var(--card)); color: hsl(var(--foreground)); box-shadow: 0 1px 4px #0000000c; font-weight: 600; }
.collection-tabs { display: flex; gap: 0.4rem; min-width: 0; max-width: 100%; overflow-x: auto; padding: 0.2rem; scrollbar-width: thin; }
.collection-tabs button { flex-shrink: 0; padding: 0.5rem 0.8rem; border-radius: 999px; color: hsl(var(--muted-foreground)); font-size: 0.8125rem; white-space: nowrap; }
.collection-tabs button.active { background: hsl(var(--primary) / 0.09); color: hsl(var(--primary)); font-weight: 600; }
.collection-tabs button:hover:not(.active), .category-tabs button:hover:not(.active) { color: hsl(var(--foreground)); }
.genre-filter { display: flex; align-items: center; gap: 0.7rem; margin-top: 1rem; min-width: 0; font-size: 0.75rem; }
.genre-label { color: hsl(var(--muted-foreground)); flex-shrink: 0; }
.genre-options { display: flex; gap: 0.3rem; min-width: 0; overflow-x: auto; padding: 0.25rem; scrollbar-width: thin; }
.genre-options button { padding: 0.25rem 0.6rem; border-radius: 0.35rem; white-space: nowrap; color: hsl(var(--muted-foreground)); }
.genre-options button.active { color: hsl(var(--primary)); background: hsl(var(--primary) / 0.08); }
.library-filters { display: grid; gap: 0.35rem; margin-top: 0.8rem; }
.library-filters .genre-filter { margin-top: 0; align-items: flex-start; }
.library-filters .genre-label { padding-top: 0.65rem; }
.library-filters .genre-options { flex-wrap: wrap; overflow: visible; }
.library-filters .genre-options button { min-height: 2rem; }
.discover-subheading { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin: 1rem 0 1.25rem; }
.discover-subheading p { color: hsl(var(--muted-foreground)); font-size: 0.75rem; line-height: 1.6; }
.discover-subheading .pool-size { margin-top: 0.25rem; font-size: 0.6875rem; }
.library-toolbar { margin-top: 1rem; }
.library-search { display: flex; gap: 0.5rem; max-width: 650px; }
.library-search input { min-width: 0; flex: 1; height: 2.5rem; padding: 0.5rem 0.75rem; border: 1px solid hsl(var(--border)); border-radius: 0.45rem; background: hsl(var(--card)); font-size: 0.8125rem; }
.library-search-submit { flex-shrink: 0; padding: 0.5rem 0.85rem; border-radius: 0.45rem; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); font-size: 0.8125rem; }
.library-search-submit:disabled { opacity: 0.5; }
.library-clear { flex-shrink: 0; padding: 0.5rem 0.25rem; color: hsl(var(--muted-foreground)); font-size: 0.8125rem; }
.library-search-hint { margin-top: 0.5rem; color: hsl(var(--muted-foreground)); font-size: 0.6875rem; line-height: 1.6; }
.library-year-filter { display: flex; align-items: flex-start; gap: 0.7rem; min-width: 0; font-size: 0.75rem; }
.year-filter-body { flex: 1; min-width: 0; }
.year-options { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; min-width: 0; padding: 0.25rem; }
.year-options button { display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem; min-width: 2.75rem; min-height: 2rem; padding: 0.3rem 0.6rem; border-radius: 0.35rem; color: hsl(var(--muted-foreground)); white-space: nowrap; font-variant-numeric: tabular-nums; }
.year-options button:hover:not(.active), .library-filters .genre-options button:hover:not(.active) { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
.year-options button.active { background: hsl(var(--primary) / 0.09); color: hsl(var(--primary)); font-weight: 600; }
.year-options .more-years-button { color: hsl(var(--foreground) / 0.75); }
.more-years-button svg { width: 0.85rem; height: 0.85rem; transition: transform 0.15s; }
.more-years-button svg.expanded { transform: rotate(180deg); }
.more-years-panel { display: grid; gap: 0.35rem; max-height: 20rem; margin: 0.4rem 0.25rem 0; padding: 0.55rem 0.65rem; overflow-y: auto; overscroll-behavior: contain; border: 1px solid hsl(var(--border)); border-radius: 0.55rem; background: hsl(var(--muted) / 0.35); }
.year-decade-group { display: flex; align-items: flex-start; gap: 0.65rem; min-width: 0; }
.year-decade-label { flex: 0 0 4.5rem; padding-top: 0.75rem; color: hsl(var(--muted-foreground)); font-size: 0.6875rem; }
.year-decade-group .year-options { flex: 1; }
.catalog-summary { margin-top: 0.85rem; font-size: 0.8125rem; line-height: 1.7; color: hsl(var(--muted-foreground)); }
.catalog-summary strong { color: hsl(var(--foreground)); font-weight: 600; }
.library-pagination { display: flex; align-items: center; justify-content: center; gap: 0.6rem; flex-shrink: 0; font-size: 0.75rem; white-space: nowrap; }
.library-pagination button { padding: 0.4rem 0.65rem; border: 1px solid hsl(var(--border)); border-radius: 0.4rem; background: hsl(var(--card)); }
.library-pagination button:disabled { opacity: 0.4; cursor: default; }
.library-pagination button:hover:enabled { border-color: hsl(var(--primary) / 0.4); color: hsl(var(--primary)); }
.library-pagination span { color: hsl(var(--muted-foreground)); }
.library-pagination-bottom { margin-top: 1.5rem; }
.batch-button { display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0; color: hsl(var(--primary)); font-size: 0.8125rem; padding: 0.4rem 0; }
.batch-button svg { width: 1rem; height: 1rem; }
.batch-button:disabled { opacity: 0.5; cursor: wait; }
.recommendation-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1.5rem 1.1rem; }
.recommendation-card { min-width: 0; background: hsl(var(--card)); border: 1px solid hsl(var(--border) / 0.7); border-radius: 0.75rem; overflow: hidden; transition: box-shadow 0.18s, border-color 0.18s; }
.recommendation-card:hover { box-shadow: 0 6px 20px #0000000a; border-color: hsl(var(--primary) / 0.3); }
.poster-button { display: block; width: 100%; aspect-ratio: 2 / 3; position: relative; overflow: hidden; text-align: left; }
.poster-button :deep(img) { transition: transform 0.3s; }
.poster-button:hover :deep(img) { transform: scale(1.035); }
.poster-shade { position: absolute; inset: 50% 0 0; background: linear-gradient(transparent, #0009); pointer-events: none; }
.recommendation-reason { position: absolute; bottom: 0.7rem; left: 0.65rem; right: 2.8rem; color: #fff; font-size: 0.6875rem; line-height: 1.5; text-shadow: 0 1px 4px #0006; }
.poster-rating { position: absolute; top: 0.6rem; right: 0.6rem; display: flex; align-items: center; gap: 0.2rem; padding: 0.15rem 0.4rem; border-radius: 0.35rem; background: #141820d9; color: #ffda75; font-size: 0.75rem; font-weight: 700; backdrop-filter: blur(5px); }
.poster-rating > span { font-size: 0.65rem; }
.card-body { padding: 0.75rem; }
.title-button { width: 100%; text-align: left; }
.title-button h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.875rem; line-height: 1.5; font-weight: 600; }
.title-button:hover { color: hsl(var(--primary)); }
.card-meta { margin-top: 0.25rem; min-height: 1.1rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: hsl(var(--muted-foreground)); font-size: 0.6875rem; }
.card-year { color: hsl(var(--foreground) / 0.8); font-weight: 500; }
.card-rating { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2rem 0.4rem; min-height: 1.2rem; margin-top: 0.5rem; font-size: 0.6875rem; color: #26864b; }
.card-rating.unrated { color: hsl(var(--muted-foreground)); }
.card-votes { color: hsl(var(--muted-foreground)); font-size: 0.625rem; }
.card-overview { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; height: 2.1rem; margin: 0.45rem 0 0.85rem; font-size: 0.6875rem; line-height: 1.05rem; color: hsl(var(--muted-foreground)); }
.search-resource { display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; width: 100%; min-height: 2rem; padding: 0.4rem 0.7rem; border: 1px solid hsl(var(--primary) / 0.18); border-radius: 0.4rem; background: hsl(var(--primary) / 0.055); color: hsl(var(--primary)); font-size: 0.75rem; font-weight: 500; transition: background 0.15s; }
.search-resource:hover { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
.search-resource svg { width: 0.9rem; height: 0.9rem; }
.discover-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem 1rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid hsl(var(--border)); color: hsl(var(--muted-foreground)); font-size: 0.6875rem; line-height: 1.7; }
.tmdb-attribution { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; flex-basis: 100%; }
.tmdb-attribution img { display: block; }
.recommendation-skeleton { overflow: hidden; }
.skeleton-poster { aspect-ratio: 2 / 3; border-radius: 0.75rem; background: hsl(var(--muted)); animation: pulse 1.5s ease-in-out infinite; }
.skeleton-line { height: 0.8rem; width: 80%; margin: 0.8rem 0; border-radius: 0.25rem; background: hsl(var(--muted)); }
.skeleton-line.short { width: 50%; }
.discover-empty { min-height: 20rem; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; text-align: center; }
.empty-symbol { font-size: 3rem; color: hsl(var(--primary) / 0.6); }
.discover-empty h3 { font-size: 1rem; font-weight: 600; margin: 0.5rem 0; }
.discover-empty p { font-size: 0.8125rem; color: hsl(var(--muted-foreground)); line-height: 1.7; margin-bottom: 1rem; }
.secondary-button { display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1rem; min-height: 2rem; border: 1px solid hsl(var(--border)); border-radius: 0.4rem; font-size: 0.75rem; }
.secondary-button:hover { background: hsl(var(--muted)); }
button:focus-visible, a:focus-visible { outline: 2px solid hsl(var(--primary)); outline-offset: 3px; }
.discover-detail-dialog { width: min(760px, calc(100vw - 2rem)); max-height: calc(100dvh - 3rem); padding: 0; border: 1px solid hsl(var(--border)); border-radius: 1rem; background: hsl(var(--card)); color: hsl(var(--foreground)); box-shadow: 0 20px 70px #0003; }
.discover-detail-dialog::backdrop { background: #0f172a99; backdrop-filter: blur(3px); }
.detail-content { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 1.75rem; padding: 2rem; position: relative; }
.detail-close { position: absolute; right: 0.7rem; top: 0.5rem; display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; color: hsl(var(--muted-foreground)); font-size: 1.6rem; line-height: 1; }
.detail-close:hover { background: hsl(var(--muted)); }
.detail-poster { aspect-ratio: 2 / 3; align-self: start; overflow: hidden; border-radius: 0.65rem; }
.detail-info { min-width: 0; padding-top: 0.5rem; }
.detail-info h2 { margin: 0.5rem 0 0.4rem; font-size: 1.6rem; line-height: 1.35; font-weight: 700; }
.original-title { color: hsl(var(--muted-foreground)); font-size: 0.875rem; }
.detail-meta { margin-top: 0.7rem; font-size: 0.8125rem; color: hsl(var(--muted-foreground)); }
.detail-rating { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem; font-size: 0.75rem; color: hsl(var(--muted-foreground)); }
.rating-number { color: #26864b; font-size: 1.8rem; line-height: 1; font-weight: 700; }
.detail-votes { font-size: 0.6875rem; }
.detail-overview { margin: 1.25rem 0; font-size: 0.875rem; line-height: 1.9; white-space: pre-line; overflow-wrap: anywhere; }
.detail-status { margin-bottom: 0.75rem; font-size: 0.75rem; color: hsl(var(--muted-foreground)); }
.metadata-source { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; font-size: 0.6875rem; color: hsl(var(--muted-foreground)); }
.metadata-source a { color: hsl(var(--primary)); }
.detail-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1.25rem; }
.detail-actions .search-resource { width: auto; padding-left: 1.25rem; padding-right: 1.25rem; }
@keyframes pulse { 50% { opacity: 0.5; } }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1100px) { .recommendation-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 768px) {
  .discover { padding-top: 0; }
  .discover-heading { align-items: flex-start; margin-bottom: 1.25rem; }
  .discover-heading h2 { font-size: 1.5rem; }
  .discover-heading p { font-size: 0.75rem; }
  .rating-source { font-size: 0; gap: 0; padding-top: 1.4rem; }
  .discover-filters { flex-direction: column; align-items: stretch; gap: 0.8rem; padding-bottom: 0.8rem; }
  .category-tabs button { flex: 1 0 auto; padding: 0.5rem 0.4rem; }
  .collection-tabs { justify-content: space-between; gap: 0.15rem; }
  .collection-tabs button { padding: 0.45rem 0.6rem; font-size: 0.75rem; }
  .library-filters .genre-options button, .year-options button { min-height: 2.75rem; }
  .library-filters .genre-label { padding-top: 1rem; }
  .more-years-panel { padding: 0.4rem; }
  .year-decade-group { gap: 0.3rem; }
  .year-decade-label { flex-basis: 4rem; padding-top: 1.1rem; }
  .discover-subheading { margin: 0.8rem 0 1rem; align-items: flex-start; }
  .discover-subheading:has(.library-pagination) { flex-direction: column; gap: 0.65rem; }
  .discover-subheading .library-pagination { align-self: stretch; }
  .discover-subheading p { max-width: 80%; font-size: 0.6875rem; }
  .recommendation-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem 0.75rem; }
  .card-body { padding: 0.6rem; }
  .card-votes { flex-basis: 100%; }
  .detail-content { grid-template-columns: 140px minmax(0, 1fr); gap: 1.1rem; padding: 2rem 1.25rem 1.25rem; }
  .detail-info h2 { font-size: 1.25rem; }
}
@media (max-width: 480px) {
  .recommendation-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .card-body { padding: 0.7rem; }
  .card-votes { flex-basis: auto; }
  .detail-content { display: block; }
  .detail-poster { float: left; width: 100px; margin: 0.4rem 1rem 0.8rem 0; }
  .detail-info { padding-top: 0; }
  .detail-overview { clear: both; padding-top: 0.5rem; }
  .detail-rating { margin-top: 0.5rem; }
  .detail-meta { font-size: 0.75rem; }
  .rating-number { font-size: 1.5rem; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
