import api from '@/api';

export type DiscoverCategory = 'movie' | 'tv' | 'animation' | 'variety' | 'documentary';
export type DiscoverCollection = 'hot' | 'top' | 'new' | 'random' | 'library';

export interface DiscoverQuery {
  page?: number;
  page_size?: number;
  genre?: string;
  year?: string;
  year_from?: string;
  year_to?: string;
  q?: string;
  tag?: string;
}

export interface DiscoverItem {
  id: string;
  title: string;
  original_title?: string;
  year?: string | number;
  release_date?: string;
  poster_url?: string;
  overview?: string;
  genres?: string[];
  douban_rating: number | null;
  douban_votes?: number | null;
  douban_url?: string;
  tmdb_id?: number | string;
  metadata_source?: 'tmdb' | 'douban';
  details_cached?: boolean;
  media_type?: 'movie' | 'tv';
  reason?: string;
}

export interface DiscoverResponse {
  items: DiscoverItem[];
  updated_at?: string | number;
  stale?: boolean;
  tmdb_configured?: boolean;
  warning?: string;
  total?: number;
  catalog_total?: number;
  page?: number;
  page_size?: number;
  has_more?: boolean;
  genres?: string[];
  years?: string[];
  indexing?: boolean;
  catalog_sync?: {
    enabled: boolean;
    stage: string;
    indexed: number;
    hydrated: number;
    total?: number;
    updated_at?: string;
    error?: string;
  };
}

export const getDiscover = async (
  category: DiscoverCategory,
  collection: DiscoverCollection,
  signal?: AbortSignal,
  query: DiscoverQuery = {}
): Promise<DiscoverResponse> => {
  const response = await api.get<DiscoverResponse>('/discover', {
    params: { category, collection, ...query }, signal, timeout: 30000
  });
  const data = response.data;
  if (!data || !Array.isArray(data.items)
    || data.items.some(item => !item || typeof item.title !== 'string' || !item.title.trim())) {
    throw new Error('推荐数据暂不可用');
  }
  return data;
};

export const getDiscoverSubject = async (id: string, mediaType: 'movie' | 'tv', signal?: AbortSignal): Promise<DiscoverItem> => {
  const response = await api.get<DiscoverItem>('/discover/subject', {
    params: { id, media_type: mediaType }, signal, timeout: 30000
  });
  const item = response.data;
  if (!item || typeof item.title !== 'string' || !item.title.trim()) throw new Error('作品详情暂不可用');
  return item;
};
