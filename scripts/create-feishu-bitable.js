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
  const res = await fetch(`${FEISHU_API_BASE}/drive/v1/files`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name,
      type: 'bitable',
      folder_token: folderToken || undefined,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Create bitable failed: ${data.msg}`);
  }
  return {
    appToken: data.data?.token,
    url: data.data?.url,
  };
}

async function addFields(token, appToken, tableId, fields) {
  const requests = fields.map((f) => ({
    field_name: f.name,
    type: f.type,
    property: f.property || undefined,
  }));

  const res = await fetch(
    `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/fields/batch_create`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requests }),
    }
  );
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Add fields failed: ${data.msg}`);
  }
  return data.data;
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
  const { appToken, url } = await createBitable(token, config.folderToken, weekTitle);
  console.log(`Created: ${url}`);

  // The first table is created automatically, get its ID
  const tablesRes = await fetch(`${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const tablesData = await tablesRes.json();
  const tableId = tablesData.data?.items?.[0]?.table_id;
  console.log(`Table ID: ${tableId}`);

  // Load converted data
  const rowsPath = path.join(__dirname, 'feishu-rows.json');
  const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf-8'));
  console.log(`Loaded ${rows.length} rows`);

  // Add fields
  console.log('Adding fields...');
  await addFields(token, appToken, tableId, [
    { name: 'date', type: 5 }, // Date
    { name: 'weekday', type: 1 }, // Text
    { name: 'slot', type: 3, property: { options: [{ name: '晨练' }, { name: '晚间' }, { name: '伪直播-早' }, { name: '伪直播-晚' }, { name: '朋友圈' }] } },
    { name: 'rowType', type: 3, property: { options: [{ name: '直播名' }, { name: '文案负责人' }, { name: '曝光量级' }, { name: 'audience' }] } },
    { name: 'liveName', type: 1 },
    { name: 'owner', type: 1 },
    { name: 'exposure', type: 2 }, // Number
    { name: 'audienceCategory', type: 1 },
    { name: 'audienceTimeRange', type: 1 },
    { name: 'audienceCount', type: 2 },
    { name: 'audienceLine', type: 3, property: { options: [{ name: '健康线' }, { name: '变美线' }, { name: '兴趣线' }] } },
    { name: 'isStock', type: 7 }, // Checkbox
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
