<script setup lang="ts">
import { useScheduleStore } from '@/stores/schedule'
import { normalizeCategory } from '@/utils/categoryMapping'
import type { SlotType } from '@/types'

const store = useScheduleStore()

function formatGMV(n: number): string {
  if (n === 0) return '¥0'
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `¥${(n / 1000).toFixed(1)}k`
  return `¥${Math.round(n)}`
}

const slotSections: { slot: SlotType; label: string; ribbonClass: string; textClass: string }[] = [
  { slot: 'morning', label: '早间｜晨练', ribbonClass: 'bg-amber-100 border-amber-200', textClass: 'text-amber-800' },
  { slot: 'evening', label: '晚间｜晚IP专场', ribbonClass: 'bg-blue-100 border-blue-200', textClass: 'text-blue-800' },
]

function getLives(slot: SlotType, date: string) {
  return store.liveStreams.filter((l) => l.slot === slot && l.date === date)
}

function selectLive(id: string) {
  store.setSelectedLive(id)
}
</script>

<template>
  <main class="flex-1 flex flex-col bg-[#f8f9ff] overflow-hidden">
    <!-- Scheduling Rules Banner -->
    <div class="px-4 py-2 bg-blue-50 border-b border-blue-100 shrink-0">
      <div class="flex items-center gap-2 text-xs text-blue-800">
        <span class="font-semibold shrink-0">排期规则：</span>
        <span class="shrink-0">① 评级定流量 S>A>B>C</span>
        <span class="text-blue-300">|</span>
        <span class="shrink-0">② 同品类互斥</span>
        <span class="text-blue-300">|</span>
        <span class="shrink-0">③ 同线主宣发（按跨科率）</span>
        <span class="text-blue-300">|</span>
        <span class="shrink-0">④ 伪直播30天频控</span>
        <span class="text-blue-300">|</span>
        <span class="shrink-0">⑤ 当日去重</span>
      </div>
    </div>

    <!-- Matrix Header (Days) -->
    <div class="bg-white border-b border-slate-200 shrink-0 pr-4 pl-12">
      <div class="grid grid-cols-7 gap-4 py-3">
        <div
          v-for="day in store.weekDays"
          :key="day.date"
          class="text-center"
          :class="day.label === '周三' ? 'bg-blue-50/50 rounded -m-1 p-1' : ''"
        >
          <div class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{{ day.label }}</div>
          <div class="text-sm font-mono font-medium text-slate-900 mt-1">{{ day.date }}</div>
        </div>
      </div>
    </div>

    <!-- Matrix Scrollable Area -->
    <div class="flex-1 overflow-auto p-4">
      <div class="space-y-4">
        <!-- Morning & Evening Sections -->
        <div
          v-for="section in slotSections"
          :key="section.slot"
          class="grid grid-cols-[48px_1fr] gap-4"
        >
          <!-- Ribbon -->
          <div
            class="rounded-l flex items-center justify-center border border-r-0 relative"
            :class="section.ribbonClass"
          >
            <span class="writing-vertical text-[11px] font-semibold tracking-widest absolute top-1/2 -translate-y-1/2" :class="section.textClass">
              {{ section.label }}
            </span>
          </div>

          <!-- Row Grid -->
          <div class="grid grid-cols-7 gap-4">
            <div
              v-for="day in store.weekDays"
              :key="day.date"
              class="min-h-[240px]"
            >
              <div
                v-for="live in getLives(section.slot, day.date)"
                :key="live.id"
                class="bg-white border rounded shadow-sm flex flex-col relative group cursor-pointer hover:border-blue-300 overflow-hidden mb-2"
                :class="[
                  live.conflictReasons.length > 0 ? 'border-2 border-red-400' : 'border-slate-200',
                  store.selectedLiveId === live.id ? 'ring-1 ring-blue-400' : '',
                ]"
                @click="selectLive(live.id)"
              >
                <!-- Conflict Badge -->
                <div
                  v-if="live.conflictReasons.length > 0"
                  class="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center shadow-sm z-10"
                >
                  <span class="text-[10px] font-bold">!</span>
                </div>

                <!-- Cell Content -->
                <div class="p-3 flex flex-col h-full">
                  <!-- Header: Time + Grade + Historical Suggestion -->
                  <div class="flex justify-between items-start mb-2">
                    <span class="text-xs font-mono text-slate-500">{{ live.startTime }}</span>
                    <div class="flex items-center gap-1">
                      <span
                        v-if="store.historicalGradeSuggestion[normalizeCategory(live.category)] && store.historicalGradeSuggestion[normalizeCategory(live.category)] !== live.grade"
                        :title="'历史数据建议：该品类4月平均单场GMV为 ' + formatGMV(store.categoryHistoricalStats[normalizeCategory(live.category)]?.avgGMV || 0)"
                        class="px-1 py-0.5 rounded text-[9px] font-bold leading-none border border-dashed cursor-help"
                        :class="{
                          'bg-amber-50/60 text-amber-600 border-amber-200': store.historicalGradeSuggestion[normalizeCategory(live.category)] === 'S',
                          'bg-blue-50/60 text-blue-600 border-blue-200': store.historicalGradeSuggestion[normalizeCategory(live.category)] === 'A',
                          'bg-sky-50/60 text-sky-600 border-sky-200': store.historicalGradeSuggestion[normalizeCategory(live.category)] === 'B',
                          'bg-gray-50/60 text-gray-500 border-gray-200': store.historicalGradeSuggestion[normalizeCategory(live.category)] === 'C',
                        }"
                      >
                        历{{ store.historicalGradeSuggestion[normalizeCategory(live.category)] }}
                      </span>
                      <span
                        class="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none border"
                        :class="{
                          'bg-amber-50 text-amber-700 border-amber-200': live.grade === 'S',
                          'bg-blue-50 text-blue-700 border-blue-200': live.grade === 'A',
                          'bg-sky-50 text-sky-700 border-sky-200': live.grade === 'B',
                          'bg-gray-50 text-gray-600 border-gray-200': live.grade === 'C',
                        }"
                      >
                        {{ live.grade || '?' }}
                      </span>
                    </div>
                  </div>

                  <!-- Name -->
                  <h3 class="text-sm font-bold text-slate-900 leading-tight mb-1 truncate">{{ live.name }}</h3>

                  <!-- Owner -->
                  <div class="flex items-center gap-1.5 mb-2">
                    <div class="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[8px] text-slate-600">
                      {{ live.owner[0] }}
                    </div>
                    <span class="text-xs text-slate-500">{{ live.owner }}</span>
                  </div>

                  <!-- Exposure -->
                  <div class="mt-auto pt-2 border-t border-slate-100">
                    <div class="text-[10px] text-slate-400 mb-0.5">预估曝光</div>
                    <div class="text-lg font-mono font-bold text-slate-800">{{ live.exposure.toLocaleString() }}</div>
                  </div>

                  <!-- Audience Distribution Bars -->
                  <div class="flex h-1.5 w-full rounded-full overflow-hidden mt-2 gap-0.5">
                    <div
                      v-if="live.assignedAudiences.some(a => a.line === 'health')"
                      class="bg-emerald-500"
                      :style="{ width: (live.assignedAudiences.filter(a => a.line === 'health').reduce((s, a) => s + a.count, 0) / Math.max(live.exposure, 1) * 100) + '%' }"
                    ></div>
                    <div
                      v-if="live.assignedAudiences.some(a => a.line === 'beauty')"
                      class="bg-pink-500"
                      :style="{ width: (live.assignedAudiences.filter(a => a.line === 'beauty').reduce((s, a) => s + a.count, 0) / Math.max(live.exposure, 1) * 100) + '%' }"
                    ></div>
                    <div
                      v-if="live.assignedAudiences.some(a => a.line === 'interest')"
                      class="bg-purple-500"
                      :style="{ width: (live.assignedAudiences.filter(a => a.line === 'interest').reduce((s, a) => s + a.count, 0) / Math.max(live.exposure, 1) * 100) + '%' }"
                    ></div>
                  </div>

                  <!-- Conflict Alert Mini -->
                  <div
                    v-if="live.conflictReasons.length > 0"
                    class="mt-2 p-1.5 bg-red-50 border border-red-100 rounded"
                  >
                    <div class="text-[10px] font-bold text-red-700 flex items-center gap-1">
                      <span>!</span> 冲突
                    </div>
                    <div class="text-[10px] text-red-600 mt-0.5 leading-tight truncate">
                      {{ live.conflictReasons[0] }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- Empty State -->
              <button
                v-if="getLives(section.slot, day.date).length === 0"
                class="w-full h-full min-h-[160px] border-2 border-dashed border-slate-300 rounded hover:border-blue-400 hover:bg-blue-50/50 flex flex-col items-center justify-center text-slate-400 hover:text-blue-600 transition-colors bg-white/50"
              >
                <span class="text-2xl mb-1">+</span>
                <span class="text-sm">添加排期</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Fake Live Section -->
        <div class="grid grid-cols-[48px_1fr] gap-4">
          <div class="bg-teal-100 rounded-l flex items-center justify-center border border-teal-200 border-r-0 relative">
            <span class="writing-vertical text-[11px] font-semibold tracking-widest absolute top-1/2 -translate-y-1/2 text-teal-800">
              伪直播复用
            </span>
          </div>
          <div class="grid grid-cols-7 gap-4">
            <div
              v-for="day in store.weekDays"
              :key="day.date"
              class="min-h-[200px]"
            >
              <div
                v-for="live in getLives('fake-morning', day.date).concat(getLives('fake-evening', day.date))"
                :key="live.id"
                class="bg-white border rounded shadow-sm flex flex-col relative group cursor-pointer hover:border-blue-300 overflow-hidden mb-2"
                :class="[
                  live.conflictReasons.length > 0 ? 'border-2 border-red-400' : 'border-slate-200',
                  store.selectedLiveId === live.id ? 'ring-1 ring-blue-400' : '',
                ]"
                @click="selectLive(live.id)"
              >
                <div
                  v-if="live.conflictReasons.length > 0"
                  class="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center shadow-sm z-10"
                >
                  <span class="text-[10px] font-bold">!</span>
                </div>
                <div class="p-3 flex flex-col h-full">
                  <div class="flex justify-between items-start mb-1">
                    <span class="text-xs font-mono text-slate-500">{{ live.startTime }}</span>
                    <span class="px-1.5 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded text-[10px] font-bold">
                      {{ live.slot.includes('morning') ? '早播' : '晚播' }}
                    </span>
                  </div>
                  <h3 class="text-sm font-bold text-slate-900 leading-tight mb-1 truncate">{{ live.name }}</h3>
                  <div class="flex items-center gap-1.5 mb-2">
                    <div class="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[8px] text-slate-600">
                      {{ live.owner[0] }}
                    </div>
                    <span class="text-xs text-slate-500">{{ live.owner }}</span>
                  </div>
                  <!-- Current week exposure (for real lives on fake slots that receive audiences) -->
                  <div v-if="live.exposure > 0" class="mt-auto pt-2 border-t border-slate-100">
                    <div class="text-[10px] text-slate-400 mb-0.5">本周预估曝光</div>
                    <div class="text-lg font-mono font-bold text-slate-800">{{ live.exposure.toLocaleString() }}</div>
                  </div>
                  <div v-if="live.exposure > 0" class="flex h-1.5 w-full rounded-full overflow-hidden mt-2 gap-0.5">
                    <div v-if="live.assignedAudiences.some(a => a.line === 'health')" class="bg-emerald-500" :style="{ width: (live.assignedAudiences.filter(a => a.line === 'health').reduce((s, a) => s + a.count, 0) / Math.max(live.exposure, 1) * 100) + '%' }"></div>
                    <div v-if="live.assignedAudiences.some(a => a.line === 'beauty')" class="bg-pink-500" :style="{ width: (live.assignedAudiences.filter(a => a.line === 'beauty').reduce((s, a) => s + a.count, 0) / Math.max(live.exposure, 1) * 100) + '%' }"></div>
                    <div v-if="live.assignedAudiences.some(a => a.line === 'interest')" class="bg-purple-500" :style="{ width: (live.assignedAudiences.filter(a => a.line === 'interest').reduce((s, a) => s + a.count, 0) / Math.max(live.exposure, 1) * 100) + '%' }"></div>
                  </div>
                  <!-- Fake history reference (if any) -->
                  <div v-if="(live.fakeHistoryAudiences || []).length > 0" class="mt-auto pt-2 border-t border-slate-100" :class="live.exposure > 0 ? 'mt-2' : ''">
                    <div class="text-[10px] text-teal-500 mb-0.5">上周记录 · 本周剔除</div>
                    <div class="text-lg font-mono font-bold text-slate-500">{{ (live.fakeHistoryAudiences || []).reduce((s, a) => s + a.count, 0).toLocaleString() }}</div>
                  </div>
                  <div v-if="(live.fakeHistoryAudiences || []).length > 0" class="flex h-1.5 w-full rounded-full overflow-hidden mt-2 gap-0.5 opacity-50">
                    <div v-if="(live.fakeHistoryAudiences || []).some(a => a.line === 'health')" class="bg-emerald-500" :style="{ width: ((live.fakeHistoryAudiences || []).filter(a => a.line === 'health').reduce((s, a) => s + a.count, 0) / Math.max((live.fakeHistoryAudiences || []).reduce((s, a) => s + a.count, 0), 1) * 100) + '%' }"></div>
                    <div v-if="(live.fakeHistoryAudiences || []).some(a => a.line === 'beauty')" class="bg-pink-500" :style="{ width: ((live.fakeHistoryAudiences || []).filter(a => a.line === 'beauty').reduce((s, a) => s + a.count, 0) / Math.max((live.fakeHistoryAudiences || []).reduce((s, a) => s + a.count, 0), 1) * 100) + '%' }"></div>
                    <div v-if="(live.fakeHistoryAudiences || []).some(a => a.line === 'interest')" class="bg-purple-500" :style="{ width: ((live.fakeHistoryAudiences || []).filter(a => a.line === 'interest').reduce((s, a) => s + a.count, 0) / Math.max((live.fakeHistoryAudiences || []).reduce((s, a) => s + a.count, 0), 1) * 100) + '%' }"></div>
                  </div>
                </div>
              </div>
              <button
                v-if="getLives('fake-morning', day.date).length === 0 && getLives('fake-evening', day.date).length === 0"
                class="w-full h-full min-h-[120px] border-2 border-dashed border-slate-300 rounded hover:border-blue-400 hover:bg-blue-50/50 flex flex-col items-center justify-center text-slate-400 hover:text-blue-600 transition-colors bg-white/50"
              >
                <span class="text-2xl mb-1">+</span>
                <span class="text-sm">添加排期</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Friend Circle Section -->
        <div class="grid grid-cols-[48px_1fr] gap-4">
          <div class="bg-gray-100 rounded-l flex items-center justify-center border border-gray-200 border-r-0 relative">
            <span class="writing-vertical text-[11px] font-semibold tracking-widest absolute top-1/2 -translate-y-1/2 text-gray-700">
              朋友圈宣发
            </span>
          </div>
          <div class="grid grid-cols-7 gap-4">
            <div
              v-for="day in store.weekDays"
              :key="day.date"
              class="min-h-[140px]"
            >
              <div
                v-for="live in getLives('friend-circle', day.date)"
                :key="live.id"
                class="bg-white border rounded shadow-sm flex flex-col relative group cursor-pointer hover:border-blue-300 overflow-hidden mb-2"
                :class="[
                  store.selectedLiveId === live.id ? 'ring-1 ring-blue-400' : 'border-slate-200',
                ]"
                @click="selectLive(live.id)"
              >
                <div class="p-3 flex flex-col h-full">
                  <div class="flex justify-between items-start mb-1">
                    <span class="text-xs font-mono text-slate-500">{{ live.startTime }}</span>
                    <span class="px-1.5 py-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded text-[10px] font-bold">
                      宣发
                    </span>
                  </div>
                  <h3 class="text-sm font-bold text-slate-900 leading-tight mb-1 truncate">{{ live.name }}</h3>
                  <div class="flex items-center gap-1.5">
                    <div class="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[8px] text-slate-600">
                      {{ live.owner[0] }}
                    </div>
                    <span class="text-xs text-slate-500">{{ live.owner }}</span>
                  </div>
                </div>
              </div>
              <button
                v-if="getLives('friend-circle', day.date).length === 0"
                class="w-full h-full min-h-[100px] border-2 border-dashed border-slate-300 rounded hover:border-blue-400 hover:bg-blue-50/50 flex flex-col items-center justify-center text-slate-400 hover:text-blue-600 transition-colors bg-white/50"
              >
                <span class="text-2xl mb-1">+</span>
                <span class="text-sm">添加排期</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
