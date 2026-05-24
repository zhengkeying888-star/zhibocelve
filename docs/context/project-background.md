# 项目背景：直播排期策略看板

## 项目定位

私域直播运营的核心工具，将约 487 万 audience 库存按规则分配给每周 20-30 场直播，并输出 GMV 预估与归因数据。

运营团队通过上传 Excel 排期表，由系统自动完成 audience 分配；运营可手动调整分配并沉淀规则，系统学习后下次自动应用。

## 核心 stakeholders

- **运营团队**：上传排期表、审核 autoSchedule 结果、手动调整分配、导出最终排期
- **数据团队**：提供 4月直播明细表（历史实际 GMV）、跨科偏好表（day60 跨科率/LTV）
- **技术实现**：本系统（Vue 3 + Pinia + 本地/云端持久化）

## 当前系统版本

- **DATA_VERSION**: `v3.4-line-round-robin-and-segment-cap`
- **PRD 版本**: v3.4
- **生效日期**: 2026-05-24

## 关键数据流

```
排期表 Excel → parseScheduleWorkbook → LiveStream[]
audience 量级表 Excel → parseAudienceJson → AudienceSegment[]
跨科偏好表 Excel → parseCrossCategoryPrefs → CrossCategoryPref[]
4月直播明细表 Excel → parseLiveDetailSheet → categoryHistoricalStats
                                                              ↓
                    autoSchedule() → 分配 audience → liveAttribution → 导出 Excel
```

## 当前技术债务与已知风险

1. **品类映射维护成本高**：上游 Excel 原始品类名和系统标准名之间需要持续维护 `CATEGORY_ALIASES` 和 `CATEGORY_TO_LINE`。新品类上线或运营命名习惯改变时容易断裂。
2. **`assignedTo` 单指针限制复用**：`AudienceSegment.assignedTo` 是 `string | undefined`，只能指向一个 live。复用场景下（同一段分配给 2 个直播）不覆盖 `assignedTo`，导致手动 transfer 时可能行为异常。
3. **单周限制**：当前只支持单周排期，多周批量管理尚未实现。
4. **历史数据仅单月**：`categoryHistoricalStats` 基于单月均值，缺乏多月趋势。
5. **理论模型已边缘化**：一旦上传明细表，系统强制走统一历史路径，理论 `crossRate × LTV` 模型几乎不再使用。

## 近期重大变更时间线

| 日期 | 变更 | 影响 |
|---|---|---|
| 2026-05-12 | v3.0 历史归因模型 | 引入 `categoryHistoricalStats`、动态缩放、历史等级推荐 |
| 2026-05-13 | v3.1 数字解析修复 | 支持货币符号/逗号，扩充排期规则 |
| 2026-05-14 | v3.2 全跨科 + 防垄断 | `isCrossCategory: true`、5-family limit、2x ceiling、split 保护 |
| 2026-05-15 | v3.3 复用 + 频控修正 | `isSameCategoryFamily` 替代 `===`、Round 2 真正复用、映射补全 |
| 2026-05-24 | v3.4 segment-cap + morning-discount + 一杰瑜伽修正 | `MAX_TOTAL_SEGMENTS` 硬上限、晨练 target ×0.75、品类族上限等级相关、一杰瑜伽精确映射 beauty、cloud sync race 修复、parser 逗号/+分隔符修复 |

## 核心指标

- **目标总曝光**: 487w（audience 总库存）
- **周 GMV 目标区间**: 20-25w（动态缩放强制收敛）
- **单场目标曝光**: S=600k, A=500k, B=350k, C=250k（晨练 ×0.75）
- **单场总段数上限**: S=10, A=8, B=7, C=5
- **频控**: 3天间隔、一周内最多2次、当日去重

## 关联文件

- 最新 PRD: `docs/PRD_直播排期规则_v3.4.md`
- 项目复盘: `docs/bugs/2026-05-15-category-mapping-reuse-retrospective.md`
- 全局记忆: `~/.claude/memory-log/2026-05-17-live-schedule-dashboard-v3-4-system-and-rules.md`
