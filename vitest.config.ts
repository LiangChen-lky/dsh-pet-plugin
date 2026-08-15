import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const emptyCss = fileURLToPath(new URL('./test-harness/empty-css.cjs', import.meta.url))

/** 把任何 .css import（如 katex 的 katex.min.css）解析为空模块。 */
const cssStub: Plugin = {
  name: 'dsh-pet-test:css-stub',
  enforce: 'pre',
  resolveId(source) {
    if (/\.css(\?|$)/.test(source)) return emptyCss
    return null
  },
}

const alias = [
  // 浏览器半区 bundle 在 vitest 里经模块表提供：把解析引到 .cjs 包装
  //（module.exports = __ModuleLoader__.get(id)），vite 的 CJS interop
  // 让命名导入从该对象取属性。
  {
    find: /^@deepseek-ai\/dsh-client-runtime\/client$/,
    replacement: fileURLToPath(new URL('./test-harness/runtime-client.cjs', import.meta.url)),
  },
  {
    find: /^@deepseek-ai\/dsh-client-locale\/client$/,
    replacement: fileURLToPath(new URL('./test-harness/locale-client.cjs', import.meta.url)),
  },
]

export default defineConfig({
  test: {
    // 官方同款结构：client 测试默认 node（无 pragma 的 browser-plugin/activity
    // 与官方一致在 node 跑，locale 的 detectBrowserLocale 因此回退默认 zh）；
    // 带 // @vitest-environment jsdom pragma 的文件自动切 jsdom。
    // host 测试同样 node。
    projects: [
      {
        plugins: [cssStub],
        resolve: { alias },
        test: {
          name: 'client',
          environment: 'node',
          include: ['packages/client-pet-ui/tests/**/*.spec.{ts,tsx}'],
          setupFiles: ['./vitest.setup.ts'],
          server: {
            deps: {
              // test-runtime 依赖链里的浏览器包必须走 vite 转译而不是 Node 原生加载
              inline: [/@deepseek-ai\//, /katex/],
            },
          },
        },
      },
      {
        plugins: [cssStub],
        resolve: { alias },
        test: {
          name: 'host',
          environment: 'node',
          include: ['packages/host-pet-assets/tests/**/*.spec.ts'],
          setupFiles: ['./vitest.setup.ts'],
          server: {
            deps: {
              // setup 统一预加载平台模块（含 ui-slots 的 vite 转译链），
              // 必须与 client project 一样内联，否则 Node 原生加载撞上 katex 的 .css
              inline: [/@deepseek-ai\//, /katex/],
            },
          },
        },
      },
    ],
  },
})
