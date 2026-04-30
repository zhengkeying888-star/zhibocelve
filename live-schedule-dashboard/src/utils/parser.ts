import * as XLSX from 'xlsx'
import type {
  LiveStream,
  AudienceSegment,
  HistoryRecord,
  CrossPref,
  CrossCategoryPref,
  LineType,
  SlotType,
  WeekDay,
} from '@/types'
import { normalizeCategory, parseLineFromCategory } from './categoryMapping'

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

function parseLine(lineStr: string): LineType {
  // First try the canonical mapping
  const line = parseLineFromCategory(lineStr)
  if (line) return line

  // Fallback to keyword heuristics for unknown categories
  const s = String(lineStr || '').trim().toLowerCase()
  if (s.includes('健康') || s.includes('五禽戏') || s.includes('睡眠') || s.includes('太极') || s.includes('气血') || s.includes('固气')) return 'health'
  if (s.includes('变美') || s.includes('美容') || s.includes('瑜伽') || s.includes('普拉提') || s.includes('驻颜')) return 'beauty'
  if (s.includes('兴趣') || s.includes('摄影') || s.includes('唱歌') || s.includes('声乐') || s.includes('短视频')) return 'interest'
  return 'health'
}

function detectSlot(resourceName: string): SlotType {
  const s = String(resourceName || '').toLowerCase()
  if (s.includes('晨练') || s.includes('早间')) return 'morning'
  if (s.includes('晚ip') || s.includes('晚播') || s.includes('晚间') || s.includes('晚上平播')) return 'evening'
  if (s.includes('伪直播') || s.includes('复用')) {
    if (s.includes('7:') || s.includes('8:') || s.includes('晨练')) return 'fake-morning'
    return 'fake-evening'
  }
  if (s.includes('朋友圈') || s.includes('视频号')) return 'friend-circle'
  return 'evening'
}

function normCell(v: any): string {
  if (v === undefined || v === null) return ''
  const s = String(v).trim()
  if (s === 'NaN') return ''
  return s
}

function inferMonthFromSheetName(sheetName: string): number | null {
  const m = sheetName.match(/(\d+)月/)
  if (m) return parseInt(m[1], 10)
  const m2 = sheetName.match(/【?(\d+)\.(\d+)/)
  if (m2) return parseInt(m2[1], 10)
  return null
}

function inferWeekFromFileName(fileName: string, firstDay: number): number | null {
  // Match patterns like "4月29日" to get a reference date
  const m = fileName.match(/(\d{1,2})月(\d{1,2})日/)
  if (!m) return null
  const refMonth = parseInt(m[1], 10)
  const refDay = parseInt(m[2], 10)
  const year = new Date().getFullYear()
  const refDate = new Date(year, refMonth - 1, refDay)
  const dow = refDate.getDay() // 0=Sun, 1=Mon...

  // Next Monday
  const daysUntilMon = dow === 0 ? 1 : 8 - dow
  const nextMon = new Date(refDate)
  nextMon.setDate(refDate.getDate() + daysUntilMon)
  if (nextMon.getDate() === firstDay) return nextMon.getMonth() + 1

  // Current Monday
  const daysSinceMon = dow === 0 ? 6 : dow - 1
  const thisMon = new Date(refDate)
  thisMon.setDate(refDate.getDate() - daysSinceMon)
  if (thisMon.getDate() === firstDay) return thisMon.getMonth() + 1

  return null
}

function buildFullDate(sheetName: string, dayStr: string, fileName?: string): string {
  let month = inferMonthFromSheetName(sheetName)

  // dayStr may be "4.6" (month.day) or "6" (day only)
  let day: number
  const dotParts = dayStr.split('.')
  if (dotParts.length === 2) {
    day = parseInt(dotParts[1], 10)
    if (!month) month = parseInt(dotParts[0], 10)
  } else {
    day = parseInt(dayStr, 10)
  }
  if (isNaN(day)) return dayStr

  // If still no month, try to infer from file name week context
  if (!month && fileName) {
    month = inferWeekFromFileName(fileName, day)
  }

  // Fallback to file name month literal
  if (!month && fileName) {
    month = inferMonthFromSheetName(fileName)
  }

  const year = new Date().getFullYear()
  return `${year}-${String(month || 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function extractLink(line: string): string {
  let link = line.replace('预约链接：', '').replace('链接：', '').trim()
  if (link.includes(' ')) link = link.split(' ')[0]
  return link
}

function inferCategory(name: string): string {
  // Normalize using the canonical mapping system
  const normalized = normalizeCategory(name)
  if (normalized !== name.trim()) return normalized

  // Fallback: extract prefix before separator (e.g. "摄影美学-段晓晖单人" → "摄影美学")
  const separators = ['-', '—', '–', '|', '·', '•']
  for (const sep of separators) {
    const idx = name.indexOf(sep)
    if (idx > 0) {
      const prefix = name.slice(0, idx).trim()
      if (prefix.length >= 2) {
        const prefixNormalized = normalizeCategory(prefix)
        if (prefixNormalized !== prefix) return prefixNormalized
        return prefix
      }
    }
  }

  // Fallback to keyword mapping for names without separators
  const s = name.toLowerCase()
  if (s.includes('健康营养')) return '健康营养'
  if (s.includes('太极')) return '太极'
  if (s.includes('五禽戏')) return '五禽戏'
  if (s.includes('睡眠')) return '睡眠调理'
  if (s.includes('中医') || s.includes('变美')) return '中医变美'
  if (s.includes('普拉提')) return '普拉提'
  if (s.includes('瑜伽')) return '瑜伽'
  if (s.includes('摄影')) return '手机摄影'
  if (s.includes('唱歌')) return '唱歌'
  if (s.includes('短视频')) return '短视频'
  return name
}

function hasDayData(row: any[]): boolean {
  return row.slice(2, 9).some((c: any) => normCell(c) !== '')
}

function isBlockHeaderRow(col0: string): boolean {
  return !!col0 && (
    col0.includes('早间') ||
    col0.includes('晚IP') ||
    col0.includes('晚上') ||
    col0.includes('朋友圈') ||
    col0.includes('视频号') ||
    col0.includes('伪直播') ||
    col0.includes('复用')
  )
}

function isMetadataRow(c0: string, c1: string): boolean {
  return (
    c1 === '文案负责人' ||
    c0 === '定时负责人' ||
    c1 === '曝光量级' ||
    c1 === '健康线' ||
    c1 === '变美线' ||
    c1 === '兴趣线'
  )
}

function parseMergedLiveCell(merged: string, day: WeekDay, slot: SlotType): LiveStream[] {
  const lines = merged.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const timeRangeRegex = /(\d{1,2}[：:]\d{2})\s*[-~－]\s*(\d{1,2}[：:]\d{2})/
  const timeIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (timeRangeRegex.test(lines[i])) timeIndices.push(i)
  }

  // If multiple time ranges, split into multiple lives
  if (timeIndices.length > 1) {
    const result: LiveStream[] = []
    let startIdx = 0
    for (let t = 0; t < timeIndices.length; t++) {
      const ti = timeIndices[t]
      let nameIdx = -1
      for (let j = startIdx; j < ti; j++) {
        const line = lines[j]
        if (
          !line.includes('开播时间') &&
          !line.includes('预约链接') &&
          !line.includes('直播间ID') &&
          !line.includes('复用') &&
          !line.includes('需剪辑') &&
          !timeRangeRegex.test(line)
        ) {
          nameIdx = j
        }
      }
      const name = nameIdx >= 0 ? lines[nameIdx] : lines[startIdx]
      const timeMatch = lines[ti].match(timeRangeRegex)
      const startTime = timeMatch ? timeMatch[1].replace('：', ':') : '07:30'
      const endTime = timeMatch ? timeMatch[2].replace('：', ':') : '09:00'

      let link = ''
      for (let j = startIdx; j <= ti; j++) {
        if (lines[j].includes('预约链接') || lines[j].includes('http')) {
          link = extractLink(lines[j])
        }
      }

      const lineType = parseLine(name)
      const isFake = slot.includes('fake') || name.includes('复用') || name.includes('伪')

      result.push({
        id: generateId(),
        name,
        startTime,
        endTime,
        date: day.date,
        type: isFake ? 'fake' : 'real',
        category: inferCategory(name),
        line: lineType,
        slot,
        grade: null,
        owner: '',
        link,
        ltv: 80,
        assignedAudiences: [],
        exposure: 0,
        conflictReasons: [],
        isRecommended: false,
        isCrossCategory: false,
      })

      startIdx = ti + 1
    }

    // Attach remaining metadata (links) to last live
    if (startIdx < lines.length && result.length > 0) {
      for (let j = startIdx; j < lines.length; j++) {
        if (lines[j].includes('预约链接') || lines[j].includes('http')) {
          result[result.length - 1].link = extractLink(lines[j])
        }
      }
    }

    return result
  }

  // Single live
  const name = lines[0]
  let startTime = ''
  let endTime = ''
  let link = ''

  for (const line of lines) {
    if (line.includes('开播时间')) {
      const match = line.match(/(\d{1,2}[：:]\d{2})/)
      if (match) startTime = match[1].replace('：', ':')
    }
    if (timeRangeRegex.test(line)) {
      const match = line.match(timeRangeRegex)
      if (match) {
        startTime = match[1].replace('：', ':')
        endTime = match[2].replace('：', ':')
      }
    }
    if (line.includes('预约链接') || line.includes('http')) {
      link = extractLink(line)
    }
  }

  const lineType = parseLine(name)
  const isFake = slot.includes('fake') || name.includes('复用') || name.includes('伪')

  return [{
    id: generateId(),
    name,
    startTime: startTime || (slot.includes('morning') ? '07:30' : '19:00'),
    endTime: endTime || (slot.includes('morning') ? '09:00' : '21:00'),
    date: day.date,
    type: isFake ? 'fake' : 'real',
    category: inferCategory(name),
    line: lineType,
    slot,
    grade: null,
    owner: '',
    link,
    ltv: 80,
    assignedAudiences: [],
    exposure: 0,
    conflictReasons: [],
    isRecommended: false,
    isCrossCategory: false,
  }]
}

// Find the row index where col0 === '星期' (header row)
function findHeaderRow(json: any[][]): number {
  for (let r = 0; r < Math.min(json.length, 10); r++) {
    if (normCell(json[r]?.[0]) === '星期') return r
  }
  return -1
}

function findDateRow(json: any[][], startFrom: number): number {
  for (let r = startFrom; r < Math.min(json.length, startFrom + 3); r++) {
    if (normCell(json[r]?.[0]) === '日期') return r
  }
  return -1
}

function isScheduleSheet(sheetJson: any[][]): boolean {
  const hr = findHeaderRow(sheetJson)
  if (hr === -1) return false
  const dr = findDateRow(sheetJson, hr + 1)
  return dr !== -1
}

function isAudienceSheet(sheetJson: any[][]): boolean {
  if (sheetJson.length < 3) return false
  for (let r = 0; r < Math.min(sheetJson.length, 5); r++) {
    const row = sheetJson[r]
    if (!row) continue
    const cols = row.map((c: any) => normCell(c))
    if (cols.includes('线') && cols.includes('品类') && cols.includes('用户数')) return true
  }
  return false
}

function pickCurrentScheduleSheet(workbook: XLSX.WorkBook): { sheetName: string; json: any[][] } | null {
  const candidates: { sheetName: string; json: any[][]; priority: number }[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
    if (!isScheduleSheet(json)) continue

    // Skip sheets that are clearly audience or other data
    if (sheetName.includes('用户量级') || sheetName.includes('各线人数')) continue

    let priority = 0
    // Prefer sheets with month markers and more recent dates
    if (sheetName.includes('5月')) priority += 100
    else if (sheetName.includes('4月')) priority += 50
    if (sheetName.includes('排期')) priority += 10
    if (sheetName.includes('月度')) priority += 5

    candidates.push({ sheetName, json, priority })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.priority - a.priority)
  return { sheetName: candidates[0].sheetName, json: candidates[0].json }
}

function pickAudienceSheets(workbook: XLSX.WorkBook): { sheetName: string; json: any[][] }[] {
  const result: { sheetName: string; json: any[][] }[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
    if (isAudienceSheet(json)) {
      result.push({ sheetName, json })
    }
  }
  return result
}

// ====== 1. Parse Schedule Sheet (matrix structure) ======
export function parseScheduleSheet(buffer: ArrayBuffer): { lives: LiveStream[]; weekDays: WeekDay[] } {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const picked = pickCurrentScheduleSheet(workbook)
  if (!picked) return { lives: [], weekDays: [] }

  const result = parseScheduleJson(picked.json, picked.sheetName)
  return result
}

// ====== 2. Parse Audience Sheet (dynamic columns) ======
export function parseAudienceSheet(buffer: ArrayBuffer): AudienceSegment[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheets = pickAudienceSheets(workbook)
  if (sheets.length === 0) return []

  // Prefer sheet with most rows; if tied, prefer one whose name matches a current week
  sheets.sort((a, b) => b.json.length - a.json.length)
  const json = sheets[0].json
  return parseAudienceJson(json)
}

// ====== 3. Parse History from Schedule Book ======
export function parseHistoryFromScheduleBook(buffer: ArrayBuffer, excludeSheetName?: string): HistoryRecord[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const records: HistoryRecord[] = []

  for (const sheetName of workbook.SheetNames) {
    if (excludeSheetName && sheetName === excludeSheetName) continue
    if (!isScheduleSheet(workbook.Sheets[sheetName] ? XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) as any[][] : [])) continue

    const sheet = workbook.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
    if (json.length < 4) continue

    const headerRowIdx = findHeaderRow(json)
    const dateRowIdx = findDateRow(json, headerRowIdx + 1)
    if (headerRowIdx === -1 || dateRowIdx === -1) continue

    const dateRow = json[dateRowIdx] || []
    const weekDays: { label: string; date: string; fullDate: string }[] = []
    for (let col = 2; col <= 8; col++) {
      const label = normCell(dateRow[col])
      if (label) weekDays.push({ label, date: label, fullDate: buildFullDate(sheetName, label) })
    }

    let currentSlot: SlotType = 'morning'

    for (let r = dateRowIdx + 1; r < json.length; r++) {
      const row = json[r]
      if (!row || row.length < 3) continue

      const col0 = normCell(row[0])
      const col1 = normCell(row[1])

      if (col0 && (col0.includes('早间') || col0.includes('晚IP') || col0.includes('晚上') || col0.includes('朋友圈') || col0.includes('视频号') || col0.includes('伪直播') || col0.includes('复用'))) {
        currentSlot = detectSlot(col0)
      }

      if (col1 !== '健康线' && col1 !== '变美线' && col1 !== '兴趣线') continue

      for (let col = 2; col < row.length; col++) {
        const cell = normCell(row[col])
        if (!cell) continue
        const dayIdx = col - 2
        if (dayIdx >= weekDays.length) continue
        const day = weekDays[dayIdx]

        const lines = cell.split('\n').map(l => l.trim()).filter(Boolean)
        let currentTimeRange = ''
        for (let i = 0; i < lines.length; i++) {
          const al = lines[i]
          if (al.includes('【存量】')) {
            const remainder = al.replace('【存量】', '').trim()
            if (remainder) {
              currentTimeRange = remainder
            } else if (i + 1 < lines.length) {
              currentTimeRange = lines[i + 1]
            }
            continue
          }
          if (!currentTimeRange && /年.*—/.test(al)) {
            currentTimeRange = al
            continue
          }
          const match = al.match(/(.+?)[（(](\d+)[）)]/)
          if (match && currentTimeRange) {
            records.push({
              date: day.date,
              liveId: generateId(),
              category: normalizeCategory(match[1].trim()),
              timeRange: currentTimeRange,
              type: 'real',
              slot: currentSlot,
            })
          }
        }
      }
    }
  }

  return records
}

// ====== 4. Parse Cross Pref Sheet ======
export function parseCrossPrefSheet(buffer: ArrayBuffer): { crossPrefs: CrossPref[]; crossCategoryPrefs: CrossCategoryPref[] } {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const crossPrefs: CrossPref[] = []
  const crossCategoryPrefs: CrossCategoryPref[] = []

  // First sheet: category -> line mapping (legacy, for crossPrefs)
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const firstJson = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as any[][]
  if (firstJson.length >= 2) {
    const firstHeaders = firstJson[0].map((h: any) => normCell(h))
    const catIdx = firstHeaders.findIndex(h => h.includes('跨科品类'))
    const lineIdx = firstHeaders.findIndex(h => h.includes('归属线级'))
    for (let i = 1; i < firstJson.length; i++) {
      const row = firstJson[i]
      if (!row) continue
      const category = normalizeCategory(normCell(row[catIdx >= 0 ? catIdx : 0]))
      const lineStr = normCell(row[lineIdx >= 0 ? lineIdx : 1])
      if (!category || !lineStr) continue
      const line = parseLine(lineStr)
      crossPrefs.push({ fromCategory: category, toLine: line, rate: 0 })
    }
  }

  // Find the data sheet with actual cross-rate / LTV records
  let dataSheetName: string | null = null
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
    if (json.length < 2) continue
    const headers = json[0].map((h: any) => normCell(h)).join(' ')
    if (headers.includes('跨科率') && headers.includes('LTV') && headers.includes('公海')) {
      dataSheetName = name
      break
    }
    // Fallback: look for day60 cross-category data pattern
    if (headers.includes('day60') || headers.includes('跨科线索数')) {
      dataSheetName = name
      break
    }
  }

  if (!dataSheetName) {
    return { crossPrefs, crossCategoryPrefs }
  }

  const dataSheet = workbook.Sheets[dataSheetName]
  const json = XLSX.utils.sheet_to_json(dataSheet, { header: 1, defval: '' }) as any[][]
  if (json.length < 2) return { crossPrefs, crossCategoryPrefs }

  const headers = json[0].map((h: any) => normCell(h))
  // Data format: [month, fromCategory, toCategory, totalLeads, day60CrossLeads, firstOrderCount, firstOrderGMV, crossRate, conversionRate, LTV, ...]
  const fromIdx = 1
  const toIdx = 2
  const rateIdx = headers.findIndex(h => h.includes('跨科率_导量') || h.includes('跨科率'))
  const ltvIdx = headers.findIndex(h => h.includes('LTV_导量') || h.includes('LTV'))

  for (let i = 1; i < json.length; i++) {
    const row = json[i]
    if (!row) continue

    const rawFrom = normCell(row[fromIdx])
    const rawTo = normCell(row[toIdx])
    const rate = Number(row[rateIdx >= 0 ? rateIdx : 7] || 0)
    const ltvVal = row[ltvIdx >= 0 ? ltvIdx : 9]
    const ltv = ltvVal === '' || ltvVal === undefined ? 0 : Number(ltvVal)

    if (!rawFrom || !rawTo) continue

    const fromCategory = normalizeCategory(rawFrom)
    const toCategory = normalizeCategory(rawTo)

    crossCategoryPrefs.push({
      fromCategory,
      toCategory,
      toLine: parseLine(toCategory),
      crossRate: isNaN(rate) ? 0 : rate,
      ltv: isNaN(ltv) ? 0 : ltv,
    })

    // Update legacy CrossPref with actual rate
    const existing = crossPrefs.find(p => p.fromCategory === fromCategory && p.toLine === parseLine(toCategory))
    if (existing) {
      existing.rate = Math.max(existing.rate, isNaN(rate) ? 0 : rate)
    } else {
      crossPrefs.push({
        fromCategory,
        toLine: parseLine(toCategory),
        rate: isNaN(rate) ? 0 : rate,
      })
    }
  }

  return { crossPrefs, crossCategoryPrefs }
}

// ====== 5. Unified workbook parser ======
export function parseScheduleWorkbook(buffer: ArrayBuffer, fileName?: string): {
  lives: LiveStream[]
  weekDays: WeekDay[]
  audienceSegments: AudienceSegment[]
  historyRecords: HistoryRecord[]
} {
  const workbook = XLSX.read(buffer, { type: 'array' })

  let lives: LiveStream[] = []
  let weekDays: WeekDay[] = []

  // Parse schedule from the best matching sheet
  const schedulePicked = pickCurrentScheduleSheet(workbook)
  if (schedulePicked) {
    const result = parseScheduleJson(schedulePicked.json, schedulePicked.sheetName, fileName)
    lives = result.lives
    weekDays = result.weekDays
  }

  // Parse audience from audience sheets
  const audienceSheets = pickAudienceSheets(workbook)
  let audienceSegments: AudienceSegment[] = []
  if (audienceSheets.length > 0) {
    audienceSheets.sort((a, b) => b.json.length - a.json.length)
    audienceSegments = parseAudienceJson(audienceSheets[0].json)
  }

  // Fallback: derive audience segments from schedule's own audience assignment rows
  // (for completed schedule files that don't have a separate audience sheet)
  if (audienceSegments.length === 0 && lives.length > 0) {
    const segmentMap = new Map<string, AudienceSegment>()
    for (const live of lives) {
      for (const aud of live.assignedAudiences) {
        const canonicalCat = normalizeCategory(aud.category)
        const correctLine = parseLineFromCategory(canonicalCat)
        const key = `${correctLine}-${canonicalCat}-${aud.timeRange}`
        if (!segmentMap.has(key)) {
          segmentMap.set(key, {
            id: generateId(),
            line: correctLine,
            category: canonicalCat,
            timeRange: aud.timeRange,
            count: aud.count,
            status: 'available',
          })
        } else {
          segmentMap.get(key)!.count += aud.count
        }
      }
    }
    audienceSegments = Array.from(segmentMap.values())
  }

  // Parse history from other schedule sheets
  const historyRecords: HistoryRecord[] = []
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === schedulePicked?.sheetName) continue
    const sheet = workbook.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
    if (!isScheduleSheet(json)) continue
    const sheetHistory = parseHistoryJson(json, sheetName, fileName)
    historyRecords.push(...sheetHistory)
  }

  return { lives, weekDays, audienceSegments, historyRecords }
}

// Internal: parse schedule from already-loaded json
function parseScheduleJson(json: any[][], sheetName?: string, fileName?: string): { lives: LiveStream[]; weekDays: WeekDay[] } {
  const lives: LiveStream[] = []
  const weekDays: WeekDay[] = []

  const headerRowIdx = findHeaderRow(json)
  const dateRowIdx = findDateRow(json, headerRowIdx + 1)

  if (headerRowIdx === -1 || dateRowIdx === -1) return { lives, weekDays }

  const headerRow = json[headerRowIdx] || []
  const dateRow = json[dateRowIdx] || []

  for (let col = 2; col <= 8; col++) {
    const label = normCell(headerRow[col])
    const dateVal = normCell(dateRow[col])
    if (label && dateVal) {
      weekDays.push({ label, date: dateVal, fullDate: buildFullDate(sheetName || '', dateVal, fileName) })
    }
  }

  let currentSlot: SlotType = 'morning'
  let rowIdx = dateRowIdx + 1

  // Store exposure values from the exposure row; applied later only to lives
  // that did not receive audience assignments (completed schedule vs raw schedule)
  const slotDayExposure = new Map<string, number>()

  while (rowIdx < json.length) {
    const row = json[rowIdx]
    if (!row || row.length < 3) { rowIdx++; continue }

    const col0 = normCell(row[0])
    const col1 = normCell(row[1])

    // Detect resource block header and update slot
    if (isBlockHeaderRow(col0)) {
      currentSlot = detectSlot(col0)
    }

    // Skip rows with no day data
    if (!hasDayData(row)) {
      rowIdx++
      continue
    }

    // Skip standalone structural rows
    if (col0 === '星期' || col0 === '日期') {
      rowIdx++
      continue
    }

    // Handle metadata rows
    if (isMetadataRow(col0, col1)) {
      if (col1 === '文案负责人' || col0 === '定时负责人') {
        for (let col = 2; col <= 8; col++) {
          const owner = normCell(row[col])
          if (!owner) continue
          const day = weekDays[col - 2]
          if (!day) continue
          const dayLives = lives.filter(l => l.date === day.date && l.slot === currentSlot)
          dayLives.forEach(l => { if (!l.owner) l.owner = owner })
        }
      } else if (col1 === '曝光量级') {
        for (let col = 2; col <= 8; col++) {
          const raw = normCell(row[col])
          if (!raw) continue
          const exposure = Number(raw.replace(/,/g, ''))
          if (isNaN(exposure)) continue
          const day = weekDays[col - 2]
          if (!day) continue
          slotDayExposure.set(`${currentSlot}-${day.date}`, exposure)
        }
      }
      // Audience rows: handled separately below because they span multiple rows
      rowIdx++
      continue
    }

    // If this is an audience assignment row (should have been caught by isMetadataRow,
    // but handle here just in case it slipped through with col0 being non-empty)
    if (col1 === '健康线' || col1 === '变美线' || col1 === '兴趣线') {
      parseAudienceAssignmentRow(row, weekDays, currentSlot, lives)
      rowIdx++
      continue
    }

    // Collect consecutive live-info rows for this block
    const liveInfoRows: any[][] = []
    let r = rowIdx
    while (r < json.length) {
      const curRow = json[r]
      if (!curRow || curRow.length < 3) { r++; continue }

      const c0 = normCell(curRow[0])
      const c1 = normCell(curRow[1])

      // Stop at next block header (but include it if it's the first row of collection)
      if (isBlockHeaderRow(c0) && r > rowIdx) break

      // Stop at metadata rows
      if (isMetadataRow(c0, c1)) break

      // Skip pure label rows like 【晚间】 that have no day data
      if (c0 === '' && /【.+】/.test(c1) && !hasDayData(curRow)) {
        r++
        continue
      }

      // Must have some day data to be a live-info row
      if (!hasDayData(curRow)) {
        r++
        continue
      }

      liveInfoRows.push(curRow)
      r++
    }

    // Merge and parse each column
    for (let col = 2; col <= 8; col++) {
      const lines: string[] = []
      for (const lr of liveInfoRows) {
        const cell = normCell(lr[col])
        if (cell) lines.push(cell)
      }
      if (lines.length === 0) continue

      const merged = lines.join('\n')
      const day = weekDays[col - 2]
      if (!day) continue

      const parsedLives = parseMergedLiveCell(merged, day, currentSlot)
      lives.push(...parsedLives)
    }

    // After live-info rows, there may be metadata rows before the next block.
    // We already skipped metadata in the outer loop, but if the inner loop
    // ended on a metadata row, we need to let the outer loop process it.
    // Set rowIdx to r so the outer loop handles the next row (which might be metadata).
    rowIdx = r
  }

  // Apply exposure values from the exposure row only to lives that did not
  // receive audience assignments (avoids double-counting in completed schedules)
  for (const live of lives) {
    if (live.assignedAudiences.length > 0) continue
    const key = `${live.slot}-${live.date}`
    const exposure = slotDayExposure.get(key)
    if (exposure !== undefined) {
      live.exposure = exposure
    }
  }

  return { lives, weekDays }
}

function parseAudienceAssignmentRow(row: any[], weekDays: WeekDay[], currentSlot: SlotType, lives: LiveStream[]) {
  const col1 = normCell(row[1])
  const lineKey: LineType = col1 === '健康线' ? 'health' : col1 === '变美线' ? 'beauty' : 'interest'
  for (let col = 2; col <= 8; col++) {
    const cell = normCell(row[col])
    if (!cell) continue
    const day = weekDays[col - 2]
    if (!day) continue
    const dayLives = lives.filter(l => l.date === day.date && l.slot === currentSlot)
    if (dayLives.length === 0) continue

    const audLines = cell.split('\n').map(l => l.trim()).filter(Boolean)
    let currentTimeRange = ''
    for (let i = 0; i < audLines.length; i++) {
      const al = audLines[i]
      if (al.includes('【存量】')) {
        const remainder = al.replace('【存量】', '').trim()
        if (remainder) {
          currentTimeRange = remainder
        } else if (i + 1 < audLines.length) {
          currentTimeRange = audLines[i + 1]
        }
        continue
      }
      if (!currentTimeRange && /年.*—/.test(al)) {
        currentTimeRange = al
        continue
      }
      const match = al.match(/(.+?)[（(](\d+)[）)]/)
      if (match && currentTimeRange) {
        const category = normalizeCategory(match[1].trim())
        const count = parseInt(match[2], 10)
        const targetLive = dayLives.find(l => parseLine(l.name) === lineKey) || dayLives[0]
        if (targetLive) {
          targetLive.assignedAudiences.push({
            segmentId: generateId(),
            line: targetLive.line,
            category,
            timeRange: currentTimeRange,
            count,
          })
          targetLive.exposure += count
        }
      }
    }
  }
}

// Internal: parse audience from already-loaded json
function parseAudienceJson(json: any[][]): AudienceSegment[] {
  const segments: AudienceSegment[] = []
  if (json.length < 4) return segments

  let headerRowIdx = -1
  for (let r = 0; r < Math.min(json.length, 5); r++) {
    const row = json[r]
    if (!row) continue
    const cols = row.map((c: any) => normCell(c))
    if (cols.includes('线') && cols.includes('品类') && cols.includes('用户数')) {
      headerRowIdx = r
      break
    }
  }
  if (headerRowIdx === -1) return segments

  const headerRow = json[headerRowIdx].map((h: any) => normCell(h))

  const timeIndices: number[] = []
  const userCountIndices: number[] = []

  // For each '用户数' column, find the nearest preceding '时间' column
  for (let j = 3; j < headerRow.length; j++) {
    if (headerRow[j] === '用户数') {
      let timeIdx = -1
      for (let i = j - 1; i >= 3; i--) {
        if (headerRow[i] === '时间') {
          timeIdx = i
          break
        }
      }
      if (timeIdx !== -1) {
        timeIndices.push(timeIdx)
        userCountIndices.push(j)
      }
    }
  }

  let currentLine: LineType = 'health'

  for (let r = headerRowIdx + 1; r < json.length; r++) {
    const row = json[r]
    if (!row || row.length < 3) continue

    const lineStr = normCell(row[0])
    const rawCategory = normCell(row[1])
    if (!rawCategory) continue

    if (lineStr) {
      currentLine = parseLine(lineStr)
    } else {
      // Fallback: infer line from category name so empty cells don't inherit the wrong line
      currentLine = parseLineFromCategory(rawCategory)
    }

    const category = normalizeCategory(rawCategory)
    const lineType = currentLine

    for (let g = 0; g < timeIndices.length; g++) {
      const ti = timeIndices[g]
      const ui = userCountIndices[g]
      const timeRange = normCell(row[ti])
      const count = Number(row[ui] || 0)

      if (!timeRange || isNaN(count) || count <= 0) continue
      if (timeRange.startsWith('截止')) continue

      segments.push({
        id: generateId(),
        line: lineType,
        category,
        timeRange,
        count,
        status: 'available',
      })
    }
  }

  return segments
}

// Internal: parse history from already-loaded json
function parseHistoryJson(json: any[][], sheetName: string, fileName?: string): HistoryRecord[] {
  const records: HistoryRecord[] = []
  if (json.length < 4) return records

  const headerRowIdx = findHeaderRow(json)
  const dateRowIdx = findDateRow(json, headerRowIdx + 1)
  if (headerRowIdx === -1 || dateRowIdx === -1) return records

  const dateRow = json[dateRowIdx] || []
  const weekDays: { label: string; date: string; fullDate: string }[] = []
  for (let col = 2; col <= 8; col++) {
    const label = normCell(dateRow[col])
    if (label) weekDays.push({ label, date: label, fullDate: buildFullDate(sheetName, label, fileName) })
  }

  let currentSlot: SlotType = 'morning'

  for (let r = dateRowIdx + 1; r < json.length; r++) {
    const row = json[r]
    if (!row || row.length < 3) continue

    const col0 = normCell(row[0])
    const col1 = normCell(row[1])

    if (col0 && (col0.includes('早间') || col0.includes('晚IP') || col0.includes('晚上') || col0.includes('朋友圈') || col0.includes('视频号') || col0.includes('伪直播') || col0.includes('复用'))) {
      currentSlot = detectSlot(col0)
    }

    if (col1 !== '健康线' && col1 !== '变美线' && col1 !== '兴趣线') continue

    for (let col = 2; col < row.length; col++) {
      const cell = normCell(row[col])
      if (!cell) continue
      const dayIdx = col - 2
      if (dayIdx >= weekDays.length) continue
      const day = weekDays[dayIdx]

      const lines = cell.split('\n').map(l => l.trim()).filter(Boolean)
      let currentTimeRange = ''
      for (let i = 0; i < lines.length; i++) {
        const al = lines[i]
        if (al.includes('【存量】')) {
          const remainder = al.replace('【存量】', '').trim()
          if (remainder) {
            currentTimeRange = remainder
          } else if (i + 1 < lines.length) {
            currentTimeRange = lines[i + 1]
          }
          continue
        }
        if (!currentTimeRange && /年.*—/.test(al)) {
          currentTimeRange = al
          continue
        }
        const match = al.match(/(.+?)[（(](\d+)[）)]/)
        if (match && currentTimeRange) {
          records.push({
            date: day.date,
            liveId: generateId(),
            category: normalizeCategory(match[1].trim()),
            timeRange: currentTimeRange,
            type: 'real',
            slot: currentSlot,
          })
        }
      }
    }
  }

  return records
}
