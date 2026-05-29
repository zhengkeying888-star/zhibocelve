import * as fs from 'fs'
import * as path from 'path'
// Resolve xlsx from the dashboard's node_modules
const xlsxPath = require.resolve('xlsx', { paths: [path.join(__dirname, '../live-schedule-dashboard/node_modules')] })
const XLSX = require(xlsxPath)

const buf = fs.readFileSync(path.join(__dirname, '../正确排期5.25-31.xlsx'))
const wb = XLSX.read(buf, { type: 'array' })

for (const sheetName of wb.SheetNames) {
  const sheet = wb.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
  console.log(`\n=== Sheet: ${sheetName} ===`)
  for (let r = 0; r < json.length; r++) {
    const row = json[r]
    if (!row) continue
    const line = row.map((c: any) => String(c || '')).join(' | ')
    if (line.includes('君合') || line.includes('太极') || line.includes('气血') || line.includes('健康营养') || line.includes('亚健康') || line.includes('BCD') || line.includes('【存量】')) {
      console.log(`Row ${r}:`, JSON.stringify(row))
    }
  }
}
