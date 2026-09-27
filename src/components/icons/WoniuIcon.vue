<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :width="size"
    :height="size"
  >
    <!-- 蜗牛壳：同心螺旋 -->
    <path
      d="M20.5 12a8.5 8.5 0 1 1-3.1-6.56"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path
      d="M17.2 12a5.2 5.2 0 1 1-2.05-4.16"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path
      d="M14.1 12a2.1 2.1 0 1 1-1.35-1.97"
      stroke-width="1.8"
      stroke-linecap="round"
    />
    <!-- 触角 -->
    <path
      d="M3.6 8.2V5.4"
      stroke-width="1.8"
      stroke-linecap="round"
    />
    <path
      d="M6.9 8.6V6.2"
      stroke-width="1.8"
      stroke-linecap="round"
    />
    <circle cx="3.6" cy="4.6" r="1" fill="currentColor" stroke="none" />
    <circle cx="6.9" cy="5.4" r="1" fill="currentColor" stroke="none" />
    <!-- 腹足 -->
    <path
      d="M2.8 16.4h11.6a3.4 3.4 0 0 0 3.4-3.4"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<script setup lang="ts">
interface Props {
  size?: string | number
}

withDefaults(defineProps<Props>(), {
  size: '24'
})
</script>
