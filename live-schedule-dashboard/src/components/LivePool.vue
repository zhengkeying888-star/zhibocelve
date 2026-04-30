<script setup lang="ts">
import { ref, computed } from 'vue'
import { useScheduleStore } from '@/stores/schedule'

const store = useScheduleStore()
const showRecommend = ref(false)

const lineLabel: Record<string, string> = {
  health: '健康线',
  beauty: '变美线',
  interest: '兴趣线',
}

const slotLabel: Record<string, string> = {
  morning: '晨练',
  evening: '晚IP',
  'fake-morning': '伪直播早',
  'fake-evening': '伪直播晚',
  'friend-circle': '朋友圈',
}

const editingLiveId = ref<string | null>(null)
const editCategory = ref('')
const editLine = ref<'health' | 'beauty' | 'interest'>('health')
const editRemember = ref(false)
const editIsCross = ref(false)

function startEdit(live: typeof store.liveStreams[0]) {
  editingLiveId.value = live.id
  editCategory.value = live.category
  editLine.value = live.line
  editRemember.value = true
  editIsCross.value = live.isCrossCategory
}

function cancelEdit() {
  editingLiveId.value = null
}

function saveEdit(live: typeof store.liveStreams[0]) {
  store.setLiveCategory(live.id, editCategory.value)
  store.setLiveLine(live.id, editLine.value)
  store.setLiveCrossCategory(live.id, editIsCross.value)
  if (editRemember.value) {
    store.setNameOverride(live.name, editCategory.value, editLine.value)
  }
  editingLiveId.value = null
}

const recommendedFakes = computed(() =>
  store.fakeLiveHistory.filter((f) => f.isQualified)
)

function selectLive(id: string) {
  store.setSelectedLive(id)
}

// Drag & Drop
const dragOverLiveId = ref<string | null>(null)

function onDragOver(liveId: string) {
  dragOverLiveId.value = liveId
}

function onDragLeave() {
  dragOverLiveId.value = null
}

function onDrop(e: DragEvent, liveId: string) {
  dragOverLiveId.value = null
  const segmentId = e.dataTransfer?.getData('segmentId')
  if (!segmentId) return
  store.assignAudience(liveId, segmentId)
  store.recordAdjustment(liveId, segmentId)
}
</script>

<template>
  <aside class="w-[280px] bg-white border-r border-slate-200 flex flex-col shrink-0">
    <!-- Header -->
    <div class="p-4 border-b border-slate-200 flex justify-between items-center">
      <div>
        <h2 class="text-lg font-semibold text-[#0b1c30]">本周直播场次</h2>
        <p class="text-sm text-slate-500 mt-0.5">{{ store.liveStreams.length }} 场待分配</p>
      </div>
      <button class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">
        &#8801;
      </button>
    </div>

    <!-- Live List -->
    <div class="flex-1 overflow-y-auto p-3 space-y-2">
      <div
        v-for="live in store.liveStreams"
        :key="live.id"
        class="border rounded p-3 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer relative"
        :class="[
          store.selectedLiveId === live.id ? 'border-blue-400 bg-blue-50/30' : 'border-slate-200 bg-white',
          dragOverLiveId === live.id ? 'ring-2 ring-blue-400 ring-offset-2' : ''
        ]"
        @click="selectLive(live.id)"
        @dragover.prevent="onDragOver(live.id)"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop($event, live.id)"
      >
        <div class="flex justify-between items-start mb-2">
          <div class="flex items-center gap-1.5">
            <span
              class="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none border"
              :class="{
                'bg-amber-50 text-amber-700 border-amber-200': live.grade === 'S',
                'bg-blue-50 text-blue-700 border-blue-200': live.grade === 'A',
                'bg-sky-50 text-sky-700 border-sky-200': live.grade === 'B',
                'bg-gray-50 text-gray-600 border-gray-200': live.grade === 'C',
                'bg-slate-100 text-slate-500 border-slate-200': !live.grade,
              }"
            >
              {{ live.grade || '?' }}级
            </span>
            <span class="text-sm font-semibold text-slate-900 truncate max-w-[140px]">{{ live.name }}</span>
          </div>
          <span class="text-slate-300 text-sm">&#8942;</span>
        </div>
        <div class="flex items-center justify-between mt-2">
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-600 flex items-center gap-1">
              <span>&#9716;</span> {{ live.startTime }}
            </span>
            <span class="w-1 h-1 rounded-full bg-slate-300"></span>
            <span class="text-[11px] font-semibold tracking-wide" :class="{
              'text-emerald-600': live.line === 'health',
              'text-pink-600': live.line === 'beauty',
              'text-purple-600': live.line === 'interest',
            }">
              {{ lineLabel[live.line] }}
            </span>
          </div>
          <span class="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px]">{{ slotLabel[live.slot] }}</span>
        </div>

        <!-- Category / Line Display -->
        <div
          v-if="editingLiveId !== live.id"
          class="mt-1.5 text-[11px] text-slate-500 cursor-pointer hover:text-blue-600 transition-colors"
          @click.stop="startEdit(live)"
        >
          品类: {{ live.category || '未识别' }} · {{ lineLabel[live.line] || '未分类' }}
          <span v-if="live.isCrossCategory" class="ml-1 px-1 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[9px]">跨科</span>
        </div>

        <!-- Inline Edit Form -->
        <div
          v-else
          class="mt-2 p-2 bg-slate-50 rounded border border-slate-200 space-y-2"
          @click.stop
        >
          <div>
            <label class="text-[10px] text-slate-500 block mb-0.5">品类</label>
            <input
              v-model="editCategory"
              type="text"
              class="w-full text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
              placeholder="输入品类名称"
            />
          </div>
          <div>
            <label class="text-[10px] text-slate-500 block mb-0.5">所属线</label>
            <select
              v-model="editLine"
              class="w-full text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400 bg-white"
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
          <div class="flex items-center gap-2 pt-1">
            <button
              class="flex-1 text-[11px] text-white bg-blue-600 hover:bg-blue-700 rounded px-2 py-1 transition-colors"
              @click.stop="saveEdit(live)"
            >
              保存
            </button>
            <button
              class="flex-1 text-[11px] text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded px-2 py-1 transition-colors"
              @click.stop="cancelEdit"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Accordion -->
    <div class="border-t border-slate-200 bg-white">
      <button
        @click="showRecommend = !showRecommend"
        class="w-full flex items-center justify-between p-3 text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <div class="flex items-center gap-2">
          <span class="text-slate-400 text-lg">&#9654;</span>
          <span class="text-sm font-medium">伪直播推荐库</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-medium">+{{ recommendedFakes.length }} 高转</span>
          <span class="text-slate-400 transition-transform" :class="showRecommend ? 'rotate-180' : ''">&#9660;</span>
        </div>
      </button>
      <div v-if="showRecommend" class="px-3 pb-3 space-y-2 max-h-48 overflow-y-auto">
        <div
          v-for="item in recommendedFakes.slice(0, 6)"
          :key="item.name"
          class="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-100"
        >
          <div>
            <div class="text-xs font-medium text-slate-700">{{ item.name }}</div>
            <div class="text-[10px] text-slate-400">{{ item.category }}</div>
          </div>
          <div class="text-xs text-emerald-600 font-bold">{{ (item.conversionRate * 100).toFixed(1) }}%</div>
        </div>
      </div>
    </div>
  </aside>
</template>
