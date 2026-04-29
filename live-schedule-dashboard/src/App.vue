<script setup lang="ts">
import { onMounted } from 'vue'
import UploadBar from './components/UploadBar.vue'
import LivePool from './components/LivePool.vue'
import WeekBoard from './components/WeekBoard.vue'
import DetailPanel from './components/DetailPanel.vue'
import { useScheduleStore } from './stores/schedule'

const store = useScheduleStore()

onMounted(() => {
  store.loadMockData()
})
</script>

<template>
  <div class="h-screen flex flex-col overflow-hidden bg-[#f8f9ff]">
    <UploadBar />
    <div class="flex flex-1 overflow-hidden">
      <LivePool />
      <WeekBoard />
      <DetailPanel />
    </div>
  </div>
</template>
