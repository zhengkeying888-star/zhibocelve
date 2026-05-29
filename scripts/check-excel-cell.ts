import * as fs from 'fs'
import * as path from 'path'
import * as XLSX from 'xlsx'

const xlsxPath = require.resolve('xlsx', { paths: [path.join(__dirname, '../live-schedule-dashboard/node_modules')] })
const XLSXMod = require(xlsxPath)

const buf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期.xlsx'))
const wb = XLSXMod.read(buf, { type: 'array' })

for (const sheetName of wb.SheetNames) {
  const sheet = wb.Sheets[sheetName]
  const json = XLSXMod.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
  console.log(`\n=== Sheet: ${sheetName} ===`)
  for (let r = 0; r < json.length; r++) {
    const row = json[r]
    if (!row) continue
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]
      if (cell && String(cell).includes('普拉提') && String(cell).includes('一杰')) {
        console.log(`Row ${r} Col ${c}: ${JSON.stringify(cell)}`)
      }
    }
  }
}
