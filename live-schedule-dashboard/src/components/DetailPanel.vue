<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { mergeAudiences } from '@/utils/exporter'
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

// PRD v2.0 target exposure; support joint live override
const targetExposure = computed(() => {
  const targets: Record<string, number> = { S: 350000, A: 220000, B: 150000, C: 120000 }
  return selectedLive.value?.target ?? targets[selectedLive.value?.grade || 'C'] ?? 120000
})

const selectedAttribution = computed(() => {
  if (!selectedLive.value) return null
  return store.liveAttribution.find((a) => a.liveId === selectedLive.value!.id) || null
})

function getAudienceByLine(line: LineType) {
  return selectedLive.value?.assignedAudiences.filter((a) => a.line === line) || []
}

function getMergedAudienceByLine(line: LineType) {
  const items = getAudienceByLine(line)
  return mergeAudiences(items)
}

function removeAudienceByCategory(category: string) {
  if (!selectedLive.value) return
  const toRemove = selectedLive.value.assignedAudiences.filter((a) => a.category === category)
  for (const a of toRemove) {
    store.removeAudience(selectedLive.value.id, a.segmentId)
  }
}

function formatCount(n: number): string {
  if (n === 0) return '0'
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 10000).toFixed(2)}w`
  return `${Math.round(n)}`
}

function formatGMV(n: number): string {
  if (n === 0) return '¥0'
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `¥${(n / 1000).toFixed(1)}k`
  return `¥${Math.round(n)}`
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

        <!-- Fake Live Warning -->
        <div v-if="selectedLive.type === 'fake'" class="bg-amber-50 border border-amber-200 rounded p-2.5 mb-4 flex gap-2 items-start">
          <span class="text-amber-500 text-base mt-0.5">&#9888;</span>
          <div class="text-xs text-amber-800 leading-tight">
            <strong>伪直播频控：</strong>30天内同一人群不得复用2次。请确认该品类+时间段的历史复用间隔 ≥ 30天。
          </div>
        </div>

        <!-- Alert -->
        <div v-if="selectedLive.conflictReasons.length > 0" class="bg-red-50 border border-red-200 rounded p-2.5 mb-4 flex gap-2 items-start">
          <span class="text-red-500 text-base mt-0.5">!</span>
          <div class="text-xs text-red-800 leading-tight">
            <strong>触达频控警告：</strong>{{ selectedLive.conflictReasons[0] }}
          </div>
        </div>

        <!-- Fake History Audiences (上周记录·本周剔除) -->
        <div v-if="(selectedLive.fakeHistoryAudiences ?? []).length > 0" class="mb-4">
          <div class="mb-2 flex justify-between items-end">
            <span class="text-[11px] font-semibold tracking-wide text-teal-600 uppercase">
              上周记录 · 本周剔除 ({{ (selectedLive.fakeHistoryAudiences ?? []).length }})
            </span>
            <span class="text-xs text-slate-400">
              共 {{ ((selectedLive.fakeHistoryAudiences ?? []).reduce((s, a) => s + a.count, 0) / 10000).toFixed(1) }}w
            </span>
          </div>
          <div class="space-y-1.5">
            <div
              v-for="aud in (selectedLive.fakeHistoryAudiences ?? [])"
              :key="aud.segmentId"
              class="p-2 border border-teal-100 rounded bg-teal-50/30"
            >
              <div class="flex items-center justify-between mb-0.5">
                <div class="flex items-center gap-2">
                  <div class="w-1 h-3 rounded-full" :class="lineDotClass[aud.line]"></div>
                  <span class="text-sm text-slate-700">{{ aud.category }}</span>
                </div>
                <span class="text-xs font-mono text-slate-500">{{ (aud.count / 10000).toFixed(1) }}w</span>
              </div>
              <div class="text-[10px] text-slate-500 pl-3">{{ aud.timeRange }}</div>
            </div>
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
              v-for="aud in getMergedAudienceByLine(line)"
              :key="aud.category"
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
                  <button class="text-slate-400 hover:text-red-600" @click="removeAudienceByCategory(aud.category)">
                    &times;
                  </button>
                </div>
              </div>
              <div class="text-[10px] text-slate-500 pl-3">{{ aud.timeRange }}</div>
            </div>
            <div v-if="getMergedAudienceByLine(line).length === 0" class="text-xs text-slate-400 py-1">
              暂无分配
            </div>
          </div>
        </div>

        <!-- Attribution Summary -->
        <div v-if="selectedAttribution" class="bg-slate-50 border border-slate-200 rounded p-3 mb-4">
          <div class="text-[10px] font-semibold text-slate-500 uppercase mb-2">排期归因</div>
          <div class="grid grid-cols-4 gap-2">
            <div class="text-center">
              <div class="text-xs text-slate-500">总触达</div>
              <div class="text-sm font-mono font-bold text-slate-800">{{ (selectedAttribution.totalExposure / 10000).toFixed(1) }}w</div>
            </div>
            <div class="text-center">
              <div class="text-xs text-slate-500">预计线索</div>
              <div class="text-sm font-mono font-bold text-blue-700">{{ formatCount(selectedAttribution.expectedLeads) }}</div>
            </div>
            <div class="text-center">
              <div class="text-xs text-slate-500">预计首单</div>
              <div class="text-sm font-mono font-bold text-indigo-700">{{ formatCount(selectedAttribution.expectedFirstOrders) }}</div>
            </div>
            <div class="text-center">
              <div class="text-xs text-slate-500">预计GMV</div>
              <div class="text-sm font-mono font-bold text-emerald-700">{{ formatGMV(selectedAttribution.expectedGMV) }}</div>
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
  </aside>
</template>
