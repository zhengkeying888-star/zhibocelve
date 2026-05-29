import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory } from '../live-schedule-dashboard/src/utils/categoryMapping'
import { DEFAULT_CATEGORY_GRADES } from '../live-schedule-dashboard/src/lib/defaultCategoryMappings'

const sysBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期.xlsx'))
const sysParsed = parseScheduleWorkbook(sysBuf, '5月25-31日直播排期.xlsx')
let sysLives = sysParsed.lives.map(l => ({
  ...l,
  grade: inferGrade(l.name) || l.grade || DEFAULT_CATEGORY_GRADES[normalizeCategory(l.category)] || 'C',
}))

for (const live of sysLives) {
  if (live.name.includes('一杰') || live.name.includes('君合') || live.name.includes('睡眠') || live.name.includes('风光') || live.name.includes('摄影美学')) {
    console.log(`"${live.name}" date="${live.date}" slot="${live.slot}" grade=${live.grade} line=${live.line}`)
  }
}
