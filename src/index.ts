import readline from "readline"
import { join } from "path"
import { mkdir } from "fs/promises"
import type { CoreMessage } from "ai"
import { agentDecisionLoopQueued, RateLimitError, resetStepCounter } from "./agent/loop"
import { getGlobalQueue } from "./agent/request-queue"
import {
  shouldCompress,
  compressHistory,
  buildCompressionHint,
} from "./agent/context"
import { initializeState, refreshState } from "./tools/memory-store"
import { autoIntervene } from "./tools/intervention"
import { scheduleWeek } from "./tools/scheduler"
import { calculateRisk } from "./tools/risk-predict"
import { resolveSafePath } from "./utils/safety"
import { loadGoalTree } from "./tools/goal-tree"
import { loadTasks } from "./tools/task-store"
import type { StudyTask } from "./agent/context"
import { formatLocalDate, formatLocalDateTime, formatLocalTimestampForFile } from "./utils/datetime"
import {
  renderMarkdown,
  printUserMessage,
  printAssistantMessage,
  printSystemMessage,
  printError,
  printWarning,
  printSuccess,
  printDivider,
  clearScreen
} from "./utils/markdown"
import chalk from "chalk"

//全局变量
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

let history: CoreMessage[] = []
let runtimeHints: string[] = []
let preferredWeeklyHours = 50

function buildCurrentTimeHint(): string {
  const now = new Date()
  return [
    `[系统时间] 当前本地时间: ${formatLocalDateTime(now)}`,
    `[系统日期] 今天是: ${formatLocalDate(now)}`,
    "处理‘今日/明日/昨天’相关请求时，必须以系统日期为准，不要自行猜测。",
  ].join("\n")
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const AGENT_MAX_RETRIES = parsePositiveIntEnv("AGENT_MAX_RETRIES", 5)

//初始化状态，确保每次启动都有一个基础状态可用
async function ensureState() {
  return initializeState(preferredWeeklyHours)
}

//解析用户输入的每天可用小时数
function parseDailyHours(input: string): number | null {
  const matched = input.match(/每天\s*(\d+(?:\.\d+)?)\s*小时/u)
  if (!matched) return null
  const value = Number(matched[1])
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

// 将回答保存到 markdown 文件
async function saveAnswerToFile(content: string, userQuestion: string): Promise<string> {
  const logsDir = resolveSafePath("data/logs", "write")
  await mkdir(logsDir, { recursive: true })
  
  const timestamp = formatLocalTimestampForFile(new Date())
  const filename = `${timestamp}.md`
  const filePath = join(logsDir, filename)
  
  const fileContent = [
    `# Agent 回答记录\n`,
    `**时间**: ${new Date().toLocaleString("zh-CN")}\n`,
    `**用户提问**: ${userQuestion}\n`,
    `---\n`,
    content
  ].join("\n")
  
  await Bun.write(filePath, fileContent)
  return filePath
}


//本地降级流程：在模型不可用时，基于当前状态和简单规则生成回答
async function runLocalFallback(question: string): Promise<string> {
  //取最新状态
  const baseState = await refreshState(preferredWeeklyHours)
  //解析每日工作时间
  const dailyHours = parseDailyHours(question)
  const availableHours = dailyHours ? Math.round(dailyHours * 7 * 10) / 10 : baseState.weeklyAvailableHours

  if (dailyHours) {
    preferredWeeklyHours = availableHours
  }

  //周计划分配
  const schedule = await scheduleWeek(availableHours)
  //风险评估
  const risk = await calculateRisk()
  //根据风险评估生成干预建议
  const interventionText = await autoIntervene(risk.riskLevel, baseState.consecutiveMissedDays)
  //拿到最终同步状态
  const finalState = await refreshState(availableHours)

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
  const helpText = `
# 📚 Campus Cognitive Planner

一个基于AI的校园学习规划助手，帮助你高效管理学习目标和任务。

## 可用命令

- \`/reset\` - 清空当前会话历史，重新开始
- \`/queue\` - 查看请求队列状态
- \`/state\` - 查看当前状态摘要
- \`/clear\` - 清屏
- \`/help\` - 显示此帮助
- \`/exit\` 或 \`/quit\` - 退出程序

## 可用工具

- **read_file** - 读取文件内容
- **write_file** - 写入文件
- **edit_file** - 局部编辑文件
- **bash** - 执行Shell命令
- **web_fetch** - 抓取网页内容
- **goal_tree** - 管理学习目标
- **task_store** - 管理学习任务
- **scheduler** - 周计划生成
- **risk_predict** - 风险评估

## 使用示例

- "帮我规划这周的学习时间"
- "评估当前的学习风险"
- "添加一个新的学习目标"
- "查看我的任务完成情况"
`
  console.log(renderMarkdown(helpText))
}

function prompt() {
  rl.question(chalk.bold.blue("\n💭 You: "), async (input) => {
    const question = input.trim()

    if (question === "/exit" || question === "/quit") {
      printSuccess("再见！")
      rl.close()
      return
    }

    if (question === "/reset") {
      history = []
      runtimeHints = []
      await initializeState(preferredWeeklyHours)
      printSystemMessage("会话与状态已重置")
      prompt()
      return
    }

    if (question === "/help") {
      printHelp()
      prompt()
      return
    }

    if (question === "/clear") {
      clearScreen()
      printSuccess("屏幕已清空")
      prompt()
      return
    }

    if (question === "/state") {
      const state = await refreshState(preferredWeeklyHours)
      const stateInfo = `
**当前状态摘要**

- 🎯 风险等级: ${state.riskLevel}
- ⏰ 本周可用: ${state.weeklyAvailableHours}h
- 📊 本周需求: ${state.weeklyDemandHours}h
- 🔧 干预模式: ${state.interventionMode}
`
      console.log(renderMarkdown(stateInfo))
      prompt()
      return
    }

    if (question === "/queue") {
      const queue = getGlobalQueue()
      const status = queue.getStatus()
      printSystemMessage(
        `队列长度: ${status.queueLength} | 飞行中: ${status.requestsInFlight} | 处理中: ${status.processing ? "是" : "否"}`
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
      const dailyHours = parseDailyHours(question)
      if (dailyHours) {
        preferredWeeklyHours = Math.round(dailyHours * 7 * 10) / 10
      }

      // 获取当前状态并通过队列执行决策循环
      // 所有请求都会按顺序进入队列，避免并发导致的限流
      const state = await refreshState(preferredWeeklyHours)
      const queue = getGlobalQueue()
      const requestRuntimeHints = [...runtimeHints, buildCurrentTimeHint()]
      
      printSystemMessage("正在思考...")
      
      const { text, responseMessages, usage, stepCount } = await agentDecisionLoopQueued(
        state,
        question,
        history,
        requestRuntimeHints,
        AGENT_MAX_RETRIES,
        queue
      )

      history.push({ role: "user", content: question })
      history.push(...responseMessages)

      // 显示完整的markdown格式回答
      printDivider()
      printAssistantMessage(text)
      printDivider()
      
      // 将完整回答保存到文件
      const savedPath = await saveAnswerToFile(text, question)
      printSystemMessage(`回答已保存到: ${savedPath}`)

      if (shouldCompress(usage.promptTokens)) {
        printWarning("上下文接近上限，正在压缩...")
        try {
          const compressedSummary = await compressHistory(history)
          const hint = buildCompressionHint(compressedSummary)
          history = []
          runtimeHints = [hint]
          printSystemMessage("上下文已压缩，下次对话继续")
        } catch (e) {
          printWarning(`压缩失败: ${(e as Error).message}`)
        }
      }
    } catch (e) {
      //错误识别：3次重试都失败的限流错误才调用降级流程
      if (e instanceof RateLimitError) {
        printWarning(
          `限流已达到重试上限 (${(e as RateLimitError).retryAfter}ms 后可重试)，切换本地降级流程`
        )
        try {
          const fallback = await runLocalFallback(question)
          printDivider()
          printAssistantMessage(fallback)
          printDivider()
          await saveAnswerToFile(fallback, question)
          printSystemMessage("已使用本地降级模式完成")
        } catch (fallbackError) {
          printError(`降级流程失败: ${(fallbackError as Error).message}`)
        }
      } else {
        printError((e as Error).message)
      }
    }

    prompt()
  })
}

async function main() {
  await ensureState()
  
  // 显示欢迎信息
  clearScreen()
  const welcomeText = `
# 🎓 Campus Cognitive Planner

**版本**: v0.0.1  
**描述**: 基于AI的校园学习规划助手

输入 \`/help\` 查看帮助信息，输入 \`/exit\` 退出程序。

---
`
  console.log(renderMarkdown(welcomeText))
  prompt()
}

main().catch((error) => {
  printError(`启动失败: ${(error as Error).message}`)
  process.exit(1)
})
