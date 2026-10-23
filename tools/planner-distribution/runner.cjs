'use strict';
const fs = require('node:fs');
const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { build, Platform, Arch } = require(request.builder);
const platform = request.platform === 'win32' ? Platform.WINDOWS : Platform.LINUX;
const targets = platform.createTarget(
  [request.platform === 'win32' ? 'nsis' : 'zip'],
  Arch.x64,
);
build({
  projectDir: request.stage,
  targets,
  config: request.config,
  publish: 'never',
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
