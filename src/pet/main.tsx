import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app'
import './main.css'

const root = document.getElementById('root') as HTMLElement
root.className = 'h-full w-full'

// 禁用桌宠窗口右键菜单：桌宠窗口是装饰性的透明置顶小窗，右键不应弹出
// WebView 默认 context menu（Chromium/WebView2 尊重 contextmenu 的 preventDefault）。
window.addEventListener('contextmenu', event => event.preventDefault(), { capture: true })

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
