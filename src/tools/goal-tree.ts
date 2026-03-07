import type { GoalNode } from "../agent/context"
import { resolveSafePath } from "../utils/safety"
import { mkdir } from "fs/promises"
import { dirname } from "path"

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

interface SyncGoalTreeResult {
  updated: boolean
  goals: GoalNode[]
}

// ========== 互斥锁实现 ==========
let operationQueue: Promise<any> = Promise.resolve()

function withLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation)
  operationQueue = result.catch(() => {}) // 确保失败不会阻塞后续操作
  return result
}
// ================================

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
  const path = resolveSafePath(GOALS_FILE, "write")
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify(goals, null, 2))
}

// 添加目标（带锁）
export async function addGoal(params: AddGoalParams): Promise<string> {
  return withLock(async () => {
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
  })
}

// 更新目标（带锁）
export async function updateGoal(params: UpdateGoalParams): Promise<string> {
  return withLock(async () => {
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
  })
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

// 同步目标树的派生状态：
// 1) 叶子目标按 actualHours 自动推进状态
// 2) 父目标按子目标聚合状态，避免父子状态不一致
export async function syncGoalTreeDerivedState(): Promise<SyncGoalTreeResult> {
  return withLock(async () => {
    const goals = await loadGoalTree()
    if (goals.length === 0) {
      return { updated: false, goals }
    }

    const byParent = new Map<string, GoalNode[]>()
    for (const goal of goals) {
      if (!goal.parentId) continue
      const siblings = byParent.get(goal.parentId) ?? []
      siblings.push(goal)
      byParent.set(goal.parentId, siblings)
    }

    let changed = false

    // 先处理叶子目标
    for (const goal of goals) {
      const children = byParent.get(goal.id) ?? []
      if (children.length > 0) continue

      if (goal.actualHours >= goal.estimatedHours && goal.status !== "completed") {
        goal.status = "completed"
        changed = true
        continue
      }

      if (
        goal.actualHours > 0 &&
        goal.actualHours < goal.estimatedHours &&
        goal.status === "pending"
      ) {
        goal.status = "in_progress"
        changed = true
      }
    }

    // 再自底向上处理父目标（多轮直到收敛）
    let parentChanged = true
    while (parentChanged) {
      parentChanged = false

      for (const goal of goals) {
        const children = byParent.get(goal.id) ?? []
        if (children.length === 0) continue

        const allCompleted = children.every((c) => c.status === "completed")
        const anyDelayed = children.some((c) => c.status === "delayed")
        const anyStarted = children.some(
          (c) => c.status === "in_progress" || c.status === "completed"
        )

        let nextStatus: GoalNode["status"] = "pending"
        if (allCompleted) {
          nextStatus = "completed"
        } else if (anyDelayed) {
          nextStatus = "delayed"
        } else if (anyStarted) {
          nextStatus = "in_progress"
        }

        if (goal.status !== nextStatus) {
          goal.status = nextStatus
          parentChanged = true
          changed = true
        }
      }
    }

    if (changed) {
      await saveGoalTree(goals)
    }

    return { updated: changed, goals }
  })
}

// 根据标题关键词模糊查找目标
export async function findGoalByTitle(titleKeyword: string): Promise<string> {
  const goals = await loadGoalTree()
  const matched = goals.filter((goal) =>
    goal.title.toLowerCase().includes(titleKeyword.toLowerCase())
  )

  if (matched.length === 0) {
    return `未找到包含 "${titleKeyword}" 的目标`
  }

  if (matched.length === 1) {
    const goal = matched[0]
    return [
      `找到目标：${goal.title}`,
      `- ID: ${goal.id}`,
      `- 状态: ${goal.status}`,
      `- 进度: ${goal.actualHours}h / ${goal.estimatedHours}h（${((goal.actualHours / goal.estimatedHours) * 100).toFixed(1)}%）`,
      `- DDL: ${goal.deadline ?? "无"}`,
      `- 权重: 长期价值${goal.longTermValue} × 紧急度${goal.urgency}`,
    ].join("\n")
  }

  const lines = [`找到 ${matched.length} 个匹配目标：`, ""]
  for (const goal of matched) {
    lines.push(`- ${goal.title} (ID: ${goal.id}) | 状态: ${goal.status} | 进度: ${goal.actualHours}/${goal.estimatedHours}h`)
  }
  return lines.join("\n")
}