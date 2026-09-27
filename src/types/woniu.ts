// ============================================================
// 蜗牛插件类型定义
// ============================================================

export interface WoniuBaseResponse {
  success: boolean
  message: string
  data?: any
}

export interface WoniuStatus {
  hash: string
  logged_in: boolean
  status: 'pending' | 'active' | 'expired'
  username: string
  login_time: string
  expire_time: string
  expires_in_days: number
  /** 后台保活校验发现的问题，例如"登录态已失效，请重新登录" */
  last_error?: string
  /** 当前插件里可用的账号总数，多账号时便于确认是否都在线 */
  account_count?: number
}

export interface WoniuStatusResponse extends WoniuBaseResponse {
  data: WoniuStatus
}

export interface WoniuConfigResponse extends WoniuBaseResponse {
  data: {
    base_url: string
    default_url: string
  }
}

export interface WoniuLoginResponse extends WoniuBaseResponse {
  data: {
    hash: string
    username: string
    status: string
    login_time: string
  }
}

export interface WoniuLogoutResponse extends WoniuBaseResponse {
  data: {
    status: string
  }
}

export interface WoniuSearchLink {
  type: string
  url: string
  password: string
  work_title?: string
}

export interface WoniuSearchResult {
  unique_id: string
  title: string
  content: string
  datetime: string
  links: WoniuSearchLink[]
  tags?: string[]
  images?: string[]
}

export interface WoniuSearchResponse extends WoniuBaseResponse {
  data: {
    keyword: string
    total_results: number
    total_links: number
    results: WoniuSearchResult[]
  }
}
