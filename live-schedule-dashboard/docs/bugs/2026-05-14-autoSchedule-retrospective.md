# 2026-05-14 autoSchedule 连环错误复盘

## 一句话总结

今晚 autoSchedule 连续出现**总量失控、单场超标、列缺失、伪直播未剔除**四类错误，根因是**修复只做表面、未触及分配函数 greedy 本质**，导致用户在同一个问题上发火两次。

---

## 错误时间线

### 错误 1：总量失控 628w（第一次）

**现象**：排期后总触达 628w，远超库存 470w。

**根因**：
1. `tryAssign` 一次性把整个 `audienceSegment`（可能几十万）全塞给一场直播，没有任何截断。
2. Round 3b「强制填满剩余库存」将剩余可用段强制分配给最缺曝光的直播，无上限。

**用户反馈**：「你的规则不要乱来，直播目标达标即可」。

**首次修复（治标）**：仅删除了 Round 3b。
**结果**：总量下降，但单场仍然严重超标，用户第二次发火。

---

### 错误 2：单场严重超标（B 级 43w vs target 15w）

**现象**：某 B 级直播触达 43w，目标仅 15w；S 级触达 19.5w，目标 35w（反而不够）。

**根因**：`tryAssign` 没有 `maxCount` 参数。当候选段（如一个 40w 的 health 大段）匹配到直播时，整个段被直接分配，单场瞬间爆表。

**用户反馈**：「按等级顺序分配」「470w 总值，不能超出太多！要合理分配」。

**关键教训**：只在外层循环加 `if (exposure >= target) continue` 挡不住单次贪心。必须在 `tryAssign` 内部做实时截断。

---

### 错误 3：周一列完全缺失

**现象**：WeekBoard 上周一没有任何直播。

**根因**：`parser.ts` 中所有循环硬编码 `col = 2`，假设周一在 Excel 第 2 列。但本次排期表周一在第 1 列，导致整列被跳过。

**修复**：引入 `startCol` 动态检测：
```typescript
const startCol = (normCell(headerRow[1]) !== '' && normCell(dateRow[1]) !== '') ? 1 : 2
```
所有 `col = 2` 改为 `col = startCol`，`weekDays[col - 2]` 改为 `weekDays[col - startCol]`。

---

### 错误 4：伪直播历史人群完全未剔除

**现象**：用户明确标注「伪直播复用 + 上次直播排期要剔除该人群」，但排期后该人群仍被分配。

**根因**：伪直播排除逻辑使用精确字符串匹配：
```typescript
const usedKeys = new Set<string>()
usedKeys.add(`${aud.category}-${aud.timeRange}`)
// ...
if (usedKeys.has(`${seg.category}-${seg.timeRange}`)) seg.status = 'used'
```
排期表中的时间范围是中文格式（"2026年1月19日—2026年5月3日"），而 audience 表中是数字格式（"2026.1.19-2026.5.3"），字符串永远不匹配，导致剔除逻辑形同虚设。

**修复**：改为**规范化品类 + 重叠年份**匹配：
```typescript
function extractYears(timeRange: string): string[] {
  return (timeRange.match(/\d{4}/g) || [])
}
const usedEntries: { category: string; years: string[] }[] = []
// 匹配时：normalizeCategory + years.some(overlap)
```

---

### 错误 5：14 场变 13 场

**现象**：用户指出「一共是 14 场，你图片只有 13 场」，遗漏了「周六 23 伪直播复用 逆龄女神瑜伽」。

**根因**：parser 在处理特定行结构时，该行被判定为无 day data 或 metadata 行，被跳过。

**修复**：通过 `startCol` 修复和 metadata 判断逻辑调整后，该行被正确解析。

---

### 错误 6：修复反复，用户两次发火（核心教训）

**路径**：
1. 用户说「达标即可」→ 我只删了 Round 3b（治标）→ 用户仍怒。
2. 用户说「按权重分完 470w」→ 我错误理解为「取消上限 + 恢复强制填满」→ 总量回到 628w → 用户暴怒「你在骗我」。
3. 最终正确理解：「按目标权重分配配额，但单场必须截断，不能循环复用」→ 引入 `quota` + `maxCount` + 彻底删除 reuse。

**关键教训**：
- 用户说「达标即可」= **严格按 target 上限截断**，不是「差不多就行」。
- 用户说「分完 470w」= **在配额内尽量填满**，不是「取消上限强制填满」。

---

### 错误 7：health 线按等级穷尽分配结果为 0

**现象**：用户要求「健康线里要实现按直播等级分配 穷尽」，但分配结果为 0。

**根因**：在修复过程中，health 线的过滤条件或品类映射出现错误，导致没有候选段通过过滤。

**修复**：确认 `getCandidates` 中的 `allowedLines` 和 `excludedCats` 逻辑正确，且 `normalizeCategory` 映射无误。

---

### 错误 8：一杰瑜伽跨线规则错误

**现象**：用户强调「优先原线分配！！！一杰是变美品」，但一杰瑜伽被分配到了 health 线。

**根因**：`一杰瑜伽` 是中性品类（`NEUTRAL_CATEGORIES`），理论上允许 beauty → health 跨线，但用户要求**优先原线**，只有在 beauty 线资源耗尽后才考虑跨线。

**修复**：在 `getCandidates` 返回前加同线过滤：
```typescript
if (NEUTRAL_CATEGORIES.has(live.category) && live.line === 'beauty') {
  const sameLineCandidates = candidates.filter((s) => s.line === live.line)
  if (sameLineCandidates.length > 0) return sameLineCandidates
}
```

---

### 错误 9：伪直播逻辑理解混乱

**现象**：用户对「居家古法养生」是否为伪直播、是否需要剔除人群产生混淆，我多次理解错误。

**根因**：伪直播有两种状态：
- **有 assignedAudiences** → 这是「上次直播排期」带来的历史人群，需要**全局剔除**。
- **无 assignedAudiences** → 这是正常排期的伪直播，按普通逻辑分配。

我多次将两者混淆，导致该剔除的没剔除、不该剔除的误剔除。

**修复**：明确区分：
```typescript
if (live.type === 'fake' && live.assignedAudiences.length > 0) {
  // 收集 usedEntries，全局剔除
  continue
}
```

---

## 最终修复方案

### 1. 配额制（Quota System）

```typescript
const totalInventory = audienceSegments.value.reduce((sum, s) => sum + s.count, 0)
const totalWeight = scored.reduce((sum, { live }) => sum + TARGET_EXPOSURE[live.grade || 'C'], 0)
const quotas = new Map<string, number>()
for (const { live } of scored) {
  const weight = TARGET_EXPOSURE[live.grade || 'C']
  quotas.set(live.id, Math.round((weight / totalWeight) * totalInventory))
}
```

每场直播的配额 = `(该直播 target / 所有直播 target 之和) * 总库存`。确保总触达不超过总库存。

### 2. tryAssign 实时截断 + 段拆分

```typescript
function tryAssign(live: LiveStream, seg: AudienceSegment, maxCount?: number): boolean {
  const desiredCount = Math.min(seg.count, maxCount ?? seg.count)
  if (desiredCount <= 0) return false
  if (desiredCount < seg.count) {
    // 拆分剩余段
    const remaining = { ...seg, count: seg.count - desiredCount, id: generateId() }
    audienceSegments.value.push(remaining)
    seg.count = desiredCount
  }
  // ... 分配逻辑
}
```

### 3. 删除 Round 2（reuse）和 Round 4（force-fill）

- Round 2 的 reuse 会导致同一段被多次计数，总量虚高。
- Round 4 的 force-fill 无视上限，单场必然超标。

保留：
- **Round 1**：严格分配，每段只用一次，配额截断。
- **Round 2**（原 Round 3b 改名）：将剩余未分配段按优先级二次分配，但仍受配额限制。
- **Round 3**：保底，确保零触达直播至少获得一段。

### 4. 同线优先 + 中性品类同线穷尽

在 `getCandidates` 排序第 0 级加入同线优先，并在返回前对中性品类过滤同线候选。

### 5. 伪直播剔除：品类 + 重叠年份匹配

彻底放弃字符串精确匹配，改用规范化品类 + 年份交集判断。

### 6. Parser：动态 startCol

检测 headerRow[1] 和 dateRow[1] 是否有内容，决定 day columns 从 col=1 还是 col=2 开始。

---

## 验证清单（以后每次修改分配逻辑必须执行）

1. [ ] 构建成功 `npm run build`
2. [ ] 部署成功
3. [ ] **单场触达 vs target 散点分布**：每场直播的 exposure 是否落在合理区间（S≈35w、A≈22w、B≈15w、C≈12w）。
4. [ ] **总触达 vs 总库存**：`totalAssigned` 是否接近 `totalInventory`，且不超过 100%。
5. [ ] **列完整性**：周一到周日是否都有数据。
6. [ ] **伪直播剔除**：已标注剔除的人群是否状态为 `used`。
7. [ ] **直播场数**：解析出的 live 数量是否与 Excel 一致。

---

## 规则沉淀（来自用户现场指令）

1. **「达标即可」= 严格按 target 上限截断**，不是「差不多就行」。
2. **「按权重分完」= 配额内尽量填满**，不是「取消上限强制填满」。
3. **优先原线分配**，中性品类跨线是最后手段。
4. **按等级顺序分配**，S > A > B > C。
5. **伪直播有 assignedAudiences → 全局剔除**；无 assignedAudiences → 正常排期。
6. **所有使用品类名做匹配的地方必须先 `normalizeCategory`**。
7. **修复必须触及根因**，不能只做表面补丁。
