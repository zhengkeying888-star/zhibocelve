# 直播间排期策略看板 — 项目级 Agent 协作规则

## 强制触发：规则深度确认协议（Rule Review Protocol）

当用户请求涉及以下任一动作时，主 agent **禁止**直接给出"没问题/已确认/正确/可以"式结论：
- 确认、评估、审核、校对、审计
- 验收、过目、看看对不对
- 判断规则/策略/记忆/文档/PRD/代码实现"是否正确"或"是否完整"
- 要求对排期结果、品类映射、autoSchedule 逻辑、导出口径进行"检查"

主 agent 必须执行以下步骤：

1. 完整读取待评估目标文件/段落，标注具体范围（文件路径 + 行号/段落标题）。
2. 读取项目 `MEMORY.md`（`/Users/zhengkeying/.claude/projects/-Users-zhengkeying--------/memory/MEMORY.md`）及所有相关链接记忆（`feedback-*.md`、`project-*.md`、`docs/bugs/*.md`）。
3. 如涉及 parser / autoSchedule / 上传 / 导出口径，必须读取：
   - `docs/bugs/2026-05-14-autoSchedule-retrospective.md`
   - `~/.claude/memory-log/2026-05-29-parser-and-schedule-rules-audit.md`
4. 调用 Workflow `rule-review`，传入 `args.target`；或 spawn `rule-critic` agent。
5. 交叉校验现有记忆与代码实现，检查冲突、遗漏、优先级、可执行性。
6. 输出必须包含：
   - 总体认可程度（完全认可 / 基本认可但有保留 / 暂不认可）
   - 5 维度评分（完整性、一致性、可执行性、优先级清晰度、风险，1–5 分）
   - 至少 1 条保留意见
   - 建议补充项（含建议写入位置）
   - 与现有记忆的冲突/缺口
   - 是否需要用户裁决

## 排期规则冲突优先级（硬顺序）

当以下约束冲突时，按此顺序优先：
1. **真直播 200,000 单场底线**（所有直播形态统一 20w 底线，真直播上限可高于伪直播/数字人）
2. **同 audience 一周最多 2 次 / 间隔 ≥3 天**
3. **联合直播跨线资源实际分配**（涉及 line group 中以当前 group line 为第一优先）
4. **伪直播/数字人只能用剩余段后置承接**
5. **品类族上限与段数上限**（S/A/B/C 的 MAX_TOTAL_SEGMENTS）

解读：不应用 audience 复用规则去挤压其他真直播的 20w 底线；若补到 20w 会导致其他真直播跌破 15w，则先保证各真直播 20w 底线，再用复用规则补差。

## Memory 链接约束

每次规则评估完成后，若产生新的保留意见、补充项、待确认项或严重冲突，必须：
1. 使用 `key-memory-log` skill 生成 `rule-review-retrospective-YYYY-MM-DD.md`；或
2. 在项目 `MEMORY.md` 中追加索引链接；或
3. 在 `docs/bugs/` 下创建对应复盘文档。

**不得让评估结论停留在单次对话中。**

## 看板前端实现相关评估

当评估涉及 `live-schedule-dashboard` 前端组件、Pinia store、新增面板/弹窗时：
1. 除规则审计外，还需检查是否与现有 Vue 组件结构一致（`components/`、`stores/`、`utils/` 分工）；
2. 新增功能必须说明数据流（props / store / localStorage / Cloud Sync）；
3. 必须评估对 `DATA_VERSION` 和 persisted state 的兼容性影响；
4. 若新增规则展示/审计面板，必须明确其数据是静态写入前端代码、从记忆文件同步，还是运行时调用 Claude Agent。
