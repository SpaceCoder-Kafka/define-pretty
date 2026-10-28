# 开发与发布说明

[返回 README](../README.md)

本文保留源码运行、打包发布与实现约定。日常使用请阅读 README。

## 运行环境与数据目录

需要 Node.js 22.12 或更新版本。正式入口默认使用以下数据目录，与安装版本和 npx 缓存无关：

| 系统 | 默认数据目录 |
| --- | --- |
| macOS | `~/Library/Application Support/Define Pretty` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/define-pretty` |
| Windows | `%LOCALAPPDATA%\Define Pretty` |

## 源码开发

需要 Node.js >= 22.12。在源码目录安装开发依赖并启动：

```sh
npm ci
npm run dev
```

生产构建与启动：

```sh
npm run build
npm start
```

`npm run dev` 保持使用仓库内 `.data/visual-cards` 和 Vite 热更新；不自动打开浏览器。`npm start` 使用已构建的发布入口、自动打开浏览器，并使用上面的固定用户数据目录。原有 `dev:cards`、`build:cards`、`start:cards` 命令保留为别名。

如果希望生产入口继续使用当前仓库的旧数据，显式指定目录，无需复制或迁移：

```sh
npm start -- --data-dir .data/visual-cards --source-data-dir .data
```

`npm run dev` 的前端由 Vite 热更新，后端不会自动重启。修改 `server/` 或后端引用的 `shared/` 后，应等待在途任务结束，再停止并重新启动服务；只刷新浏览器不会让新的执行配置和提示词生效。生产入口需先重新构建。

### 运行核心

`server/core.ts` 负责服务生命周期、数据锁和任务管理；`server/cli.ts` 负责参数、环境检查、浏览器打开和退出信号。导入核心不会启动服务或注册全局信号处理。安装发布包后可以在自己的 Node.js 程序中调用：

```js
import { startLocalService } from 'define-pretty/core';

const service = await startLocalService({ dataDirectory: '/absolute/path/to/data' });
console.log(service.consoleOrigin, service.previewOrigin);
// 宿主在退出时调用；会取消在途任务并保留中断记录。
await service.shutdown();
```

核心仅监听 `127.0.0.1`，没有公网绑定选项。界面、示例和内置网页相对安装位置加载，不依赖调用者的工作目录；数据路径由宿主明确传入。

### 打包与 GitHub 发布

```sh
npm run pack:release
```

生成 `.release/define-pretty.tgz` 和 `.release/SHA256SUMS`。打包前自动类型检查并构建；白名单只包含发布代码、前端与必要资源，排除本地数据、日志、测试和开发依赖。也支持标准 `npm pack`，会通过 `prepack` 自动构建。

在本机直接验证这个发布包：

```sh
npx --yes --package ./.release/define-pretty.tgz define-pretty
```

将 `define-pretty.tgz` 和 `SHA256SUMS` 上传到 GitHub Release 后，用户可以一条命令下载并启动，无需 npm 账号或 npm registry 发布：

```sh
npx --yes --package=https://github.com/SpaceCoder-Kafka/define-pretty/releases/latest/download/define-pretty.tgz define-pretty
```

`.github/workflows/release.yml` 在推送、PR 和手动触发时执行 macOS / Linux 验证；推送与 `package.json` 版本一致的标签（如 `v0.1.0`）时，测试通过后创建带安装命令的 **GitHub Release 草稿**。维护者检查草稿后发布。手动触发仅构建并上传工作流产物。

```sh
npm test
npm run test:package
```

`test:package` 重新打包，从仓库之外通过 npx 与仅含生产依赖的安装环境验证启动、类型声明、示例资源、重复启动保护、上传持久化和退出清理；使用隔离数据与模拟 Codex，不发起真实生成。设置 `DEFINE_PRETTY_PACKAGE_BROWSER_TEST=1` 会额外检查发布包中的真实浏览器界面。当前发布流程验证 macOS 和 Linux；Windows 路径与启动适配尚未经过同等端到端验证。

### 内置原始网页

滚动到工作台下方的网页验证区域，或打开 http://127.0.0.1:4193/#original-websites ，再点击原网页预览标题旁的「更换网页」打开场景选择弹窗。新安装默认使用 Dashboard；已有网页选择会保留。

| 场景 | 风格 | 可测试的内容与交互 |
| --- | --- | --- |
| 数据 Dashboard | 深色霓虹 | 指标、图表、表格筛选和待办 |
| 个人简历 | 经典渐变 | 经历时间线、技能与项目展示 |
| 个人博客 | 经典渐变 | 分类、搜索与文章阅读 |
| SaaS 产品官网 | 经典渐变 | 功能、定价、FAQ 与产品体验 |
| 设计师作品集 | 深色霓虹 | 作品筛选与项目详情 |
| 电商商品页 | 经典渐变 | 商品浏览、购物车数量和金额 |
| 在线课程 | 经典渐变 | 课程筛选、课程详情与学习进度 |
| 活动报名 | 深色霓虹 | 议程切换与本地报名表单 |

网页刻意保留早期 AI 常见的蓝紫渐变、Emoji、重复卡片、圆角和阴影，便于观察设计优化。所有品牌、人物、数据、价格均为演示内容，交互在本地完成。源文件在 `public/builtin-websites/<场景>/index.html`，每款独立、无外部依赖。

启动时按内容哈希创建冻结副本，后续测试只修改独立测试副本。内置文件更新后产生新的来源版本，历史对比仍引用原有副本。生产模式修改页面后需重新构建并重启服务。

### 最初的风格候选

打开 http://127.0.0.1:4193/ai-baselines/ 可对比四版早期 AI 风格的 FlowAI 演示网页：A 经典整块渐变、B 白底通用模板、C 深色霓虹科技、D 满屏玻璃拟态。首屏统一为 1440 × 1000，完整预览支持桌面和手机尺寸；「记为候选」只保存在浏览器，不会替换验证工作台的默认原网页。

源文件位于 `public/ai-baselines/`，各候选为无外部依赖的独立 HTML，包含页内导航、定价和本地演示表单。生产模式下新增或修改候选后需运行 `npm run build`。

```sh
npm run check
npm test
```

## 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DEFINE_PRETTY_PORT` | 从 `4193` 查找可用端口 | 固定控制台端口；被占用时报错 |
| `DEFINE_PRETTY_PREVIEW_PORT` | 从 `4194` 查找可用端口 | 固定独立静态预览端口；被占用时报错 |
| `DEFINE_PRETTY_DATA_DIR` | 正式入口为用户数据目录；开发为仓库 `.data/visual-cards` | 卡片、图片与验证记录 |
| `DEFINE_PRETTY_DIST_DIR` | 发布包内 `dist/visual-cards` | 覆盖已构建前端目录 |
| `DEFINE_PRETTY_SOURCE_DATA_DIR` | 正式入口与数据目录相同；开发为仓库 `.data` | 首次导入旧实验原网页时只读访问的目录 |
| `DEFINE_PRETTY_CHROME` | 自动查找 | 浏览器可执行文件路径 |

CLI 参数优先于对应环境变量；只有明确指定的相对路径才相对当前工作目录解析。

模型、provider 和 CLI 版本从本机 Codex 配置读取，复用现有登录。CLI 通过参数数组和 stdin 调用；卡片分析以只读沙箱运行，可使用只读图像分析命令与可用工具，保持原始输入不变。生成和修改网页以独立工作目录运行，并开启工作目录沙箱的网络访问；生成期间可以下载素材、安装依赖、构建和启动临时预览，也可截图对照参考图并自主修正。

网页任务会获得 `node preview.mjs` 截图入口，可指定视口宽高，返回当前 `website/` 的实际渲染及加载诊断。浏览器由本地服务启动，避免 macOS 工作目录沙箱阻止 Chrome 启动；页面仍使用与最终预览相同的隔离策略。入口只接受本任务的静态文件，不提供任意网址导航或浏览器控制权限，任务结束、取消或超时后关闭。模型自主决定何时截图、如何修改，不设固定迭代轮数。普通 SVG 图片可加载；SVG sprite 应使用同文档 `symbol`，外链 `<use>` 会受到浏览器同源限制。

截图会在浏览器内触发离屏图片加载，以共享的有界等待窗口检查图片，避免把尚未触发的懒加载误报为丢图；交付 HTML 保持不变。执行进度写入 `work/progress.json`，截图检查点写入 `work/draft-preview.json`，均通过原子写入供轮询读取；界面只接收活动摘要，不展示内部推理和原始命令载荷。

最终交付仍为可直接预览的 `website/index.html` 及本地静态资源。生成图片和下载素材保存到 `website/assets/`，构建源文件与依赖留在 `website/` 之外。生成阶段联网不改变成品的预览隔离策略。

## 数据与兼容

- 图片文件保留在 `references/`；图片索引使用 `references.json`。首次读取可兼容原 `store.json` 中的图片索引；新上传不会改写历史实验记录。
- 卡片、补全任务、验证任务分别保存在 `feature-boards/`、`feature-completions/`、`feature-tests/`。目录中的输入、配置、日志和运行结果用于追溯。新测试额外冻结无标记原图，记录文件名、类型及哈希；旧测试记录继续读取，只展示当时实际传入的卡片图。
- 内置网页启动时冻结到 `feature-tests/sources/`；新安装无需历史数据即可选择网页并进行验证。原有 `feature-tests/source.json` 及已冻结副本继续保留；未导入时仍可从历史数据最后一个实验读取已完成的原网页并校验哈希。历史来源、已生成网页与内置网页可以并存，尚未提供上传应用的入口。
- 旧多组实验界面、分组规范生成、调度器、评价与变化高亮接口已移除。`?view=experiments` 现在也显示卡片工作台；旧 `/api/experiments`、`/api/runs` 等接口返回 404。
- 磁盘中的历史实验和运行产物保留，不清理、不迁移其状态；旧实现可从 Git 历史恢复。
- `.data/`、`dist/` 与依赖不纳入 Git。数据目录使用进程锁，防止多个服务同时修改。

控制台写入接口校验来源和会话令牌；生成网页仅在另一个端口提供静态文件，并以限制权限的 iframe 运行。预览不能访问执行接口，文件读取拒绝路径穿越与符号链接。

网页验证允许通过 HTTPS 加载远程字体文件及字体样式表（如字体服务的 CSS），其他外部脚本、图片与业务请求仍受预览策略限制；生成期间获取并保存到交付目录的图片可正常预览。检查会等待字体加载并记录请求失败、字体错误或超时；加载成功不等于风格与业务适配已完成，也不能保证所有汉字都使用了预期字体。远程资源不可用时，浏览器可能显示回退字体。
