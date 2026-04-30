# 设计文档：人工排期调适 + 按进量月份科学归因

## 背景

排期看板已完成 autoSchedule、归因看板、品类映射等基础功能。现需迭代两个核心能力：

1. **人工在自动排期后的调适**：运营需要评估 autoSchedule 结果是否合理，并能拖拽调整 audience 分配，同时让系统学习调整原因，沉淀为规则。
2. **归因数据的科学性**：当前 `crossCategoryPrefs` 丢失了 `转继承添加好友月份`（cohortMonth）维度，所有 audience 都套用同一个 crossRate/LTV，导致预估失真。需按 audience 的进量时间匹配对应月份的跨科数据。

---

## 1. 按进量月份科学归因

### 1.1 问题现状

- `parseCrossPrefSheet` 目前忽略第0列（`转继承添加好友月份`），只取 `fromCategory / toCategory / crossRate / ltv`。
- 同一个 `fromCategory -> toCategory` 在不同月份有多行数据，但全部平铺进数组，`.find()` 时匹配顺序不确定。
- `AudienceSegment` 有 `timeRange`（如 `"2025.1.12-2026.4.26"`），但没有用来匹配 cohort。

### 1.2 目标

归因计算时，根据 audience 的进量时间范围，匹配对应 cohortMonth 的 crossRate / conversionRate / LTV。

### 1.3 方案

#### 数据模型扩展

```typescript
// types/index.ts
export interface CrossCategoryPref {
  fromCategory: string
  toCategory: string
  toLine: LineType
  cohortMonth: string      // 新增：如 "2026-03"
  crossRate: number
  conversionRate: number
  ltv: number
}
```

#### Parser 修正（`src/utils/parser.ts`）

`parseCrossPrefSheet` 需要：
1. 读取第0列作为 `cohortMonth`
2. 解析 `跨科率_直播间` / `转化率_直播间` / `LTV_直播间` 优先；若直播间数据为0则同时保留 `导量` 数据用于 fallback（见 1.4）
3. `crossCategoryPrefs.push({ ..., cohortMonth: normCell(row[0]) || 'unknown' })`

#### Store 归因计算（`src/stores/schedule.ts`）

`liveAttribution` computed 的匹配逻辑：

```typescript
// 从 audience.timeRange 提取结束月份作为代表
function extractCohortMonth(timeRange: string): string | null {
  // "2025.1.12-2026.4.26" -> "2026-04"
  const parts = timeRange.split('-')
  if (parts.length < 2) return null
  const endPart = parts[parts.length - 1].trim()
  const match = endPart.match(/(\d{4})\.(\d{1,2})/)
  if (!match) return null
  const year = match[1]
  const month = match[2].padStart(2, '0')
  return `${year}-${month}`
}

// 匹配优先级：
// 1. fromCategory + toCategory + cohortMonth（精确匹配）
// 2. fromCategory + toCategory（全量平均 fallback）
// 3. 默认 zero
```

#### autoSchedule 排序逻辑

同线分配排序时，先按品类族匹配，再按预估GMV排序。预估GMV的计算也要使用 cohort-aware 的 crossPref（优先匹配同 cohortMonth，否则全量平均）。

### 1.4 Fallback 策略

当直播间数据（`crossRate_直播间` / `LTV_直播间`）为0时，排序和归因都 fallback 到导量数据：

```
预估GMV = audience.count * crossRate_导量 * conversionRate_导量 * LTV_导量
```

> 注：当前 parser 已优先提取 `_直播间` 列。扩展后，若 `_直播间` 为0，则存储 `_导量` 数据作为 `crossRate` / `conversionRate` / `ltv` 的 fallback 值。

---

## 2. 人工排期调适

### 2.1 布局重构：左侧替换为全局人群面板

现有布局：
- 左侧：WeekBoard（周排期矩阵）
- 中间：LivePool（直播列表）
- 右侧：DetailPanel（单场直播详情 + 人群库存）

新布局（方案B）：
- **左侧（320px）**：全局人群细分面板（上部智能推荐 + 下部全部库存）
- **中间（flex-1）**：直播列表（可切换为时间轴视图或GMV排序视图）
- **右侧（320px）**：DetailPanel（单场直播详情，已分配 audience + 归因汇总）

> 旧 WeekBoard 不再默认显示。若用户需要日历视图，后续可作为可切换标签页保留。

### 2.2 左侧面板结构

#### 上部：智能推荐区（高度约占 40%）

当用户选中某场直播时，此区域显示"针对该直播的推荐 audience 列表"。

**排序逻辑**：
1. 先筛选 `crossPref.fromCategory === live.category` 且 `toLine === live.line` 的记录
2. 按 `预估GMV = 库存 * crossRate * LTV` 降序
3. 无直播间数据时，fallback 到导量数据计算预估GMV
4. 同品类族（垂类）高亮显示

**展示字段**：
- 目标品类 + cohortMonth
- 当前库存量级
- crossRate（直播间优先，fallback导量时标灰）
- LTV
- 预估GMV
- 推荐理由标签（如"同品类族"、"直播间数据"、"导量fallback"）

**交互**：
- 点击推荐卡片：直接分配到当前选中的直播
- 拖拽推荐卡片：拖到中间直播列表的任意直播卡片上

#### 下部：全部人群库存树（高度约占 60%）

按线（健康/变美/兴趣）-> 品类 -> cohortMonth 层级展开的树形结构。

- 每个叶子节点显示：cohortMonth + 库存量级 + 状态（available / used / conflict）
- 已分配的 audience 标灰并显示"已排"
- 拖拽任意节点到中间直播卡片：执行分配（需走冲突检查）

### 2.3 拖拽调整交互

**触发条件**：用户从左侧拖拽 audience 到中间直播卡片，或在 DetailPanel 里移除/替换 audience。

**冲突检查**：分配前检查所有硬规则（同线、3天频控、30天伪直播复用、当日去重、跨科直播同品类族限制）。

**自然语言反馈弹窗**：调整完成后，系统弹出对比窗口：

```
┌─────────────────────────────────────┐
│  调整确认                             │
├─────────────────────────────────────┤
│  你把「中医变美」换成了「瑜伽BCD」      │
│  调整前 GMV：¥0.1w                    │
│  调整后 GMV：¥1.8w                    │
│                                      │
│  [为什么这样调整？]                    │
│  _________________________________   │
│                                      │
│  [确认并记录规则]  [仅确认不记录]      │
└─────────────────────────────────────┘
```

**规则存储**：用户输入的自然语言文本 + 调整前后的结构化数据（直播品类、原audience、新audience、GMV变化）存入 `localStorage` 的 `schedule.learnedRules`。

**规则应用**：下次 `autoSchedule` 时，在执行默认策略前，先扫描 `learnedRules`。若有规则匹配当前直播品类 + audience 品类组合，则按规则指定的偏好调整排序权重。

> MVP 阶段规则应用采用简单关键词匹配（如规则文本包含"跨科率太低"，则降低该组合的排序权重）。后续可接入更智能的解析。

### 2.4 DetailPanel 增强

- 显示当前选中直播的 `date + startTime - endTime`（明确排期时间）
- 已分配 audience 列表增加拖拽手柄（可拖到其他直播上实现"转移"）
- 底部归因汇总区：总触达、预计线索、预计首单、预计GMV（使用 cohort-aware 计算）

---

## 3. 数据流

```
cross-pref Excel
    |
    v
parseCrossPrefSheet  --> CrossCategoryPref[] (含 cohortMonth)
    |
    v
scheduleStore.crossCategoryPrefs
    |
    +---> autoSchedule()          -- 排序时使用 cohort-aware 预估GMV
    +---> liveAttribution computed -- 归因计算时按 cohortMonth 匹配
    +---> 智能推荐区              -- 按预估GMV排序展示
```

---

## 4. 关键文件变更

| 文件 | 变更内容 |
|------|----------|
| `src/types/index.ts` | `CrossCategoryPref` 增加 `cohortMonth` |
| `src/utils/parser.ts` | `parseCrossPrefSheet` 提取 cohortMonth；直播间数据为0时 fallback 导量数据 |
| `src/stores/schedule.ts` | 归因计算支持 cohortMonth 匹配；新增 `learnedRules` 状态；autoSchedule 应用规则偏好 |
| `src/components/WeekBoard.vue` | 保留但不再默认显示，后续可作为切换视图 |
| `src/components/LivePool.vue` | 支持接收拖拽事件；增加GMV排序视图 |
| `src/components/DetailPanel.vue` | 已分配 audience 增加拖拽手柄；归因数据使用 cohort-aware 值 |
| `src/components/GlobalAudiencePanel.vue` | **新建**：左侧全局人群面板（智能推荐 + 库存树） |
| `src/components/AdjustmentFeedbackModal.vue` | **新建**：拖拽调整后的自然语言反馈弹窗 |

---

## 5. 验证方式

1. 上传含 `转继承添加好友月份` 列的 cross-pref 文件，检查 AttributionPanel 中各直播的跨科率是否随 audience timeRange 变化。
2. 选中一场直播，确认左侧面板智能推荐区按预估GMV排序，且同品类族高亮。
3. 拖拽替换 audience，确认弹窗弹出，输入原因后点击"确认并记录规则"。
4. 重新点击"自动排期"，确认系统优先应用已记录的规则偏好。
5. 检查导量 fallback：找一个直播间 crossRate=0 的组合，确认系统使用了导量数据计算预估GMV。
