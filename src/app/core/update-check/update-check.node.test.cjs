const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { of, throwError, Subject } = require('rxjs');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const filename = require.resolve('./update-check.service.ts');
let response;
let notifications;
const oldLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent?.filename === filename) {
    if (request === '@angular/core')
      return {
        Injectable: () => (c) => c,
        inject: (name) =>
          name === 'http' ? { get: () => response } : { open: () => notifications++ },
      };
    if (request === '@angular/common/http') return { HttpClient: 'http' };
    if (request.endsWith('environment')) return { environment: { version: '1.0.0' } };
    if (request.endsWith('t.const')) return { T: {} };
    if (request.endsWith('global-config.service'))
      return { GlobalConfigService: 'config' };
    if (request.endsWith('banner.service')) return { BannerService: 'banner' };
    if (request.endsWith('banner.model')) return { BannerId: {} };
    if (request.endsWith('snack.service')) return { SnackService: 'snack' };
    if (request.endsWith('storage-keys.const'))
      return { LS: { UPDATE_CHECK_DISMISSED_VERSION: 'dismissed' } };
    if (request.endsWith('/log')) return { Log: { log: () => {} } };
    if (request.endsWith('is-update-check-possible.util'))
      return { isUpdateCheckPossible: () => true };
  }
  return oldLoad.call(this, request, parent, ...rest);
};
let UpdateCheckService;
try {
  ({ UpdateCheckService } = require(filename));
} finally {
  Module._load = oldLoad;
}
test('silent update outcome reports available without publishing banner or trusting html_url', async () => {
  notifications = 0;
  response = of({ tag_name: 'v999.0.0', html_url: 'https://evil.example' });
  const result = await new UpdateCheckService().checkForUpdateOutcome({ isSilent: true });
  assert.equal(result.status, 'available');
  assert.equal(
    result.releaseUrl,
    'https://github.com/super-productivity/super-productivity/releases/tag/v999.0.0',
  );
  assert.equal(notifications, 0);
});
test('native updater distinguishes up to date, malformed response, network error and busy', async () => {
  const service = new UpdateCheckService();
  response = of({ tag_name: 'v1.0.0' });
  assert.equal(
    (await service.checkForUpdateOutcome({ isSilent: true })).status,
    'up_to_date',
  );
  response = of({ tag_name: 'invalid' });
  assert.equal((await service.checkForUpdateOutcome({ isSilent: true })).status, 'error');
  response = throwError(() => new Error('offline'));
  assert.equal((await service.checkForUpdateOutcome({ isSilent: true })).status, 'error');
  response = new Subject();
  const pending = service.checkForUpdateOutcome({ isSilent: true });
  assert.equal((await service.checkForUpdateOutcome({ isSilent: true })).status, 'busy');
  response.next({ tag_name: 'v1.0.0' });
  await pending;
});
