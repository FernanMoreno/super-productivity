'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { stageApplication } = require('./pipeline.cjs');
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)),
    );
  });
}
const winPath = (value) =>
  execFileSync('wslpath', ['-w', value], { encoding: 'utf8' }).trim();
async function buildPlatform(repo, platform, output) {
  const windows = platform === 'win32';
  if (!['linux', 'win32'].includes(platform))
    throw Error('Supported platforms: linux, windows, all');
  const env = {
    ...process.env,
    SP_SKIP_WAYLAND_IDLE_HELPER_BUILD: '',
    PATH: path.join(os.homedir(), '.cargo/bin') + path.delimiter + process.env.PATH,
  };
  if (!windows)
    await run(process.execPath, ['tools/build-wayland-idle-helper.js'], {
      cwd: repo,
      env: {
        ...env,
        SP_REQUIRE_WAYLAND_IDLE_HELPER_BUILD: '1',
        SP_SKIP_WAYLAND_IDLE_HELPER_BUILD: '',
      },
    });
  await fs.mkdir(output, { recursive: true });
  const stage = await fs.mkdtemp(path.join(output, `stage-${platform}-`));
  const runtime = await stageApplication(repo, stage, {
    platform,
    ...(process.env.SP_PLANNER_FRONTEND_DIR
      ? { frontendDirectory: path.resolve(process.env.SP_PLANNER_FRONTEND_DIR) }
      : {}),
  });
  for (const relative of [
    'tools/beforePack.js',
    'tools/afterPack.js',
    'build/linux/snap-wrapper.sh',
    'build/icon.png',
    'build/icon.icns',
  ]) {
    const target = path.join(stage, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(repo, relative), target);
  }
  const rootRequire = require('node:module').createRequire(
    path.join(repo, 'package.json'),
  );
  const electronPackage = rootRequire.resolve('electron/package.json');
  const electron = JSON.parse(await fs.readFile(electronPackage, 'utf8'));
  const lock = JSON.parse(
    await fs.readFile(path.join(repo, 'package-lock.json'), 'utf8'),
  );
  if (electron.version !== lock.packages['node_modules/electron'].version)
    throw Error('Installed Electron differs from root lockfile');
  const builder = rootRequire.resolve('electron-builder');
  const convert = windows ? winPath : (value) => value;
  const artifacts = path.join(output, platform);
  await fs.mkdir(artifacts, { recursive: true });
  const config = {
    extends: convert(path.join(repo, 'electron-builder.yaml')),
    electronVersion: electron.version,
    npmRebuild: false,
    forceCodeSigning: false,
    publish: null,
    ...(windows
      ? {
          appId: 'com.super-productivity.personal-planner',
          productName: 'Super Productivity Planner',
        }
      : {}),
    directories: {
      output: convert(artifacts),
      buildResources: convert(path.join(stage, 'build')),
    },
    beforePack: convert(path.join(stage, 'tools/beforePack.js')),
    afterPack: convert(path.join(stage, 'tools/afterPack.js')),
    files: [
      'electron/**/*.js',
      'electron/assets/**/*',
      '.tmp/angular-dist/**/*',
      'LICENSE',
    ],
    ...(windows
      ? {
          win: {
            signExecutable: false,
            publish: null,
            icon: convert(path.join(stage, 'build/icon.png')),
          },
          nsis: {
            artifactName: 'Super-Productivity-Planner-Setup-${arch}.${ext}',
            uninstallDisplayName: 'Super Productivity Planner',
          },
        }
      : {
          electronDist: path.dirname(electronPackage) + '/dist',
          linux: { target: ['zip'], publish: null },
        }),
  };
  const request = { stage: convert(stage), builder: convert(builder), platform, config };
  const requestFile = path.join(stage, 'builder-request.json');
  await fs.writeFile(requestFile, JSON.stringify(request, null, 2));
  const runner = path.join(__dirname, 'runner.cjs');
  const command = windows
    ? process.env.SP_WINDOWS_NODE || '/mnt/c/Program Files/nodejs/node.exe'
    : process.execPath;
  await run(command, [convert(runner), convert(requestFile)], { cwd: stage, env });
  console.log(
    JSON.stringify(
      {
        platform,
        stage,
        artifacts,
        electronVersion: electron.version,
        runtime: runtime.dependencies,
      },
      null,
      2,
    ),
  );
}
if (require.main === module) {
  const args = process.argv.slice(2),
    selected = args[0] || 'all';
  const repo = path.resolve(__dirname, '../..');
  const output = path.resolve(args[1] || path.join(repo, '.tmp/planner-distribution'));
  const platforms =
    selected === 'all'
      ? ['linux', 'win32']
      : [selected === 'windows' ? 'win32' : selected];
  (async () => {
    for (const platform of platforms) await buildPlatform(repo, platform, output);
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { buildPlatform };
