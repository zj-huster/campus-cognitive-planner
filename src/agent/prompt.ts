import { join } from "path"

// 系统提示词分三段拼装：
//   Segment 1: 静态核心指令（SYSTEM_PROMPT.md）
//   Segment 2: 工具使用补充说明（动态，随工具增减自动更新）
//   Segment 3: 运行时状态（可选，如上下文压缩摘要）

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
  runtimeHints: string[] = []
): Promise<string> {
  const segments: string[] = []

  // Segment 1: 静态指令
  segments.push(await Bun.file(PROMPT_FILE).text())

  // Segment 2: 强制约束（始终注入）
  segments.push(HARD_CONSTRAINTS)

  // Segment 3: 运行时状态（有则注入）
  if (runtimeHints.length > 0) {
    segments.push("---\n# 运行时状态\n\n" + runtimeHints.join("\n\n"))
  }

  return segments.join("\n\n")
}
