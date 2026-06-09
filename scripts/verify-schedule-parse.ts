import * as fs from 'fs'
import { parseScheduleWorkbook } from '../live-schedule-dashboard/src/utils/parser'
import { parseLineFromCategory } from '../live-schedule-dashboard/src/utils/categoryMapping'

console.log('DEBUG: parseLineFromCategory("太极BCD") =', parseLineFromCategory('太极BCD'))

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6月排期【6.1-6.7】确认版.xlsx')
const result = parseScheduleWorkbook(buf, '6月排期【6.1-6.7】确认版.xlsx')

console.log('=== 确认版排期表解析验证 ===\n')
console.log(`解析出的直播数量: ${result.lives.length}`)

// 检查君合太极晨练的 audience 线级
const taiji = result.lives.find(l => l.name.includes('君合太极晨练'))
if (taiji) {
  console.log('\n君合太极晨练 audience 详情:')
  for (const a of taiji.assignedAudiences) {
    console.log(`  line=${a.line} category=${a.category} count=${a.count}`)
  }
}

// ... rest of verification
const bySlotDate = new Map<string, typeof result.lives>()
for (const live of result.lives) {
  const key = `${live.date}|${live.slot}`
  if (!bySlotDate.has(key)) bySlotDate.set(key, [])
  bySlotDate.get(key)!.push(live)
}

const sortedKeys = Array.from(bySlotDate.keys()).sort()
for (const key of sortedKeys) {
  const lives = bySlotDate.get(key)!
  const [date, slot] = key.split('|')
  console.log(`\n${date} ${slot}:`)
  for (const live of lives) {
    console.log(`  ${live.name.padEnd(30)} 品类:${live.category.padEnd(12)} 线级:${live.line} 曝光:${live.exposure.toLocaleString()} 段数:${live.assignedAudiences.length}`)
    if (live.assignedAudiences.length > 0) {
      for (const a of live.assignedAudiences) {
        console.log(`    → ${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
      }
    }
  }
}

const totalExposure = result.lives.reduce((s, l) => s + l.exposure, 0)
console.log(`\n总触达: ${totalExposure.toLocaleString()}`)
console.log(`总直播数: ${result.lives.length}`)
