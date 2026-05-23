import * as fs from 'fs'
import * as path from 'path'
const XLSX = require('../live-schedule-dashboard/node_modules/xlsx')

const wb = XLSX.readFile(path.join(__dirname, '../正确排期5.25-31.xlsx'))
const ws = wb.Sheets[wb.SheetNames[0]]
const data = XLSX.utils.sheet_to_json(ws, {header:1}) as any[][]

// Print first 35 rows
for (let r = 0; r < 35; r++) {
  const row = data[r] || []
  const cells = row.slice(0, 10).map((c, i) => {
    if (c == null) return ''
    const s = String(c).replace(/\n/g, '\\n')
    return s.length > 25 ? s.slice(0, 25) + '...' : s
  })
  if (cells.some(c => c)) {
    console.log(`Row ${r}:`, cells.map((c, i) => `[${i}]${c}`).join(' | '))
  }
}
