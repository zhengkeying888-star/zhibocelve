import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory } from '../live-schedule-dashboard/src/utils/categoryMapping'
import { DEFAULT_CATEGORY_GRADES } from '../live-schedule-dashboard/src/lib/defaultCategoryMappings'

const sysBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期.xlsx'))
const sysParsed = parseScheduleWorkbook(sysBuf, '5月25-31日直播排期.xlsx')
const sysLives = sysParsed.lives.map(l => ({ ...l, grade: inferGrade(l.name) || l.grade || DEFAULT_CATEGORY_GRADES[normalizeCategory(l.category)] || 'C' }))

const NEUTRAL_CATEGORIES = new Set(['一杰瑜伽', '东方养正瑜伽'])

function getLiveAllowedLines(live: any): Array<'health' | 'beauty' | 'interest'> {
  const lines = new Set<'health' | 'beauty' | 'interest'>()
  if (live.isJoint && live.lines && live.lines.length > 0) {
    for (const line of live.lines) lines.add(line)
  } else if (NEUTRAL_CATEGORIES.has(live.category) && live.line === 'beauty') {
    lines.add('beauty')
    lines.add('health')
  } else {
    lines.add(live.line as 'health' | 'beauty' | 'interest')
  }
  const result = Array.from(lines)
  const primaryIdx = result.indexOf(live.line as 'health' | 'beauty' | 'interest')
  if (primaryIdx > 0) { [result[0], result[primaryIdx]] = [result[primaryIdx], result[0]] }
  return result
}

for (const live of sysLives) {
  if (live.name.includes('普拉提') || live.name.includes('一杰瑜伽')) {
    const allowed = getLiveAllowedLines(live)
    console.log(`"${live.name}" isJoint=${live.isJoint} line=${live.line} lines=${JSON.stringify(live.lines)} category="${live.category}" allowed=${JSON.stringify(allowed)}`)
  }
}
