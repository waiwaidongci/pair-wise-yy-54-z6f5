<script setup lang="ts">
import { ref } from 'vue'
import { useMutation } from '@vue/apollo-composable'
import { COMMENTS_MUTATION } from '../graphql'
import { useSchemeStore } from '../store/scheme'

const store = useSchemeStore()
const { mutate } = useMutation(COMMENTS_MUTATION)
const selectedVersion = ref('v7')
const versions = [
  { id: 'v7', author: '建设组', time: '今天 16:22', summary: '调整第二阶段夜间全封闭范围，保留急救通道' },
  { id: 'v6', author: '交通组', time: '今天 14:50', summary: '补充江海大道信号配时和现场疏导岗位' },
  { id: 'v5', author: '公交组', time: '昨天 19:10', summary: '提交临时站点与线路绕行方案' },
]

function resolve(id: string, status: '已接受' | '已退回') {
  store.resolveComment(id, status)
  void mutate({ id, status })
}
function exportNotice() {
  if (!store.publishReady) return
  const text = [
    `${store.scheme.project} 施工封路公开通告`,
    `范围：${store.scheme.area}`,
    `版本：草案 v${store.scheme.version} · 道路 v${store.scheme.roadVersion}`,
    `接点连续性：${store.scheme.junctions.map((junction) => junction.name).join('、')} 全部连续`,
    '',
    ...store.scheme.stages.map((stage) => `${stage.start} 至 ${stage.end}｜${stage.name}｜${stage.lanes}`),
    '',
    '绕行建议：',
    ...store.scheme.detours.map((route) => `${route.name}，增加约 ${route.extraMinutes} 分钟`),
    '',
    '本通告由建设、交通、公交、应急单位联合确认，全部意见已在当前道路版本下复签。',
  ].join('\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `封路公开通告-${store.scheme.id}-v${store.scheme.version}.txt`
  link.click()
  URL.revokeObjectURL(link.href)
}
</script>

<template>
  <section class="page-head compact"><div><p class="eyebrow">条件会签与版本批复 · 道路 v{{ store.scheme.roadVersion }}</p><h1>路段意见与阶段审批</h1><p>意见锚定路段与道路版本；接点变更后共用接点的意见须重新确认，全部复签且接点连续才能发布通告。</p></div><a-button type="primary" :disabled="!store.publishReady" @click="exportNotice">导出公开通告包</a-button></section>
  <a-alert v-if="!store.publishReady" type="warning" title="公开通告未满足发布条件" class="mb16"><div v-for="item in store.publishBlockers" :key="item">· {{ item }}</div></a-alert>
  <a-alert v-else type="success" title="接点连续且意见全部复签，可导出公开通告" class="mb16" />
  <div class="review-grid">
    <article class="card">
      <div class="panel-head"><div><h2>会签意见</h2><p>原意见不可覆盖，处理动作进入审计记录</p></div><a-tag color="orange">{{ store.unsignedComments.length }} 待复签</a-tag></div>
      <button v-for="comment in store.scheme.comments" :key="comment.id" class="comment" :class="{ active: store.selectedCommentId === comment.id }" @click="store.selectedCommentId = comment.id">
        <div class="comment-head"><span>{{ comment.unit }}</span><b>{{ comment.author }}</b><a-tag v-if="comment.reconfirm && comment.status === '待处理'" color="orangered">接点变更需复签</a-tag><a-tag :color="comment.status === '已接受' ? 'green' : comment.status === '已退回' ? 'red' : 'orange'">{{ comment.status }}</a-tag></div>
        <p>{{ comment.content }}</p><small v-if="comment.condition">条件：{{ comment.condition }}</small><small v-if="comment.reconfirm" class="reconfirm">{{ comment.reconfirm }}</small><em>锚点 {{ comment.segmentId }} · 签于道路 v{{ comment.signedVersion }} / 当前 v{{ store.scheme.roadVersion }}</em>
      </button>
    </article>
    <div class="right">
      <article class="card">
        <div class="panel-head"><div><h2>阶段条件处理</h2><p>{{ store.selectedComment?.segmentId }} · {{ store.selectedComment?.unit }}</p></div></div>
        <div v-if="store.selectedComment" class="condition"><b>要求条件</b><p>{{ store.selectedComment.condition || '无附加条件' }}</p><b>影响解释</b><p>{{ store.selectedComment.content }}</p></div>
        <a-space><a-button status="danger" :disabled="!store.selectedComment || store.selectedComment.status === '已退回'" @click="resolve(store.selectedComment!.id, '已退回')">退回方案</a-button><a-button type="primary" :disabled="!store.selectedComment || store.selectedComment.status === '已接受'" @click="resolve(store.selectedComment!.id, '已接受')">接受并复签</a-button></a-space>
      </article>
      <article class="card">
        <div class="panel-head"><div><h2>几何版本比较</h2><p>并排核对阶段起止、围挡与绕行</p></div><a-select v-model="selectedVersion" style="width:110px"><a-option v-for="version in versions" :key="version.id" :value="version.id">{{ version.id }}</a-option></a-select></div>
        <div class="version-list"><div v-for="version in versions" :key="version.id" :class="{ selected: selectedVersion === version.id }"><b>{{ version.id }} · {{ version.author }}</b><small>{{ version.time }}</small><p>{{ version.summary }}</p></div></div>
        <a-divider />
        <h3>阶段差异</h3><div class="diff"><a-tag color="red">修改</a-tag><span>ST-02 夜间封闭边界缩短 28 米，保留急救中心南门 4 米通道。</span></div><div class="diff"><a-tag color="green">新增</a-tag><span>江海大道口增加 2 名交通疏导员和临时信号配时方案。</span></div>
      </article>
      <article class="card">
        <div class="panel-head"><div><h2>操作留痕</h2><p>接点调整、回传合并与复签记录</p></div></div>
        <div v-if="!store.audit.length" class="empty">暂无记录</div>
        <div v-for="(item, index) in store.audit.slice(-6).reverse()" :key="index" class="audit-item">{{ item }}</div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.review-grid{display:grid;grid-template-columns:1fr 1.15fr;gap:16px}.right{display:grid;gap:16px;height:fit-content}.panel-head{display:flex;justify-content:space-between;margin-bottom:12px}.panel-head h2{font-size:17px;margin:0 0 4px}.panel-head p{color:#7a8798;font-size:12px;margin:0}.comment{display:block;width:100%;text-align:left;border:1px solid #e7ebf1;background:#fff;border-radius:7px;padding:13px;margin-bottom:9px;color:inherit;cursor:pointer}.comment:hover,.comment.active{border-color:#2563eb;background:#f5f8ff}.comment-head{display:flex;align-items:center;gap:8px}.comment-head>span{display:grid;place-items:center;width:36px;height:36px;border-radius:6px;background:#eef2f7;font-weight:800}.comment-head b{flex:1}.comment p{margin:9px 0 5px;color:#475569}.comment small,.comment em{display:block;color:#7a8798}.comment em{margin-top:6px;font-style:normal}.comment .reconfirm{color:#d97706}.condition p{color:#475569}.version-list>div{padding:11px;border:1px solid #edf0f5;border-radius:6px;margin-bottom:7px}.version-list>div.selected{border-color:#2563eb;background:#f5f8ff}.version-list b,.version-list small{display:block}.version-list small{color:#7a8798;margin-top:3px}.version-list p{margin:7px 0 0;color:#475569}.diff{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5}.empty{color:#94a3b8;font-size:13px}.audit-item{padding:8px 0;border-bottom:1px solid #edf0f5;font-size:13px;color:#475569}
@media(max-width:980px){.review-grid{grid-template-columns:1fr}}
</style>
