<script setup lang="ts">
// 搜索等待动画：网盘平台环绕轨道。
//
// 结构参考 quanpan 的 orbit 设计（双虚线轨道 + 12 个网盘图标公转 + 呼吸缩放 + 脉冲圈 + 漂浮粒子），
// 配色只用本项目主色（pansou.css 的 --primary）与中性灰：不做光晕、不做脉冲圈——
// 浅蓝光晕在白底卡片上会糊成一片发灰的蓝雾，显脏且与主题底色不协调；
// 环绕感由虚线轨道 + 白色图标底盘 + 中心主色徽标表达，边界清晰。
//
// 关键点：单个 animation 同时完成「绕中心公转」与「自身反向自转」，两者在同一 transform 里抵消，
// 图标才能严格保持正立；半径用 --r 变量，移动端只改半径即可。
//
// 配色必须用 hsl(var(--primary)) —— 本项目 pansou.css 里的 --primary 是 HSL 三元组
// （217 91% 60%），写成 rgb(var(--primary)) 会被 Chrome 按 CSS Color 4 解析成
// rgb(217, 91%, 60%) = rgb(217,232,153)，即一个黄绿色，而不是主色蓝。
//
// 图标放在 public/pan-icons 而不是 src/assets：写在模板里的运行时路径不会被 Vite 处理，
// 放 src 下开发环境能跑、生产构建必然 404，必须走 public。
const innerIcons = [
  { file: 'baidu.svg', alt: '百度网盘' },
  { file: 'xunlei.svg', alt: '迅雷' },
  { file: 'uc.svg', alt: 'UC网盘' },
  { file: 'kuake.svg', alt: '夸克网盘' },
  { file: 'yidong.svg', alt: '移动网盘' },
  { file: 'tianyi.svg', alt: '天翼云' },
];

const outerIcons = [
  { file: '123.svg', alt: '123云盘' },
  { file: '115.svg', alt: '115云盘' },
  { file: 'magnet.svg', alt: '磁力' },
  { file: 'ali.svg', alt: '阿里云盘' },
  { file: 'eMule.svg', alt: '电驴' },
  { file: 'guangya.svg', alt: '光鸭云盘' },
];

// 粒子位置与漂移方向：颜色只在蓝色族里取
const particles = [
  { top: '18%', left: '26%', color: '#3b82f6', dx: '36px', dy: '-52px', dur: '3.4s' },
  { top: '62%', left: '18%', color: '#60a5fa', dx: '-44px', dy: '-38px', dur: '4.2s' },
  { top: '30%', left: '76%', color: '#2563eb', dx: '30px', dy: '46px', dur: '3.8s' },
  { top: '72%', left: '72%', color: '#60a5fa', dx: '-34px', dy: '40px', dur: '4.6s' },
  { top: '48%', left: '54%', color: '#3b82f6', dx: '26px', dy: '-30px', dur: '3.1s' },
];
</script>

<template>
  <div class="loading-orbit">
    <div class="orbit-wrap" aria-hidden="true">
      <div class="orbit-center">
        <svg class="orbit-center-logo" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          ></path>
        </svg>
      </div>

      <div class="orbit-ring orbit-ring-1">
        <div v-for="(ic, i) in innerIcons" :key="ic.file" class="orbit-item" :class="`pos-${i * 60}`">
          <span class="fb">
            <img :src="`/pan-icons/${ic.file}`" :alt="ic.alt" />
          </span>
        </div>
      </div>

      <div class="orbit-ring orbit-ring-2">
        <div v-for="(ic, i) in outerIcons" :key="ic.file" class="orbit-item" :class="`pos-${i * 60}`">
          <span class="fb">
            <img :src="`/pan-icons/${ic.file}`" :alt="ic.alt" />
          </span>
        </div>
      </div>

      <div
        v-for="(p, i) in particles"
        :key="i"
        class="data-particle"
        :style="{
          top: p.top,
          left: p.left,
          background: p.color,
          '--dx': p.dx,
          '--dy': p.dy,
          '--dur': p.dur,
        }"
      ></div>
    </div>

  </div>
</template>

<style scoped>
.loading-orbit {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem 0;
}

.orbit-wrap {
  position: relative;
  width: 340px;
  height: 340px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 这里原本有一层 340px 的主色径向渐变光晕，以及三个主色描边的脉冲圈。
   在浅色卡片上它们叠成一片发灰的蓝雾，既显得脏，又和主题底色不协调，已全部移除。
   现在只靠虚线轨道、白色图标底盘与中心主色徽标表达"环绕"，边界清晰不透光。 */

.orbit-center {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 64px;
  height: 64px;
  margin: -32px 0 0 -32px;
  border-radius: 50%;
  background: hsl(var(--primary, 217 91% 60%));
  color: hsl(var(--primary-foreground, 0 0% 98%));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.16);
}

.orbit-center-logo {
  width: 55%;
  height: 55%;
}

/* 轨道：静态虚线圆，只作底纹 */
.orbit-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 50%;
  border: 2px dashed rgba(15, 23, 42, 0.08);
  pointer-events: none;
}

.orbit-ring-1 {
  width: 208px;
  height: 208px;
  margin: -104px 0 0 -104px;
}

.orbit-ring-2 {
  width: 320px;
  height: 320px;
  margin: -160px 0 0 -160px;
  border-color: rgba(15, 23, 42, 0.06);
}

.orbit-item {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 48px;
  height: 48px;
  margin: -24px 0 0 -24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* .fb 承担视觉与呼吸缩放；缩放放这层，不受公转相位延迟影响 → 所有图标同步呼吸 */
.orbit-item .fb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.1);
  overflow: hidden;
  transform-origin: center;
  animation: orbit-breathe var(--dur, 8s) ease-in-out infinite;
  animation-delay: var(--wave, 0s);
}

@keyframes orbit-breathe {
  0%,
  20% {
    transform: scale(1);
  }
  24%,
  74% {
    transform: scale(0.28);
  }
  78%,
  100% {
    transform: scale(1);
  }
}

.orbit-item .fb img {
  width: 56%;
  height: 56%;
  object-fit: contain;
  animation: orbit-fade var(--dur, 8s) ease-in-out infinite;
  animation-delay: var(--wave, 0s);
}

@keyframes orbit-fade {
  0%,
  20% {
    opacity: 1;
  }
  24%,
  74% {
    opacity: 0;
  }
  78%,
  100% {
    opacity: 1;
  }
}

/* 公转 + 反向自转抵消 → 图标始终正立 */
@keyframes orbit-upright {
  from {
    transform: rotate(0deg) translateY(var(--r)) rotate(0deg);
  }
  to {
    transform: rotate(360deg) translateY(var(--r)) rotate(-360deg);
  }
}

.orbit-ring-1 .orbit-item {
  --r: -104px;
  animation: orbit-upright 90s linear infinite;
}

.orbit-ring-2 .orbit-item {
  --r: -160px;
  animation: orbit-upright 120s linear infinite reverse;
}

/* 6 个位置用负延迟错开到 60° 间隔 */
.orbit-ring-1 .pos-0 {
  animation-delay: 0s;
}
.orbit-ring-1 .pos-60 {
  animation-delay: -15s;
}
.orbit-ring-1 .pos-120 {
  animation-delay: -30s;
}
.orbit-ring-1 .pos-180 {
  animation-delay: -45s;
}
.orbit-ring-1 .pos-240 {
  animation-delay: -60s;
}
.orbit-ring-1 .pos-300 {
  animation-delay: -75s;
}

.orbit-ring-2 .pos-0 {
  animation-delay: 0s;
}
.orbit-ring-2 .pos-60 {
  animation-delay: -20s;
}
.orbit-ring-2 .pos-120 {
  animation-delay: -40s;
}
.orbit-ring-2 .pos-180 {
  animation-delay: -60s;
}
.orbit-ring-2 .pos-240 {
  animation-delay: -80s;
}
.orbit-ring-2 .pos-300 {
  animation-delay: -100s;
}

/* 呼吸周期取 7~13s 间互不成倍数的值 → 长期永不同步，不会"排队一起变小" */
.orbit-ring-1 .pos-0 .fb,
.orbit-ring-1 .pos-0 .fb img {
  --dur: 8s;
  --wave: -0.5s;
}
.orbit-ring-1 .pos-60 .fb,
.orbit-ring-1 .pos-60 .fb img {
  --dur: 11s;
  --wave: -6.2s;
}
.orbit-ring-1 .pos-120 .fb,
.orbit-ring-1 .pos-120 .fb img {
  --dur: 9.5s;
  --wave: -2.7s;
}
.orbit-ring-1 .pos-180 .fb,
.orbit-ring-1 .pos-180 .fb img {
  --dur: 12.5s;
  --wave: -9.1s;
}
.orbit-ring-1 .pos-240 .fb,
.orbit-ring-1 .pos-240 .fb img {
  --dur: 7s;
  --wave: -4.3s;
}
.orbit-ring-1 .pos-300 .fb,
.orbit-ring-1 .pos-300 .fb img {
  --dur: 10.5s;
  --wave: -1.6s;
}

.orbit-ring-2 .pos-0 .fb,
.orbit-ring-2 .pos-0 .fb img {
  --dur: 13s;
  --wave: -7.8s;
}
.orbit-ring-2 .pos-60 .fb,
.orbit-ring-2 .pos-60 .fb img {
  --dur: 8.5s;
  --wave: -3.4s;
}
.orbit-ring-2 .pos-120 .fb,
.orbit-ring-2 .pos-120 .fb img {
  --dur: 11.5s;
  --wave: -0.9s;
}
.orbit-ring-2 .pos-180 .fb,
.orbit-ring-2 .pos-180 .fb img {
  --dur: 9s;
  --wave: -5.5s;
}
.orbit-ring-2 .pos-240 .fb,
.orbit-ring-2 .pos-240 .fb img {
  --dur: 12s;
  --wave: -10.2s;
}
.orbit-ring-2 .pos-300 .fb,
.orbit-ring-2 .pos-300 .fb img {
  --dur: 7.5s;
  --wave: -2.1s;
}

/* 漂浮粒子：只取蓝色族 */
.data-particle {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  opacity: 0.7;
  animation: orbit-drift var(--dur, 4s) ease-in-out infinite;
  pointer-events: none;
}

@keyframes orbit-drift {
  0%,
  100% {
    transform: translate(0, 0);
    opacity: 0.2;
  }
  50% {
    transform: translate(var(--dx, 30px), var(--dy, -40px));
    opacity: 0.75;
  }
}

/* 尊重系统的减少动效设置 */
@media (prefers-reduced-motion: reduce) {
  .loading-orbit * {
    animation: none !important;
  }
  .orbit-item .fb {
    transform: none;
  }
}

@media (max-width: 767px) {
  .orbit-wrap {
    width: 280px;
    height: 280px;
  }
  .orbit-ring-1 {
    width: 172px;
    height: 172px;
    margin: -86px 0 0 -86px;
  }
  .orbit-ring-2 {
    width: 264px;
    height: 264px;
    margin: -132px 0 0 -132px;
  }
  .orbit-item {
    width: 36px;
    height: 36px;
    margin: -18px 0 0 -18px;
  }
  .orbit-ring-1 .orbit-item {
    --r: -86px;
  }
  .orbit-ring-2 .orbit-item {
    --r: -132px;
  }
}
</style>