import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook, parseAudienceSheet, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, parseLineFromCategory, getCategoryFamily, isSameCategoryFamily } from '../live-schedule-dashboard/src/utils/categoryMapping'
import { DEFAULT_CATEGORY_GRADES } from '../live-schedule-dashboard/src/lib/defaultCategoryMappings'
import type { LiveStream, AudienceSegment, AssignedAudience } from '../live-schedule-dashboard/src/types'

// ===== 1. Parse system lives (raw schedule without assignments) =====
const sysBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期.xlsx'))
const sysParsed = parseScheduleWorkbook(sysBuf, '5月25-31日直播排期.xlsx')
let sysLives = sysParsed.lives.map(l => ({
  ...l,
  assignedAudiences: [] as AssignedAudience[],
  exposure: 0,
  conflictReasons: [] as string[],
  grade: inferGrade(l.name) || l.grade || DEFAULT_CATEGORY_GRADES[normalizeCategory(l.category)] || 'C',
}))

// ===== 2. Parse human schedule (with assignments) =====
const humanBuf = fs.readFileSync(path.join(__dirname, '../正确排期5.25-31.xlsx'))
const humanParsed = parseScheduleWorkbook(humanBuf, '正确排期5.25-31.xlsx')
const humanLives = humanParsed.lives

// ===== 3. Parse audience inventory =====
const audBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期人数.xlsx'))
const audienceSegments = parseAudienceSheet(audBuf)

// ===== 4. Run system autoSchedule (latest logic with Merge Sweep + normCat counting) =====
const TARGET_EXPOSURE: Record<string, number> = { S: 600000, A: 500000, B: 350000, C: 250000 }
const MAX_SEGMENTS_BY_GRADE: Record<string, number> = { S: 8, A: 7, B: 5, C: 5 }
const ROUND2_CAP_MULTIPLIER: Record<string, number> = { S: 2.0, A: 1.8, B: 1.5, C: 1.2 }
const NEUTRAL_CATEGORIES = new Set(['东方养正瑜伽'])
const GRADE_SCORE: Record<string, number> = { S: 100, A: 70, B: 40, C: 20 }

function generateId() { return Math.random().toString(36).substring(2, 10) }
function daysBetween(a: string, b: string): number {
  const d1 = new Date(a), d2 = new Date(b)
  return Math.abs(Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)))
}
function getTarget(live: LiveStream): number {
  const base = live.target ?? TARGET_EXPOSURE[live.grade || 'C'] ?? 120000
  if (live.slot === 'morning') return Math.floor(base * 0.75)
  return base
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
  // 段数限制按品类族计数：同族（含等级变体）不额外占用 slot
  const assignedFamilies = new Set(live.assignedAudiences.map((a) => getCategoryFamily(a.category)))
  const segFamily = getCategoryFamily(seg.category)
  if (!assignedFamilies.has(segFamily) && assignedFamilies.size >= maxSegs) return null

  // 单场直播总段数上限（按等级），防止单场段数过多影响发送速度
  const MAX_TOTAL_SEGMENTS: Record<string, number> = { S: 10, A: 8, B: 7, C: 5 }
  if (live.assignedAudiences.length >= MAX_TOTAL_SEGMENTS[live.grade || 'C']) return null

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
  const excludedCats = getExcludedCats(live)
  const assignedCats = new Set(live.assignedAudiences.map((a) => getCategoryFamily(a.category)))
  const assignedCatRanges = new Set(live.assignedAudiences.map((a) => `${normalizeCategory(a.category)}|${a.timeRange}`))

  const mergeable = pool.filter((seg) => {
    if (seg.id === seedSeg.id) return false
    if (!isSameCategoryFamily(seg.category, seedSeg.category)) return false
    if (!allowReuse) {
      if (seg.status !== 'available') return false
      if (!isSegmentUnused(seg)) return false
    } else {
      const usable = (seg.status === 'available' && isSegmentUnused(seg)) || (seg.status === 'used' && isSegmentReusable(seg, live.date))
      if (!usable) return false
    }
    if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
    if (checkConflicts(live, seg, sysLives).length > 0) return false
    const maxFamilies = live.grade === 'S' ? 5 : live.grade === 'A' ? 4 : 3
    if (assignedCats.size >= maxFamilies && !assignedCats.has(getCategoryFamily(seg.category))) return false
    if (assignedCatRanges.has(`${normalizeCategory(seg.category)}|${seg.timeRange}`)) return false
    return true
  })
  mergeable.sort((a, b) => b.count - a.count)
  const maxAdditionalByGrade: Record<string, number> = { S: 1, A: 1, B: 1, C: 0 }
  let maxAdditional = maxAdditionalByGrade[live.grade || 'C'] ?? 1
  if (live.assignedAudiences.length >= 5) maxAdditional = 0
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
    const maxFamilies = live.grade === 'S' ? 5 : live.grade === 'A' ? 4 : 3
    if (assignedCats.size >= maxFamilies && !assignedCats.has(getCategoryFamily(seg.category))) return false
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
    if (live.slot === 'evening') score += 60
    else if (live.slot === 'morning') score += 20
    else if (live.slot === 'fake-evening') score += 15
    else if (live.slot === 'fake-morning') score += 10
    else score += 5
    if (live.grade === 'S') score += 10
    if (isLowWeightLive(live)) score -= 120
    return { live, score }
  })
scored.sort((a, b) => b.score - a.score)

// Round 1
const lineGroups: Record<'health' | 'beauty' | 'interest', typeof scored> = { health: [], beauty: [], interest: [] }
for (const s of scored) {
  const allowedLines = getLiveAllowedLines(s.live)
  for (const line of allowedLines) if (lineGroups[line]) lineGroups[line].push(s)
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
        const best = pickBest(live, linePools[tryLine])
        if (best) {
          const maxCount = Math.max(0, target - live.exposure)
          const beforeCount = live.assignedAudiences.length
          const remaining = tryAssign(live, best, allSegments, maxCount > 0 ? maxCount : undefined)
          if (live.assignedAudiences.length !== beforeCount) {
            const idx = linePools[tryLine].indexOf(best)
            if (idx !== -1) linePools[tryLine].splice(idx, 1)
            if (remaining) linePools[remaining.line as 'health' | 'beauty' | 'interest'].push(remaining)
            // Merge Sweep
            const mergeResult = tryAssignMergeSweep(live, best, linePools[tryLine], maxCount > 0 ? Math.max(0, maxCount - live.exposure) : undefined)
            for (const r of mergeResult.remaining) linePools[r.line as 'health' | 'beauty' | 'interest'].push(r)
            round1Changed = true
            break
          }
        }
      }
    }
  }
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

// ===== 5. Comparison =====
console.log('\n========== 系统排期 vs 人工排期 对比 (5.25-5.31) ==========\n')

let totalSys = 0, totalHuman = 0

for (const { live } of scored) {
  const humanLive = humanLives.find(h => h.date === live.date && h.slot === live.slot && normalizeCategory(h.name) === normalizeCategory(live.name))
  const humanAuds = humanLive?.assignedAudiences || []
  const sysAuds = live.assignedAudiences
  const humanExposure = humanLive?.exposure || 0
  const sysExposure = live.exposure
  totalSys += sysExposure
  totalHuman += humanExposure
  const target = getTarget(live)

  const humanKeySet = new Set(humanAuds.map(a => `${normalizeCategory(a.category)}|${a.timeRange}`))
  const sysKeySet = new Set(sysAuds.map(a => `${normalizeCategory(a.category)}|${a.timeRange}`))
  const matched = sysAuds.filter(a => humanKeySet.has(`${normalizeCategory(a.category)}|${a.timeRange}`))
  const sysOnly = sysAuds.filter(a => !humanKeySet.has(`${normalizeCategory(a.category)}|${a.timeRange}`))
  const humanOnly = humanAuds.filter(a => !sysKeySet.has(`${normalizeCategory(a.category)}|${a.timeRange}`))

  const diffFlag = (sysOnly.length > 0 || humanOnly.length > 0) ? '【差异】' : '【一致】'
  console.log(`${live.date} ${live.slot} ${live.name} (等级:${live.grade}) 目标:${target.toLocaleString()}`)
  console.log(`  人工: ${humanExposure.toLocaleString()} 段:${humanAuds.length} | 系统: ${sysExposure.toLocaleString()} 段:${sysAuds.length} ${diffFlag}`)

  if (matched.length > 0) {
    console.log('  ✓ 一致段:')
    for (const a of matched) console.log(`    ${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
  }
  if (sysOnly.length > 0) {
    console.log('  ⚠ 系统多分配:')
    for (const a of sysOnly) console.log(`    ${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
  }
  if (humanOnly.length > 0) {
    console.log('  ✗ 系统漏分配:')
    for (const a of humanOnly) console.log(`    ${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
  }
  console.log('')
}

const totalInventory = allSegments.reduce((sum, s) => sum + s.count, 0)
const unassigned = allSegments.filter(s => s.status === 'available' && s.count > 0)
console.log('========== 汇总 ==========')
console.log(`总库存: ${totalInventory.toLocaleString()}`)
console.log(`人工总触达: ${totalHuman.toLocaleString()}`)
console.log(`系统总触达: ${totalSys.toLocaleString()}`)
console.log(`差距: ${(totalHuman - totalSys).toLocaleString()}`)
console.log(`系统未分配段: ${unassigned.length} 人次: ${unassigned.reduce((sum, s) => sum + s.count, 0).toLocaleString()}`)

console.log('\n========== 系统未分配明细 ==========')
for (const s of unassigned) {
  console.log(`  ${s.line} ${s.category}(${s.count.toLocaleString()}) ${s.timeRange}`)
}
