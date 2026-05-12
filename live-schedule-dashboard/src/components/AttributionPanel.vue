<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import type { LineType } from '@/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useScheduleStore()
const filterLine = ref<LineType | 'all'>('all')

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

const filteredAttribution = computed(() => {
  if (filterLine.value === 'all') return store.liveAttribution
  return store.liveAttribution.filter((a) => a.line === filterLine.value)
})

const totals = computed(() => {
  const list = filteredAttribution.value
  return {
    exposure: list.reduce((s, a) => s + a.totalExposure, 0),
    leads: list.reduce((s, a) => s + a.expectedLeads, 0),
    firstOrders: list.reduce((s, a) => s + a.expectedFirstOrders, 0),
    gmv: list.reduce((s, a) => s + a.expectedGMV, 0),
  }
})

function selectLive(id: string) {
  store.setSelectedLive(id)
  emit('close')
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
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[100] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />

        <div class="relative bg-white rounded-xl shadow-2xl w-[900px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden">
          <!-- Header -->
          <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div>
              <h2 class="text-lg font-bold text-[#0b1c30]">排期归因看板</h2>
              <p class="text-xs text-slate-500 mt-0.5">基于公海品类→跨科品类的 day60 跨科率与 LTV 数据</p>
            </div>
            <div class="flex items-center gap-4">
              <div class="text-right">
                <div class="text-[10px] text-slate-500">本周预计GMV</div>
                <div class="text-lg font-mono font-bold text-emerald-700">{{ formatGMV(totals.gmv) }}</div>
              </div>
              <button class="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 transition-colors" @click="emit('close')">
                &times;
              </button>
            </div>
          </div>

          <!-- Filters -->
          <div class="px-6 py-3 border-b border-slate-200 flex items-center gap-3 bg-white">
            <span class="text-xs text-slate-500">筛选:</span>
            <button
              class="text-xs px-2.5 py-1 rounded border transition-colors"
              :class="filterLine === 'all' ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'"
              @click="filterLine = 'all'"
            >
              全部
            </button>
            <button
              v-for="line in (['health', 'beauty', 'interest'] as LineType[])"
              :key="line"
              class="text-xs px-2.5 py-1 rounded border transition-colors flex items-center gap-1"
              :class="filterLine === line ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'"
              @click="filterLine = line"
            >
              <div class="w-1.5 h-1.5 rounded-full" :class="lineDotClass[line]" />
              {{ lineLabel[line] }}
            </button>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto p-6">
            <div v-if="store.liveAttribution.length === 0" class="text-center py-12 text-slate-400 text-sm">
              暂无归因数据，请先完成 audience 分配并上传包含 day60LTV 的跨科偏好文件
            </div>

            <table v-else class="w-full text-sm">
              <thead>
                <tr class="border-b border-slate-200 text-left">
                  <th class="py-2 text-xs font-semibold text-slate-500 uppercase">直播名称</th>
                  <th class="py-2 text-xs font-semibold text-slate-500 uppercase">品类</th>
                  <th class="py-2 text-xs font-semibold text-slate-500 uppercase">线</th>
                  <th class="py-2 text-xs font-semibold text-slate-500 uppercase text-right">触达人数</th>
                  <th class="py-2 text-xs font-semibold text-slate-500 uppercase text-right">预计线索</th>
                  <th class="py-2 text-xs font-semibold text-slate-500 uppercase text-right">预计首单</th>
                  <th class="py-2 text-xs font-semibold text-slate-500 uppercase text-right">预计GMV</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="att in filteredAttribution"
                  :key="att.liveId"
                  class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  @click="selectLive(att.liveId)"
                >
                  <td class="py-2.5">
                    <div class="flex items-center gap-1.5">
                      <span class="text-sm font-medium text-slate-800">{{ att.name }}</span>
                      <span
                        v-if="att.line"
                        class="w-1.5 h-1.5 rounded-full"
                        :class="lineDotClass[att.line]"
                      />
                    </div>
                    <div class="text-[10px] text-slate-400 mt-0.5">
                      {{ att.items.length }} 个宣发品类
                    </div>
                  </td>
                  <td class="py-2.5 text-slate-600">{{ att.category }}</td>
                  <td class="py-2.5">
                    <span class="text-xs" :class="{
                      'text-emerald-600': att.line === 'health',
                      'text-pink-600': att.line === 'beauty',
                      'text-purple-600': att.line === 'interest',
                    }">
                      {{ lineLabel[att.line] }}
                    </span>
                  </td>
                  <td class="py-2.5 text-right font-mono text-slate-700">
                    {{ (att.totalExposure / 10000).toFixed(1) }}w
                  </td>
                  <td class="py-2.5 text-right font-mono text-blue-700">
                    {{ formatCount(att.expectedLeads) }}
                  </td>
                  <td class="py-2.5 text-right font-mono text-indigo-700">
                    {{ formatCount(att.expectedFirstOrders) }}
                  </td>
                  <td class="py-2.5 text-right font-mono text-emerald-700">
                    {{ formatGMV(att.expectedGMV) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Footer Summary -->
          <div class="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <div class="flex items-center gap-4">
              <span class="text-xs text-slate-500">
                共 {{ filteredAttribution.length }} 场直播
              </span>
              <span v-if="store.weeklyScaledTarget > 0" class="text-xs text-slate-400">
                本周动态目标 {{ (store.weeklyScaledTarget / 10000).toFixed(1) }}w
                <span v-if="store.scaleFactor !== 1" class="text-amber-600 ml-1">
                  (缩放 {{ (store.scaleFactor * 100).toFixed(0) }}%)
                </span>
              </span>
            </div>
            <div class="flex items-center gap-6">
              <div class="text-center">
                <div class="text-[10px] text-slate-500">总触达</div>
                <div class="text-sm font-mono font-bold text-slate-800">{{ (totals.exposure / 10000).toFixed(1) }}w</div>
              </div>
              <div class="text-center">
                <div class="text-[10px] text-slate-500">总预计线索</div>
                <div class="text-sm font-mono font-bold text-blue-700">{{ formatCount(totals.leads) }}</div>
              </div>
              <div class="text-center">
                <div class="text-[10px] text-slate-500">总预计首单</div>
                <div class="text-sm font-mono font-bold text-indigo-700">{{ formatCount(totals.firstOrders) }}</div>
              </div>
              <div class="text-center">
                <div class="text-[10px] text-slate-500">总预计GMV</div>
                <div class="text-sm font-mono font-bold text-emerald-700">{{ formatGMV(totals.gmv) }}</div>
              </div>
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
