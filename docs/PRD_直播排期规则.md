# 直播排期规则 PRD

> 版本：v3.0
> 日期：2026-05-12
> 适用范围：5月W2（5.11–5.17）及后续周次
> 关联脚本：`schedule_solver.py`、`live-schedule-dashboard`

---

## 1. 概述

本规则定义从 Excel 排期表、audience 量级表、跨科偏好表、**4月直播明细表**到最终 audience 分配与 GMV 归因的全流程逻辑。

**核心变更（v3.0）**：
- 引入 **4 月直播明细表**作为历史实际数据校准源，替代原有的纯理论 `crossRate × LTV` 归因模型。
- 新增 **动态目标缩放机制**：每周总预估 GMV 强制收敛到 20–25w 区间，单场 GMV 按品类历史均值线性等比缩放。
- 新增 **历史等级推荐**：基于品类历史 avgGMV 的四分位数自动建议 S/A/B/C 等级（历S/历A/历B/历C）。
- 自动排期排序引入 **历史产值权重** 和 **历史 ROI 排序**，高历史产值直播优先获得 audience。

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
| 公开课名称 | 品类 | 直播状态名称 | 是否新用户测试直播 | 曝光人数 | 总gmv | 首单贡献占比 | 首单订单数 | 首单转化率 |
```

**过滤口径**：
- 剔除 `是否新用户测试直播 = '是'` 的行（新量测试直播数据不纳入日常排期参考）。
- 剔除 `直播状态名称 = '回放'` 的行。
- 品类映射：优先使用明细表中的「品类」列；若为空，从「公开课名称」推断。

**统计指标（按标准品类聚合）**：
- `avgGMV`：该品类过滤后直播的 `总gmv` 平均值。
- `avgExposure`：该品类过滤后直播的 `曝光人数` 平均值。
- `avgFirstOrders`：该品类过滤后直播的 `首单订单数` 平均值。
- `avgConversionRate`：该品类过滤后直播的 `首单转化率` 平均值。
- `avgContributionRatio`：该品类过滤后直播的 `首单贡献占比` 平均值。
- `count`：该品类过滤后直播的场次数。

---

## 3. 直播解析规则

### 3.1 早间晨练（row 2）
- **同单元格内多行直播名 = 一场联合直播**，共享 audience 池。
- 多行以换行符 `\n` 分隔，过滤掉时间、备注、空行。
- 提取所有子品类：`name.replace('晨练', '').strip()`。

### 3.2 晚间专场（row 7 / row 13）
- 每行独立为一场单直播。
- 通过关键词或前缀推断品类（如"短视频"、"手机摄影"、"朗诵"）。

### 3.3 完成版排期解析（运营确认排期表）
- 完成版排期表在直播名下方以多行形式嵌入 audience 分配数据。
- 健康线 / 变美线 / 兴趣线 audience 分配可能跨多行，只有首行带线级标签，后续行标签为空。
- 解析器需连续收集同一线级的所有行，按列合并后提取 `(品类, 人数, 时间范围)`。
- 跳过 Excel 时间数字（如 `0.291666666666667`）、纯标签行（如 `【晚间】`）、资源位标注（如 `不回捞`）。

### 3.4 伪直播复用（row 19）
- 伪直播标注的是 **上周实际使用的 audience**，本周仅作记录和全局剔除。
- 伪直播本身 **本周不分配任何新 audience**。

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

匹配优先级：
1. 精确匹配标准名
2. 精确匹配别名
3. 提取分隔符前前缀匹配（`-`、`—`、`|`、`·`、`•`）
4. 最长子串匹配标准名
5. 最长子串匹配别名

### 6.2 同品类族判断

**规则**：只有当 `normalizeCategory(a) === normalizeCategory(b)` **严格相等**时，才算同品类族。

**已废弃**：子串匹配、家族关键词匹配、前缀包含匹配均不再适用。

**典型反例**：
- `君合太极` ≠ `太极BCD`
- `一杰瑜伽` ≠ `瑜伽BCD`
- `体态塑形瑜伽` ≠ `瑜伽SA`
- `普拉提BCD` 是独立标准品类 ≠ `普拉提`

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

| 规则 | 说明 |
|---|---|
| 3 天间隔 | 同一 audience 段两次分配间隔 `>= 3` 天 |
| 一周最多 2 次 | 同一 audience 段一周内最多被分配 `2` 场直播 |
| 当日去重 | 同一天同一 audience 段只能分配给 **一场** 直播 |
| 跨科直播不能宣发同品类族 | `isCrossCategory === true` 时不能分配同品类族 audience |

---

## 10. 自动排期算法

### 10.1 直播优先级排序

```
score = GRADE_SCORE[grade] + slot_bonus + fake_hist_bonus + historical_gmv_bonus
GRADE_SCORE = {'S': 100, 'A': 70, 'B': 40, 'C': 20, null: 10}
slot_bonus: evening +50, morning +30, other +10
fake_hist_bonus: fakeLiveHistory.conversionRate × 100
historical_gmv_bonus: min(avgGMV / 20,000, 5)   // 封顶 +5，避免过度偏离
```

按 score 降序排列：真直播 S > 真直播 A/B/C > 伪直播。**历史产值高的直播获得额外加分**，优先获得 audience 分配。

### 10.2 伪直播预处理
- 标记 excluded audiences 为全局已使用。
- 伪直播 `assignedAudiences = []`，`exposure = 0`。

### 10.3 候选池过滤
对每场真直播，从可用 audience 段中筛选：

1. **线级匹配**：`seg.line in allowed_lines`
   - 联合直播：`allowed_lines = set(live.lines)`
   - 中性品类单直播（beauty）：`allowed_lines = {'beauty', 'health'}`
   - 其他单直播：`allowed_lines = {live.line}`
2. **状态可用**：`seg.status != 'used'`
3. **次数限制**：`len(seg.assigned_dates) < 2`
4. **当日去重**：`live_day not in seg.assigned_dates`
5. **3天间隔**：`all(abs(live_day - d) >= 3 for d in seg.assigned_dates)`
6. **非同品类族**：`not any(isSameCategoryFamily(seg.category, cat) for cat in excluded_cats)`
   - 联合直播：`excluded_cats = set(live.categories)`
   - 单直播：`excluded_cats = {live.category}`

### 10.4 候选排序与分配

排序优先级（7级，高到低）：
1. **同品类族优先**（垂类 audience 无需跨科，crossRate = 1.0）
2. **已分配品类去重**（避免同一品类重复选取，强制分散搭配）
3. **已分配 timeRange 去重**（同一时间段只选一次，进一步分散）
4. **超大段降权**（超过目标 60% 的段降低优先级，避免 greedy 独吞大池）
5. **已学习的规则匹配优先**（用户手动确认过的搭配，详见 §11）
6. **预估 GMV 降序（历史数据口径）**：
   - **有历史数据时**：`count × (avgGMV / avgExposure)`，即每触达一人的历史产值效率
   - **无历史数据时回退**：`count × crossRate × LTV`
7. **count 降序**

**停止条件**：达到目标曝光的 **130%** 后停止，确保每场直播能分配到 2–4 个段，而不是 1 个大段就结束。

分配后更新 segment 的 `assigned_dates`。

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
| **v3.0** | **2026-05-12** | **历史数据归因模型**：4月直播明细表解析、动态目标缩放（20–25w）、统一历史路径归因、历史等级推荐（历S/A/B/C）、autoSchedule 历史 GMV 权重与历史 ROI 排序 |

---

## 16. 待决策/待优化项

1. **历史数据趋势分析**：当前仅使用单月销量均值，未来可扩展为多月销量趋势（如近 3 个月滚动平均）。
2. **规则学习效果评估**：当前规则仅影响排序优先级，尚未量化规则对 GMV 的实际提升效果。
3. **多周排期批量管理**：当前为单周排期，未来可支持多周批量上传与对比。
4. **完成版排期直接回写**：当前完成版排期可正确解析并显示，但尚未支持将手动调整后的结果导出为新的"正确版排期"格式。
