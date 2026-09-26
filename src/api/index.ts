import axios from 'axios';
import type { SearchResponse, LinkCheckItem, LinkCheckResponse } from '@/types';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000
});

// 请求拦截器 - 自动添加token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 处理401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 清除token
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_username');
      
      // 触发显示登录窗口的事件
      window.dispatchEvent(new CustomEvent('auth:required'));
    }
    return Promise.reject(error);
  }
);

// 搜索参数接口
export interface SearchParams {
  kw: string;
  refresh?: boolean;
  res?: 'all' | 'results' | 'merge';
  src?: 'all' | 'tg' | 'plugin';
  plugins?: string;
  channels?: string;
  cloud_types?: string;
  ext?: string;
}

// API响应包装类型
interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// 健康状态接口（基于实际API返回）
export interface HealthStatus {
  status: string;
  plugins_enabled: boolean;
  plugin_count: number;
  plugins: string[];
  channels: string[];
  auth_enabled?: boolean;
}

// 登录请求参数
export interface LoginParams {
  username: string;
  password: string;
}

// 登录响应
export interface LoginResponse {
  token: string;
  expires_at: number;
  username: string;
}

// 认证状态
export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
}

// 获取API健康状态
export const getHealth = async (): Promise<HealthStatus> => {
  const response = await api.get<HealthStatus>('/health');
  return response.data;
};

// SEARCH_TIMEOUT_MS 搜索请求的超时。
//
// 不能沿用 api 实例的 10 秒：服务端单个插件批次就允许到 PLUGIN_TIMEOUT（默认 10 秒），
// 等于客户端和服务端同时到点，前端必然先报 ECONNABORTED。
const SEARCH_TIMEOUT_MS = 45000;

// 搜索API
export const search = async (params: SearchParams): Promise<SearchResponse> => {
  // 添加ext参数，包含referer信息
  const searchParams = {
    ...params,
    ext: JSON.stringify({ referer: "https://dm.xueximeng.com" })
  };
  
  const response = await api.get<ApiResponse<SearchResponse>>('/search', {
    params: searchParams,
    // 搜索是慢请求：服务端允许插件批次用到 PLUGIN_TIMEOUT（默认 10 秒），
    // 频道阶段还有各自的收集窗口。用 api 实例默认的 10 秒会在服务端还没返回时
    // 就把请求掐掉——前端只看到 AxiosError: timeout of 10000ms exceeded，
    // 而服务端其实还在后台跑（它用的是脱离请求的 context），结果白丢一次。
    // 超时值必须大于服务端最坏情况，这里跟 gying 接口的 30 秒档保持一致偏保守。
    timeout: SEARCH_TIMEOUT_MS,
  });
  
  // 如果响应中包含data字段，则返回data
  if (response.data && response.data.data) {
    return response.data.data;
  }
  
  // 如果响应本身就是SearchResponse格式（未经 ApiResponse 包裹）
  // 注意：response.data 的声明类型是 ApiResponse<SearchResponse>，它没有 total/merged_by_type，
  // 直接读会被类型系统挡下——也正说明原写法这个兜底分支永远不会命中。这里按"未包裹"的形状检查。
  const raw = response.data as unknown as SearchResponse;
  if (raw && raw.total !== undefined && raw.merged_by_type) {
    return raw;
  }
  
  // 返回空结果
  return {
    total: 0,
    results: [],
    merged_by_type: {}
  };
};

// 登录
export const login = async (params: LoginParams): Promise<LoginResponse> => {
  const response = await api.post<LoginResponse>('/auth/login', params);
  return response.data;
};

// 验证token
export const verifyToken = async (): Promise<boolean> => {
  try {
    await api.post('/auth/verify');
    return true;
  } catch {
    return false;
  }
};

// 退出登录
export const logout = async (): Promise<void> => {
  try {
    await api.post('/auth/logout');
  } finally {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');
  }
};

export const inspectVisibleLinks = async (
  items: LinkCheckItem[],
  view_token?: string
): Promise<LinkCheckResponse> => {
  const response = await api.post<LinkCheckResponse>('/check/links', {
    items,
    view_token
  });
  return response.data;
};

// 检查认证状态
export const checkAuthStatus = async (): Promise<AuthStatus> => {
  try {
    const health = await getHealth();
    const authEnabled = health.auth_enabled || false;
    const token = localStorage.getItem('auth_token');
    
    if (!authEnabled) {
      return { enabled: false, authenticated: true };
    }
    
    if (!token) {
      return { enabled: true, authenticated: false };
    }
    
    const valid = await verifyToken();
    return { enabled: true, authenticated: valid };
  } catch {
    return { enabled: false, authenticated: true };
  }
};

export default api; 
