import { createServer } from 'vite'
import fs from 'node:fs'

globalThis.localStorage = {
  getItem: (key) => (key === 'schedule_data_version' ? 'v3.4-fake-reuse-redline-20260608' : null),
  setItem: () => {},
  removeItem: () => {},
}

function readArrayBuffer(path) {
  const buf = fs.readFileSync(path)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })

try {
  const { createPinia, setActivePinia } = await vite.ssrLoadModule('pinia')
  const { useScheduleStore } = await vite.ssrLoadModule('/src/stores/schedule.ts')
  const {
    parseAudienceSheet,
    parseCrossPrefSheet,
    parseLiveDetailSheet,
    parseScheduleWorkbook,
  } = await vite.ssrLoadModule('/src/utils/parser.ts')

  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useScheduleStore(pinia)

  const schedule = parseScheduleWorkbook(readArrayBuffer('../6月8-14排期.xlsx'), '6月8-14排期.xlsx')
  const audience = parseAudienceSheet(readArrayBuffer('../6.8-14排期人数.xlsx'))
  const cross = parseCrossPrefSheet(readArrayBuffer('../转继承新增用户day60跨科品类.xlsx'))
  const liveStats = parseLiveDetailSheet(readArrayBuffer('../直播明细表.xlsx'))

  store.liveStreams = schedule.lives
  store.weekDays = schedule.weekDays
  store.audienceSegments = audience
  store.crossPrefs = cross.crossPrefs
  store.crossCategoryPrefs = cross.crossCategoryPrefs
  store.categoryHistoricalStats = liveStats
  store.applyNameOverrides()
  store.applyCategoryGrades()

  await store.autoSchedule()

  const targets = ['国际声乐', '短视频', '懒人吃瘦', '东方养正瑜伽', '居家古法']
  for (const live of store.liveStreams.filter((l) => targets.some((t) => l.name.includes(t)))) {
    console.log(`LIVE\t${live.name}\t${live.date}\t${live.line}\t${live.type}\t${live.exposure}\t${live.assignedAudiences.length}`)
    for (const a of live.assignedAudiences) {
      console.log(`  AUD\t${a.line}\t${a.category}\t${a.count}\t${a.timeRange}`)
    }
  }

  const crossLineViolations = store.liveStreams.flatMap((live) =>
    live.assignedAudiences
      .filter((a) => {
        const allowed =
          live.isJoint && live.lines?.length
            ? live.lines
            : live.category === '茶道'
              ? ['interest', 'health']
              : live.category === '东方养正瑜伽' && live.line === 'beauty'
                ? ['beauty', 'health']
                : [live.line]
        return !allowed.includes(a.line)
      })
      .map((a) => `${live.name}:${a.line}:${a.category}`),
  )
  console.log('CROSS_LINE_VIOLATIONS', crossLineViolations.length, crossLineViolations.join('|'))

  const remainingByLine = store.audienceSegments.reduce((acc, seg) => {
    if (seg.status === 'available') acc[seg.line] = (acc[seg.line] || 0) + seg.count
    return acc
  }, {})
  console.log('REMAINING_BY_LINE', JSON.stringify(remainingByLine))
} finally {
  await vite.close()
}
