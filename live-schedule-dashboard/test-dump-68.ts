import * as fs from 'fs'
import * as XLSX from 'xlsx'

const buf = fs.readFileSync('../6.8-14排期.xlsx')
const wb = XLSX.read(buf, { type: 'buffer' })
const sheet = wb.Sheets[wb.SheetNames[0]]
const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]

console.log('Sheet name:', wb.SheetNames[0])
console.log('Total rows:', json.length)
for (let i = 0; i < Math.min(15, json.length); i++) {
  const row = json[i] || []
  console.log(i, row.map((c: any) => String(c).trim()))
}
