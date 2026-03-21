import type { StudyTask } from "../agent/context"
import { resolveSafePath } from "../utils/safety"

const TASKS_FILE = "data/tasks.json"

export async function loadPlanTasks(): Promise<StudyTask[]> {
  try {
    const path = resolveSafePath(TASKS_FILE)
    const file = Bun.file(path)
    if (!(await file.exists())) {
      return []
    }

    const parsed = (await file.json()) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed as StudyTask[]
  } catch {
    return []
  }
}

export function splitPlanTasks(tasks: StudyTask[]): {
  weekly: StudyTask[]
  daily: StudyTask[]
} {
  return {
    weekly: tasks.filter((task) => task.level === "weekly"),
    daily: tasks.filter((task) => task.level === "daily"),
  }
}
