import { loadGoalTree, calculateWeight } from "./goal-tree"
import type { StudyState } from "../agent/context"

interface RiskMetrics {
  delayRate: number
  completionRate: number
  stressIndex: number
  riskLevel: "low" | "medium" | "high"
  triggers: string[]
}

// 计算风险指标
export async function calculateRisk(): Promise<RiskMetrics> {
  const goals = await loadGoalTree()

  // 1. 延迟率
  const completedGoals = goals.filter((g) => g.status === "completed")
  let totalDelayRatio = 0
  for (const goal of completedGoals) {
    const delayRatio = goal.actualHours / goal.estimatedHours
    totalDelayRatio += delayRatio
  }
  const delayRate = completedGoals.length > 0 
    ? totalDelayRatio / completedGoals.length 
    : 1.0

  // 2. 完成率
  const totalGoals = goals.length
  const completedCount = completedGoals.length
  const completionRate = totalGoals > 0 ? completedCount / totalGoals : 0

  // 3. 压力指数
  const highPriorityGoals = goals.filter(
    (g) => g.status !== "completed" && calculateWeight(g) > 0.5
  )
  const stressIndex = highPriorityGoals.reduce(
    (sum, g) => sum + calculateWeight(g),
    0
  )

  // 4. 风险等级
  const triggers: string[] = []
  let riskLevel: "low" | "medium" | "high" = "low"

  if (delayRate > 1.3) {
    triggers.push("延迟率 > 1.3")
    riskLevel = "high"
  } else if (delayRate > 1.1) {
    triggers.push("延迟率 > 1.1")
    riskLevel = riskLevel === "low" ? "medium" : riskLevel
  }

  if (completionRate < 0.5) {
    triggers.push("完成率 < 50%")
    riskLevel = "high"
  } else if (completionRate < 0.7) {
    triggers.push("完成率 < 70%")
    riskLevel = riskLevel === "low" ? "medium" : riskLevel
  }

  if (stressIndex > 5) {
    triggers.push("压力指数 > 5")
    riskLevel = "high"
  } else if (stressIndex > 3) {
    triggers.push("压力指数 > 3")
    riskLevel = riskLevel === "low" ? "medium" : riskLevel
  }

  return {
    delayRate,
    completionRate,
    stressIndex,
    riskLevel,
    triggers,
  }
}

// 生成风险报告
export async function generateRiskReport(): Promise<string> {
  const metrics = await calculateRisk()

  const lines = [
    "## 风险等级",
    `- 等级：${metrics.riskLevel}`,
    `- 触发指标：${metrics.triggers.join("、") || "无"}`,
    `- 延迟率：${metrics.delayRate.toFixed(2)}`,
    `- 完成率：${(metrics.completionRate * 100).toFixed(1)}%`,
    `- 压力指数：${metrics.stressIndex.toFixed(2)}`,
  ]

  if (metrics.riskLevel === "high") {
    lines.push("- 预测结论：高风险，建议立即干预")
  } else if (metrics.riskLevel === "medium") {
    lines.push("- 预测结论：中风险，需要关注")
  } else {
    lines.push("- 预测结论：低风险，保持当前节奏")
  }

  return lines.join("\n")
}