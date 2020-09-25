## Service所在

> 提供核心的Service类和PluginApi类
---
### Config
* config.ts
  ```
  主要作用是读取配置,这里包括用户自定义的.umirc相关的配置, 还有package.json里的
  umi插件, preset等
  ```
### Service
> Service类,PluginAPI类 实现了主要的命令, 插件机制