// 引入 Vue 框架的核心函数
import { createApp } from 'vue';
// 引入 Pinia，用于状态管理（管理全局共享数据）
import { createPinia } from 'pinia';
// 引入 Vue Router，用于管理页面路由
import { createRouter, createWebHistory } from 'vue-router';
// 引入根组件（App.vue），应用的顶层组件
import App from './App.vue';
// 引入全局样式文件
import './assets/main.css';
// 引入 axios，全局配置一次
import axios from 'axios';

// ===== 全局 axios 配置（只注册一次） =====
const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
axios.defaults.baseURL = API_URL;
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 路由守卫：检查是否登录
function requireAuth(to: any, _from: any, next: any) {
  const token = localStorage.getItem('token');
  if (!token && to.path !== '/auth') {
    next('/auth');
  } else {
    next();
  }
}

// 创建路由实例
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/auth',
      name: 'auth',
      component: () => import('./views/AuthView.vue'),
    },
    {
      path: '/promo',
      name: 'promo',
      component: () => import('./views/LandingPromo.vue'),
    },
    {
      path: '/',
      name: 'home',
      component: () => import('./views/HomeView.vue'),
      beforeEnter: requireAuth,
    },
    {
      path: '/document/:id',
      redirect: '/editor/:id',
    },
    {
      path: '/stats',
      name: 'stats',
      component: () => import('./views/StatsView.vue'),
      beforeEnter: requireAuth,
    },
    {
      path: '/editor/:id',
      name: 'editor',
      component: () => import('./views/BookEditorView.vue'),
      beforeEnter: requireAuth,
    },
  ],
});

// 创建 Vue 应用实例
const app = createApp(App);

// 安装 Pinia 状态管理
app.use(createPinia());

// 安装路由
app.use(router);

// 挂载应用
app.mount('#app');
