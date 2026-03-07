// 自动干预决策（纯函数，不落盘）
export async function autoIntervene(
  riskLevel: "low" | "medium" | "high",
  consecutiveMissed: number
): Promise<string> {
  let action = ""
  let newMode: "normal" | "light" | "sprint" = "normal"

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

  return `干预动作：${action}\n当前模式：${newMode}`
}