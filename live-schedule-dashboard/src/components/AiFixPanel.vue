<script setup lang="ts">
import { computed } from 'vue'
import { useScheduleStore } from '@/stores/schedule'

const store = useScheduleStore()

const suggestions = computed(() => store.aiFixSuggestions?.suggestions || [])
const rootCause = computed(() => store.aiFixSuggestions?.rootCause || '')
const confidence = computed(() => store.aiFixSuggestions?.confidence || 0)
const healthAnalysis = computed(() => store.aiFixSuggestions?.healthLineAnalysis || null)
const isLoading = computed(() => store.isAiFixLoading)
const error = computed(() => store.aiFixError)
const raw = computed(() => store.aiFixSuggestions?.raw || '')

function typeLabel(type: string) {
  const map: Record<string, string> = {
    transfer: '转移',
    add: '添加',
    remove: '移除',
    reorder: '重排',
    manual: '手动',
  }
  return map[type] || type
}

function typeColor(type: string) {
  const map: Record<string, string> = {
    transfer: 'bg-amber-50 text-amber-700 border-amber-200',
    add: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    remove: 'bg-rose-50 text-rose-700 border-rose-200',
    reorder: 'bg-blue-50 text-blue-700 border-blue-200',
    manual: 'bg-slate-50 text-slate-700 border-slate-200',
  }
  return map[type] || 'bg-slate-50 text-slate-700 border-slate-200'
}

function riskColor(risk: string) {
  if (risk === '低风险') return 'text-emerald-600 bg-emerald-50'
  if (risk === '中风险') return 'text-amber-600 bg-amber-50'
  return 'text-rose-600 bg-rose-50'
}

async function handleAnalyze() {
  await store.fetchAiFixSuggestions()
}

function handleApply(suggestion: any) {
  store.applyAiFixSuggestion(suggestion)
}

function handleClose() {
  store.clearAiFix()
}

function handleShowRaw() {
  // 简单的 alert 展示原始回复，便于调试
  alert(raw.value)
}
</script>

<template>
  <div class="fixed inset-y-0 right-0 w-[420px] bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col">
    <!-- Header -->
    <div class="h-14 border-b border-slate-100 flex items-center justify-between px-5 shrink-0">
      <div class="flex items-center gap-2">
        <span class="text-lg">🤖</span>
        <h2 class="font-bold text-[#0b1c30]">AI 排期诊断</h2>
        <span v-if="confidence > 0" class="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
          置信度 {{ Math.round(confidence * 100) }}%
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="raw"
          @click="handleShowRaw"
          class="text-xs text-slate-400 hover:text-slate-600"
          title="查看原始回复"
        >
          原始
        </button>
        <button @click="handleClose" class="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-5 space-y-4">
      <!-- Loading -->
      <div v-if="isLoading" class="flex flex-col items-center justify-center py-12 gap-3">
        <div class="w-8 h-8 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
        <p class="text-sm text-slate-500">正在分析排期数据，请稍候…</p>
        <p class="text-xs text-slate-400">通常需要 5-15 秒</p>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="bg-rose-50 border border-rose-200 rounded-lg p-4">
        <div class="flex items-center gap-2 text-rose-700 font-medium text-sm mb-1">
          <span>⚠️</span>
          <span>分析失败</span>
        </div>
        <p class="text-xs text-rose-600">{{ error }}</p>
        <button
          @click="handleAnalyze"
          class="mt-3 px-3 py-1.5 bg-white border border-rose-200 rounded text-xs text-rose-700 hover:bg-rose-50"
        >
          重试
        </button>
      </div>

      <!-- Empty state -->
      <div v-else-if="!rootCause && !isLoading" class="flex flex-col items-center justify-center py-12 gap-3">
        <div class="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-2xl">🔍</div>
        <p class="text-sm text-slate-500">点击「AI 诊断」按钮开始分析排期问题</p>
        <button
          @click="handleAnalyze"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          开始 AI 诊断
        </button>
      </div>

      <!-- Results -->
      <template v-else>
        <!-- Root Cause -->
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div class="flex items-center gap-2 text-amber-800 font-medium text-sm mb-1">
            <span>🎯</span>
            <span>根因分析</span>
          </div>
          <p class="text-sm text-amber-900 leading-relaxed">{{ rootCause }}</p>
        </div>

        <!-- Health Line Analysis -->
        <div v-if="healthAnalysis" class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div class="flex items-center gap-2 text-blue-800 font-medium text-sm mb-2">
            <span>📊</span>
            <span>Health 线分析</span>
          </div>
          <div class="space-y-1 text-sm text-blue-900">
            <p><span class="text-blue-600">剩余库存：</span>{{ healthAnalysis.remaining?.toLocaleString() }}</p>
            <p><span class="text-blue-600">原因：</span>{{ healthAnalysis.reason }}</p>
            <p><span class="text-blue-600">建议：</span>{{ healthAnalysis.suggestion }}</p>
          </div>
        </div>

        <!-- Suggestions -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-medium text-sm text-slate-700">修复建议</h3>
            <span class="text-xs text-slate-400">共 {{ suggestions.length }} 条</span>
          </div>

          <div
            v-for="(s, i) in suggestions"
            :key="i"
            class="border rounded-lg p-4 space-y-2"
            :class="typeColor(s.type)"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-xs px-2 py-0.5 rounded border bg-white/60">{{ typeLabel(s.type) }}</span>
                <span
                  v-if="s.risk"
                  class="text-xs px-2 py-0.5 rounded font-medium"
                  :class="riskColor(s.risk)"
                >
                  {{ s.risk }}
                </span>
              </div>
              <button
                @click="handleApply(s)"
                class="text-xs px-3 py-1 rounded bg-white border hover:bg-slate-50 transition-colors"
                :class="s.type === 'transfer' ? 'border-amber-200 text-amber-700' : 'border-slate-200 text-slate-600'"
              >
                应用
              </button>
            </div>

            <p class="text-sm font-medium">{{ s.description }}</p>
            <p class="text-xs opacity-80">{{ s.reason }}</p>

            <div v-if="s.expectedExposure" class="text-xs opacity-70">
              预计曝光：{{ s.expectedExposure?.toLocaleString() }}
            </div>
          </div>
        </div>

        <!-- Re-analyze -->
        <div class="pt-2">
          <button
            @click="handleAnalyze"
            class="w-full px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
          >
            重新分析
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
