import * as XLSX from 'xlsx'
import type { LiveStream, WeekDay } from '@/types'

function formatAudience(live: LiveStream, line: string): string {
  const items = live.assignedAudiences.filter((a) => a.line === line)
  if (items.length === 0) return ''
  return items
    .map((a) => `【存量】${a.timeRange} ${a.category}（${a.count.toLocaleString()}）`)
    .join('\n')
}

export function exportSchedule(
  lives: LiveStream[],
  weekDays: WeekDay[],
  weekTitle: string
): void {
  const wb = XLSX.utils.book_new()

  // Build matrix structure
  // Rows: for each slot type, we have:
  // 1. 直播资源位分布行
  // 2. 文案负责人行
  // 3. 曝光量级行
  // 4. 健康线宣发行
  // 5. 变美线宣发行
  // 6. 兴趣线宣发行

  const slotTypes = [
    { slot: 'morning', label: '【早间】晨练' },
    { slot: 'evening', label: '【晚间】晚IP专场' },
    { slot: 'fake-morning', label: '【伪直播】早播' },
    { slot: 'fake-evening', label: '【伪直播】晚播' },
    { slot: 'friend-circle', label: '朋友圈宣发' },
  ]

  const lines = [
    { key: 'health', label: '健康线' },
    { key: 'beauty', label: '变美线' },
    { key: 'interest', label: '兴趣线' },
  ] as const

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

  const ws = XLSX.utils.aoa_to_sheet(data)

  // Set column widths
  const colWidths = [
    { wch: 16 }, // 资源位标签
    { wch: 14 }, // 行标签
    ...weekDays.map(() => ({ wch: 28 })),
  ]
  ws['!cols'] = colWidths

  // Set row heights for multi-line cells
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
  ws['!rows'] = rowHeights

  XLSX.utils.book_append_sheet(wb, ws, weekTitle)
  XLSX.writeFile(wb, `直播排期策略表_${weekTitle}.xlsx`)
}
