import type { CoreMessage } from "ai"
import { generateText } from "ai"
import { model } from "./provider"

// ========== 新增：学习状态结构 ==========
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
你是一个 Agent 执行历史压缩器。将以下执行历史总结为结构化摘要，输出格式如下（使用 XML 标签）：

<completed>
已完成的具体操作（每行一条，保留关键细节）
</completed>

<remaining>
还未完成的任务或子任务
</remaining>

<current_state>
当前状态：已修改的文件路径、关键变量、环境状态等
</current_state>

<notes>
注意事项：踩过的坑、特殊处理、边界条件
</notes>

要求：信息密度高，去掉废话，保留所有对后续执行有用的细节。
`.trim()

  const historyText = history
    .map((m) => {
      const content =
        typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.content)
      return `[${m.role}]\n${content}`
    })
    .join("\n\n---\n\n")

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
  const sections: string[] = []

  // 1. 目标树摘要
  const activeGoals = state.goalTree.filter(
    (g) => g.status === "in_progress" || g.status === "delayed"
  )
  sections.push("## 当前活跃目标")
  sections.push(
    activeGoals
      .map(
        (g) =>
          `- [${g.status}] ${g.title} (剩余: ${g.estimatedHours - g.actualHours}h, DDL: ${g.deadline || "无"})`
      )
      .join("\n")
  )

  // 2. 时间预算
  sections.push("\n## 时间预算")
  sections.push(`- 本周可用: ${state.weeklyAvailableHours}h`)
  sections.push(`- 本周需求: ${state.weeklyDemandHours}h`)
  sections.push(
    `- 负载率: ${((state.weeklyDemandHours / state.weeklyAvailableHours) * 100).toFixed(1)}%`
  )

  // 3. 风险指标
  sections.push("\n## 风险指标")
  sections.push(`- 延迟率: ${state.delayRate.toFixed(2)}`)
  sections.push(`- 完成率: ${(state.completionRate * 100).toFixed(1)}%`)
  sections.push(`- 压力指数: ${state.stressIndex.toFixed(2)}`)
  sections.push(`- 风险等级: ${state.riskLevel}`)

  // 4. 行为状态
  sections.push("\n## 行为状态")
  sections.push(`- 连续未完成: ${state.consecutiveMissedDays} 天`)
  sections.push(`- 疲劳度: ${(state.fatigueScore * 100).toFixed(1)}%`)
  sections.push(`- 策略模式: ${state.interventionMode}`)

  return sections.join("\n")
}
