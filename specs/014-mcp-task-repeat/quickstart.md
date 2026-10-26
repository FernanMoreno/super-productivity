# Validation quickstart

Run node --test electron/mcp/control-tools.test.cjs src/app/features/assistant-control/\*.test.cjs. Build frontend and Electron, package into isolated archive, then run e2e/electron/assistant-controls-smoke.cjs against a disposable app profile. Verify Wednesday/Friday intervals, changing frequency/start, replay, restart persistence, stale revision and denied write grants.
