import * as XLSX from 'xlsx'
import type { LiveStream, WeekDay, AssignedAudience } from '@/types'

export interface MergedAudience {
  category: string
  timeRange: string
  count: number
  grouped?: boolean
}

export function mergeAudiences(items: AssignedAudience[]): MergedAudience[] {
  const exactMap = new Map<string, { category: string; timeRange: string; count: number; order: number }>()
  for (const item of items) {
    const key = `${item.timeRange}||${item.category}`
    const existing = exactMap.get(key)
    if (existing) {
      existing.count += item.count
    } else {
      exactMap.set(key, {
        category: item.category,
        timeRange: item.timeRange,
        count: item.count,
        order: exactMap.size,
      })
    }
  }

  const rangeMap = new Map<string, { timeRange: string; items: { category: string; count: number; order: number }[]; order: number }>()
  for (const item of exactMap.values()) {
    const existing = rangeMap.get(item.timeRange)
    if (existing) {
      existing.items.push({ category: item.category, count: item.count, order: item.order })
    } else {
      rangeMap.set(item.timeRange, {
        timeRange: item.timeRange,
        items: [{ category: item.category, count: item.count, order: item.order }],
        order: item.order,
      })
    }
  }

  return Array.from(rangeMap.values())
    .sort((a, b) => a.order - b.order)
    .map(({ timeRange, items }) => {
      const sortedItems = items.sort((a, b) => a.order - b.order)
      const count = sortedItems.reduce((sum, item) => sum + item.count, 0)
      if (sortedItems.length === 1) {
        return { category: sortedItems[0].category, timeRange, count }
      }
      return {
        category: sortedItems.map((item) => `${item.category}（${item.count.toLocaleString()}）`).join('、'),
        timeRange,
        count,
        grouped: true,
      }
    })
}

function formatAudience(live: LiveStream, line: string): string {
  const items = live.assignedAudiences.filter((a) => a.line === line)
  if (items.length === 0) return ''
  const merged = mergeAudiences(items)
  return merged
    .map((a) => `【存量】${a.timeRange} ${a.grouped ? a.category : `${a.category}（${a.count.toLocaleString()}）`}`)
    .join('\n')
}

const slotTypes = [
  { slot: 'morning', label: '【早间】晨练' },
  { slot: 'evening', label: '【晚间】晚IP专场' },
  { slot: 'fake-morning', label: '【伪直播】早播' },
  { slot: 'fake-evening', label: '【伪直播】晚播' },
  { slot: 'friend-circle', label: '朋友圈宣发' },
]

const lines = [
  { key: 'health' as const, label: '健康线' },
  { key: 'beauty' as const, label: '变美线' },
  { key: 'interest' as const, label: '兴趣线' },
]

export function buildExportMatrix(
  lives: LiveStream[],
  weekDays: WeekDay[]
): { data: (string | number)[][]; colWidths: { wch: number }[]; rowHeights: { hpt: number }[] } {
  const data: (string | number)[][] = []

  // Header row
  data.push(['星期', '', ...weekDays.map((d) => d.label)])
  data.push(['日期', '', ...weekDays.map((d) => d.date)])

  for (const st of slotTypes) {
    // Row 1: 直播资源位分布
    const resourceRow = [st.label, '直播资源位分布']
    for (const day of weekDays) {
      const dayLives = lives.filter((l) => l.slot === st.slot && l.date === day.date)
      resourceRow.push(
        dayLives
          .map((l) => `${l.name}\n${l.startTime}${l.link ? '\n预约链接' : ''}`)
          .join('\n---\n') || ''
      )
    }
    data.push(resourceRow)

    // Row 2: 文案负责人 (friend-circle uses 定时负责人 label)
    const ownerLabel = st.slot === 'friend-circle' ? '定时负责人' : '文案负责人'
    const ownerRow = ['', ownerLabel]
    for (const day of weekDays) {
      const dayLives = lives.filter((l) => l.slot === st.slot && l.date === day.date)
      ownerRow.push(dayLives.map((l) => l.owner).join('\n') || '')
    }
    data.push(ownerRow)

    // Friend-circle: skip exposure and audience rows
    if (st.slot !== 'friend-circle') {
      // Row 3: 曝光量级
      const exposureRow = ['', '曝光量级']
      for (const day of weekDays) {
        const dayLives = lives.filter((l) => l.slot === st.slot && l.date === day.date)
        exposureRow.push(dayLives.map((l) => l.exposure.toLocaleString()).join('\n') || '')
      }
      data.push(exposureRow)

      // Rows 4-6: 各线宣发人群
      for (const line of lines) {
        const lineRow = ['', line.label]
        for (const day of weekDays) {
          const dayLives = lives.filter((l) => l.slot === st.slot && l.date === day.date)
          lineRow.push(dayLives.map((l) => formatAudience(l, line.key)).join('\n---\n') || '')
        }
        data.push(lineRow)
      }
    }

    // Empty separator row
    data.push(['', '', ...weekDays.map(() => '')])
  }

  const colWidths = [
    { wch: 16 },
    { wch: 14 },
    ...weekDays.map(() => ({ wch: 28 })),
  ]

  const rowHeights = data.map((row) => {
    const maxLines = Math.max(
      ...row.map((cell) => {
        if (typeof cell === 'string') {
          return cell.split('\n').length
        }
        return 1
      })
    )
    return { hpt: Math.max(18, maxLines * 14) }
  })

  return { data, colWidths, rowHeights }
}

export function exportSchedule(
  lives: LiveStream[],
  weekDays: WeekDay[],
  weekTitle: string
): void {
  const wb = XLSX.utils.book_new()
  const { data, colWidths, rowHeights } = buildExportMatrix(lives, weekDays)
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = colWidths
  ws['!rows'] = rowHeights
  XLSX.utils.book_append_sheet(wb, ws, weekTitle)
  XLSX.writeFile(wb, `直播排期策略表_${weekTitle}.xlsx`)
}
