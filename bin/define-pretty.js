#!/usr/bin/env node

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Define Pretty 需要 Node.js >= 22.12，当前为 ${process.version}。请升级 Node.js 后重试。`);
  process.exitCode = 1;
} else {
  import('../dist/server/cli.js').then(({ runCLI }) => runCLI()).catch(error => {
    console.error(error?.code === 'ERR_MODULE_NOT_FOUND'
      ? '发布包不完整。源码用户请先运行 npm run build；安装包用户请重新安装。'
      : error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
