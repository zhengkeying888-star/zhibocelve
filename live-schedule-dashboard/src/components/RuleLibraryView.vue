<script setup lang="ts">
import { computed, ref } from 'vue'
import { ACTIVE_RULES, RULE_CATEGORIES, type RuleCategory } from '@/lib/activeRules'

const props = defineProps<{
  open: boolean
}>()
const emit = defineEmits<{
  (e: 'close'): void
}>()

const search = ref('')
const selectedCategory = ref<RuleCategory | 'all'>('all')

const categories = computed(() => [
  { key: 'all' as const, label: '全部' },
  ...Object.entries(RULE_CATEGORIES).map(([key, meta]) => ({ key: key as RuleCategory, label: meta.label })),
])

const filteredRules = computed(() => {
  let list = [...ACTIVE_RULES]
  if (selectedCategory.value !== 'all') {
    list = list.filter((r) => r.category === selectedCategory.value)
  }
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    list = list.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q)
    )
  }
  // Sort by priority (lower = higher), then title
  return list.sort((a, b) => {
    const pa = a.priority ?? 99
    const pb = b.priority ?? 99
    if (pa !== pb) return pa - pb
    return a.title.localeCompare(b.title)
  })
})

function categoryStyle(category: RuleCategory) {
  return RULE_CATEGORIES[category].color
}

function categoryLabel(category: RuleCategory) {
  return RULE_CATEGORIES[category].label
}
</script>

<template>
  <Transition name="slide">
    <div
      v-if="open"
      class="fixed inset-y-0 right-0 w-[420px] bg-white shadow-2xl border-l border-slate-200 z-[100] flex flex-col"
    >
      <!-- Header -->
      <div class="h-14 border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-lg">📚</span>
          <h2 class="font-bold text-slate-800">规则库</h2>
          <span class="text-xs text-slate-500 ml-1">{{ filteredRules.length }} 条</span>
        </div>
        <button
          @click="emit('close')"
          class="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors"
        >
          <span class="text-xl leading-none">×</span>
        </button>
      </div>

      <!-- Filters -->
      <div class="px-4 py-3 border-b border-slate-100 space-y-2 shrink-0">
        <input
          v-model="search"
          type="text"
          placeholder="搜索规则标题、描述、来源..."
          class="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="cat in categories"
            :key="cat.key"
            @click="selectedCategory = cat.key"
            class="px-2 py-1 rounded text-xs font-medium transition-colors"
            :class="
              selectedCategory === cat.key
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            "
          >
            {{ cat.label }}
          </button>
        </div>
      </div>

      <!-- Rules list -->
      <div class="flex-1 overflow-y-auto p-3 space-y-2">
        <div
          v-for="rule in filteredRules"
          :key="rule.id"
          class="border border-slate-200 rounded-lg p-3 hover:border-blue-300 transition-colors"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="font-medium text-sm text-slate-800 leading-snug">{{ rule.title }}</div>
            <span
              class="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
              :class="categoryStyle(rule.category)"
            >
              {{ categoryLabel(rule.category) }}
            </span>
          </div>
          <div class="text-xs text-slate-600 mt-1.5 leading-relaxed">{{ rule.description }}</div>
          <div class="flex items-center gap-2 mt-2">
            <span v-if="rule.priority != null" class="text-[10px] text-slate-500">
              优先级 P{{ rule.priority }}
            </span>
            <span class="text-[10px] text-slate-400">•</span>
            <span class="text-[10px] text-slate-500 truncate">来源：{{ rule.source }}</span>
            <span class="text-[10px] text-slate-400">•</span>
            <span
              class="text-[10px] px-1 rounded"
              :class="rule.checkable ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'"
            >
              {{ rule.checkable ? '可自动检查' : '待人工确认' }}
            </span>
          </div>
        </div>

        <div v-if="filteredRules.length === 0" class="text-center text-sm text-slate-400 py-8">
          未找到匹配规则
        </div>
      </div>

      <!-- Footer -->
      <div class="px-4 py-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 shrink-0">
        规则库随 AGENTS.md / MEMORY.md / Codex 记忆同步更新
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
