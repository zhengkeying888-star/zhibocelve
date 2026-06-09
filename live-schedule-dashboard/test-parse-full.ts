import { parseScheduleWorkbook } from './src/utils/parser'
import * as fs from 'fs'

const filePath = '../6月8-14排期.xlsx'
const buf = fs.readFileSync(filePath)
// Convert Buffer to ArrayBuffer
const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

const result = parseScheduleWorkbook(arrayBuf, filePath)
console.log('lives count:', result.lives.length)
console.log('weekDays count:', result.weekDays.length)
console.log('audienceSegments count:', result.audienceSegments.length)
console.log('historyRecords count:', result.historyRecords.length)

for (const live of result.lives.slice(0, 5)) {
  console.log('Live:', live.name, '|', live.date, '|', live.slot, '| type:', live.type, '| grade:', live.grade, '| cat:', live.category)
}
