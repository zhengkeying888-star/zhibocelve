import type { LineType } from '@/types'

// Standard category → line mapping (provided by user)
export const CATEGORY_TO_LINE: Record<string, LineType> = {
  '编织工艺美学': 'interest',
  '茶道': 'interest',
  '唱歌': 'interest',
  '穿搭': 'beauty',
  '电子琴': 'interest',
  '东方食养': 'health',
  '东方养正瑜伽': 'beauty',
  '短视频': 'interest',
  '儿童健康': 'health',
  '风光摄影': 'interest',
  '钩针编织美学': 'interest',
  '古法居家养生': 'health',
  '固气活血': 'health',
  '国画1': 'interest',
  '国际声乐': 'interest',
  '国学朗诵': 'interest',
  '华佗肩颈舒活功': 'health',
  '健康家厨': 'health',
  '健康食养': 'health',
  '健康营养': 'health',
  '键盘乐': 'interest',
  '君合太极': 'health',
  '开心太极': 'health',
  '懒人吃瘦': 'beauty',
  '美学收纳': 'interest',
  '面部瑜伽驻颜': 'beauty',
  '内养太极': 'health',
  '逆龄女神瑜伽': 'beauty',
  '逆龄普拉提': 'beauty',
  '女性保养瑜伽': 'beauty',
  '普拉提': 'beauty',
  '气血调理': 'health',
  '轻训营': 'health',
  '摄影美学': 'interest',
  '声乐': 'interest',
  '食养助长': 'health',
  '手机摄影': 'interest',
  '睡眠调理': 'health',
  '私域': 'health',
  '塑形流瑜伽': 'beauty',
  '太极': 'health',
  '体态': 'beauty',
  '体态塑形瑜伽': 'beauty',
  '体质食养': 'health',
  '五禽戏': 'health',
  '舞蹈': 'interest',
  '戏曲': 'interest',
  '相机摄影': 'interest',
  '形体芭蕾': 'beauty',
  '亚健康管理': 'health',
  '养正变美': 'beauty',
  '一杰瑜伽': 'beauty',
  '易筋经': 'health',
  '营养调理': 'health',
  '优雅舞蹈': 'interest',
  '油画': 'interest',
  '瑜伽': 'beauty',
  '瑜伽会员': 'beauty',
  '云帆太极': 'health',
  '真书法': 'interest',
  '正位塑形瑜伽': 'beauty',
  '中式美食制作': 'health',
  '中医变美': 'beauty',
}

// Common aliases → canonical name
const CATEGORY_ALIASES: Record<string, string> = {
  '睡眠': '睡眠调理',
  '五禽戏': '五禽戏',
  '瑜伽SA': '瑜伽',
  '普拉提SA': '普拉提',
  '太极SA': '太极',
  '手机摄影SA': '手机摄影',
  '摄影美学': '摄影美学',
  '君合太极': '君合太极',
  '开心太极': '开心太极',
  '内养太极': '内养太极',
  '云帆太极': '云帆太极',
  '气血': '气血调理',
  '固气': '固气活血',
  '中医': '中医变美',
  '健康': '健康营养',
  '食养': '健康食养',
  '养生': '古法居家养生',
  '变美': '中医变美',
  '国画': '国画1',
  '声乐': '声乐',
  '电子琴': '电子琴',
  '键盘乐': '键盘乐',
  '真书法': '真书法',
  '油画': '油画',
  '国学朗诵': '国学朗诵',
  '戏曲': '戏曲',
  '舞蹈': '舞蹈',
  '优雅舞蹈': '优雅舞蹈',
  '短视频': '短视频',
  '茶道': '茶道',
  '编织工艺美学': '编织工艺美学',
  '钩针编织美学': '钩针编织美学',
  '美学收纳': '美学收纳',
  '穿搭': '穿搭',
  '面部瑜伽驻颜': '面部瑜伽驻颜',
  '体态': '体态',
  '形体芭蕾': '形体芭蕾',
  '逆龄女神瑜伽': '逆龄女神瑜伽',
  '逆龄普拉提': '逆龄普拉提',
  '女性保养瑜伽': '女性保养瑜伽',
  '东方养正瑜伽': '东方养正瑜伽',
  '塑形流瑜伽': '塑形流瑜伽',
  '体态塑形瑜伽': '体态塑形瑜伽',
  '正位塑形瑜伽': '正位塑形瑜伽',
  '一杰瑜伽': '一杰瑜伽',
  '瑜伽会员': '瑜伽会员',
  '懒人吃瘦': '懒人吃瘦',
  '养正变美': '养正变美',
  '风光摄影': '风光摄影',
  '相机摄影': '相机摄影',
  '国际声乐': '国际声乐',
  '华佗肩颈舒活功': '华佗肩颈舒活功',
  '健康家厨': '健康家厨',
  '儿童健康': '儿童健康',
  '食养助长': '食养助长',
  '体质食养': '体质食养',
  '易筋经': '易筋经',
  '营养调理': '营养调理',
  '中式美食制作': '中式美食制作',
  '东方食养': '东方食养',
  '轻训营': '轻训营',
  '亚健康管理': '亚健康管理',
  '私域': '私域',
}

export function normalizeCategory(name: string): string {
  const s = name.trim()
  if (!s) return ''

  // 1. Exact match to canonical
  if (CATEGORY_TO_LINE[s]) return s

  // 2. Exact match to alias
  if (CATEGORY_ALIASES[s]) return CATEGORY_ALIASES[s]

  // 3. Extract prefix before separator (e.g. "睡眠调理-五禽戏" → "睡眠调理")
  const separators = ['-', '—', '–', '|', '·', '•']
  for (const sep of separators) {
    const idx = s.indexOf(sep)
    if (idx > 0) {
      const prefix = s.slice(0, idx).trim()
      if (CATEGORY_TO_LINE[prefix]) return prefix
      if (CATEGORY_ALIASES[prefix]) return CATEGORY_ALIASES[prefix]
    }
  }

  // 4. Longest substring match against canonical names
  let bestCanonical = ''
  for (const canonical of Object.keys(CATEGORY_TO_LINE)) {
    if (s.includes(canonical) && canonical.length > bestCanonical.length) {
      bestCanonical = canonical
    }
  }
  if (bestCanonical) return bestCanonical

  // 5. Longest substring match against aliases
  let bestAlias = ''
  let bestAliasCanonical = ''
  for (const [alias, canonical] of Object.entries(CATEGORY_ALIASES)) {
    if (s.includes(alias) && alias.length > bestAlias.length) {
      bestAlias = alias
      bestAliasCanonical = canonical
    }
  }
  if (bestAliasCanonical) return bestAliasCanonical

  return s
}

export function parseLineFromCategory(category: string): LineType {
  const canonical = normalizeCategory(category)
  return CATEGORY_TO_LINE[canonical] || 'health'
}

export function isSameCategoryFamily(liveCat: string, segCat: string): boolean {
  const lc = normalizeCategory(liveCat).toLowerCase().replace(/\s+/g, '')
  const sc = normalizeCategory(segCat).toLowerCase().replace(/\s+/g, '')
  return sc.includes(lc) || lc.includes(sc)
}
