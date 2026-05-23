import * as fs from 'fs'
import * as path from 'path'
import { parseAudienceSheet } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory } from '../live-schedule-dashboard/src/utils/categoryMapping'

const audienceBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期人数.xlsx'))
const segments = parseAudienceSheet(audienceBuf)

// Group by category and sum counts
const catMap = new Map<string, { total: number, ranges: { timeRange: string, count: number }[] }>()
for (const seg of segments) {
  const cat = normalizeCategory(seg.category)
  if (!catMap.has(cat)) catMap.set(cat, { total: 0, ranges: [] })
  const info = catMap.get(cat)!
  info.total += seg.count
  info.ranges.push({ timeRange: seg.timeRange, count: seg.count })
}

// Sort categories by total count desc
const sorted = Array.from(catMap.entries()).sort((a, b) => b[1].total - a[1].total)

console.log('=== 各品类 timeRange 拆分情况（仅显示总计 > 50K 且有多个 timeRange 的品类）===\n')
for (const [cat, info] of sorted) {
  if (info.total < 50000) continue
  if (info.ranges.length <= 1) continue
  console.log(`${cat}: 总计 ${info.total.toLocaleString()}，拆分 ${info.ranges.length} 个 timeRange`)
  info.ranges.sort((a, b) => b.count - a.count)
  info.ranges.forEach(r => {
    console.log(`  ${r.timeRange.padEnd(30)} ${r.count.toLocaleString()}`)
  })
  console.log('')
}
