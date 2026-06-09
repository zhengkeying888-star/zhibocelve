const testCases = [
  '2023年1月—2026年5月17日 普拉提A（105,511）',
  '2023年1月—2026年5月24日 中医变美（177,822）',
  '2025年5月12日—2026年5月24日 唱歌（371,961）',
  '2023年1月1日—2026年5月24日',
  '2023年1月—2025年5月11日 太极BCD(292030)',
  '2025年11月10日—2026年2月8日 太极A（36,371）',
]

const regex1 = /(\d{4}[年.].*?[\-~—]\s*\d{4}[年.].*?)/
const regex2 = /(\d{4}[年.][\d\s月日.,]*[\-~—]\s*\d{4}[年.][\d\s月日.,]*)/

console.log('=== Regex Test ===\n')
for (const tc of testCases) {
  const m1 = tc.match(regex1)
  const m2 = tc.match(regex2)
  console.log(`Input: ${tc}`)
  console.log(`  regex1: ${m1 ? m1[1] : 'NO MATCH'}`)
  console.log(`  regex2: ${m2 ? m2[1] : 'NO MATCH'}`)
  console.log('')
}
