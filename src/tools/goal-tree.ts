import type { GoalNode } from "../agent/context"
import { resolveSafePath } from "../utils/safety"

const GOALS_FILE = "data/goals.json"

interface AddGoalParams {
  title: string
  parentId?: string
  longTermValue: number
  urgency: number
  deadline?: string
  estimatedHours: number
}

interface UpdateGoalParams {
  id: string
  actualHours?: number
  status?: GoalNode["status"]
}

// 读取目标树
export async function loadGoalTree(): Promise<GoalNode[]> {
  try {
    const path = resolveSafePath(GOALS_FILE)
    const file = Bun.file(path)
    if (!(await file.exists())) {
      return []
    }
    return await file.json()
  } catch (e) {
    throw new Error(`读取目标树失败：${(e as Error).message}`)
  }
}

// 保存目标树
export async function saveGoalTree(goals: GoalNode[]): Promise<void> {
  const path = resolveSafePath(GOALS_FILE)
  await Bun.write(path, JSON.stringify(goals, null, 2))
}

// 添加目标
export async function addGoal(params: AddGoalParams): Promise<string> {
  const goals = await loadGoalTree()
  
  const newGoal: GoalNode = {
    id: `g${Date.now()}`,
    title: params.title,
    parentId: params.parentId || null,
    longTermValue: params.longTermValue,
    urgency: params.urgency,
    deadline: params.deadline || null,
    estimatedHours: params.estimatedHours,
    actualHours: 0,
    status: "pending",
  }
  
  goals.push(newGoal)
  await saveGoalTree(goals)
  
  return `success: 已添加目标 "${params.title}" (ID: ${newGoal.id})`
}

// 更新目标
export async function updateGoal(params: UpdateGoalParams): Promise<string> {
  const goals = await loadGoalTree()
  const goal = goals.find((g) => g.id === params.id)
  
  if (!goal) {
    return `错误：目标 ${params.id} 不存在`
  }
  
  if (params.actualHours !== undefined) {
    goal.actualHours = params.actualHours
  }
  if (params.status) {
    goal.status = params.status
  }
  
  await saveGoalTree(goals)
  return `success: 已更新目标 "${goal.title}"`
}

// 计算任务权重
export function calculateWeight(goal: GoalNode): number {
  const timeLeft = goal.deadline 
    ? Math.max(1, (new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 7 // 无 DDL 默认 7 天

  const timePressure = 1 / timeLeft
  return goal.urgency * goal.longTermValue * timePressure
}

// 获取目标树摘要
export async function getGoalSummary(): Promise<string> {
  const goals = await loadGoalTree()
  
  if (goals.length === 0) {
    return "当前无目标"
  }
  
  const lines = goals.map((g) => {
    const weight = calculateWeight(g).toFixed(3)
    const remaining = g.estimatedHours - g.actualHours
    return `- [${g.status}] ${g.title} | 权重:${weight} | 剩余:${remaining}h | DDL:${g.deadline || "无"}`
  })
  
  return lines.join("\n")
}