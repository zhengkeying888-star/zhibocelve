<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { normalizeCategory } from '@/utils/categoryMapping'

const store = useScheduleStore()
const reason = ref('')

const adjustment = computed(() => store.pendingAdjustment)

const live = computed(() => {
  if (!adjustment.value) return null
  return store.liveStreams.find((l) => l.id === adjustment.value!.liveId) || null
})

const segment = computed(() => {
  if (!adjustment.value) return null
  return store.audienceSegments.find((s) => s.id === adjustment.value!.segmentId) || null
})

const fromLive = computed(() => {
  if (!adjustment.value?.fromLiveId) return null
  return store.liveStreams.find((l) => l.id === adjustment.value!.fromLiveId) || null
})

const oldAttribution = computed(() => {
  if (!fromLive.value || !segment.value) return null
  return store.liveAttribution.find((a) => a.liveId === fromLive.value!.id)
})

const newAttribution = computed(() => {
  if (!live.value || !segment.value) return null
  return store.liveAttribution.find((a) => a.liveId === live.value!.id)
})

const oldItem = computed(() => {
  if (!oldAttribution.value || !segment.value) return null
  return oldAttribution.value.items.find((i) => i.segmentId === segment.value!.id)
})

const newItem = computed(() => {
  if (!newAttribution.value || !segment.value) return null
  return newAttribution.value.items.find((i) => i.segmentId === segment.value!.id)
})

function dismiss() {
  store.dismissAdjustment()
  reason.value = ''
}

function confirm() {
  if (!live.value || !segment.value) {
    dismiss()
    return
  }
  store.saveLearnedRule({
    liveCategory: normalizeCategory(live.value.category),
    fromCategory: fromLive.value ? normalizeCategory(fromLive.value.category) : '',
    toCategory: normalizeCategory(segment.value.category),
    reason: reason.value || '手动调整',
  })
  reason.value = ''
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="adjustment"
        class="fixed inset-0 z-[200] flex items-center justify-center"
      >
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="dismiss" />
        <div class="relative bg-white rounded-xl shadow-2xl w-[480px] max-w-[95vw] p-6">
          <h3 class="text-base font-bold text-[#0b1c30] mb-1">调整确认</h3>
          <p class="text-xs text-slate-500 mb-4">
            系统记录你的调整原因，下次自动排期时优先应用
          </p>

          <div class="bg-slate-50 rounded-lg p-3 mb-4 border border-slate-100">
            <div class="text-xs text-slate-600 mb-2">
              <span v-if="fromLive">
                从 <strong>{{ fromLive.name }}</strong> 转移到 <strong>{{ live?.name }}</strong>
              </span>
              <span v-else>
                为 <strong>{{ live?.name }}</strong> 新增 <strong>{{ segment?.category }}</strong>
              </span>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div
                class="rounded border p-2"
                :class="fromLive ? 'border-red-200 bg-red-50/30' : 'border-slate-200 bg-white'"
              >
                <div class="text-[10px] text-slate-500 mb-1">
                  {{ fromLive ? '调整前' : '—' }}
                </div>
                <div v-if="oldItem" class="text-xs">
                  <div class="font-mono text-slate-700">{{ (oldItem.expectedGMV / 10000).toFixed(1) }}w</div>
                  <div class="text-[10px] text-slate-400">预估GMV</div>
                </div>
                <div v-else class="text-xs text-slate-400">无</div>
              </div>

              <div class="rounded border border-emerald-200 bg-emerald-50/30 p-2">
                <div class="text-[10px] text-slate-500 mb-1">调整后</div>
                <div v-if="newItem" class="text-xs">
                  <div class="font-mono text-emerald-700 font-bold">{{ (newItem.expectedGMV / 10000).toFixed(1) }}w</div>
                  <div class="text-[10px] text-slate-400">预估GMV</div>
                </div>
                <div v-else class="text-xs text-slate-400">计算中...</div>
              </div>
            </div>
          </div>

          <label class="block text-xs font-medium text-slate-700 mb-1.5">
            为什么这样调整？
          </label>
          <textarea
            v-model="reason"
            rows="3"
            class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 resize-none"
            placeholder="例如：中医变美跨科率太低，瑜伽更匹配；或者想测试新品类..."
          />

          <div class="flex items-center gap-3 mt-4">
            <button
              class="flex-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 transition-colors"
              @click="confirm"
            >
              确认并记录规则
            </button>
            <button
              class="flex-1 text-xs text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg px-3 py-2 transition-colors"
              @click="dismiss"
            >
              仅确认不记录
            </button>
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
