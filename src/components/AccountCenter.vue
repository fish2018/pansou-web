<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import AccountServiceCard from '@/components/AccountServiceCard.vue'
import QQPDIcon from '@/components/icons/QQPDIcon.vue'
import GyingIcon from '@/components/icons/GyingIcon.vue'
import PanlianIcon from '@/components/icons/PanlianIcon.vue'
import WeiboIcon from '@/components/icons/WeiboIcon.vue'
import WoniuIcon from '@/components/icons/WoniuIcon.vue'
import type { HealthStatus } from '@/api'
import {
  DEFAULT_GYING_BASE_URL,
  GYING_BASE_URL_STORAGE_KEY,
  getStoredGyingBaseURL
} from '@/utils/gying'

// 定义Props
interface Props {
  backendHealth: HealthStatus | null
}

const props = defineProps<Props>()

// 定义事件
const emit = defineEmits<{
  (e: 'navigate', page: 'qqpd' | 'gying' | 'panlian' | 'weibo' | 'woniu'): void
}>()

// QQPD账号状态
const qqpdAccounts = ref<any[]>([])
const qqpdAccountCount = computed(() => qqpdAccounts.value.length)

// Gying账号状态  
const gyingAccounts = ref<any[]>([])
const gyingAccountCount = computed(() => gyingAccounts.value.length)
const gyingBaseURL = ref(DEFAULT_GYING_BASE_URL)

// 盘链账号状态
const panlianAccounts = ref<any[]>([])
const panlianAccountCount = computed(() => panlianAccounts.value.length)

// Weibo账号状态
const weiboAccounts = ref<any[]>([])
const weiboAccountCount = computed(() => weiboAccounts.value.length)

// 蜗牛账号状态
const woniuAccounts = ref<any[]>([])
const woniuAccountCount = computed(() => woniuAccounts.value.length)

// 检查服务是否启用
const isQQPDEnabled = computed(() => {
  return props.backendHealth?.plugins?.includes('qqpd') || false
})

const isGyingEnabled = computed(() => {
  return props.backendHealth?.plugins?.includes('gying') || false
})

const isPanlianEnabled = computed(() => {
  return props.backendHealth?.plugins?.includes('panlian') || false
})

const isWeiboEnabled = computed(() => {
  return props.backendHealth?.plugins?.includes('weibo') || false
})

const isWoniuEnabled = computed(() => {
  return props.backendHealth?.plugins?.includes('woniu') || false
})

// 加载账号状态
const loadAccountsStatus = () => {
  try {
    // 加载QQPD账号
    const qqpdUsersStr = localStorage.getItem('qqpd_users')
    qqpdAccounts.value = qqpdUsersStr ? JSON.parse(qqpdUsersStr) : []
    
    // 加载Gying账号
    const gyingUsersStr = localStorage.getItem('gying_users')
    gyingAccounts.value = gyingUsersStr ? JSON.parse(gyingUsersStr) : []
    gyingBaseURL.value = getStoredGyingBaseURL()

    const panlianUsersStr = localStorage.getItem('panlian_users')
    panlianAccounts.value = panlianUsersStr ? JSON.parse(panlianUsersStr) : []
    
    // 加载Weibo账号
    const weiboUsersStr = localStorage.getItem('weibo_users')
    weiboAccounts.value = weiboUsersStr ? JSON.parse(weiboUsersStr) : []

    // 加载蜗牛账号
    const woniuUsersStr = localStorage.getItem('woniu_users')
    woniuAccounts.value = woniuUsersStr ? JSON.parse(woniuUsersStr) : []
  } catch (error) {
    console.error('加载账号状态失败:', error)
    gyingBaseURL.value = DEFAULT_GYING_BASE_URL
  }
}

// 计算QQPD状态文本
const qqpdStatusText = computed(() => {
  if (qqpdAccountCount.value === 0) return ''
  
  // 计算总频道数
  let totalChannels = 0
  qqpdAccounts.value.forEach((account: any) => {
    if (account.channels && Array.isArray(account.channels)) {
      totalChannels += account.channels.length
    }
  })
  
  return totalChannels > 0 ? `配置了 ${totalChannels} 个频道` : ''
})

// 计算Gying状态文本
const gyingStatusText = computed(() => {
  if (gyingAccountCount.value === 0) return ''
  
  // 获取最近登录时间
  const latestAccount = gyingAccounts.value.reduce((latest: any, account: any) => {
    if (!latest || (account.last_login && account.last_login > latest.last_login)) {
      return account
    }
    return latest
  }, null)
  
  if (latestAccount?.last_login) {
    const date = new Date(latestAccount.last_login)
    return `最近登录: ${date.toLocaleDateString('zh-CN')}`
  }
  
  return ''
})

const panlianStatusText = computed(() => {
  if (panlianAccountCount.value === 0) return ''

  const latestAccount = panlianAccounts.value.reduce((latest: any, account: any) => {
    if (!latest || (account.last_login && account.last_login > latest.last_login)) {
      return account
    }
    return latest
  }, null)

  if (latestAccount?.last_login) {
    const date = new Date(latestAccount.last_login)
    return `最近登录: ${date.toLocaleDateString('zh-CN')}`
  }

  return ''
})

// 计算Weibo状态文本
const weiboStatusText = computed(() => {
  if (weiboAccountCount.value === 0) return ''
  
  // 计算总用户ID数
  let totalUserIds = 0
  weiboAccounts.value.forEach((account: any) => {
    if (account.user_ids && Array.isArray(account.user_ids)) {
      totalUserIds += account.user_ids.length
    }
  })
  
  return totalUserIds > 0 ? `配置了 ${totalUserIds} 个用户ID` : ''
})

const woniuStatusText = computed(() => {
  if (woniuAccountCount.value === 0) return ''

  const latestAccount = woniuAccounts.value.reduce((latest: any, account: any) => {
    if (!latest || (account.last_login && account.last_login > latest.last_login)) {
      return account
    }
    return latest
  }, null)

  if (latestAccount?.last_login) {
    const date = new Date(latestAccount.last_login)
    return `最近登录: ${date.toLocaleDateString('zh-CN')}`
  }

  return ''
})

// 监听localStorage变化
const handleStorageChange = (e: StorageEvent) => {
  if (
    e.key === 'qqpd_users' ||
    e.key === 'gying_users' ||
    e.key === 'panlian_users' ||
    e.key === 'weibo_users' ||
    e.key === 'woniu_users' ||
    e.key === GYING_BASE_URL_STORAGE_KEY
  ) {
    loadAccountsStatus()
  }
}

onMounted(() => {
  loadAccountsStatus()
  window.addEventListener('storage', handleStorageChange)
})

onUnmounted(() => {
  window.removeEventListener('storage', handleStorageChange)
})

// 导航到服务管理页面
const navigateToService = (service: 'qqpd' | 'gying' | 'panlian' | 'weibo' | 'woniu') => {
  emit('navigate', service)
}
</script>

<template>
  <div class="account-center">
    <!-- 页面标题 -->
    <div class="header-section">
      <h1 class="page-title">账号管理中心</h1>
      <p class="page-description">统一管理你的账号配置</p>
    </div>
    
    <!-- 统计概览 -->
    <div class="stats-overview">
      <div class="stat-card">
        <div class="stat-value">{{ [isQQPDEnabled, isGyingEnabled, isPanlianEnabled, isWeiboEnabled, isWoniuEnabled].filter(Boolean).length }}</div>
        <div class="stat-label">可用服务</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ qqpdAccountCount + gyingAccountCount + panlianAccountCount + weiboAccountCount + woniuAccountCount }}</div>
        <div class="stat-label">已登录账号</div>
      </div>
    </div>
    
    <!-- 服务卡片列表 -->
    <div class="services-section">
      <h2 class="section-title">服务列表</h2>
      
      <div class="service-grid">
        <!-- QQ频道卡片 -->
        <AccountServiceCard
          :icon-component="QQPDIcon"
          name="QQ频道"
          description="扫码登录，配置频道列表搜索资源"
          :account-count="qqpdAccountCount"
          :enabled="isQQPDEnabled"
          :status-text="qqpdStatusText"
          external-link="https://pd.qq.com/"
          @manage="navigateToService('qqpd')"
        />
        
        <!-- 观影卡片 -->
        <AccountServiceCard
          :icon-component="GyingIcon"
          name="观影"
          description="用户名密码登录，搜索影视资源"
          :account-count="gyingAccountCount"
          :enabled="isGyingEnabled"
          :status-text="gyingStatusText"
          :external-link="gyingBaseURL"
          @manage="navigateToService('gying')"
        />

        <AccountServiceCard
          :icon-component="PanlianIcon"
          name="盘链"
          description="用户名密码登录，验证盘链搜索与网盘链接抓取"
          :account-count="panlianAccountCount"
          :enabled="isPanlianEnabled"
          :status-text="panlianStatusText"
          external-link="https://pinglian.lol/"
          @manage="navigateToService('panlian')"
        />
        
        <!-- 蜗牛卡片 -->
        <AccountServiceCard
          :icon-component="WoniuIcon"
          name="蜗牛"
          description="用户名密码登录，抓取蜗牛 I 4K 的网盘链接"
          :account-count="woniuAccountCount"
          :enabled="isWoniuEnabled"
          :status-text="woniuStatusText"
          external-link="https://wn4k.com/"
          @manage="navigateToService('woniu')"
        />

        <!-- 微博卡片 -->
        <AccountServiceCard
          :icon-component="WeiboIcon"
          name="微博"
          description="扫码登录，配置用户ID列表搜索资源"
          :account-count="weiboAccountCount"
          :enabled="isWeiboEnabled"
          :status-text="weiboStatusText"
          external-link="https://weibo.com/"
          @manage="navigateToService('weibo')"
        />
      </div>
      
      <!-- 提示信息 -->
      <div v-if="!isQQPDEnabled && !isGyingEnabled && !isPanlianEnabled && !isWeiboEnabled && !isWoniuEnabled" class="empty-state">
        <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
        </svg>
        <p class="empty-text">后端未启用任何需要登录的服务</p>
        <p class="empty-hint">请在后端配置中启用 qqpd、gying、panlian、weibo 或 woniu 插件</p>
      </div>
      
      <!-- 占位卡片 -->
      <div class="placeholder-card">
        <div class="placeholder-icon">+</div>
        <div class="placeholder-text">更多服务即将上线</div>
        <div class="placeholder-hint">敬请期待</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account-center {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}

/* 页面标题 */
.header-section {
  margin-bottom: 2rem;
  text-align: center;
}

.page-title {
  font-size: 2rem;
  font-weight: 700;
  color: hsl(var(--foreground));
  margin: 0 0 0.5rem 0;
}

.page-description {
  font-size: 1rem;
  color: hsl(var(--muted-foreground));
  margin: 0;
}

/* 统计概览 */
.stats-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  margin-bottom: 2.5rem;
}

.stat-card {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  padding: 1.5rem;
  text-align: center;
  transition: all 0.2s ease;
}

.stat-card:hover {
  border-color: hsl(var(--primary));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.stat-value {
  font-size: 2.5rem;
  font-weight: 700;
  color: hsl(var(--primary));
  line-height: 1;
  margin-bottom: 0.5rem;
}

.stat-label {
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
}

/* 服务列表区域 */
.services-section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin: 0 0 1.25rem 0;
}

.service-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.25rem;
  margin-bottom: 1.5rem;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  background: hsl(var(--muted) / 0.3);
  border-radius: 12px;
  margin-bottom: 1.5rem;
}

.empty-icon {
  width: 4rem;
  height: 4rem;
  color: hsl(var(--muted-foreground));
  opacity: 0.5;
  margin: 0 auto 1rem;
}

.empty-text {
  font-size: 1rem;
  color: hsl(var(--foreground));
  margin: 0 0 0.5rem 0;
}

.empty-hint {
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
  margin: 0;
}

/* 占位卡片 */
.placeholder-card {
  background: hsl(var(--muted) / 0.3);
  border: 2px dashed hsl(var(--border));
  border-radius: 12px;
  padding: 2rem;
  text-align: center;
  transition: all 0.2s ease;
}

.placeholder-card:hover {
  border-color: hsl(var(--primary) / 0.5);
  background: hsl(var(--muted) / 0.4);
}

.placeholder-icon {
  font-size: 2.5rem;
  color: hsl(var(--muted-foreground));
  margin-bottom: 0.75rem;
}

.placeholder-text {
  font-size: 1rem;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  margin-bottom: 0.25rem;
}

.placeholder-hint {
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
  opacity: 0.7;
}

/* 响应式 */
@media (max-width: 768px) {
  .page-title {
    font-size: 1.5rem;
  }
  
  .stats-overview {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .service-grid {
    grid-template-columns: 1fr;
  }
  
  .stat-value {
    font-size: 2rem;
  }
}

/* 页面动画 */
.account-center {
  animation: fadeIn 0.3s ease-out;
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
</style>
