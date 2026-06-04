import type { AgeGroup, Gender, RegionGroup, SupportCluster } from "./api"

export function ageGroupShort(ageGroup: AgeGroup | string): string {
  const labels: Record<string, string> = {
    "20s": "20대",
    "30s": "30대",
    "40s": "40대",
    "50s": "50대",
    "60s": "60대",
    "70_plus": "70대+",
  }
  return labels[ageGroup] ?? String(ageGroup)
}

export function genderShort(gender: Gender | string): string {
  const labels: Record<string, string> = { male: "남", female: "여", unknown: "미상" }
  return labels[gender] ?? String(gender)
}

export function regionGroupLabel(regionGroup: RegionGroup | string): string {
  const labels: Record<string, string> = {
    capital: "수도권",
    yeongnam: "영남",
    honam: "호남",
    chungcheong: "충청",
    gangwon: "강원",
    jeju: "제주",
    other: "기타",
  }
  return labels[regionGroup] ?? String(regionGroup)
}

export function regionShort(region: string, regionGroup: RegionGroup | string): string {
  const dash = region.indexOf("-")
  if (dash < 0) return regionGroupLabel(regionGroup)
  const tail = region.slice(dash + 1).trim()
  const space = tail.indexOf(" ")
  return space < 0 ? tail : tail.slice(0, space)
}

export function niceTickMax(n: number): number {
  if (n <= 5) return 5
  if (n <= 10) return 10
  if (n <= 20) return 20
  if (n <= 30) return 30
  if (n <= 50) return 50
  if (n <= 100) return 100
  return Math.ceil(n / 50) * 50
}

export function seededJitter(value: string): number {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return ((Math.abs(hash) % 2001) - 1000) / 1000
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export type PlacedOpinionBadge = SupportCluster & {
  side: "support" | "concern"
  x: number
  y: number
  sizeClass: "sz-1" | "sz-2" | "sz-3" | "sz-5"
}

function sizeClass(count: number): PlacedOpinionBadge["sizeClass"] {
  if (count <= 1) return "sz-1"
  if (count === 2) return "sz-2"
  if (count <= 4) return "sz-3"
  return "sz-5"
}

export function placeOpinionBadges(
  clusters: SupportCluster[],
  side: "support" | "concern",
  yMax: number,
): PlacedOpinionBadge[] {
  const placed: PlacedOpinionBadge[] = []
  const center = side === "support" ? 25 : 75
  for (const cluster of clusters.filter((item) => !item.excluded_from_map)) {
    const y = (1 - Math.min(cluster.count, yMax) / yMax) * 88 + 8
    let radius = 18
    let jitter = seededJitter(cluster.label || cluster.short_label)
    let x = center + radius * jitter
    while (
      placed.some((badge) => Math.abs(badge.y - y) <= 3 && Math.abs(badge.x - x) < 22) &&
      radius <= 28
    ) {
      radius += 4
      jitter = jitter === 0 ? 0.5 : -jitter * 1.2
      x = center + radius * jitter
    }
    x = side === "support" ? clamp(x, 5, 45) : clamp(x, 55, 95)
    placed.push({ ...cluster, side, x, y, sizeClass: sizeClass(cluster.count) })
  }
  return placed
}
