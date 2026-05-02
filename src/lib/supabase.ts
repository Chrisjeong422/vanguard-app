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

export async function createUser(nickname: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .insert([{ nickname }])
    .select()
    .single()
  if (error) return null
  return data
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
  let streak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const ds = d.toISOString().split('T')[0]
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
