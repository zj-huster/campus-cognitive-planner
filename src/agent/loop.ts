import { generateText, type CoreMessage, type LanguageModelUsage, type StepResult } from "ai"
import { model } from "./provider"
import { assembleSystemPrompt } from "./prompt"
import type { StudyState } from "./context"
import { TOOLS } from "../tools/index"

export interface RunResult {
  text: string
  responseMessages: CoreMessage[]
  usage: LanguageModelUsage
  stepCount: number
}

// 用于存储每次尝试中已完成的步骤
interface AttemptProgress {
  completedSteps: StepResult<any>[]
  messagesBeforeError: CoreMessage[]
}

// ========== 错误恢复：指数退避重试 ==========
export class RateLimitError extends Error {
  constructor(message: string, public readonly retryAfter: number = 2000) {
    super(message)
    this.name = "RateLimitError"
  }
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const DEFAULT_MAX_RETRIES = parsePositiveIntEnv("AGENT_MAX_RETRIES", 5)
const AGENT_MAX_STEPS = parsePositiveIntEnv("AGENT_MAX_STEPS", 10)
const RETRY_BASE_DELAY_MS = parsePositiveIntEnv("AGENT_RETRY_BASE_DELAY_MS", 4000)
const RETRY_MAX_DELAY_MS = parsePositiveIntEnv("AGENT_RETRY_MAX_DELAY_MS", 60000)
const RETRY_JITTER_MS = parsePositiveIntEnv("AGENT_RETRY_JITTER_MS", 1000)
const TRANSIENT_ERROR_EXTRA_DELAY_MS = parsePositiveIntEnv(
  "AGENT_TRANSIENT_ERROR_DELAY_MS",
  1500
)

function isRateLimitError(error: unknown): boolean {
  const message = (error as Error)?.message?.toLowerCase() ?? ""
  return (
    message.includes("rate limit") ||
    message.includes("rpm") ||
    message.includes("429") ||
    message.includes("quota")
  )
}

function isTransientProviderError(error: unknown): boolean {
  const message = (error as Error)?.message?.toLowerCase() ?? ""
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("gateway") ||
    message.includes("temporarily unavailable")
  )
}

function extractRetryAfterMs(error: unknown): number | null {
  const anyError = error as any

  const numericCandidates = [
    anyError?.retryAfter,
    anyError?.retryAfterMs,
    anyError?.cause?.retryAfter,
    anyError?.cause?.retryAfterMs,
  ]

  for (const candidate of numericCandidates) {
    const parsed = Number(candidate)
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed)
    }
  }

  const headerCandidates = [
    anyError?.responseHeaders,
    anyError?.headers,
    anyError?.response?.headers,
    anyError?.cause?.response?.headers,
  ]

  for (const headers of headerCandidates) {
    const retryAfterValue =
      headers?.["retry-after"] ??
      headers?.["Retry-After"] ??
      (typeof headers?.get === "function" ? headers.get("retry-after") : undefined)

    if (retryAfterValue != null) {
      const text = String(retryAfterValue).trim()
      const seconds = Number(text)
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.floor(seconds * 1000)
      }

      const asDate = Date.parse(text)
      if (Number.isFinite(asDate)) {
        const ms = asDate - Date.now()
        if (ms > 0) {
          return Math.floor(ms)
        }
      }
    }
  }

  const message = (anyError?.message as string | undefined) ?? ""
  const byMs = message.match(/(\d{3,})\s*ms/i)
  if (byMs?.[1]) {
    const parsed = Number(byMs[1])
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed)
    }
  }

  const bySeconds = message.match(/(?:after|等待|重试).*?(\d{1,3})\s*s/i)
  if (bySeconds?.[1]) {
    const parsed = Number(bySeconds[1])
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed * 1000)
    }
  }

  return null
}

async function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 带指数退避重试的包装函数（支持断点续传）
export async function agentDecisionLoopWithRetry(
  state: StudyState,
  userInstruction: string,
  history: CoreMessage[] = [],
  runtimeHints: string[] = [],
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<RunResult> {
  let lastError: Error | null = null
  let lastRetryAfterFromServer = 0
  let accumulatedHistory = [...history] // 累积的历史消息（包含已完成的工具调用）
  let totalCompletedSteps = 0 // 累积的已完成步骤数

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const baseWait = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
        const jitter = Math.floor(Math.random() * RETRY_JITTER_MS)
        const serverSuggestedWait = lastRetryAfterFromServer > 0 ? lastRetryAfterFromServer : 0
        const transientPenalty = isTransientProviderError(lastError)
          ? TRANSIENT_ERROR_EXTRA_DELAY_MS
          : 0
        const waitMs = Math.min(
          RETRY_MAX_DELAY_MS,
          Math.max(baseWait + jitter + transientPenalty, serverSuggestedWait)
        )
        console.log(
          `\x1b[33m[重试 ${attempt}/${maxRetries - 1}，从第 ${totalCompletedSteps + 1} 步继续，等待 ${waitMs}ms...]\x1b[0m`
        )
        await sleepMs(waitMs)
        
        // 设置步骤计数器偏移，让后续步骤编号正确显示
        setStepCounterOffset(totalCompletedSteps)
      }

      // 使用累积的历史进行决策（支持断点续传）
      const result = await agentDecisionLoop(state, userInstruction, accumulatedHistory, runtimeHints)
      
      // 成功完成，返回结果
      return {
        ...result,
        stepCount: totalCompletedSteps + result.stepCount, // 包含所有尝试的步骤总数
      }
    } catch (error) {
      lastError = error as Error
      lastRetryAfterFromServer = extractRetryAfterMs(error) ?? 0
      
      // 检查是否为限流错误
      const isRateLimited = isRateLimitError(error)
      const isTransient = isTransientProviderError(error)
      if (!isRateLimited && !isTransient) {
        throw error // 非限流错误，立即抛出
      }

      // 可重试错误：尝试从错误对象中提取已完成的步骤
      const partialMessages = extractPartialMessages(error)
      if (partialMessages.length > 0) {
        // 计算新增的步骤数（过滤出 assistant 消息）
        const newStepsCount = partialMessages.filter(m => m.role === 'assistant').length
        
        // 将已完成的步骤添加到累积历史中
        accumulatedHistory = [...accumulatedHistory, ...partialMessages]
        totalCompletedSteps += newStepsCount
        
        console.log(
          `\x1b[90m[✓ 已保存 ${newStepsCount} 个完成步骤（共 ${partialMessages.length} 条消息）到历史]\x1b[0m`
        )
      } else {
        console.log(
          `\x1b[90m[⚠ 未能提取已完成步骤，将从头重试]\x1b[0m`
        )
      }

      if (attempt === maxRetries - 1) {
        const recommendedRetryAfter = Math.max(
          Math.min(
            RETRY_MAX_DELAY_MS,
            RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(maxRetries - 1, 0)) + RETRY_JITTER_MS
          ),
          lastRetryAfterFromServer || 0
        )
        throw new RateLimitError(
          `模型限流，${maxRetries} 次重试后仍失败`,
          recommendedRetryAfter
        )
      }
    }
  }

  throw lastError || new Error("未知错误")
}

// 从错误对象中提取部分已完成的消息（如果 SDK 支持）
function extractPartialMessages(error: unknown): CoreMessage[] {
  // Vercel AI SDK 在某些情况下会在错误对象中附加已完成的消息
  // 这是一个兜底逻辑，如果 SDK 支持则使用
  const anyError = error as any
  if (anyError?.responseMessages && Array.isArray(anyError.responseMessages)) {
    return anyError.responseMessages as CoreMessage[]
  }
  
  // 如果错误对象中有 messages 字段
  if (anyError?.messages && Array.isArray(anyError.messages)) {
    return anyError.messages as CoreMessage[]
  }
  
  // 无法提取，返回空数组
  return []
}

/**
 * 通过请求队列执行 Agent 决策循环
 * 这确保了即使有多个用户请求，也会按顺序执行，避免并发导致的限流
 */
export async function agentDecisionLoopQueued(
  state: StudyState,
  userInstruction: string,
  history: CoreMessage[] = [],
  runtimeHints: string[] = [],
  maxRetries: number = DEFAULT_MAX_RETRIES,
  queue?: any // 接受任何 RequestQueue 实例或 undefined
): Promise<RunResult> {
  // 动态导入以避免循环依赖
  const { getGlobalQueue } = await import("./request-queue")
  const requestQueue = queue || getGlobalQueue()

  // 将 Agent 调用提交到队列
  return requestQueue.enqueue(
    () => agentDecisionLoopWithRetry(state, userInstruction, history, runtimeHints, maxRetries),
    50 // 默认优先级
  )
}

// ========== 新增：Agent 决策循环（状态驱动） ==========
export async function agentDecisionLoop(
  state: StudyState, // 当前学习状态
  userInstruction: string, // 用户指令（可选，如"生成本周计划"）
  history: CoreMessage[] = [],
  runtimeHints: string[] = []
): Promise<RunResult> {
  // 1. 组装系统提示词（注入状态）
  const system = await assembleSystemPrompt(state, runtimeHints)

  // 2. 构建初始消息
  const messages: CoreMessage[] = [
    ...history,
    {
      role: "user",
      content: userInstruction || "请基于当前状态生成本周学习计划",
    },
  ]

  // 3. 收集已完成的步骤消息（用于断点续传）
  const completedMessages: CoreMessage[] = []
  let completedStepCount = 0

  try {
    // 4. 执行决策循环
    const result = await generateText({
      model,
      system,
      messages,
      tools: TOOLS,
      maxSteps: AGENT_MAX_STEPS,

      onStepFinish: ({ text, toolCalls, toolResults, finishReason, response }) => {
        const isFinalStep = finishReason === "stop" && toolCalls.length === 0
        if (!isFinalStep) {
          printStep({ text, toolCalls, finishReason })
        }

        // 实时收集已完成的消息（用于断点续传）
        // response.messages 包含从开始到当前步骤的所有消息
        if (response.messages && response.messages.length > completedMessages.length) {
          // 只添加新增的消息
          const newMessages = (response.messages as CoreMessage[]).slice(completedMessages.length)
          completedMessages.push(...newMessages)
          completedStepCount++
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
  } catch (error) {
    // 如果发生错误，将已完成的消息附加到错误对象中（用于断点续传）
    const enhancedError = error as any
    if (completedMessages.length > 0) {
      enhancedError.responseMessages = completedMessages
      console.log(
        `\x1b[33m[错误发生前已完成 ${completedStepCount} 个步骤（${completedMessages.length} 条消息），将用于断点续传]\x1b[0m`
      )
    }
    throw enhancedError
  }
}

// ========== 打印辅助函数 ==========
interface StepInfo {
  text: string
  toolCalls: Array<{ toolName: string; args: unknown }>
  finishReason: string
}

let stepCounter = 0
let isRetryMode = false // 标记是否处于重试模式

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
  isRetryMode = false
}

// 设置步骤计数器的起始值（用于重试时的断点续传）
export function setStepCounterOffset(offset: number) {
  stepCounter = offset
  isRetryMode = offset > 0
}
