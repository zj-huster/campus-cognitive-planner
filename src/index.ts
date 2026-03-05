import readline from "readline"
import type { CoreMessage } from "ai"
import { agentLoop, agentDecisionLoop, resetStepCounter } from "./agent/loop"
import {
  shouldCompress,
  compressHistory,
  buildCompressionHint,
} from "./agent/context"
import type { StudyState } from "./agent/context"

// ── CLI 多轮对话 ──────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

// 维护跨轮对话的消息历史（不含系统提示词，generateText 单独传 system）
let history: CoreMessage[] = []
// 运行时 hint 列表（如上下文压缩摘要，会注入系统提示词 Segment 3）
let runtimeHints: string[] = []

function prompt() {
  rl.question("\n\x1b[34m> \x1b[0m", async (input) => {
    const question = input.trim()

    // slash 命令
    if (question === "/exit" || question === "/quit") {
      console.log("再见！")
      rl.close()
      return
    }

    if (question === "/reset") {
      history = []
      runtimeHints = []
      console.log("\x1b[90m[会话已重置]\x1b[0m")
      prompt()
      return
    }

    if (question === "/help") {
      printHelp()
      prompt()
      return
    }

    if (!question) {
      prompt()
      return
    }

    // ── 执行 Agent Loop ────────────────────────────────────────────────────────
    resetStepCounter()

    try {
      const { text, responseMessages, usage, stepCount } = await agentLoop(
        question,
        history,
        runtimeHints
      )

      // 将本轮消息（含所有中间工具调用步骤）追加到 history
      history.push({ role: "user", content: question })
      history.push(...responseMessages)

      // 有工具调用（多步）时才打印分隔线，纯文本回答直接输出，避免重复
      if (stepCount > 1) {
        console.log(`\n\x1b[36m── 最终回答 ─────────────────────────────────────\x1b[0m`)
      }
      console.log(text)

      // ── 上下文压缩检查（本轮结束后，基于 API 返回的真实 token 用量）────────
      // promptTokens 是本轮实际发送的 token 数，比字符估算准确
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

function printHelp() {
  console.log(`
\x1b[1mcampus-cognitive-planner\x1b[0m — 教学用 Code Agent

\x1b[1m可用命令：\x1b[0m
  /reset   清空当前会话历史，重新开始
  /exit    退出
  /help    显示此帮助

\x1b[1m可用工具：\x1b[0m
  read_file   读取文件
  write_file  写入文件
  edit_file   局部编辑文件
  bash        执行 Shell 命令
  web_fetch   抓取网页内容
`)
}

// ── 启动 ──────────────────────────────────────────────────────────────────────

console.log(`\x1b[1mcampus-cognitive-planner\x1b[0m \x1b[90mv0.1.0 — 输入 /help 查看帮助\x1b[0m\n`)
prompt()

// ========== 模拟初始状态（后续从文件/数据库加载） ==========
const MOCK_STATE: StudyState = {
  goalTree: [
    {
      id: "g1",
      title: "高数强化",
      parentId: null,
      longTermValue: 0.9,
      urgency: 0.8,
      deadline: "2026-03-15T00:00:00Z",
      estimatedHours: 20,
      actualHours: 8,
      status: "in_progress",
    },
    {
      id: "g2",
      title: "线代专项",
      parentId: null,
      longTermValue: 0.7,
      urgency: 0.9,
      deadline: "2026-03-10T00:00:00Z",
      estimatedHours: 15,
      actualHours: 7,
      status: "delayed",
    },
  ],
  weeklyAvailableHours: 50,
  weeklyDemandHours: 62,
  delayRate: 1.35,
  completionRate: 0.675,
  stressIndex: 8.42,
  consecutiveMissedDays: 3,
  fatigueScore: 0.72,
  interventionMode: "light",
  riskLevel: "high",
}

async function main() {
  console.log("\x1b[1m\x1b[34m🎓 Campus Cognitive Planner - Agent Decision Loop\x1b[0m\n")

  resetStepCounter()

  // 调用决策循环
  const result = await agentDecisionLoop(
    MOCK_STATE,
    "请生成本周学习计划，并进行风险评估和干预决策"
  )

  // 打印最终输出
  console.log("\n\x1b[1m\x1b[33m━━━ 决策结果 ━━━\x1b[0m\n")
  console.log(result.text)

  console.log("\n\x1b[90m────────────────────────────────────────────")
  console.log(`Token 用量: ${result.usage.totalTokens}`)
  console.log(`决策步数: ${result.stepCount}\x1b[0m`)
}

main().catch(console.error)
