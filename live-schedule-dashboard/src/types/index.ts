export type LineType = 'health' | 'beauty' | 'interest'
export type SlotType = 'morning' | 'evening' | 'fake-morning' | 'fake-evening' | 'friend-circle'
export type GradeType = 'S' | 'A' | 'B' | 'C'
export type LiveType = 'real' | 'fake'

export interface AudienceSegment {
  id: string
  line: LineType
  category: string
  timeRange: string
  count: number
  status: 'available' | 'used' | 'conflict-3d' | 'conflict-30d'
  assignedTo?: string
  assignedDates?: string[] // track dates this segment was assigned in current week (max 2)
}

export interface AssignedAudience {
  segmentId: string
  line: LineType
  category: string
  timeRange: string
  count: number
}

export interface LiveStream {
  id: string
  name: string
  startTime: string
  endTime?: string
  date: string
  type: LiveType
  category: string
  line: LineType
  slot: SlotType
  grade: GradeType | null
  owner: string
  link?: string
  ltv?: number
  assignedAudiences: AssignedAudience[]
  exposure: number
  conflictReasons: string[]
  isRecommended: boolean
  isCrossCategory: boolean
  // Joint live fields (v2)
  isJoint?: boolean
  categories?: string[]
  lines?: LineType[]
  target?: number
}

export interface HistoryRecord {
  date: string
  liveId: string
  category: string
  timeRange: string
  type: LiveType
  slot: SlotType
}

export interface CrossPref {
  fromCategory: string
  toLine: LineType
  rate: number
}

export interface CrossCategoryPref {
  fromCategory: string
  toCategory: string
  toLine: LineType
  cohortMonth: string
  crossRate: number
  conversionRate: number
  ltv: number
}

export interface ParsedData {
  liveStreams: LiveStream[]
  audienceSegments: AudienceSegment[]
  historyRecords: HistoryRecord[]
  crossPrefs: CrossPref[]
  crossCategoryPrefs: CrossCategoryPref[]
  fakeLiveHistory: FakeLiveHistoryItem[]
}

export interface FakeLiveHistoryItem {
  name: string
  category: string
  slot: SlotType
  conversionRate: number
  isQualified: boolean
}

export interface AttributionItem {
  segmentId: string
  category: string
  line: LineType
  count: number
  crossRate: number
  conversionRate: number
  ltv: number
  expectedLeads: number
  expectedFirstOrders: number
  expectedGMV: number
}

export interface LiveAttribution {
  liveId: string
  name: string
  category: string
  line: LineType
  totalExposure: number
  expectedLeads: number
  expectedFirstOrders: number
  expectedGMV: number
  items: AttributionItem[]
}

export interface CategoryHistoricalStat {
  avgGMV: number
  avgExposure: number
  avgContributionRatio: number
  avgFirstOrders: number
  avgConversionRate: number
  count: number
}

export interface WeekDay {
  label: string
  date: string
  fullDate: string
}
