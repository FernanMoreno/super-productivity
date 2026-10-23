'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire, builtinModules } = require('node:module');
const builtins = new Set([
  ...builtinModules.map((name) => name.replace(/^node:/, '')),
  'electron',
]);
const normalize = (name) => name.split(path.sep).join('/');
function isPublicAppFile(name) {
  name = normalize(name);
  if (name === 'LICENSE') return true;
  if (name.startsWith('.tmp/angular-dist/'))
    return !name.split('/').some((part) => part === '..');
  if (name.startsWith('electron/assets/'))
    return !name.split('/').some((part) => part === '..');
  if (name === 'electron/bin/wayland-idle-helper') return true;
  return (
    name.startsWith('electron/') &&
    !name.startsWith('electron/scripts/') &&
    !name.endsWith('.map') &&
    name.endsWith('.js') &&
    !name.endsWith('.test.js') &&
    !name.split('/').some((part) => part === '..')
  );
}
async function walk(root) {
  const out = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(file)));
    else if (entry.isFile()) out.push(file);
    else if (entry.isSymbolicLink())
      throw Error('Unexpected symlink in public application source: ' + file);
  }
  return out;
}
function runtimeNames(sources, rootPackage) {
  const names = new Set();
  for (const source of sources)
    for (const match of source.matchAll(
      /(?:require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g,
    )) {
      const specifier = match[1];
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        builtins.has(specifier.replace(/^node:/, ''))
      )
        continue;
      const name = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      if (!Object.hasOwn(rootPackage.dependencies || {}, name))
        throw Error(`Runtime package ${name} must be declared in root dependencies.`);
      names.add(name);
    }
  return [...names].sort();
}
function frontendPath(repo, options = {}) {
  return path.resolve(options.frontendDirectory || path.join(repo, '.tmp/angular-dist'));
}
function stagedPath(repo, file, frontendDirectory) {
  const relativeFrontend = path.relative(frontendDirectory, file);
  const inFrontend =
    relativeFrontend !== '..' &&
    !relativeFrontend.startsWith('..' + path.sep) &&
    !path.isAbsolute(relativeFrontend);
  return inFrontend
    ? path.join('.tmp/angular-dist', relativeFrontend)
    : path.relative(repo, file);
}
function validatePreload(source) {
  for (const match of source.matchAll(/(?:\brequire|\bimport)\s*\(\s*([^)]*)\)/g)) {
    if (!/^(['"])electron\1\s*$/.test(match[1]))
      throw Error(
        'Sandbox preload must be bundled: only electron imports are allowed. Run npm run electron:build, including bundle-preload.',
      );
  }
}
async function publicAppFiles(repo, options = {}) {
  const frontendDirectory = frontendPath(repo, options);
  const files = [path.join(repo, 'LICENSE')];
  for (const directory of [path.join(repo, 'electron'), frontendDirectory])
    for (const file of await walk(directory))
      if (isPublicAppFile(stagedPath(repo, file, frontendDirectory))) files.push(file);
  for (const required of [
    path.join(repo, 'electron/main.js'),
    path.join(repo, 'electron/preload.js'),
    path.join(frontendDirectory, 'browser/index.html'),
    path.join(frontendDirectory, '3rdpartylicenses.txt'),
  ])
    if (!files.includes(required))
      throw Error('Missing compiled application input: ' + required);
  return files.sort();
}
async function packageRoot(name, from) {
  const requireFrom = createRequire(path.join(from, 'package.json'));
  let directory = path.dirname(requireFrom.resolve(name));
  while (true) {
    try {
      const metadata = JSON.parse(
        await fs.readFile(path.join(directory, 'package.json'), 'utf8'),
      );
      if (metadata.name === name) return { directory, metadata };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory)
      throw Error('Cannot locate runtime package metadata: ' + name);
    directory = parent;
  }
}
async function resolveRuntime(repo, options = {}) {
  const rootPackage = JSON.parse(
    await fs.readFile(path.join(repo, 'package.json'), 'utf8'),
  );
  const lock = JSON.parse(
    await fs.readFile(path.join(repo, 'package-lock.json'), 'utf8'),
  );
  validatePreload(await fs.readFile(path.join(repo, 'electron/preload.js'), 'utf8'));
  const installedRoot = await fs.realpath(path.join(repo, 'node_modules'));
  const files = await publicAppFiles(repo, options),
    sources = await Promise.all(
      files
        .filter(
          (file) =>
            normalize(path.relative(repo, file)).startsWith('electron/') &&
            file.endsWith('.js'),
        )
        .map((file) => fs.readFile(file, 'utf8')),
    );
  const names = runtimeNames(sources, rootPackage),
    dependencies = {},
    packages = {};
  const validate = async (name, from) => {
    const found = await packageRoot(name, from),
      real = await fs.realpath(found.directory),
      relative = path.relative(installedRoot, real);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw Error('Runtime package is outside the installed lock tree: ' + name);
    const entry = lock.packages?.['node_modules/' + normalize(relative)];
    if (!entry || entry.version !== found.metadata.version)
      throw Error('Installed runtime differs from root lockfile: ' + name);
    return { ...found, directory: real };
  };
  for (const name of names) {
    const found = await validate(name, repo);
    dependencies[name] = found.metadata.version;
    packages[name] = found;
  }
  return { rootPackage, dependencies, packages, files, validate };
}
async function copyRuntime(found, destination, validate, ancestors = new Map()) {
  const { metadata, directory } = found;
  if (ancestors.get(metadata.name) === metadata.version) return;
  const chain = new Map(ancestors);
  chain.set(metadata.name, metadata.version);
  await fs.cp(directory, destination, {
    recursive: true,
    dereference: true,
    filter: (source) =>
      !path.relative(directory, source).split(path.sep).includes('node_modules'),
  });
  const dependencies = {
    ...metadata.dependencies,
    ...metadata.optionalDependencies,
    ...metadata.peerDependencies,
  };
  for (const name of Object.keys(dependencies || {}).sort()) {
    if (builtins.has(name)) continue;
    let child;
    try {
      child = await validate(name, directory);
    } catch (error) {
      if (
        error.code === 'MODULE_NOT_FOUND' &&
        (Object.hasOwn(metadata.optionalDependencies || {}, name) ||
          metadata.peerDependenciesMeta?.[name]?.optional)
      )
        continue;
      throw error;
    }
    if (chain.get(name) === child.metadata.version) continue;
    await copyRuntime(
      child,
      path.join(destination, 'node_modules', name),
      validate,
      chain,
    );
  }
}
async function stageApplication(repo, stage, options = {}) {
  const { platform = 'linux' } = options;
  const runtime = await resolveRuntime(repo, options);
  const frontendDirectory = frontendPath(repo, options);
  // The caller owns a generated directory, never a user's installed application.
  await fs.mkdir(stage, { recursive: true });
  for (const file of runtime.files) {
    const relative = stagedPath(repo, file, frontendDirectory);
    if (
      platform === 'win32' &&
      normalize(relative) === 'electron/bin/wayland-idle-helper'
    )
      continue;
    const target = path.join(stage, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file, target);
  }
  const { rootPackage } = runtime;
  const metadata = Object.fromEntries(
    ['name', 'version', 'description', 'author', 'license', 'main', 'packageManager']
      .filter((key) => rootPackage[key] !== undefined)
      .map((key) => [key, rootPackage[key]]),
  );
  if (platform === 'win32') {
    metadata.name = 'super-productivity-planner';
    metadata.productName = 'Super Productivity Planner';
  }
  metadata.dependencies = runtime.dependencies;
  await fs.writeFile(
    path.join(stage, 'package.json'),
    JSON.stringify(metadata, null, 2) + '\n',
  );
  for (const [name, found] of Object.entries(runtime.packages))
    await copyRuntime(found, path.join(stage, 'node_modules', name), runtime.validate);
  if (
    platform === 'win32' &&
    (await walk(path.join(stage, 'node_modules'))).some((file) => file.endsWith('.node'))
  )
    throw Error(
      'Windows staging has native Node addons; a platform-specific rebuild is required.',
    );
  return runtime;
}
module.exports = {
  isPublicAppFile,
  validatePreload,
  runtimeNames,
  resolveRuntime,
  stageApplication,
  publicAppFiles,
};
