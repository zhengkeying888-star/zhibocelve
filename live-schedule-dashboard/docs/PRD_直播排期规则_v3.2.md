# 直播排期规则 PRD

> 版本：v3.2
> 日期：2026-05-15
> 适用范围：5月W2（5.11–5.17）及后续周次
> 关联仓库：`live-schedule-dashboard`
>
> **本版本核心修正**：
> - 彻底移除伪直播 audience 的「全局剔除」表述，明确其仅参与 3天/30天 频控，可被其他真直播复用。
> - 同品类族判断引入 `getCategoryFamily`，支持 audience 等级变体（瑜伽S/A/BCD → 瑜伽）与别名族（声乐 → 国际声乐）。
> - autoSchedule 明确为**配额制 + 三段式分配**，删除复用轮次与强制填满轮次，单场分配通过 `tryAssign` 实时截断。
> - Parser 动态 `startCol` 写入正式规则。

---

## 1. 概述

本规则定义从 Excel 排期表、audience 量级表、跨科偏好表、**4月直播明细表**到最终 audience 分配与 GMV 归因的全流程逻辑。

**核心变更（v3.2）**：
- **同品类族定义精确化**：引入品类族（family）概念，audience 等级变体统一映射到基族；live 品类保持独立。
- **伪直播规则澄清**：`type === 'fake' && assignedAudiences.length > 0` 的 audience **不**全局剔除，仅通过 `checkConflicts` 参与 3天/30天 频控校验，可被其他真直播在符合频控条件时分配。
- **autoSchedule 配额制固化**：每场直播配额 = `(TARGET_EXPOSURE[grade] / 所有直播 target 之和) × 总库存`。`tryAssign` 内部实时截断，超配额 segment 自动拆分。
- **三段式分配**：Round 1（严格单次分配）→ Round 2（剩余未分配段二次分配，仍受配额限制）→ Round 3（零触达保底）。**删除复用轮次与强制填满轮次**。
- **Parser 动态 startCol**：day columns 起始列根据 headerRow[1] 和 dateRow[1] 是否有内容自动判定为 col=1 或 col=2。

---

## 2. 数据输入

| 文件 | 必填 | 说明 |
|---|---|---|
| 排期表（含伪直播历史 audience） | 是 | 真直播、伪直播、联合直播的原始排期 |
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

**数字清洗（v3.1 新增）**：
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
|      | ...（同上） |
| 伪直播复用 | ... |
| 朋友圈宣发 | ... |
```

### 3.2 Parser 动态列起始（startCol）

**规则**：day columns（周一到周日）的起始列不固定，必须动态检测。

**检测逻辑**：
```typescript
const startCol = (normCell(headerRow[1]) !== '' && normCell(dateRow[1]) !== '') ? 1 : 2
```

- 若 `headerRow[1]` 和 `dateRow[1]` 均非空 → day columns 从 **col=1** 开始。
- 否则 → day columns 从 **col=2** 开始。

**所有循环硬编码 `col = 2` 必须替换为 `col = startCol`**，`weekDays[col - 2]` 必须替换为 `weekDays[col - startCol]`。

### 3.3 早间晨练（联合直播）

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

### 3.4 晚间专场（单直播）

**规则**：每行独立为一场单直播。

**解析细节**：
1. 每行提取为一个独立直播场次。
2. 品类推断：通过关键词或前缀推断（如"短视频"→`短视频`，"手机摄影"→`手机摄影`）。
3. 如果行中包含 `开播时间：XX:XX-XX:XX`，提取为 `startTime`。
4. 不属于联合直播，不共享 audience 池。
5. **`isCrossCategory` 默认为 `true`**：当前业务场景下所有单直播均为跨科直播，不允许宣发同品类族 audience。

### 3.5 伪直播复用

**规则**：伪直播分两种状态，必须严格区分：

#### 状态 A：有 assignedAudiences（【上次直播排期】/【存量】）
- 这些 audience 是**历史已使用人群**，本周**不为其分配新 audience**。
- **关键**：这些 audience **不**全局标记为 `used`（`seg.status = 'used'`），而是保留在 `live.assignedAudiences` 中。
- 它们通过 `checkConflicts` 中的 `combinedHistory` 参与 **3天/30天 频控校验**：其他真直播在分配同品类同时间范围 audience 时，若与伪直播历史日期间隔 < 3天，会被频控拦截。
- 这些 audience **可以**被其他真直播在符合频控条件时分配（即非全局剔除）。

#### 状态 B：无 assignedAudiences
- 视为本周正常排期的伪直播，按普通逻辑分配 audience（但通常 exposure=0，不做新分配）。

**解析细节**：
1. 伪直播单元格中的 `【上次直播排期】` / `【存量】` audience 数据被提取为 `fakeLiveHistory`。
2. `extractFakeHistoryFromCell` 和 `parseAudienceAssignmentBlock` 必须同时识别 `【上次直播排期】` 和 `【存量】` 关键字。
3. 若 `【上次直播排期】` 的 audience 数据出现在直播信息行之前（排期表顺序不固定），`parseAudienceAssignmentBlock` 会自动创建一个 `type: 'fake'` 的占位直播对象接收这些数据。
4. 30天内不能对同一伪直播再次复用同一 audience 段（`daysBetween(fakeHistory.date, live.date) <= 30` 时拦截）。

### 3.6 完成版排期解析（运营确认排期表）

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

### 3.7 朋友圈宣发

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

### 5.2 动态目标缩放（v3.0 新增）

**背景**：不同周次的排期品类组合不同，按历史 avgGMV 直接加总可能导致周总预估偏离 20–25w 运营目标区间。

**计算步骤**：
1. **原始预估** `weeklyRawTarget = Σ(当周各 real live 对应品类的 avgGMV)`
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
1. 精确匹配标准名（69 个标准品类）
2. 精确匹配别名（150+ 个别名映射）
3. 提取分隔符前前缀匹配（`-`、`—`、`|`、`·`、`•`）
4. 最长子串匹配标准名
5. 最长子串匹配别名

**关键标准品类**：
- **健康线**：健康营养、太极、五禽戏、睡眠调理、气血调理、固气活血、君合太极、开心太极、内养太极、云帆太极、东方食养、古法居家养生、华佗肩颈舒活功、健康家厨、健康食养、儿童健康、食养助长、体质食养、易筋经、营养调理、中式美食制作、轻训营、亚健康管理、私域
- **变美线**：普拉提、瑜伽、中医变美、穿搭、懒人吃瘦、面部瑜伽驻颜、逆龄女神瑜伽、逆龄普拉提、女性保养瑜伽、东方养正瑜伽、塑形流瑜伽、体态、体态塑形瑜伽、形体芭蕾、养正变美、一杰瑜伽、正位塑形瑜伽、瑜伽会员
- **兴趣线**：手机摄影、摄影美学、唱歌、短视频、风光摄影、相机摄影、声乐、国际声乐、电子琴、键盘乐、真书法、油画、国画1、国学朗诵、戏曲、舞蹈、优雅舞蹈、茶道、编织工艺美学、钩针编织美学、美学收纳

### 6.2 品类族（Category Family）

**核心原则**：
- **Audience 品类**（来自 audience 量级表）有等级变体，需映射到基族。
- **Live 品类**（来自排期表）保持独立的规范化名，**不**映射到基族。
- **判断同族时**：两边都经过 `getCategoryFamily` 映射后再比较。

**`getCategoryFamily` 映射规则**：

1. **备注后缀剥离**：`普拉提S【剔除庭香】` → `普拉提S`
2. **Audience 等级变体映射到基族**：
   - `瑜伽S` / `瑜伽A` / `瑜伽BCD` → `瑜伽`
   - `普拉提S` / `普拉提A` / `普拉提BCD` → `普拉提`
   - `太极s` / `太极A` / `太极BCD` → `太极`
   - `手机摄影SA` / `手机摄影BCD` → `手机摄影`
3. **别名族映射**：
   - `声乐` → `国际声乐`
4. **其他**：保持规范化后的标准名不变。

**`isSameCategoryFamily(a, b)`**：
```typescript
return getCategoryFamily(a) === getCategoryFamily(b)
```

**典型示例**：
| 输入 A | 输入 B | 结果 | 说明 |
|---|---|---|---|
| 瑜伽S | 瑜伽 | ✅ 同族 | audience 等级变体映射到基族 |
| 普拉提A | 普拉提BCD | ✅ 同族 | 同族不同等级 |
| 太极BCD | 太极 | ✅ 同族 | audience 等级变体映射 |
| 声乐 | 国际声乐 | ✅ 同族 | 别名族映射 |
| 一杰瑜伽 | 瑜伽 | ❌ 不同族 | live 品类保持独立 |
| 君合太极 | 太极 | ❌ 不同族 | live 品类保持独立 |
| 体态塑形瑜伽 | 瑜伽 | ❌ 不同族 | live 品类保持独立 |
| 睡眠 | 睡眠调理 | ✅ 同族 | normalizeCategory 已做别名映射 |

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

**同线优先原则**：中性品类直播在 `getCandidates` 返回前，先过滤同线候选池；只有同线候选耗尽后才允许跨线。

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
| **当日去重** | 同一天同一个 audience 段只能分配给 **一场** 直播 | `live.date not in assignedDates` |
| **3 天间隔** | 同一 audience 段两次分配间隔 `>= 3` 天 | `daysBetween(assignedDates[0], live.date) >= 3` |
| **一周最多 2 次** | 同一 audience 段一周内最多被分配 `2` 场直播 | `assignedDates.length < 2` |
| **跨科直播不能宣发同品类族** | `isCrossCategory === true` 时不能分配同品类族 audience | `!isSameCategoryFamily(seg.category, live.category)` |
| **30 天伪直播复用** | 伪直播自身的 audience 段 30 天内不能被再次复用到**同一伪直播** | `daysBetween(fakeHistory.date, live.date) > 30`（仅 `live.type === 'fake'` 时检查） |
| **自动复用条件** | 系统在 Round 3 可自动将已用一次的段分配给第二场直播 | `assignedDates.length === 1` + `daysBetween >= 3` + `crossRate >= 0.1%` |

**重要澄清（v3.2）**：
- 伪直播的 `assignedAudiences`（【上次直播排期】/【存量】）**不**触发全局 `seg.status = 'used'`。
- 这些 audience 段在 `checkConflicts` 中通过 `combinedHistory` 参与 3天频控和 30天伪直播频控，但**可以被其他真直播分配**（只要满足 3天间隔等硬规则）。
- `sameWeek` 检查（当日去重）**排除** `type === 'fake'` 的直播，避免伪直播历史 audience 导致 false positive。
- **自动复用不等于强制填满**：复用仅在 `crossRate >= REUSE_MIN_CROSS_RATE`（默认 0.1%）时触发，低跨科率段不会被自动复用。

---

## 10. 自动排期算法（Auto-Scheduling Engine）

### 10.1 整体流程

```
1. 重置所有 segment 为 available（清除 status / assignedTo / assignedDates）
2. 重置所有真直播的 assignedAudiences / exposure / conflictReasons
3. 保留有 assignedAudiences 的伪直播（不清除其历史 audience）
4. Round 1：严格分配（每段只用一次，target 截断）
5. Round 2：剩余未分配段二次分配（target 截断）
6. Round 3：复用分配（3日频控 + 高跨科率，cap 截断）
7. Round 4：保底（零触达直播至少获得一段）
8. 验证与冲突检查
```

**核心约束**：
- **单场上限**：每场直播的 exposure 上限 = `TARGET_EXPOSURE[grade] × 1.3`。Round 1/2 截断在 target，Round 3/4 截断在 130% cap。
- **复用受控**：自动复用仅在 Round 3 发生，且必须满足 `crossRate >= REUSE_MIN_CROSS_RATE`（默认 0.1%）。
- **总量自然收敛**：总触达 `totalAssigned` 通过复用可以 **≥ 总库存 `totalInventory`**，但受单场上限约束，不会无限膨胀。

### 10.2 单场截断与上限

**Target**：各等级直播的目标曝光量（S=350k, A=220k, B=150k, C=120k）。
**Cap**：`TARGET_EXPOSURE[grade] × 1.3`，单场 hard ceiling，防止任何直播爆表。

```typescript
function getTarget(live: LiveStream): number {
  return TARGET_EXPOSURE[live.grade || 'C'] || 120000
}
function getCap(live: LiveStream): number {
  return Math.round(getTarget(live) * 1.3)
}
```

**作用**：
- Round 1/2 以 `target` 为截断点，确保每场直播**至少达标**。
- Round 3/4 以 `cap` 为截断点，允许通过复用略超目标，但**不超过 130%**。
- 彻底废除 weight-based 配额制（旧 quota = (target/sum(targets)) × inventory 会导致低等级直播 quota 远超 target）。

### 10.3 直播优先级排序（scored）

每场真直播按以下公式计算得分，按 score 降序排列：

```
score = GRADE_SCORE[grade] + slot_bonus + fake_hist_bonus + historical_gmv_bonus

GRADE_SCORE = {'S': 100, 'A': 70, 'B': 40, 'C': 20, null: 10}
slot_bonus:   evening +50, morning +30, other +10
fake_hist_bonus: fakeLiveHistory.conversionRate × 100
historical_gmv_bonus: min(avgGMV / 20,000, 5)   // 封顶 +5，避免过度偏离
```

按 score 降序排列：真直播 S > 真直播 A/B/C > 伪直播。历史产值高的直播获得额外加分，优先获得 audience 分配。

### 10.4 tryAssign 实时截断与段拆分

```typescript
function tryAssign(live: LiveStream, seg: AudienceSegment, maxCount?: number): boolean {
  if (seg.status !== 'available') return false
  const desiredCount = Math.min(seg.count, maxCount ?? seg.count)
  if (desiredCount <= 0) return false

  // Split segment if we only need a portion
  if (desiredCount < seg.count) {
    const remaining: AudienceSegment = {
      id: generateId(),
      line: seg.line,
      category: seg.category,
      timeRange: seg.timeRange,
      count: seg.count - desiredCount,
      status: 'available',
      assignedDates: seg.assignedDates ? [...seg.assignedDates] : [],
    }
    audienceSegments.value.push(remaining)
    seg.count = desiredCount
  }

  // Defensive: if segment already assigned to another live, remove it first
  if (seg.assignedTo && seg.assignedTo !== live.id) {
    // ...transfer cleanup...
  }

  // Assign
  live.assignedAudiences.push({...})
  live.exposure += seg.count
  seg.status = 'used'
  seg.assignedTo = live.id
  seg.assignedDates.push(live.date)
  return true
}
```

**关键行为**：
- `maxCount` 来自 `target - live.exposure`（Round 1/2）或 `cap - live.exposure`（Round 3/4），单场分配**不可能超过上限**。
- 若 segment 大于 `maxCount`，自动拆分出剩余段并重新推入 `audienceSegments.value`。
- 转移防御：若 segment 已分配给其他直播，先 remove 再 assign，同步更新 `assignedDates`。

### 10.5 候选池过滤

对每场真直播，从可用 audience 段中筛选候选池：

| 步骤 | 条件 | 说明 |
|---|---|---|
| 1 | 线级匹配 | `seg.line in allowed_lines`。联合直播取 `set(live.lines)`；中性品类取 `{'beauty', 'health'}`；其他取 `{live.line}` |
| 2 | 状态可用 | `seg.status === 'available'` |
| 3 | 次数限制 | `assignedDates.length < 2` |
| 4 | 当日去重 | `live.date not in assignedDates` |
| 5 | 3天间隔 | 若 `assignedDates.length === 1`，则 `daysBetween(assignedDates[0], live.date) >= 3` |
| 6 | 非同品类族 | `!isSameCategoryFamily(seg.category, excludedCat)`。联合直播排除所有子品类；单直播排除自身品类（因 `isCrossCategory === true`） |

### 10.6 候选排序（7级优先级 + 同线优先）

对通过过滤的候选段按以下优先级降序排列：

**第 0 级：同线优先**
- `seg.line === live.line` 的段排前面。
- 对中性品类，此级在 `getCandidates` 返回前强制过滤：若同线候选存在，**只返回同线候选**。

**第 1 级：同品类族优先**（垂类，crossRate = 1.0）
- 同品类族排最前，优先使用垂类存量。

**第 2 级：已分配品类去重**（强制分散搭配）
- 若某品类已在该直播的 `assignedAudiences` 中，降低其优先级，避免同一品类重复选取。

**第 3 级：已分配 timeRange 去重**
- 若某时间范围已在该直播的 `assignedAudiences` 中，降低其优先级，进一步分散 cohort。

**第 4 级：超大段降权**
- 若 `seg.count > baseTarget × 0.6`，降低优先级，避免 greedy 独吞大池。

**第 5 级：已学习的规则匹配优先**
- 统计 `learnedRules` 中匹配 `(live.category, seg.category)` 的规则数量，匹配越多优先级越高。

**第 6 级：预估 GMV 降序（历史数据口径）**
- **有历史数据时**：`count × (avgGMV / avgExposure)`，即每触达一人的历史产值效率。
- **无历史数据时回退**：`count × crossRate × LTV`。

**第 7 级：count 降序**
- 最后按 audience 段人数降序，大段优先。

### 10.7 分配轮次

#### Round 1：严格分配

- 只选取 `assignedDates.length === 0` 的段（从未被分配过的段）。
- 按直播优先级遍历：对每个直播，取排序后的第一个候选段。
- **截断**：`maxCount = max(0, target - live.exposure)`，`tryAssign` 内部按 `maxCount` 截断。
- 循环直到没有直播能获得新的候选段。
- **目的**：优先保证每段 audience 只被使用一次，最大化覆盖不同存量池，且单场不超过 target。

#### Round 2：剩余段二次分配

- 遍历所有 `status === 'available'` 且 `assignedDates.length === 0` 的段（严格剩余段）。
- 对每个剩余段，找出所有可接收的直播（满足线级、品类族、次数限制、target 有剩余）。
- 按等级降序、当前 exposure 升序排序，将段分配给最优先且最缺曝光的直播。
- **截断**：`maxCount = target - live.exposure`，单场不超 target。
- **目的**：将 Round 1 遗漏的段（如因排序靠后未轮到的段）合理分配出去，帮助未达标直播触达 target。

#### Round 3：复用分配（Reuse Refill）

- 仅对 `exposure < cap` 的直播允许复用。
- 候选条件：
  1. `assignedDates.length === 1`（已被使用过一次）
  2. `daysBetween(assignedDates[0], live.date) >= 3`（3天频控，由 `getCandidates` 保证）
  3. `crossRate >= REUSE_MIN_CROSS_RATE`（默认 0.1%，历史跨科率高）
- 按直播优先级遍历，继续分配直到没有符合条件的候选段。
- **截断**：`maxCount = cap - live.exposure`，单场不超 130% cap。
- **目的**：通过高跨科率复用，让总触达接近或超过总库存，同时保证单场可控。

#### Round 4：保底分配

- 找出所有 `exposure === 0` 的真直播。
- 对每个零触达直播，在 `status === 'available'` 且 `assignedDates.length === 0` 的段中找候选。
- 按同样过滤规则筛选，取第一个候选分配。
- **截断**：`maxCount = cap - live.exposure`。
- **目的**：确保每场真直播至少获得一个 audience 段，避免完全空播。

### 10.8 停止条件与超额分配

- **单轮停止**：每场直播分配 audience 直到达到目标曝光的 **130%** 后停止。
- **130% 目的**：强制分散搭配多个段，确保每场直播能分配到 2–4 个段，而不是 1 个大段独吞。
- **Cap 兜底**：即使 130% 未触发，`cap = target × 1.3` 通过 `maxCount` 硬截断单场分配量。
- **总量自然收敛**：由于 Round 3 复用受 `crossRate` 阈值限制，总触达不会无限制膨胀，通常落在 `totalInventory` 至 `1.3 × sum(targets)` 之间。
- **最终验证**：排期完成后自动运行 `validateSchedule()` 检查冲突（3天间隔、当日去重、同品类族等）。

### 10.9 分配后更新

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

**自动排期时的应用**：在 `getCandidates()` 的 7 级排序中，第 5 级为「已学习的规则匹配优先」：匹配规则越多，候选 audience 的优先级越高。

---

## 12. 归因计算（v3.0 历史数据口径）

### 12.1 统一历史路径（核心变更）

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

## 13. 历史等级推荐（v3.0 新增）

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

---

## 15. 版本变更记录

| 版本 | 日期 | 变更内容 |
|---|---|---|
| v1.0 | 2026-05-07 | 初始排期逻辑：独立直播解析、同线分配、子串匹配同品类族 |
| v2.0 | 2026-05-08 | **联合直播模型**、严格同品类族（`normalizeCategory` 严格相等）、跨线规则（beauty→health 仅限中性品类）、伪直播处理、时间段合并 |
| v2.1 | 2026-05-09 | **联合直播目标修正**（第一场完整 + 后续 × 0.5）；**完成版排期解析**；autoSchedule 校准（7级排序 + 130% 目标超额分配） |
| v2.2 | 2026-05-11 | **规则学习智能体**、Cloud Sync、严格频控实现（`assignedDates` 机制）、总触达排除伪直播 |
| v3.0 | 2026-05-12 | **历史数据归因模型**：4月直播明细表解析、动态目标缩放（20–25w）、统一历史路径归因、历史等级推荐（历S/A/B/C）、autoSchedule 历史 GMV 权重与历史 ROI 排序 |
| v3.1 | 2026-05-13 | **修复数字解析**：支持 `¥35,000`、`12,500` 等带货币符号/千分位逗号格式；**扩充直播排期规则章节**（细化早间/晚间/伪直播/朋友圈解析规则） |
| **v3.2** | **2026-05-15** | **同品类族定义精确化**：引入 `getCategoryFamily`，支持 audience 等级变体映射与别名族；**伪直播规则澄清**：移除「全局剔除」表述，明确仅参与频控；**autoSchedule 目标-cap 制**：废除 weight-based quota，改为 `target`（100%）+ `cap`（130%）截断；**引入 Round 3 自动复用**：3日频控 + `crossRate >= 0.1%` 条件下允许复用，使 totalAssigned 可 ≥ totalInventory；**Parser 动态 startCol** 写入正式规则 |

---

## 16. 待决策/待优化项

1. **历史数据趋势分析**：当前仅使用单月销量均值，未来可扩展为多月销量趋势（如近 3 个月滚动平均）。
2. **规则学习效果评估**：当前规则仅影响排序优先级，尚未量化规则对 GMV 的实际提升效果。
3. **多周排期批量管理**：当前为单周排期，未来可支持多周批量上传与对比。
4. **完成版排期直接回写**：当前完成版排期可正确解析并显示，但尚未支持将手动调整后的结果导出为新的"正确版排期"格式。
