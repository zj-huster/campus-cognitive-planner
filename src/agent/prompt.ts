import { join } from "path"
import { buildStateHint, type StudyState } from "./context"

const PROMPT_FILE = join(import.meta.dir, "../SYSTEM_PROMPT.md")

const HARD_CONSTRAINTS = `
---
# 强制执行约束（Runtime Hard Constraints）

你必须始终执行以下要求：
1) 决策必须覆盖四种能力：目标树、动态负载、风险预测、行为干预。
2) 输出必须严格使用以下四段且顺序不可变：
   - 状态摘要
   - 本周分配
   - 风险等级
   - 干预动作
3) 不能省略“风险等级”和“干预动作”。
4) 若数据不足，先输出“所需最小数据清单”，再给保守方案。
`.trim()

export async function assembleSystemPrompt(
  state?: StudyState, // 新增：学习状态
  runtimeHints: string[] = []
): Promise<string> {
  const segments: string[] = []

  // Segment 1: 静态指令
  segments.push(await Bun.file(PROMPT_FILE).text())

  // Segment 2: 强制约束
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
