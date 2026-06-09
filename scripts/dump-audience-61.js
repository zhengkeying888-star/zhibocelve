const XLSX = require('../live-schedule-dashboard/node_modules/xlsx')
const fs = require('fs')

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期人数.xlsx')
const wb = XLSX.read(buf, { type: 'array' })

for (const sheetName of wb.SheetNames) {
  const sheet = wb.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  console.log(`\n========== Sheet: ${sheetName} (rows=${json.length}) ==========`)
  for (let i = 0; i < Math.min(json.length, 50); i++) {
    const row = json[i]
    if (!row || row.every(c => !c)) continue
    const cells = row.map((c, idx) => {
      const s = String(c || '').trim()
      if (!s) return ''
      const display = s.length > 60 ? s.slice(0, 60) + '...' : s
      return `[${idx}]${display}`
    }).filter(Boolean)
    if (cells.length > 0) {
      console.log(`Row ${i.toString().padStart(2, '0')}: ${cells.join(' | ')}`)
    }
  }
}
