<script setup lang="ts">
import { ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import {
  parseScheduleWorkbook,
  parseAudienceSheet,
  parseCrossPrefSheet,
} from '@/utils/parser'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'done'): void }>()

const store = useScheduleStore()

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
])

const overallStatus = ref<'idle' | 'parsing' | 'done'>('idle')

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
      }
      const validKeys = ['schedule', 'audience', 'history', 'crossPref', 'fakeHistory'] as const
      type UploadKey = typeof validKeys[number]
      if (validKeys.includes(item.key as UploadKey)) {
        store.updateUploadStatus(item.key as UploadKey, true)
      }
      item.status = 'done'
    } catch (err) {
      console.error('Parse error:', err)
      item.status = 'error'
    }
  }

  overallStatus.value = 'done'

  // Close modal immediately so the user isn't blocked while autoSchedule runs.
  emit('done')
  emit('close')

  // Re-run autoSchedule only when the schedule file does NOT already contain
  // audience assignments (e.g. raw schedule from the livestream team).
  // Completed/calibrated schedules should preserve their manual assignments.
  const hasAudience = store.audienceSegments.length > 0
  const hasCrossPref = files.value.some(f => f.key === 'crossPref' && f.status === 'done')
  const livesHaveAssignments = store.liveStreams.some(l => l.assignedAudiences.length > 0)
  if (!livesHaveAssignments && hasAudience && (hasCrossPref || files.value.some(f => f.key === 'schedule' && f.status === 'done') || files.value.some(f => f.key === 'audience' && f.status === 'done'))) {
    await store.autoSchedule()
  }
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
          </div>

          <!-- Footer -->
          <div class="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50/50">
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
