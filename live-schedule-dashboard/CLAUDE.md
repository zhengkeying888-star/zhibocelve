# CLAUDE.md — 直播排期策略看板

## 项目概述

私域直播运营用的排期策略看板。核心 workflow：

1. 上传排期 Excel → 系统解析出本周直播场次
2. 上传 audience 量级表 → 系统获得各品类各时间段的存量用户数
3. 上传跨科偏好数据 → 系统获得品类→品类的 day60 跨科率 + LTV（含 cohortMonth）
4. **上传 4月直播明细表 → 系统用实际历史 GMV 校准预估模型**
5. 系统自动按规则分配 audience（自动排期）
6. 运营可在看板上手动校准品类、线级、评级、人群分配
7. **拖拽调整后系统记录规则，下次自动应用**
8. 导出排期结果回 Excel

## 技术栈

- Vue 3 + `<script setup>` + TypeScript
- Vite (build tool)
- Pinia (state management)
- Tailwind CSS v4
- xlsx (SheetJS) — Excel 解析/导出
- Supabase — 云端同步（可选，未配置时降级到 localStorage）

## 目录结构

```
src/
  components/
    UploadBar.vue                — 顶部工具栏（上传、自动排期、导出、归因入口）
    UploadModal.vue              — 上传文件弹窗（排期表 / audience表 / 跨科偏好表 / 直播明细表）
    LivePool.vue                 — 直播卡片列表（可编辑品类/线级/评级，支持接收拖拽）
    DetailPanel.vue              — 右侧详情面板（已分配 audience + 人群库存 + 归因数据，支持拖拽转移）
    CategoryManager.vue          — 品类评级管理弹窗
    AttributionPanel.vue         — 全局排期归因看板弹窗
    WeekBoard.vue                — 周度排期矩阵看板（直播卡片 + 历史等级推荐标签）
    GlobalAudiencePanel.vue      — 左侧全局人群面板（智能推荐 + 按 cohortMonth 展开的库存树）
    AdjustmentFeedbackModal.vue  — 拖拽调整后的自然语言反馈弹窗（记录规则）
  stores/
    schedule.ts                  — 核心 Pinia store（状态、计算属性、actions、autoSchedule）
  utils/
    parser.ts                    — Excel 解析（排期矩阵、audience sheet、跨科偏好、历史记录、直播明细表）
    exporter.ts                  — Excel 导出
    categoryMapping.ts           — 标准品类映射 + normalizeCategory 函数
  types/
    index.ts                     — TypeScript 类型定义
  lib/
    cloudSync.ts                 — Supabase 云端同步封装
    defaultCategoryMappings.ts   — 默认品类线级/评级映射
```

## 核心数据模型

### 直播场次 (LiveStream)

```typescript
interface LiveStream {
  id: string
  name: string
  startTime: string
  endTime?: string
  date: string
  type: 'real' | 'fake'
  category: string       // 品类（已规范化到标准名）
  line: 'health' | 'beauty' | 'interest'
  slot: 'morning' | 'evening' | 'fake-morning' | 'fake-evening' | 'friend-circle'
  grade: 'S' | 'A' | 'B' | 'C' | null
  owner: string
  assignedAudiences: AssignedAudience[]
  exposure: number
  conflictReasons: string[]
  isCrossCategory: boolean   // true = 跨科直播（不能宣发同品类 audience）
  isJoint?: boolean          // 联合直播
  categories?: string[]      // 联合直播子品类列表
  lines?: LineType[]         // 联合直播涉及的线级去重列表
  target?: number            // 动态计算的目标曝光量
}
```

### Audience 人群段 (AudienceSegment)

```typescript
interface AudienceSegment {
  id: string
  line: LineType
  category: string       // 公海品类（已规范化）
  timeRange: string      // 如 "2025.1.12-2026.4.26"
  count: number
  status: 'available' | 'used'
  assignedTo?: string    // 分配到的 liveId
  assignedDates?: string[] // 当前周被分配的日期（最多2个）
}
```

### 跨科偏好 (CrossCategoryPref)

```typescript
interface CrossCategoryPref {
  fromCategory: string   // 公海品类（audience 品类）
  toCategory: string     // 跨科品类（直播品类）
  toLine: LineType
  cohortMonth: string    // 转继承添加好友月份，如 "2026-03"
  crossRate: number      // day60 跨科率（直播间优先，fallback 导量）
  conversionRate: number // 首单转化率（直播间优先，fallback 导量）
  ltv: number            // day60 LTV（直播间优先，fallback 导量）
}
```

### 历史统计数据 (CategoryHistoricalStat)

```typescript
interface CategoryHistoricalStat {
  avgGMV: number              // 单场平均 GMV
  avgExposure: number         // 单场平均曝光人数
  avgContributionRatio: number // 单场平均贡献占比
  avgFirstOrders: number      // 单场平均首单订单数
  avgConversionRate: number   // 单场平均首单转化率
  count: number               // 历史直播场次数
}
```

由 `parseLiveDetailSheet()` 从 4 月直播明细表解析生成，按标准品类聚合。

## 业务规则（硬规则）

1. **同线分配**：health → health，beauty → beauty，interest → interest。
2. **联合直播自然跨线**：联合直播涉及多线品类时，允许跨线分配。
3. **中性品类单直播跨线**：beauty 线 → health 线，仅限 `一杰瑜伽`、`东方养正瑜伽`。
4. **health / interest 不向外跨线**。
5. **跨科直播不能宣发同品类**：如果 `isCrossCategory === true`，不能分配与直播品类属于同一家族的 audience。**比较时必须用 `isSameCategoryFamily`，不能用 `===`**。
6. **3 天频控**：同一个 audience 段 3 天内不能被重复触达。**品类比较用 `isSameCategoryFamily`**，确保别名族（如 `声乐`/`国际声乐`）和等级变体（如 `瑜伽S`/`瑜伽`）也被正确频控。
7. **30 天伪直播复用**：伪直播复用的 audience 段 30 天内不能被再次复用。
8. **当日去重**：同一天同一个 audience 段只能分配给一场直播。
9. **朋友圈资源位不排量级**：`slot === 'friend-circle'` 的直播只做标注，不参与 audience 分配。
10. **5-family 限制**：每个直播最多分配 **5 个不同品类族**的 audience。计数用 `getCategoryFamily`，确保等级变体（瑜伽S/A/BCD）计为 1 个族。

## 品类映射系统

**关键**：不同 Excel 里的品类名称可能不一致（如 "睡眠" vs "睡眠调理" vs "睡眠调理-五禽戏"）。系统通过 `src/utils/categoryMapping.ts` 做统一规范化。

- `CATEGORY_TO_LINE`: 69 个标准品类 → 线级映射（用户提供的表二）
- `CATEGORY_ALIASES`: 常见别名 → 标准名映射
- `normalizeCategory(name)`: 把任意输入映射到标准品类名

**所有使用品类名做匹配的地方都必须先 `normalizeCategory`**：parser 解析时、autoSchedule 排序时、liveAttribution 计算时、用户手动设置品类时。

## AutoSchedule 策略

### 1. 直播优先级排序（scored）

```typescript
score = GRADE_SCORE[grade] + slot_bonus + fake_hist_bonus + historical_gmv_bonus
GRADE_SCORE = {'S': 100, 'A': 70, 'B': 40, 'C': 20, null: 10}
slot_bonus: evening +50, morning +30, other +10
fake_hist_bonus: fakeLiveHistory.conversionRate × 100
historical_gmv_bonus: Math.min(avgGMV / 20_000, 5)   // 封顶 +5
```

按 score 降序排列：高等级 + 晚间场 + 伪直播历史好 + 历史产值高 的直播优先获得 audience。

### 2. 候选排序（getCandidates，7级优先级）

1. **同品类族优先**（垂类，crossRate = 1.0）
2. **已分配品类去重**（强制分散）
3. **已分配 timeRange 去重**（进一步分散）
4. **超大段降权**（超过目标 60% 降低优先级）
5. **已学习的规则匹配优先**（learnedRules）
6. **预估 GMV 降序**：
   - **有历史数据**：`count × (avgGMV / avgExposure)`（每触达一人的历史产值效率）
   - **无历史数据回退**：`count × crossRate × LTV`
7. **count 降序**

### 3. 分配轮次

- **Round 1（目标保底）**：只选 `assignedDates.length === 0` 的段。每轮每个直播只拿一个最佳段，`maxCount = target - exposure` 限制不超目标。分配后**不 splice** 已用段，保留在 `linePools` 中供 Round 2 复用。
- **Round 2（复用填充）**：允许复用 Round 1 已分配的段。`pickBest(..., allowReuse=true)` 允许 `status === 'used'` 且 `assignedDates.length === 1` 且 `daysBetween >= 3` 的段进入候选池。`tryAssign(..., allowReuse=true)` **跳过 transfer 逻辑**（不从原直播移除），真正共享。当 `assignedDates.length >= 2` 时才从 `linePools` splice。
- **Round 3（零曝光兜底）**：对 `exposure === 0` 的直播强制分配。先尝试 unused 段，再尝试 reusable 段。

### 4. 停止条件

达到目标曝光的 **130%** 后停止（强制分散搭配多个段）。

### 5. 目标曝光量

| 评级 | 目标曝光 |
|---|---|
| S | 350,000 |
| A | 220,000 |
| B | 150,000 |
| C | 120,000 |

联合直播目标 = 第一场完整目标 + 后续子直播目标 × 0.5

## 动态目标缩放（Dynamic Scaling）

当上传了 4 月直播明细表后，系统启用动态缩放：

1. **原始预估**：`weeklyRawTarget = Σ(当周各 real live 对应品类的 avgGMV)`
2. **缩放系数**：
   - `raw > 250,000` → `scaleFactor = 250,000 / raw`
   - `raw < 200,000` → `scaleFactor = 200,000 / raw`
   - 否则 → `scaleFactor = 1`
3. **校准后目标**：`weeklyScaledTarget = raw × scaleFactor`

单场预估 GMV = `avgGMV × scaleFactor`，按 audience count 比例分摊。

## 归因计算（Attribution）

### 统一历史路径（当 categoryHistoricalStats 非空时）

**所有 real live 统一使用历史口径**，不再为个别无历史数据的品类回退到理论模型。

**有历史数据的品类**：
```
expectedGMV         = avgGMV × scaleFactor
expectedFirstOrders = avgFirstOrders × scaleFactor
expectedLeads       = (avgFirstOrders / avgConversionRate) × scaleFactor   // avgConversionRate > 0
```
按各 assigned audience 的 `count / totalExposure` 比例分摊到 segment 级别。

**历史数据查找（`findHistoricalStat`）**：
1. 精确匹配 `categoryHistoricalStats[cat]`
2. `getCategoryFamily(cat)` 回退（处理等级变体如 `瑜伽S` → `瑜伽`）
3. 最长子串回退（处理细分类目包含大类如 `逆龄女神瑜伽` 包含 `瑜伽`）

**无历史数据的品类**：
```
expectedGMV = 0
expectedFirstOrders = 0
expectedLeads = 0
```

### 理论模型回退（当 categoryHistoricalStats 为空时）

```
expectedLeads       = Σ(audience.count × crossRate)
expectedFirstOrders = Σ(expectedLeads × conversionRate)
expectedGMV         = Σ(expectedFirstOrders × ltv)
```

**匹配优先级**：
1. `normalizeCategory(fromCategory) === audCat && normalizeCategory(toCategory) === liveCat && cohortMonth === extractCohortMonth(aud.timeRange)`（精确匹配）
2. `normalizeCategory(fromCategory) === audCat && normalizeCategory(toCategory) === liveCat`（全量平均 fallback）
3. 默认 zero

## 历史等级推荐（Historical Grade Suggestion）

基于所有有历史数据品类的 `avgGMV` 计算四分位数：

```typescript
const avgGMVs = stats.map(s => s.avgGMV).sort((a, b) => a - b)
const p20 = avgGMVs[Math.floor(avgGMVs.length * 0.2)]
const p50 = avgGMVs[Math.floor(avgGMVs.length * 0.5)]
const p80 = avgGMVs[Math.floor(avgGMVs.length * 0.8)]

if (avgGMV >= p80) → 'S'
else if (avgGMV >= p50) → 'A'
else if (avgGMV >= p20) → 'B'
else → 'C'
```

在 `WeekBoard.vue` 直播卡片上显示「历S/历A/历B/历C」标签（仅当与当前 grade 不一致时）。

## 完成版排期解析

支持解析运营已确认的实际执行排期（正确版排期），其中 audience 分配数据以多行形式嵌入在直播名下方：
- 健康线 / 变美线 / 兴趣线 audience 可能跨多行，仅首行带线级标签
- 解析器连续收集同一线级的所有行，按列合并后提取 `(品类, 人数, 时间范围)`
- 跳过 Excel 时间数字、`【晚间】` 等资源位标注行
- **【上次直播排期】容错**：若 `【上次直播排期】` 的 audience 数据出现在直播信息行之前（排期表顺序不固定），`parseAudienceAssignmentBlock` 会自动创建一个 `type: 'fake'` 的占位直播对象接收这些数据，避免全局剔除遗漏

## 人工调适与规则学习

### 拖拽调整
- **左侧库存树 → 中间直播卡片**：点击或拖拽分配
- **右侧已分配 audience → 中间直播卡片**：自动转移（先 remove 再 assign）
- 悬停时直播卡片高亮，释放后执行分配

### 智能推荐
选中直播后，左侧「智能推荐」区显示所有可宣发人群：
- **有历史数据**：按 `预估GMV = 库存 × (avgGMV / avgExposure)` 降序排列
- **无历史数据**：按 `预估GMV = 库存 × crossRate × LTV` 降序排列
- 同品类族（垂类）高亮
- 显示 cohortMonth、crossRate、LTV
- 无直播间数据时 fallback 导量，标灰提示

### 规则学习
拖拽/点击分配后弹出 `AdjustmentFeedbackModal`：
- 显示调整前后的 GMV 对比
- 自然语言输入框（如"中医变美跨科率太低，瑜伽更匹配"）
- 点击「确认并记录」存入 `learnedRules`（localStorage + Cloud Sync）
- 下次 `autoSchedule` 时第 5 级优先级应用规则匹配

## 持久化

- `schedule.categoryGrades` — 品类手动评级 (localStorage + Cloud)
- `schedule.categoryLines` — 品类线级覆盖 (localStorage + Cloud)
- `schedule.nameOverrides` — 按直播名记忆的品类/线级 (localStorage + Cloud)
- `schedule.learnedRules` — 人工调整沉淀的规则 (localStorage + Cloud)
- `schedule.categoryHistoricalStats` — 历史统计数据 (localStorage + Cloud，v2.3 新增)

## 开发命令

```bash
cd live-schedule-dashboard
npm run dev      # 本地开发
npm run build    # 生产构建
npm run preview  # 预览构建产物
```

## 版本与数据兼容性

- **DATA_VERSION**: `v3.3-reuse-and-family-conflicts`
- 每次 autoSchedule 逻辑发生不兼容变更时必须 bump DATA_VERSION，强制清空旧 persisted state
- 版本不匹配时自动调用 `resetAllData()` 并 reload 页面

## 注意事项

- 不要mock数据库，所有测试都基于真实Excel解析逻辑
- 品类名必须走 `normalizeCategory` 规范化后再做匹配，否则归因会全是0
- **频控/排除/去重中的品类比较必须用 `isSameCategoryFamily`，绝对不能用 `===`**。`===` 会导致别名族（`声乐`/`国际声乐`）和等级变体（`瑜伽S`/`瑜伽`）的频控漏控
- **复用和转移是完全不同的概念**：`tryAssign` 的 transfer 逻辑（从原直播移除）在复用场景下是毁灭性 bug
- 修改品类映射后需要重新上传数据或点击「应用到所有场次」+「重新生成排期」
- 构建输出在 `dist/` 目录，可部署到任何静态托管服务
- **跨科偏好文件格式**：必须包含 `转继承添加好友月份` 列作为第0列，系统按此列提取 `cohortMonth`
- **4月直播明细表格式**：必须包含「品类」或「公开课名称」用于映射，「总gmv」「曝光人数」用于统计。上传后系统强制走统一历史路径，无历史数据的品类 GMV 将显示为 0
- **联合直播原始名分隔符**：明细表/排期表中的联合直播名可能用 `x`、`X`、`×` 分隔（如 `五禽戏 x 健康食养`），`normalizeCategory` 已支持这些分隔符
- **品类映射双向审计**：不仅要维护 `CATEGORY_TO_LINE` 和 `CATEGORY_ALIASES`，还要定期读取上游 Excel 实际出现的原始名，确保映射无断裂
