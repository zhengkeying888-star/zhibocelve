import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook, parseAudienceSheet, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, parseLineFromCategory, getCategoryFamily, isSameCategoryFamily } from '../live-schedule-dashboard/src/utils/categoryMapping'
import { DEFAULT_CATEGORY_GRADES } from '../live-schedule-dashboard/src/lib/defaultCategoryMappings'
import type { LiveStream, AudienceSegment, AssignedAudience } from '../live-schedule-dashboard/src/types'

const sysBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期.xlsx'))
const sysParsed = parseScheduleWorkbook(sysBuf, '5月25-31日直播排期.xlsx')
let sysLives = sysParsed.lives.map(l => ({
  ...l,
  assignedAudiences: [] as AssignedAudience[],
  exposure: 0,
  conflictReasons: [] as string[],
  grade: inferGrade(l.name) || l.grade || DEFAULT_CATEGORY_GRADES[normalizeCategory(l.category)] || 'C',
}))

const humanBuf = fs.readFileSync(path.join(__dirname, '../正确排期5.25-31.xlsx'))
const humanParsed = parseScheduleWorkbook(humanBuf, '正确排期5.25-31.xlsx')
const humanLives = humanParsed.lives

const audBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期人数.xlsx'))
const audienceSegments = parseAudienceSheet(audBuf)

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
  if (primaryIdx > 0) { [result[0], result[primaryIdx]] = [result[primaryIdx], result[0]] }
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
  return live.name.includes('数字人') || live.name.includes('录播') || live.name.includes('开心太极')
}
function getLowWeightLimit(live: LiveStream): { maxSegments: number; maxExposure: number } | null {
  if (isLowWeightLive(live)) return { maxSegments: 1, maxExposure: 200000 }
  return null
}

function checkConflicts(live: LiveStream, seg: AudienceSegment, allLives: LiveStream[]): string[] {
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
  const assignedNormCats = new Set(live.assignedAudiences.map((a) => normalizeCategory(a.category)))
  const segNormCat = normalizeCategory(seg.category)
  if (!assignedNormCats.has(segNormCat) && assignedNormCats.size >= maxSegs) return null

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
      id: generateId(), line: seg.line, category: seg.category, timeRange: seg.timeRange,
      count: seg.count - desiredCount, status: 'available',
      assignedDates: seg.assignedDates ? [...seg.assignedDates] : [],
    } as AudienceSegment
    allSegments.push(remaining)
    seg.count = desiredCount
  }

  if (!allowReuse && seg.assignedTo && seg.assignedTo !== live.id) {
    const fromLive = sysLives.find((l) => l.id === seg.assignedTo)
    if (fromLive) {
      const idx = fromLive.assignedAudiences.findIndex((a) => a.segmentId === seg.id)
      if (idx !== -1) {
        fromLive.exposure -= fromLive.assignedAudiences[idx].count
        fromLive.assignedAudiences.splice(idx, 1)
      }
      if (seg.assignedDates) seg.assignedDates = seg.assignedDates.filter((d) => d !== fromLive.date)
    }
  }

  const conflicts = checkConflicts(live, seg, sysLives)
  const assigned: AssignedAudience = {
    segmentId: seg.id, line: seg.line, category: seg.category, timeRange: seg.timeRange, count: seg.count,
  }
  live.assignedAudiences.push(assigned)
  live.exposure += seg.count
  if (!allowReuse) { seg.status = 'used' as any; seg.assignedTo = live.id }
  if (!seg.assignedDates) seg.assignedDates = []
  seg.assignedDates.push(live.date)
  live.conflictReasons.push(...conflicts)
  return remaining
}

function tryAssignMergeSweep(live: LiveStream, seedSeg: AudienceSegment, pool: AudienceSegment[], maxCount?: number, allowReuse: boolean = false): { assigned: AudienceSegment[]; remaining: AudienceSegment[] } {
  const assigned: AudienceSegment[] = []
  const remaining: AudienceSegment[] = []
  const seedNorm = normalizeCategory(seedSeg.category)
  const excludedCats = getExcludedCats(live)
  const assignedCats = new Set(live.assignedAudiences.map((a) => getCategoryFamily(a.category)))
  const assignedCatRanges = new Set(live.assignedAudiences.map((a) => `${normalizeCategory(a.category)}|${a.timeRange}`))

  const mergeable = pool.filter((seg) => {
    if (seg.id === seedSeg.id) return false
    if (normalizeCategory(seg.category) !== seedNorm) return false
    if (!allowReuse) {
      if (seg.status !== 'available') return false
      if (!isSegmentUnused(seg)) return false
    } else {
      const usable = (seg.status === 'available' && isSegmentUnused(seg)) || (seg.status === 'used' && isSegmentReusable(seg, live.date))
      if (!usable) return false
    }
    if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
    if (checkConflicts(live, seg, sysLives).length > 0) return false
    if (assignedCats.size >= 5 && !assignedCats.has(getCategoryFamily(seg.category))) return false
    if (assignedCatRanges.has(`${normalizeCategory(seg.category)}|${seg.timeRange}`)) return false
    return true
  })
  mergeable.sort((a, b) => b.count - a.count)
  const maxAdditionalByGrade: Record<string, number> = { S: 2, A: 2, B: 1, C: 1 }
  const maxAdditional = maxAdditionalByGrade[live.grade || 'C'] ?? 1
  const toMerge = mergeable.slice(0, maxAdditional)
  for (const seg of toMerge) {
    const beforeLen = live.assignedAudiences.length
    const segRemaining = tryAssign(live, seg, allSegments, maxCount !== undefined ? Math.max(0, maxCount - live.exposure) : undefined, allowReuse)
    if (segRemaining) remaining.push(segRemaining)
    if (live.assignedAudiences.length > beforeLen) {
      assigned.push(seg)
      const idx = pool.indexOf(seg)
      if (idx !== -1) pool.splice(idx, 1)
    }
  }
  return { assigned, remaining }
}

function pickBest(live: LiveStream, pool: AudienceSegment[], allowReuse: boolean = false): AudienceSegment | null {
  const excludedCats = getExcludedCats(live)
  const assignedCats = new Set(live.assignedAudiences.map((a) => getCategoryFamily(a.category)))
  const assignedCatRanges = new Set(live.assignedAudiences.map((a) => `${normalizeCategory(a.category)}|${a.timeRange}`))

  const eligible = pool.filter((seg) => {
    if (!allowReuse) {
      if (seg.status !== 'available') return false
      if (!isSegmentUnused(seg)) return false
    } else {
      const usable = (seg.status === 'available' && isSegmentUnused(seg)) || (seg.status === 'used' && isSegmentReusable(seg, live.date))
      if (!usable) return false
    }
    if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
    const conflicts = checkConflicts(live, seg, sysLives)
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
    return b.count - a.count
  })
  return eligible[0]
}

// Reset segments
let allSegments = audienceSegments.map(s => ({ ...s, status: 'available' as const, assignedTo: undefined as string | undefined, assignedDates: [] as string[] }))

// Build line pools
const linePools: Record<'health' | 'beauty' | 'interest', AudienceSegment[]> = { health: [], beauty: [], interest: [] }
for (const seg of allSegments) {
  if (linePools[seg.line as 'health' | 'beauty' | 'interest']) linePools[seg.line as 'health' | 'beauty' | 'interest'].push(seg)
}

// Score lives
const scored = sysLives
  .filter((live) => live.slot !== 'friend-circle')
  .map((live) => {
    let score = GRADE_SCORE[live.grade || ''] ?? 10
    if (live.slot === 'evening') score += 50
    else if (live.slot === 'morning') score += 30
    else if (live.slot === 'fake-evening') score += 15
    else if (live.slot === 'fake-morning') score += 10
    else score += 5
    if (live.grade === 'S') score += 10
    if (isLowWeightLive(live)) score -= 120
    return { live, score }
  })
scored.sort((a, b) => b.score - a.score)

console.log('\n=== DEBUG: Scored lives (all) ===')
for (const { live, score } of scored) {
  console.log(`  ${String(score).padStart(4)} ${live.date} ${live.slot.padEnd(14)} ${live.name} (grade:${live.grade} line:${live.line})`)
}

// Round 1
const lineGroups: Record<'health' | 'beauty' | 'interest', typeof scored> = { health: [], beauty: [], interest: [] }
for (const s of scored) {
  const allowedLines = getLiveAllowedLines(s.live)
  for (const line of allowedLines) if (lineGroups[line]) lineGroups[line].push(s)
}

console.log('\n=== DEBUG: lineGroups[health] ===')
for (const { live, score } of lineGroups.health) {
  console.log(`  ${score} ${live.date} ${live.slot} ${live.name}`)
}

console.log('\n=== DEBUG: lineGroups[beauty] ===')
for (const { live, score } of lineGroups.beauty) {
  console.log(`  ${score} ${live.date} ${live.slot} ${live.name}`)
}

console.log('\n=== DEBUG: lineGroups[interest] ===')
for (const { live, score } of lineGroups.interest) {
  console.log(`  ${score} ${live.date} ${live.slot} ${live.name}`)
}

// Trace specific lives
const TRACE_LIVES = [
  { name: '一杰瑜伽', date: '2026-05-25', slot: 'evening' },
  { name: '君合太极晨练', date: '2026-05-27', slot: 'morning' },
  { name: '睡眠调理晨练', date: '2026-05-29', slot: 'morning' },
  { name: '风光摄影', date: '2026-05-27', slot: 'evening' },
  { name: '摄影美学', date: '2026-05-28', slot: 'evening' },
]

function getLive(name: string, date: string, slot: string): LiveStream | undefined {
  return sysLives.find(l => l.name.includes(name) && l.date === date && l.slot === slot)
}

function printLive(label: string, live?: LiveStream) {
  if (!live) {
    console.log(`\n=== ${label}: NOT FOUND ===`)
    return
  }
  console.log(`\n=== ${label}: ${live.date} ${live.slot} ${live.name} (grade:${live.grade}) exposure:${live.exposure.toLocaleString()} segs:${live.assignedAudiences.length} ===`)
  for (const a of live.assignedAudiences) {
    console.log(`  ${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
  }
}

function pickBestDebug(live: LiveStream, pool: AudienceSegment[], allowReuse: boolean = false, label?: string) {
  const excludedCats = getExcludedCats(live)
  const assignedCats = new Set(live.assignedAudiences.map((a) => getCategoryFamily(a.category)))
  const assignedCatRanges = new Set(live.assignedAudiences.map((a) => `${normalizeCategory(a.category)}|${a.timeRange}`))

  const eligible = pool.filter((seg) => {
    if (!allowReuse) {
      if (seg.status !== 'available') return false
      if (!isSegmentUnused(seg)) return false
    } else {
      const usable = (seg.status === 'available' && isSegmentUnused(seg)) || (seg.status === 'used' && isSegmentReusable(seg, live.date))
      if (!usable) return false
    }
    if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
    const conflicts = checkConflicts(live, seg, sysLives)
    if (conflicts.length > 0) return false
    if (assignedCats.size >= 5 && !assignedCats.has(getCategoryFamily(seg.category))) return false
    if (assignedCatRanges.has(`${normalizeCategory(seg.category)}|${seg.timeRange}`)) return false
    return true
  })
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
    return b.count - a.count
  })
  if (label && eligible.length > 0) {
    console.log(`\n  [pickBest ${label}] top eligible for ${live.name}:`)
    for (const seg of eligible.slice(0, 5)) {
      console.log(`    ${seg.line} ${seg.category}(${seg.count.toLocaleString()}) ${seg.timeRange}`)
    }
  }
  return eligible[0] || null
}

let round1Changed = true
let round1Iters = 0
while (round1Changed && round1Iters < 200) {
  round1Changed = false
  round1Iters++
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
        const shouldTrace = TRACE_LIVES.some(t => live.name.includes(t.name) && live.date === t.date && live.slot === t.slot)
        const best = shouldTrace
          ? pickBestDebug(live, linePools[tryLine], false, `R1 ${live.name}`)
          : pickBest(live, linePools[tryLine])
        if (best) {
          const maxCount = Math.max(0, target - live.exposure)
          const beforeCount = live.assignedAudiences.length
          const remaining = tryAssign(live, best, allSegments, maxCount > 0 ? maxCount : undefined)
          if (live.assignedAudiences.length !== beforeCount) {
            if (shouldTrace) {
              console.log(`  -> assigned ${best.category}(${best.count.toLocaleString()}) to ${live.name}`)
            }
            const idx = linePools[tryLine].indexOf(best)
            if (idx !== -1) linePools[tryLine].splice(idx, 1)
            if (remaining) linePools[remaining.line as 'health' | 'beauty' | 'interest'].push(remaining)
            const mergeResult = tryAssignMergeSweep(live, best, linePools[tryLine], maxCount > 0 ? Math.max(0, maxCount - live.exposure) : undefined)
            if (shouldTrace && mergeResult.assigned.length > 0) {
              console.log(`  -> mergeSweep added ${mergeResult.assigned.length} segs to ${live.name}`)
            }
            for (const r of mergeResult.remaining) linePools[r.line as 'health' | 'beauty' | 'interest'].push(r)
            round1Changed = true
            break
          }
        }
      }
    }
  }
}

for (const t of TRACE_LIVES) {
  printLive(`Round1 ${t.name}`, getLive(t.name, t.date, t.slot))
}

// Round 2
let round2Changed = true
let round2Iters = 0
while (round2Changed && round2Iters < 200) {
  round2Changed = false
  round2Iters++
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
      const best = pickBest(live, linePools[line], true)
      if (best) {
        const beforeCount = live.assignedAudiences.length
        const maxCount = Math.max(0, cap - live.exposure)
        const remaining = tryAssign(live, best, allSegments, maxCount > 0 ? maxCount : undefined, true)
        if (live.assignedAudiences.length !== beforeCount) {
          const idx = linePools[line].indexOf(best)
          if (idx !== -1) linePools[line].splice(idx, 1)
          if (remaining) linePools[remaining.line as 'health' | 'beauty' | 'interest'].push(remaining)
          const mergeResult = tryAssignMergeSweep(live, best, linePools[line], maxCount > 0 ? Math.max(0, maxCount - live.exposure) : undefined, true)
          for (const r of mergeResult.remaining) linePools[r.line as 'health' | 'beauty' | 'interest'].push(r)
          round2Changed = true
          break
        }
      }
    }
  }
}

for (const t of TRACE_LIVES) {
  printLive(`Round2 ${t.name}`, getLive(t.name, t.date, t.slot))
}

// Round 3
let round3Changed = true
let round3Iters = 0
while (round3Changed && round3Iters < 200) {
  round3Changed = false
  round3Iters++
  const sorted = [...scored].sort((a, b) => b.score - a.score)
  for (const { live } of sorted) {
    const allowedLines = getLiveAllowedLines(live)
    const primaryLine = live.line as 'health' | 'beauty' | 'interest'
    const linesToTry = allowedLines.includes(primaryLine)
      ? [primaryLine, ...allowedLines.filter(l => l !== primaryLine)]
      : allowedLines
    for (const line of linesToTry) {
      const best = pickBest(live, linePools[line], true)
      if (best) {
        const beforeCount = live.assignedAudiences.length
        const remaining = tryAssign(live, best, allSegments, undefined, true)
        if (live.assignedAudiences.length !== beforeCount) {
          const idx = linePools[line].indexOf(best)
          if (idx !== -1) linePools[line].splice(idx, 1)
          if (remaining) linePools[remaining.line as 'health' | 'beauty' | 'interest'].push(remaining)
          const mergeResult = tryAssignMergeSweep(live, best, linePools[line], undefined, true)
          for (const r of mergeResult.remaining) linePools[r.line as 'health' | 'beauty' | 'interest'].push(r)
          round3Changed = true
          break
        }
      }
    }
  }
}

for (const t of TRACE_LIVES) {
  printLive(`Final ${t.name}`, getLive(t.name, t.date, t.slot))
}

// Find specific segments
console.log('\n=== Where did 瑜伽SA segments go? ===')
for (const live of sysLives) {
  const segs = live.assignedAudiences.filter(a => normalizeCategory(a.category) === '瑜伽SA')
  if (segs.length > 0) {
    console.log(`  ${live.date} ${live.slot} ${live.name}:`)
    for (const a of segs) console.log(`    ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
  }
}

console.log('\n=== Where did 气血调理(124574) go? ===')
for (const live of sysLives) {
  const segs = live.assignedAudiences.filter(a => normalizeCategory(a.category) === '气血调理' && a.count >= 120000)
  if (segs.length > 0) {
    console.log(`  ${live.date} ${live.slot} ${live.name}:`)
    for (const a of segs) console.log(`    ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
  }
}

console.log('\n=== Where did 亚健康(20940) go? ===')
for (const live of sysLives) {
  const segs = live.assignedAudiences.filter(a => normalizeCategory(a.category) === '亚健康管理' && a.count >= 20000)
  if (segs.length > 0) {
    console.log(`  ${live.date} ${live.slot} ${live.name}:`)
    for (const a of segs) console.log(`    ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
  }
}

console.log('\n=== Unassigned segments with count > 1000 ===')
for (const seg of allSegments) {
  if (seg.status === 'available' && seg.count > 1000) {
    console.log(`  ${seg.line} ${seg.category}(${seg.count.toLocaleString()}) ${seg.timeRange}`)
  }
}
