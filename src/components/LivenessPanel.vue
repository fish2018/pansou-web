<script setup lang="ts">
// 存活观测面板：把 /api/health 里的 liveness 段落渲染成"一眼看出谁失效"的列表。
//
// 后端按每轮搜索累积、滑动窗口 20 轮统计，判定：
//   failing     窗口内有报错且从未产出 —— 可直接停用
//   degraded    有过产出但失败占比过半
//   zero_yield  没有报错但窗口内零产出 —— 其内容通常经后台补齐进缓存，
//               不代表无数据，界面上也必须把这句话显示出来，避免有人直接删插件
// 组件自己拉取 /api/health，因此可以挂在任何位置，无需父组件传参。
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import type { LivenessItem, LivenessReport } from '@/types';

const liveness = ref<LivenessReport | null>(null);
const loading = ref(true);
const failed = ref<string | null>(null);
const expanded = ref<Record<string, boolean>>({ failing: true, degraded: true });

const fetchLiveness = async () => {
  loading.value = true;
  failed.value = null;
  try {
    const resp = await axios.get('/api/health');
    // 旧版本后端不返回 liveness，按缺失处理即可
    liveness.value = resp.data?.liveness ?? null;
  } catch (e) {
    failed.value = '获取存活观测失败';
    console.error('获取存活观测失败:', e);
  } finally {
    loading.value = false;
  }
};

const pluginGroups = computed(() => {
  const lv = liveness.value;
  if (!lv) return [];
  return [
    {
      key: 'failing',
      title: '一直失败',
      hint: '窗口内有报错且从未产出，可直接停用',
      tone: 'danger',
      items: lv.failing_plugins ?? [],
    },
    {
      key: 'degraded',
      title: '时好时坏',
      hint: '有过产出但失败占比过半',
      tone: 'warn',
      items: lv.degraded_plugins ?? [],
    },
    {
      key: 'zero_yield',
      title: '窗口内零产出',
      hint: '没有报错。内容通常经后台补齐进缓存，不代表无数据，不要据此删除',
      tone: 'muted',
      items: lv.zero_yield_plugins ?? [],
    },
  ].filter((g) => g.items.length > 0);
});

const channelGroups = computed(() => {
  const lv = liveness.value;
  if (!lv) return [];
  return [
    { key: 'chan_failing', title: '一直失败', hint: '', tone: 'danger', items: lv.failing_channels ?? [] },
    { key: 'chan_zero', title: '窗口内零产出', hint: '', tone: 'muted', items: lv.zero_yield_channels ?? [] },
  ].filter((g) => g.items.length > 0);
});

const summaryOf = (status?: Record<string, number>) => {
  const st = status ?? {};
  return [
    { key: 'ok', label: '正常', value: st['ok'] ?? 0, tone: 'ok' },
    { key: 'failing', label: '失效', value: st['failing'] ?? 0, tone: 'danger' },
    { key: 'degraded', label: '降级', value: st['degraded'] ?? 0, tone: 'warn' },
    { key: 'zero_yield', label: '零产出', value: st['zero_yield'] ?? 0, tone: 'muted' },
  ];
};

// 分组标题里的数量：优先用后端的完整计数，并显式提示"还有多少没列出"，
// 避免 40 条上限把超出的条目悄悄藏起来。
const groupLabel = (g: { key: string; items: LivenessItem[] }) => {
  const lv = liveness.value;
  const full: Record<string, number | undefined> = {
    failing: lv?.failing_plugin_count,
    degraded: lv?.degraded_plugin_count,
    zero_yield: lv?.zero_yield_plugin_count,
    chan_failing: lv?.failing_channel_count,
    chan_zero: lv?.zero_yield_channel_count,
  };
  const total = full[g.key] ?? g.items.length;
  if (total > g.items.length) {
    return `共 ${total} · 已列出 ${g.items.length}`;
  }
  return `${g.items.length}`;
};

const itemStat = (it: LivenessItem) => {
  const parts = [`${it.rounds} 轮`];
  if (it.failed > 0) parts.push(`失败 ${it.failed}`);
  if (it.yielded > 0) parts.push(`产出 ${it.yielded}`);
  if (it.zero_yield > 0) parts.push(`零产出 ${it.zero_yield}`);
  return parts.join(' · ');
};

onMounted(fetchLiveness);
defineExpose({ fetchLiveness });
</script>

<template>
  <div class="liveness-panel">
    <div class="liveness-header">
      <h3 class="liveness-title">
        <span>🩺</span>
        存活观测
        <span v-if="liveness" class="liveness-scale">
          {{ liveness.plugin_total }} 插件 / {{ liveness.channel_total }} 频道
        </span>
      </h3>
      <button class="liveness-refresh" :disabled="loading" @click="fetchLiveness">
        {{ loading ? '刷新中...' : '刷新' }}
      </button>
    </div>

    <p v-if="loading && !liveness" class="liveness-msg">获取中...</p>
    <p v-else-if="failed" class="liveness-msg error">{{ failed }}</p>
    <p v-else-if="!liveness" class="liveness-msg">
      当前后端未返回存活观测（旧版本），升级后端后即可看到失效插件与频道。
    </p>

    <template v-else>
      <div class="liveness-block">
        <div class="liveness-block-title">插件</div>
        <div class="liveness-summary">
          <span v-for="s in summaryOf(liveness.plugin_status)" :key="s.key" class="liveness-chip" :class="s.tone">
            {{ s.label }} {{ s.value }}
          </span>
        </div>
        <div v-for="g in pluginGroups" :key="g.key" class="liveness-group">
          <button class="liveness-group-toggle" @click="expanded[g.key] = !expanded[g.key]">
            <span class="toggle-icon" :class="{ expanded: expanded[g.key] }">▶</span>
            {{ g.title }}
            <span class="liveness-group-count" :class="g.tone">{{ groupLabel(g) }}</span>
          </button>
          <p v-if="g.hint" class="liveness-hint">{{ g.hint }}</p>
          <div v-show="expanded[g.key]" class="liveness-list">
            <div v-for="it in g.items" :key="it.name" class="liveness-row">
              <span class="liveness-name">{{ it.name }}</span>
              <span class="liveness-stat">{{ itemStat(it) }}</span>
              <span v-if="it.last_error" class="liveness-err" :title="it.last_error">{{ it.last_error }}</span>
            </div>
          </div>
        </div>
        <p v-if="pluginGroups.length === 0" class="liveness-msg ok">没有需要关注的插件</p>
      </div>

      <div class="liveness-block">
        <div class="liveness-block-title">TG 频道</div>
        <div class="liveness-summary">
          <span v-for="s in summaryOf(liveness.channel_status)" :key="s.key" class="liveness-chip" :class="s.tone">
            {{ s.label }} {{ s.value }}
          </span>
        </div>
        <div v-for="g in channelGroups" :key="g.key" class="liveness-group">
          <button class="liveness-group-toggle" @click="expanded[g.key] = !expanded[g.key]">
            <span class="toggle-icon" :class="{ expanded: expanded[g.key] }">▶</span>
            {{ g.title }}
            <span class="liveness-group-count" :class="g.tone">{{ groupLabel(g) }}</span>
          </button>
          <div v-show="expanded[g.key]" class="liveness-list">
            <div v-for="it in g.items" :key="it.name" class="liveness-row">
              <span class="liveness-name">{{ it.name }}</span>
              <span class="liveness-stat">{{ itemStat(it) }}</span>
            </div>
          </div>
        </div>
        <p v-if="channelGroups.length === 0" class="liveness-msg ok">所有频道均正常</p>
      </div>

      <p v-for="msg in liveness.truncated ?? []" :key="msg" class="liveness-msg warn">⚠️ {{ msg }}</p>
      <p class="liveness-note">{{ liveness.note }}</p>
    </template>
  </div>
</template>

<style scoped>
.liveness-panel {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1rem 1.25rem;
  background: #fff;
  margin-bottom: 1.5rem;
}

.liveness-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.liveness-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 1rem;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
}

.liveness-scale {
  font-size: 0.75rem;
  font-weight: 400;
  color: #94a3b8;
}

.liveness-refresh {
  font-size: 0.78rem;
  padding: 0.25rem 0.7rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #334155;
  cursor: pointer;
}

.liveness-refresh:disabled {
  opacity: 0.6;
  cursor: default;
}

.liveness-block {
  margin-bottom: 1.25rem;
}

.liveness-block-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #475569;
  margin-bottom: 0.5rem;
}

.liveness-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.liveness-chip {
  font-size: 0.75rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
}

.liveness-chip.ok {
  background: #dcfce7;
  color: #15803d;
}

.liveness-chip.danger {
  background: #fee2e2;
  color: #b91c1c;
}

.liveness-chip.warn {
  background: #fef3c7;
  color: #b45309;
}

.liveness-chip.muted {
  background: #e2e8f0;
  color: #475569;
}

.liveness-group {
  margin-bottom: 0.5rem;
}

.liveness-group-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.35rem 0;
  background: none;
  border: none;
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
}

.toggle-icon {
  font-size: 0.7rem;
  transition: transform 0.15s;
}

.toggle-icon.expanded {
  transform: rotate(90deg);
}

.liveness-group-count {
  font-size: 0.72rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
}

.liveness-group-count.danger {
  background: #fee2e2;
  color: #b91c1c;
}

.liveness-group-count.warn {
  background: #fef3c7;
  color: #b45309;
}

.liveness-group-count.muted {
  background: #e2e8f0;
  color: #475569;
}

.liveness-hint {
  font-size: 0.75rem;
  color: #64748b;
  margin: 0.15rem 0 0.35rem;
}

.liveness-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 280px;
  overflow-y: auto;
}

.liveness-row {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.3rem 0.5rem;
  background: #f8fafc;
  border-radius: 6px;
  font-size: 0.78rem;
}

.liveness-name {
  font-weight: 600;
  color: #1e293b;
  min-width: 7rem;
}

.liveness-stat {
  color: #64748b;
  white-space: nowrap;
}

.liveness-err {
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.liveness-note {
  font-size: 0.72rem;
  color: #94a3b8;
  line-height: 1.5;
  margin: 0.5rem 0 0;
  padding-top: 0.5rem;
  border-top: 1px dashed #e2e8f0;
}

.liveness-msg {
  font-size: 0.8rem;
  color: #64748b;
}

.liveness-msg.error {
  color: #b91c1c;
}

.liveness-msg.ok {
  color: #15803d;
}

.liveness-msg.warn {
  color: #b45309;
}
</style>