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

export async function assembleSystemPrompt(
  state?: StudyState, 
  runtimeHints: string[] = []
): Promise<string> {
  const segments: string[] = []

  // 只加载一次
  segments.push(await getBasePrompt())

  // Segment 2: 当前学习状态（核心）
  if (state) {
    segments.push("---\n# 当前学习状态\n\n" + buildStateHint(state))
  }

  // Segment 3: 其他运行时状态
  if (runtimeHints.length > 0) {
    segments.push("---\n# 其他运行时状态\n\n" + runtimeHints.join("\n\n"))
  }

  return segments.join("\n\n")
}
