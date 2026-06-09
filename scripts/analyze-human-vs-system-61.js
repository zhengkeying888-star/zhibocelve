const XLSX = require('../live-schedule-dashboard/node_modules/xlsx')
const fs = require('fs')

// ===== Parse Human Schedule =====
const humanBuf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6月排期【6.1-6.7】确认版.xlsx')
const humanWb = XLSX.read(humanBuf, { type: 'array' })
const sheet = humanWb.Sheets[humanWb.SheetNames[0]]
const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

const colToDate = { 2: '2026-06-01', 3: '2026-06-02', 4: '2026-06-03', 5: '2026-06-04', 6: '2026-06-05', 7: '2026-06-06', 8: '2026-06-07' }
const colToDay = { 2: '周一(1)', 3: '周二(2)', 4: '周三(3)', 5: '周四(4)', 6: '周五(5)', 7: '周六(6)', 8: '周日(7)' }

// Parse the human schedule block by block
// Structure: each live has: name row, time row, owner row, exposure row, then line blocks

const humanLives = []

function extractAudiences(startRow, endRow) {
  const audiences = []
  let currentLine = null
  for (let r = startRow; r < endRow; r++) {
    const row = json[r] || []
    const lineCell = String(row[1] || '').trim()
    if (lineCell === '健康线') { currentLine = 'health'; continue }
    if (lineCell === '变美线') { currentLine = 'beauty'; continue }
    if (lineCell === '兴趣线') { currentLine = 'interest'; continue }
    if (!currentLine) continue
    for (let c = 2; c <= 8; c++) {
      const cell = String(row[c] || '').trim()
      if (!cell) continue
      // Parse patterns like "太极A(106104)" or "太极A（106104）" or "2026年... 太极A(106104)"
      // Also handle "人数解读错误" annotations
      if (cell.includes('人数解读错误') || cell.includes('数据错了') || cell.includes('时间错了')) continue
      if (cell.includes('【存量】')) {
        // May contain date + category + count in same cell
        const m = cell.match(/(.+?)\s*（\s*([\d,]+)\s*）/)
        if (m) {
          const cat = m[1].replace(/【存量】/g, '').trim().replace(/^\d{4}年.+?日\s*/, '')
          const count = parseInt(m[2].replace(/,/g, ''), 10)
          audiences.push({ line: currentLine, category: cat, count, raw: cell })
        } else {
          // Just a date row or annotation, skip
        }
        continue
      }
      // Check if cell is just a date range
      if (/^\d{4}年/.test(cell) && !cell.includes('(') && !cell.includes('（')) continue
      // Extract category and count
      const m1 = cell.match(/^(.+?)\s*[\(（]\s*([\d,]+)\s*[\)）]$/)
      if (m1) {
        const cat = m1[1].trim()
        const count = parseInt(m1[2].replace(/,/g, ''), 10)
        audiences.push({ line: currentLine, category: cat, count, raw: cell })
        continue
      }
      // Cell with date prefix and category+count on same line
      const m2 = cell.match(/\d{4}年.+?日\s*(.+?)\s*[\(（]\s*([\d,]+)\s*[\)）]/)
      if (m2) {
        const cat = m2[1].trim()
        const count = parseInt(m2[2].replace(/,/g, ''), 10)
        audiences.push({ line: currentLine, category: cat, count, raw: cell })
        continue
      }
      // Just count like "285471" in exposure row
      if (/^\d+$/.test(cell.replace(/,/g, ''))) continue
    }
  }
  return audiences
}

// Manually define live blocks based on observed structure
const liveBlocks = [
  // Morning
  { name: '普拉提晨练', slot: 'morning', date: '2026-06-02', exposureRow: 7, audStart: 8, audEnd: 23, col: 3 },
  { name: '君合太极晨练', slot: 'morning', date: '2026-06-03', exposureRow: 7, audStart: 8, audEnd: 23, col: 4 },
  { name: '东方养正瑜伽晨练+五禽戏晨练', slot: 'morning', date: '2026-06-04', exposureRow: 7, audStart: 8, audEnd: 23, col: 5 },
  { name: '睡眠调理晨练', slot: 'morning', date: '2026-06-05', exposureRow: 7, audStart: 8, audEnd: 23, col: 6 },
  // Evening
  { name: '健康食养助教-禾昀', slot: 'evening', date: '2026-06-01', exposureRow: 26, audStart: 27, audEnd: 38, col: 2 },
  { name: '中医变美IP-石今如', slot: 'evening', date: '2026-06-02', exposureRow: 26, audStart: 27, audEnd: 38, col: 3 },
  { name: '懒人吃瘦【IP田珂单人】-节气栏目', slot: 'evening', date: '2026-06-03', exposureRow: 26, audStart: 27, audEnd: 52, col: 4 },
  { name: '手摄大赛悟空（本地单人）', slot: 'evening', date: '2026-06-04', exposureRow: 26, audStart: 27, audEnd: 52, col: 5 },
  { name: '开心太极-IP刘海涛', slot: 'evening', date: '2026-06-05', exposureRow: 26, audStart: 27, audEnd: 52, col: 6 },
  // Second evening
  { name: '数字人-懒人吃瘦', slot: 'evening', date: '2026-06-05', exposureRow: 55, audStart: 56, audEnd: 65, col: 5 },
  { name: '数字人-开心太极', slot: 'evening', date: '2026-06-05', exposureRow: 55, audStart: 56, audEnd: 65, col: 6 },
  // Fake evening
  { name: '风光摄影耿春晖', slot: 'fake-evening', date: '2026-06-05', exposureRow: 67, audStart: 68, audEnd: 86, col: 5 },
  { name: '健康营养王溪', slot: 'fake-evening', date: '2026-06-06', exposureRow: 67, audStart: 68, audEnd: 86, col: 6 },
  { name: '普拉提', slot: 'fake-evening', date: '2026-06-07', exposureRow: 67, audStart: 68, audEnd: 86, col: 7 },
  { name: '摄影美学-段晓晖', slot: 'fake-evening', date: '2026-06-06', exposureRow: 90, audStart: 91, audEnd: 98, col: 6 },
]

for (const block of liveBlocks) {
  const row = json[block.exposureRow] || []
  const exposure = parseInt(String(row[block.col] || '0').replace(/,/g, ''), 10)
  const audiences = []
  let currentLine = null
  for (let r = block.audStart; r < block.audEnd && r < json.length; r++) {
    const rowData = json[r] || []
    const lineCell = String(rowData[1] || '').trim()
    if (lineCell === '健康线') { currentLine = 'health'; continue }
    if (lineCell === '变美线') { currentLine = 'beauty'; continue }
    if (lineCell === '兴趣线') { currentLine = 'interest'; continue }
    if (!currentLine) continue
    const cell = String(rowData[block.col] || '').trim()
    if (!cell) continue
    if (cell.includes('人数解读错误') || cell.includes('数据错了') || cell.includes('时间错了')) continue
    if (cell.includes('【存量】')) {
      const m = cell.match(/(.+?)\s*（\s*([\d,]+)\s*）/)
      if (m) {
        const cat = m[1].replace(/【存量】/g, '').trim().replace(/^\d{4}年.+?日\s*/, '')
        const count = parseInt(m[2].replace(/,/g, ''), 10)
        audiences.push({ line: currentLine, category: cat, count })
      }
      continue
    }
    if (/^\d{4}年/.test(cell) && !cell.includes('(') && !cell.includes('（')) continue
    const m1 = cell.match(/^(.+?)\s*[\(（]\s*([\d,]+)\s*[\)）]$/)
    if (m1) {
      audiences.push({ line: currentLine, category: m1[1].trim(), count: parseInt(m1[2].replace(/,/g, ''), 10) })
      continue
    }
    const m2 = cell.match(/\d{4}年.+?日\s*(.+?)\s*[\(（]\s*([\d,]+)\s*[\)）]/)
    if (m2) {
      audiences.push({ line: currentLine, category: m2[1].trim(), count: parseInt(m2[2].replace(/,/g, ''), 10) })
      continue
    }
  }
  const totalExposure = audiences.reduce((s, a) => s + a.count, 0)
  humanLives.push({ ...block, audiences, totalExposure, declaredExposure: exposure })
}

// ===== Parse System Schedule =====
const sysText = fs.readFileSync('/Users/zhengkeying/直播间排期策略/scripts/output-61-v3.txt', 'utf-8')
const sysLives = []
const blocks = sysText.split(/\n(?=\d+\s+(?:evening|morning|fake-evening|fake-morning))/)
for (const block of blocks) {
  const lines = block.trim().split('\n')
  if (lines.length < 2) continue
  const headerMatch = lines[0].match(/(\S+)\s+(\S+)\s+(.+?)\s+\(等级:(\S)\)\s+目标:([\d,]+)/)
  if (!headerMatch) continue
  const [_, dateStr, slot, name, grade, target] = headerMatch
  const audiences = []
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('上周记录') || line.startsWith('总库存')) break
    const m = line.match(/(\S+)\s+(.+?)\(([\d,]+)\)\s+(.+)/)
    if (m) {
      audiences.push({ line: m[1], category: m[2], count: parseInt(m[3].replace(/,/g, ''), 10), timeRange: m[4] })
    }
  }
  const totalExposure = audiences.reduce((s, a) => s + a.count, 0)
  sysLives.push({ date: dateStr, slot, name: name.trim(), grade, target: parseInt(target.replace(/,/g, ''), 10), audiences, totalExposure })
}

// ===== Comparison =====
console.log('\n========== 人工 vs 系统排期 差异对比 ==========\n')

const sysMap = new Map()
for (const s of sysLives) {
  const key = `${s.date}|${s.slot}|${s.name}`
  sysMap.set(key, s)
}

for (const h of humanLives) {
  // Find matching system live by fuzzy name + date + slot
  let s = sysMap.get(`${h.date}|${h.slot}|${h.name}`)
  if (!s) {
    // Fuzzy match
    for (const [key, val] of sysMap) {
      const [d, sl, n] = key.split('|')
      if (d === h.date && sl === h.slot) {
        const hNorm = h.name.replace(/【.*?】/g, '').replace(/-IP.*/g, '').replace(/助教.*/g, '').trim()
        const sNorm = n.replace(/【.*?】/g, '').replace(/-IP.*/g, '').trim()
        if (hNorm.includes(sNorm) || sNorm.includes(hNorm) || (hNorm.includes('太极') && sNorm.includes('太极')) || (hNorm.includes('摄影') && sNorm.includes('摄影')) || (hNorm.includes('普拉提') && sNorm.includes('普拉提'))) {
          s = val
          break
        }
      }
    }
  }

  console.log(`\n--- ${h.date} ${h.slot} ${h.name} ---`)
  console.log(`  人工: 曝光=${h.totalExposure.toLocaleString()} 段数=${h.audiences.length} (表显=${h.declaredExposure.toLocaleString()})`)
  if (s) {
    console.log(`  系统: 曝光=${s.totalExposure.toLocaleString()} 段数=${s.audiences.length} 目标=${s.target.toLocaleString()}`)
    const diff = s.totalExposure - h.totalExposure
    console.log(`  差异: ${diff > 0 ? '+' : ''}${diff.toLocaleString()}`)
  } else {
    console.log(`  系统: [未找到匹配]`)
  }

  // Show audiences side by side
  if (s) {
    const hCats = h.audiences.map(a => `${a.line} ${a.category}(${a.count.toLocaleString()})`)
    const sCats = s.audiences.map(a => `${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
    console.log('  人工分配:')
    hCats.forEach(c => console.log(`    ${c}`))
    console.log('  系统分配:')
    sCats.forEach(c => console.log(`    ${c}`))
  }
}

// Check system-only lives
console.log('\n========== 仅系统排期有的场次 ==========\n')
const humanKeys = new Set(humanLives.map(h => `${h.date}|${h.slot}`))
for (const s of sysLives) {
  const key = `${s.date}|${s.slot}`
  if (!humanKeys.has(key)) {
    console.log(`${s.date} ${s.slot} ${s.name} 曝光=${s.totalExposure.toLocaleString()}`)
  }
}

// Summary
console.log('\n========== 汇总 ==========')
const humanTotal = humanLives.reduce((s, h) => s + h.totalExposure, 0)
const sysTotal = sysLives.reduce((s, l) => s + l.totalExposure, 0)
console.log(`人工总触达: ${humanTotal.toLocaleString()}`)
console.log(`系统总触达: ${sysTotal.toLocaleString()}`)
console.log(`差异: ${sysTotal - humanTotal > 0 ? '+' : ''}${(sysTotal - humanTotal).toLocaleString()}`)
