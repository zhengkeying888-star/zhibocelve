import * as XLSX from 'xlsx'
import * as fs from 'fs'

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6月排期【6.1-6.7】确认版.xlsx')
const wb = XLSX.read(buf, { type: 'array' })
const sheet = wb.Sheets[wb.SheetNames[0]]
const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]

function normCell(v: any): string {
  if (v === undefined || v === null) return ''
  const s = String(v).trim()
  if (s === 'NaN') return ''
  return s
}

// Find the 变美线 block rows
let found = false
for (let r = 0; r < json.length; r++) {
  const row = json[r]
  if (!row) continue
  const c1 = normCell(row[1])
  if (c1 === '变美线') {
    found = true
    console.log(`Found 变美线 block at row ${r}`)
    // Collect rows until break condition
    const rows: any[][] = [row]
    let i = r + 1
    while (i < json.length) {
      const nextRow = json[i]
      if (!nextRow || nextRow.length < 3) { i++; continue }
      const nc0 = normCell(nextRow[0])
      const nc1 = normCell(nextRow[1])
      if (nc0 && (nc0.includes('早间') || nc0.includes('晚IP') || nc0.includes('晚上') || nc0.includes('伪直播') || nc0.includes('复用'))) break
      if (nc1 === '文案负责人' || nc1 === '曝光量级' || nc1 === '健康线' || nc1 === '变美线' || nc1 === '兴趣线') break
      if (nc0 !== '' || (nc1 !== '' && !/【.+】/.test(nc1))) break
      const hasData = nextRow.slice(2, 9).some((c: any) => normCell(c) !== '')
      if (!hasData) break
      rows.push(nextRow)
      i++
    }
    console.log(`Collected ${rows.length} rows`)
    for (const row of rows) {
      const cells = row.map((c: any, idx: number) => {
        const s = normCell(c)
        if (!s) return ''
        return `[${idx}]${s.length > 50 ? s.slice(0, 50) + '...' : s}`
      }).filter(Boolean)
      console.log(`  ${cells.join(' | ')}`)
    }

    // Test regex matching for each cell
    const regex = /(.+?)[\(（][\d,.]+[\)）]/
    for (let col = 2; col <= 8; col++) {
      for (const row of rows) {
        const cell = normCell(row[col])
        if (!cell) continue
        const lines = cell.split('\n').map((l: string) => l.trim()).filter(Boolean)
        for (const line of lines) {
          if (line.includes('人数解读错误') || line.includes('数据错了') || line.includes('时间错了')) continue
          const match = line.match(regex)
          if (match) {
            console.log(`  MATCH col=${col}: "${line}" → group1="${match[1].trim()}"`)
          } else {
            console.log(`  NO MATCH col=${col}: "${line}"`)
          }
        }
      }
    }
    break
  }
}
if (!found) console.log('变美线 block not found')
