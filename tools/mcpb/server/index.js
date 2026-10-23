#!/usr/bin/env node
/**
 * Dependency-free JSON-lines stdio bridge to the running Electron MCP endpoint.
 * The app owns tools, permissions and persistence. This adapter never retries.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const readline = require('node:readline');
const REQUEST_TIMEOUT_MS = 60000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const INTERNAL_ERROR = -32603;

function readSettings(env = process.env) {
  let endpoint;
  try {
    endpoint = new URL(env.SP_MCP_URL || 'http://127.0.0.1:3876/mcp');
  } catch {
    throw new Error('Invalid MCP endpoint; use http://127.0.0.1:3876/mcp.');
  }
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
    endpoint.pathname !== '/mcp' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(
      'MCP endpoint must be plain HTTP on literal loopback, path /mcp, without credentials or query.',
    );
  }
  let accessKey = env.SP_ACCESS_KEY || '';
  if (env.SP_ACCESS_KEY_FILE) {
    try {
      accessKey = fs.readFileSync(env.SP_ACCESS_KEY_FILE, 'utf8').trim();
    } catch {
      // Do not expose user paths or filesystem error details to the MCP client.
      throw new Error(
        'Cannot read SP_ACCESS_KEY_FILE. Check the external token file and its permissions.',
      );
    }
  }
  if (!accessKey) {
    throw new Error(
      "Set SP_ACCESS_KEY or SP_ACCESS_KEY_FILE with the app's assistant MCP access key.",
    );
  }
  if (!/^sp_mcp_[A-Za-z0-9_-]{1,256}$/.test(accessKey)) {
    throw new Error(
      'Invalid MCP access key format. Generate an assistant key starting with sp_mcp_; the REST credential is independent.',
    );
  }
  return { endpoint, accessKey };
}

const errorFor = (id, message, code = 'BRIDGE_ERROR', rpcCode = INTERNAL_ERROR) => ({
  jsonrpc: '2.0',
  id,
  error: { code: rpcCode, message, data: { code } },
});
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasId = (message) => Object.hasOwn(message, 'id');
const isId = (id) =>
  typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
const mutationUnknown = (id) =>
  errorFor(
    id,
    'OUTCOME_UNKNOWN: Super Productivity may have applied this tool call. Do not retry automatically; inspect app state or use the same operationId if that tool supports it.',
    'OUTCOME_UNKNOWN',
  );

function post(endpoint, accessKey, body, protocolVersion, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: endpoint.hostname.replace(/^\[|\]$/g, ''),
        port: endpoint.port || 80,
        path: endpoint.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${accessKey}`,
          ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
        },
      },
      (res) => {
        let data = '',
          bytes = 0;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_RESPONSE_BYTES) req.destroy(new Error('response-too-large'));
          else data += chunk;
        });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      },
    );
    // A total deadline also covers a peer that streams bytes indefinitely.
    const deadline = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.end(body);
  });
}

function explainStatus(status) {
  if (status === 401)
    return 'Super Productivity rejected the access key. Generate an assistant access key in Settings and update SP_ACCESS_KEY or its external file.';
  if (status === 403)
    return 'Super Productivity refused this request. Check the granted assistant permissions and use the local MCP endpoint.';
  if (status === 503)
    return 'Assistant access is switched off in Super Productivity. Open the Electron app and enable assistant access in Settings.';
  return `Super Productivity answered HTTP ${status}. Check the app and assistant access settings.`;
}

function createBridge({ endpoint, accessKey, timeoutMs = REQUEST_TIMEOUT_MS }) {
  let protocolVersion;
  return async (line, write) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      write(errorFor(null, 'Parse error', 'PARSE_ERROR', -32700));
      return;
    }
    if (
      !isObject(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string' ||
      (hasId(message) && !isId(message.id))
    ) {
      write(
        errorFor(
          null,
          'Invalid JSON-RPC request; batches are not supported.',
          'INVALID_REQUEST',
          -32600,
        ),
      );
      return;
    }
    const request = hasId(message),
      toolCall = message.method === 'tools/call';
    let reply;
    try {
      reply = await post(endpoint, accessKey, line, protocolVersion, timeoutMs);
    } catch (error) {
      if (request) {
        if (toolCall && error.code !== 'ECONNREFUSED') write(mutationUnknown(message.id));
        else
          write(
            errorFor(
              message.id,
              error.code === 'ECONNREFUSED'
                ? 'Super Productivity is not running, or its assistant access is switched off.'
                : 'Super Productivity did not answer. No automatic retry was made.',
              'APP_UNAVAILABLE',
            ),
          );
      }
      return;
    }
    if (!request) return;
    let parsed;
    try {
      parsed = JSON.parse(reply.data);
    } catch {
      /* No untrusted response body in errors. */
    }
    if (
      isObject(parsed) &&
      parsed.jsonrpc === '2.0' &&
      parsed.id === message.id &&
      (Object.hasOwn(parsed, 'result') || Object.hasOwn(parsed, 'error'))
    ) {
      if (
        message.method === 'initialize' &&
        typeof parsed.result?.protocolVersion === 'string'
      )
        protocolVersion = parsed.result.protocolVersion;
      write(parsed);
    } else if (toolCall && ![401, 403, 503].includes(reply.status)) {
      write(mutationUnknown(message.id));
    } else {
      write(errorFor(message.id, explainStatus(reply.status), 'APP_REJECTED'));
    }
  };
}

function run({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  let forward, configurationError;
  try {
    forward = createBridge(readSettings(env));
  } catch (error) {
    configurationError = error.message;
  }
  const write = (value) => output.write(JSON.stringify(value) + '\n');
  let queue = Promise.resolve();
  const lines = readline.createInterface({ input });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    queue = queue
      .then(async () => {
        if (!configurationError) return forward(line, write);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          write(errorFor(null, 'Parse error', 'PARSE_ERROR', -32700));
          return;
        }
        if (isObject(message) && hasId(message) && isId(message.id))
          write(errorFor(message.id, configurationError, 'CONFIGURATION_ERROR'));
      })
      .catch(() => {
        // Never print request contents, credentials, headers or raw transport errors.
      });
  });
  return lines;
}

module.exports = { readSettings, createBridge, run };
if (require.main === module) run();
