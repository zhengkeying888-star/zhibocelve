import { supabase, isSupabaseConfigured } from './supabase'
import type {
  LiveStream,
  AudienceSegment,
  HistoryRecord,
  CrossPref,
  CrossCategoryPref,
  FakeLiveHistoryItem,
  LineType,
  GradeType,
  WeekDay,
} from '@/types'

export interface ScheduleState {
  currentWeek: string
  weekDays: WeekDay[]
  liveStreams: LiveStream[]
  audienceSegments: AudienceSegment[]
  historyRecords: HistoryRecord[]
  crossPrefs: CrossPref[]
  crossCategoryPrefs: CrossCategoryPref[]
  fakeLiveHistory: FakeLiveHistoryItem[]
  categoryGrades: Record<string, GradeType>
  categoryLines: Record<string, LineType>
  nameOverrides: Record<string, { category: string; line: LineType }>
  gmvMultiplier?: number
  learnedRules?: Array<{
    id: string
    liveCategory: string
    fromCategory: string
    toCategory: string
    reason: string
    timestamp: number
  }>
}

const SCHEDULE_ID_KEY = 'schedule.currentId'

function getStoredScheduleId(): string | null {
  return localStorage.getItem(SCHEDULE_ID_KEY)
}

function setStoredScheduleId(id: string) {
  localStorage.setItem(SCHEDULE_ID_KEY, id)
}

export async function loadScheduleState(): Promise<ScheduleState | null> {
  if (!isSupabaseConfigured()) {
    console.warn('[Cloud] Supabase not configured. Using local mode.')
    return null
  }

  const scheduleId = getStoredScheduleId()
  let query = supabase.from('schedules').select('*')

  if (scheduleId) {
    query = query.eq('id', scheduleId)
  } else {
    query = query.order('updated_at', { ascending: false }).limit(1)
  }

  const { data, error } = await query.single()
  if (error || !data) {
    console.warn('[Cloud] Load failed:', error?.message)
    return null
  }

  setStoredScheduleId(data.id)
  return (data.state ?? {}) as ScheduleState
}

export async function saveScheduleState(state: ScheduleState): Promise<void> {
  if (!isSupabaseConfigured()) {
    // Fallback: persist config mappings locally so they survive reloads
    localStorage.setItem('schedule.categoryGrades', JSON.stringify(state.categoryGrades))
    localStorage.setItem('schedule.categoryLines', JSON.stringify(state.categoryLines))
    localStorage.setItem('schedule.nameOverrides', JSON.stringify(state.nameOverrides))
    if (state.learnedRules) {
      localStorage.setItem('schedule.learnedRules', JSON.stringify(state.learnedRules))
    }
    return
  }

  const scheduleId = getStoredScheduleId()
  const payload = {
    state,
    updated_at: new Date().toISOString(),
  }

  if (scheduleId) {
    const { error } = await supabase
      .from('schedules')
      .update(payload)
      .eq('id', scheduleId)
    if (error) console.error('[Cloud] Save failed:', error.message)
  } else {
    const { data, error } = await supabase
      .from('schedules')
      .insert(payload)
      .select('id')
      .single()
    if (error) {
      console.error('[Cloud] Save failed:', error.message)
    } else if (data) {
      setStoredScheduleId(data.id)
    }
  }
}

export function subscribeToChanges(callback: () => void): () => void {
  if (!isSupabaseConfigured()) return () => {}

  const channel = supabase
    .channel('schedule_updates')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'schedules' },
      () => callback()
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
