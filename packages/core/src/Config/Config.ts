import { existsSync } from 'fs';
import { extname, join } from 'path';
import {
  chalk,
  chokidar,
  compatESModuleRequire,
  deepmerge,
  cleanRequireCache,
  lodash,
  parseRequireDeps,
  winPath,
  getFile,
  createDebug,
} from '@umijs/utils';
import assert from 'assert';
import joi from '@umijs/deps/compiled/@hapi/joi';
import Service from '../Service/Service';
import { ServiceStage } from '../Service/enums';
import {
  getUserConfigWithKey,
  updateUserConfigWithKey,
} from './utils/configUtils';
import isEqual from './utils/isEqual';
import mergeDefault from './utils/mergeDefault';

const debug = createDebug('umi:core:Config');

interface IChanged {
  key: string;
  pluginId: string;
}

interface IOpts {
  cwd: string;
  service: Service;
  localConfig?: boolean;
  configFiles?: string[];
}

const DEFAULT_CONFIG_FILES = [
  '.umirc.ts',
  '.umirc.js',
  'config/config.ts',
  'config/config.js',
];

// TODO:
// 1. custom config file
export default class Config {
  cwd: string;
  service: Service;
  config?: object;
  localConfig?: boolean;
  configFile?: string | null;
  configFiles = DEFAULT_CONFIG_FILES;

  constructor(opts: IOpts) {
    this.cwd = opts.cwd || process.cwd();
    this.service = opts.service;
    this.localConfig = opts.localConfig;

    if (Array.isArray(opts.configFiles)) {
      // 配置的优先读取
      this.configFiles = lodash.uniq(opts.configFiles.concat(this.configFiles));
    }
  }

  async getDefaultConfig() {
    const pluginIds = Object.keys(this.service.plugins);

    // collect default config
    let defaultConfig = pluginIds.reduce((memo, pluginId) => {
      const { key, config = {} } = this.service.plugins[pluginId];
      if ('default' in config) memo[key] = config.default;
      return memo;
    }, {});

    return defaultConfig;
  }

  // ysy: 读取配置项的schema, 验证配置的正确性
  getConfig({ defaultConfig }: { defaultConfig: object }) {
    assert(
      this.service.stage >= ServiceStage.pluginReady,
      `Config.getConfig() failed, it should not be executed before plugin is ready.`,
    );

    const userConfig = this.getUserConfig();
    // 用于提示用户哪些 key 是未定义的
    // TODO: 考虑不排除 false 的 key
    const userConfigKeys = Object.keys(userConfig).filter((key) => {
      return userConfig[key] !== false;
    });

    // get config
    /**
     * ysy: 配置校验现在都是以plugin的形式注入,
     * 例如: copy: 
     api.describe({
    key: 'copy',
    config: {
      schema(joi) {
        return joi.array().items(joi.string());
      },
    },
  });

     */
    const pluginIds = Object.keys(this.service.plugins);
    pluginIds.forEach((pluginId) => {
      const { key, config = {} } = this.service.plugins[pluginId];
      // recognize as key if have schema config
      if (!config.schema) return;

      const value = getUserConfigWithKey({ key, userConfig });
      // 不校验 false 的值，此时已禁用插件
      // ysy: 配置的值为false就是不开启功能, 不做校验
      if (value === false) return;

      // do validate
      const schema = config.schema(joi);
      assert(
        joi.isSchema(schema),
        `schema return from plugin ${pluginId} is not valid schema.`,
      );
      // ysy: 验证, 用的库是joi
      const { error } = schema.validate(value);
      if (error) {
        const e = new Error(
          `Validate config "${key}" failed, ${error.message}`,
        );
        e.stack = error.stack;
        throw e;
      }

      // remove key
      // ysy: 验证通过就把key删除, userConfigKeys用来在后面提示用户有哪些无效配置
      const index = userConfigKeys.indexOf(key.split('.')[0]);
      if (index !== -1) {
        userConfigKeys.splice(index, 1);
      }

      // update userConfig with defaultConfig
      // ysy: 跟新默认配置 deep merge
      if (key in defaultConfig) {
        const newValue = mergeDefault({
          defaultConfig: defaultConfig[key],
          config: value,
        });
        updateUserConfigWithKey({
          key,
          value: newValue,
          userConfig,
        });
      }
    });

    if (userConfigKeys.length) {
      const keys = userConfigKeys.length > 1 ? 'keys' : 'key';
      throw new Error(`Invalid config ${keys}: ${userConfigKeys.join(', ')}`);
    }

    return userConfig;
  }

  getUserConfig() {
    // ysy: 读取配置文件
    const configFile = this.getConfigFile();
    this.configFile = configFile;
    // 潜在问题：
    // .local 和 .env 的配置必须有 configFile 才有效
    if (configFile) {
      let envConfigFile;
      // ysy: 读取环境特定的配置文件
      if (process.env.UMI_ENV) {
        const envConfigFileName = this.addAffix(
          configFile,
          process.env.UMI_ENV,
        );
        const fileNameWithoutExt = envConfigFileName.replace(
          extname(envConfigFileName),
          '',
        );
        envConfigFile = getFile({
          base: this.cwd,
          fileNameWithoutExt,
          type: 'javascript',
        })?.filename;
        if (!envConfigFile) {
          throw new Error(
            `get user config failed, ${envConfigFile} does not exist, but process.env.UMI_ENV is set to ${process.env.UMI_ENV}.`,
          );
        }
      }
      const files = [
        configFile,
        envConfigFile,
        this.localConfig && this.addAffix(configFile, 'local'),
      ]
        .filter((f): f is string => !!f)
        .map((f) => join(this.cwd, f))
        .filter((f) => existsSync(f));

      // clear require cache and set babel register
      // ysy: 配置文件可能依赖其他文件, 这里去解析所有依赖的配置文件
      const requireDeps = files.reduce((memo: string[], file) => {
        memo = memo.concat(parseRequireDeps(file));
        return memo;
      }, []);
      // ysy: 清理require.cache缓存
      requireDeps.forEach(cleanRequireCache);
      // ysy: 给这些文件添加babel处理
      this.service.babelRegister.setOnlyMap({
        key: 'config',
        value: requireDeps,
      });

      // require config and merge
      // ysy: deep merge configs
      return this.mergeConfig(...this.requireConfigs(files));
    } else {
      return {};
    }
  }

  addAffix(file: string, affix: string) {
    const ext = extname(file);
    return file.replace(new RegExp(`${ext}$`), `.${affix}${ext}`);
  }

  requireConfigs(configFiles: string[]) {
    // ysy: 导出配置文件里的config对象
    return configFiles.map((f) => compatESModuleRequire(require(f)));
  }

  mergeConfig(...configs: object[]) {
    let ret = {};
    for (const config of configs) {
      // TODO: 精细化处理，比如处理 dotted config key
      ret = deepmerge(ret, config);
    }
    return ret;
  }

  getConfigFile(): string | null {
    // TODO: support custom config file
    const configFile = this.configFiles.find((f) =>
      existsSync(join(this.cwd, f)),
    );
    return configFile ? winPath(configFile) : null;
  }

  getWatchFilesAndDirectories() {
    const umiEnv = process.env.UMI_ENV;
    const configFiles = lodash.clone(this.configFiles);
    this.configFiles.forEach((f) => {
      if (this.localConfig) configFiles.push(this.addAffix(f, 'local'));
      if (umiEnv) configFiles.push(this.addAffix(f, umiEnv));
    });

    const configDir = winPath(join(this.cwd, 'config'));

    const files = configFiles
      .reduce<string[]>((memo, f) => {
        const file = winPath(join(this.cwd, f));
        if (existsSync(file)) {
          memo = memo.concat(parseRequireDeps(file));
        } else {
          memo.push(file);
        }
        return memo;
      }, [])
      .filter((f) => !f.startsWith(configDir));

    return [configDir].concat(files);
  }

  // ysy: --watch模式会调用这个方法
  watch(opts: {
    userConfig: object;
    onChange: (args: {
      userConfig: any;
      pluginChanged: IChanged[];
      valueChanged: IChanged[];
    }) => void;
  }) {
    let paths = this.getWatchFilesAndDirectories();
    let userConfig = opts.userConfig;
    const watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      cwd: this.cwd,
    });
    watcher.on('all', (event, path) => {
      console.log(chalk.green(`[${event}] ${path}`));
      const newPaths = this.getWatchFilesAndDirectories();
      const diffs = lodash.difference(newPaths, paths);
      if (diffs.length) {
        watcher.add(diffs);
        paths = paths.concat(diffs);
      }

      const newUserConfig = this.getUserConfig();
      const pluginChanged: IChanged[] = [];
      const valueChanged: IChanged[] = [];
      Object.keys(this.service.plugins).forEach((pluginId) => {
        const { key, config = {} } = this.service.plugins[pluginId];
        // recognize as key if have schema config
        if (!config.schema) return;
        if (!isEqual(newUserConfig[key], userConfig[key])) {
          const changed = {
            key,
            pluginId: pluginId,
          };
          if (newUserConfig[key] === false || userConfig[key] === false) {
            pluginChanged.push(changed);
          } else {
            valueChanged.push(changed);
          }
        }
      });
      debug(`newUserConfig: ${JSON.stringify(newUserConfig)}`);
      debug(`oldUserConfig: ${JSON.stringify(userConfig)}`);
      debug(`pluginChanged: ${JSON.stringify(pluginChanged)}`);
      debug(`valueChanged: ${JSON.stringify(valueChanged)}`);

      if (pluginChanged.length || valueChanged.length) {
        opts.onChange({
          userConfig: newUserConfig,
          pluginChanged,
          valueChanged,
        });
      }
      userConfig = newUserConfig;
    });

    return () => {
      watcher.close();
    };
  }
}
