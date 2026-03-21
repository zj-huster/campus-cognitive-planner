import { mkdir } from "fs/promises"
import { dirname } from "path"
import type { StudyTask } from "../agent/context"
import { resolveSafePath } from "../utils/safety"

const UI_STATE_FILE = "data/planner-ui-state.json"

export interface CalendarTaskInput {
  date: string
  name: string
  start: string
  end: string
}

export interface CalendarTaskItem extends CalendarTaskInput {
  id: string
  source: "calendar_ui"
  createdAt: string
}

interface SessionPlannerUiState {
  calendarTasksByDate: Record<string, CalendarTaskItem[]>
  updatedAt: string
}

interface PlannerUiStore {
  sessions: Record<string, SessionPlannerUiState>
}

const EMPTY_STORE: PlannerUiStore = { sessions: {} }
let operationQueue: Promise<unknown> = Promise.resolve()

function withLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation)
  operationQueue = result.catch(() => {})
  return result
}

async function loadStore(): Promise<PlannerUiStore> {
  try {
    const path = resolveSafePath(UI_STATE_FILE)
    const file = Bun.file(path)
    if (!(await file.exists())) {
      return structuredClone(EMPTY_STORE)
    }

    const parsed = (await file.json()) as unknown
    if (!parsed || typeof parsed !== "object") {
      return structuredClone(EMPTY_STORE)
    }

    const sessions = (parsed as PlannerUiStore).sessions
    if (!sessions || typeof sessions !== "object") {
      return structuredClone(EMPTY_STORE)
    }

    return {
      sessions: sessions as PlannerUiStore["sessions"],
    }
  } catch {
    return structuredClone(EMPTY_STORE)
  }
}

async function saveStore(store: PlannerUiStore): Promise<void> {
  const path = resolveSafePath(UI_STATE_FILE, "write")
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify(store, null, 2))
}

function ensureSession(
  store: PlannerUiStore,
  sessionId: string
): SessionPlannerUiState {
  const existing = store.sessions[sessionId]
  if (existing) {
    if (!existing.calendarTasksByDate || typeof existing.calendarTasksByDate !== "object") {
      existing.calendarTasksByDate = {}
    }
    return existing
  }

  const created: SessionPlannerUiState = {
    calendarTasksByDate: {},
    updatedAt: new Date().toISOString(),
  }
  store.sessions[sessionId] = created
  return created
}

function sortCalendarTasks(tasks: CalendarTaskItem[]): CalendarTaskItem[] {
  return [...tasks].sort((a, b) => {
    const byStart = a.start.localeCompare(b.start)
    if (byStart !== 0) return byStart
    return a.name.localeCompare(b.name, "zh-CN")
  })
}

export async function getPlannerUiState(sessionId: string): Promise<SessionPlannerUiState> {
  const store = await loadStore()
  const session = ensureSession(store, sessionId)
  return {
    calendarTasksByDate: structuredClone(session.calendarTasksByDate),
    updatedAt: session.updatedAt,
  }
}

export async function addCalendarTaskForSession(
  sessionId: string,
  input: CalendarTaskInput
): Promise<CalendarTaskItem> {
  return withLock(async () => {
    const store = await loadStore()
    const session = ensureSession(store, sessionId)

    const next: CalendarTaskItem = {
      id: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      date: input.date,
      name: input.name,
      start: input.start,
      end: input.end,
      source: "calendar_ui",
      createdAt: new Date().toISOString(),
    }

    const list = Array.isArray(session.calendarTasksByDate[input.date])
      ? session.calendarTasksByDate[input.date]
      : []

    session.calendarTasksByDate[input.date] = sortCalendarTasks([...list, next])
    session.updatedAt = new Date().toISOString()
    await saveStore(store)
    return next
  })
}

export async function removeCalendarTaskForSession(
  sessionId: string,
  date: string,
  taskId: string
): Promise<boolean> {
  return withLock(async () => {
    const store = await loadStore()
    const session = ensureSession(store, sessionId)
    const list = Array.isArray(session.calendarTasksByDate[date])
      ? session.calendarTasksByDate[date]
      : []

    const next = list.filter((item) => item.id !== taskId)
    const removed = next.length !== list.length

    if (!removed) {
      return false
    }

    if (next.length === 0) {
      delete session.calendarTasksByDate[date]
    } else {
      session.calendarTasksByDate[date] = sortCalendarTasks(next)
    }

    session.updatedAt = new Date().toISOString()
    await saveStore(store)
    return true
  })
}

export function buildPlannerUiHint(
  uiState: SessionPlannerUiState,
  _dailyTasks: StudyTask[]
): string {
  const calendarLines = Object.entries(uiState.calendarTasksByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, tasks]) =>
      tasks.map((task) => `${date} ${task.start}-${task.end} ${task.name}`)
    )

  const lines = ["[用户界面变更摘要]"]
  lines.push(
    calendarLines.length > 0
      ? `日历新增任务(${calendarLines.length}): ${calendarLines.slice(-8).join("; ")}`
      : "日历新增任务: 暂无"
  )

  return lines.join("\n")
}
