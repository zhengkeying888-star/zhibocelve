import * as XLSX from 'xlsx'
import * as fs from 'fs'

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期.xlsx')
const workbook = XLSX.read(buf, { type: 'array' })

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
  console.log(`\n========== Sheet: ${sheetName} ==========`)
  for (let i = 0; i < json.length; i++) {
    const row = json[i]
    if (!row || row.every((c: any) => !c)) continue
    const cells = row.map((c: any, idx: number) => {
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
