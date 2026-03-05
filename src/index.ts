import readline from "readline"
import type { CoreMessage } from "ai"
import { agentDecisionLoop, resetStepCounter } from "./agent/loop"
import {
  shouldCompress,
  compressHistory,
  buildCompressionHint,
} from "./agent/context"
import { initializeState, refreshState } from "./tools/memory-store"
import { loadState, saveState } from "./tools/intervention"

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

let history: CoreMessage[] = []
let runtimeHints: string[] = []

async function ensureState() {
  const existing = await loadState()
  if (existing) return existing
  return initializeState()
}

function printHelp() {
  console.log(`
\x1b[1mcampus-cognitive-planner\x1b[0m — 教学用 Code Agent

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
      console.error(`\n\x1b[31m[错误] ${(e as Error).message}\x1b[0m`)
    }

    prompt()
  })
}

async function main() {
  await ensureState()
  console.log(`\x1b[1mcampus-cognitive-planner\x1b[0m \x1b[90mv0.2.0 — 输入 /help 查看帮助\x1b[0m\n`)
  prompt()
}

main().catch((error) => {
  console.error(`\x1b[31m[启动失败] ${(error as Error).message}\x1b[0m`)
  process.exit(1)
})
