/**
 * 经 GitHub API 创建远程仓库（沙箱里 pwsh 的 schannel TLS 失败，必须用
 * node fetch）。token 由 PowerShell 从 git credential fill 取来经 GH_TOKEN
 * 环境变量传入，不落盘、不打印。
 */
const token = process.env.GH_TOKEN
if (!token) {
  console.error('缺少 GH_TOKEN')
  process.exit(1)
}

const headers = {
  Authorization: `token ${token}`,
  'User-Agent': 'dsh-pet-plugin-setup',
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
}

// 拿账号信息（login + id，id 用于构造 GitHub noreply 提交邮箱）
const meRes = await fetch('https://api.github.com/user', { headers })
const me = await meRes.json()
if (!meRes.ok) {
  console.error('获取用户信息失败', meRes.status, JSON.stringify(me))
  process.exit(1)
}
console.log('user:', me.login, me.id)

// 创建公开仓库（插件分发目的；不 auto_init，本地已有提交）
const body = {
  name: 'dsh-pet-plugin',
  description:
    'dsh web companion-pet bundle: Codex-style desktop pet for the DeepSeek Harness web GUI (host pet-assets + client pet-ui)',
  private: false,
  auto_init: false,
  has_issues: true,
  has_wiki: false,
}
const res = await fetch('https://api.github.com/user/repos', {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
})
const created = await res.json()
if (!res.ok) {
  console.error('创建仓库失败', res.status, JSON.stringify(created))
  process.exit(1)
}
console.log('created:', created.full_name, created.html_url)
