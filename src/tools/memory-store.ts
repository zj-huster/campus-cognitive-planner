import { loadGoalTree, syncGoalTreeDerivedState } from "./goal-tree"
import { calculateRisk } from "./risk-predict"
import type { StudyState } from "../agent/context"
import { loadTasks, splitTasks } from "./task-store"

function computeInterventionMode(
  riskLevel: "low" | "medium" | "high"
): "normal" | "light" | "sprint" {
  if (riskLevel === "high") return "light"
  if (riskLevel === "medium") return "sprint"
  return "normal"
}

function computeConsecutiveMissedDays(dailyTasks: StudyState["dailyTasks"]): number {
  if (dailyTasks.length === 0) return 0

  const byDate = new Map<string, StudyState["dailyTasks"]>()
  for (const task of dailyTasks) {
    if (!task.date) continue
    const current = byDate.get(task.date) ?? []
    current.push(task)
    byDate.set(task.date, current)
  }

  const dates = Array.from(byDate.keys()).sort().reverse()
  let streak = 0

  for (const date of dates) {
    const tasks = byDate.get(date) ?? []
    const allDone = tasks.every((task) => task.status === "completed")
    if (allDone) break
    streak++
  }

  return streak
}

function computeFatigueScore(dailyTasks: StudyState["dailyTasks"]): number {
  if (dailyTasks.length === 0) return 0
  const inProgressOrPending = dailyTasks.filter(
    (task) => task.status === "pending" || task.status === "in_progress"
  ).length
  return Math.min(1, inProgressOrPending / Math.max(1, dailyTasks.length))
}

// 初始化默认状态
export async function initializeState(weeklyAvailableHours = 50): Promise<StudyState> {
  const synced = await syncGoalTreeDerivedState()
  const goals = synced.goals.length > 0 ? synced.goals : await loadGoalTree()
  const tasks = await loadTasks()
  const { weekly, daily } = splitTasks(tasks)
  const risk = await calculateRisk()

  const state: StudyState = {
    goalTree: goals,
    weeklyTasks: weekly,
    dailyTasks: daily,
    weeklyAvailableHours,
    weeklyDemandHours: goals.reduce((sum, g) => sum + (g.estimatedHours - g.actualHours), 0),
    delayRate: risk.delayRate,
    completionRate: risk.completionRate,
    stressIndex: risk.stressIndex,
    consecutiveMissedDays: computeConsecutiveMissedDays(daily),
    fatigueScore: computeFatigueScore(daily),
    interventionMode: computeInterventionMode(risk.riskLevel),
    riskLevel: risk.riskLevel,
  }
  return state
}

// 刷新状态（重新计算指标）
export async function refreshState(weeklyAvailableHours = 50): Promise<StudyState> {
  const synced = await syncGoalTreeDerivedState()
  const goals = synced.goals.length > 0 ? synced.goals : await loadGoalTree()
  const tasks = await loadTasks()
  const { weekly, daily } = splitTasks(tasks)
  const risk = await calculateRisk()

  const state: StudyState = {
    goalTree: goals,
    weeklyTasks: weekly,
    dailyTasks: daily,
    weeklyAvailableHours,
    weeklyDemandHours: goals.reduce((sum, g) => sum + (g.estimatedHours - g.actualHours), 0),
    delayRate: risk.delayRate,
    completionRate: risk.completionRate,
    stressIndex: risk.stressIndex,
    consecutiveMissedDays: computeConsecutiveMissedDays(daily),
    fatigueScore: computeFatigueScore(daily),
    interventionMode: computeInterventionMode(risk.riskLevel),
    riskLevel: risk.riskLevel,
  }
  return state
}