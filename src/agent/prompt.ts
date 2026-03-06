import { join } from "path"
import { buildStateHint, type StudyState } from "./context"

const PROMPT_FILE = join(import.meta.dir, "../SYSTEM_PROMPT.md")

// 缓存静态 prompt（应用启动时加载一次）
let cachedBasePrompt: string | null = null

async function getBasePrompt(): Promise<string> {
  if (!cachedBasePrompt) {
    cachedBasePrompt = await Bun.file(PROMPT_FILE).text()
  }
  return cachedBasePrompt
}

const HARD_CONSTRAINTS = `
# 强制约束
1) 决策覆盖四能力：目标树、动态负载、风险预测、行为干预
2) 输出四段固定顺序：状态摘要 → 本周分配 → 风险等级 → 干预动作
3) 必须输出风险等级和干预动作
4) 数据不足时先输出所需数据清单再给保守方案
5) 关键指导：完成以下任条件时立即输出最终回答，不再调用工具：
   - 已获得目标摘要（get_goal_summary）
   - 已评估风险等级（assess_risk）
   - 已生成周计划（generate_schedule）
   - 已制定干预策略（intervene）
   过度调用工具会导致系统超时，一定要及时停止！
`.trim()

export async function assembleSystemPrompt(
  state?: StudyState, 
  runtimeHints: string[] = []
): Promise<string> {
  const segments: string[] = []

  // 只加载一次
  segments.push(await getBasePrompt())
  segments.push(HARD_CONSTRAINTS)

  // Segment 3: 当前学习状态（核心）
  if (state) {
    segments.push("---\n# 当前学习状态\n\n" + buildStateHint(state))
  }

  // Segment 4: 其他运行时状态
  if (runtimeHints.length > 0) {
    segments.push("---\n# 其他运行时状态\n\n" + runtimeHints.join("\n\n"))
  }

  return segments.join("\n\n")
}
