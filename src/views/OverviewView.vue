<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@vue/apollo-composable'
import { Message } from '@arco-design/web-vue'
import { SCHEME_QUERY } from '../graphql'
import { useSchemeStore } from '../store/scheme'

const store = useSchemeStore()
const router = useRouter()
const { result, loading, error } = useQuery(SCHEME_QUERY)
const stats = computed(() => [
  { label: '施工阶段', value: store.scheme.stages.length, note: '跨 42 天' },
  { label: '接点断点', value: store.brokenJunctions.length, note: store.continuous ? '接点全部连续' : '断开阶段的更新会被拒绝' },
  { label: '待复签意见', value: store.unsignedComments.length, note: '接点变更后须重新确认' },
  { label: '道路版本', value: `v${store.scheme.roadVersion}`, note: `草案 v${store.scheme.version} · 几何留痕` },
])
const queuedDetours = computed(() => store.capacityRows.flatMap((row) => row.detours.filter((slot) => slot.state === '排队中').map((slot) => `${slot.name}（${row.stageId} 第 ${slot.queue} 位）`)))

function previewNotice() {
  if (store.publishReady) router.push('/review')
  else Message.warning(`暂不可发布：${store.publishBlockers[0]}`)
}
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">建设 · 交通 · 公交 · 应急</p><h1>封路方案协调总览</h1><p>阶段、导改与单位意见绑定同一道路版本；接点连续且意见全部复签后才出公开通告。</p></div><a-space><a-button @click="previewNotice">公开通告预览</a-button><a-button type="primary" @click="$router.push('/map')">编辑封路方案</a-button></a-space></section>
  <a-spin :loading="loading" style="width:100%">
    <a-alert v-if="error" type="error" title="GraphQL 请求异常，已使用本地草案" class="mb16" />
    <a-alert v-if="!store.publishReady" type="warning" title="公开通告未满足发布条件" class="mb16"><div v-for="item in store.publishBlockers" :key="item">· {{ item }}</div></a-alert>
    <a-alert v-else type="success" title="接点连续且意见全部复签，可导出公开通告" class="mb16" />
    <div class="metrics"><article v-for="item in stats" :key="item.label" class="card metric"><span>{{ item.label }}</span><strong>{{ item.value }}</strong><small>{{ item.note }}</small></article></div>
    <div class="grid-2">
      <article class="card">
        <div class="panel-head"><div><h2>施工阶段时间轴</h2><p>点击阶段查看范围与道路占用</p></div><a-tag color="orange">42 天计划</a-tag></div>
        <a-table :data="store.scheme.stages" :pagination="false" row-key="id" @row-click="(row: any) => { store.selectedStageId = row.id; $router.push('/map') }">
          <template #columns><a-table-column title="阶段" data-index="name" /><a-table-column title="时间" :width="190"><template #cell="{ record }">{{ record.start }} → {{ record.end }}</template></a-table-column><a-table-column title="车道方案" data-index="lanes" /><a-table-column title="状态" :width="100"><template #cell="{ record }"><a-tag :color="record.status === '已批准' ? 'green' : record.status === '退回' ? 'red' : 'orange'">{{ record.status }}</a-tag></template></a-table-column></template></a-table>
      </article>
      <article class="card">
        <div class="panel-head"><div><h2>规则检测结果</h2><p>按影响等级排序</p></div><a-tag color="red">{{ store.conflicts.filter((item) => item.level === '高').length }} 高风险</a-tag></div>
        <div v-for="item in store.conflicts" :key="item.id" class="conflict" :class="item.level === '高' ? 'red' : 'amber'"><div><b>{{ item.title }}</b><small>{{ item.segmentId }}</small></div><a-tag :color="item.level === '高' ? 'red' : 'orange'">{{ item.level }}</a-tag><p>{{ item.detail }}</p><a-button size="mini" type="text" @click="store.selectedStageId = item.segmentId; $router.push('/map')">定位路段</a-button></div>
      </article>
    </div>
    <div class="grid-2 mt16">
      <article class="card">
        <div class="panel-head"><div><h2>车道容量分配</h2><p>急救通道与公交保底班次先占容量，余量不够的导改线路排队</p></div><a-tag :color="queuedDetours.length ? 'orange' : 'green'">{{ queuedDetours.length ? `${queuedDetours.length} 条排队` : '全部排入' }}</a-tag></div>
        <div v-for="row in store.capacityRows" :key="row.stageId" class="capacity-row">
          <div class="capacity-head"><b>{{ row.stageId }}</b><div class="capacity"><span>能力 {{ row.capacity }}</span><span>急救 {{ row.ambulance }}</span><span>公交保底 {{ row.busMin }}</span><span :class="{ negative: row.remaining < 0 }">余量 {{ row.remaining }}</span></div></div>
          <div v-if="!row.detours.length" class="empty">无导改线路</div>
          <div v-for="slot in row.detours" :key="slot.id" class="slot"><span>{{ slot.name }} · 需求 {{ slot.demand }} 辆/时</span><a-tag :color="slot.state === '已排入' ? 'green' : 'orange'">{{ slot.state === '已排入' ? '已排入' : `排队第 ${slot.queue} 位` }}</a-tag></div>
        </div>
      </article>
      <article class="card">
        <div class="panel-head"><div><h2>会签单位与条件</h2><p>意见锚定具体分段与道路版本，原记录不覆盖</p></div><a-button type="text" @click="$router.push('/review')">进入会签</a-button></div>
        <div class="agency-grid"><div v-for="agency in result?.agencies || []" :key="agency.id" class="agency"><span>{{ agency.role }}</span><div><b>{{ agency.name }}</b><small>{{ agency.role === '公交' ? '1 条待处理' : agency.role === '应急' ? '条件已接受' : '暂无新增意见' }}</small></div><a-tag :color="agency.role === '公交' ? 'orange' : 'green'">{{ agency.role === '公交' ? '待处理' : '已响应' }}</a-tag></div></div>
        <a-divider />
        <div class="panel-head"><div><h2>接点连续性</h2><p>共用接点的意见随接点变更重新确认</p></div><a-tag :color="store.continuous ? 'green' : 'red'">{{ store.continuous ? '全部连续' : `${store.brokenJunctions.length} 处断点` }}</a-tag></div>
        <div v-for="junction in store.scheme.junctions" :key="junction.id" class="slot"><span>{{ junction.name }} · {{ junction.stageIds.join('、') }}</span><a-tag :color="store.brokenJunctions.some((item) => item.id === junction.id) ? 'red' : 'green'">{{ store.brokenJunctions.some((item) => item.id === junction.id) ? '断点' : '连续' }}</a-tag></div>
      </article>
    </div>
  </a-spin>
</template>

<style scoped>
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.metric{padding:17px;border-left:4px solid #2563eb}.metric span,.metric small{display:block;color:#667085}.metric strong{display:block;font-size:29px;margin:7px 0 2px}.grid-2{display:grid;grid-template-columns:1.4fr .8fr;gap:16px}.panel-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}.panel-head h2{font-size:17px;margin:0 0 4px}.panel-head p{color:#7a8798;font-size:13px;margin:0}.conflict{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:12px;margin-bottom:9px;border-radius:6px}.conflict.red{background:#fff1f2;border-left:3px solid #e11d48}.conflict.amber{background:#fff7ed;border-left:3px solid #f59e0b}.conflict>div{min-width:210px}.conflict b,.conflict small{display:block}.conflict small{color:#7a8798;margin-top:3px}.conflict p{width:100%;margin:0;color:#475569}.mt16{margin-top:16px}.agency-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.agency{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid #e7ebf1;border-radius:7px}.agency>span{display:grid;place-items:center;width:35px;height:35px;border-radius:7px;background:#eff6ff;color:#2563eb;font-weight:800}.agency b,.agency small{display:block}.agency small{color:#7a8798;margin-top:3px}.agency>div{flex:1}
.capacity-row{border-top:1px solid #edf0f5;padding-top:10px;margin-top:10px}.capacity-row:first-of-type{border-top:none;padding-top:0;margin-top:0}.capacity-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.capacity{display:flex;flex-wrap:wrap;gap:6px}.capacity span{background:#f1f5f9;border-radius:5px;padding:3px 8px;font-size:12px;color:#475569}.capacity span.negative{background:#fff1f2;color:#e11d48}.slot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #edf0f5;font-size:13px;color:#475569}.empty{color:#94a3b8;font-size:13px;padding:8px 0}
@media(max-width:1050px){.metrics,.agency-grid{grid-template-columns:1fr 1fr}.grid-2{grid-template-columns:1fr}}@media(max-width:600px){.metrics,.agency-grid{grid-template-columns:1fr}}
</style>
