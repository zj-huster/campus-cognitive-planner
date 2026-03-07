import { tool } from "ai"
import { z } from "zod"
import { readFile } from "./read-file"
import { writeFile } from "./write-file"
import { editFile } from "./edit-file"
import { bash } from "./bash"
import { webFetch } from "./web-fetch"
import { addGoal, updateGoal, getGoalSummary, findGoalByTitle } from "./goal-tree"
import { generateAndPersistWeeklyAndDailyTasks } from "./scheduler"
import { generateRiskReport } from "./risk-predict"
import { autoIntervene } from "./intervention"
import { initializeState, refreshState } from "./memory-store"
import { addTask, updateTask, getTaskSummary, clearOutdatedTasks, getWeeklyProgress, syncTasksFromGoals, getTodayTasks, markTaskCompletedByTitle } from "./task-store"

// 工具注册表
// Vercel AI SDK 的 tool() 封装了参数 schema（Zod）和执行函数
// SDK 自动处理：参数解析 → 执行 → 结果回填到 history
export const TOOLS = {
  read_file: tool({
    description:
      "读取本地文件内容。大文件建议用 offset + limit 分段读取，避免一次性读取撑爆上下文。输出带行号，方便定位。",
    parameters: z.object({
      path: z.string().describe("文件路径（相对于当前工作目录）"),
      offset: z
        .number()
        .optional()
        .describe("从第几行开始读（0-indexed，默认从头）"),
      limit: z
        .number()
        .optional()
        .describe("最多读取多少行（默认读到文件末尾）"),
    }),
    execute: readFile,
  }),

  write_file: tool({
    description:
      "将内容写入文件。文件不存在则创建，已存在则完整覆盖。局部修改请用 edit_file，避免不必要的全量重写。",
    parameters: z.object({
      path: z.string().describe("文件路径（相对于当前工作目录）"),
      content: z.string().describe("要写入的完整文件内容"),
    }),
    execute: writeFile,
  }),

  edit_file: tool({
    description:
      "替换文件中的特定字符串。old_string 必须在文件中唯一存在（仅出现一次），否则会报错。建议先用 read_file 确认目标字符串。",
    parameters: z.object({
      path: z.string().describe("文件路径（相对于当前工作目录）"),
      old_string: z.string().describe("要被替换的原始字符串，必须唯一"),
      new_string: z.string().describe("替换后的新字符串"),
    }),
    execute: editFile,
  }),

  bash: tool({
    description:
      "执行 Shell 命令。危险命令（如 rm -rf）会暂停并等待用户确认。命令输出超长时自动截断。",
    parameters: z.object({
      command: z.string().describe("要执行的 Shell 命令"),
      timeout: z
        .number()
        .optional()
        .describe("超时时间（毫秒），默认 30000"),
    }),
    execute: bash,
  }),

  web_fetch: tool({
    description:
      "抓取网页内容并转换为 Markdown 格式返回。适合查阅文档、README、API 参考等。",
    parameters: z.object({
      url: z.string().describe("要抓取的完整 URL（包含 https://）"),
    }),
    execute: webFetch,
  }),

  // ========== 新增：学习 Agent 核心工具 ==========
  add_goal: tool({
    description: "添加新的学习目标到目标树",
    parameters: z.object({
      title: z.string().describe("目标名称"),
      parentId: z.string().optional().describe("父目标 ID（可选）"),
      longTermValue: z
        .number()
        .min(0)
        .max(1)
        .describe("长期价值 0-1"),
      urgency: z
        .number()
        .min(0)
        .max(1)
        .describe("紧急程度 0-1"),
      deadline: z
        .string()
        .optional()
        .describe("截止日期 ISO 8601"),
      estimatedHours: z
        .number()
        .describe("预计所需小时数"),
    }),
    execute: addGoal,
  }),

  update_goal: tool({
    description: "更新目标的完成情况",
    parameters: z.object({
      id: z.string().describe("目标 ID"),
      actualHours: z
        .number()
        .optional()
        .describe("实际完成小时数"),
      status: z
        .enum(["pending", "in_progress", "completed", "delayed"])
        .optional(),
    }),
    execute: updateGoal,
  }),

  get_goal_summary: tool({
    description: "获取当前所有目标的摘要",
    parameters: z.object({}),
    execute: getGoalSummary,
  }),

  find_goal: tool({
    description: "根据标题关键词模糊查找目标（返回目标ID、状态、进度等信息）",
    parameters: z.object({
      titleKeyword: z.string().describe("目标标题关键词（支持模糊匹配）"),
    }),
    execute: async ({ titleKeyword }) => findGoalByTitle(titleKeyword),
  }),

  add_task: tool({
    description: "添加周任务或日任务到任务池（写入 data/tasks.json）",
    parameters: z.object({
      title: z.string().describe("任务名称"),
      goalId: z.string().optional().describe("关联目标 ID（可选）"),
      level: z.enum(["weekly", "daily"]).describe("任务层级"),
      date: z.string().optional().describe("日任务日期 YYYY-MM-DD，仅 daily 需要"),
      weekStart: z.string().optional().describe("周起始日期 YYYY-MM-DD（可选）"),
      plannedHours: z.number().describe("计划时长（小时）"),
      priority: z.enum(["P0", "P1", "P2"]).optional().describe("优先级"),
    }),
    execute: addTask,
  }),

  update_task: tool({
    description: "更新任务状态/实际时长（写入 data/tasks.json）",
    parameters: z.object({
      id: z.string().describe("任务 ID"),
      actualHours: z.number().optional().describe("实际完成时长"),
      status: z
        .enum(["pending", "in_progress", "completed", "deferred"])
        .optional()
        .describe("任务状态"),
    }),
    execute: updateTask,
  }),

  get_task_summary: tool({
    description: "获取当前任务池摘要（读取 data/tasks.json）",
    parameters: z.object({}),
    execute: getTaskSummary,
  }),

  get_today_tasks: tool({
    description: "获取今日任务清单（按状态分组展示）",
    parameters: z.object({}),
    execute: getTodayTasks,
  }),

  mark_task_completed: tool({
    description: "根据标题关键词快速标记任务完成（优先匹配今日任务）",
    parameters: z.object({
      titleKeyword: z.string().describe("任务标题关键词"),
      actualHours: z
        .number()
        .optional()
        .describe("实际完成时长，不填则使用计划时长"),
    }),
    execute: async ({ titleKeyword, actualHours }) =>
      markTaskCompletedByTitle(titleKeyword, actualHours),
  }),

  generate_schedule: tool({
    description: "生成本周分配并落盘周/日任务到 data/tasks.json",
    parameters: z.object({
      availableHours: z
        .number()
        .describe("本周可用总小时数"),
    }),
    execute: async ({ availableHours }) => {
      const persisted = await generateAndPersistWeeklyAndDailyTasks(availableHours)
      return [
        `已写入 tasks.json：weekStart=${persisted.weekStart}`,
        `周任务 ${persisted.weeklyCount} 条，日任务 ${persisted.dailyCount} 条`,
        "",
        persisted.weeklyReport,
      ].join("\n")
    },
  }),

  generate_daily_schedule: tool({
    description: "生成详细7天日计划并落盘到 data/tasks.json",
    parameters: z.object({
      availableHours: z
        .number()
        .describe("本周可用总小时数"),
      startDate: z
        .string()
        .optional()
        .describe("开始日期 ISO 8601 格式，默认今天"),
    }),
    execute: async ({ availableHours, startDate }) => {
      const start = startDate ? new Date(startDate) : new Date()
      const persisted = await generateAndPersistWeeklyAndDailyTasks(availableHours, start)
      return [
        `已写入 tasks.json：weekStart=${persisted.weekStart}`,
        `周任务 ${persisted.weeklyCount} 条，日任务 ${persisted.dailyCount} 条`,
        "",
        persisted.dailyReport,
      ].join("\n")
    },
  }),

  clear_outdated_tasks: tool({
    description: "清理过期任务（保留本周及未来任务、手动任务、未完成的P0任务）",
    parameters: z.object({}),
    execute: clearOutdatedTasks,
  }),

  get_weekly_progress: tool({
    description: "获取本周任务进度统计（完成率、时间进度等）",
    parameters: z.object({}),
    execute: getWeeklyProgress,
  }),

  sync_tasks_from_goals: tool({
    description: "根据目标树变化智能同步本周任务（保留手动任务和已完成任务）",
    parameters: z.object({
      availableHours: z
        .number()
        .describe("本周可用总小时数"),
    }),
    execute: async ({ availableHours }) => {
      const { loadGoalTree } = await import("./goal-tree")
      const goalTree = await loadGoalTree()
      return syncTasksFromGoals(availableHours, goalTree)
    },
  }),

  assess_risk: tool({
    description: "评估当前学习风险等级",
    parameters: z.object({}),
    execute: generateRiskReport,
  }),

  intervene: tool({
    description: "执行自动干预策略",
    parameters: z.object({
      riskLevel: z
        .enum(["low", "medium", "high"])
        .describe("当前风险等级"),
      consecutiveMissed: z
        .number()
        .describe("连续未完成天数"),
    }),
    execute: async ({ riskLevel, consecutiveMissed }) => {
      return autoIntervene(riskLevel, consecutiveMissed)
    },
  }),

  refresh_state: tool({
    description: "刷新学习状态（基于 goals.json + tasks.json 即时计算）",
    parameters: z.object({}),
    execute: async () => {
      const state = await refreshState()
      return `状态已刷新：风险等级 ${state.riskLevel}，负载率 ${((state.weeklyDemandHours / state.weeklyAvailableHours) * 100).toFixed(1)}%`
    },
  }),

  initialize_state: tool({
    description: "初始化学习状态（基于 goals.json + tasks.json 生成快照，不写 state.json）",
    parameters: z.object({}),
    execute: async () => {
      await initializeState()
      return "状态已初始化"
    },
  }),
}
