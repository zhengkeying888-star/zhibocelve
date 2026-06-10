<script setup lang="ts">
import { computed } from 'vue'
import { useScheduleStore } from '@/stores/schedule'

const store = useScheduleStore()

const rootCause = computed(() => store.aiFixSuggestions?.rootCause || '')
const isLoading = computed(() => store.isAiFixLoading)
const error = computed(() => store.aiFixError)
const raw = computed(() => store.aiFixSuggestions?.raw || '')

async function handleAnalyze() {
  await store.fetchAiFixSuggestions()
}

async function handleCopy() {
  if (!raw.value) return
  try {
    await navigator.clipboard.writeText(raw.value)
    alert('诊断报告已复制到剪贴板！请粘贴到 Claude Code 对话中。')
  } catch {
    // Fallback
    const textarea = document.createElement('textarea')
    textarea.value = raw.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    alert('诊断报告已复制到剪贴板！请粘贴到 Claude Code 对话中。')
  }
}

function handleClose() {
  store.clearAiFix()
}
</script>

<template>
  <div class="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col">
    <!-- Header -->
    <div class="h-14 border-b border-slate-100 flex items-center justify-between px-5 shrink-0">
      <div class="flex items-center gap-2">
        <span class="text-lg">🤖</span>
        <h2 class="font-bold text-[#0b1c30]">AI 排期诊断</h2>
      </div>
      <button @click="handleClose" class="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-5 space-y-4">
      <!-- Loading -->
      <div v-if="isLoading" class="flex flex-col items-center justify-center py-12 gap-3">
        <div class="w-8 h-8 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
        <p class="text-sm text-slate-500">正在生成本地诊断报告…</p>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="bg-rose-50 border border-rose-200 rounded-lg p-4">
        <div class="flex items-center gap-2 text-rose-700 font-medium text-sm mb-1">
          <span>⚠️</span>
          <span>生成失败</span>
        </div>
        <p class="text-xs text-rose-600">{{ error }}</p>
        <button @click="handleAnalyze" class="mt-3 px-3 py-1.5 bg-white border border-rose-200 rounded text-xs text-rose-700 hover:bg-rose-50">重试</button>
      </div>

      <!-- Empty state -->
      <div v-else-if="!rootCause && !isLoading" class="flex flex-col items-center justify-center py-12 gap-4">
        <div class="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-2xl">📋</div>
        <p class="text-sm text-slate-500 text-center max-w-[280px]">
          点击「生成诊断报告」，系统会基于当前排期数据生成结构化 Markdown 报告，复制后粘贴到 Claude Code 即可分析。
        </p>
        <button @click="handleAnalyze" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          生成诊断报告
        </button>
      </div>

      <!-- Report Result -->
      <template v-else>
        <!-- Success banner -->
        <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
          <div class="flex items-center gap-2 text-emerald-800 font-medium text-sm">
            <span>✅</span>
            <span>诊断报告已生成</span>
          </div>
          <p class="text-xs text-emerald-700">
            点击下方「复制报告」按钮，将 Markdown 报告粘贴到 Claude Code 对话中，我会自动分析并给出修复建议。
          </p>
          <button @click="handleCopy" class="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors">
            📋 复制报告到剪贴板
          </button>
        </div>

        <!-- Report Preview -->
        <div class="border border-slate-200 rounded-lg overflow-hidden">
          <div class="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
            <span class="text-xs font-medium text-slate-600">报告预览</span>
            <span class="text-xs text-slate-400">{{ raw.length.toLocaleString() }} 字</span>
          </div>
          <pre class="p-4 text-xs text-slate-700 overflow-auto max-h-[500px] whitespace-pre-wrap font-mono leading-relaxed">{{ raw }}</pre>
        </div>

        <!-- Re-generate -->
        <div class="pt-2">
          <button @click="handleAnalyze" class="w-full px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors">
            重新生成
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
