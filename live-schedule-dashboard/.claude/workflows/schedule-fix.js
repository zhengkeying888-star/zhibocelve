export const meta = {
  name: 'schedule-fix',
  description: '排期算法修复工作流：algo-agent 分析根因并修改代码 → qa-agent 用真实 Excel 数据回归验证',
  phases: [
    { title: '根因分析与修复', detail: 'algo-agent 定位 autoSchedule / parser / ruleAuditor 问题并修改代码' },
    { title: '回归验证', detail: 'qa-agent 用最新真实数据验证修复前后的排期差异' },
  ],
}

phase('根因分析与修复')

const fixResult = await agent(
  `你是 algo-agent（排期算法专家）。\n\n` +
  `任务：分析并修复 autoSchedule 相关问题。\n\n` +
  `必须遵循的规则：\n` +
  `1. 只修改 src/stores/schedule.ts、src/utils/parser.ts、src/utils/ruleAuditor.ts、src/utils/categoryMapping.ts、src/utils/scheduleValidator.ts；\n` +
  `2. 禁止修改 src/components/ 下的 Vue 组件；\n` +
  `3. 任何 autoSchedule 逻辑变更必须同步检查 ruleAuditor.ts 中对应审计项；\n` +
  `4. 修改 categoryMapping.ts 时必须双向审计；\n` +
  `5. 修改后运行 npx vue-tsc --noEmit --skipLibCheck 验证编译通过；\n` +
  `6. 返回修改的文件路径列表和修改摘要。`,
  { label: 'algo-fix', agentType: 'algo-agent' }
)

phase('回归验证')

const qaResult = await agent(
  `你是 qa-agent（回归测试专家）。\n\n` +
  `任务：用真实 Excel 数据验证 algo-agent 的修复效果。\n\n` +
  `必须遵循的规则：\n` +
  `1. 基于真实上传数据验证，不使用 mock；\n` +
  `2. 对比修复前后的排期结果，生成差异报告；\n` +
  `3. 报告必须包含：总库存、总触达、剩余 audience、伪直播达标率、health 线利用率；\n` +
  `4. 发现 regression 时必须明确标注受影响的具体直播和 audience 段；\n` +
  `5. 禁止修改 src/ 下的业务代码。`,
  { label: 'qa-verify', agentType: 'qa-agent' }
)

return {
  fix: fixResult,
  verification: qaResult,
}
