import * as fs from 'fs'
import * as path from 'path'
import { parseAudienceSheet, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, parseLineFromCategory, getCategoryFamily, isSameCategoryFamily } from '../live-schedule-dashboard/src/utils/categoryMapping'
import { DEFAULT_CATEGORY_GRADES } from '../live-schedule-dashboard/src/lib/defaultCategoryMappings'
import type { LiveStream, AudienceSegment, AssignedAudience } from '../live-schedule-dashboard/src/types'

// ====== 1. Human Schedule (manually verified from raw Excel) ======
interface HumanLive {
  date: string
  slot: string
  name: string
  type: 'real' | 'fake'
  category: string
  line: 'health' | 'beauty' | 'interest'
  grade: string
  exposure: number
}

const humanLives: HumanLive[] = [
  { date: '2026-05-25', slot: 'evening', name: '一杰瑜伽', type: 'real', category: '一杰瑜伽', line: 'beauty', grade: 'A', exposure: 491_144 },
  { date: '2026-05-26', slot: 'morning', name: '逆龄女神瑜伽晨练+五禽戏晨练', type: 'real', category: '逆龄女神瑜伽', line: 'beauty', grade: 'A', exposure: 406_972 },
  { date: '2026-05-26', slot: 'evening', name: '开心太极', type: 'fake', category: '开心太极', line: 'health', grade: 'B', exposure: 176_690 },
  { date: '2026-05-27', slot: 'morning', name: '君合太极晨练', type: 'real', category: '君合太极', line: 'health', grade: 'S', exposure: 420_769 },
  { date: '2026-05-27', slot: 'evening', name: '风光摄影耿春晖', type: 'real', category: '风光摄影', line: 'interest', grade: 'A', exposure: 471_894 },
  { date: '2026-05-28', slot: 'morning', name: '普拉提晨练+一杰瑜伽晨练', type: 'real', category: '普拉提', line: 'beauty', grade: 'B', exposure: 393_745 },
  { date: '2026-05-28', slot: 'evening', name: '手机摄影大赛-段晓晖', type: 'real', category: '摄影美学', line: 'interest', grade: 'B', exposure: 229_140 },
  { date: '2026-05-28', slot: 'evening', name: '体态塑形瑜伽', type: 'fake', category: '体态塑形瑜伽', line: 'beauty', grade: 'B', exposure: 153_915 },
  { date: '2026-05-28', slot: 'fake-evening', name: '唱歌张婷婷', type: 'fake', category: '唱歌', line: 'interest', grade: 'B', exposure: 325_303 },
  { date: '2026-05-29', slot: 'morning', name: '睡眠调理晨练', type: 'real', category: '睡眠调理', line: 'health', grade: 'A', exposure: 487_378 },
  { date: '2026-05-29', slot: 'evening', name: '健康营养王溪', type: 'real', category: '健康营养', line: 'health', grade: 'S', exposure: 562_167 },
  { date: '2026-05-29', slot: 'evening', name: '居家古法', type: 'fake', category: '古法居家养生', line: 'health', grade: 'B', exposure: 402_098 },
  { date: '2026-05-29', slot: 'fake-evening', name: '懒人吃瘦IP田珂', type: 'fake', category: '懒人吃瘦', line: 'beauty', grade: 'B', exposure: 456_635 },
  { date: '2026-05-30', slot: 'fake-evening', name: '唱歌李燃', type: 'fake', category: '唱歌', line: 'interest', grade: 'S', exposure: 404_337 },
]

console.log('人工排期直播数:', humanLives.length)
let totalHumanExp = 0
humanLives.forEach(l => {
  totalHumanExp += l.exposure
  console.log(`${l.date} ${l.slot.padEnd(12)} ${l.name.padEnd(25)} 曝光:${l.exposure.toLocaleString()} 等级:${l.grade}`)
})
console.log(`人工总曝光: ${totalHumanExp.toLocaleString()}\n`)

// ====== 2. Build System Lives (same lineup) ======
const systemLives: LiveStream[] = humanLives.map((h, idx) => {
  const isJoint = h.name.includes('+')
  let categories: string[] | undefined
  let lines: any[] | undefined
  if (isJoint) {
    const parts = h.name.replace(/【.*?】/g, '').split(/[+xX×]/).map(p => p.trim())
    categories = parts.map(p => normalizeCategory(p))
    lines = [...new Set(categories.map(c => parseLineFromCategory(c) || h.line))]
  }
  return {
    id: `live-${idx}`, name: h.name, startTime: h.slot === 'morning' ? '07:00' : '19:00',
    date: h.date, type: h.type,
    category: h.category, line: h.line, slot: h.slot as any,
    grade: h.grade as any, owner: '', assignedAudiences: [], exposure: 0,
    conflictReasons: [], isCrossCategory: false, isJoint, categories, lines, target: undefined
  }
})

// ====== 3. Load Audience ======
const audienceBuf = fs.readFileSync(path.join(__dirname, '../5月25-31日直播排期人数.xlsx'))
const audienceSegments = parseAudienceSheet(audienceBuf)
console.log('Audience segments:', audienceSegments.length)

// ====== 4. AutoSchedule Core ======
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
  // 段数限制按 normalizeCategory 计数：同品类的不同 timeRange 不额外占用 slot
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
function tryAssignMergeSweep(
  live: LiveStream,
  seedSeg: AudienceSegment,
  pool: AudienceSegment[],
  allSegments: AudienceSegment[],
  allLives: LiveStream[],
  historyRecords: any[],
  maxCount?: number,
  allowReuse: boolean = false
): { assigned: AudienceSegment[]; remaining: AudienceSegment[] } {
  const assigned: AudienceSegment[] = []
  const remaining: AudienceSegment[] = []
  const seedNorm = normalizeCategory(seedSeg.category)

  // Build current-live constraints (same as pickBest)
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
      const usable =
        (seg.status === 'available' && isSegmentUnused(seg)) ||
        (seg.status === 'used' && isSegmentReusable(seg, live.date))
      if (!usable) return false
    }
    // MUST re-run all pickBest eligibility checks (conflicts, exclusion, family limit, cat-range dedup)
    if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
    if (checkConflicts(live, seg, allLives, historyRecords).length > 0) return false
    if (assignedCats.size >= 5 && !assignedCats.has(getCategoryFamily(seg.category))) return false
    if (assignedCatRanges.has(`${normalizeCategory(seg.category)}|${seg.timeRange}`)) return false
    return true
  })
  mergeable.sort((a, b) => b.count - a.count)

  // 限制同品类合并数量：S/A 级最多额外合并 2 个（同品类共 3 个），B/C 级最多额外合并 1 个（同品类共 2 个）
  const maxAdditionalByGrade: Record<string, number> = { S: 2, A: 2, B: 1, C: 1 }
  const maxAdditional = maxAdditionalByGrade[live.grade || 'C'] ?? 1
  const toMerge = mergeable.slice(0, maxAdditional)

  for (const seg of toMerge) {
    const beforeLen = live.assignedAudiences.length
    const segRemaining = tryAssign(
      live,
      seg,
      allSegments,
      maxCount !== undefined ? Math.max(0, maxCount - live.exposure) : undefined,
      allowReuse
    )
    if (segRemaining) remaining.push(segRemaining)
    if (live.assignedAudiences.length > beforeLen) {
      assigned.push(seg)
      const idx = pool.indexOf(seg)
      if (idx !== -1) pool.splice(idx, 1)
    }
  }
  return { assigned, remaining }
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
              const mergeResult = tryAssignMergeSweep(
                live,
                best,
                linePools[tryLine],
                segments,
                lives,
                historyRecords,
                maxCount > 0 ? maxCount : undefined,
                false
              )
              for (const r of mergeResult.remaining) {
                linePools[r.line as 'health' | 'beauty' | 'interest'].push(r)
              }
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
            const mergeResult = tryAssignMergeSweep(
              live,
              best,
              linePools[line],
              segments,
              lives,
              historyRecords,
              maxCount > 0 ? maxCount : undefined,
              true
            )
            for (const r of mergeResult.remaining) {
              linePools[r.line as 'health' | 'beauty' | 'interest'].push(r)
            }
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
            const mergeResult = tryAssignMergeSweep(
              live,
              best,
              linePools[line],
              segments,
              undefined,
              true
            )
            for (const r of mergeResult.remaining) {
              linePools[r.line as 'health' | 'beauty' | 'interest'].push(r)
            }
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

// ====== 5. Comparison ======
console.log('\n========== 人工排期 vs 系统排期 对比 ==========\n')
console.log('日期'.padEnd(12), '时段'.padEnd(12), '直播名'.padEnd(25), '等级'.padEnd(6), '人工曝光'.padEnd(10), '系统曝光'.padEnd(10), '差异'.padEnd(10), '系统段'.padEnd(8))
console.log('-'.repeat(115))

let totalHuman = 0, totalSystem = 0
for (let i = 0; i < humanLives.length; i++) {
  const h = humanLives[i]
  const s = result.scored.find(({ live }) => live.id === `live-${i}`)?.live
  if (!s) continue
  const diff = s.exposure - h.exposure
  totalHuman += h.exposure
  totalSystem += s.exposure
  const diffStr = diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()
  const flag = Math.abs(diff) > 100000 ? '***' : ''
  console.log(
    h.date.padEnd(12),
    h.slot.padEnd(12),
    h.name.slice(0, 23).padEnd(25),
    h.grade.padEnd(6),
    h.exposure.toLocaleString().padEnd(10),
    s.exposure.toLocaleString().padEnd(10),
    diffStr.padEnd(10),
    String(s.assignedAudiences.length).padEnd(8),
    flag
  )
}
console.log('-'.repeat(115))
console.log('总计'.padEnd(55), totalHuman.toLocaleString().padEnd(10), totalSystem.toLocaleString().padEnd(10), (totalSystem - totalHuman).toLocaleString().padEnd(10))

// Detailed diff for lives with >80K diff
console.log('\n========== 差异 > 80K 的详细对比 ==========\n')
for (let i = 0; i < humanLives.length; i++) {
  const h = humanLives[i]
  const s = result.scored.find(({ live }) => live.id === `live-${i}`)?.live
  if (!s) continue
  const diff = Math.abs(s.exposure - h.exposure)
  if (diff < 80000) continue
  console.log(`\n--- ${h.date} ${h.slot} ${h.name} (等级:${h.grade}) ---`)
  console.log(`人工: ${h.exposure.toLocaleString()} | 系统: ${s.exposure.toLocaleString()} (${s.assignedAudiences.length}段) | 差异:${(s.exposure - h.exposure) > 0 ? '+' : ''}${(s.exposure - h.exposure).toLocaleString()}`)
  console.log('系统分配:')
  s.assignedAudiences.forEach(a => console.log(`  ${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`))
}

// Unassigned
const unassigned = testSegments.filter(s => s.status === 'available' && s.count > 0)
console.log(`\n\n系统未分配段: ${unassigned.length}  未分配人次: ${unassigned.reduce((sum, s) => sum + s.count, 0).toLocaleString()}`)
console.log('未分配详情:')
unassigned.forEach(s => console.log(`  ${s.line} ${s.category}(${s.count.toLocaleString()}) ${s.timeRange}`))
