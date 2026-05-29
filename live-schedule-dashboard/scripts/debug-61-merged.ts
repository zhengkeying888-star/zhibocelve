import * as XLSX from 'xlsx'
import * as fs from 'fs'

const buf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期.xlsx')
const workbook = XLSX.read(buf, { type: 'array' })

const sheet = workbook.Sheets[workbook.SheetNames[0]]
const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]

// Find the fake-evening block and print row contents for Fri (col 5)
let inFakeEvening = false
for (let i = 0; i < json.length; i++) {
  const row = json[i]
  if (!row) continue
  const c0 = String(row[0] || '').trim()
  if (c0.includes('伪直播') || c0.includes('复用')) {
    inFakeEvening = true
    console.log(`\n=== Block header at row ${i}: ${c0} ===`)
    continue
  }
  if (inFakeEvening && row.length >= 5) {
    const cell = String(row[5] || '').trim() // Friday column
    if (cell) {
      console.log(`Row ${i} col5 [${cell}]`)
      // Test regex matching
      const timeRangeRegex = /^\d{4}[年.].*?[\-~—]\s*\d{4}[年.].*?$/
      const audienceRegex = /^(.+?)[\s:：]*[（(]?([\d,.]+)[）)]?$/
      const lines = cell.split('\n').map((l: string) => l.trim()).filter(Boolean)
      for (const line of lines) {
        const trMatch = timeRangeRegex.test(line)
        const audMatch = line.match(audienceRegex)
        let count: number | null = null
        if (audMatch) {
          count = parseInt(audMatch[2].replace(/,/g, ''), 10)
        }
        console.log(`  line=[${line}] timeRange=${trMatch} audMatch=${!!audMatch} count=${count}`)
      }
    }
    // Stop after a few rows
    if (c0.includes('健康线') || c0.includes('变美线') || c0.includes('兴趣线') || c0.includes('文案') || c0.includes('曝光')) {
      inFakeEvening = false
    }
  }
}
