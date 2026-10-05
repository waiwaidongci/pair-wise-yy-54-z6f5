<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { Message } from '@arco-design/web-vue'
import { useSchemeStore } from './store/scheme'

const route = useRoute()
const router = useRouter()
const store = useSchemeStore()
const nav = [
  { name: 'overview', label: '方案总览' },
  { name: 'map', label: '地图与阶段' },
  { name: 'review', label: '多单位会签' },
]

function requestApproval() {
  if (store.publishReady) Message.success('接点连续且意见全部复签，阶段审批已发起')
  else Message.warning(`暂不可发起：${store.publishBlockers[0]}`)
}
</script>

<template>
  <a-layout class="shell">
    <a-layout-sider :width="224" class="sider">
      <div class="brand"><b>路</b><div><strong>封路协调台</strong><small>ROAD CONTROL</small></div></div>
      <a-menu :selected-keys="[route.name]" class="menu" @menu-item-click="(key: string) => router.push({ name: key })">
        <a-menu-item v-for="item in nav" :key="item.name">{{ item.label }}</a-menu-item>
      </a-menu>
      <div class="project-card"><span></span><div><b>{{ store.scheme.project }}</b><small>草案 v{{ store.scheme.version }} · 道路 v{{ store.scheme.roadVersion }} · 4 家单位会签</small></div></div>
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="topbar">
        <div><b>{{ store.scheme.id }}</b><span>{{ store.scheme.area }} · 2026 年第四季度施工计划</span></div>
        <div class="top-actions"><a-tag :color="store.publishReady ? 'green' : 'orange'">{{ store.publishReady ? '可发布通告' : '待复签 / 待接通' }}</a-tag><a-button :disabled="!store.dirty" @click="store.undo">撤销修改</a-button><a-button type="primary" @click="requestApproval">发起阶段审批</a-button></div>
      </a-layout-header>
      <a-layout-content class="main"><router-view /></a-layout-content>
    </a-layout>
  </a-layout>
</template>
