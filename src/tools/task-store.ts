import { mkdir } from "fs/promises"
import { dirname } from "path"
import type { StudyTask } from "../agent/context"
import { resolveSafePath } from "../utils/safety"
import { formatLocalDate, mondayOfLocalWeek } from "../utils/datetime"
import { updateLearnerProfileFromTask } from "./learner-profile"

const TASKS_FILE = "data/tasks.json"

interface AddTaskParams {
  title: string
  goalId?: string
  level: "weekly" | "daily"
  date?: string
  weekStart?: string
  plannedHours: number
  priority?: "P0" | "P1" | "P2"
}

interface UpdateTaskParams {
  id: string
  actualHours?: number
  status?: StudyTask["status"]
}

let operationQueue: Promise<unknown> = Promise.resolve()

function withLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation)
  operationQueue = result.catch(() => {})
  return result
}

function normalizeDate(date: Date): string {
  return formatLocalDate(date)
}

function mondayOf(date: Date): string {
  return mondayOfLocalWeek(date)
}

function defaultWeekStart(): string {
  return mondayOf(new Date())
}

export async function loadTasks(): Promise<StudyTask[]> {
  try {
    const path = resolveSafePath(TASKS_FILE)
    const file = Bun.file(path)
    if (!(await file.exists())) {
      return []
    }

    const parsed = (await file.json()) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed as StudyTask[]
  } catch (e) {
    throw new Error(`读取任务失败：${(e as Error).message}`)
  }
}

export async function saveTasks(tasks: StudyTask[]): Promise<void> {
  const path = resolveSafePath(TASKS_FILE, "write")
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify(tasks, null, 2))
}

export async function addTask(params: AddTaskParams): Promise<string> {
  return withLock(async () => {
    const tasks = await loadTasks()
    const task: StudyTask = {
      id: `t${Date.now()}`,
      title: params.title,
      goalId: params.goalId ?? null,
      level: params.level,
      date: params.level === "daily" ? params.date ?? normalizeDate(new Date()) : null,
      weekStart: params.weekStart ?? defaultWeekStart(),
      plannedHours: params.plannedHours,
      actualHours: 0,
      priority: params.priority ?? "P1",
      status: "pending",
      source: "manual",
    }

    tasks.push(task)
    await saveTasks(tasks)
    return `success: 已添加任务 \"${task.title}\" (ID: ${task.id})`
  })
}

export async function updateTask(params: UpdateTaskParams): Promise<string> {
  return withLock(async () => {
    const tasks = await loadTasks()
    const task = tasks.find((item) => item.id === params.id)

    if (!task) {
      return `错误：任务 ${params.id} 不存在`
    }

    const previousStatus = task.status
    if (params.actualHours !== undefined) {
      task.actualHours = params.actualHours
    }
    if (params.status) {
      task.status = params.status
    }

    await saveTasks(tasks)

    if (task.status === "completed" && previousStatus !== "completed") {
      await updateLearnerProfileFromTask(task)
    }

    return `success: 已更新任务 \"${task.title}\"`
  })
}

export async function getTaskSummary(): Promise<string> {
  const tasks = await loadTasks()
  if (tasks.length === 0) {
    return "当前无任务"
  }

  const weekly = tasks.filter((task) => task.level === "weekly")
  const daily = tasks.filter((task) => task.level === "daily")

  const lines: string[] = [
    `周任务: ${weekly.length} 个`,
    `日任务: ${daily.length} 个`,
    "",
  ]

  for (const task of tasks.slice(0, 20)) {
    const datePart = task.level === "daily" ? ` | 日期:${task.date}` : ""
    lines.push(
      `- [${task.status}] ${task.title} | ${task.level} | 计划:${task.plannedHours}h | 实际:${task.actualHours}h | 优先级:${task.priority}${datePart}`
    )
  }

  return lines.join("\n")
}

export async function replaceAutoTasksForWeek(
  weekStart: string,
  weeklyTasks: Omit<StudyTask, "id" | "source">[],
  dailyTasks: Omit<StudyTask, "id" | "source">[]
): Promise<void> {
  await withLock(async () => {
    const current = await loadTasks()

    const kept = current.filter((task) => {
      if (task.weekStart !== weekStart) return true
      // Keep manual tasks for user edits.
      return task.source === "manual"
    })

    const generatedWeekly: StudyTask[] = weeklyTasks.map((task, index) => ({
      ...task,
      id: `tw${Date.now()}${index}`,
      source: "auto",
    }))

    const generatedDaily: StudyTask[] = dailyTasks.map((task, index) => ({
      ...task,
      id: `td${Date.now()}${index}`,
      source: "auto",
    }))

    await saveTasks([...kept, ...generatedWeekly, ...generatedDaily])
  })
}

export function splitTasks(tasks: StudyTask[]): {
  weekly: StudyTask[]
  daily: StudyTask[]
} {
  return {
    weekly: tasks.filter((task) => task.level === "weekly"),
    daily: tasks.filter((task) => task.level === "daily"),
  }
}

// 清理过期任务（保留本周和未来的任务）
export async function clearOutdatedTasks(): Promise<string> {
  return withLock(async () => {
    const tasks = await loadTasks()
    const today = normalizeDate(new Date())
    const thisWeekStart = mondayOf(new Date())

    const kept = tasks.filter((task) => {
      // 保留手动任务
      if (task.source === "manual") return true
      // 保留本周及未来的任务
      if (task.weekStart >= thisWeekStart) return true
      // 保留未完成的重要任务
      if (task.status !== "completed" && task.priority === "P0") return true
      return false
    })

    const removed = tasks.length - kept.length
    if (removed > 0) {
      await saveTasks(kept)
      return `success: 已清理 ${removed} 个过期任务，保留 ${kept.length} 个任务`
    }
    return `无需清理，当前 ${tasks.length} 个任务均有效`
  })
}

// 获取本周进度统计
export async function getWeeklyProgress(): Promise<string> {
  const tasks = await loadTasks()
  const thisWeekStart = mondayOf(new Date())
  const weeklyTasks = tasks.filter((task) => task.weekStart === thisWeekStart && task.level === "weekly")
  const dailyTasks = tasks.filter((task) => task.weekStart === thisWeekStart && task.level === "daily")

  if (weeklyTasks.length === 0 && dailyTasks.length === 0) {
    return "本周尚未生成任务，请先调用 generate_schedule 生成计划"
  }

  const weeklyStats = {
    total: weeklyTasks.length,
    completed: weeklyTasks.filter((t) => t.status === "completed").length,
    inProgress: weeklyTasks.filter((t) => t.status === "in_progress").length,
    pending: weeklyTasks.filter((t) => t.status === "pending").length,
    plannedHours: weeklyTasks.reduce((sum, t) => sum + t.plannedHours, 0),
    actualHours: weeklyTasks.reduce((sum, t) => sum + t.actualHours, 0),
  }

  const dailyStats = {
    total: dailyTasks.length,
    completed: dailyTasks.filter((t) => t.status === "completed").length,
    inProgress: dailyTasks.filter((t) => t.status === "in_progress").length,
    pending: dailyTasks.filter((t) => t.status === "pending").length,
    plannedHours: dailyTasks.reduce((sum, t) => sum + t.plannedHours, 0),
    actualHours: dailyTasks.reduce((sum, t) => sum + t.actualHours, 0),
  }

  const lines = [
    `## 本周进度统计（${thisWeekStart}）`,
    "",
    "### 周任务",
    `- 总数：${weeklyStats.total} 个`,
    `- 已完成：${weeklyStats.completed} 个（${((weeklyStats.completed / Math.max(1, weeklyStats.total)) * 100).toFixed(1)}%）`,
    `- 进行中：${weeklyStats.inProgress} 个`,
    `- 待开始：${weeklyStats.pending} 个`,
    `- 时间进度：${weeklyStats.actualHours.toFixed(1)}h / ${weeklyStats.plannedHours.toFixed(1)}h（${((weeklyStats.actualHours / Math.max(1, weeklyStats.plannedHours)) * 100).toFixed(1)}%）`,
    "",
    "### 日任务",
    `- 总数：${dailyStats.total} 个`,
    `- 已完成：${dailyStats.completed} 个（${((dailyStats.completed / Math.max(1, dailyStats.total)) * 100).toFixed(1)}%）`,
    `- 进行中：${dailyStats.inProgress} 个`,
    `- 待开始：${dailyStats.pending} 个`,
    `- 时间进度：${dailyStats.actualHours.toFixed(1)}h / ${dailyStats.plannedHours.toFixed(1)}h（${((dailyStats.actualHours / Math.max(1, dailyStats.plannedHours)) * 100).toFixed(1)}%）`,
  ]

  return lines.join("\n")
}

// 根据目标树变化智能同步任务（不覆盖手动任务和已完成任务）
export async function syncTasksFromGoals(
  availableHours: number,
  goalTree: Array<{ id: string; title: string; estimatedHours: number; actualHours: number; status: string }>
): Promise<string> {
  return withLock(async () => {
    const tasks = await loadTasks()
    const thisWeekStart = mondayOf(new Date())
    
    // 保留：手动任务、已完成任务、非本周任务
    const kept = tasks.filter(
      (task) =>
        task.source === "manual" ||
        task.status === "completed" ||
        task.weekStart !== thisWeekStart
    )

    // 找出活跃目标（未完成）
    const activeGoals = goalTree.filter((g) => g.status !== "completed")
    if (activeGoals.length === 0) {
      await saveTasks(kept)
      return "所有目标已完成，已清空本周自动任务"
    }

    // 简单权重分配（按剩余时间）
    const totalRemaining = activeGoals.reduce((sum, g) => sum + (g.estimatedHours - g.actualHours), 0)
    const newWeeklyTasks: Omit<StudyTask, "id" | "source">[] = activeGoals.map((goal) => {
      const remaining = goal.estimatedHours - goal.actualHours
      const allocatedHours = Math.min(
        (remaining / Math.max(1, totalRemaining)) * availableHours,
        remaining
      )
      return {
        title: goal.title,
        goalId: goal.id,
        level: "weekly" as const,
        date: null,
        weekStart: thisWeekStart,
        plannedHours: Math.round(allocatedHours * 10) / 10,
        actualHours: 0,
        priority: "P1" as const,
        status: "pending" as const,
      }
    })

    const generatedWeekly: StudyTask[] = newWeeklyTasks.map((task, index) => ({
      ...task,
      id: `tw${Date.now()}${index}`,
      source: "auto",
    }))

    await saveTasks([...kept, ...generatedWeekly])
    return `success: 已同步 ${generatedWeekly.length} 个周任务到 tasks.json（保留 ${kept.length} 个已有任务）`
  })
}

// 获取今日任务清单
export async function getTodayTasks(): Promise<string> {
  const tasks = await loadTasks()
  const today = normalizeDate(new Date())
  const todayTasks = tasks.filter((task) => task.level === "daily" && task.date === today)

  if (todayTasks.length === 0) {
    return "今日无任务，请先调用 generate_daily_schedule 生成日计划"
  }

  const lines = [
    `## 今日任务清单（${today}）`,
    "",
  ]

  const byStatus = {
    completed: todayTasks.filter((t) => t.status === "completed"),
    in_progress: todayTasks.filter((t) => t.status === "in_progress"),
    pending: todayTasks.filter((t) => t.status === "pending"),
    deferred: todayTasks.filter((t) => t.status === "deferred"),
  }

  if (byStatus.completed.length > 0) {
    lines.push("### ✅ 已完成")
    for (const task of byStatus.completed) {
      lines.push(`- ${task.title} | ${task.actualHours}h / ${task.plannedHours}h`)
    }
    lines.push("")
  }

  if (byStatus.in_progress.length > 0) {
    lines.push("### 🔄 进行中")
    for (const task of byStatus.in_progress) {
      lines.push(`- ${task.title} | ${task.actualHours}h / ${task.plannedHours}h | ID: ${task.id}`)
    }
    lines.push("")
  }

  if (byStatus.pending.length > 0) {
    lines.push("### ⏳ 待开始")
    for (const task of byStatus.pending) {
      lines.push(`- ${task.title} | 计划${task.plannedHours}h | ID: ${task.id}`)
    }
    lines.push("")
  }

  if (byStatus.deferred.length > 0) {
    lines.push("### ⏸️ 已推迟")
    for (const task of byStatus.deferred) {
      lines.push(`- ${task.title}`)
    }
    lines.push("")
  }

  const totalPlanned = todayTasks.reduce((sum, t) => sum + t.plannedHours, 0)
  const totalActual = todayTasks.reduce((sum, t) => sum + t.actualHours, 0)
  const completionRate = ((byStatus.completed.length / todayTasks.length) * 100).toFixed(1)

  lines.push("### 📊 今日统计")
  lines.push(`- 任务完成率：${byStatus.completed.length} / ${todayTasks.length}（${completionRate}%）`)
  lines.push(`- 时间进度：${totalActual.toFixed(1)}h / ${totalPlanned.toFixed(1)}h（${((totalActual / Math.max(1, totalPlanned)) * 100).toFixed(1)}%）`)

  return lines.join("\n")
}

// 根据任务标题模糊匹配并标记完成
export async function markTaskCompletedByTitle(
  titleKeyword: string,
  actualHours?: number
): Promise<string> {
  return withLock(async () => {
    const tasks = await loadTasks()
    const today = normalizeDate(new Date())
    
    // 优先匹配今日任务
    const todayTasks = tasks.filter((task) => task.level === "daily" && task.date === today)
    const matched = todayTasks.filter((task) =>
      task.title.toLowerCase().includes(titleKeyword.toLowerCase())
    )

    if (matched.length === 0) {
      // 如果今日无匹配，尝试匹配本周任务
      const thisWeekStart = mondayOf(new Date())
      const weekTasks = tasks.filter((task) => task.level === "weekly" && task.weekStart === thisWeekStart)
      const weekMatched = weekTasks.filter((task) =>
        task.title.toLowerCase().includes(titleKeyword.toLowerCase())
      )

      if (weekMatched.length === 0) {
        return `错误：未找到包含 "${titleKeyword}" 的任务`
      }

      if (weekMatched.length > 1) {
        const titles = weekMatched.map((t) => `- ${t.title} (ID: ${t.id})`).join("\n")
        return `找到 ${weekMatched.length} 个匹配任务，请使用 update_task 并指定 ID：\n${titles}`
      }

      const task = weekMatched[0]
      task.status = "completed"
      task.actualHours = actualHours ?? task.plannedHours
      await saveTasks(tasks)
      await updateLearnerProfileFromTask(task)
      return `success: 已标记周任务 "${task.title}" 为完成（${task.actualHours}h）`
    }

    if (matched.length > 1) {
      const titles = matched.map((t) => `- ${t.title} (ID: ${t.id})`).join("\n")
      return `找到 ${matched.length} 个匹配任务，请使用 update_task 并指定 ID：\n${titles}`
    }

    const task = matched[0]
    task.status = "completed"
    task.actualHours = actualHours ?? task.plannedHours
    await saveTasks(tasks)
    await updateLearnerProfileFromTask(task)
    return `success: 已标记今日任务 "${task.title}" 为完成（${task.actualHours}h）`
  })
}
