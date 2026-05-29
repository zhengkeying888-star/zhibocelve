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
import { normalizeCategory, isSameCategoryFamily, parseLineFromCategory, getCategoryFamily } from '@/utils/categoryMapping'
import { inferGrade } from '@/utils/parser'
import { validateSchedule } from '@/utils/scheduleValidator'
import { loadScheduleState, saveScheduleState, subscribeToChanges, clearScheduleState } from '@/lib/cloudSync'
import type { ScheduleState } from '@/lib/cloudSync'
import type { FeishuConfig } from '@/types'
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
  // Breaking-change data version: bump this whenever autoSchedule logic changes
  // in a way that makes old persisted assignments invalid.
  const DATA_VERSION = 'v3.4-joint-cross-line-grade-variants-20260521'

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

  // Feishu integration config
  const feishuConfig = ref<FeishuConfig | null>(null)

  // Global calibration multiplier (temporary fix for crossRate underestimation)
  const gmvMultiplier = ref(18)

  // PRD v2.0: neutral categories that can cross beauty → health
  const NEUTRAL_CATEGORIES = new Set(['东方养正瑜伽'])

  // Adjusted target exposure based on actual human scheduling behavior.
  // Human schedules do not stop at fixed targets; famous hosts get as many
  // segments as available. These values are raised so the system does not
  // artificially cap分配 too early.
  const TARGET_EXPOSURE: Record<string, number> = {
    S: 600000,
    A: 500000,
    B: 350000,
    C: 250000,
  }

  // Max segments per live by grade (human rule: famous hosts = more segments)
  const MAX_SEGMENTS_BY_GRADE: Record<string, number> = {
    S: 8,
    A: 7,
    B: 5,
    C: 5,
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
    if ((state as any).feishuConfig) feishuConfig.value = (state as any).feishuConfig
    if (state.currentWeek) currentWeek.value = state.currentWeek
    if (state.weekDays) weekDays.value = state.weekDays
    if (state.liveStreams) {
      // Filter out legacy fake placeholders created by old parser versions
      const filtered = state.liveStreams.filter(l => !(l.type === 'fake' && l.name === '上次直播记录'))
      if (filtered.length !== state.liveStreams.length) {
        console.log('[State] Filtered out', state.liveStreams.length - filtered.length, 'legacy fake placeholders')
      }
      // Migration: all real lives must be cross-category (v3.2+)
      for (const live of filtered) {
        if (live.type === 'real' && live.isCrossCategory === false) {
          live.isCrossCategory = true
        }
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
      const savedFeishu = loadFromStorage<FeishuConfig | null>('schedule.feishuConfig', null)
      if (savedFeishu) {
        feishuConfig.value = savedFeishu
        console.log('[Local] Loaded feishuConfig')
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

  let isCloudSyncPaused = false
  let skipNextCloudSync = false
  let unsubscribeChanges = subscribeToChanges(() => {
    if (isCloudSyncPaused) {
      console.log('[Cloud] Sync skipped: upload in progress')
      return
    }
    if (skipNextCloudSync) {
      skipNextCloudSync = false
      console.log('[Cloud] Sync skipped: grace period after resume')
      return
    }
    loadFromCloud()
  })

  function pauseCloudSync() {
    isCloudSyncPaused = true
    console.log('[Cloud] Sync paused for upload')
  }
  function resumeCloudSync() {
    isCloudSyncPaused = false
    skipNextCloudSync = true
    console.log('[Cloud] Sync resumed, skipping next load')
  }

  // Sync version check BEFORE async cloud load so stale data is cleared immediately
  const savedVersion = localStorage.getItem('schedule_data_version')
  if (savedVersion !== DATA_VERSION) {
    console.log('[Version] Sync mismatch:', savedVersion, '!==', DATA_VERSION, '→ auto-reset')
    resetAllData()
    // resetAllData reloads the page, so code below won't run
  }

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
      const stat = findHistoricalStat(cat)
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
    // Categories from current week's live streams
    for (const live of liveStreams.value) {
      if (live.category) set.add(live.category)
    }
    // Also include categories from uploaded historical stats so users can
    // pre-configure grades/lines for categories not in this week's schedule.
    for (const cat of Object.keys(categoryHistoricalStats.value)) {
      set.add(cat)
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
      const hist = findHistoricalStat(liveCat)
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
            const audCat = normalizeCategory(aud.category)
            const isVertical = isSameCategoryFamily(audCat, liveCat)
            items.push({
              segmentId: aud.segmentId,
              category: aud.category,
              line: aud.line,
              count: aud.count,
              crossRate: isVertical ? 1.0 : 0,
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

      const suggestedGrade = historicalGradeSuggestion.value[liveCat] || null
      result.push({
        liveId: live.id,
        name: live.name,
        category: live.category,
        line: live.line,
        grade: live.grade,
        suggestedGrade,
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

  /**
   * 查找品类的历史统计数据，支持多级回退：
   * 1. 精确名匹配
   * 2. getCategoryFamily（处理瑜伽S/A/BCD → 瑜伽等等级变体）
   * 3. 最长子串匹配（处理逆龄女神瑜伽 → 瑜伽等明细表归大类场景）
   */
  function findHistoricalStat(cat: string): import('@/types').CategoryHistoricalStat | undefined {
    const stats = categoryHistoricalStats.value
    if (stats[cat]) return stats[cat]

    const family = getCategoryFamily(cat)
    if (family !== cat && stats[family]) return stats[family]

    let bestKey = ''
    for (const key of Object.keys(stats)) {
      if (cat.includes(key) && key.length > bestKey.length) {
        bestKey = key
      }
    }
    if (bestKey) return stats[bestKey]

    return undefined
  }

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

  function setFeishuConfig(config: FeishuConfig | null) {
    feishuConfig.value = config
    if (config) {
      localStorage.setItem('schedule.feishuConfig', JSON.stringify(config))
    } else {
      localStorage.removeItem('schedule.feishuConfig')
    }
  }

  function removeNameOverride(name: string) {
    delete nameOverrides.value[name]
  }

  function applyCategoryGrades() {
    for (const live of liveStreams.value) {
      // 1. 直播名硬映射优先级最高（用户明确指定的名师/IP 等级）
      const inferred = inferGrade(live.name)
      if (inferred) {
        live.grade = inferred
      }

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
          // 若直播名无硬映射，则使用子品类等级
          if (!inferred) live.grade = grades[0] as GradeType
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
      if (!inferred) {
        // Fallback: 品类级别映射
        const grade = categoryGrades.value[canonical]
        if (grade) live.grade = grade
      }
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

    // 3-day rule: check history records AND already-assigned lives this week
    // PRD v3.3: 频控用 normalizeCategory 精确品类名，不用 isSameCategoryFamily。
    // 原因：太极BCD/太极SA/太极A 是同一 family 但不同用户等级段，3天内应允许分别触达。
    const normSegCat = normalizeCategory(seg.category)
    const recentHistory = combinedHistory.filter(
      (h) =>
        normalizeCategory(h.category) === normSegCat &&
        h.timeRange === seg.timeRange &&
        daysBetween(h.date, live.date) < 3
    )
    const recentWeek = liveStreams.value.filter(
      (l) =>
        l.id !== live.id &&
        l.assignedAudiences.some(
          (a) => normalizeCategory(a.category) === normSegCat && a.timeRange === seg.timeRange
        ) &&
        daysBetween(l.date, live.date) < 3
    )
    if (recentHistory.length > 0 || recentWeek.length > 0) {
      reasons.push(`${seg.category} ${seg.timeRange} 3天内已被触达`)
    }

    // 30-day fake live rule: if this live itself has fakeHistoryAudiences,
    // those historical crowds cannot be re-assigned to this live.
    if (live.fakeHistoryAudiences && live.fakeHistoryAudiences.length > 0) {
      const matched = live.fakeHistoryAudiences.find(
        (h) => normalizeCategory(h.category) === normSegCat
      )
      if (matched) {
        reasons.push(`${seg.category} 为该直播历史复用人群，30天内不可再次复用`)
      }
    }

    // Same category within week (all live types)
    const sameWeek = liveStreams.value.filter(
      (l) =>
        l.id !== live.id &&
        l.date === live.date &&
        l.assignedAudiences.some((a) => normalizeCategory(a.category) === normSegCat && a.timeRange === seg.timeRange)
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
      for (const seg of audienceSegments.value) {
        seg.status = 'available'
        seg.assignedTo = undefined
        seg.assignedDates = []
      }

      // Reset all lives (including fake).
      for (const live of liveStreams.value) {
        live.assignedAudiences = []
        live.exposure = 0
        live.conflictReasons = []
      }

      // Build line pools from all available segments
      const linePools: Record<LineType, AudienceSegment[]> = {
        health: [],
        beauty: [],
        interest: [],
      }
      for (const seg of audienceSegments.value) {
        if (linePools[seg.line]) {
          linePools[seg.line].push(seg)
        }
      }

      function isLowWeightLive(live: LiveStream): boolean {
        return live.name.includes('数字人') || live.name.includes('录播') || live.name.includes('开心太极')
      }

      function getLowWeightLimit(live: LiveStream): { maxSegments: number; maxExposure: number } | null {
        if (isLowWeightLive(live)) return { maxSegments: 1, maxExposure: 200000 }
        return null
      }

      // Score and sort lives by weight
      const GRADE_SCORE: Record<string, number> = { S: 100, A: 70, B: 40, C: 20 }
      const scored = liveStreams.value
        .filter((live) => live.slot !== 'friend-circle')
        .map((live) => {
          let score = GRADE_SCORE[live.grade || ''] ?? 10
          if (live.slot === 'evening') score += 50
          else if (live.slot === 'morning') score += 30
          else if (live.slot === 'fake-evening') score += 15
          else if (live.slot === 'fake-morning') score += 10
          else score += 5

          // 名师/IP 直播适当加权
          if (live.grade === 'S') score += 10

          // 数字人 / 录播 / 低权重直播 大幅降权
          if (isLowWeightLive(live)) score -= 120

          return { live, score }
        })
      scored.sort((a, b) => b.score - a.score)

      // Helpers
      function getLiveAllowedLines(live: LiveStream): LineType[] {
        const lines = new Set<LineType>()
        if (live.isJoint && live.lines && live.lines.length > 0) {
          for (const line of live.lines) lines.add(line)
        } else if (NEUTRAL_CATEGORIES.has(live.category) && live.line === 'beauty') {
          lines.add('beauty')
          lines.add('health')
        } else {
          lines.add(live.line)
        }
        const result = Array.from(lines)
        const primaryIdx = result.indexOf(live.line)
        if (primaryIdx > 0) {
          ;[result[0], result[primaryIdx]] = [result[primaryIdx], result[0]]
        }
        return result
      }

      function getExcludedCats(live: LiveStream): Set<string> {
        const liveCat = normalizeCategory(live.category)
        if (live.isJoint && live.categories && live.categories.length > 0) {
          return new Set(live.categories.map((c) => normalizeCategory(c)))
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
        if (!seg.assignedDates || seg.assignedDates.length === 0) return false
        const lastAssigned = seg.assignedDates[seg.assignedDates.length - 1]
        return daysBetween(lastAssigned, liveDate) >= 3
      }

      // tryAssign returns the remaining segment if a split occurred, so the
      // caller can push it back into the correct line pool.
      function tryAssign(live: LiveStream, seg: AudienceSegment, maxCount?: number, allowReuse: boolean = false): AudienceSegment | null {
        if (seg.status !== 'available' && !allowReuse) return null
        const maxSegs = MAX_SEGMENTS_BY_GRADE[live.grade || 'C'] ?? 2
        // 段数限制按品类族计数：同族（含等级变体）不额外占用 slot
        const assignedFamilies = new Set(live.assignedAudiences.map((a) => getCategoryFamily(a.category)))
        const segFamily = getCategoryFamily(seg.category)
        if (!assignedFamilies.has(segFamily) && assignedFamilies.size >= maxSegs) return null

        // 单场直播总段数上限（按等级），防止单场段数过多影响发送速度
        const MAX_TOTAL_SEGMENTS: Record<string, number> = { S: 10, A: 8, B: 7, C: 5 }
        if (live.assignedAudiences.length >= MAX_TOTAL_SEGMENTS[live.grade || 'C']) return null

        // 低权重直播硬性上限（低权重仍按实际段数计，防止过度堆叠）
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
          }
          audienceSegments.value.push(remaining)
          seg.count = desiredCount
        }

        // When allowReuse is true, we are assigning the same segment to a
        // second live (daysBetween >= 3). Do NOT remove it from the first live.
        if (!allowReuse && seg.assignedTo && seg.assignedTo !== live.id) {
          const fromLive = liveStreams.value.find((l) => l.id === seg.assignedTo)
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
          seg.status = 'used'
          seg.assignedTo = live.id
        }
        if (!seg.assignedDates) seg.assignedDates = []
        seg.assignedDates.push(live.date)
        live.conflictReasons.push(...conflicts)
        return remaining
      }

      // Merge Sweep: after a segment is assigned, greedily assign other eligible
      // segments of the same normalized category (different timeRange) to the same live.
      function tryAssignMergeSweep(
        live: LiveStream,
        seedSeg: AudienceSegment,
        pool: AudienceSegment[],
        maxCount?: number,
        allowReuse: boolean = false
      ): { assigned: AudienceSegment[]; remaining: AudienceSegment[] } {
        const assigned: AudienceSegment[] = []
        const remaining: AudienceSegment[] = []

        // Build current-live constraints (same as pickBest)
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
            const usable =
              (seg.status === 'available' && isSegmentUnused(seg)) ||
              (seg.status === 'used' && isSegmentReusable(seg, live.date))
            if (!usable) return false
          }
          // MUST re-run all pickBest eligibility checks (conflicts, exclusion, family limit, cat-range dedup)
          if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
          if (checkConflicts(live, seg).length > 0) return false
          const maxFamilies = live.grade === 'S' ? 5 : live.grade === 'A' ? 4 : 3
          if (assignedCats.size >= maxFamilies && !assignedCats.has(getCategoryFamily(seg.category))) return false
          if (assignedCatRanges.has(`${normalizeCategory(seg.category)}|${seg.timeRange}`)) return false
          return true
        })

        mergeable.sort((a, b) => b.count - a.count)

        // 限制同品类合并数量：S/A/B 级最多额外合并 1 个（同品类共 2 个），C 级不合并
        // 当直播已分配段数 >= 5 时，不再触发合并扫荡，防止单场段数过多
        const maxAdditionalByGrade: Record<string, number> = { S: 1, A: 1, B: 1, C: 0 }
        let maxAdditional = maxAdditionalByGrade[live.grade || 'C'] ?? 1
        if (live.assignedAudiences.length >= 5) maxAdditional = 0
        const toMerge = mergeable.slice(0, maxAdditional)

        for (const seg of toMerge) {
          const beforeLen = live.assignedAudiences.length
          const segRemaining = tryAssign(
            live,
            seg,
            maxCount !== undefined ? Math.max(0, maxCount - live.exposure) : undefined,
            allowReuse
          )
          if (segRemaining) {
            remaining.push(segRemaining)
          }
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
        // Use category FAMILY for counting so 太极s/A/BCD count as one "太极"
        const assignedCats = new Set(live.assignedAudiences.map((a) => getCategoryFamily(a.category)))
        const assignedCatRanges = new Set(live.assignedAudiences.map((a) => `${normalizeCategory(a.category)}|${a.timeRange}`))
        const assignedRanges = new Set(live.assignedAudiences.map((a) => a.timeRange))

        const maxFamilies = live.grade === 'S' ? 5 : live.grade === 'A' ? 4 : 3
        // Debug: log when category limit is active
        if (assignedCats.size >= maxFamilies) {
          console.log(`[pickBest] ${live.name} has ${assignedCats.size} cat families, limiting to existing:`, Array.from(assignedCats))
        }

        const eligible = pool.filter((seg) => {
          // Round 1: only unused available segments
          if (!allowReuse) {
            if (seg.status !== 'available') return false
            if (!isSegmentUnused(seg)) return false
          } else {
            // Round 2: allow unused available OR reusable used segments
            const usable = (seg.status === 'available' && isSegmentUnused(seg)) ||
              (seg.status === 'used' && isSegmentReusable(seg, live.date))
            if (!usable) return false
          }

          if (Array.from(excludedCats).some((cat) => isSameCategoryFamily(cat, normalizeCategory(seg.category)))) return false
          const conflicts = checkConflicts(live, seg)
          if (conflicts.length > 0) return false
          // 品类族上限：S 5 个、A 4 个、B/C 3 个
          if (assignedCats.size >= maxFamilies && !assignedCats.has(getCategoryFamily(seg.category))) {
            console.log(`[pickBest] ${live.name} SKIP ${getCategoryFamily(seg.category)} (family limit reached)`)
            return false
          }
          // 同一场直播同一 (品类, 时间段) 最多只分配一次（避免堆叠）
          // 允许同一品类的不同时间段合并分配
          if (assignedCatRanges.has(`${normalizeCategory(seg.category)}|${seg.timeRange}`)) return false
          return true
        })

        if (eligible.length === 0) return null

        eligible.sort((a, b) => {
          // 1. Primary line first (主线优先，中性品类跨线作为 fallback)
          const aPrimary = a.line === live.line
          const bPrimary = b.line === live.line
          if (aPrimary !== bPrimary) return bPrimary ? 1 : -1

          // 2. Same category family (垂类优先)
          const aSameFamily = isSameCategoryFamily(a.category, live.category)
          const bSameFamily = isSameCategoryFamily(b.category, live.category)
          if (aSameFamily !== bSameFamily) return bSameFamily ? 1 : -1

          // 3. Deduplicate assigned categories (强制分散)
          const aDupCat = assignedCats.has(getCategoryFamily(a.category))
          const bDupCat = assignedCats.has(getCategoryFamily(b.category))
          if (aDupCat !== bDupCat) return aDupCat ? 1 : -1

          // 4. Avoid duplicate timeRanges (still prefer new timeRanges within same category)
          const aDupRange = assignedRanges.has(a.timeRange)
          const bDupRange = assignedRanges.has(b.timeRange)
          if (aDupRange !== bDupRange) return aDupRange ? 1 : -1

          // 5. Large count first (大数量段优先)
          if (b.count !== a.count) return b.count - a.count

          return 0
        })

        return eligible[0]
      }

      function getTarget(live: LiveStream): number {
        const base = live.target ?? TARGET_EXPOSURE[live.grade || 'C'] ?? 120000
        // 晨练目标按 75% 计算，避免晨练占用过多段、晚间 S 级拿不到大段
        if (live.slot === 'morning') return Math.floor(base * 0.75)
        return base
      }

      // Round 1: 按线级分组轮询，确保同线各直播都有机会拿到段
      const lineGroups: Record<LineType, typeof scored> = {
        health: [],
        beauty: [],
        interest: [],
      }
      for (const s of scored) {
        // 联合直播应同时出现在它所关联的所有线级组中，发挥跨线优势
        const allowedLines = getLiveAllowedLines(s.live)
        for (const line of allowedLines) {
          if (lineGroups[line]) lineGroups[line].push(s)
        }
      }

      let changed = true
      let round1Iters = 0
      while (changed && round1Iters < 200) {
        changed = false
        round1Iters++
        for (const line of (['health', 'beauty', 'interest'] as LineType[])) {
          const group = lineGroups[line]
          for (const { live } of group) {
            const target = getTarget(live)
            if (live.exposure >= target) continue
            const allowedLines = getLiveAllowedLines(live)
            const primaryLine = live.line as LineType
            // 联合直播在当前 group 遍历时优先尝试当前 line，确保跨线分配
            const linesToTry = live.isJoint && allowedLines.includes(line)
              ? [line, ...allowedLines.filter((l) => l !== line)]
              : allowedLines.includes(primaryLine)
                ? [primaryLine, ...allowedLines.filter((l) => l !== primaryLine)]
                : allowedLines
            for (const tryLine of linesToTry) {
              const best = pickBest(live, linePools[tryLine])
              if (best) {
                const maxCount = Math.max(0, target - live.exposure)
                const beforeCount = live.assignedAudiences.length
                const remaining = tryAssign(live, best, maxCount)
                if (live.assignedAudiences.length === beforeCount) {
                  // tryAssign failed (e.g. too-small split for this live's remaining target).
                  // Do NOT remove from pool — the segment is still viable for other lives.
                } else {
                  const idx = linePools[tryLine].indexOf(best)
                  if (idx !== -1) linePools[tryLine].splice(idx, 1)
                  if (remaining) {
                    linePools[remaining.line].push(remaining)
                  }
                  // Merge sweep: assign other eligible timeRanges of the same category
                  const mergeResult = tryAssignMergeSweep(
                    live,
                    best,
                    linePools[tryLine],
                    maxCount,
                    false
                  )
                  for (const r of mergeResult.remaining) {
                    linePools[r.line].push(r)
                  }
                  changed = true
                  break
                }
              }
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      // Round 2: 严格等级优先，继续分配剩余 unused 段（有 grade-based soft cap）
      const ROUND2_CAP_MULTIPLIER: Record<string, number> = { S: 2.0, A: 1.8, B: 1.5, C: 1.2 }
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
          const primaryLine = live.line as LineType
          const linesToTry = allowedLines.includes(primaryLine)
            ? [primaryLine, ...allowedLines.filter((l) => l !== primaryLine)]
            : allowedLines
          for (const line of linesToTry) {
            const best = pickBest(live, linePools[line], false)
            if (best) {
              const beforeCount = live.assignedAudiences.length
              const maxCount = Math.max(0, cap - live.exposure)
              const remaining = tryAssign(live, best, maxCount, false)
              if (live.assignedAudiences.length === beforeCount) {
                // tryAssign failed for this live; keep segment in pool for others
              } else {
                const idx = linePools[line].indexOf(best)
                if (idx !== -1) linePools[line].splice(idx, 1)
                if (remaining) {
                  linePools[remaining.line].push(remaining)
                }
                // Merge sweep: assign other eligible timeRanges of the same category
                const mergeResult = tryAssignMergeSweep(
                  live,
                  best,
                  linePools[line],
                  maxCount,
                  false
                )
                for (const r of mergeResult.remaining) {
                  linePools[r.line].push(r)
                }
                round2Changed = true
                break
              }
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      // Round 3: 零曝光兜底，强制给未分配任何段的直播至少一段
      const zeroExposureLives = scored
        .filter(({ live }) => live.exposure === 0)
        .sort((a, b) => b.score - a.score)

      for (const { live } of zeroExposureLives) {
        const allowedLines = getLiveAllowedLines(live)
        const primaryLine = live.line as LineType
        const linesToTry = allowedLines.includes(primaryLine)
          ? [primaryLine, ...allowedLines.filter((l) => l !== primaryLine)]
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
              if (remaining) {
                linePools[remaining.line].push(remaining)
              }
              // Merge sweep: assign other eligible timeRanges of the same category
              const mergeResult = tryAssignMergeSweep(
                live,
                best,
                linePools[line],
                undefined,
                false
              )
              for (const r of mergeResult.remaining) {
                linePools[r.line].push(r)
              }
              break
            }
          }
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

  async function resetAllData() {
    // Clear all reactive state
    liveStreams.value = []
    audienceSegments.value = []
    historyRecords.value = []
    crossPrefs.value = []
    crossCategoryPrefs.value = []
    fakeLiveHistory.value = []
    categoryHistoricalStats.value = {}
    learnedRules.value = []
    pendingAdjustment.value = null
    selectedLiveId.value = null

    // Reset upload status
    uploadStatus.value = {
      schedule: false,
      audience: false,
      history: false,
      crossPref: false,
      fakeHistory: false,
      liveDetail: false,
    }

    // Reset category mappings to defaults
    categoryGrades.value = { ...DEFAULT_CATEGORY_GRADES }
    categoryLines.value = { ...DEFAULT_CATEGORY_LINES }
    nameOverrides.value = {}
    gmvMultiplier.value = 18
    feishuConfig.value = null
    localStorage.removeItem('schedule.feishuConfig')

    // Clear cloud + localStorage
    await clearScheduleState()
    localStorage.setItem('schedule_data_version', DATA_VERSION)
    console.log('[Reset] All data cleared. Reloading page...')
    window.location.reload()
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
    feishuConfig,
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
    setFeishuConfig,
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
    resetAllData,
    learnedRules,
    pendingAdjustment,
    pauseCloudSync,
    resumeCloudSync,
  }
})
