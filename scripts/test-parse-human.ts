import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook } from '../live-schedule-dashboard/src/utils/parser'

const buf = fs.readFileSync(path.join(__dirname, '../正确排期5.25-31.xlsx'))
const result = parseScheduleWorkbook(buf, '正确排期5.25-31.xlsx')
console.log('Lives:', result.lives.length)
console.log('WeekDays:', result.weekDays.map(w => w.fullDate).join(', '))
result.lives.forEach(l => {
  console.log(`${l.date} ${l.slot} ${l.name} (等级:${l.grade}) 曝光:${l.exposure} 段数:${l.assignedAudiences.length}`)
  l.assignedAudiences.forEach(a => console.log(`  ${a.line} ${a.category}(${a.count}) ${a.timeRange}`))
})
