import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

export type ExecutionRecord = {
  id?: string
  nickname: string
  date: string
  task: string
  done: boolean
  fail_reason?: string
  hour_of_day?: number
  xp_earned?: number
}

export type User = {
  plan?: string;
  id?: string
  nickname: string
  goal?: string
  is_premium?: boolean
  streak?: number
}

export async function getUser(nickname: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('nickname', nickname)
    .single()
  if (error) return null
  return data
}

export async function createUser(nickname: string, profile?: { occupation?: string; focus_time?: string; obstacle?: string }): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .insert([{ nickname, ...(profile || {}) }])
    .select()
    .single()
  if (error) return null
  return data
}

export async function updateUserProfile(nickname: string, profile: { occupation?: string; focus_time?: string; obstacle?: string }): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update(profile)
    .eq('nickname', nickname)
  return !error
}

export async function saveRecord(record: ExecutionRecord): Promise<boolean> {
  const { error } = await supabase
    .from('execution_records')
    .insert([record])
  return !error
}

export async function getRecords(nickname: string): Promise<ExecutionRecord[]> {
  const { data, error } = await supabase
    .from('execution_records')
    .select('*')
    .eq('nickname', nickname)
    .order('created_at', { ascending: false })
  if (error) return []
  return data || []
}

export function calcStreak(records: ExecutionRecord[]): number {
  if (!records.length) return 0
  const daily: Record<string, boolean> = {}
  records.forEach(r => { if (r.done) daily[r.date] = true })
  // KST 기준 날짜 계산
  const kstDateStr = (ms: number) => {
    const k = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "Asia/Seoul" }))
    return `${k.getFullYear()}-${String(k.getMonth()+1).padStart(2,"0")}-${String(k.getDate()).padStart(2,"0")}`
  }
  let streak = 0
  for (let i = 0; i < 365; i++) {
    const ds = kstDateStr(Date.now() - 86400000 * i)
    if (daily[ds]) streak++
    else if (i > 0) break
  }
  return streak
}

export function calcFailCount(records: ExecutionRecord[]): number {
  const thisMonth = new Date().toISOString().slice(0, 7)
  return records.filter(r => !r.done && r.date.startsWith(thisMonth)).length
}

export type Schedule = {
  id?: string
  nickname: string
  title: string
  due_date: string
  due_time?: string
  done?: boolean
}

export async function saveSchedule(schedule: Schedule): Promise<boolean> {
  const { error } = await supabase
    .from('schedules')
    .insert([schedule])
  return !error
}

export async function getSchedules(nickname: string): Promise<Schedule[]> {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .eq('nickname', nickname)
    .gte('due_date', today)
    .order('due_date', { ascending: true })
  if (error) return []
  return data || []
}

export async function getTomorrowSchedules(nickname: string): Promise<Schedule[]> {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .eq('nickname', nickname)
    .eq('due_date', tomorrowStr)
  if (error) return []
  return data || []
}

export async function updateGoal(nickname: string, goal: string): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({ goal, goal_updated_at: new Date().toISOString() })
    .eq('nickname', nickname)
  return !error
}

export async function getGoal(nickname: string): Promise<string> {
  const { data, error } = await supabase
    .from('users')
    .select('goal')
    .eq('nickname', nickname)
    .single()
  if (error || !data) return ''
  return data.goal || ''
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('schedules')
    .delete()
    .eq('id', id)
  return !error
}

export async function toggleScheduleDone(id: string, done: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('schedules')
    .update({ done })
    .eq('id', id)
  return !error
}

// 주간 리더보드 - 모든 유저 표시 (XP 0 포함)
export async function getWeeklyLeaderboard(): Promise<{ nickname: string; xp: number }[]> {
  const kstDateStr = (ms: number) => {
    const k = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "Asia/Seoul" }))
    return `${k.getFullYear()}-${String(k.getMonth()+1).padStart(2,"0")}-${String(k.getDate()).padStart(2,"0")}`
  }
  const weekAgo = kstDateStr(Date.now() - 7 * 86400000)

  // 모든 유저 가져오기
  const { data: users } = await supabase.from('users').select('nickname')
  // 이번 주 완료 기록 (xp_earned 포함)
  const { data: recs } = await supabase
    .from('execution_records')
    .select('nickname, done, date, xp_earned')
    .gte('date', weekAgo)

  const xpByUser: Record<string, number> = {}
  // 모든 유저를 0으로 초기화
  if (users) {
    users.forEach(u => { if (u.nickname) xpByUser[u.nickname] = 0 })
  }
  // 완료 기록 XP 합산 (xp_earned 있으면 그것, 없으면 기본 10)
  if (recs) {
    recs.forEach(r => {
      if (r.done && r.nickname) {
        const xp = (r.xp_earned !== null && r.xp_earned !== undefined) ? r.xp_earned : 10
        xpByUser[r.nickname] = (xpByUser[r.nickname] || 0) + xp
      }
    })
  }
  return Object.entries(xpByUser)
    .map(([nickname, xp]) => ({ nickname, xp }))
    .sort((a, b) => b.xp - a.xp)
}
