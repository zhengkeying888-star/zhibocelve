import * as XLSX from 'xlsx'
import * as fs from 'fs'

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期.xlsx')
const workbook = XLSX.read(buf, { type: 'array' })

const sheet = workbook.Sheets[workbook.SheetNames[0]]
const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]

console.log('=== All rows with col5 content (Friday) ===')
for (let i = 0; i < json.length; i++) {
  const row = json[i]
  if (!row || row.length < 5) continue
  const c0 = String(row[0] || '').trim()
  const c1 = String(row[1] || '').trim()
  const cell5 = String(row[5] || '').trim()
  if (cell5 || c0.includes('伪') || c0.includes('复用') || c0.includes('健康') || c0.includes('变美') || c0.includes('兴趣')) {
    console.log(`Row ${i} c0=[${c0}] c1=[${c1}] col5=[${cell5.replace(/\n/g, '\\n')}]`)
  }
}
