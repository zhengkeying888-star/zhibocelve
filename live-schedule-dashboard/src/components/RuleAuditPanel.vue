<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { auditSchedule, type AuditResult, type AuditCheckItem } from '@/utils/ruleAuditor'

const store = useScheduleStore()
const props = defineProps<{
  open: boolean
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'openCategoryManager'): void
}>()

const result = ref<AuditResult | null>(null)
const expandedIds = ref<Set<string>>(new Set())

function refresh() {
  result.value = auditSchedule(store.liveStreams, store.audienceSegments)
}

watch(
  [() => store.liveStreams, () => store.audienceSegments],
  () => {
    if (props.open) refresh()
  },
  { deep: true }
)

watch(() => props.open, (isOpen) => {
  if (isOpen && !result.value) refresh()
})

watch(() => result.value, (newResult) => {
  if (newResult) {
    const toExpand = newResult.checks
      .filter((c) => c.severity !== 'pass')
      .map((c) => c.id)
    expandedIds.value = new Set(toExpand)
  }
})

const scoreColor = computed(() => {
  const s = result.value?.overall.score ?? 0
  if (s >= 90) return 'text-emerald-600'
  if (s >= 70) return 'text-amber-500'
  return 'text-rose-600'
})

const scoreRing = computed(() => {
  const s = result.value?.overall.score ?? 0
  if (s >= 90) return 'stroke-emerald-500'
  if (s >= 70) return 'stroke-amber-500'
  return 'stroke-rose-500'
})

const scoreBg = computed(() => {
  const s = result.value?.overall.score ?? 0
  if (s >= 90) return 'bg-emerald-50'
  if (s >= 70) return 'bg-amber-50'
  return 'bg-rose-50'
})

function toggleItem(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function severityIcon(severity: AuditCheckItem['severity']) {
  if (severity === 'pass') return '✅'
  if (severity === 'warning') return '⚠️'
  return '❌'
}

function severityBorder(severity: AuditCheckItem['severity']) {
  if (severity === 'pass') return 'border-emerald-200'
  if (severity === 'warning') return 'border-amber-200'
  return 'border-rose-200'
}

function severityBg(severity: AuditCheckItem['severity']) {
  if (severity === 'pass') return 'bg-emerald-50/50'
  if (severity === 'warning') return 'bg-amber-50/50'
  return 'bg-rose-50/50'
}

const sortedChecks = computed(() => {
  if (!result.value) return []
  const order = { fail: 0, warning: 1, pass: 2 }
  return [...result.value.checks].sort((a, b) => order[a.severity] - order[b.severity])
})

// 一键操作
function selectLive(liveId: string) {
  store.setSelectedLive(liveId)
  emit('close')
}

async function handleAutoSchedule() {
  await store.autoSchedule()
}

function openCategoryManager() {
  emit('openCategoryManager')
}

async function fixCrossLineViolations() {
  // 红线修复：移除所有跨线违规的 audience，然后重新排期
  for (const live of store.liveStreams) {
    const allowed: string[] =
      live.isJoint && live.lines && live.lines.length > 0
        ? live.lines
        : live.category === '茶道'
          ? ['interest', 'health']
          : (live.category === '一杰瑜伽' || live.category === '东方养正瑜伽') && live.line === 'beauty'
            ? ['beauty', 'health']
            : [live.line]
    const invalid = live.assignedAudiences.filter((a) => !allowed.includes(a.line))
    for (const a of invalid) {
      store.removeAudience(live.id, a.segmentId)
    }
  }
  await store.autoSchedule()
}

const RECHECKABLE_IDS = new Set([
  'all-live-floor',
  'real-live-exposure',
  'fake-live-exposure',
  'audience-reuse',
  'inventory-utilization',
  'segment-status',
  'exposure-attribution',
  'fake-live-priority',
  'zero-exposure-blockers',
])

function getActionLabel(checkId: string): string {
  switch (checkId) {
    case 'inventory-utilization':
      return '为伪直播预留并重排'
    case 'zero-exposure-blockers':
      return '按 blocker 分析重排'
    case 'all-live-floor':
    case 'real-live-exposure':
      return '为真直播补齐并重排'
    case 'fake-live-exposure':
      return '为伪直播补充段并重排'
    case 'cross-line':
      return '移除违规人群并重排'
    default:
      return '重新自动排期'
  }
}
</script>

<template>
  <Transition name="slide">
    <div
      v-if="open"
      class="fixed inset-y-0 right-0 w-[400px] bg-white shadow-2xl border-l border-slate-200 z-[100] flex flex-col"
    >
      <!-- Header -->
      <div class="h-14 border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-lg">🛡️</span>
          <h2 class="font-bold text-slate-800">规则审计</h2>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="refresh"
            class="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors"
            title="刷新检查"
          >
            <span class="text-lg">↻</span>
          </button>
          <button
            @click="emit('close')"
            class="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors"
          >
            <span class="text-xl leading-none">×</span>
          </button>
        </div>
      </div>

      <!-- Score banner -->
      <div
        v-if="result"
        class="px-5 py-5 border-b border-slate-100 shrink-0"
        :class="scoreBg"
      >
        <div class="flex items-center gap-5">
          <!-- Ring score -->
          <div class="relative w-20 h-20 shrink-0">
            <svg class="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <path
                class="stroke-slate-200"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke-width="3"
              />
              <path
                :class="scoreRing"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke-width="3"
                :stroke-dasharray="`${result.overall.score}, 100`"
                stroke-linecap="round"
              />
            </svg>
            <div class="absolute inset-0 flex items-center justify-center">
              <span class="text-xl font-bold" :class="scoreColor">
                {{ result.overall.score }}
              </span>
            </div>
          </div>

          <!-- Stats -->
          <div class="flex-1">
            <div class="text-sm text-slate-600 mb-2">综合健康分</div>
            <div class="flex gap-3">
              <div class="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-700 text-xs font-medium">
                通过 {{ result.overall.pass }}
              </div>
              <div class="px-2.5 py-1 rounded-md bg-amber-100 text-amber-700 text-xs font-medium">
                警告 {{ result.overall.warning }}
              </div>
              <div class="px-2.5 py-1 rounded-md bg-rose-100 text-rose-700 text-xs font-medium">
                失败 {{ result.overall.fail }}
              </div>
            </div>
            <div class="text-xs text-slate-500 mt-2">
              生成时间：{{ new Date(result.generatedAt).toLocaleTimeString() }}
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else
        class="flex-1 flex items-center justify-center text-slate-400 text-sm"
      >
        点击刷新开始规则审计
      </div>

      <!-- Checks list -->
      <div v-if="result" class="flex-1 overflow-y-auto p-3 space-y-2">
        <div
          v-for="check in sortedChecks"
          :key="check.id"
          class="border rounded-lg overflow-hidden transition-colors"
          :class="[severityBorder(check.severity), severityBg(check.severity)]"
        >
          <button
            @click="toggleItem(check.id)"
            class="w-full px-3 py-2.5 flex items-start gap-2 text-left"
          >
            <span class="text-base mt-0.5 shrink-0">{{ severityIcon(check.severity) }}</span>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm text-slate-800">{{ check.title }}</div>
              <div class="text-xs text-slate-600 mt-0.5 truncate">{{ check.message }}</div>
            </div>
            <span class="text-slate-400 text-xs mt-1 shrink-0">
              {{ expandedIds.has(check.id) ? '收起' : '展开' }}
            </span>
          </button>

          <div
            v-if="expandedIds.has(check.id)"
            class="px-3 pb-3 pt-0 space-y-2"
          >
            <!-- Details -->
            <ul v-if="check.details.length > 0" class="space-y-1">
              <li
                v-for="(detail, idx) in check.details"
                :key="idx"
                class="text-xs text-slate-700 pl-3 border-l-2 border-slate-300 leading-relaxed"
              >
                {{ detail }}
              </li>
            </ul>

            <!-- Suggestions -->
            <div v-if="check.suggestions && check.suggestions.length > 0" class="mt-2">
              <div class="text-[11px] font-medium text-blue-700 mb-1">💡 修复建议</div>
              <ul class="space-y-1">
                <li
                  v-for="(suggestion, idx) in check.suggestions"
                  :key="idx"
                  class="text-xs text-slate-700 pl-3 border-l-2 border-blue-300 leading-relaxed bg-blue-50/60 py-1 rounded-r"
                >
                  {{ suggestion }}
                </li>
              </ul>
            </div>

            <!-- Actions -->
            <div v-if="check.severity !== 'pass'" class="flex flex-wrap gap-2 mt-3">
              <button
                v-if="check.involvedLives && check.involvedLives.length > 0"
                @click="selectLive(check.involvedLives[0])"
                class="px-2.5 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors font-medium"
              >
                选中直播调整
              </button>
              <button
                v-if="check.id === 'category-mapping'"
                @click="openCategoryManager"
                class="px-2.5 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-700 transition-colors font-medium"
              >
                打开品类映射
              </button>
              <button
                v-if="check.id === 'cross-line'"
                @click="fixCrossLineViolations"
                class="px-2.5 py-1 bg-rose-600 text-white text-xs rounded hover:bg-rose-700 transition-colors font-medium"
              >
                移除违规人群并重排
              </button>
              <button
                v-else-if="RECHECKABLE_IDS.has(check.id)"
                @click="handleAutoSchedule"
                class="px-2.5 py-1 bg-slate-700 text-white text-xs rounded hover:bg-slate-800 transition-colors font-medium"
              >
                {{ getActionLabel(check.id) }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer hint -->
      <div class="px-4 py-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 shrink-0">
        规则来源：AGENTS.md、MEMORY.md、PRD v3.4、Codex 排期策略记忆
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
