# 单维度输入配对试验

此脚本是一次小样本验证工具，不改变控制台、既有实验或默认提示词。

当前固定案例使用 2026-10-24 已冻结的项目管理页，以及该版本的“有机色块拼贴插画”四条规则。规则并非针对试验结果重新撰写。目标收窄为引导卡片的既有协作插画，不能据此推断整页层级或所有维度的表现。

```sh
# 首次运行；目录存在时拒绝覆盖。两个端口必须空闲。
./node_modules/.bin/tsx scripts/dimension-pilot.ts run .data/pilots/illustration-20261024

# 全部终态后，记录文本保留、水平溢出及目标卡片之外的像素变化。
./node_modules/.bin/tsx scripts/analyze-dimension-pilot.ts .data/pilots/illustration-20261024

# 进程关闭后只恢复展示，不重新生成。
./node_modules/.bin/tsx scripts/dimension-pilot.ts serve .data/pilots/illustration-20261024
```

匿名对比在 `http://127.0.0.1:4183/`，生成网页在独立静态端口 `4184`，无执行接口。样本通过共享的 sandbox CSP 隔离。运行完后进程保留用于查看；SIGTERM/SIGINT 会终止当前任务并关闭这两个服务器。

实验先保存协议、完整输入和随机匿名对应，再启动三对独立运行。每对包含一句话组和规范组，各从同一冻结基线开始。唯一区别是规范组在同一个目标句后追加四条规则。公共约束、模型、推理、CLI、图片、并行及超时一致。一次生成后由宿主统一截取初始视口与目标卡片，执行现有功能检查；不自动修正或择优重跑。

结果目录保留 `protocol.md`、`manifest.json`、每次实际 `prompt.txt` / `input.json` / `command.json` / `events.jsonl`、完整网站、差异、退出结果、截图与验证证据。预览使用 A—F 随机编号；揭示前不显示方法。用户评价保存在浏览器，可导出 JSON；记录首次揭示时间以区别揭示后的评价。

测量不输出美观分。外部像素差异只能反映修改位置；不代表变化因果、规范遵循或审美质量。一个案例、每组三次只能形成局部证据，不能证明普遍优越或统计等效。
