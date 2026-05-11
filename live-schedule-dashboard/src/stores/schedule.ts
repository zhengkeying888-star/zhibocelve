import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type {
  LiveStream,
  AudienceSegment,
  HistoryRecord,
  CrossPref,
  CrossCategoryPref,
  FakeLiveHistoryItem,
  LineType,
  SlotType,
  GradeType,
  AssignedAudience,
  WeekDay,
  LiveAttribution,
  AttributionItem,
} from '@/types'
import { normalizeCategory, isSameCategoryFamily, parseLineFromCategory } from '@/utils/categoryMapping'
import { validateSchedule } from '@/utils/scheduleValidator'
import { loadScheduleState, saveScheduleState, subscribeToChanges } from '@/lib/cloudSync'
import type { ScheduleState } from '@/lib/cloudSync'
import { DEFAULT_CATEGORY_LINES, DEFAULT_CATEGORY_GRADES } from '@/lib/defaultCategoryMappings'

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export const useScheduleStore = defineStore('schedule', () => {
  // ========== State ==========
  const liveStreams = ref<LiveStream[]>([])
  const audienceSegments = ref<AudienceSegment[]>([])
  const historyRecords = ref<HistoryRecord[]>([])
  const crossPrefs = ref<CrossPref[]>([])
  const crossCategoryPrefs = ref<CrossCategoryPref[]>([])
  const fakeLiveHistory = ref<FakeLiveHistoryItem[]>([])

  const selectedLiveId = ref<string | null>(null)
  const currentWeek = ref('2026.4.27 - 5.3')
  const weekDays = ref([
    { label: '周一', date: '4/27', fullDate: '2026-04-27' },
    { label: '周二', date: '4/28', fullDate: '2026-04-28' },
    { label: '周三', date: '4/29', fullDate: '2026-04-29' },
    { label: '周四', date: '4/30', fullDate: '2026-04-30' },
    { label: '周五', date: '5/1', fullDate: '2026-05-01' },
    { label: '周六', date: '5/2', fullDate: '2026-05-02' },
    { label: '周日', date: '5/3', fullDate: '2026-05-03' },
  ])

  const uploadStatus = ref({
    schedule: false,
    audience: false,
    history: false,
    crossPref: false,
    fakeHistory: false,
  })

  // Category / line / grade mappings (persisted in cloud)
  const categoryGrades = ref<Record<string, GradeType>>({ ...DEFAULT_CATEGORY_GRADES })
  const categoryLines = ref<Record<string, LineType>>({ ...DEFAULT_CATEGORY_LINES })
  const nameOverrides = ref<Record<string, { category: string; line: LineType }>>({})

  // Global calibration multiplier (temporary fix for crossRate underestimation)
  const gmvMultiplier = ref(18)

  // PRD v2.0: neutral categories that can cross beauty → health
  const NEUTRAL_CATEGORIES = new Set(['一杰瑜伽', '东方养正瑜伽'])

  // PRD v2.0 target exposure
  const TARGET_EXPOSURE: Record<string, number> = {
    S: 350000,
    A: 220000,
    B: 150000,
    C: 120000,
  }

  // Learned rules from manual adjustments
  interface LearnedRule {
    id: string
    liveCategory: string
    fromCategory: string
    toCategory: string
    reason: string
    timestamp: number
  }
  const learnedRules = ref<LearnedRule[]>([])
  const pendingAdjustment = ref<{ liveId: string; segmentId: string; fromLiveId?: string } | null>(null)

  // ========== Cloud Sync ==========
  let isLoadingFromCloud = false
  let isAutoScheduling = false

  function serializeState(): ScheduleState {
    return {
      currentWeek: currentWeek.value,
      weekDays: weekDays.value,
      liveStreams: liveStreams.value,
      audienceSegments: audienceSegments.value,
      historyRecords: historyRecords.value,
      crossPrefs: crossPrefs.value,
      crossCategoryPrefs: crossCategoryPrefs.value,
      fakeLiveHistory: fakeLiveHistory.value,
      categoryGrades: categoryGrades.value,
      categoryLines: categoryLines.value,
      nameOverrides: nameOverrides.value,
      gmvMultiplier: gmvMultiplier.value,
      learnedRules: learnedRules.value,
    }
  }

  function deserializeState(state: ScheduleState) {
    if (state.learnedRules) learnedRules.value = state.learnedRules
    if (state.currentWeek) currentWeek.value = state.currentWeek
    if (state.weekDays) weekDays.value = state.weekDays
    if (state.liveStreams) liveStreams.value = state.liveStreams
    if (state.audienceSegments) audienceSegments.value = state.audienceSegments
    if (state.historyRecords) historyRecords.value = state.historyRecords
    if (state.crossPrefs) crossPrefs.value = state.crossPrefs
    if (state.crossCategoryPrefs) crossCategoryPrefs.value = state.crossCategoryPrefs
    if (state.fakeLiveHistory) fakeLiveHistory.value = state.fakeLiveHistory
    // Merge with defaults so empty cloud state doesn't wipe initialized defaults
    if (state.categoryGrades) categoryGrades.value = { ...DEFAULT_CATEGORY_GRADES, ...state.categoryGrades }
    if (state.categoryLines) categoryLines.value = { ...DEFAULT_CATEGORY_LINES, ...state.categoryLines }
    if (state.nameOverrides) nameOverrides.value = state.nameOverrides
    if (state.gmvMultiplier != null) gmvMultiplier.value = state.gmvMultiplier
  }

  async function loadFromCloud() {
    if (isAutoScheduling) {
      console.log('[Cloud] Skipping cloud load during autoSchedule')
      return
    }
    isLoadingFromCloud = true
    const state = await loadScheduleState()
    if (state) {
      deserializeState(state)
      console.log('[Cloud] Loaded from cloud')
    } else {
      // Fallback: try localStorage for configs when cloud is not available
      // Merge with defaults so empty localStorage doesn't wipe initialized defaults
      categoryGrades.value = { ...DEFAULT_CATEGORY_GRADES, ...loadFromStorage('schedule.categoryGrades', {}) }
      categoryLines.value = { ...DEFAULT_CATEGORY_LINES, ...loadFromStorage('schedule.categoryLines', {}) }
      nameOverrides.value = loadFromStorage('schedule.nameOverrides', {})
      learnedRules.value = loadFromStorage('schedule.learnedRules', [])
    }
    isLoadingFromCloud = false
  }

  const triggerSave = (() => {
    let timer: ReturnType<typeof setTimeout>
    return () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (isLoadingFromCloud || isAutoScheduling) return
        saveScheduleState(serializeState())
      }, 800)
    }
  })()

  watch(
    [liveStreams, audienceSegments, historyRecords, crossPrefs, crossCategoryPrefs, fakeLiveHistory, categoryGrades, categoryLines, nameOverrides, currentWeek, weekDays, learnedRules, gmvMultiplier],
    () => triggerSave(),
    { deep: true }
  )

  subscribeToChanges(() => {
    loadFromCloud()
  })

  loadFromCloud()

  // ========== Getters ==========
  const selectedLive = computed(() =>
    liveStreams.value.find((l) => l.id === selectedLiveId.value) || null
  )

  const liveBySlotAndDay = computed(() => {
    const map = new Map<string, LiveStream[]>()
    for (const live of liveStreams.value) {
      const key = `${live.slot}-${live.date}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(live)
    }
    return map
  })

  const totalExposure = computed(() => {
    return liveStreams.value
      .filter((l) => l.type === 'real')
      .reduce((sum, l) => sum + l.exposure, 0)
  })

  const availableAudience = computed(() => {
    return audienceSegments.value.filter((a) => a.status === 'available')
  })

  const uniqueCategories = computed(() => {
    const set = new Set<string>()
    for (const live of liveStreams.value) {
      if (live.category) set.add(live.category)
    }
    return Array.from(set).sort()
  })

  const liveAttribution = computed((): LiveAttribution[] => {
    const result: LiveAttribution[] = []
    for (const live of liveStreams.value) {
      if (live.assignedAudiences.length === 0) continue
      const liveCat = normalizeCategory(live.category)
      const items: AttributionItem[] = []
      let totalExposure = 0
      let expectedLeads = 0
      let expectedFirstOrders = 0
      let expectedGMV = 0
      for (const aud of live.assignedAudiences) {
        const audCat = normalizeCategory(aud.category)
        const audCohort = extractCohortMonth(aud.timeRange)
        // 公海品类(from)=audience品类, 跨科品类(to)=直播品类
        // 优先按 cohortMonth 精确匹配，再 fallback 到全量平均，再 fallback 到家族匹配
        const pref = findCrossPref(audCat, liveCat, audCohort)
        const crossRate = pref?.crossRate || 0
        // 如果 cross-pref 中没有 conversionRate 数据，默认线索全部转化（crossRate 已是整体转化率）
        const conversionRate = (pref?.conversionRate || 0) > 0 ? pref!.conversionRate : 1
        const ltv = pref?.ltv || live.ltv || 80
        const leads = aud.count * crossRate
        const firstOrders = leads * conversionRate
        const gmv = firstOrders * ltv * gmvMultiplier.value
        items.push({
          segmentId: aud.segmentId,
          category: aud.category,
          line: aud.line,
          count: aud.count,
          crossRate,
          conversionRate,
          ltv,
          expectedLeads: leads,
          expectedFirstOrders: firstOrders,
          expectedGMV: gmv,
        })
        totalExposure += aud.count
        expectedLeads += leads
        expectedFirstOrders += firstOrders
        expectedGMV += gmv
      }
      result.push({
        liveId: live.id,
        name: live.name,
        category: live.category,
        line: live.line,
        totalExposure,
        expectedLeads,
        expectedFirstOrders,
        expectedGMV,
        items,
      })
    }
    return result
  })

  // ========== Helpers ==========
  function generateId() {
    return Math.random().toString(36).substring(2, 10)
  }

  function extractCohortMonth(timeRange: string): string | null {
    if (!timeRange) return null
    // Handle formats like: "2025.1.12-2026.4.26", "2025.1-2026.4", "截止2026.4", "2026.4"
    // 1. Try to find the latest YYYY.M or YYYY.MM pattern in the string
    const allMatches = Array.from(timeRange.matchAll(/(\d{4})[\.年](\d{1,2})/g))
    if (allMatches.length === 0) return null
    // Use the last match (latest date) as cohort month
    const lastMatch = allMatches[allMatches.length - 1]
    return `${lastMatch[1]}-${lastMatch[2].padStart(2, '0')}`
  }

  function parseDate(fullDate: string): Date {
    return new Date(fullDate)
  }

  function resolveDate(d: string): Date {
    let parsed = parseDate(d)
    if (isNaN(parsed.getTime())) {
      const full = weekDays.value.find((w) => w.date === d)?.fullDate
      if (full) parsed = parseDate(full)
    }
    return parsed
  }

  function daysBetween(a: string, b: string): number {
    const d1 = resolveDate(a)
    const d2 = resolveDate(b)
    return Math.abs(Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)))
  }

  // ========== Cross-Pref Lookup (cohort-aware, strict equality) ==========
  function findCrossPref(audienceCat: string, liveCat: string, cohortMonth: string | null): CrossCategoryPref | undefined {
    const normAud = normalizeCategory(audienceCat)
    const normLive = normalizeCategory(liveCat)

    // 1. Exact match with cohortMonth
    const pref = crossCategoryPrefs.value.find(
      (p) => normalizeCategory(p.fromCategory) === normAud && normalizeCategory(p.toCategory) === normLive && p.cohortMonth === cohortMonth
    )
    if (pref) return pref

    // 2. Exact match without cohortMonth (fallback to average)
    return crossCategoryPrefs.value.find(
      (p) => normalizeCategory(p.fromCategory) === normAud && normalizeCategory(p.toCategory) === normLive
    )
  }

  // ========== Actions ==========

  function setSelectedLive(id: string | null) {
    selectedLiveId.value = id
  }

  function updateUploadStatus(key: keyof typeof uploadStatus.value, val: boolean) {
    uploadStatus.value[key] = val
  }

  function setLiveStreams(list: LiveStream[]) {
    liveStreams.value = list
  }

  function setAudienceSegments(list: AudienceSegment[]) {
    audienceSegments.value = list
  }

  function setWeekDays(list: WeekDay[]) {
    weekDays.value = list
  }

  function setCurrentWeek(weekStr: string) {
    currentWeek.value = weekStr
  }

  function setHistoryRecords(list: HistoryRecord[]) {
    historyRecords.value = list
  }

  function setCrossPrefs(list: CrossPref[]) {
    crossPrefs.value = list
  }

  function setCrossCategoryPrefs(list: CrossCategoryPref[]) {
    crossCategoryPrefs.value = list
  }

  function setFakeLiveHistory(list: FakeLiveHistoryItem[]) {
    fakeLiveHistory.value = list
  }

  function setLiveGrade(liveId: string, grade: GradeType) {
    const live = liveStreams.value.find((l) => l.id === liveId)
    if (live) live.grade = grade
  }

  function setLiveCategory(liveId: string, category: string) {
    const live = liveStreams.value.find((l) => l.id === liveId)
    if (live) live.category = normalizeCategory(category)
  }

  function setLiveLine(liveId: string, line: LineType) {
    const live = liveStreams.value.find((l) => l.id === liveId)
    if (live) live.line = line
  }

  function setLiveCrossCategory(liveId: string, val: boolean) {
    const live = liveStreams.value.find((l) => l.id === liveId)
    if (live) live.isCrossCategory = val
  }

  function setCategoryGrade(category: string, grade: GradeType) {
    const canonical = normalizeCategory(category)
    categoryGrades.value[canonical] = grade
  }

  function setCategoryLine(category: string, line: LineType) {
    const canonical = normalizeCategory(category)
    categoryLines.value[canonical] = line
  }

  function setNameOverride(name: string, category: string, line: LineType) {
    const canonical = normalizeCategory(category)
    nameOverrides.value[name] = { category: canonical, line }
  }

  function removeNameOverride(name: string) {
    delete nameOverrides.value[name]
  }

  function applyCategoryGrades() {
    for (const live of liveStreams.value) {
      // Joint live: compute grades/lines/target from all sub-categories
      if (live.isJoint && live.categories) {
        const grades: string[] = []
        const lines: LineType[] = []
        for (const cat of live.categories) {
          const canonical = normalizeCategory(cat)
          const grade = categoryGrades.value[canonical]
          if (grade) grades.push(grade)
          const line = categoryLines.value[canonical] || parseLineFromCategory(canonical)
          if (line) lines.push(line)
        }
        if (grades.length > 0) {
          live.grade = grades[0] as GradeType
          // Joint live target: primary live gets full target, subsequent lives get half
          live.target = grades.reduce((sum, g, idx) => sum + (TARGET_EXPOSURE[g] || 120000) * (idx === 0 ? 1 : 0.5), 0)
        }
        if (lines.length > 0) {
          live.line = lines[0]
          live.lines = Array.from(new Set(lines)) as LineType[]
        }
        continue
      }

      const canonical = normalizeCategory(live.category)
      const grade = categoryGrades.value[canonical]
      if (grade) live.grade = grade
      const line = categoryLines.value[canonical]
      if (line) live.line = line
    }
  }

  function applyNameOverrides() {
    for (const live of liveStreams.value) {
      const override = nameOverrides.value[live.name]
      if (override) {
        live.category = normalizeCategory(override.category)
        live.line = override.line
      }
    }
  }

  function getAllowedLines(live: LiveStream): Set<LineType> {
    if (live.isJoint && live.lines && live.lines.length > 0) {
      return new Set(live.lines)
    }
    if (NEUTRAL_CATEGORIES.has(live.category) && live.line === 'beauty') {
      return new Set(['beauty', 'health'])
    }
    return new Set([live.line])
  }

  function assignAudience(liveId: string, segmentId: string) {
    const live = liveStreams.value.find((l) => l.id === liveId)
    const seg = audienceSegments.value.find((a) => a.id === segmentId)
    if (!live || !seg) return

    // If already assigned to another live, remove it first (transfer)
    if (seg.assignedTo && seg.assignedTo !== liveId) {
      const fromLive = liveStreams.value.find((l) => l.id === seg.assignedTo)
      if (fromLive) {
        const idx = fromLive.assignedAudiences.findIndex((a) => a.segmentId === segmentId)
        if (idx !== -1) {
          const assigned = fromLive.assignedAudiences[idx]
          fromLive.exposure -= assigned.count
          fromLive.assignedAudiences.splice(idx, 1)
        }
      }
      seg.status = 'available'
      seg.assignedTo = undefined
    }

    // Enforce line rules (joint live / neutral categories)
    const allowedLines = getAllowedLines(live)
    if (!allowedLines.has(seg.line)) {
      console.warn('Cross-line assignment blocked:', seg.line, '->', live.line)
      return
    }

    // Enforce same-category exclusion
    const excludedCats = live.isJoint && live.categories
      ? new Set(live.categories.map((c) => normalizeCategory(c)))
      : new Set([normalizeCategory(live.category)])
    if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, seg.category))) {
      console.warn('Same-category assignment blocked:', live.category, '->', seg.category)
      return
    }

    // Check conflicts
    const conflicts = checkConflicts(live, seg)
    if (conflicts.length > 0) {
      live.conflictReasons.push(...conflicts)
    }

    const assigned: AssignedAudience = {
      segmentId: seg.id,
      line: seg.line,
      category: seg.category,
      timeRange: seg.timeRange,
      count: seg.count,
    }
    live.assignedAudiences.push(assigned)
    live.exposure += seg.count
    seg.status = 'used'
    seg.assignedTo = liveId
    if (!seg.assignedDates) seg.assignedDates = []
    seg.assignedDates.push(live.date)
  }

  function removeAudience(liveId: string, segmentId: string) {
    const live = liveStreams.value.find((l) => l.id === liveId)
    if (!live) return
    const idx = live.assignedAudiences.findIndex((a) => a.segmentId === segmentId)
    if (idx === -1) return
    const assigned = live.assignedAudiences[idx]
    live.exposure -= assigned.count
    live.assignedAudiences.splice(idx, 1)

    const seg = audienceSegments.value.find((a) => a.id === segmentId)
    if (seg) {
      seg.status = 'available'
      seg.assignedTo = undefined
      if (seg.assignedDates) {
        seg.assignedDates = seg.assignedDates.filter((d) => d !== live.date)
      }
    }
    recalcConflicts(live)
  }

  function recordAdjustment(liveId: string, segmentId: string) {
    const seg = audienceSegments.value.find((a) => a.id === segmentId)
    pendingAdjustment.value = {
      liveId,
      segmentId,
      fromLiveId: seg?.assignedTo,
    }
  }

  function saveLearnedRule(rule: Omit<LearnedRule, 'id' | 'timestamp'>) {
    learnedRules.value.push({
      id: generateId(),
      ...rule,
      timestamp: Date.now(),
    })
    pendingAdjustment.value = null
  }

  function dismissAdjustment() {
    pendingAdjustment.value = null
  }

  function checkConflicts(live: LiveStream, seg: AudienceSegment): string[] {
    const reasons: string[] = []

    // 3-day rule
    const recent = historyRecords.value.filter(
      (h) =>
        h.category === seg.category &&
        h.timeRange === seg.timeRange &&
        daysBetween(h.date, live.date) < 3
    )
    if (recent.length > 0) {
      reasons.push(`${seg.category} ${seg.timeRange} 3天内已被触达`)
    }

    // 30-day fake live rule
    if (live.type === 'fake') {
      const recentFake = historyRecords.value.filter(
        (h) =>
          h.type === 'fake' &&
          h.category === seg.category &&
          h.timeRange === seg.timeRange &&
          daysBetween(h.date, live.date) <= 30
      )
      if (recentFake.length > 0) {
        reasons.push(`${seg.category} ${seg.timeRange} 30天内已复用伪直播`)
      }
    }

    // Same category within week
    const sameWeek = liveStreams.value.filter(
      (l) =>
        l.id !== live.id &&
        l.date === live.date &&
        l.assignedAudiences.some((a) => a.category === seg.category && a.timeRange === seg.timeRange)
    )
    if (sameWeek.length > 0) {
      reasons.push(`${seg.category} ${seg.timeRange} 当日已被分配`)
    }

    return reasons
  }

  function recalcConflicts(live: LiveStream) {
    live.conflictReasons = []
    for (const a of live.assignedAudiences) {
      const seg = audienceSegments.value.find((s) => s.id === a.segmentId)
      if (seg) {
        const conflicts = checkConflicts(live, seg)
        live.conflictReasons.push(...conflicts)
      }
    }
  }

  async function autoSchedule() {
    isAutoScheduling = true
    try {
      // Collect fake-live audiences before reset (for global exclusion)
      const fakeAudiences = new Set<string>()
      for (const live of liveStreams.value) {
        if (live.type === 'fake') {
          for (const aud of live.assignedAudiences) {
            fakeAudiences.add(`${aud.category}-${aud.timeRange}`)
          }
        }
      }

      // Reset: preserve fake-live history data
      for (const live of liveStreams.value) {
        if (live.type === 'fake') {
          live.conflictReasons = []
          continue
        }
        live.assignedAudiences = []
        live.exposure = 0
        live.conflictReasons = []
      }
      for (const seg of audienceSegments.value) {
        const key = `${seg.category}-${seg.timeRange}`
        if (fakeAudiences.has(key)) {
          seg.status = 'used'
        } else {
          seg.status = 'available'
          seg.assignedTo = undefined
        }
        seg.assignedDates = []
      }

    function getCrossPref(audienceCat: string, liveCat: string, timeRange: string): { crossRate: number; conversionRate: number; ltv: number } {
      const cohortMonth = extractCohortMonth(timeRange)

      // 同品类族（垂类）：crossRate = 1.0（无需跨科）
      if (isSameCategoryFamily(audienceCat, liveCat)) {
        return { crossRate: 1.0, conversionRate: 1.0, ltv: 80 }
      }

      const pref = findCrossPref(audienceCat, liveCat, cohortMonth)
      if (pref) {
        const crossRate = pref.crossRate || 0
        // 如果 cross-pref 中没有 conversionRate 数据，默认线索全部转化（crossRate 已是整体转化率）
        const conversionRate = (pref.conversionRate || 0) > 0 ? pref.conversionRate : 1
        return {
          crossRate,
          conversionRate,
          ltv: pref.ltv || 0,
        }
      }
      return { crossRate: 0, conversionRate: 1, ltv: 0 }
    }

    // Score and sort (skip friend-circle and fake lives)
    const scored = liveStreams.value
      .filter((live) => live.slot !== 'friend-circle' && live.type !== 'fake')
      .map((live) => {
        let score = 0
        if (live.grade === 'S') score += 100
        else if (live.grade === 'A') score += 70
        else if (live.grade === 'B') score += 40
        else if (live.grade === 'C') score += 20
        else score += 10

        if (live.slot === 'evening' || live.slot === 'fake-evening') score += 50
        else if (live.slot === 'morning' || live.slot === 'fake-morning') score += 30
        else score += 10

        const fakeHist = fakeLiveHistory.value.find(
          (f) => f.name === live.name && f.category === live.category
        )
        if (fakeHist) score += fakeHist.conversionRate * 100

        return { live, score }
      })

    scored.sort((a, b) => b.score - a.score)

    function tryAssign(live: LiveStream, seg: AudienceSegment) {
      // Defensive: if segment is already assigned to another live, remove it first
      if (seg.assignedTo && seg.assignedTo !== live.id) {
        const fromLive = liveStreams.value.find((l) => l.id === seg.assignedTo)
        if (fromLive) {
          const idx = fromLive.assignedAudiences.findIndex((a) => a.segmentId === seg.id)
          if (idx !== -1) {
            fromLive.exposure -= fromLive.assignedAudiences[idx].count
            fromLive.assignedAudiences.splice(idx, 1)
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
      seg.status = 'used'
      seg.assignedTo = live.id
      if (!seg.assignedDates) seg.assignedDates = []
      seg.assignedDates.push(live.date)
      live.conflictReasons.push(...conflicts)
    }

    // PRD v2.0: joint live / neutral category cross-line support
    function getCandidates(live: LiveStream, allowReuse: boolean = false) {
      const liveCat = normalizeCategory(live.category)

      // Determine allowed lines
      let allowedLines: Set<LineType>
      if (live.isJoint && live.lines && live.lines.length > 0) {
        allowedLines = new Set(live.lines)
      } else if (NEUTRAL_CATEGORIES.has(live.category) && live.line === 'beauty') {
        allowedLines = new Set(['beauty', 'health'])
      } else {
        allowedLines = new Set([live.line])
      }

      // Determine excluded categories
      const excludedCats = live.isJoint && live.categories
        ? new Set(live.categories.map((c) => normalizeCategory(c)))
        : new Set([liveCat])

      const assignedCats = new Set(live.assignedAudiences.map((a) => normalizeCategory(a.category)))
      const assignedRanges = new Set(live.assignedAudiences.map((a) => a.timeRange))
      const baseTarget = live.target ?? TARGET_EXPOSURE[live.grade || 'C'] ?? 120000

      // Helper: count learned-rule matches for (liveCategory -> segCategory)
      function getRuleBoost(liveCategory: string, segCategory: string): number {
        const lc = normalizeCategory(liveCategory)
        const sc = normalizeCategory(segCategory)
        return learnedRules.value.filter(
          (r) => normalizeCategory(r.liveCategory) === lc && normalizeCategory(r.toCategory) === sc
        ).length
      }

      return audienceSegments.value
        .filter((s) => {
          if (!allowedLines.has(s.line)) return false
          const dates = s.assignedDates || []
          if (!allowReuse) {
            // Round 1: only segments that have never been assigned this week
            return dates.length === 0
          }
          // Round 2 (refill): allow reuse if under 2 times and 3-day gap
          if (dates.length >= 2) return false
          if (dates.length === 1 && daysBetween(dates[0], live.date) < 3) return false
          return true
        })
        .filter((s) => !Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(s.category))))
        .sort((a, b) => {
          // 1. 同品类族优先
          const aSameFamily = isSameCategoryFamily(a.category, live.category)
          const bSameFamily = isSameCategoryFamily(b.category, live.category)
          if (aSameFamily !== bSameFamily) return bSameFamily ? 1 : -1

          // 2. 已分配品类去重（强制分散搭配）
          const aDupCat = assignedCats.has(normalizeCategory(a.category))
          const bDupCat = assignedCats.has(normalizeCategory(b.category))
          if (aDupCat !== bDupCat) return aDupCat ? 1 : -1

          // 3. 已分配 timeRange 去重
          const aDupRange = assignedRanges.has(a.timeRange)
          const bDupRange = assignedRanges.has(b.timeRange)
          if (aDupRange !== bDupRange) return aDupRange ? 1 : -1

          // 4. 超大段降权（超过目标 60% 的段降低优先级，避免 greedy 独吞）
          const aOversized = a.count > baseTarget * 0.6
          const bOversized = b.count > baseTarget * 0.6
          if (aOversized !== bOversized) return aOversized ? 1 : -1

          // 5. 已学习的规则匹配优先（用户手动确认过的搭配）
          const aRuleBoost = getRuleBoost(live.category, a.category)
          const bRuleBoost = getRuleBoost(live.category, b.category)
          if (aRuleBoost !== bRuleBoost) return bRuleBoost - aRuleBoost

          // 6. 预估 GMV = count × crossRate × LTV
          const aPref = getCrossPref(a.category, live.category, a.timeRange)
          const bPref = getCrossPref(b.category, live.category, b.timeRange)
          const aGMV = a.count * (aPref.crossRate || 0) * (aPref.ltv || 0)
          const bGMV = b.count * (bPref.crossRate || 0) * (bPref.ltv || 0)
          if (bGMV !== aGMV) return bGMV - aGMV

          // 7. count 降序
          return b.count - a.count
        })
    }

    // Round 1: strict allocation — each audience segment can only be used once
    let changed = true
    while (changed) {
      changed = false
      for (const { live } of scored) {
        const target = live.target ?? TARGET_EXPOSURE[live.grade || 'C'] ?? 120000
        if (live.exposure >= target * 1.3) continue
        const candidates = getCandidates(live, false)
        if (candidates.length > 0) {
          tryAssign(live, candidates[0])
          changed = true
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // Round 2: refill under-target lives with reused segments (3-day gap, max 2/week)
    // Only lives that haven't reached their target are eligible for reuse
    changed = true
    while (changed) {
      changed = false
      for (const { live } of scored) {
        const target = live.target ?? TARGET_EXPOSURE[live.grade || 'C'] ?? 120000
        if (live.exposure >= target) continue
        const candidates = getCandidates(live, true)
        if (candidates.length > 0) {
          tryAssign(live, candidates[0])
          changed = true
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // Round 3: force-assign remaining available segments to any eligible live
    // Ensures total inventory is fully allocated even if some lives exceed target
    // Prioritize lives with lowest current exposure to distribute evenly
    for (const seg of audienceSegments.value) {
      if (seg.status !== 'available') continue
      const eligibleLives = scored
        .filter(({ live }) => {
          const allowedLines = getAllowedLines(live)
          if (!allowedLines.has(seg.line)) return false

          const liveCat = normalizeCategory(live.category)
          const excludedCats = live.isJoint && live.categories
            ? new Set(live.categories.map((c) => normalizeCategory(c)))
            : new Set([liveCat])
          if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false

          const dates = seg.assignedDates || []
          if (dates.length >= 2) return false
          if (dates.length === 1 && daysBetween(dates[0], live.date) < 3) return false

          const conflicts = checkConflicts(live, seg)
          if (conflicts.length > 0) return false

          return true
        })
        .sort((a, b) => a.live.exposure - b.live.exposure)

      if (eligibleLives.length > 0) {
        tryAssign(eligibleLives[0].live, seg)
      }
    }

    // Validate schedule after generation
    const validation = validateSchedule(liveStreams.value, audienceSegments.value, crossCategoryPrefs.value)
    if (!validation.passed) {
      console.error('排期验证失败:', validation.errors)
    }
    if (validation.warnings.length > 0) {
      console.warn('排期警告:', validation.warnings)
    }
    console.log('排期统计:', validation.stats)
    } finally {
      isAutoScheduling = false
      // Trigger one save after autoSchedule completes
      triggerSave()
    }
  }

  function loadMockData() {
    // Mock live streams
    const lines: LineType[] = ['health', 'beauty', 'interest']
    const slots: SlotType[] = ['morning', 'evening', 'fake-morning', 'fake-evening']
    const grades: (GradeType | null)[] = ['S', 'A', 'B', 'C', null]
    const names = [
      '八段锦晨间带练',
      '逆龄女神瑜伽',
      '肩颈理疗专场',
      '古法居家姚国诚',
      '气血调理专场',
      '手机摄影大赛',
      '睡眠调理晨练',
      '普拉提晨练',
      '君合太极晨练',
      '短视频复用',
      '摄影美学单人',
      '君合太极-刘君合',
    ]

    const mockLives: LiveStream[] = []
    for (let i = 0; i < 12; i++) {
      const dayIdx = i % 7
      mockLives.push({
        id: generateId(),
        name: names[i],
        startTime: i % 2 === 0 ? '07:30' : '19:00',
        endTime: i % 2 === 0 ? '09:00' : '21:00',
        date: weekDays.value[dayIdx].date,
        type: i > 8 ? 'fake' : 'real',
        category: ['健康营养', '普拉提', '太极', '手机摄影', '睡眠调理', '五禽戏'][i % 6],
        line: lines[i % 3],
        slot: slots[i % 4],
        grade: grades[i % 5],
        owner: ['静雯', '刘芳', '李慧'][i % 3],
        link: 'https://example.com/live',
        ltv: 80,
        assignedAudiences: [],
        exposure: 0,
        conflictReasons: [],
        isRecommended: false,
        isCrossCategory: false,
      })
    }

    // Mock audience segments
    const categories = [
      { line: 'health' as LineType, cat: '健康营养' },
      { line: 'health' as LineType, cat: '太极' },
      { line: 'health' as LineType, cat: '五禽戏' },
      { line: 'health' as LineType, cat: '睡眠调理' },
      { line: 'beauty' as LineType, cat: '中医变美' },
      { line: 'beauty' as LineType, cat: '普拉提' },
      { line: 'beauty' as LineType, cat: '瑜伽' },
      { line: 'interest' as LineType, cat: '手机摄影' },
      { line: 'interest' as LineType, cat: '唱歌' },
      { line: 'interest' as LineType, cat: '短视频' },
    ]
    const timeRanges = [
      '2025.1.12-2026.4.26',
      '2025.10.13-2026.1.11',
      '2025.4.14-2025.10.12',
      '2023.1-2025.4.13',
    ]
    const mockSegments: AudienceSegment[] = []
    for (const c of categories) {
      for (const tr of timeRanges) {
        mockSegments.push({
          id: generateId(),
          line: c.line,
          category: c.cat,
          timeRange: tr,
          count: Math.floor(Math.random() * 150000) + 20000,
          status: 'available',
        })
      }
    }

    // Mock history
    const mockHistory: HistoryRecord[] = []
    for (let i = 0; i < 20; i++) {
      const dayIdx = Math.floor(Math.random() * 7)
      mockHistory.push({
        date: weekDays.value[dayIdx].fullDate,
        liveId: generateId(),
        category: categories[i % categories.length].cat,
        timeRange: timeRanges[i % timeRanges.length],
        type: i % 3 === 0 ? 'fake' : 'real',
        slot: slots[i % 4],
      })
    }

    // Mock cross-prefs
    const mockCrossPrefs: CrossPref[] = []
    const mockCrossCategoryPrefs: CrossCategoryPref[] = []
    const mockCohortMonths = ['2026-01', '2026-02', '2026-03']
    for (const c of categories) {
      for (const c2 of categories) {
        if (c.cat === c2.cat) continue
        // Generate one entry per cohort month for realistic mock data
        for (const cm of mockCohortMonths) {
          const rate = Math.random() * 0.5
          mockCrossCategoryPrefs.push({
            fromCategory: c.cat,
            toCategory: c2.cat,
            toLine: c2.line,
            cohortMonth: cm,
            crossRate: rate,
            conversionRate: Math.random() * 0.2,
            ltv: Math.floor(Math.random() * 300) + 50,
          })
          const existing = mockCrossPrefs.find(p => p.fromCategory === c.cat && p.toLine === c2.line)
          if (existing) {
            existing.rate = Math.max(existing.rate, rate)
          } else {
            mockCrossPrefs.push({
              fromCategory: c.cat,
              toLine: c2.line,
              rate,
            })
          }
        }
      }
    }

    // Mock fake live history
    const mockFakeHistory: FakeLiveHistoryItem[] = names.map((n, i) => ({
      name: n,
      category: categories[i % categories.length].cat,
      slot: slots[i % 4],
      conversionRate: Math.random() * 0.08,
      isQualified: Math.random() > 0.5,
    }))

    liveStreams.value = mockLives
    audienceSegments.value = mockSegments
    historyRecords.value = mockHistory
    crossPrefs.value = mockCrossPrefs
    crossCategoryPrefs.value = mockCrossCategoryPrefs
    fakeLiveHistory.value = mockFakeHistory
  }

  return {
    liveStreams,
    audienceSegments,
    historyRecords,
    crossPrefs,
    crossCategoryPrefs,
    fakeLiveHistory,
    selectedLiveId,
    currentWeek,
    weekDays,
    uploadStatus,
    categoryGrades,
    categoryLines,
    nameOverrides,
    selectedLive,
    liveBySlotAndDay,
    totalExposure,
    availableAudience,
    uniqueCategories,
    liveAttribution,
    setSelectedLive,
    updateUploadStatus,
    setLiveStreams,
    setAudienceSegments,
    setWeekDays,
    setCurrentWeek,
    setHistoryRecords,
    setCrossPrefs,
    setCrossCategoryPrefs,
    setFakeLiveHistory,
    setLiveGrade,
    setLiveCategory,
    setLiveLine,
    setLiveCrossCategory,
    setCategoryGrade,
    setCategoryLine,
    setNameOverride,
    removeNameOverride,
    applyCategoryGrades,
    applyNameOverrides,
    assignAudience,
    removeAudience,
    recordAdjustment,
    saveLearnedRule,
    dismissAdjustment,
    autoSchedule,
    loadMockData,
    learnedRules,
    pendingAdjustment,
  }
})
