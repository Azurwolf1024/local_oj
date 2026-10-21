'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const isWin = process.platform === 'win32';

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Replace {placeholder} tokens in a string.
function substitute(str, vars) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// Resolve a bare command name to an absolute path using `where`/`command -v`.
// Returns the first existing candidate, or the original name if none found
// (so the caller can let spawn fail naturally and report a helpful error).
function which(name) {
  if (!name) return null;
  // If it already looks like a path, just return it.
  if (path.isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    return name;
  }
  const cmd = isWin ? 'where' : 'command';
  const arg = isWin ? name : ['-v', name];
  try {
    const out = execFileSync(cmd, Array.isArray(arg) ? arg : [arg], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    return out || name;
  } catch (e) {
    return null;
  }
}

// Pick the first usable executable from a primary name + fallbacks.
function resolveExecutable(primary, fallbacks) {
  const candidates = [primary, ...(fallbacks || [])].filter(Boolean);
  for (const c of candidates) {
    const resolved = which(c);
    if (resolved) return resolved;
  }
  // Nothing found; return the primary so spawn produces a clear ENOENT error.
  return primary || null;
}

// Kill a process and its entire descendant tree.
function killTree(pid) {
  if (!pid) return;
  try {
    if (isWin) {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      // Negative pid targets the whole process group.
      process.kill(-pid, 'SIGKILL');
    }
  } catch (e) {
    // Best effort. If taskkill/pkill fails the process may already be gone.
  }
}

// Sample a process' current working set (bytes) without blocking the loop.
function sampleMemory(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(0);
    const onDone = (out) => {
      const v = parseInt((out || '').trim(), 10);
      resolve(v || 0);
    };
    try {
      if (isWin) {
        execFile(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){$p.WorkingSet}`,
          ],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
          (err, stdout) => onDone(stdout)
        );
      } else {
        execFile('ps', ['-o', 'rss=', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] },
          (err, stdout) => onDone(stdout ? String(parseInt(stdout, 10) * 1024) : ''));
      }
    } catch (e) {
      resolve(0);
    }
  });
}

// Best-effort peak working-set (bytes) of pid on Windows, RSS on POSIX.
// Polls asynchronously (non-blocking) until `shouldStop()` returns true.
async function monitorMemory(pid, shouldStop, intervalMs = 40) {
  if (!pid) return 0;
  let peak = 0;
  while (!shouldStop()) {
    const v = await sampleMemory(pid);
    if (v > peak) peak = v;
    await sleep(intervalMs);
  }
  const v = await sampleMemory(pid);
  if (v > peak) peak = v;
  return peak;
}

// Recursively remove a directory, retrying on Windows file-lock races.
function rmDirSafe(dir) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      return;
    } catch (e) {
      if (i === 4) {
        /* give up silently; temp dir will be cleaned by OS later */
      }
    }
  }
}

module.exports = {
  isWin,
  sleep,
  substitute,
  which,
  resolveExecutable,
  killTree,
  monitorMemory,
  rmDirSafe,
};
