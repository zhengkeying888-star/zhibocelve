# CLAUDE.md — 直播排期策略看板

## 项目概述

私域直播运营用的排期策略看板。核心 workflow：

1. 上传排期 Excel → 系统解析出本周直播场次
2. 上传 audience 量级表 → 系统获得各品类各时间段的存量用户数
3. 上传跨科偏好数据 → 系统获得品类→品类的 day60 跨科率 + LTV
4. 系统自动按规则分配 audience（自动排期）
5. 运营可在看板上手动校准品类、线级、评级、人群分配
6. 导出排期结果回 Excel

## 技术栈

- Vue 3 + `<script setup>` + TypeScript
- Vite (build tool)
- Pinia (state management)
- Tailwind CSS v4
- xlsx (SheetJS) — Excel 解析/导出
- 纯前端，localStorage 持久化配置

## 目录结构

```
src/
  components/
    UploadBar.vue        — 顶部工具栏（上传、自动排期、导出、归因入口）
    UploadModal.vue      — 上传文件弹窗（排期表 / audience表 / 跨科偏好表）
    WeekBoard.vue        — 周排期矩阵看板（周一至周日 × 各时段）
    LivePool.vue         — 直播卡片列表（可编辑品类/线级/评级）
    DetailPanel.vue      — 右侧详情面板（已分配 audience + 人群库存 + 归因数据）
    CategoryManager.vue  — 品类评级管理弹窗
    AttributionPanel.vue — 全局排期归因看板弹窗
  stores/
    schedule.ts          — 核心 Pinia store（状态、计算属性、actions、autoSchedule）
  utils/
    parser.ts            — Excel 解析（排期矩阵、audience sheet、跨科偏好、历史记录）
    exporter.ts          — Excel 导出
    categoryMapping.ts   — 标准品类映射 + normalizeCategory 函数
  types/
    index.ts             — TypeScript 类型定义
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
}
```

### 跨科偏好 (CrossCategoryPref)

```typescript
interface CrossCategoryPref {
  fromCategory: string   // 直播品类
  toCategory: string     // 宣发目标品类（audience 品类）
  toLine: LineType
  crossRate: number      // day60 跨科率
  ltv: number            // day60 LTV（GMV/例子数）
}
```

## 业务规则（硬规则）

1. **同线分配**：health 的 audience 只能分配给 health 的直播，beauty→beauty，interest→interest。**跨线分配已彻底移除**。
2. **跨科直播不能宣发同品类**：如果 `isCrossCategory === true`，不能分配与直播品类属于同一家族的 audience。
3. **3 天频控**：同一个 audience 段（同品类 + 同时间段）3 天内不能被重复触达。
4. **30 天伪直播复用**：伪直播复用的 audience 段 30 天内不能被再次复用。
5. **当日去重**：同一天同一个 audience 段只能分配给一场直播。
6. **朋友圈资源位不排量级**：`slot === 'friend-circle'` 的直播只做标注，不参与 audience 分配。

## 品类映射系统

**关键**：不同 Excel 里的品类名称可能不一致（如 "睡眠" vs "睡眠调理" vs "睡眠调理-五禽戏"）。系统通过 `src/utils/categoryMapping.ts` 做统一规范化。

- `CATEGORY_TO_LINE`: 69 个标准品类 → 线级映射（用户提供的表二）
- `CATEGORY_ALIASES`: 常见别名 → 标准名映射
- `normalizeCategory(name)`: 把任意输入映射到标准品类名

**所有使用品类名做匹配的地方都必须先 `normalizeCategory`**：parser 解析时、autoSchedule 排序时、liveAttribution 计算时、用户手动设置品类时。

## AutoSchedule 策略

1. 按直播权重排序：`S(100) > A(70) > B(40) > C(20)`，晚间场加分，伪直播历史转化率加分
2. 同线分配，优先同品类族（垂类），再按 LTV 排序，最后按 count 排序
3. 每个直播分配 audience 直到达到目标曝光量（S:45w, A:30w, B:20w, C:15w）
4. 检查所有硬规则冲突

## 归因计算

对每个直播的 `assignedAudiences`：

```
expectedConversion = Σ(audience.count × crossRate)
expectedGMV = Σ(audience.count × crossRate × ltv)
```

匹配条件：`normalizeCategory(crossPref.fromCategory) === normalizeCategory(live.category) && normalizeCategory(crossPref.toCategory) === normalizeCategory(aud.category)`

## 持久化

- `schedule.categoryGrades` — 品类手动评级 (localStorage)
- `schedule.categoryLines` — 品类线级覆盖 (localStorage)
- `schedule.nameOverrides` — 按直播名记忆的品类/线级 (localStorage)

## 开发命令

```bash
cd live-schedule-dashboard
npm run dev      # 本地开发
npm run build    # 生产构建
npm run preview  # 预览构建产物
```

## 注意事项

- 不要mock数据库，所有测试都基于真实Excel解析逻辑
- 品类名必须走 `normalizeCategory` 规范化后再做匹配，否则归因会全是0
- 修改品类映射后需要重新上传数据或点击「应用到所有场次」+「重新生成排期」
- 构建输出在 `dist/` 目录，可部署到任何静态托管服务
