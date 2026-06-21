import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'web');
const isWin = process.platform === 'win32';

function tryFreePort(port) {
  if (!isWin) return;
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      console.log(`[dev] Dừng tiến trình cũ trên :${port} (pid ${pid})`);
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    }
  } catch {
    /* port is free */
  }
}

function run(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[${label}] stopped (${signal})`);
      return;
    }
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
    }
  });
  return child;
}

function resetNextBuild() {
  const nextDir = path.join(webRoot, '.next');
  if (!fs.existsSync(nextDir)) return;
  console.log('[dev] Xóa cache .next cũ...');
  fs.rmSync(nextDir, { recursive: true, force: true });
}

console.log('[dev] Starting Flask on http://127.0.0.1:5000');
const backend = run('flask', 'python', ['app.py'], root);

console.log('[dev] Starting Next.js on http://localhost:3000');
tryFreePort(3000);
resetNextBuild();
const frontend = run('next', 'npm', ['run', 'dev'], webRoot);

let stopping = false;
function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  console.log(`\n[dev] Shutting down (${reason})...`);
  if (isWin) {
    spawn('taskkill', ['/pid', String(backend.pid), '/f', '/t'], { shell: true, stdio: 'ignore' });
    spawn('taskkill', ['/pid', String(frontend.pid), '/f', '/t'], { shell: true, stdio: 'ignore' });
  } else {
    backend.kill('SIGTERM');
    frontend.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
