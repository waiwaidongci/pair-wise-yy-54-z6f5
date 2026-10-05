import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ClosureStage,
  DetourRoute,
  Junction,
  LaneCapacity,
  OfflineChange,
  Scheme,
  SegmentComment,
} from '../types'
import { distanceMeters, JUNCTION_TOLERANCE, midpoint, stageEnd, stageStart, type LngLat } from '../geo'

const STORAGE_KEY = 'yy54-road-scheme-v2'

const seed: Scheme = {
  id: 'RC-2026-0918', project: '云河路快速化改造', contractor: '市政建设集团第三工程处', area: '云河路 / 江海大道', version: 7,
  stages: [
    { id: 'ST-01', name: '第一阶段 · 东半幅围挡', start: '2026-10-08', end: '2026-10-22', lanes: '双向 4 车道收窄为 2 车道', status: '条件通过', version: 7, fromJunctionId: 'J-1', toJunctionId: 'J-2', capacity: { total: 4, emergency: 1, bus: 1 }, route: [[121.470,31.228],[121.482,31.231],[121.496,31.235]] },
    { id: 'ST-02', name: '第二阶段 · 路口夜间施工', start: '2026-10-23', end: '2026-11-05', lanes: '22:00–05:00 全封闭（保留 4 米急救通道）', status: '待协商', version: 7, fromJunctionId: 'J-2', capacity: { total: 2, emergency: 1, bus: 0 }, route: [[121.496,31.235],[121.508,31.238],[121.516,31.242]] },
    { id: 'ST-03', name: '第三阶段 · 西半幅恢复', start: '2026-11-06', end: '2026-11-18', lanes: '西侧公交专用道临时占用', status: '退回', version: 7, toJunctionId: 'J-1', capacity: { total: 3, emergency: 1, bus: 1 }, route: [[121.452,31.224],[121.462,31.226],[121.470,31.228]] },
  ],
  detours: [
    { id: 'DR-01', name: '江海大道—滨河路绕行', distance: 4.8, extraMinutes: 11, requiredLanes: 2, stageId: 'ST-02', status: '排队', version: 7, coordinates: [[121.470,31.228],[121.478,31.214],[121.502,31.218],[121.516,31.242]] },
    { id: 'DR-02', name: '云河路辅道保通', distance: 2.3, extraMinutes: 6, requiredLanes: 2, stageId: 'ST-01', status: '保通', version: 7, coordinates: [[121.452,31.224],[121.462,31.219],[121.496,31.235]] },
  ],
  comments: [
    { id: 'CM-41', segmentId: 'ST-01', unit: '公交', author: '顾敏', content: '17 路、806 路临时站点与云河路站距离 680 米，超过老年乘客可接受步行距离。', condition: '需在江海大道口增设临时站并配置导乘人员。', status: '待处理', anchoredVersion: 7 },
    { id: 'CM-42', segmentId: 'ST-02', unit: '应急', author: '夏川', content: '夜间全封闭期间，区域急救中心南门通道被切断。', condition: '保留 4 米应急通道，路口导改每 15 分钟巡查一次。', status: '已接受', anchoredVersion: 7 },
    { id: 'CM-43', segmentId: 'ST-03', unit: '交通', author: '郑航', content: '公交专用道占用导致高峰小时延误增加 19 分钟，超过方案阈值。', condition: '缩减围挡 1.5 米并调整信号配时。', status: '已退回', anchoredVersion: 7 },
  ],
  junctions: [
    { id: 'J-1', lng: 121.470, lat: 31.228, upstreamStageId: 'ST-03', downstreamStageId: 'ST-01', status: '连续', confirmedVersion: 7 },
    { id: 'J-2', lng: 121.496, lat: 31.235, upstreamStageId: 'ST-01', downstreamStageId: 'ST-02', status: '连续', confirmedVersion: 7 },
  ],
  offlineChanges: [],
}

/** 一次几何更新的校验结果 */
interface GeometryValidation {
  ok: boolean
  /** 断开的接点（超过容差） */
  breakpoints: { junction: Junction; distance: number }[]
  /** 位置发生移动的接点（即使仍连续） */
  moved: Junction[]
}

export const useSchemeStore = defineStore('scheme', () => {
  const scheme = ref<Scheme>(structuredClone(seed))
  const selectedStageId = ref('ST-01')
  const selectedCommentId = ref('CM-41')
  const drawing = ref(false)
  const draftRoute = ref<LngLat[]>([])
  const history = ref<string[]>([])
  /** 最近一次被拒绝的更新（断点等） */
  const lastRejection = ref<{ reason: string; detail: string; breakpoints?: { junctionId: string; distance: number }[] } | null>(null)
  /** 最近一次操作提示 */
  const lastNotice = ref<string | null>(null)

  const selectedStage = computed(() => scheme.value.stages.find((item) => item.id === selectedStageId.value))
  const selectedComment = computed(() => scheme.value.comments.find((item) => item.id === selectedCommentId.value))
  const dirty = computed(() => history.value.length > 0)

  const conflicts = computed(() => [
    ...(scheme.value.stages.some((stage) => stage.id === 'ST-02') ? [{ id: 'CF-01', level: '高' as const, segmentId: 'ST-02', title: '相邻雨污分流工程时间重叠', detail: '10 月 26–30 日江海大道东段同步占用慢车道，建议错峰 4 天。' }] : []),
    { id: 'CF-02', level: '高' as const, segmentId: 'ST-02', title: '救护通道中断风险', detail: '夜间全封闭将切断区域急救中心南门，必须保留 4 米应急通道。' },
    { id: 'CF-03', level: '中' as const, segmentId: 'ST-01', title: '公交站点覆盖缺口', detail: '17 路与 806 路临时站距现状站 680 米，已超过 500 米阈值。' },
    { id: 'CF-04', level: '中' as const, segmentId: 'ST-03', title: '绕行延误超阈值', detail: '高峰绕行新增 19 分钟，超过方案设定的 15 分钟阈值。' },
  ])

  /** 车道容量台账：急救、公交先占后，余量供导改排队 */
  const capacityLedger = computed(() => scheme.value.stages.map((stage) => {
    const remaining = Math.max(0, stage.capacity.total - stage.capacity.emergency - stage.capacity.bus)
    const onStage = scheme.value.detours.filter((detour) => detour.stageId === stage.id)
    let avail = remaining
    const assigned = onStage.map((detour) => {
      const active = avail >= detour.requiredLanes
      if (active) avail -= detour.requiredLanes
      return { detour, active }
    })
    return { stage, remaining, avail, assigned }
  }))

  const detourStatus = (detourId: string): '保通' | '排队' => {
    for (const row of capacityLedger.value) {
      const found = row.assigned.find((item) => item.detour.id === detourId)
      if (found) return found.active ? '保通' : '排队'
    }
    return '排队'
  }

  /** 接点连续性：全部连续且无冲突才可出通告 */
  const junctionsContinuous = computed(() =>
    scheme.value.junctions.every((junction) => junction.status === '连续' && !junction.conflict))

  /** 意见复签情况：全部已接受才允许通告 */
  const commentsAllAccepted = computed(() =>
    scheme.value.comments.every((comment) => comment.status === '已接受'))

  const publishChecks = computed(() => {
    const junctionIssues = scheme.value.junctions.filter((junction) => junction.status === '断点' || junction.conflict)
    const unsigned = scheme.value.comments.filter((comment) => comment.status !== '已接受')
    return {
      ok: junctionIssues.length === 0 && unsigned.length === 0,
      junctionIssues,
      unsigned,
    }
  })

  const noticeText = computed(() => {
    const s = scheme.value
    return [
      `${s.project} 施工封路公开通告`,
      `范围：${s.area}`,
      `版本：v${s.version}`,
      '',
      '一、封路阶段（接点连续，逐段复签）',
      ...s.stages.map((stage) => `${stage.start} 至 ${stage.end}｜${stage.name}｜${stage.lanes}`),
      '',
      '二、导改线路（急救通道与公交保底班次先占车道容量）',
      ...s.detours.map((detour) => `${detour.name}，增加约 ${detour.extraMinutes} 分钟｜${detourStatus(detour.id) === '保通' ? '保通' : '排队候行'}`),
      '',
      '三、接点连续性',
      ...s.junctions.map((junction) => `${junction.id}｜${junction.status}${junction.conflict ? '（离线回传冲突待现场复核）' : ''}`),
      '',
      '本通告由建设、交通、公交、应急单位在同一道路版本下联合确认。',
    ].join('\n')
  })

  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(scheme.value)) }
  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try { scheme.value = JSON.parse(raw) } catch { /* 忽略损坏的本地草案 */ }
    }
  }
  function commit() { history.value.push(JSON.stringify(scheme.value)); persist() }

  function undo() {
    const previous = history.value.pop()
    if (previous) { scheme.value = JSON.parse(previous); persist() }
  }

  function bumpVersion() { scheme.value.version += 1 }

  /** 取接点在某阶段上的端点（上游取终点，下游取起点） */
  function junctionPoint(stage: ClosureStage, junction: Junction): LngLat | null {
    if (junction.upstreamStageId === stage.id) return stageEnd(stage.route)
    if (junction.downstreamStageId === stage.id) return stageStart(stage.route)
    return null
  }

  /** 校验某阶段换成新折线后，涉及的接点是否仍连续 */
  function validateGeometry(stage: ClosureStage, newRoute: LngLat[]): GeometryValidation {
    const breakpoints: GeometryValidation['breakpoints'] = []
    const moved: Junction[] = []
    for (const junction of scheme.value.junctions) {
      if (junction.upstreamStageId !== stage.id && junction.downstreamStageId !== stage.id) continue
      const partnerId = junction.upstreamStageId === stage.id ? junction.downstreamStageId : junction.upstreamStageId
      const partner = scheme.value.stages.find((item) => item.id === partnerId)
      if (!partner) continue
      const newPoint = junction.upstreamStageId === stage.id ? stageEnd(newRoute) : stageStart(newRoute)
      const partnerPoint = junctionPoint(partner, junction)
      if (!partnerPoint) continue
      const dist = distanceMeters(newPoint, partnerPoint)
      if (dist > JUNCTION_TOLERANCE) {
        breakpoints.push({ junction, distance: dist })
      } else {
        const movedDist = distanceMeters(newPoint, [junction.lng, junction.lat])
        if (movedDist > 1) moved.push(junction)
      }
    }
    return { ok: breakpoints.length === 0, breakpoints, moved }
  }

  /** 按当前折线重算所有接点坐标与连续状态 */
  function recomputeJunctions() {
    for (const junction of scheme.value.junctions) {
      const upstream = scheme.value.stages.find((stage) => stage.id === junction.upstreamStageId)
      const downstream = scheme.value.stages.find((stage) => stage.id === junction.downstreamStageId)
      if (!upstream || !downstream) continue
      const upPoint = stageEnd(upstream.route)
      const downPoint = stageStart(downstream.route)
      const dist = distanceMeters(upPoint, downPoint)
      if (dist <= JUNCTION_TOLERANCE && !junction.conflict) {
        junction.status = '连续'
        const mid = midpoint(upPoint, downPoint)
        junction.lng = mid[0]
        junction.lat = mid[1]
      } else if (!junction.conflict) {
        junction.status = '断点'
      }
    }
  }

  /** 接点变动后，让共用该接点的意见重新确认（置为待复签） */
  function invalidateCommentsAtJunctions(junctions: Junction[]) {
    const ids = new Set(junctions.map((junction) => junction.id))
    const stageIds = new Set<string>()
    for (const junction of scheme.value.junctions) {
      if (!ids.has(junction.id)) continue
      stageIds.add(junction.upstreamStageId)
      stageIds.add(junction.downstreamStageId)
    }
    for (const comment of scheme.value.comments) {
      if (stageIds.has(comment.segmentId) && comment.status !== '待复签') {
        comment.status = '待复签'
      }
    }
  }

  function startDraw() {
    drawing.value = true
    draftRoute.value = []
    lastRejection.value = null
  }

  function addPoint(point: LngLat) {
    if (drawing.value) draftRoute.value.push(point)
  }

  function finishDraw(): boolean {
    const stage = selectedStage.value
    if (!stage) return false
    if (draftRoute.value.length < 2) {
      lastRejection.value = { reason: '折线过短', detail: '封路折线至少需要 2 个接点才能成段。' }
      return false
    }
    const validation = validateGeometry(stage, draftRoute.value)
    if (!validation.ok) {
      lastRejection.value = {
        reason: '相邻阶段断点',
        detail: `改线后与相邻阶段端点距离超出 ${JUNCTION_TOLERANCE} 米容差，共 ${validation.breakpoints.length} 处断点。请顺接相邻阶段后再提交。`,
        breakpoints: validation.breakpoints.map((item) => ({ junctionId: item.junction.id, distance: Math.round(item.distance) })),
      }
      return false
    }
    commit()
    stage.route = draftRoute.value
    stage.status = '待协商'
    bumpVersion()
    stage.version = scheme.value.version
    for (const junction of validation.moved) junction.conflict = undefined
    recomputeJunctions()
    invalidateCommentsAtJunctions(validation.moved)
    drawing.value = false
    draftRoute.value = []
    lastRejection.value = null
    lastNotice.value = `已更新 ${stage.id} 几何至 v${scheme.value.version}，共用接点的意见已置为待复签。`
    persist()
    return true
  }

  function cancelDraw() {
    drawing.value = false
    draftRoute.value = []
  }

  function updateStage(patch: Partial<ClosureStage>) {
    const stage = selectedStage.value
    if (!stage) return
    commit()
    Object.assign(stage, patch)
    stage.status = '待协商'
    bumpVersion()
    stage.version = scheme.value.version
    persist()
  }

  function updateCapacity(stageId: string, patch: Partial<LaneCapacity>) {
    const stage = scheme.value.stages.find((item) => item.id === stageId)
    if (!stage) return
    commit()
    Object.assign(stage.capacity, patch)
    bumpVersion()
    stage.version = scheme.value.version
    persist()
  }

  function resolveComment(id: string, status: SegmentComment['status']) {
    const comment = scheme.value.comments.find((item) => item.id === id)
    if (!comment) return
    commit()
    comment.status = status
    comment.anchoredVersion = scheme.value.version
    persist()
  }

  /** 离线测量回传：按阶段编号合并；两边改同一接点时保存现场坐标与旧值 */
  function mergeOfflineChanges(incoming: OfflineChange[]): { merged: number; conflicts: Junction[] } {
    commit()
    const conflicts: Junction[] = []
    for (const change of incoming) {
      const stage = scheme.value.stages.find((item) => item.id === change.stageId)
      if (!stage) continue
      scheme.value.offlineChanges.push(change)

      if (change.siteJunction && change.junctionId) {
        const junction = scheme.value.junctions.find((item) => item.id === change.junctionId)
        if (junction) {
          // 检查是否已有另一方回传改过同一接点
          const prior = scheme.value.offlineChanges.find(
            (item) => item.junctionId === change.junctionId && item.reportedBy !== change.reportedBy,
          )
          if (prior && prior.siteJunction) {
            junction.conflict = {
              oldLng: change.oldJunction?.lng ?? junction.lng,
              oldLat: change.oldJunction?.lat ?? junction.lat,
              sides: [
                { reporter: prior.reportedBy, at: prior.at, stageId: prior.stageId, siteLng: prior.siteJunction.lng, siteLat: prior.siteJunction.lat },
                { reporter: change.reportedBy, at: change.at, stageId: change.stageId, siteLng: change.siteJunction.lng, siteLat: change.siteJunction.lat },
              ],
            }
            junction.status = '断点'
            conflicts.push(junction)
            continue
          }
          // 仅一方改动：落到对应阶段端点
          if (junction.upstreamStageId === stage.id) {
            stage.route[stage.route.length - 1] = [change.siteJunction.lng, change.siteJunction.lat]
          } else if (junction.downstreamStageId === stage.id) {
            stage.route[0] = [change.siteJunction.lng, change.siteJunction.lat]
          }
        }
      } else if (change.siteCoordinates.length >= 2) {
        stage.route = change.siteCoordinates
      }
    }
    bumpVersion()
    for (const stage of scheme.value.stages) stage.version = scheme.value.version
    recomputeJunctions()
    const affected = scheme.value.junctions.filter((junction) =>
      incoming.some((change) => change.junctionId === junction.id))
    invalidateCommentsAtJunctions(affected)
    persist()
    return { merged: incoming.length, conflicts }
  }

  /** 现场复核后清除接点冲突：取两边现场坐标的折中位置作为复核后坐标，顺接两端 */
  function resolveJunctionConflict(junctionId: string) {
    const junction = scheme.value.junctions.find((item) => item.id === junctionId)
    if (!junction) return
    commit()
    if (junction.conflict && junction.conflict.sides.length >= 2) {
      const sides = junction.conflict.sides
      const reconciled: LngLat = [
        (sides[0].siteLng + sides[1].siteLng) / 2,
        (sides[0].siteLat + sides[1].siteLat) / 2,
      ]
      const upstream = scheme.value.stages.find((stage) => stage.id === junction.upstreamStageId)
      const downstream = scheme.value.stages.find((stage) => stage.id === junction.downstreamStageId)
      if (upstream) upstream.route[upstream.route.length - 1] = reconciled
      if (downstream) downstream.route[0] = reconciled
    }
    junction.conflict = undefined
    recomputeJunctions()
    if (junction.status === '连续') {
      bumpVersion()
      junction.confirmedVersion = scheme.value.version
      invalidateCommentsAtJunctions([junction])
    }
    persist()
  }

  function publishNotice(): boolean {
    const checks = publishChecks.value
    if (!checks.ok) {
      const reasons: string[] = []
      if (checks.junctionIssues.length) reasons.push(`${checks.junctionIssues.length} 处接点未连续或存在离线冲突`)
      if (checks.unsigned.length) reasons.push(`${checks.unsigned.length} 条意见未复签`)
      lastRejection.value = { reason: '不满足通告条件', detail: `${reasons.join('；')}。接点连续且全部意见复签后才可公开通告。` }
      return false
    }
    scheme.value.noticePublishedVersion = scheme.value.version
    if (typeof document !== 'undefined') {
      const blob = new Blob([noticeText.value], { type: 'text/plain;charset=utf-8' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `封路公开通告-${scheme.value.id}-v${scheme.value.version}.txt`
      link.click()
      URL.revokeObjectURL(link.href)
    }
    lastNotice.value = `已发布 v${scheme.value.version} 公开通告。`
    return true
  }

  restore()
  return {
    scheme, selectedStageId, selectedCommentId, selectedStage, selectedComment,
    drawing, draftRoute, history, conflicts, dirty, lastRejection, lastNotice,
    capacityLedger, junctionsContinuous, commentsAllAccepted, publishChecks, noticeText,
    detourStatus, startDraw, addPoint, finishDraw, cancelDraw, updateStage, updateCapacity,
    resolveComment, mergeOfflineChanges, resolveJunctionConflict, publishNotice, undo,
  }
})
