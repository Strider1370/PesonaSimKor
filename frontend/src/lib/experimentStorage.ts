export type ExperimentSnapshotSlot = {
  id: "A" | "B" | "C"
  presetId: string
  policy: string
}

export type ExperimentSnapshotSettings = {
  nAgents: number
  repeatCount?: number
  modelProvider?: "ollama" | "openai"
  modelName?: string
  thinking?: boolean
  personaDepth?: "minimal" | "standard" | "full"
}

export type ExperimentSnapshotResult = {
  slotId: "A" | "B" | "C"
  presetId: string
  total: {
    support: number
    oppose: number
    neutral: number
  } | null
  runs?: Array<{
    support: number
    oppose: number
    neutral: number
  }>
  stability?: {
    supportMean: number
    supportStddev: number
    opposeMean: number
    opposeStddev: number
    neutralMean: number
    neutralStddev: number
  } | null
  realOpinion?: {
    source: string
    year: number
    supportActual: number
    supportSimulated: number
    supportDiff: number
    opposeActual: number
    opposeSimulated: number
    opposeDiff: number
    note: string
  } | null
}

export type ExperimentSnapshotInput = {
  name: string
  settings: ExperimentSnapshotSettings
  slots: ExperimentSnapshotSlot[]
  results: ExperimentSnapshotResult[]
}

export type ExperimentSnapshot = ExperimentSnapshotInput & {
  id: string
  createdAt: string
}

const STORAGE_KEY = "koreansim.experiment.snapshots.v1"

export function saveExperimentSnapshot(input: ExperimentSnapshotInput): ExperimentSnapshot {
  const snapshot: ExperimentSnapshot = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const snapshots = listExperimentSnapshots()
  writeSnapshots([snapshot, ...snapshots])
  return snapshot
}

export function listExperimentSnapshots(): ExperimentSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSnapshot).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

export function loadExperimentSnapshot(id: string): ExperimentSnapshot | null {
  return listExperimentSnapshots().find((snapshot) => snapshot.id === id) ?? null
}

export function deleteExperimentSnapshot(id: string): void {
  writeSnapshots(listExperimentSnapshots().filter((snapshot) => snapshot.id !== id))
}

function writeSnapshots(snapshots: ExperimentSnapshot[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots))
}

function isSnapshot(value: unknown): value is ExperimentSnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<ExperimentSnapshot>
  return (
    typeof snapshot.id === "string" &&
    typeof snapshot.createdAt === "string" &&
    typeof snapshot.name === "string" &&
    !!snapshot.settings &&
    Array.isArray(snapshot.slots) &&
    Array.isArray(snapshot.results)
  )
}
