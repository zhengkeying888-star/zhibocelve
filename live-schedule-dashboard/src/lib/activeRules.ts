export type RuleCategory =
  | 'exposure'
  | 'frequency'
  | 'priority'
  | 'category'
  | 'joint'
  | 'export'
  | 'cross-line'

export interface ActiveRule {
  id: string
  title: string
  category: RuleCategory
  description: string
  source: string
  priority?: number
  checkable: boolean
  auditorId?: string
}

export const RULE_CATEGORIES: Record<RuleCategory, { label: string; color: string }> = {
  exposure: { label: '曝光底线', color: 'bg-blue-100 text-blue-700' },
  frequency: { label: '频控复用', color: 'bg-purple-100 text-purple-700' },
  priority: { label: '分配优先级', color: 'bg-orange-100 text-orange-700' },
  category: { label: '品类映射', color: 'bg-emerald-100 text-emerald-700' },
  joint: { label: '联合直播', color: 'bg-pink-100 text-pink-700' },
  export: { label: '导出口径', color: 'bg-slate-100 text-slate-700' },
  'cross-line': { label: '跨线规则', color: 'bg-cyan-100 text-cyan-700' },
}

export const ACTIVE_RULES: ActiveRule[] = [
  {
    id: 'real-live-200k-floor',
    title: '真直播单场 20w 曝光底线',
    category: 'exposure',
    description:
      '所有真直播单场曝光统一以 200,000 为分配底线。15–20w 仅作为异常兜底区间，低于 150,000 不可接受。当补量约束与 audience 复用冲突时，20w 优先。',
    source: 'Codex 2026-06-07 / AGENTS.md',
    priority: 1,
    checkable: true,
    auditorId: 'real-live-exposure',
  },
  {
    id: 'fake-live-200k-floor',
    title: '伪直播/数字人 20w 左右底线',
    category: 'exposure',
    description:
      '伪直播/复用场、数字人后置承接目标优先接近 200,000，低于 150,000 需要解释 blocker。真直播的上限和优先级高于伪直播/数字人。',
    source: 'Codex 2026-06-07',
    priority: 1,
    checkable: true,
    auditorId: 'fake-live-exposure',
  },
  {
    id: 'audience-3d-2week',
    title: '同 audience 3天间隔 / 周最多2次',
    category: 'frequency',
    description:
      '同一个 audience 段可以跨天复用，但必须间隔至少 3 天，且一周最多 2 次。周一、周四、周日即使都满足间隔，也不能用第 3 次。',
    source: 'PRD v3.4 / MEMORY.md',
    priority: 2,
    checkable: true,
    auditorId: 'audience-reuse',
  },
  {
    id: 'audience-daily-dedup',
    title: 'Audience 当日去重',
    category: 'frequency',
    description: '同一天同一个 audience 段只能分配给一场直播。',
    source: 'PRD v3.4',
    priority: 2,
    checkable: true,
    auditorId: 'audience-reuse',
  },
  {
    id: 'fake-live-30d',
    title: '伪直播 30 天复用限制',
    category: 'frequency',
    description: '伪直播复用的 audience 段 30 天内不能被再次复用。',
    source: 'PRD v3.4',
    priority: 2,
    checkable: false,
  },
  {
    id: 'priority-order',
    title: '分配顺序：真直播 → 零曝光兜底 → 20w补齐 → 伪直播/数字人',
    category: 'priority',
    description:
      '伪直播/复用场不能参与主资源抢量。正确顺序是：真直播主分配 -> 零曝光兜底 -> 真直播 20w 底线补齐 -> 伪直播/数字人用剩余可用段后置承接。',
    source: 'Codex 2026-06-07 / AGENTS.md',
    priority: 3,
    checkable: true,
    auditorId: 'fake-live-priority',
  },
  {
    id: 'digital-human-limit',
    title: '数字人时间固定、最多3段、30w封顶',
    category: 'priority',
    description:
      '数字人资源位要保留具体品类，类型标记为 fake/低权重，但品类仍用于选择人群。数字人是固定事件，日期/时间不能自动调整；只能在当前日期补同线 available 或合规复用段，最多3段、总量30w封顶。',
    source: 'Codex 2026-06-08',
    priority: 3,
    checkable: false,
  },
  {
    id: 'fake-live-time-adjustable',
    title: '普通伪直播可调时间',
    category: 'frequency',
    description:
      '普通伪直播/复用场可以调整日期来满足同 audience 间隔≥3天、周最多2次的复用条件；该调整范围不包含任何名称含“数字人”的场次。',
    source: 'Codex 2026-06-08',
    priority: 2,
    checkable: false,
  },
  {
    id: 'category-normalization',
    title: '所有品类名必须先 normalizeCategory',
    category: 'category',
    description:
      '不同 Excel 里的品类名称可能不一致，系统通过 CATEGORY_ALIASES 和 CATEGORY_TO_LINE 做统一规范化。所有使用品类名做匹配的地方都必须先 normalize。',
    source: 'PRD v3.4 / CLAUDE.md',
    priority: 0,
    checkable: true,
    auditorId: 'category-mapping',
  },
  {
    id: 'category-family-exclusion',
    title: '同品类族排除（跨科直播不能宣发同品类族）',
    category: 'category',
    description:
      '跨科直播不能宣发同品类族 audience。排除/去重/5-family limit 场景必须使用 isSameCategoryFamily，不能用 ===。',
    source: 'PRD v3.3+ / MEMORY.md',
    priority: 0,
    checkable: true,
    auditorId: 'same-category',
  },
  {
    id: 'category-frequency-exact',
    title: '3 天频控使用 normalizeCategory 精确品类名',
    category: 'category',
    description:
      '频控用 normalizeCategory 精确品类名，不用 isSameCategoryFamily。太极BCD/太极SA/太极A 是同一 family 但不同用户等级段，3天内应允许分别触达。',
    source: 'PRD v3.4',
    priority: 0,
    checkable: false,
  },
  {
    id: 'joint-live-lines',
    title: '联合直播必须在所有涉及线级中实际分配 audience',
    category: 'joint',
    description:
      '联合直播承载多个子直播，排序时应高于普通同级晨练，并在涉及的每个 line group 中优先当前 line，确保跨线资源实际被分配。',
    source: 'Codex 2026-06-07 / feedback-joint-live-cross-line',
    priority: 3,
    checkable: true,
    auditorId: 'joint-live-allocation',
  },
  {
    id: 'cross-line-health-interest',
    title: '茶道可用 interest + health 资源',
    category: 'cross-line',
    description: '茶道属于兴趣/才艺线，但系统允许茶道使用 interest + health 资源。',
    source: 'Codex 2026-06-07',
    priority: 0,
    checkable: false,
  },
  {
    id: 'cross-line-beauty-health',
    title: '一杰瑜伽 / 东方养正瑜伽 允许 beauty → health',
    category: 'cross-line',
    description: '中性品类在 beauty 线时，允许向 health 线跨线分配。',
    source: 'PRD v3.4',
    priority: 0,
    checkable: false,
  },
  {
    id: 'export-merge',
    title: '导出合并口径：合并人数必须等于明细之和',
    category: 'export',
    description:
      '导出格式可以合并展示，目的是方便运营定时人群；但合并人数必须等于明细之和，不能造成同品类不同时间段合计误判。',
    source: 'Codex 2026-06-07',
    priority: 0,
    checkable: false,
  },
]
