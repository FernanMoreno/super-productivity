# Data model and boundary contract

No persistent schema changes. Internal detector method adds wslWindows; environment adds an isWsl flag. Host read returns a fresh integer duration in milliseconds (0..4294967295). Invalid output or process failure rejects; IdleTimeHandler logs it and permits subsequent fresh reads. Existing IPC.IDLE_TIME and renderer idle state contracts remain unchanged. No timestamps, keystrokes, task data, or credentials leave the machine.
