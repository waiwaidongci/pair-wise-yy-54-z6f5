<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import { SCHEME_QUERY } from '../graphql'
import { useSchemeStore } from '../store/scheme'

const store = useSchemeStore()
const { result, loading, error } = useQuery(SCHEME_QUERY)

const queuedDetours = computed(() => store.scheme.detours.filter((detour) => store.detourStatus(detour.id) === '排队').length)
const pendingComments = computed(() => store.scheme.comments.filter((comment) => comment.status !== '已接受').length)

const stats = computed(() => [
  { label: '施工阶段', value: store.scheme.stages.length, note: '跨 42 天' },
  { label: '接点连续', value: store.junctionsContinuous ? '全部连续' : '存在断点', note: `${store.scheme.junctions.length} 个接点 · 断开拒绝更新` },
  { label: '排队导改', value: queuedDetours.value, note: '急救公交先占容量，余量不足' },
  { label: '方案版本', value: `v${result.value?.scheme?.version ?? store.scheme.version}`, note: '几何修改留痕 · 意见锚定版本' },
])

function agencyNote(role: string) {
  const count = store.scheme.comments.filter((comment) => comment.unit === role && comment.status !== '已接受').length
  if (count) return `${count} 条待复签/处理`
  return '已全部复签'
}

function previewNotice() {
  const ok = store.publishNotice()
  if (!ok) {
    // 拒绝原因已写入 store.lastRejection，跳转后可见
  }
}
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">建设 · 交通 · 公交 · 应急</p><h1>封路方案协调总览</h1><p>同一道路版本下核验相邻接点、生命通道、公交覆盖与绕行时延；接点连续且全部复签才可出通告。</p></div><a-space><a-button @click="previewNotice">公开通告预览</a-button><a-button type="primary" @click="$router.push('/map')">编辑封路方案</a-button></a-space></section>
  <a-spin :loading="loading" style="width:100%">
    <a-alert v-if="error" type="error" title="GraphQL 请求异常，已使用本地草案" class="mb16" />
    <a-alert v-if="store.lastRejection" type="error" :title="store.lastRejection.reason" class="mb16" :content="store.lastRejection.detail" />
    <div class="metrics"><article v-for="item in stats" :key="item.label" class="card metric"><span>{{ item.label }}</span><strong>{{ item.value }}</strong><small>{{ item.note }}</small></article></div>
    <div class="grid-2">
      <article class="card">
        <div class="panel-head"><div><h2>施工阶段时间轴</h2><p>点击阶段查看范围与道路占用</p></div><a-tag color="orange">42 天计划</a-tag></div>
        <a-table :data="store.scheme.stages" :pagination="false" row-key="id" @row-click="(row: any) => { store.selectedStageId = row.id; $router.push('/map') }">
          <template #columns><a-table-column title="阶段" data-index="name" /><a-table-column title="时间" :width="190"><template #cell="{ record }">{{ record.start }} → {{ record.end }}</template></a-table-column><a-table-column title="车道方案" data-index="lanes" /><a-table-column title="状态" :width="100"><template #cell="{ record }"><a-tag :color="record.status === '已批准' ? 'green' : record.status === '退回' ? 'red' : 'orange'">{{ record.status }}</a-tag></template></a-table-column></template>
        </a-table>
      </article>
      <article class="card">
        <div class="panel-head"><div><h2>规则检测结果</h2><p>按影响等级排序</p></div><a-tag color="red">{{ store.conflicts.filter((item) => item.level === '高').length }} 高风险</a-tag></div>
        <div v-for="item in store.conflicts" :key="item.id" class="conflict" :class="item.level === '高' ? 'red' : 'amber'"><div><b>{{ item.title }}</b><small>{{ item.segmentId }}</small></div><a-tag :color="item.level === '高' ? 'red' : 'orange'">{{ item.level }}</a-tag><p>{{ item.detail }}</p><a-button size="mini" type="text" @click="store.selectedStageId = item.segmentId; $router.push('/map')">定位路段</a-button></div>
      </article>
    </div>
    <article class="card mt16"><div class="panel-head"><div><h2>会签单位与条件</h2><p>意见锚定同一道路版本，接点变动即复签</p></div><a-button type="text" @click="$router.push('/review')">进入会签</a-button></div><div class="agency-grid"><div v-for="agency in result?.agencies || []" :key="agency.id" class="agency"><span>{{ agency.role }}</span><div><b>{{ agency.name }}</b><small>{{ agencyNote(agency.role) }}</small></div><a-tag :color="agencyNote(agency.role).includes('待') ? 'orange' : 'green'">{{ agencyNote(agency.role).includes('待') ? '待复签' : '已响应' }}</a-tag></div></div></article>
  </a-spin>
</template>

<style scoped>
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.metric{padding:17px;border-left:4px solid #2563eb}.metric span,.metric small{display:block;color:#667085}.metric strong{display:block;font-size:29px;margin:7px 0 2px}.grid-2{display:grid;grid-template-columns:1.4fr .8fr;gap:16px}.panel-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}.panel-head h2{font-size:17px;margin:0 0 4px}.panel-head p{color:#7a8798;font-size:13px;margin:0}.conflict{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:12px;margin-bottom:9px;border-radius:6px}.conflict.red{background:#fff1f2;border-left:3px solid #e11d48}.conflict.amber{background:#fff7ed;border-left:3px solid #f59e0b}.conflict>div{min-width:210px}.conflict b,.conflict small{display:block}.conflict small{color:#7a8798;margin-top:3px}.conflict p{width:100%;margin:0;color:#475569}.mt16{margin-top:16px}.agency-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.agency{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid #e7ebf1;border-radius:7px}.agency>span{display:grid;place-items:center;width:35px;height:35px;border-radius:7px;background:#eff6ff;color:#2563eb;font-weight:800}.agency b,.agency small{display:block}.agency small{color:#7a8798;margin-top:3px}.agency>div{flex:1}
@media(max-width:1050px){.metrics,.agency-grid{grid-template-columns:1fr 1fr}.grid-2{grid-template-columns:1fr}}@media(max-width:600px){.metrics,.agency-grid{grid-template-columns:1fr}}
</style>
