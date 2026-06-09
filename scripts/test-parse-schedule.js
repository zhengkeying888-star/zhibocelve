const fs = require('fs')
const path = require('path')

// We need to run this via tsx to handle TypeScript imports
// But let's just test the basic xlsx reading first
const XLSX = require('../live-schedule-dashboard/node_modules/xlsx')

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期.xlsx')
const wb = XLSX.read(buf, { type: 'array' })

console.log('Sheet names:', wb.SheetNames)

const sheet = wb.Sheets[wb.SheetNames[0]]
const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

console.log('Total rows:', json.length)

// Check first few rows
for (let i = 0; i < Math.min(15, json.length); i++) {
  const row = json[i]
  if (!row) continue
  console.log(`Row ${i}:`, row.map((c, idx) => `[${idx}]${String(c || '').slice(0, 30)}`).join(' | '))
}
