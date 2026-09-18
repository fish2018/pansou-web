// URL query 参数与搜索条件的互相转换
// q   -> 搜索关键词
// inc -> 包含关键词（OR关系）
// exc -> 排除关键词（OR关系）
// 示例: ?q=流浪地球&inc=4k,hdr&exc=预告

const KEYWORD_PARAM = 'q';
const INCLUDE_PARAM = 'inc';
const EXCLUDE_PARAM = 'exc';

// 与 SearchForm 中的过滤逻辑保持一致：空格或英文逗号分隔
const KEYWORD_SEPARATOR = /[,\s]+/;

export interface SearchQueryState {
  keyword: string;
  include: string;
  exclude: string;
}

// 归一化为逗号分隔，避免回写后地址栏出现 + 或 %20
const normalizeKeywords = (value: string) => {
  return value.split(KEYWORD_SEPARATOR).filter(k => k.trim()).join(',');
};

// 从 URL 读取搜索条件。原始字符串直接返回，不做拆分，
// 这样手写的 inc=4k%20hdr（空格分隔）也能被输入框正常识别
export const parseSearchQuery = (search: string = window.location.search): SearchQueryState => {
  const params = new URLSearchParams(search);

  return {
    keyword: (params.get(KEYWORD_PARAM) || '').trim(),
    include: (params.get(INCLUDE_PARAM) || '').trim(),
    exclude: (params.get(EXCLUDE_PARAM) || '').trim()
  };
};

// 把当前搜索条件写回地址栏（不产生历史记录）
export const writeSearchQuery = (state: SearchQueryState) => {
  const params = new URLSearchParams();

  const keyword = state.keyword.trim();
  const include = normalizeKeywords(state.include);
  const exclude = normalizeKeywords(state.exclude);

  if (keyword) {
    params.set(KEYWORD_PARAM, keyword);
  }
  if (include) {
    params.set(INCLUDE_PARAM, include);
  }
  if (exclude) {
    params.set(EXCLUDE_PARAM, exclude);
  }

  // 逗号是合法的 query 字符，还原回来让链接更易读
  const query = params.toString().replace(/%2C/g, ',');
  const url = query
    ? `${window.location.pathname}?${query}${window.location.hash}`
    : `${window.location.pathname}${window.location.hash}`;

  try {
    window.history.replaceState(window.history.state, '', url);
  } catch (err) {
    console.error('更新地址栏失败:', err);
  }
};
