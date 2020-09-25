## umi主包
---
> 存在bin目录, 安装umi后的指令启动就在这里,
> 主要作用就是分发umi指令
---
### 核心部分 cli.ts

```javascript
(async () => {
  try {
    switch (args._[0]) {
      case 'dev':
        const child = fork({
          scriptPath: require.resolve('./forkedDev'),
        });
        // ref:
        // http://nodejs.cn/api/process/signal_events.html
        process.on('SIGINT', () => {
          child.kill('SIGINT');
        });
        process.on('SIGTERM', () => {
          child.kill('SIGTERM');
        });
        break;
      default:
        const name = args._[0];
        if (name === 'build') {
          process.env.NODE_ENV = 'production';
        }
        await new Service({
          cwd: getCwd(),
          pkg: getPkg(process.cwd()),
        }).run({
          name,
          args,
        });
        break;
    }
  } catch (e) {
    console.error(chalk.red(e.message));
    console.error(e.stack);
    process.exit(1);
  }
})();
```
> 通过yParser解析命令行参数, 根据参数的不同, 给Service(core包里)传递不同的参数