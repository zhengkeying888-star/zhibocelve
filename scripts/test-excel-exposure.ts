import * as fs from 'fs'
import * as path from 'path'
const XLSX = require('../live-schedule-dashboard/node_modules/xlsx')

const wb = XLSX.readFile(path.join(__dirname, '../正确排期5.25-31.xlsx'))
const ws = wb.Sheets[wb.SheetNames[0]]
const data = XLSX.utils.sheet_to_json(ws, {header:1}) as any[][]

// Find exposure rows and live name rows
const exposureRows: { section: string, row: number, values: Record<number, number> }[] = []
const liveNameRows: { section: string, row: number, values: Record<number, string> }[] = []

let currentSection = ''
for (let r = 0; r < data.length; r++) {
  const row = data[r]
  if (!row) continue
  const col0 = String(row[0] || '').trim()
  const col1 = String(row[1] || '').trim()
  
  if (col0.includes('早间') || col0.includes('晚IP') || col0.includes('伪直播')) {
    currentSection = col0
  }
  if (col1 === '曝光量级') {
    const vals: Record<number, number> = {}
    for (let c = 2; c <= 8; c++) {
      const v = row[c]
      if (v != null && !isNaN(Number(v))) vals[c] = Number(v)
    }
    exposureRows.push({ section: currentSection, row: r, values: vals })
  }
  if (col1 === '直播资源位分布' || col1 === '【晨练】' || col1 === '【晚间】') {
    const vals: Record<number, string> = {}
    for (let c = 2; c <= 8; c++) {
      const v = row[c]
      if (v != null && String(v).trim()) vals[c] = String(v).trim()
    }
    liveNameRows.push({ section: currentSection, row: r, values: vals })
  }
}

console.log('=== Live Names ===')
liveNameRows.forEach(r => {
  console.log(`Section: ${r.section}, Row ${r.row}`)
  Object.entries(r.values).forEach(([c, v]) => console.log(`  Col ${c}: ${v}`))
})

console.log('\n=== Exposure Values ===')
let total = 0
exposureRows.forEach(r => {
  console.log(`Section: ${r.section}, Row ${r.row}`)
  Object.entries(r.values).forEach(([c, v]) => {
    console.log(`  Col ${c}: ${v.toLocaleString()}`)
    total += v
  })
})
console.log(`\n总曝光（曝光量级行合计）: ${total.toLocaleString()}`)
