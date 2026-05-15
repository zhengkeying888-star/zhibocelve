# 直播排期规则 PRD

> 版本：v3.3（当前有效）
> 日期：2026-05-15
> 适用范围：5月W3（5.18–5.24）及后续周次
> 关联仓库：`live-schedule-dashboard`
> DATA_VERSION：`v3.3-reuse-and-family-conflicts`

---

## 1. 概述

本规则定义从 Excel 排期表、audience 量级表、跨科偏好表、**4月直播明细表**到最终 audience 分配与 GMV 归因的全流程逻辑。

**核心变更（v3.3）**：
- **频控品类比较修正**：`checkConflicts` 全部改用 `isSameCategoryFamily`，修复别名族（声乐↔国际声乐）和等级变体（瑜伽S↔瑜伽）的频控漏控问题。
- **Round 2 真正复用**：`pickBest` 增加 `allowReuse` 参数，允许已分配但 `assignedDates.length === 1` 且 `daysBetween >= 3` 的段进入候选池。
- **`tryAssign` 复用模式下跳过 transfer**：复用 = 同一段分配给多个直播，不是从原直播转移。
- **历史数据查找三级回退**：`findHistoricalStat` 支持精确 → `getCategoryFamily` → 最长子串匹配。
- **品类映射补全**：新增 `居家古法` → `古法居家养生` 别名，`normalizeCategory` 分隔符加入 `x`、`X`、`×`。

**前序变更（v3.2）**：
- 所有 real live 默认 `isCrossCategory: true`
- `pickBest` 5-family limit 使用 `getCategoryFamily` 计数
- `tryAssign` 硬 ceiling（2x target）+ split 保护（< 30% 跳过）
- 联合直播 `categories` 去重 + intra-week 3天频控

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
→ 目标曝光：`TARGET_EXPOSURE['A'] + TARGET_EXPOSURE['B'] * 0.5 = 220,000 + 75,000 = 295,000`

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

> 经验值：两个 A 级联合时，目标曝光落在 30–40 万区间，由公式自动计算。

---

## 5. 目标曝光与动态缩放（Target Exposure & Dynamic Scaling）

### 5.1 单直播目标曝光

| 评级 | 单直播目标曝光 |
|---|---|
| S | 350,000 |
| A | 220,000 |
| B | 150,000 |
| C | 120,000 |

联合直播目标 = 第一场子直播完整目标 + 后续子直播目标 × 0.5。

> 举例：逆龄女神瑜伽(A) + 五禽戏晨练(B) = 220,000 + 150,000×0.5 = **295,000**

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
3. Round 1：严格分配（每段只用一次，达 target 即止）
4. Round 2：复用填充（允许复用 Round 1 已用段，3天间隔 + assignedDates < 2）
5. Round 3：零曝光兜底（对仍无曝光的直播强制分配）
6. 验证与冲突检查
```

### 10.2 直播优先级排序（scored）

每场真直播按以下公式计算得分，按 score 降序排列：

```
score = GRADE_SCORE[grade] + slot_bonus + fake_hist_bonus + historical_gmv_bonus

GRADE_SCORE = {'S': 100, 'A': 70, 'B': 40, 'C': 20, null: 10}
slot_bonus:   evening +50, morning +30, other +10
fake_hist_bonus: fakeLiveHistory.conversionRate × 100
historical_gmv_bonus: min(avgGMV / 20,000, 5)   // 封顶 +5，避免过度偏离
```

**排序结果**：真直播 S > 真直播 A/B/C > 伪直播。历史产值高的直播获得额外加分，优先获得 audience 分配。

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
| 2 | 状态可用 | Round 1：`seg.status !== 'used'` 且未被伪直播全局剔除。Round 2：`seg.status === 'available' && isSegmentUnused` 或 `seg.status === 'used' && isSegmentReusable(seg, live.date)` |
| 3 | 次数限制 | `assignedDates.length < 2` |
| 4 | 当日去重 | `live.date not in assignedDates` |
| 5 | 3天间隔 | 若 `assignedDates.length === 1`，则 `daysBetween(assignedDates[0], live.date) >= 3` |
| 6 | 非同品类族 | `!isSameCategoryFamily(seg.category, excludedCat)`。联合直播排除所有子品类；单直播排除自身品类 |

### 10.5 候选排序（7级优先级）

对通过过滤的候选段按以下优先级降序排列：

1. **同品类族优先**（垂类 audience 无需跨科，crossRate = 1.0）
   - 同品类族排最前，优先使用垂类存量。

2. **已分配品类去重**（强制分散搭配）
   - 若某品类已在该直播的 `assignedAudiences` 中，降低其优先级，避免同一品类重复选取。

3. **已分配 timeRange 去重**
   - 若某时间范围已在该直播的 `assignedAudiences` 中，降低其优先级，进一步分散 cohort。

4. **超大段降权**
   - 若 `seg.count > baseTarget × 0.6`，降低优先级，避免 greedy 独吞大池。

5. **已学习的规则匹配优先**
   - 统计 `learnedRules` 中匹配 `(live.category, seg.category)` 的规则数量，匹配越多优先级越高。

6. **预估 GMV 降序（历史数据口径）**
   - **有历史数据时**：`count × (avgGMV / avgExposure)`，即每触达一人的历史产值效率。
   - **无历史数据时回退**：`count × crossRate × LTV`。

7. **count 降序**
   - 最后按 audience 段人数降序，大段优先。

### 10.6 分配轮次

#### Round 1：目标保底分配

- 只选取 `assignedDates.length === 0` 的段（从未被分配过的段）。
- 按直播优先级遍历：对每个直播，取排序后的第一个候选段，执行分配。
- `maxCount = target - live.exposure`，防止单轮超过 target。
- 循环直到没有直播能获得新的候选段。
- **分配后不 splice**：已用段保留在 `linePools` 中，供 Round 2 复用。

#### Round 2：复用填充（v3.3 核心修正）

- **允许复用**：`pickBest(..., allowReuse=true)` 允许 `status === 'used'` 但 `assignedDates.length === 1` 且 `daysBetween >= 3` 的段进入候选池。
- `tryAssign(..., allowReuse=true)` **跳过 transfer 逻辑**：不从原直播移除该段，真正共享。
-  Ceiling：`live.exposure >= target * 2` 的直播跳过。
- 按直播优先级 round-robin 遍历。
- **splice 条件**：只有当 `assignedDates.length >= 2`（不可再复用）时才从 `linePools` 剔除。

#### Round 3：零曝光兜底

- 对 `exposure === 0` 的直播强制分配。
- 先尝试 unused 段（`pickBest`，非复用模式）。
- 再尝试 reusable 段（直接从 `audienceSegments.value` 筛选）。
- `tryAssign(..., allowReuse=true)` 跳过 transfer。

### 10.7 停止条件与超额分配

- **单轮停止**：每场直播分配 audience 直到达到目标曝光的 **130%** 后停止。
- **130% 目的**：强制分散搭配多个段，确保每场直播能分配到 2–4 个段，而不是 1 个大段独吞。
- **最终验证**：排期完成后自动运行 `validateSchedule()` 检查冲突（3天间隔、当日去重、同品类族等）。

### 10.8 分配后更新

每次分配后更新：
- `live.exposure += seg.count`
- `live.assignedAudiences.push(aud)`
- `seg.status = 'used'`（首次分配）或保持 `'used'`（复用分配）
- `seg.assignedTo = live.id`（首次分配）或 **不覆盖**（复用分配）
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

**自动排期时的应用**：在 `getCandidates()` 的 7 级排序中，第 5 级为「已学习的规则匹配优先」：匹配规则越多，候选 audience 的优先级越高。

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

## 14. 导出格式

导出 Excel 包含以下列：
- 日期、时段、直播名称、品类、线级、评级、类型
- 目标曝光、实际曝光
- 分配人群-品类、分配人群-进量时间段、分配人群-人数

联合直播的每个 audience 段单独一行，首行填充直播信息。

时间段合并显示：同一品类的多个段合并为合并后的时间跨度（如 `2023年1月—2026年5月10日`）。

---

## 15. 版本变更记录

| 版本 | 日期 | 变更内容 |
|---|---|---|
| v1.0 | 2026-05-07 | 初始排期逻辑：独立直播解析、同线分配、子串匹配同品类族 |
| v2.0 | 2026-05-08 | **联合直播模型**、严格同品类族（`normalizeCategory` 严格相等）、跨线规则（beauty→health 仅限中性品类）、伪直播处理、时间段合并 |
| v2.1 | 2026-05-09 | **联合直播目标修正**（第一场完整 + 后续 × 0.5）；**完成版排期解析**；autoSchedule 校准（7级排序 + 130% 目标超额分配） |
| v2.2 | 2026-05-11 | **规则学习智能体**、Cloud Sync、严格频控实现（`assignedDates` 机制）、总触达排除伪直播 |
| v3.0 | 2026-05-12 | **历史数据归因模型**：4月直播明细表解析、动态目标缩放（20–25w）、统一历史路径归因、历史等级推荐（历S/A/B/C）、autoSchedule 历史 GMV 权重与历史 ROI 排序 |
| v3.1 | 2026-05-13 | **修复数字解析**：支持 `¥35,000`、`12,500` 等带货币符号/千分位逗号格式；**扩充直播排期规则章节** |
| v3.2 | 2026-05-14 | **所有 real live 默认 isCrossCategory: true**；`pickBest` 5-family limit 使用 `getCategoryFamily` 计数；`tryAssign` 硬 ceiling（2x target）+ split 保护（< 30% 跳过）；联合直播 `categories` 去重 + intra-week 3天频控 |
| **v3.3** | **2026-05-15** | **`checkConflicts` 频控品类比较改用 `isSameCategoryFamily`**（修复别名族/等级变体漏控）；**Round 2 真正复用**：`pickBest` 支持 `allowReuse`，`tryAssign` 复用模式跳过 transfer；**历史数据查找三级回退**（`findHistoricalStat`）；**品类映射补全**（`居家古法` 别名、`x/X/×` 分隔符） |

---

## 16. 待决策/待优化项

1. **历史数据趋势分析**：当前仅使用单月销量均值，未来可扩展为多月销量趋势（如近 3 个月滚动平均）。
2. **规则学习效果评估**：当前规则仅影响排序优先级，尚未量化规则对 GMV 的实际提升效果。
3. **多周排期批量管理**：当前为单周排期，未来可支持多周批量上传与对比。
4. **完成版排期直接回写**：当前完成版排期可正确解析并显示，但尚未支持将手动调整后的结果导出为新的"正确版排期"格式。
