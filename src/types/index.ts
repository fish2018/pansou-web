// 搜索结果链接类型
export interface ResultLink {
  type: string;
  url: string;
  password?: string;
}

// 搜索结果项类型
export interface ResultItem {
  message_id?: string;
  unique_id?: string;
  channel?: string;
  datetime?: string;
  title: string;
  content?: string;
  links: ResultLink[];
  tags?: string[];
}

// 按网盘类型合并的结果项
export interface MergedResultItem {
  url: string;
  password?: string;
  note: string;
  datetime?: string;
  source?: string;  // 数据来源（频道或插件名称）
}

// 按网盘类型合并的结果
export interface MergedResults {
  [key: string]: MergedResultItem[];
}

// API响应类型
export interface SearchResponse {
  total: number;
  results: ResultItem[];
  merged_by_type: MergedResults;
}

// 健康状态类型
// 存活观测：后端按每轮搜索累积、滑动窗口 20 轮统计的插件/频道健康度
export type LivenessStatus = 'failing' | 'zero_yield' | 'degraded' | 'ok' | 'insufficient_data';

export interface LivenessItem {
  name: string;
  status: LivenessStatus;
  rounds: number;
  yielded: number;
  failed: number;
  zero_yield: number;
  last_yield?: string;
  last_error?: string;
}

export interface LivenessReport {
  note: string;
  plugin_total: number;
  channel_total: number;
  plugin_status: Record<string, number>;
  channel_status: Record<string, number>;
  failing_plugins?: LivenessItem[];
  zero_yield_plugins?: LivenessItem[];
  degraded_plugins?: LivenessItem[];
  failing_channels?: LivenessItem[];
  zero_yield_channels?: LivenessItem[];
  // 各分类截断前的完整数量：列表每类最多 40 条，用 count > items.length 判断是否被截断
  failing_plugin_count?: number;
  zero_yield_plugin_count?: number;
  degraded_plugin_count?: number;
  failing_channel_count?: number;
  zero_yield_channel_count?: number;
  truncated?: string[];
}

export interface HealthStatus {
  status: string;
  plugins_enabled: boolean;
  plugin_count: number;
  plugins: string[];
  channels: string[];
  auth_enabled?: boolean;
  // 旧版本后端不返回该字段，界面需按缺失处理
  liveness?: LivenessReport;
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

// 过滤配置类型
export interface FilterConfig {
  include?: string[];
  exclude?: string[];
}

// 搜索结果导出格式
export type ExportFormat = 'json' | 'txt';

// 搜索结果导出字段
export type ExportField = 'sequence' | 'title' | 'source' | 'datetime';

// 搜索结果导出设置
export interface ExportSettings {
  format: ExportFormat;
  fields: ExportField[];
  prettyJson: boolean;
  includeFieldLabels: boolean;
  selectedDiskTypes: string[];
  allDiskTypesSelected: boolean;
}

export interface DetectionSettings {
  enabled: boolean;
}

export type LinkHealthState =
  | 'idle'
  | 'pending'
  | 'ok'
  | 'bad'
  | 'locked'
  | 'unsupported'
  | 'uncertain';

export interface LinkHealthRecord {
  state: LinkHealthState;
  summary?: string;
  checked_at: number;
  expires_at: number;
  normalized_url?: string;
}

export interface LinkCheckItem {
  disk_type: string;
  url: string;
  password?: string;
}

export interface LinkCheckResult {
  disk_type: string;
  url: string;
  normalized_url?: string;
  state: LinkHealthState;
  summary?: string;
  cache_hit: boolean;
  checked_at: number;
  expires_at: number;
}

export interface LinkCheckResponse {
  results: LinkCheckResult[];
}

// 导出QQPD相关类型
export * from './qqpd' 
export * from './gying'
export * from './weibo'
export * from './panlian'
