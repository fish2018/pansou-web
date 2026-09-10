<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { SearchParams } from '@/api';
import type { HealthStatus } from '@/api';
import type { FilterConfig } from '@/types';
import { Button, Input, Icons } from '@/components/ui';
import FilterIcon from '@/components/icons/FilterIcon.vue';
import { parseSearchQuery, writeSearchQuery } from '@/utils/searchQuery';

const keyword = ref('');
const loading = ref(false);
const showAdvanced = ref(false);
const includeKeywords = ref('');
const excludeKeywords = ref('');

// 是否已根据 URL 参数自动搜索过（避免重复触发）
const autoSearched = ref(false);

// 接收后端健康状态作为 props
const props = defineProps<{
  backendHealth: HealthStatus | null;
  // 后端健康状态是否已获取完毕（成功或失败），用于决定何时可以自动搜索
  healthReady?: boolean;
}>();

const emit = defineEmits<{
  (e: 'search', params: SearchParams): void;
  (e: 'searchComplete'): void;
}>();

// 从配置中加载用户设置和后端默认配置
const loadUserConfig = () => {
  try {
    const savedChannels = localStorage.getItem('pansou_channels');
    const savedPlugins = localStorage.getItem('pansou_plugins');
    const savedDiskTypes = localStorage.getItem('pansou_disk_types');
    
    // 如果用户已手动设置，使用用户设置
    if (savedChannels !== null || savedPlugins !== null) {
      return {
        channels: savedChannels ? JSON.parse(savedChannels) : [],
        plugins: savedPlugins ? JSON.parse(savedPlugins) : [],
        cloudTypes: savedDiskTypes ? JSON.parse(savedDiskTypes) : undefined
      };
    }
    
    // 如果用户未设置，使用传入的后端配置
    if (props.backendHealth) {
      return {
        channels: props.backendHealth.channels || [],
        plugins: props.backendHealth.plugins || [],
        cloudTypes: savedDiskTypes ? JSON.parse(savedDiskTypes) : undefined
      };
    }
    
    return {
      channels: [],
      plugins: [],
      cloudTypes: undefined
    };
  } catch (err) {
    console.error('加载配置失败:', err);
    return {
      channels: [],
      plugins: [],
      cloudTypes: undefined
    };
  }
};

const handleSearch = () => {
  if (!keyword.value.trim()) {
    return;
  }
  
  loading.value = true;
  
  // 加载配置（用户设置或后端默认缓存）
  const userConfig = loadUserConfig();
  
  // 判断有哪些数据源
  const hasChannels = userConfig.channels && userConfig.channels.length > 0;
  const hasPlugins = userConfig.plugins && userConfig.plugins.length > 0;
  
  // 根据搜索逻辑决定第一次搜索的src参数：
  // 1. 如果同时启用了tg和plugin，第一次只搜索tg
  // 2. 如果只启用了tg，搜索tg
  // 3. 如果只启用了plugin，搜索plugin
  // 4. 如果都没有，使用all（兜底）
  let src: 'all' | 'tg' | 'plugin' = 'all';
  if (hasChannels && hasPlugins) {
    src = 'tg';  // 同时启用，第一次只搜索tg（快速）
  } else if (hasChannels && !hasPlugins) {
    src = 'tg';  // 只启用tg
  } else if (!hasChannels && hasPlugins) {
    src = 'plugin';  // 只启用plugin
  }
  
  const params: SearchParams = {
    kw: keyword.value,
    res: 'merge',
    src: src
  };
  
  // 添加用户配置的参数
  if (hasChannels) {
    // 将频道数组转为逗号分隔的字符串
    (params as any).channels = userConfig.channels.join(',');
  }
  
  if (hasPlugins) {
    params.plugins = userConfig.plugins.join(',');
  }
  
  if (userConfig.cloudTypes && userConfig.cloudTypes.length > 0) {
    // 将网盘类型数组转为逗号分隔的字符串
    (params as any).cloud_types = userConfig.cloudTypes.join(',');
  }
  
  // 添加过滤配置（使用后端filter参数格式）
  const filterConfig: FilterConfig = {};
  if (includeKeywords.value.trim()) {
    filterConfig.include = includeKeywords.value.split(/[,\s]+/).filter(k => k.trim());
  }
  if (excludeKeywords.value.trim()) {
    filterConfig.exclude = excludeKeywords.value.split(/[,\s]+/).filter(k => k.trim());
  }
  if (filterConfig.include || filterConfig.exclude) {
    (params as any).filter = JSON.stringify(filterConfig);
  }

  // 把当前搜索条件同步到地址栏，方便复制分享和刷新保留
  writeSearchQuery({
    keyword: keyword.value,
    include: includeKeywords.value,
    exclude: excludeKeywords.value
  });

  emit('search', params);
  
  // 2秒后重置loading状态
  setTimeout(() => {
    loading.value = false;
    // 不再触发searchComplete事件
  }, 2000);
};

// 从 URL 读取搜索条件并填入表单
onMounted(() => {
  const query = parseSearchQuery();

  keyword.value = query.keyword;
  includeKeywords.value = query.include;
  excludeKeywords.value = query.exclude;

  // 带了过滤条件时展开高级面板，让生效的过滤项可见
  if (query.include || query.exclude) {
    showAdvanced.value = true;
  }
});

// 自动搜索要等后端健康状态就绪：子组件 onMounted 早于父组件，
// 此时 backendHealth 必然为 null，直接搜索会让未配置过的用户拿到与手动搜索不同的结果。
// healthReady 在应用生命周期内只会 false -> true 一次，且必然晚于本组件首次挂载，
// 因此这里不需要 immediate；切换页面后重新挂载时也不会重复搜索
watch(() => props.healthReady, (ready) => {
  if (!ready || autoSearched.value || !keyword.value.trim()) {
    return;
  }

  autoSearched.value = true;
  handleSearch();
});
</script>

<template>
  <div class="w-full max-w-content mx-auto">
    <div class="search-container">
      <!-- 主搜索框 -->
      <div class="relative w-full">
        <div class="relative flex flex-row items-center w-full">
          <div class="relative w-full">
            <!-- 筛选按钮（最左侧） -->
            <button
              type="button"
              @click="showAdvanced = !showAdvanced"
              :class="[
                'advanced-toggle-left',
                showAdvanced && 'active',
                (includeKeywords.trim() || excludeKeywords.trim()) && 'has-filter'
              ]"
              title="高级筛选"
            >
              <FilterIcon :size="16" />
            </button>
            <input
              v-model="keyword"
              type="text"
              placeholder="搜索资源、电影、音乐、软件..."
              :disabled="loading"
              @keydown.enter="handleSearch"
              class="flex h-10 outline-none focus:outline-none rounded-md border bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 w-full text-center pl-12 pr-12 transition-all duration-300 border-primary/20 hover:border-primary/40 shadow-sm hover:shadow-md focus-visible:shadow-lg focus-visible:ring-primary/30 focus-visible:ring-offset-0 focus-visible:border-primary/60"
            />
            <!-- 搜索按钮 -->
            <button
              type="button"
              @click="handleSearch"
              :disabled="loading || !keyword.trim()"
              class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 w-10 absolute right-0 top-0 h-full rounded-l-none transition-all duration-300 border-0 hover:border hover:border-l-0 hover:border-primary/40 hover:bg-primary hover:text-primary-foreground hover:scale-[1.03]"
            >
              <component 
                :is="loading ? Icons.Loading() : Icons.Send()" 
                :class="[
                  'w-4 h-4',
                  loading && 'animate-spin'
                ]"
              />
            </button>
          </div>
        </div>
      </div>
      
      <!-- 高级选项面板 -->
      <Transition name="slide-down">
        <div v-if="showAdvanced" class="advanced-panel">
          <div class="advanced-content">
            <!-- 包含关键词 -->
            <div class="filter-input-group">
              <label class="filter-label">
                <span class="label-text">包含关键词</span>
                <span class="label-hint">结果中至少包含一个关键词 (OR关系)，多个关键词用空格或英文逗号(,)分隔</span>
              </label>
              <input
                v-model="includeKeywords"
                type="text"
                placeholder="高码 hdr 4k"
                class="filter-input"
                @keydown.enter="handleSearch"
              />
              <div v-if="includeKeywords.trim()" class="filter-preview">
                <span class="preview-label">包含:</span>
                <span 
                  v-for="(word, index) in includeKeywords.split(/[,\s]+/).filter(w => w.trim())" 
                  :key="index"
                  class="filter-tag include"
                >
                  {{ word }}
                </span>
              </div>
            </div>
            
            <!-- 排除关键词 -->
            <div class="filter-input-group">
              <label class="filter-label">
                <span class="label-text">排除关键词</span>
                <span class="label-hint">结果中包含任意一个关键词就排除 (OR关系)，多个关键词用空格或英文逗号(,)分隔</span>
              </label>
              <input
                v-model="excludeKeywords"
                type="text"
                placeholder="预告 花絮 枪版 CAM TS"
                class="filter-input"
                @keydown.enter="handleSearch"
              />
              <div v-if="excludeKeywords.trim()" class="filter-preview">
                <span class="preview-label">排除:</span>
                <span 
                  v-for="(word, index) in excludeKeywords.split(/[,\s]+/).filter(w => w.trim())" 
                  :key="index"
                  class="filter-tag exclude"
                >
                  {{ word }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.search-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
}

/* 高级选项切换按钮（左侧） */
.advanced-toggle-left {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 6px 0 0 6px;
  background: transparent;
  border: none;
  border-right: 1px solid hsl(var(--border));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;
}

.advanced-toggle-left:hover {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

.advanced-toggle-left.active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.advanced-toggle-left.has-filter {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.advanced-toggle-left.has-filter::after {
  content: '';
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  background: hsl(var(--primary));
  border-radius: 50%;
  border: 2px solid hsl(var(--background));
}

/* 高级选项面板 */
.advanced-panel {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  padding: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.advanced-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* 过滤模式选择 */
.filter-mode {
  display: flex;
  gap: 0.75rem;
}

.mode-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  flex: 1;
}

.mode-label:has(.mode-radio:checked) {
  background: hsl(var(--primary) / 0.08);
  border-color: hsl(var(--primary));
}

.mode-label:hover {
  border-color: hsl(var(--primary) / 0.5);
}

.mode-radio {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: hsl(var(--primary));
  margin: 0;
}

.mode-text {
  font-weight: 500;
  color: hsl(var(--foreground));
  font-size: 0.875rem;
}

/* 关键词输入 */
.filter-input-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.filter-label {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.label-text {
  font-weight: 500;
  color: hsl(var(--foreground));
  font-size: 0.875rem;
}

.label-hint {
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

.filter-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 0.875rem;
  transition: all 0.2s ease;
}

.filter-input:focus {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.1);
}

.filter-input::placeholder {
  color: hsl(var(--muted-foreground));
}

/* 过滤预览 */
.filter-preview {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.5rem;
  background: hsl(var(--muted) / 0.3);
  border-radius: 6px;
}

.preview-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.filter-tag {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.75rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.filter-tag.include {
  background: hsl(142, 76%, 36% / 0.1);
  color: hsl(142, 76%, 36%);
  border: 1px solid hsl(142, 76%, 36% / 0.3);
}

.filter-tag.exclude {
  background: hsl(0, 84%, 60% / 0.1);
  color: hsl(0, 84%, 60%);
  border: 1px solid hsl(0, 84%, 60% / 0.3);
}

/* 过渡动画 */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* 响应式 */
@media (max-width: 768px) {
  .advanced-panel {
    padding: 0.75rem;
  }
  
  .filter-mode {
    flex-direction: column;
  }
}

.search-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  margin-bottom: 2rem;
}

.search-input-wrapper {
  position: relative;
  width: 100%;
  flex: 1;
}

.search-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  border: 1px solid #e5e7eb;
  background-color: #fff;
  color: #111827;
  font-size: 1rem;
  outline: none;
  transition: all 0.2s ease;
}

.search-input::placeholder {
  color: #9ca3af;
}

.search-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}

.search-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 1.5rem;
  border-radius: 0.75rem;
  background-color: #3b82f6;
  color: #fff;
  font-weight: 500;
  font-size: 1rem;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.search-button:hover:not(:disabled) {
  background-color: #2563eb;
}

.search-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-spinner {
  display: inline-block;
  width: 1rem;
  height: 1rem;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #fff;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 768px) {
  .search-form {
    flex-direction: row;
    align-items: center;
  }
  
  .search-button {
    width: auto;
    white-space: nowrap;
  }
}
</style> 