import { loadTasks } from "./task-store"
import { loadGoalTree } from "./goal-tree"
import type { StudyTask } from "../agent/context"
import { formatLocalDate, mondayOfLocalWeek } from "../utils/datetime"

function getIsoDate(date: Date): string {
  return formatLocalDate(date)
}

function getCurrentWeekStartIso(): string {
  return mondayOfLocalWeek(new Date())
}

function getPreferredWeekStart(tasks: StudyTask[]): string | null {
  const weeklyTasks = tasks.filter((t) => t.level === "weekly")
  if (weeklyTasks.length === 0) return null

  const currentWeek = getCurrentWeekStartIso()
  if (weeklyTasks.some((t) => t.weekStart === currentWeek)) {
    return currentWeek
  }

  const allWeeks = [...new Set(weeklyTasks.map((t) => t.weekStart))].sort((a, b) =>
    b.localeCompare(a)
  )
  return allWeeks[0] ?? null
}

function getPreferredDailyDate(
  dailyTasks: StudyTask[],
  preferredWeekStart: string | null
): string | null {
  if (dailyTasks.length === 0) return null

  const today = getIsoDate(new Date())
  const todayTasks = dailyTasks.filter((t) => t.date === today)
  if (todayTasks.length > 0) return today

  if (preferredWeekStart) {
    const weekDates = [
      ...new Set(
        dailyTasks
          .filter((t) => t.weekStart === preferredWeekStart)
          .map((t) => t.date)
          .filter(Boolean)
      ),
    ] as string[]
    weekDates.sort((a, b) => a.localeCompare(b))
    if (weekDates.length > 0) return weekDates[0]
  }

  const allDates = [...new Set(dailyTasks.map((t) => t.date).filter(Boolean))] as string[]
  allDates.sort((a, b) => b.localeCompare(a))
  return allDates[0] ?? null
}

function priorityOrder(priority: StudyTask["priority"]): number {
  if (priority === "P0") return 0
  if (priority === "P1") return 1
  return 2
}

function statusLabel(status: StudyTask["status"]): string {
  if (status === "completed") return "已完成"
  if (status === "in_progress") return "进行中"
  if (status === "deferred") return "已推迟"
  return "待开始"
}

/**
 * 获取周计划摘要
 * 返回精简格式的周计划信息，用于减少 LLM 上下文长度
 */
export async function getWeeklyPlanSummary(): Promise<string> {
  const [goals, tasks] = await Promise.all([loadGoalTree(), loadTasks()])

  const weeklyTasks = tasks.filter((t) => t.level === "weekly")
  if (weeklyTasks.length === 0) {
    return "未找到周计划，建议调用 generate_schedule 生成本周任务规划"
  }

  const weekStart = getPreferredWeekStart(tasks)
  if (!weekStart) {
    return "未找到周计划数据"
  }

  const scoped = weeklyTasks
    .filter((t) => t.weekStart === weekStart)
    .sort((a, b) => {
      const p = priorityOrder(a.priority) - priorityOrder(b.priority)
      if (p !== 0) return p
      return b.plannedHours - a.plannedHours
    })

  if (scoped.length === 0) {
    return `未找到 weekStart=${weekStart} 的周任务`
  }

  const goalTitleById = new Map(goals.map((g) => [g.id, g.title]))

  const totalPlanned = scoped.reduce((sum, t) => sum + t.plannedHours, 0)
  const totalActual = scoped.reduce((sum, t) => sum + t.actualHours, 0)
  const completedCount = scoped.filter((t) => t.status === "completed").length

  // 按优先级分组统计
  const p0Tasks = scoped.filter((t) => t.priority === "P0")
  const p1Tasks = scoped.filter((t) => t.priority === "P1")
  const p2Tasks = scoped.filter((t) => t.priority === "P2")

  const rows = scoped
    .map(
      (t) =>
        `${t.title} (${t.plannedHours.toFixed(1)}h/${t.actualHours.toFixed(1)}实 | ${t.priority} | ${statusLabel(t.status)})`
    )
    .join("\n  ")

  return [
    `📋 本周计划摘要（${weekStart}）`,
    ``,
    `📊 统计数据：`,
    `  • 总任务数：${scoped.length} 个`,
    `  • 完成进度：${completedCount}/${scoped.length}（${((completedCount / Math.max(1, scoped.length)) * 100).toFixed(1)}%）`,
    `  • 时间进度：${totalActual.toFixed(1)}h / ${totalPlanned.toFixed(1)}h（${((totalActual / Math.max(1, totalPlanned)) * 100).toFixed(1)}%）`,
    `  • 优先级分布：P0=${p0Tasks.length} P1=${p1Tasks.length} P2=${p2Tasks.length}`,
    ``,
    `📝 详细任务列表（优先级排序）：`,
    `  ${rows}`,
  ].join("\n")
}

/**
 * 获取日计划摘要
 * 返回精简格式的日计划信息，用于减少 LLM 上下文长度
 */
export async function getDailyPlanSummary(): Promise<string> {
  const [goals, tasks] = await Promise.all([loadGoalTree(), loadTasks()])

  const dailyTasks = tasks.filter((t) => t.level === "daily")
  if (dailyTasks.length === 0) {
    return "未找到日计划，建议调用 generate_daily_schedule 生成详细日计划"
  }

  const weeklyTasks = tasks.filter((t) => t.level === "weekly")
  const weekStart = getPreferredWeekStart(weeklyTasks)
  const targetDate = getPreferredDailyDate(dailyTasks, weekStart)

  if (!targetDate) {
    return "未找到日计划数据"
  }

  const goalTitleById = new Map(goals.map((g) => [g.id, g.title]))
  const today = getIsoDate(new Date())

  const dateScoped = dailyTasks.filter((t) => t.date === targetDate).sort((a, b) => {
    const slotOrder = ["早1", "早2", "中1", "中2", "晚1", "晚2"]
    const aSlot = slotOrder.findIndex((slot) => a.title.includes(`(${slot})`))
    const bSlot = slotOrder.findIndex((slot) => b.title.includes(`(${slot})`))
    const aRank = aSlot === -1 ? 99 : aSlot
    const bRank = bSlot === -1 ? 99 : bSlot
    if (aRank !== bRank) return aRank - bRank
    return priorityOrder(a.priority) - priorityOrder(b.priority)
  })

  if (dateScoped.length === 0) {
    return `未找到 ${targetDate} 的日任务`
  }

  const totalPlanned = dateScoped.reduce((sum, t) => sum + t.plannedHours, 0)
  const totalActual = dateScoped.reduce((sum, t) => sum + t.actualHours, 0)
  const completedCount = dateScoped.filter((t) => t.status === "completed").length

  const rows = dateScoped
    .map(
      (t) =>
        `${t.title} (${t.plannedHours.toFixed(1)}h/${t.actualHours.toFixed(1)}实 | ${t.priority} | ${statusLabel(t.status)})`
    )
    .join("\n  ")

  return [
    `📅 日计划摘要（${targetDate}）${targetDate !== today ? " [非今日]" : " [今日]"}`,
    ``,
    `📊 统计数据：`,
    `  • 总任务数：${dateScoped.length} 个`,
    `  • 完成进度：${completedCount}/${dateScoped.length}（${((completedCount / Math.max(1, dateScoped.length)) * 100).toFixed(1)}%）`,
    `  • 时间进度：${totalActual.toFixed(1)}h / ${totalPlanned.toFixed(1)}h（${((totalActual / Math.max(1, totalPlanned)) * 100).toFixed(1)}%）`,
    ``,
    `📝 时间段任务（按时间顺序）：`,
    `  ${rows}`,
  ].join("\n")
}
