const XLSX = require('xlsx');
const fs = require('fs');

function normCell(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s === 'null' || s === 'undefined' ? '' : s;
}

function detectSlot(label) {
  const s = label;
  if (s.includes('晨练') || s.includes('早间')) return '晨练';
  if (s.includes('晚IP') || s.includes('晚间')) return '晚间';
  if (s.includes('伪直播') && s.includes('早')) return '伪直播-早';
  if (s.includes('伪直播') && s.includes('晚')) return '伪直播-晚';
  if (s.includes('朋友圈')) return '朋友圈';
  return '晚间';
}

function parseNumber(str) {
  const n = parseInt(String(str).replace(/,/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function buildFullDate(dateStr) {
  const d = parseInt(dateStr, 10);
  return `2026-05-${String(d).padStart(2, '0')}`;
}

function isBlockHeader(row) {
  const col0 = normCell(row[0]);
  const col1 = normCell(row[1]);
  return col0.includes('早间') || col0.includes('晚IP') || col0.includes('伪直播') || col0.includes('朋友圈') ||
         col1.includes('【晨练】') || col1.includes('【晚间】');
}

function main() {
  const filePath = process.argv[2] || '/Users/zhengkeying/直播间排期策略/我的排期5.18-5.24.xlsx';
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const weekdays = [];
  const dateRow = rows[1];
  for (let col = 2; col < 9; col++) {
    weekdays.push({
      label: normCell(rows[0][col]),
      date: buildFullDate(normCell(dateRow[col])),
    });
  }

  const feishuRows = [];

  // Identify blocks
  const blocks = [];
  let blockStart = 2; // First data row after headers
  let currentSlot = '晨练';

  for (let r = 2; r < rows.length; r++) {
    if (isBlockHeader(rows[r])) {
      const col0 = normCell(rows[r][0]);
      const col1 = normCell(rows[r][1]);
      const slot = detectSlot(col0 + col1);

      // End previous block (if any)
      if (r > blockStart) {
        blocks.push({ start: blockStart, end: r - 1, slot: currentSlot });
      }

      // Start new block from this row
      blockStart = r;
      currentSlot = slot;
    }
  }
  // Final block
  if (blockStart < rows.length) {
    blocks.push({ start: blockStart, end: rows.length - 1, slot: currentSlot });
  }

  console.log('Found', blocks.length, 'blocks');
  blocks.forEach(b => console.log('Block', b.slot, 'rows', b.start, '-', b.end));

  // Process each block
  for (const block of blocks) {
    const slot = block.slot;
    const blockRows = rows.slice(block.start, block.end + 1);

    // Find live name rows (rows before 文案负责人/曝光量级)
    const liveNames = {}; // col -> liveName
    const liveTimes = {}; // col -> time

    for (let br = 0; br < blockRows.length; br++) {
      const col1 = normCell(blockRows[br][1]);
      if (col1.includes('文案负责人') || col1.includes('曝光量级') ||
          col1.includes('健康线') || col1.includes('变美线') || col1.includes('兴趣线')) {
        break;
      }

      for (let col = 2; col < 9; col++) {
        const cell = normCell(blockRows[br][col]);
        if (!cell) continue;

        // Time range
        if (/^\d{1,2}[：:]\d{2}\s*[-~]\s*\d{1,2}[：:]\d{2}$/.test(cell)) {
          if (!liveTimes[col]) liveTimes[col] = cell;
          continue;
        }
        // Single time
        if (/^\d{1,2}[：:]\d{2}$/.test(cell)) {
          if (!liveTimes[col]) liveTimes[col] = cell;
          continue;
        }
        // Excel time values
        if (/^\d+\.\d+$/.test(cell)) continue;
        // Skip meta markers
        if (cell.includes('【存量】') || cell.includes('文案负责人') || cell.includes('曝光量级')) continue;
        if (cell.includes('健康线') || cell.includes('变美线') || cell.includes('兴趣线')) continue;
        if (cell.includes('年') && cell.includes('—')) continue;
        if (/\(\d+\)/.test(cell) && !cell.includes('-')) continue;

        // Live name (keep first non-time value per column)
        if (!liveNames[col]) liveNames[col] = cell;
      }
    }

    // Find owners
    const owners = {};
    for (let br = 0; br < blockRows.length; br++) {
      const col1 = normCell(blockRows[br][1]);
      if (col1.includes('文案负责人') || col1.includes('定时负责人')) {
        for (let col = 2; col < 9; col++) {
          const cell = normCell(blockRows[br][col]);
          if (cell) owners[col] = cell;
        }
        break;
      }
    }

    // Find exposures
    const exposures = {};
    for (let br = 0; br < blockRows.length; br++) {
      const col1 = normCell(blockRows[br][1]);
      if (col1.includes('曝光量级')) {
        for (let col = 2; col < 9; col++) {
          const cell = normCell(blockRows[br][col]);
          if (cell) exposures[col] = parseNumber(cell);
        }
        break;
      }
    }

    // Create live rows
    for (const col of Object.keys(liveNames)) {
      const colNum = parseInt(col);
      const dayIdx = colNum - 2;
      if (dayIdx >= weekdays.length) continue;
      const day = weekdays[dayIdx];
      const name = liveNames[col];
      const time = liveTimes[col] || '';
      const liveName = time ? `${name}|${time}` : name;

      feishuRows.push({
        date: day.date, weekday: day.label, slot, rowType: '直播名',
        liveName, owner: '', exposure: 0,
        audienceCategory: '', audienceTimeRange: '', audienceCount: 0, audienceLine: '', isStock: false,
      });

      if (owners[col]) {
        feishuRows.push({
          date: day.date, weekday: day.label, slot, rowType: '文案负责人',
          liveName, owner: owners[col], exposure: 0,
          audienceCategory: '', audienceTimeRange: '', audienceCount: 0, audienceLine: '', isStock: false,
        });
      }

      if (exposures[col]) {
        feishuRows.push({
          date: day.date, weekday: day.label, slot, rowType: '曝光量级',
          liveName, owner: '', exposure: exposures[col],
          audienceCategory: '', audienceTimeRange: '', audienceCount: 0, audienceLine: '', isStock: false,
        });
      }
    }

    // Parse audience data
    let inAudience = false;
    let currentLine = '';
    let bufferRows = [];

    for (let br = 0; br < blockRows.length; br++) {
      const col0 = normCell(blockRows[br][0]);
      const col1 = normCell(blockRows[br][1]);

      // Detect line headers
      if (col1.includes('健康线')) { inAudience = true; currentLine = '健康线'; bufferRows = []; continue; }
      if (col1.includes('变美线')) { inAudience = true; currentLine = '变美线'; bufferRows = []; continue; }
      if (col1.includes('兴趣线')) { inAudience = true; currentLine = '兴趣线'; bufferRows = []; continue; }

      if (!inAudience) continue;

      // Check for block end
      if (col0.includes('晚IP') || col0.includes('伪直播') || col0.includes('早间') || col0.includes('朋友圈') ||
          col1.includes('直播资源位分布')) {
        inAudience = false;
        continue;
      }

      bufferRows.push(blockRows[br]);

      // Parse audience when buffer has 3 rows
      if (bufferRows.length >= 3) {
        for (let col = 2; col < 9; col++) {
          const dayIdx = col - 2;
          if (dayIdx >= weekdays.length) continue;
          const day = weekdays[dayIdx];
          const liveName = liveNames[col];
          if (!liveName) continue;

          let timeRange = '';
          let category = '';
          let count = 0;

          for (const arow of bufferRows) {
            const cell = normCell(arow[col]);
            if (!cell) continue;

            if (cell.includes('【存量】')) {
              const remainder = cell.replace('【存量】', '').trim();
              if (remainder) timeRange = remainder;
              continue;
            }
            if (!timeRange && /年.*—/.test(cell)) {
              timeRange = cell;
              continue;
            }
            const match = cell.match(/(.+?)[（(](\d+)[）)]/);
            if (match && timeRange) {
              category = match[1].trim();
              count = parseInt(match[2], 10);

              feishuRows.push({
                date: day.date, weekday: day.label, slot, rowType: 'audience',
                liveName, owner: '', exposure: 0,
                audienceCategory: category, audienceTimeRange: timeRange, audienceCount: count,
                audienceLine: currentLine, isStock: true,
              });

              timeRange = '';
              category = '';
              count = 0;
            }
          }
        }
        bufferRows = [];
      }
    }
  }

  console.log('Total rows:', feishuRows.length);
  console.log('Live rows:', feishuRows.filter(r => r.rowType === '直播名').length);
  console.log('Audience rows:', feishuRows.filter(r => r.rowType === 'audience').length);
  console.log('Sample live rows:', feishuRows.filter(r => r.rowType === '直播名').slice(0, 5));
  console.log('Sample audience rows:', feishuRows.filter(r => r.rowType === 'audience').slice(0, 5));

  // Save as JSON
  fs.writeFileSync('/Users/zhengkeying/直播间排期策略/scripts/feishu-rows.json', JSON.stringify(feishuRows, null, 2));
  console.log('\nSaved to feishu-rows.json');

  // Save as CSV
  const headers = ['date', 'weekday', 'slot', 'rowType', 'liveName', 'owner', 'exposure', 'audienceCategory', 'audienceTimeRange', 'audienceCount', 'audienceLine', 'isStock'];
  const csvLines = [headers.join(',')];
  for (const row of feishuRows) {
    const values = headers.map(h => {
      const v = row[h];
      if (typeof v === 'string' && v.includes(',')) return `"${v.replace(/"/g, '""')}"`;
      return String(v);
    });
    csvLines.push(values.join(','));
  }
  fs.writeFileSync('/Users/zhengkeying/直播间排期策略/scripts/feishu-rows.csv', csvLines.join('\n'));
  console.log('Saved to feishu-rows.csv');
}

main();
