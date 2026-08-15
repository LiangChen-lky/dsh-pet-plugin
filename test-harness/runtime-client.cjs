/**
 * vitest 别名包装：把 @deepseek-ai/dsh-client-runtime/client 的解析从
 * ModuleLoader bundle 指向模块表。vite 对 `module.exports = <表达式>` 的
 * CommonJS interop 会让命名导入从默认导出对象取属性，因此一个赋值即可
 * 转发 runtime 的全部导出（无需枚举导出名）。
 */
'use strict'
module.exports = globalThis.__ModuleLoader__.get('@deepseek-ai/dsh-client-runtime')
