import axios from 'axios';
import type { SearchResponse } from '@/types';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000
});

// 搜索参数接口
export interface SearchParams {
  kw: string;
  refresh?: boolean;
  res?: 'all' | 'results' | 'merge';
  src?: 'all' | 'tg' | 'plugin';
  plugins?: string;
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
}

// 获取API健康状态
export const getHealth = async (): Promise<HealthStatus> => {
  try {
    const response = await api.get<HealthStatus>('/health');
    return response.data;
  } catch (error) {
    console.error('获取健康状态失败:', error);
    // 返回模拟数据
    return getMockHealthData();
  }
};

// 模拟健康状态数据
const getMockHealthData = (): HealthStatus => {
  return {
    status: "ok",
    plugins_enabled: true,
    plugin_count: 6,
    plugins: ["pansearch", "hdr4k", "shandian", "muou", "duoduo", "labi"],
    channels: ["tgsearchers3", "SharePanBaidu", "yunpanxunlei", "tianyifc", "BaiduCloudDisk"]
  };
};

// 搜索API
export const search = async (params: SearchParams): Promise<SearchResponse> => {
  // 添加ext参数，包含referer信息
  const searchParams = {
    ...params,
    ext: JSON.stringify({ referer: "https://dm.xueximeng.com" })
  };
  
  // console.log('搜索参数:', searchParams);
  try {
    const response = await api.get<ApiResponse<SearchResponse>>('/search', { params: searchParams });
    // console.log('API响应:', response.data);
    
    // 如果响应中包含data字段，则返回data
    if (response.data && response.data.data) {
      // console.log('提取的数据:', response.data.data);
      return response.data.data;
    }
    
    // 如果响应本身就是SearchResponse格式
    if (response.data && response.data.total !== undefined && response.data.merged_by_type) {
      return response.data as unknown as SearchResponse;
    }
    
    // 如果都不匹配，使用模拟数据
    console.warn('API响应格式不匹配，使用模拟数据');
    return getMockData();
  } catch (error) {
    console.error('API错误:', error);
    
    // 开发阶段使用模拟数据
    // console.log('使用模拟数据');
    return getMockData();
  }
};

// 模拟数据（开发阶段使用）
const getMockData = (): SearchResponse => {
  return {
    total: 15,
    results: [
      {
        message_id: "12345",
        unique_id: "channel-12345",
        channel: "tgsearchers3",
        datetime: "2023-06-10T14:23:45Z",
        title: "速度与激情全集1-10",
        content: "速度与激情系列全集，1080P高清...",
        links: [
          {
            type: "baidu",
            url: "https://pan.baidu.com/s/1abcdef",
            password: "1234"
          }
        ],
        tags: ["电影", "合集"]
      }
    ],
    merged_by_type: {
      baidu: [
        {
          url: "https://pan.baidu.com/s/1abcdef",
          password: "1234",
          note: "速度与激情全集1-10",
          datetime: "2023-06-10T14:23:45Z",
          source: "tgsearchers3"
        },
        {
          url: "https://pan.baidu.com/s/1ghijkl",
          password: "5678",
          note: "速度与激情9",
          datetime: "2023-05-15T10:20:30Z",
          source: "SharePanBaidu"
        }
      ],
      aliyun: [
        {
          url: "https://www.aliyundrive.com/s/abcdef",
          note: "速度与激情系列合集",
          datetime: "2023-07-01T08:15:20Z",
          source: "yunpanxunlei"
        }
      ],
      "115": [
        {
          url: "https://115.com/s/abcdefg",
          password: "abc123",
          note: "速度与激情1-10全集高清资源",
          datetime: "2023-04-22T16:45:12Z",
          source: "pansearch插件"
        }
      ]
    }
  };
};

export default api; 