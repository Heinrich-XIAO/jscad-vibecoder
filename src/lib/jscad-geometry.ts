export type Vec3 = [number, number, number]

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const toArrayVec3 = (value: unknown): Vec3 | null => {
  if (!Array.isArray(value)) return null
  if (value.length < 3) return null
  const x = value[0]
  const y = value[1]
  const z = value[2]
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null
  return [x, y, z]
}

const toObjectVec3 = (value: Record<string, unknown>): Vec3 | null => {
  if (isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)) {
    return [value.x, value.y, value.z]
  }
  if (value.pos !== undefined) {
    return toVec3(value.pos)
  }
  if (value.point !== undefined) {
    return toVec3(value.point)
  }
  return null
}

export function toVec3(vertex: unknown): Vec3 | null {
  if (vertex === null || vertex === undefined) return null
  if (Array.isArray(vertex)) {
    return toArrayVec3(vertex)
  }
  if (typeof vertex === "object") {
    return toObjectVec3(vertex as Record<string, unknown>)
  }
  return null
}

export function polygonVertices(polygon: Record<string, unknown> | null | undefined): Vec3[] {
  if (!polygon) return []
  const raw = polygon.vertices
  if (!Array.isArray(raw)) return []
  const vertices: Vec3[] = []
  for (const vertex of raw) {
    const vec = toVec3(vertex)
    if (vec) vertices.push(vec)
  }
  return vertices
}
