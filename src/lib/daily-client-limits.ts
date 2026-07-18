type DailyUsageRecord = {
  count: number
  date: string
}

type DailyUsageState = DailyUsageRecord & {
  isLimited: boolean
  remaining: number
}

type DailyUsageConsumeResult = DailyUsageState & {
  allowed: boolean
}

function getTodayDateString() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createEmptyRecord(): DailyUsageRecord {
  return {
    count: 0,
    date: getTodayDateString(),
  }
}

function sanitiseRecord(rawValue: unknown): DailyUsageRecord {
  const emptyRecord = createEmptyRecord()

  if (!rawValue || typeof rawValue !== 'object') {
    return emptyRecord
  }

  const candidate = rawValue as Partial<DailyUsageRecord>
  const count =
    typeof candidate.count === 'number' && Number.isFinite(candidate.count) && candidate.count >= 0
      ? Math.floor(candidate.count)
      : 0
  const date = typeof candidate.date === 'string' ? candidate.date : emptyRecord.date

  if (date !== emptyRecord.date) {
    return emptyRecord
  }

  return {
    count,
    date,
  }
}

function readDailyUsageRecord(storageKey: string) {
  const emptyRecord = createEmptyRecord()

  if (typeof window === 'undefined') {
    return emptyRecord
  }

  const rawValue = window.localStorage.getItem(storageKey)

  if (!rawValue) {
    window.localStorage.setItem(storageKey, JSON.stringify(emptyRecord))
    return emptyRecord
  }

  try {
    const parsedValue = JSON.parse(rawValue)
    const nextRecord = sanitiseRecord(parsedValue)
    window.localStorage.setItem(storageKey, JSON.stringify(nextRecord))
    return nextRecord
  } catch {
    window.localStorage.setItem(storageKey, JSON.stringify(emptyRecord))
    return emptyRecord
  }
}

export function getDailyUsageState(storageKey: string, maxPerDay: number): DailyUsageState {
  const nextRecord = readDailyUsageRecord(storageKey)
  const remaining = Math.max(0, maxPerDay - nextRecord.count)

  return {
    ...nextRecord,
    isLimited: nextRecord.count >= maxPerDay,
    remaining,
  }
}

export function consumeDailyUsage(
  storageKey: string,
  maxPerDay: number
): DailyUsageConsumeResult {
  const currentState = getDailyUsageState(storageKey, maxPerDay)

  if (currentState.isLimited || typeof window === 'undefined') {
    return {
      ...currentState,
      allowed: false,
    }
  }

  const nextRecord: DailyUsageRecord = {
    count: currentState.count + 1,
    date: currentState.date,
  }
  window.localStorage.setItem(storageKey, JSON.stringify(nextRecord))

  return {
    ...nextRecord,
    allowed: true,
    isLimited: nextRecord.count >= maxPerDay,
    remaining: Math.max(0, maxPerDay - nextRecord.count),
  }
}
