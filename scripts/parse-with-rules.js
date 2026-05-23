const XLSX = require('../live-schedule-dashboard/node_modules/xlsx');
const fs = require('fs');

// ====== categoryMapping.ts 核心逻辑 ======
const CATEGORY_TO_LINE = {
  '编织工艺美学': 'interest', '茶道': 'interest', '唱歌': 'interest', '穿搭': 'beauty',
  '电子琴': 'interest', '东方食养': 'health', '东方养正瑜伽': 'beauty', '短视频': 'interest',
  '儿童健康': 'health', '风光摄影': 'interest', '钩针编织美学': 'interest', '古法居家养生': 'health',
  '固气活血': 'health', '国画1': 'interest', '国际声乐': 'interest', '国学朗诵': 'interest',
  '华佗肩颈舒活功': 'health', '健康家厨': 'health', '健康食养': 'health', '健康营养': 'health',
  '键盘乐': 'interest', '君合太极': 'health', '开心太极': 'health', '懒人吃瘦': 'beauty',
  '美学': 'health', '美学收纳': 'interest', '面部瑜伽驻颜': 'beauty', '内养太极': 'health',
  '逆龄女神瑜伽': 'beauty', '逆龄普拉提': 'beauty', '女性保养瑜伽': 'beauty', '普拉提': 'beauty',
  '普拉提S【剔除庭香】': 'beauty', '普拉提A': 'beauty', '普拉提BCD': 'beauty', '气血调理': 'health',
  '轻训营': 'health', '摄影美学': 'interest', '声乐': 'interest', '食养助长': 'health',
  '手机摄影': 'interest', '手机摄影SA': 'interest', '手机摄影BCD': 'interest', '睡眠调理': 'health',
  '私域': 'health', '塑形流瑜伽': 'beauty', '太极': 'health', '太极s': 'health', '太极A': 'health',
  '太极BCD': 'health', '体态': 'beauty', '体态塑形瑜伽': 'beauty', '体质食养': 'health',
  '五禽戏': 'health', '舞蹈': 'interest', '戏曲': 'interest', '相机摄影': 'interest',
  '形体芭蕾': 'beauty', '亚健康管理': 'health', '养正变美': 'beauty', '一杰瑜伽': 'beauty',
  '易筋经': 'health', '营养调理': 'health', '优雅舞蹈': 'interest', '油画': 'interest',
  '瑜伽': 'beauty', '瑜伽S': 'beauty', '瑜伽A': 'beauty', '瑜伽BCD': 'beauty', '瑜伽会员': 'beauty',
  '云帆太极': 'health', '真书法': 'interest', '正位塑形瑜伽': 'beauty', '中式美食制作': 'health',
  '中医变美': 'beauty', '中医瑜伽': 'beauty',
};

const CATEGORY_ALIASES = {
  '睡眠': '睡眠调理', '五禽戏': '五禽戏', '瑜伽SA': '瑜伽', '普拉提SA': '普拉提', '太极SA': '太极',
  '手机摄影BCD': '手机摄影', '摄影美学': '摄影美学', '君合太极': '君合太极', '开心太极': '开心太极',
  '内养太极': '内养太极', '云帆太极': '云帆太极', '气血': '气血调理', '固气': '固气活血',
  '中医': '中医变美', '健康': '健康营养', '食养': '健康食养', '养生': '古法居家养生', '变美': '中医变美',
  '国画': '国画1', '声乐': '声乐', '电子琴': '电子琴', '键盘乐': '键盘乐', '真书法': '真书法',
  '油画': '油画', '国学朗诵': '国学朗诵', '戏曲': '戏曲', '舞蹈': '舞蹈', '优雅舞蹈': '优雅舞蹈',
  '短视频': '短视频', '茶道': '茶道', '编织工艺美学': '编织工艺美学', '钩针编织美学': '钩针编织美学',
  '美学收纳': '美学收纳', '美学': '美学', '穿搭': '穿搭', '面部瑜伽驻颜': '面部瑜伽驻颜',
  '面部驻颜瑜伽': '面部瑜伽驻颜', '体态': '体态', '形体芭蕾': '形体芭蕾', '逆龄女神瑜伽': '逆龄女神瑜伽',
  '逆龄普拉提': '逆龄普拉提', '女性保养瑜伽': '女性保养瑜伽', '东方养正瑜伽': '东方养正瑜伽',
  '塑形流瑜伽': '塑形流瑜伽', '体态塑形瑜伽': '体态塑形瑜伽', '正位塑形瑜伽': '正位塑形瑜伽',
  '一杰瑜伽': '一杰瑜伽', '瑜伽会员': '瑜伽会员', '懒人吃瘦': '懒人吃瘦', '养正变美': '养正变美',
  '风光摄影': '风光摄影', '相机摄影': '相机摄影', '国际声乐': '国际声乐', '华佗肩颈舒活功': '华佗肩颈舒活功',
  '健康家厨': '健康家厨', '儿童健康': '儿童健康', '食养助长': '食养助长', '体质食养': '体质食养',
  '易筋经': '易筋经', '营养调理': '营养调理', '中式美食制作': '中式美食制作', '东方食养': '东方食养',
  '轻训营': '轻训营', '亚健康管理': '亚健康管理', '亚健康': '亚健康管理', '私域': '私域',
  '古法居家': '古法居家养生', '居家古法': '古法居家养生', '华佗肩颈': '华佗肩颈舒活功',
  '面部瑜伽': '面部瑜伽驻颜', '逆龄女神': '逆龄女神瑜伽', '女性保养': '女性保养瑜伽',
  '东方养正': '东方养正瑜伽', '塑形流': '塑形流瑜伽', '正位塑形': '正位塑形瑜伽', '体态塑形': '体态塑形瑜伽',
};

function normalizeCategory(name) {
  const s = name.trim(); if (!s) return '';
  if (CATEGORY_TO_LINE[s]) return s;
  if (CATEGORY_ALIASES[s]) return CATEGORY_ALIASES[s];
  const separators = ['-', '—', '–', '|', '·', '•', 'x', 'X', '×', '、'];
  for (const sep of separators) {
    const idx = s.indexOf(sep);
    if (idx > 0) {
      const prefix = s.slice(0, idx).trim();
      if (CATEGORY_TO_LINE[prefix]) return prefix;
      if (CATEGORY_ALIASES[prefix]) return CATEGORY_ALIASES[prefix];
    }
  }
  let bestCanonical = '';
  for (const canonical of Object.keys(CATEGORY_TO_LINE)) {
    if (s.includes(canonical) && canonical.length > bestCanonical.length) bestCanonical = canonical;
  }
  if (bestCanonical) return bestCanonical;
  let bestAlias = '', bestAliasCanonical = '';
  for (const [alias, canonical] of Object.entries(CATEGORY_ALIASES)) {
    if (s.includes(alias) && alias.length > bestAlias.length) { bestAlias = alias; bestAliasCanonical = canonical; }
  }
  if (bestAliasCanonical) return bestAliasCanonical;
  return s;
}

function parseLineFromCategory(category) {
  const canonical = normalizeCategory(category);
  return CATEGORY_TO_LINE[canonical] || null;
}

function inferCategory(name) {
  const LIVE_NAME_TO_CATEGORY = { '唱歌李燃': '国际声乐' };
  const directMap = LIVE_NAME_TO_CATEGORY[name.trim()];
  if (directMap) return directMap;
  const normalized = normalizeCategory(name);
  if (normalized !== name.trim()) return normalized;
  const separators = ['-', '—', '–', '|', '·', '•', '、'];
  for (const sep of separators) {
    const idx = name.indexOf(sep);
    if (idx > 0) {
      const prefix = name.slice(0, idx).trim();
      if (prefix.length >= 2) {
        const prefixNormalized = normalizeCategory(prefix);
        if (prefixNormalized !== prefix) return prefixNormalized;
        return prefix;
      }
    }
  }
  const s = name.toLowerCase();
  if (s.includes('健康营养')) return '健康营养';
  if (s.includes('太极')) return '太极';
  if (s.includes('五禽戏')) return '五禽戏';
  if (s.includes('睡眠')) return '睡眠调理';
  if (s.includes('中医') || s.includes('变美')) return '中医变美';
  if (s.includes('普拉提')) return '普拉提';
  if (s.includes('瑜伽')) return '瑜伽';
  if (s.includes('摄影')) return '手机摄影';
  if (s.includes('唱歌')) return '唱歌';
  if (s.includes('短视频')) return '短视频';
  if (s.includes('朗诵')) return '国学朗诵';
  if (s.includes('茶道')) return '茶道';
  if (s.includes('编织') || s.includes('钩针')) return '编织工艺美学';
  if (s.includes('穿搭')) return '穿搭';
  if (s.includes('国画')) return '国画1';
  if (s.includes('声乐')) return '声乐';
  if (s.includes('电子琴') || s.includes('键盘')) return '电子琴';
  if (s.includes('书法')) return '真书法';
  if (s.includes('油画')) return '油画';
  if (s.includes('戏曲')) return '戏曲';
  if (s.includes('舞蹈')) return '舞蹈';
  if (s.includes('易筋经')) return '易筋经';
  if (s.includes('气血')) return '气血调理';
  if (s.includes('固气')) return '固气活血';
  if (s.includes('养生')) return '古法居家养生';
  if (s.includes('食养')) return '健康食养';
  if (s.includes('营养')) return '营养调理';
  if (s.includes('儿童')) return '儿童健康';
  if (s.includes('体态')) return '体态';
  if (s.includes('形体')) return '形体芭蕾';
  if (s.includes('面部')) return '面部瑜伽驻颜';
  if (s.includes('懒人')) return '懒人吃瘦';
  if (s.includes('东方食养')) return '东方食养';
  if (s.includes('亚健')) return '亚健康管理';
  if (s.includes('私域')) return '私域';
  if (s.includes('轻训')) return '轻训营';
  if (s.includes('家厨')) return '健康家厨';
  if (s.includes('养正')) return '东方养正瑜伽';
  if (s.includes('焕醒') || s.includes('晨练')) return '瑜伽';
  if (s.includes('节气')) return '健康营养';
  return name;
}

// ====== parser.ts 核心逻辑 ======
function normCell(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (s === 'NaN') return '';
  return s;
}

function detectSlot(resourceName) {
  const s = String(resourceName || '').toLowerCase();
  if (s.includes('晨练') || s.includes('早间')) return 'morning';
  if (s.includes('晚ip') || s.includes('晚播') || s.includes('晚间') || s.includes('晚上平播')) return 'evening';
  if (s.includes('伪直播') || s.includes('复用')) {
    if (s.includes('7:') || s.includes('8:') || s.includes('晨练')) return 'fake-morning';
    return 'fake-evening';
  }
  if (s.includes('朋友圈') || s.includes('视频号')) return 'friend-circle';
  return 'evening';
}

function hasDayData(row, startCol = 2) {
  return row.slice(startCol, 9).some(c => normCell(c) !== '');
}

function isBlockHeaderRow(col0) {
  return !!col0 && (
    col0.includes('早间') || col0.includes('晚IP') || col0.includes('晚上') ||
    col0.includes('朋友圈') || col0.includes('视频号') || col0.includes('伪直播') || col0.includes('复用')
  );
}

function isMetadataRow(c0, c1) {
  return (
    c1 === '文案负责人' || c0 === '定时负责人' || c1 === '曝光量级' ||
    c1 === '健康线' || c1 === '变美线' || c1 === '兴趣线'
  );
}

function buildFullDate(sheetName, dayStr) {
  let month;
  const m = sheetName.match(/(\d+)月/);
  if (m) month = parseInt(m[1], 10);
  let day;
  const dotParts = dayStr.split('.');
  if (dotParts.length === 2) {
    day = parseInt(dotParts[1], 10);
    if (!month) month = parseInt(dotParts[0], 10);
  } else {
    day = parseInt(dayStr, 10);
  }
  if (isNaN(day)) return dayStr;
  const year = new Date().getFullYear();
  return `${year}-${String(month || 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseMergedLiveCell(merged, slot) {
  const rawLines = merged.split('\n').map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return [];

  const timeRangeRegex = /(\d{1,2}[：:]\d{2})\s*[-~－]\s*(\d{1,2}[：:]\d{2})/;
  const liveNames = [];
  const timeMatches = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (timeRangeRegex.test(line)) {
      const m = line.match(timeRangeRegex);
      if (m) timeMatches.push({ start: m[1].replace('：', ':'), end: m[2].replace('：', ':') });
      continue;
    }
    if (
      line.includes('开播时间') || line.includes('预约链接') || line.includes('直播间ID') ||
      line.includes('复用') || line.includes('需剪辑') || line.includes('已有单课id') ||
      line.includes('不回捞') || /^【.+】$/.test(line)
    ) {
      continue;
    }
    if (/^\d+\.\d+$/.test(line) && parseFloat(line) < 1) continue;
    liveNames.push(line);
  }

  // 早间晨练：同单元格多行 = 联合直播
  if (slot === 'morning' && liveNames.length > 1) {
    const categories = liveNames.map(name => inferCategory(name.replace('晨练', '').trim()));
    const startTime = timeMatches.length > 0 ? timeMatches[0].start : '07:30';
    const endTime = timeMatches.length > 0 ? timeMatches[timeMatches.length - 1].end : '10:00';
    return [{
      name: liveNames.join(' + '),
      category: categories[0],
      categories,
      isJoint: true,
      startTime, endTime,
    }];
  }

  // Single live fallback
  let name = liveNames[0] || rawLines[0];
  if (liveNames.length > 1 && inferCategory(name) === name) {
    for (let i = 1; i < liveNames.length; i++) {
      if (inferCategory(liveNames[i]) !== liveNames[i]) {
        name = liveNames[i];
        break;
      }
    }
  }
  let startTime = timeMatches.length > 0 ? timeMatches[0].start : (slot.includes('morning') ? '07:30' : '19:00');
  let endTime = timeMatches.length > 0 ? timeMatches[0].end : (slot.includes('morning') ? '09:00' : '21:00');

  if (name) {
    return [{
      name,
      category: inferCategory(name),
      isJoint: false,
      startTime, endTime,
    }];
  }
  return [];
}

// ====== 主解析逻辑 ======
const filePath = process.argv[2] || '我的排期5.18-5.24.xlsx';
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

const headerRowIdx = (() => {
  for (let r = 0; r < Math.min(json.length, 10); r++) {
    if (normCell(json[r]?.[0]) === '星期') return r;
  }
  return -1;
})();
const dateRowIdx = (() => {
  for (let r = headerRowIdx + 1; r < Math.min(json.length, headerRowIdx + 3); r++) {
    if (normCell(json[r]?.[0]) === '日期') return r;
  }
  return -1;
})();

const headerRow = json[headerRowIdx] || [];
const dateRow = json[dateRowIdx] || [];
const startCol = (normCell(headerRow[1]) !== '' && normCell(dateRow[1]) !== '') ? 1 : 2;

const weekDays = [];
for (let col = startCol; col < headerRow.length && col <= 8; col++) {
  const label = normCell(headerRow[col]);
  const dateVal = normCell(dateRow[col]);
  if (label && dateVal) {
    weekDays.push({ label, date: dateVal, fullDate: buildFullDate('5月', dateVal) });
  }
}

let currentSlot = 'morning';
let rowIdx = dateRowIdx + 1;
const lives = [];
const slotDayExposure = new Map();
const slotDayOwner = new Map();

while (rowIdx < json.length) {
  const row = json[rowIdx];
  if (!row || row.length < 3) { rowIdx++; continue; }

  const col0 = normCell(row[0]);
  const col1 = normCell(row[1]);

  if (isBlockHeaderRow(col0)) {
    currentSlot = detectSlot(col0);
  }

  if (!hasDayData(row, startCol)) { rowIdx++; continue; }
  if (col0 === '星期' || col0 === '日期') { rowIdx++; continue; }

  if (isMetadataRow(col0, col1)) {
    if (col1 === '文案负责人' || col0 === '定时负责人') {
      for (let col = startCol; col <= 8; col++) {
        const owner = normCell(row[col]);
        if (!owner) continue;
        const day = weekDays[col - startCol];
        if (!day) continue;
        slotDayOwner.set(`${currentSlot}-${day.fullDate}`, owner);
      }
    } else if (col1 === '曝光量级') {
      for (let col = startCol; col <= 8; col++) {
        const raw = normCell(row[col]);
        if (!raw) continue;
        const exposure = Number(raw.replace(/,/g, ''));
        if (isNaN(exposure)) continue;
        const day = weekDays[col - startCol];
        if (!day) continue;
        slotDayExposure.set(`${currentSlot}-${day.fullDate}`, exposure);
      }
    }
    rowIdx++;
    continue;
  }

  // Collect consecutive live-info rows
  const liveInfoRows = [];
  let r = rowIdx;
  while (r < json.length) {
    const curRow = json[r];
    if (!curRow || curRow.length < 3) { r++; continue; }
    const c0 = normCell(curRow[0]);
    const c1 = normCell(curRow[1]);
    if (isBlockHeaderRow(c0) && r > rowIdx) break;
    if (isMetadataRow(c0, c1)) break;
    if (c0 === '' && /【.+】/.test(c1) && !hasDayData(curRow, startCol)) { r++; continue; }
    if (!hasDayData(curRow, startCol)) { r++; continue; }
    liveInfoRows.push(curRow);
    r++;
  }

  for (let col = startCol; col <= 8; col++) {
    const lines = [];
    for (const lr of liveInfoRows) {
      const cell = normCell(lr[col]);
      if (cell) lines.push(cell);
    }
    if (lines.length === 0) continue;
    const merged = lines.join('\n');
    const day = weekDays[col - startCol];
    if (!day) continue;

    const parsed = parseMergedLiveCell(merged, currentSlot);
    for (const p of parsed) {
      lives.push({
        ...p,
        date: day.fullDate,
        slot: currentSlot,
        owner: slotDayOwner.get(`${currentSlot}-${day.fullDate}`) || '',
        exposure: slotDayExposure.get(`${currentSlot}-${day.fullDate}`) || 0,
        dayLabel: day.label,
      });
    }
  }

  rowIdx = r;
}

// 输出结果
console.log('=== 解析结果 ===\n');
for (const live of lives) {
  const line = parseLineFromCategory(live.category) || 'unknown';
  const status = line === 'unknown' ? ' [⚠️ 品类无法识别]' : '';
  console.log(`${live.dayLabel} ${live.date} | ${live.slot} | ${live.name} | 品类:${live.category} | 线:${line}${status} | 负责人:${live.owner} | 曝光:${live.exposure}`);
  if (live.isJoint) {
    console.log(`  联合直播子品类: ${live.categories.join(', ')}`);
  }
}

// 统计问题
console.log('\n=== 问题统计 ===');
const unknownCats = lives.filter(l => !parseLineFromCategory(l.category));
console.log(`品类无法识别的直播: ${unknownCats.length} 个`);
for (const l of unknownCats) {
  console.log(`  - ${l.dayLabel} ${l.slot}: "${l.name}" → 推断为 "${l.category}"`);
}

const noOwner = lives.filter(l => !l.owner);
console.log(`\n缺少负责人的直播: ${noOwner.length} 个`);
for (const l of noOwner) {
  console.log(`  - ${l.dayLabel} ${l.slot}: ${l.name}`);
}

const noExposure = lives.filter(l => !l.exposure);
console.log(`\n缺少曝光的直播: ${noExposure.length} 个`);
for (const l of noExposure) {
  console.log(`  - ${l.dayLabel} ${l.slot}: ${l.name}`);
}
