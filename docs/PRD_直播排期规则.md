# 直播排期规则 PRD

> 版本：v2.0  
> 日期：2026-05-08  
> 适用范围：5月W2（5.11–5.17）及后续周次  
> 关联脚本：`schedule_solver.py`

---

## 1. 概述

本规则定义从 Excel 排期表、audience 量级表、跨科偏好表到最终 audience 分配的全流程逻辑。核心目标是在满足所有硬约束的前提下，为每场直播（含联合直播）分配合适的 audience 段，并支持运营手动校准与规则沉淀。

---

## 2. 数据输入

| 文件 | 说明 |
|---|---|
| 排期表（含优先级与伪直播剔除） | 真直播、伪直播、联合直播的原始排期 |
| 确认排期表 | 运营确认的实际执行排期，用于提取伪直播 audience 与规则校验 |
| audience 量级表 | 各品类各时间段的存量用户数（含时间范围） |
| 跨科偏好表 | 品类→品类的 day60 跨科率、转化率、LTV（含 cohortMonth） |

---

## 3. 直播解析规则

### 3.1 早间晨练（row 2）
- **同单元格内多行直播名 = 一场联合直播**，共享 audience 池。
- 多行以换行符 `\n` 分隔，过滤掉时间、备注、空行。
- 提取所有子品类：`name.replace('晨练', '').strip()`。

### 3.2 晚间专场（row 7 / row 13）
- 每行独立为一场单直播。
- 通过关键词或前缀推断品类（如"短视频"、"手机摄影"、"朗诵"）。

### 3.3 伪直播复用（row 19）
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

## 5. 目标曝光（Target Exposure）

| 评级 | 单直播目标曝光 |
|---|---|
| S | 350,000 |
| A | 220,000 |
| B | 150,000 |
| C | 120,000 |

联合直播目标 = 第一场子直播完整目标 + 后续子直播目标 × 0.5。

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

---

## 10. 自动排期算法

### 10.1 直播优先级排序

```
score = GRADE_SCORE[grade] + slot_bonus
GRADE_SCORE = {'S': 100, 'A': 70, 'B': 40, 'C': 20}
slot_bonus: evening +50, morning +30
```

按 score 降序排列：真直播 S > 真直播 A/B/C > 伪直播。

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

当前策略：**按 `count` 降序贪婪选取**，直到达到目标曝光。

> **待优化**：当前策略倾向于单段独吞大池，部分场景下与运营手动分配的"混用小段"模式存在差异。后续需根据运营手动校准数据沉淀排序偏好（如：优先同品类族 > 跨品类族、控制单段上限、按预估 GMV 排序等）。

分配后更新 segment 的 `assigned_dates`。

---

## 11. 归因计算（cohort-aware）

对已分配的 audiences：

```
expectedLeads      = Σ(audience.count × crossRate)
expectedFirstOrders = Σ(expectedLeads × conversionRate)
expectedGMV        = Σ(expectedFirstOrders × ltv)
```

**匹配优先级**：
1. `fromCategory == audCat && toCategory == liveCat && cohortMonth == extractCohortMonth(aud.timeRange)`（精确匹配）
2. `fromCategory == audCat && toCategory == liveCat`（全量平均 fallback）
3. 默认 zero

---

## 12. 导出格式

导出 Excel 包含以下列：
- 日期、时段、直播名称、品类、线级、评级、类型
- 目标曝光、实际曝光
- 分配人群-品类、分配人群-进量时间段、分配人群-人数

联合直播的每个 audience 段单独一行，首行填充直播信息。

---

## 13. 版本变更记录

| 版本 | 日期 | 变更内容 |
|---|---|---|
| v1.0 | 2026-05-07 | 初始排期逻辑：独立直播解析、同线分配、子串匹配同品类族 |
| v2.0 | 2026-05-08 | **联合直播模型**：同单元格多行合并为一场共享 audience 池；**严格同品类族**：`normalizeCategory` 严格相等，移除子串/关键词匹配；**跨线规则**：beauty→health 仅限中性品类（一杰瑜伽、东方养正瑜伽），联合直播自然跨线；**伪直播处理**：确认为上周记录，本周全局剔除；**时间段合并**：保留合并逻辑，简化内容下发 |

---

## 14. 待决策/待优化项

1. **分配合理性**：当前按人数降序贪婪选取，部分场景下单段过大。需运营在确认排期基础上给出偏好（如：同品类族优先、 diversified 混合策略、单段上限比例）。
2. **规则学习**：拖拽/手动调整后沉淀为 `learnedRules`，用于下次 autoSchedule 调整排序权重。
3. **LTV/跨科率排序**：在人数排序基础上引入预估 GMV（crossRate × LTV）作为二级排序因子。
