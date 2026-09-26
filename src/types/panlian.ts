// ============================================================
// 盘链插件类型定义
// ============================================================

export interface PanlianBaseResponse {
  success: boolean
  message: string
  data?: any
}

export interface PanlianStatus {
  hash: string
  logged_in: boolean
  status: 'pending' | 'active' | 'expired'
  username: string
  login_time: string
  expire_time: string
  expires_in_days: number
}

export interface PanlianStatusResponse extends PanlianBaseResponse {
  data: PanlianStatus
}

// 登录响应复用同一个信封：可能直接成功，也可能停在"需要邮箱确认"这一步。
// 失败时 data 里会带 captcha_required / captcha_invalid，前端据此自动换一张验证码。
export interface PanlianLoginData {
  username?: string
  status?: string
  need_email?: boolean
  confirm_id?: string
  email_hint?: string
  captcha_required?: boolean
  captcha_invalid?: boolean
}

export interface PanlianLoginResponse extends PanlianBaseResponse {
  data: PanlianLoginData
}

// 站点自 2026 年起登录必须先过图形验证码：image 是 base64 data URL，captcha_id 回填登录请求。
export interface PanlianCaptchaResponse extends PanlianBaseResponse {
  data: {
    captcha_id: string
    image: string
  }
}

export interface PanlianLogoutResponse extends PanlianBaseResponse {
  data: {
    status: string
  }
}

export interface PanlianSearchLink {
  type: string
  url: string
  password: string
  datetime?: string
  work_title?: string
}

export interface PanlianSearchResult {
  message_id: string
  unique_id: string
  channel: string
  title: string
  content: string
  datetime: string
  link_count: number
  links: PanlianSearchLink[]
  tags?: string[]
  images?: string[]
}

export interface PanlianSearchResponse extends PanlianBaseResponse {
  data: {
    keyword: string
    total_results: number
    total_links: number
    results: PanlianSearchResult[]
  }
}
