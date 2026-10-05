<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl, { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { Message } from '@arco-design/web-vue'
import { useSchemeStore, fmtPoint } from '../store/scheme'

const store = useSchemeStore()
const mapEl = ref<HTMLDivElement>()
let map: MapLibreMap | undefined
const layers = ref({ closure: true, detour: true, ambulance: true, bus: true, adjacent: true })
let dragJunction: string | null = null
let suppressClick = false

const stageJunctions = computed(() => store.junctionsOf(store.selectedStageId))
const stageCapacity = computed(() => store.capacityRows.find((row) => row.stageId === store.selectedStageId))
const brokenIds = computed(() => new Set(store.brokenJunctions.map((junction) => junction.id)))

function junctionData(overrideId?: string, overridePoint?: [number, number]) {
  return {
    type: 'FeatureCollection',
    features: store.scheme.junctions.map((junction) => ({
      type: 'Feature',
      properties: { id: junction.id, name: junction.name, broken: brokenIds.value.has(junction.id) },
      geometry: { type: 'Point', coordinates: junction.id === overrideId && overridePoint ? overridePoint : junction.point },
    })),
  } as FeatureCollection
}

function addGeoSource(id: string, coordinates: [number, number][], color: string, dasharray?: number[]) {
  if (!map?.isStyleLoaded()) return
  if (map.getLayer(id)) { map.removeLayer(id); map.removeSource(id) }
  map.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } })
  map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': color, 'line-width': 5, 'line-opacity': .85, ...(dasharray ? { 'line-dasharray': dasharray } : {}) } })
}

function drawJunctions() {
  if (!map?.isStyleLoaded()) return
  const source = map.getSource('junctions') as maplibregl.GeoJSONSource | undefined
  if (source) { source.setData(junctionData()); return }
  map.addSource('junctions', { type: 'geojson', data: junctionData() })
  map.addLayer({ id: 'junctions', type: 'circle', source: 'junctions', paint: { 'circle-radius': 8, 'circle-color': ['case', ['get', 'broken'], '#e11d48', '#0ea5e9'], 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' } })
  map.addLayer({ id: 'junctions-label', type: 'symbol', source: 'junctions', layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top' }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } })
}

function drawDraft() {
  if (!map?.isStyleLoaded()) return
  const coords = store.draftRoute
  const data = { type: 'FeatureCollection', features: coords.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [] } as FeatureCollection
  const source = map.getSource('draft') as maplibregl.GeoJSONSource | undefined
  if (source) { source.setData(data); return }
  map.addSource('draft', { type: 'geojson', data })
  map.addLayer({ id: 'draft', type: 'line', source: 'draft', paint: { 'line-color': '#f59e0b', 'line-width': 4, 'line-dasharray': [2, 1] } })
}

function drawAll() {
  if (!map?.isStyleLoaded()) return
  const stage = store.selectedStage
  if (stage) addGeoSource('closure', stage.route, '#ef4444')
  store.scheme.detours.forEach((route, index) => addGeoSource(`detour-${index}`, route.coordinates, '#2563eb', [2, 2]))
  addGeoSource('ambulance', [[121.476, 31.216], [121.478, 31.228], [121.496, 31.235]], '#16a34a')
  addGeoSource('bus', [[121.466, 31.220], [121.480, 31.229], [121.502, 31.238]], '#d97706', [1, 1])
  addGeoSource('adjacent', [[121.502, 31.244], [121.514, 31.236], [121.524, 31.228]], '#7c3aed')
  drawJunctions()
  if (map.getLayer('junctions')) { map.moveLayer('junctions'); map.moveLayer('junctions-label') }
  drawDraft()
}

function toggleLayer(id: string, visible: boolean) { if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none') }
function fit() { const bounds = new maplibregl.LngLatBounds(); store.scheme.stages.flatMap((stage) => stage.route).forEach((point) => bounds.extend(point)); map?.fitBounds(bounds, { padding: 60 }) }

function completeDraw() {
  const result = store.finishDraw()
  if (result.ok) Message.success('封路折线已更新，道路版本已递增')
  else if (result.reason) Message.error(result.reason)
}

function runSurveyReturn() {
  const report = store.simulateSurveyReturn()
  if (report.conflicts.length) Message.warning(`回传合并完成：${report.applied.length} 处采用现场值，${report.conflicts.length} 处冲突待处理`)
  else Message.success(`回传合并完成：${report.applied.length} 处更新，${report.unchanged.length} 处一致`)
}

function junctionName(id: string) { return store.scheme.junctions.find((junction) => junction.id === id)?.name ?? id }

function onJunctionDown(event: MapMouseEvent) {
  const features = map?.queryRenderedFeatures(event.point, { layers: ['junctions'] })
  if (!features?.length) return
  event.preventDefault()
  dragJunction = features[0].properties?.id ?? null
  map?.dragPan.disable()
  if (map) map.getCanvas().style.cursor = 'grabbing'
}
function onMouseMove(event: MapMouseEvent) {
  if (!dragJunction || !map) return
  const source = map.getSource('junctions') as maplibregl.GeoJSONSource | undefined
  source?.setData(junctionData(dragJunction, [event.lngLat.lng, event.lngLat.lat]))
}
function onMouseUp(event: MapMouseEvent) {
  if (!dragJunction) return
  const id = dragJunction
  dragJunction = null
  map?.dragPan.enable()
  if (map) map.getCanvas().style.cursor = ''
  suppressClick = true
  setTimeout(() => { suppressClick = false }, 0)
  store.moveJunction(id, [event.lngLat.lng, event.lngLat.lat])
}

onMounted(async () => {
  await nextTick()
  map = new maplibregl.Map({
    container: mapEl.value!,
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
    center: [121.488, 31.23], zoom: 13,
  })
  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.on('load', drawAll)
  map.on('click', (event) => { if (!suppressClick) store.addPoint([event.lngLat.lng, event.lngLat.lat]) })
  map.on('mousedown', 'junctions', onJunctionDown)
  map.on('mousemove', onMouseMove)
  map.on('mouseup', onMouseUp)
  map.on('mouseenter', 'junctions', () => { if (map) map.getCanvas().style.cursor = 'grab' })
  map.on('mouseleave', 'junctions', () => { if (map && !dragJunction) map.getCanvas().style.cursor = '' })
})
onBeforeUnmount(() => map?.remove())
watch(() => store.selectedStageId, () => { const stage = store.selectedStage; if (map && stage) { map.flyTo({ center: stage.route[0], zoom: 14 }); drawAll() } })
watch(() => store.scheme.roadVersion, drawAll)
watch(() => store.draftRoute, drawDraft, { deep: true })
watch(layers, () => {
  if (!map) return
  toggleLayer('closure', layers.value.closure)
  store.scheme.detours.forEach((_, index) => toggleLayer(`detour-${index}`, layers.value.detour))
  toggleLayer('ambulance', layers.value.ambulance)
  toggleLayer('bus', layers.value.bus)
  toggleLayer('adjacent', layers.value.adjacent)
}, { deep: true })
</script>

<template>
  <section class="page-head compact"><div><p class="eyebrow">几何与时间联动 · 道路 v{{ store.scheme.roadVersion }}</p><h1>封路范围与阶段地图</h1><p>阶段、导改与单位意见绑定同一道路版本；拖动接点会同步共用阶段并触发意见复签，断开接点的更新会被拒绝。</p></div><a-space><a-button @click="store.startDraw" :status="store.drawing ? 'danger' : undefined">{{ store.drawing ? `绘制中 · 已点 ${store.draftRoute.length} 个` : '绘制封路路线' }}</a-button><a-button :disabled="!store.drawing" type="primary" @click="completeDraw">完成绘制</a-button><a-button @click="fit">定位全段</a-button></a-space></section>
  <div class="toolbar card"><a-radio-group v-model="store.selectedStageId" type="button"><a-radio v-for="stage in store.scheme.stages" :key="stage.id" :value="stage.id">{{ stage.id }}</a-radio></a-radio-group><span class="spacer"></span><a-checkbox v-model="layers.closure">封路</a-checkbox><a-checkbox v-model="layers.detour">绕行</a-checkbox><a-checkbox v-model="layers.ambulance">救护通道</a-checkbox><a-checkbox v-model="layers.bus">公交</a-checkbox><a-checkbox v-model="layers.adjacent">相邻工程</a-checkbox></div>
  <div class="map-grid">
    <div ref="mapEl" class="map"></div>
    <aside class="card inspector">
      <div class="panel-head"><div><h2>{{ store.selectedStage?.name }}</h2><p>{{ store.selectedStage?.start }} → {{ store.selectedStage?.end }}</p></div><a-tag :color="store.selectedStage?.status === '退回' ? 'red' : 'orange'">{{ store.selectedStage?.status }}</a-tag></div>
      <a-form layout="vertical" :model="store.selectedStage || {}">
        <a-form-item label="车道占用"><a-input :model-value="store.selectedStage?.lanes" @change="(value: string) => store.updateStage({ lanes: value })" /></a-form-item>
        <a-form-item label="阶段名称"><a-input :model-value="store.selectedStage?.name" @change="(value: string) => store.updateStage({ name: value })" /></a-form-item>
        <div class="two"><a-form-item label="开始"><a-date-picker :model-value="store.selectedStage?.start" @change="(value: any) => store.updateStage({ start: value })" /></a-form-item><a-form-item label="结束"><a-date-picker :model-value="store.selectedStage?.end" @change="(value: any) => store.updateStage({ end: value })" /></a-form-item></div>
      </a-form>
      <h3>阶段接点</h3>
      <div v-for="junction in stageJunctions" :key="junction.id" class="junction-row">
        <div><b>{{ junction.name }}</b><small>{{ fmtPoint(junction.point) }} · 共用 {{ junction.stageIds.join('、') }}</small></div>
        <a-tag :color="brokenIds.has(junction.id) ? 'red' : 'green'">{{ brokenIds.has(junction.id) ? '断点' : '连续' }}</a-tag>
      </div>
      <h3>绕行比较</h3>
      <div v-for="route in store.scheme.detours" :key="route.id" class="detour"><div><b>{{ route.name }}</b><small>{{ route.distance }} km · 增加 {{ route.extraMinutes }} 分钟 · 需求 {{ route.demand }} 辆/时 · 道路 v{{ route.roadVersion }}</small></div><a-tag :color="route.extraMinutes > 10 ? 'orange' : 'green'">{{ route.extraMinutes > 10 ? '关注' : '可用' }}</a-tag></div>
      <template v-if="stageCapacity">
        <h3>车道容量分配</h3>
        <div class="capacity"><span>通行能力 {{ stageCapacity.capacity }}</span><span>急救 {{ stageCapacity.ambulance }}</span><span>公交保底 {{ stageCapacity.busMin }}</span><span :class="{ negative: stageCapacity.remaining < 0 }">余量 {{ stageCapacity.remaining }}</span></div>
        <div v-for="slot in stageCapacity.detours" :key="slot.id" class="detour"><div><b>{{ slot.name }}</b><small>需求 {{ slot.demand }} 辆/时</small></div><a-tag :color="slot.state === '已排入' ? 'green' : 'orange'">{{ slot.state === '已排入' ? '已排入' : `排队第 ${slot.queue} 位` }}</a-tag></div>
      </template>
      <a-divider />
      <h3>路段冲突</h3>
      <div v-for="item in store.conflicts.filter((conflict) => conflict.segmentId === store.selectedStageId)" :key="item.id" class="issue" :class="item.level === '高' ? 'red' : 'amber'"><b>{{ item.title }}</b><p>{{ item.detail }}</p></div>
    </aside>
  </div>
  <div class="bottom-grid">
    <article class="card">
      <div class="panel-head"><div><h2>接点连续性</h2><p>拖动地图接点可整体改移，共用阶段同步更新</p></div><a-tag :color="store.continuous ? 'green' : 'red'">{{ store.continuous ? '全部连续' : `${store.brokenJunctions.length} 处断点` }}</a-tag></div>
      <div v-for="junction in store.scheme.junctions" :key="junction.id" class="junction-row">
        <div><b>{{ junction.id }} · {{ junction.name }}</b><small>{{ fmtPoint(junction.point) }} · {{ junction.stageIds.join('、') }}</small></div>
        <a-tag :color="brokenIds.has(junction.id) ? 'red' : 'green'">{{ brokenIds.has(junction.id) ? '断点' : '连续' }}</a-tag>
      </div>
    </article>
    <article class="card">
      <div class="panel-head"><div><h2>车道容量分配</h2><p>急救通道与公交保底班次先占容量，余量不够的导改线路排队</p></div></div>
      <div v-for="row in store.capacityRows" :key="row.stageId" class="capacity-block">
        <div class="capacity-head"><b>{{ row.stageId }}</b><div class="capacity"><span>能力 {{ row.capacity }}</span><span>急救 {{ row.ambulance }}</span><span>公交 {{ row.busMin }}</span><span :class="{ negative: row.remaining < 0 }">余量 {{ row.remaining }}</span></div></div>
        <div v-if="!row.detours.length" class="empty">无导改线路</div>
        <div v-for="slot in row.detours" :key="slot.id" class="detour"><div><b>{{ slot.name }}</b><small>需求 {{ slot.demand }} 辆/时</small></div><a-tag :color="slot.state === '已排入' ? 'green' : 'orange'">{{ slot.state === '已排入' ? '已排入' : `排队第 ${slot.queue} 位` }}</a-tag></div>
      </div>
    </article>
    <article class="card">
      <div class="panel-head"><div><h2>离线测量回传</h2><p>按阶段编号合并；双方同改一个接点时保存现场坐标和旧值</p></div><a-button size="small" type="primary" @click="runSurveyReturn">模拟回传</a-button></div>
      <div v-if="store.lastMerge" class="merge">
        <p><b>{{ store.lastMerge.surveyor }}</b> · {{ store.lastMerge.time }}</p>
        <p v-if="store.lastMerge.applied.length">采用现场值：{{ store.lastMerge.applied.join('、') }}</p>
        <p v-if="store.lastMerge.conflicts.length" class="warn">冲突待处理：{{ store.lastMerge.conflicts.join('、') }}</p>
        <p v-if="store.lastMerge.unchanged.length">一致未动：{{ store.lastMerge.unchanged.join('、') }}</p>
      </div>
      <div v-if="!store.scheme.junctionConflicts.length" class="empty">暂无回传冲突</div>
      <div v-for="conflict in store.scheme.junctionConflicts" :key="conflict.id" class="conflict-row">
        <div class="conflict-head"><b>{{ conflict.id }} · {{ junctionName(conflict.junctionId) }}</b><a-tag :color="conflict.status === '待处理' ? 'orange' : 'green'">{{ conflict.status }}</a-tag></div>
        <small>{{ conflict.source }} · {{ conflict.time }}</small>
        <div class="points"><span>现场 {{ fmtPoint(conflict.fieldPoint) }}</span><span>旧值 {{ fmtPoint(conflict.previousPoint) }}</span></div>
        <a-space v-if="conflict.status === '待处理'"><a-button size="mini" type="primary" @click="store.resolveJunctionConflict(conflict.id, true)">采用现场值</a-button><a-button size="mini" @click="store.resolveJunctionConflict(conflict.id, false)">保留原值</a-button></a-space>
      </div>
    </article>
  </div>
</template>

<style scoped>
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px;margin-bottom:14px}.spacer{flex:1}.map-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(330px,.65fr);gap:16px}.map{height:min(68vh,680px);min-height:420px;border-radius:8px;overflow:hidden}.inspector{height:fit-content}.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.panel-head h2{font-size:18px;margin:0 0 5px}.panel-head p{color:#7a8798;font-size:12px;margin:0}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.inspector h3{font-size:14px;margin:18px 0 10px}.detour{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5}.detour b,.detour small{display:block}.detour small{color:#7a8798;margin-top:4px}.issue{padding:10px;border-radius:6px;margin-bottom:8px}.issue.red{background:#fff1f2}.issue.amber{background:#fff7ed}.issue p{margin:4px 0 0;color:#64748b;font-size:13px}
.junction-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #edf0f5}.junction-row b,.junction-row small{display:block}.junction-row small{color:#7a8798;margin-top:3px}
.capacity{display:flex;flex-wrap:wrap;gap:6px}.capacity span{background:#f1f5f9;border-radius:5px;padding:3px 8px;font-size:12px;color:#475569}.capacity span.negative{background:#fff1f2;color:#e11d48}
.bottom-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:16px}.capacity-block{border-top:1px solid #edf0f5;padding-top:10px;margin-top:10px}.capacity-block:first-of-type{border-top:none;padding-top:0;margin-top:0}.capacity-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.empty{color:#94a3b8;font-size:13px;padding:8px 0}
.merge{background:#f8fafc;border-radius:6px;padding:10px;margin-bottom:10px}.merge p{margin:4px 0;font-size:13px;color:#475569}.merge .warn{color:#d97706}
.conflict-row{border:1px solid #fde68a;background:#fffbeb;border-radius:6px;padding:10px;margin-bottom:8px}.conflict-head{display:flex;justify-content:space-between;align-items:center}.conflict-row>small{display:block;color:#7a8798;margin:4px 0}.points{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px}.points span{font-size:12px;background:#fff;border:1px solid #fde68a;border-radius:5px;padding:3px 8px}
@media(max-width:1200px){.bottom-grid{grid-template-columns:1fr}}@media(max-width:1050px){.map-grid{grid-template-columns:1fr}.map{height:55vh}}
</style>
