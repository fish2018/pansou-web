<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import * as qqpdApi from '@/api/qqpd'
import type { QQPDStatus, QQPDSearchResult } from '@/types/qqpd'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'

// 定义事件
const emit = defineEmits<{
  (e: 'back-to-center'): void
}>()

// ============================================================
// 本地存储的用户列表
// ============================================================

interface SavedUser {
  qq_number: string
  hash: string
  qq_masked: string
  last_login: string
}

const savedUsers = ref<SavedUser[]>([])
const currentView = ref<'list' | 'add' | 'manage'>('list')
const selectedUser = ref<SavedUser | null>(null)

// 从localStorage加载用户列表
const loadSavedUsers = () => {
  const stored = localStorage.getItem('qqpd_users')
  if (stored) {
    try {
      savedUsers.value = JSON.parse(stored)
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
  localStorage.setItem('qqpd_users', JSON.stringify(savedUsers.value))
}

// 添加新用户到列表
const addUserToList = (qqNumber: string, hash: string, qqMasked: string) => {
  const user: SavedUser = {
    qq_number: qqNumber,
    hash: hash,
    qq_masked: qqMasked,
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
// 添加QQ号界面
// ============================================================

const qqNumber = ref('')
const generatingHash = ref(false)

const handleAddQQ = async () => {
  if (!qqNumber.value.trim()) {
    showAlertMessage('请输入QQ号', 'error')
    return
  }
  
  generatingHash.value = true
  
  try {
    const hash = await qqpdApi.getHashByQQNumber(qqNumber.value.trim())
    
    // 切换到管理界面
    selectedUser.value = {
      qq_number: qqNumber.value.trim(),
      hash: hash,
      qq_masked: '', // 登录成功后更新
      last_login: new Date().toISOString()
    }
    
    currentHash.value = hash
    currentView.value = 'manage'
    
    // 只加载一次状态，不启动轮询
    await loadStatus(true)
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
  // 只加载一次状态，不启动轮询
  loadStatus(true)
}

const handleBackToList = () => {
  stopAllPolling()
  selectedUser.value = null
  currentHash.value = ''
  currentView.value = savedUsers.value.length > 0 ? 'list' : 'add'
  qqNumber.value = ''
  isEditingChannels.value = false
}

const handleShowAddForm = () => {
  currentView.value = 'add'
  qqNumber.value = ''
}

// ============================================================
// 管理界面数据
// ============================================================

const currentHash = ref<string>('')

const status = ref<QQPDStatus>({
  hash: '',
  logged_in: false,
  status: 'pending',
  qq_masked: '',
  login_time: '',
  expire_time: '',
  expires_in_days: 0,
  channels: [],
  channel_count: 0
})

const qrcodeImage = ref<string>('')
const channelsText = ref<string>('')
const searchKeyword = ref<string>('')
const searchResults = ref<QQPDSearchResult[]>([])
const searching = ref(false)

// 只保留登录检查的定时器（未登录时需要）
let loginCheckInterval: number | null = null

const showAlert = ref(false)
const alertMessage = ref('')
const alertType = ref<'success' | 'error'>('success')

// ============================================================
// 计算属性
// ============================================================

const qqFirstChar = computed(() => {
  return status.value.qq_masked?.[0] || selectedUser.value?.qq_number?.[0] || 'Q'
})

const isLoggedIn = computed(() => {
  return status.value.logged_in && status.value.status === 'active'
})

// ============================================================
// 生命周期
// ============================================================

onMounted(() => {
  loadSavedUsers()
})

onUnmounted(() => {
  stopAllPolling()
})

// ============================================================
// 状态管理
// ============================================================

// 标记用户是否正在编辑频道
const isEditingChannels = ref(false)

const loadStatus = async (forceUpdateChannels = false) => {
  if (!currentHash.value) return
  
  try {
    const response = await qqpdApi.getStatus(currentHash.value)
    
    if (response.success && response.data) {
      status.value = response.data
      
      // 如果登录成功，更新用户列表中的qq_masked
      if (response.data.logged_in && response.data.qq_masked && selectedUser.value) {
        selectedUser.value.qq_masked = response.data.qq_masked
        selectedUser.value.last_login = new Date().toISOString()
        addUserToList(
          selectedUser.value.qq_number,
          selectedUser.value.hash,
          response.data.qq_masked
        )
      }
      
      // 更新二维码（只在未登录时需要）
      if (!response.data.logged_in && response.data.qrcode_base64) {
        qrcodeImage.value = response.data.qrcode_base64
      }
      
      // 更新频道列表（只在未编辑或强制更新时）
      if (forceUpdateChannels || !isEditingChannels.value) {
        channelsText.value = response.data.channels.join('\n')
      }
      
      // 登录状态处理
      if (!response.data.logged_in && !loginCheckInterval) {
        startLoginPolling()
      } else if (response.data.logged_in && loginCheckInterval) {
        stopLoginPolling()
      }
    }
  } catch (error) {
    console.error('获取状态失败:', error)
  }
}

// 不再需要定时轮询状态，只在特定时机调用
const stopAllPolling = () => {
  stopLoginPolling()
}

// ============================================================
// 登录管理
// ============================================================

const startLoginPolling = () => {
  if (loginCheckInterval) return
  loginCheckInterval = window.setInterval(checkLoginStatus, 2000)
}

const stopLoginPolling = () => {
  if (loginCheckInterval) {
    clearInterval(loginCheckInterval)
    loginCheckInterval = null
  }
}

const checkLoginStatus = async () => {
  if (!currentHash.value) return
  
  try {
    const response = await qqpdApi.checkLogin(currentHash.value)
    
    if (response.success && response.data.login_status === 'success') {
      stopLoginPolling()
      showAlertMessage('登录成功！', 'success')
      // 登录成功后重新加载状态
      await loadStatus(true)
    }
  } catch (error) {
    console.error('检查登录失败:', error)
  }
}

const handleRefreshQRCode = async () => {
  if (!currentHash.value) return
  
  try {
    const response = await qqpdApi.refreshQRCode(currentHash.value)
    
    if (response.success) {
      showAlertMessage('二维码已刷新', 'success')
      // 刷新二维码后重新加载状态
      await loadStatus(true)
      startLoginPolling()
    }
  } catch (error) {
    console.error('刷新二维码失败:', error)
    showAlertMessage('刷新二维码失败', 'error')
  }
}

const handleLogout = async () => {
  if (!currentHash.value) return
  if (!confirm('确定要退出登录吗？')) return
  
  try {
    const response = await qqpdApi.logout(currentHash.value)
    
    if (response.success) {
      showAlertMessage('已退出登录', 'success')
      // 退出登录后重新加载状态
      await loadStatus(true)
    }
  } catch (error) {
    console.error('退出登录失败:', error)
    showAlertMessage('退出登录失败', 'error')
  }
}

// 删除此账号
const handleDeleteAccount = () => {
  if (!selectedUser.value) return
  
  if (confirm(`确定要删除账号 ${selectedUser.value.qq_masked || selectedUser.value.qq_number} 吗？\n\n这将删除本地保存的配置信息。`)) {
    removeUser(selectedUser.value.hash)
    handleBackToList()
    showAlertMessage('账号已删除', 'success')
  }
}

// ============================================================
// 频道管理
// ============================================================

const handleSaveChannels = async () => {
  if (!currentHash.value) return
  
  const channels = channelsText.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
  
  if (channels.length === 0) {
    showAlertMessage('请至少添加一个频道', 'error')
    return
  }
  
  try {
    isEditingChannels.value = false  // 保存时标记为非编辑状态
    const response = await qqpdApi.setChannels(currentHash.value, channels)
    
    if (response.success) {
      const count = response.data.channel_count
      const invalidCount = response.data.invalid_channels?.length || 0
      
      let msg = `已保存 ${count} 个频道`
      if (invalidCount > 0) {
        msg += `，${invalidCount} 个无效`
      }
      
      showAlertMessage(msg, 'success')
      // 保存成功后重新加载状态，强制更新频道列表
      await loadStatus(true)
    }
  } catch (error) {
    console.error('保存频道失败:', error)
    showAlertMessage('保存频道失败', 'error')
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
    const response = await qqpdApi.testSearch(currentHash.value, searchKeyword.value.trim(), 20)
    
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
  <div class="qqpd-manager">
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
        <h1 class="text-3xl font-bold mb-2">QQ频道管理</h1>
        <p class="text-muted-foreground">管理你的QQ频道搜索配置</p>
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
              <div class="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold">
                {{ user.qq_masked?.[0] || user.qq_number?.[0] || 'Q' }}
              </div>
              <div class="flex-1">
                <div class="font-medium">{{ user.qq_masked || '未登录' }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ user.last_login ? '最近登录: ' + formatDateTime(user.last_login) : 'QQ ' + user.qq_number }}
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
            <div class="text-primary font-medium">添加QQ账号</div>
            <div class="text-xs text-muted-foreground">配置新的QQ频道搜索</div>
          </div>
        </Card>
      </div>
    </div>
    
    <!-- 添加QQ号视图 -->
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
              <div class="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                </svg>
              </div>
              <h2 class="text-2xl font-bold mb-2">添加QQ账号</h2>
              <p class="text-muted-foreground text-sm">输入QQ号开始配置频道搜索</p>
            </div>
            
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium mb-2">QQ号</label>
                <Input 
                  v-model="qqNumber" 
                  placeholder="请输入你的QQ号" 
                  type="text"
                  @keyup.enter="handleAddQQ"
                  class="text-center text-lg"
                />
                <p class="text-xs text-muted-foreground mt-2">
                  系统会生成专属hash保护你的隐私，QQ号不会被存储
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
                  @click="handleAddQQ" 
                  :disabled="!qqNumber.trim() || generatingHash"
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
        <!-- 左侧：登录状态 + 频道管理 -->
        <div class="space-y-6 lg:col-span-1">
          <!-- 登录状态 -->
          <Card>
            <div class="p-6">
              <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>📱</span>
                <span>登录状态</span>
              </h3>
              
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
                    <span class="text-muted-foreground">QQ号</span>
                    <span>{{ status.qq_masked }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">登录时间</span>
                    <span class="text-right text-xs">{{ formatDateTime(status.login_time) }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">有效期</span>
                    <span class="text-right text-xs">{{ status.expire_time ? formatDateTime(status.expire_time) : '-' }}</span>
                  </div>
                </div>
                
                <Button @click="handleLogout" variant="outline" class="w-full" size="sm">
                  退出登录
                </Button>
              </div>
              
              <!-- 未登录 -->
              <div v-else class="space-y-4">
                <div class="flex flex-col items-center gap-3">
                  <div class="qrcode-wrapper">
                    <img 
                      v-if="qrcodeImage" 
                      :src="qrcodeImage" 
                      alt="登录二维码"
                      class="qrcode-image"
                    />
                    <div v-else class="qrcode-placeholder">
                      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                  </div>
                  <div class="text-center">
                    <p class="text-sm font-medium mb-1">扫码登录</p>
                    <p class="text-xs text-muted-foreground">使用手机QQ扫描二维码</p>
                  </div>
                  <Button @click="handleRefreshQRCode" variant="outline" size="sm" class="w-full">
                    刷新二维码
                  </Button>
                </div>
              </div>
            </div>
          </Card>
          
          <!-- 频道管理 -->
          <Card>
            <div class="p-6">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-semibold flex items-center gap-2">
                  <span>📋</span>
                  <span>频道管理</span>
                  <span class="text-sm text-muted-foreground font-normal">({{ status.channel_count }} 个)</span>
                </h3>
                <a 
                  href="https://github.com/fish2018/pansou/issues/4" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  class="channel-link"
                  title="查看更多频道配置"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                  </svg>
                  <span class="link-text">更多频道</span>
                </a>
              </div>
              
              <div v-if="!isLoggedIn" class="text-center py-8 text-muted-foreground">
                <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
                <p>请先登录后配置频道</p>
              </div>
              
              <div v-else class="space-y-3">
                <div class="text-sm text-muted-foreground">
                  每行一个频道号或链接，支持自动识别
                </div>
                <textarea 
                  v-model="channelsText" 
                  rows="10"
                  class="channel-textarea"
                  placeholder="pd97631607
languan8K115
https://pd.qq.com/g/m250319e25"
                  @focus="isEditingChannels = true"
                  @blur="isEditingChannels = false"
                />
                <Button @click="handleSaveChannels" class="save-channels-button">
                  💾 保存配置
                </Button>
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
                      <pre class="text-xs overflow-x-auto"><code>curl -X POST http://localhost:8888/qqpd/{{ currentHash.slice(0, 16) }}... \
  -H "Content-Type: application/json" \
  -d '{"action": "get_status"}'</code></pre>
                    </div>
                  </details>
                  
                  <details class="api-detail">
                    <summary class="cursor-pointer text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                      设置频道
                    </summary>
                    <div class="mt-2 p-3 bg-muted/50 rounded-lg">
                      <pre class="text-xs overflow-x-auto"><code>curl -X POST http://localhost:8888/qqpd/{{ currentHash.slice(0, 16) }}... \
  -H "Content-Type: application/json" \
  -d '{"action": "set_channels", "channels": ["pd97631607"]}'</code></pre>
                    </div>
                  </details>
                  
                  <details class="api-detail">
                    <summary class="cursor-pointer text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                      测试搜索
                    </summary>
                    <div class="mt-2 p-3 bg-muted/50 rounded-lg">
                      <pre class="text-xs overflow-x-auto"><code>curl -X POST http://localhost:8888/qqpd/{{ currentHash.slice(0, 16) }}... \
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
.qqpd-manager {
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

/* 二维码 */
.qrcode-wrapper {
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid hsl(var(--border));
  border-radius: 12px;
  overflow: hidden;
  background: hsl(var(--background));
}

.qrcode-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qrcode-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
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

.api-docs-section > div {
  flex: 1;
  display: flex;
  flex-direction: column;
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

/* 频道链接 */
.channel-link {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background: transparent;
  border: 1px solid hsl(var(--border));
  border-radius: 0.375rem;
  color: hsl(var(--muted-foreground));
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.channel-link:hover {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--primary));
  transform: translateY(-1px);
  box-shadow: 0 2px 8px hsl(var(--primary) / 0.3);
}

.channel-link .link-text {
  white-space: nowrap;
}

/* 频道输入框 */
.channel-textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  transition: all 0.2s ease;
}

.channel-textarea:focus {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.1);
}

.channel-textarea::placeholder {
  color: hsl(var(--muted-foreground));
}

/* 搜索卡片高度控制 */
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
.search-button {
  min-width: 100px;
  padding-left: 24px;
  padding-right: 24px;
  font-weight: 600;
}

.save-channels-button {
  width: 100%;
  padding-top: 12px;
  padding-bottom: 12px;
  font-weight: 600;
  font-size: 15px;
}

/* 响应式 */
@media (max-width: 1024px) {
  .qqpd-manager .grid {
    grid-template-columns: 1fr;
  }
  
  .qqpd-manager .lg\:col-span-1,
  .qqpd-manager .lg\:col-span-2 {
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
  .qqpd-manager {
    padding: 0 0.5rem;
  }
  
  .alert {
    left: 12px;
    right: 12px;
    top: 12px;
  }
  
  .qrcode-wrapper {
    width: 160px;
    height: 160px;
  }
  
  .search-button {
    min-width: 80px;
    padding-left: 16px;
    padding-right: 16px;
  }
  
  .search-results-list {
    max-height: 400px;
  }

  .channel-link .link-text {
    display: none;
  }
  
  .channel-link {
    padding: 0.5rem;
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