import type { LiveStream, AudienceSegment, LineType } from '@/types'
import { normalizeCategory, isSameCategoryFamily } from './categoryMapping'

export type AuditSeverity = 'pass' | 'warning' | 'fail'

export type AuditActionType = 'autoSchedule' | 'selectLive' | 'openCategoryManager' | 'openUploadModal'

export interface AuditAction {
  label: string
  type: AuditActionType
  targetId?: string
}

export interface AuditCheckItem {
  id: string
  title: string
  severity: AuditSeverity
  message: string
  details: string[]
  suggestions?: string[]
  actions?: AuditAction[]
  involvedLives?: string[]
  involvedSegments?: string[]
}

export interface AuditResult {
  generatedAt: number
  overall: {
    pass: number
    warning: number
    fail: number
    score: number // 0-100
  }
  checks: AuditCheckItem[]
}

const PREFERRED_MIN_EXPOSURE = 200000
const MIN_ACCEPTABLE_EXPOSURE = 150000

export function auditSchedule(
  lives: LiveStream[],
  segments: AudienceSegment[]
): AuditResult {
  const checks: AuditCheckItem[] = []

  checks.push(auditInventoryUtilization(lives, segments))
  checks.push(auditZeroExposureBlockers(lives, segments))
  checks.push(auditAllLiveFloor(lives))
  checks.push(auditRealLiveExposure(lives))
  checks.push(auditFakeLiveExposure(lives))
  checks.push(auditAudienceReuse(lives, segments))
  checks.push(auditFakeLivePriority(lives))
  checks.push(auditJointLiveAllocation(lives))
  checks.push(auditCategoryMapping(lives, segments))
  checks.push(auditCrossLineAssignment(lives))
  checks.push(auditSameCategoryExclusion(lives))
  checks.push(auditSegmentStatusConsistency(lives, segments))
  checks.push(auditExposureAttribution(lives))

  const pass = checks.filter((c) => c.severity === 'pass').length
  const warning = checks.filter((c) => c.severity === 'warning').length
  const fail = checks.filter((c) => c.severity === 'fail').length
  const total = checks.length
  const score = total === 0 ? 100 : Math.round(((pass + warning * 0.5) / total) * 100)

  return {
    generatedAt: Date.now(),
    overall: { pass, warning, fail, score },
    checks,
  }
}

/**
 * 0. 真直播 15w 不可接受底线（仅 real）
 * 数字人/伪直播的承接量不足单独在 auditFakeLiveExposure 中检查
 */
function auditAllLiveFloor(lives: LiveStream[]): AuditCheckItem {
  const fails: string[] = []
  const suggestions: string[] = []
  const involvedLives: string[] = []

  for (const live of lives) {
    if (live.type !== 'real' || live.slot === 'friend-circle') continue
    if (live.exposure > 0 && live.exposure < MIN_ACCEPTABLE_EXPOSURE) {
      fails.push(
        `${live.name} (${live.date}) exposure=${live.exposure.toLocaleString()}，低于真直播不可接受底线 ${MIN_ACCEPTABLE_EXPOSURE}`
      )
      suggestions.push(
        `建议为「${live.name}」补充同线可用 audience 段：优先使用 unused 大段（>5万），必要时在间隔≥3天前提下启用复用。`
      )
      involvedLives.push(live.id)
    }
  }

  if (fails.length > 0) {
    return {
      id: 'all-live-floor',
      title: '真直播 15w 不可接受底线',
      severity: 'fail',
      message: `${fails.length} 场真直播低于 15w 不可接受底线`,
      details: fails,
      suggestions,
      involvedLives,
    }
  }
  return {
    id: 'all-live-floor',
    title: '真直播 15w 不可接受底线',
    severity: 'pass',
    message: '所有真直播均达到 15w 不可接受底线',
    details: [],
  }
}

/**
 * 1. 真直播 20w 优先底线检查
 * - exposure 在 15w-20w：警告（建议补到 20w）
 * - exposure >= 20w：通过
 * - 低于 15w 已在 auditAllLiveFloor 中处理
 */
function auditRealLiveExposure(lives: LiveStream[]): AuditCheckItem {
  const warnings: string[] = []
  const suggestions: string[] = []
  const involvedLives: string[] = []

  for (const live of lives) {
    if (live.type !== 'real' || live.slot === 'friend-circle') continue
    if (live.exposure === 0) {
      warnings.push(`${live.name} (${live.date}) 当前 exposure=0，需确保兜底轮分配`)
      suggestions.push(`建议检查「${live.name}」是否在 autoSchedule 中被遗漏：确认品类映射是否正确、是否为 friend-circle 被排除、或 audience 库存是否不足。`)
      involvedLives.push(live.id)
      continue
    }
    if (live.exposure >= MIN_ACCEPTABLE_EXPOSURE && live.exposure < PREFERRED_MIN_EXPOSURE) {
      warnings.push(
        `${live.name} (${live.date}) exposure=${live.exposure.toLocaleString()}，在 15-20w 区间，建议补到 ${PREFERRED_MIN_EXPOSURE}`
      )
      suggestions.push(
        `建议为「${live.name}」补充同线可用 audience 段：优先使用 unused 段，若同品类族大段已用完，可尝试跨品类族；在间隔≥3天前提下可启用复用。`
      )
      involvedLives.push(live.id)
    }
  }

  if (warnings.length > 0) {
    return {
      id: 'real-live-exposure',
      title: '真直播 20w 优先底线',
      severity: 'warning',
      message: `${warnings.length} 场真直播在 15-20w 区间`,
      details: warnings,
      suggestions,
      involvedLives,
    }
  }
  return {
    id: 'real-live-exposure',
    title: '真直播 20w 优先底线',
    severity: 'pass',
    message: '所有真直播均达到 20w 优先底线',
    details: [],
  }
}

/**
 * 2. 伪直播/数字人 15w 后置承接底线检查
 * - 数字人/伪直播作为后置承接，低于 15w 标为警告（不是失败）
 * - 建议：优先 1 个大段；单段不足 15w 时允许最多 2 段补齐
 * - 允许使用同品类剩余段
 */
function auditFakeLiveExposure(lives: LiveStream[]): AuditCheckItem {
  const warnings: string[] = []
  const suggestions: string[] = []
  const involvedLives: string[] = []

  for (const live of lives) {
    if (live.type !== 'fake' || live.slot === 'friend-circle') continue
    const isDigitalHuman = live.name.includes('数字人')
    if (live.exposure > 0 && live.exposure < MIN_ACCEPTABLE_EXPOSURE) {
      warnings.push(
        `${live.name} (${live.date}) exposure=${live.exposure.toLocaleString()}，低于后置承接底线 ${MIN_ACCEPTABLE_EXPOSURE}`
      )
      if (isDigitalHuman) {
        suggestions.push(
          `数字人「${live.name}」时间不可调整：只能在当前日期补同线 available 段或满足间隔≥3天、周内最多2次的同线复用段；若仍低于15w，应标记为同线库存不足，不能通过移动日期或跨线补量解决。`
        )
      } else {
        suggestions.push(
          `伪直播「${live.name}」后置承接不足：可先补同线 available/可复用段；若当前日期不满足3天复用条件，可建议移动伪直播时间，但该规则不适用于数字人。`
        )
      }
      involvedLives.push(live.id)
    } else if (live.exposure >= MIN_ACCEPTABLE_EXPOSURE && live.exposure < PREFERRED_MIN_EXPOSURE) {
      warnings.push(
        `${live.name} (${live.date}) exposure=${live.exposure.toLocaleString()}，在 15-20w 区间，建议补到 ${PREFERRED_MIN_EXPOSURE}`
      )
      if (isDigitalHuman) {
        suggestions.push(
          `数字人「${live.name}」已达15w底线后只做同日期同线补量建议；不得建议移动数字人时间。`
        )
      } else {
        suggestions.push(
          `伪直播「${live.name}」可在真直播主分配完成后，使用剩余 available/同线可复用段补到20w；必要时可建议调整伪直播时间以满足3天复用。`
        )
      }
      involvedLives.push(live.id)
    }
  }

  if (warnings.length > 0) {
    return {
      id: 'fake-live-exposure',
      title: '伪直播/数字人后置承接量',
      severity: 'warning',
      message: `${warnings.length} 场伪直播/数字人后置承接不足`,
      details: warnings,
      suggestions,
      involvedLives,
    }
  }
  return {
    id: 'fake-live-exposure',
    title: '伪直播/数字人后置承接量',
    severity: 'pass',
    message: '伪直播/数字人后置承接量正常',
    details: [],
  }
}

/**
 * 3. Audience 复用频控检查
 */
function auditAudienceReuse(lives: LiveStream[], segments: AudienceSegment[]): AuditCheckItem {
  const fails: string[] = []
  const warnings: string[] = []
  const suggestions: string[] = []
  const involvedSegments: string[] = []

  const segmentAssignments = new Map<string, { liveId: string; date: string }[]>()
  for (const live of lives) {
    for (const aud of live.assignedAudiences) {
      if (!segmentAssignments.has(aud.segmentId)) {
        segmentAssignments.set(aud.segmentId, [])
      }
      segmentAssignments.get(aud.segmentId)!.push({ liveId: live.id, date: live.date })
    }
  }

  for (const [segId, assignments] of segmentAssignments) {
    const seg = segments.find((s) => s.id === segId)
    if (!seg) continue

    const dayMap = new Map<string, string[]>()
    for (const a of assignments) {
      if (!dayMap.has(a.date)) dayMap.set(a.date, [])
      dayMap.get(a.date)!.push(a.liveId)
    }
    for (const [date, liveIds] of dayMap) {
      if (liveIds.length > 1) {
        const liveNames = liveIds
          .map((id) => lives.find((l) => l.id === id)?.name || id)
          .join('、')
        fails.push(`${seg.category} ${seg.timeRange} 在 ${date} 被同时分配给：${liveNames}`)
        suggestions.push(`当日去重违规：请从上述直播中移除一个 ${seg.category} ${seg.timeRange} 的分配，确保同一天只触达一次。`)
        involvedSegments.push(segId)
      }
    }

    if (assignments.length > 2) {
      fails.push(`${seg.category} ${seg.timeRange} 本周被触达 ${assignments.length} 次，超过周上限 2 次`)
      suggestions.push(`周频控违规：请减少 ${seg.category} ${seg.timeRange} 的触达次数，保留效果最好的 2 场，其余移除。`)
      involvedSegments.push(segId)
    }

    const sortedDates = assignments
      .map((a) => resolveDate(a.date, lives))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())
    for (let i = 1; i < sortedDates.length; i++) {
      const diffDays = Math.floor(
        (sortedDates[i].getTime() - sortedDates[i - 1].getTime()) / (1000 * 60 * 60 * 24)
      )
      if (diffDays < 3) {
        fails.push(`${seg.category} ${seg.timeRange} 两次触达间隔 ${diffDays} 天，小于 3 天`)
        suggestions.push(`3天间隔违规：请将 ${seg.category} ${seg.timeRange} 的两次触达间隔拉开到至少 3 天，或更换为其他 audience 段。`)
        involvedSegments.push(segId)
      }
    }
  }

  for (const seg of segments) {
    const actualCount = segmentAssignments.get(seg.id)?.length || 0
    const recordedCount = seg.assignedDates?.length || 0
    if (actualCount !== recordedCount) {
      warnings.push(
        `${seg.category} ${seg.timeRange} assignedDates 记录(${recordedCount})与实际分配(${actualCount})不一致`
      )
      suggestions.push(`数据不一致：建议重新运行 autoSchedule 或手动检查 ${seg.category} ${seg.timeRange} 的分配记录。`)
      involvedSegments.push(seg.id)
    }
  }

  if (fails.length > 0) {
    return {
      id: 'audience-reuse',
      title: 'Audience 复用频控（3天/周2次/当日去重）',
      severity: 'fail',
      message: `发现 ${fails.length} 处频控违规${warnings.length > 0 ? `，另有 ${warnings.length} 处记录不一致` : ''}`,
      details: [...fails, ...warnings],
      suggestions,
      involvedSegments: Array.from(new Set(involvedSegments)),
    }
  }
  if (warnings.length > 0) {
    return {
      id: 'audience-reuse',
      title: 'Audience 复用频控（3天/周2次/当日去重）',
      severity: 'warning',
      message: `发现 ${warnings.length} 处记录不一致`,
      details: warnings,
      suggestions,
      involvedSegments: Array.from(new Set(involvedSegments)),
    }
  }
  return {
    id: 'audience-reuse',
    title: 'Audience 复用频控（3天/周2次/当日去重）',
    severity: 'pass',
    message: '所有 audience 段复用符合频控规则',
    details: [],
  }
}

/**
 * 4. 伪直播/数字人后置承接优先级检查
 */
function auditFakeLivePriority(lives: LiveStream[]): AuditCheckItem {
  const warnings: string[] = []
  const suggestions: string[] = []
  const involvedLives: string[] = []

  const realLives = lives.filter((l) => l.type === 'real' && l.slot !== 'friend-circle')
  const fakeLives = lives.filter((l) => l.type === 'fake' && l.slot !== 'friend-circle')

  const realBelowMin = realLives.filter((l) => l.exposure > 0 && l.exposure < MIN_ACCEPTABLE_EXPOSURE)
  const fakeAboveReal = fakeLives.filter((fl) => {
    if (fl.exposure <= PREFERRED_MIN_EXPOSURE) return false
    const sameDayReal = realLives.filter(
      (rl) => rl.date === fl.date && rl.exposure < fl.exposure && rl.exposure < PREFERRED_MIN_EXPOSURE
    )
    return sameDayReal.length > 0
  })

  if (realBelowMin.length > 0) {
    warnings.push(`${realBelowMin.length} 场真直播未达 15w 底线`)
    suggestions.push(`建议优先保证真直播 15w 底线：检查同日期伪直播/数字人是否占用了本该分配给真直播的 audience 段，可尝试将真直播前置分配。`)
    realBelowMin.forEach((l) => involvedLives.push(l.id))
  }

  for (const fl of fakeAboveReal) {
    warnings.push(
      `${fl.name} (${fl.date}) exposure=${fl.exposure.toLocaleString()}，高于部分同天真直播，可能优先级异常`
    )
    suggestions.push(`建议降低「${fl.name}」的分配优先级，确保同天真直播优先达到 20w 后再为伪直播/数字人补充剩余段。`)
    involvedLives.push(fl.id)
  }

  if (warnings.length > 0) {
    return {
      id: 'fake-live-priority',
      title: '伪直播/数字人后置承接',
      severity: 'warning',
      message: `发现 ${warnings.length} 处优先级异常信号`,
      details: warnings,
      suggestions,
      involvedLives: Array.from(new Set(involvedLives)),
    }
  }
  return {
    id: 'fake-live-priority',
    title: '伪直播/数字人后置承接',
    severity: 'pass',
    message: '伪直播/数字人未挤压真直播主资源',
    details: [],
  }
}

/**
 * 5. 联合直播跨线分配检查
 */
function auditJointLiveAllocation(lives: LiveStream[]): AuditCheckItem {
  const fails: string[] = []
  const warnings: string[] = []
  const suggestions: string[] = []
  const involvedLives: string[] = []

  for (const live of lives) {
    if (!live.isJoint || !live.lines || live.lines.length === 0) continue

    const assignedLines = new Set<LineType>()
    for (const aud of live.assignedAudiences) {
      assignedLines.add(aud.line)
    }

    const missingLines = live.lines.filter((l) => !assignedLines.has(l))
    if (missingLines.length > 0) {
      fails.push(
        `${live.name} 为联合直播，涉及 line：${live.lines.join('、')}，但未在 ${missingLines.join('、')} 线分配 audience`
      )
      suggestions.push(`建议为「${live.name}」在 ${missingLines.join('、')} 线补充 audience 段：联合直播必须在所有涉及线级中实际分配资源。`)
      involvedLives.push(live.id)
    }

    if (live.exposure < PREFERRED_MIN_EXPOSURE && live.exposure > 0) {
      warnings.push(
        `${live.name} exposure=${live.exposure.toLocaleString()}，联合直播建议达到 ${PREFERRED_MIN_EXPOSURE} 以上`
      )
      suggestions.push(`建议为联合直播「${live.name}」补充 audience 段至 20w 以上，联合直播承载多个子直播，目标通常高于普通直播。`)
      involvedLives.push(live.id)
    }
  }

  if (fails.length > 0) {
    return {
      id: 'joint-live-allocation',
      title: '联合直播跨线资源分配',
      severity: 'fail',
      message: `${fails.length} 场联合直播存在跨线分配缺失${warnings.length > 0 ? `，另有 ${warnings.length} 场未达 20w` : ''}`,
      details: [...fails, ...warnings],
      suggestions,
      involvedLives: Array.from(new Set(involvedLives)),
    }
  }
  if (warnings.length > 0) {
    return {
      id: 'joint-live-allocation',
      title: '联合直播跨线资源分配',
      severity: 'warning',
      message: `${warnings.length} 场联合直播未达 20w 底线`,
      details: warnings,
      suggestions,
      involvedLives: Array.from(new Set(involvedLives)),
    }
  }
  return {
    id: 'joint-live-allocation',
    title: '联合直播跨线资源分配',
    severity: 'pass',
    message: '联合直播跨线资源分配正常',
    details: [],
  }
}

/**
 * 6. 品类映射检查
 */
function auditCategoryMapping(lives: LiveStream[], segments: AudienceSegment[]): AuditCheckItem {
  const warnings: string[] = []
  const suggestions: string[] = []
  const involvedLives: string[] = []
  const involvedSegments: string[] = []

  const seenCategories = new Set<string>()
  for (const live of lives) {
    if (live.category) seenCategories.add(live.category)
  }
  for (const seg of segments) {
    seenCategories.add(seg.category)
  }

  for (const cat of seenCategories) {
    const normalized = normalizeCategory(cat)
    if (!normalized || normalized === cat.toLowerCase()) {
      warnings.push(`品类 "${cat}" 规范化结果需要关注：${normalized}`)
      suggestions.push(`建议检查 CATEGORY_ALIASES 和 CATEGORY_TO_LINE 映射表，确认 "${cat}" 是否有对应的标准名和线级映射。`)
    }
  }

  for (const live of lives) {
    if (!live.category) {
      warnings.push(`${live.name} 未设置品类`)
      suggestions.push(`建议为「${live.name}」手动设置品类，或在 nameOverrides 中建立直播名→品类的映射。`)
      involvedLives.push(live.id)
    }
  }

  if (warnings.length > 0) {
    return {
      id: 'category-mapping',
      title: '品类映射完整性',
      severity: 'warning',
      message: `发现 ${warnings.length} 处品类映射需要关注`,
      details: warnings,
      suggestions,
      involvedLives: Array.from(new Set(involvedLives)),
      involvedSegments: Array.from(new Set(involvedSegments)),
    }
  }
  return {
    id: 'category-mapping',
    title: '品类映射完整性',
    severity: 'pass',
    message: '所有品类已正确映射',
    details: [],
  }
}

/**
 * 7. 跨线分配检查
 */
function auditCrossLineAssignment(lives: LiveStream[]): AuditCheckItem {
  const fails: string[] = []
  const suggestions: string[] = []
  const involvedLives: string[] = []

  for (const live of lives) {
    const allowedLines = getAllowedLinesForLive(live)
    for (const aud of live.assignedAudiences) {
      if (!allowedLines.includes(aud.line)) {
        fails.push(
          `${live.name} (${live.line}) 被错误分配了 ${aud.line} 线 audience: ${aud.category}`
        )
        suggestions.push(`建议将「${live.name}」的 ${aud.category} (${aud.line} 线) 移除，替换为 ${allowedLines.join(' 或 ')} 线的可用 audience 段。`)
        involvedLives.push(live.id)
      }
    }
  }

  if (fails.length > 0) {
    return {
      id: 'cross-line',
      title: '跨线分配合规性',
      severity: 'fail',
      message: `发现 ${fails.length} 处跨线分配违规`,
      details: fails,
      suggestions,
      involvedLives: Array.from(new Set(involvedLives)),
    }
  }
  return {
    id: 'cross-line',
    title: '跨线分配合规性',
    severity: 'pass',
    message: '所有 audience 线级分配符合规则',
    details: [],
  }
}

/**
 * 8. 同品类排除检查
 */
function auditSameCategoryExclusion(lives: LiveStream[]): AuditCheckItem {
  const fails: string[] = []
  const suggestions: string[] = []
  const involvedLives: string[] = []

  for (const live of lives) {
    // 伪直播/数字人作为后置承接位，允许使用同品类剩余/复用段。
    if (live.type === 'fake') continue
    const excludedCats = live.isJoint && live.categories
      ? new Set(live.categories.map((c) => normalizeCategory(c)))
      : new Set([normalizeCategory(live.category)])

    for (const aud of live.assignedAudiences) {
      if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, aud.category))) {
        fails.push(
          `${live.name} (${live.category}) 被错误分配了同品类族 audience: ${aud.category}`
        )
        suggestions.push(`建议将「${live.name}」的 ${aud.category} 移除，更换为不同品类族的 audience 段；跨科直播不能宣发同品类族。`)
        involvedLives.push(live.id)
      }
    }
  }

  if (fails.length > 0) {
    return {
      id: 'same-category',
      title: '同品类族排除',
      severity: 'fail',
      message: `发现 ${fails.length} 处同品类族违规`,
      details: fails,
      suggestions,
      involvedLives: Array.from(new Set(involvedLives)),
    }
  }
  return {
    id: 'same-category',
    title: '同品类族排除',
    severity: 'pass',
    message: '无同品类族违规分配',
    details: [],
  }
}

/**
 * 9. Segment 状态一致性
 */
function auditSegmentStatusConsistency(lives: LiveStream[], segments: AudienceSegment[]): AuditCheckItem {
  const fails: string[] = []
  const suggestions: string[] = []
  const involvedSegments: string[] = []

  const usedIds = new Set<string>()
  for (const live of lives) {
    for (const aud of live.assignedAudiences) {
      usedIds.add(aud.segmentId)
    }
  }

  for (const seg of segments) {
    const isUsed = usedIds.has(seg.id)
    if (isUsed && seg.status !== 'used') {
      fails.push(`${seg.category} ${seg.timeRange} 已被分配但状态不是 used`)
      suggestions.push(`建议手动将 ${seg.category} ${seg.timeRange} 的 status 修正为 'used'，或重新运行 autoSchedule 统一修正状态。`)
      involvedSegments.push(seg.id)
    }
    if (!isUsed && seg.status === 'used') {
      fails.push(`${seg.category} ${seg.timeRange} 状态为 used 但未出现在任何直播`)
      suggestions.push(`建议检查 ${seg.category} ${seg.timeRange} 是否被误标记为 used，或重新运行 autoSchedule 重置状态。`)
      involvedSegments.push(seg.id)
    }
  }

  if (fails.length > 0) {
    return {
      id: 'segment-status',
      title: 'Segment 状态一致性',
      severity: 'fail',
      message: `发现 ${fails.length} 处 segment 状态不一致`,
      details: fails,
      suggestions,
      involvedSegments: Array.from(new Set(involvedSegments)),
    }
  }
  return {
    id: 'segment-status',
    title: 'Segment 状态一致性',
    severity: 'pass',
    message: 'Segment 状态一致',
    details: [],
  }
}

/**
 * 10. Exposure 归因一致性
 */
function auditExposureAttribution(lives: LiveStream[]): AuditCheckItem {
  const fails: string[] = []
  const suggestions: string[] = []
  const involvedLives: string[] = []

  for (const live of lives) {
    if (live.assignedAudiences.length === 0) continue
    const calc = live.assignedAudiences.reduce((sum, a) => sum + a.count, 0)
    if (live.exposure !== calc) {
      fails.push(`${live.name} exposure(${live.exposure}) ≠ Σaudience.count(${calc})`)
      suggestions.push(`建议检查「${live.name}」的 exposure 计算逻辑：确认是否有手动调整未同步到 assignedAudiences，或重新运行 autoSchedule 重新计算。`)
      involvedLives.push(live.id)
    }
  }

  if (fails.length > 0) {
    return {
      id: 'exposure-attribution',
      title: 'Exposure 归因一致性',
      severity: 'fail',
      message: `发现 ${fails.length} 场 exposure 与分配明细不一致`,
      details: fails,
      suggestions,
      involvedLives: Array.from(new Set(involvedLives)),
    }
  }
  return {
    id: 'exposure-attribution',
    title: 'Exposure 归因一致性',
    severity: 'pass',
    message: '所有 exposure 与分配明细一致',
    details: [],
  }
}

/**
 * 11. Audience 库存利用率检查
 * 解释总触达与目标库存差异
 */
function auditInventoryUtilization(lives: LiveStream[], segments: AudienceSegment[]): AuditCheckItem {
  const totalInventory = segments.reduce((sum, s) => sum + s.count, 0)
  const assignedToReal = lives
    .filter((l) => l.type === 'real' && l.slot !== 'friend-circle')
    .reduce((sum, l) => sum + l.exposure, 0)
  const assignedToFake = lives
    .filter((l) => l.type === 'fake' && l.slot !== 'friend-circle')
    .reduce((sum, l) => sum + l.exposure, 0)
  const remainingSegments = segments.filter((s) => s.status === 'available')
  const remaining = remainingSegments.reduce((sum, s) => sum + s.count, 0)

  const realUtilization = totalInventory > 0 ? (assignedToReal / totalInventory) * 100 : 0

  const details: string[] = []
  const suggestions: string[] = []

  details.push(`总库存：${totalInventory.toLocaleString()}`)
  details.push(`已分配给真直播：${assignedToReal.toLocaleString()}`)
  details.push(`已分配给伪直播/数字人：${assignedToFake.toLocaleString()}`)
  details.push(`剩余可用：${remaining.toLocaleString()}`)
  details.push(`真直播利用率：${realUtilization.toFixed(1)}%`)

  // 深入分析剩余段特征
  if (remainingSegments.length > 0) {
    const avgSize = remaining / remainingSegments.length
    const smallSegments = remainingSegments.filter((s) => s.count < 50000)
    const byLine: Record<string, number> = {}
    const byCategory: Record<string, number> = {}
    for (const s of remainingSegments) {
      byLine[s.line] = (byLine[s.line] || 0) + s.count
      byCategory[s.category] = (byCategory[s.category] || 0) + s.count
    }

    details.push(`剩余段数：${remainingSegments.length}，平均段大小：${Math.round(avgSize).toLocaleString()}`)
    details.push(`小段（<5万）占比：${smallSegments.length}/${remainingSegments.length}`)
    details.push(`剩余按线分布：${Object.entries(byLine).map(([l, c]) => `${l} ${(c / 10000).toFixed(1)}w`).join('、')}`)
    details.push(`剩余按品类分布：${Object.entries(byCategory).slice(0, 5).map(([c, n]) => `${c} ${(n / 10000).toFixed(1)}w`).join('、')}`)

    // 启发式：为什么剩余段没被分配
    if (avgSize < 30000) {
      suggestions.push(`剩余段平均大小仅 ${Math.round(avgSize).toLocaleString()}，多为小段碎片，可能因「小段拼凑限制（同品类族小段不超过2个）」或「tryAssign 最小拆分比例（0.1/0.3）」被过滤。`)
    }

    // 检查是否有真直播因段数上限已满而无法接收
    const realLivesAtSegmentCap = lives.filter(
      (l) => l.type === 'real' && l.slot !== 'friend-circle'
    ).filter((l) => {
      const maxSegs = { S: 10, A: 8, B: 7, C: 5 }[l.grade || 'C'] ?? 5
      return l.assignedAudiences.length >= maxSegs
    })
    if (realLivesAtSegmentCap.length > 0) {
      suggestions.push(`${realLivesAtSegmentCap.length} 场真直播已达段数上限（S=10, A=8, B/C=7/5），无法继续接收剩余段。`)
    }

    // 检查是否有真直播因品类族上限已满
    const realLivesAtFamilyCap = lives.filter(
      (l) => l.type === 'real' && l.slot !== 'friend-circle'
    ).filter((l) => {
      const maxFamilies = l.grade === 'S' ? 5 : l.grade === 'A' ? 4 : 3
      const families = new Set(l.assignedAudiences.map((a) => a.category))
      return families.size >= maxFamilies
    })
    if (realLivesAtFamilyCap.length > 0) {
      suggestions.push(`${realLivesAtFamilyCap.length} 场真直播已达品类族上限（S=5, A=4, B/C=3），无法接收新品类族 audience。`)
    }

    // 如果某条线剩余特别多，提示 line 不匹配
    for (const [line, count] of Object.entries(byLine)) {
      if (count > remaining * 0.4) {
        suggestions.push(`${line} 线剩余 ${(count / 10000).toFixed(1)}w 占比过高，可能因该线真直播已达标或 line 不匹配导致。`)
      }
    }

    suggestions.push(`剩余 ${remaining.toLocaleString()} audience 尚未分配，可点击「重新自动排期」尝试将剩余段分配给未达标的直播。`)
  }

  if (assignedToFake > assignedToReal * 0.3) {
    suggestions.push(`伪直播/数字人分配占比过高（${(assignedToFake / 10000).toFixed(1)}w），建议检查是否真直播已达到 20w 底线后再分配给伪直播。`)
  }

  const actions: AuditAction[] = []
  if (remaining > 0 || assignedToReal < totalInventory * 0.85) {
    actions.push({ label: '重新自动排期', type: 'autoSchedule' })
  }

  if (remaining > 0) {
    return {
      id: 'inventory-utilization',
      title: 'Audience 库存利用率',
      severity: 'warning',
      message: `真直播利用率 ${realUtilization.toFixed(1)}%，剩余 ${(remaining / 10000).toFixed(1)}w 未分配`,
      details,
      suggestions,
      actions,
    }
  }

  return {
    id: 'inventory-utilization',
    title: 'Audience 库存利用率',
    severity: 'pass',
    message: `真直播利用率 ${realUtilization.toFixed(1)}%，库存分配充分`,
    details,
    suggestions,
    actions,
  }
}

/**
 * 12. 0 曝光直播 blocker 原因分析
 * 解释为什么某些直播 exposure=0：线库存耗尽、跨线限制、品类排除等
 */
function auditZeroExposureBlockers(lives: LiveStream[], segments: AudienceSegment[]): AuditCheckItem {
  const zeroLives = lives.filter((l) => l.slot !== 'friend-circle' && l.exposure === 0)
  if (zeroLives.length === 0) {
    return {
      id: 'zero-exposure-blockers',
      title: '0 曝光直播 blocker 分析',
      severity: 'pass',
      message: '无 0 曝光直播',
      details: [],
    }
  }

  const details: string[] = []
  const suggestions: string[] = []
  const involvedLives: string[] = []

  for (const live of zeroLives) {
    const line = live.line
    const allowedLines = getAllowedLinesForLive(live)
    const remainingByLine: Record<string, number> = {}
    for (const l of allowedLines) {
      remainingByLine[l] = segments
        .filter((s) => s.line === l && s.status === 'available')
        .reduce((sum, s) => sum + s.count, 0)
    }
    const totalRemainingInAllowed = Object.values(remainingByLine).reduce((a, b) => a + b, 0)

    if (totalRemainingInAllowed === 0) {
      // 检查其他线是否有剩余
      const otherLines = (['health', 'beauty', 'interest'] as LineType[]).filter(
        (l) => !allowedLines.includes(l)
      )
      const otherRemaining = otherLines
        .map((l) => ({
          line: l,
          count: segments
            .filter((s) => s.line === l && s.status === 'available')
            .reduce((sum, s) => sum + s.count, 0),
        }))
        .filter((o) => o.count > 0)

      if (otherRemaining.length > 0) {
        details.push(
          `${live.name} (${line}) exposure=0，所属线 ${allowedLines.join('/')} 剩余 0；${otherRemaining
            .map((o) => `${o.line} ${(o.count / 10000).toFixed(1)}w`)
            .join('、')} 虽有剩余，但跨线兜底违反合规红线，禁止执行。`
        )
        suggestions.push(
          `「${live.name}」所属线库存不足，且跨线分配违反 line 合规红线。宁可不排，也不能用其他线 audience 补量。建议检查该线真直播是否过度分配，或上传更多 ${allowedLines.join('/')} 线 audience。`
        )
      } else {
        details.push(
          `${live.name} (${line}) exposure=0，所有允许线剩余库存均为 0，可能 audience 量级表未上传或库存不足。`
        )
        suggestions.push(
          `建议检查 audience 量级表是否正确上传，或该周 ${allowedLines.join('/')} 线 audience 总库存是否不足。`
        )
      }
    } else {
      details.push(
        `${live.name} (${line}) exposure=0，但所属线仍有 ${(totalRemainingInAllowed / 10000).toFixed(
          1
        )}w 剩余，可能因品类排除、频控冲突或段数上限导致无法分配。`
      )
      suggestions.push(
        `建议手动选中「${live.name}」查看左侧智能推荐，确认是否有可用段被频控或品类族上限阻止。`
      )
    }
    involvedLives.push(live.id)
  }

  return {
    id: 'zero-exposure-blockers',
    title: '0 曝光直播 blocker 分析',
    severity: 'warning',
    message: `${zeroLives.length} 场直播 exposure=0，已分析 blocker 原因`,
    details,
    suggestions,
    involvedLives,
  }
}

// Helpers
function getAllowedLinesForLive(live: LiveStream): LineType[] {
  if (live.isJoint && live.lines && live.lines.length > 0) {
    return live.lines
  }
  if (live.category === '茶道') {
    return ['interest', 'health']
  }
  if ((live.category === '一杰瑜伽' || live.category === '东方养正瑜伽') && live.line === 'beauty') {
    return ['beauty', 'health']
  }
  return [live.line]
}

function resolveDate(dateStr: string, lives: LiveStream[]): Date | null {
  const live = lives.find((l) => l.date === dateStr)
  if (live) {
    const full = parseFullDate(dateStr)
    if (full) return full
  }
  const parsed = new Date(dateStr)
  return isNaN(parsed.getTime()) ? null : parsed
}

function parseFullDate(dateStr: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const d = new Date(dateStr)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}
