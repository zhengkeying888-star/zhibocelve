import { normalizeCategory, parseLineFromCategory } from '../live-schedule-dashboard/src/utils/categoryMapping'

const tests = [
  '【存量】2023年1月—2026年5月24日 太极BCD',
  '【存量】2023年1月—2026年5月24日 太极A',
  '太极BCD',
  '2023年1月—2026年5月24日 太极BCD',
  '卖摄影美学例子',
]

for (const t of tests) {
  const norm = normalizeCategory(t)
  const line = parseLineFromCategory(norm)
  console.log(`"${t}" → normalize: "${norm}" → line: ${line}`)
}
