import axios from 'axios'
import type {
  WoniuStatusResponse,
  WoniuConfigResponse,
  WoniuLoginResponse,
  WoniuLogoutResponse,
  WoniuSearchResponse
} from '@/types/woniu'

const woniuApi = axios.create({
  baseURL: '/woniu',
  timeout: 15000
})

woniuApi.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

woniuApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_username')
      window.dispatchEvent(new CustomEvent('auth:required'))
    }
    return Promise.reject(error)
  }
)

// 登录要等站点在 Cloudflare 后面握手，测试搜索还要抓一批详情页，都比普通请求慢。
const WONIU_LONG_TIMEOUT = 120000

export const getStatus = async (hash: string): Promise<WoniuStatusResponse> => {
  const response = await woniuApi.post<WoniuStatusResponse>(`/${hash}`, {
    action: 'get_status'
  })
  return response.data
}

export const getConfig = async (hash: string): Promise<WoniuConfigResponse> => {
  const response = await woniuApi.post<WoniuConfigResponse>(`/${hash}`, {
    action: 'get_config'
  })
  return response.data
}

export const updateConfig = async (hash: string, baseURL: string): Promise<WoniuConfigResponse> => {
  const response = await woniuApi.post<WoniuConfigResponse>(`/${hash}`, {
    action: 'update_config',
    base_url: baseURL
  })
  return response.data
}

export const login = async (
  hash: string,
  username: string,
  password: string
): Promise<WoniuLoginResponse> => {
  const response = await woniuApi.post<WoniuLoginResponse>(
    `/${hash}`,
    { action: 'login', username, password },
    { timeout: WONIU_LONG_TIMEOUT }
  )
  return response.data
}

export const logout = async (hash: string): Promise<WoniuLogoutResponse> => {
  const response = await woniuApi.post<WoniuLogoutResponse>(`/${hash}`, {
    action: 'logout'
  })
  return response.data
}

export const testSearch = async (hash: string, keyword: string): Promise<WoniuSearchResponse> => {
  const response = await woniuApi.post<WoniuSearchResponse>(
    `/${hash}`,
    { action: 'test_search', keyword },
    { timeout: WONIU_LONG_TIMEOUT }
  )
  return response.data
}

export const getHashByIdentifier = async (identifier: string): Promise<string> => {
  const response = await woniuApi.get(`/${identifier}`)
  const responseUrl = response.request?.responseURL || response.config?.url || ''
  const hashMatch = responseUrl.match(/\/woniu\/([a-f0-9]{64})/)
  if (hashMatch && hashMatch[1]) {
    return hashMatch[1]
  }

  // 走到这里说明 /woniu/ 没有转发到后端。最常见的原因是部署时 nginx 少了
  // location /woniu/ 块：请求落进 SPA 的 try_files 回退，返回 200 的 index.html，
  // 后端根本没收到请求，responseURL 自然没有 hash。本地开发走 vite 代理不会复现，
  // 所以直接把判别方法写进错误里，省得只看到"获取hash失败"无从下手。
  if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
    throw new Error('服务端未转发 /woniu/ 请求：返回的是前端页面而非后端跳转，请在 nginx 增加 location /woniu/ 代理块')
  }
  throw new Error('无法从重定向URL中提取hash')
}

export default {
  getStatus,
  getConfig,
  updateConfig,
  login,
  logout,
  testSearch,
  getHashByIdentifier
}
