<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { inspectVisibleLinks } from '@/api';
import type {
  DetectionSettings,
  LinkCheckItem,
  LinkHealthRecord,
  LinkHealthState,
  MergedResults,
  MergedResultItem,
} from '@/types';
import { getDiskTypeName } from '@/utils/diskTypes';
import {
  buildHealthCacheKey,
  buildHealthRecord,
  loadDetectionSettings,
  loadLinkHealthCache,
  persistLinkHealthCache,
  pruneExpiredHealthCache,
  saveCachedLinkHealth,
} from '@/utils/linkDetection';

const props = defineProps<{
  mergedResults: MergedResults;
  loading: boolean;
  hasSearched: boolean;
  isActivelySearching: boolean;
}>();

// 当前激活的标签
const activeTab = ref('');
// 当前标签页的数据
const currentTabData = ref<MergedResultItem[]>([]);
// 虚拟列表显示的数据
const visibleItems = ref<MergedResultItem[]>([]);
// 每次加载的数量
const PAGE_SIZE = 20;
// 当前加载的页码
const currentPage = ref(1);
const listContainerRef = ref<HTMLElement | null>(null);
// 当前查看详情的结果项
const detailItem = ref<MergedResultItem | null>(null);
// 复制状态
const linkCopyStatus = ref<'idle' | 'success' | 'error'>('idle');
const passwordCopyStatus = ref<'idle' | 'success' | 'error'>('idle');
const linkCopyTimer = ref<number | null>(null);
const passwordCopyTimer = ref<number | null>(null);
const listLinkFeedbackKey = ref('');
const listLinkFeedbackStatus = ref<'idle' | 'success' | 'error'>('idle');
const listLinkFeedbackTimer = ref<number | null>(null);
const listPasswordFeedbackKey = ref('');
const listPasswordFeedbackStatus = ref<'idle' | 'success' | 'error'>('idle');
const listPasswordFeedbackTimer = ref<number | null>(null);
const detectionSettings = ref<DetectionSettings>(loadDetectionSettings());
const healthCache = ref<Record<string, LinkHealthRecord>>({});
const pendingHealthMap = ref<Record<string, true>>({});
const currentViewToken = ref('');

const supportedDetectionDiskTypes = new Set([
  'baidu',
  'quark',
  'aliyun',
  'uc',
  'tianyi',
  '123',
  'xunlei',
  '115',
  'mobile'
]);

let visibilityObserver: IntersectionObserver | null = null;
let flushTimer: number | null = null;
const queuedItems = new Map<string, LinkCheckItem>();
const inFlightKeys = new Set<string>();

// 计算所有可用的网盘类型
const diskTypes = computed(() => {
  return Object.keys(props.mergedResults || {}).sort();
});

// 判断是否有搜索结果
const hasResults = computed(() => {
  return diskTypes.value.length > 0;
});

// 判断是否显示空状态（无结果且已完成搜索）
const showEmptyState = computed(() => {
  return !hasResults.value && props.hasSearched && !props.isActivelySearching;
});

// 判断是否显示搜索中状态（无结果但正在搜索）
const showSearchingState = computed(() => {
  return !hasResults.value && props.hasSearched && props.isActivelySearching;
});

// 判断是否显示初始状态（未搜索）
const showInitialState = computed(() => {
  return !hasResults.value && !props.hasSearched;
});

const hydrateHealthCache = () => {
  const nextCache = pruneExpiredHealthCache(loadLinkHealthCache());
  healthCache.value = nextCache;
  persistLinkHealthCache(nextCache);
};

const reloadDetectionSettings = () => {
  detectionSettings.value = loadDetectionSettings();
};

const getHealthStateKey = (diskType: string, url: string) => {
  return buildHealthCacheKey(diskType, url);
};

const getLinkHealthRecord = (diskType: string, url: string) => {
  const key = getHealthStateKey(diskType, url);

  if (pendingHealthMap.value[key]) {
    return buildHealthRecord('pending', {
      checked_at: Date.now(),
      expires_at: Date.now() + 5 * 60 * 1000
    });
  }

  return healthCache.value[key] || null;
};

const getIndicatorState = (item: MergedResultItem): LinkHealthState => {
  if (!activeTab.value) return 'idle';
  return getLinkHealthRecord(activeTab.value, item.url)?.state || 'idle';
};

const getIndicatorTitle = (item: MergedResultItem) => {
  const record = getLinkHealthRecord(activeTab.value, item.url);
  if (!record) return '未检测';

  const labelMap: Record<LinkHealthState, string> = {
    idle: '未检测',
    pending: '检测中',
    ok: '链接有效',
    bad: '链接失效',
    locked: '需要提取码',
    unsupported: '暂不支持检测',
    uncertain: '检测结果不确定'
  };

  return record.summary ? `${labelMap[record.state]}: ${record.summary}` : labelMap[record.state];
};

const shouldShowIndicator = (item: MergedResultItem) => {
  return getIndicatorState(item) !== 'idle';
};

const getIndicatorClass = (item: MergedResultItem) => {
  const state = getIndicatorState(item);
  return {
    'health-indicator': true,
    'is-pending': state === 'pending',
    'is-ok': state === 'ok',
    'is-bad': state === 'bad',
    'is-locked': state === 'locked',
    'is-uncertain': state === 'uncertain',
    'is-unsupported': state === 'unsupported'
  };
};

const getHealthPriority = (item: MergedResultItem) => {
  const state = activeTab.value
    ? getLinkHealthRecord(activeTab.value, item.url)?.state || 'idle'
    : 'idle';

  switch (state) {
    case 'ok':
      return 0;
    case 'locked':
      return 1;
    case 'pending':
      return 2;
    case 'idle':
      return 3;
    case 'unsupported':
      return 4;
    case 'uncertain':
      return 5;
    case 'bad':
      return 6;
    default:
      return 3;
  }
};

const getRankedTabData = () => {
  if (!activeTab.value || !props.mergedResults[activeTab.value]) {
    return [];
  }

  const source = props.mergedResults[activeTab.value] || [];
  if (!detectionSettings.value.enabled || !supportedDetectionDiskTypes.has(activeTab.value)) {
    return source;
  }

  return source
    .map((item, index) => ({
      item,
      index,
      priority: getHealthPriority(item)
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      return a.index - b.index;
    })
    .map(({ item }) => item);
};

const clearPendingForKeys = (keys: string[]) => {
  if (!keys.length) return;

  const nextMap = { ...pendingHealthMap.value };
  keys.forEach((key) => {
    delete nextMap[key];
    inFlightKeys.delete(key);
  });
  pendingHealthMap.value = nextMap;
};

const resetInspectionQueue = () => {
  queuedItems.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingHealthMap.value = {};
  inFlightKeys.clear();
  currentViewToken.value = `${activeTab.value || 'empty'}-${Date.now()}`;
};

const scheduleFlush = () => {
  if (flushTimer || !detectionSettings.value.enabled) return;

  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushInspectionQueue();
  }, 220);
};

const saveHealthResult = (diskType: string, url: string, record: LinkHealthRecord) => {
  saveCachedLinkHealth(diskType, url, record);
  healthCache.value = {
    ...healthCache.value,
    [getHealthStateKey(diskType, url)]: record
  };
};

const flushInspectionQueue = async () => {
  if (!detectionSettings.value.enabled || queuedItems.size === 0) return;

  const batchEntries = Array.from(queuedItems.entries()).slice(0, 6);
  batchEntries.forEach(([key]) => queuedItems.delete(key));

  const pendingMap = { ...pendingHealthMap.value };
  const items = batchEntries.map(([key, item]) => {
    pendingMap[key] = true;
    inFlightKeys.add(key);
    return item;
  });
  pendingHealthMap.value = pendingMap;

  try {
    const response = await inspectVisibleLinks(items, currentViewToken.value);

    response.results.forEach((result) => {
      const record = buildHealthRecord(result.state, {
        summary: result.summary,
        normalized_url: result.normalized_url,
        checked_at: result.checked_at,
        expires_at: result.expires_at
      });

      saveHealthResult(result.disk_type, result.url, record);
    });
  } catch (error) {
    const fallbackRecord = buildHealthRecord('uncertain', {
      summary: '检测服务暂不可用',
      checked_at: Date.now(),
      expires_at: Date.now() + 5 * 60 * 1000
    });

    items.forEach((item) => {
      saveHealthResult(item.disk_type, item.url, fallbackRecord);
    });
    console.error('链接检测失败:', error);
  } finally {
    clearPendingForKeys(batchEntries.map(([key]) => key));

    if (queuedItems.size > 0) {
      scheduleFlush();
    }
  }
};

const queueItemInspection = (item: MergedResultItem) => {
  if (!detectionSettings.value.enabled || !activeTab.value) return;
  if (!supportedDetectionDiskTypes.has(activeTab.value)) return;

  const key = getHealthStateKey(activeTab.value, item.url);
  if (queuedItems.has(key) || inFlightKeys.has(key)) return;

  const cached = healthCache.value[key];
  if (cached && cached.expires_at > Date.now()) return;

  queuedItems.set(key, {
    disk_type: activeTab.value,
    url: item.url,
    password: item.password
  });
  scheduleFlush();
};

const rebuildVisibilityObserver = () => {
  if (visibilityObserver) {
    visibilityObserver.disconnect();
    visibilityObserver = null;
  }

  if (!detectionSettings.value.enabled || !listContainerRef.value || !activeTab.value) {
    return;
  }

  visibilityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35) return;

        const index = Number((entry.target as HTMLElement).dataset.visibleIndex ?? '-1');
        if (Number.isNaN(index) || index < 0) return;

        const item = visibleItems.value[index];
        if (!item) return;

        queueItemInspection(item);
      });
    },
    {
      root: listContainerRef.value,
      threshold: [0.35, 0.6]
    }
  );

  listContainerRef.value
    .querySelectorAll<HTMLElement>('.result-item')
    .forEach((element) => visibilityObserver?.observe(element));
};

// 监听结果变化，智能选择标签
watch(
  () => props.mergedResults,
  (newVal) => {
    if (newVal && Object.keys(newVal).length > 0) {
      nextTick(() => {
        // 如果当前没有选中标签，或者当前选中的标签在新数据中不存在，则选择第一个标签
        const availableTypes = Object.keys(newVal);
        if (!activeTab.value || !availableTypes.includes(activeTab.value)) {
          activeTab.value = availableTypes[0] || '';
        }
        updateCurrentTabData();
        resetInspectionQueue();
      });
    } else {
      // 当没有结果时，清空当前数据
      activeTab.value = '';
      currentTabData.value = [];
      visibleItems.value = [];
      resetInspectionQueue();
    }
  },
  { immediate: true, deep: true }
);

// 监听标签页切换
watch(
  () => activeTab.value,
  () => {
    currentPage.value = 1;
    updateCurrentTabData();
    resetInspectionQueue();
  }
);

watch(
  () => detectionSettings.value.enabled,
  (enabled) => {
    if (!enabled) {
      resetInspectionQueue();
      updateCurrentTabData();
      return;
    }

    updateCurrentTabData();
  }
);

watch(
  () => [
    activeTab.value,
    detectionSettings.value.enabled,
    Object.keys(pendingHealthMap.value).sort().join('|'),
    Object.entries(healthCache.value)
      .map(([key, record]) => `${key}:${record.state}:${record.checked_at}`)
      .sort()
      .join('|')
  ],
  () => {
    if (!activeTab.value) return;
    updateCurrentTabData();
  }
);

watch(
  () => [
    activeTab.value,
    detectionSettings.value.enabled,
    visibleItems.value.map((item) => `${item.url}|${item.password || ''}`).join('||')
  ],
  () => {
    nextTick(() => {
      rebuildVisibilityObserver();
    });
  }
);

// 更新当前标签页数据
const updateCurrentTabData = () => {
  if (!activeTab.value || !props.mergedResults[activeTab.value]) {
    currentTabData.value = [];
    visibleItems.value = [];
    return;
  }
  
  currentTabData.value = getRankedTabData();
  loadMoreItems();
};

// 加载更多数据
const loadMoreItems = () => {
  const start = 0;
  const end = currentPage.value * PAGE_SIZE;
  visibleItems.value = currentTabData.value.slice(start, end);
};

// 处理滚动加载更多
const handleScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
  
  // 当滚动到底部100px时，加载更多数据
  if (scrollBottom < 100 && visibleItems.value.length < currentTabData.value.length) {
    currentPage.value++;
    loadMoreItems();
  }
};

// 打开链接
const openLink = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

// 通用复制函数（支持降级处理）
const copyToClipboard = async (text: string): Promise<boolean> => {
  // 方法1: 优先使用现代 Clipboard API（安全上下文可用）
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Clipboard API 失败，尝试降级方案:', err);
    }
  }
  
  // 方法2: 降级使用传统 execCommand 方法 (兼容HTTP)
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    
    return successful;
  } catch (err) {
    console.error('复制失败:', err);
    return false;
  }
};

const clearCopyFeedbackTimers = () => {
  if (listLinkFeedbackTimer.value) {
    clearTimeout(listLinkFeedbackTimer.value);
    listLinkFeedbackTimer.value = null;
  }

  if (linkCopyTimer.value) {
    clearTimeout(linkCopyTimer.value);
    linkCopyTimer.value = null;
  }

  if (passwordCopyTimer.value) {
    clearTimeout(passwordCopyTimer.value);
    passwordCopyTimer.value = null;
  }
};

const clearListPasswordFeedbackTimer = () => {
  if (listPasswordFeedbackTimer.value) {
    clearTimeout(listPasswordFeedbackTimer.value);
    listPasswordFeedbackTimer.value = null;
  }
};

const resetCopyStatus = () => {
  clearCopyFeedbackTimers();
  listLinkFeedbackKey.value = '';
  listLinkFeedbackStatus.value = 'idle';
  linkCopyStatus.value = 'idle';
  passwordCopyStatus.value = 'idle';
};

const getResultItemKey = (item: MergedResultItem, index: number) => {
  return `${index}-${item.url}-${item.password ?? ''}`;
};

const getListPasswordStatus = (item: MergedResultItem, index: number) => {
  if (listPasswordFeedbackKey.value !== getResultItemKey(item, index)) {
    return 'idle';
  }

  return listPasswordFeedbackStatus.value;
};

const getListLinkStatus = (item: MergedResultItem, index: number) => {
  if (listLinkFeedbackKey.value !== getResultItemKey(item, index)) {
    return 'idle';
  }

  return listLinkFeedbackStatus.value;
};

const copyListLink = async (item: MergedResultItem, index: number) => {
  const success = await copyToClipboard(item.url);

  if (listLinkFeedbackTimer.value) {
    clearTimeout(listLinkFeedbackTimer.value);
  }

  listLinkFeedbackKey.value = getResultItemKey(item, index);
  listLinkFeedbackStatus.value = success ? 'success' : 'error';
  listLinkFeedbackTimer.value = window.setTimeout(() => {
    listLinkFeedbackKey.value = '';
    listLinkFeedbackStatus.value = 'idle';
    listLinkFeedbackTimer.value = null;
  }, 1800);
};

const copyListPassword = async (item: MergedResultItem, index: number) => {
  if (!item.password) return;

  const success = await copyToClipboard(item.password);

  clearListPasswordFeedbackTimer();
  listPasswordFeedbackKey.value = getResultItemKey(item, index);
  listPasswordFeedbackStatus.value = success ? 'success' : 'error';
  listPasswordFeedbackTimer.value = window.setTimeout(() => {
    listPasswordFeedbackKey.value = '';
    listPasswordFeedbackStatus.value = 'idle';
    listPasswordFeedbackTimer.value = null;
  }, 1800);
};

const setCopyStatus = (type: 'link' | 'password', success: boolean) => {
  const status = success ? 'success' : 'error';
  const timerRef = type === 'link' ? linkCopyTimer : passwordCopyTimer;
  const statusRef = type === 'link' ? linkCopyStatus : passwordCopyStatus;

  if (timerRef.value) {
    clearTimeout(timerRef.value);
  }

  statusRef.value = status;
  timerRef.value = window.setTimeout(() => {
    statusRef.value = 'idle';
    timerRef.value = null;
  }, 1800);
};

const openTitleDetail = (item: MergedResultItem) => {
  detailItem.value = item;
  resetCopyStatus();
};

const closeTitleDetail = () => {
  detailItem.value = null;
  resetCopyStatus();
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && detailItem.value) {
    closeTitleDetail();
  }
};

const copyDetailField = async (type: 'link' | 'password') => {
  if (!detailItem.value) return;

  const text = type === 'link' ? detailItem.value.url : detailItem.value.password;
  if (!text) return;

  const success = await copyToClipboard(text);
  setCopyStatus(type, success);
};

const getCopyButtonText = (type: 'link' | 'password') => {
  const status = type === 'link' ? linkCopyStatus.value : passwordCopyStatus.value;

  if (status === 'success') {
    return '复制成功';
  }

  if (status === 'error') {
    return '复制失败';
  }

  return type === 'link' ? '复制链接' : '复制密码';
};

const getDetailPasswordText = () => {
  if (passwordCopyStatus.value === 'success') {
    return '复制成功';
  }

  if (passwordCopyStatus.value === 'error') {
    return '复制失败';
  }

  return detailItem.value?.password ?? '';
};

// 格式化日期时间
const formatDateTime = (dateTimeStr?: string) => {
  if (!dateTimeStr) return '';
  
  try {
    const date = new Date(dateTimeStr);
    return date.toLocaleString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit'
    });
  } catch (e) {
    return dateTimeStr;
  }
};

// 获取网盘类型中文名称
const getDiskName = (type: string) => {
  return getDiskTypeName(type);
};

watch(detailItem, (newVal) => {
  document.body.style.overflow = newVal ? 'hidden' : '';
});

onMounted(() => {
  hydrateHealthCache();
  reloadDetectionSettings();
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('storage', reloadDetectionSettings);
  window.addEventListener('config:saved', reloadDetectionSettings);
  nextTick(() => {
    rebuildVisibilityObserver();
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('storage', reloadDetectionSettings);
  window.removeEventListener('config:saved', reloadDetectionSettings);
  document.body.style.overflow = '';
  clearCopyFeedbackTimers();
  clearListPasswordFeedbackTimer();
  if (visibilityObserver) {
    visibilityObserver.disconnect();
    visibilityObserver = null;
  }
  resetInspectionQueue();
});

</script>

<template>
  <div class="results-wrapper">
    <!-- 初始状态 -->
    <div v-if="showInitialState" class="empty-state">
      <div class="empty-icon">
        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
        </svg>
      </div>
      <p class="empty-title">输入关键词开始搜索</p>
    </div>
    
    <!-- 搜索中状态 -->
    <div v-else-if="showSearchingState" class="searching-state">
      <div class="searching-icon">
        <div class="searching-spinner"></div>
      </div>
      <p class="searching-title">正在搜索资源中...</p>
      <p class="searching-subtitle">资源搜索可能需要一些时间，请耐心等待</p>
    </div>
    
    <!-- 搜索无结果状态 -->
    <div v-else-if="showEmptyState" class="empty-state">
      <div class="empty-icon">
        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </div>
      <p class="empty-title">未找到相关资源</p>
      <p class="empty-subtitle">请尝试其他关键词</p>
    </div>
    
    <!-- 搜索结果 -->
    <div v-else-if="hasResults" class="results-container">
      <!-- 标签页 -->
      <div class="tabs">
        <button 
          v-for="type in diskTypes" 
          :key="type"
          class="tab-button"
          :class="{ active: activeTab === type }"
          @click="activeTab = type"
        >
          {{ getDiskName(type) }} ({{ mergedResults[type]?.length || 0 }})
        </button>
      </div>
      
      <!-- 内容区域 -->
      <div class="tab-content">
        <div v-if="!currentTabData.length" class="empty-tab">
          <p>暂无数据</p>
        </div>
        
        <div ref="listContainerRef" v-else class="result-list" @scroll="handleScroll">
          <div 
            v-for="(item, index) in visibleItems" 
            :key="index" 
            class="result-item"
            :data-visible-index="index"
          >
            <!-- 标题行（移动端单独占一行） -->
            <div class="result-header">
              <button
                type="button"
                class="result-title-button"
                :title="item.note"
                @click="openTitleDetail(item)"
              >
                <span class="result-title-row">
                  <span class="result-title">{{ item.note }}</span>
                  <span
                    v-if="shouldShowIndicator(item)"
                    :class="getIndicatorClass(item)"
                    :title="getIndicatorTitle(item)"
                  ></span>
                </span>
              </button>
              <!-- 桌面端：数据来源+时间与标题同行 -->
              <div class="result-meta desktop-only" v-if="item.source || item.datetime">
                <span v-if="item.source" class="result-source">{{ item.source }}</span>
                <span v-if="item.source && item.datetime" class="meta-separator">·</span>
                <span v-if="item.datetime" class="result-date">{{ formatDateTime(item.datetime) }}</span>
              </div>
            </div>
            
            <!-- 移动端：数据来源+时间单独一行 -->
            <div class="result-meta mobile-only" v-if="item.source || item.datetime">
              <span v-if="item.source" class="result-source">{{ item.source }}</span>
              <span v-if="item.source && item.datetime" class="meta-separator">·</span>
              <span v-if="item.datetime" class="result-date">{{ formatDateTime(item.datetime) }}</span>
            </div>
            
            <!-- 第二行：链接和提取码 -->
            <div class="result-row">
              <div class="result-link-group">
                <button
                  type="button"
                  class="result-link"
                  :title="item.url"
                  @click="openLink(item.url)"
                >
                  {{ item.url }}
                </button>
                <button
                  type="button"
                  class="result-link-copy"
                  :class="{
                    copied: getListLinkStatus(item, index) === 'success',
                    'copy-failed': getListLinkStatus(item, index) === 'error'
                  }"
                  :title="getListLinkStatus(item, index) === 'success' ? '已复制' : '复制链接'"
                  @click.stop="copyListLink(item, index)"
                >
                  <template v-if="getListLinkStatus(item, index) === 'success'">
                    复制成功
                  </template>
                  <template v-else-if="getListLinkStatus(item, index) === 'error'">
                    复制失败
                  </template>
                  <template v-else>
                    复制
                  </template>
                </button>
              </div>
              <button
                v-if="item.password"
                type="button"
                class="result-password"
                :class="{
                  copied: getListPasswordStatus(item, index) === 'success',
                  'copy-failed': getListPasswordStatus(item, index) === 'error'
                }"
                @click="copyListPassword(item, index)"
              >
                <template v-if="getListPasswordStatus(item, index) === 'success'">
                  复制成功
                </template>
                <template v-else-if="getListPasswordStatus(item, index) === 'error'">
                  复制失败
                </template>
                <template v-else>
                  提取码: <span class="password-value">{{ item.password }}</span>
                </template>
              </button>
            </div>
          </div>
          
          <div v-if="visibleItems.length < currentTabData.length" class="loading-more">
            <div class="loading-spinner"></div>
            <span>加载更多...</span>
          </div>
        </div>
      </div>
      
      <!-- 持续搜索提示 -->
      <div v-if="isActivelySearching" class="ongoing-search-hint">
        <div class="hint-spinner"></div>
        <span>正在持续搜索更多资源...</span>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="detail-fade">
        <div v-if="detailItem" class="detail-overlay" @click="closeTitleDetail">
          <div class="detail-dialog" @click.stop>
            <div class="detail-header">
              <div class="detail-heading">
                <p class="detail-label">完整标题</p>
                <h3 class="detail-title">{{ detailItem.note }}</h3>
              </div>
              <button
                type="button"
                class="detail-close"
                aria-label="关闭标题详情"
                @click="closeTitleDetail"
              >
                <svg class="detail-close-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <div v-if="detailItem.source || detailItem.datetime" class="detail-meta">
              <span v-if="detailItem.source" class="result-source">{{ detailItem.source }}</span>
              <span v-if="detailItem.source && detailItem.datetime" class="meta-separator">·</span>
              <span v-if="detailItem.datetime" class="result-date">{{ formatDateTime(detailItem.datetime) }}</span>
            </div>

            <div class="detail-actions">
              <button
                type="button"
                class="detail-copy-btn"
                :class="{
                  success: linkCopyStatus === 'success',
                  error: linkCopyStatus === 'error'
                }"
                @click="copyDetailField('link')"
              >
                {{ getCopyButtonText('link') }}
              </button>

              <button
                v-if="detailItem.password"
                type="button"
                class="detail-password-action"
                :class="{
                  success: passwordCopyStatus === 'success',
                  error: passwordCopyStatus === 'error'
                }"
                @click="copyDetailField('password')"
              >
                <template v-if="passwordCopyStatus === 'idle'">
                  <span class="detail-password-label">提取码:</span>
                  <span class="detail-password-content">{{ detailItem.password }}</span>
                </template>
                <template v-else>
                  {{ getDetailPasswordText() }}
                </template>
              </button>
            </div>

            <button
              type="button"
              class="detail-link-preview"
              :title="detailItem.url"
              @click="openLink(detailItem.url)"
            >
              {{ detailItem.url }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.results-wrapper {
  width: 100%;
}

.empty-state, .searching-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  text-align: center;
  background-color: #fff;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.empty-icon {
  width: 4rem;
  height: 4rem;
  background-color: #f3f4f6;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.empty-icon .icon {
  width: 2rem;
  height: 2rem;
  color: #9ca3af;
}

.searching-icon {
  width: 4rem;
  height: 4rem;
  background-color: #f0f9ff;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.searching-spinner {
  width: 2rem;
  height: 2rem;
  border: 3px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.empty-title, .searching-title {
  font-size: 1.125rem;
  font-weight: 500;
  color: #4b5563;
  margin-bottom: 0.5rem;
}

.empty-subtitle, .searching-subtitle {
  font-size: 0.875rem;
  color: #6b7280;
}

.results-container {
  background-color: #fff;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.tabs {
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid #e5e7eb;
  background-color: #f9fafb;
  padding: 0 1rem;
}

.tab-button {
  padding: 0.75rem 1rem;
  white-space: nowrap;
  font-size: 0.875rem;
  color: #4b5563;
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
}

.tab-button:hover {
  color: #3b82f6;
}

.tab-button.active {
  color: #3b82f6;
  font-weight: 500;
}

.tab-button.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 100%;
  height: 2px;
  background-color: #3b82f6;
}

.tab-content {
  min-height: 300px;
}

.empty-tab {
  padding: 3rem 1rem;
  text-align: center;
  color: #6b7280;
}

.result-list {
  max-height: 600px;
  overflow-y: auto;
  padding: 1rem;
}

.result-item {
  padding: 0.75rem;
  border-bottom: 1px solid #f3f4f6;
  transition: background-color 0.2s ease;
}

.result-item:hover {
  background-color: #f9fafb;
}

.result-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.result-row:last-child {
  margin-bottom: 0;
}

.result-link-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
}

.result-title-button {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  width: 100%;
  min-width: 0;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.result-title-button:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
  border-radius: 0.25rem;
}

.result-title {
  display: block;
  width: 100%;
  font-size: 0.95rem;
  font-weight: 500;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-title-row {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  gap: 0.45rem;
}

.health-indicator {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 9999px;
  flex: 0 0 auto;
  background: #cbd5e1;
}

.health-indicator.is-pending {
  background: #60a5fa;
  animation: pulse-dot 1.1s ease-in-out infinite;
}

.health-indicator.is-ok {
  background: #22c55e;
}

.health-indicator.is-bad {
  background: #ef4444;
}

.health-indicator.is-locked {
  background: #f59e0b;
}

.health-indicator.is-uncertain,
.health-indicator.is-unsupported {
  background: #94a3b8;
}

/* 标题行布局 */
.result-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  width: 100%;
}

/* 桌面端：数据来源与标题同行 */
.result-meta.desktop-only {
  display: flex;
  align-items: center;
  margin-left: 0.75rem;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 移动端：数据来源单独一行 */
.result-meta.mobile-only {
  display: none;
  align-items: center;
  margin-top: 0.375rem;
  margin-bottom: 0.25rem;
}

/* 响应式显示控制 */
@media (max-width: 768px) {
  .desktop-only {
    display: none !important;
  }
  
  .mobile-only {
    display: flex !important;
  }
  
  .result-header {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .result-title {
    width: 100%;
    margin-bottom: 0;
  }
  
  /* 移动端数据来源标签优化 */
  .result-source {
    font-size: 0.6875rem;
    padding: 0.0625rem 0.25rem;
  }
}

.result-source {
  font-size: 0.75rem;
  color: #3b82f6;
  font-weight: 500;
  background-color: #eff6ff;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  border: 1px solid #bfdbfe;
}

.meta-separator {
  font-size: 0.75rem;
  color: #9ca3af;
  margin: 0 0.375rem;
}

.result-date {
  font-size: 0.75rem;
  color: #6b7280;
}

.result-link {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  text-align: left;
  font: inherit;
  font-size: 0.875rem;
  color: #3b82f6;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  flex: 1 1 auto;
}

.result-link:hover {
  text-decoration: underline;
}

.result-link:focus-visible,
.result-link-copy:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
  border-radius: 0.25rem;
}

.result-link-copy {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  font-size: 0.75rem;
  color: #6b7280;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.result-link-copy:hover {
  color: #4b5563;
}

.result-link-copy.copied {
  color: #059669;
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.7rem;
  border-radius: 9999px;
  background: #ecfdf5;
  border: 1px solid #d1fae5;
  line-height: 1;
}

.result-link-copy.copy-failed {
  color: #dc2626;
}

.result-password {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  font-size: 0.75rem;
  color: #6b7280;
  margin-left: 0.75rem;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s ease;
}

.result-password:hover {
  color: #4b5563;
}

.result-password:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
  border-radius: 0.25rem;
}

.result-password.copied {
  color: #059669;
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.7rem;
  border-radius: 9999px;
  background: #ecfdf5;
  border: 1px solid #d1fae5;
  line-height: 1;
}

.result-password.copy-failed {
  color: #dc2626;
}

.password-value {
  color: #10b981;
  font-weight: 500;
}

.detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(8px);
}

.detail-dialog {
  width: min(100%, 640px);
  max-height: min(80vh, 680px);
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 1rem;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.2);
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.25rem 0.75rem;
}

.detail-heading {
  min-width: 0;
}

.detail-label {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #6b7280;
}

.detail-title {
  margin: 0;
  font-size: 1rem;
  line-height: 1.7;
  font-weight: 600;
  color: #111827;
  word-break: break-word;
}

.detail-close {
  appearance: none;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #6b7280;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.detail-close:hover {
  color: #111827;
  border-color: #cbd5e1;
  background: #f8fafc;
}

.detail-close:focus-visible,
.detail-copy-btn:focus-visible,
.detail-password-action:focus-visible,
.detail-link-preview:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}

.detail-close-icon {
  width: 1rem;
  height: 1rem;
}

.detail-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.375rem;
  padding: 0 1.25rem 1rem;
}

.detail-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0 1.25rem 0.875rem;
  min-width: 0;
}

.detail-password-action {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  color: #6b7280;
}

.detail-password-action:hover {
  color: #047857;
}

.detail-password-action.success {
  color: #059669;
  padding: 0.3rem 0.7rem;
  border-radius: 9999px;
  background: #ecfdf5;
  border: 1px solid #d1fae5;
  line-height: 1;
}

.detail-password-action.error {
  color: #dc2626;
}

.detail-copy-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: #2563eb;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.detail-copy-btn:hover {
  color: #1d4ed8;
}

.detail-copy-btn.success {
  color: #059669;
  padding: 0.3rem 0.7rem;
  border-radius: 9999px;
  background: #ecfdf5;
  border: 1px solid #d1fae5;
  line-height: 1;
}

.detail-copy-btn.error {
  color: #dc2626;
}

.detail-password-label {
  color: inherit;
  flex-shrink: 0;
}

.detail-password-content {
  color: #10b981;
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-link-preview {
  appearance: none;
  display: block;
  width: calc(100% - 2.5rem);
  margin: 0 1.25rem 1.25rem;
  padding: 0;
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #3b82f6;
  font-size: 0.875rem;
  line-height: 1.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.detail-link-preview:hover {
  text-decoration: underline;
}

.detail-fade-enter-active,
.detail-fade-leave-active {
  transition: opacity 0.2s ease;
}

.detail-fade-enter-from,
.detail-fade-leave-to {
  opacity: 0;
}

.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1rem;
  color: #6b7280;
  font-size: 0.875rem;
}

.loading-spinner, .hint-spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.ongoing-search-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background-color: #f0f9ff;
  color: #3b82f6;
  font-size: 0.875rem;
  border-top: 1px solid #e5e7eb;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.95);
  }
  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@media (max-width: 768px) {
  .results-wrapper {
    width: 100%;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .results-container {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .tabs {
    flex: 0 0 auto;
  }

  .tab-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .result-list {
    flex: 1 1 auto;
    max-height: none;
    min-height: 0;
    padding: 0.5rem;
    overflow-y: auto;
    scroll-padding-bottom: 1rem;
  }
  
  .result-item {
    padding: 0.75rem 0.5rem;
  }

  .result-row {
    flex-wrap: wrap;
  }

  .result-link-group {
    width: 100%;
  }

  .result-link {
    font-size: 0.8125rem;
  }

  .result-link-copy {
    font-size: 0.6875rem;
  }
  
  .tab-button {
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
  }

  .detail-dialog {
    width: 100%;
    max-height: 85vh;
    border-radius: 1rem;
  }

  .detail-header {
    padding: 1rem 1rem 0.75rem;
  }

  .detail-meta,
  .detail-actions {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  .detail-link-preview {
    width: calc(100% - 2rem);
    margin-left: 1rem;
    margin-right: 1rem;
  }
}
</style>
