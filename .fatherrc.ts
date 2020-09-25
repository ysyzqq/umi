import { readdirSync } from 'fs';
import { join } from 'path';

// utils must build before core
// runtime must build before renderer-react
// 主配置, 配置打包顺序
const headPkgs = ['utils', 'ast', 'runtime', 'core', 'server'];
const tailPkgs = ['umi', 'test-utils'];
const otherPkgs = readdirSync(join(__dirname, 'packages')).filter(
  (pkg) =>
    pkg.charAt(0) !== '.' && !headPkgs.includes(pkg) && !tailPkgs.includes(pkg),
);

export default {
  target: 'node',
  cjs: { type: 'babel', lazy: true },
  disableTypeCheck: true,
  pkgs: [...headPkgs, ...otherPkgs, ...tailPkgs],
};
