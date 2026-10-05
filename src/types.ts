export type StageStatus = '待协商' | '条件通过' | '已批准' | '退回'

/** 相邻阶段共用的接点（道路几何版本的一部分） */
export interface Junction {
  id: string
  name: string
  point: [number, number]
  stageIds: string[]
}

export interface ClosureStage {
  id: string
  name: string
  start: string
  end: string
  lanes: string
  status: StageStatus
  route: [number, number][]
  /** 通行能力（辆/小时） */
  capacity: number
  /** 急救通道保底占用（辆/小时） */
  ambulance: number
  /** 公交保底班次占用（辆/小时） */
  busMin: number
  roadVersion: number
}

export interface DetourRoute {
  id: string
  name: string
  /** 服务的施工阶段 */
  stageId: string
  distance: number
  extraMinutes: number
  /** 预计分担流量（辆/小时） */
  demand: number
  roadVersion: number
  coordinates: [number, number][]
}

export interface SegmentComment {
  id: string
  segmentId: string
  unit: '建设' | '交通' | '公交' | '应急'
  author: string
  content: string
  condition?: string
  status: '待处理' | '已接受' | '已退回'
  /** 意见签署时对应的道路版本 */
  signedVersion: number
  /** 接点变更导致的复签原因 */
  reconfirm?: string
}

/** 离线回传冲突：双方都改了同一接点时，保存现场坐标和旧值 */
export interface JunctionConflict {
  id: string
  junctionId: string
  stageId: string
  source: string
  fieldPoint: [number, number]
  previousPoint: [number, number]
  status: '待处理' | '已采用现场值' | '已保留原值'
  time: string
}

export interface SurveyPoint {
  stageId: string
  junctionId: string
  point: [number, number]
}

export interface SurveyUpload {
  id: string
  surveyor: string
  device: string
  time: string
  points: SurveyPoint[]
}

export interface MergeReport {
  uploadId: string
  surveyor: string
  time: string
  applied: string[]
  conflicts: string[]
  unchanged: string[]
}

export interface CapacitySlot {
  id: string
  name: string
  demand: number
  state: '已排入' | '排队中'
  queue: number | null
}

export interface CapacityRow {
  stageId: string
  stageName: string
  capacity: number
  ambulance: number
  busMin: number
  remaining: number
  detours: CapacitySlot[]
}

export interface Scheme {
  id: string
  project: string
  contractor: string
  area: string
  version: number
  /** 道路几何版本：阶段、导改、意见都绑定到它 */
  roadVersion: number
  junctions: Junction[]
  stages: ClosureStage[]
  detours: DetourRoute[]
  comments: SegmentComment[]
  junctionConflicts: JunctionConflict[]
}
