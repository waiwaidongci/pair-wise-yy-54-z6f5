export type LngLat = [number, number]

/** 接点容差（米）：相邻阶段端点在此距离内视为连续 */
export const JUNCTION_TOLERANCE = 25

const EARTH_RADIUS = 6371000

/** 两点间距离（米，等距近似，城市尺度足够） */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const x = dLng * Math.cos((lat1 + lat2) / 2)
  return EARTH_RADIUS * Math.hypot(x, dLat)
}

export function midpoint(a: LngLat, b: LngLat): LngLat {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

export function stageStart(route: LngLat[]): LngLat {
  return route[0]
}

export function stageEnd(route: LngLat[]): LngLat {
  return route[route.length - 1]
}
