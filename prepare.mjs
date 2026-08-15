/**
 * 组合包安装时的 prepare 钩子。bundle 本身没有运行时代码——两个插件子包以
 * npm 版本依赖从 registry 安装（产物已构建），这里只做存在性校验并打印版本，
 * 让 pnpm 的 build-scripts 白名单（allowBuilds）有一个无害的入口。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const root = dirname(fileURLToPath(import.meta.url))
const manifest = require(join(root, 'package.json'))

console.log(`[dsh-pet-plugin] prepare: bundle ${manifest.name}@${manifest.version}`)
for (const name of Object.keys(manifest.dependencies ?? {})) {
  try {
    const dep = require(join(root, 'node_modules', name, 'package.json'))
    console.log(`[dsh-pet-plugin] dependency ${name}@${dep.version}`)
  } catch {
    // 依赖解析不到时交由 pnpm 自身的错误面暴露，prepare 不吞错误
    throw new Error(`[dsh-pet-plugin] dependency ${name} is not installed`)
  }
}
