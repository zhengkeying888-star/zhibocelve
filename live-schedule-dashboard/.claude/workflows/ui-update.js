export const meta = {
  name: 'ui-update',
  description: '前端更新工作流：frontend-agent 修改 Vue 组件 → 本地验证',
  phases: [
    { title: '前端修改', detail: 'frontend-agent 修改组件、样式、交互' },
    { title: '本地验证', detail: 'npm run build 验证无编译错误' },
  ],
}

phase('前端修改')

const uiResult = await agent(
  `你是 frontend-agent（前端专家）。\n\n` +
  `任务：修改直播排期策略看板的前端组件。\n\n` +
  `必须遵循的规则：\n` +
  `1. 只修改 src/components/*.vue、src/App.vue、src/style.css；\n` +
  `2. 禁止修改 src/stores/schedule.ts 中的 autoSchedule 核心算法；\n` +
  `3. 新组件遵循 <script setup> + TypeScript 规范；\n` +
  `4. 修改后运行 npm run build 验证编译通过；\n` +
  `5. 返回修改的文件路径列表和修改摘要。`,
  { label: 'frontend-update', agentType: 'frontend-agent' }
)

phase('本地验证')

const buildOk = await agent(
  `验证前端构建是否通过。运行：\n` +
  `cd /Users/zhengkeying/直播间排期策略/live-schedule-dashboard && npm run build 2>&1\n` +
  `如果失败，返回错误信息；如果成功，返回 "build ok"。`,
  { label: 'build-check' }
)

return {
  ui: uiResult,
  build: buildOk,
}
