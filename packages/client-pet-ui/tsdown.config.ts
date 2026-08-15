/**
 * client-pet-ui 的 tsdown 配置：node 半区 lib（tsc 产物收拢）+ 浏览器半区
 * client bundle。clientBundle 预设产出 ModuleLoader closure-factory 产物，
 * 平台模块（react/cordis/运行时注入等）按模块表 external，运行时由 dsh web
 * 的加载器提供。
 */
import { clientBundle } from '../../tsdown.client.ts'

export default clientBundle('@kkkey/dsh-client-pet-ui', ['lib/types/index.js', 'lib/types/invariant.js'])
