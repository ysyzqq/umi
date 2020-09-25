### 新的umi3采用微内核架构, 主仓库还是采用learn多packages模式
这里是脚本
```javascript
  "scripts": {
    "bootstrap": "node ./scripts/bootstrap.js",
    "build": "father-build",
    "docs": "node ./scripts/docs.js",
    "docs:build": "node ./packages/umi/bin/umi.js build",
    "docs:dev": "node ./packages/umi/bin/umi.js dev",
    "docs:sync": "node ./scripts/docs.js syncDocs",
    "prettier": "prettier --write '**/*.{js,jsx,tsx,ts,less,md,json}'",
    "link:umi": "cd packages/umi && yarn link && cd -",
    "release": "node ./scripts/release.js",
    "test": "umi-test",
    "test:coverage": "umi-test --coverage",
    "sync:tnpm": "node -e 'require(\"./scripts/syncTNPM\")()'",
    "now-build": "echo \"Hello\"",
    "update:deps": "yarn upgrade-interactive --latest"
  },
```
1. build脚本还是使用father来做打包,会把packages下面的所有src下面的文件打包成cjs模块到lib目录下,具体打包配置看.fatherrc.ts
2. bootstrap脚本: 遍历所有的packages, 补充package.json的信息, 生成readme.md