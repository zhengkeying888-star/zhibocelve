# 直播排期规则 PRD

> 版本：v3.4-merge-candidate（当前有效）
> 日期：2026-05-21
> 适用范围：5月W3（5.18–5.24）及后续周次
> 关联仓库：`live-schedule-dashboard`
> DATA_VERSION：`v3.4-joint-cross-line-grade-variants-20260521`

---

## 1. 概述

本规则定义从 Excel 排期表、audience 量级表、跨科偏好表、**4月直播明细表**到最终 audience 分配与 GMV 归因的全流程逻辑。

**核心变更（v3.4-merge-candidate）**：
- **合并候选（Merge Sweep）**：`pickBest` 选中某品类段后，自动把同 `normalizeCategory` 的其他 eligible `timeRange` 段合并分配给同一场直播，解决系统把同品类多段拆散到多场、人工却集中在一场的结构性差距。
- **段数上限按品类-等级计数**：`MAX_SEGMENTS_BY_GRADE` 的计数维度从 `assignedAudiences.length` 改为 `normalizeCategory(category)` 的唯一值数量。同品类的不同 `timeRange` 不再各占用 1 个 slot，解决名师直播因段数上限触顶而大量 audience 未分配的问题。
- **合并数量限制**：S/A 级直播最多额外合并 2 个同品类段，B/C 级最多 1 个，防止过度集中导致其他直播无段可用。
- **联合直播 Round 1 当前 line 优先**：`linesToTry` 以当前轮询 group 的 `line` 为第一优先，确保联合直播涉及的所有线都实际分配到 audience。
- **品类映射保留等级变体**：`瑜伽SA`、`普拉提SA`、`太极SA`、`手机摄影BCD` 保留为独立规范品类，不再被 `CATEGORY_ALIASES` 吞并为基类。

**核心变更（v3.4）**：
- **线级分组轮询（Round 1）**：不再全局按得分排序 greedy 分配，改为按 health → beauty → interest 三线分别轮询，确保同线内各直播都有机会获得 audience。
- **直播优先级排序精简**：移除 `fakeLiveHistory` 和 `historicalGMV` 干扰 bonus，仅保留 `grade + slot` 基础分；新增 **S-grade 名师/IP 加权** 和 **低权重直播（数字人/录播/开心太极）大幅降权**。
- **低权重直播硬性上限**：数字人/录播/开心太极 最多 1 段、最多 200,000 曝光，系统不再给其分配大段。
- **候选排序回归 count**：移除 ROI / `crossRate × LTV` 排序和 `learnedRules` boost，改为 **主线优先 → 垂类优先 → 品类分散 → 避免 timeRange 重复 → 大段优先**，与人工排期逻辑对齐。
- **同 (品类, 时间段) 去重**：同一场直播同一 `normalizeCategory|timeRange` 组合最多只分配一次，允许同品类不同时间段的多个段合并分配。
- **目标曝光量上调**：匹配实际人工排期量级（S: 60万, A: 50万, B: 35万, C: 25万）。
- **Round 2 关闭复用**：`allowReuse = false`，杜绝总量膨胀风险。
- **Grade 推断硬映射更新**：补充 `居家古法养生`、`君合太极晨练`、`2025.5.16健康营养`、`2026.4.2唐一杰`、`李扬` 为 S；`睡眠调理晨练` 为 A。

**前序变更（v3.3）**：
- **频控品类比较修正**：`checkConflicts` 全部改用 `isSameCategoryFamily`，修复别名族（声乐↔国际声乐）和等级变体（瑜伽S↔瑜伽）的频控漏控问题。
- **`tryAssign` 复用模式下跳过 transfer**：复用 = 同一段分配给多个直播，不是从原直播转移。
- **历史数据查找三级回退**：`findHistoricalStat` 支持精确 → `getCategoryFamily` → 最长子串匹配。
- **品类映射补全**：新增 `居家古法` → `古法居家养生` 别名，`normalizeCategory` 分隔符加入 `x`、`X`、`×`。

---

## 2. 数据输入

| 文件 | 必填 | 说明 |
|---|---|---|
| 排期表（含优先级与伪直播剔除） | 是 | 真直播、伪直播、联合直播的原始排期 |
| 确认排期表 | 否 | 运营确认的实际执行排期，用于提取伪直播 audience 与规则校验 |
| audience 量级表 | 否 | 各品类各时间段的存量用户数（含时间范围） |
| 跨科偏好表 | 否 | 品类→品类的 day60 跨科率、转化率、LTV（含 cohortMonth） |
| **4月直播明细表** | **否** | **各直播实际 GMV、曝光人数、首单订单数、首单转化率，用于校准预估模型** |

### 2.1 4月直播明细表格式

```
| 公开课名称 | 直播品类 | 直播状态名称 | 是否新用户测试直播 | 曝光人数 | 总gmv | 首单贡献占比 | 首单订单数 | 首单转化率 |
```

**过滤口径**：
- 剔除 `是否新用户测试直播 = '是'` 的行（新量测试直播数据不纳入日常排期参考）。
- 剔除 `直播状态名称 = '回放'` 的行。
- 品类映射：优先使用明细表中的「直播品类」列；若为空，从「公开课名称」推断。
- **联合直播分隔符支持**：`x`、`X`、`×`（如 `五禽戏 x 健康食养`）会被正确拆分。

**数字清洗**：
明细表中的数字列可能包含货币符号（`¥`、`$`）或千分位逗号（`35,000`）。解析前自动清洗：
```
"¥35,000" → 35000
"12,500"  → 12500
"  8000 " → 8000
```

**统计指标（按标准品类聚合）**：
- `avgGMV`：该品类过滤后直播的 `总gmv` 平均值。
- `avgExposure`：该品类过滤后直播的 `曝光人数` 平均值。
- `avgFirstOrders`：该品类过滤后直播的 `首单订单数` 平均值。
- `avgConversionRate`：该品类过滤后直播的 `首单转化率` 平均值。
- `avgContributionRatio`：该品类过滤后直播的 `首单贡献占比` 平均值。
- `count`：该品类过滤后直播的场次数。

---

## 3. 直播排期规则（核心规则）

排期表采用**矩阵式结构**，横向为一周七天（周一到周日），纵向按时段分为早间晨练、晚间专场、伪直播复用、朋友圈宣发四个区域。

### 3.1 排期表结构

```
| 星期 |      | 周一 | 周二 | ... |
| 日期 |      | 4/27 | 4/28 | ... |
| 早间 |
|      | 健康线 | 直播信息 | ... |
|      | 变美线 | 直播信息 | ... |
|      | 兴趣线 | 直播信息 | ... |
|      | 文案负责人 | 负责人名 | ... |
|      | 定时负责人 | 负责人名 | ... |
|      | 曝光量级 | 数字 | ... |
| 晚间 |
|      | 健康线 | 直播信息 | ... |
|      | ...（同上） |
| 伪直播复用 | ... |
| 朋友圈宣发 | ... |
```

### 3.2 早间晨练（联合直播）

**规则**：同单元格内多行直播名 = **一场联合直播**，共享 audience 池。

**解析细节**：
1. 单元格内容以换行符 `\n` 分隔为多行。
2. 过滤掉时间行（如 `07:30-09:00`）、备注行、空行。
3. 剩余每行提取为一个子直播，子品类 = `name.replace('晨练', '').trim()`。
4. 联合直播名称 = 所有子直播名用 ` + ` 连接。
5. 主品类 = 第一场子直播的品类。
6. 线级 = 涉及的所有子品类线级去重（如 health + beauty）。
7. 评级 = 以第一场子直播的评级为准。
8. 目标曝光 = 第一场子直播完整目标 + 后续子直播目标 × 0.5。

**举例**：
```
逆龄女神瑜伽
五禽戏晨练
```
→ 联合直播名：`逆龄女神瑜伽 + 五禽戏晨练`
→ 主品类：`逆龄女神瑜伽` 的品类
→ 线级：`beauty` + `health` = `{beauty, health}`（自然跨线）
→ 目标曝光：`TARGET_EXPOSURE['A'] + TARGET_EXPOSURE['B'] * 0.5 = 500,000 + 350,000×0.5 = 675,000`

### 3.3 晚间专场（单直播）

**规则**：每行独立为一场单直播。

**解析细节**：
1. 每行提取为一个独立直播场次。
2. 品类推断：通过关键词或前缀推断（如"短视频"→`短视频`，"手机摄影"→`手机摄影`）。
3. 如果行中包含 `开播时间：XX:XX-XX:XX`，提取为 `startTime`。
4. 不属于联合直播，不共享 audience 池。

### 3.4 伪直播复用

**规则**：伪直播标注的是 **上周实际使用的 audience**，本周仅作记录和全局剔除。

**解析细节**：
1. 伪直播单元格中的 audience 数据被提取为 `fakeLiveHistory`。
2. 这些 audience 段在本周全局标记为 `used`（已使用），不再分配给任何新直播。
3. 伪直播本身 **本周不分配任何新 audience**，`exposure = 0`。
4. 30 天内不能再次复用同一 audience 段（30天频控）。
5. **容错处理**：若 `【上次直播排期】` 的 audience 分配行出现在直播信息行之前（排期表顺序不固定），`parseAudienceAssignmentBlock` 会自动创建一个 `type: 'fake'` 的占位直播对象来接收这些 audience 数据，确保全局剔除逻辑不丢失。

### 3.5 完成版排期解析（运营确认排期表）

**规则**：支持解析运营已确认的实际执行排期，其中 audience 分配数据以多行形式嵌入在直播名下方。

**解析细节**：
1. 直播名下方可能跟随多行 audience 分配数据。
2. 健康线 / 变美线 / 兴趣线 audience 可能跨多行，**只有首行带线级标签**，后续行标签为空。
3. 解析器连续收集同一线级的所有行，按列合并后提取 `(品类, 人数, 时间范围)`。
4. 跳过 Excel 时间数字（如 `0.291666666666667`）、纯标签行（如 `【晚间】`）、资源位标注（如 `不回捞`）。
5. 自动识别 `【上次直播排期】` 段落，将对应 audience 路由到伪直播历史记录。若当天尚无 `type === 'fake'` 的直播对象，解析器会自动创建占位对象接收数据。

**举例**：
```
八段锦晨间带练
健康线  睡眠调理  120000  2025.1-2026.4
        五禽戏    80000   2024.7-2024.12
```
→ 提取两条 audience 段：`(睡眠调理, 120000, 2025.1-2026.4)` 和 `(五禽戏, 80000, 2024.7-2024.12)`，线级均为 health。

### 3.6 朋友圈宣发

**规则**：朋友圈资源位直播只做标注，**不参与 audience 分配**。

**解析细节**：
1. `slot === 'friend-circle'` 的直播不进入 autoSchedule 分配流程。
2. 不计算曝光、不分配 audience、不参与 GMV 归因。
3. 导出时保留资源标注行和负责人行。

---

## 4. 联合直播模型

| 属性 | 规则 |
|---|---|
| 名称 | 用 ` + ` 连接所有子直播名 |
| 主品类 | 第一场直播的品类 |
| 线级 | 涉及的所有子品类线级去重（如 health + beauty） |
| 评级 | 以第一场直播的评级为准 |
| 目标曝光 | 各子直播目标曝光之和：`sum(TARGET_EXPOSURE[grade_i])` |
| 跨线 | 自然跨线（因涉及多线品类） |

> 经验值：两个 A 级联合时，目标曝光落在 50–75 万区间，由公式自动计算。

---

## 5. 目标曝光与动态缩放（Target Exposure & Dynamic Scaling）

### 5.1 单直播目标曝光

| 评级 | 单直播目标曝光 |
|---|---|
| S | 600,000 |
| A | 500,000 |
| B | 350,000 |
| C | 250,000 |

联合直播目标 = 第一场子直播完整目标 + 后续子直播目标 × 0.5。

> 举例：逆龄女神瑜伽(A) + 五禽戏晨练(B) = 500,000 + 350,000×0.5 = **675,000**

### 5.2 动态目标缩放

**背景**：不同周次的排期品类组合不同，按历史 avgGMV 直接加总可能导致周总预估偏离 20–25w 运营目标区间。

**计算步骤**：
1. **原始预估** `weeklyRawTarget = Σ(当周各 real live 对应品类的 avgGMV)`
   - 查找顺序：`findHistoricalStat(cat)`：精确 → `getCategoryFamily` → 最长子串匹配
2. **缩放系数** `scaleFactor`：
   - 若 `weeklyRawTarget > 250,000`：`scaleFactor = 250,000 / weeklyRawTarget`（压缩到 25w）
   - 若 `weeklyRawTarget < 200,000`：`scaleFactor = 200,000 / weeklyRawTarget`（放大到 20w）
   - 若在 200,000–250,000 之间：`scaleFactor = 1`
3. **校准后周目标** `weeklyScaledTarget = weeklyRawTarget × scaleFactor`

**单场预估**：
- `expectedGMV = avgGMV × scaleFactor`
- `expectedFirstOrders = avgFirstOrders × scaleFactor`
- `expectedLeads = (avgFirstOrders / avgConversionRate) × scaleFactor`（当 avgConversionRate > 0）

**分摊逻辑**：单场预估按各 assigned audience 的 `count / totalExposure` 比例分摊到 segment 级别。

---

## 6. 品类规范化与同品类族判断

### 6.1 规范化（normalizeCategory）

所有使用品类名做匹配的地方 **必须先经过 `normalizeCategory`**，否则归因/分配会出错。

**匹配优先级**：
1. 精确匹配标准名（69+ 个标准品类）
2. 精确匹配别名（150+ 个别名映射）
3. 提取分隔符前前缀匹配（`-`、`—`、`|`、`·`、`•`、`x`、`X`、`×`）
4. 最长子串匹配标准名
5. 最长子串匹配别名

**新增别名（v3.3）**：
- `居家古法` → `古法居家养生`

**新增分隔符（v3.3）**：`x`、`X`、`×`（支持联合直播原始名如 `五禽戏 x 健康食养`）

### 6.2 同品类族判断（isSameCategoryFamily）

**v3.3 重大修正**：频控、同品类排除、5-family limit 计数 **全部使用 `isSameCategoryFamily`**，不能用 `===` 精确匹配。

**规则**：
1. 先通过 `getCategoryFamily(a)` 和 `getCategoryFamily(b)` 映射到品类族
2. 再比较族名是否相等

**映射规则**：
- **等级变体**：`瑜伽S` / `瑜伽A` / `瑜伽BCD` → `瑜伽`；`普拉提S` / `普拉提A` / `普拉提BCD` → `普拉提`；`太极s` / `太极A` / `太极BCD` → `太极`；`手机摄影SA` / `手机摄影BCD` → `手机摄影`
- **别名族**：`声乐` → `国际声乐`
- **Live 独立品类**：`一杰瑜伽`、`逆龄女神瑜伽`、`东方养正瑜伽` 等 **不映射**到 `瑜伽`，保持独立族名
- **备注剥离**：`普拉提S【剔除庭香】` 先剥离 `【剔除庭香】` 再映射

**典型场景**：
- `声乐` 和 `国际声乐` → **同族**（3天频控生效）
- `瑜伽S` 和 `瑜伽BCD` → **同族**（5-family limit 计为 1 个族）
- `逆龄女神瑜伽` 和 `瑜伽` → **不同族**（独立 Live 品类）

---

## 7. 线级与跨线分配规则

### 7.1 默认规则

同线分配：health → health，beauty → beauty，interest → interest。

### 7.2 联合直播

联合直播 **自然跨线**（涉及多线品类即可跨线）。

### 7.3 单直播跨线

只允许 **beauty 线 → health 线**，且仅限 **中性品类**。

**中性品类**（可在 health + beauty 同时宣发）：
- `一杰瑜伽`
- `东方养正瑜伽`

### 7.4 禁止跨线

health 线和 interest 线 **不向外跨线**（自身池子够大）。

---

## 8. Audience 段提取与时间段合并

### 8.1 提取

从 audience 量级表提取所有 `(品类, 时间范围, 人数)` 三元组。

### 8.2 时间段合并（merge_date_ranges）

同一品类的连续或重叠时间段合并为一个 segment：
- **合并条件**：当前开始日期 `<=` 上一个结束日期 `+ 1天`
- **合并后人数累加**
- 合并后生成统一时间范围文本：`{start}—{end}`

> 合并是为了简化内容下发，避免同一品类的多个微小时间段被拆成独立池子。运营确认排期中也存在合并后的大段分配，合理性取决于具体场景。

---

## 9. Audience 复用约束（硬规则）

| 规则 | 说明 | 实现机制 |
|---|---|---|
| **3 天间隔** | 同一 audience 段两次分配间隔 `>= 3` 天 | `daysBetween(assignedDates[0], live.date) >= 3` |
| **一周最多 2 次** | 同一 audience 段一周内最多被分配 `2` 场直播 | `assignedDates.length < 2` |
| **当日去重** | 同一天同一 audience 段只能分配给 **一场** 直播 | `live.date not in assignedDates` |
| **跨科直播不能宣发同品类族** | `isCrossCategory === true` 时不能分配同品类族 audience | `!isSameCategoryFamily(seg.category, live.category)` |
| **30 天伪直播复用** | 伪直播复用的 audience 段 30 天内不能被再次复用 | `daysBetween(fakeHistory.date, live.date) > 30` |

**v3.3 频控品类比较修正**：
`checkConflicts` 中的 `recentHistory`、`recentWeek`、`sameWeek`、`fakeHistoryAudiences` 检查，**品类比较全部使用 `isSameCategoryFamily`**，不能用 `===`。这是防止别名族（如 `声乐` ↔ `国际声乐`）和等级变体（如 `瑜伽S` ↔ `瑜伽`）的频控漏控。

---

## 10. 自动排期算法（Auto-Scheduling Engine）

### 10.1 整体流程

```
1. 直播优先级排序（scored）
2. 伪直播预处理（全局剔除）
3. Round 1：线级分组轮询，达 target 即止
4. Round 2：全局优先级填充剩余 unused 段
5. Round 3：零曝光兜底
6. 验证与冲突检查
```

### 10.2 直播优先级排序（scored）

每场真直播按以下公式计算得分，按 score 降序排列：

```
score = GRADE_SCORE[grade] + slot_bonus + s_grade_bonus + low_weight_penalty

GRADE_SCORE = {'S': 100, 'A': 70, 'B': 40, 'C': 20, null: 10}
slot_bonus:   evening +50, morning +30, fake-evening +15, fake-morning +10, other +5
s_grade_bonus: +10（仅限 S 级）
low_weight_penalty: -120（仅限数字人/录播/开心太极）
```

**排序结果**：真直播 S > 真直播 A/B/C > 伪直播。低权重直播被大幅降权，确保其不会抢占高优先级直播的 audience。

### 10.3 伪直播预处理

1. 遍历所有伪直播，将其 `assignedAudiences` 中的每个段标记为全局已使用（`seg.status = 'used'`）。
2. 伪直播本身保留 `assignedAudiences` 用于展示历史数据，`exposure` 保持为历史 audience 总和。
3. 这些段在本周不再参与 audience 分配。
4. **解析层容错**：若排期表中 `【上次直播排期】` 的 audience 分配行出现在直播信息行之前，`parseAudienceAssignmentBlock` 会自动创建 `type: 'fake'` 占位对象接收数据，确保全局剔除不遗漏。

### 10.4 候选池过滤

对每场真直播，从可用 audience 段中筛选候选池：

| 步骤 | 条件 | 说明 |
|---|---|---|
| 1 | 线级匹配 | `seg.line in allowed_lines`。联合直播取 `set(live.lines)`；中性品类取 `{'beauty', 'health'}`；其他取 `{live.line}` |
| 2 | 状态可用 | `seg.status === 'available'` 且未被伪直播全局剔除，且 `assignedDates.length === 0` |
| 3 | 次数限制 | `assignedDates.length < 2` |
| 4 | 当日去重 | `live.date not in assignedDates` |
| 5 | 3天间隔 | 若 `assignedDates.length === 1`，则 `daysBetween(assignedDates[0], live.date) >= 3` |
| 6 | 非同品类族 | `!isSameCategoryFamily(seg.category, excludedCat)`。联合直播排除所有子品类；单直播排除自身品类 |
| 7 | 同 (品类, 时间段) 去重 | 同一场直播同一 `${normalizeCategory(category)}|${timeRange}` 组合最多只分配一次；允许同品类不同 timeRange 的多个段合并分配 |
| 8 | 5-family limit | 已分配 `>= 5` 个品类族时，只允许从已分配的族中选取 |

### 10.5 候选排序（5级优先级）

对通过过滤的候选段按以下优先级降序排列：

1. **主线优先**
   - `seg.line === live.line` 的段排最前。中性品类跨线时，主线 health/beauty 仍优先于 fallback 线。

2. **同品类族优先（垂类）**
   - `isSameCategoryFamily(seg.category, live.category)` 为 true 的段优先，确保垂类存量优先使用。

3. **强制分散已分配品类族**
   - 若该品类族已在该直播的 `assignedAudiences` 中，**降低**优先级，促进品类族分散。
   - Merge Sweep 会在 `pickBest` 之后自动合并同品类的其他 timeRange，因此 `pickBest` 本身优先选取新品类族。

4. **避免 timeRange 重复**
   - 若某时间范围已在该直播的 `assignedAudiences` 中，降低优先级，促进 cohort 分散。

5. **大数量段优先**
   - 按 `seg.count` 降序排列。

> **v3.4 移除**：`learnedRules` boost、ROI / `crossRate × LTV` 排序、时间新近排序。原因：ROI 排序导致系统过度回避低 crossRate 但高主题相关性的品类；时间新近排序在合并候选模式下导致同品类大段被新品类小段挤占，与人工排期严重偏离。

### 10.6 分配轮次

#### Round 1：线级分组轮询（v3.4 核心变更）

**目标**：确保同线内各直播都有机会获得 audience，避免全局 greedy 导致某一线级的低权重直播被饿死。

**步骤**：
1. 将 `scored` 按 `live.line` 分组为 `health`、`beauty`、`interest` 三组。
2. 按 `health → beauty → interest` 顺序，对每组内的直播进行轮询。
3. 对每个直播，优先尝试其 **主线** (`live.line`)，再尝试允许的跨线。
4. 只选取 `assignedDates.length === 0` 的段（从未被分配过的段）。
5. `maxCount = target - live.exposure`，防止单轮超过 target。
6. 循环直到没有直播能获得新的候选段。

**分配后处理**：
- 若 `tryAssign` 成功（无论是否 split），将原 segment 从 `linePools` 中移除。
- 若发生 split，将剩余段 `remaining` 推回对应 `linePools`。
- 若 `tryAssign` 失败（如 too-small split），也将该 segment 从 pool 移除，避免无限重试。

#### Round 2：全局优先级填充

- **不复用**：`pickBest(..., allowReuse=false)`，仅使用 unused 段。
- **无 target 上限**：不再设置 `target * 2` ceiling，继续分配直到没有可用段。
- 按 `scored` 全局优先级 round-robin 遍历。
- 同样优先主线、再跨线。

#### Round 3：零曝光兜底

- 对 `exposure === 0` 的直播强制分配。
- 仅尝试 unused 段（`pickBest`，非复用模式）。
- 按主线优先顺序尝试。
- **同样触发 Merge Sweep**：兜底分配的 seed 段也会触发合并扫荡。

### 10.7 合并候选（Merge Sweep）

**问题背景**：人工排期常把同一品类的多个不同 `timeRange` 段（如太极A 的 `截止5/17`、`截止2/2`、`截止1/5`、`截止8/24`）全部放到一场直播；系统因 `pickBest` 强制分散逻辑会把它们拆到不同直播，导致每场只拿到"一小段 3万的"。

**解决方案**：`pickBest` 保持返回单条 `AudienceSegment` 不变，在 `tryAssign` 成功之后立即执行 `tryAssignMergeSweep`，从同 pool 中找出所有与 seed 同 `normalizeCategory(category)` 且仍 eligible 的其他段，逐条 `tryAssign`。

**算法**：
```
tryAssign(seed) 成功
  ↓
tryAssignMergeSweep(live, seed, pool, maxCount, allowReuse)
  1. 从 pool 中筛选：normalizeCategory(seg.category) === normalizeCategory(seed.category)
  2. 复用 pickBest 完整过滤：
     - 排除 excludedCats（跨科直播不能宣发同品类族）
     - checkConflicts 通过（3天频控、当日去重、30天伪直播复用）
     - 5-family limit 未满或该族已存在
     - 不重复已分配的 (normalizeCategory, timeRange) 组合
  3. 按 count 降序排列
  4. 限制合并数量：S/A 级最多额外合并 2 个，B/C 级最多 1 个
  5. 逐条 tryAssign，成功则从 pool 移除，失败保留
```

**兼容性**：Merge Sweep 复用现有 `tryAssign` 和 `checkConflicts`，所有硬规则自然生效：
- 3天频控、当日去重、30天伪直播复用 → `checkConflicts` 逐条检测
- MAX_SEGMENTS、低权重上限、`desiredCount < count * 0.3` → `tryAssign` 内部拦截
- 5-family limit → `pickBest` 已过滤 + Merge Sweep 再检
- 同 (品类, timeRange) 去重 → `assignedCatRanges` 阻止重复
- 联合直播跨线 → 在每个 `tryLine` 的 pool 内独立执行，不跨 pool

### 10.8 段数上限与低权重直播硬性上限

#### 段数上限（MAX_SEGMENTS_BY_GRADE）

| 评级 | 最多品类-等级数 |
|---|---|
| S | 8 |
| A | 7 |
| B | 5 |
| C | 5 |

**v3.4-merge-candidate 重大变更**：段数计数维度从 `assignedAudiences.length` 改为 `normalizeCategory(category)` 的唯一值数量。

**原因**：同品类的不同 `timeRange`（如太极A 的 4 个 timeRange）在人工排期中被视为"1 个品类段"，按旧逻辑会占用 4 个 slot，导致 S/A 级名师直播迅速触顶（8/7 段），大量 audience 无法分配。

**新逻辑**：
```
assignedNormCats = new Set(live.assignedAudiences.map(a => normalizeCategory(a.category)))
segNormCat = normalizeCategory(seg.category)
if (!assignedNormCats.has(segNormCat) && assignedNormCats.size >= maxSegs) return null
```
- 太极BCD（4 个 timeRange）= 1 个 slot
- 太极A（1 个 timeRange）= 1 个 slot
- 同一场直播同时有太极BCD + 太极A = 2 个 slot（按 normalizeCategory 区分）

> 低权重直播仍按实际 `assignedAudiences.length` 计段数（见下节），防止过度堆叠。

#### 低权重直播硬性上限

**定义**：直播名包含 `数字人`、`录播`、`开心太极` 的直播被视为低权重直播。

**上限规则**：
- 最多分配 **1 段** audience（按 `assignedAudiences.length` 计数，不受 normCat 计数放宽影响）。
- 累计曝光最多 **200,000**。
- 排序得分 **-120** 大幅降权。

> 原因：人工排期中数字人/录播直播通常只分配 1 个小段，系统若不设硬上限会贪婪分配多段，挤占真人名师直播的资源。低权重直播不应享受 normCat 计数放宽，否则数字人可能被分配 3-4 个同品类段。

### 10.9 停止条件与超额分配

- **单轮停止**：Round 1 中每场直播分配 audience 直到达到目标曝光后停止该直播的 Round 1 轮询。
- **无全局 130% 上限**：v3.4 移除全局 130% 硬性上限，改为以 target 为 Round 1 指导值，Round 2 继续填充。人工排期中名师/IP 直播常获得远超 target 的 audience。
- **最终验证**：排期完成后自动运行 `validateSchedule()` 检查冲突（3天间隔、当日去重、同品类族等）。

### 10.10 分配后更新

每次分配后更新：
- `live.exposure += seg.count`
- `live.assignedAudiences.push(aud)`
- `seg.status = 'used'`
- `seg.assignedTo = live.id`
- `seg.assignedDates.push(live.date)`
- `live.conflictReasons.push(...conflicts)`（如有冲突则记录）

---

## 11. 规则学习（Rule Learning）

当运营通过拖拽或点击手动调整 audience 分配时，系统记录调整原因并沉淀为结构化规则。下次自动排期时，智能体优先应用这些规则。

**规则结构**：
```typescript
interface LearnedRule {
  id: string
  liveCategory: string    // 直播品类（规范化后）
  fromCategory: string    // 被替换的 audience 品类（如有）
  toCategory: string      // 新分配的 audience 品类
  reason: string          // 用户输入的自然语言原因
  timestamp: number
}
```

> **v3.4 说明**：`learnedRules` 仍被记录和持久化，但 **不再参与 `pickBest` 的排序优先级**。原因：规则学习在历史数据不足时容易产生过拟合，干扰主线/垂类/大段等硬规则的执行。规则数据保留用于未来更精细的模型训练。

---

## 12. 归因计算（历史数据口径）

### 12.1 统一历史路径

当上传了 4 月直播明细表（即 `categoryHistoricalStats` 非空）后，**所有 real live 统一使用历史口径**，不再为个别无历史数据的品类回退到 `crossRate × LTV` 理论模型。

**原因**：理论模型对无历史数据的品类（如「朗诵」）会给出严重虚高的预估，而实际该品类从未直播过，GMV 应为 0。

### 12.2 有历史数据的品类

对已分配的 audiences：

```
totalExposure       = Σ(audience.count)
ratio_i             = audience.count / totalExposure
expectedGMV         = avgGMV × scaleFactor
expectedFirstOrders = avgFirstOrders × scaleFactor
expectedLeads       = (avgFirstOrders / avgConversionRate) × scaleFactor   // 当 avgConversionRate > 0

segmentExpectedGMV_i         = expectedGMV × ratio_i
segmentExpectedFirstOrders_i = expectedFirstOrders × ratio_i
segmentExpectedLeads_i       = expectedLeads × ratio_i
```

**历史数据查找（v3.3 新增三级回退）**：
1. 精确匹配：`categoryHistoricalStats[cat]`
2. `getCategoryFamily` 回退：处理等级变体（瑜伽S → 瑜伽）
3. 最长子串回退：处理细分类目包含大类（逆龄女神瑜伽 包含 瑜伽）

**归因面板展示**：
- 触达人数：该直播分配的所有 audience count 之和
- 预计线索：`expectedLeads`
- 预计首单：`expectedFirstOrders`
- 预计 GMV：`expectedGMV`

### 12.3 无历史数据的品类

当 `categoryHistoricalStats` 非空，但某品类在明细表中无记录时：
- `expectedGMV = 0`
- `expectedFirstOrders = 0`
- `expectedLeads = 0`

该直播在归因面板中显示为 0，提示运营该品类缺乏历史数据支撑。

### 12.4 理论模型回退条件

仅当 **从未上传过 4 月直播明细表**（`categoryHistoricalStats` 为空）时，回退到理论模型：

```
expectedLeads      = Σ(audience.count × crossRate)
expectedFirstOrders = Σ(expectedLeads × conversionRate)
expectedGMV        = Σ(expectedFirstOrders × ltv)
```

**匹配优先级**（cohort-aware）：
1. `fromCategory == audCat && toCategory == liveCat && cohortMonth == extractCohortMonth(aud.timeRange)`（精确匹配）
2. `fromCategory == audCat && toCategory == liveCat`（全量平均 fallback）
3. 默认 zero

---

## 13. 历史等级推荐

基于所有有历史数据品类的 `avgGMV` 计算四分位数，自动推荐等级标签（历S/历A/历B/历C）。

**计算方式**：
1. 提取所有品类的 `avgGMV`，排序。
2. 计算 p20、p50、p80 分位数。
3. 每个品类的推荐等级：
   - `avgGMV >= p80` → **历S**
   - `avgGMV >= p50` → **历A**
   - `avgGMV >= p20` → **历B**
   - 其他 → **历C**

**展示位置**：直播卡片右上角，当前等级标签左侧。仅当推荐等级与当前等级不一致时显示。

**作用**：仅为建议，不自动覆盖 `categoryGrades`。运营可据此手动调整品类评级，调整后重新点击「自动排期」即可生效。

---

## 14. 协作方式流程（人机对齐工作流）

v3.4 引入标准化的人机协作流程，用于每周排期时让系统自动排期结果逐步逼近人工排期标准。

### 14.1 流程图

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 1. 上传数据  │ --> │ 2. 自动排期  │ --> │ 3. 运营审阅  │
│  (Excel)    │     │ (autoSchedule)│     │ (对比人工)   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌─────────────┐            │ 差异?
                    │ 5. 修正规则  │ <-- 是 ---┘
                    │ (代码/配置)  │
                    └──────┬──────┘
                           │
                           └--> 返回 2. 重新生成

                    否 --> ┌─────────────┐
                           │ 6. 确认导出  │
                           │ (Excel/飞书) │
                           └─────────────┘
```

### 14.2 各阶段说明

#### 阶段 1：数据上传

运营每周上传以下文件：
1. **排期表**（`.xlsx`）：包含本周所有直播场次、文案负责人、定时负责人。
2. **audience 量级表**（`.xlsx`）：各品类各时间段的存量用户数和 cohort 时间范围。
3. **4月直播明细表**（可选，首次上传后持久化）：用于历史 GMV 校准。

上传后系统自动解析并展示周度排期矩阵。

#### 阶段 2：自动排期

运营点击「自动排期」按钮，系统按 v3.4 算法执行：
- 线级分组轮询 Round 1
- 全局填充 Round 2
- 零曝光兜底 Round 3

生成后，系统展示：
- 每场直播的 assigned audiences（品类、时间范围、人数）
- 总触达人数 vs 总库存
- 冲突与警告（如有）

#### 阶段 3：运营审阅与质问

运营将系统排期与人工预期排期逐场对比，重点关注以下维度：

| 审阅维度 | 常见问题 | 对应规则调整 |
|---|---|---|
| **等级推断** | 某直播被系统判为 C，但人工认为是 S/A | 更新 `LIVE_NAME_TO_GRADE` 硬映射或 `categoryGrades` |
| **段数上限** | 名师/IP 直播段数太少，或低权重直播段数太多 | 调整 `MAX_SEGMENTS_BY_GRADE` 或 `isLowWeightLive` 上限 |
| **品类堆叠** | 同一场直播被分配了 2+ 个同 (品类, 时间段) 组合 | 检查 `assignedCatRanges` 去重是否生效 |
| **合并集中度** | 同品类多 timeRange 被拆散到不同直播 | 检查 `tryAssignMergeSweep` 是否触发、合并数量限制是否过严 |
| **跨线分配** | 某直播被分配了非主线的 audience，但人工未如此安排 | 检查 `pickBest` 的 `primary line first` 排序 |
| **时间新近** | 某直播被分配了很老的 cohort，但人工分配了更新的 | 检查 `getTimeRecencyScore` 排序权重 |
| **总量失控** | 系统总触达远超或远低于人工总触达 | 检查 `allowReuse` 是否关闭、`tryAssign` hardMax 是否移除 |
| **ROI 偏差** | 系统因 crossRate 低而跳过高相关品类 | **移除 ROI 排序**，回归 count 排序 |

**审阅工具**：
- 看板左侧「智能推荐」显示各直播的可分配库存。
- 右侧「详情面板」显示已分配 audience 的 GMV 归因。
- 拖拽调整：运营可将 audience 从一场直播拖到另一场，系统记录调整。

#### 阶段 4：规则修正（关键迭代）

当发现系统性偏差时，按以下优先级修正：

1. **配置层修正**（无需改代码）：
   - 在看板「品类管理」中调整某品类的 grade/line。
   - 在「直播卡片」上手动修改单场直播的 grade/category/line。
   - 调整 `gmvMultiplier`（临时全局校准系数）。

2. **代码层修正**（需要发版）：
   - 更新 `LIVE_NAME_TO_GRADE` 硬映射（`parser.ts`）。
   - 更新 `MAX_SEGMENTS_BY_GRADE` 段数上限（`schedule.ts`）。
   - 调整 `pickBest` 排序因子或新增硬规则（`schedule.ts`）。
   - 调整 `tryAssignMergeSweep` 合并数量限制（`schedule.ts`）。
   - 更新 `isLowWeightLive` 检测范围（`schedule.ts`）。
   - 调整段数计数维度（normCat vs 实际段数）（`schedule.ts`）。
   - Bump `DATA_VERSION` 强制清空旧 persisted state。

3. **验证层修正**：
   - 运行 `scripts/test-autoSchedule.ts` 对比系统结果与人工排期。
   - 逐场核对：目标曝光、实际曝光、段数、品类族数、细分品类数。
   - 确认「总库存 ≈ 人工总触达 ≈ 系统总触达」（误差 < 2%）。

#### 阶段 5：重新生成

修正后，运营点击「重置并重新生成」或刷新页面后重新执行 autoSchedule。

**迭代原则**：
- 每次只改一个变量，观察差异变化。
- 优先修正「等级推断」和「低权重上限」，再调排序细节。
- 当系统与人工的「同品类族分配率」> 80% 且「总触达误差」< 2% 时，视为对齐。

#### 阶段 6：确认导出

对齐后，运营点击「导出排期结果」生成 Excel：
- 矩阵式排期表（与上传格式一致）。
- 包含分配人群-品类、分配人群-进量时间段、分配人群-人数。
- 联合直播的每个 audience 段单独一行，首行填充直播信息。

---

## 15. 导出格式

导出 Excel 包含以下列：
- 日期、时段、直播名称、品类、线级、评级、类型
- 目标曝光、实际曝光
- 分配人群-品类、分配人群-进量时间段、分配人群-人数

联合直播的每个 audience 段单独一行，首行填充直播信息。

时间段合并显示：同一品类的多个段合并为合并后的时间跨度（如 `2023年1月—2026年5月10日`）。

---

## 16. 版本变更记录

| 版本 | 日期 | 变更内容 |
|---|---|---|
| v1.0 | 2026-05-07 | 初始排期逻辑：独立直播解析、同线分配、子串匹配同品类族 |
| v2.0 | 2026-05-08 | **联合直播模型**、严格同品类族（`normalizeCategory` 严格相等）、跨线规则（beauty→health 仅限中性品类）、伪直播处理、时间段合并 |
| v2.1 | 2026-05-09 | **联合直播目标修正**（第一场完整 + 后续 × 0.5）；**完成版排期解析**；autoSchedule 校准（7级排序 + 130% 目标超额分配） |
| v2.2 | 2026-05-11 | **规则学习智能体**、Cloud Sync、严格频控实现（`assignedDates` 机制）、总触达排除伪直播 |
| v3.0 | 2026-05-12 | **历史数据归因模型**：4月直播明细表解析、动态目标缩放（20–25w）、统一历史路径归因、历史等级推荐（历S/A/B/C）、autoSchedule 历史 GMV 权重与历史 ROI 排序 |
| v3.1 | 2026-05-13 | **修复数字解析**：支持 `¥35,000`、`12,500` 等带货币符号/千分位逗号格式；**扩充直播排期规则章节** |
| v3.2 | 2026-05-14 | **所有 real live 默认 isCrossCategory: true**；`pickBest` 5-family limit 使用 `getCategoryFamily` 计数；`tryAssign` 硬 ceiling（2x target）+ split 保护（< 30% 跳过）；联合直播 `categories` 去重 + intra-week 3天频控 |
| v3.3 | 2026-05-15 | **`checkConflicts` 频控品类比较改用 `isSameCategoryFamily`**（修复别名族/等级变体漏控）；**Round 2 真正复用**：`pickBest` 支持 `allowReuse`，`tryAssign` 复用模式跳过 transfer；**历史数据查找三级回退**（`findHistoricalStat`）；**品类映射补全**（`居家古法` 别名、`x/X/×` 分隔符） |
| **v3.4** | **2026-05-17** | **线级分组轮询 Round 1**（health→beauty→interest）；**直播优先级排序精简**（移除 fakeHist/histGMV bonus，新增 S-grade +10 / 低权重 -120）；**低权重直播硬性上限**（1段/20万）；**候选排序回归 count**（移除 ROI 与 learnedRules boost，改为 主线→垂类→分散→大段）；**细分品类硬去重**（`assignedNormalizedCats`）；**Round 2 关闭复用**（`allowReuse=false`）；**目标曝光量上调**（S:60万, A:50万, B:35万, C:25万）；**新增人机协作对齐工作流**（第14章）；**Grade 推断硬映射更新** |
| **v3.4-merge-candidate** | **2026-05-21** | **合并候选 Merge Sweep**：`pickBest` 选中后自动合并同 `normalizeCategory` 的其他 eligible `timeRange` 段；**段数上限按品类-等级计数**：`MAX_SEGMENTS` 计数从 `assignedAudiences.length` 改为 `normalizeCategory` 唯一值，同品类不同 timeRange 不额外占 slot；**合并数量限制**（S/A 额外 2 个，B/C 额外 1 个）；**联合直播 Round 1 当前 line 优先**；**品类映射保留等级变体**（瑜伽SA/普拉提SA/太极SA/手机摄影BCD 为独立规范品类）；**移除时间新近排序**；**同 (品类, timeRange) 去重**替代同细分品类去重 |

---

## 17. 待决策/待优化项

1. **历史数据趋势分析**：当前仅使用单月销量均值，未来可扩展为多月销量趋势（如近 3 个月滚动平均）。
2. **规则学习效果评估**：当前规则仅影响排序优先级，尚未量化规则对 GMV 的实际提升效果。
3. **多周排期批量管理**：当前为单周排期，未来可支持多周批量上传与对比。
4. **完成版排期直接回写**：当前完成版排期可正确解析并显示，但尚未支持将手动调整后的结果导出为新的"正确版排期"格式。
5. **飞书多维表格集成**：计划支持从飞书 Bitable 直接读取排期数据，减少 Excel 上传步骤。
