import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, getCategoryFamily, isSameCategoryFamily } from '../live-schedule-dashboard/src/utils/categoryMapping'
import type { LiveStream, AudienceSegment } from '../live-schedule-dashboard/src/types'

const filePath = path.join(__dirname, '../我的排期5.18-5.24.xlsx')
const buffer = fs.readFileSync(filePath)
const { lives, audienceSegments } = parseScheduleWorkbook(buffer, path.basename(filePath))

const realLives = lives.filter(l => l.type === 'real')

// 按日期+线级分组，看竞争格局
const dateLineMap = new Map<string, Map<string, typeof realLives>>()
for (const live of realLives) {
  const key = live.date
  if (!dateLineMap.has(key)) dateLineMap.set(key, new Map())
  const lineMap = dateLineMap.get(key)!
  const line = live.line || 'unknown'
  if (!lineMap.has(line)) lineMap.set(line, [])
  lineMap.get(line)!.push(live)
}

// 统计每线级每天的audience库存
const segByLineDate = new Map<string, Map<string, number>>()
for (const seg of audienceSegments) {
  // 简化：不按日期分，只看线级总库存
  const key = seg.line
  if (!segByLineDate.has(key)) segByLineDate.set(key, new Map())
  const catMap = segByLineDate.get(key)!
  const cat = normalizeCategory(seg.category)
  catMap.set(cat, (catMap.get(cat) || 0) + seg.count)
}

console.log('=== 线级总库存与品类分布 ===\n')
for (const [line, catMap] of segByLineDate) {
  const total = Array.from(catMap.values()).reduce((a, b) => a + b, 0)
  const cats = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}(${n.toLocaleString()})`).join(', ')
  console.log(`${line}: 总库存 ${total.toLocaleString()}`)
  console.log(`  品类分布: ${cats}\n`)
}

// 找出关键偏差直播
const focusLives = [
  '普拉提晨练',
  '居家古法养生',
  '一杰瑜伽晨练',
  '2025.5.16健康营养',
  '君合太极晨练',
  '睡眠调理晨练',
  '2026.4.2唐一杰',
  '短视频李扬',
]

console.log('=== 关键直播人工排期明细 ===\n')
for (const live of realLives) {
  if (!focusLives.some(n => live.name.includes(n))) continue
  const lineStr = live.isJoint ? (live.lines?.join('+') || live.line) : live.line
  console.log(`${live.date} ${live.slot} ${live.name} (线:${lineStr}, 等级:${live.grade || inferGrade(live.name) || '?'}) 曝光:${live.exposure.toLocaleString()} 段数:${live.assignedAudiences.length}`)
  for (const a of live.assignedAudiences) {
    const isVertical = isSameCategoryFamily(a.category, live.category)
    const isPrimaryLine = a.line === live.line
    console.log(`  ${isVertical ? '【垂类】' : ''}${isPrimaryLine ? '' : '[跨线]'} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
  }
  console.log('')
}

// 分析health线S级竞争
console.log('=== health 线 S级竞争分析 ===\n')
const healthSLives = realLives.filter(l => l.line === 'health' && (l.grade === 'S' || inferGrade(l.name) === 'S'))
for (const live of healthSLives) {
  console.log(`${live.date} ${live.slot} ${live.name} 曝光:${live.exposure.toLocaleString()} 段数:${live.assignedAudiences.length}`)
  const families = new Set(live.assignedAudiences.map(a => getCategoryFamily(a.category)))
  console.log(`  品类族: ${Array.from(families).join(', ')}`)
}

// 分析beauty线C级是否拿了不该拿的大段
console.log('\n=== beauty 线 C级直播分配明细 ===\n')
const beautyCLives = realLives.filter(l => l.line === 'beauty' && l.grade === 'C')
for (const live of beautyCLives) {
  const hasLargeNonVertical = live.assignedAudiences.some(a => {
    const seg = audienceSegments.find(s => s.category === a.category && s.timeRange === a.timeRange)
    return seg && seg.count > 150000 && !isSameCategoryFamily(a.category, live.category)
  })
  if (hasLargeNonVertical || live.exposure > 300000) {
    console.log(`${live.date} ${live.slot} ${live.name} 曝光:${live.exposure.toLocaleString()} 段数:${live.assignedAudiences.length}`)
    for (const a of live.assignedAudiences) {
      const isVertical = isSameCategoryFamily(a.category, live.category)
      console.log(`  ${isVertical ? '【垂类】' : '【跨科】'} ${a.category}(${a.count.toLocaleString()})`)
    }
  }
}
