import { resolveSafePath } from "../utils/safety"
import type { StudyState } from "../agent/context"

const STATE_FILE = "data/state.json"

// 加载学习状态
export async function loadState(): Promise<StudyState | null> {
  try {
    const path = resolveSafePath(STATE_FILE)
    const file = Bun.file(path)
    if (!(await file.exists())) {
      return null
    }
    return await file.json()
  } catch (e) {
    throw new Error(`读取状态失败：${(e as Error).message}`)
  }
}

// 保存学习状态
export async function saveState(state: StudyState): Promise<void> {
  const path = resolveSafePath(STATE_FILE)
  await Bun.write(path, JSON.stringify(state, null, 2))
}

// 自动干预决策
export async function autoIntervene(
  riskLevel: "low" | "medium" | "high",
  consecutiveMissed: number
): Promise<string> {
  const state = await loadState()
  if (!state) {
    return "错误：无法加载状态"
  }

  let action = ""
  let newMode = state.interventionMode

  // 决策逻辑
  if (riskLevel === "high" || consecutiveMissed >= 3) {
    newMode = "light"
    action = "启用轻量模式：降低任务难度、减少数量"
  } else if (riskLevel === "medium") {
    newMode = "sprint"
    action = "启用冲刺模式：集中资源应对 DDL"
  } else {
    newMode = "normal"
    action = "保持正常模式"
  }

  // 更新状态
  state.interventionMode = newMode
  state.riskLevel = riskLevel
  await saveState(state)

  return `干预动作：${action}\n当前模式：${newMode}`
}