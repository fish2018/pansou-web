<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import api from '@/api';
import { queuePosterRequest } from '@/utils/posterQueue';

const props = defineProps<{ src?: string; title: string }>();
const imageUrl = ref('');
const failed = ref(false);
const element = ref<HTMLElement | null>(null);
const proxiedPoster = ref(false);
let controller: AbortController | undefined;
let blobUrl = '';
let sourceUrl = '';
let visible = false;
let observer: IntersectionObserver | undefined;

const cancelRequest = () => {
  controller?.abort();
  controller = undefined;
};

const clearImage = () => {
  cancelRequest();
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = '';
};

const loadVisiblePoster = () => {
  if (!visible || !proxiedPoster.value || !sourceUrl || controller || blobUrl || failed.value) return;
  const requestController = new AbortController();
  controller = requestController;
  const { signal } = requestController;
  const url = sourceUrl;
  // Share two transport slots across cards and dialogs, leaving room for list requests.
  void queuePosterRequest(signal, () => api.get<Blob>(url, { responseType: 'blob', signal, timeout: 15000 }))
    .then(response => {
      if (signal.aborted) return;
      blobUrl = URL.createObjectURL(response.data);
      imageUrl.value = blobUrl;
    })
    .catch(() => { if (!signal.aborted) failed.value = true; })
    .finally(() => { if (controller === requestController) controller = undefined; });
};

watch(() => props.src, source => {
  clearImage();
  failed.value = false;
  imageUrl.value = '';
  sourceUrl = '';
  proxiedPoster.value = false;
  if (!source) return;
  let url: URL;
  try { url = new URL(source, window.location.origin); } catch { return; }
  if (!['http:', 'https:'].includes(url.protocol)) return;
  sourceUrl = url.href;
  // Only this same-origin endpoint uses the API client and its bearer header.
  proxiedPoster.value = url.origin === window.location.origin && url.pathname === '/api/discover/poster';
  if (proxiedPoster.value) loadVisiblePoster();
  else imageUrl.value = url.href;
}, { immediate: true });

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') {
    visible = true;
    loadVisiblePoster();
    return;
  }
  observer = new IntersectionObserver(entries => {
    const intersects = entries.some(entry => entry.isIntersecting);
    if (intersects === visible) return;
    visible = intersects;
    if (visible) {
      failed.value = false;
      loadVisiblePoster();
    } else if (!blobUrl) {
      cancelRequest();
      failed.value = false;
    }
  }, { rootMargin: '100px 0px' });
  if (element.value) observer.observe(element.value);
});

const handleImageError = (event: Event) => {
  if ((event.target as HTMLImageElement).src === imageUrl.value) failed.value = true;
};

onUnmounted(() => { observer?.disconnect(); clearImage(); });
</script>

<template>
  <div ref="element" class="discover-poster">
    <img v-if="imageUrl && !failed" :src="imageUrl" :alt="`${title}海报`" :loading="proxiedPoster ? 'eager' : 'lazy'" decoding="async" fetchpriority="low" referrerpolicy="no-referrer" @error="handleImageError" />
    <div v-else class="poster-placeholder" aria-label="暂无海报">
      <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="9" y="7" width="30" height="34" rx="4" stroke="currentColor" stroke-width="1.5"/><path d="M15 7v34M33 7v34M9 15h6m-6 9h6m-6 9h6m18-18h6m-6 9h6m-6 9h6" stroke="currentColor" stroke-width="1.5"/><path d="m21 19 8 5-8 5V19Z" fill="currentColor"/></svg>
      <span>{{ title }}</span>
    </div>
  </div>
</template>

<style scoped>
.discover-poster { width: 100%; height: 100%; background: hsl(var(--muted)); }
img { width: 100%; height: 100%; object-fit: cover; }
.poster-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; height: 100%; padding: 1rem; color: hsl(var(--muted-foreground)); background: linear-gradient(145deg, hsl(var(--primary) / 0.09), hsl(var(--accent) / 0.06)); text-align: center; font-size: 0.8125rem; }
svg { width: 2.5rem; height: 2.5rem; opacity: 0.5; }
</style>
