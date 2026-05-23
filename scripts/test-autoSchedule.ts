import * as fs from 'fs'
import * as path from 'path'
import { parseScheduleWorkbook, inferGrade, parseCrossPrefSheet } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, parseLineFromCategory, getCategoryFamily, isSameCategoryFamily } from '../live-schedule-dashboard/src/utils/categoryMapping'
import type { LiveStream, AudienceSegment, HistoryRecord, AssignedAudience, CrossCategoryPref } from '../live-schedule-dashboard/src/types'

const filePath = path.join(__dirname, '../我的排期5.18-5.24.xlsx')
const buffer = fs.readFileSync(filePath)
const parsed = parseScheduleWorkbook(buffer, path.basename(filePath))
const { lives, audienceSegments, historyRecords, weekDays } = parsed as any
console.log('WeekDays from parser:', weekDays?.map((w: any) => `${w.label} ${w.date} ${w.fullDate}`) || 'N/A')

// Load cross-category preferences
const crossPrefPath = path.join(__dirname, '../转继承新增用户day60跨科品类.xlsx')
let crossCategoryPrefs: CrossCategoryPref[] = []
if (fs.existsSync(crossPrefPath)) {
  const crossBuffer = fs.readFileSync(crossPrefPath)
  const parsed = parseCrossPrefSheet(crossBuffer)
  crossCategoryPrefs = parsed.crossCategoryPrefs
}

function extractCohortMonth(timeRange: string): string | null {
  if (!timeRange) return null
  const allMatches = Array.from(timeRange.matchAll(/(\d{4})[\.年](\d{1,2})/g))
  if (allMatches.length === 0) return null
  const lastMatch = allMatches[allMatches.length - 1]
  return `${lastMatch[1]}-${lastMatch[2].padStart(2, '0')}`
}

function findCrossPref(audienceCat: string, liveCat: string, cohortMonth: string | null): CrossCategoryPref | undefined {
  const normAud = normalizeCategory(audienceCat)
  const normLive = normalizeCategory(liveCat)
  const pref = crossCategoryPrefs.find(
    (p) => normalizeCategory(p.fromCategory) === normAud && normalizeCategory(p.toCategory) === normLive && p.cohortMonth === cohortMonth
  )
  if (pref) return pref
  return crossCategoryPrefs.find(
    (p) => normalizeCategory(p.fromCategory) === normAud && normalizeCategory(p.toCategory) === normLive
  )
}

function getCrossPref(audienceCat: string, liveCat: string, timeRange: string): { crossRate: number; conversionRate: number; ltv: number } {
  const cohortMonth = extractCohortMonth(timeRange)
  if (isSameCategoryFamily(audienceCat, liveCat)) {
    return { crossRate: 1.0, conversionRate: 1.0, ltv: 80 }
  }
  const pref = findCrossPref(audienceCat, liveCat, cohortMonth)
  if (pref) {
    const crossRate = pref.crossRate || 0
    const conversionRate = (pref.conversionRate || 0) > 0 ? pref.conversionRate : 1
    return { crossRate, conversionRate, ltv: pref.ltv || 0 }
  }
  return { crossRate: 0, conversionRate: 1, ltv: 0 }
}

function isFakeLiveByName(name: string): boolean {
  return name.includes('短视频') || name.includes('2026.4.2唐一杰')
}

// Only real lives participate in scheduling
let testLives = lives.filter(l => l.type === 'real' && !isFakeLiveByName(l.name)).map(l => ({
  ...l,
  assignedAudiences: [] as AssignedAudience[],
  exposure: 0,
  conflictReasons: [] as string[],
  grade: inferGrade(l.name) || l.grade || 'C',
}))

let testSegments = audienceSegments.map(s => ({ ...s, status: 'available' as const, assignedTo: undefined as string | undefined, assignedDates: [] as string[] }))
let testHistory = historyRecords

// ========== Constants matching schedule.ts ==========
const TARGET_EXPOSURE: Record<string, number> = {
  S: 600000, A: 500000, B: 350000, C: 250000,
}
const MAX_SEGMENTS_BY_GRADE: Record<string, number> = {
  S: 8, A: 7, B: 5, C: 5,
}

function isLowWeightLive(live: LiveStream): boolean {
  return live.name.includes('数字人') || live.name.includes('录播') || live.name.includes('开心太极')
}

function getLowWeightLimit(live: LiveStream): { maxSegments: number; maxExposure: number } | null {
  if (isLowWeightLive(live)) return { maxSegments: 1, maxExposure: 200000 }
  return null
}
const NEUTRAL_CATEGORIES = new Set(['一杰瑜伽', '东方养正瑜伽'])
const GRADE_SCORE: Record<string, number> = { S: 100, A: 70, B: 40, C: 20 }

function generateId() { return Math.random().toString(36).substring(2, 10) }
function resolveDate(d: string): Date { return new Date(d) }
function daysBetween(a: string, b: string): number {
  const d1 = resolveDate(a), d2 = resolveDate(b)
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
  if (live.isCrossCategory) {
    return new Set([liveCat])
  }
  return new Set<string>()
}
function isSegmentUnused(seg: AudienceSegment): boolean {
  return !seg.assignedDates || seg.assignedDates.length === 0
}
function isSegmentReusable(seg: AudienceSegment, liveDate: string): boolean {
  if (!seg.assignedDates || seg.assignedDates.length !== 1) return false
  return daysBetween(seg.assignedDates[0], liveDate) >= 3
}
function isRecentSegment(timeRange: string, daysThreshold: number = 14): boolean {
  return getTimeRecencyScore(timeRange) >= -daysThreshold
}
function getTimeRecencyScore(timeRange: string): number {
  const parts = timeRange.split(/[-~—]/)
  if (parts.length < 2) return 0
  const endPart = parts[parts.length - 1].trim()
  const match = endPart.match(/(\d{4})[年.]?(\d{1,2})[月.]?(\d{1,2})?/)
  if (!match) return 0
  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10) - 1
  const day = match[3] ? parseInt(match[3], 10) : 1
  const endDate = new Date(year, month, day)
  const now = new Date('2026-05-17')
  const diffMs = now.getTime() - endDate.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  return -diffDays
}

function checkConflicts(live: LiveStream, seg: AudienceSegment): string[] {
  const reasons: string[] = []
  const normSegCat = normalizeCategory(seg.category)

  const recentHistory = testHistory.filter(
    (h) => normalizeCategory(h.category) === normSegCat && h.timeRange === seg.timeRange && daysBetween(h.date, live.date) < 3
  )
  const recentWeek = testLives.filter(
    (l) =>
      l.id !== live.id &&
      l.type !== 'fake' &&
      l.assignedAudiences.some((a) => normalizeCategory(a.category) === normSegCat && a.timeRange === seg.timeRange) &&
      daysBetween(l.date, live.date) < 3
  )
  if (recentHistory.length > 0 || recentWeek.length > 0) {
    reasons.push(`${seg.category} ${seg.timeRange} 3天内已被触达`)
  }

  const sameWeek = testLives.filter(
    (l) =>
      l.id !== live.id &&
      l.type !== 'fake' &&
      l.date === live.date &&
      l.assignedAudiences.some((a) => normalizeCategory(a.category) === normSegCat && a.timeRange === seg.timeRange)
  )
  if (sameWeek.length > 0) {
    reasons.push(`${seg.category} ${seg.timeRange} 当日已被分配`)
  }

  return reasons
}

function tryAssign(live: LiveStream, seg: AudienceSegment, maxCount?: number, allowReuse: boolean = false): AudienceSegment | null {
  if (seg.status !== 'available' && !allowReuse) return null
  const maxSegs = MAX_SEGMENTS_BY_GRADE[live.grade || 'C'] ?? 2
  if (live.assignedAudiences.length >= maxSegs) return null

  // 低权重直播硬性上限
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
      id: generateId(),
      line: seg.line,
      category: seg.category,
      timeRange: seg.timeRange,
      count: seg.count - desiredCount,
      status: 'available',
      assignedDates: seg.assignedDates ? [...seg.assignedDates] : [],
    } as AudienceSegment
    testSegments.push(remaining)
    seg.count = desiredCount
  }

  if (!allowReuse && seg.assignedTo && seg.assignedTo !== live.id) {
    const fromLive = testLives.find((l) => l.id === seg.assignedTo)
    if (fromLive) {
      const idx = fromLive.assignedAudiences.findIndex((a) => a.segmentId === seg.id)
      if (idx !== -1) {
        fromLive.exposure -= fromLive.assignedAudiences[idx].count
        fromLive.assignedAudiences.splice(idx, 1)
      }
      if (seg.assignedDates) {
        seg.assignedDates = seg.assignedDates.filter((d) => d !== fromLive.date)
      }
    }
  }

  const conflicts = checkConflicts(live, seg)
  const assigned: AssignedAudience = {
    segmentId: seg.id,
    line: seg.line,
    category: seg.category,
    timeRange: seg.timeRange,
    count: seg.count,
  }
  live.assignedAudiences.push(assigned)
  live.exposure += seg.count
  if (!allowReuse) {
    seg.status = 'used' as any
    seg.assignedTo = live.id
  }
  if (!seg.assignedDates) seg.assignedDates = []
  seg.assignedDates.push(live.date)
  live.conflictReasons.push(...conflicts)
  return remaining
}

function pickBest(live: LiveStream, pool: AudienceSegment[], allowReuse: boolean = false): AudienceSegment | null {
  const excludedCats = getExcludedCats(live)
  const assignedCats = new Set(live.assignedAudiences.map((a) => getCategoryFamily(a.category)))
  const assignedNormalizedCats = new Set(live.assignedAudiences.map((a) => normalizeCategory(a.category)))
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
    const conflicts = checkConflicts(live, seg)
    if (conflicts.length > 0) return false
    if (assignedCats.size >= 5 && !assignedCats.has(getCategoryFamily(seg.category))) return false
    // 同一场直播同一细分品类最多只分配一次（避免堆叠）
    if (assignedNormalizedCats.has(normalizeCategory(seg.category))) return false
    return true
  })

  if (eligible.length === 0) return null

  const liveCat = normalizeCategory(live.category)

  eligible.sort((a, b) => {
    // 1. Primary line first (主线优先，中性品类跨线作为 fallback)
    const aPrimary = a.line === live.line
    const bPrimary = b.line === live.line
    if (aPrimary !== bPrimary) return bPrimary ? 1 : -1

    // 2. Time recency: newer cohorts have higher quality users (最高优先级)
    const aRecency = getTimeRecencyScore(a.timeRange)
    const bRecency = getTimeRecencyScore(b.timeRange)
    if (aRecency !== bRecency) return bRecency - aRecency

    // 3. Same category family (垂类优先)
    const aSameFamily = isSameCategoryFamily(a.category, live.category)
    const bSameFamily = isSameCategoryFamily(b.category, live.category)
    if (aSameFamily !== bSameFamily) return bSameFamily ? 1 : -1

    // 4. Prefer already-assigned categories (同品类多个时间段合并)
    const aDupCat = assignedCats.has(getCategoryFamily(a.category))
    const bDupCat = assignedCats.has(getCategoryFamily(b.category))
    if (aDupCat !== bDupCat) return aDupCat ? -1 : 1

    // 5. Avoid duplicate timeRanges (still prefer new timeRanges within same category)
    const aDupRange = assignedRanges.has(a.timeRange)
    const bDupRange = assignedRanges.has(b.timeRange)
    if (aDupRange !== bDupRange) return aDupRange ? 1 : -1

    // 6. Large count first (大数量段优先)
    if (b.count !== a.count) return b.count - a.count

    return 0
  })

  return eligible[0]
}

// Build line pools
const linePools: Record<'health' | 'beauty' | 'interest', AudienceSegment[]> = {
  health: [], beauty: [], interest: [],
}
for (const seg of testSegments) {
  if (linePools[seg.line as 'health' | 'beauty' | 'interest']) {
    linePools[seg.line as 'health' | 'beauty' | 'interest'].push(seg)
  }
}

// Score lives — 严格等级优先，名师/IP 影响大
const scored = testLives
  .filter((live) => live.slot !== 'friend-circle' && live.type !== 'fake')
  .map((live) => {
    let score = GRADE_SCORE[live.grade || ''] ?? 10
    if (live.slot === 'evening') score += 50
    else if (live.slot === 'morning') score += 30
    else if (live.slot === 'fake-evening') score += 15
    else if (live.slot === 'fake-morning') score += 10
    else score += 5
    // 数字人 / 录播 / 低权重直播降权
    if (isLowWeightLive(live)) score -= 120
    // 名师/IP 直播适当加权
    if (live.grade === 'S') score += 10
    return { live, score }
  })
scored.sort((a, b) => b.score - a.score)

console.log('Starting Round 1...')

// Round 1: 按线级分组轮询，确保同线各直播都有机会拿到段
const lineGroups: Record<'health' | 'beauty' | 'interest', typeof scored> = {
  health: [], beauty: [], interest: [],
}
for (const s of scored) {
  // 联合直播应同时出现在它所关联的所有线级组中，发挥跨线优势
  const allowedLines = getLiveAllowedLines(s.live)
  for (const line of allowedLines) {
    if (lineGroups[line]) lineGroups[line].push(s)
  }
}

let round1Changed = true
let round1Iters = 0
while (round1Changed && round1Iters < 200) {
  round1Changed = false
  round1Iters++
  for (const line of (['health', 'beauty', 'interest'] as const)) {
    const group = lineGroups[line]
    for (const { live } of group) {
      const target = getTarget(live)
      if (live.exposure >= target) continue
      const allowedLines = getLiveAllowedLines(live)
      const primaryLine = live.line as 'health' | 'beauty' | 'interest'
      const linesToTry = allowedLines.includes(primaryLine)
        ? [primaryLine, ...allowedLines.filter(l => l !== primaryLine)]
        : allowedLines
      for (const tryLine of linesToTry) {
        const best = pickBest(live, linePools[tryLine])
        if (best) {
          const maxCount = Math.max(0, target - live.exposure)
          const beforeCount = live.assignedAudiences.length
          const remaining = tryAssign(live, best, maxCount > 0 ? maxCount : undefined)
          if (live.assignedAudiences.length === beforeCount) {
            // tryAssign failed (e.g. too-small split for this live's remaining target).
            // Do NOT remove from pool — the segment is still viable for other lives.
          } else {
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
console.log(`Round 1 done after ${round1Iters} iterations`)

// Round 2: 严格等级优先，继续分配剩余 unused 段（有 grade-based soft cap）
const ROUND2_CAP_MULTIPLIER: Record<string, number> = { S: 2.0, A: 1.8, B: 1.5, C: 1.2 }
console.log('Starting Round 2...')
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
      const best = pickBest(live, linePools[line], false)
      if (best) {
        const beforeCount = live.assignedAudiences.length
        const maxCount = Math.max(0, cap - live.exposure)
        const remaining = tryAssign(live, best, maxCount > 0 ? maxCount : undefined, false)
        if (live.assignedAudiences.length === beforeCount) {
          // tryAssign failed for this live; keep segment in pool for others
        } else {
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
console.log(`Round 2 done after ${round2Iters} iterations`)

// Round 3: 强制把剩余 unused 段分配给任意可兼容直播（按得分降序），确保 100% 利用率
console.log('Starting Round 3...')
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
      const best = pickBest(live, linePools[line], false)
      if (best) {
        const beforeCount = live.assignedAudiences.length
        const remaining = tryAssign(live, best, undefined, false)
        if (live.assignedAudiences.length === beforeCount) {
          // tryAssign failed for this live; keep segment in pool for others
        } else {
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
console.log(`Round 3 done after ${round3Iters} iterations`)

// ========== Comparison ==========
console.log('\n=== 系统 autoSchedule 结果 vs 人工排期 ===\n')

for (const { live } of scored) {
  const humanLive = lives.find(l => l.id === live.id)
  const humanAuds = humanLive?.assignedAudiences || []
  const sysAuds = live.assignedAudiences

  const humanExposure = humanLive?.exposure || 0
  const sysExposure = live.exposure
  const target = getTarget(live)

  const humanKeySet = new Set(humanAuds.map(a => `${normalizeCategory(a.category)}|${a.timeRange}`))
  const sysKeySet = new Set(sysAuds.map(a => `${normalizeCategory(a.category)}|${a.timeRange}`))

  const matched = sysAuds.filter(a => humanKeySet.has(`${normalizeCategory(a.category)}|${a.timeRange}`))
  const sysOnly = sysAuds.filter(a => !humanKeySet.has(`${normalizeCategory(a.category)}|${a.timeRange}`))
  const humanOnly = humanAuds.filter(a => !sysKeySet.has(`${normalizeCategory(a.category)}|${a.timeRange}`))

  let diffFlag = ''
  if (sysOnly.length > 0 || humanOnly.length > 0) diffFlag = ' [差异]'

  console.log(`${live.date} ${live.slot} ${live.name} (等级:${live.grade}) 目标:${target.toLocaleString()} 人工:${humanExposure.toLocaleString()} 系统:${sysExposure.toLocaleString()}${diffFlag}`)

  if (matched.length > 0) {
    console.log('  ✓ 一致:')
    for (const a of matched) {
      console.log(`    ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
    }
  }
  if (sysOnly.length > 0) {
    console.log('  ⚠ 系统多分配:')
    for (const a of sysOnly) {
      console.log(`    ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
    }
  }
  if (humanOnly.length > 0) {
    console.log('  ✗ 系统漏分配:')
    for (const a of humanOnly) {
      console.log(`    ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
    }
  }
  console.log('')
}

console.log('WeekDays from parser:', audienceSegments.weekDays?.map((w: any) => w.fullDate) || 'N/A')

const totalSysAssigned = testLives.reduce((sum, l) => sum + l.exposure, 0)
const totalHumanAssigned = lives.filter(l => l.type === 'real').reduce((sum, l) => sum + l.exposure, 0)
const totalInventory = testSegments.reduce((sum, s) => sum + s.count, 0)
console.log(`总库存: ${totalInventory.toLocaleString()}`)
console.log(`人工总触达: ${totalHumanAssigned.toLocaleString()}`)
console.log(`系统总触达: ${totalSysAssigned.toLocaleString()}`)

// Show unassigned segments
const unassigned = testSegments.filter(s => s.status === 'available' && s.count > 0)
if (unassigned.length > 0) {
  console.log('\n=== 系统未分配的 audience 段 ===')
  for (const s of unassigned) {
    console.log(`  ${s.line} ${s.category}(${s.count.toLocaleString()}) ${s.timeRange} status=${s.status} assignedTo=${s.assignedTo} assignedDates=${JSON.stringify(s.assignedDates)}`)
  }

  // Dump line pools
  console.log('\n=== Round 3 结束后各线 pool 剩余段 ===')
  for (const line of ['health', 'beauty', 'interest'] as const) {
    const segs = linePools[line]
    console.log(`${line}: ${segs.length} 段`)
    for (const s of segs) {
      console.log(`  ${s.category}(${s.count.toLocaleString()}) ${s.timeRange} status=${s.status} unused=${isSegmentUnused(s)}`)
    }
  }

  // Diagnose why each unassigned segment was not allocated
  console.log('\n=== 未分配段根因诊断 ===')
  for (const seg of unassigned) {
    console.log(`\n${seg.line} ${seg.category}(${seg.count.toLocaleString()}) ${seg.timeRange}`)
    const blockers: string[] = []
    for (const live of testLives) {
      if (live.slot === 'friend-circle') continue
      const allowedLines = getLiveAllowedLines(live)
      if (!allowedLines.includes(seg.line as any)) {
        blockers.push(`${live.name}(${live.grade}): 线级不匹配 [live.line=${live.line}, allowed=${allowedLines.join('+')}]`)
        continue
      }
      const maxSegs = MAX_SEGMENTS_BY_GRADE[live.grade || 'C'] ?? 2
      if (live.assignedAudiences.length >= maxSegs) {
        blockers.push(`${live.name}(${live.grade}): 已达段数上限 ${maxSegs}`)
        continue
      }
      const lowLimit = getLowWeightLimit(live)
      if (lowLimit && live.assignedAudiences.length >= lowLimit.maxSegments) {
        blockers.push(`${live.name}(${live.grade}): 低权重段数上限 ${lowLimit.maxSegments}`)
        continue
      }
      const excludedCats = getExcludedCats(live)
      if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) {
        blockers.push(`${live.name}(${live.grade}): 品类被排除 [excluded=${Array.from(excludedCats).join(',')}]`)
        continue
      }
      const assignedNormalizedCats = new Set(live.assignedAudiences.map((a) => normalizeCategory(a.category)))
      if (assignedNormalizedCats.has(normalizeCategory(seg.category))) {
        blockers.push(`${live.name}(${live.grade}): 已分配同细分品类`)
        continue
      }
      const assignedCats = new Set(live.assignedAudiences.map((a) => getCategoryFamily(a.category)))
      if (assignedCats.size >= 5 && !assignedCats.has(getCategoryFamily(seg.category))) {
        blockers.push(`${live.name}(${live.grade}): 5-family 限制已满 [${Array.from(assignedCats).join(',')}]`)
        continue
      }
      const conflicts = checkConflicts(live, seg)
      if (conflicts.length > 0) {
        blockers.push(`${live.name}(${live.grade}): 冲突 [${conflicts.join('; ')}]`)
        continue
      }
      // Round-2/3 condition: maxCount is undefined, desiredCount = seg.count
      const desiredCount = seg.count
      if (desiredCount < seg.count * 0.3) {
        blockers.push(`${live.name}(${live.grade}): desiredCount(${desiredCount}) < 30% of seg(${seg.count})`)
        continue
      }
      // If we reach here, this live SHOULD have been able to take it
      blockers.push(`${live.name}(${live.grade}): ✅ 理论上可分配! exposure=${live.exposure}, segs=${live.assignedAudiences.length}`)
    }
    for (const b of blockers) console.log(`  ${b}`)

    // Deep dive: for "✅ 理论上可分配" lives, check pickBest ranking in the actual pool
    const okLives = blockers.filter(b => b.includes('✅')).map(b => b.split(':')[0])
    if (okLives.length > 0) {
      console.log(`  [深度分析] 以下直播理论上可分配但未拿到，检查 pickBest 排序:`)
      const pool = linePools[seg.line as 'health' | 'beauty' | 'interest']
      for (const liveName of okLives) {
        const live = testLives.find(l => l.name === liveName.split('(')[0])!
        const eligible = pool.filter(s => {
          if (s.status !== 'available' || !isSegmentUnused(s)) return false
          if (Array.from(getExcludedCats(live)).some(c => isSameCategoryFamily(c, normalizeCategory(s.category)))) return false
          if (checkConflicts(live, s).length > 0) return false
          const ac = new Set(live.assignedAudiences.map(a => getCategoryFamily(a.category)))
          if (ac.size >= 5 && !ac.has(getCategoryFamily(s.category))) return false
          const anc = new Set(live.assignedAudiences.map(a => normalizeCategory(a.category)))
          if (anc.has(normalizeCategory(s.category))) return false
          return true
        })
        eligible.sort((a, b) => {
          const ap = a.line === live.line, bp = b.line === live.line
          if (ap !== bp) return bp ? 1 : -1
          const ar = getTimeRecencyScore(a.timeRange), br = getTimeRecencyScore(b.timeRange)
          if (ar !== br) return br - ar
          const asf = isSameCategoryFamily(a.category, live.category), bsf = isSameCategoryFamily(b.category, live.category)
          if (asf !== bsf) return bsf ? 1 : -1
          const ac2 = new Set(live.assignedAudiences.map(aa => getCategoryFamily(aa.category)))
          const adc = ac2.has(getCategoryFamily(a.category)), bdc = ac2.has(getCategoryFamily(b.category))
          if (adc !== bdc) return adc ? -1 : 1
          const ar2 = new Set(live.assignedAudiences.map(aa => aa.timeRange))
          const adr = ar2.has(a.timeRange), bdr = ar2.has(b.timeRange)
          if (adr !== bdr) return adr ? 1 : -1
          return b.count - a.count
        })
        const idx = eligible.findIndex(s => s.id === seg.id)
        const top3 = eligible.slice(0, 3).map(s => `${s.category}(${s.count.toLocaleString()})`).join(', ')
        console.log(`    ${live.name}: 在 eligible 中排第 ${idx + 1} / ${eligible.length}, 前3: ${top3}`)
      }
    }
  }
}
