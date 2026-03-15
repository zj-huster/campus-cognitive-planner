import { mkdir } from "fs/promises"
import { dirname } from "path"
import { resolveSafePath } from "../utils/safety"
import type { StudyTask } from "../agent/context"
import { formatLocalDateTime } from "../utils/datetime"

const PROFILE_FILE = "data/learner-profile.json"
const PROFILE_VERSION = 1
const DEFAULT_FACTOR = 1
const MIN_FACTOR = 0.6
const MAX_FACTOR = 1.4
const EMA_ALPHA = 0.25

export interface LearnerProfile {
  version: number
  updatedAt: string
  taskRecords: number
  subjectEfficiency: Record<string, number>
  slotFocus: Record<string, number>
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function createDefaultProfile(): LearnerProfile {
  return {
    version: PROFILE_VERSION,
    updatedAt: formatLocalDateTime(new Date()),
    taskRecords: 0,
    subjectEfficiency: {},
    slotFocus: {
      "早1": DEFAULT_FACTOR,
      "早2": DEFAULT_FACTOR,
      "中1": DEFAULT_FACTOR,
      "中2": DEFAULT_FACTOR,
      "晚1": DEFAULT_FACTOR,
      "晚2": DEFAULT_FACTOR,
    },
  }
}

function normalizeProfile(input: unknown): LearnerProfile {
  if (!input || typeof input !== "object") {
    return createDefaultProfile()
  }

  const parsed = input as Partial<LearnerProfile>
  const defaults = createDefaultProfile()
  const subjectEfficiency =
    parsed.subjectEfficiency && typeof parsed.subjectEfficiency === "object"
      ? Object.fromEntries(
          Object.entries(parsed.subjectEfficiency).map(([k, v]) => [
            k,
            clamp(Number(v) || DEFAULT_FACTOR, MIN_FACTOR, MAX_FACTOR),
          ])
        )
      : defaults.subjectEfficiency
  const slotFocus =
    parsed.slotFocus && typeof parsed.slotFocus === "object"
      ? {
          ...defaults.slotFocus,
          ...Object.fromEntries(
            Object.entries(parsed.slotFocus).map(([k, v]) => [
              k,
              clamp(Number(v) || DEFAULT_FACTOR, MIN_FACTOR, MAX_FACTOR),
            ])
          ),
        }
      : defaults.slotFocus

  return {
    version: PROFILE_VERSION,
    updatedAt:
      typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0
        ? parsed.updatedAt
        : defaults.updatedAt,
    taskRecords: Number.isFinite(parsed.taskRecords)
      ? Math.max(0, Math.floor(Number(parsed.taskRecords)))
      : defaults.taskRecords,
    subjectEfficiency,
    slotFocus,
  }
}

export async function loadLearnerProfile(): Promise<LearnerProfile> {
  const path = resolveSafePath(PROFILE_FILE)
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return createDefaultProfile()
  }

  try {
    const parsed = (await file.json()) as unknown
    return normalizeProfile(parsed)
  } catch {
    return createDefaultProfile()
  }
}

export async function saveLearnerProfile(profile: LearnerProfile): Promise<void> {
  const path = resolveSafePath(PROFILE_FILE, "write")
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify(profile, null, 2))
}

function ema(oldValue: number, observed: number): number {
  return oldValue * (1 - EMA_ALPHA) + observed * EMA_ALPHA
}

function inferSubject(title: string): string {
  const normalized = title.toLowerCase()
  if (normalized.includes("数学")) return "数学"
  if (normalized.includes("英语")) return "英语"
  if (normalized.includes("政治")) return "政治"
  if (normalized.includes("408") || normalized.includes("计算机")) return "408"
  return "通用"
}

function inferSlot(title: string): string | null {
  const matched = title.match(/\((早|中|晚)(1|2)\)/u)
  if (!matched) return null
  return `${matched[1]}${matched[2]}`
}

function computeObservedEfficiency(task: StudyTask): number {
  const planned = Math.max(0.1, task.plannedHours)
  const actual = Math.max(0.1, task.actualHours)
  let score = planned / actual

  if (task.status !== "completed") {
    score *= 0.9
  }

  return clamp(score, MIN_FACTOR, MAX_FACTOR)
}

export async function updateLearnerProfileFromTask(task: StudyTask): Promise<void> {
  const profile = await loadLearnerProfile()
  const observed = computeObservedEfficiency(task)
  const subject = inferSubject(task.title)
  const slot = inferSlot(task.title)

  const subjectOld = profile.subjectEfficiency[subject] ?? DEFAULT_FACTOR
  const subjectNew = clamp(ema(subjectOld, observed), MIN_FACTOR, MAX_FACTOR)
  profile.subjectEfficiency[subject] = round3(subjectNew)

  if (slot) {
    const slotOld = profile.slotFocus[slot] ?? DEFAULT_FACTOR
    const slotNew = clamp(ema(slotOld, observed), MIN_FACTOR, MAX_FACTOR)
    profile.slotFocus[slot] = round3(slotNew)
  }

  profile.taskRecords += 1
  profile.updatedAt = formatLocalDateTime(new Date())
  await saveLearnerProfile(profile)
}

export function getSubjectAdjustment(profile: LearnerProfile, title: string): number {
  const subject = inferSubject(title)
  return profile.subjectEfficiency[subject] ?? DEFAULT_FACTOR
}

export function getSlotAdjustment(
  profile: LearnerProfile,
  title: string,
  slotKey: string
): number {
  const subjectFactor = getSubjectAdjustment(profile, title)
  const slotFactor = profile.slotFocus[slotKey] ?? DEFAULT_FACTOR
  return round3(clamp(subjectFactor * slotFactor, MIN_FACTOR, MAX_FACTOR))
}

export async function getLearnerProfileSummary(): Promise<string> {
  const profile = await loadLearnerProfile()
  const subjectLines = Object.entries(profile.subjectEfficiency)
    .sort((a, b) => b[1] - a[1])
    .map(([subject, value]) => `- ${subject}: ${value.toFixed(2)}`)

  const slotLines = Object.entries(profile.slotFocus)
    .map(([slot, value]) => `- ${slot}: ${value.toFixed(2)}`)

  return [
    "## 学习画像摘要",
    `- 样本任务数: ${profile.taskRecords}`,
    `- 最近更新时间: ${profile.updatedAt}`,
    "",
    "### 科目效率因子",
    ...(subjectLines.length > 0 ? subjectLines : ["- 暂无数据，默认 1.00"]),
    "",
    "### 时段专注因子",
    ...slotLines,
  ].join("\n")
}
