<script setup lang="ts">
import { ref, watch, defineComponent, h } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import type { GradeType } from '@/types'
import {
  parseScheduleWorkbook,
  parseAudienceSheet,
  parseCrossPrefSheet,
  parseLiveDetailSheet,
} from '@/utils/parser'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'done'): void }>()

const store = useScheduleStore()

// Reusable editable live tag for confirmation panel
const LiveEditTag = defineComponent({
  props: {
    live: { type: Object, required: true },
    dim: { type: Boolean, default: false },
  },
  setup(props) {
    return () => {
      const live = props.live as LivePreview
      const dim = props.dim
      const baseCls = dim
        ? 'bg-slate-100 border-slate-200 text-slate-500'
        : 'bg-white border-slate-200 text-slate-700'
      const selCls = dim
        ? 'bg-slate-200 border-slate-300 text-slate-500'
        : 'bg-white border-slate-300 text-slate-700'
      return h('span', {
        class: `inline-flex items-center gap-1 px-2 py-0.5 rounded border ${baseCls}`,
      }, [
        h('span', { class: 'font-medium' }, live.name),
        h('select', {
          value: live.grade || '',
          onChange: (e: Event) => updateLiveGrade(live.id, (e.target as HTMLSelectElement).value || null),
          class: `text-[10px] px-0.5 py-0 rounded border outline-none cursor-pointer ${selCls}`,
        }, GRADE_OPTIONS.map((g) => h('option', { value: g.value, key: g.value }, g.label))),
        !dim
          ? h('input', {
              value: live.category,
              onBlur: (e: Event) => updateLiveCategory(live.id, (e.target as HTMLInputElement).value),
              class: 'text-[10px] w-14 px-1 py-0 rounded border border-slate-200 outline-none text-slate-400',
            })
          : null,
        h('button', {
          onClick: (e: MouseEvent) => { e.stopPropagation(); removeLive(live.id) },
          class: 'text-slate-300 hover:text-red-500 leading-none ml-0.5 text-xs',
          title: '删除',
        }, '×'),
      ])
    }
  },
})

function formatWeekRange(weekDays: { fullDate: string }[]): string {
  if (weekDays.length === 0) return ''
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return { y, m, d }
  }
  const start = parse(weekDays[0].fullDate)
  const end = parse(weekDays[weekDays.length - 1].fullDate)
  const startStr = `${start.y}.${start.m}.${start.d}`
  const endStr = start.y === end.y ? `${end.m}.${end.d}` : `${end.y}.${end.m}.${end.d}`
  return `${startStr} - ${endStr}`
}

interface FileItem {
  key: string
  label: string
  desc: string
  required: boolean
  file: File | null
  status: 'idle' | 'parsing' | 'done' | 'error'
}

const files = ref<FileItem[]>([
  { key: 'schedule', label: '直播排期表', desc: '直播组提供的一周直播排期（含历史sheet，系统自动追溯）', required: true, file: null, status: 'idle' },
  { key: 'audience', label: '用户量级表', desc: '各品类各时间段阶梯的存量用户数（若排期文件中已包含可跳过）', required: false, file: null, status: 'idle' },
  { key: 'crossPref', label: '跨科偏好数据', desc: '转继承新增用户day60跨科品类.xlsx', required: false, file: null, status: 'idle' },
  { key: 'liveDetail', label: '4月直播明细表', desc: '包含实际GMV、单场贡献占比的历史明细（用于校准归因模型）', required: false, file: null, status: 'idle' },
])

const overallStatus = ref<'idle' | 'parsing' | 'done'>('idle')
const showConfirm = ref(false)

// Reset confirmation state when modal is opened/closed
watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    showConfirm.value = false
    uploadSummary.value = null
  }
})

interface LivePreview {
  id: string
  name: string
  category: string
  grade: string | null
  line: string
  type: 'real' | 'fake'
}

interface SlotLives {
  real: LivePreview[]
  fake: LivePreview[]
}

interface DaySchedule {
  date: string
  dayLabel: string
  morning: SlotLives
  evening: SlotLives
  friendCircle: SlotLives
}

interface GradeDistribution {
  S: { real: LivePreview[]; fake: LivePreview[] }
  A: { real: LivePreview[]; fake: LivePreview[] }
  B: { real: LivePreview[]; fake: LivePreview[] }
  C: { real: LivePreview[]; fake: LivePreview[] }
}

interface UploadSummary {
  realLives: number
  fakeLives: number
  audienceSegments: number
  audienceCategories: number
  crossPrefs: number
  historyRecords: number
  shouldAutoSchedule: boolean
  scheduleByDay: DaySchedule[]
  morningGrades: GradeDistribution
  eveningGrades: GradeDistribution
  lineDistribution: Record<string, { real: LivePreview[]; fake: LivePreview[] }>
}
const uploadSummary = ref<UploadSummary | null>(null)

const GRADE_OPTIONS = [
  { label: 'S', value: 'S', cls: 'bg-red-50 text-red-600' },
  { label: 'A', value: 'A', cls: 'bg-orange-50 text-orange-600' },
  { label: 'B', value: 'B', cls: 'bg-blue-50 text-blue-600' },
  { label: 'C', value: 'C', cls: 'bg-slate-100 text-slate-500' },
  { label: '—', value: '', cls: 'bg-slate-50 text-slate-400' },
]

function onFileSelect(key: string, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const item = files.value.find(f => f.key === key)
  if (item) {
    item.file = file
    item.status = 'idle'
  }
}

function removeFile(key: string) {
  const item = files.value.find(f => f.key === key)
  if (item) {
    item.file = null
    item.status = 'idle'
  }
}

async function handleSubmit() {
  const requiredFiles = files.value.filter(f => f.required && !f.file)
  if (requiredFiles.length > 0) {
    alert(`请上传必填文件：${requiredFiles.map(f => f.label).join('、')}`)
    return
  }

  // Pause cloud sync during upload to prevent stale cloud data from overwriting fresh uploads
  store.pauseCloudSync()

  // Clear old data so stale segments from previous uploads don't linger
  store.setLiveStreams([])
  store.setAudienceSegments([])
  store.setHistoryRecords([])

  overallStatus.value = 'parsing'

  for (const item of files.value) {
    if (!item.file) continue
    item.status = 'parsing'

    try {
      const buffer = await item.file.arrayBuffer()
      switch (item.key) {
        case 'schedule': {
          const result = parseScheduleWorkbook(buffer, item.file?.name)
          console.log('[Upload Debug] parseScheduleWorkbook result:', {
            livesCount: result.lives.length,
            weekDaysCount: result.weekDays.length,
            weekDays: result.weekDays.map(d => d.date),
            audienceSegmentsCount: result.audienceSegments.length,
            historyRecordsCount: result.historyRecords.length,
          })
          if (result.lives.length > 0) {
            store.setLiveStreams(result.lives)
            store.setWeekDays(result.weekDays)
            store.setCurrentWeek(formatWeekRange(result.weekDays))
            // Apply historical mappings so user doesn't have to re-categorize every week
            store.applyNameOverrides()
            store.applyCategoryGrades()
          }
          if (result.audienceSegments.length > 0) {
            store.setAudienceSegments(result.audienceSegments)
            store.updateUploadStatus('audience', true)
          }
          if (result.historyRecords.length > 0) {
            store.setHistoryRecords(result.historyRecords)
            store.updateUploadStatus('history', true)
          }
          break
        }
        case 'audience': {
          const segs = parseAudienceSheet(buffer)
          if (segs.length > 0) store.setAudienceSegments(segs)
          break
        }
        case 'crossPref': {
          const result = parseCrossPrefSheet(buffer)
          if (result.crossPrefs.length > 0) store.setCrossPrefs(result.crossPrefs)
          if (result.crossCategoryPrefs.length > 0) store.setCrossCategoryPrefs(result.crossCategoryPrefs)
          break
        }
        case 'liveDetail': {
          const stats = parseLiveDetailSheet(buffer)
          store.setCategoryHistoricalStats(stats)
          break
        }
      }
      const validKeys = ['schedule', 'audience', 'history', 'crossPref', 'fakeHistory', 'liveDetail'] as const
      type UploadKey = typeof validKeys[number]
      if (validKeys.includes(item.key as UploadKey)) {
        store.updateUploadStatus(item.key as UploadKey, true)
      }
      item.status = 'done'
    } catch (err: any) {
      console.error('Parse error:', err)
      item.status = 'error'
      alert(`【${item.label}】解析失败：${err?.message || String(err)}`)
      // 中断上传流程，避免在错误状态下继续 autoSchedule
      overallStatus.value = 'idle'
      store.resumeCloudSync()
      return
    }
  }

  overallStatus.value = 'done'

  // Generate summary and show confirmation panel instead of closing immediately
  const realLives = store.liveStreams.filter(l => l.type === 'real').length
  const fakeLives = store.liveStreams.filter(l => l.type === 'fake').length
  const audienceCategories = new Set(store.audienceSegments.map(s => s.category)).size
  const hasAudience = store.audienceSegments.length > 0
  const hasCrossPref = files.value.some(f => f.key === 'crossPref' && f.status === 'done')
  const realLivesHaveAssignments = store.liveStreams.some(l => l.type === 'real' && l.assignedAudiences.length > 0)
  const shouldAutoSchedule = !realLivesHaveAssignments && hasAudience && (hasCrossPref || files.value.some(f => f.key === 'schedule' && f.status === 'done') || files.value.some(f => f.key === 'audience' && f.status === 'done'))

  // Build detailed schedule preview (real + fake, separated)
  const toPreview = (l: any): LivePreview => ({ id: l.id, name: l.name, category: l.category, grade: l.grade, line: l.line, type: l.type })
  const bySlot = (lives: any[], slot: string) => lives.filter((l: any) => l.slot === slot || l.slot === `fake-${slot}`)

  const scheduleByDay: DaySchedule[] = store.weekDays.map((day: any) => {
    const dayLives = store.liveStreams.filter((l: any) => l.date === day.fullDate)
    const morningLives = bySlot(dayLives, 'morning')
    const eveningLives = bySlot(dayLives, 'evening')
    const fcLives = dayLives.filter((l: any) => l.slot === 'friend-circle')
    return {
      date: day.fullDate,
      dayLabel: day.date,
      morning: { real: morningLives.filter((l: any) => l.type === 'real').map(toPreview), fake: morningLives.filter((l: any) => l.type === 'fake').map(toPreview) },
      evening: { real: eveningLives.filter((l: any) => l.type === 'real').map(toPreview), fake: eveningLives.filter((l: any) => l.type === 'fake').map(toPreview) },
      friendCircle: { real: fcLives.filter((l: any) => l.type === 'real').map(toPreview), fake: fcLives.filter((l: any) => l.type === 'fake').map(toPreview) },
    }
  }).filter((d: DaySchedule) =>
    d.morning.real.length + d.morning.fake.length +
    d.evening.real.length + d.evening.fake.length +
    d.friendCircle.real.length + d.friendCircle.fake.length > 0
  )

  const buildGradeDist = (slotPrefix: string): GradeDistribution => {
    const slotLives = store.liveStreams.filter((l: any) => l.slot === slotPrefix || l.slot === `fake-${slotPrefix}`)
    return {
      S: { real: slotLives.filter((l: any) => l.grade === 'S' && l.type === 'real').map(toPreview), fake: slotLives.filter((l: any) => l.grade === 'S' && l.type === 'fake').map(toPreview) },
      A: { real: slotLives.filter((l: any) => l.grade === 'A' && l.type === 'real').map(toPreview), fake: slotLives.filter((l: any) => l.grade === 'A' && l.type === 'fake').map(toPreview) },
      B: { real: slotLives.filter((l: any) => l.grade === 'B' && l.type === 'real').map(toPreview), fake: slotLives.filter((l: any) => l.grade === 'B' && l.type === 'fake').map(toPreview) },
      C: { real: slotLives.filter((l: any) => l.grade === 'C' && l.type === 'real').map(toPreview), fake: slotLives.filter((l: any) => l.grade === 'C' && l.type === 'fake').map(toPreview) },
    }
  }
  const morningGrades = buildGradeDist('morning')
  const eveningGrades = buildGradeDist('evening')

  const lineKeys: Record<string, string> = { health: '健康线', beauty: '变美线', interest: '兴趣线' }
  const lineDistribution: Record<string, { real: LivePreview[]; fake: LivePreview[] }> = {}
  for (const line of ['health', 'beauty', 'interest'] as const) {
    const lives = store.liveStreams.filter((l: any) => l.line === line)
    if (lives.length > 0) {
      lineDistribution[lineKeys[line] || line] = {
        real: lives.filter((l: any) => l.type === 'real').map(toPreview),
        fake: lives.filter((l: any) => l.type === 'fake').map(toPreview),
      }
    }
  }

  uploadSummary.value = {
    realLives,
    fakeLives,
    audienceSegments: store.audienceSegments.length,
    audienceCategories,
    crossPrefs: store.crossCategoryPrefs.length,
    historyRecords: store.historyRecords.length,
    shouldAutoSchedule,
    scheduleByDay,
    morningGrades,
    eveningGrades,
    lineDistribution,
  }
  showConfirm.value = true
}

// Inline edit helpers: modify store live and refresh summary
function updateLiveGrade(liveId: string, grade: string | null) {
  const live = store.liveStreams.find((l: any) => l.id === liveId)
  if (live) {
    live.grade = grade as GradeType | null
    recalcSummary()
  }
}

function updateLiveCategory(liveId: string, category: string) {
  const live = store.liveStreams.find((l: any) => l.id === liveId)
  if (live) {
    live.category = category
    recalcSummary()
  }
}

function removeLive(liveId: string) {
  const idx = store.liveStreams.findIndex((l: any) => l.id === liveId)
  if (idx !== -1) {
    store.liveStreams.splice(idx, 1)
    recalcSummary()
  }
}

function recalcSummary() {
  if (!uploadSummary.value) return
  const realLives = store.liveStreams.filter((l: any) => l.type === 'real').length
  const fakeLives = store.liveStreams.filter((l: any) => l.type === 'fake').length
  const hasAudience = store.audienceSegments.length > 0
  const hasCrossPref = files.value.some((f: any) => f.key === 'crossPref' && f.status === 'done')
  const realLivesHaveAssignments = store.liveStreams.some((l: any) => l.type === 'real' && l.assignedAudiences.length > 0)
  const shouldAutoSchedule = !realLivesHaveAssignments && hasAudience && (hasCrossPref || files.value.some((f: any) => f.key === 'schedule' && f.status === 'done') || files.value.some((f: any) => f.key === 'audience' && f.status === 'done'))

  const toPreview = (l: any): LivePreview => ({ id: l.id, name: l.name, category: l.category, grade: l.grade, line: l.line, type: l.type })
  const bySlot = (lives: any[], slot: string) => lives.filter((l: any) => l.slot === slot || l.slot === `fake-${slot}`)

  const scheduleByDay: DaySchedule[] = store.weekDays.map((day: any) => {
    const dayLives = store.liveStreams.filter((l: any) => l.date === day.fullDate)
    const morningLives = bySlot(dayLives, 'morning')
    const eveningLives = bySlot(dayLives, 'evening')
    const fcLives = dayLives.filter((l: any) => l.slot === 'friend-circle')
    return {
      date: day.fullDate,
      dayLabel: day.date,
      morning: { real: morningLives.filter((l: any) => l.type === 'real').map(toPreview), fake: morningLives.filter((l: any) => l.type === 'fake').map(toPreview) },
      evening: { real: eveningLives.filter((l: any) => l.type === 'real').map(toPreview), fake: eveningLives.filter((l: any) => l.type === 'fake').map(toPreview) },
      friendCircle: { real: fcLives.filter((l: any) => l.type === 'real').map(toPreview), fake: fcLives.filter((l: any) => l.type === 'fake').map(toPreview) },
    }
  }).filter((d: DaySchedule) =>
    d.morning.real.length + d.morning.fake.length +
    d.evening.real.length + d.evening.fake.length +
    d.friendCircle.real.length + d.friendCircle.fake.length > 0
  )

  const buildGradeDist = (slotPrefix: string): GradeDistribution => {
    const slotLives = store.liveStreams.filter((l: any) => l.slot === slotPrefix || l.slot === `fake-${slotPrefix}`)
    return {
      S: { real: slotLives.filter((l: any) => l.grade === 'S' && l.type === 'real').map(toPreview), fake: slotLives.filter((l: any) => l.grade === 'S' && l.type === 'fake').map(toPreview) },
      A: { real: slotLives.filter((l: any) => l.grade === 'A' && l.type === 'real').map(toPreview), fake: slotLives.filter((l: any) => l.grade === 'A' && l.type === 'fake').map(toPreview) },
      B: { real: slotLives.filter((l: any) => l.grade === 'B' && l.type === 'real').map(toPreview), fake: slotLives.filter((l: any) => l.grade === 'B' && l.type === 'fake').map(toPreview) },
      C: { real: slotLives.filter((l: any) => l.grade === 'C' && l.type === 'real').map(toPreview), fake: slotLives.filter((l: any) => l.grade === 'C' && l.type === 'fake').map(toPreview) },
    }
  }
  const morningGrades = buildGradeDist('morning')
  const eveningGrades = buildGradeDist('evening')

  const lineKeys: Record<string, string> = { health: '健康线', beauty: '变美线', interest: '兴趣线' }
  const lineDistribution: Record<string, { real: LivePreview[]; fake: LivePreview[] }> = {}
  for (const line of ['health', 'beauty', 'interest'] as const) {
    const lives = store.liveStreams.filter((l: any) => l.line === line)
    if (lives.length > 0) {
      lineDistribution[lineKeys[line] || line] = {
        real: lives.filter((l: any) => l.type === 'real').map(toPreview),
        fake: lives.filter((l: any) => l.type === 'fake').map(toPreview),
      }
    }
  }

  uploadSummary.value = {
    realLives,
    fakeLives,
    audienceSegments: store.audienceSegments.length,
    audienceCategories: new Set(store.audienceSegments.map((s: any) => s.category)).size,
    crossPrefs: store.crossCategoryPrefs.length,
    historyRecords: store.historyRecords.length,
    shouldAutoSchedule,
    scheduleByDay,
    morningGrades,
    eveningGrades,
    lineDistribution,
  }
}

async function handleConfirm() {
  showConfirm.value = false
  emit('done')
  emit('close')

  if (uploadSummary.value?.shouldAutoSchedule) {
    await store.autoSchedule()
  }

  // Resume cloud sync after upload + autoSchedule are fully done
  store.resumeCloudSync()
}

function handleCancelConfirm() {
  showConfirm.value = false
  store.resumeCloudSync()
}

function reset() {
  files.value.forEach(f => {
    f.file = null
    f.status = 'idle'
  })
  overallStatus.value = 'idle'
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[100] flex items-center justify-center">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />

        <!-- Modal -->
        <div class="relative bg-white rounded-xl shadow-2xl w-[640px] max-w-[90vw] max-h-[85vh] flex flex-col overflow-hidden">
          <!-- Header -->
          <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div>
              <h2 class="text-lg font-bold text-[#0b1c30]">上传本周排期数据</h2>
              <p class="text-xs text-slate-500 mt-0.5">上传完成后系统将自动生成预测排期</p>
            </div>
            <button class="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 transition-colors" @click="emit('close')">
              &times;
            </button>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto p-6 space-y-4">
            <!-- File list -->
            <template v-if="!showConfirm">
              <div
                v-for="item in files"
                :key="item.key"
                class="border rounded-lg p-4 transition-colors"
                :class="{
                  'border-slate-200 bg-white': item.status === 'idle',
                  'border-blue-300 bg-blue-50/30': item.status === 'parsing',
                  'border-emerald-300 bg-emerald-50/20': item.status === 'done',
                  'border-red-300 bg-red-50/20': item.status === 'error',
                }"
              >
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-slate-900">{{ item.label }}</span>
                    <span v-if="item.required" class="px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[10px] font-bold">必填</span>
                  </div>
                  <span v-if="item.status === 'done'" class="text-emerald-600 text-sm">&#10003;</span>
                  <span v-else-if="item.status === 'error'" class="text-red-600 text-sm">!</span>
                </div>
                <p class="text-xs text-slate-500 mb-3">{{ item.desc }}</p>

                <div v-if="!item.file" class="flex items-center gap-3">
                  <label class="cursor-pointer">
                    <input type="file" accept=".xlsx,.xls,.csv" class="hidden" @change="onFileSelect(item.key, $event)" />
                    <span class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:border-blue-400 hover:text-blue-600 rounded text-sm transition-colors">
                      <span>&#8679;</span> 选择文件
                    </span>
                  </label>
                  <span class="text-xs text-slate-400">支持 .xlsx / .xls / .csv</span>
                </div>

                <div v-else class="flex items-center justify-between bg-slate-50 rounded px-3 py-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-blue-600 text-sm">&#128196;</span>
                    <span class="text-sm text-slate-700 truncate">{{ item.file.name }}</span>
                  </div>
                  <button class="text-slate-400 hover:text-red-600 text-sm px-1" @click="removeFile(item.key)">
                    &#10005;
                  </button>
                </div>
              </div>
            </template>

            <!-- Confirmation panel -->
            <template v-else>
              <div class="space-y-5">
                <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <h3 class="text-sm font-bold text-emerald-800 mb-1">&#10003; 数据解析完成</h3>
                  <p class="text-xs text-emerald-600">请核对以下排期信息，确认无误后点击「确认并生成排期」</p>
                </div>

                <!-- 1. 时间段排期（按天 → 晨练/晚间 → 真/伪） -->
                <div>
                  <h4 class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">&#128197; 时间段排期</h4>
                  <div class="space-y-2">
                    <div v-for="day in uploadSummary?.scheduleByDay" :key="day.date" class="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                      <div class="px-3 py-2 bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
                        <span>{{ day.dayLabel }}</span>
                        <span class="text-slate-400 font-normal">
                          真{{ (day.morning.real.length + day.evening.real.length + day.friendCircle.real.length) }} /
                          伪{{ (day.morning.fake.length + day.evening.fake.length + day.friendCircle.fake.length) }}
                        </span>
                      </div>
                      <div class="p-3 space-y-2.5 text-xs">
                        <!-- 晨练 -->
                        <div v-if="day.morning.real.length + day.morning.fake.length" class="space-y-1.5">
                          <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">晨练</div>
                          <div v-if="day.morning.real.length" class="flex gap-2">
                            <span class="shrink-0 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-bold">真直播</span>
                            <div class="flex flex-wrap gap-1.5">
                              <LiveEditTag v-for="live in day.morning.real" :key="live.id" :live="live" />
                            </div>
                          </div>
                          <div v-if="day.morning.fake.length" class="flex gap-2">
                            <span class="shrink-0 px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold">伪直播</span>
                            <div class="flex flex-wrap gap-1.5">
                              <LiveEditTag v-for="live in day.morning.fake" :key="live.id" :live="live" dim />
                            </div>
                          </div>
                        </div>
                        <!-- 晚间 -->
                        <div v-if="day.evening.real.length + day.evening.fake.length" class="space-y-1.5">
                          <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">晚间</div>
                          <div v-if="day.evening.real.length" class="flex gap-2">
                            <span class="shrink-0 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-bold">真直播</span>
                            <div class="flex flex-wrap gap-1.5">
                              <LiveEditTag v-for="live in day.evening.real" :key="live.id" :live="live" />
                            </div>
                          </div>
                          <div v-if="day.evening.fake.length" class="flex gap-2">
                            <span class="shrink-0 px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold">伪直播</span>
                            <div class="flex flex-wrap gap-1.5">
                              <LiveEditTag v-for="live in day.evening.fake" :key="live.id" :live="live" dim />
                            </div>
                          </div>
                        </div>
                        <!-- 朋友圈 -->
                        <div v-if="day.friendCircle.real.length + day.friendCircle.fake.length" class="space-y-1.5">
                          <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">朋友圈</div>
                          <div v-if="day.friendCircle.real.length" class="flex gap-2">
                            <span class="shrink-0 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-bold">真直播</span>
                            <div class="flex flex-wrap gap-1.5">
                              <LiveEditTag v-for="live in day.friendCircle.real" :key="live.id" :live="live" />
                            </div>
                          </div>
                          <div v-if="day.friendCircle.fake.length" class="flex gap-2">
                            <span class="shrink-0 px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold">伪直播</span>
                            <div class="flex flex-wrap gap-1.5">
                              <LiveEditTag v-for="live in day.friendCircle.fake" :key="live.id" :live="live" dim />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 2. 直播等级分布（按晨练/晚间分板块） -->
                <div>
                  <h4 class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">&#11088; 直播等级分布</h4>
                  <div class="grid grid-cols-2 gap-3">
                    <!-- 晨练 -->
                    <div class="bg-slate-50 rounded-lg border border-slate-200 p-3 space-y-2">
                      <div class="text-xs font-bold text-slate-700 border-b border-slate-200 pb-1.5">晨练</div>
                      <div v-for="(data, grade) in uploadSummary?.morningGrades" :key="'m-'+grade" class="space-y-1">
                        <div class="flex items-center gap-1.5">
                          <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded font-bold text-[10px]" :class="{
                            'bg-red-50 text-red-600 border border-red-100': grade === 'S',
                            'bg-orange-50 text-orange-600 border border-orange-100': grade === 'A',
                            'bg-blue-50 text-blue-600 border border-blue-100': grade === 'B',
                            'bg-slate-100 text-slate-500 border border-slate-200': grade === 'C',
                          }">{{ grade }}</span>
                          <span class="text-[10px] text-slate-400">真{{ data.real.length }} / 伪{{ data.fake.length }}</span>
                        </div>
                        <div v-if="data.real.length" class="flex flex-wrap gap-1 pl-6">
                          <LiveEditTag v-for="live in data.real" :key="live.id" :live="live" />
                        </div>
                        <div v-if="data.fake.length" class="flex flex-wrap gap-1 pl-6">
                          <LiveEditTag v-for="live in data.fake" :key="live.id" :live="live" dim />
                        </div>
                      </div>
                    </div>
                    <!-- 晚间 -->
                    <div class="bg-slate-50 rounded-lg border border-slate-200 p-3 space-y-2">
                      <div class="text-xs font-bold text-slate-700 border-b border-slate-200 pb-1.5">晚间</div>
                      <div v-for="(data, grade) in uploadSummary?.eveningGrades" :key="'e-'+grade" class="space-y-1">
                        <div class="flex items-center gap-1.5">
                          <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded font-bold text-[10px]" :class="{
                            'bg-red-50 text-red-600 border border-red-100': grade === 'S',
                            'bg-orange-50 text-orange-600 border border-orange-100': grade === 'A',
                            'bg-blue-50 text-blue-600 border border-blue-100': grade === 'B',
                            'bg-slate-100 text-slate-500 border border-slate-200': grade === 'C',
                          }">{{ grade }}</span>
                          <span class="text-[10px] text-slate-400">真{{ data.real.length }} / 伪{{ data.fake.length }}</span>
                        </div>
                        <div v-if="data.real.length" class="flex flex-wrap gap-1 pl-6">
                          <LiveEditTag v-for="live in data.real" :key="live.id" :live="live" />
                        </div>
                        <div v-if="data.fake.length" class="flex flex-wrap gap-1 pl-6">
                          <LiveEditTag v-for="live in data.fake" :key="live.id" :live="live" dim />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 3. 直播分类（按板块/线级） -->
                <div>
                  <h4 class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">&#128204; 直播分类（按板块）</h4>
                  <div class="space-y-2">
                    <div v-for="(data, lineName) in uploadSummary?.lineDistribution" :key="lineName" class="bg-slate-50 rounded-lg border border-slate-200 p-3">
                      <div class="flex items-center justify-between mb-2">
                        <div class="text-xs font-bold text-slate-700">{{ lineName }}</div>
                        <div class="text-[10px] text-slate-400">
                          真{{ data.real.length }} / 伪{{ data.fake.length }}
                        </div>
                      </div>
                      <div v-if="data.real.length" class="mb-1.5">
                        <div class="text-[10px] text-emerald-600 font-bold mb-1">真直播</div>
                        <div class="flex flex-wrap gap-1.5">
                          <LiveEditTag v-for="live in data.real" :key="live.id" :live="live" />
                        </div>
                      </div>
                      <div v-if="data.fake.length">
                        <div class="text-[10px] text-slate-400 font-bold mb-1">伪直播</div>
                        <div class="flex flex-wrap gap-1.5">
                          <LiveEditTag v-for="live in data.fake" :key="live.id" :live="live" dim />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 4. 基础统计 -->
                <div class="grid grid-cols-4 gap-2">
                  <div class="bg-slate-50 rounded-lg p-2 border border-slate-200 text-center">
                    <div class="text-lg font-bold text-slate-900">{{ uploadSummary?.realLives }}</div>
                    <div class="text-[10px] text-slate-500">real 场次</div>
                  </div>
                  <div class="bg-slate-50 rounded-lg p-2 border border-slate-200 text-center">
                    <div class="text-lg font-bold text-slate-900">{{ uploadSummary?.fakeLives }}</div>
                    <div class="text-[10px] text-slate-500">fake 场次</div>
                  </div>
                  <div class="bg-slate-50 rounded-lg p-2 border border-slate-200 text-center">
                    <div class="text-lg font-bold text-slate-900">{{ uploadSummary?.audienceSegments }}</div>
                    <div class="text-[10px] text-slate-500">audience 段</div>
                  </div>
                  <div class="bg-slate-50 rounded-lg p-2 border border-slate-200 text-center">
                    <div class="text-lg font-bold text-slate-900">{{ uploadSummary?.crossPrefs }}</div>
                    <div class="text-[10px] text-slate-500">跨科偏好</div>
                  </div>
                </div>

                <div v-if="!uploadSummary?.shouldAutoSchedule" class="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div class="text-xs text-amber-700">
                    <span class="font-bold">&#9888; 不满足自动排期条件</span> — 可能原因：已有 audience 分配 或缺少必要数据。请检查文件内容。
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div class="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50/50">
            <template v-if="!showConfirm">
              <button class="text-sm text-slate-500 hover:text-slate-800 transition-colors" @click="reset">
                清空已选
              </button>
              <div class="flex items-center gap-3">
                <button class="text-sm text-slate-600 hover:text-slate-900 px-4 py-2 rounded transition-colors" @click="emit('close')">
                  取消
                </button>
                <button
                  class="text-sm text-white bg-primary hover:bg-blue-700 px-5 py-2 rounded shadow-sm transition-colors flex items-center gap-2"
                  :disabled="overallStatus === 'parsing'"
                  @click="handleSubmit"
                >
                  <span v-if="overallStatus === 'parsing'">生成中...</span>
                  <span v-else>&#10022; 上传并生成排期</span>
                </button>
              </div>
            </template>
            <template v-else>
              <button class="text-sm text-slate-500 hover:text-slate-800 transition-colors" @click="handleCancelConfirm">
                返回修改
              </button>
              <div class="flex items-center gap-3">
                <button class="text-sm text-slate-600 hover:text-slate-900 px-4 py-2 rounded transition-colors" @click="emit('close')">
                  关闭
                </button>
                <button
                  v-if="uploadSummary?.shouldAutoSchedule"
                  class="text-sm text-white bg-primary hover:bg-blue-700 px-5 py-2 rounded shadow-sm transition-colors flex items-center gap-2"
                  @click="handleConfirm"
                >
                  <span>&#10022; 确认并生成排期</span>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
