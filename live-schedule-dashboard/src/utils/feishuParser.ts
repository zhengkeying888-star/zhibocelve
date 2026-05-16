import type { LiveStream, AudienceSegment, HistoryRecord, WeekDay, LineType, SlotType } from '@/types'
import { normalizeCategory, parseLineFromCategory } from './categoryMapping'
import { generateId } from './parser'

export interface FeishuBitableRow {
  date: string
  weekday: string
  slot: string
  rowType: string
  liveName?: string
  owner?: string
  exposure?: number
  audienceCategory?: string
  audienceTimeRange?: string
  audienceCount?: number
  audienceLine?: string
  isStock?: boolean
}

function detectSlot(slotRaw: string): SlotType {
  const s = slotRaw.trim()
  if (s.includes('晨练') || s.includes('早间')) return 'morning'
  if (s.includes('晚IP') || s.includes('晚间')) return 'evening'
  if (s.includes('伪直播') && s.includes('早')) return 'fake-morning'
  if (s.includes('伪直播') && s.includes('晚')) return 'fake-evening'
  if (s.includes('朋友圈')) return 'friend-circle'
  return 'evening'
}

function detectLine(lineRaw: string): LineType | null {
  const s = lineRaw.trim()
  if (s.includes('健康')) return 'health'
  if (s.includes('变美')) return 'beauty'
  if (s.includes('兴趣')) return 'interest'
  return parseLineFromCategory(s)
}

export function parseFeishuRows(rows: FeishuBitableRow[]): {
  lives: LiveStream[]
  weekDays: WeekDay[]
  audienceSegments: AudienceSegment[]
  historyRecords: HistoryRecord[]
} {
  // Group rows by (date, slot, liveName)
  const groups = new Map<string, FeishuBitableRow[]>()
  const daySet = new Map<string, { label: string; date: string }>()

  for (const row of rows) {
    const key = `${row.date}::${row.slot}::${row.liveName || ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
    if (row.date) {
      daySet.set(row.date, { label: row.weekday || '', date: row.date })
    }
  }

  const lives: LiveStream[] = []
  const audienceSegments: AudienceSegment[] = []
  const historyRecords: HistoryRecord[] = []

  for (const [, groupRows] of groups) {
    const liveRow = groupRows.find((r) => r.rowType === '直播名')
    if (!liveRow || !liveRow.liveName) continue

    const slot = detectSlot(liveRow.slot)
    const liveNameRaw = liveRow.liveName.trim()
    const category = normalizeCategory(liveNameRaw)
    const line = parseLineFromCategory(category) || 'health'

    // Parse time from liveName e.g. "品类-名字|19:00|数字人"
    const timeMatch = liveNameRaw.match(/(\d{1,2}[:：]\d{2})\s*[-~]\s*(\d{1,2}[:：]\d{2})/)
    let startTime = '19:00'
    let endTime = '21:00'
    if (timeMatch) {
      startTime = timeMatch[1].replace('：', ':')
      endTime = timeMatch[2].replace('：', ':')
    } else {
      const singleTime = liveNameRaw.match(/(\d{1,2}[:：]\d{2})/)
      if (singleTime) startTime = singleTime[1].replace('：', ':')
      if (slot.includes('morning')) {
        startTime = timeMatch ? startTime : '07:30'
        endTime = timeMatch ? endTime : '09:00'
      }
    }

    const ownerRow = groupRows.find((r) => r.rowType === '文案负责人')
    const exposureRow = groupRows.find((r) => r.rowType === '曝光量级')

    const live: LiveStream = {
      id: generateId(),
      name: liveNameRaw,
      startTime,
      endTime,
      date: liveRow.date,
      type: 'real',
      category,
      line,
      slot,
      grade: null,
      owner: ownerRow?.owner || '',
      assignedAudiences: [],
      exposure: exposureRow?.exposure || 0,
      conflictReasons: [],
      isRecommended: false,
      isCrossCategory: true,
    }

    // Parse audience rows
    const audRows = groupRows.filter((r) => r.rowType === 'audience')
    for (const ar of audRows) {
      if (!ar.audienceCategory || !ar.audienceTimeRange || !ar.audienceCount) continue
      const segLine = detectLine(ar.audienceLine || '') || line
      const segCat = normalizeCategory(ar.audienceCategory)
      const seg: AudienceSegment = {
        id: generateId(),
        line: segLine,
        category: segCat,
        timeRange: ar.audienceTimeRange,
        count: ar.audienceCount,
        status: 'available',
      }
      audienceSegments.push(seg)

      // Add to live assignedAudiences
      live.assignedAudiences.push({
        segmentId: seg.id,
        line: segLine,
        category: segCat,
        timeRange: ar.audienceTimeRange,
        count: ar.audienceCount,
      })
      live.exposure += ar.audienceCount

      // Build history record for frequency control
      historyRecords.push({
        date: liveRow.date,
        liveId: live.id,
        category: segCat,
        timeRange: ar.audienceTimeRange,
        type: 'real',
        slot,
      })
    }

    lives.push(live)
  }

  // Build weekDays from daySet
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const weekDays: WeekDay[] = Array.from(daySet.values())
    .map((d) => ({
      label: d.label,
      date: d.date,
      fullDate: d.date,
    }))
    .sort((a, b) => {
      const ai = weekdays.indexOf(a.label)
      const bi = weekdays.indexOf(b.label)
      return ai - bi
    })

  return { lives, weekDays, audienceSegments, historyRecords }
}

export function trimHistoryRecords(records: HistoryRecord[], weeks: number = 4): HistoryRecord[] {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - weeks * 7)
  return records.filter((r) => {
    const d = new Date(r.date.replace(/\//g, '-'))
    return d >= cutoff
  })
}
