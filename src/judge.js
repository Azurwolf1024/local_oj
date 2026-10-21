'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const {
  isWin,
  sleep,
  substitute,
  resolveExecutable,
  killTree,
  monitorMemory,
  rmDirSafe,
} = require('./util');

// ---- verdict severity (higher = worse) ----
const SEVERITY = { AC: 0, PE: 1, WA: 2, TLE: 3, MLE: 3, RE: 4, CE: 5, SE: 6 };
function worse(a, b) {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

// ---- output comparison with trailing whitespace / newline tolerance ----
function normalizeStrict(s) {
  s = String(s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = s.split('\n').map((l) => l.replace(/[ \t]+$/g, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}
function normalizeLoose(s) {
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\s+/)
    .filter((x) => x.length)
    .join(' ');
}
function compareOutputs(user, std, cfg) {
  if (normalizeStrict(user) === normalizeStrict(std)) return 'AC';
  if (cfg.allowPresentationError && normalizeLoose(user) === normalizeLoose(std))
    return 'PE';
  return 'WA';
}

// ---- run a single child process with resource limits ----
async function runProcess({ executable, args, stdinFile, workdir, timeLimit }) {
  const result = {
    code: null,
    signal: null,
    stdout: '',
    stderr: '',
    time: 0,
    memory: 0,
    timedOut: false,
    error: null,
  };

  let child;
  let inputFd = null;
  try {
    if (stdinFile) inputFd = fs.openSync(stdinFile, 'r');
    const t0 = process.hrtime.bigint();
    let stopped = false;

    child = spawn(executable, args, {
      cwd: workdir,
      stdio: [inputFd !== null ? inputFd : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: isWin,
    });

    let memMonitor;
    if (child.pid) {
      memMonitor = monitorMemory(child.pid, () => stopped).then(
        (m) => (result.memory = m)
      );
    }

    const timer = setTimeout(() => {
      result.timedOut = true;
      if (child && child.pid) killTree(child.pid);
    }, timeLimit);

    let bytes = 0;
    const MAX = 32 * 1024 * 1024;
    child.stdout.on('data', (d) => {
      bytes += d.length;
      if (bytes <= MAX) result.stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => (result.stderr += d.toString('utf8')));

    const exitCode = await new Promise((resolveExit) => {
      child.on('error', (err) => {
        result.error = err.message || String(err);
        resolveExit('error');
      });
      child.on('close', (code, signal) => {
        result.code = code;
        result.signal = signal;
        resolveExit(code);
      });
    });

    clearTimeout(timer);
    stopped = true;
    const t1 = process.hrtime.bigint();
    result.time = Number(t1 - t0) / 1e6; // ms
    if (memMonitor) await memMonitor;
    if (exitCode === 'error') result.code = null;
  } catch (e) {
    result.error = e.message || String(e);
  } finally {
    if (inputFd !== null) {
      try {
        fs.closeSync(inputFd);
      } catch (e) {}
    }
  }
  return result;
}

// ---- resolve executables for a language, honoring config overrides ----
function getCompileExe(langKey, langCfg, judgeCfg) {
  const ov = judgeCfg.executables && judgeCfg.executables[langKey];
  if (ov && ov.compiler) return ov.compiler;
  return resolveExecutable(langCfg.compile.command, langCfg.compile.fallbacks);
}
function getRunExe(langKey, langCfg, judgeCfg, vars) {
  const cmd = langCfg.run.command;
  if (cmd.includes('{')) return substitute(cmd, vars); // e.g. {out}
  const ov = judgeCfg.executables && judgeCfg.executables[langKey];
  if (ov && ov.interpreter) return ov.interpreter;
  return resolveExecutable(cmd, langCfg.run.fallbacks);
}

// ---- compile a Special Judge program (cached) ----
async function buildSpj(problemDir, spjCfg, judgeCfg) {
  const spjDir = path.join(problemDir, 'spj');
  const srcPath = path.join(spjDir, spjCfg.file);
  if (!fs.existsSync(srcPath)) {
    throw new Error('SPJ source not found: ' + srcPath);
  }
  if (spjCfg.lang === 'python') {
    const interp = resolveExecutable(judgeCfg.executables.python.interpreter, judgeCfg.executables.python.fallbacks);
    return { exe: interp, script: srcPath, lang: 'python' };
  }
  // default: cpp
  const exeName = isWin ? 'spj.exe' : 'spj';
  const exePath = path.join(spjDir, exeName);
  const srcMtime = fs.statSync(srcPath).mtimeMs;
  const needBuild =
    !fs.existsSync(exePath) || fs.statSync(exePath).mtimeMs < srcMtime;
  if (needBuild) {
    const compiler =
      (judgeCfg.executables.cpp.compiler) ||
      resolveExecutable('g++', ['g++.exe', 'mingw32-g++', 'clang++']);
    const r = await runProcess({
      executable: compiler,
      args: ['-O2', '-std=c++17', '-o', exePath, srcPath],
      stdinFile: null,
      workdir: spjDir,
      timeLimit: judgeCfg.spj.compileTimeout || 30000,
    });
    if (r.code !== 0) {
      throw new Error('SPJ compile failed: ' + (r.stderr || r.error));
    }
  }
  return { exe: exePath, script: null, lang: 'cpp' };
}

// ---- run SPJ against one test case ----
async function runSpj(spj, inputFile, userOutFile, stdOutFile, judgeCfg) {
  const args =
    spj.lang === 'python'
      ? [spj.script, inputFile, userOutFile, stdOutFile]
      : [inputFile, userOutFile, stdOutFile];
  const r = await runProcess({
    executable: spj.exe,
    args,
    stdinFile: null,
    workdir: path.dirname(spj.exe),
    timeLimit: judgeCfg.spj.runTimeLimit || 10000,
  });
  if (r.error) return { verdict: 'SE', detail: r.error };
  if (r.timedOut) return { verdict: 'WA', detail: 'SPJ TLE' };
  return { verdict: r.code === 0 ? 'AC' : 'WA', detail: r.stderr.trim() };
}

// ---- main entry: judge one submission ----
async function judgeSubmission({ problem, langKey, source, judgeCfg }) {
  const langCfg = judgeCfg.languages[langKey];
  if (!langCfg || !langCfg.enabled) {
    return { verdict: 'SE', error: 'Language not available: ' + langKey, cases: [] };
  }
  const problemDir = problem.dir;
  const workdir = fs.mkdtempSync(path.join(judgeCfg.tempDir || os.tmpdir(), 'oj-'));
  const ext = langCfg.extensions[0];
  const srcPath = path.join(workdir, 'solution.' + ext);
  const outBase = path.join(workdir, 'solution');
  const outExe =
    langCfg.outExtension && isWin
      ? outBase + langCfg.outExtension
      : outBase + (langCfg.outExtension || '');

  const vars = { src: srcPath, out: outExe, workdir };
  const compareCfg = judgeCfg.compare;

  try {
    fs.writeFileSync(srcPath, source);

    // 1) compile (if needed)
    if (langCfg.compile) {
      const compileExe = getCompileExe(langKey, langCfg, judgeCfg);
      const compileArgs = langCfg.compile.args.map((a) => substitute(a, vars));
      const cr = await runProcess({
        executable: compileExe,
        args: compileArgs,
        stdinFile: null,
        workdir,
        timeLimit: langCfg.compile.timeout || 30000,
      });
      if (cr.code !== 0) {
        return {
          verdict: 'CE',
          compileError: (cr.stderr || cr.error || 'compile error').slice(0, 4000),
          cases: [],
          time: 0,
          memory: 0,
        };
      }
    }

    // 2) SPJ (built once, reused)
    let spj = null;
    if (problem.spj) {
      try {
        spj = await buildSpj(problemDir, problem.spj, judgeCfg);
      } catch (e) {
        return { verdict: 'SE', error: e.message, cases: [] };
      }
    }

    // 3) run every test case
    const cases = [];
    let finalVerdict = 'AC';
    let maxTime = 0;
    let maxMem = 0;
    let passed = 0;

    for (const t of problem.tests) {
      const inputFile = path.join(problemDir, 'tests', t.in);
      const stdFile = path.join(problemDir, 'tests', t.out);
      const timeLimit = (t.timeLimit || problem.timeLimit) + (langCfg.run.timeLimitGrace || 0);
      const memLimitBytes = (t.memoryLimit || problem.memoryLimit) * 1024 * 1024;

      const runExe = getRunExe(langKey, langCfg, judgeCfg, vars);
      const runArgs = (langCfg.run.args || []).map((a) => substitute(a, vars));

      const r = await runProcess({
        executable: runExe,
        args: runArgs,
        stdinFile: inputFile,
        workdir,
        timeLimit,
      });

      let verdict;
      let detail = '';
      if (r.error) {
        verdict = 'RE';
        detail = r.error;
      } else if (r.timedOut) {
        verdict = 'TLE';
      } else if (r.code !== 0) {
        verdict = 'RE';
        detail = 'exit code ' + r.code + (r.signal ? ' signal ' + r.signal : '');
      } else if (r.memory > memLimitBytes) {
        verdict = 'MLE';
      } else {
        const userOutFile = path.join(workdir, 'user.out');
        fs.writeFileSync(userOutFile, r.stdout);
        if (spj) {
          const sp = await runSpj(spj, inputFile, userOutFile, stdFile, judgeCfg);
          verdict = sp.verdict;
          detail = sp.detail;
        } else {
          const std = fs.readFileSync(stdFile, 'utf8');
          verdict = compareOutputs(r.stdout, std, compareCfg);
        }
      }

      const caseTime = Math.round(r.time);
      const caseMemKB = Math.round(r.memory / 1024);
      maxTime = Math.max(maxTime, caseTime);
      maxMem = Math.max(maxMem, r.memory);
      if (verdict === 'AC') passed++;
      finalVerdict = worse(finalVerdict, verdict);
      cases.push({ name: t.name, verdict, time: caseTime, memory: caseMemKB, detail });
    }

    return {
      verdict: finalVerdict,
      cases,
      passed,
      total: problem.tests.length,
      time: maxTime,
      memory: Math.round(maxMem / 1024),
    };
  } catch (e) {
    return { verdict: 'SE', error: e.message, cases: [] };
  } finally {
    rmDirSafe(workdir);
  }
}

module.exports = {
  judgeSubmission,
  compareOutputs,
  normalizeStrict,
  normalizeLoose,
  worse,
};
