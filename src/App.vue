<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, nextTick, watch } from 'vue';
import { search, logout, getHealth, verifyToken, type SearchParams, type HealthStatus } from '@/api';
import type { SearchResponse, MergedResults, ExportField, ExportSettings } from '@/types';
import SearchForm from '@/components/SearchForm.vue';
import ResultTabs from '@/components/ResultTabs.vue';
import SearchStats from '@/components/SearchStats.vue';
import SearchConfig from '@/components/SearchConfig.vue';
import ApiDocs from '@/components/ApiDocs.vue';
import LoginDialog from '@/components/LoginDialog.vue';
import QQPDManager from '@/components/QQPDManager.vue';
import AccountCenter from '@/components/AccountCenter.vue';
import GyingManager from '@/components/GyingManager.vue';
import PanlianManager from '@/components/PanlianManager.vue';
import WeiboManager from '@/components/WeiboManager.vue';
import ExportResultsModal from '@/components/ExportResultsModal.vue';
import { getDiskTypeName } from '@/utils/diskTypes';

// 后端健康状态缓存（应用启动时获取一次）
const backendHealth = ref<HealthStatus | null>(null);
// 健康状态是否已获取完毕（无论成功或失败），SearchForm 依赖它决定何时按 URL 参数自动搜索
const healthReady = ref(false);

// 搜索状态
const loading = ref(false);
const searchResults = reactive<{
  total: number;
  mergedResults: MergedResults;
}>({
  total: 0,
  mergedResults: {}
});

// 搜索时间
const searchTime = ref<number | undefined>(undefined);

// 后台更新状态
const isUpdating = ref(false);
const updateCount = ref(0);
const updateTimer = ref<number | null>(null);
const secondSearchTimeout = ref<number | null>(null);
const thirdSearchTimeout = ref<number | null>(null);
const fourthSearchTimeout = ref<number | null>(null);
const lastSearchParams = ref<SearchParams | null>(null);
const showExportModal = ref(false);
const navHeaderRef = ref<HTMLElement | null>(null);
const mainContentRef = ref<HTMLElement | null>(null);
const footerRef = ref<HTMLElement | null>(null);
const searchResultsBlockRef = ref<HTMLElement | null>(null);
const mobileSearchResultsHeight = ref<string>('');
const exportSettings = ref<ExportSettings>({
  format: 'json',
  fields: ['title', 'source', 'datetime'],
  prettyJson: true,
  includeFieldLabels: true,
  selectedDiskTypes: [],
  allDiskTypesSelected: true
});

const EXPORT_SETTINGS_STORAGE_KEY = 'pansou_export_settings';

// 是否已经执行过搜索
const hasSearched = ref(false);
// 是否正在进行后台搜索（包括初始搜索和后续更新）
const isActivelySearching = ref(false);
const hasExportableResults = computed(() => {
  return Object.values(searchResults.mergedResults || {}).some(items => Array.isArray(items) && items.length > 0);
});
const exportableDiskTypes = computed(() => {
  return Object.keys(searchResults.mergedResults || {}).filter(key => {
    const items = searchResults.mergedResults[key];
    return Array.isArray(items) && items.length > 0;
  });
});

// 强制刷新逻辑
let forceRefreshPending = false;

// 当前页面状态
const currentPage = ref<'search' | 'status' | 'docs' | 'accounts' | 'qqpd' | 'gying' | 'panlian' | 'weibo'>('search');

// 登录状态
const showLogin = ref(false);
const isAuthenticated = ref(false);
const currentUsername = ref('');

// QQPD插件状态
const isQQPDEnabled = ref(false);

// Gying插件状态
const isGyingEnabled = ref(false);

// 盘链插件状态
const isPanlianEnabled = ref(false);

// Weibo插件状态
const isWeiboEnabled = ref(false);

// 检查是否有需要账号管理的服务
const hasAccountServices = computed(() => {
  return isQQPDEnabled.value || isGyingEnabled.value || isPanlianEnabled.value || isWeiboEnabled.value;
});

// 页面切换
const switchToStatus = () => {
  currentPage.value = 'status';
};

const switchToDocs = () => {
  currentPage.value = 'docs';
};

const switchToAccounts = () => {
  currentPage.value = 'accounts';
};

const switchToQQPD = () => {
  currentPage.value = 'qqpd';
};

const switchToGying = () => {
  currentPage.value = 'gying';
};

const switchToPanlian = () => {
  currentPage.value = 'panlian';
};

const switchToWeibo = () => {
  currentPage.value = 'weibo';
};

// 从账号中心导航到具体服务
const handleAccountNavigate = (service: 'qqpd' | 'gying' | 'panlian' | 'weibo') => {
  if (service === 'qqpd') {
    switchToQQPD();
  } else if (service === 'gying') {
    switchToGying();
  } else if (service === 'panlian') {
    switchToPanlian();
  } else if (service === 'weibo') {
    switchToWeibo();
  }
};



// 初始化后端健康状态（应用启动时调用一次）
const initBackendHealth = async () => {
  try {
    backendHealth.value = await getHealth();
  } catch (err) {
    console.error('获取后端健康状态失败:', err);
    backendHealth.value = null;
  } finally {
    // 失败时也要放行，让自动搜索走与手动搜索相同的兜底路径，不会永久卡住
    healthReady.value = true;
  }
};

// 检查配置（优先使用用户设置，否则使用后端默认缓存）
const checkConfig = () => {
  try {
    const savedChannels = localStorage.getItem('pansou_channels');
    const savedPlugins = localStorage.getItem('pansou_plugins');
    
    // 如果用户已手动设置，使用用户设置
    if (savedChannels !== null || savedPlugins !== null) {
      return {
        channels: savedChannels ? JSON.parse(savedChannels) : [],
        plugins: savedPlugins ? JSON.parse(savedPlugins) : []
      };
    }
    
    // 如果用户未设置，使用缓存的后端配置
    if (backendHealth.value) {
      return {
        channels: backendHealth.value.channels || [],
        plugins: backendHealth.value.plugins || []
      };
    }
    
    return { channels: [], plugins: [] };
  } catch (err) {
    console.error('检查配置失败:', err);
    return { channels: [], plugins: [] };
  }
};

// 处理搜索
const handleSearch = async (params: SearchParams) => {
  // 停止之前的更新
  stopUpdate();

  // 先保存用户输入的原始参数，不带 refresh
  lastSearchParams.value = { ...params };

  // 强制刷新: 只影响本次请求参数
  let innerParams = { ...params };
  if (forceRefreshPending) {
    innerParams.refresh = true;
    forceRefreshPending = false;
  }

  // 标记状态
  hasSearched.value = true;
  isActivelySearching.value = true;
  loading.value = true;

  // 清空之前的搜索结果
  searchResults.total = 0;
  searchResults.mergedResults = {};
  searchTime.value = undefined;

  const startTime = Date.now();

  // 配置
  const config = checkConfig();
  const hasChannels = config.channels.length > 0;
  const hasPlugins = config.plugins.length > 0;

  try {
    // 只用 innerParams，确保 refresh 只传一次
    const userParams: SearchParams = { ...innerParams };
    
    // 如果同时启用了TG和插件，立即发起后台预热搜索（忽略结果）
    if (hasChannels && hasPlugins) {
      const preloadParams: SearchParams = { 
        ...lastSearchParams.value,
        src: 'all'  // 后台预热搜索使用 all
      };
      
      // 后台预热搜索，仅用于触发后端插件异步缓存，不处理结果
      search(preloadParams)
        .catch(error => {
          console.warn('后台预热搜索失败（不影响主搜索）:', error);
        });
    }
    
    // 先发起第一次搜索请求（显示结果）
    search(userParams)
      .then(firstResponse => {
        
        if (firstResponse && firstResponse.total !== undefined) {
          // 使用第一次搜索结果进行显示
          updateSearchResults(firstResponse);
          searchTime.value = Date.now() - startTime;
          // 第一次搜索完成后，关闭加载状态
          loading.value = false;
          
          // 根据配置决定是否需要后续搜索：
          // 1. 同时启用tg和plugin：需要第二次、第三次搜索（src=all）
          // 2. 只启用tg：不需要后续搜索
          // 3. 只启用plugin：需要第二次、第三次搜索（src=plugin）
          if (hasPlugins) {
            // 只要启用了插件，就需要后续搜索（插件是异步的）
            // 记录第一次搜索完成时间
            const firstSearchCompleteTime = Date.now();
            
            // 开始第二次搜索
            startSecondAllSearch(firstSearchCompleteTime);
          } else {
            // 只有TG或都没有，不需要后续搜索，标记搜索完成
            isActivelySearching.value = false;
          }
        } else {
          console.error('第一次搜索结果格式不正确:', firstResponse);
          loading.value = false;
          isActivelySearching.value = false;
        }
      })
      .catch(error => {
        console.error('第一次搜索出错:', error);
        loading.value = false;
        isActivelySearching.value = false;
      });
    
    // 设置一个超时，确保即使搜索很慢，UI也不会一直处于加载状态
    setTimeout(() => {
      if (loading.value) {
        loading.value = false;
      }
    }, 5000); // 5秒后如果还在加载，则关闭加载状态
    
  } catch (error) {
    console.error('搜索初始化出错:', error);
    loading.value = false;
    isActivelySearching.value = false;
  }
};

// 搜索完成处理
const handleSearchComplete = () => {
  // 只处理UI相关的状态，不影响搜索流程
};

// 应用关键词过滤（后端filter参数已经处理，这里保留作为备用）
const applyKeywordFilter = (results: any, filterStr: string) => {
  if (!results || !filterStr.trim()) return results;
  
  try {
    const filter = JSON.parse(filterStr);
    const includeKeywords = (filter.include || []).map((k: string) => k.toLowerCase());
    const excludeKeywords = (filter.exclude || []).map((k: string) => k.toLowerCase());
    
    if (includeKeywords.length === 0 && excludeKeywords.length === 0) {
      return results;
    }
    
    const filteredResults: any = {};
    
    // 遍历每个网盘类型的结果
    Object.keys(results).forEach(diskType => {
      const diskResults = results[diskType];
      if (!Array.isArray(diskResults)) return;
      
      // 过滤每个结果项
      const filtered = diskResults.filter((item: any) => {
        const note = (item.note || '').toLowerCase();
        const source = (item.source || '').toLowerCase();
        const searchText = `${note} ${source}`;
        
        // 包含检查 (OR关系)：如果有include，必须至少包含一个
        if (includeKeywords.length > 0) {
          const hasInclude = includeKeywords.some(keyword => searchText.includes(keyword));
          if (!hasInclude) return false;
        }
        
        // 排除检查 (OR关系)：如果有exclude，包含任意一个就排除
        if (excludeKeywords.length > 0) {
          const hasExclude = excludeKeywords.some(keyword => searchText.includes(keyword));
          if (hasExclude) return false;
        }
        
        return true;
      });
      
      // 只保留有结果的网盘类型
      if (filtered.length > 0) {
        filteredResults[diskType] = filtered;
      }
    });
    
    return filteredResults;
  } catch (error) {
    console.error('过滤参数解析失败:', error);
    return results;
  }
};

// 更新搜索结果
const updateSearchResults = (response: SearchResponse) => {
  if (!response) return;
  
  searchResults.total = response.total || 0;
  
  if (response.merged_by_type) {
    let results = { ...response.merged_by_type };
    
    // 注意：后端已经处理了filter参数，这里不再需要前端过滤
    // 保留以下代码作为备用，但不执行
    // if (lastSearchParams.value && (lastSearchParams.value as any).filter) {
    //   results = applyKeywordFilter(results, (lastSearchParams.value as any).filter);
    // }
    
    searchResults.mergedResults = results;
  } else {
    console.warn('搜索结果中没有merged_by_type字段');
    searchResults.mergedResults = {};
  }
};

const loadExportSettings = () => {
  try {
    const saved = localStorage.getItem(EXPORT_SETTINGS_STORAGE_KEY);
    if (!saved) return;

    const parsed = JSON.parse(saved);
    const allowedFields: ExportField[] = ['sequence', 'title', 'source', 'datetime'];
    const fields = Array.isArray(parsed.fields)
      ? parsed.fields.filter((field: unknown): field is ExportField => allowedFields.includes(field as ExportField))
      : exportSettings.value.fields;

    exportSettings.value = {
      format: parsed.format === 'txt' ? 'txt' : 'json',
      fields,
      prettyJson: parsed.prettyJson !== false,
      includeFieldLabels: parsed.includeFieldLabels !== false,
      selectedDiskTypes: Array.isArray(parsed.selectedDiskTypes) ? parsed.selectedDiskTypes : [],
      allDiskTypesSelected: parsed.allDiskTypesSelected !== false
    };
  } catch (error) {
    console.error('读取导出设置失败:', error);
  }
};

const persistExportSettings = () => {
  try {
    localStorage.setItem(EXPORT_SETTINGS_STORAGE_KEY, JSON.stringify(exportSettings.value));
  } catch (error) {
    console.error('保存导出设置失败:', error);
  }
};

const updateExportSettings = (value: ExportSettings) => {
  exportSettings.value = {
    ...value,
    fields: [...value.fields]
  };
  persistExportSettings();
};

const openExportModal = () => {
  if (!hasExportableResults.value) return;
  showExportModal.value = true;
};

const closeExportModal = () => {
  showExportModal.value = false;
};

type ExportRow = Record<ExportField, string>;
type FixedExportFields = 'url' | 'password';
type FullExportRow = ExportRow & Record<FixedExportFields, string> & { diskTypeKey: string; diskType: string };
type ExportLinkBuildResult = {
  url: string;
  passwordIncluded: boolean;
};

const sanitizeFileNamePart = (value: string) => {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 48);
};

const normalizePasswordText = (value: string) => {
  return value.trim().toLowerCase();
};

const isPasswordEmbeddedInUrl = (url: string, password: string) => {
  if (!url || !password) return false;

  const normalizedPassword = normalizePasswordText(password);
  if (!normalizedPassword) return false;

  const candidates = new Set<string>([url]);

  try {
    candidates.add(decodeURIComponent(url));
  } catch {}

  try {
    candidates.add(decodeURI(url));
  } catch {}

  return Array.from(candidates).some(candidate => candidate.toLowerCase().includes(normalizedPassword));
};

const buildUrlWithQueryParam = (url: string, key: string, password: string) => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(key, password);
    return parsed.toString();
  } catch {
    const connector = url.includes('?') ? '&' : '?';
    return `${url}${connector}${key}=${encodeURIComponent(password)}`;
  }
};

const buildIntegratedExportUrl = (diskTypeKey: string, url: string, password: string): ExportLinkBuildResult => {
  if (!url || !password) {
    return { url, passwordIncluded: !password };
  }

  if (isPasswordEmbeddedInUrl(url, password)) {
    return { url, passwordIncluded: true };
  }

  const ruleMap: Record<string, string | null> = {
    baidu: 'pwd',
    tianyi: 'pwd',
    mobile: 'pwd',
    '123': 'pwd',
    aliyun: 'password',
    quark: 'pwd',
    uc: 'pwd',
    xunlei: 'pwd',
    pikpak: 'pwd'
  };

  const paramName = ruleMap[diskTypeKey];
  if (paramName) {
    return {
      url: buildUrlWithQueryParam(url, paramName, password),
      passwordIncluded: true
    };
  }

  return {
    url,
    passwordIncluded: false
  };
};

const buildCombinedLinkLine = (row: FullExportRow) => {
  const integrated = buildIntegratedExportUrl(row.diskTypeKey, row.url, row.password);

  if (integrated.passwordIncluded || !row.password) {
    return integrated.url;
  }

  return `${integrated.url} 提取码:${row.password}`;
};

const buildExportRows = () => {
  const rows: FullExportRow[] = [];
  const selectedSet = new Set((exportSettings.value.selectedDiskTypes || []).filter(Boolean));

  Object.entries(searchResults.mergedResults || {}).forEach(([diskTypeKey, items]) => {
    if (!Array.isArray(items)) return;
    if (!exportSettings.value.allDiskTypesSelected && !selectedSet.has(diskTypeKey)) return;

    items.forEach((item, index) => {
      const row: FullExportRow = {
        diskTypeKey,
        diskType: getDiskTypeName(diskTypeKey),
        sequence: String(index + 1),
        title: item.note || '',
        url: item.url || '',
        password: item.password || '',
        source: item.source || '',
        datetime: item.datetime || ''
      };

      rows.push(row);
    });
  });

  return rows;
};

const buildExportRecord = (row: FullExportRow, selectedFields: ExportField[]) => {
  const integrated = buildIntegratedExportUrl(row.diskTypeKey, row.url, row.password);
  const record = selectedFields.reduce<Record<string, string>>((record, field) => {
    record[field] = row[field] || '';
    return record;
  }, {
    url: integrated.url
  });

  if (row.password && !integrated.passwordIncluded) {
    record.password = row.password;
  }

  return record;
};

const buildTxtValueLines = (row: FullExportRow, fields: ExportField[]) => {
  const values: string[] = [];

  fields.forEach(field => {
    const value = row[field] || '';
    if (value) {
      values.push(value);
    }
  });

  values.push(buildCombinedLinkLine(row));

  return values.join('\n');
};

const buildJsonExportContent = (rows: FullExportRow[]) => {
  const selectedFields = exportSettings.value.fields;
  const groupedRows = rows.reduce<Record<string, FullExportRow[]>>((acc, row) => {
    if (!acc[row.diskType]) acc[row.diskType] = [];
    acc[row.diskType].push(row);
    return acc;
  }, {});

  const payload = Object.entries(groupedRows).reduce<Record<string, Array<Record<string, string>>>>((acc, [diskType, groupRows]) => {
    acc[diskType] = groupRows.map(row => buildExportRecord(row, selectedFields));
    return acc;
  }, {});

  const meta = {
    keyword: lastSearchParams.value?.kw || '',
    total: searchResults.total,
    exportedAt: new Date().toISOString(),
    fields: [...selectedFields, 'url', 'password'],
    groupedByDiskType: true,
    diskTypes: exportSettings.value.allDiskTypesSelected
      ? ['all']
      : exportSettings.value.selectedDiskTypes
  };

  return JSON.stringify(
    {
      meta,
      results: payload,
      flatResults: rows.map(row => buildExportRecord(row, selectedFields))
    },
    null,
    exportSettings.value.prettyJson ? 2 : 0
  );
};

const fieldLabelMap: Record<ExportField | FixedExportFields, string> = {
  sequence: '序号',
  title: '标题',
  url: '链接',
  password: '提取码',
  source: '来源',
  datetime: '时间'
};

const buildTxtRow = (row: FullExportRow, fields: ExportField[]) => {
  if (!exportSettings.value.includeFieldLabels) {
    return buildTxtValueLines(row, fields);
  }

  const lines = fields.map(field => `${fieldLabelMap[field]}: ${row[field] || '无'}`);
  lines.push(`${fieldLabelMap.url}: ${buildCombinedLinkLine(row)}`);

  return lines.join('\n');
};

const buildTxtExportContent = (rows: FullExportRow[]) => {
  const blocks: string[] = [];
  const fields = exportSettings.value.fields;

  const grouped = rows.reduce<Record<string, FullExportRow[]>>((acc, row) => {
    if (!acc[row.diskType]) acc[row.diskType] = [];
    acc[row.diskType].push(row);
    return acc;
  }, {});

  Object.entries(grouped).forEach(([diskType, groupRows]) => {
    blocks.push(`${diskType} (${groupRows.length})`);
    blocks.push(groupRows.map((row) => buildTxtRow(row, fields)).join('\n\n'));
  });

  return blocks.filter(Boolean).join('\n\n');
};

const downloadContent = (content: string, fileName: string, mimeType: string) => {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const handleExportConfirm = () => {
  if (!hasExportableResults.value) return;

  persistExportSettings();

  const rows = buildExportRows();
  const keyword = sanitizeFileNamePart(lastSearchParams.value?.kw || 'results');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (exportSettings.value.format === 'json') {
    const content = buildJsonExportContent(rows);
    downloadContent(content, `pansou-${keyword}-${timestamp}.json`, 'application/json');
  } else {
    const content = buildTxtExportContent(rows);
    downloadContent(content, `pansou-${keyword}-${timestamp}.txt`, 'text/plain');
  }

  closeExportModal();
};

const updateMobileSearchResultsHeight = () => {
  if (typeof window === 'undefined' || window.innerWidth > 768) {
    mobileSearchResultsHeight.value = '';
    return;
  }

  const resultsBlock = searchResultsBlockRef.value;
  const footer = footerRef.value;

  if (!resultsBlock || !footer) {
    mobileSearchResultsHeight.value = '';
    return;
  }

  const resultsTop = resultsBlock.getBoundingClientRect().top;
  const footerTop = footer.getBoundingClientRect().top;
  const availableHeight = Math.floor(footerTop - resultsTop - 8);

  mobileSearchResultsHeight.value = availableHeight > 0 ? `${availableHeight}px` : '';
};

const syncMobileSearchLayout = () => {
  nextTick(() => {
    updateMobileSearchResultsHeight();
  });
};

watch(
  () => [currentPage.value, hasSearched.value, loading.value, searchResults.total, isActivelySearching.value],
  () => {
    syncMobileSearchLayout();
  },
  { deep: true }
);

// 根据配置计算第二次、第三次搜索的src参数
const calculateSrcForFullSearch = (): 'all' | 'tg' | 'plugin' => {
  try {
    const config = checkConfig();
    const hasChannels = config.channels.length > 0;
    const hasPlugins = config.plugins.length > 0;
    
    // 根据完整配置决定src
    if (hasChannels && hasPlugins) {
      return 'all';     // 都有，使用all（第一次已用tg，现在搜索全部）
    } else if (!hasChannels && hasPlugins) {
      return 'plugin';  // 只有插件
    } else if (hasChannels && !hasPlugins) {
      return 'tg';      // 只有TG频道（理论上不应该走到这里，因为只有TG时不会有后续搜索）
    }
    return 'all';       // 默认
  } catch (err) {
    console.error('计算src参数失败:', err);
    return 'all';
  }
};

// 开始第二次搜索
const startSecondAllSearch = (firstSearchCompleteTime: number) => {
  if (!lastSearchParams.value) return;
  
  isUpdating.value = true;
  isActivelySearching.value = true;
  updateCount.value = 1;
  
  // 第二次搜索：根据完整配置设置src
  const src = calculateSrcForFullSearch();
  const userParams: SearchParams = { 
    ...lastSearchParams.value,
    src: src  // 使用完整配置的src
  };
  
  // 计算需要等待的时间，确保与第一次搜索至少间隔2秒
  const currentTime = Date.now();
  const timeElapsedSinceFirstSearch = currentTime - firstSearchCompleteTime;
  const delayForSecondSearch = Math.max(0, 2000 - timeElapsedSinceFirstSearch);
  
  // 执行第二次搜索
  const executeSecondSearch = async () => {
    if (!lastSearchParams.value) {
      stopUpdate();
      return;
    }
    
    try {
      const response = await search(userParams);
      
      // 更新结果
      if (response && response.total >= searchResults.total) {
        updateSearchResults(response);
      }
      
      // 记录第二次搜索完成时间
      const secondSearchCompleteTime = Date.now();
      
      // 开始第三次搜索
      startThirdAllSearch(secondSearchCompleteTime);
    } catch (error) {
      console.error('第二次搜索出错:', error);
      stopUpdate();
    }
  };
  
  // 设置定时器，在适当的时间执行第二次搜索
  secondSearchTimeout.value = window.setTimeout(executeSecondSearch, delayForSecondSearch);
};

// 开始第三次搜索
const startThirdAllSearch = (secondSearchCompleteTime: number) => {
  if (!lastSearchParams.value) return;
  
  updateCount.value = 2;
  
  // 第三次搜索：根据完整配置设置src
  const src = calculateSrcForFullSearch();
  const userParams: SearchParams = { 
    ...lastSearchParams.value,
    src: src  // 使用完整配置的src
  };
  
  // 计算需要等待的时间，确保与第二次搜索至少间隔3秒
  const currentTime = Date.now();
  const timeElapsedSinceSecondSearch = currentTime - secondSearchCompleteTime;
  const delayForThirdSearch = Math.max(0, 3000 - timeElapsedSinceSecondSearch);
  
  // 执行第三次搜索
  const executeThirdSearch = async () => {
    if (!lastSearchParams.value) {
      stopUpdate();
      return;
    }
    
    try {
      const response = await search(userParams);
      
      // 更新结果
      if (response && response.total >= searchResults.total) {
        updateSearchResults(response);
      }
      
      // 记录第三次搜索完成时间
      const thirdSearchCompleteTime = Date.now();
      
      // 检查是否需要第四次搜索（只有启用插件时才需要）
      const config = checkConfig();
      const hasPlugins = config.plugins.length > 0;
      
      if (hasPlugins) {
        // 开始第四次搜索
        startFourthAllSearch(thirdSearchCompleteTime);
      } else {
        // 没有插件，完成所有搜索
        stopUpdate();
      }
    } catch (error) {
      console.error('第三次搜索出错:', error);
      stopUpdate();
    }
  };
  
  // 设置定时器，在适当的时间执行第三次搜索
  thirdSearchTimeout.value = window.setTimeout(executeThirdSearch, delayForThirdSearch);
};

// 开始第四次搜索
const startFourthAllSearch = (thirdSearchCompleteTime: number) => {
  if (!lastSearchParams.value) return;
  
  updateCount.value = 3;
  
  // 第四次搜索：根据完整配置设置src
  const src = calculateSrcForFullSearch();
  const userParams: SearchParams = { 
    ...lastSearchParams.value,
    src: src  // 使用完整配置的src
  };
  
  // 计算需要等待的时间，确保与第三次搜索至少间隔3秒
  const currentTime = Date.now();
  const timeElapsedSinceThirdSearch = currentTime - thirdSearchCompleteTime;
  const delayForFourthSearch = Math.max(0, 3000 - timeElapsedSinceThirdSearch);
  
  // 执行第四次搜索
  const executeFourthSearch = async () => {
    if (!lastSearchParams.value) {
      stopUpdate();
      return;
    }
    
    try {
      const response = await search(userParams);
      
      // 更新结果
      if (response && response.total >= searchResults.total) {
        updateSearchResults(response);
      }
    } catch (error) {
      console.error('第四次搜索出错:', error);
    } finally {
      // 完成所有搜索，停止更新
      stopUpdate();
    }
  };
  
  // 设置定时器，在适当的时间执行第四次搜索
  fourthSearchTimeout.value = window.setTimeout(executeFourthSearch, delayForFourthSearch);
};

// 停止后台更新
const stopUpdate = () => {
  // 清除所有定时器
  if (updateTimer.value) {
    clearInterval(updateTimer.value);
    updateTimer.value = null;
  }
  
  if (secondSearchTimeout.value) {
    clearTimeout(secondSearchTimeout.value);
    secondSearchTimeout.value = null;
  }
  
  if (thirdSearchTimeout.value) {
    clearTimeout(thirdSearchTimeout.value);
    thirdSearchTimeout.value = null;
  }
  
  if (fourthSearchTimeout.value) {
    clearTimeout(fourthSearchTimeout.value);
    fourthSearchTimeout.value = null;
  }
  
  // 标记搜索已结束
  isUpdating.value = false;
  isActivelySearching.value = false;
};

// 切换到搜索页面（保持搜索结果）
const switchToSearch = () => {
  currentPage.value = 'search';
};

// 重置到初始页面（清空搜索结果，仅在必要时使用）
const resetToInitial = () => {
  // 停止之前的更新
  stopUpdate();
  
  // 切换到搜索页面
  currentPage.value = 'search';
  
  // 重置所有状态
  hasSearched.value = false;
  isActivelySearching.value = false;
  loading.value = false;
  searchResults.total = 0;
  searchResults.mergedResults = {};
  searchTime.value = undefined;
  isUpdating.value = false;
  updateCount.value = 0;
};

// 检查认证状态（使用缓存的健康状态，避免重复调用API）
const checkAuth = async () => {
  try {
    // 使用缓存的健康状态，避免重复调用 /health
    const authEnabled = backendHealth.value?.auth_enabled || false;
    const token = localStorage.getItem('auth_token');
    
    if (!authEnabled) {
      // 认证未启用，不显示任何登录相关信息
      isAuthenticated.value = false;
      showLogin.value = false;
      return;
    }
    
    if (!token) {
      // 需要认证但没有token
      showLogin.value = true;
      isAuthenticated.value = false;
      return;
    }
    
    // 验证token是否有效
    const valid = await verifyToken();
    if (valid) {
      isAuthenticated.value = true;
      currentUsername.value = localStorage.getItem('auth_username') || '';
    } else {
      showLogin.value = true;
      isAuthenticated.value = false;
    }
  } catch (error) {
    console.error('检查认证状态失败:', error);
    // 出错时默认显示登录窗口
    showLogin.value = true;
    isAuthenticated.value = false;
  }
};

// 监听401事件
const handleAuthRequired = () => {
  showLogin.value = true;
};

// 登录成功处理
const handleLoginSuccess = () => {
  window.location.reload();
};

// 退出登录
const handleLogout = async () => {
  if (confirm('确定要退出登录吗？')) {
    await logout();
    window.location.reload();
  }
};

// 检查QQPD插件是否显示（后端支持时默认显示，除非用户主动禁用）
const checkQQPDPlugin = () => {
  try {
    // 1. 检查后端是否支持QQPD（使用缓存的健康状态）
    const backendSupportsQQPD = backendHealth.value?.plugins?.includes('qqpd') || false;
    
    // 2. 如果后端不支持，直接隐藏
    if (!backendSupportsQQPD) {
      isQQPDEnabled.value = false;
      return;
    }
    
    // 3. 检查用户配置
    try {
      const savedPlugins = localStorage.getItem('pansou_plugins');
      
      if (savedPlugins === null) {
        // 用户从未保存过配置，默认启用（后端支持即显示）
        isQQPDEnabled.value = true;
      } else {
        // 用户保存过配置，按用户配置来
        const plugins = JSON.parse(savedPlugins);
        isQQPDEnabled.value = Array.isArray(plugins) && plugins.includes('qqpd');
      }
    } catch (err) {
      console.error('读取用户插件配置失败:', err);
      // 解析失败时，默认启用
      isQQPDEnabled.value = true;
    }
  } catch (error) {
    console.error('检查QQPD插件失败:', error);
    isQQPDEnabled.value = false;
  }
};

// 检查Gying插件是否启用
const checkGyingPlugin = () => {
  try {
    // 1. 检查后端是否支持Gying（使用缓存的健康状态）
    const backendSupportsGying = backendHealth.value?.plugins?.includes('gying') || false;
    
    // 2. 如果后端不支持，直接隐藏
    if (!backendSupportsGying) {
      isGyingEnabled.value = false;
      return;
    }
    
    // 3. 检查用户配置
    try {
      const savedPlugins = localStorage.getItem('pansou_plugins');
      
      if (savedPlugins === null) {
        // 用户从未保存过配置，默认启用（后端支持即显示）
        isGyingEnabled.value = true;
      } else {
        // 用户保存过配置，按用户配置来
        const plugins = JSON.parse(savedPlugins);
        isGyingEnabled.value = Array.isArray(plugins) && plugins.includes('gying');
      }
    } catch (err) {
      console.error('读取用户插件配置失败:', err);
      // 解析失败时，默认启用
      isGyingEnabled.value = true;
    }
  } catch (error) {
    console.error('检查Gying插件失败:', error);
    isGyingEnabled.value = false;
  }
};

// 检查盘链插件是否启用
const checkPanlianPlugin = () => {
  try {
    const backendSupportsPanlian = backendHealth.value?.plugins?.includes('panlian') || false;

    if (!backendSupportsPanlian) {
      isPanlianEnabled.value = false;
      return;
    }

    try {
      const savedPlugins = localStorage.getItem('pansou_plugins');

      if (savedPlugins === null) {
        isPanlianEnabled.value = true;
      } else {
        const plugins = JSON.parse(savedPlugins);
        isPanlianEnabled.value = Array.isArray(plugins) && plugins.includes('panlian');
      }
    } catch (err) {
      console.error('读取用户插件配置失败:', err);
      isPanlianEnabled.value = true;
    }
  } catch (error) {
    console.error('检查Panlian插件失败:', error);
    isPanlianEnabled.value = false;
  }
};

// 检查Weibo插件是否启用
const checkWeiboPlugin = () => {
  try {
    const backendSupportsWeibo = backendHealth.value?.plugins?.includes('weibo') || false;
    
    if (!backendSupportsWeibo) {
      isWeiboEnabled.value = false;
      return;
    }
    
    try {
      const savedPlugins = localStorage.getItem('pansou_plugins');
      
      if (savedPlugins === null) {
        isWeiboEnabled.value = true;
      } else {
        const plugins = JSON.parse(savedPlugins);
        isWeiboEnabled.value = Array.isArray(plugins) && plugins.includes('weibo');
      }
    } catch (err) {
      console.error('读取用户插件配置失败:', err);
      isWeiboEnabled.value = true;
    }
  } catch (error) {
    console.error('检查Weibo插件失败:', error);
    isWeiboEnabled.value = false;
  }
};

// 监听localStorage变化，当用户配置改变时更新插件状态
const handleStorageChange = (e: StorageEvent) => {
  // 只关心插件配置的变化
  if (e.key === 'pansou_plugins') {
    checkQQPDPlugin();
    checkGyingPlugin();
    checkPanlianPlugin();
    checkWeiboPlugin();
  }
};

// 自定义事件：当用户在配置页保存设置时触发
const handleConfigSaved = () => {
  checkQQPDPlugin();
  checkGyingPlugin();
  checkPanlianPlugin();
  checkWeiboPlugin();
};

// 强制刷新处理
const handleForceRefresh = () => {
  if (loading.value) return;
  forceRefreshPending = true;
  // 复用handleSearch最近一次参数
  if (lastSearchParams.value) {
    handleSearch({ ...lastSearchParams.value });
  }
};

// 组件加载时初始化
onMounted(async () => {
  // 首先初始化后端健康状态（只调用一次）
  await initBackendHealth();
  loadExportSettings();
  syncMobileSearchLayout();
  
  // 然后初始化其他状态
  checkAuth();
  checkQQPDPlugin();
  checkGyingPlugin();
  checkPanlianPlugin();
  checkWeiboPlugin();
  
  // 监听事件
  window.addEventListener('auth:required', handleAuthRequired);
  window.addEventListener('storage', handleStorageChange);
  window.addEventListener('config:saved', handleConfigSaved);
  window.addEventListener('resize', syncMobileSearchLayout);
});

onUnmounted(() => {
  // 确保在组件卸载时清理所有定时器和事件监听
  stopUpdate();
  window.removeEventListener('auth:required', handleAuthRequired);
  window.removeEventListener('storage', handleStorageChange);
  window.removeEventListener('config:saved', handleConfigSaved);
  window.removeEventListener('resize', syncMobileSearchLayout);
});
</script>

<template>
  <div class="app-shell min-h-screen bg-background text-foreground transition-colors duration-300 flex flex-col">
    <!-- 登录对话框 -->
    <LoginDialog 
      v-model:visible="showLogin" 
      @success="handleLoginSuccess"
    />
    
    <!-- 背景装饰 -->
    <div class="bg-decorative"></div>
    
    <!-- 导航栏 -->
    <nav ref="navHeaderRef" class="nav-header backdrop-blur-md bg-background/80 border-b border-border">
      <div class="container mx-auto px-4 h-16 flex items-center justify-between">
        <div class="flex items-center gap-3 cursor-pointer" @click="switchToSearch">
          <div class="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
          </div>
          <div>
            <h1 class="text-xl font-bold">PanSou</h1>
          </div>
        </div>
        
        <!-- 导航菜单 -->
        <nav class="flex items-center gap-2">
          <button 
            @click="switchToSearch"
            class="nav-button"
            :class="{ 'active': currentPage === 'search' }"
            title="搜索"
          >
            <span class="nav-icon">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
              </svg>
            </span>
            <span class="nav-text">搜索</span>
          </button>
          <button 
            @click="switchToStatus"
            class="nav-button"
            :class="{ 'active': currentPage === 'status' }"
            title="配置"
          >
            <span class="nav-icon">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
            </span>
            <span class="nav-text">配置</span>
          </button>
          <button 
            @click="switchToDocs"
            class="nav-button"
            :class="{ 'active': currentPage === 'docs' }"
            title="API文档"
          >
            <span class="nav-icon">
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <!-- 文档外框 -->
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 2v6h6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <!-- API文字 -->
                <text x="12" y="15" font-size="6" font-weight="bold" text-anchor="middle" fill="currentColor" font-family="Arial, sans-serif">API</text>
              </svg>
            </span>
            <span class="nav-text">API</span>
          </button>
          <button 
            v-if="hasAccountServices"
            @click="switchToAccounts"
            class="nav-button"
            :class="{ 'active': currentPage === 'accounts' || currentPage === 'qqpd' || currentPage === 'gying' || currentPage === 'panlian' || currentPage === 'weibo' }"
            title="账号管理"
          >
            <span class="nav-icon">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
              </svg>
            </span>
            <span class="nav-text">账号</span>
          </button>
          <button 
            v-if="isAuthenticated"
            @click="handleLogout"
            class="nav-button logout-button"
            :title="'退出登录 (当前用户: ' + currentUsername + ')'"
          >
            <span class="nav-icon">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
              </svg>
            </span>
            <span class="nav-text">退出</span>
          </button>
        </nav>
      </div>
    </nav>
    
    <!-- 主要内容区域 -->
    <main
      ref="mainContentRef"
      class="main-content container mx-auto px-4 py-8 flex-1"
      :class="{ 'search-main': currentPage === 'search' }"
    >
      <!-- 搜索页面 -->
      <div v-if="currentPage === 'search'" class="search-page">
        <!-- 搜索表单 -->
        <div class="search-form-block mb-6">
          <SearchForm
            :backend-health="backendHealth"
            :health-ready="healthReady"
            @search="handleSearch"
            @search-complete="handleSearchComplete"
          />
        </div>
        
        <!-- 搜索统计 -->
        <div v-if="hasSearched || loading" class="search-stats-block mb-6">
          <SearchStats 
            :total="searchResults.total || 0" 
            :mergedResults="searchResults.mergedResults || {}" 
            :loading="loading"
            :searchTime="searchTime"
            :isUpdating="isUpdating"
            :updateCount="updateCount"
            :canExport="hasExportableResults"
            @export-results="openExportModal"
            @force-refresh="handleForceRefresh"
          />
        </div>
        
        <!-- 加载状态 -->
        <div v-if="loading" class="search-loading-block card p-6">
          <div class="space-y-3">
            <div class="h-4 bg-muted rounded animate-pulse"></div>
            <div class="h-4 bg-muted rounded animate-pulse w-3/4"></div>
            <div class="h-4 bg-muted rounded animate-pulse w-1/2"></div>
            <div class="h-4 bg-muted rounded animate-pulse w-2/3"></div>
            <div class="h-4 bg-muted rounded animate-pulse"></div>
          </div>
        </div>
        
        <!-- 搜索结果 -->
        <div
          v-else
          ref="searchResultsBlockRef"
          class="search-results-block"
          :style="mobileSearchResultsHeight ? {
            height: mobileSearchResultsHeight,
            minHeight: mobileSearchResultsHeight,
            maxHeight: mobileSearchResultsHeight
          } : undefined"
        >
          <ResultTabs 
            :mergedResults="searchResults.mergedResults || {}" 
            :loading="loading"
            :hasSearched="hasSearched"
            :isActivelySearching="isActivelySearching"
          />
        </div>

        <ExportResultsModal
          :visible="showExportModal"
          :total="searchResults.total || 0"
          :settings="exportSettings"
          :available-disk-types="exportableDiskTypes"
          @close="closeExportModal"
          @update:settings="updateExportSettings"
          @confirm="handleExportConfirm"
        />
      </div>
      
      <!-- 配置页面 -->
      <div v-else-if="currentPage === 'status'" class="status-page">
        <SearchConfig :backend-health="backendHealth" />
      </div>
      
      <!-- API文档页面 -->
      <div v-else-if="currentPage === 'docs'" class="docs-page">
        <ApiDocs />
      </div>
      
      <!-- 账号管理中心页面 -->
      <div v-else-if="currentPage === 'accounts'" class="accounts-page">
        <AccountCenter 
          :backend-health="backendHealth"
          @navigate="handleAccountNavigate"
        />
      </div>
      
      <!-- QQ频道管理页面 -->
      <div v-else-if="currentPage === 'qqpd'" class="qqpd-page">
        <QQPDManager @back-to-center="switchToAccounts" />
      </div>
      
      <!-- 观影管理页面 -->
      <div v-else-if="currentPage === 'gying'" class="gying-page">
        <GyingManager @back-to-center="switchToAccounts" />
      </div>

      <div v-else-if="currentPage === 'panlian'" class="panlian-page">
        <PanlianManager @back-to-center="switchToAccounts" />
      </div>
      
      <!-- 微博管理页面 -->
      <div v-else-if="currentPage === 'weibo'" class="weibo-page">
        <WeiboManager @back-to-center="switchToAccounts" />
      </div>
    </main>
    
    <!-- 页脚 -->
    <footer ref="footerRef" class="footer-shell border-t border-border bg-background/50 backdrop-blur-sm mt-auto">
      <div class="container mx-auto px-4 py-4">
        <div class="flex items-center justify-center gap-4 text-sm text-muted-foreground">
          <span>© {{ new Date().getFullYear() }}-{{ new Date().getFullYear() + 10 }}</span>
          <a href="https://dm.xueximeng.com/" target="_blank" rel="noopener noreferrer" class="hover:text-foreground transition-colors">美漫资源共建</a>
          <a href="/report.html" target="_blank" rel="noopener noreferrer" class="hover:text-foreground transition-colors">实时监控</a>
          <a href="https://github.com/fish2018" target="_blank" rel="noopener noreferrer" class="hover:text-foreground transition-colors">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
          </a>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.bg-decorative {
  position: fixed;
  inset: 0;
  z-index: -10;
  background-image: radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground)) 1px, transparent 0);
  background-size: 20px 20px;
  opacity: 0.1;
}

.nav-header {
  position: sticky;
  top: 0;
  z-index: 50;
}

/* 导航按钮样式 */
.nav-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: transparent;
  color: hsl(var(--muted-foreground));
  border: 1px solid hsl(var(--border));
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-button:hover {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
  border-color: hsl(var(--accent));
}

.nav-button.active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--primary));
}

.logout-button {
  border-color: hsl(0, 84%, 60%);
  color: hsl(0, 84%, 60%);
}

.logout-button:hover {
  background: hsl(0, 84%, 95%);
  border-color: hsl(0, 84%, 60%);
  color: hsl(0, 84%, 50%);
}

@media (prefers-color-scheme: dark) {
  .logout-button:hover {
    background: hsl(0, 84%, 20%);
    color: hsl(0, 84%, 90%);
  }
}



.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-text {
  white-space: nowrap;
}

/* 页面切换动画 */
.search-page, .status-page {
  animation: fadeIn 0.3s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 768px) {
  .app-shell {
    --mobile-footer-height: calc(3.15rem + env(safe-area-inset-bottom));
    height: 100dvh;
    min-height: 100dvh;
    overflow: hidden;
  }

  .main-content {
    flex: 1 1 auto;
    height: calc(100dvh - 4rem - var(--mobile-footer-height));
    min-height: 0;
    box-sizing: border-box;
    padding-top: 2rem;
    padding-bottom: 0.5rem;
    overflow: hidden;
    overflow-x: hidden;
  }

  .main-content:not(.search-main) {
    overflow-y: auto;
  }

  .footer-shell {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    min-height: var(--mobile-footer-height);
    margin-top: 0 !important;
  }

  .footer-shell .container {
    box-sizing: border-box;
    padding-top: 0.2rem;
    padding-bottom: calc(0.2rem + env(safe-area-inset-bottom));
    min-height: var(--mobile-footer-height);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .footer-shell .container > div {
    gap: 1rem;
    font-size: 0.875rem;
    line-height: 1.25;
    flex-wrap: nowrap;
    align-items: center;
  }

  .search-page {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    gap: 1rem;
  }

  .search-form-block,
  .search-stats-block,
  .search-loading-block {
    margin-bottom: 0 !important;
    min-height: 0;
  }

  .search-results-block {
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .container {
    padding-left: 1rem;
    padding-right: 1rem;
  }
  
  /* 移动端按钮样式 - 只显示图标 */
  .nav-button {
    padding: 0.5rem;
    font-size: 0.8rem;
    min-width: 2.5rem;
    justify-content: center;
  }
  
  /* 移动端隐藏按钮文字 */
  .nav-text {
    display: none;
  }
}

/* 页脚按钮样式 */
footer button {
  background: transparent;
  border: none;
  padding: 0;
  font-size: inherit;
  color: inherit;
  cursor: pointer;
}
</style>
