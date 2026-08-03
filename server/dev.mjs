import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const children = [
  spawn(process.execPath, ['--watch', 'server/index.mjs'], { cwd: root, env: process.env, stdio: 'inherit' }),
  spawn(process.execPath, [vite, ...process.argv.slice(2)], { cwd: root, env: process.env, stdio: 'inherit' }),
]
let stopping = false

const stop = (signal, code = 0) => {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) child.kill(signal)
}

for (const child of children) {
  child.once('error', () => stop('SIGTERM', 1))
  child.once('exit', (code, signal) => stop('SIGTERM', code ?? (signal ? 1 : 0)))
}
process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))
