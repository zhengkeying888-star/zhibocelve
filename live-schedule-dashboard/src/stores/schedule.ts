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
import { normalizeCategory, isSameCategoryFamily } from '@/utils/categoryMapping'
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
    if (state.categoryGrades) categoryGrades.value = state.categoryGrades
    if (state.categoryLines) categoryLines.value = state.categoryLines
    if (state.nameOverrides) nameOverrides.value = state.nameOverrides
  }

  async function loadFromCloud() {
    isLoadingFromCloud = true
    const state = await loadScheduleState()
    if (state) {
      deserializeState(state)
      console.log('[Cloud] Loaded from cloud')
    } else {
      // Fallback: try localStorage for configs when cloud is not available
      categoryGrades.value = loadFromStorage('schedule.categoryGrades', {})
      categoryLines.value = loadFromStorage('schedule.categoryLines', {})
      nameOverrides.value = loadFromStorage('schedule.nameOverrides', {})
    }
    isLoadingFromCloud = false
  }

  const triggerSave = (() => {
    let timer: ReturnType<typeof setTimeout>
    return () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (isLoadingFromCloud) return
        saveScheduleState(serializeState())
      }, 800)
    }
  })()

  watch(
    [liveStreams, audienceSegments, historyRecords, crossPrefs, crossCategoryPrefs, fakeLiveHistory, categoryGrades, categoryLines, nameOverrides, currentWeek, weekDays],
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
    return liveStreams.value.reduce((sum, l) => sum + l.exposure, 0)
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
        const gmv = firstOrders * ltv
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

  // ========== Cross-Pref Lookup (with family fallback) ==========
  function findCrossPref(audienceCat: string, liveCat: string, cohortMonth: string | null): CrossCategoryPref | undefined {
    const normAud = normalizeCategory(audienceCat)
    const normLive = normalizeCategory(liveCat)

    // 1. Exact match with cohortMonth
    let pref = crossCategoryPrefs.value.find(
      (p) => normalizeCategory(p.fromCategory) === normAud && normalizeCategory(p.toCategory) === normLive && p.cohortMonth === cohortMonth
    )
    if (pref) return pref

    // 2. Exact match without cohortMonth (fallback to average)
    pref = crossCategoryPrefs.value.find(
      (p) => normalizeCategory(p.fromCategory) === normAud && normalizeCategory(p.toCategory) === normLive
    )
    if (pref) return pref

    // 3. Family match: audience category is a variant of base category in cross-pref
    // e.g. audCat="普拉提BCD" should match fromCategory="普拉提"
    for (const p of crossCategoryPrefs.value) {
      if (normalizeCategory(p.toCategory) === normLive && p.cohortMonth === cohortMonth) {
        const normFrom = normalizeCategory(p.fromCategory)
        if (isSameCategoryFamily(normFrom, normAud)) return p
      }
    }
    for (const p of crossCategoryPrefs.value) {
      if (normalizeCategory(p.toCategory) === normLive) {
        const normFrom = normalizeCategory(p.fromCategory)
        if (isSameCategoryFamily(normFrom, normAud)) return p
      }
    }

    return undefined
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

    // Enforce same-line rule
    if (seg.line !== live.line) {
      console.warn('Cross-line assignment blocked:', seg.line, '->', live.line)
      return
    }

    // Enforce same-category exclusion
    if (isSameCategoryFamily(live.category, seg.category)) {
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
    // Reset
    for (const live of liveStreams.value) {
      live.assignedAudiences = []
      live.exposure = 0
      live.conflictReasons = []
    }
    for (const seg of audienceSegments.value) {
      seg.status = 'available'
      seg.assignedTo = undefined
    }

    function getCrossPref(audienceCat: string, liveCat: string, timeRange: string): { crossRate: number; conversionRate: number; ltv: number } {
      const cohortMonth = extractCohortMonth(timeRange)
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

    // Score and sort (skip friend-circle)
    const scored = liveStreams.value
      .filter((live) => live.slot !== 'friend-circle')
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

    const targets: Record<string, number> = {
      S: 450000,
      A: 300000,
      B: 200000,
      C: 150000,
    }

    function tryAssign(live: LiveStream, seg: AudienceSegment) {
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
      live.conflictReasons.push(...conflicts)
    }

    // Phase 1: Same-line only. Protect each line's pool so high-score lives
    // from other lines cannot steal audience from weaker lines.
    // Use round-robin to ensure every live gets at least some audience.
    function getCandidates(live: LiveStream) {
      const liveCat = normalizeCategory(live.category)
      return audienceSegments.value
        .filter((s) => s.status === 'available' && s.line === live.line)
        // 同品类互斥：任何直播都不能宣发同品类的 audience
        .filter((s) => !isSameCategoryFamily(liveCat, normalizeCategory(s.category)))
        .sort((a, b) => {
          const aPref = getCrossPref(a.category, live.category, a.timeRange)
          const bPref = getCrossPref(b.category, live.category, b.timeRange)
          const aRate = aPref.crossRate || 0
          const bRate = bPref.crossRate || 0
          if (bRate !== aRate) return bRate - aRate
          const aLTV = aPref.ltv || 0
          const bLTV = bPref.ltv || 0
          if (bLTV !== aLTV) return bLTV - aLTV
          return b.count - a.count
        })
    }

    let changed = true
    while (changed) {
      changed = false
      for (const { live } of scored) {
        const target = targets[live.grade || 'C']
        if (live.exposure >= target) continue
        const candidates = getCandidates(live)
        if (candidates.length > 0) {
          tryAssign(live, candidates[0])
          changed = true
          // Yield frequently so clicks (e.g. cancel) can be handled
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
      // Yield to browser so UI stays responsive
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // NOTE: Cross-line assignment is intentionally removed.
    // Business rule: health audience -> health live only;
    //                beauty audience -> beauty live only;
    //                interest audience -> interest live only.
    // If a live cannot reach its target with same-line audience,
    // the user can manually add cross-line segments in DetailPanel.

    // Validate schedule after generation
    const validation = validateSchedule(liveStreams.value, audienceSegments.value, crossCategoryPrefs.value)
    if (!validation.passed) {
      console.error('排期验证失败:', validation.errors)
    }
    if (validation.warnings.length > 0) {
      console.warn('排期警告:', validation.warnings)
    }
    console.log('排期统计:', validation.stats)
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
