import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook, parseAudienceSheet, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory } from '../live-schedule-dashboard/src/utils/categoryMapping'
import { DEFAULT_CATEGORY_GRADES } from '../live-schedule-dashboard/src/lib/defaultCategoryMappings'

const sysBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期.xlsx'))
const sysParsed = parseScheduleWorkbook(sysBuf, '5月25-31日直播排期.xlsx')
const sysLives = sysParsed.lives.map(l => ({ ...l, grade: inferGrade(l.name) || l.grade || DEFAULT_CATEGORY_GRADES[normalizeCategory(l.category)] || 'C' }))

const audBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期人数.xlsx'))
const audienceSegments = parseAudienceSheet(audBuf)

// Check if 瑜伽SA exists in audience inventory
const yogaSA = audienceSegments.filter(s => normalizeCategory(s.category) === '瑜伽SA')
console.log('=== 瑜伽SA in audience inventory ===')
console.log(yogaSA.length > 0 ? yogaSA : 'NOT FOUND')

const yogaSABCD = audienceSegments.filter(s => normalizeCategory(s.category) === '瑜伽SABCD')
console.log('\n=== 瑜伽SABCD in audience inventory ===')
console.log(yogaSABCD.length > 0 ? yogaSABCD : 'NOT FOUND')

// Check all yoga segments
console.log('\n=== All yoga segments in inventory ===')
for (const s of audienceSegments) {
  if (normalizeCategory(s.category).includes('瑜伽')) {
    console.log(`  ${s.category}(${s.count.toLocaleString()}) ${s.timeRange}`)
  }
}

// Check 气血调理 segments
console.log('\n=== All 气血调理 segments in inventory ===')
for (const s of audienceSegments) {
  if (normalizeCategory(s.category) === '气血调理') {
    console.log(`  ${s.category}(${s.count.toLocaleString()}) ${s.timeRange}`)
  }
}

// Check parsed system lives
console.log('\n=== Relevant system lives ===')
for (const live of sysLives) {
  if (live.name.includes('一杰瑜伽') || live.name.includes('君合太极') || live.name.includes('睡眠调理') || live.name.includes('风光摄影') || live.name.includes('摄影美学')) {
    console.log(`  "${live.name}" date="${live.date}" slot="${live.slot}" grade=${live.grade} line=${live.line}`)
  }
}
