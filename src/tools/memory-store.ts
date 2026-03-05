import { loadState, saveState } from "./intervention"
import { loadGoalTree } from "./goal-tree"
import { calculateRisk } from "./risk-predict"
import type { StudyState } from "../agent/context"

// 初始化默认状态
export async function initializeState(): Promise<StudyState> {
  const goals = await loadGoalTree()
  const risk = await calculateRisk()

  const state: StudyState = {
    goalTree: goals,
    weeklyAvailableHours: 50,
    weeklyDemandHours: goals.reduce((sum, g) => sum + (g.estimatedHours - g.actualHours), 0),
    delayRate: risk.delayRate,
    completionRate: risk.completionRate,
    stressIndex: risk.stressIndex,
    consecutiveMissedDays: 0,
    fatigueScore: 0,
    interventionMode: "normal",
    riskLevel: risk.riskLevel,
  }

  await saveState(state)
  return state
}

// 刷新状态（重新计算指标）
export async function refreshState(): Promise<StudyState> {
  const existing = await loadState()
  const goals = await loadGoalTree()
  const risk = await calculateRisk()

  const state: StudyState = {
    goalTree: goals,
    weeklyAvailableHours: existing?.weeklyAvailableHours || 50,
    weeklyDemandHours: goals.reduce((sum, g) => sum + (g.estimatedHours - g.actualHours), 0),
    delayRate: risk.delayRate,
    completionRate: risk.completionRate,
    stressIndex: risk.stressIndex,
    consecutiveMissedDays: existing?.consecutiveMissedDays || 0,
    fatigueScore: existing?.fatigueScore || 0,
    interventionMode: existing?.interventionMode || "normal",
    riskLevel: risk.riskLevel,
  }

  await saveState(state)
  return state
}