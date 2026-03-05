import { loadGoalTree, calculateWeight } from "./goal-tree"
import type { GoalNode } from "../agent/context"

interface ScheduleResult {
  allocations: Array<{
    goalId: string
    title: string
    weight: number
    allocatedHours: number
    priority: string
  }>
  totalDemand: number
  availableHours: number
  overload: boolean
}

// 动态负载平衡：按权重分配时间
export async function scheduleWeek(availableHours: number): Promise<ScheduleResult> {
  const goals = await loadGoalTree()
  const activeGoals = goals.filter(
    (g) => g.status === "in_progress" || g.status === "delayed"
  )

  if (activeGoals.length === 0) {
    return {
      allocations: [],
      totalDemand: 0,
      availableHours,
      overload: false,
    }
  }

  // 计算权重
  const weights = activeGoals.map((g) => calculateWeight(g))
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)

  // 初步分配
  let totalDemand = 0
  const allocations = activeGoals.map((goal, i) => {
    const remaining = goal.estimatedHours - goal.actualHours
    totalDemand += remaining
    
    const idealAllocation = (weights[i] / totalWeight) * availableHours
    const allocatedHours = Math.min(idealAllocation, remaining)

    return {
      goalId: goal.id,
      title: goal.title,
      weight: weights[i],
      allocatedHours: Math.round(allocatedHours * 10) / 10,
      priority: weights[i] > totalWeight / activeGoals.length ? "P0" : "P1",
    }
  })

  // 按权重排序
  allocations.sort((a, b) => b.weight - a.weight)

  return {
    allocations,
    totalDemand,
    availableHours,
    overload: totalDemand > availableHours,
  }
}

// 生成调度报告
export async function generateScheduleReport(availableHours: number): Promise<string> {
  const result = await scheduleWeek(availableHours)

  const lines = [
    "## 本周分配",
    "| 目标/任务 | 权重 | 分配时长(h) | 优先级 | 说明 |",
    "|---|---:|---:|---|---|",
  ]

  for (const alloc of result.allocations) {
    lines.push(
      `| ${alloc.title} | ${alloc.weight.toFixed(2)} | ${alloc.allocatedHours} | ${alloc.priority} | - |`
    )
  }

  lines.push("")
  lines.push(`总需求: ${result.totalDemand}h`)
  lines.push(`可用时间: ${result.availableHours}h`)
  lines.push(`负载状态: ${result.overload ? "⚠️ 超载" : "✅ 正常"}`)

  return lines.join("\n")
}