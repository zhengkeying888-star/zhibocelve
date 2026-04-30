<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import type { GradeType, LineType } from '@/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useScheduleStore()
const autoReschedule = ref(true)
const applying = ref(false)

const categories = computed(() => {
  const list = store.uniqueCategories.map((cat) => ({
    name: cat,
    line: store.categoryLines[cat] || null,
    grade: store.categoryGrades[cat] || null,
  }))
  list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return list
})

function setLine(cat: string, line: LineType | '') {
  if (line) store.setCategoryLine(cat, line)
}

function setGrade(cat: string, grade: GradeType | '') {
  if (grade) store.setCategoryGrade(cat, grade)
}

async function applyAll() {
  applying.value = true
  store.applyCategoryGrades()
  store.applyNameOverrides()
  if (autoReschedule.value && store.audienceSegments.length > 0) {
    await store.autoSchedule()
  }
  applying.value = false
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[100] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
        <div class="relative bg-white rounded-xl shadow-2xl w-[560px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden">
          <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div>
              <h2 class="text-lg font-bold text-[#0b1c30]">品类评级管理</h2>
              <p class="text-xs text-slate-500 mt-0.5">设置每个品类的所属线与等级，系统将自动应用到对应直播场次</p>
            </div>
            <button class="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 transition-colors" @click="emit('close')">
              &times;
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-6">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-slate-200">
                  <th class="text-left py-2 text-xs font-semibold text-slate-500 uppercase">品类名称</th>
                  <th class="text-left py-2 text-xs font-semibold text-slate-500 uppercase">所属线</th>
                  <th class="text-left py-2 text-xs font-semibold text-slate-500 uppercase">等级</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="cat in categories"
                  :key="cat.name"
                  class="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td class="py-2.5 text-slate-800 font-medium">{{ cat.name }}</td>
                  <td class="py-2.5">
                    <select
                      :value="cat.line || ''"
                      class="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400 bg-white"
                      @change="setLine(cat.name, ($event.target as HTMLSelectElement).value as LineType)"
                    >
                      <option value="">未设置</option>
                      <option value="health">健康线</option>
                      <option value="beauty">变美线</option>
                      <option value="interest">兴趣线</option>
                    </select>
                  </td>
                  <td class="py-2.5">
                    <select
                      :value="cat.grade || ''"
                      class="text-xs border border-slate-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400 bg-white"
                      @change="setGrade(cat.name, ($event.target as HTMLSelectElement).value as GradeType)"
                    >
                      <option value="">未设置</option>
                      <option value="S">S</option>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                    </select>
                  </td>
                </tr>
                <tr v-if="categories.length === 0">
                  <td colspan="3" class="py-8 text-center text-sm text-slate-400">
                    暂无品类数据，请先上传排期表
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div class="flex items-center gap-3">
              <span class="text-xs text-slate-500">
                共 {{ categories.length }} 个品类
              </span>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input v-model="autoReschedule" type="checkbox" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <span class="text-xs text-slate-600">重新生成排期</span>
              </label>
            </div>
            <div class="flex items-center gap-3">
              <button class="text-sm text-slate-600 hover:text-slate-900 px-4 py-2 rounded transition-colors" @click="emit('close')">
                关闭
              </button>
              <button
                class="text-sm text-white bg-primary hover:bg-blue-700 px-5 py-2 rounded shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                :disabled="applying"
                @click="applyAll"
              >
                <span v-if="applying">应用中...</span>
                <span v-else>应用到所有场次</span>
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
