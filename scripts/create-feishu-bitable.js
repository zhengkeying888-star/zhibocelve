const fs = require('fs');
const path = require('path');

// Load credentials from config.json (gitignored)
const configPath = path.join(__dirname, 'config.json');
let config = {};
try {
  const raw = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(raw);
} catch {
  console.error('Error: config.json not found or invalid. Please fill in your appId and appSecret in scripts/config.json');
  process.exit(1);
}

if (!config.appId || !config.appSecret) {
  console.error('Error: appId and appSecret are required in scripts/config.json');
  process.exit(1);
}

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

async function getTenantAccessToken(appId, appSecret) {
  const res = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json();
  if (!data.tenant_access_token) {
    throw new Error(`Failed to get token: ${data.msg}`);
  }
  return data.tenant_access_token;
}

async function createBitable(token, folderToken, name) {
  const res = await fetch(`${FEISHU_API_BASE}/bitable/v1/apps`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name,
      folder_token: folderToken || undefined,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Create bitable failed: ${data.msg}`);
  }
  return {
    appToken: data.data?.app?.app_token,
    tableId: data.data?.app?.default_table_id,
    url: data.data?.app?.url,
  };
}

async function addField(token, appToken, tableId, field) {
  const res = await fetch(
    `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        field_name: field.name,
        type: field.type,
        property: field.property || undefined,
      }),
    }
  );
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Add field "${field.name}" failed: ${data.msg}`);
  }
  return data.data;
}

async function addFields(token, appToken, tableId, fields) {
  for (const field of fields) {
    await addField(token, appToken, tableId, field);
    console.log(`  Added field: ${field.name}`);
  }
}

async function batchCreateRecords(token, appToken, tableId, records) {
  const body = { records: records.map((r) => ({ fields: r })) };
  const res = await fetch(
    `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Batch create records failed: ${data.msg}`);
  }
  return data.data;
}

async function main() {
  console.log('Getting access token...');
  const token = await getTenantAccessToken(config.appId, config.appSecret);
  console.log('Token acquired');

  // Create bitable
  const weekTitle = '排期5.18-5.24';
  console.log(`Creating bitable: ${weekTitle}...`);
  const { appToken, tableId, url } = await createBitable(token, config.folderToken, weekTitle);
  console.log(`Created: ${url}`);
  console.log(`Table ID: ${tableId}`);

  // Load converted data
  const rowsPath = path.join(__dirname, 'feishu-rows.json');
  const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf-8'));
  console.log(`Loaded ${rows.length} rows`);

  // Convert date strings to timestamps for Feishu Date fields
  for (const row of rows) {
    if (row.date) {
      row.date = new Date(row.date).getTime();
    }
  }

  // Add fields
  console.log('Adding fields...');
  await addFields(token, appToken, tableId, [
    { name: 'date', type: 5 }, // Date
    { name: 'weekday', type: 1 }, // Text
    { name: 'slot', type: 3, property: { options: [{ name: '晨练' }, { name: '晚间' }, { name: '伪直播-早' }, { name: '伪直播-晚' }, { name: '朋友圈' }] } },
    { name: 'liveName', type: 1 },
    { name: 'category', type: 1 },
    { name: 'line', type: 3, property: { options: [{ name: '健康线' }, { name: '变美线' }, { name: '兴趣线' }] } },
    { name: 'owner', type: 1 },
    { name: 'exposure', type: 2 }, // Number
    { name: 'healthAudience', type: 1 },
    { name: 'beautyAudience', type: 1 },
    { name: 'interestAudience', type: 1 },
    { name: 'isJoint', type: 7 }, // Checkbox
    { name: 'isCrossCategory', type: 7 }, // Checkbox
  ]);

  // Batch create records (max 500 per call)
  console.log('Writing records...');
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await batchCreateRecords(token, appToken, tableId, batch);
    console.log(`Written ${Math.min(i + batchSize, rows.length)} / ${rows.length}`);
  }

  console.log('\nDone!');
  console.log('Bitable URL:', url);
  console.log('App Token:', appToken);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
