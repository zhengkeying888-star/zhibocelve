import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook } from '../live-schedule-dashboard/src/utils/parser'

const SLOT_MAP: Record<string, string> = {
  morning: '晨练',
  evening: '晚间',
  'fake-morning': '伪直播-早',
  'fake-evening': '伪直播-晚',
  'friend-circle': '朋友圈',
}

const LINE_MAP: Record<string, string> = {
  health: '健康线',
  beauty: '变美线',
  interest: '兴趣线',
}

function getWeekday(dateStr: string): string {
  const date = new Date(dateStr)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdays[date.getDay()]
}

function formatAudience(audiences: Array<{ category: string; count: number; timeRange: string }>): string {
  if (audiences.length === 0) return ''
  return audiences
    .map(a => `${a.category}（${a.count}）${a.timeRange}`)
    .join('\n')
}

function main() {
  const filePath = process.argv[2] || path.join(__dirname, '../我的排期5.18-5.24.xlsx')
  const buffer = fs.readFileSync(filePath)

  const { lives, weekDays } = parseScheduleWorkbook(buffer, path.basename(filePath))

  // Build map from raw date -> fullDate, and fullDate -> weekday label
  const fullDateMap = new Map<string, string>()
  const weekdayMap = new Map<string, string>()
  for (const wd of weekDays) {
    fullDateMap.set(wd.date, wd.fullDate)
    weekdayMap.set(wd.fullDate, wd.label)
  }

  interface FeishuRow {
    date: string
    weekday: string
    slot: string
    liveName: string
    category: string
    line: string
    owner: string
    exposure: number
    healthAudience: string
    beautyAudience: string
    interestAudience: string
    isJoint: boolean
    isCrossCategory: boolean
  }

  const feishuRows: FeishuRow[] = []

  for (const live of lives) {
    if (live.type !== 'real') continue

    const fullDate = fullDateMap.get(live.date) || live.date
    const weekday = weekdayMap.get(fullDate) || getWeekday(fullDate)

    // Group assigned audiences by line
    const healthAud: Array<{ category: string; count: number; timeRange: string }> = []
    const beautyAud: Array<{ category: string; count: number; timeRange: string }> = []
    const interestAud: Array<{ category: string; count: number; timeRange: string }> = []

    for (const aud of live.assignedAudiences) {
      const item = { category: aud.category, count: aud.count, timeRange: aud.timeRange }
      if (aud.line === 'health') healthAud.push(item)
      else if (aud.line === 'beauty') beautyAud.push(item)
      else if (aud.line === 'interest') interestAud.push(item)
    }

    // Include fake history audiences as well (marked with 【存量】 prefix in text)
    for (const aud of live.fakeHistoryAudiences || []) {
      const item = { category: `【存量】${aud.category}`, count: aud.count, timeRange: aud.timeRange }
      if (aud.line === 'health') healthAud.push(item)
      else if (aud.line === 'beauty') beautyAud.push(item)
      else if (aud.line === 'interest') interestAud.push(item)
    }

    feishuRows.push({
      date: fullDate,
      weekday,
      slot: SLOT_MAP[live.slot] || live.slot,
      liveName: live.name,
      category: live.category,
      line: LINE_MAP[live.line] || live.line,
      owner: live.owner || '',
      exposure: live.exposure,
      healthAudience: formatAudience(healthAud),
      beautyAudience: formatAudience(beautyAud),
      interestAudience: formatAudience(interestAud),
      isJoint: !!live.isJoint,
      isCrossCategory: live.isCrossCategory,
    })
  }

  console.log('Total rows:', feishuRows.length)

  // Save as JSON
  const jsonPath = path.join(__dirname, 'feishu-rows.json')
  fs.writeFileSync(jsonPath, JSON.stringify(feishuRows, null, 2))
  console.log('\nSaved to', jsonPath)

  // Save as CSV for inspection
  const headers = ['date', 'weekday', 'slot', 'liveName', 'category', 'line', 'owner', 'exposure', 'healthAudience', 'beautyAudience', 'interestAudience', 'isJoint', 'isCrossCategory']
  const csvLines = [headers.join(',')]
  for (const row of feishuRows) {
    const values = headers.map(h => {
      const v = (row as any)[h]
      if (typeof v === 'string' && v.includes(',')) return `"${v.replace(/"/g, '""')}"`
      if (typeof v === 'boolean') return v ? 'true' : 'false'
      return String(v)
    })
    csvLines.push(values.join(','))
  }
  const csvPath = path.join(__dirname, 'feishu-rows.csv')
  fs.writeFileSync(csvPath, csvLines.join('\n'))
  console.log('Saved to', csvPath)
}

main()
