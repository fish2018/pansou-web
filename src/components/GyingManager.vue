<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import * as gyingApi from '@/api/gying'
import type { GyingStatus, GyingSearchResult } from '@/types/gying'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import {
  DEFAULT_GYING_BASE_URL,
  getStoredGyingBaseURL,
  saveStoredGyingBaseURL
} from '@/utils/gying'

// 定义事件
const emit = defineEmits<{
  (e: 'back-to-center'): void
}>()

// ============================================================
// 本地存储的用户列表
// ============================================================

interface SavedUser {
  username: string
  hash: string
  last_login: string
}

const savedUsers = ref<SavedUser[]>([])
const currentView = ref<'list' | 'add' | 'manage'>('list')
const selectedUser = ref<SavedUser | null>(null)
const currentBaseURL = ref(getStoredGyingBaseURL())
const baseURLInput = ref(getStoredGyingBaseURL())
const savingBaseURL = ref(false)
const isEditingBaseURL = ref(false)

// 从localStorage加载用户列表
const loadSavedUsers = () => {
  const stored = localStorage.getItem('gying_users')
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      savedUsers.value = Array.isArray(parsed)
        ? parsed
            .map((item: any) => ({
              username: typeof item?.username === 'string' ? item.username : '',
              hash: typeof item?.hash === 'string' ? item.hash : '',
              last_login: typeof item?.last_login === 'string' ? item.last_login : ''
            }))
            .filter((item: SavedUser) => item.hash)
        : []
      localStorage.setItem('gying_users', JSON.stringify(savedUsers.value))
    } catch (e) {
      savedUsers.value = []
    }
  }
  
  // 如果没有用户，直接进入添加界面
  if (savedUsers.value.length === 0) {
    currentView.value = 'add'
  }
}

// 保存用户列表
const saveSavedUsers = () => {
  localStorage.setItem('gying_users', JSON.stringify(savedUsers.value))
  // 触发存储变化事件，通知AccountCenter更新
  window.dispatchEvent(new StorageEvent('storage', { key: 'gying_users' }))
}

const syncStoredBaseURL = (baseURL: string) => {
  const normalizedBaseURL = baseURL || DEFAULT_GYING_BASE_URL
  currentBaseURL.value = normalizedBaseURL
  baseURLInput.value = normalizedBaseURL
  saveStoredGyingBaseURL(normalizedBaseURL)
}

// 添加新用户到列表
const addUserToList = (username: string, hash: string) => {
  const user: SavedUser = {
    username,
    hash,
    last_login: new Date().toISOString()
  }
  
  // 检查是否已存在
  const index = savedUsers.value.findIndex(u => u.hash === hash)
  if (index >= 0) {
    savedUsers.value[index] = user
  } else {
    savedUsers.value.push(user)
  }
  
  saveSavedUsers()
}

// 删除用户
const removeUser = (hash: string) => {
  savedUsers.value = savedUsers.value.filter(u => u.hash !== hash)
  saveSavedUsers()
}

// ============================================================
// 添加用户界面
// ============================================================

const username = ref('')
const generatingHash = ref(false)

const handleAddUser = async () => {
  if (!username.value.trim()) {
    showAlertMessage('请输入用户名', 'error')
    return
  }
  
  generatingHash.value = true
  
  try {
    const hash = await gyingApi.getHashByUsername(username.value.trim())
    
    // 切换到管理界面
    selectedUser.value = {
      username: username.value.trim(),
      hash,
      last_login: new Date().toISOString()
    }
    
    currentHash.value = hash
    currentView.value = 'manage'
    
    // 加载状态和站点配置
    await loadManageContext()
  } catch (error) {
    console.error('获取hash失败:', error)
    showAlertMessage('获取hash失败', 'error')
  } finally {
    generatingHash.value = false
  }
}

// ============================================================
// 用户选择
// ============================================================

const handleSelectUser = (user: SavedUser) => {
  selectedUser.value = user
  currentHash.value = user.hash
  currentView.value = 'manage'
  void loadManageContext()
}

const handleBackToList = () => {
  selectedUser.value = null
  currentHash.value = ''
  currentView.value = savedUsers.value.length > 0 ? 'list' : 'add'
  username.value = ''
  loginUsername.value = ''
  loginPassword.value = ''
  searchKeyword.value = ''
  searchResults.value = []
  baseURLInput.value = currentBaseURL.value
}

const handleShowAddForm = () => {
  currentView.value = 'add'
  username.value = ''
  baseURLInput.value = currentBaseURL.value
}

// ============================================================
// 管理界面数据
// ============================================================

const currentHash = ref<string>('')

const status = ref<GyingStatus>({
  hash: '',
  logged_in: false,
  status: 'pending',
  username: '',
  login_time: '',
  expire_time: '',
  expires_in_days: 0
})

const searchKeyword = ref<string>('')
const searchResults = ref<GyingSearchResult[]>([])
const searching = ref(false)

const showAlert = ref(false)
const alertMessage = ref('')
const alertType = ref<'success' | 'error'>('success')

// 登录表单
const loginUsername = ref<string>('')
const loginPassword = ref<string>('')
const loggingIn = ref(false)

// ============================================================
// 计算属性
// ============================================================

const isLoggedIn = computed(() => {
  return status.value.logged_in && status.value.status === 'active'
})

const hasCurrentBaseURL = computed(() => {
  return Boolean(currentBaseURL.value.trim())
})

const showBaseURLEditor = computed(() => {
  return isEditingBaseURL.value || !hasCurrentBaseURL.value
})

// ============================================================
// 生命周期
// ============================================================

onMounted(() => {
  loadSavedUsers()

  const firstUserHash = savedUsers.value[0]?.hash
  if (firstUserHash) {
    void loadConfig(firstUserHash)
  }
})

// ============================================================
// 状态管理
// ============================================================

const loadStatus = async () => {
  if (!currentHash.value) return
  
  try {
    const response = await gyingApi.getStatus(currentHash.value)
    
    if (response.success && response.data) {
      status.value = response.data
      
      // 如果登录成功，使用后端返回的用户名更新本地列表
      if (response.data.logged_in && response.data.username && selectedUser.value) {
        selectedUser.value.username = response.data.username
        selectedUser.value.last_login = new Date().toISOString()
        addUserToList(
          selectedUser.value.username,
          selectedUser.value.hash
        )
      }
    }
  } catch (error) {
    console.error('获取状态失败:', error)
  }
}

const loadConfig = async (hash: string = currentHash.value) => {
  if (!hash) return

  try {
    const response = await gyingApi.getConfig(hash)

    if (response.success && response.data) {
      syncStoredBaseURL(response.data.base_url || DEFAULT_GYING_BASE_URL)
    }
  } catch (error) {
    console.error('获取站点配置失败:', error)
  }
}

const loadManageContext = async () => {
  if (!currentHash.value) return

  await Promise.all([
    loadStatus(),
    loadConfig(currentHash.value)
  ])
}

// ============================================================
// 登录管理
// ============================================================

const handleSaveBaseURL = async () => {
  if (!currentHash.value) return

  const nextBaseURL = baseURLInput.value.trim()
  if (!nextBaseURL) {
    showAlertMessage('请输入站点地址', 'error')
    return
  }

  savingBaseURL.value = true

  try {
    const response = await gyingApi.updateConfig(currentHash.value, nextBaseURL)

    if (response.success && response.data) {
      syncStoredBaseURL(response.data.base_url || DEFAULT_GYING_BASE_URL)
      isEditingBaseURL.value = false
      searchResults.value = []
      showAlertMessage(response.message || '站点地址已保存', 'success')
      await loadStatus()
    } else {
      showAlertMessage(response.message || '保存站点地址失败', 'error')
    }
  } catch (error: any) {
    console.error('保存站点配置失败:', error)
    const message = error.response?.data?.message || '保存站点地址失败'
    showAlertMessage(message, 'error')
  } finally {
    savingBaseURL.value = false
  }
}

const handleToggleBaseURLEdit = () => {
  if (savingBaseURL.value) return

  if (isEditingBaseURL.value) {
    baseURLInput.value = currentBaseURL.value
    isEditingBaseURL.value = false
    return
  }

  baseURLInput.value = currentBaseURL.value
  isEditingBaseURL.value = true
}

const handleLogin = async () => {
  if (!currentHash.value) return
  if (!loginUsername.value.trim() || !loginPassword.value.trim()) {
    showAlertMessage('请输入用户名和密码', 'error')
    return
  }
  
  loggingIn.value = true
  
  try {
    const response = await gyingApi.login(
      currentHash.value,
      loginUsername.value.trim(),
      loginPassword.value.trim()
    )
    
    if (response.success) {
      showAlertMessage('登录成功！', 'success')
      // 登录成功后重新加载状态
      await loadStatus()
      // 清空密码
      loginPassword.value = ''
    } else {
      showAlertMessage(response.message || '登录失败', 'error')
    }
  } catch (error: any) {
    console.error('登录失败:', error)
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      await loadStatus()
      if (isLoggedIn.value) {
        showAlertMessage('登录成功！', 'success')
        loginPassword.value = ''
        loggingIn.value = false
        return
      }
    }
    const message = error.response?.data?.message || '登录失败'
    showAlertMessage(message, 'error')
  } finally {
    loggingIn.value = false
  }
}

const handleLogout = async () => {
  if (!currentHash.value) return
  if (!confirm('确定要退出登录吗？')) return
  
  try {
    const response = await gyingApi.logout(currentHash.value)
    
    if (response.success) {
      showAlertMessage('已退出登录', 'success')
      // 退出登录后重新加载状态
      await loadStatus()
    }
  } catch (error) {
    console.error('退出登录失败:', error)
    showAlertMessage('退出登录失败', 'error')
  }
}

// 删除此账号
const handleDeleteAccount = () => {
  if (!selectedUser.value) return
  
  if (confirm(`确定要删除账号 ${selectedUser.value.username} 吗？\n\n这将删除本地保存的配置信息。`)) {
    removeUser(selectedUser.value.hash)
    handleBackToList()
    showAlertMessage('账号已删除', 'success')
  }
}

// ============================================================
// 测试搜索
// ============================================================

const handleTestSearch = async () => {
  if (!currentHash.value) return
  
  if (!searchKeyword.value.trim()) {
    showAlertMessage('请输入搜索关键词', 'error')
    return
  }
  
  searching.value = true
  searchResults.value = []
  
  try {
    const response = await gyingApi.testSearch(currentHash.value, searchKeyword.value.trim(), 20)
    
    if (response.success) {
      searchResults.value = response.data.results || []
      
      if (searchResults.value.length === 0) {
        showAlertMessage('未找到结果', 'error')
      }
    }
  } catch (error: any) {
    console.error('搜索失败:', error)
    if (error.response?.data?.message) {
      showAlertMessage(error.response.data.message, 'error')
    } else {
      showAlertMessage('搜索失败', 'error')
    }
  } finally {
    searching.value = false
  }
}

// ============================================================
// 辅助函数
// ============================================================

const showAlertMessage = (message: string, type: 'success' | 'error' = 'success') => {
  alertMessage.value = message
  alertType.value = type
  showAlert.value = true
  
  setTimeout(() => {
    showAlert.value = false
  }, 3000)
}

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-'
  try {
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}

// 复制Hash到剪贴板（支持降级处理）
const copyHashToClipboard = async () => {
  if (!currentHash.value) return
  
  let success = false
  
  // 方法1: 尝试使用现代 Clipboard API (需要HTTPS)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(currentHash.value)
      success = true
    } catch (error) {
      console.warn('Clipboard API 失败，尝试降级方案:', error)
    }
  }
  
  // 方法2: 降级使用传统 execCommand 方法 (兼容HTTP)
  if (!success) {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = currentHash.value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      
      textarea.select()
      textarea.setSelectionRange(0, currentHash.value.length)
      
      success = document.execCommand('copy')
      document.body.removeChild(textarea)
    } catch (error) {
      console.error('复制失败:', error)
    }
  }
  
  if (success) {
    showAlertMessage('Hash已复制到剪贴板', 'success')
  } else {
    showAlertMessage('复制失败', 'error')
  }
}
</script>

<template>
  <div class="gying-manager">
    <!-- Alert提示 -->
    <Transition name="slide-fade">
      <div v-if="showAlert" :class="['alert', `alert-${alertType}`]">
        <div class="flex items-center gap-2">
          <span v-if="alertType === 'success'">✓</span>
          <span v-else>✕</span>
          <span>{{ alertMessage }}</span>
        </div>
      </div>
    </Transition>
    
    <!-- 用户列表视图 -->
    <div v-if="currentView === 'list'" class="user-list-view">
      <!-- 返回按钮 -->
      <button @click="emit('back-to-center')" class="back-button mb-6">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        <span>返回账号管理中心</span>
      </button>
      
      <div class="header-section mb-8">
        <h1 class="text-3xl font-bold mb-2">观影管理</h1>
        <p class="text-muted-foreground">管理你的观影账号配置</p>
      </div>
      
      <!-- 用户卡片列表 -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <Card 
          v-for="user in savedUsers" 
          :key="user.hash"
          class="user-card cursor-pointer hover:shadow-lg transition-shadow"
          @click="handleSelectUser(user)"
        >
          <div class="p-6">
            <div class="flex items-center gap-4 mb-4">
              <div class="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white text-xl font-bold">
                <span v-if="user.username">
                  {{ user.username?.[0] || 'G' }}
                </span>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-6 h-6">
                  <rect x="2" y="3" width="20" height="18" rx="2" stroke-width="2"/>
                  <line x1="2" y1="7" x2="6" y2="7" stroke-width="2"/>
                  <line x1="2" y1="12" x2="6" y2="12" stroke-width="2"/>
                  <line x1="2" y1="17" x2="6" y2="17" stroke-width="2"/>
                  <line x1="18" y1="7" x2="22" y2="7" stroke-width="2"/>
                  <line x1="18" y1="12" x2="22" y2="12" stroke-width="2"/>
                  <line x1="18" y1="17" x2="22" y2="17" stroke-width="2"/>
                  <polygon points="10,9 10,15 15,12" fill="currentColor"/>
                </svg>
              </div>
              <div class="flex-1">
                <div class="font-medium">{{ user.username || '未登录' }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ user.last_login ? '最近登录: ' + formatDateTime(user.last_login) : '用户: ' + user.username }}
                </div>
              </div>
            </div>
            <div class="text-sm text-primary flex items-center gap-1">
              <span>管理</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
              </svg>
            </div>
          </div>
        </Card>
        
        <!-- 添加新账号卡片 -->
        <Card class="add-card cursor-pointer hover:shadow-lg transition-shadow" @click="handleShowAddForm">
          <div class="p-6 h-full flex flex-col items-center justify-center text-center gap-3">
            <div class="w-12 h-12 rounded-full border-2 border-dashed border-primary flex items-center justify-center">
              <svg class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
            </div>
            <div class="text-primary font-medium">添加账号</div>
            <div class="text-xs text-muted-foreground">配置新的观影账号</div>
          </div>
        </Card>
      </div>
    </div>
    
    <!-- 添加用户视图 -->
    <div v-else-if="currentView === 'add'" class="add-view">
      <!-- 返回按钮 -->
      <button 
        v-if="savedUsers.length === 0"
        @click="emit('back-to-center')" 
        class="back-button mb-6"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        <span>返回账号管理中心</span>
      </button>
      
      <div class="max-w-md mx-auto">
        <Card>
          <div class="p-8">
            <div class="text-center mb-6">
              <div class="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-8 h-8">
                  <rect x="2" y="3" width="20" height="18" rx="2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <line x1="2" y1="7" x2="6" y2="7" stroke-width="2" stroke-linecap="round"/>
                  <line x1="2" y1="12" x2="6" y2="12" stroke-width="2" stroke-linecap="round"/>
                  <line x1="2" y1="17" x2="6" y2="17" stroke-width="2" stroke-linecap="round"/>
                  <line x1="18" y1="7" x2="22" y2="7" stroke-width="2" stroke-linecap="round"/>
                  <line x1="18" y1="12" x2="22" y2="12" stroke-width="2" stroke-linecap="round"/>
                  <line x1="18" y1="17" x2="22" y2="17" stroke-width="2" stroke-linecap="round"/>
                  <polygon points="10,9 10,15 15,12" fill="currentColor" stroke="none"/>
                </svg>
              </div>
              <h2 class="text-2xl font-bold mb-2">添加观影账号</h2>
              <p class="text-muted-foreground text-sm">输入用户名开始配置</p>
            </div>
            
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium mb-2">用户名</label>
                <Input 
                  v-model="username" 
                  placeholder="请输入你的用户名" 
                  type="text"
                  @keyup.enter="handleAddUser"
                  class="text-center text-lg"
                />
                <p class="text-xs text-muted-foreground mt-2">
                  系统会生成专属hash保护你的隐私
                </p>
              </div>
              
              <div class="flex gap-2">
                <Button 
                  v-if="savedUsers.length > 0"
                  @click="handleBackToList" 
                  variant="outline"
                  class="flex-1 h-12"
                >
                  返回
                </Button>
                <Button 
                  @click="handleAddUser" 
                  :disabled="!username.trim() || generatingHash"
                  class="flex-1 h-12"
                >
                  {{ generatingHash ? '获取中...' : '确定' }}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
    
    <!-- 管理视图 -->
    <div v-else-if="currentView === 'manage'" class="manage-view">
      <!-- 顶部操作栏 -->
      <div class="flex items-center justify-between mb-6">
        <button @click="handleBackToList" class="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
          </svg>
          <span>返回列表</span>
        </button>
        
        <button 
          v-if="selectedUser"
          @click="handleDeleteAccount" 
          class="text-red-500 hover:text-red-600 text-sm transition-colors"
        >
          删除此账号
        </button>
      </div>
      
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- 左侧：站点配置 + 登录状态 -->
        <div class="space-y-6 lg:col-span-1">
          <!-- 站点配置 -->
          <Card>
            <div class="p-6 space-y-4">
              <h3 class="text-lg font-semibold flex items-center gap-2">
                <span>🌐</span>
                <span>观影站点</span>
              </h3>

              <div class="rounded-xl border border-border bg-muted/30 p-4">
                <div class="site-header-row">
                  <div class="text-sm text-muted-foreground">当前站点</div>
                  <button
                    v-if="hasCurrentBaseURL"
                    type="button"
                    class="site-edit-button"
                    :disabled="savingBaseURL"
                    @click="handleToggleBaseURLEdit"
                  >
                    {{ isEditingBaseURL ? '取消' : '编辑' }}
                  </button>
                </div>
                <a
                  :href="currentBaseURL"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="site-link"
                >
                  {{ currentBaseURL }}
                </a>
              </div>

              <div v-if="showBaseURLEditor">
                <label class="block text-sm font-medium mb-2">自定义域名</label>
                <Input
                  v-model="baseURLInput"
                  placeholder="例如: https://www.gying.net"
                  @keyup.enter="handleSaveBaseURL"
                />
              </div>

              <div v-if="showBaseURLEditor" class="site-config-notice">
                保存站点地址后，当前登录状态会被清空，需要重新登录。
              </div>

              <Button
                v-if="showBaseURLEditor"
                @click="handleSaveBaseURL"
                :disabled="savingBaseURL || !baseURLInput.trim()"
                class="w-full login-button"
              >
                {{ savingBaseURL ? '保存中...' : '保存站点地址' }}
              </Button>
            </div>
          </Card>

          <!-- 登录状态 -->
          <Card>
            <div class="p-6">
              <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>🔐</span>
                <span>登录状态</span>
              </h3>

              <div class="login-notice">
                登录前请先确认上方站点地址是否正确。
              </div>
              
              <!-- 已登录 -->
              <div v-if="isLoggedIn" class="space-y-4">
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between items-center">
                    <span class="text-muted-foreground">状态</span>
                    <div class="inline-flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs">
                      <span class="w-2 h-2 bg-green-500 rounded-full"></span>
                      <span>已登录</span>
                    </div>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">用户名</span>
                    <span>{{ status.username }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">登录时间</span>
                    <span class="text-right text-xs">{{ formatDateTime(status.login_time) }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">有效期</span>
                    <span>{{ status.expires_in_days }} 天</span>
                  </div>
                </div>
                
                <Button @click="handleLogout" variant="outline" class="w-full" size="sm">
                  退出登录
                </Button>
              </div>
              
              <!-- 未登录 -->
              <div v-else class="space-y-4">
                <div class="space-y-3">
                  <div>
                    <label class="block text-sm font-medium mb-2">用户名</label>
                    <Input 
                      v-model="loginUsername" 
                      placeholder="输入用户名"
                      @keyup.enter="handleLogin"
                    />
                  </div>
                  <div>
                    <label class="block text-sm font-medium mb-2">密码</label>
                    <Input 
                      v-model="loginPassword" 
                      type="password"
                      placeholder="输入密码"
                      @keyup.enter="handleLogin"
                    />
                  </div>
                  <Button 
                    @click="handleLogin" 
                    :disabled="loggingIn || !loginUsername.trim() || !loginPassword.trim()"
                    class="w-full login-button"
                  >
                    {{ loggingIn ? '登录中...' : '登录' }}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
        
        <!-- 右侧：API文档 + 测试搜索 -->
        <div class="space-y-6 lg:col-span-2">
          <!-- API文档（默认折叠） -->
          <Card>
            <details class="api-docs-section p-2">
              <summary class="py-4 px-4 cursor-pointer font-semibold flex items-center justify-center hover:bg-muted/30 transition-colors rounded-t">
                <div class="flex items-center gap-2">
                  <span>📖</span>
                  <span>API文档</span>
                </div>
                <svg class="w-5 h-5 transform transition-transform details-icon ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                </svg>
              </summary>
              
              <div class="p-6 pt-4 space-y-4">
                <!-- Hash信息 -->
                <div class="p-4 bg-muted/30 rounded-lg border border-border">
                  <div class="flex items-center justify-between mb-3">
                    <div class="text-sm text-muted-foreground font-medium">当前Hash</div>
                    <button 
                      @click="copyHashToClipboard"
                      class="flex items-center gap-1 px-2 py-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded-md transition-colors"
                    >
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                      </svg>
                      <span>复制</span>
                    </button>
                  </div>
                  <div class="font-mono text-sm text-foreground leading-relaxed break-all">{{ currentHash }}</div>
                </div>
                
                <!-- API调用示例 -->
                <div class="space-y-3">
                  <div class="text-sm font-medium text-muted-foreground">API调用示例</div>
                  
                  <details class="api-detail">
                    <summary class="cursor-pointer text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                      获取状态
                    </summary>
                    <div class="mt-2 p-3 bg-muted/50 rounded-lg">
                      <pre class="text-xs overflow-x-auto"><code>curl -X POST http://localhost:8888/gying/{{ currentHash.slice(0, 16) }}... \
  -H "Content-Type: application/json" \
  -d '{"action": "get_status"}'</code></pre>
                    </div>
                  </details>
                  
                  <details class="api-detail">
                    <summary class="cursor-pointer text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                      登录
                    </summary>
                    <div class="mt-2 p-3 bg-muted/50 rounded-lg">
                      <pre class="text-xs overflow-x-auto"><code>curl -X POST http://localhost:8888/gying/{{ currentHash.slice(0, 16) }}... \
  -H "Content-Type: application/json" \
  -d '{"action": "login", "username": "xxx", "password": "xxx"}'</code></pre>
                    </div>
                  </details>
                  
                  <details class="api-detail">
                    <summary class="cursor-pointer text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                      测试搜索
                    </summary>
                    <div class="mt-2 p-3 bg-muted/50 rounded-lg">
                      <pre class="text-xs overflow-x-auto"><code>curl -X POST http://localhost:8888/gying/{{ currentHash.slice(0, 16) }}... \
  -H "Content-Type: application/json" \
  -d '{"action": "test_search", "keyword": "遮天"}'</code></pre>
                    </div>
                  </details>
                </div>
              </div>
            </details>
          </Card>
          
          <!-- 测试搜索 -->
          <Card class="search-card">
            <div class="p-6 flex flex-col h-full">
              <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>🔍</span>
                <span>测试搜索</span>
              </h3>
              
              <div v-if="!isLoggedIn" class="text-center py-16 text-muted-foreground flex-1 flex items-center justify-center">
                <div>
                  <svg class="w-16 h-16 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                  </svg>
                  <p>请先登录后使用搜索功能</p>
                </div>
              </div>
              
              <div v-else class="space-y-4 flex-1 flex flex-col">
                <div class="flex gap-3">
                  <Input 
                    v-model="searchKeyword" 
                    placeholder="输入关键词测试搜索"
                    class="flex-1"
                    @keyup.enter="handleTestSearch"
                  />
                  <Button 
                    @click="handleTestSearch" 
                    :disabled="searching || !searchKeyword.trim()"
                    class="search-button"
                  >
                    <span v-if="searching">搜索中...</span>
                    <span v-else>搜索</span>
                  </Button>
                </div>
                
                <!-- 搜索结果 -->
                <div v-if="searchResults.length > 0" class="search-results-container flex-1">
                  <div class="text-sm text-muted-foreground mb-3">
                    找到 <strong class="text-foreground">{{ searchResults.length }}</strong> 条结果
                  </div>
                  
                  <div class="search-results-list">
                    <div 
                      v-for="(result, index) in searchResults" 
                      :key="result.unique_id"
                      class="result-item"
                    >
                      <div class="font-medium text-sm mb-2">
                        {{ index + 1 }}. {{ result.title }}
                      </div>
                      <div 
                        v-for="link in result.links" 
                        :key="link.url"
                        class="link-item"
                      >
                        <span class="link-type">{{ link.type }}</span>
                        <span class="link-url">{{ link.url }}</span>
                        <span v-if="link.password" class="link-password">
                          🔑 {{ link.password }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 样式与QQPDManager.vue保持一致 */
.gying-manager {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}

/* Alert动画 */
.alert {
  position: fixed;
  top: 24px;
  right: 24px;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  backdrop-filter: blur(8px);
}

.alert-success {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.alert-error {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

@media (prefers-color-scheme: dark) {
  .alert-success {
    background: rgba(16, 185, 129, 0.2);
    color: #6ee7b7;
  }
  
  .alert-error {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }
}

.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}

.slide-fade-enter-from {
  transform: translateX(20px);
  opacity: 0;
}

.slide-fade-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

/* 用户卡片 */
.user-card {
  transition: all 0.2s ease;
}

.user-card:hover {
  transform: translateY(-2px);
}

.add-card {
  border: 2px dashed hsl(var(--border));
  background: hsl(var(--muted) / 0.3);
}

.add-card:hover {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.05);
}

/* API文档样式 */
.api-docs-section {
  display: flex;
  flex-direction: column;
}

.api-docs-section summary {
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.api-docs-section[open] summary {
  border-bottom: 1px solid hsl(var(--border));
}

.api-docs-section[open] .details-icon {
  transform: rotate(180deg);
}

.api-detail summary {
  transition: all 0.2s ease;
  user-select: none;
  font-weight: 500;
}

.api-detail[open] summary {
  color: hsl(var(--primary));
}

.api-detail pre {
  margin: 0;
  font-family: ui-monospace, monospace;
  line-height: 1.5;
}

.api-detail code {
  color: hsl(var(--foreground));
  font-size: 11px;
}

/* 搜索卡片 */
.search-card {
  height: fit-content;
  max-height: calc(100vh - 300px);
  display: flex;
  flex-direction: column;
}

.search-results-container {
  display: flex;
  flex-direction: column;
  min-height: 0;

  min-width: 0;}

.search-results-list {
  overflow-y: auto;
  max-height: 400px;
  padding-right: 8px;
  scrollbar-width: thin;

  min-width: 0;}

.search-results-list::-webkit-scrollbar {
  width: 6px;
}

.search-results-list::-webkit-scrollbar-track {
  background: hsl(var(--muted) / 0.3);
  border-radius: 3px;
}

.search-results-list::-webkit-scrollbar-thumb {
  background: hsl(var(--muted-foreground) / 0.3);
  border-radius: 3px;
}

.search-results-list::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 0.5);
}

/* 搜索结果项 */
.result-item {
  padding: 12px;
  background: hsl(var(--muted) / 0.3);
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  transition: all 0.2s ease;
  margin-bottom: 12px;

  min-width: 0;
  overflow-wrap: anywhere;}

.result-item:hover {
  background: hsl(var(--muted) / 0.5);
  border-color: hsl(var(--primary) / 0.3);
}

.link-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 12px;
  background: hsl(var(--background));
  border-radius: 4px;
  margin-top: 4px;

  min-width: 0;}

.link-type {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  border-radius: 4px;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  min-width: 50px;
  justify-content: center;
}

.link-url {
  flex: 1;
  color: hsl(var(--muted-foreground));
  word-break: break-all;

  min-width: 0;
  overflow-wrap: anywhere;}

.link-password {
  color: hsl(var(--primary));
  font-weight: 500;
}

/* 按钮尺寸优化 */
.login-button {
  height: 44px;
  font-size: 15px;
  font-weight: 600;
}

.search-button {
  min-width: 100px;
  padding-left: 24px;
  padding-right: 24px;
  font-weight: 600;
}

.site-link {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  color: hsl(var(--primary));
  font-weight: 600;
  line-height: 1.5;
  word-break: break-all;
  text-decoration: none;
}

.site-link:hover {
  text-decoration: underline;
}

.site-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.site-edit-button {
  flex-shrink: 0;
  min-width: 3.5rem;
  height: 2rem;
  padding: 0 0.75rem;
  border: 1px solid hsl(var(--border));
  border-radius: 9999px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 0.75rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

.site-edit-button:hover:not(:disabled) {
  border-color: hsl(var(--primary));
  color: hsl(var(--primary));
}

.site-edit-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.site-config-notice,
.login-notice {
  border-radius: 0.75rem;
  padding: 0.75rem;
  font-size: 0.75rem;
  line-height: 1.5;
}

.site-config-notice {
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: rgb(180, 83, 9);
}

.login-notice {
  margin-bottom: 1rem;
  background: hsl(var(--muted) / 0.4);
  color: hsl(var(--muted-foreground));
}

@media (prefers-color-scheme: dark) {
  .site-config-notice {
    border-color: rgba(251, 191, 36, 0.3);
    background: rgba(245, 158, 11, 0.18);
    color: rgb(253, 230, 138);
  }
}

/* 响应式 */
@media (max-width: 1024px) {
  .gying-manager .grid {
    grid-template-columns: 1fr;
  }
  
  .gying-manager .lg\:col-span-1,
  .gying-manager .lg\:col-span-2 {
    grid-column: span 1;
  }
  
  .search-card {
    min-height: auto;
    max-height: none;
  }
  
  .search-results-list {
    max-height: 500px;
  }
}

@media (max-width: 768px) {
  .gying-manager {
    padding: 0 0.5rem;
  }
  
  .alert {
    left: 12px;
    right: 12px;
    top: 12px;
  }
  
  .search-button {
    min-width: 80px;
    padding-left: 16px;
    padding-right: 16px;
  }
  
  .search-results-list {
    max-height: 400px;
  }
}

/* 返回按钮 */
.back-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: transparent;
  color: hsl(var(--muted-foreground));
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-button:hover {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
  border-color: hsl(var(--accent));
}

/* 页面过渡动画 */
.user-list-view,
.add-view,
.manage-view {
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
