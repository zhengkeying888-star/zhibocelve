const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

async function getTenantAccessToken(appId, appSecret) {
  const res = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json();
  if (!data.tenant_access_token) throw new Error(`Failed to get token: ${data.msg}`);
  return data.tenant_access_token;
}

async function batchCreateRecords(token, appToken, tableId, records) {
  const body = { records: records.map((r) => ({ fields: r })) };
  const res = await fetch(
    `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Batch create failed: ${data.msg}`);
  return data.data;
}

async function main() {
  const token = await getTenantAccessToken(config.appId, config.appSecret);
  
  const rowsPath = process.argv[2] || path.join(__dirname, 'feishu-rows-525.json');
  const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf-8'));
  
  // Convert date strings to timestamps for Feishu Date fields
  for (const row of rows) {
    if (row.date) row.date = new Date(row.date).getTime();
  }
  
  console.log(`Appending ${rows.length} records to existing bitable...`);
  const appToken = config.appToken;
  const tableId = config.tableId;
  
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await batchCreateRecords(token, appToken, tableId, batch);
    console.log(`Written ${Math.min(i + batchSize, rows.length)} / ${rows.length}`);
  }
  
  console.log('Done!');
}

main().catch((err) => { console.error(err); process.exit(1); });
