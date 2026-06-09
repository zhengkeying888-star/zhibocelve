import * as fs from 'fs'
import { parseScheduleSheet } from '../live-schedule-dashboard/src/utils/parser'

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期.xlsx')
const result = parseScheduleSheet(buf)

console.log('Lives count:', result.lives.length)
console.log('WeekDays count:', result.weekDays.length)

for (const live of result.lives) {
  console.log(`  ${live.date} ${live.slot} [${live.type}] ${live.name} (cat=${live.category}, line=${live.line})`)
}
