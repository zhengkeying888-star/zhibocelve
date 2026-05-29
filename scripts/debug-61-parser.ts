import * as fs from 'fs'
import { parseScheduleWorkbook } from '../live-schedule-dashboard/src/utils/parser'

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期.xlsx')
const result = parseScheduleWorkbook(buf, '6.1-6.7排期.xlsx')

console.log('=== Lives ===')
for (const live of result.lives) {
  console.log(`${live.date} ${live.slot} ${live.name} (cat:${live.category}, grade:${live.grade}, type:${live.type}, joint:${live.isJoint})`)
  if (live.fakeHistoryAudiences && live.fakeHistoryAudiences.length > 0) {
    console.log('  fakeHistory:')
    for (const a of live.fakeHistoryAudiences) {
      console.log(`    ${a.category}(${a.count}) ${a.timeRange}`)
    }
  }
}

console.log('\n=== WeekDays ===')
for (const d of result.weekDays) {
  console.log(`  ${d.label} ${d.date} ${d.fullDate}`)
}

console.log('\n=== AudienceSegments from schedule ===')
for (const s of result.audienceSegments) {
  console.log(`  ${s.line} ${s.category}(${s.count}) ${s.timeRange}`)
}
