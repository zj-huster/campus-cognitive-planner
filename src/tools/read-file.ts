import { resolveSafePath, isSensitivePath } from "../utils/safety"
import { truncateOutput } from "../utils/truncate"

interface Params {
  path: string
  offset?: number
  limit?: number
}

const LARGE_FILE_AUTO_LIMIT = 200
const LARGE_FILE_MAX_LIMIT = 400
const HEAVY_JSON_PATHS = new Set(["data/goals.json", "data/tasks.json"])

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase()
}

function toCountLines(entries: Array<[string, number]>): string {
  if (entries.length === 0) return "- 无"
  return entries.map(([k, v]) => `- ${k}: ${v}`).join("\n")
}

async function summarizeGoalsFile(safePath: string): Promise<string> {
  const data = (await Bun.file(safePath).json()) as Array<{
    id: string
    title: string
    parentId: string | null
    status: string
    longTermValue: number
    urgency: number
    estimatedHours: number
    actualHours: number
    deadline?: string
  }>

  if (!Array.isArray(data)) {
    return "错误：goals.json 不是数组格式"
  }

  const statusCount = new Map<string, number>()
  let roots = 0
  let leaves = 0
  const childCount = new Map<string, number>()

  for (const g of data) {
    statusCount.set(g.status, (statusCount.get(g.status) ?? 0) + 1)
    if (!g.parentId) roots++
    if (g.parentId) {
      childCount.set(g.parentId, (childCount.get(g.parentId) ?? 0) + 1)
    }
  }
  for (const g of data) {
    if (!childCount.has(g.id)) leaves++
  }

  const topPriority = [...data]
    .sort((a, b) => b.longTermValue * b.urgency - a.longTermValue * a.urgency)
    .slice(0, 12)

  const topPriorityLines =
    topPriority.length === 0
      ? "- 无"
      : topPriority
          .map(
            (g) =>
              `- ${g.title} (id=${g.id}, status=${g.status}, weight=${(g.longTermValue * g.urgency).toFixed(2)}, ${g.actualHours}/${g.estimatedHours}h, ddl=${g.deadline ?? "无"})`
          )
          .join("\n")

  return [
    "[goals.json 摘要模式]",
    `- 总目标数: ${data.length}`,
    `- 根目标: ${roots}`,
    `- 叶子目标: ${leaves}`,
    "- 状态统计:",
    toCountLines([...statusCount.entries()]),
    "",
    "- 最高优先级目标 Top12:",
    topPriorityLines,
    "",
    "提示: 如需原文，请使用 offset/limit 分段读取（建议 limit <= 120）",
  ].join("\n")
}

async function summarizeTasksFile(safePath: string): Promise<string> {
  const data = (await Bun.file(safePath).json()) as Array<{
    id: string
    title: string
    level: "weekly" | "daily"
    date: string | null
    weekStart: string
    plannedHours: number
    actualHours: number
    priority: "P0" | "P1" | "P2"
    status: "pending" | "in_progress" | "completed" | "deferred"
    source: "auto" | "manual"
  }>

  if (!Array.isArray(data)) {
    return "错误：tasks.json 不是数组格式"
  }

  const levelCount = new Map<string, number>()
  const statusCount = new Map<string, number>()
  const priorityCount = new Map<string, number>()
  const weekCount = new Map<string, number>()

  for (const t of data) {
    levelCount.set(t.level, (levelCount.get(t.level) ?? 0) + 1)
    statusCount.set(t.status, (statusCount.get(t.status) ?? 0) + 1)
    priorityCount.set(t.priority, (priorityCount.get(t.priority) ?? 0) + 1)
    weekCount.set(t.weekStart, (weekCount.get(t.weekStart) ?? 0) + 1)
  }

  const weekly = data.filter((t) => t.level === "weekly")
  const daily = data.filter((t) => t.level === "daily")
  const topWeekly = [...weekly]
    .sort((a, b) => b.plannedHours - a.plannedHours)
    .slice(0, 12)

  const topWeeklyLines =
    topWeekly.length === 0
      ? "- 无"
      : topWeekly
          .map(
            (t) =>
              `- ${t.title} (id=${t.id}, ${t.plannedHours}h, ${t.priority}, ${t.status}, week=${t.weekStart})`
          )
          .join("\n")

  const hotWeeks = [...weekCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)

  return [
    "[tasks.json 摘要模式]",
    `- 总任务数: ${data.length}`,
    `- 周任务: ${weekly.length}`,
    `- 日任务: ${daily.length}`,
    "- 状态统计:",
    toCountLines([...statusCount.entries()]),
    "- 优先级统计:",
    toCountLines([...priorityCount.entries()]),
    "- 周分布 Top6:",
    toCountLines(hotWeeks),
    "",
    "- 周任务时长 Top12:",
    topWeeklyLines,
    "",
    "提示: 如需原文，请使用 offset/limit 分段读取（建议 limit <= 120）",
  ].join("\n")
}

export async function readFile({ path, offset, limit }: Params): Promise<string> {
  // 路径安全检查
  let safePath: string
  try {
    safePath = resolveSafePath(path)
  } catch (e) {
    return `错误：${(e as Error).message}`
  }

  // 敏感文件提示（不阻止，但提醒）
  if (isSensitivePath(path)) {
    console.warn(`\x1b[33m[警告] 正在读取敏感文件：${path}\x1b[0m`)
  }

  const file = Bun.file(safePath)
  if (!(await file.exists())) {
    return `错误：文件不存在 - ${path}`
  }

  const normalized = normalizePath(path)
  const isHeavyJson = HEAVY_JSON_PATHS.has(normalized)

  // 防止大 JSON 全量注入上下文：默认返回摘要
  if (isHeavyJson && offset === undefined && limit === undefined) {
    if (normalized.endsWith("goals.json")) {
      return truncateOutput("read_file", await summarizeGoalsFile(safePath))
    }
    return truncateOutput("read_file", await summarizeTasksFile(safePath))
  }

  const text = await file.text()
  const lines = text.split("\n")

  // 按 offset/limit 切片（默认自动分页，避免大文件一次性读取）
  const start = Math.max(0, offset ?? 0)
  let effectiveLimit = limit
  if (effectiveLimit !== undefined) {
    effectiveLimit = Math.max(1, Math.min(LARGE_FILE_MAX_LIMIT, effectiveLimit))
  } else if (lines.length > LARGE_FILE_AUTO_LIMIT) {
    effectiveLimit = LARGE_FILE_AUTO_LIMIT
  }

  const end = effectiveLimit !== undefined ? start + effectiveLimit : lines.length
  const slice = lines.slice(start, end)

  // 带行号输出（方便 LLM 定位，减少 edit_file 时的 old_string 匹配错误）
  const withLineNumbers = slice
    .map((line, i) => `${start + i + 1}\t${line}`)
    .join("\n")

  // 附加元信息
  const omitted = Math.max(0, lines.length - Math.min(end, lines.length))
  const meta = [
    `[显示第 ${start + 1}–${Math.min(end, lines.length)} 行，共 ${lines.length} 行]`,
    omitted > 0 ? `[剩余 ${omitted} 行未显示，可通过 offset=${Math.min(end, lines.length)} 继续读取]` : "",
    effectiveLimit !== limit && limit !== undefined
      ? `[提示] limit 过大，已自动收敛到 ${effectiveLimit}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")

  // 大 JSON 明确提醒使用摘要工具而不是全量读取
  const guidance = isHeavyJson
    ? "\n[建议] 优先使用 get_goal_summary / get_task_summary / get_weekly_progress / get_today_tasks，尽量避免读取原始 JSON 全量内容。"
    : ""

  return truncateOutput("read_file", withLineNumbers + "\n" + meta + guidance)
}
