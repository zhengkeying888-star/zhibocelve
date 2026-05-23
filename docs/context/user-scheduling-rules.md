# 用户实际排期规则（对冲基准）

> 本文件由 `rule-keeper` Agent 维护。记录用户每周人工排期中沉淀的隐性规则，用于对冲验证 AI 实现的规则是否偏离实际业务。
> 每次人工排期后更新，每次系统修复后验证。

## 核心对齐规则

### 规则 1：场次必须对齐排期表
- **内容**：系统解析出的直播场次必须 = 排期表实际直播行数（允许 ±1 误差，因占位行导致）
- **来源**：2026-05-17 对话
- **验证方式**：对比排期表行数 vs 系统 `liveStreams.length`
- **历史基准**：5.18-5.24 排期表应有约 20+ 场（含 real + fake）

### 规则 2：触达必须对齐当周库存
- **内容**：系统总触达 ≈ 当周 audience 库存总量，误差 ≤ 5%
- **来源**：2026-05-17 对话
- **验证方式**：`inventory` 总量 vs 系统 `totalExposure`
- **历史基准**：
  - 5.18-5.24 库存约 478 万 → 系统总触达应在 454 万 ~ 502 万之间

## 品类与等级规则

### 规则 3：国际声乐 = S
- **内容**：「国际声乐」直播评级必须为 S
- **映射方式**：按品类名硬映射。已在 `LIVE_NAME_TO_GRADE` 和 `DEFAULT_CATEGORY_GRADES` 中设为 `'S'`
- **来源**：2026-05-15 对话；2026-05-17 确认按品类名映射
- **验证方式**：检查 `LIVE_NAME_TO_GRADE['国际声乐'] === 'S'` 且 `DEFAULT_CATEGORY_GRADES['国际声乐'] === 'S'`

### 规则 4：段晓晖 = S
- **内容**：「段晓晖」相关直播评级必须为 S
- **来源**：2026-05-15 对话
- **验证方式**：同上

### 规则 5：摄影美学 = S
- **内容**：「摄影美学」直播评级必须为 S
- **映射方式**：按品类名硬映射。已在 `LIVE_NAME_TO_GRADE` 和 `DEFAULT_CATEGORY_GRADES` 中设为 `'S'`
- **来源**：2026-05-15 对话；2026-05-17 确认按品类名映射
- **验证方式**：检查 `LIVE_NAME_TO_GRADE['摄影美学'] === 'S'` 且 `DEFAULT_CATEGORY_GRADES['摄影美学'] === 'S'`

### 规则 6：一杰瑜伽允许跨线 beauty → health
- **内容**：「一杰瑜伽」允许从 beauty 线跨到 health 线分配；默认按 `live.line`（beauty）优先，health 作为跨线 fallback
- **来源**：2026-05-15 拖拽调整记录；2026-05-17 确认维持现状（beauty 优先）
- **验证方式**：检查 `NEUTRAL_CATEGORIES` 是否包含「一杰瑜伽」；检查 `getLiveAllowedLines` 是否返回 `['beauty', 'health']`

### 规则 7：东方养正瑜伽跨线 beauty → health
- **内容**：「东方养正瑜伽」允许从 beauty 线跨到 health 线分配
- **来源**：PRD v3.4 已确认规则
- **验证方式**：检查 `NEUTRAL_CATEGORIES` 集合是否包含该品类

## 上限与频控规则

### 规则 8：低权重直播硬性上限
- **内容**：数字人 / 录播 / 开心太极 最多分配 1 个段，且总曝光 ≤ 200,000
- **来源**：2026-05-15 v3.4 关键决策
- **验证方式**：检查 autoSchedule 结果中这些直播的 `assignedAudiences.length` 和 `exposure`

### 规则 9：C 级 Round 2 必须有 cap
- **内容**：C 级直播在 Round 2 不能无上限扫段，cap = 1.2x target（即 300K）
- **来源**：2026-05-15 复盘（普拉提晨练系统给了 443K vs 人工 189K）
- **验证方式**：检查 C 级直播 `exposure` 是否超过 `target * 1.2`

### 规则 10：tryAssign 失败不 splice
- **内容**：当 `tryAssign` 因段太大而返回 null 时，段必须保留在 pool 中，不能被 splice 出去
- **来源**：2026-05-15 复盘（health 美学 55K 和健康营养 91K 因 splice 永久丢失）
- **验证方式**：检查 `autoSchedule` 中 Round 1/2/3 的失败处理逻辑

## 联合直播规则

### 规则 11：联合直播跨线分配
- **内容**：联合直播（如「一杰瑜伽 + 五禽戏」）必须同时参与所有关联线的 pool 轮询
- **来源**：2026-05-15 v3.4 修复
- **验证方式**：检查 `getLiveAllowedLines` 是否返回多线，`lineGroups` 是否正确放入

### 规则 12：联合直播目标计算
- **内容**：联合直播目标 = 第一场完整 target + 后续子直播 target × 0.5
- **来源**：PRD v3.4
- **验证方式**：检查联合直播的 `target` 字段计算逻辑

### 规则 12a：联合直播强制跨线（优先级修正）
- **内容**：联合直播在 Round 1 `lineGroups` 轮询中，遍历每个 line group 时必须以该 group 的 line 为第一优先，确保从所有 involved line 都实际分配到 audience，而非仅固定在 primary line
- **来源**：2026-05-21 对话（逆龄女神瑜伽只分配到 beauty 段，health 段未分配）
- **验证方式**：检查 Round 1 的 `linesToTry` 生成逻辑，确认联合直播在 health group 中优先 health，在 beauty group 中优先 beauty

## 品类映射规则

### 规则 16：等级变体必须保留独立标准名
- **内容**：`normalizeCategory` 不能通过 `CATEGORY_ALIASES` 吞并等级后缀。`太极SA` 必须规范化为 `太极SA`（或 `太极s`），不能降级为 `太极`；`瑜伽SA`、`普拉提SA`、`手机摄影BCD` 同理。`CATEGORY_TO_LINE` 需为每个等级变体设独立精确键
- **来源**：2026-05-21 对话（用户要求明确区分太极 A/S/BCD）
- **验证方式**：检查 `CATEGORY_ALIASES` 中无等级变体映射；检查 `CATEGORY_TO_LINE` 中是否有 `太极s`、`太极S`、`太极SA`、`太极A`、`太极BCD`、`瑜伽S`、`瑜伽SA`、`瑜伽A`、`瑜伽BCD`、`普拉提S`、`普拉提SA`、`普拉提A`、`普拉提BCD`、`手机摄影SA`、`手机摄影BCD` 等精确键
- **职责分离**：`normalizeCategory` 保留精确标准名（用于显示、3 日频控）；`getCategoryFamily` 负责族映射（用于 5-family limit、排除/去重）

## 排期表解析规则

### 规则 13：周一列必须完整
- **内容**：排期表解析必须包含周一到周日 7 列，第一天必须是周一
- **来源**：2026-05-17 对话（多次缺失周一）
- **验证方式**：`weekDays.length === 7` 且第一项 label 为「周一」
- **关键实现**：`startCol` 检测必须正确识别 Monday 在 col 1 的情况

### 规则 14：当日去重
- **内容**：同一天同一 `category+timeRange` 只能分配给一场直播
- **来源**：PRD v3.4 硬规则
- **验证方式**：检查 `checkConflicts` 中的当日去重逻辑

### 规则 15：3 天频控
- **内容**：同一个 audience 段 3 天内不能被重复触达。品类比较使用 `normalizeCategory` 精确品类名（允许同 family 的不同等级段如 `太极BCD` / `太极SA` 在 3 天内分别触达）
- **来源**：PRD v3.3 设计变更；2026-05-17 确认维持精确匹配
- **验证方式**：检查 `checkConflicts` 中的 3 天频控逻辑，确认使用 `normalizeCategory` 精确匹配，而非 `isSameCategoryFamily`

## 待补充规则（每次排期后更新）

- [ ] 2026-05-18 排期后：补充本周人工调整的具体规则
- [ ] 2026-05-25 排期后：补充下周人工调整的具体规则
