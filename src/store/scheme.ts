import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  CapacityRow, ClosureStage, Junction, JunctionConflict, MergeReport,
  Scheme, SegmentComment, SurveyPoint, SurveyUpload,
} from '../types'

const STORAGE_KEY = 'yy54-road-scheme-v2'
/** 绘制端点吸附接点的容差（度），约 250 米 */
const SNAP_TOL = 0.0025
/** 接点连续性判定容差（度） */
const SAME_TOL = 1e-6

const seed: Scheme = {
  id: 'RC-2026-0918', project: '云河路快速化改造', contractor: '市政建设集团第三工程处', area: '云河路 / 江海大道',
  version: 7, roadVersion: 3,
  junctions: [
    { id: 'J1', name: '云河路西口', point: [121.452, 31.224], stageIds: ['ST-03'] },
    { id: 'J2', name: '江海大道口', point: [121.470, 31.228], stageIds: ['ST-03', 'ST-01'] },
    { id: 'J3', name: '滨河路口', point: [121.496, 31.235], stageIds: ['ST-01', 'ST-02'] },
    { id: 'J4', name: '云河路东口', point: [121.516, 31.242], stageIds: ['ST-02'] },
  ],
  stages: [
    { id: 'ST-01', name: '第一阶段 · 东半幅围挡', start: '2026-10-08', end: '2026-10-22', lanes: '双向 4 车道收窄为 2 车道', status: '条件通过', capacity: 2400, ambulance: 200, busMin: 600, roadVersion: 3, route: [[121.470, 31.228], [121.482, 31.231], [121.496, 31.235]] },
    { id: 'ST-02', name: '第二阶段 · 路口夜间施工', start: '2026-10-23', end: '2026-11-05', lanes: '22:00–05:00 全封闭', status: '待协商', capacity: 900, ambulance: 200, busMin: 300, roadVersion: 3, route: [[121.496, 31.235], [121.508, 31.238], [121.516, 31.242]] },
    { id: 'ST-03', name: '第三阶段 · 西半幅恢复', start: '2026-11-06', end: '2026-11-18', lanes: '西侧公交专用道临时占用', status: '退回', capacity: 1600, ambulance: 200, busMin: 500, roadVersion: 3, route: [[121.452, 31.224], [121.462, 31.226], [121.470, 31.228]] },
  ],
  detours: [
    { id: 'DR-01', name: '江海大道—滨河路绕行', stageId: 'ST-01', distance: 4.8, extraMinutes: 11, demand: 1500, roadVersion: 3, coordinates: [[121.470, 31.228], [121.478, 31.214], [121.502, 31.218], [121.516, 31.242]] },
    { id: 'DR-02', name: '云河路辅道保通', stageId: 'ST-01', distance: 2.3, extraMinutes: 6, demand: 400, roadVersion: 3, coordinates: [[121.452, 31.224], [121.462, 31.219], [121.496, 31.235]] },
    { id: 'DR-03', name: '夜间应急绕行—东江路', stageId: 'ST-02', distance: 3.6, extraMinutes: 9, demand: 500, roadVersion: 3, coordinates: [[121.496, 31.235], [121.506, 31.246], [121.516, 31.242]] },
  ],
  comments: [
    { id: 'CM-41', segmentId: 'ST-01', unit: '公交', author: '顾敏', content: '17 路、806 路临时站点与云河路站距离 680 米，超过老年乘客可接受步行距离。', condition: '需在江海大道口增设临时站并配置导乘人员。', status: '待处理', signedVersion: 3 },
    { id: 'CM-42', segmentId: 'ST-02', unit: '应急', author: '夏川', content: '夜间全封闭期间，区域急救中心南门通道被切断。', condition: '保留 4 米应急通道，路口导改每 15 分钟巡查一次。', status: '已接受', signedVersion: 3 },
    { id: 'CM-43', segmentId: 'ST-03', unit: '交通', author: '郑航', content: '公交专用道占用导致高峰小时延误增加 19 分钟，超过方案阈值。', condition: '缩减围挡 1.5 米并调整信号配时。', status: '已退回', signedVersion: 2 },
  ],
  junctionConflicts: [],
}

function samePoint(a: [number, number], b: [number, number], tol = SAME_TOL) {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol
}
function clonePoint(p: [number, number]): [number, number] { return [p[0], p[1]] }
export function fmtPoint(p: [number, number]) { return `${p[0].toFixed(4)}, ${p[1].toFixed(4)}` }

export const useSchemeStore = defineStore('scheme', () => {
  const scheme = ref<Scheme>(structuredClone(seed))
  const selectedStageId = ref('ST-01')
  const selectedCommentId = ref('CM-41')
  const drawing = ref(false)
  const draftRoute = ref<[number, number][]>([])
  const history = ref<string[]>([])
  /** 上次同步时各接点的基准坐标（三方合并用） */
  const syncBase = ref<Record<string, [number, number]>>({})
  const lastMerge = ref<MergeReport | null>(null)
  const audit = ref<string[]>([])

  const selectedStage = computed(() => scheme.value.stages.find((item) => item.id === selectedStageId.value))
  const selectedComment = computed(() => scheme.value.comments.find((item) => item.id === selectedCommentId.value))
  const conflicts = computed(() => [
    ...(scheme.value.stages.some((stage) => stage.id === 'ST-02') ? [{ id: 'CF-01', level: '高', segmentId: 'ST-02', title: '相邻雨污分流工程时间重叠', detail: '10 月 26–30 日江海大道东段同步占用慢车道，建议错峰 4 天。' }] : []),
    { id: 'CF-02', level: '高', segmentId: 'ST-02', title: '救护通道中断风险', detail: '夜间全封闭将切断区域急救中心南门，必须保留 4 米应急通道。' },
    { id: 'CF-03', level: '中', segmentId: 'ST-01', title: '公交站点覆盖缺口', detail: '17 路与 806 路临时站距现状站 680 米，已超过 500 米阈值。' },
    { id: 'CF-04', level: '中', segmentId: 'ST-03', title: '绕行延误超阈值', detail: '高峰绕行新增 19 分钟，超过方案设定的 15 分钟阈值。' },
  ])
  const dirty = computed(() => history.value.length > 0)

  /* ---------- 接点连续性 ---------- */

  function junctionsOf(stageId: string) {
    return scheme.value.junctions.filter((junction) => junction.stageIds.includes(stageId))
  }
  function isJunctionContinuous(junction: Junction) {
    return junction.stageIds.every((stageId) => {
      const stage = scheme.value.stages.find((item) => item.id === stageId)
      if (!stage || stage.route.length < 2) return false
      return samePoint(stage.route[0], junction.point) || samePoint(stage.route[stage.route.length - 1], junction.point)
    })
  }
  const brokenJunctions = computed(() => scheme.value.junctions.filter((junction) => !isJunctionContinuous(junction)))
  const continuous = computed(() => brokenJunctions.value.length === 0)

  /* ---------- 容量分配：急救与公交保底先占，余量不够的导改排队 ---------- */

  const capacityRows = computed<CapacityRow[]>(() => scheme.value.stages.map((stage) => {
    let remaining = stage.capacity - stage.ambulance - stage.busMin
    let queue = 0
    const detours = scheme.value.detours
      .filter((route) => route.stageId === stage.id)
      .map((route) => {
        if (remaining >= route.demand) {
          remaining -= route.demand
          return { id: route.id, name: route.name, demand: route.demand, state: '已排入' as const, queue: null }
        }
        queue += 1
        return { id: route.id, name: route.name, demand: route.demand, state: '排队中' as const, queue }
      })
    return { stageId: stage.id, stageName: stage.name, capacity: stage.capacity, ambulance: stage.ambulance, busMin: stage.busMin, remaining, detours }
  }))

  /* ---------- 发布门禁：接点连续且意见全部复签 ---------- */

  const unsignedComments = computed(() => scheme.value.comments.filter((item) => item.status !== '已接受'))
  const pendingJunctionConflicts = computed(() => scheme.value.junctionConflicts.filter((item) => item.status === '待处理'))
  const publishBlockers = computed(() => {
    const list: string[] = []
    brokenJunctions.value.forEach((junction) => list.push(`接点 ${junction.name} 存在断点`))
    if (unsignedComments.value.length) list.push(`${unsignedComments.value.length} 条单位意见未复签`)
    if (pendingJunctionConflicts.value.length) list.push(`${pendingJunctionConflicts.value.length} 处接点回传冲突待处理`)
    return list
  })
  const publishReady = computed(() => publishBlockers.value.length === 0)

  /* ---------- 版本与留痕 ---------- */

  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(scheme.value)) }
  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Scheme
      if (Array.isArray(parsed.junctions) && Array.isArray(parsed.junctionConflicts)) scheme.value = parsed
    } catch { /* 数据损坏时保留种子 */ }
  }
  function commit() { history.value.push(JSON.stringify(scheme.value)); persist() }
  function log(text: string) {
    audit.value.push(`${new Date().toLocaleString('zh-CN', { hour12: false })} ${text}`)
  }
  /** 几何变更后，把阶段与导改重新绑到同一道路版本 */
  function stampRoadVersion() {
    scheme.value.stages.forEach((stage) => { stage.roadVersion = scheme.value.roadVersion })
    scheme.value.detours.forEach((route) => { route.roadVersion = scheme.value.roadVersion })
  }
  /** 接点变更 → 共用接点的意见全部转回复签 */
  function resetCommentsForJunction(junction: Junction, reason: string) {
    scheme.value.comments.forEach((comment) => {
      if (junction.stageIds.includes(comment.segmentId)) {
        comment.status = '待处理'
        comment.reconfirm = reason
      }
    })
  }
  /** 移动接点并同步所有共用阶段的端点（不产生断点） */
  function applyJunctionPoint(junction: Junction, point: [number, number], reason: string) {
    const old = junction.point
    junction.point = clonePoint(point)
    scheme.value.stages.forEach((stage) => {
      if (!junction.stageIds.includes(stage.id)) return
      if (samePoint(stage.route[0], old)) stage.route[0] = clonePoint(point)
      if (samePoint(stage.route[stage.route.length - 1], old)) stage.route[stage.route.length - 1] = clonePoint(point)
    })
    scheme.value.roadVersion += 1
    scheme.value.version += 1
    stampRoadVersion()
    resetCommentsForJunction(junction, reason)
  }

  function moveJunction(id: string, point: [number, number]) {
    const junction = scheme.value.junctions.find((item) => item.id === id)
    if (!junction || samePoint(junction.point, point)) return
    commit()
    applyJunctionPoint(junction, point, `接点 ${junction.name} 坐标变更，需复签`)
    log(`接点 ${junction.name} 调整至 ${fmtPoint(point)}，${junction.stageIds.join('、')} 共用接点，相关意见已转待复签`)
    persist()
  }

  /* ---------- 绘制：端点必须落在接点上，断开时拒绝更新 ---------- */

  function startDraw() { drawing.value = true; draftRoute.value = [] }
  function addPoint(point: [number, number]) { if (drawing.value) draftRoute.value.push(point) }
  function finishDraw(): { ok: boolean; reason?: string } {
    const stage = selectedStage.value
    const finish = (result: { ok: boolean; reason?: string }) => { drawing.value = false; draftRoute.value = []; return result }
    if (!stage || draftRoute.value.length < 2) return finish({ ok: false, reason: '绘制点不足，未更新' })
    const links = junctionsOf(stage.id)
    const startJunction = links.find((junction) => samePoint(stage.route[0], junction.point, SNAP_TOL))
    const endJunction = links.find((junction) => samePoint(stage.route[stage.route.length - 1], junction.point, SNAP_TOL))
    const route = draftRoute.value.map(clonePoint)
    const first = route[0]
    const last = route[route.length - 1]
    const near = (p: [number, number], junction?: Junction) => !!junction && samePoint(p, junction.point, SNAP_TOL)
    const forward = near(first, startJunction) && near(last, endJunction)
    const backward = near(first, endJunction) && near(last, startJunction)
    if (!forward && !backward) {
      const names = [startJunction?.name, endJunction?.name].filter(Boolean).join(' / ') || '所属接点'
      return finish({ ok: false, reason: `起止点未落在接点 ${names} 上，相邻阶段将产生断点，已拒绝更新` })
    }
    if (backward) route.reverse()
    route[0] = clonePoint(startJunction!.point)
    route[route.length - 1] = clonePoint(endJunction!.point)
    commit()
    stage.route = route
    stage.status = '待协商'
    scheme.value.roadVersion += 1
    scheme.value.version += 1
    stampRoadVersion()
    log(`${stage.id} 封路折线重绘，端点吸附 ${startJunction!.name} / ${endJunction!.name}，道路版本升至 v${scheme.value.roadVersion}`)
    persist()
    return finish({ ok: true })
  }

  function updateStage(patch: Partial<ClosureStage>) {
    const stage = selectedStage.value
    if (!stage) return
    commit(); Object.assign(stage, patch); stage.status = '待协商'; scheme.value.version += 1; persist()
  }

  /* ---------- 意见复签 ---------- */

  function resolveComment(id: string, status: SegmentComment['status']) {
    const comment = scheme.value.comments.find((item) => item.id === id)
    if (!comment) return
    commit()
    comment.status = status
    if (status === '已接受') {
      comment.signedVersion = scheme.value.roadVersion
      delete comment.reconfirm
      log(`${comment.unit} 单位 ${comment.author} 在道路 v${comment.signedVersion} 上复签 ${comment.segmentId}`)
    }
    scheme.value.version += 1
    persist()
  }

  /* ---------- 离线测量回传：按阶段编号合并 ---------- */

  function mergeSurvey(upload: SurveyUpload): MergeReport {
    const report: MergeReport = { uploadId: upload.id, surveyor: upload.surveyor, time: upload.time, applied: [], conflicts: [], unchanged: [] }
    const byStage = new Map<string, SurveyPoint[]>()
    upload.points.forEach((point) => {
      const list = byStage.get(point.stageId) ?? []
      list.push(point)
      byStage.set(point.stageId, list)
    })
    type Decision = { junction: Junction; point: SurveyPoint; kind: 'applied' | 'conflict'; label: string }
    const decisions: Decision[] = []
    byStage.forEach((points, stageId) => {
      points.forEach((point) => {
        const junction = scheme.value.junctions.find((item) => item.id === point.junctionId)
        if (!junction || !junction.stageIds.includes(stageId)) return
        const label = `${stageId} · ${junction.name}`
        const base = syncBase.value[junction.id] ?? junction.point
        const surveyChanged = !samePoint(point.point, base)
        const officeChanged = !samePoint(junction.point, base)
        if (!surveyChanged || samePoint(point.point, junction.point)) { report.unchanged.push(label); return }
        if (officeChanged) {
          decisions.push({ junction, point, kind: 'conflict', label })
          report.conflicts.push(label)
        } else {
          decisions.push({ junction, point, kind: 'applied', label })
          report.applied.push(label)
        }
      })
    })
    if (!decisions.length) { lastMerge.value = report; return report }
    commit()
    decisions.forEach(({ junction, point, kind, label }) => {
      if (kind === 'conflict') {
        // 两边都改了同一接点：保存现场坐标和旧值，不自动覆盖
        scheme.value.junctionConflicts.push({
          id: `JC-${String(scheme.value.junctionConflicts.length + 1).padStart(2, '0')}`,
          junctionId: junction.id, stageId: point.stageId,
          source: `${upload.surveyor} / ${upload.device}`,
          fieldPoint: clonePoint(point.point), previousPoint: clonePoint(junction.point),
          status: '待处理', time: upload.time,
        })
        log(`回传冲突：${label} 双方均修改接点，已保存现场坐标 ${fmtPoint(point.point)} 与旧值 ${fmtPoint(junction.point)}`)
      } else {
        applyJunctionPoint(junction, point.point, `测量回传修正接点 ${junction.name}，需复签`)
        log(`回传合并：${label} 采用现场坐标 ${fmtPoint(point.point)}`)
      }
    })
    scheme.value.junctions.forEach((junction) => {
      const pending = scheme.value.junctionConflicts.some((item) => item.junctionId === junction.id && item.status === '待处理')
      if (!pending) syncBase.value[junction.id] = clonePoint(junction.point)
    })
    lastMerge.value = report
    persist()
    return report
  }

  function resolveJunctionConflict(id: string, useField: boolean) {
    const conflict = scheme.value.junctionConflicts.find((item) => item.id === id)
    if (!conflict || conflict.status !== '待处理') return
    const junction = scheme.value.junctions.find((item) => item.id === conflict.junctionId)
    if (!junction) return
    commit()
    if (useField) {
      applyJunctionPoint(junction, conflict.fieldPoint, `接点 ${junction.name} 采用现场坐标，需复签`)
      conflict.status = '已采用现场值'
      log(`冲突 ${conflict.id} 采用现场坐标 ${fmtPoint(conflict.fieldPoint)}`)
    } else {
      conflict.status = '已保留原值'
      log(`冲突 ${conflict.id} 保留旧值 ${fmtPoint(conflict.previousPoint)}`)
    }
    syncBase.value[junction.id] = clonePoint(junction.point)
    scheme.value.version += 1
    persist()
  }

  function simulateSurveyReturn() {
    return mergeSurvey({
      id: `SV-${Date.now() % 100000}`,
      surveyor: '测量员 陆远',
      device: 'RTK 终端 A7',
      time: new Date().toLocaleString('zh-CN', { hour12: false }),
      points: [
        { stageId: 'ST-03', junctionId: 'J2', point: [121.4707, 31.2285] },
        { stageId: 'ST-01', junctionId: 'J3', point: [121.4966, 31.2353] },
        { stageId: 'ST-02', junctionId: 'J4', point: [121.516, 31.242] },
      ],
    })
  }

  function undo() {
    const previous = history.value.pop()
    if (previous) { scheme.value = JSON.parse(previous); persist() }
  }

  restore()
  scheme.value.junctions.forEach((junction) => {
    if (!syncBase.value[junction.id]) syncBase.value[junction.id] = clonePoint(junction.point)
  })

  return {
    scheme, selectedStageId, selectedCommentId, selectedStage, selectedComment,
    drawing, draftRoute, conflicts, dirty, audit, lastMerge,
    junctionsOf, brokenJunctions, continuous, capacityRows,
    unsignedComments, pendingJunctionConflicts, publishBlockers, publishReady,
    startDraw, addPoint, finishDraw, updateStage, resolveComment,
    moveJunction, mergeSurvey, resolveJunctionConflict, simulateSurveyReturn, undo,
  }
})
