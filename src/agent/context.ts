import type { CoreMessage } from "ai"
import { generateText } from "ai"
import { model } from "./provider"

// ========== 学习状态结构 ==========
export interface GoalNode {
  id: string
  title: string
  parentId: string | null
  longTermValue: number // 0-1，长期重要性
  urgency: number // 0-1，紧急程度
  deadline: string | null // ISO 8601
  estimatedHours: number
  actualHours: number
  status: "pending" | "in_progress" | "completed" | "delayed"
}

export interface StudyState {
  // 目标树
  goalTree: GoalNode[]

  // 时间预算
  weeklyAvailableHours: number // 本周可用总时长
  weeklyDemandHours: number // 本周任务需求总时长

  // 风险指标
  delayRate: number // 延迟率 = 实际完成时间 / 计划完成时间
  completionRate: number // 完成率 = 已完成 / 计划完成
  stressIndex: number // 压力指数 = 未完成高优任务数 × 权重

  // 行为状态
  consecutiveMissedDays: number // 连续未完成天数
  fatigueScore: number // 疲劳度 0-1
  interventionMode: "normal" | "light" | "sprint" // 当前策略模式

  // 风险等级
  riskLevel: "low" | "medium" | "high"
}

// ========== 原有压缩逻辑保持，新增状态序列化 ==========
const MODEL_CONTEXT_LIMIT = 128_000
// 超过 80% 时触发压缩，留余量给 LLM 输出和工具结果
const COMPRESS_THRESHOLD = 0.8

// 使用 AI SDK 返回的真实 promptTokens 判断是否需要压缩
export function shouldCompress(promptTokens: number): boolean {
  return promptTokens > MODEL_CONTEXT_LIMIT * COMPRESS_THRESHOLD
}

// 将完整 history 压缩为结构化摘要
// 摘要要能支撑下一轮继续工作：不追求"漂亮"，追求"够用"
export async function compressHistory(
  history: CoreMessage[]
): Promise<string> {
  const COMPRESS_SYSTEM = `
总结执行历史为密集格式（XML）：
<completed>已完成操作（每行一条，仅关键细节）</completed>
<remaining>未完成任务</remaining>
<state>当前状态（文件、变量、环境）</state>
<notes>踩过的坑、特殊处理</notes>

要求：极度精简，每条信息 ≤ 20 字
`.trim()

  // 只取最后 N 条消息，减少输入
  const recentHistory = history.slice(-20) // 只用最近 20 条

  const historyText = recentHistory
    .map((m) => {
      const content =
        typeof m.content === "string"
          ? m.content.substring(0, 200) // 截断超长内容
          : JSON.stringify(m.content).substring(0, 200)
      return `[${m.role}] ${content}`
    })
    .join("\n")

  const { text } = await generateText({
    model,
    system: COMPRESS_SYSTEM,
    prompt: historyText,
    maxSteps: 1,
  })

  return text
}

// 用压缩摘要重建最小 history 和运行时 hint
export function buildCompressionHint(summary: string): string {
  return [
    "[执行历史摘要 - 之前会话已压缩]",
    "",
    summary,
    "",
    "注意：以上是对之前执行历史的摘要，你处于重建会话状态。",
    "请基于摘要继续完成原始任务，不要重复已完成的操作。",
  ].join("\n")
}

// ========== 新增：状态序列化为 Prompt Hint ==========
export function buildStateHint(state: StudyState): string {
  const activeGoals = state.goalTree.filter(
    (g) => g.status === "in_progress" || g.status === "delayed"
  )

  // 精简格式，移除冗余标题
  const lines: string[] = [
    `活跃目标(${activeGoals.length}): ${activeGoals
      .map((g) =>
        `${g.title}[${g.estimatedHours - g.actualHours}h]`
      )
      .join(", ")}`,
    `时间: ${state.weeklyAvailableHours}h可用/${state.weeklyDemandHours}h需求 (${((state.weeklyDemandHours / state.weeklyAvailableHours) * 100).toFixed(0)}%)`,
    `风险: 延迟${state.delayRate.toFixed(1)} 完成${(state.completionRate * 100).toFixed(0)}% 压力${state.stressIndex.toFixed(1)} [${state.riskLevel}]`,
    `状态: 连续未完成${state.consecutiveMissedDays}d 疲劳${(state.fatigueScore * 100).toFixed(0)}% 模式${state.interventionMode}`,
  ]

  return lines.join("\n")
}
