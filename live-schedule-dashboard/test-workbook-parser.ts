import * as fs from 'fs'
import * as XLSX from 'xlsx'

// Need to import from the dashboard source
const parserPath = '../live-schedule-dashboard/src/utils/parser.ts'

// Since parser.ts imports XLSX and other modules, let's inline the key functions
// or use ts-node with proper paths. Instead, let's just test pickCurrentScheduleSheet
// by replicating its logic.

function normCell(v: any): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function isScheduleSheet(json: any[][]): boolean {
  for (let i = 0; i < Math.min(15, json.length); i++) {
    const row = json[i] || []
    for (let j = 0; j < row.length; j++) {
      const cell = normCell(row[j])
      if (/周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue/i.test(cell)) return true
      if (/直播资源位分布|排期/.test(cell)) return true
    }
  }
  return false
}

function pickCurrentScheduleSheet(workbook: XLSX.WorkBook): { sheetName: string; json: any[][] } | null {
  const candidates: { sheetName: string; json: any[][]; priority: number }[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]
    if (!isScheduleSheet(json)) continue
    if (sheetName.includes('用户量级') || sheetName.includes('各线人数')) continue
    let priority = 0
    if (sheetName.includes('5月')) priority += 100
    else if (sheetName.includes('4月')) priority += 50
    if (sheetName.includes('排期')) priority += 10
    if (sheetName.includes('月度')) priority += 5
    candidates.push({ sheetName, json, priority })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.priority - a.priority)
  return { sheetName: candidates[0].sheetName, json: candidates[0].json }
}

const filePath = process.argv[2] || '../6.8-14排期.xlsx'
const buf = fs.readFileSync(filePath)
const workbook = XLSX.read(buf, { type: 'buffer' })

console.log('Sheet names:', workbook.SheetNames)

const picked = pickCurrentScheduleSheet(workbook)
if (picked) {
  console.log('Picked sheet:', picked.sheetName)
  console.log('First 5 rows:')
  for (let i = 0; i < Math.min(5, picked.json.length); i++) {
    console.log(i, picked.json[i].map((c: any) => normCell(c)))
  }
} else {
  console.log('No schedule sheet found!')
}
