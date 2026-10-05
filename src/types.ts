export type StageStatus = '待协商' | '条件通过' | '已批准' | '退回'
export type CommentStatus = '待处理' | '已接受' | '已退回' | '待复签'

/** 车道容量：急救通道与公交保底班次先占，余量供导改线路排队 */
export interface LaneCapacity {
  /** 封闭后剩余车道总数 */
  total: number
  /** 急救通道先占车道 */
  emergency: number
  /** 公交保底班次先占车道 */
  bus: number
}

export interface ClosureStage {
  id: string
  name: string
  start: string
  end: string
  lanes: string
  status: StageStatus
  route: [number, number][]
  capacity: LaneCapacity
  /** 该阶段几何最后确认时的道路版本 */
  version: number
  /** 起点接点（上游来向） */
  fromJunctionId?: string
  /** 终点接点（下游去向） */
  toJunctionId?: string
}

export interface DetourRoute {
  id: string
  name: string
  distance: number
  extraMinutes: number
  coordinates: [number, number][]
  /** 导改线路需要的车道数 */
  requiredLanes: number
  /** 绕过的施工阶段 */
  stageId: string
  status: '保通' | '排队'
  /** 纳入当前道路版本时的版本号 */
  version: number
}

export interface SegmentComment {
  id: string
  segmentId: string
  unit: '建设' | '交通' | '公交' | '应急'
  author: string
  content: string
  condition?: string
  status: CommentStatus
  /** 意见会签时锚定的道路版本；低于当前版本即需复签 */
  anchoredVersion: number
}

/** 接点：相邻阶段共用的端点 */
export interface Junction {
  id: string
  lng: number
  lat: number
  /** 上游阶段（取其终点） */
  upstreamStageId: string
  /** 下游阶段（取其起点） */
  downstreamStageId: string
  status: '连续' | '断点'
  confirmedVersion: number
  /** 离线回传两边改同一接点时的现场坐标与旧值 */
  conflict?: JunctionConflict
}

export interface JunctionConflict {
  /** 旧值：两边改动前的接点坐标 */
  oldLng: number
  oldLat: number
  /** 两边各自回传的现场坐标 */
  sides: JunctionConflictSide[]
}

export interface JunctionConflictSide {
  reporter: string
  at: string
  stageId: string
  siteLng: number
  siteLat: number
}

/** 离线测量回传（按阶段编号合并） */
export interface OfflineChange {
  id: string
  stageId: string
  junctionId?: string
  /** 现场测回的折线（整段重绘时） */
  siteCoordinates: [number, number][]
  /** 现场测回的接点坐标（仅接点变动时） */
  siteJunction?: { lng: number; lat: number }
  /** 改动前旧值 */
  oldCoordinates: [number, number][]
  oldJunction?: { lng: number; lat: number }
  reportedBy: string
  at: string
}

export interface Scheme {
  id: string
  project: string
  contractor: string
  area: string
  version: number
  stages: ClosureStage[]
  detours: DetourRoute[]
  comments: SegmentComment[]
  junctions: Junction[]
  offlineChanges: OfflineChange[]
  noticePublishedVersion?: number
}
