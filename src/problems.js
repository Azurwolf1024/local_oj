'use strict';
const fs = require('fs');
const path = require('path');
const { parseZip } = require('./zip');

const PROBLEMS_DIR = path.join(__dirname, '..', 'problems');

function loadLanguages() {
  const langCfg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'languages.json'), 'utf8')
  );
  const judgeCfg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'judge.json'), 'utf8')
  );
  const merged = {
    languages: {},
    compare: langCfg.default.compare,
    tempDir: judgeCfg.tempDir || null,
    spj: judgeCfg.spj,
    executables: judgeCfg.executables,
  };
  for (const [key, cfg] of Object.entries(langCfg.languages)) {
    const lang = JSON.parse(JSON.stringify(cfg));
    // per-language time/memory defaults from global default (overridable per problem)
    merged.languages[key] = lang;
  }
  return merged;
}

function loadProblem(id, opts = {}) {
  const withContent = !!opts.withContent;
  const dir = path.join(PROBLEMS_DIR, String(id));
  const metaPath = path.join(dir, 'problem.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  const testsDir = path.join(dir, 'tests');
  const tests = (meta.tests || []).map((t, i) => {
    const name = t.name || String(i + 1);
    const inFile = t.in || `${i + 1}.in`;
    const outFile = t.out || `${i + 1}.out`;
    let input = null, output = null;
    if (withContent) {
      try { input = fs.readFileSync(path.join(testsDir, inFile), 'utf8'); } catch (e) { input = ''; }
      try { output = fs.readFileSync(path.join(testsDir, outFile), 'utf8'); } catch (e) { output = ''; }
    }
    return {
      name,
      in: inFile,
      out: outFile,
      input,
      output,
      timeLimit: t.timeLimit || meta.timeLimit,
      memoryLimit: t.memoryLimit || meta.memoryLimit,
    };
  });

  return {
    id: String(id),
    dir,
    title: meta.title,
    timeLimit: meta.timeLimit,
    memoryLimit: meta.memoryLimit,
    difficulty: meta.difficulty || 'Easy',
    description: meta.description || '',
    input: meta.input || '',
    output: meta.output || '',
    note: meta.note || '',
    samples: meta.samples || [],
    spj: meta.spj || null,
    tests,
  };
}

// Returns a fully editable representation (includes test contents + SPJ source).
function loadProblemEditable(id) {
  const p = loadProblem(id, { withContent: true });
  if (!p) return null;
  let spj = { enabled: false, lang: 'cpp', source: '' };
  if (p.spj) {
    let src = '';
    try { src = fs.readFileSync(path.join(p.dir, 'spj', p.spj.file), 'utf8'); } catch (e) {}
    spj = { enabled: true, lang: p.spj.lang, source: src };
  }
  return {
    id: p.id,
    title: p.title,
    difficulty: p.difficulty,
    timeLimit: p.timeLimit,
    memoryLimit: p.memoryLimit,
    description: p.description,
    input: p.input,
    output: p.output,
    note: p.note,
    samples: p.samples || [],
    spj,
    cases: p.tests.map((t) => ({ input: t.input || '', output: t.output || '' })),
  };
}

function listProblems() {
  if (!fs.existsSync(PROBLEMS_DIR)) return [];
  return fs
    .readdirSync(PROBLEMS_DIR)
    .filter((d) => fs.statSync(path.join(PROBLEMS_DIR, d)).isDirectory())
    .map((id) => {
      const p = loadProblem(id);
      if (!p) return null;
      return {
        id: p.id,
        title: p.title,
        difficulty: p.difficulty,
        timeLimit: p.timeLimit,
        memoryLimit: p.memoryLimit,
        spj: !!p.spj,
        testCount: p.tests.length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function listLanguages(judgeCfg) {
  return Object.entries(judgeCfg.languages)
    .filter(([, c]) => c.enabled)
    .map(([key, c]) => ({ key, name: c.name }));
}

// Create or overwrite a problem directory from a request body.
// `body.cases` = [{input, output}], `body.spj` = {enabled, lang, source} | null
function saveProblem(id, body) {
  const dir = path.join(PROBLEMS_DIR, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });

  const cases = Array.isArray(body.cases) ? body.cases : [];
  const tests = [];
  cases.forEach((c, i) => {
    const n = i + 1;
    fs.writeFileSync(path.join(dir, 'tests', n + '.in'), c.input != null ? String(c.input) : '');
    fs.writeFileSync(path.join(dir, 'tests', n + '.out'), c.output != null ? String(c.output) : '');
    tests.push({ name: '#' + n, in: n + '.in', out: n + '.out' });
  });

  let spj = null;
  if (body.spj && body.spj.enabled) {
    fs.mkdirSync(path.join(dir, 'spj'), { recursive: true });
    const lang = body.spj.lang === 'python' ? 'python' : 'cpp';
    const fname = 'spj.' + (lang === 'python' ? 'py' : 'cpp');
    fs.writeFileSync(path.join(dir, 'spj', fname), body.spj.source || '');
    spj = { lang, file: fname };
  }

  const meta = {
    id,
    title: String(body.title),
    difficulty: body.difficulty || 'Easy',
    timeLimit: Number(body.timeLimit) || 1000,
    memoryLimit: Number(body.memoryLimit) || 256,
    description: body.description || '',
    input: body.input || '',
    output: body.output || '',
    note: body.note || '',
    samples: Array.isArray(body.samples) ? body.samples : [],
    spj,
    tests,
  };
  fs.writeFileSync(path.join(dir, 'problem.json'), JSON.stringify(meta, null, 2));
}

// Remove a problem directory (path-traversal protected).
function deleteProblem(id) {
  const dir = path.join(PROBLEMS_DIR, String(id));
  const base = fs.realpathSync(PROBLEMS_DIR);
  const target = fs.realpathSync(dir);
  if (!target.startsWith(base)) throw new Error('非法路径');
  fs.rmSync(target, { recursive: true, force: true });
}

// ---- batch import problems from a ZIP of problem folders ----
// ZIP layout: each problem is a folder containing problem.json + tests/ (+ optional spj/).
// A top-level wrapper directory is tolerated.

// Scan a ZIP and return import plans + structural errors, without writing anything.
function planImport(buf) {
  const entries = parseZip(buf);
  const folderFiles = new Map(); // folderPrefix -> true
  for (const f of entries) {
    if (f.name.toLowerCase().endsWith('problem.json')) {
      const folder = f.name.slice(0, f.name.length - 'problem.json'.length);
      if (!folderFiles.has(folder)) folderFiles.set(folder, true);
    }
  }

  const plans = [];
  const errors = [];
  for (const folder of folderFiles.keys()) {
    const list = entries.filter((e) => e.name === folder || e.name.startsWith(folder));
    const metaEntry = list.find((e) => e.name.toLowerCase().endsWith('problem.json'));
    if (!metaEntry) continue;

    const segments = folder.split('/').filter((s) => s.length);
    let base = (segments.length ? segments[segments.length - 1] : '').replace(/[^\w-]/g, '');
    if (!base) {
      errors.push({ folder, reason: '无法确定题号（目录名非法）' });
      continue;
    }
    let meta;
    try {
      meta = JSON.parse(metaEntry.data.toString('utf8'));
    } catch (e) {
      errors.push({ folder, reason: 'problem.json 不是合法 JSON' });
      continue;
    }
    if (!meta.title) {
      errors.push({ folder: base, reason: '缺少 title' });
      continue;
    }
    plans.push({ folder, base, meta, list });
  }
  return { plans, errors };
}

// Safe write of one zip entry relative to a problem dir (path-traversal protected).
function writeEntry(targetDir, relPath, data) {
  fs.mkdirSync(targetDir, { recursive: true });
  const base = fs.realpathSync(targetDir);
  const full = path.normalize(path.join(targetDir, relPath));
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error('路径越界: ' + relPath);
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
}

// Preview what would be imported (no writes).
function previewImport(buf) {
  const { plans, errors } = planImport(buf);
  const problems = plans.map((p) => ({
    id: p.base,
    title: String(p.meta.title),
    testCount: Array.isArray(p.meta.tests) ? p.meta.tests.length : 0,
    exists: fs.existsSync(path.join(PROBLEMS_DIR, p.base)),
  }));
  return { problems, errors };
}

// Actually import the problems. mode: 'skip' (default) | 'overwrite'.
function importProblemsFromZip(buf, mode = 'skip') {
  const { plans, errors } = planImport(buf);
  const imported = [];
  const skipped = [];
  for (const p of plans) {
    const targetDir = path.join(PROBLEMS_DIR, p.base);
    if (fs.existsSync(targetDir)) {
      if (mode === 'skip') {
        skipped.push({ id: p.base, reason: '已存在（跳过）' });
        continue;
      }
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });
    try {
      for (const e of p.list) {
        if (e.name === p.folder) continue; // folder entry itself
        if (e.name.endsWith('/')) continue; // directory entry
        let rel = e.name.slice(p.folder.length);
        if (rel.startsWith('/')) rel = rel.slice(1);
        if (!rel) continue;
        writeEntry(targetDir, rel, e.data);
      }
      // keep meta.id consistent with the folder name used as the problem id
      p.meta.id = p.base;
      fs.writeFileSync(path.join(targetDir, 'problem.json'), JSON.stringify(p.meta, null, 2));
      imported.push({ id: p.base, title: String(p.meta.title) });
    } catch (e) {
      errors.push({ folder: p.base, reason: e.message });
    }
  }
  return { imported, skipped, errors };
}

module.exports = {
  loadLanguages, loadProblem, loadProblemEditable, listProblems, listLanguages,
  saveProblem, deleteProblem, importProblemsFromZip, previewImport, PROBLEMS_DIR,
};
