import readline from "readline"
import type { CoreMessage } from "ai"
import { agentDecisionLoop, resetStepCounter } from "./agent/loop"
import {
  shouldCompress,
  compressHistory,
  buildCompressionHint,
} from "./agent/context"
import { initializeState, refreshState } from "./tools/memory-store"
import { autoIntervene, loadState, saveState } from "./tools/intervention"
import { scheduleWeek } from "./tools/scheduler"
import { calculateRisk } from "./tools/risk-predict"

//全局变量
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

let history: CoreMessage[] = []
let runtimeHints: string[] = []

//初始化状态，确保每次启动都有一个基础状态可用
async function ensureState() {
  const existing = await loadState()
  if (existing) return existing
  return initializeState()
}

//解析用户输入的每天可用小时数
function parseDailyHours(input: string): number | null {
  const matched = input.match(/每天\s*(\d+(?:\.\d+)?)\s*小时/u)
  if (!matched) return null
  const value = Number(matched[1])
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

//错误识别：调用本地降级流程
function isRateLimitError(error: unknown): boolean {
  const message = (error as Error)?.message?.toLowerCase() ?? ""
  return message.includes("rate limit") || message.includes("rpm") || message.includes("429")
}

//本地降级流程：在模型不可用时，基于当前状态和简单规则生成回答
async function runLocalFallback(question: string): Promise<string> {
  //取最新状态
  const baseState = await refreshState()
  //解析每日工作时间
  const dailyHours = parseDailyHours(question)
  const availableHours = dailyHours ? Math.round(dailyHours * 7 * 10) / 10 : baseState.weeklyAvailableHours

  if (dailyHours) {
    baseState.weeklyAvailableHours = availableHours
    await saveState(baseState)
  }

  //周计划分配
  const schedule = await scheduleWeek(availableHours)
  //风险评估
  const risk = await calculateRisk()
  //根据风险评估生成干预建议
  const interventionText = await autoIntervene(risk.riskLevel, baseState.consecutiveMissedDays)
  //拿到最终同步状态
  const finalState = await refreshState()

  const scheduleRows = schedule.allocations.length
    ? schedule.allocations
        .map(
          (row) =>
            `| ${row.title} | ${row.weight.toFixed(2)} | ${row.allocatedHours.toFixed(1)} | ${row.priority} | ${schedule.overload ? "超载时保留高权重" : "正常推进"} |`
        )
        .join("\n")
    : "| - | - | - | - | 当前无 in_progress/delayed 任务 |"

  const interventionLines = interventionText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  return [
    "## 状态摘要",
    `- 目标进度：共 ${finalState.goalTree.length} 个目标，已完成 ${Math.round(finalState.completionRate * 100)}%`,
    `- 本周可用时间：${availableHours}h`,
    `- 本周任务需求：${schedule.totalDemand.toFixed(1)}h`,
    `- 关键偏差（延迟率/完成率/压力指数）：${risk.delayRate.toFixed(2)} / ${(risk.completionRate * 100).toFixed(1)}% / ${risk.stressIndex.toFixed(2)}`,
    "",
    "## 本周分配",
    "| 目标/任务 | 权重 | 分配时长(h) | 优先级 | 说明 |",
    "|---|---:|---:|---|---|",
    scheduleRows,
    "",
    "## 风险等级",
    `- 等级：${risk.riskLevel}`,
    `- 触发指标：${risk.triggers.join("、") || "无"}`,
    `- 主要风险源：${risk.triggers[0] ?? "暂无"}`,
    `- 预测结论：${risk.riskLevel === "high" ? "高风险，已建议立即干预" : risk.riskLevel === "medium" ? "中风险，建议持续观察" : "低风险，保持当前节奏"}`,
    "",
    "## 干预动作",
    `1. 动作：${interventionLines[0] ?? "无"}`,
    "2. 影响对象：高风险或延迟目标",
    "3. 执行时机：立即",
    `4. 预期效果：${interventionLines[1] ?? "降低延期风险并稳定节奏"}`,
  ].join("\n")
}

function printHelp() {
  console.log(`
\x1b[1mcampus-cognitive-planner\x1b[0m — 校园效率规划Agent
\x1b[1m可用命令：\x1b[0m
  /reset   清空当前会话历史，重新开始
  /exit    退出
  /state   查看当前状态摘要
  /help    显示此帮助

\x1b[1m可用工具：\x1b[0m
  read_file   读取文件
  write_file  写入文件
  edit_file   局部编辑文件
  bash        执行 Shell 命令
  web_fetch   抓取网页内容
`)
}

function prompt() {
  rl.question("\n\x1b[34m> \x1b[0m", async (input) => {
    const question = input.trim()

    if (question === "/exit" || question === "/quit") {
      console.log("再见！")
      rl.close()
      return
    }

    if (question === "/reset") {
      history = []
      runtimeHints = []
      await initializeState()
      console.log("\x1b[90m[会话与状态已重置]\x1b[0m")
      prompt()
      return
    }

    if (question === "/help") {
      printHelp()
      prompt()
      return
    }

    if (question === "/state") {
      const state = await refreshState()
      console.log(
        `\x1b[90m[风险: ${state.riskLevel} | 可用: ${state.weeklyAvailableHours}h | 需求: ${state.weeklyDemandHours}h | 模式: ${state.interventionMode}]\x1b[0m`
      )
      prompt()
      return
    }

    if (!question) {
      prompt()
      return
    }

    resetStepCounter()

    try {
      //获取当前状态并进入决策循环
      const state = await refreshState()
      const { text, responseMessages, usage, stepCount } = await agentDecisionLoop(
        state,
        question,
        history,
        runtimeHints
      )

      history.push({ role: "user", content: question })
      history.push(...responseMessages)

      if (stepCount > 1) {
        console.log(`\n\x1b[36m── 最终回答 ─────────────────────────────────────\x1b[0m`)
      }
      console.log(text)

      const synced = await refreshState()
      await saveState(synced)

      if (shouldCompress(usage.promptTokens)) {
        console.log("\n\x1b[33m[上下文接近上限，正在压缩...]\x1b[0m")
        try {
          const summary = await compressHistory(history)
          const hint = buildCompressionHint(summary)
          history = []
          runtimeHints = [hint]
          console.log("\x1b[90m[上下文已压缩，下次对话继续]\x1b[0m")
        } catch (e) {
          console.warn(`\x1b[33m[压缩失败: ${(e as Error).message}]\x1b[0m`)
        }
      }
    } catch (e) {
      //错误识别：调用本地降级流程
      if (isRateLimitError(e)) {
        console.warn("\n\x1b[33m[模型限流，已切换本地降级流程并继续执行]\x1b[0m")
        try {
          const fallback = await runLocalFallback(question)
          console.log(fallback)
        } catch (fallbackError) {
          console.error(`\n\x1b[31m[降级流程失败] ${(fallbackError as Error).message}\x1b[0m`)
        }
      } else {
        console.error(`\n\x1b[31m[错误] ${(e as Error).message}\x1b[0m`)
      }
    }

    prompt()
  })
}

async function main() {
  await ensureState()
  console.log(`\x1b[1mcampus-cognitive-planner\x1b[0m \x1b[90mv0.0.1 — 输入 /help 查看帮助\x1b[0m\n`)
  prompt()
}

main().catch((error) => {
  console.error(`\x1b[31m[启动失败] ${(error as Error).message}\x1b[0m`)
  process.exit(1)
})
