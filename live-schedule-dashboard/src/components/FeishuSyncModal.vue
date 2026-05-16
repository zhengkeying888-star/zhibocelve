<script setup lang="ts">
import { ref, computed } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import {
  getTenantAccessToken,
  extractAppTokenFromUrl,
  extractSpreadsheetTokenFromUrl,
  searchBitableRecords,
  listBitableTables,
  createSpreadsheetSheet,
  appendSpreadsheetValues,
  clearCachedToken,
} from '@/lib/feishu'
import { parseFeishuRows } from '@/utils/feishuParser'
import { buildExportMatrix } from '@/utils/exporter'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useScheduleStore()

const config = ref({
  appId: store.feishuConfig?.appId || '',
  appSecret: store.feishuConfig?.appSecret || '',
  baseUrl: store.feishuConfig?.baseUrl || '',
  targetSpreadsheetUrl: store.feishuConfig?.targetSpreadsheetUrl || '',
})

const status = ref<'idle' | 'syncing' | 'exporting' | 'done' | 'error'>('idle')
const statusMsg = ref('')
const tables = ref<{ tableId: string; name: string }[]>([])
const selectedTableId = ref('')

const canSync = computed(() => {
  return config.value.appId && config.value.appSecret && config.value.baseUrl
})

const canExport = computed(() => {
  return config.value.appId && config.value.appSecret && config.value.targetSpreadsheetUrl
})

async function loadTables() {
  if (!canSync.value) return
  status.value = 'syncing'
  statusMsg.value = '正在获取表格列表...'
  try {
    clearCachedToken()
    const token = await getTenantAccessToken(config.value.appId, config.value.appSecret)
    const appToken = extractAppTokenFromUrl(config.value.baseUrl)
    if (!appToken) throw new Error('无法从 URL 解析 base token')
    tables.value = await listBitableTables(token, appToken)
    if (tables.value.length > 0) selectedTableId.value = tables.value[0].tableId
    status.value = 'idle'
    statusMsg.value = `找到 ${tables.value.length} 个数据表`
  } catch (err: any) {
    status.value = 'error'
    statusMsg.value = err.message || '获取表格列表失败'
  }
}

async function handleSync() {
  if (!canSync.value || !selectedTableId.value) return
  status.value = 'syncing'
  statusMsg.value = '正在同步数据...'
  try {
    clearCachedToken()
    const token = await getTenantAccessToken(config.value.appId, config.value.appSecret)
    const appToken = extractAppTokenFromUrl(config.value.baseUrl)
    if (!appToken) throw new Error('无法从 URL 解析 base token')

    const records = await searchBitableRecords(token, appToken, selectedTableId.value)
    const rows = records.map((r) => ({
      date: r.fields.date || '',
      weekday: r.fields.weekday || '',
      slot: r.fields.slot || '',
      rowType: r.fields.rowType || '',
      liveName: r.fields.liveName || '',
      owner: r.fields.owner || '',
      exposure: Number(r.fields.exposure || 0),
      audienceCategory: r.fields.audienceCategory || '',
      audienceTimeRange: r.fields.audienceTimeRange || '',
      audienceCount: Number(r.fields.audienceCount || 0),
      audienceLine: r.fields.audienceLine || '',
      isStock: !!r.fields.isStock,
    }))

    const result = parseFeishuRows(rows)

    // Save config
    store.setFeishuConfig({
      appId: config.value.appId,
      appSecret: config.value.appSecret,
      baseUrl: config.value.baseUrl,
      targetSpreadsheetUrl: config.value.targetSpreadsheetUrl,
    })

    // Update store
    store.setLiveStreams(result.lives)
    store.setAudienceSegments(result.audienceSegments)
    store.setWeekDays(result.weekDays)
    store.setHistoryRecords(result.historyRecords)
    store.applyNameOverrides()
    store.applyCategoryGrades()

    status.value = 'done'
    statusMsg.value = `同步完成：${result.lives.length} 场直播，${result.audienceSegments.length} 个 audience 段`

    // Auto schedule
    if (result.audienceSegments.length > 0 && result.lives.length > 0) {
      await store.autoSchedule()
    }
  } catch (err: any) {
    status.value = 'error'
    statusMsg.value = err.message || '同步失败'
    console.error('Feishu sync error:', err)
  }
}

async function handleExport() {
  if (!canExport.value) return
  status.value = 'exporting'
  statusMsg.value = '正在导出到飞书表格...'
  try {
    clearCachedToken()
    const token = await getTenantAccessToken(config.value.appId, config.value.appSecret)
    const spreadsheetToken = extractSpreadsheetTokenFromUrl(config.value.targetSpreadsheetUrl)
    if (!spreadsheetToken) throw new Error('无法从 URL 解析 spreadsheet token')

    const { data } = buildExportMatrix(store.liveStreams, store.weekDays)
    const sheetTitle = `排期结果_${store.currentWeek}`
    const { sheetId } = await createSpreadsheetSheet(token, spreadsheetToken, sheetTitle)
    await appendSpreadsheetValues(token, spreadsheetToken, sheetId, data)

    status.value = 'done'
    statusMsg.value = `导出完成：已创建 sheet「${sheetTitle}」`
  } catch (err: any) {
    status.value = 'error'
    statusMsg.value = err.message || '导出失败'
    console.error('Feishu export error:', err)
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[100] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
        <div class="relative bg-white rounded-xl shadow-2xl w-[560px] max-w-[90vw] max-h-[85vh] flex flex-col overflow-hidden">
          <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div>
              <h2 class="text-lg font-bold text-[#0b1c30]">飞书同步设置</h2>
              <p class="text-xs text-slate-500 mt-0.5">配置飞书应用凭证以同步排期数据</p>
            </div>
            <button class="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 transition-colors" @click="emit('close')">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <div class="p-6 space-y-4 overflow-y-auto">
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <p class="font-medium">安全提示</p>
              <p class="mt-1 text-xs">app_secret 存储在前端存在泄露风险，建议创建仅限读写指定表格的受限应用。</p>
            </div>

            <div class="space-y-3">
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">App ID</label>
                <input v-model="config.appId" type="text" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="cli_xxxxxxxx" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">App Secret</label>
                <input v-model="config.appSecret" type="password" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="xxxxxxxxxxxxxxxx" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">本周多维表格 URL</label>
                <input v-model="config.baseUrl" type="text" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://xxx.feishu.cn/base/xxx" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">目标电子表格 URL</label>
                <input v-model="config.targetSpreadsheetUrl" type="text" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://xxx.feishu.cn/sheets/xxx" />
              </div>
            </div>

            <div v-if="tables.length > 0" class="space-y-2">
              <label class="block text-sm font-medium text-slate-700">选择数据表</label>
              <select v-model="selectedTableId" class="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option v-for="t in tables" :key="t.tableId" :value="t.tableId">{{ t.name }}</option>
              </select>
            </div>

            <div v-if="statusMsg" class="text-sm" :class="{
              'text-emerald-600': status === 'done',
              'text-red-600': status === 'error',
              'text-blue-600': status === 'syncing' || status === 'exporting',
              'text-slate-600': status === 'idle',
            }">
              {{ statusMsg }}
            </div>

            <div class="flex gap-3 pt-2">
              <button
                v-if="canSync"
                @click="loadTables"
                class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
              >
                获取表格列表
              </button>
              <button
                v-if="canSync && selectedTableId"
                @click="handleSync"
                :disabled="status === 'syncing' || status === 'exporting'"
                class="px-4 py-2 bg-primary hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                从飞书同步
              </button>
              <button
                v-if="canExport"
                @click="handleExport"
                :disabled="status === 'syncing' || status === 'exporting'"
                class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                导出到飞书
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
