import * as fs from 'fs'
import { parseScheduleWorkbook, parseAudienceSheet, parseCrossPrefSheet, parseLiveDetailSheet, inferGrade } from '../live-schedule-dashboard/src/utils/parser'
import { normalizeCategory, getCategoryFamily, isSameCategoryFamily } from '../live-schedule-dashboard/src/utils/categoryMapping'
import { DEFAULT_CATEGORY_GRADES } from '../live-schedule-dashboard/src/lib/defaultCategoryMappings'
import type { LiveStream, AudienceSegment, CrossCategoryPref, CategoryHistoricalStat } from '../live-schedule-dashboard/src/types'

// ===== Load data =====
const schedBuf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期.xlsx')
const schedParsed = parseScheduleWorkbook(schedBuf, '6.1-6.7排期.xlsx')
let lives = schedParsed.lives.map(l => ({
  ...l,
  assignedAudiences: [] as any[],
  exposure: 0,
  conflictReasons: [] as string[],
  grade: inferGrade(l.name) || l.grade || DEFAULT_CATEGORY_GRADES[normalizeCategory(l.category)] || 'C',
}))

const audBuf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/6.1-6.7排期人数.xlsx')
let allSegments = parseAudienceSheet(audBuf)

const crossBuf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/转继承新增用户day60跨科品类.xlsx')
const crossResult = parseCrossPrefSheet(crossBuf)

const detailBuf = fs.readFileSync('/Users/zhengkeying/直播间排期策略/直播明细表.xlsx')
const historicalStats = parseLiveDetailSheet(detailBuf)

// Simple standalone autoSchedule ( mirrors schedule.ts logic )
const TARGET_EXPOSURE: Record<string, number> = { S: 600000, A: 500000, B: 350000, C: 250000 }
const MAX_SEGMENTS_BY_GRADE: Record<string, number> = { S: 8, A: 7, B: 5, C: 5 }
const MAX_TOTAL_SEGMENTS: Record<string, number> = { S: 10, A: 8, B: 7, C: 5 }
const ROUND2_CAP_MULTIPLIER = 1.5

function generateId() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function daysBetween(a: string, b: string) { const x = new Date(a), y = new Date(b); return Math.abs(Math.floor((x.getTime() - y.getTime()) / 86400000)) }

function getTarget(live: any) {
  const base = TARGET_EXPOSURE[live.grade || 'C'] ?? 120000
  if (live.slot === 'morning') return Math.floor(base * 0.75)
  return base
}
function getLowWeightLimit(live: any) {
  const name = live.name || ''
  if (name.includes('数字人') || name.includes('录播') || name.includes('开心太极')) {
    return { maxSegments: 1, maxExposure: 200000 }
  }
  return null
}
function getExcludedCats(live: any) {
  const excluded = new Set<string>()
  if (live.isCrossCategory) {
    const family = getCategoryFamily(normalizeCategory(live.category))
    if (family) excluded.add(family)
  }
  return excluded
}
function checkConflicts(live: any, seg: any) {
  const reasons: string[] = []
  const normCat = normalizeCategory(seg.category)
  for (const a of live.assignedAudiences) {
    if (normalizeCategory(a.category) === normCat && a.timeRange === seg.timeRange) {
      reasons.push('同直播同品类同timeRange')
    }
  }
  return reasons
}

function tryAssign(live: any, seg: any, maxCount?: number, allowReuse = false) {
  if (seg.status !== 'available' && !allowReuse) return null
  const maxSegs = MAX_SEGMENTS_BY_GRADE[live.grade || 'C'] ?? 2
  const assignedFamilies = new Set(live.assignedAudiences.map((a: any) => getCategoryFamily(a.category)))
  const segFamily = getCategoryFamily(seg.category)
  if (!assignedFamilies.has(segFamily) && assignedFamilies.size >= maxSegs) return null
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

  let remaining = null
  if (desiredCount < seg.count) {
    remaining = { id: generateId(), line: seg.line, category: seg.category, timeRange: seg.timeRange, count: seg.count - desiredCount, status: 'available', assignedDates: seg.assignedDates ? [...seg.assignedDates] : [] }
    allSegments.push(remaining)
    seg.count = desiredCount
  }
  if (!allowReuse && seg.assignedTo) {
    // skip transfer for simplicity
  }
  if (!seg.assignedDates) seg.assignedDates = []
  seg.assignedDates.push(live.date)
  seg.status = 'used'
  seg.assignedTo = live.id
  live.assignedAudiences.push({ segmentId: seg.id, line: seg.line, category: seg.category, timeRange: seg.timeRange, count: desiredCount })
  live.exposure += desiredCount
  return remaining
}

function pickBest(live: any, pool: any[], allowReuse = false) {
  const excludedCats = getExcludedCats(live)
  const assignedCats = new Set(live.assignedAudiences.map((a: any) => getCategoryFamily(a.category)))
  const assignedCatRanges = new Set(live.assignedAudiences.map((a: any) => `${normalizeCategory(a.category)}|${a.timeRange}`))
  const maxFamilies = live.grade === 'S' ? 5 : live.grade === 'A' ? 4 : 3

  const candidates = pool.filter((seg) => {
    if (!allowReuse && seg.status !== 'available') return false
    if (allowReuse) {
      const usable = seg.status === 'available' || (seg.status === 'used' && seg.assignedDates && seg.assignedDates.length > 0 && daysBetween(seg.assignedDates[seg.assignedDates.length - 1], live.date) >= 3)
      if (!usable) return false
    }
    if (Array.from(excludedCats).some((cat: any) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
    if (checkConflicts(live, seg).length > 0) return false
    if (assignedCats.size >= maxFamilies && !assignedCats.has(getCategoryFamily(seg.category))) return false
    if (assignedCatRanges.has(`${normalizeCategory(seg.category)}|${seg.timeRange}`)) return false
    return true
  })

  candidates.sort((a, b) => {
    const aFamily = getCategoryFamily(a.category), bFamily = getCategoryFamily(b.category)
    const aDup = assignedCats.has(aFamily) ? 1 : 0, bDup = assignedCats.has(bFamily) ? 1 : 0
    if (aDup !== bDup) return bDup - aDup
    const aRangeDup = assignedCatRanges.has(`${normalizeCategory(a.category)}|${a.timeRange}`) ? 1 : 0
    const bRangeDup = assignedCatRanges.has(`${normalizeCategory(b.category)}|${b.timeRange}`) ? 1 : 0
    if (aRangeDup !== bRangeDup) return bRangeDup - aRangeDup
    if (b.count !== a.count) return b.count - a.count
    return 0
  })
  return candidates[0] || null
}

function tryAssignMergeSweep(live: any, seedSeg: any, pool: any[], maxCount?: number, allowReuse = false) {
  const assigned: any[] = [], remaining: any[] = []
  const seedNorm = normalizeCategory(seedSeg.category)
  const excludedCats = getExcludedCats(live)
  const assignedCats = new Set(live.assignedAudiences.map((a: any) => getCategoryFamily(a.category)))
  const assignedCatRanges = new Set(live.assignedAudiences.map((a: any) => `${normalizeCategory(a.category)}|${a.timeRange}`))

  const mergeable = pool.filter((seg) => {
    if (seg.id === seedSeg.id) return false
    if (normalizeCategory(seg.category) !== seedNorm) return false
    if (!allowReuse) { if (seg.status !== 'available') return false }
    else {
      const usable = seg.status === 'available' || (seg.status === 'used' && seg.assignedDates && seg.assignedDates.length > 0 && daysBetween(seg.assignedDates[seg.assignedDates.length - 1], live.date) >= 3)
      if (!usable) return false
    }
    if (Array.from(excludedCats).some((cat: any) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
    if (checkConflicts(live, seg).length > 0) return false
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
    const segRemaining = tryAssign(live, seg, maxCount !== undefined ? Math.max(0, maxCount - live.exposure) : undefined, allowReuse)
    if (segRemaining) remaining.push(segRemaining)
    if (live.assignedAudiences.length > beforeLen) {
      assigned.push(seg)
      const idx = pool.indexOf(seg)
      if (idx !== -1) pool.splice(idx, 1)
    }
  }
  return { assigned, remaining }
}

// Run autoSchedule
const linePools: Record<string, any[]> = { health: [], beauty: [], interest: [] }
for (const seg of allSegments) {
  if (!linePools[seg.line]) linePools[seg.line] = []
  linePools[seg.line].push(seg)
}

function getLiveAllowedLines(live: any) {
  const lines = new Set<string>()
  lines.add(live.line)
  if (live.isJoint && live.lines) {
    for (const l of live.lines) lines.add(l)
  }
  const NEUTRAL_CATEGORIES = new Set(['东方养正瑜伽'])
  if (NEUTRAL_CATEGORIES.has(normalizeCategory(live.category))) {
    lines.add('health'); lines.add('beauty')
  }
  return Array.from(lines) as any[]
}

const scored = lives.map(live => {
  const gradeScore = { S: 100, A: 70, B: 40, C: 20, null: 10 }[live.grade || 'C'] || 10
  const slotBonus = { evening: 50, morning: 30, 'fake-evening': 20, 'fake-morning': 10, 'friend-circle': 0 }[live.slot] || 10
  const score = gradeScore + slotBonus
  return { live, score }
}).sort((a, b) => b.score - a.score)

// Round 1
for (const { live } of scored) {
  const target = getTarget(live)
  const allowedLines = getLiveAllowedLines(live)
  const primaryLine = live.line
  const linesToTry = allowedLines.includes(primaryLine) ? [primaryLine, ...allowedLines.filter((l: any) => l !== primaryLine)] : allowedLines
  for (const line of linesToTry) {
    if (!linePools[line] || linePools[line].length === 0) continue
    const best = pickBest(live, linePools[line], false)
    if (best) {
      const maxCount = Math.max(0, target - live.exposure)
      const beforeCount = live.assignedAudiences.length
      const remaining = tryAssign(live, best, maxCount)
      if (live.assignedAudiences.length !== beforeCount) {
        const idx = linePools[line].indexOf(best)
        if (idx !== -1) linePools[line].splice(idx, 1)
        if (remaining) linePools[remaining.line].push(remaining)
        const mergeResult = tryAssignMergeSweep(live, best, linePools[line], Math.max(0, maxCount - live.exposure), false)
        for (const r of mergeResult.remaining) linePools[r.line].push(r)
        break
      }
    }
  }
}

// Round 2
const round2Cap = (live: any) => {
  const base = getTarget(live)
  const mult = { S: 2.0, A: 1.8, B: 1.5, C: 1.2 }[live.grade || 'C'] || 1.2
  return Math.floor(base * mult)
}
let round2Changed = true, round2Iters = 0
while (round2Changed && round2Iters < 200) {
  round2Changed = false; round2Iters++
  const sorted = [...scored].sort((a, b) => b.score - a.score)
  for (const { live } of sorted) {
    const allowedLines = getLiveAllowedLines(live)
    const primaryLine = live.line
    const linesToTry = allowedLines.includes(primaryLine) ? [primaryLine, ...allowedLines.filter((l: any) => l !== primaryLine)] : allowedLines
    for (const line of linesToTry) {
      if (!linePools[line] || linePools[line].length === 0) continue
      const best = pickBest(live, linePools[line], true)
      if (best) {
        const beforeCount = live.assignedAudiences.length
        const cap = round2Cap(live)
        const maxCount = Math.max(0, cap - live.exposure)
        const remaining = tryAssign(live, best, maxCount, true)
        if (live.assignedAudiences.length !== beforeCount) {
          const idx = linePools[line].indexOf(best)
          if (idx !== -1) linePools[line].splice(idx, 1)
          if (remaining) linePools[remaining.line].push(remaining)
          const mergeResult = tryAssignMergeSweep(live, best, linePools[line], Math.max(0, maxCount - live.exposure), true)
          for (const r of mergeResult.remaining) linePools[r.line].push(r)
          round2Changed = true
          break
        }
      }
    }
  }
}

// Round 3
let round3Changed = true, round3Iters = 0
while (round3Changed && round3Iters < 200) {
  round3Changed = false; round3Iters++
  const sorted = [...scored].sort((a, b) => b.score - a.score)
  for (const { live } of sorted) {
    if (live.exposure > 0) continue
    const allowedLines = getLiveAllowedLines(live)
    const primaryLine = live.line
    const linesToTry = allowedLines.includes(primaryLine) ? [primaryLine, ...allowedLines.filter((l: any) => l !== primaryLine)] : allowedLines
    for (const line of linesToTry) {
      if (!linePools[line] || linePools[line].length === 0) continue
      const best = pickBest(live, linePools[line], false)
      if (best) {
        const beforeCount = live.assignedAudiences.length
        const remaining = tryAssign(live, best, undefined, false)
        if (live.assignedAudiences.length !== beforeCount) {
          const idx = linePools[line].indexOf(best)
          if (idx !== -1) linePools[line].splice(idx, 1)
          if (remaining) linePools[remaining.line].push(remaining)
          const mergeResult = tryAssignMergeSweep(live, best, linePools[line], undefined, false)
          for (const r of mergeResult.remaining) linePools[r.line].push(r)
          round3Changed = true
          break
        }
      }
    }
  }
}

// Output
console.log('\n========== 6.1-6.7 系统排期结果 ==========\n')
let totalSys = 0, totalSegs = 0
for (const { live } of scored) {
  const auds = live.assignedAudiences || []
  totalSys += live.exposure
  totalSegs += auds.length
  console.log(`${live.date} ${live.slot} ${live.name} (等级:${live.grade}) 目标:${getTarget(live).toLocaleString()}`)
  console.log(`  触达: ${live.exposure.toLocaleString()} 段:${auds.length}`)
  if (auds.length > 0) {
    for (const a of auds) {
      console.log(`    ${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
    }
  }
  if (live.fakeHistoryAudiences && live.fakeHistoryAudiences.length > 0) {
    console.log(`  上周记录·本周剔除:`)
    for (const a of live.fakeHistoryAudiences) {
      console.log(`    ${a.line} ${a.category}(${a.count.toLocaleString()}) ${a.timeRange}`)
    }
  }
  console.log('')
}
console.log(`\n总库存: ${allSegments.reduce((s, seg) => s + seg.count, 0).toLocaleString()}`)
console.log(`系统总触达: ${totalSys.toLocaleString()}`)
console.log(`系统总段数: ${totalSegs}`)
const unassigned = allSegments.filter(s => s.status === 'available')
console.log(`未分配段: ${unassigned.length} 人次: ${unassigned.reduce((s, seg) => s + seg.count, 0).toLocaleString()}`)
