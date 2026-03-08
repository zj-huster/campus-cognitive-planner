function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function pad3(value: number): string {
  return String(value).padStart(3, "0")
}

export function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  return `${year}-${month}-${day}`
}

export function formatLocalDateTime(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hour = pad2(date.getHours())
  const minute = pad2(date.getMinutes())
  const second = pad2(date.getSeconds())
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

export function formatLocalTimestampForFile(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hour = pad2(date.getHours())
  const minute = pad2(date.getMinutes())
  const second = pad2(date.getSeconds())
  const millisecond = pad3(date.getMilliseconds())
  return `${year}-${month}-${day}T${hour}-${minute}-${second}-${millisecond}`
}

export function mondayOfLocalWeek(date: Date = new Date()): string {
  const d = new Date(date)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  d.setHours(0, 0, 0, 0)
  return formatLocalDate(d)
}
