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

interface TimeSlot {
  period: "早" | "中" | "晚"
  slot: 1 | 2
  startTime: string
  endTime: string
  duration: number // 分钟
  goalId?: string
  taskTitle?: string
}

interface DailySchedule {
  date: string // YYYY-MM-DD
  dayOfWeek: string
  slots: TimeSlot[]
  totalHours: number
}

// 每个时段的时间配置
const TIME_SLOTS = [
  { period: "早" as const, slot: 1 as const, startTime: "08:00", endTime: "09:30", duration: 90 },
  { period: "早" as const, slot: 2 as const, startTime: "09:30", endTime: "11:00", duration: 90 },
  { period: "中" as const, slot: 1 as const, startTime: "14:00", endTime: "15:30", duration: 90 },
  { period: "中" as const, slot: 2 as const, startTime: "15:30", endTime: "17:00", duration: 90 },
  { period: "晚" as const, slot: 1 as const, startTime: "19:00", endTime: "20:30", duration: 90 },
  { period: "晚" as const, slot: 2 as const, startTime: "20:30", endTime: "22:00", duration: 90 },
]

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

// 生成日计划
export async function generateDailySchedules(
  weekAllocations: ScheduleResult["allocations"],
  startDate: Date = new Date()
): Promise<DailySchedule[]> {
  const dailySchedules: DailySchedule[] = []
  const daysOfWeek = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
  
  // 分配周任务到每天
  const tasksPerDay = 6 // 每天6个时段
  let currentTaskIndex = 0
  let currentTaskHoursUsed = 0
  
  for (let day = 0; day < 7; day++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + day)
    
    const slots: TimeSlot[] = TIME_SLOTS.map((slot) => {
      let slotTask: TimeSlot = {
        ...slot,
      }
      
      // 按优先级分配任务
      if (currentTaskIndex < weekAllocations.length) {
        const currentAllocation = weekAllocations[currentTaskIndex]
        const slotHours = slot.duration / 60
        
        if (
          currentTaskHoursUsed + slotHours <= currentAllocation.allocatedHours &&
          currentTaskIndex < weekAllocations.length
        ) {
          slotTask.goalId = currentAllocation.goalId
          slotTask.taskTitle = currentAllocation.title
          currentTaskHoursUsed += slotHours
        } else if (currentTaskHoursUsed > 0) {
          // 当前任务分配完成，移到下一个
          currentTaskIndex++
          currentTaskHoursUsed = 0
          
          if (currentTaskIndex < weekAllocations.length) {
            const nextAllocation = weekAllocations[currentTaskIndex]
            slotTask.goalId = nextAllocation.goalId
            slotTask.taskTitle = nextAllocation.title
            currentTaskHoursUsed = slotHours
          }
        }
      }
      
      return slotTask
    })
    
    dailySchedules.push({
      date: date.toISOString().split("T")[0],
      dayOfWeek: daysOfWeek[day],
      slots,
      totalHours: 9, // 6个时段 × 1.5h
    })
  }
  
  return dailySchedules
}

// 生成日计划报告
export async function generateDailyScheduleReport(
  weekAllocations: ScheduleResult["allocations"],
  startDate?: Date
): Promise<string> {
  const schedules = await generateDailySchedules(weekAllocations, startDate)
  
  const lines = ["## 日计划详情\n"]
  
  for (const day of schedules) {
    lines.push(`### ${day.date} ${day.dayOfWeek}`)
    lines.push("| 时段 | 开始 | 结束 | 任务 |")
    lines.push("|------|------|------|------|")
    
    for (const slot of day.slots) {
      const taskName = slot.taskTitle || "待安排"
      lines.push(
        `| ${slot.period}${slot.slot} | ${slot.startTime} | ${slot.endTime} | ${taskName} |`
      )
    }
    lines.push("")
  }
  
  return lines.join("\n")
}