/**
 * host-pet-assets 的 tsdown 配置：node 半区产物。tsc 先把 src 编译到
 * lib/types（类型 + JS），tsdown 再从 lib/types 把入口收拢到 lib/ 根，
 * 产物与 package.json 的 files/exports 声明一一对应。
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  name: '@kkkey/dsh-pet-assets',
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
