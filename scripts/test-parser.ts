import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook } from '../live-schedule-dashboard/src/utils/parser'

const filePath = path.join(__dirname, '../我的排期5.18-5.24.xlsx')
const buffer = fs.readFileSync(filePath)

const result = parseScheduleWorkbook(buffer, '我的排期5.18-5.24.xlsx')

console.log('=== 解析结果 ===')
console.log(`直播总数: ${result.lives.length}`)
console.log(`Audience 段总数: ${result.audienceSegments.length}`)
console.log(`历史记录总数: ${result.historyRecords.length}`)
console.log('')

const realLives = result.lives.filter(l => l.type === 'real')
const fakeLives = result.lives.filter(l => l.type === 'fake')

console.log(`Real 直播: ${realLives.length}`)
console.log(`Fake 直播: ${fakeLives.length}`)
console.log('')

// 按 slot 分组统计
const slotGroups: Record<string, typeof realLives> = {}
for (const live of realLives) {
  if (!slotGroups[live.slot]) slotGroups[live.slot] = []
  slotGroups[live.slot].push(live)
}

for (const [slot, lives] of Object.entries(slotGroups)) {
  console.log(`\n--- ${slot} (${lives.length}场) ---`)
  for (const live of lives) {
    const audStr = live.assignedAudiences.length > 0
      ? ` | audience:${live.assignedAudiences.length}段`
      : ''
    const jointStr = live.isJoint ? ' [联合]' : ''
    const crossStr = live.isCrossCategory ? ' [跨科]' : ''
    console.log(
      `${live.date} | ${live.name} | 品类:${live.category} | 线:${live.line} | 负责人:${live.owner || '(空)'} | 曝光:${live.exposure}${audStr}${jointStr}${crossStr}`
    )
    if (live.assignedAudiences.length > 0) {
      for (const aud of live.assignedAudiences) {
        console.log(`  -> ${aud.category}(${aud.count}) ${aud.timeRange}`)
      }
    }
  }
}

// 问题统计
const unknownCategoryLives = realLives.filter(l => {
  const cat = l.category
  // 检查是否无法识别：normalizeCategory 返回原值，且不在映射中
  return cat && !Object.keys(require('../live-schedule-dashboard/src/utils/categoryMapping').CATEGORY_TO_LINE || {}).includes(cat)
})

console.log('\n=== 问题统计 ===')
console.log(`品类无法识别的直播: ${unknownCategoryLives.length} 个`)
for (const live of unknownCategoryLives) {
  console.log(`  - ${live.date} ${live.slot}: "${live.name}" → 推断为 "${live.category}"`)
}

const missingOwner = realLives.filter(l => !l.owner)
console.log(`\n缺少负责人的直播: ${missingOwner.length} 个`)
for (const live of missingOwner) {
  console.log(`  - ${live.date} ${live.slot}: ${live.name}`)
}

const missingExposure = realLives.filter(l => l.exposure === 0 && l.assignedAudiences.length === 0)
console.log(`\n缺少曝光且无人群的直播: ${missingExposure.length} 个`)
for (const live of missingExposure) {
  console.log(`  - ${live.date} ${live.slot}: ${live.name}`)
}
