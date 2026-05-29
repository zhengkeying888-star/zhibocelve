import { parseMergedLiveCell } from '../src/utils/parser'

const cell = `【上次直播排期】2026年2月2日—2026年5月17日
太极s（167,123）
2023年1月—2025年5月4日
五禽戏（83,087）
2023年1月—2026年5月17日
睡眠调理（105164）
2025年11月3日—2026年2月
太极BCD（66,980）
2025年5月5日—2026年2月1日
太极A（92637）
2023年1月1日—2026年5月17日
固气（47176）`

const day = { label: '周五', date: '5', fullDate: '2026-06-05' } as any
const result = parseMergedLiveCell(cell, day, 'fake-evening')
console.log('parsed lives:', result.map(l => `${l.name} cat=${l.category} fake=${l.fakeHistoryAudiences?.length || 0}`))
