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
  AssignedAudience,
} from '@/types'
import { normalizeCategory, parseLineFromCategory } from './categoryMapping'

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

function parseCleanNumber(val: any): number {
  if (typeof val === 'number') return val
  if (!val) return 0
  const cleaned = String(val)
    .replace(/[¥,$\s]/g, '')
    .replace(/,/g, '')
  const num = Number(cleaned)
  return isNaN(num) ? 0 : num
}

function parseLine(lineStr: string): LineType {
  // First try the canonical mapping
  const line = parseLineFromCategory(lineStr)
  if (line) return line

  // Fallback to keyword heuristics for unknown categories
  const s = String(lineStr || '').trim().toLowerCase()
  if (s.includes('健康') || s.includes('五禽戏') || s.includes('睡眠') || s.includes('太极') || s.includes('气血') || s.includes('固气')) return 'health'
  if (s.includes('变美') || s.includes('美容') || s.includes('瑜伽') || s.includes('普拉提') || s.includes('驻颜') || s.includes('吃瘦')) return 'beauty'
  if (s.includes('兴趣') || s.includes('摄影') || s.includes('唱歌') || s.includes('声乐') || s.includes('短视频') || s.includes('朗诵')) return 'interest'
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
  if (s.includes('朗诵')) return '国学朗诵'
  if (s.includes('茶道')) return '茶道'
  if (s.includes('编织') || s.includes('钩针')) return '编织工艺美学'
  if (s.includes('穿搭')) return '穿搭'
  if (s.includes('国画')) return '国画1'
  if (s.includes('声乐')) return '声乐'
  if (s.includes('电子琴') || s.includes('键盘')) return '电子琴'
  if (s.includes('书法')) return '真书法'
  if (s.includes('油画')) return '油画'
  if (s.includes('戏曲')) return '戏曲'
  if (s.includes('舞蹈')) return '舞蹈'
  if (s.includes('易筋经')) return '易筋经'
  if (s.includes('气血')) return '气血调理'
  if (s.includes('固气')) return '固气活血'
  if (s.includes('养生')) return '古法居家养生'
  if (s.includes('食养')) return '健康食养'
  if (s.includes('营养')) return '营养调理'
  if (s.includes('儿童')) return '儿童健康'
  if (s.includes('体态')) return '体态'
  if (s.includes('形体')) return '形体芭蕾'
  if (s.includes('面部')) return '面部瑜伽驻颜'
  if (s.includes('懒人')) return '懒人吃瘦'
  if (s.includes('东方食养')) return '东方食养'
  if (s.includes('亚健')) return '亚健康管理'
  if (s.includes('私域')) return '私域'
  if (s.includes('轻训')) return '轻训营'
  if (s.includes('家厨')) return '健康家厨'
  if (s.includes('养正')) return '东方养正瑜伽'
  if (s.includes('焕醒') || s.includes('晨练')) return '瑜伽'
  if (s.includes('节气')) return '健康营养'
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

function extractFakeHistoryFromCell(lines: string[]): { remainingLines: string[]; fakeAudiences: AssignedAudience[] } {
  const fakeAudiences: AssignedAudience[] = []
  const remainingLines: string[] = []
  let inFakeHistory = false
  let currentTimeRange = ''

  // Match time ranges like: 2026年1月19日—2026年5月3日 / 2026.1.19-2026.5.3 / 2023.1-2025.4.13
  const timeRangeRegex = /(\d{4}[年.].*?[\-~—]\s*\d{4}[年.].*?)/
  // Match audience count: 唱歌（113756） / 唱歌(113756) / 唱歌 113756 / 唱歌:113756 / 唱歌113756
  const audienceRegex = /^(.+?)[\s:：]*[（(]?([\d,.]+)[）)]?$/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('上次') && (line.includes('排期') || line.includes('直播') || line.includes('宣发'))) {
      inFakeHistory = true
      if (i + 1 < lines.length && timeRangeRegex.test(lines[i + 1])) {
        currentTimeRange = lines[i + 1]
        i++
      }
      continue
    }
    if (inFakeHistory) {
      if (timeRangeRegex.test(line)) {
        currentTimeRange = line
        continue
      }
      const match = line.match(audienceRegex)
      if (match && currentTimeRange) {
        const countStr = match[2].replace(/,/g, '')
        const count = parseInt(countStr, 10)
        if (!isNaN(count) && count > 0) {
          fakeAudiences.push({
            segmentId: generateId(),
            line: 'interest',
            category: normalizeCategory(match[1].trim()),
            timeRange: currentTimeRange,
            count,
          })
          continue
        }
      }
      // If line doesn't match audience pattern, exit fake history mode
      inFakeHistory = false
      currentTimeRange = ''
      remainingLines.push(line)
    } else {
      remainingLines.push(line)
    }
  }
  return { remainingLines, fakeAudiences }
}

function parseMergedLiveCell(merged: string, day: WeekDay, slot: SlotType): LiveStream[] {
  const rawLines = merged.split('\n').map(l => l.trim()).filter(Boolean)
  if (rawLines.length === 0) return []

  const { remainingLines: lines, fakeAudiences } = extractFakeHistoryFromCell(rawLines)

  const timeRangeRegex = /(\d{1,2}[：:]\d{2})\s*[-~－]\s*(\d{1,2}[：:]\d{2})/
  const timeIndices: number[] = []
  const liveNames: string[] = []
  const timeMatches: { start: string; end: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (timeRangeRegex.test(line)) {
      timeIndices.push(i)
      const m = line.match(timeRangeRegex)
      if (m) timeMatches.push({ start: m[1].replace('：', ':'), end: m[2].replace('：', ':') })
      continue
    }
    if (
      line.includes('开播时间') ||
      line.includes('预约链接') ||
      line.includes('直播间ID') ||
      line.includes('复用') ||
      line.includes('需剪辑') ||
      line.includes('已有单课id') ||
      line.includes('不回捞') ||
      /^【.+】$/.test(line)
    ) {
      continue
    }
    // Skip Excel time values like 0.291666666666667
    if (/^\d+\.\d+$/.test(line) && parseFloat(line) < 1) {
      continue
    }
    liveNames.push(line)
  }

  // 早间晨练：同单元格多行 = 一场联合直播（PRD v2.0）
  if (slot === 'morning' && liveNames.length > 1) {
    const categories = liveNames.map(name => inferCategory(name.replace('晨练', '').trim()))
    const linesList = categories.map(cat => parseLine(cat))
    const primaryCategory = categories[0]
    const primaryLine = linesList[0]
    const uniqueLines = Array.from(new Set(linesList)) as LineType[]

    const startTime = timeMatches.length > 0 ? timeMatches[0].start : '07:30'
    const endTime = timeMatches.length > 0 ? timeMatches[timeMatches.length - 1].end : '10:00'

    let link = ''
    for (const line of lines) {
      if (line.includes('预约链接') || line.includes('http')) {
        link = extractLink(line)
      }
    }

    return [{
      id: generateId(),
      name: liveNames.join(' + '),
      startTime,
      endTime,
      date: day.date,
      type: 'real',
      category: primaryCategory,
      categories,
      line: primaryLine,
      lines: uniqueLines,
      slot,
      grade: null,
      owner: '',
      link,
      ltv: 80,
      assignedAudiences: fakeAudiences,
      exposure: fakeAudiences.reduce((s, a) => s + a.count, 0),
      conflictReasons: [],
      isRecommended: false,
      isCrossCategory: false,
      isJoint: true,
    }]
  }

  // If multiple time ranges (non-morning), split into multiple lives
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

    if (fakeAudiences.length > 0) {
      const fakeSlot = slot.includes('morning') ? 'fake-morning' : 'fake-evening'
      result.unshift({
        id: generateId(),
        name: '上次直播记录',
        startTime: fakeSlot === 'fake-morning' ? '07:30' : '19:00',
        endTime: fakeSlot === 'fake-morning' ? '09:00' : '21:00',
        date: day.date,
        type: 'fake',
        category: '',
        line: result[0]?.line || 'interest',
        slot: fakeSlot,
        grade: null,
        owner: '',
        link: '',
        ltv: 80,
        assignedAudiences: fakeAudiences,
        exposure: fakeAudiences.reduce((s, a) => s + a.count, 0),
        conflictReasons: [],
        isRecommended: false,
        isCrossCategory: false,
      })
    }
    return result
  }

  // Single live
  let name = liveNames[0] || lines[0]
  // If first name is unrecognizable but a later name is, prefer the recognizable one
  if (liveNames.length > 1 && inferCategory(name) === name) {
    for (let i = 1; i < liveNames.length; i++) {
      if (inferCategory(liveNames[i]) !== liveNames[i]) {
        name = liveNames[i]
        break
      }
    }
  }
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
  const isFake = slot.includes('fake') || name.includes('复用') || name.includes('伪') || fakeAudiences.length > 0

  const results: LiveStream[] = []

  // If the cell contains fake-history audiences, the entire live is treated as fake
  // (pseudo-live reusing historical audience). autoSchedule will preserve its audience.
  if (fakeAudiences.length > 0 || isFake) {
    const fakeSlot = slot.includes('morning') ? 'fake-morning' : 'fake-evening'
    results.push({
      id: generateId(),
      name: name || '上次直播记录',
      startTime: startTime || (fakeSlot === 'fake-morning' ? '07:30' : '19:00'),
      endTime: endTime || (fakeSlot === 'fake-morning' ? '09:00' : '21:00'),
      date: day.date,
      type: 'fake',
      category: name ? inferCategory(name) : '',
      line: lineType || 'interest',
      slot: fakeSlot,
      grade: null,
      owner: '',
      link,
      ltv: 80,
      assignedAudiences: fakeAudiences,
      exposure: fakeAudiences.reduce((s, a) => s + a.count, 0),
      conflictReasons: [],
      isRecommended: false,
      isCrossCategory: false,
    })
    return results
  }

  if (name) {
    results.push({
      id: generateId(),
      name,
      startTime: startTime || (slot.includes('morning') ? '07:30' : '19:00'),
      endTime: endTime || (slot.includes('morning') ? '09:00' : '21:00'),
      date: day.date,
      type: 'real',
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
  }

  return results
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

// Fuzzy header matchers for audience sheets (support various column naming conventions)
const LINE_KEYWORDS = ['线', '线级', '归属线', '线级归属', 'line']
const CATEGORY_KEYWORDS = ['品类', '品类名', '公海品类', '品类名称', 'category', '科目']
const COUNT_KEYWORDS = ['用户数', '人数', '存量', '用户量级', '存量人数', 'count', '人数人', '量级', '用户']
const TIME_KEYWORDS = ['时间', '时间段', '时间范围', '周期', 'time', '时期']

function headerMatches(cols: string[], keywords: string[]): boolean {
  return cols.some((c) => keywords.some((kw) => c.includes(kw)))
}

function isAudienceSheet(sheetJson: any[][]): boolean {
  if (sheetJson.length < 3) return false
  for (let r = 0; r < Math.min(sheetJson.length, 5); r++) {
    const row = sheetJson[r]
    if (!row) continue
    const cols = row.map((c: any) => normCell(c))
    if (headerMatches(cols, LINE_KEYWORDS) && headerMatches(cols, CATEGORY_KEYWORDS) && headerMatches(cols, COUNT_KEYWORDS)) return true
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
  // Data format: [cohortMonth, fromCategory, toCategory, totalLeads, day60CrossLeads, firstOrderCount, firstOrderGMV, crossRate, conversionRate, LTV, ...]
  const fromIdx = 1
  const toIdx = 2

  // Find column indices for live vs guide data
  const crossRateLiveIdx = headers.findIndex(h => h.includes('跨科率_直播间'))
  const crossRateGuideIdx = headers.findIndex(h => h.includes('跨科率_导量'))
  const crossRateGeneralIdx = headers.findIndex(h => h.includes('跨科率'))

  const convRateLiveIdx = headers.findIndex(h => h.includes('转化率_直播间'))
  const convRateGuideIdx = headers.findIndex(h => h.includes('转化率_导量'))
  const convRateGeneralIdx = headers.findIndex(h => h.includes('转化率'))

  const ltvLiveIdx = headers.findIndex(h => h.includes('LTV_直播间'))
  const ltvGuideIdx = headers.findIndex(h => h.includes('LTV_导量'))
  const ltvGeneralIdx = headers.findIndex(h => h.includes('LTV'))

  function parseNumeric(val: any): number {
    if (val === '' || val === undefined || val === null) return NaN
    if (typeof val === 'number') return val
    const s = String(val).trim()
    // Handle percentage strings like "0.30%" or "0.0030%"
    if (s.endsWith('%')) {
      return Number(s.replace('%', '')) / 100
    }
    return Number(s)
  }

  function getNumberValue(row: any[], liveIdx: number, guideIdx: number, generalIdx: number): number {
    if (liveIdx >= 0) {
      const val = parseNumeric(row[liveIdx])
      if (!isNaN(val) && val > 0) return val
    }
    if (guideIdx >= 0) {
      const val = parseNumeric(row[guideIdx])
      if (!isNaN(val) && val > 0) return val
    }
    if (generalIdx >= 0) {
      const val = parseNumeric(row[generalIdx])
      if (!isNaN(val)) return val
    }
    return 0
  }

  function getLtvValue(row: any[], liveIdx: number, guideIdx: number, generalIdx: number): number {
    if (liveIdx >= 0) {
      const val = row[liveIdx]
      const num = parseNumeric(val)
      if (!isNaN(num) && num > 0) return num
    }
    if (guideIdx >= 0) {
      const val = row[guideIdx]
      const num = parseNumeric(val)
      if (!isNaN(num) && num > 0) return num
    }
    if (generalIdx >= 0) {
      const val = row[generalIdx]
      const num = parseNumeric(val)
      if (!isNaN(num)) return num
    }
    return 0
  }

  for (let i = 1; i < json.length; i++) {
    const row = json[i]
    if (!row) continue

    const cohortMonth = normCell(row[0])
    const rawFrom = normCell(row[fromIdx])
    const rawTo = normCell(row[toIdx])

    if (!rawFrom || !rawTo) continue

    const crossRate = getNumberValue(row, crossRateLiveIdx, crossRateGuideIdx, crossRateGeneralIdx)
    const convRate = getNumberValue(row, convRateLiveIdx, convRateGuideIdx, convRateGeneralIdx)
    const ltv = getLtvValue(row, ltvLiveIdx, ltvGuideIdx, ltvGeneralIdx)

    const fromCategory = normalizeCategory(rawFrom)
    const toCategory = normalizeCategory(rawTo)

    crossCategoryPrefs.push({
      fromCategory,
      toCategory,
      toLine: parseLine(toCategory),
      cohortMonth: cohortMonth || 'unknown',
      crossRate: isNaN(crossRate) ? 0 : crossRate,
      conversionRate: isNaN(convRate) ? 0 : convRate,
      ltv: isNaN(ltv) ? 0 : ltv,
    })

    // Update legacy CrossPref with actual rate (use max across cohorts)
    const existing = crossPrefs.find(p => p.fromCategory === fromCategory && p.toLine === parseLine(toCategory))
    if (existing) {
      existing.rate = Math.max(existing.rate, crossRate)
    } else {
      crossPrefs.push({
        fromCategory,
        toLine: parseLine(toCategory),
        rate: crossRate,
      })
    }
  }

  return { crossPrefs, crossCategoryPrefs }
}

// ====== 5. Parse Live Detail Sheet (historical actual outcomes) ======
export function parseLiveDetailSheet(
  buffer: ArrayBuffer
): Record<string, import('@/types').CategoryHistoricalStat> {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
  if (rows.length < 2) return {}

  const headers = rows[0].map((h: any) => normCell(h))
  const nameIdx = headers.findIndex((h) => h.includes('公开课名称') || h.includes('直播名称'))
  const catIdx = headers.findIndex((h) => h === '品类' || h.includes('品类'))
  const statusIdx = headers.findIndex((h) => h.includes('直播状态名称'))
  const isTestIdx = headers.findIndex((h) => h.includes('是否新用户测试直播') || h.includes('新量测试'))
  const gmvIdx = headers.findIndex((h) => h === '总gmv' || h.includes('总gmv'))
  const exposureIdx = headers.findIndex((h) => h.includes('曝光人数'))
  const ratioIdx = headers.findIndex(
    (h) => h.includes('首单贡献占比') || h.includes('单场贡献占比') || h.includes('贡献占比')
  )
  const firstOrdersIdx = headers.findIndex((h) => h.includes('首单订单数'))
  const conversionRateIdx = headers.findIndex((h) => h.includes('首单转化率'))

  // Accumulators per normalized category
  const acc = new Map<
    string,
    { gmvSum: number; exposureSum: number; ratioSum: number; firstOrdersSum: number; conversionRateSum: number; count: number }
  >()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    const name = normCell(row[nameIdx >= 0 ? nameIdx : 1])
    const status = normCell(row[statusIdx >= 0 ? statusIdx : 5])
    const isTest = normCell(row[isTestIdx >= 0 ? isTestIdx : 3])

    // Skip new-user test lives and replay rows
    if (isTest === '是' || status === '回放') continue
    if (!name) continue

    // Prefer explicit category column if present; fallback to inferring from live name
    const rawCategory = catIdx >= 0 ? normCell(row[catIdx]) : ''
    const category = rawCategory ? normalizeCategory(rawCategory) : inferCategory(name)
    if (!category) continue

    const gmv = parseCleanNumber(row[gmvIdx >= 0 ? gmvIdx : -1])
    const exposure = parseCleanNumber(row[exposureIdx >= 0 ? exposureIdx : -1])
    const ratio = parseCleanNumber(row[ratioIdx >= 0 ? ratioIdx : -1])
    const firstOrders = parseCleanNumber(row[firstOrdersIdx >= 0 ? firstOrdersIdx : -1])
    const conversionRate = parseCleanNumber(row[conversionRateIdx >= 0 ? conversionRateIdx : -1])

    const existing = acc.get(category)
    if (existing) {
      existing.gmvSum += gmv
      existing.exposureSum += exposure
      existing.ratioSum += ratio
      existing.firstOrdersSum += firstOrders
      existing.conversionRateSum += conversionRate
      existing.count += 1
    } else {
      acc.set(category, { gmvSum: gmv, exposureSum: exposure, ratioSum: ratio, firstOrdersSum: firstOrders, conversionRateSum: conversionRate, count: 1 })
    }
  }

  const result: Record<string, import('@/types').CategoryHistoricalStat> = {}
  for (const [category, data] of acc.entries()) {
    if (data.count === 0) continue
    result[category] = {
      avgGMV: data.gmvSum / data.count,
      avgExposure: data.exposureSum / data.count,
      avgContributionRatio: data.ratioSum / data.count,
      avgFirstOrders: data.firstOrdersSum / data.count,
      avgConversionRate: data.conversionRateSum / data.count,
      count: data.count,
    }
  }

  console.log('[LiveDetail] Parsed headers:', headers)
  return result
}

// ====== 6. Unified workbook parser ======
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
        const correctLine = parseLineFromCategory(canonicalCat) || 'health'
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
      // Audience assignment rows: collect this row and subsequent rows that
      // belong to the same line block (subsequent rows have empty col0/col1).
      if (col1 === '健康线' || col1 === '变美线' || col1 === '兴趣线') {
        const audienceRows: any[][] = [row]
        let r = rowIdx + 1
        while (r < json.length) {
          const nextRow = json[r]
          if (!nextRow || nextRow.length < 3) { r++; continue }
          const nc0 = normCell(nextRow[0])
          const nc1 = normCell(nextRow[1])
          if (isBlockHeaderRow(nc0)) break
          if (isMetadataRow(nc0, nc1) && (nc1 === '文案负责人' || nc1 === '曝光量级' || nc1 === '健康线' || nc1 === '变美线' || nc1 === '兴趣线')) break
          if (nc0 !== '' || (nc1 !== '' && !/【.+】/.test(nc1))) break
          if (!hasDayData(nextRow)) break
          audienceRows.push(nextRow)
          r++
        }
        parseAudienceAssignmentBlock(audienceRows, weekDays, currentSlot, lives)
        rowIdx = r
        continue
      }

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

function parseAudienceAssignmentBlock(rows: any[][], weekDays: WeekDay[], currentSlot: SlotType, lives: LiveStream[]) {
  if (rows.length === 0) return
  const lineKey: LineType = normCell(rows[0][1]) === '健康线' ? 'health' : normCell(rows[0][1]) === '变美线' ? 'beauty' : 'interest'

  for (let col = 2; col <= 8; col++) {
    const lines: string[] = []
    for (const r of rows) {
      const cell = normCell(r[col])
      if (cell) lines.push(cell)
    }
    if (lines.length === 0) continue
    const merged = lines.join('\n')

    const day = weekDays[col - 2]
    if (!day) continue
    let dayLives = lives.filter(l => l.date === day.date && l.slot === currentSlot)

    const audLines = merged.split('\n').map(l => l.trim()).filter(Boolean)
    let currentTimeRange = ''
    let isFakeHistory = false
    for (let i = 0; i < audLines.length; i++) {
      const al = audLines[i]
      if (al.includes('上次') && (al.includes('排期') || al.includes('直播') || al.includes('宣发'))) {
        isFakeHistory = true
        if (i + 1 < audLines.length && /年.*—/.test(audLines[i + 1])) {
          currentTimeRange = audLines[i + 1]
          i++
        }
        continue
      }
      if (al.includes('【存量】')) {
        isFakeHistory = false
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

        let targetLive
        if (isFakeHistory) {
          targetLive = dayLives.find(l => l.type === 'fake')
          if (!targetLive) {
            targetLive = {
              id: generateId(),
              name: '上次直播记录',
              startTime: currentSlot.includes('morning') ? '07:30' : '19:00',
              endTime: currentSlot.includes('morning') ? '09:00' : '22:00',
              date: day.date,
              type: 'fake',
              category: '',
              line: lineKey,
              slot: currentSlot.includes('morning') ? 'fake-morning' : 'fake-evening',
              grade: null,
              owner: '',
              assignedAudiences: [],
              exposure: 0,
              conflictReasons: [],
              isRecommended: false,
              isCrossCategory: false,
            } as unknown as LiveStream
            lives.push(targetLive)
            dayLives.push(targetLive)
          }
        } else {
          targetLive = dayLives.find(l => parseLine(l.name) === lineKey) || dayLives[0]
        }

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
    if (headerMatches(cols, LINE_KEYWORDS) && headerMatches(cols, CATEGORY_KEYWORDS) && headerMatches(cols, COUNT_KEYWORDS)) {
      headerRowIdx = r
      break
    }
  }
  if (headerRowIdx === -1) return segments

  const headerRow = json[headerRowIdx].map((h: any) => normCell(h))

  const timeIndices: number[] = []
  const userCountIndices: number[] = []

  // For each count column, find the nearest preceding time column
  for (let j = 3; j < headerRow.length; j++) {
    if (COUNT_KEYWORDS.some((kw) => headerRow[j].includes(kw))) {
      let timeIdx = -1
      for (let i = j - 1; i >= 3; i--) {
        if (TIME_KEYWORDS.some((kw) => headerRow[i].includes(kw))) {
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

  for (let r = headerRowIdx + 1; r < json.length; r++) {
    const row = json[r]
    if (!row || row.length < 3) continue

    const rawCategory = normCell(row[1])
    if (!rawCategory) continue

    // Always infer line from the canonical category name.
    // We intentionally ignore the Excel "线" column because it is often empty
    // or copy-pasted incorrectly, which causes cross-line contamination.
    const category = normalizeCategory(rawCategory)
    const lineType = parseLineFromCategory(category) || 'health'

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
