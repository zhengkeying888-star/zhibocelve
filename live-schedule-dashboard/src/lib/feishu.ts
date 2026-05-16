const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'

export interface FeishuTokenResponse {
  tenant_access_token: string
  expire: number
}

export interface FeishuRecord {
  record_id: string
  fields: Record<string, any>
}

export interface FeishuSearchResponse {
  code: number
  data?: {
    items?: FeishuRecord[]
    has_more?: boolean
    page_token?: string
    total?: number
  }
  msg?: string
}

let cachedToken: { token: string; expireAt: number } | null = null

export async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  if (cachedToken && cachedToken.expireAt > Date.now() + 60_000) {
    return cachedToken.token
  }
  const res = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const data: FeishuTokenResponse = await res.json()
  if (!data.tenant_access_token) {
    throw new Error('Failed to get tenant_access_token')
  }
  cachedToken = {
    token: data.tenant_access_token,
    expireAt: Date.now() + (data.expire || 7200) * 1000,
  }
  return data.tenant_access_token
}

export function clearCachedToken() {
  cachedToken = null
}

export function extractAppTokenFromUrl(url: string): string | null {
  const m = url.match(/\/base\/([a-zA-Z0-9]+)/)
  return m ? m[1] : null
}

export function extractSpreadsheetTokenFromUrl(url: string): string | null {
  const m = url.match(/\/sheets\/([a-zA-Z0-9]+)/)
  return m ? m[1] : null
}

export async function searchBitableRecords(
  token: string,
  appToken: string,
  tableId: string,
  options?: { filter?: string; pageToken?: string; pageSize?: number }
): Promise<FeishuRecord[]> {
  const body: any = {}
  if (options?.filter) body.filter = options.filter
  if (options?.pageToken) body.page_token = options.pageToken
  if (options?.pageSize) body.page_size = options.pageSize

  const res = await fetch(
    `${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }
  )
  const data: FeishuSearchResponse = await res.json()
  if (data.code !== 0) {
    throw new Error(`Feishu API error: ${data.msg} (code: ${data.code})`)
  }
  const items = data.data?.items ?? []
  if (data.data?.has_more && data.data?.page_token) {
    const next = await searchBitableRecords(token, appToken, tableId, {
      ...options,
      pageToken: data.data.page_token,
    })
    return items.concat(next)
  }
  return items
}

export async function listBitableTables(token: string, appToken: string): Promise<{ tableId: string; name: string }[]> {
  const res = await fetch(`${FEISHU_API_BASE}/bitable/v1/apps/${appToken}/tables`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (data.code !== 0) {
    throw new Error(`Feishu API error: ${data.msg} (code: ${data.code})`)
  }
  return (data.data?.items ?? []).map((t: any) => ({ tableId: t.table_id, name: t.name }))
}

export async function createSpreadsheetSheet(
  token: string,
  spreadsheetToken: string,
  title: string
): Promise<{ sheetId: string; title: string }> {
  const res = await fetch(
    `${FEISHU_API_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/sheets_batch_update`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: { title, index: 0 },
            },
          },
        ],
      }),
    }
  )
  const data = await res.json()
  if (data.code !== 0) {
    throw new Error(`Feishu API error: ${data.msg} (code: ${data.code})`)
  }
  const sheetId = data.data?.replies?.[0]?.addSheet?.properties?.sheetId
  return { sheetId, title }
}

export async function appendSpreadsheetValues(
  token: string,
  spreadsheetToken: string,
  sheetId: string,
  values: (string | number)[][]
): Promise<void> {
  if (values.length === 0) return
  const range = `${sheetId}!A1:${String.fromCharCode(64 + values[0].length)}${values.length}`
  const res = await fetch(
    `${FEISHU_API_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/values_prepend`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        valueRange: { range, values },
      }),
    }
  )
  const data = await res.json()
  if (data.code !== 0) {
    throw new Error(`Feishu API error: ${data.msg} (code: ${data.code})`)
  }
}
