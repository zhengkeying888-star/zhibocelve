// Vercel Edge Function: AI 排期诊断与修复建议
// 支持 Kimi (Moonshot) / Anthropic 双平台，根据 API Key 前缀自动识别

export const config = {
  runtime: 'edge',
}

const SYSTEM_PROMPT = `你是直播间排期策略系统的专职算法顾问（algo-agent）。

## 你的任务
根据用户提供的排期状态数据，分析排期问题并给出可执行的修复建议。

## 核心规则（不可违反）
1. 真直播 200,000 单场底线（MIN_ACCEPTABLE_EXPOSURE = 150k, PREFERRED = 200k）
2. 同 audience 一周最多 2 次 / 间隔 >=3 天
3. 联合直播跨线资源实际分配
4. 伪直播/数字人只能用剩余段后置承接
5. 品类族上限与段数上限
6. 严禁跨线兜底

## 分析维度
1. 剩余 audience 未分配的原因（段数上限？品类族上限？3天锁？）
2. 伪直播/数字人曝光不足的根因
3. health 线死库存的分析
4. 具体可执行的修复操作（如"把 X 段从直播A转移到直播B"）

## 输出格式（严格 JSON）
{
  "rootCause": "一句话根因总结",
  "confidence": 0-1,
  "suggestions": [
    {
      "type": "transfer" | "add" | "remove" | "reorder" | "manual",
      "description": "建议描述",
      "fromLiveId": "来源直播ID（transfer/remove时）",
      "toLiveId": "目标直播ID（transfer/add时）",
      "segmentId": "audience段ID",
      "reason": "为什么这个操作有效",
      "expectedExposure": 预计调整后的曝光量,
      "risk": "低风险/中风险/高风险"
    }
  ],
  "healthLineAnalysis": {
    "remaining": health线剩余audience,
    "reason": "health线剩余的原因",
    "suggestion": "health线处理建议"
  }
}`

interface ScheduleState {
  liveStreams: any[]
  audienceSegments: any[]
  auditReport: any
  weekDays: any[]
}

type ApiProvider = 'anthropic' | 'kimi'

function detectProvider(apiKey: string): ApiProvider {
  if (apiKey.startsWith('sk-kimi')) return 'kimi'
  if (apiKey.startsWith('sk-ant')) return 'anthropic'
  // 默认按 Anthropic 处理（兼容旧 key）
  return 'anthropic'
}

async function callAnthropic(apiKey: string, compactState: any) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `请分析以下排期状态并给出修复建议：\n\n${JSON.stringify(compactState, null, 2)}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  return {
    content: data.content?.[0]?.text || '',
    model: data.model,
    usage: data.usage,
  }
}

async function callKimi(apiKey: string, compactState: any) {
  const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'kimi-k2.6',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `请分析以下排期状态并给出修复建议：\n\n${JSON.stringify(compactState, null, 2)}`,
        },
      ],
      temperature: 0.2,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Kimi API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  return {
    content: data.choices?.[0]?.message?.content || '',
    model: data.model,
    usage: data.usage,
  }
}

export default async function handler(req: Request): Promise<Response> {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500)
  }

  try {
    const body: ScheduleState = await req.json()
    const compactState = compactScheduleState(body)
    const provider = detectProvider(apiKey)

    const result = provider === 'kimi'
      ? await callKimi(apiKey, compactState)
      : await callAnthropic(apiKey, compactState)

    // 尝试从回复中提取 JSON
    let suggestions = null
    try {
      const jsonMatch = result.content.match(/```json\n([\s\S]*?)\n```/) ||
                        result.content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[1] || jsonMatch[0])
      }
    } catch (e) {
      console.error('Failed to parse LLM response as JSON:', e)
    }

    return jsonResponse({
      raw: result.content,
      suggestions,
      model: result.model,
      usage: result.usage,
      provider,
    })
  } catch (err: any) {
    console.error('Edge function error:', err)
    return jsonResponse({ error: err.message || 'Internal error' }, 500)
  }
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

// 精简排期状态，只保留诊断所需的字段，减少 API token
function compactScheduleState(state: ScheduleState) {
  const lives = (state.liveStreams || []).map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    line: l.line,
    grade: l.grade,
    date: l.date,
    slot: l.slot,
    exposure: l.exposure,
    assignedAudiences: (l.assignedAudiences || []).map((a: any) => ({
      segmentId: a.segmentId,
      line: a.line,
      category: a.category,
      timeRange: a.timeRange,
      count: a.count,
    })),
    conflictReasons: l.conflictReasons,
  }))

  const segments = (state.audienceSegments || []).map((s) => ({
    id: s.id,
    line: s.line,
    category: s.category,
    timeRange: s.timeRange,
    count: s.count,
    status: s.status,
    assignedDates: s.assignedDates,
  }))

  const audit = state.auditReport || {}

  const lineStats = {
    health: { total: 0, assigned: 0, remaining: 0 },
    beauty: { total: 0, assigned: 0, remaining: 0 },
    interest: { total: 0, assigned: 0, remaining: 0 },
  }

  for (const seg of segments) {
    const line = seg.line as keyof typeof lineStats
    if (lineStats[line]) {
      lineStats[line].total += seg.count
      if (seg.status === 'used') {
        lineStats[line].assigned += seg.count
      } else {
        lineStats[line].remaining += seg.count
      }
    }
  }

  return {
    weekInfo: state.weekDays?.map((w: any) => ({ date: w.date, label: w.label })),
    liveSummary: lives,
    segmentSummary: segments,
    lineStats,
    auditSummary: {
      totalLives: lives.length,
      realLives: lives.filter((l) => l.type === 'real').length,
      fakeLives: lives.filter((l) => l.type === 'fake').length,
      underFloorLives: lives.filter((l) => l.type === 'real' && l.exposure > 0 && l.exposure < 200000).length,
      underMinLives: lives.filter((l) => l.type === 'real' && l.exposure > 0 && l.exposure < 150000).length,
      fakeUnderMin: lives.filter((l) => l.type === 'fake' && l.exposure < 150000).length,
      totalRemaining: segments.filter((s) => s.status === 'available').reduce((sum, s) => sum + s.count, 0),
      healthRemaining: lineStats.health.remaining,
      issues: audit.issues || [],
    },
  }
}
