# 复盘：品类映射断裂、频控规则误用与复用逻辑缺失

日期：2026-05-15
关联版本：v3.2 → v3.3
关联文件：`src/utils/categoryMapping.ts`、`src/stores/schedule.ts`、`src/utils/parser.ts`

---

## 1. 现象

用户上传排期表后执行 autoSchedule，出现以下问题：

1. **总曝光量仅 406w，距 audience 总库存 487w 差 81w**
2. **部分直播显示 ¥0 GMV**（逆龄女神瑜伽、一杰瑜伽等明明有历史数据）
3. **频控失效**：国际声乐直播与前一天的短视频直播被分配到同一 audience 段
4. **品类映射错误**：明细表里的 `居家古法` 无法被识别为标准品类 `古法居家养生`

用户核心反馈：**"根源在于你对于规则的理解太弱了"**

---

## 2. 根因分析

### 根因 A：4月明细表 → 系统标准品的映射断裂

4月直播明细表里的「直播品类」列包含原始运营命名，和系统 `CATEGORY_TO_LINE` 里的标准名不完全一致。

| 明细表原始名 | 之前解析结果 | 问题 |
|---|---|---|
| `居家古法` | `居家古法`（无法识别） | 别名表里只有 `古法居家` → `古法居家养生`，缺少 `居家古法` |
| `五禽戏 x 健康食养` | `五禽戏` | 联合直播分隔符 `x` 不在 `normalizeCategory` 的分隔符列表里，只取了前缀 |
| `写作` | `写作` | 完全不在任何映射里 |

**影响**：这些品类无法被正确聚合到 `categoryHistoricalStats`，导致排期时查不到历史数据，GMV 显示为 0。

### 根因 B：频控用 `===` 精确匹配品类，导致别名族漏控

`checkConflicts` 检查 3天/当日/30天频控时，一直用 `a.category === seg.category` 精确匹配。

**致命问题**：
- `声乐` 和 `国际声乐` 在 `getCategoryFamily` 下是同一族（`familyAliasMap: { '声乐': '国际声乐' }`）
- 但 `===` 认为它们不同 → 国际声乐直播可以分配到昨天声乐直播已经用过的人群
- 同理，`瑜伽S` / `瑜伽A` / `瑜伽BCD` 和 `瑜伽` 的频控也会漏掉

**影响**：违反了「同一品类族 audience 3 天内不能重复触达」的运营规则。

### 根因 C：Round 2 完全没有复用机制（总量 406w 的核心根因）

`autoSchedule` 设计了三轮分配，但 Round 2 的 `pickBest` 只选 `assignedDates.length === 0` 的段（`isSegmentUnused`）。

**实际执行流程**：
1. Round 1：分配所有 unused 段给各直播
2. Round 2：试图继续分配，但池子里已经没有 unused 段了 → 直接结束
3. Round 3：只对 **zero-exposure lives** 做复用兜底

**结果**：
- 大量段只被用了一次（分配给一场直播）
- 即使 3 天间隔已过，这些段也无法被分配给其他直播
- 很多直播在 Round 1 拿了几个段后就再也拿不到新的，因为池子已空
- **81w 的差距正是这些被"一次性浪费"掉的段**

**更深的 bug**：Round 3 调用 `tryAssign(best, ..., allowReuse=true)` 时，`tryAssign` 内部无条件执行了 transfer 逻辑（如果 best 已分配给直播 A，先从 A 里移除再分配给 B）。这不是"复用"，这是"转移"。

### 根因 D：历史数据查找缺少回退

`liveAttribution` 和 `weeklyRawTarget` 查找 `categoryHistoricalStats[cat]` 时只有精确匹配。

当排期表用 `逆龄女神瑜伽`（细分类目）而明细表只有 `瑜伽`（大类统计）时，lookup 失败。虽然本次明细表里实际有 `逆龄女神瑜伽`，但 `findHistoricalStat` 的三级回退（精确 → family → 子串）仍然必要，以防未来出现名称不一致。

---

## 3. 修复方案

### 3.1 映射修复

```typescript
// CATEGORY_ALIASES 新增
'居家古法': '古法居家养生'

// normalizeCategory 分隔符新增
const separators = ['-', '—', '–', '|', '·', '•', 'x', 'X', '×']
```

### 3.2 频控修复

`checkConflicts` 全部改用 `isSameCategoryFamily`：

```typescript
// 3天频控
const recentHistory = combinedHistory.filter(
  (h) =>
    isSameCategoryFamily(h.category, seg.category) &&
    h.timeRange === seg.timeRange &&
    daysBetween(h.date, live.date) < 3
)

// 当日去重
const sameWeek = liveStreams.value.filter(
  (l) =>
    l.id !== live.id &&
    l.type !== 'fake' &&
    l.date === live.date &&
    l.assignedAudiences.some(
      (a) => isSameCategoryFamily(a.category, seg.category) && a.timeRange === seg.timeRange
    )
)
```

### 3.3 复用机制修复

**核心改动**：

1. `pickBest` 增加 `allowReuse` 参数：
   - `allowReuse = false`（Round 1）：只选 unused 段
   - `allowReuse = true`（Round 2）：允许 `status === 'used'` 但 `assignedDates.length === 1 && daysBetween >= 3` 的段

2. Round 2 调用 `pickBest(..., true)` + `tryAssign(..., allowReuse=true)`

3. `tryAssign` 在 `allowReuse = true` 时：
   - **跳过 transfer 逻辑**（不从原直播移除）
   - **不覆盖 `assignedTo`**（保留原直播的引用）
   - 只 push 新日期到 `assignedDates`

4. `linePools` 维护：
   - Round 1 分配后，**不 splice** 已用段（保留给 Round 2 复用）
   - 只有当 `assignedDates.length >= 2`（不可再复用）时才 splice

### 3.4 历史数据查找回退

新增 `findHistoricalStat(cat)`  helper：
1. 精确匹配 `categoryHistoricalStats[cat]`
2. `getCategoryFamily(cat)` 回退（处理瑜伽S/A/BCD → 瑜伽）
3. 最长子串回退（处理 `逆龄女神瑜伽` 包含 `瑜伽`）

---

## 4. 验证清单

- [ ] 上传明细表后，`居家古法` 被正确识别并聚合到 `古法居家养生`
- [ ] 频控：`国际声乐` 直播不能再分配到前一天 `声乐` 直播已用的人群段
- [ ] 频控：`瑜伽` 直播和 `逆龄女神瑜伽` 直播在 3 天内不能共用同一 timeRange 段
- [ ] Round 2 复用：同一段在周一被分配后，周四的直播可以再次获得该段
- [ ] totalExposure 从 ~406w 提升到接近 ~487w
- [ ] 子品类（逆龄女神瑜伽）能正确查到历史数据，不再显示 ¥0

---

## 5. 经验教训

1. **品类映射必须双向验证**：不仅要看系统 `CATEGORY_TO_LINE` 里有什么，还要看上游 Excel 里实际出现什么原始名。联合直播的分隔符（x、×、X）容易被忽略。

2. **频控的品类比较必须用 `isSameCategoryFamily`**，不能用 `===`。别名族（声乐/国际声乐）和等级变体（瑜伽S/瑜伽）是频控的关键场景。

3. **"复用"和"转移"是完全不同的概念**：`tryAssign` 里的 transfer 逻辑（从原直播移除）在复用场景下是毁灭性 bug。复用意味着同一段分配给多个直播，转移意味着只保留最新分配。

4. **Round 2 不执行复用 = 81w 差距的核心根因**。不要因为 `pickBest` 的过滤条件太严格就盲目放宽保护阈值（如 split 保护、2x ceiling），要先检查段是否真的被充分利用了。

5. **历史数据查找必须有回退**：明细表里的品类命名和排期表里的品类命名可能来自不同运营人员，存在"大类统计 vs 细分类目"的差异。
