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
    liveDetail: false,
  })

  // Historical live outcome stats per category (from actual monthly detail sheet)
  const categoryHistoricalStats = ref<Record<string, import('@/types').CategoryHistoricalStat>>({})

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
      categoryHistoricalStats: categoryHistoricalStats.value,
    }
  }

  function deserializeState(state: ScheduleState) {
    if (state.learnedRules) learnedRules.value = state.learnedRules
    if (state.currentWeek) currentWeek.value = state.currentWeek
    if (state.weekDays) weekDays.value = state.weekDays
    if (state.liveStreams) {
      // Filter out legacy fake placeholders created by old parser versions
      const filtered = state.liveStreams.filter(l => !(l.type === 'fake' && l.name === '上次直播记录'))
      if (filtered.length !== state.liveStreams.length) {
        console.log('[State] Filtered out', state.liveStreams.length - filtered.length, 'legacy fake placeholders')
      }
      liveStreams.value = filtered
    }
    if (state.audienceSegments) audienceSegments.value = state.audienceSegments
    if (state.historyRecords) historyRecords.value = state.historyRecords
    if (state.crossPrefs) crossPrefs.value = state.crossPrefs
    if (state.crossCategoryPrefs) crossCategoryPrefs.value = state.crossCategoryPrefs
    if (state.fakeLiveHistory) fakeLiveHistory.value = state.fakeLiveHistory
    if (state.categoryHistoricalStats) categoryHistoricalStats.value = state.categoryHistoricalStats
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
      const savedStats = loadFromStorage<Record<string, import('@/types').CategoryHistoricalStat>>('schedule.categoryHistoricalStats', {})
      if (Object.keys(savedStats).length > 0) {
        categoryHistoricalStats.value = savedStats
        console.log('[Local] Loaded categoryHistoricalStats:', Object.keys(savedStats))
      }
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

  let unsubscribeChanges = subscribeToChanges(() => {
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

  // Weekly target calibration based on historical per-category avg GMV
  const weeklyRawTarget = computed(() => {
    let sum = 0
    for (const live of liveStreams.value) {
      if (live.type !== 'real') continue
      const cat = normalizeCategory(live.category)
      const stat = categoryHistoricalStats.value[cat]
      if (stat) sum += stat.avgGMV
    }
    return sum
  })

  const scaleFactor = computed(() => {
    const raw = weeklyRawTarget.value
    if (raw > 250000) return 250000 / raw
    if (raw < 200000) return 200000 / raw
    return 1
  })

  const weeklyScaledTarget = computed(() => weeklyRawTarget.value * scaleFactor.value)

  // Historical grade suggestions based on avgGMV quartiles across all categories
  const historicalGradeSuggestion = computed((): Record<string, GradeType> => {
    const stats = Object.values(categoryHistoricalStats.value)
    if (stats.length === 0) return {}
    const avgGMVs = stats.map((s) => s.avgGMV).sort((a, b) => a - b)
    const p20 = avgGMVs[Math.floor(avgGMVs.length * 0.2)] ?? 0
    const p50 = avgGMVs[Math.floor(avgGMVs.length * 0.5)] ?? 0
    const p80 = avgGMVs[Math.floor(avgGMVs.length * 0.8)] ?? 0

    const result: Record<string, GradeType> = {}
    for (const [cat, stat] of Object.entries(categoryHistoricalStats.value)) {
      const gmv = stat.avgGMV
      if (gmv >= p80) result[cat] = 'S'
      else if (gmv >= p50) result[cat] = 'A'
      else if (gmv >= p20) result[cat] = 'B'
      else result[cat] = 'C'
    }
    return result
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
    const hasHistoricalData = Object.keys(categoryHistoricalStats.value).length > 0

    for (const live of liveStreams.value) {
      if (live.type !== 'real') continue
      if (live.assignedAudiences.length === 0) continue
      const liveCat = normalizeCategory(live.category)
      const hist = categoryHistoricalStats.value[liveCat]
      const items: AttributionItem[] = []
      let totalExposure = 0
      let expectedLeads = 0
      let expectedFirstOrders = 0
      let expectedGMV = 0

      if (hasHistoricalData) {
        // Unified historical path: all real lives use historical stats when available
        if (hist) {
          const liveExpectedGMV = hist.avgGMV * scaleFactor.value
          const liveExpectedFirstOrders = hist.avgFirstOrders * scaleFactor.value
          const liveExpectedLeads =
            hist.avgConversionRate > 0
              ? (hist.avgFirstOrders / hist.avgConversionRate) * scaleFactor.value
              : 0

          for (const aud of live.assignedAudiences) {
            totalExposure += aud.count
          }
          for (const aud of live.assignedAudiences) {
            const ratio = totalExposure > 0 ? aud.count / totalExposure : 0
            const segGMV = liveExpectedGMV * ratio
            const segFirstOrders = liveExpectedFirstOrders * ratio
            const segLeads = liveExpectedLeads * ratio
            items.push({
              segmentId: aud.segmentId,
              category: aud.category,
              line: aud.line,
              count: aud.count,
              crossRate: 0,
              conversionRate: hist.avgConversionRate,
              ltv: hist.avgFirstOrders > 0 ? hist.avgGMV / hist.avgFirstOrders : 0,
              expectedLeads: segLeads,
              expectedFirstOrders: segFirstOrders,
              expectedGMV: segGMV,
            })
          }
          expectedGMV = liveExpectedGMV
          expectedFirstOrders = liveExpectedFirstOrders
          expectedLeads = liveExpectedLeads
        } else {
          // Category has no historical data: fallback to theoretical crossRate × LTV model
          for (const aud of live.assignedAudiences) {
            const audCat = normalizeCategory(aud.category)
            const audCohort = extractCohortMonth(aud.timeRange)
            let crossRate: number
            let conversionRate: number
            let ltv: number
            if (isSameCategoryFamily(audCat, liveCat)) {
              crossRate = 1.0
              conversionRate = 1.0
              ltv = 80
            } else {
              const pref = findCrossPref(audCat, liveCat, audCohort)
              crossRate = pref?.crossRate || 0
              conversionRate = (pref?.conversionRate || 0) > 0 ? pref!.conversionRate : 1
              ltv = pref?.ltv || live.ltv || 80
            }
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
        }
      } else {
        // Fallback to theoretical crossRate × LTV model when no historical data at all
        for (const aud of live.assignedAudiences) {
          const audCat = normalizeCategory(aud.category)
          const audCohort = extractCohortMonth(aud.timeRange)
          let crossRate: number
          let conversionRate: number
          let ltv: number
          if (isSameCategoryFamily(audCat, liveCat)) {
            crossRate = 1.0
            conversionRate = 1.0
            ltv = 80
          } else {
            const pref = findCrossPref(audCat, liveCat, audCohort)
            crossRate = pref?.crossRate || 0
            conversionRate = (pref?.conversionRate || 0) > 0 ? pref!.conversionRate : 1
            ltv = pref?.ltv || live.ltv || 80
          }
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

  function setCategoryHistoricalStats(stats: Record<string, import('@/types').CategoryHistoricalStat>) {
    categoryHistoricalStats.value = stats
    console.log('[Store] categoryHistoricalStats set:', Object.keys(stats))
    console.log('[Store] categoryHistoricalStats sample:', Object.entries(stats).slice(0, 3))
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
        // Clean up assignedDates when transferring so reuse limits stay accurate
        if (seg.assignedDates) {
          seg.assignedDates = seg.assignedDates.filter((d) => d !== fromLive.date)
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

    // Build combined history from historyRecords + fakeHistoryAudiences
    // so that last-week fake-live crowds participate in 3-day checks.
    const combinedHistory: HistoryRecord[] = [...historyRecords.value]
    for (const fl of liveStreams.value) {
      const histories = fl.fakeHistoryAudiences ?? []
      if (histories.length > 0) {
        for (const aud of histories) {
          combinedHistory.push({
            date: fl.date,
            liveId: fl.id,
            category: aud.category,
            timeRange: aud.timeRange,
            type: 'fake',
            slot: fl.slot,
          })
        }
      }
    }

    // 3-day rule
    const recent = combinedHistory.filter(
      (h) =>
        h.category === seg.category &&
        h.timeRange === seg.timeRange &&
        daysBetween(h.date, live.date) < 3
    )
    if (recent.length > 0) {
      reasons.push(`${seg.category} ${seg.timeRange} 3天内已被触达`)
    }

    // 30-day fake live rule: if this live itself has fakeHistoryAudiences,
    // those historical crowds cannot be re-assigned to this live.
    if (live.fakeHistoryAudiences && live.fakeHistoryAudiences.length > 0) {
      const matched = live.fakeHistoryAudiences.find(
        (h) => h.category === seg.category && h.timeRange === seg.timeRange
      )
      if (matched) {
        reasons.push(`${seg.category} ${seg.timeRange} 为该直播历史复用人群，30天内不可再次复用`)
      }
    }

    // Same category within week (only check real lives; fake placeholders should not count)
    const sameWeek = liveStreams.value.filter(
      (l) =>
        l.id !== live.id &&
        l.type !== 'fake' &&
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
    unsubscribeChanges()
    try {
      // Reset segments: all segments available at start of autoSchedule
      // fakeHistoryAudiences participate in 3-day/30-day frequency control
      // via checkConflicts, but are NOT active assignments.
      for (const seg of audienceSegments.value) {
        seg.status = 'available'
        seg.assignedTo = undefined
        seg.assignedDates = []
      }

      // Reset all real lives. Fake placeholders (if any) are skipped entirely.
      for (const live of liveStreams.value) {
        if (live.type === 'fake') continue
        live.assignedAudiences = []
        live.exposure = 0
        live.conflictReasons = []
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

    // Score and sort (skip friend-circle and standalone fake placeholders)
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

        // Historical GMV weight: higher actual revenue history gets priority
        const liveCat = normalizeCategory(live.category)
        const hist = categoryHistoricalStats.value[liveCat]
        if (hist) {
          score += Math.min(hist.avgGMV / 20000, 5)
        }

        return { live, score }
      })

    scored.sort((a, b) => b.score - a.score)

    // Target exposure per grade. Round 1 fills to target.
    // Cap is removed per user directive: "487万就是要分干净",
    // "你不应该限制单场直播排期". Rounds 2-4 distribute remaining
    // segments without artificial per-live ceilings.
    function getTarget(live: LiveStream): number {
      return live.target ?? TARGET_EXPOSURE[live.grade || 'C'] ?? 120000
    }
    function getCap(_live: LiveStream): number {
      return Infinity
    }

    // Reuse threshold: dynamically computed as the mean crossRate of all non-zero
    // cross-category preferences. Falls back to 0.001 (0.1%) if no data available.
    function computeReuseThreshold(): number {
      const rates = crossCategoryPrefs.value
        .filter((p) => p.crossRate > 0 && !isSameCategoryFamily(p.fromCategory, p.toCategory))
        .map((p) => p.crossRate)
      if (rates.length === 0) return 0.001
      const sum = rates.reduce((a, b) => a + b, 0)
      return sum / rates.length
    }
    const REUSE_MIN_CROSS_RATE = computeReuseThreshold()

    function tryAssign(live: LiveStream, seg: AudienceSegment, maxCount?: number, allowReuse: boolean = false): boolean {
      if (seg.status !== 'available' && !allowReuse) return false
      const desiredCount = Math.min(seg.count, maxCount ?? seg.count)
      if (desiredCount <= 0) return false

      // Split segment if we only need a portion
      if (desiredCount < seg.count) {
        const remaining: AudienceSegment = {
          id: generateId(),
          line: seg.line,
          category: seg.category,
          timeRange: seg.timeRange,
          count: seg.count - desiredCount,
          status: 'available',
          assignedDates: seg.assignedDates ? [...seg.assignedDates] : [],
        }
        audienceSegments.value.push(remaining)
        seg.count = desiredCount
      }

      // Defensive: if segment is already assigned to another live, remove it first
      if (seg.assignedTo && seg.assignedTo !== live.id) {
        const fromLive = liveStreams.value.find((l) => l.id === seg.assignedTo)
        if (fromLive) {
          const idx = fromLive.assignedAudiences.findIndex((a) => a.segmentId === seg.id)
          if (idx !== -1) {
            fromLive.exposure -= fromLive.assignedAudiences[idx].count
            fromLive.assignedAudiences.splice(idx, 1)
          }
          // Clean up assignedDates when transferring so reuse limits stay accurate
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
      seg.status = 'used'
      seg.assignedTo = live.id
      if (!seg.assignedDates) seg.assignedDates = []
      seg.assignedDates.push(live.date)
      live.conflictReasons.push(...conflicts)
      return true
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
      // Only cross-category lives exclude same-family audiences; normal lives can use same-category segments.
      let excludedCats: Set<string>
      if (live.isJoint && live.categories && live.categories.length > 0) {
        excludedCats = new Set(live.categories.map((c) => normalizeCategory(c)))
      } else if (live.isCrossCategory) {
        excludedCats = new Set([liveCat])
      } else {
        excludedCats = new Set<string>()
      }

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

      const candidates = audienceSegments.value
        .filter((s) => {
          if (s.status !== 'available') return false
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
          // 0. 同线优先（跨线段排后面，尤其针对中性品类跨线）
          const aSameLine = a.line === live.line
          const bSameLine = b.line === live.line
          if (aSameLine !== bSameLine) return bSameLine ? 1 : -1

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

          // 6. 预估 GMV: prefer history-calibrated ROI per exposure count
          const hist = categoryHistoricalStats.value[liveCat]
          if (hist && hist.avgExposure > 0) {
            const roi = hist.avgGMV / hist.avgExposure
            const aEff = a.count * roi
            const bEff = b.count * roi
            if (bEff !== aEff) return bEff - aEff
          } else {
            // Fallback to theoretical crossRate × LTV model
            const aPref = getCrossPref(a.category, live.category, a.timeRange)
            const bPref = getCrossPref(b.category, live.category, b.timeRange)
            const aGMV = a.count * (aPref.crossRate || 0) * (aPref.ltv || 0)
            const bGMV = b.count * (bPref.crossRate || 0) * (bPref.ltv || 0)
            if (bGMV !== aGMV) return bGMV - aGMV
          }

          // 7. count 降序
          return b.count - a.count
        })

      // For neutral categories: exhaust same-line inventory before cross-line
      if (NEUTRAL_CATEGORIES.has(live.category) && live.line === 'beauty') {
        const sameLineCandidates = candidates.filter((s) => s.line === live.line)
        if (sameLineCandidates.length > 0) {
          return sameLineCandidates
        }
      }

      return candidates
    }

    // Round 1: strict allocation — each segment used exactly once, capped at target
    let changed = true
    while (changed) {
      changed = false
      for (const { live } of scored) {
        const target = getTarget(live)
        if (live.exposure >= target) continue
        const candidates = getCandidates(live, false)
        if (candidates.length > 0) {
          const maxCount = Math.max(0, target - live.exposure)
          if (maxCount > 0 && tryAssign(live, candidates[0], maxCount)) {
            changed = true
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // Round 2: distribute remaining never-assigned segments to lives still under cap
    for (const seg of audienceSegments.value) {
      if (seg.status !== 'available' || (seg.assignedDates && seg.assignedDates.length > 0)) continue
      const eligibleLives = scored
        .filter(({ live }) => {
          const cap = getCap(live)
          if (live.exposure >= cap) return false
          const allowedLines = getAllowedLines(live)
          if (!allowedLines.has(seg.line)) return false

          const liveCat = normalizeCategory(live.category)
          let excludedCats: Set<string>
          if (live.isJoint && live.categories && live.categories.length > 0) {
            excludedCats = new Set(live.categories.map((c) => normalizeCategory(c)))
          } else if (live.isCrossCategory) {
            excludedCats = new Set([liveCat])
          } else {
            excludedCats = new Set<string>()
          }
          if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false

          return true
        })
        .sort((a, b) => {
          const gradeScore: Record<string, number> = { S: 100, A: 70, B: 40, C: 20 }
          const gradeDiff = (gradeScore[b.live.grade || 'C'] || 0) - (gradeScore[a.live.grade || 'C'] || 0)
          if (gradeDiff !== 0) return gradeDiff
          return a.live.exposure - b.live.exposure
        })

      if (eligibleLives.length > 0) {
        const live = eligibleLives[0].live
        const cap = getCap(live)
        const maxCount = Math.max(0, cap - live.exposure)
        if (maxCount > 0) {
          tryAssign(live, seg, maxCount)
        }
      }
    }

    // Round 3: reuse allocation for under-cap lives with high cross-rate
    // Conditions: 3-day gap (handled by getCandidates) + crossRate >= threshold
    changed = true
    while (changed) {
      changed = false
      for (const { live } of scored) {
        const cap = getCap(live)
        if (live.exposure >= cap) continue
        const candidates = getCandidates(live, true).filter((seg) => {
          // Only segments that have been assigned exactly once
          if (!seg.assignedDates || seg.assignedDates.length !== 1) return false
          // High historical cross-rate check
          const pref = getCrossPref(seg.category, live.category, seg.timeRange)
          return (pref.crossRate || 0) >= REUSE_MIN_CROSS_RATE
        })
        if (candidates.length > 0) {
          const maxCount = Math.max(0, cap - live.exposure)
          if (maxCount > 0 && tryAssign(live, candidates[0], maxCount, true)) {
            changed = true
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // Round 4: force-fill — assign all remaining available segments to under-cap lives
    // (sorted by exposure asc so neediest lives get first pick)
    const underCapLives = scored
      .filter(({ live }) => {
        const cap = getCap(live)
        return live.exposure < cap
      })
      .sort((a, b) => a.live.exposure - b.live.exposure)

    for (const { live } of underCapLives) {
      const cap = getCap(live)
      while (live.exposure < cap) {
        const candidates = audienceSegments.value.filter((seg) => {
          if (seg.status !== 'available') return false
          if (seg.assignedDates && seg.assignedDates.length > 0) return false
          const allowedLines = getAllowedLines(live)
          if (!allowedLines.has(seg.line)) return false
          const liveCat = normalizeCategory(live.category)
          let excludedCats: Set<string>
          if (live.isJoint && live.categories && live.categories.length > 0) {
            excludedCats = new Set(live.categories.map((c) => normalizeCategory(c)))
          } else if (live.isCrossCategory) {
            excludedCats = new Set([liveCat])
          } else {
            excludedCats = new Set<string>()
          }
          if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
          return true
        })
        if (candidates.length === 0) break
        const maxCount = Math.max(0, cap - live.exposure)
        if (maxCount <= 0) break
        tryAssign(live, candidates[0], maxCount)
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
    const finalInventory = audienceSegments.value.reduce((sum, s) => sum + s.count, 0)
    const totalAssigned = liveStreams.value.filter(l => l.type === 'real').reduce((sum, l) => sum + l.exposure, 0)
    const remaining = audienceSegments.value.filter(s => s.status === 'available').reduce((sum, s) => sum + s.count, 0)
    console.log('【诊断】总库存:', finalInventory, '总触达:', totalAssigned, '剩余:', remaining, '段数:', audienceSegments.value.length)
    } finally {
      isAutoScheduling = false
      // Force-save immediately so cloud gets the fresh result before re-enabling sync
      saveScheduleState(serializeState()).then(() => {
        unsubscribeChanges = subscribeToChanges(() => {
          loadFromCloud()
        })
      })
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
    weeklyScaledTarget,
    scaleFactor,
    historicalGradeSuggestion,
    categoryHistoricalStats,
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
    setCategoryHistoricalStats,
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
