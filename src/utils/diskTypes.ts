// 网盘类型映射
export const diskTypeMap: Record<string, string> = {
  'baidu': '百度',
  'aliyun': '阿里',
  '115': '115',
  '123': '123',
  'xunlei': '迅雷',
  'quark': '夸克',
  'guangya': '光鸭',
  'mobile': '移动',
  'tianyi': '天翼',
  'uc': 'UC',
  'pikpak': 'PikPak',
  'ed2k': '电驴',
  'magnet': '磁力',
  'other': '其他'
};

// 获取网盘类型的中文名称
export const getDiskTypeName = (type: string): string => {
  return diskTypeMap[type] || type;
};

// 网盘类型默认排序
export const DEFAULT_DISK_TYPE_ORDER = [
  'baidu', 'aliyun', 'quark', 'guangya', 'tianyi', '115',
  'xunlei', 'uc', 'mobile', 'pikpak', '123', 'magnet', 'ed2k'
];

const DISK_TYPE_ORDER_STORAGE_KEY = 'pansou_disk_type_order';

// 将已保存的排序与参考顺序对齐，过滤失效项并补全缺失项
export const normalizeDiskTypeOrder = (order: string[], reference: string[] = DEFAULT_DISK_TYPE_ORDER): string[] => {
  const referenceSet = new Set(reference);
  const seen = new Set<string>();
  const normalized: string[] = [];

  order.forEach((id) => {
    if (referenceSet.has(id) && !seen.has(id)) {
      normalized.push(id);
      seen.add(id);
    }
  });

  reference.forEach((id) => {
    if (!seen.has(id)) {
      normalized.push(id);
      seen.add(id);
    }
  });

  return normalized;
};

// 加载用户自定义的网盘类型排序
export const loadDiskTypeOrder = (reference: string[] = DEFAULT_DISK_TYPE_ORDER): string[] => {
  try {
    const saved = localStorage.getItem(DISK_TYPE_ORDER_STORAGE_KEY);
    if (saved) {
      return normalizeDiskTypeOrder(JSON.parse(saved), reference);
    }
  } catch (err) {
    console.error('加载网盘类型排序失败:', err);
  }
  return normalizeDiskTypeOrder(reference, reference);
};

// 保存网盘类型排序
export const saveDiskTypeOrder = (order: string[]): void => {
  try {
    localStorage.setItem(DISK_TYPE_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch (err) {
    console.error('保存网盘类型排序失败:', err);
  }
};

// 按照给定顺序对网盘类型键进行排序，未在顺序中的类型排在末尾并按字母排序
export const sortDiskTypesByOrder = (keys: string[], order: string[]): string[] => {
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  return [...keys].sort((a, b) => {
    const indexA = orderIndex.has(a) ? orderIndex.get(a)! : order.length;
    const indexB = orderIndex.has(b) ? orderIndex.get(b)! : order.length;
    if (indexA !== indexB) return indexA - indexB;
    return a.localeCompare(b);
  });
};
