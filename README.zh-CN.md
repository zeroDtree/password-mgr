# password-mgr (pm)

[English](README.md) · [简体中文](README.zh-CN.md)

一个本地密码管理器：用一个**主密码**加密全部密码与 API Key，保存为**单个加密文件**。
提供命令行（CLI）和本地网页（Web UI）两种界面，基于 [Cordis](https://github.com/cordiverse/cordis) 框架构建。
CLI、Web UI 与本文档均提供**中文 / English 双语**（见[界面语言](#界面语言)）。

```
主密码 ──scrypt──▶ KEK ──AES-GCM 解封──▶ DEK ──AES-GCM 解密──▶ 条目数据
                        （封装密钥）              （数据密钥）
```

## 特性

- 🔐 **单文件加密存储**：AES-256-GCM 认证加密，主密码经 scrypt（64 MiB 内存开销）派生
- 🗂️ **开放条目模型**：核心只有标题/用户名/密码，其余一切都是 `extra` 里的自由键值
  （分类、网址、备注、标签只是几个约定键），不猜字段、不丢信息
- 🏷️ **自定义分类**：内置 邮箱 / API Key / 网站 / 其他 只是建议值，随手输入任意分类名即可创建
  （如「服务器」「工作」）；CLI 与 Web 界面都能直接增、删、改分类，分类为空即「未分类」
- 🖱️ **拖拽归类**：在网页里把条目拖到左侧分类上即可移动（拖到「未分类」即清空分类）
- 🔎 **分类与检索**：按分类筛选、关键词搜索（覆盖 extra 键值）
- 🖥️ **两种界面**：`pm` 命令行 + `pm web` 本地网页（仅监听 127.0.0.1）
- 🌐 **中英双语**：CLI 输出、帮助与报错、Web 界面、文档均可切换语言；默认跟随系统区域，可用 `--lang` 或 `PM_LANG` 覆盖
- 🎲 **密码生成器**：可配长度、字符集、排除易混淆字符
- 📋 **剪贴板复制**：`pm cp <条目>` 直接把密码送进系统剪贴板
- 📥 **导入 / 导出**：JSON、CSV 明文格式，方便备份与迁移
- 🔒 **加密副本**：一键导出与保险库同主密码的 pmvault 加密备份（CLI / Web 均可），可安全存放，支持导回
- 🔑 **改主密码不重加密数据**：数据密钥（DEK）独立，改密码只需重新封装 DEK
- 🛡️ **完整性保护**：篡改检测、跨进程文件锁（并发写入不再静默丢数据）、覆盖前自动留 `.bak` 备份
- 🧯 **写失败不留脏状态**：所有修改先落在草稿副本上，写盘成功才提交到内存
- 📦 **零构建**：Node 原生运行 TypeScript，无打包步骤，依赖极少

## 安装

要求 Node.js >= 23.6（原生 TypeScript 支持）。

```bash
npm install          # 安装依赖
npm link             # 可选：把 pm 命令链接到全局
```

不安装也可直接用 `node bin/pm.js <命令>` 或 `npm run pm -- <命令>`。

## 快速开始

```bash
pm init                                  # 创建保险库，设置主密码
pm add website GitHub -u me@example.com -g --url https://github.com -t dev
pm add                                   # 不带参数 = 交互式向导，逐项询问
pm ls                                    # 列出全部条目（密码打码）
pm get GitHub --show                     # 查看详情并显示密码明文
pm cp GitHub                             # 复制密码到剪贴板
pm web                                   # 打开本地网页界面
```

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `pm init` | 创建保险库（设置主密码，`--force` 覆盖已有文件） |
| `pm add [分类] [标题]` | 添加条目；`-u` 用户名、`-p` 密码、`-g` 生成、`--url`、`-n` 备注、`-t` 标签、`-e key=value` 任意额外字段 |
| `pm ls [分类]` | 列出条目；分类可以是任意自定义名或 `未分类`/`none`，`-q` 关键词过滤，`--json` 输出 JSON |
| `pm cat [list]` | 分类总览（分类 / 值 / 内置或自定义 / 条目数） |
| `pm cat add <名>` | 登记一个自定义分类（即使暂时没有条目） |
| `pm cat rename <旧> <新>` | 重命名分类，相关条目一并更新 |
| `pm cat rm <名>` | 删除分类，相关条目变为未分类（内置分类同样可删，重新添加即恢复） |
| `pm get <查询>` | 查看条目；`--show` 显示密码、`-c` 复制、`-f <字段>` 输出单个字段（核心字段或任意 extra 键）、`--json` |
| `pm cp <查询>` | 复制密码到剪贴板 |
| `pm edit <查询>` | 修改条目；`-e key=value` 增改额外字段、`--clear <键>` 清空，无选项时进入交互编辑 |
| `pm rm <查询>` | 删除条目（交互模式下需确认） |
| `pm gen` | 生成随机密码；`-l` 长度、`-c` 个数、`--no-symbols`、`--no-ambiguous`、`--copy` |
| `pm passwd` | 修改主密码 |
| `pm export [文件]` | 导出；`--format json\|csv` 为明文，`--format vault` 导出加密副本（无需解锁）；不指定文件则输出到 stdout |
| `pm import <文件>` | 从 JSON/CSV 或 pmvault 加密备份导入（自动识别；加密备份需输入其主密码；默认跳过重复条目） |
| `pm web` | 启动本地 Web UI：`-p` 端口、`--auto-lock` 自动锁定分钟数、`--no-open` |
| `pm info` | 显示保险库路径、状态与分类统计 |
| `pm help [命令]` | 查看帮助 |

分类名是自由字符串：内置四个可写中文或英文（`邮箱`/`email`、`apikey`/`api`、`网站`/`website`、`其他`/`other`），
其余按输入原样作为自定义分类（`pm add 服务器 阿里云ECS -u root`）。也可以完全不给分类。
条目查询支持 id、标题精确匹配、以及标题/用户名/全部 extra 键值的模糊匹配。

**全局参数**（写在命令之前）：`-F, --file <路径>` 指定保险库文件（也可用环境变量 `PM_VAULT`）；
`--lang <en|zh>` 指定界面语言（也可用环境变量 `PM_LANG`）。默认位置 `~/.password-mgr/vault.json`。

**管道用法**（脚本友好，非交互时主密码从 stdin 读一行）：

```bash
printf 'master-password\n' | pm get GitHub -f password
pm gen -l 32 | pbcopy
# 导入加密备份：第一行是当前保险库主密码，第二行是备份文件的主密码
printf 'master-password\nbackup-master-password\n' | pm import backup.pmv
```

## 界面语言

所有面向用户的文本都有中英两套：CLI 的命令描述、交互提示、报错，Web 界面，以及本文档。

- 默认语言按 `PM_LANG`、POSIX 的 `LANGUAGE` / `LC_ALL` / `LC_MESSAGES` / `LANG`、系统区域的顺序探测；
  不是 `en*` / `zh*` 的区域一律回退到英文（`C`/`POSIX` 即英文）。
- 单次命令用 `--lang en` / `--lang zh` 覆盖（优先级最高，盖过所有环境变量）。
- 每个 shell 用 `export PM_LANG=zh`（或 `=en`）固定。
- Web 界面顶栏和解锁卡片上有语言切换器；选择会记在浏览器里，并同步给服务端，
  因此接口报错和下次刷新页面都会保持所选语言。

```bash
pm --lang zh --help          # 中文帮助
PM_LANG=zh pm ls             # 中文输出
LANG=zh_CN.UTF-8 pm ls       # 跟随系统区域
```

机器可读的输出不翻译：`--json`、`-f/--field`、`gen` 的原始密码、以及导出内容都与语言无关。

## Web UI

```bash
pm web                    # 启动后终端会打印带 token 的访问地址
pm web -p 8080 --auto-lock 5
```

安全设计（面向本机使用）：

- 只监听回环地址；监听其他地址时需要二次确认（密码会暴露给局域网设备）
- 启动时生成随机访问令牌。用终端打印的完整地址打开一次（`http://127.0.0.1:3170/?token=…`），令牌只留在该标签页，因此同一标签页可以刷新；新标签页需要重新打开完整地址。API 请求必须在 `X-Vault-Token` 头里带上该令牌。页面壳本身不含保险库数据
- 校验 `Host`、`Origin` 和 `Sec-Fetch-Site`，阻断 DNS rebinding、其他本机端口以及来自其他网站的请求
- 列表接口不下发密码字段，只有查看单条详情时才返回
- 无操作自动锁定（默认 10 分钟），DEK 只存在于 Node 进程内存中

界面里的「导出」支持明文 JSON/CSV 与**加密副本**（pmvault，与主密码相同），「导入」支持
JSON / CSV / pmvault 加密备份（加密备份需填写其主密码）。

## 条目模型

条目核心只有三个字段，其余一律进 `extra`：

```jsonc
{
  "title": "Godaddy",
  "username": "h2p74f...",          // 可选
  "password": "VvQn8D4...",         // 可选
  "extra": {                        // 任意键值，值均为字符串
    "category": "apikey",           // 约定键：分类（email/apikey/website/other）
    "url": "https://...",           // 约定键：网址
    "notes": "…",                   // 约定键：备注
    "tags": "dns|api",              // 约定键：标签，用 | 分隔
    "SecretId": "AKID...",          // 其他任意键，想放什么放什么
    "环境": "生产"
  }
}
```

CLI 里用 `-e key=value`（可重复）读写任意键，`pm get <条目> -f <键>` 取单个值；
Web 界面详情页会列出全部 extra 键，编辑弹窗里有专门的「额外字段」输入区。

分类同理：`extra.category` 想写什么就写什么。**把条目直接拖到左侧分类上即可归类**（拖到「未分类」则清空分类）；
侧栏「分类」区顶部有 **＋ 新建**，选中的分类下方会出现 **重命名 / 删除**；
编辑条目时的分类输入框也能直接敲新分类名（带已有分类的建议）。内置的四个分类同样可以重命名或删除
（删除=从列表移除，条目变为未分类；用同名新建即可恢复）。新增条目的分类会自动登记；
用 `pm cat add` 可以先建一个空分类备用。

导入文件同样遵循该结构，例如：

```json
{ "version": 2, "entries": [
  { "title": "Godaddy", "username": "…", "password": "…",
    "extra": { "category": "apikey", "notes": "来源标注 key/secret" } }
] }
```

兼容旧写法：条目上的顶层 `category`/`url`/`notes`/`tags`（JSON）或对应 CSV 列会自动折进 extra。

## 加密备份（pmvault）

`pm export --format vault backup.pmv`（Web 界面：「导出 → 下载加密副本」）会导出一份**加密副本**：
它就是一个完整的保险库文件（AES-256-GCM，主密码保护），不含任何明文，可安全上传网盘或异地保存。
导出只是复制当前文件，**无需输入主密码**，也不会改动主库。

- **整库恢复**：把副本当保险库文件用 —— 覆盖回 `~/.password-mgr/vault.json`，或 `pm -F backup.pmv <命令>`，主密码不变。
- **合并导回**：`pm import backup.pmv` 会提示输入备份文件的主密码，把其中的条目合并进当前保险库
  （默认跳过重复条目，`--keep-duplicates` 可保留；条目的创建时间也会保留）。
- 副本与保险库共用同一主密码：主密码一旦忘记，两者都不可恢复。

## 文件格式

```jsonc
{
  "format": "pmvault",
  "version": 2,
  "kdf":     { "algo": "scrypt", "N": 65536, "r": 8, "p": 1, "salt": "…" },
  "wrapped": { "algo": "aes-256-gcm", "iv": "…", "tag": "…", "data": "…" },  // KEK 封装的 DEK
  "vault":   { "algo": "aes-256-gcm", "iv": "…", "tag": "…", "data": "…" },  // DEK 加密的条目
  "meta":    { "createdAt": "…", "updatedAt": "…" }
}
```

`version: 1` 的旧文件仍可读：解锁时会把旧的 category/url/notes/tags 自动折进 `extra`，下次写入即升级为 v2。

密文使用不同的附加认证数据（AAD）绑定角色，防止 `wrapped` 与 `vault` 密文互换。
文件权限为 `0600`，目录 `0700`；每次覆盖写入前会保留一份 `.bak` 备份；写入采用「临时文件 + rename」原子替换。

写入时会创建 `<文件>.lock` 独占锁，覆盖「读 → 校验 → 写 → 改名」全过程：
另一个 `pm` 进程正在写时，本进程会得到明确冲突提示而不是互相覆盖。
进程崩溃留下的锁超过 10 秒会被自动清理。KDF 参数在读取时会做范围校验，
恶意构造的保险库文件无法用它触发超出上限的内存分配。

## 安全边界（请务必了解）

- **忘记主密码 = 数据永久不可读**。没有后门、没有恢复密钥，这是刻意设计。
- 主密码通过**命令行参数以外的通道**输入（隐藏回显的交互提示），但 `-p` 参数会把密码暴露在
  shell 历史与进程列表里，仅建议在测试时使用。
- 解锁后 DEK 与明文条目驻留在进程内存中；程序会尽力擦除密钥缓冲区，但 JavaScript 字符串
  无法可靠清零，**内存转储/Debugger 不在防护范围内**。
- 云同步网盘（iCloud/Dropbox）会拿到加密文件本身，这是安全的；**加密副本（`.pmv`）同样安全**，
  它只是保险库文件的完整复制；但**导出的 JSON/CSV 是明文**，用完请及时删除。
- 剪贴板内容不会自动清除。
- 本工具防护的是「文件泄露」与「离线暴力破解」，不防护已被攻陷的本机（键盘记录、内存抓取等）。

## 项目结构

```
src/
  index.ts            入口：全局参数解析 + 语言解析 + Cordis 应用组装
  i18n/               文案目录（en.ts 是事实来源，zh.ts 按它的类型校验，缺键即报错）
  cli/                本地化的帮助渲染与错误/类型提示
  crypto.ts           scrypt / AES-256-GCM / 密码生成器等原语
  types.ts            条目模型（标题/用户名/密码 + extra）与分类约定
  serialize.ts        JSON / CSV 导入导出（extra 键值往返）
  plugins/
    vault.ts          Vault 服务：加解密、持久化、增删改查（ctx.vault）
    commands.ts       CLI 命令插件（注入 cli、vault）
    web.ts            Web UI 插件（注入 server、vault，提供 ctx.webui）
  web/ui.ts           自包含单页界面（无外部资源；拖拽归类、分类增删改、语言切换都在这里）
  utils/              隐藏输入、剪贴板、终端格式化
test/                 node:test 单元测试（含 CLI 端到端与文案目录校验）
```

Cordis 相关用法：`Vault`、`WebUI` 以 `Service` 形式提供服务；`commands`/`web` 通过
`inject` 声明依赖；所有路由、事件监听、定时器都注册在各自插件的 fiber 内，随插件卸载自动清理；
`schemastery` 负责插件配置校验。

## 测试

```bash
npm test          # node:test 单元测试（crypto / vault / 序列化 / i18n / Web UI / CLI）
npm run typecheck # tsc --noEmit 类型检查
```
