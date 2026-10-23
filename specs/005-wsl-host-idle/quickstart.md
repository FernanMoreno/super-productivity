# Quickstart

Run node --test electron/idle-time-handler.test.cjs electron/wsl-idle-time.test.cjs; npm run test:electron; npm run checkFile -- electron/idle-time-handler.ts electron/wsl-idle-time.ts; npm run electron:build. Run project-composition-check SuperPro from WSL. Real integration must read the host through WSL, demonstrate rising time and reset after input, then exercise the real Electron idle dialog with an isolated profile at the minimum supported threshold. Never accept a missing dialog alone as evidence of success.
