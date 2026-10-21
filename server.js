'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.OJ_PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOT_DIR = __dirname;

const { loadLanguages, loadProblem, loadProblemEditable, listProblems, listLanguages, PROBLEMS_DIR, saveProblem, deleteProblem, importProblemsFromZip, previewImport } = require('./src/problems');
const { judgeSubmission } = require('./src/judge');
const { parseZip, matchCases } = require('./src/zip');
const storage = require('./src/storage');

const judgeCfg = loadLanguages();
const LANGS = listLanguages(judgeCfg);

// ---- judge queue (bounded concurrency) ----
const queue = [];
let active = 0;
const MAX_CONCURRENCY = judgeCfg && require('./config/judge.json').judgeConcurrency || 1;

async function worker() {
  if (active >= MAX_CONCURRENCY) return;
  if (queue.length === 0) return;
  active++;
  const job = queue.shift();
  try {
    const problem = loadProblem(job.problemId);
    if (!problem) {
      storage.updateSubmission(job.id, { status: 'Done', verdict: 'SE', error: 'Problem not found' });
    } else {
      const res = await judgeSubmission({
        problem,
        langKey: job.language,
        source: job.code,
        judgeCfg,
      });
      storage.updateSubmission(job.id, {
        status: 'Done',
        verdict: res.verdict,
        compileError: res.compileError || null,
        error: res.error || null,
        cases: res.cases || [],
        passed: res.passed || 0,
        total: res.total || problem.tests.length,
        time: res.time || 0,
        memory: res.memory || 0,
      });
    }
  } catch (e) {
    storage.updateSubmission(job.id, { status: 'Done', verdict: 'SE', error: e.message });
  } finally {
    active--;
    setImmediate(worker);
  }
}

function enqueue(job) {
  queue.push(job);
  worker();
}

// ---- helpers ----
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---- per-problem completion status (no user accounts: global across submissions) ----
function problemStatus(id) {
  const arr = storage.listAllSubmissions().filter((s) => s.problemId === id);
  for (const s of arr) if (s.verdict === 'AC' && s.passed === s.total) return 'AC';
  return arr.length ? (arr[0].verdict || 'NONE') : 'NONE';
}

// ---- routing ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      // ---- languages ----
      if (pathname === '/api/languages' && req.method === 'GET') {
        return sendJSON(res, 200, { languages: LANGS, config: judgeCfg.compare });
      }
      // ---- problem list (with per-problem completion status) ----
      if (pathname === '/api/problems' && req.method === 'GET') {
        const problems = listProblems();
        for (const p of problems) p.status = problemStatus(p.id);
        return sendJSON(res, 200, { problems });
      }
      // ---- single problem ----
      const probMatch = pathname.match(/^\/api\/problem\/([^/]+)$/);
      if (probMatch && req.method === 'GET') {
        const full = url.searchParams.get('full') === '1';
        if (full) {
          const ed = loadProblemEditable(probMatch[1]);
          if (!ed) return sendJSON(res, 404, { error: 'Problem not found' });
          return sendJSON(res, 200, ed);
        }
        const p = loadProblem(probMatch[1]);
        if (!p) return sendJSON(res, 404, { error: 'Problem not found' });
        p.status = problemStatus(probMatch[1]);
        return sendJSON(res, 200, p);
      }
      // ---- update problem ----
      if (probMatch && req.method === 'PUT') {
        try {
          const id = probMatch[1];
          if (!loadProblem(id)) return sendJSON(res, 404, { error: '题目不存在' });
          const body = JSON.parse(await readBody(req));
          if (!body.title) return sendJSON(res, 400, { error: '标题必填' });
          saveProblem(id, body);
          return sendJSON(res, 200, { ok: true, id });
        } catch (e) {
          return sendJSON(res, 500, { error: e.message });
        }
      }
      // ---- delete problem ----
      if (probMatch && req.method === 'DELETE') {
        try {
          const id = probMatch[1];
          if (!loadProblem(id)) return sendJSON(res, 404, { error: '题目不存在' });
          deleteProblem(id);
          return sendJSON(res, 200, { ok: true });
        } catch (e) {
          return sendJSON(res, 500, { error: e.message });
        }
      }
      // ---- submit ----
      if (pathname === '/api/submit' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        if (!body.problemId || !body.language || !body.code) {
          return sendJSON(res, 400, { error: 'problemId, language and code are required' });
        }
        const p = loadProblem(body.problemId);
        if (!p) return sendJSON(res, 404, { error: 'Problem not found' });
        if (!judgeCfg.languages[body.language] || !judgeCfg.languages[body.language].enabled) {
          return sendJSON(res, 400, { error: 'Language not available' });
        }
        const rec = storage.createSubmission({
          problemId: body.problemId,
          problemTitle: p.title,
          language: body.language,
          code: body.code,
        });
        enqueue({ id: rec.id, problemId: body.problemId, language: body.language, code: body.code });
        return sendJSON(res, 200, { id: rec.id });
      }
      // ---- submissions list (optional ?problemId= filter, ?limit=) ----
      if (pathname === '/api/submissions' && req.method === 'GET') {
        const problemId = url.searchParams.get('problemId');
        const limit = parseInt(url.searchParams.get('limit') || '50', 10) || 50;
        let subs = storage.listSubmissions(limit);
        if (problemId) subs = subs.filter((s) => s.problemId === problemId);
        return sendJSON(res, 200, { submissions: subs });
      }
      // ---- batch parse test cases (ZIP) ----
      if (pathname === '/api/problem/parse-cases' && req.method === 'POST') {
        try {
          const body = JSON.parse(await readBody(req));
          if (body.format !== 'zip' || !body.data) {
            return sendJSON(res, 400, { error: '需要 format=zip 与 base64 数据' });
          }
          const buf = Buffer.from(body.data, 'base64');
          let files;
          try { files = parseZip(buf); }
          catch (e) { return sendJSON(res, 400, { error: 'ZIP 解析失败：' + e.message }); }
          if (!files.length) return sendJSON(res, 400, { error: '压缩包为空' });
          const { cases, skipped } = matchCases(files);
          if (!cases.length) {
            return sendJSON(res, 400, { error: '未找到可配对的测试文件（需要 *.in 与 *.out/*.ans/*.sol）', skipped });
          }
          return sendJSON(res, 200, { cases, skipped, count: cases.length });
        } catch (e) {
          return sendJSON(res, 400, { error: e.message });
        }
      }
      // ---- batch import problems: preview ----
      if (pathname === '/api/problems/import-preview' && req.method === 'POST') {
        try {
          const body = JSON.parse(await readBody(req));
          if (!body.data) return sendJSON(res, 400, { error: '需要 base64 数据' });
          const buf = Buffer.from(body.data, 'base64');
          return sendJSON(res, 200, previewImport(buf));
        } catch (e) {
          return sendJSON(res, 400, { error: e.message });
        }
      }
      // ---- batch import problems: import ----
      if (pathname === '/api/problems/import' && req.method === 'POST') {
        try {
          const body = JSON.parse(await readBody(req));
          if (!body.data) return sendJSON(res, 400, { error: '需要 base64 数据' });
          const mode = body.mode === 'overwrite' ? 'overwrite' : 'skip';
          const buf = Buffer.from(body.data, 'base64');
          return sendJSON(res, 200, importProblemsFromZip(buf, mode));
        } catch (e) {
          return sendJSON(res, 400, { error: e.message });
        }
      }
      // ---- create problem ----
      if (pathname === '/api/problem' && req.method === 'POST') {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJSON(res, 400, { error: '请求体不是合法 JSON' }); }
        if (!body.id || !body.title) {
          return sendJSON(res, 400, { error: '题号和标题为必填项' });
        }
        const id = String(body.id).replace(/[^\w-]/g, '');
        if (!id) return sendJSON(res, 400, { error: '题号非法' });
        if (loadProblem(id)) return sendJSON(res, 400, { error: '该题目已存在' });
        const cases = Array.isArray(body.cases) ? body.cases : [];
        if (!cases.length) return sendJSON(res, 400, { error: '至少需要一个测试点' });
        try {
          saveProblem(id, body);
        } catch (e) {
          return sendJSON(res, 500, { error: '保存失败：' + e.message });
        }
        return sendJSON(res, 200, { ok: true, id });
      }
      // ---- single submission ----
      const subMatch = pathname.match(/^\/api\/submission\/([^/]+)$/);
      if (subMatch && req.method === 'GET') {
        const s = storage.getSubmission(subMatch[1]);
        if (!s) return sendJSON(res, 404, { error: 'Submission not found' });
        return sendJSON(res, 200, s);
      }
      return sendJSON(res, 404, { error: 'API not found' });
    }

    // static
    return serveStatic(req, res, pathname);
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Local OJ running at http://localhost:${PORT}`);
  console.log(`Loaded languages: ${LANGS.map((l) => l.name).join(', ')}`);
});
