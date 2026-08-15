/**
 * vitest 环境的 dsh web 加载器替身。
 *
 * 官方仓库里 client 插件测试走 tsconfig paths 直连源码，没有这个问题；独立
 * 仓库的 @deepseek-ai/dsh-client-* 依赖是 npm 发布的浏览器 bundle 产物
 * （ModuleLoader closure-factory：顶层 `window.__ModuleLoader__.load({id,
 * factory})`，factory 末尾 `return module.exports`）。测试环境必须提供与
 * dsh web 加载器相同的最小契约：执行 factory、把导出按 id 存入模块表、
 * require 从模块表或真实 node 模块解析平台依赖（react/cordis 等）。
 *
 * host 测试跑在 node 环境（无 window），不需要加载器；jsdom 环境（client
 * 测试）才预加载：平台模块经 vite 转译链载入模块表（css 由 vite 处理），
 * runtime/locale 的浏览器 bundle 由 Node require 执行（其 factory 的
 * require 全部命中模块表，不再走 Node ESM 链，从而避开 katex 的 .css）。
 */
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

// vitest 以仓库根为 cwd；不依赖 import.meta.url（转译后可能是虚拟 id）
const root = resolve(process.cwd())
// pnpm 布局下 @deepseek-ai/* 装在子包 node_modules，各自用对应的 require 上下文解析
const clientRequire = createRequire(join(root, 'packages/client-pet-ui/package.json'))
const localeRequire = createRequire(
  join(root, 'packages/client-pet-ui/node_modules/@deepseek-ai/dsh-client-locale/package.json'),
)
const requireContexts = [clientRequire, localeRequire]

const table = new Map<string, unknown>()

function resolveSpec(spec: string): unknown {
  if (table.has(spec)) return table.get(spec)
  // bundle 之间互相引用用完整 exports 子路径（如 runtime/client），但注册
  // key 是 bundle 名（@deepseek-ai/dsh-client-runtime）——去掉 /client 回退。
  // 不能走下面的 node require：bundle 顶层是 `window.__ModuleLoader__.load(...)`
  // 表达式（没有 module.exports 赋值），Node require 只会得到空对象。
  const base = spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
  if (table.has(base)) return table.get(base)
  for (const req of requireContexts) {
    try {
      const loaded = req(spec)
      table.set(spec, loaded)
      return loaded
    } catch {
      // 尝试下一个解析上下文
    }
  }
  throw new Error(`[vitest.setup] 无法解析平台模块 ${spec}`)
}

interface LoadRequest {
  id: string
  factory: (require: (spec: string) => unknown) => unknown
}

const loader = {
  load({ id, factory }: LoadRequest): unknown {
    const exports = factory((spec: string) => {
      if (spec === id) return table.get(id)
      return resolveSpec(spec)
    })
    table.set(id, exports)
    return exports
  },
  get(id: string): unknown {
    return table.get(id)
  },
}

// jsdom 的 window === globalThis；node 环境（host 测试）直接挂 globalThis，
// bundle 的 window.__ModuleLoader__ 引用在 jsdom 下同样命中。
;(globalThis as unknown as { __ModuleLoader__: typeof loader }).__ModuleLoader__ = loader

// node 环境（无 pragma 的 .ts 测试，如 browser-plugin）也走同一加载链：补一个
// window 引用，让浏览器 bundle 顶层的 `window.__ModuleLoader__` 可解析。
// jsdom 环境已有 window（=== globalThis），不覆盖。
if (typeof window === 'undefined') {
  ;(globalThis as { window?: unknown }).window = globalThis
}

// 预加载平台模块与浏览器 bundle。jsdom 测试与 node 测试共用同一张模块表。
// 平台模块用真实路径导入（setup 从仓库根解析不到子包依赖），走 vite 转译链
//（css 由 css-stub 插件处理）。
table.set('@deepseek-ai/cordis', await import(clientRequire.resolve('@deepseek-ai/cordis')))
table.set('@deepseek-ai/dsh-client-ui-slots', await import(clientRequire.resolve('@deepseek-ai/dsh-client-ui-slots')))
table.set('@deepseek-ai/dsh-client-ui-primitives', await import(localeRequire.resolve('@deepseek-ai/dsh-client-ui-primitives')))
// 浏览器半区 bundle（CJS）：Node require 执行其顶层 load 注册进模块表；
// factory 内的平台模块 require 全部命中上面的模块表（含 /client 回退），
// 不会碰 Node ESM 链
clientRequire(clientRequire.resolve('@deepseek-ai/dsh-client-runtime/client'))
clientRequire(clientRequire.resolve('@deepseek-ai/dsh-client-locale/client'))
