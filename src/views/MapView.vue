<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import { useSchemeStore } from '../store/scheme'
import { distanceMeters, JUNCTION_TOLERANCE, stageEnd, stageStart, type LngLat } from '../geo'

const store = useSchemeStore()
const mapEl = ref<HTMLDivElement>()
let map: MapLibreMap | undefined
const layers = ref({ closure: true, detour: true, ambulance: true, bus: true, adjacent: true, junction: true })

function addLineSource(id: string, coordinates: LngLat[], color: string, dasharray?: number[]) {
  if (!map?.isStyleLoaded()) return
  if (map.getLayer(id)) { map.removeLayer(id); map.removeSource(id) }
  map.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } })
  map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': color, 'line-width': 5, 'line-opacity': .85, ...(dasharray ? { 'line-dasharray': dasharray } : {}) } })
}

function addJunctionLayer() {
  if (!map?.isStyleLoaded()) return
  const id = 'junctions'
  if (map.getLayer(id)) { map.removeLayer(id); map.removeSource(id) }
  const features = store.scheme.junctions.map((junction) => ({
    type: 'Feature' as const,
    properties: { id: junction.id, status: junction.status, conflict: junction.conflict ? 1 : 0 },
    geometry: { type: 'Point' as const, coordinates: [junction.lng, junction.lat] },
  }))
  map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features } })
  map.addLayer({
    id, type: 'circle', source: id,
    paint: {
      'circle-radius': 8,
      'circle-color': ['match', ['get', 'status'], '连续', '#16a34a', '断点', '#dc2626', '#94a3b8'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })
}

function addDraftLayer() {
  if (!map?.isStyleLoaded()) return
  const id = 'draft'
  if (map.getLayer(id)) { map.removeLayer(id); map.removeSource(id) }
  if (store.draftRoute.length < 2) return
  map.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: store.draftRoute } } })
  map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': '#7c3aed', 'line-width': 4, 'line-dasharray': [2, 2], 'line-opacity': .9 } })
}

function drawAll() {
  if (!map?.isStyleLoaded()) return
  const stage = store.selectedStage
  if (stage) addLineSource('closure', stage.route, '#ef4444')
  store.scheme.detours.forEach((route, index) => addLineSource(`detour-${index}`, route.coordinates, '#2563eb', [2, 2]))
  addLineSource('ambulance', [[121.476,31.216],[121.478,31.228],[121.496,31.235]], '#16a34a')
  addLineSource('bus', [[121.466,31.220],[121.480,31.229],[121.502,31.238]], '#d97706', [1, 1])
  addLineSource('adjacent', [[121.502,31.244],[121.514,31.236],[121.524,31.228]], '#7c3aed')
  addJunctionLayer()
  addDraftLayer()
}

function toggleLayer(id: string, visible: boolean) { if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none') }
function fit() { const bounds = new maplibregl.LngLatBounds(); store.scheme.stages.flatMap((stage) => stage.route).forEach((point) => bounds.extend(point)); map?.fitBounds(bounds, { padding: 60 }) }

/** 绘制中实时校验：草稿端点与相邻阶段是否顺接 */
const draftBreakpoints = ref<{ junctionId: string; distance: number }[]>([])
function refreshDraftBreakpoints() {
  draftBreakpoints.value = []
  const stage = store.selectedStage
  if (!stage || store.draftRoute.length < 2) return
  for (const junction of store.scheme.junctions) {
    if (junction.upstreamStageId !== stage.id && junction.downstreamStageId !== stage.id) continue
    const partnerId = junction.upstreamStageId === stage.id ? junction.downstreamStageId : junction.upstreamStageId
    const partner = store.scheme.stages.find((item) => item.id === partnerId)
    if (!partner) continue
    const newPoint = junction.upstreamStageId === stage.id ? stageEnd(store.draftRoute) : stageStart(store.draftRoute)
    const partnerPoint = junction.upstreamStageId === stage.id ? stageStart(partner.route) : stageEnd(partner.route)
    const dist = distanceMeters(newPoint, partnerPoint)
    if (dist > JUNCTION_TOLERANCE) draftBreakpoints.value.push({ junctionId: junction.id, distance: Math.round(dist) })
  }
}

function finishDraw() {
  const ok = store.finishDraw()
  if (ok) { draftBreakpoints.value = []; drawAll() }
  else refreshDraftBreakpoints()
}

onMounted(async () => {
  await nextTick()
  map = new maplibregl.Map({
    container: mapEl.value!,
    style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
    center: [121.488, 31.23], zoom: 13,
  })
  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.on('load', drawAll)
  map.on('click', (event) => { if (store.drawing) { store.addPoint([event.lngLat.lng, event.lngLat.lat]); refreshDraftBreakpoints() } })
})
onBeforeUnmount(() => map?.remove())
watch(() => store.selectedStageId, () => { if (!map) return; const stage = store.selectedStage; if (stage) { map.flyTo({ center: stage.route[0], zoom: 14 }); drawAll() } })
watch(() => store.scheme.version, () => { if (map) drawAll() })
watch(() => store.draftRoute, () => { if (map) addDraftLayer() }, { deep: true })
watch(layers, () => {
  if (!map) return
  toggleLayer('closure', layers.value.closure)
  store.scheme.detours.forEach((_, index) => toggleLayer(`detour-${index}`, layers.value.detour))
  toggleLayer('ambulance', layers.value.ambulance)
  toggleLayer('bus', layers.value.bus)
  toggleLayer('adjacent', layers.value.adjacent)
  toggleLayer('junctions', layers.value.junction)
}, { deep: true })
</script>

<template>
  <section class="page-head compact"><div><p class="eyebrow">几何与时间联动 · 接点连续</p><h1>封路范围与阶段地图</h1><p>选择阶段后在地图上点击绘制路线；改线后与相邻阶段端点顺接才可提交，断点拒绝更新。</p></div><a-space><a-button @click="store.startDraw" :status="store.drawing ? 'danger' : undefined">{{ store.drawing ? `绘制中 · 已点 ${store.draftRoute.length} 个` : '绘制封路路线' }}</a-button><a-button :disabled="!store.drawing" type="primary" @click="finishDraw">完成绘制</a-button><a-button @click="fit">定位全段</a-button></a-space></section>

  <a-alert v-if="store.lastRejection" type="error" :title="store.lastRejection.reason" class="mb16">
    <template #content>{{ store.lastRejection.detail }}<span v-if="store.lastRejection.breakpoints">（{{ store.lastRejection.breakpoints.map((b) => `${b.junctionId} 相差 ${b.distance} 米`).join('；') }}）</span></template>
  </a-alert>
  <a-alert v-if="store.lastNotice" type="success" :title="store.lastNotice" class="mb16" closable @close="store.lastNotice = null" />
  <a-alert v-if="draftBreakpoints.length" type="warning" class="mb16" title="草稿存在断点">
    <template #content>{{ draftBreakpoints.map((b) => `${b.junctionId} 相差 ${b.distance} 米（容差 ${JUNCTION_TOLERANCE} 米）`).join('；') }}，请顺接相邻阶段后再完成绘制。</template>
  </a-alert>

  <div class="toolbar card"><a-radio-group v-model="store.selectedStageId" type="button"><a-radio v-for="stage in store.scheme.stages" :key="stage.id" :value="stage.id">{{ stage.id }}</a-radio></a-radio-group><span class="spacer"></span><a-checkbox v-model="layers.closure">封路</a-checkbox><a-checkbox v-model="layers.detour">绕行</a-checkbox><a-checkbox v-model="layers.ambulance">救护通道</a-checkbox><a-checkbox v-model="layers.bus">公交</a-checkbox><a-checkbox v-model="layers.adjacent">相邻工程</a-checkbox><a-checkbox v-model="layers.junction">接点</a-checkbox></div>
  <div class="map-grid">
    <div ref="mapEl" class="map"></div>
    <aside class="card inspector">
      <div class="panel-head"><div><h2>{{ store.selectedStage?.name }}</h2><p>{{ store.selectedStage?.start }} → {{ store.selectedStage?.end }}</p></div><a-tag :color="store.selectedStage?.status === '退回' ? 'red' : 'orange'">{{ store.selectedStage?.status }}</a-tag></div>
      <a-form layout="vertical" :model="store.selectedStage || {}">
        <a-form-item label="车道占用"><a-input :model-value="store.selectedStage?.lanes" @change="(value: string) => store.updateStage({ lanes: value })" /></a-form-item>
        <a-form-item label="阶段名称"><a-input :model-value="store.selectedStage?.name" @change="(value: string) => store.updateStage({ name: value })" /></a-form-item>
        <div class="two"><a-form-item label="开始"><a-date-picker :model-value="store.selectedStage?.start" @change="(value: any) => store.updateStage({ start: value })" /></a-form-item><a-form-item label="结束"><a-date-picker :model-value="store.selectedStage?.end" @change="(value: any) => store.updateStage({ end: value })" /></a-form-item></div>
      </a-form>
      <h3>车道容量（急救、公交先占）</h3>
      <div class="capacity-grid">
        <label>总车道<input type="number" :value="store.selectedStage?.capacity.total" min="0" @change="(e) => store.selectedStage && store.updateCapacity(store.selectedStage.id, { total: Number((e.target as HTMLInputElement).value) })" /></label>
        <label>急救<input type="number" :value="store.selectedStage?.capacity.emergency" min="0" @change="(e) => store.selectedStage && store.updateCapacity(store.selectedStage.id, { emergency: Number((e.target as HTMLInputElement).value) })" /></label>
        <label>公交<input type="number" :value="store.selectedStage?.capacity.bus" min="0" @change="(e) => store.selectedStage && store.updateCapacity(store.selectedStage.id, { bus: Number((e.target as HTMLInputElement).value) })" /></label>
        <div class="capacity-remain">余量 {{ store.selectedStage ? Math.max(0, store.selectedStage.capacity.total - store.selectedStage.capacity.emergency - store.selectedStage.capacity.bus) : 0 }}</div>
      </div>
      <h3>绕行比较</h3>
      <div v-for="route in store.scheme.detours" :key="route.id" class="detour"><div><b>{{ route.name }}</b><small>{{ route.distance }} km · 增加 {{ route.extraMinutes }} 分钟 · 需 {{ route.requiredLanes }} 车道</small></div><a-tag :color="store.detourStatus(route.id) === '保通' ? 'green' : 'orange'">{{ store.detourStatus(route.id) }}</a-tag></div>
      <a-divider />
      <h3>路段冲突</h3>
      <div v-for="item in store.conflicts.filter((conflict) => conflict.segmentId === store.selectedStageId)" :key="item.id" class="issue" :class="item.level === '高' ? 'red' : 'amber'"><b>{{ item.title }}</b><p>{{ item.detail }}</p></div>
    </aside>
  </div>
</template>

<style scoped>
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px;margin-bottom:14px}.spacer{flex:1}.map-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(330px,.65fr);gap:16px}.map{height:min(68vh,680px);min-height:420px;border-radius:8px;overflow:hidden}.inspector{height:fit-content}.panel-head{display:flex;justify-content:space-between}.panel-head h2{font-size:18px;margin:0 0 5px}.panel-head p{color:#7a8798;font-size:12px;margin:0}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.inspector h3{font-size:14px;margin:18px 0 10px}.detour{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5}.detour b,.detour small{display:block}.detour small{color:#7a8798;margin-top:4px}.issue{padding:10px;border-radius:6px;margin-bottom:8px}.issue.red{background:#fff1f2}.issue.amber{background:#fff7ed}.issue p{margin:4px 0 0;color:#64748b;font-size:13px}
.capacity-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.capacity-grid label{display:flex;flex-direction:column;font-size:12px;color:#7a8798;gap:4px}.capacity-grid input{border:1px solid #e1e7ef;border-radius:5px;padding:6px 8px;font-size:14px}.capacity-remain{grid-column:1/-1;background:#eff6ff;color:#2563eb;border-radius:5px;padding:7px 10px;font-size:13px;font-weight:600}
@media(max-width:1050px){.map-grid{grid-template-columns:1fr}.map{height:55vh}}
</style>
