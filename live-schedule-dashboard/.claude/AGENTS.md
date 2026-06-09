# AGENTS.md — 直播排期策略看板

## 项目概述

私域直播运营排期策略看板。核心工作流：上传 Excel → 解析 → autoSchedule（5 轮自动分配）→ 规则审计 → 运营手动校准 → 导出。

技术栈：Vue 3 + TypeScript + Pinia + Tailwind CSS v4。

## Agent 定义

### algo-agent（排期算法专家）

- **职责**：autoSchedule 核心算法、tryAssign/pickBest/checkConflicts、parser 解析逻辑、规则审计（ruleAuditor）、归因计算、品类映射。
- **代码范围**：
  - `src/stores/schedule.ts`（autoSchedule 主算法）
  - `src/utils/parser.ts`（Excel 解析）
  - `src/utils/ruleAuditor.ts`（规则审计）
  - `src/utils/categoryMapping.ts`（品类映射）
  - `src/utils/scheduleValidator.ts`（排期验证）
- **禁止**：修改 Vue 组件（`src/components/*.vue`）、样式、UI 交互逻辑。
- **约束**：
  - 任何 autoSchedule 逻辑变更必须同步检查 `ruleAuditor.ts` 中对应审计项。
  - 修改 `categoryMapping.ts` 时必须双向审计（上游原始名 ↔ 标准名）。
  - 必须验证 TypeScript 编译通过后才能标记完成。

### frontend-agent（前端专家）

- **职责**：Vue 组件开发、UI 交互、拖拽逻辑、面板布局、弹窗、图表、样式调整。
- **代码范围**：
  - `src/components/*.vue`
  - `src/App.vue`
  - `src/style.css` / Tailwind 配置
- **禁止**：修改 `src/stores/schedule.ts` 中的 autoSchedule 核心算法、parser、ruleAuditor。
- **约束**：
  - 组件变更后必须检查是否破坏现有拖拽/上传/导出流程。
  - 新组件遵循 `<script setup>` + TypeScript 规范。

### qa-agent（回归测试专家）

- **职责**：用真实 Excel 数据跑回归验证、对比修复前后的排期结果、检查规则合规、生成差异报告。
- **代码范围**：
  - `scripts/` 测试脚本
  - 临时验证脚本（可创建在 `scripts/` 或项目根目录）
- **禁止**：修改 `src/` 下的业务代码。
- **约束**：
  - 必须基于真实上传数据验证，不使用 mock。
  - 验证报告必须包含：总库存、总触达、剩余 audience、伪直播达标率、health 线利用率。
  - 发现 regression 时必须明确标注受影响的具体直播和 audience 段。

### rule-critic（规则批判者）

- **定义位置**：`~/.claude/agents/rule-critic.md`（全局 Agent）
- **职责**：对业务规则、策略文档、排期记忆进行批判性审计，强制挑刺、交叉校验已有记忆、评估可执行性与冲突风险。
- **触发条件**：用户要求「确认 / 评估 / 审核 / 校对 / 审计」任何规则、文档、记忆时自动调用。

## 工作流

### schedule-fix（排期算法修复）

```
用户提出算法问题
    ↓
algo-agent 分析根因 → 修改代码
    ↓
qa-agent 用真实数据跑回归验证
    ↓
主 Agent 汇总结果 → 展示给用户
```

### ui-update（前端更新）

```
用户提出 UI/交互需求
    ↓
frontend-agent 修改组件
    ↓
主 Agent 本地验证（npm run dev / build）
    ↓
展示给用户
```

### rule-audit（规则审计）

```
用户要求审计规则/记忆/策略
    ↓
rule-critic 执行深度审计（5 维度评分 + 保留意见 + 冲突检测）
    ↓
主 Agent 汇总报告
```

## 协作规则

1. **algo-agent 与 frontend-agent 不交叉**：算法问题只派 algo-agent，UI 问题只派 frontend-agent。
2. **qa-agent 必须在 algo-agent 之后**：任何算法修改完成后，qa-agent 必须执行回归验证。
3. **rule-critic 在重大规则变更前必须触发**：修改 `AGENTS.md`、`MEMORY.md`、业务规则文档前，先执行 rule-review 工作流。
4. **主 Agent（我）负责任务分发和汇总**：子 Agent 不直接面向用户输出结论，由主 Agent 整合后呈现。

## 记忆关联

- [[排期上传规则]] — 上传完成后强制重新 autoSchedule
- [[autoSchedule 连环踩坑]] — 总量失控、单场超标、修复不彻底
- [[品类比较与复用陷阱]] — `===` 在品类比较里是致命陷阱
- [[联合直播强制跨线]] — Round 1 lineGroups 中联合直播必须以当前 group line 为第一优先
- [[合并候选与段数计数突破]] — Merge Sweep 后合并策略、段数按 normalizeCategory 计数
- [[v3.5 Redline 跨线合规与规则审计]] — 红线级修复：删除跨线兜底、tryAssign 底层硬校验
