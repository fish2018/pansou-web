import axios from 'axios'
import type {
  PanlianStatusResponse,
  PanlianLoginResponse,
  PanlianLogoutResponse,
  PanlianCaptchaResponse,
  PanlianSearchResponse
} from '@/types/panlian'

const panlianApi = axios.create({
  baseURL: '/panlian',
  timeout: 15000
})

panlianApi.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

panlianApi.interceptors.response.use(
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

export const getStatus = async (hash: string): Promise<PanlianStatusResponse> => {
  const response = await panlianApi.post<PanlianStatusResponse>(`/${hash}`, {
    action: 'get_status'
  })
  return response.data
}

// 图形验证码：站点每次登录都要，由用户肉眼识别后回填，插件不做识别。
export const getCaptcha = async (hash: string): Promise<PanlianCaptchaResponse> => {
  const response = await panlianApi.post<PanlianCaptchaResponse>(`/${hash}`, {
    action: 'captcha'
  })
  return response.data
}

export const login = async (
  hash: string,
  username: string,
  password: string,
  captchaId: string,
  captchaCode: string
): Promise<PanlianLoginResponse> => {
  const response = await panlianApi.post<PanlianLoginResponse>(`/${hash}`, {
    action: 'login',
    username,
    password,
    captcha_id: captchaId,
    captcha_code: captchaCode
  })
  return response.data
}

// 登录第二步：提交站点下发的 confirm_id 与账号绑定的邮箱，通过后即拿到会话。
export const confirmEmail = async (
  hash: string,
  username: string,
  password: string,
  confirmId: string,
  email: string
): Promise<PanlianLoginResponse> => {
  const response = await panlianApi.post<PanlianLoginResponse>(`/${hash}`, {
    action: 'confirm_email',
    username,
    password,
    confirm_id: confirmId,
    email
  })
  return response.data
}

export const logout = async (hash: string): Promise<PanlianLogoutResponse> => {
  const response = await panlianApi.post<PanlianLogoutResponse>(`/${hash}`, {
    action: 'logout'
  })
  return response.data
}

export const testSearch = async (
  hash: string,
  keyword: string
): Promise<PanlianSearchResponse> => {
  const response = await panlianApi.post<PanlianSearchResponse>(`/${hash}`, {
    action: 'test_search',
    keyword
  })
  return response.data
}

export const getHashByIdentifier = async (identifier: string): Promise<string> => {
  const response = await panlianApi.get(`/${identifier}`)
  const responseUrl = response.request?.responseURL || response.config?.url || ''
  const hashMatch = responseUrl.match(/\/panlian\/([a-f0-9]{64})/)
  if (hashMatch && hashMatch[1]) {
    return hashMatch[1]
  }
  throw new Error('无法从重定向URL中提取hash')
}

export default {
  getStatus,
  getCaptcha,
  login,
  confirmEmail,
  logout,
  testSearch,
  getHashByIdentifier
}
