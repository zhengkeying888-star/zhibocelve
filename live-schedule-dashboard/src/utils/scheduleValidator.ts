import type { LiveStream, AudienceSegment, CrossCategoryPref, LineType } from '@/types'
import { isSameCategoryFamily } from './categoryMapping'

export interface ValidationResult {
  passed: boolean
  errors: string[]
  warnings: string[]
  stats: {
    totalLives: number
    scheduledLives: number
    zeroExposureLives: number
    totalExposure: number
    crossLineViolations: number
    sameCategoryViolations: number
  }
}

export function validateSchedule(
  lives: LiveStream[],
  segments: AudienceSegment[],
  crossCategoryPrefs: CrossCategoryPref[]
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const stats = {
    totalLives: lives.length,
    scheduledLives: 0,
    zeroExposureLives: 0,
    totalExposure: 0,
    crossLineViolations: 0,
    sameCategoryViolations: 0,
  }

  // 1. Exhaustiveness check (friend-circle and fake lives excluded)
  for (const live of lives) {
    if (live.slot === 'friend-circle' || live.type === 'fake') continue
    stats.totalExposure += live.exposure
    if (live.exposure > 0) {
      stats.scheduledLives++
    } else {
      stats.zeroExposureLives++
      warnings.push(`[EXPOSURE_ZERO] ${live.name} (${live.line}, ${live.category}) exposure=0，未排上期`)
    }
  }

  // 2. Line check (supports joint live and neutral category cross-line)
  for (const live of lives) {
    const allowedLines: LineType[] =
      live.isJoint && live.lines && live.lines.length > 0
        ? live.lines
        : live.category === '茶道'
          ? ['interest', 'health']
        : (live.category === '一杰瑜伽' || live.category === '东方养正瑜伽') && live.line === 'beauty'
          ? ['beauty', 'health']
          : [live.line]
    for (const aud of live.assignedAudiences) {
      if (!allowedLines.includes(aud.line)) {
        stats.crossLineViolations++
        errors.push(
          `[CROSS_LINE] ${live.name} (${live.line}) 被错误分配了 ${aud.line} 线 audience: ${aud.category}`
        )
      }
    }
  }

  // 3. Same-category exclusion check
  for (const live of lives) {
    // 伪直播/数字人是后置承接位，允许使用真直播排完后的同品类剩余段或合规复用段。
    if (live.type === 'fake') continue
    for (const aud of live.assignedAudiences) {
      if (isSameCategoryFamily(live.category, aud.category)) {
        stats.sameCategoryViolations++
        errors.push(
          `[SAME_CATEGORY] ${live.name} (${live.category}) 被错误分配了同品类 audience: ${aud.category}`
        )
      }
    }
  }

  // 4. Daily dedup check
  const segmentDayMap = new Map<string, string>() // key: segmentId-date, value: liveId
  for (const live of lives) {
    for (const aud of live.assignedAudiences) {
      const key = `${aud.segmentId}-${live.date}`
      if (segmentDayMap.has(key)) {
        const otherLiveId = segmentDayMap.get(key)!
        errors.push(
          `[DUPLICATE_DAY] audience ${aud.category} ${aud.timeRange} 在 ${live.date} 被同时分配给 ${live.name} 和 ${otherLiveId}`
        )
      } else {
        segmentDayMap.set(key, live.id)
      }
    }
  }

  // 5. Segment status consistency
  const usedSegmentIds = new Set<string>()
  for (const live of lives) {
    for (const aud of live.assignedAudiences) {
      usedSegmentIds.add(aud.segmentId)
    }
  }
  for (const seg of segments) {
    const isUsed = usedSegmentIds.has(seg.id)
    if (isUsed && seg.status !== 'used') {
      errors.push(`[STATUS_MISMATCH] segment ${seg.category} ${seg.timeRange} 已被分配但状态不是 used`)
    }
    if (!isUsed && seg.status === 'used') {
      errors.push(`[STATUS_MISMATCH] segment ${seg.category} ${seg.timeRange} 状态为 used 但未出现在任何直播`)
    }
  }

  // 6. Attribution accuracy check
  for (const live of lives) {
    if (live.assignedAudiences.length === 0) continue
    let calcTotalExposure = 0
    for (const aud of live.assignedAudiences) {
      calcTotalExposure += aud.count
    }
    if (live.exposure !== calcTotalExposure) {
      errors.push(
        `[ATTRIBUTION] ${live.name} exposure(${live.exposure}) ≠ Σaudience.count(${calcTotalExposure})`
      )
    }
  }

  // 7. Target achievement check (warning level) — PRD v2.0 targets
  const targets: Record<string, number> = { S: 600000, A: 500000, B: 350000, C: 250000 }
  const minAcceptableExposure = 150000
  const preferredMinExposure = 200000
  for (const live of lives) {
    if (live.slot === 'friend-circle') continue
    if (live.type === 'real' && live.exposure > 0 && live.exposure < minAcceptableExposure) {
      warnings.push(
        `[EXPOSURE_FLOOR] ${live.name} exposure=${live.exposure}，低于真直播底线 ${minAcceptableExposure}（建议接近 ${preferredMinExposure}）`
      )
    }
    const target = live.target ?? targets[live.grade || 'C'] ?? 120000
    if (live.exposure < target) {
      warnings.push(
        `[TARGET_MISS] ${live.name} (${live.grade || '无评级'}) exposure=${live.exposure}，未达到目标 ${target}`
      )
    }
  }

  // 8. Conflict markers check
  for (const live of lives) {
    for (const reason of live.conflictReasons) {
      warnings.push(`[CONFLICT] ${live.name}: ${reason}`)
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    stats,
  }
}
