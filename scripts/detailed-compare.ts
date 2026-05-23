import * as fs from 'fs'
import * as path from 'path'
import { parseAudienceSheet, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, parseLineFromCategory, getCategoryFamily, isSameCategoryFamily } from '../live-schedule-dashboard/src/utils/categoryMapping'
import type { LiveStream, AudienceSegment, AssignedAudience } from '../live-schedule-dashboard/src/types'

// ====== Parse Human Schedule ======
const XLSX = require('../live-schedule-dashboard/node_modules/xlsx')
const humanWb = XLSX.readFile(path.join(__dirname, '../正确排期5.25-31.xlsx'))
const humanWs = humanWb.Sheets[humanWb.SheetNames[0]]
const humanData = XLSX.utils.sheet_to_json(humanWs, {header:1}) as any[][]

// Parse human schedule audiences per live
interface HumanAssignment {
  date: string
  slot: string
  liveName: string
  line: string
  audiences: { category: string, count: number, timeRange: string, isStock: boolean }[]
  totalExposure: number
}

const humanAssignments: HumanAssignment[] = []
const colToDate = ['', '', '2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30']

// This is complex - let's do a simplified extraction
// For each column (date), find the live name and then extract all audiences below it

// First, build a map of live positions
const liveSlots: { row: number, col: number, name: string, slot: string }[] = []
for (let r = 2; r < 30; r++) {
  for (let c = 2; c <= 7; c++) {
    const val = humanData[r]?.[c]
    if (val && typeof val === 'string' && val.length > 2 && !val.match(/^\d/)) {
      let slot = 'evening'
      if (r <= 5) slot = 'morning'
      if (r >= 75) slot = 'fake-evening'
      liveSlots.push({ row: r, col: c, name: val, slot })
    }
  }
}

console.log('Found live slots:', liveSlots.length)
liveSlots.forEach(l => console.log(l.row, l.col, l.name, l.slot))
