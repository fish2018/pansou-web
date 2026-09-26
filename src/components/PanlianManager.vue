<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import * as panlianApi from '@/api/panlian'
import type { PanlianStatus, PanlianSearchResult } from '@/types/panlian'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'

const emit = defineEmits<{
  (e: 'back-to-center'): void
}>()

interface SavedUser {
  username: string
  hash: string
  last_login: string
}

const savedUsers = ref<SavedUser[]>([])
const currentView = ref<'list' | 'add' | 'manage'>('list')
const selectedUser = ref<SavedUser | null>(null)

const identifier = ref('')
const generatingHash = ref(false)
const currentHash = ref('')

const status = ref<PanlianStatus>({
  hash: '',
  logged_in: false,
  status: 'pending',
  username: '',
  login_time: '',
  expire_time: '',
  expires_in_days: 0
})

const loginUsername = ref('')
const loginPassword = ref('')
const loggingIn = ref(false)

// 站点自 2026 年起登录改成三步：图形验证码 → 账号密码 → 输入账号绑定的邮箱。
// 验证码只能靠人眼看图，插件不做识别，所以整条流程由这个向导带着用户走完。
const captchaId = ref('')
const captchaImage = ref('')
const captchaCode = ref('')
const loadingCaptcha = ref(false)
const needEmail = ref(false)
const confirmId = ref('')
const emailHint = ref('')
const loginEmail = ref('')

const searchKeyword = ref('')
const searchResults = ref<PanlianSearchResult[]>([])
const searching = ref(false)

const showAlert = ref(false)
const alertMessage = ref('')
const alertType = ref<'success' | 'error'>('success')

const isLoggedIn = computed(() => status.value.logged_in && status.value.status === 'active')
const totalSearchLinks = computed(() =>
  searchResults.value.reduce((sum, result) => sum + (result.links?.length || 0), 0)
)

const loadSavedUsers = () => {
  const stored = localStorage.getItem('panlian_users')
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
      localStorage.setItem('panlian_users', JSON.stringify(savedUsers.value))
    } catch {
      savedUsers.value = []
    }
  }

  if (savedUsers.value.length === 0) {
    currentView.value = 'add'
  }
}

const saveSavedUsers = () => {
  localStorage.setItem('panlian_users', JSON.stringify(savedUsers.value))
  window.dispatchEvent(new StorageEvent('storage', { key: 'panlian_users' }))
}

const addUserToList = (username: string, hash: string) => {
  const user: SavedUser = {
    username,
    hash,
    last_login: new Date().toISOString()
  }

  const index = savedUsers.value.findIndex(u => u.hash === hash)
  if (index >= 0) {
    savedUsers.value[index] = user
  } else {
    savedUsers.value.push(user)
  }
  saveSavedUsers()
}

const removeUser = (hash: string) => {
  savedUsers.value = savedUsers.value.filter(u => u.hash !== hash)
  saveSavedUsers()
}

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

const loadStatus = async () => {
  if (!currentHash.value) return
  try {
    const response = await panlianApi.getStatus(currentHash.value)
    if (response.success && response.data) {
      status.value = response.data
      if (response.data.logged_in && response.data.username && selectedUser.value) {
        selectedUser.value.username = response.data.username
        selectedUser.value.last_login = new Date().toISOString()
        addUserToList(selectedUser.value.username, selectedUser.value.hash)
      }
      if (!response.data.logged_in) {
        // 未登录就把验证码准备好，用户点登录时不用等图。
        void loadCaptcha()
      } else {
        resetLoginFlow()
      }
    }
  } catch (error) {
    console.error('获取状态失败:', error)
  }
}

const handleAddUser = async () => {
  if (!identifier.value.trim()) {
    showAlertMessage('请输入账号标识', 'error')
    return
  }

  generatingHash.value = true
  try {
    const hash = await panlianApi.getHashByIdentifier(identifier.value.trim())
    selectedUser.value = {
      username: identifier.value.trim(),
      hash,
      last_login: new Date().toISOString()
    }
    currentHash.value = hash
    currentView.value = 'manage'
    await loadStatus()
  } catch (error) {
    console.error('获取hash失败:', error)
    showAlertMessage('获取hash失败', 'error')
  } finally {
    generatingHash.value = false
  }
}

const handleSelectUser = (user: SavedUser) => {
  selectedUser.value = user
  currentHash.value = user.hash
  currentView.value = 'manage'
  void loadStatus()
}

const handleBackToList = () => {
  selectedUser.value = null
  currentHash.value = ''
  currentView.value = savedUsers.value.length > 0 ? 'list' : 'add'
  identifier.value = ''
  loginUsername.value = ''
  loginPassword.value = ''
  searchKeyword.value = ''
  searchResults.value = []
  resetLoginFlow()
}

const handleShowAddForm = () => {
  currentView.value = 'add'
  identifier.value = ''
}

const loadCaptcha = async () => {
  if (!currentHash.value) return
  loadingCaptcha.value = true
  try {
    const response = await panlianApi.getCaptcha(currentHash.value)
    if (response.success && response.data) {
      captchaId.value = response.data.captcha_id
      captchaImage.value = response.data.image
      captchaCode.value = ''
    } else {
      showAlertMessage(response.message || '获取验证码失败', 'error')
    }
  } catch (error: any) {
    console.error('获取验证码失败:', error)
    showAlertMessage(error.response?.data?.message || '获取验证码失败', 'error')
  } finally {
    loadingCaptcha.value = false
  }
}

const resetLoginFlow = () => {
  needEmail.value = false
  confirmId.value = ''
  emailHint.value = ''
  loginEmail.value = ''
  captchaCode.value = ''
}

const backToLoginStep = () => {
  needEmail.value = false
  confirmId.value = ''
  emailHint.value = ''
  void loadCaptcha()
}

const handleLogin = async () => {
  if (!currentHash.value) return
  if (!loginUsername.value.trim() || !loginPassword.value.trim()) {
    showAlertMessage('请输入用户名和密码', 'error')
    return
  }
  if (!captchaCode.value.trim()) {
    showAlertMessage('请输入图中验证码', 'error')
    return
  }

  loggingIn.value = true
  try {
    const response = await panlianApi.login(
      currentHash.value,
      loginUsername.value.trim(),
      loginPassword.value.trim(),
      captchaId.value,
      captchaCode.value.trim()
    )
    const data = response.data || {}

    // 第二步：站点要求输入该账号绑定的邮箱，密码与验证码这一步已经过了。
    if (response.success && data.need_email) {
      needEmail.value = true
      confirmId.value = data.confirm_id || ''
      emailHint.value = data.email_hint || ''
      showAlertMessage('请继续输入该账号绑定的邮箱完成验证', 'success')
      return
    }
    if (response.success) {
      showAlertMessage('登录成功！', 'success')
      resetLoginFlow()
      loginPassword.value = ''
      await loadStatus()
      return
    }

    showAlertMessage(response.message || '登录失败', 'error')
    // 验证码错/过期由后端标记，这里自动换一张，用户不用手动点。
    if (data.captcha_required || data.captcha_invalid) {
      await loadCaptcha()
    }
  } catch (error: any) {
    console.error('登录失败:', error)
    const message = error.response?.data?.message || '登录失败'
    showAlertMessage(message, 'error')
    await loadCaptcha()
  } finally {
    loggingIn.value = false
  }
}

const handleConfirmEmail = async () => {
  if (!currentHash.value || !confirmId.value) return
  if (!loginEmail.value.trim()) {
    showAlertMessage('请输入该账号绑定的邮箱', 'error')
    return
  }

  loggingIn.value = true
  try {
    const response = await panlianApi.confirmEmail(
      currentHash.value,
      loginUsername.value.trim(),
      loginPassword.value,
      confirmId.value,
      loginEmail.value.trim()
    )
    if (response.success) {
      showAlertMessage('登录成功！', 'success')
      resetLoginFlow()
      loginPassword.value = ''
      await loadStatus()
    } else {
      showAlertMessage(response.message || '邮箱确认失败', 'error')
    }
  } catch (error: any) {
    console.error('邮箱确认失败:', error)
    showAlertMessage(error.response?.data?.message || '邮箱确认失败', 'error')
  } finally {
    loggingIn.value = false
  }
}

const handleLogout = async () => {
  if (!currentHash.value) return
  if (!confirm('确定要退出登录吗？')) return

  try {
    const response = await panlianApi.logout(currentHash.value)
    if (response.success) {
      showAlertMessage('已退出登录', 'success')
      await loadStatus()
    }
  } catch (error) {
    console.error('退出登录失败:', error)
    showAlertMessage('退出登录失败', 'error')
  }
}

const handleDeleteAccount = () => {
  if (!selectedUser.value) return
  if (confirm(`确定要删除账号 ${selectedUser.value.username || selectedUser.value.hash.slice(0, 8)} 吗？`)) {
    removeUser(selectedUser.value.hash)
    handleBackToList()
    showAlertMessage('账号已删除', 'success')
  }
}

const handleTestSearch = async () => {
  if (!currentHash.value) return
  if (!searchKeyword.value.trim()) {
    showAlertMessage('请输入搜索关键词', 'error')
    return
  }

  searching.value = true
  searchResults.value = []
  try {
    const response = await panlianApi.testSearch(currentHash.value, searchKeyword.value.trim())
    if (response.success) {
      searchResults.value = response.data.results || []
      if (searchResults.value.length === 0) {
        showAlertMessage('未找到结果', 'error')
      }
    } else {
      showAlertMessage(response.message || '搜索失败', 'error')
    }
  } catch (error: any) {
    console.error('搜索失败:', error)
    const message = error.response?.data?.message || '搜索失败'
    showAlertMessage(message, 'error')
  } finally {
    searching.value = false
  }
}

const copyHashToClipboard = async () => {
  if (!currentHash.value) return
  try {
    await navigator.clipboard.writeText(currentHash.value)
    showAlertMessage('Hash已复制到剪贴板', 'success')
  } catch {
    showAlertMessage('复制失败', 'error')
  }
}

onMounted(() => {
  loadSavedUsers()
})
</script>

<template>
  <div class="panlian-manager">
    <Transition name="slide-fade">
      <div v-if="showAlert" :class="['alert', `alert-${alertType}`]">
        <div class="flex items-center gap-2">
          <span v-if="alertType === 'success'">✓</span>
          <span v-else>✕</span>
          <span>{{ alertMessage }}</span>
        </div>
      </div>
    </Transition>

    <div v-if="currentView === 'list'" class="user-list-view">
      <button @click="emit('back-to-center')" class="back-button mb-6">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        <span>返回账号管理中心</span>
      </button>

      <div class="header-section mb-8">
        <h1 class="text-3xl font-bold mb-2">盘链管理</h1>
        <p class="text-muted-foreground">管理你的盘链账号配置</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <Card
          v-for="user in savedUsers"
          :key="user.hash"
          class="user-card cursor-pointer hover:shadow-lg transition-shadow"
          @click="handleSelectUser(user)"
        >
          <div class="p-6">
            <div class="flex items-center gap-4 mb-4">
              <div class="w-12 h-12 rounded-full bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center text-white text-xl font-bold">
                {{ user.username?.[0] || '盘' }}
              </div>
              <div class="flex-1">
                <div class="font-medium">{{ user.username || '未登录' }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ user.last_login ? '最近登录: ' + formatDateTime(user.last_login) : user.hash.slice(0, 12) + '...' }}
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

        <Card class="add-card cursor-pointer hover:shadow-lg transition-shadow" @click="handleShowAddForm">
          <div class="p-6 h-full flex flex-col items-center justify-center text-center gap-3">
            <div class="w-12 h-12 rounded-full border-2 border-dashed border-primary flex items-center justify-center">
              <svg class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
            </div>
            <div class="text-primary font-medium">添加账号</div>
            <div class="text-xs text-muted-foreground">配置新的盘链账号</div>
          </div>
        </Card>
      </div>
    </div>

    <div v-else-if="currentView === 'add'" class="add-view">
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
              <div class="w-16 h-16 rounded-full bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">
                链
              </div>
              <h2 class="text-2xl font-bold mb-2">添加盘链账号</h2>
              <p class="text-muted-foreground text-sm">输入一个账号标识开始管理</p>
            </div>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium mb-2">账号标识</label>
                <Input
                  v-model="identifier"
                  placeholder="例如用户名 pansou"
                  type="text"
                  @keyup.enter="handleAddUser"
                  class="text-center text-lg"
                />
                <p class="text-xs text-muted-foreground mt-2">
                  系统会生成专属 hash，在本地保存管理入口。
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
                  :disabled="!identifier.trim() || generatingHash"
                  :loading="generatingHash"
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

    <div v-else-if="currentView === 'manage'" class="manage-view">
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
        <div class="space-y-6 lg:col-span-1">
          <Card>
            <div class="p-6">
              <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>🔐</span>
                <span>登录状态</span>
              </h3>

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
                    <span>{{ status.username || '-' }}</span>
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
                  <div v-if="!needEmail">
                    <label class="block text-sm font-medium mb-2">图形验证码</label>
                    <div class="captcha-row">
                      <Input
                        v-model="captchaCode"
                        placeholder="输入图中字符"
                        @keyup.enter="handleLogin"
                      />
                      <img
                        v-if="captchaImage"
                        :src="captchaImage"
                        alt="验证码"
                        title="点击换一张"
                        class="captcha-image"
                        @click="loadCaptcha"
                      />
                    </div>
                    <p class="captcha-tip">
                      {{ loadingCaptcha ? '验证码加载中...' : '看不清？点图片换一张' }}
                    </p>
                  </div>
                  <div v-else>
                    <label class="block text-sm font-medium mb-2">账号绑定的邮箱</label>
                    <Input
                      v-model="loginEmail"
                      placeholder="输入该账号绑定的邮箱"
                      @keyup.enter="handleConfirmEmail"
                    />
                    <p class="captcha-tip">
                      站点为确认本人操作，需要该账号绑定的邮箱<template v-if="emailHint">（形如 {{ emailHint }}）</template>
                    </p>
                  </div>
                  <Button
                    v-if="!needEmail"
                    @click="handleLogin"
                    :disabled="loggingIn || !loginUsername.trim() || !loginPassword.trim() || !captchaCode.trim()"
                    :loading="loggingIn"
                    class="w-full login-button"
                  >
                    {{ loggingIn ? '登录中...' : '登录' }}
                  </Button>
                  <template v-else>
                    <Button
                      @click="handleConfirmEmail"
                      :disabled="loggingIn || !loginEmail.trim()"
                      :loading="loggingIn"
                      class="w-full login-button"
                    >
                      {{ loggingIn ? '验证中...' : '确认邮箱并完成登录' }}
                    </Button>
                    <Button @click="backToLoginStep" variant="outline" size="sm" class="w-full">
                      返回上一步
                    </Button>
                  </template>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div class="space-y-6 lg:col-span-2">
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

                <div class="space-y-3">
                  <div class="text-sm font-medium text-muted-foreground">API调用示例</div>

                  <details class="api-detail">
                    <summary class="cursor-pointer text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                      获取状态
                    </summary>
                    <div class="mt-2 p-3 bg-muted/50 rounded-lg">
                      <pre class="text-xs overflow-x-auto"><code>curl -X POST http://localhost:8888/panlian/{{ currentHash.slice(0, 16) }}... \
  -H "Content-Type: application/json" \
  -d '{"action": "get_status"}'</code></pre>
                    </div>
                  </details>

                  <details class="api-detail">
                    <summary class="cursor-pointer text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                      登录
                    </summary>
                    <div class="mt-2 p-3 bg-muted/50 rounded-lg">
                      <pre class="text-xs overflow-x-auto"><code>curl -X POST http://localhost:8888/panlian/{{ currentHash.slice(0, 16) }}... \
  -H "Content-Type: application/json" \
  -d '{"action": "login", "username": "xxx", "password": "xxx"}'</code></pre>
                    </div>
                  </details>

                  <details class="api-detail">
                    <summary class="cursor-pointer text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                      测试搜索
                    </summary>
                    <div class="mt-2 p-3 bg-muted/50 rounded-lg">
                      <pre class="text-xs overflow-x-auto"><code>curl -X POST http://localhost:8888/panlian/{{ currentHash.slice(0, 16) }}... \
  -H "Content-Type: application/json" \
  -d '{"action": "test_search", "keyword": "遮天"}'</code></pre>
                    </div>
                  </details>
                </div>
              </div>
            </details>
          </Card>

          <Card>
            <div class="p-6 flex flex-col h-full">
              <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>🔎</span>
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
                    :loading="searching"
                    class="search-button"
                  >
                    <span v-if="searching">搜索中...</span>
                    <span v-else>搜索</span>
                  </Button>
                </div>

                <div v-if="searchResults.length > 0" class="search-results-container flex-1">
                  <div class="text-sm text-muted-foreground mb-3">
                    找到 <strong class="text-foreground">{{ searchResults.length }}</strong> 个影视条目，
                    共 <strong class="text-foreground">{{ totalSearchLinks }}</strong> 个链接
                  </div>

                  <div class="search-results-list">
                    <div 
                      v-for="(result, index) in searchResults" 
                      :key="result.unique_id"
                      class="result-item"
                    >
                      <div class="result-head">
                        <div class="result-title">
                          <span class="result-index">{{ index + 1 }}</span>
                          <span>{{ result.title }}</span>
                        </div>
                        <span v-if="result.datetime" class="result-time">
                          {{ formatDateTime(result.datetime) }}
                        </span>
                      </div>

                      <div class="result-meta">
                        <span class="meta-chip meta-chip-primary">
                          {{ result.link_count }} 个链接
                        </span>
                        <span
                          v-for="tag in result.tags || []"
                          :key="`${result.unique_id}-${tag}`"
                          class="meta-chip"
                        >
                          {{ tag }}
                        </span>
                      </div>

                      <div class="link-list">
                        <div 
                          v-for="(link, linkIndex) in result.links" 
                          :key="`${result.unique_id}-${link.url}-${linkIndex}`"
                          class="link-item"
                        >
                          <div class="link-main">
                            <span class="link-type">{{ link.type }}</span>
                            <a
                              :href="link.url"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="link-url"
                            >
                              {{ link.url }}
                            </a>
                          </div>

                          <div
                            v-if="link.password || link.work_title || link.datetime"
                            class="link-extra"
                          >
                            <span
                              v-if="link.work_title && link.work_title !== result.title"
                              class="link-work-title"
                            >
                              {{ link.work_title }}
                            </span>
                            <span v-if="link.password" class="link-password">
                              提取码 {{ link.password }}
                            </span>
                            <span v-if="link.datetime" class="link-datetime">
                              {{ formatDateTime(link.datetime) }}
                            </span>
                          </div>
                        </div>
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
.panlian-manager {
  max-width: 1200px;
  margin: 0 auto;
}

.alert {
  position: fixed;
  top: 5rem;
  right: 1.5rem;
  z-index: 100;
  padding: 1rem 1.5rem;
  border-radius: 0.75rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.alert-success {
  background: #ecfdf5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}

.alert-error {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.back-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: hsl(var(--muted-foreground));
  transition: color 0.2s ease;
}

.back-button:hover {
  color: hsl(var(--foreground));
}

.header-section {
  text-align: center;
}

.user-card,
.add-card {
  border: 1px solid hsl(var(--border));
}

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

.search-results-container {
  display: flex;
  flex-direction: column;
  min-height: 0;

  min-width: 0;}

.search-results-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 520px;
  overflow-y: auto;
  padding-right: 4px;

  min-width: 0;}

.search-results-list::-webkit-scrollbar {
  width: 8px;
}

.search-results-list::-webkit-scrollbar-track {
  background: hsl(var(--muted) / 0.35);
  border-radius: 999px;
}

.search-results-list::-webkit-scrollbar-thumb {
  background: hsl(var(--muted-foreground) / 0.3);
  border-radius: 999px;
}

.search-results-list::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 0.5);
}

.result-item {
  padding: 16px;
  border-radius: 14px;
  border: 1px solid hsl(var(--border));
  background: linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--muted) / 0.28) 100%);
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;

  min-width: 0;
  overflow-wrap: anywhere;}

.result-item:hover {
  border-color: hsl(var(--primary) / 0.25);
  transform: translateY(-1px);
  box-shadow: 0 10px 24px hsl(var(--foreground) / 0.06);
}

.result-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.result-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;

  overflow-wrap: anywhere;}

.result-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.result-time {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}

.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  line-height: 1;
}

.meta-chip-primary {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-weight: 600;
}

.link-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.link-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border) / 0.8);
  border-radius: 10px;

  min-width: 0;}

.link-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.link-url {
  flex: 1;
  color: hsl(var(--primary));
  word-break: break-all;
  text-decoration: none;
  line-height: 1.5;

  min-width: 0;
  overflow-wrap: anywhere;}

.link-url:hover {
  text-decoration: underline;
}

.link-type {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  padding: 4px 8px;
  border-radius: 999px;
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  flex-shrink: 0;
}

.link-extra {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-left: 68px;
}

.link-password,
.link-work-title,
.link-datetime {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
}

.link-password {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
  font-weight: 600;
}

.link-work-title {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.link-datetime {
  background: hsl(var(--muted) / 0.65);
  color: hsl(var(--muted-foreground));
}

.api-docs-section[open] .details-icon {
  transform: rotate(180deg);
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

@media (max-width: 768px) {
  .result-head {
    flex-direction: column;
    gap: 8px;
  }

  .link-main {
    flex-direction: column;
  }

  .link-extra {
    padding-left: 0;
  }
}
.captcha-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.captcha-image {
  height: 2.5rem;
  border-radius: 0.375rem;
  border: 1px solid hsl(var(--border));
  cursor: pointer;
  background: #fff;
  flex-shrink: 0;
}

.captcha-tip {
  margin-top: 0.375rem;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}
</style>
