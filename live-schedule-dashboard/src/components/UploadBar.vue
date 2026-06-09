<script setup lang="ts">
import { ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import UploadModal from './UploadModal.vue'
import CategoryManager from './CategoryManager.vue'
import AttributionPanel from './AttributionPanel.vue'
import RuleAuditPanel from './RuleAuditPanel.vue'
import RuleLibraryView from './RuleLibraryView.vue'
import { exportSchedule } from '@/utils/exporter'
import FeishuSyncModal from './FeishuSyncModal.vue'
import AiFixPanel from './AiFixPanel.vue'

const store = useScheduleStore()
const showModal = ref(false)
const showCategoryManager = ref(false)
const showAttribution = ref(false)
const showFeishuSync = ref(false)
const showRuleAudit = ref(false)
const showRuleLibrary = ref(false)
const showAiFix = ref(false)

async function handleAutoSchedule() {
  await store.autoSchedule()
}

function handleExport() {
  exportSchedule(store.liveStreams, store.weekDays, store.currentWeek)
}

function onModalDone() {
  // Modal already called autoSchedule internally
  showModal.value = false
}
</script>

<template>
  <header class="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-50">
    <!-- Left: Logo + Title + Week -->
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2">
        <div class="w-6 h-6 bg-primary rounded flex items-center justify-center">
          <span class="text-white text-xs font-bold">L</span>
        </div>
        <h1 class="text-lg font-bold text-[#0b1c30]">直播排期策略看板</h1>
      </div>
      <div class="h-4 w-px bg-slate-200"></div>
      <span class="text-sm text-slate-500">{{ store.currentWeek }}</span>
    </div>

    <!-- Center: Upload Button -->
    <button
      @click="showModal = true"
      class="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 hover:border-blue-400 hover:text-blue-600 rounded-lg text-sm font-medium transition-colors shadow-sm"
    >
      <span>&#8679;</span>
      上传本周数据
      <span
        v-if="Object.values(store.uploadStatus).some(Boolean)"
        class="w-2 h-2 bg-emerald-500 rounded-full"
      ></span>
    </button>

    <!-- Right: Actions -->
    <div class="flex items-center gap-3">
      <button
        class="text-sm text-slate-500 hover:text-blue-600 flex items-center gap-1 px-2 py-1.5 transition-colors"
        @click="showAiFix = true"
      >
        <span>&#129302;</span> AI诊断
      </button>
      <button
        class="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1 px-2 py-1.5 transition-colors"
        @click="showRuleAudit = true"
      >
        <span>&#128269;</span> 规则审计
      </button>
      <button
        class="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1 px-2 py-1.5 transition-colors"
        @click="showRuleLibrary = true"
      >
        <span>&#128214;</span> 规则库
      </button>
      <button
        class="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1 px-2 py-1.5 transition-colors"
        @click="showCategoryManager = true"
      >
        <span>&#9733;</span> 品类评级
      </button>
      <button
        class="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1 px-2 py-1.5 transition-colors"
        @click="showAttribution = true"
      >
        <span>&#128200;</span> 排期归因
      </button>
      <button
        class="text-sm text-slate-500 hover:text-red-600 flex items-center gap-1 px-2 py-1.5 transition-colors"
        @click="store.resetAllData"
      >
        <span>&#8634;</span> 重置数据
      </button>
      <button
        @click="showFeishuSync = true"
        class="text-sm text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors h-8"
      >
        <span>&#9993;</span> 飞书同步
      </button>
      <button
        @click="handleExport"
        class="text-sm text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors h-8"
      >
        <span>&#8593;</span> 导出 Excel
      </button>
      <button
        @click="handleAutoSchedule"
        class="text-sm text-white bg-primary hover:bg-blue-700 px-4 py-1.5 rounded flex items-center gap-1.5 transition-colors shadow-sm h-8"
      >
        <span>&#10022;</span> 自动排期
      </button>
    </div>
  </header>

  <UploadModal
    :open="showModal"
    @close="showModal = false"
    @done="onModalDone"
  />
  <CategoryManager
    :open="showCategoryManager"
    @close="showCategoryManager = false"
  />
  <AttributionPanel
    :open="showAttribution"
    @close="showAttribution = false"
  />
  <FeishuSyncModal
    :open="showFeishuSync"
    @close="showFeishuSync = false"
  />
  <RuleAuditPanel
    :open="showRuleAudit"
    @close="showRuleAudit = false"
    @open-category-manager="showCategoryManager = true"
  />
  <RuleLibraryView
    :open="showRuleLibrary"
    @close="showRuleLibrary = false"
  />
  <AiFixPanel v-if="showAiFix" @close="showAiFix = false" />
</template>
