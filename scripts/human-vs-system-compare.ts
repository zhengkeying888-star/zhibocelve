import * as fs from 'fs'
import * as path from 'path'
import { parseAudienceSheet, parseScheduleWorkbook, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, parseLineFromCategory, getCategoryFamily, isSameCategoryFamily } from '../live-schedule-dashboard/src/utils/categoryMapping'
import { DEFAULT_CATEGORY_GRADES } from '../live-schedule-dashboard/src/lib/defaultCategoryMappings'
import type { LiveStream, AudienceSegment, AssignedAudience } from '../live-schedule-dashboard/src/types'

// ====== Parse Human Schedule ======
const humanBuf = fs.readFileSync(path.join(__dirname, '../正确排期5.25-31.xlsx'))
const humanParsed = parseScheduleWorkbook(humanBuf, '正确排期5.25-31.xlsx')
const humanLives = humanParsed.lives

// Apply grades to human lives
for (const live of humanLives) {
  const canonical = normalizeCategory(live.category || live.name)
  const grade = DEFAULT_CATEGORY_GRADES[canonical] || inferGrade(live.name) || null
  if (grade) live.grade = grade as any
}

// ====== Load System Lives (from feishu-rows-525.json) ======
const livesData = JSON.parse(fs.readFileSync(path.join(__dirname, 'feishu-rows-525.json'), 'utf-8'))
const systemLives: LiveStream[] = livesData.map((r: any, idx: number) => {
  const f = r.fields || r
  const name = f.liveName || ''
  const dateStr = f.date
  const slotMap: Record<string, string> = { '晨练': 'morning', '晚间': 'evening', '伪直播-早': 'fake-morning', '伪直播-晚': 'fake-evening', '朋友圈': 'friend-circle' }
  const slot = slotMap[f.slot] || 'morning'
  const lineMap: Record<string, any> = { '健康线': 'health', '变美线': 'beauty', '兴趣线': 'interest' }
  const line = lineMap[f.line] || 'health'
  const canonical = normalizeCategory(f.category || name)
  const grade = f['直播等级'] || DEFAULT_CATEGORY_GRADES[canonical] || inferGrade(name) || 'C'
  const isJoint = f.isJoint === true || f.isJoint === 'Yes' || name.includes('+')
  const isCrossCategory = f.isCrossCategory === true || f.isCrossCategory === 'Yes'
  let categories: string[] | undefined
  let lines: any[] | undefined
  if (isJoint && name.includes('+')) {
    const parts = name.replace(/【.*?】/g, '').split('+').map((p: string) => p.trim())
    categories = parts.map((p: string) => normalizeCategory(p))
    lines = [...new Set(categories.map(c => parseLineFromCategory(c) || line))]
  }
  return {
    id: `live-${idx}`, name, startTime: slot === 'morning' ? '07:00' : '19:00',
    date: dateStr, type: slot.startsWith('fake') ? 'fake' : 'real',
    category: normalizeCategory(f.category || name), line, slot: slot as any,
    grade: grade as any, owner: f.owner || '', assignedAudiences: [], exposure: 0,
    conflictReasons: [], isCrossCategory, isJoint, categories, lines, target: undefined
  }
})

// ====== Load Audience and Run AutoSchedule ======
const audienceBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期人数.xlsx'))
const audienceSegments = parseAudienceSheet(audienceBuf)

// AutoSchedule Core (same as compare-schedule.ts)
const TARGET_EXPOSURE: Record<string, number> = { S: 600000, A: 500000, B: 350000, C: 250000 }
const MAX_SEGMENTS_BY_GRADE: Record<string, number> = { S: 8, A: 7, B: 5, C: 5 }
const ROUND2_CAP_MULTIPLIER: Record<string, number> = { S: 2.0, A: 1.8, B: 1.5, C: 1.2 }
const NEUTRAL_CATEGORIES = new Set(['一杰瑜伽', '东方养正瑜伽'])
const GRADE_SCORE: Record<string, number> = { S: 100, A: 70, B: 40, C: 20 }

function generateId() { return Math.random().toString(36).substring(2, 10) }
function daysBetween(a: string, b: string): number {
  const d1 = new Date(a), d2 = new Date(b)
  return Math.abs(Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)))
}
function getTarget(live: LiveStream): number {
  return live.target ?? TARGET_EXPOSURE[live.grade || 'C'] ?? 120000
}
function getLiveAllowedLines(live: LiveStream): Array<'health' | 'beauty' | 'interest'> {
  const lines = new Set<'health' | 'beauty' | 'interest'>()
  if (live.isJoint && live.lines && live.lines.length > 0) {
    for (const line of live.lines) lines.add(line)
  } else if (NEUTRAL_CATEGORIES.has(live.category) && live.line === 'beauty') {
    lines.add('beauty')
    lines.add('health')
  } else {
    lines.add(live.line as 'health' | 'beauty' | 'interest')
  }
  const result = Array.from(lines)
  const primaryIdx = result.indexOf(live.line as 'health' | 'beauty' | 'interest')
  if (primaryIdx > 0) { [result[0], result[primaryIdx]] = [result[primaryIdx], result[primaryIdx]] }
  return result
}
function getExcludedCats(live: LiveStream): Set<string> {
  const liveCat = normalizeCategory(live.category)
  if (live.isJoint && live.categories && live.categories.length > 0) {
    return new Set(live.categories.map((c: string) => normalizeCategory(c)))
  }
  if (live.isCrossCategory) return new Set([liveCat])
  return new Set<string>()
}
function isSegmentUnused(seg: AudienceSegment): boolean {
  return !seg.assignedDates || seg.assignedDates.length === 0
}
function isSegmentReusable(seg: AudienceSegment, liveDate: string): boolean {
  if (!seg.assignedDates || seg.assignedDates.length === 0) return false
  const lastAssigned = seg.assignedDates[seg.assignedDates.length - 1]
  return daysBetween(lastAssigned, liveDate) >= 3
}
function isLowWeightLive(live: LiveStream): boolean {
  return live.name.includes('数字人') || live.name.includes('开心太极')
}
function getLowWeightLimit(live: LiveStream): { maxSegments: number; maxExposure: number } | null {
  if (live.name.includes('数字人')) return { maxSegments: 2, maxExposure: 200000 }
  if (live.name.includes('开心太极')) return { maxSegments: 1, maxExposure: 200000 }
  return null
}
function checkConflicts(live: LiveStream, seg: AudienceSegment, allLives: LiveStream[], _historyRecords: any[]): string[] {
  const reasons: string[] = []
  const normSegCat = normalizeCategory(seg.category)
  const recentWeek = allLives.filter(
    (l) =>
      l.id !== live.id &&
      l.type !== 'fake' &&
      l.assignedAudiences.some((a) => normalizeCategory(a.category) === normSegCat && a.timeRange === seg.timeRange) &&
      daysBetween(l.date, live.date) < 3
  )
  if (recentWeek.length > 0) reasons.push(`${seg.category} ${seg.timeRange} 3天内已被触达`)
  const sameDay = allLives.filter(
    (l) =>
      l.id !== live.id &&
      l.type !== 'fake' &&
      l.date === live.date &&
      l.assignedAudiences.some((a) => normalizeCategory(a.category) === normSegCat && a.timeRange === seg.timeRange)
  )
  if (sameDay.length > 0) reasons.push(`${seg.category} ${seg.timeRange} 当日已被分配`)
  return reasons
}
function tryAssign(live: LiveStream, seg: AudienceSegment, allSegments: AudienceSegment[], maxCount?: number, allowReuse: boolean = false): AudienceSegment | null {
  if (seg.status !== 'available' && !allowReuse) return null
  const maxSegs = MAX_SEGMENTS_BY_GRADE[live.grade || 'C'] ?? 2
  if (live.assignedAudiences.length >= maxSegs) return null
  const lowLimit = getLowWeightLimit(live)
  if (lowLimit) {
    if (live.assignedAudiences.length >= lowLimit.maxSegments) return null
    const effectiveMax = Math.min(maxCount ?? seg.count, lowLimit.maxExposure - live.exposure)
    if (effectiveMax <= 0) return null
    maxCount = effectiveMax
  }
  const desiredCount = Math.min(seg.count, maxCount ?? seg.count)
  if (desiredCount <= 0) return null
  if (desiredCount < seg.count * 0.3) return null
  let remaining: AudienceSegment | null = null
  if (desiredCount < seg.count) {
    remaining = {
      id: generateId(), line: seg.line, category: seg.category,
      timeRange: seg.timeRange, count: seg.count - desiredCount,
      status: 'available', assignedDates: seg.assignedDates ? [...seg.assignedDates] : [],
    } as AudienceSegment
    allSegments.push(remaining)
    seg.count = desiredCount
  }
  const assigned: AssignedAudience = {
    segmentId: seg.id, line: seg.line, category: seg.category,
    timeRange: seg.timeRange, count: seg.count,
  }
  live.assignedAudiences.push(assigned)
  live.exposure += seg.count
  if (!allowReuse) {
    seg.status = 'used' as any
    seg.assignedTo = live.id
  }
  if (!seg.assignedDates) seg.assignedDates = []
  seg.assignedDates.push(live.date)
  return remaining
}
function pickBest(live: LiveStream, pool: AudienceSegment[], allLives: LiveStream[], historyRecords: any[], allowReuse: boolean = false): AudienceSegment | null {
  const excludedCats = getExcludedCats(live)
  const assignedCats = new Set(live.assignedAudiences.map((a) => getCategoryFamily(a.category)))
  const assignedCatRanges = new Set(live.assignedAudiences.map((a) => `${normalizeCategory(a.category)}|${a.timeRange}`))
  const assignedRanges = new Set(live.assignedAudiences.map((a) => a.timeRange))
  const eligible = pool.filter((seg) => {
    if (!allowReuse) {
      if (seg.status !== 'available') return false
      if (!isSegmentUnused(seg)) return false
    } else {
      const usable = (seg.status === 'available' && isSegmentUnused(seg)) ||
        (seg.status === 'used' && isSegmentReusable(seg, live.date))
      if (!usable) return false
    }
    if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
    const conflicts = checkConflicts(live, seg, allLives, historyRecords)
    if (conflicts.length > 0) return false
    if (assignedCats.size >= 5 && !assignedCats.has(getCategoryFamily(seg.category))) return false
    if (assignedCatRanges.has(`${normalizeCategory(seg.category)}|${seg.timeRange}`)) return false
    return true
  })
  if (eligible.length === 0) return null
  eligible.sort((a, b) => {
    const aPrimary = a.line === live.line
    const bPrimary = b.line === live.line
    if (aPrimary !== bPrimary) return bPrimary ? 1 : -1
    const aSameFamily = isSameCategoryFamily(a.category, live.category)
    const bSameFamily = isSameCategoryFamily(b.category, live.category)
    if (aSameFamily !== bSameFamily) return bSameFamily ? 1 : -1
    const aDupCat = assignedCats.has(getCategoryFamily(a.category))
    const bDupCat = assignedCats.has(getCategoryFamily(b.category))
    if (aDupCat !== bDupCat) return aDupCat ? 1 : -1
    const aDupRange = assignedRanges.has(a.timeRange)
    const bDupRange = assignedRanges.has(b.timeRange)
    if (aDupRange !== bDupRange) return aDupRange ? 1 : -1
    return b.count - a.count
  })
  return eligible[0]
}
function runAutoSchedule(lives: LiveStream[], segments: AudienceSegment[], historyRecords: any[] = []) {
  const linePools: Record<'health' | 'beauty' | 'interest', AudienceSegment[]> = {
    health: [], beauty: [], interest: [],
  }
  for (const seg of segments) {
    if (linePools[seg.line as 'health' | 'beauty' | 'interest']) {
      linePools[seg.line as 'health' | 'beauty' | 'interest'].push(seg)
    }
  }
  const scored = lives
    .filter((live) => live.slot !== 'friend-circle')
    .map((live) => {
      let score = GRADE_SCORE[live.grade || ''] ?? 10
      if (live.slot === 'evening') score += 50
      else if (live.slot === 'morning') score += 30
      else if (live.slot === 'fake-evening') score += 15
      else if (live.slot === 'fake-morning') score += 10
      else score += 5
      if (live.name.includes('数字人') || live.name.includes('开心太极')) score -= 120
      if (live.grade === 'S') score += 10
      return { live, score }
    })
  scored.sort((a, b) => b.score - a.score)
  const lineGroups: Record<'health' | 'beauty' | 'interest', typeof scored> = {
    health: [], beauty: [], interest: [],
  }
  for (const s of scored) {
    const allowedLines = getLiveAllowedLines(s.live)
    for (const line of allowedLines) {
      if (lineGroups[line]) lineGroups[line].push(s)
    }
  }
  let round1Changed = true, round1Iters = 0
  while (round1Changed && round1Iters < 200) {
    round1Changed = false; round1Iters++
    for (const line of (['health', 'beauty', 'interest'] as const)) {
      for (const { live } of lineGroups[line]) {
        const target = getTarget(live)
        if (live.exposure >= target) continue
        const allowedLines = getLiveAllowedLines(live)
        const primaryLine = live.line as 'health' | 'beauty' | 'interest'
        const linesToTry = live.isJoint && allowedLines.includes(line)
          ? [line, ...allowedLines.filter(l => l !== line)]
          : allowedLines.includes(primaryLine)
            ? [primaryLine, ...allowedLines.filter(l => l !== primaryLine)]
            : allowedLines
        for (const tryLine of linesToTry) {
          const best = pickBest(live, linePools[tryLine], lives, historyRecords)
          if (best) {
            const maxCount = Math.max(0, target - live.exposure)
            const beforeCount = live.assignedAudiences.length
            const remaining = tryAssign(live, best, segments, maxCount > 0 ? maxCount : undefined)
            if (live.assignedAudiences.length !== beforeCount) {
              const idx = linePools[tryLine].indexOf(best)
              if (idx !== -1) linePools[tryLine].splice(idx, 1)
              if (remaining) linePools[remaining.line as 'health' | 'beauty' | 'interest'].push(remaining)
              round1Changed = true
              break
            }
          }
        }
      }
    }
  }
  let round2Changed = true, round2Iters = 0
  while (round2Changed && round2Iters < 200) {
    round2Changed = false; round2Iters++
    for (const { live } of scored) {
      const target = getTarget(live)
      const cap = target * (ROUND2_CAP_MULTIPLIER[live.grade || 'C'] ?? 1.5)
      if (live.exposure >= cap) continue
      const allowedLines = getLiveAllowedLines(live)
      const primaryLine = live.line as 'health' | 'beauty' | 'interest'
      const linesToTry = allowedLines.includes(primaryLine)
        ? [primaryLine, ...allowedLines.filter(l => l !== primaryLine)]
        : allowedLines
      for (const line of linesToTry) {
        const best = pickBest(live, linePools[line], lives, historyRecords, true)
        if (best) {
          const beforeCount = live.assignedAudiences.length
          const maxCount = Math.max(0, cap - live.exposure)
          const remaining = tryAssign(live, best, segments, maxCount > 0 ? maxCount : undefined, true)
          if (live.assignedAudiences.length !== beforeCount) {
            const idx = linePools[line].indexOf(best)
            if (idx !== -1) linePools[line].splice(idx, 1)
            if (remaining) linePools[remaining.line as 'health' | 'beauty' | 'interest'].push(remaining)
            round2Changed = true
            break
          }
        }
      }
    }
  }
  let round3Changed = true, round3Iters = 0
  while (round3Changed && round3Iters < 200) {
    round3Changed = false; round3Iters++
    const sorted = [...scored].sort((a, b) => b.score - a.score)
    for (const { live } of sorted) {
      const allowedLines = getLiveAllowedLines(live)
      const primaryLine = live.line as 'health' | 'beauty' | 'interest'
      const linesToTry = allowedLines.includes(primaryLine)
        ? [primaryLine, ...allowedLines.filter(l => l !== primaryLine)]
        : allowedLines
      for (const line of linesToTry) {
        const best = pickBest(live, linePools[line], lives, historyRecords, true)
        if (best) {
          const beforeCount = live.assignedAudiences.length
          const remaining = tryAssign(live, best, segments, undefined, true)
          if (live.assignedAudiences.length !== beforeCount) {
            const idx = linePools[line].indexOf(best)
            if (idx !== -1) linePools[line].splice(idx, 1)
            if (remaining) linePools[remaining.line as 'health' | 'beauty' | 'interest'].push(remaining)
            round3Changed = true
            break
          }
        }
      }
    }
  }
  return { scored, linePools, round1Iters, round2Iters, round3Iters }
}

const testSegments = audienceSegments.map(s => ({ ...s, status: 'available' as const, assignedTo: undefined as string | undefined, assignedDates: [] as string[] }))
const result = runAutoSchedule(systemLives, testSegments)

// ====== Build comparison with fuzzy matching ======
function normalizeName(name: string): string {
  return name.replace(/【.*?】/g, '').replace(/\s+/g, '').toLowerCase()
}

function normalizeDate(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const day = parseInt(date, 10)
  if (!isNaN(day) && day >= 1 && day <= 31) return `2026-05-${String(day).padStart(2, '0')}`
  return date
}
function matchKey(live: LiveStream): string {
  return `${normalizeDate(live.date)}|${live.slot}`
}

// Group by date+slot
const humanBySlot = new Map<string, LiveStream[]>()
for (const live of humanLives) {
  const key = matchKey(live)
  if (!humanBySlot.has(key)) humanBySlot.set(key, [])
  humanBySlot.get(key)!.push(live)
}

const systemBySlot = new Map<string, LiveStream[]>()
for (const { live } of result.scored) {
  const key = matchKey(live)
  if (!systemBySlot.has(key)) systemBySlot.set(key, [])
  systemBySlot.get(key)!.push(live)
}

const allSlots = new Set([...humanBySlot.keys(), ...systemBySlot.keys()])
const sortedSlots = Array.from(allSlots).sort()

console.log('\n========== 人工排期 vs 系统排期 对比（按日期+时段） ==========\n')
console.log('日期'.padEnd(12), '时段'.padEnd(12), '类型'.padEnd(8), '直播名'.padEnd(28), '等级'.padEnd(6), '人工曝光'.padEnd(10), '系统曝光'.padEnd(10), '差异'.padEnd(10), '人工段'.padEnd(8), '系统段'.padEnd(8))
console.log('-'.repeat(140))

let totalHuman = 0, totalSystem = 0
for (const slotKey of sortedSlots) {
  const hLives = humanBySlot.get(slotKey) || []
  const sLives = systemBySlot.get(slotKey) || []
  const maxLen = Math.max(hLives.length, sLives.length)
  for (let i = 0; i < maxLen; i++) {
    const h = hLives[i]
    const s = sLives[i]
    const date = h?.date || s?.date || slotKey.split('|')[0]
    const slot = h?.slot || s?.slot || slotKey.split('|')[1]
    const name = h?.name || s?.name || ''
    const type = h?.type || s?.type || ''
    const grade = h?.grade || s?.grade || ''
    const hExp = h?.exposure || 0
    const sExp = s?.exposure || 0
    const hSegs = h?.assignedAudiences?.length || 0
    const sSegs = s?.assignedAudiences?.length || 0
    totalHuman += hExp
    totalSystem += sExp
    const diff = sExp - hExp
    const diffStr = diff > 0 ? `+${diff.toLocaleString()}` : (diff < 0 ? diff.toLocaleString() : '-')
    const flag = !h ? '[仅系统]' : !s ? '[仅人工]' : Math.abs(diff) > 100000 ? '[大差]' : ''
    console.log(
      date.padEnd(12),
      slot.padEnd(12),
      type.padEnd(8),
      name.slice(0, 26).padEnd(28),
      String(grade).padEnd(6),
      (h ? hExp.toLocaleString() : '-').padEnd(10),
      (s ? sExp.toLocaleString() : '-').padEnd(10),
      diffStr.padEnd(10),
      (h ? String(hSegs) : '-').padEnd(8),
      (s ? String(sSegs) : '-').padEnd(8),
      flag
    )
  }
}
console.log('-'.repeat(140))
console.log('总计'.padEnd(60), totalHuman.toLocaleString().padEnd(10), totalSystem.toLocaleString().padEnd(10), (totalSystem - totalHuman).toLocaleString().padEnd(10))

// Detailed comparison for slots that exist in both
console.log('\n========== 同时段详细对比 ==========\n')
for (const slotKey of sortedSlots) {
  const hLives = humanBySlot.get(slotKey) || []
  const sLives = systemBySlot.get(slotKey) || []
  if (hLives.length === 0 || sLives.length === 0) continue

  for (const h of hLives) {
    // Find best matching system live by normalized name
    let bestS: LiveStream | undefined
    let bestScore = -1
    for (const s of sLives) {
      const hNorm = normalizeName(h.name)
      const sNorm = normalizeName(s.name)
      let score = 0
      if (hNorm === sNorm) score = 100
      else if (hNorm.includes(sNorm) || sNorm.includes(hNorm)) score = 50
      else {
        const hCats = hNorm.split(/[+xX×]/)
        const sCats = sNorm.split(/[+xX×]/)
        const match = hCats.filter(c => sCats.some(sc => sc.includes(c) || c.includes(sc))).length
        score = match * 20
      }
      if (score > bestScore) { bestScore = score; bestS = s }
    }
    if (!bestS || bestScore < 20) continue

    const diff = bestS.exposure - h.exposure
    if (Math.abs(diff) < 30000 && h.assignedAudiences.length === bestS.assignedAudiences.length) continue

    console.log(`\n--- ${h.date} ${h.slot} ---`)
    console.log(`人工: ${h.name} (等级:${h.grade}) 曝光:${h.exposure.toLocaleString()} 段数:${h.assignedAudiences.length}`)
    console.log(`系统: ${bestS.name} (等级:${bestS.grade}) 曝光:${bestS.exposure.toLocaleString()} 段数:${bestS.assignedAudiences.length} 差异:${diff > 0 ? '+' : ''}${diff.toLocaleString()}`)
    if (h.assignedAudiences.length > 0) {
      console.log('人工分配:')
      h.assignedAudiences.forEach(a => console.log(`  ${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`))
    }
    if (bestS.assignedAudiences.length > 0) {
      console.log('系统分配:')
      bestS.assignedAudiences.forEach(a => console.log(`  ${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`))
    }
  }
}

console.log('\n')
