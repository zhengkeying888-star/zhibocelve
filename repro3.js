const XLSX = require('./live-schedule-dashboard/node_modules/xlsx');

function normCell(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (s === 'NaN') return '';
  return s;
}

function isBlockHeaderRow(col0) {
  return !!col0 && (
    col0.includes('早间') ||
    col0.includes('晚IP') ||
    col0.includes('晚上') ||
    col0.includes('朋友圈') ||
    col0.includes('视频号') ||
    col0.includes('伪直播') ||
    col0.includes('复用')
  );
}

function hasDayData(row) {
  return row.slice(2, 9).some((c) => normCell(c) !== '');
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

function isMetadataRow(c0, c1) {
  return (
    c1 === '文案负责人' ||
    c0 === '定时负责人' ||
    c1 === '曝光量级' ||
    c1 === '健康线' ||
    c1 === '变美线' ||
    c1 === '兴趣线'
  );
}

function findHeaderRow(json) {
  for (let r = 0; r < Math.min(json.length, 10); r++) {
    if (normCell(json[r]?.[0]) === '星期') return r;
  }
  return -1;
}

function findDateRow(json, startFrom) {
  for (let r = startFrom; r < Math.min(json.length, startFrom + 3); r++) {
    if (normCell(json[r]?.[0]) === '日期') return r;
  }
  return -1;
}

function isScheduleSheet(sheetJson) {
  const hr = findHeaderRow(sheetJson);
  if (hr === -1) return false;
  const dr = findDateRow(sheetJson, hr + 1);
  return dr !== -1;
}

function pickCurrentScheduleSheet(workbook) {
  const candidates = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!isScheduleSheet(json)) continue;
    if (sheetName.includes('用户量级') || sheetName.includes('各线人数')) continue;
    let priority = 0;
    if (sheetName.includes('5月')) priority += 100;
    else if (sheetName.includes('4月')) priority += 50;
    if (sheetName.includes('排期')) priority += 10;
    if (sheetName.includes('月度')) priority += 5;
    candidates.push({ sheetName, json, priority });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.priority - a.priority);
  return { sheetName: candidates[0].sheetName, json: candidates[0].json };
}

const wb = XLSX.readFile('5月18-24排期.xlsx');
const picked = pickCurrentScheduleSheet(wb);

console.log('schedulePicked:', picked ? picked.sheetName : null);

if (picked) {
  const json = picked.json;
  console.log('Total rows:', json.length);
  console.log('Header row idx:', findHeaderRow(json));
  console.log('Date row idx:', findDateRow(json, findHeaderRow(json) + 1));

  // Count rows with day data
  let dayDataRows = 0;
  for (let i = 0; i < json.length; i++) {
    if (hasDayData(json[i])) dayDataRows++;
  }
  console.log('Rows with day data:', dayDataRows);

  // Print first 20 rows
  for (let i = 0; i < Math.min(json.length, 20); i++) {
    const row = json[i];
    const c0 = normCell(row?.[0]);
    const c1 = normCell(row?.[1]);
    console.log(`Row ${i}: col0="${c0}" col1="${c1}" hasDayData=${hasDayData(row)}`);
  }
}
