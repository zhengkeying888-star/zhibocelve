import * as fs from 'fs'
import { parseAudienceSheet } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, parseLineFromCategory } from '../live-schedule-dashboard/src/utils/categoryMapping'

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期人数.xlsx')
const segments = parseAudienceSheet(buf)

console.log('=== Audience 解析验证 ===\n')

// Group by normalized category
const byCategory = new Map<string, typeof segments>()
for (const seg of segments) {
  const key = `${seg.line}|${seg.category}`
  if (!byCategory.has(key)) byCategory.set(key, [])
  byCategory.get(key)!.push(seg)
}

// Expected totals using NORMALIZED category names
const checks = [
  { rawCat: '太极BCD', normalizedCat: '太极BCD', line: 'health', expectedTotal: 727035 },
  { rawCat: '太极A', normalizedCat: '太极A', line: 'health', expectedTotal: 302903 },
  { rawCat: '太极s', normalizedCat: '太极s', line: 'health', expectedTotal: 338376 },
  { rawCat: '普拉提A', normalizedCat: '普拉提A', line: 'beauty', expectedTotal: 119223 },
  { rawCat: '中医瑜伽', normalizedCat: '中医瑜伽', line: 'beauty', expectedTotal: 117979 },
  { rawCat: '中医变美', normalizedCat: '中医变美', line: 'beauty', expectedTotal: 239078 },
  { rawCat: '五禽戏', normalizedCat: '五禽戏', line: 'health', expectedTotal: 126262 },
  { rawCat: '健康营养', normalizedCat: '健康营养', line: 'health', expectedTotal: 211100 },
  { rawCat: '固气', normalizedCat: normalizeCategory('固气'), line: 'health', expectedTotal: 46879 },
  { rawCat: '睡眠', normalizedCat: normalizeCategory('睡眠'), line: 'health', expectedTotal: 106376 },
  { rawCat: '气血', normalizedCat: normalizeCategory('气血'), line: 'health', expectedTotal: 248556 },
  { rawCat: '亚健康', normalizedCat: normalizeCategory('亚健康'), line: 'health', expectedTotal: 21355 },
  { rawCat: '手机摄影SA', normalizedCat: '手机摄影SA', line: 'interest', expectedTotal: 140312 },
  { rawCat: '手机摄影BCD', normalizedCat: '手机摄影BCD', line: 'interest', expectedTotal: 214598 },
  { rawCat: '唱歌', normalizedCat: '唱歌', line: 'interest', expectedTotal: 508208 },
  { rawCat: '短视频', normalizedCat: '短视频', line: 'interest', expectedTotal: 247156 },
  { rawCat: '国际声乐', normalizedCat: '国际声乐', line: 'interest', expectedTotal: 32932 },
  { rawCat: '摄影美学', normalizedCat: '摄影美学', line: 'interest', expectedTotal: 52716 },
  { rawCat: '普拉提S', normalizedCat: '普拉提S', line: 'beauty', expectedTotal: 77749 },
  { rawCat: '普拉提BCD', normalizedCat: '普拉提BCD', line: 'beauty', expectedTotal: 232517 },
  { rawCat: '瑜伽S', normalizedCat: '瑜伽S', line: 'beauty', expectedTotal: 175319 },
  { rawCat: '瑜伽A', normalizedCat: '瑜伽A', line: 'beauty', expectedTotal: 155687 },
  { rawCat: '瑜伽BCD', normalizedCat: '瑜伽BCD', line: 'beauty', expectedTotal: 336789 },
  { rawCat: '面部驻颜瑜伽', normalizedCat: normalizeCategory('面部驻颜瑜伽'), line: 'beauty', expectedTotal: 66022 },
  { rawCat: '美学', normalizedCat: normalizeCategory('美学'), line: 'health', expectedTotal: 54466 },
]

let passCount = 0
let failCount = 0

for (const check of checks) {
  const key = `${check.line}|${check.normalizedCat}`
  const segs = byCategory.get(key) || []
  const total = segs.reduce((s, seg) => s + seg.count, 0)
  const status = Math.abs(total - check.expectedTotal) <= 1 ? '✅' : '❌'
  if (status === '✅') passCount++
  else failCount++

  console.log(`${status} ${check.line.padEnd(8)} ${check.rawCat.padEnd(12)} → ${check.normalizedCat.padEnd(12)} 解析:${total.toLocaleString().padStart(10)} 预期:${check.expectedTotal.toLocaleString().padStart(10)} 段数:${segs.length}`)
  for (const seg of segs) {
    console.log(`   ${seg.timeRange.padEnd(30)} ${seg.count.toLocaleString().padStart(10)}`)
  }
}

console.log(`\n总计: ${passCount} 通过, ${failCount} 失败`)

// Check line consistency
console.log('\n=== 线级一致性校验 ===\n')
let lineErrors = 0
for (const seg of segments) {
  const inferredLine = parseLineFromCategory(seg.category)
  if (inferredLine && inferredLine !== seg.line) {
    console.log(`❌ 线级不一致: ${seg.category} → 解析为${seg.line}, 实际应为${inferredLine}`)
    lineErrors++
  }
}
if (lineErrors === 0) {
  console.log('✅ 所有 audience 段线级一致')
}
