import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, getCategoryFamily, isSameCategoryFamily, parseLineFromCategory } from '../live-schedule-dashboard/src/utils/categoryMapping'

const filePath = path.join(__dirname, '../我的排期5.18-5.24.xlsx')
const buffer = fs.readFileSync(filePath)
const { lives, audienceSegments, historyRecords } = parseScheduleWorkbook(buffer, path.basename(filePath))

// 只对比 real live
const realLives = lives.filter(l => l.type === 'real')

// 按日期分组
const livesByDate = new Map<string, typeof realLives>()
for (const live of realLives) {
  if (!livesByDate.has(live.date)) livesByDate.set(live.date, [])
  livesByDate.get(live.date)!.push(live)
}

// 统计每一天每线级的直播数
console.log('=== 每日线级竞争分析 ===\n')
for (const [date, dateLives] of [...livesByDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const byLine: Record<string, typeof dateLives> = {}
  for (const live of dateLives) {
    const line = live.line
    if (!byLine[line]) byLine[line] = []
    byLine[line].push(live)
  }
  console.log(`${date}:`)
  for (const [line, lineLives] of Object.entries(byLine)) {
    const names = lineLives.map(l => `${l.name}(${l.grade}, ${l.exposure.toLocaleString()})`).join(', ')
    console.log(`  ${line}: ${lineLives.length}场 -> ${names}`)
  }
  console.log('')
}

// 统计人工排期中各直播的段数、品类集中度
console.log('=== 人工排期品类集中度 ===\n')
for (const live of realLives) {
  const families = new Set(live.assignedAudiences.map(a => getCategoryFamily(a.category)))
  const cats = new Set(live.assignedAudiences.map(a => normalizeCategory(a.category)))
  const ranges = new Set(live.assignedAudiences.map(a => a.timeRange))
  console.log(`${live.date} ${live.slot} ${live.name}(${live.grade}) 曝光:${live.exposure.toLocaleString()} 段数:${live.assignedAudiences.length} 品类族:${families.size} 细分品类:${cats.size} 时间范围:${ranges.size}`)
  for (const a of live.assignedAudiences) {
    console.log(`  - ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
  }
}

// 统计各线级总库存
const lineInventory: Record<string, number> = {}
for (const seg of audienceSegments) {
  lineInventory[seg.line] = (lineInventory[seg.line] || 0) + seg.count
}
console.log('\n=== 各线级总库存 ===')
for (const [line, total] of Object.entries(lineInventory)) {
  const liveExposure = realLives.filter(l => l.line === line || l.lines?.includes(line as any)).reduce((sum, l) => sum + l.exposure, 0)
  console.log(`${line}: 库存 ${total.toLocaleString()}, 人工分配 ${liveExposure.toLocaleString()}`)
}

// 找出数字人/低权重直播
console.log('\n=== 疑似低权重直播（人工曝光显著低于同级） ===')
for (const live of realLives) {
  const gradeTarget = { S: 600000, A: 500000, B: 350000, C: 250000 }[live.grade || 'C'] || 250000
  if (live.exposure < gradeTarget * 0.5) {
    console.log(`${live.name}(${live.grade}) 目标:${gradeTarget.toLocaleString()} 人工实际:${live.exposure.toLocaleString()} 段数:${live.assignedAudiences.length}`)
  }
}
