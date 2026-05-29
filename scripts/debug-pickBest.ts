import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook, parseAudienceSheet, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, getCategoryFamily, isSameCategoryFamily } from '../live-schedule-dashboard/src/utils/categoryMapping'
import { DEFAULT_CATEGORY_GRADES } from '../live-schedule-dashboard/src/lib/defaultCategoryMappings'
import type { LiveStream, AudienceSegment } from '../live-schedule-dashboard/src/types'

const sysBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期.xlsx'))
const sysParsed = parseScheduleWorkbook(sysBuf, '5月25-31日直播排期.xlsx')
let sysLives = sysParsed.lives.map(l => ({
  ...l,
  assignedAudiences: [] as any[],
  exposure: 0,
  conflictReasons: [] as string[],
  grade: inferGrade(l.name) || l.grade || DEFAULT_CATEGORY_GRADES[normalizeCategory(l.category)] || 'C',
}))

const audBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期人数.xlsx'))
const audienceSegments = parseAudienceSheet(audBuf)

// Find 一杰瑜伽
const yijie = sysLives.find(l => l.name.includes('一杰瑜伽') && !l.name.includes('晨练'))
console.log('一杰瑜伽 live:', yijie?.name, 'date:', yijie?.date, 'grade:', yijie?.grade, 'line:', yijie?.line, 'isJoint:', yijie?.isJoint, 'category:', yijie?.category)

// Find 普拉提晨练+一杰瑜伽晨练 joint live
const joint = sysLives.find(l => l.name.includes('普拉提') && l.name.includes('一杰瑜伽') && l.name.includes('晨练'))
console.log('Joint live:', joint?.name, 'date:', joint?.date, 'grade:', joint?.grade, 'line:', joint?.line, 'isJoint:', joint?.isJoint, 'categories:', joint?.categories, 'lines:', joint?.lines)

// Show top 10 beauty segments
const beautySegs = audienceSegments.filter(s => s.line === 'beauty').sort((a, b) => b.count - a.count)
console.log('\nTop 10 beauty segments:')
beautySegs.slice(0, 10).forEach(s => {
  console.log(`  ${s.category}(${s.count}) ${s.timeRange} family=${getCategoryFamily(s.category)}`)
})

// Show yoga segments
const yogaSegs = beautySegs.filter(s => getCategoryFamily(s.category) === '瑜伽')
console.log('\nAll yoga segments:')
yogaSegs.forEach(s => {
  console.log(`  ${s.category}(${s.count}) ${s.timeRange}`)
})

// Show 普拉提 segments
const pilatesSegs = beautySegs.filter(s => getCategoryFamily(s.category) === '普拉提')
console.log('\nAll 普拉提 segments:')
pilatesSegs.forEach(s => {
  console.log(`  ${s.category}(${s.count}) ${s.timeRange}`)
})
