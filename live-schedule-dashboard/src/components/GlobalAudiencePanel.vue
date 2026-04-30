<script setup lang="ts">
import { computed } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import type { LineType, AudienceSegment } from '@/types'
import { CATEGORY_TO_LINE, normalizeCategory, isSameCategoryFamily } from '@/utils/categoryMapping'

const store = useScheduleStore()

const lineLabel: Record<string, string> = {
  health: '健康线',
  beauty: '变美线',
  interest: '兴趣线',
}

const lineDotClass: Record<string, string> = {
  health: 'bg-emerald-500',
  beauty: 'bg-pink-500',
  interest: 'bg-purple-500',
}

const selectedLive = computed(() => store.selectedLive)

// Extract cohort month from timeRange (same logic as store)
function extractCohortMonth(timeRange: string): string | null {
  if (!timeRange) return null
  const allMatches = Array.from(timeRange.matchAll(/(\d{4})[\.年](\d{1,2})/g))
  if (allMatches.length === 0) return null
  const lastMatch = allMatches[allMatches.length - 1]
  return `${lastMatch[1]}-${lastMatch[2].padStart(2, '0')}`
}

// ========== Smart Recommendations ==========
interface Recommendation {
  category: string
  cohortMonth: string
  count: number
  crossRate: number
  conversionRate: number
  ltv: number
  expectedGMV: number
  isSameFamily: boolean
  source: 'live' | 'guide'
  segments: AudienceSegment[]
}

const recommendations = computed(() => {
  if (!selectedLive.value) return []
  const liveCat = normalizeCategory(selectedLive.value.category)
  const liveLine = selectedLive.value.line

  const recs: Recommendation[] = []
  const added = new Set<string>()

  // 1. Group available audience segments by (normalized category, cohortMonth)
  const segGroups = new Map<string, { segs: AudienceSegment[]; totalCount: number }>()
  for (const seg of store.audienceSegments) {
    if (seg.line !== liveLine) continue
    if (seg.status !== 'available') continue
    // 同品类互斥：不能推荐同品类族的 audience
    if (isSameCategoryFamily(liveCat, seg.category)) continue

    const segCat = normalizeCategory(seg.category)
    const cohortMonth = extractCohortMonth(seg.timeRange) || 'unknown'
    const key = `${segCat}|${cohortMonth}`
    if (!segGroups.has(key)) {
      segGroups.set(key, { segs: [], totalCount: 0 })
    }
    const group = segGroups.get(key)!
    group.segs.push(seg)
    group.totalCount += seg.count
  }

  // 2. For each segment group, find the best matching cross-pref
  for (const [key, group] of segGroups) {
    const [segCat, cohortMonth] = key.split('|')

    // Try exact match with cohortMonth
    let pref = store.crossCategoryPrefs.find(
      (p) => normalizeCategory(p.toCategory) === liveCat && normalizeCategory(p.fromCategory) === segCat && p.cohortMonth === cohortMonth
    )
    // Fallback: exact match ignoring cohortMonth
    if (!pref) {
      pref = store.crossCategoryPrefs.find(
        (p) => normalizeCategory(p.toCategory) === liveCat && normalizeCategory(p.fromCategory) === segCat
      )
    }
    // Fallback: family match with cohortMonth
    if (!pref) {
      pref = store.crossCategoryPrefs.find(
        (p) => normalizeCategory(p.toCategory) === liveCat && isSameCategoryFamily(p.fromCategory, segCat) && p.cohortMonth === cohortMonth
      )
    }
    // Fallback: family match ignoring cohortMonth
    if (!pref) {
      pref = store.crossCategoryPrefs.find(
        (p) => normalizeCategory(p.toCategory) === liveCat && isSameCategoryFamily(p.fromCategory, segCat)
      )
    }

    if (!pref) continue

    if (added.has(key)) continue
    added.add(key)

    const crossRate = pref.crossRate || 0
    const conversionRate = pref.conversionRate || 0
    const ltv = pref.ltv || 0
    const totalCount = group.totalCount
    const leads = totalCount * crossRate
    const firstOrders = leads * conversionRate
    const gmv = firstOrders * ltv

    recs.push({
      category: segCat,
      cohortMonth,
      count: totalCount,
      crossRate,
      conversionRate,
      ltv,
      expectedGMV: gmv,
      isSameFamily: isSameCategoryFamily(segCat, liveCat),
      source: crossRate > 0 ? 'live' : 'guide',
      segments: group.segs,
    })
  }

  // Sort by expected GMV descending
  recs.sort((a, b) => b.expectedGMV - a.expectedGMV)
  return recs
})

// ========== Inventory Tree ==========
interface InventoryItem {
  category: string
  line: LineType
  totalCount: number
  availableCount: number
  cohorts: { cohortMonth: string; count: number; availableCount: number; segments: AudienceSegment[] }[]
}

const inventoryByLine = computed(() => {
  const result: Record<string, InventoryItem[]> = { health: [], beauty: [], interest: [] }

  // 1. Seed all standard categories from CATEGORY_TO_LINE so even empty ones appear
  for (const [category, line] of Object.entries(CATEGORY_TO_LINE)) {
    if (!result[line].find((i) => i.category === category)) {
      result[line].push({
        category,
        line: line as LineType,
        totalCount: 0,
        availableCount: 0,
        cohorts: [],
      })
    }
  }

  // 2. Overlay actual audience segment data
  for (const seg of store.audienceSegments) {
    const item = result[seg.line].find((i) => i.category === seg.category)
    if (!item) {
      // Segment category not in standard mapping (rare); append it
      result[seg.line].push({
        category: seg.category,
        line: seg.line,
        totalCount: seg.count,
        availableCount: seg.status === 'available' ? seg.count : 0,
        cohorts: [],
      })
      continue
    }
    item.totalCount += seg.count
    if (seg.status === 'available') item.availableCount += seg.count
    const cohortMonth = extractCohortMonth(seg.timeRange) || 'unknown'
    const existingCohort = item.cohorts.find((c) => c.cohortMonth === cohortMonth)
    if (existingCohort) {
      existingCohort.count += seg.count
      if (seg.status === 'available') existingCohort.availableCount += seg.count
      existingCohort.segments.push(seg)
    } else {
      item.cohorts.push({
        cohortMonth,
        count: seg.count,
        availableCount: seg.status === 'available' ? seg.count : 0,
        segments: [seg],
      })
    }
  }

  // 3. Sort: items with inventory first, then by count desc
  for (const line of Object.keys(result) as LineType[]) {
    result[line].sort((a, b) => {
      const aHas = a.totalCount > 0 || a.cohorts.some((c) => c.segments.some((s) => s.status === 'available'))
      const bHas = b.totalCount > 0 || b.cohorts.some((c) => c.segments.some((s) => s.status === 'available'))
      if (aHas !== bHas) return (bHas ? 1 : 0) - (aHas ? 1 : 0)
      return b.totalCount - a.totalCount
    })
    for (const item of result[line]) {
      item.cohorts.sort((a, b) => b.count - a.count)
    }
  }

  return result
})

function getPoolByLine(line: LineType) {
  return store.audienceSegments.filter((s) => s.line === line)
}

// ========== Drag ==========
function onDragStart(e: DragEvent, segmentId: string) {
  if (e.dataTransfer) {
    e.dataTransfer.setData('segmentId', segmentId)
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onRecommendClick(rec: Recommendation) {
  if (!selectedLive.value) return
  // Assign the first available segment from this recommendation
  const seg = rec.segments.find((s) => s.status === 'available')
  if (seg) {
    store.assignAudience(selectedLive.value.id, seg.id)
    store.recordAdjustment(selectedLive.value.id, seg.id)
  }
}
</script>

<template>
  <aside class="w-[320px] bg-white border-r border-slate-200 flex flex-col shrink-0">
    <!-- Top: Smart Recommendations -->
    <div class="h-[45%] flex flex-col border-b border-slate-200">
      <div class="px-4 py-3 border-b border-slate-200 bg-slate-50/50">
        <h3 class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          智能推荐
        </h3>
        <p v-if="selectedLive" class="text-[10px] text-slate-400 mt-0.5">
          基于「{{ selectedLive.category }}」的跨科数据，按预估GMV排序
        </p>
        <p v-else class="text-[10px] text-slate-400 mt-0.5">
          选中一场直播查看推荐人群
        </p>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-2">
        <div
          v-for="rec in recommendations"
          :key="`${rec.category}-${rec.cohortMonth}`"
          class="border rounded-lg p-2.5 cursor-pointer transition-colors hover:border-blue-300"
          :class="[
            rec.isSameFamily
              ? 'bg-blue-50 border-blue-200'
              : 'bg-white border-slate-200',
          ]"
          @click="onRecommendClick(rec)"
        >
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-bold text-slate-800">{{ rec.category }}</span>
              <span
                v-if="rec.isSameFamily"
                class="px-1 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-medium"
              >
                同品类
              </span>
              <span
                v-if="rec.source === 'guide'"
                class="px-1 py-0.5 bg-amber-50 text-amber-700 rounded text-[9px]"
              >
                导量数据
              </span>
            </div>
            <span class="text-[10px] font-mono text-slate-500">{{ rec.cohortMonth }}</span>
          </div>

          <div class="flex items-center justify-between mb-1">
            <span class="text-[10px] text-slate-500">
              库存 {{ (rec.count / 10000).toFixed(1) }}w
            </span>
            <span class="text-xs font-bold text-emerald-700">
              ¥{{ (rec.expectedGMV / 10000).toFixed(1) }}w
            </span>
          </div>

          <div class="flex items-center gap-2 text-[10px] text-slate-400">
            <span>跨科 {{ (rec.crossRate * 100).toFixed(1) }}%</span>
            <span>|</span>
            <span>LTV ¥{{ rec.ltv }}</span>
          </div>
        </div>

        <div
          v-if="recommendations.length === 0 && selectedLive"
          class="text-center py-6 text-slate-400 text-xs"
        >
          暂无推荐数据
        </div>
      </div>
    </div>

    <!-- Bottom: Full Inventory Tree -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-200 bg-slate-50/50">
        <h3 class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          全部人群库存
        </h3>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-3">
        <div v-for="line in (['health', 'beauty', 'interest'] as LineType[])" :key="line">
          <div class="text-xs font-semibold text-slate-700 py-1 flex items-center gap-1.5">
            <div class="w-1.5 h-1.5 rounded-full" :class="lineDotClass[line]" />
            {{ lineLabel[line] }}
            <span class="ml-auto font-mono text-[10px] text-slate-400">
              {{ getPoolByLine(line).reduce((s, a) => s + a.count, 0).toLocaleString() }}
            </span>
          </div>

          <div class="pl-4 space-y-2 border-l border-slate-200 ml-1.5 mt-1">
            <div
              v-for="item in inventoryByLine[line]"
              :key="item.category"
              class="mb-1"
            >
              <div class="text-[11px] font-medium text-slate-700 mb-1">
                {{ item.category }} · 多期存量
                <span class="ml-1 font-mono text-[10px] text-slate-700 font-medium">
                  {{ (item.availableCount / 10000).toFixed(1) }}w
                </span>
                <span v-if="item.totalCount > item.availableCount" class="ml-1 font-mono text-[10px] text-slate-400">
                  / 共 {{ (item.totalCount / 10000).toFixed(1) }}w
                </span>
                <span
                  v-if="item.cohorts.some((c) => c.segments.some((s) => s.status === 'used'))"
                  class="ml-1 px-1 py-0.5 bg-amber-50 text-amber-700 rounded text-[9px]"
                >
                  {{ item.cohorts.every((c) => c.segments.every((s) => s.status === 'used')) ? '已排' : '部分已排' }}
                </span>
              </div>
              <div class="pl-2 space-y-1">
                <div
                  v-for="cohort in item.cohorts"
                  :key="cohort.cohortMonth"
                  class="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-50 cursor-move"
                  draggable="true"
                  @dragstart="onDragStart($event, cohort.segments.find((s) => s.status === 'available')?.id || '')"
                >
                  <span class="text-[10px] text-slate-500">{{ cohort.cohortMonth }}</span>
                  <div class="flex items-center gap-2">
                    <span
                      v-if="cohort.segments.some((s) => s.status === 'used')"
                      class="px-1 py-0.5 rounded text-[9px]"
                      :class="cohort.segments.every((s) => s.status === 'used')
                        ? 'bg-slate-200 text-slate-600'
                        : 'bg-amber-50 text-amber-700'"
                    >
                      {{ cohort.segments.every((s) => s.status === 'used') ? '已排' : '部分已排' }}
                    </span>
                    <span class="text-[10px] font-mono"
                      :class="cohort.availableCount === 0 ? 'text-slate-400' : 'text-slate-700 font-medium'"
                    >
                      {{ (cohort.availableCount / 10000).toFixed(1) }}w
                      <span v-if="cohort.count > cohort.availableCount" class="text-slate-400 font-normal">
                        / {{ (cohort.count / 10000).toFixed(1) }}w
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
