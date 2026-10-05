<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMutation } from '@vue/apollo-composable'
import { COMMENTS_MUTATION, MERGE_OFFLINE_MUTATION, PUBLISH_NOTICE_MUTATION } from '../graphql'
import { useSchemeStore } from '../store/scheme'
import type { OfflineChange } from '../types'

const store = useSchemeStore()
const { mutate } = useMutation(COMMENTS_MUTATION)
const { mutate: mergeOffline } = useMutation(MERGE_OFFLINE_MUTATION)
const { mutate: publishNotice } = useMutation(PUBLISH_NOTICE_MUTATION)
const compare = ref(['ST-01', 'ST-02'])
const selectedVersion = ref('v7')

const blockingReasons = computed(() => {
  const checks = store.publishChecks
  const reasons: string[] = []
  if (checks.junctionIssues.length) reasons.push(`${checks.junctionIssues.length} 处接点未连续或存在离线冲突`)
  if (checks.unsigned.length) reasons.push(`${checks.unsigned.length} 条意见未复签`)
  return reasons
})
const versions = [
  { id: 'v7', author: '建设组', time: '今天 16:22', summary: '调整第二阶段夜间全封闭范围，保留急救通道' },
  { id: 'v6', author: '交通组', time: '今天 14:50', summary: '补充江海大道信号配时和现场疏导岗位' },
  { id: 'v5', author: '公交组', time: '昨天 19:10', summary: '提交临时站点与线路绕行方案' },
]

function statusColor(status: string) {
  if (status === '已接受') return 'green'
  if (status === '已退回') return 'red'
  if (status === '待复签') return 'purple'
  return 'orange'
}

function resolve(id: string, status: '已接受' | '已退回') {
  store.resolveComment(id, status)
  void mutate({ id, status })
}

function reSign(id: string) {
  store.resolveComment(id, '已接受')
  void mutate({ id, status: '已接受' })
}

function publish() {
  const ok = store.publishNotice()
  if (ok) void publishNotice()
}

/** 演示：两边离线回传改同一接点（J-2），合并时保存现场坐标与旧值 */
function demoOfflineConflict() {
  const changes: OfflineChange[] = [
    {
      id: 'OC-1', stageId: 'ST-01', junctionId: 'J-2',
      siteCoordinates: store.scheme.stages.find((s) => s.id === 'ST-01')!.route,
      siteJunction: { lng: 121.4971, lat: 31.2358 },
      oldCoordinates: store.scheme.stages.find((s) => s.id === 'ST-01')!.route.map((p) => [...p] as [number, number]),
      oldJunction: { lng: 121.496, lat: 31.235 },
      reportedBy: '建设·测量一班', at: '2026-10-04 09:12',
    },
    {
      id: 'OC-2', stageId: 'ST-02', junctionId: 'J-2',
      siteCoordinates: store.scheme.stages.find((s) => s.id === 'ST-02')!.route,
      siteJunction: { lng: 121.4952, lat: 31.2344 },
      oldCoordinates: store.scheme.stages.find((s) => s.id === 'ST-02')!.route.map((p) => [...p] as [number, number]),
      oldJunction: { lng: 121.496, lat: 31.235 },
      reportedBy: '公交·复核二班', at: '2026-10-04 09:47',
    },
  ]
  const result = store.mergeOfflineChanges(changes)
  void mergeOffline({ changes })
  if (result.conflicts.length) {
    store.lastNotice = `离线回传合并完成：${result.merged} 条，发现 ${result.conflicts.length} 处同一接点两边改动，已保存现场坐标与旧值。`
  }
}
</script>

<template>
  <section class="page-head compact"><div><p class="eyebrow">条件会签 · 接点连续 · 公开通告</p><h1>路段意见与阶段审批</h1><p>各方意见锚定同一道路版本；接点一变即复签，接点连续且全部复签后才出公开通告。</p></div><a-space><a-button @click="demoOfflineConflict">导入离线回传（两边同接点）</a-button><a-button type="primary" @click="publish">发布公开通告</a-button></a-space></section>

  <a-alert v-if="store.lastRejection" type="error" :title="store.lastRejection.reason" class="mb16">
    <template #content>{{ store.lastRejection.detail }}</template>
  </a-alert>
  <a-alert v-if="store.lastNotice" type="success" :title="store.lastNotice" class="mb16" closable @close="store.lastNotice = null" />
  <a-alert v-if="blockingReasons.length" type="warning" class="mb16" title="公开通告未满足条件">
    <template #content>接点连续且全部意见复签后才可发布。当前待办：{{ blockingReasons.join('；') }}。</template>
  </a-alert>

  <div class="review-grid">
    <article class="card">
      <div class="panel-head"><div><h2>会签意见</h2><p>原意见不可覆盖，接点变动即置待复签</p></div><a-tag color="orange">{{ store.scheme.comments.filter((item) => item.status === '待处理' || item.status === '待复签').length }} 待处理/复签</a-tag></div>
      <button v-for="comment in store.scheme.comments" :key="comment.id" class="comment" :class="{ active: store.selectedCommentId === comment.id }" @click="store.selectedCommentId = comment.id">
        <div class="comment-head"><span>{{ comment.unit }}</span><b>{{ comment.author }}</b><a-tag :color="statusColor(comment.status)">{{ comment.status }}</a-tag></div>
        <p>{{ comment.content }}</p><small v-if="comment.condition">条件：{{ comment.condition }}</small><em>锚点 {{ comment.segmentId }} · 锚定版本 v{{ comment.anchoredVersion }}</em>
      </button>
    </article>
    <div class="right">
      <article class="card">
        <div class="panel-head"><div><h2>阶段条件处理</h2><p>{{ store.selectedComment?.segmentId }} · {{ store.selectedComment?.unit }}</p></div></div>
        <div v-if="store.selectedComment" class="condition"><b>要求条件</b><p>{{ store.selectedComment.condition || '无附加条件' }}</p><b>影响解释</b><p>{{ store.selectedComment.content }}</p></div>
        <a-space>
          <a-button status="danger" :disabled="store.selectedComment?.status !== '待处理' && store.selectedComment?.status !== '待复签'" @click="resolve(store.selectedComment!.id, '已退回')">退回方案</a-button>
          <a-button v-if="store.selectedComment?.status === '待复签'" type="primary" @click="reSign(store.selectedComment!.id)">复签（按当前版本）</a-button>
          <a-button v-else type="primary" :disabled="store.selectedComment?.status !== '待处理'" @click="resolve(store.selectedComment!.id, '已接受')">接受条件</a-button>
        </a-space>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>接点连续性</h2><p>相邻阶段端点顺接，断点拒绝更新</p></div><a-tag :color="store.junctionsContinuous ? 'green' : 'red'">{{ store.junctionsContinuous ? '全部连续' : '存在断点' }}</a-tag></div>
        <div v-for="junction in store.scheme.junctions" :key="junction.id" class="junction" :class="{ broken: junction.status === '断点' || junction.conflict }">
          <div class="junction-head"><b>{{ junction.id }}</b><a-tag :color="junction.status === '连续' && !junction.conflict ? 'green' : 'red'">{{ junction.conflict ? '离线冲突' : junction.status }}</a-tag></div>
          <small>{{ junction.upstreamStageId }} → {{ junction.downstreamStageId }} · v{{ junction.confirmedVersion }}</small>
          <template v-if="junction.conflict">
            <div class="conflict-box">
              <p>旧值：{{ junction.conflict.oldLng.toFixed(5) }}, {{ junction.conflict.oldLat.toFixed(5) }}</p>
              <p v-for="(side, idx) in junction.conflict.sides" :key="idx">{{ side.reporter }}（{{ side.stageId }}）现场：{{ side.siteLng.toFixed(5) }}, {{ side.siteLat.toFixed(5) }} · {{ side.at }}</p>
            </div>
            <a-button size="small" type="primary" @click="store.resolveJunctionConflict(junction.id)">现场复核后清除冲突</a-button>
          </template>
        </div>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>车道容量台账</h2><p>急救、公交先占，余量供导改排队</p></div></div>
        <div v-for="row in store.capacityLedger" :key="row.stage.id" class="capacity-row">
          <b>{{ row.stage.id }}</b>
          <span>总 {{ row.stage.capacity.total }} · 急救 {{ row.stage.capacity.emergency }} · 公交 {{ row.stage.capacity.bus }} · 余量 {{ row.remaining }}</span>
          <div v-for="item in row.assigned" :key="item.detour.id" class="detour-line">
            <small>{{ item.detour.name }}（需 {{ item.detour.requiredLanes }} 车道）</small>
            <a-tag :color="item.active ? 'green' : 'orange'">{{ item.active ? '保通' : '排队候行' }}</a-tag>
          </div>
        </div>
      </article>

      <article class="card">
        <div class="panel-head"><div><h2>几何版本比较</h2><p>并排核对阶段起止、围挡与绕行</p></div><a-select v-model="selectedVersion" style="width:110px"><a-option v-for="version in versions" :key="version.id" :value="version.id">{{ version.id }}</a-option></a-select></div>
        <div class="version-list"><div v-for="version in versions" :key="version.id" :class="{ selected: selectedVersion === version.id }"><b>{{ version.id }} · {{ version.author }}</b><small>{{ version.time }}</small><p>{{ version.summary }}</p></div></div>
        <a-divider />
        <h3>阶段差异</h3><div class="diff"><a-tag color="red">修改</a-tag><span>ST-02 夜间封闭边界缩短 28 米，保留急救中心南门 4 米通道。</span></div><div class="diff"><a-tag color="green">新增</a-tag><span>江海大道口增加 2 名交通疏导员和临时信号配时方案。</span></div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.review-grid{display:grid;grid-template-columns:1fr 1.15fr;gap:16px}.right{display:grid;gap:16px;height:fit-content}.panel-head{display:flex;justify-content:space-between;margin-bottom:12px}.panel-head h2{font-size:17px;margin:0 0 4px}.panel-head p{color:#7a8798;font-size:12px;margin:0}.comment{display:block;width:100%;text-align:left;border:1px solid #e7ebf1;background:#fff;border-radius:7px;padding:13px;margin-bottom:9px;color:inherit;cursor:pointer}.comment:hover,.comment.active{border-color:#2563eb;background:#f5f8ff}.comment-head{display:flex;align-items:center;gap:8px}.comment-head>span{display:grid;place-items:center;width:36px;height:36px;border-radius:6px;background:#eef2f7;font-weight:800}.comment-head b{flex:1}.comment p{margin:9px 0 5px;color:#475569}.comment small,.comment em{display:block;color:#7a8798}.comment em{margin-top:6px;font-style:normal}.condition p{color:#475569}.version-list>div{padding:11px;border:1px solid #edf0f5;border-radius:6px;margin-bottom:7px}.version-list>div.selected{border-color:#2563eb;background:#f5f8ff}.version-list b,.version-list small{display:block}.version-list small{color:#7a8798;margin-top:3px}.version-list p{margin:7px 0 0;color:#475569}.diff{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5}
.junction{border:1px solid #edf0f5;border-radius:7px;padding:11px;margin-bottom:9px}.junction.broken{border-color:#fca5a5;background:#fff5f5}.junction-head{display:flex;justify-content:space-between;align-items:center}.junction small{display:block;color:#7a8798;margin-top:3px}.conflict-box{background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:8px;margin:8px 0}.conflict-box p{margin:2px 0;font-size:12px;color:#9a3412}.capacity-row{padding:9px 0;border-bottom:1px solid #edf0f5}.capacity-row b{margin-right:8px}.capacity-row>span{color:#7a8798;font-size:12px}.detour-line{display:flex;justify-content:space-between;align-items:center;margin-top:4px;padding-left:10px}.detour-line small{color:#475569}
@media(max-width:980px){.review-grid{grid-template-columns:1fr}}
</style>
