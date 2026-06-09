const XLSX = require('../live-schedule-dashboard/node_modules/xlsx')
const fs = require('fs')

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期.xlsx')
const wb = XLSX.read(buf, { type: 'array' })

const sheet = wb.Sheets[wb.SheetNames[0]]
const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

function normCell(v) {
  if (v === undefined || v === null) return ''
  const s = String(v).trim()
  if (s === 'NaN') return ''
  return s
}

function isWeekDayLabel(v) {
  return /周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun/i.test(v)
}
function isDateValue(v) {
  return /^\d{1,2}[.\/]\d{1,2}$/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v)
}
function isBlockHeaderRow(c0) {
  return !!c0 && (c0.includes('早间') || c0.includes('晚IP') || c0.includes('晚上') || c0.includes('朋友圈') || c0.includes('视频号') || c0.includes('伪直播') || c0.includes('复用'))
}
function hasDayData(row, startCol = 2) {
  return row.slice(startCol, 9).some(c => normCell(c) !== '')
}
function isMetadataRow(c0, c1) {
  return c1 === '文案负责人' || c0 === '定时负责人' || c1 === '曝光量级' || c1 === '健康线' || c1 === '变美线' || c1 === '兴趣线'
}
function isAudienceDataRow(row, startCol = 2) {
  let hasAudiencePattern = false
  let hasNonAudiencePattern = false
  for (let col = startCol; col <= 8; col++) {
    const cell = normCell(row[col])
    if (!cell) continue
    const lines = cell.split('\n').map(l => l.trim()).filter(Boolean)
    for (const line of lines) {
      if (/^\d{4}[年.].*?[\-~—]\s*\d{4}[年.].*?$/.test(line)) {
        hasAudiencePattern = true
        continue
      }
      const match = line.match(/^(.+?)[\s:：]*[（(]?([\d,.]+)[）)]?$/)
      if (match) {
        const count = parseInt(match[2].replace(/,/g, ''), 10)
        if (!isNaN(count) && count > 100) {
          hasAudiencePattern = true
          continue
        }
      }
      hasNonAudiencePattern = true
    }
  }
  return hasAudiencePattern && !hasNonAudiencePattern
}
function detectSlot(resourceName) {
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

function findHeaderRow(json) {
  for (let r = 0; r < Math.min(json.length, 10); r++) {
    for (let c = 0; c < 3; c++) {
      if (normCell(json[r]?.[c]) === '星期') return r
    }
  }
  return -1
}
function findDateRow(json, startFrom) {
  for (let r = startFrom; r < Math.min(json.length, startFrom + 3); r++) {
    for (let c = 0; c < 3; c++) {
      if (normCell(json[r]?.[c]) === '日期') return r
    }
  }
  return -1
}

const headerRowIdx = findHeaderRow(json)
const dateRowIdx = findDateRow(json, headerRowIdx + 1)
const headerRow = json[headerRowIdx] || []
const dateRow = json[dateRowIdx] || []

let startCol = 2
for (let col = 1; col <= 3 && col < headerRow.length; col++) {
  const label = normCell(headerRow[col])
  const dateVal = normCell(dateRow[col])
  if (isWeekDayLabel(label) && (isDateValue(dateVal) || dateVal !== '')) {
    startCol = col
    break
  }
}

const weekDays = []
for (let col = startCol; col < headerRow.length && col <= 8; col++) {
  const label = normCell(headerRow[col])
  const dateVal = normCell(dateRow[col])
  if (label && dateVal) {
    weekDays.push({ label, date: dateVal, fullDate: `2026-06-${String(dateVal).padStart(2,'0')}` })
  }
}

console.log('weekDays:', weekDays.map(d => d.fullDate))
console.log('startCol:', startCol)

// Simplified parseScheduleJson loop
const lives = []
let currentSlot = 'morning'
let rowIdx = dateRowIdx + 1

while (rowIdx < json.length) {
  const row = json[rowIdx]
  if (!row || row.length < 3) { rowIdx++; continue }

  const col0 = normCell(row[0])
  const col1 = normCell(row[1])

  if (isBlockHeaderRow(col0)) {
    currentSlot = detectSlot(col0)
  }

  if (col0 === '星期' || col0 === '日期') { rowIdx++; continue }

  if (!hasDayData(row, startCol)) { rowIdx++; continue }

  if (isMetadataRow(col0, col1)) {
    if (col1 === '健康线' || col1 === '变美线' || col1 === '兴趣线') {
      // Skip audience rows
      let r = rowIdx + 1
      while (r < json.length) {
        const nextRow = json[r]
        if (!nextRow || nextRow.length < 3) { r++; continue }
        const nc0 = normCell(nextRow[0])
        const nc1 = normCell(nextRow[1])
        if (isBlockHeaderRow(nc0)) break
        if (isMetadataRow(nc0, nc1) && (nc1 === '文案负责人' || nc1 === '曝光量级' || nc1 === '健康线' || nc1 === '变美线' || nc1 === '兴趣线')) break
        if (nc0 !== '' || (nc1 !== '' && !/【.+】/.test(nc1))) break
        if (!hasDayData(nextRow, startCol)) break
        r++
      }
      rowIdx = r
      continue
    }
    rowIdx++
    continue
  }

  if (isAudienceDataRow(row, startCol)) {
    rowIdx++
    continue
  }

  // Live info row collection
  const liveInfoRows = []
  let r = rowIdx
  while (r < json.length) {
    const curRow = json[r]
    if (!curRow || curRow.length < 3) { r++; continue }
    const c0 = normCell(curRow[0])
    const c1 = normCell(curRow[1])
    if (isBlockHeaderRow(c0) && r > rowIdx) break
    if (isMetadataRow(c0, c1)) break
    if (c0 === '' && /【.+】/.test(c1) && !hasDayData(curRow, startCol)) { r++; continue }
    if (!hasDayData(curRow, startCol)) { r++; continue }
    if (isAudienceDataRow(curRow, startCol) && r > rowIdx) break
    liveInfoRows.push(curRow)
    r++
  }

  // Parse each column
  for (let col = startCol; col <= 8; col++) {
    const lines = []
    for (const lr of liveInfoRows) {
      const cell = normCell(lr[col])
      if (cell) lines.push(cell)
    }
    if (lines.length === 0) continue
    const day = weekDays[col - startCol]
    if (!day) continue
    lives.push({ name: lines.join('\n'), date: day.fullDate, slot: currentSlot })
  }

  // Skip trailing audience rows
  while (r < json.length) {
    const curRow = json[r]
    if (!curRow || curRow.length < 3) { r++; continue }
    const c0 = normCell(curRow[0])
    const c1 = normCell(curRow[1])
    if (isBlockHeaderRow(c0)) break
    if (isMetadataRow(c0, c1) && (c1 === '文案负责人' || c1 === '曝光量级' || c1 === '健康线' || c1 === '变美线' || c1 === '兴趣线')) break
    if (!isAudienceDataRow(curRow, startCol)) break
    r++
  }

  rowIdx = r
}

console.log('\n=== Parsed lives ===')
for (const l of lives) {
  console.log(`${l.date} ${l.slot}: ${l.name.replace(/\n/g, ' | ')}`)
}
console.log(`\nTotal lives: ${lives.length}`)
