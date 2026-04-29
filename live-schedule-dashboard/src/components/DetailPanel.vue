<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import type { LineType } from '@/types'

const store = useScheduleStore()

const editingDetail = ref(false)
const editCategory = ref('')
const editLine = ref<LineType>('health')
const editRemember = ref(false)
const editIsCross = ref(false)

function startEditDetail() {
  if (!selectedLive.value) return
  editingDetail.value = true
  editCategory.value = selectedLive.value.category
  editLine.value = selectedLive.value.line
  editRemember.value = true
  editIsCross.value = selectedLive.value.isCrossCategory
}

function saveDetailEdit() {
  if (!selectedLive.value) return
  store.setLiveCategory(selectedLive.value.id, editCategory.value)
  store.setLiveLine(selectedLive.value.id, editLine.value)
  store.setLiveCrossCategory(selectedLive.value.id, editIsCross.value)
  if (editRemember.value) {
    store.setNameOverride(selectedLive.value.name, editCategory.value, editLine.value)
  }
  editingDetail.value = false
}

function cancelDetailEdit() {
  editingDetail.value = false
}

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

const targetExposure = computed(() => {
  const targets: Record<string, number> = { S: 450000, A: 300000, B: 200000, C: 150000 }
  return targets[selectedLive.value?.grade || 'C'] || 150000
})

const selectedAttribution = computed(() => {
  if (!selectedLive.value) return null
  return store.liveAttribution.find((a) => a.liveId === selectedLive.value!.id) || null
})

function removeAudience(segmentId: string) {
  if (!selectedLive.value) return
  store.removeAudience(selectedLive.value.id, segmentId)
}

function getAudienceByLine(line: LineType) {
  return selectedLive.value?.assignedAudiences.filter((a) => a.line === line) || []
}

function getPoolByLine(line: LineType) {
  return store.audienceSegments.filter((s) => s.line === line)
}

interface MergedCategory {
  category: string
  line: LineType
  totalCount: number
  segments: typeof store.audienceSegments
}

const mergedPoolByLine = computed(() => {
  const map = new Map<string, MergedCategory>()
  for (const seg of store.audienceSegments) {
    const key = `${seg.line}-${seg.category}`
    if (!map.has(key)) {
      map.set(key, { category: seg.category, line: seg.line, totalCount: 0, segments: [] })
    }
    const item = map.get(key)!
    item.totalCount += seg.count
    item.segments.push(seg)
  }
  const result: Record<string, MergedCategory[]> = { health: [], beauty: [], interest: [] }
  for (const item of map.values()) {
    result[item.line].push(item)
  }
  for (const line of Object.keys(result) as LineType[]) {
    result[line].sort((a, b) => b.totalCount - a.totalCount)
  }
  return result
})

function getMergedStatus(segments: typeof store.audienceSegments): 'available' | 'used' | 'conflict' {
  if (segments.every((s) => s.status === 'used')) return 'used'
  if (segments.some((s) => s.status === 'available')) return 'available'
  return 'conflict'
}

function quickAssign(segmentId: string) {
  if (!selectedLive.value) return
  store.assignAudience(selectedLive.value.id, segmentId)
}

function getAttributionForAudience(segmentId: string) {
  return selectedAttribution.value?.items.find((i) => i.segmentId === segmentId)
}
</script>

<template>
  <aside class="w-[320px] bg-white border-l border-slate-200 flex flex-col shrink-0 shadow-[-4px_0_24px_rgba(0,0,0,0.02)]">
    <!-- Top Details Panel -->
    <div class="p-4 border-b border-slate-200 overflow-y-auto" :class="selectedLive ? '' : 'flex-1 flex flex-col items-center justify-center'">
      <template v-if="!selectedLive">
        <div class="text-slate-400 text-sm">点击左侧直播查看详情</div>
      </template>

      <template v-else>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-semibold text-[#0b1c30]">直播配置详情</h2>
          <button class="text-slate-400 hover:text-slate-600" @click="store.setSelectedLive(null)">
            &times;
          </button>
        </div>

        <!-- Selected Entity Context -->
        <div class="bg-slate-50 rounded p-3 mb-4 border border-slate-100">
          <div class="flex items-center gap-2 mb-1">
            <span
              class="px-1.5 py-0.5 rounded text-[10px] font-bold border"
              :class="{
                'bg-amber-50 text-amber-700 border-amber-200': selectedLive.grade === 'S',
                'bg-blue-50 text-blue-700 border-blue-200': selectedLive.grade === 'A',
                'bg-sky-50 text-sky-700 border-sky-200': selectedLive.grade === 'B',
                'bg-gray-50 text-gray-600 border-gray-200': selectedLive.grade === 'C',
              }"
            >
              {{ selectedLive.grade || '?' }}级
            </span>
            <span class="text-sm font-bold text-slate-900">{{ selectedLive.name }}</span>
          </div>
          <div class="text-xs font-mono text-slate-500 mb-2">
            {{ selectedLive.date }} {{ selectedLive.startTime }} - {{ selectedLive.endTime }}
          </div>

          <!-- Category / Line Info -->
          <div v-if="!editingDetail" class="flex items-center gap-2 text-xs">
            <span class="text-slate-500">品类:</span>
            <span class="font-medium text-slate-700">{{ selectedLive.category || '未识别' }}</span>
            <span class="text-slate-300">|</span>
            <span class="text-slate-500">线:</span>
            <span class="font-medium" :class="{
              'text-emerald-600': selectedLive.line === 'health',
              'text-pink-600': selectedLive.line === 'beauty',
              'text-purple-600': selectedLive.line === 'interest',
            }">{{ lineLabel[selectedLive.line] }}</span>
            <span
              v-if="selectedLive.isCrossCategory"
              class="ml-1 px-1 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[9px]"
            >跨科</span>
            <button class="ml-auto text-[11px] text-blue-600 hover:underline" @click="startEditDetail">
              编辑
            </button>
          </div>

          <!-- Inline Edit -->
          <div v-else class="space-y-2 mt-1">
            <div class="flex items-center gap-2">
              <label class="text-[11px] text-slate-500 shrink-0">品类</label>
              <input
                v-model="editCategory"
                type="text"
                class="flex-1 text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
              />
            </div>
            <div class="flex items-center gap-2">
              <label class="text-[11px] text-slate-500 shrink-0">线</label>
              <select
                v-model="editLine"
                class="flex-1 text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400 bg-white"
              >
                <option value="health">健康线</option>
                <option value="beauty">变美线</option>
                <option value="interest">兴趣线</option>
              </select>
            </div>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="editIsCross" type="checkbox" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <span class="text-[11px] text-slate-600">跨科直播（不宣发本品类）</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="editRemember" type="checkbox" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <span class="text-[11px] text-slate-600">保存并记住（按直播名）</span>
            </label>
            <div class="flex items-center gap-2">
              <button class="flex-1 text-[11px] text-white bg-blue-600 hover:bg-blue-700 rounded px-2 py-1" @click="saveDetailEdit">
                保存
              </button>
              <button class="flex-1 text-[11px] text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded px-2 py-1" @click="cancelDetailEdit">
                取消
              </button>
            </div>
          </div>
        </div>

        <!-- Alert -->
        <div v-if="selectedLive.conflictReasons.length > 0" class="bg-red-50 border border-red-200 rounded p-2.5 mb-4 flex gap-2 items-start">
          <span class="text-red-500 text-base mt-0.5">!</span>
          <div class="text-xs text-red-800 leading-tight">
            <strong>触达频控警告：</strong>{{ selectedLive.conflictReasons[0] }}
          </div>
        </div>

        <!-- Allocation Controls -->
        <div class="mb-2 flex justify-between items-end">
          <span class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            分配人群池 ({{ selectedLive.assignedAudiences.length }})
          </span>
          <span class="text-xs text-slate-400">
            目标: {{ targetExposure.toLocaleString() }}
          </span>
        </div>

        <div class="space-y-2 mb-4">
          <div v-for="line in (['health', 'beauty', 'interest'] as LineType[])" :key="line" class="mb-2">
            <div class="text-[10px] font-semibold text-slate-400 uppercase mb-1 flex items-center gap-1">
              <div class="w-1.5 h-1.5 rounded-full" :class="lineDotClass[line]"></div>
              {{ lineLabel[line] }}
            </div>
            <div
              v-for="aud in getAudienceByLine(line)"
              :key="aud.segmentId"
              class="p-2 border rounded hover:border-slate-300 mb-1"
              :class="selectedLive.conflictReasons.some(r => r.includes(aud.category)) ? 'bg-red-50/30 border-red-200' : 'border-slate-200'"
            >
              <div class="flex items-center justify-between mb-1">
                <div class="flex items-center gap-2">
                  <div class="w-1 h-3 rounded-full" :class="lineDotClass[line]"></div>
                  <span class="text-sm text-slate-700">{{ aud.category }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs font-mono text-slate-600">{{ (aud.count / 10000).toFixed(1) }}w</span>
                  <button class="text-slate-400 hover:text-red-600" @click="removeAudience(aud.segmentId)">
                    &times;
                  </button>
                </div>
              </div>
              <!-- Attribution mini row -->
              <div
                v-if="getAttributionForAudience(aud.segmentId)"
                class="flex items-center gap-2 text-[10px] text-slate-500 pl-3"
              >
                <span class="text-amber-600">跨科率 {{ (getAttributionForAudience(aud.segmentId)!.crossRate * 100).toFixed(1) }}%</span>
                <span class="text-slate-300">|</span>
                <span class="text-emerald-600">LTV ¥{{ getAttributionForAudience(aud.segmentId)!.ltv.toLocaleString() }}</span>
                <span class="text-slate-300">|</span>
                <span class="text-blue-600">预计转化 {{ (getAttributionForAudience(aud.segmentId)!.expectedConversion / 10000).toFixed(1) }}w</span>
                <span class="text-slate-300">|</span>
                <span class="text-purple-600">预计GMV ¥{{ (getAttributionForAudience(aud.segmentId)!.expectedGMV / 10000).toFixed(1) }}w</span>
              </div>
            </div>
            <div v-if="getAudienceByLine(line).length === 0" class="text-xs text-slate-400 py-1">
              暂无分配
            </div>
          </div>
        </div>

        <!-- Attribution Summary -->
        <div v-if="selectedAttribution" class="bg-slate-50 border border-slate-200 rounded p-3 mb-4">
          <div class="text-[10px] font-semibold text-slate-500 uppercase mb-2">排期归因</div>
          <div class="grid grid-cols-3 gap-2">
            <div class="text-center">
              <div class="text-xs text-slate-500">总触达</div>
              <div class="text-sm font-mono font-bold text-slate-800">{{ (selectedAttribution.totalExposure / 10000).toFixed(1) }}w</div>
            </div>
            <div class="text-center">
              <div class="text-xs text-slate-500">预计转化</div>
              <div class="text-sm font-mono font-bold text-blue-700">{{ (selectedAttribution.expectedConversion / 10000).toFixed(1) }}w</div>
            </div>
            <div class="text-center">
              <div class="text-xs text-slate-500">预计GMV</div>
              <div class="text-sm font-mono font-bold text-emerald-700">¥{{ (selectedAttribution.expectedGMV / 10000).toFixed(1) }}w</div>
            </div>
          </div>
        </div>

        <!-- Suggestion Action -->
        <div class="bg-blue-50 border border-blue-100 rounded p-3 flex justify-between items-center mb-4">
          <div class="flex items-center gap-1.5 text-blue-800 text-xs">
            <span>&#128161;</span>
            <span>系统建议补充 <strong>兴趣泛粉</strong></span>
          </div>
          <button class="text-blue-600 font-bold text-xs hover:underline">采纳建议</button>
        </div>
      </template>
    </div>

    <!-- Bottom Tree List: User Volume -->
    <div class="flex-1 overflow-y-auto p-4 bg-slate-50/50">
      <h3 class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase mb-3">全量人群库存</h3>
      <div class="space-y-3">
        <div v-for="line in (['health', 'beauty', 'interest'] as LineType[])" :key="line">
          <div class="text-xs font-semibold text-slate-700 py-1 flex items-center gap-1">
            <div class="w-1.5 h-1.5 rounded-full" :class="lineDotClass[line]"></div>
            {{ lineLabel[line] }}
            <span class="ml-auto font-mono text-[10px] text-slate-400">
              {{ getPoolByLine(line).reduce((s, a) => s + a.count, 0).toLocaleString() }}
            </span>
          </div>
          <div class="pl-4 space-y-1 border-l border-slate-200 ml-1.5 mt-1">
            <div
              v-for="item in mergedPoolByLine[line]"
              :key="item.category"
              class="group relative"
            >
              <!-- Merged Row -->
              <div
                class="flex items-center justify-between py-1.5 hover:bg-white rounded px-2 -ml-2 cursor-pointer"
                @click="item.segments.find(s => s.status === 'available') ? quickAssign(item.segments.find(s => s.status === 'available')!.id) : null"
              >
                <span class="text-xs text-slate-600 truncate">{{ item.category }} · 多期存量</span>
                <div class="flex items-center gap-2 shrink-0">
                  <span
                    v-if="getMergedStatus(item.segments) === 'used'"
                    class="px-1 py-0.5 bg-slate-200 text-slate-600 rounded text-[9px] font-mono leading-none"
                  >
                    已排
                  </span>
                  <span class="text-xs font-mono" :class="getMergedStatus(item.segments) === 'used' ? 'text-slate-400' : 'text-slate-700 font-medium'">
                    {{ (item.totalCount / 10000).toFixed(1) }}w
                  </span>
                </div>
              </div>

              <!-- Tooltip with original segments -->
              <div
                class="hidden group-hover:block absolute left-full top-0 ml-2 z-20 w-56 bg-white border border-slate-200 rounded shadow-lg p-2"
              >
                <div class="text-[10px] font-semibold text-slate-700 mb-1">{{ item.category }} 细分</div>
                <div
                  v-for="seg in item.segments"
                  :key="seg.id"
                  class="flex items-center justify-between py-0.5"
                >
                  <span class="text-[10px] text-slate-500">{{ seg.timeRange }}</span>
                  <span class="text-[10px] font-mono" :class="seg.status === 'used' ? 'text-slate-400' : 'text-slate-700'">
                    {{ (seg.count / 10000).toFixed(1) }}w
                  </span>
                </div>
                <div class="mt-1 pt-1 border-t border-slate-100 flex justify-between">
                  <span class="text-[10px] text-slate-500">合计</span>
                  <span class="text-[10px] font-mono font-bold text-slate-800">{{ (item.totalCount / 10000).toFixed(1) }}w</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
