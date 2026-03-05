import { generateText, type CoreMessage, type LanguageModelUsage } from "ai"
import { model } from "./provider"
import { assembleSystemPrompt } from "./prompt"
import { buildStateHint, type StudyState } from "./context"
import { TOOLS } from "../tools/index"

export interface RunResult {
  text: string
  responseMessages: CoreMessage[]
  usage: LanguageModelUsage
  stepCount: number
}

// ========== 新增：Agent 决策循环（状态驱动） ==========
export async function agentDecisionLoop(
  state: StudyState, // 当前学习状态
  userInstruction: string, // 用户指令（可选，如"生成本周计划"）
  history: CoreMessage[] = []
): Promise<RunResult> {
  // 1. 组装系统提示词（注入状态）
  const system = await assembleSystemPrompt(state, [])

  // 2. 构建初始消息
  const messages: CoreMessage[] = [
    ...history,
    {
      role: "user",
      content: userInstruction || "请基于当前状态生成本周学习计划",
    },
  ]

  // 3. 执行决策循环
  const result = await generateText({
    model,
    system,
    messages,
    tools: TOOLS,
    maxSteps: 50,

    onStepFinish: ({ text, toolCalls, finishReason }) => {
      const isFinalStep = finishReason === "stop" && toolCalls.length === 0
      if (!isFinalStep) {
        printStep({ text, toolCalls, finishReason })
      }
    },
  })

  const stepCount = result.steps.length
  if (stepCount > 1) {
    console.log(`\n\x1b[90m[共执行 ${stepCount} 步]\x1b[0m\n`)
  }

  return {
    text: result.text,
    responseMessages: result.response.messages as CoreMessage[],
    usage: result.usage,
    stepCount,
  }
}

// ========== 原有通用循环（保留兼容） ==========
export async function agentLoop(
  question: string,
  history: CoreMessage[],
  runtimeHints: string[] = []
): Promise<RunResult> {
  const system = await assembleSystemPrompt(undefined, runtimeHints)

  // 将用户问题追加到 history（generateText 需要完整的 messages 数组）
  const messages: CoreMessage[] = [
    ...history,
    { role: "user", content: question },
  ]

  const result = await generateText({
    model,
    system,
    messages,
    tools: TOOLS,
    maxSteps: 50, // ReAct 最大轮次，防止无限循环

    // 每步完成后的回调：打印执行过程
    // 最后一步（无工具调用、finishReason=stop）不打印，由外层统一输出最终结果
    onStepFinish: ({ text, toolCalls, finishReason }) => {
      const isFinalStep = finishReason === "stop" && toolCalls.length === 0
      if (!isFinalStep) {
        printStep({ text, toolCalls, finishReason })
      }
    },
  })

  // steps 包含所有中间步骤，打印总步数
  const stepCount = result.steps.length
  if (stepCount > 1) {
    console.log(`\n\x1b[90m[共执行 ${stepCount} 步]\x1b[0m\n`)
  }

  return {
    text: result.text,
    responseMessages: result.response.messages as CoreMessage[],
    usage: result.usage,
    stepCount,
  }
}

// ========== 打印辅助函数 ==========
interface StepInfo {
  text: string
  toolCalls: Array<{ toolName: string; args: unknown }>
  finishReason: string
}

let stepCounter = 0

function printStep({ text, toolCalls }: StepInfo) {
  stepCounter++
  console.log(`\n\x1b[36m── Step ${stepCounter} ──────────────────────────────────\x1b[0m`)

  // LLM 思考文本（如果有）
  if (text.trim()) {
    console.log(`\x1b[37m${text.trim()}\x1b[0m`)
  }

  // 工具调用
  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i]

    // 工具调用：一行，参数压缩成单行 JSON，超 120 字符截断
    const argsOneLine = JSON.stringify(call.args)
    const argsPreview =
      argsOneLine.length > 120 ? argsOneLine.slice(0, 120) + "…}" : argsOneLine
    console.log(`\n\x1b[32m🔧 ${call.toolName}\x1b[0m \x1b[90m${argsPreview}\x1b[0m`)

  }
}

// 重置步骤计数器（每次新对话调用）
export function resetStepCounter() {
  stepCounter = 0
}
