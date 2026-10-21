'use strict';

const app = document.getElementById('app');
let editingId = null; // set when editing an existing problem

const VERDICT_TEXT = {
  AC: 'Accepted', WA: 'Wrong Answer', PE: 'Presentation Error',
  TLE: 'Time Limit Exceeded', MLE: 'Memory Limit Exceeded',
  RE: 'Runtime Error', CE: 'Compile Error', SE: 'System Error',
  Judging: 'Judging…',
};

function badge(verdict) {
  return `<span class="badge b-${verdict}">${VERDICT_TEXT[verdict] || verdict}</span>`;
}

function statusBadge(s) {
  if (!s || s === 'NONE') return '<span class="badge b-none">未做</span>';
  return badge(s);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = '请求失败';
    try { msg = (await res.json()).error || msg; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

function navActive() {
  const hash = location.hash || '#/';
  document.querySelectorAll('nav.links a').forEach((a) => {
    const target = a.getAttribute('href');
    a.classList.toggle('active', hash.startsWith(target) && target !== '#/');
    if (target === '#/' && hash === '#/') a.classList.add('active');
  });
}

// ---------- Views ----------
async function renderProblemList() {
  navActive();
  app.innerHTML = `<div class="loading">加载题目列表…</div>`;
  const { problems } = await api('/api/problems');
  if (!problems.length) {
    app.innerHTML = `<div class="empty">暂无题目。请在 problems/ 目录下添加题目。</div>`;
    return;
  }
  app.innerHTML = `
    <div class="card">
      <h2>题目列表</h2>
      <table>
        <thead><tr>
          <th style="width:70px">题号</th><th>标题</th><th style="width:90px">状态</th>
          <th style="width:110px">难度</th><th style="width:80px">限时</th><th style="width:80px">内存</th>
          <th style="width:60px">SPJ</th><th style="width:60px">测试点</th><th style="width:120px">操作</th>
        </tr></thead>
        <tbody>
          ${problems.map((p) => `
            <tr>
              <td><a href="#/problem/${p.id}">${p.id}</a></td>
              <td><a href="#/problem/${p.id}">${escapeHtml(p.title)}</a></td>
              <td>${statusBadge(p.status)}</td>
              <td>${escapeHtml(p.difficulty)}</td>
              <td>${p.timeLimit} ms</td>
              <td>${p.memoryLimit} MB</td>
              <td>${p.spj ? '是' : '—'}</td>
              <td>${p.testCount}</td>
              <td class="row-actions">
                <a href="#/edit/${p.id}">编辑</a>
                <button class="link-danger" data-del="${p.id}">删除</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  app.querySelectorAll('button[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      const pid = b.getAttribute('data-del');
      if (!confirm(`确定删除题目 ${pid} 吗？该操作不可恢复，且会一并删除其测试点与 SPJ。`)) return;
      try {
        await api('/api/problem/' + pid, { method: 'DELETE' });
        await renderProblemList();
      } catch (e) {
        alert('删除失败：' + e.message);
      }
    });
  });
}

async function renderProblem(id) {
  navActive();
  app.innerHTML = `<div class="loading">加载题目…</div>`;
  const p = await api('/api/problem/' + id);
  const { languages } = await api('/api/languages');

  app.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="problem-title">${p.id}. ${escapeHtml(p.title)}</div>
        ${statusBadge(p.status)}
        <span style="margin-left:auto"></span>
        <a class="pill" href="#/edit/${p.id}">编辑</a>
        <button class="pill danger" data-del="${p.id}">删除</button>
      </div>
      <div class="meta-row">
        <span>难度：${escapeHtml(p.difficulty)}</span>
        <span>时间限制：${p.timeLimit} ms</span>
        <span>内存限制：${p.memoryLimit} MB</span>
        ${p.spj ? '<span>Special Judge</span>' : ''}
      </div>
      <div class="section"><h3>题目描述</h3><div>${escapeHtml(p.description).replace(/\n/g, '<br>')}</div></div>
      <div class="section"><h3>输入</h3><div>${escapeHtml(p.input).replace(/\n/g, '<br>')}</div></div>
      <div class="section"><h3>输出</h3><div>${escapeHtml(p.output).replace(/\n/g, '<br>')}</div></div>
      ${p.note ? `<div class="section"><h3>提示</h3><div>${escapeHtml(p.note).replace(/\n/g, '<br>')}</div></div>` : ''}
      ${p.samples && p.samples.length ? `
        <div class="section"><h3>样例</h3>
          ${p.samples.map((s) => `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
              <div><div class="kv">输入</div><pre>${escapeHtml(s.input)}</pre></div>
              <div><div class="kv">输出</div><pre>${escapeHtml(s.output)}</pre></div>
            </div>`).join('')}
        </div>` : ''}
    </div>

    <div class="card">
      <h2>提交代码</h2>
      <div class="section">
        <textarea id="code" spellcheck="false" placeholder="在此粘贴你的代码…"></textarea>
        <div class="controls">
          <label>语言：
            <select id="lang">
              ${languages.map((l) => `<option value="${l.key}">${escapeHtml(l.name)}</option>`).join('')}
            </select>
          </label>
          <button class="primary" id="submitBtn">提交</button>
          <span id="submitMsg" style="color:var(--muted);font-size:13px"></span>
        </div>
        <div class="section" id="resultBox" style="display:none"></div>
      </div>
    </div>`;

  const delBtn = app.querySelector('button[data-del]');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm(`确定删除题目 ${p.id} 吗？该操作不可恢复。`)) return;
      try {
        await api('/api/problem/' + p.id, { method: 'DELETE' });
        location.hash = '#/';
      } catch (e) {
        alert('删除失败：' + e.message);
      }
    });
  }

  const ta = document.getElementById('code');
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 4;
    }
  });

  document.getElementById('submitBtn').addEventListener('click', () => submit(p));
}

async function submit(p) {
  const code = document.getElementById('code').value;
  const lang = document.getElementById('lang').value;
  const msg = document.getElementById('submitMsg');
  const btn = document.getElementById('submitBtn');
  if (!code.trim()) { msg.textContent = '代码不能为空'; return; }
  msg.textContent = '提交中…';
  btn.disabled = true;
  try {
    const { id } = await api('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemId: p.id, language: lang, code }),
    });
    msg.textContent = '';
    await pollSubmission(id);
  } catch (e) {
    msg.textContent = '错误：' + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function pollSubmission(id) {
  const box = document.getElementById('resultBox');
  box.style.display = 'block';
  while (true) {
    const s = await api('/api/submission/' + id);
    if (s.status === 'Done') { renderResult(box, s); return; }
    box.innerHTML = `<div class="loading">评测中… <span class="pill">${escapeHtml(s.verdict || 'Judging')}</span></div>`;
    await new Promise((r) => setTimeout(r, 700));
  }
}

function renderResult(box, s) {
  let casesHtml = '';
  if (s.cases && s.cases.length) {
    casesHtml = `<div class="cases">${s.cases.map((c) =>
      `<div class="case-row"><span class="cname">${escapeHtml(c.name)}</span>${badge(c.verdict)}
       <span class="cmeta">${c.time} ms · ${c.memory} KB${c.detail ? ' · ' + escapeHtml(c.detail) : ''}</span></div>`
    ).join('')}</div>`;
  }
  box.innerHTML = `
    <h3>评测结果</h3>
    <div style="display:flex;gap:16px;align-items:center;margin:8px 0">
      ${badge(s.verdict)}
      <span class="kv">通过 ${s.passed}/${s.total}</span>
      <span class="kv">耗时 ${s.time} ms</span>
      <span class="kv">内存 ${s.memory} KB</span>
      <a class="pill" href="#/submission/${s.id}">查看详情</a>
    </div>
    ${s.compileError ? `<div class="err-box">编译错误：\n${escapeHtml(s.compileError)}</div>` : ''}
    ${s.error ? `<div class="err-box">系统错误：\n${escapeHtml(s.error)}</div>` : ''}
    ${casesHtml}`;
}

async function renderSubmissions() {
  navActive();
  app.innerHTML = `<div class="loading">加载提交记录…</div>`;
  const { submissions } = await api('/api/submissions?limit=1000');
  if (!submissions.length) {
    app.innerHTML = `<div class="empty">还没有提交记录。</div>`;
    return;
  }
  // distinct problems for the filter dropdown
  const problems = [];
  const seen = new Set();
  for (const s of submissions) {
    if (seen.has(s.problemId)) continue;
    seen.add(s.problemId);
    problems.push({ id: s.problemId, title: s.problemTitle || s.problemId });
  }
  problems.sort((a, b) => a.id.localeCompare(b.id));

  const render = (list) => {
    if (!list.length) {
      return `<div class="empty">该题目暂无提交记录。</div>`;
    }
    return `
      <table>
        <thead><tr><th>编号</th><th>题目</th><th>语言</th><th>结果</th><th>通过</th><th>提交时间</th></tr></thead>
        <tbody>
          ${list.map((s) => `
            <tr>
              <td><a href="#/submission/${s.id}">${s.id.slice(-8)}</a></td>
              <td><a href="#/problem/${s.problemId}">${s.problemId} · ${escapeHtml(s.problemTitle || '')}</a></td>
              <td>${escapeHtml(s.language)}</td>
              <td>${badge(s.status === 'Judging' ? 'Judging' : s.verdict)}</td>
              <td>${s.passed}/${s.total}</td>
              <td style="color:var(--muted)">${new Date(s.submittedAt).toLocaleString()}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  };

  app.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <h2>提交记录</h2>
        <span style="margin-left:auto"></span>
        <label class="sub-filter">筛选题目：
          <select id="sub-filter">
            <option value="">全部</option>
            ${problems.map((p) => `<option value="${p.id}">${p.id} · ${escapeHtml(p.title)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div id="sub-table">${render(submissions)}</div>
    </div>`;

  const select = document.getElementById('sub-filter');
  select.addEventListener('change', () => {
    const pid = select.value;
    const list = pid ? submissions.filter((s) => s.problemId === pid) : submissions;
    document.getElementById('sub-table').innerHTML = render(list);
  });
}

async function renderSubmission(id) {
  navActive();
  app.innerHTML = `<div class="loading">加载提交…</div>`;
  const s = await api('/api/submission/' + id);
  let casesHtml = '';
  if (s.cases && s.cases.length) {
    casesHtml = `<div class="cases">${s.cases.map((c) =>
      `<div class="case-row"><span class="cname">${escapeHtml(c.name)}</span>${badge(c.verdict)}
       <span class="cmeta">${c.time} ms · ${c.memory} KB${c.detail ? ' · ' + escapeHtml(c.detail) : ''}</span></div>`
    ).join('')}</div>`;
  }
  app.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <h2>提交 ${s.id.slice(-8)}</h2>
        ${badge(s.status === 'Judging' ? 'Judging' : s.verdict)}
      </div>
      <table>
        <tr><td style="color:var(--muted)">题目</td><td><a href="#/problem/${s.problemId}">${s.problemId} · ${escapeHtml(s.problemTitle || '')}</a></td></tr>
        <tr><td style="color:var(--muted)">语言</td><td>${escapeHtml(s.language)}</td></tr>
        <tr><td style="color:var(--muted)">通过</td><td>${s.passed}/${s.total}</td></tr>
        <tr><td style="color:var(--muted)">耗时</td><td>${s.time} ms</td></tr>
        <tr><td style="color:var(--muted)">内存</td><td>${s.memory} KB</td></tr>
        <tr><td style="color:var(--muted)">提交时间</td><td>${new Date(s.submittedAt).toLocaleString()}</td></tr>
      </table>
      ${s.compileError ? `<div class="section"><h3>编译错误</h3><div class="err-box">${escapeHtml(s.compileError)}</div></div>` : ''}
      ${s.error ? `<div class="section"><h3>系统错误</h3><div class="err-box">${escapeHtml(s.error)}</div></div>` : ''}
      <div class="section"><h3>测试点</h3>${casesHtml}</div>
      <div class="section"><h3>源代码</h3><pre>${escapeHtml(s.code || '')}</pre></div>
    </div>`;
  if (s.status !== 'Done') setTimeout(() => renderSubmission(id), 1000);
}

// ---------- new problem / edit ----------
async function renderNewProblem(id) {
  navActive();
  let ed = null;
  if (id) {
    try { ed = await api('/api/problem/' + id + '?full=1'); }
    catch (e) {
      app.innerHTML = `<div class="err-box">加载题目失败：${escapeHtml(e.message)}</div>`;
      return;
    }
  }
  app.innerHTML = `
    <div class="card">
      <h2>${ed ? '编辑题目' : '新建题目'}</h2>
      <div class="section np-grid">
        <label>题号（唯一，如 1004）：<input id="np-id" class="np-input" placeholder="1004" /></label>
        <label>标题：<input id="np-title" class="np-input" placeholder="题目标题" /></label>
        <label>难度：
          <select id="np-diff"><option>Easy</option><option>Medium</option><option>Hard</option></select>
        </label>
        <label>时间限制(ms)：<input id="np-tl" class="np-input" value="1000" /></label>
        <label>内存限制(MB)：<input id="np-ml" class="np-input" value="256" /></label>
      </div>
      <div class="section">
        <h3>题目描述</h3><textarea id="np-desc" class="np-ta"></textarea>
        <h3>输入说明</h3><textarea id="np-in" class="np-ta"></textarea>
        <h3>输出说明</h3><textarea id="np-out" class="np-ta"></textarea>
        <h3>提示（可选）</h3><textarea id="np-note" class="np-ta"></textarea>
      </div>
      <div class="section">
        <h3>测试点
          <button id="np-bulk-toggle" type="button" class="secondary small">批量导入 ▾</button>
        </h3>
        <div id="np-cases"></div>
        <button id="np-addcase">+ 添加测试点</button>

        <div id="np-bulk" class="bulk-box" style="display:none">
          <label class="np-check"><input type="checkbox" id="np-bulk-replace" /> 覆盖（替换）已有测试点，而非追加</label>
          <div class="bulk-tabs">
            <button type="button" class="tab active" data-tab="zip">ZIP 文件</button>
            <button type="button" class="tab" data-tab="text">文本格式</button>
          </div>

          <div class="bulk-pane" data-pane="zip">
            <p class="hint">压缩包内放成对的测试文件，如 <code>1.in</code> / <code>1.out</code>（也支持 <code>.ans</code> / <code>.sol</code>）。按文件名自动配对、按数字排序。</p>
            <input type="file" id="np-zip" accept=".zip" />
            <button id="np-zip-import" class="primary" type="button">解析并导入</button>
            <span id="np-zip-msg"></span>
          </div>

          <div class="bulk-pane" data-pane="text" style="display:none">
            <p class="hint">格式：<code>[CASE]</code> 开始一个新用例，单独一行的 <code>===</code> 分割「输入」与「期望输出」，多个用例依次排列。</p>
            <textarea id="np-bulk-text" class="np-ta" placeholder="[CASE]
1 2
===
3
[CASE]
4 5
===
9"></textarea>
            <button id="np-text-import" class="primary" type="button">解析并导入</button>
            <span id="np-text-msg"></span>
          </div>
        </div>
      </div>
      <div class="section">
        <label class="np-check"><input type="checkbox" id="np-spj" /> 使用 Special Judge (SPJ)</label>
        <div id="np-spj-box" style="display:none">
          <label>SPJ 语言：
            <select id="np-spj-lang"><option value="cpp">C++</option><option value="python">Python</option></select>
          </label>
          <h3>SPJ 源码 <span style="color:var(--muted);font-weight:400">(约定: spj &lt;输入&gt; &lt;用户输出&gt; &lt;标准输出&gt;，返回 0 为 AC)</span></h3>
          <textarea id="np-spj-src" class="np-ta" placeholder="// your special judge source"></textarea>
        </div>
      </div>
      <div class="section">
        <h3>批量导入题目
          <button id="np-batch-toggle" type="button" class="secondary small">批量导入 ▾</button>
        </h3>
        <div id="np-batch" class="bulk-box" style="display:none">
          <p class="hint">上传一个 ZIP，里面每个包含 <code>problem.json</code> 的子目录会被识别为一道题（复用本地题目目录结构：<code>tests/*.in</code> / <code>tests/*.out</code> 与可选的 <code>spj/</code>）。顶层可再套一层目录。</p>
          <input type="file" id="np-batch-zip" accept=".zip" />
          <div style="margin:10px 0">
            <label class="np-check"><input type="radio" name="np-batch-mode" value="skip" checked /> 已存在则跳过</label>
            <label class="np-check"><input type="radio" name="np-batch-mode" value="overwrite" /> 覆盖已存在</label>
          </div>
          <button id="np-batch-parse" class="primary" type="button">解析预览</button>
          <button id="np-batch-import" class="secondary" type="button" style="display:none">确认导入</button>
          <span id="np-batch-msg"></span>
          <div id="np-batch-preview" class="batch-preview"></div>
        </div>
      </div>
      <div class="controls">
        <button class="primary" id="np-submit">创建题目</button>
        <span id="np-msg"></span>
      </div>
    </div>`;

  const casesBox = document.getElementById('np-cases');

  function makeCase(input = '', output = '') {
    const d = document.createElement('div');
    d.className = 'case-edit';
    d.innerHTML = `<textarea class="np-case-in" placeholder="输入 stdin"></textarea><textarea class="np-case-out" placeholder="期望输出 stdout"></textarea><button class="np-del" type="button">删除</button>`;
    d.querySelector('.np-case-in').value = input;
    d.querySelector('.np-case-out').value = output;
    d.querySelector('.np-del').addEventListener('click', () => d.remove());
    casesBox.appendChild(d);
  }
  function addCases(arr, replace) {
    if (replace) casesBox.querySelectorAll('.case-edit').forEach((el) => el.remove());
    (arr || []).forEach((c) => makeCase(c.input || '', c.output || ''));
  }
  makeCase();
  document.getElementById('np-addcase').addEventListener('click', () => makeCase());

  // ---- bulk import panel ----
  const bulkBox = document.getElementById('np-bulk');
  document.getElementById('np-bulk-toggle').addEventListener('click', (e) => {
    const open = bulkBox.style.display !== 'none';
    bulkBox.style.display = open ? 'none' : 'block';
    e.target.textContent = open ? '批量导入 ▾' : '批量导入 ▴';
  });
  bulkBox.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      bulkBox.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.getAttribute('data-tab');
      bulkBox.querySelectorAll('.bulk-pane').forEach((p) => {
        p.style.display = p.getAttribute('data-pane') === tabName ? 'block' : 'none';
      });
    });
  });
  const replaceChk = document.getElementById('np-bulk-replace');

  // ZIP import
  document.getElementById('np-zip-import').addEventListener('click', async () => {
    const fileInput = document.getElementById('np-zip');
    const msg = document.getElementById('np-zip-msg');
    const file = fileInput.files && fileInput.files[0];
    if (!file) { msg.textContent = '请先选择 .zip 文件'; msg.style.color = 'var(--danger)'; return; }
    msg.textContent = '解析中…'; msg.style.color = '';
    try {
      const b64 = await file.text().then((t) => btoa(unescape(encodeURIComponent(t))));
      const r = await api('/api/problem/parse-cases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'zip', data: b64 }),
      });
      addCases(r.cases, replaceChk.checked);
      let m = `已导入 ${r.count} 个测试点`;
      if (r.skipped && r.skipped.length) m += `（跳过 ${r.skipped.length} 个非测试文件）`;
      msg.textContent = m; msg.style.color = 'var(--ok)';
    } catch (e) {
      msg.textContent = '导入失败：' + e.message; msg.style.color = 'var(--danger)';
    }
  });

  // Text format import
  document.getElementById('np-text-import').addEventListener('click', () => {
    const msg = document.getElementById('np-text-msg');
    const text = document.getElementById('np-bulk-text').value;
    const cases = parseBulkText(text);
    if (!cases.length) { msg.textContent = '未解析到任何用例，请检查格式'; msg.style.color = 'var(--danger)'; return; }
    addCases(cases, replaceChk.checked);
    msg.textContent = `已导入 ${cases.length} 个测试点`; msg.style.color = 'var(--ok)';
  });

  // ---- batch import problems ----
  const batchBox = document.getElementById('np-batch');
  let batchPlans = null; // latest preview payload
  document.getElementById('np-batch-toggle').addEventListener('click', (e) => {
    const open = batchBox.style.display !== 'none';
    batchBox.style.display = open ? 'none' : 'block';
    e.target.textContent = open ? '批量导入 ▾' : '批量导入 ▴';
  });

  document.getElementById('np-batch-parse').addEventListener('click', async () => {
    const fileInput = document.getElementById('np-batch-zip');
    const msg = document.getElementById('np-batch-msg');
    const preview = document.getElementById('np-batch-preview');
    const importBtn = document.getElementById('np-batch-import');
    const file = fileInput.files && fileInput.files[0];
    if (!file) { msg.textContent = '请先选择 .zip 文件'; msg.style.color = 'var(--danger)'; return; }
    msg.textContent = '解析中…'; msg.style.color = '';
    importBtn.style.display = 'none';
    try {
      const b64 = await file.text().then((t) => btoa(unescape(encodeURIComponent(t))));
      const r = await api('/api/problems/import-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: b64 }),
      });
      batchPlans = r;
      if (!r.problems.length && !r.errors.length) {
        msg.textContent = '未在压缩包内找到任何题目（需要包含 problem.json 的子目录）'; msg.style.color = 'var(--danger)';
        preview.innerHTML = '';
        return;
      }
      msg.textContent = `检测到 ${r.problems.length} 道题，可导入。`; msg.style.color = 'var(--ok)';
      preview.innerHTML = `
        <table>
          <thead><tr><th>题号</th><th>标题</th><th>测试点</th><th>状态</th></tr></thead>
          <tbody>
            ${r.problems.map((p) => `
              <tr>
                <td>${escapeHtml(p.id)}</td>
                <td>${escapeHtml(p.title)}</td>
                <td>${p.testCount}</td>
                <td>${p.exists ? '<span class="badge b-none">已存在</span>' : '<span class="badge b-AC">新增</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        ${r.errors.length ? `<div class="err-box">跳过 ${r.errors.length} 个目录：${r.errors.map((e) => escapeHtml(e.folder + ' — ' + e.reason)).join('；')}</div>` : ''}`;
      importBtn.style.display = 'inline-block';
    } catch (e) {
      msg.textContent = '解析失败：' + e.message; msg.style.color = 'var(--danger)';
      preview.innerHTML = '';
    }
  });

  document.getElementById('np-batch-import').addEventListener('click', async () => {
    const fileInput = document.getElementById('np-batch-zip');
    const msg = document.getElementById('np-batch-msg');
    const importBtn = document.getElementById('np-batch-import');
    const file = fileInput.files && fileInput.files[0];
    if (!file || !batchPlans) { msg.textContent = '请先解析预览'; msg.style.color = 'var(--danger)'; return; }
    const mode = (document.querySelector('input[name="np-batch-mode"]:checked') || {}).value || 'skip';
    msg.textContent = '导入中…'; msg.style.color = '';
    importBtn.disabled = true;
    try {
      const b64 = await file.text().then((t) => btoa(unescape(encodeURIComponent(t))));
      const r = await api('/api/problems/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: b64, mode }),
      });
      let m = `成功导入 ${r.imported.length} 道`;
      if (r.skipped.length) m += `，跳过 ${r.skipped.length} 道（已存在）`;
      msg.textContent = m; msg.style.color = 'var(--ok)';
      importBtn.disabled = false;
      importBtn.style.display = 'none';
      if (confirm(m + '。是否跳转到题目列表？')) location.hash = '#/';
    } catch (e) {
      msg.textContent = '导入失败：' + e.message; msg.style.color = 'var(--danger)';
      importBtn.disabled = false;
    }
  });

  document.getElementById('np-spj').addEventListener('change', (e) => {
    document.getElementById('np-spj-box').style.display = e.target.checked ? 'block' : 'none';
  });

  // ---- prefill when editing an existing problem ----
  if (ed) {
    editingId = ed.id;
    // batch import only applies to the "new problem" flow
    const batchSec = document.getElementById('np-batch-toggle').closest('.section');
    if (batchSec) batchSec.style.display = 'none';
    const set = (sel, val) => { const el = document.getElementById(sel); if (el) el.value = val; };
    set('np-id', ed.id); document.getElementById('np-id').disabled = true;
    set('np-title', ed.title);
    set('np-diff', ed.difficulty);
    set('np-tl', ed.timeLimit);
    set('np-ml', ed.memoryLimit);
    set('np-desc', ed.description);
    set('np-in', ed.input);
    set('np-out', ed.output);
    set('np-note', ed.note);
    casesBox.querySelectorAll('.case-edit').forEach((el) => el.remove());
    (ed.cases || []).forEach((c) => makeCase(c.input || '', c.output || ''));
    if (ed.spj && ed.spj.enabled) {
      document.getElementById('np-spj').checked = true;
      document.getElementById('np-spj-box').style.display = 'block';
      set('np-spj-lang', ed.spj.lang);
      set('np-spj-src', ed.spj.source);
    }
    document.getElementById('np-submit').textContent = '保存修改';
  } else {
    editingId = null;
  }

  document.getElementById('np-submit').addEventListener('click', () => createProblem());
}

function parseBulkText(text) {
  const lines = String(text).split(/\r?\n/);
  const cases = [];
  let curIn = [], curOut = [], mode = 'in';
  const flush = () => {
    if (curIn.length || curOut.length) {
      cases.push({ input: curIn.join('\n'), output: curOut.join('\n') });
    }
    curIn = []; curOut = []; mode = 'in';
  };
  for (const line of lines) {
    const t = line.trim();
    if (t === '[CASE]') { flush(); continue; }
    if (t === '===') { mode = 'out'; continue; }
    if (mode === 'in') curIn.push(line); else curOut.push(line);
  }
  flush();
  return cases;
}

async function createProblem() {
  const id = document.getElementById('np-id').value.trim();
  const title = document.getElementById('np-title').value.trim();
  const msg = document.getElementById('np-msg');
  if (!id || !title) { msg.textContent = '题号和标题必填'; return; }
  const cases = [...document.querySelectorAll('#np-cases .case-edit')].map((d) => ({
    input: d.querySelector('.np-case-in').value,
    output: d.querySelector('.np-case-out').value,
  }));
  if (!cases.length || (!cases[0].input && !cases[0].output)) {
    msg.textContent = '至少需要一个测试点'; return;
  }
  const spjOn = document.getElementById('np-spj').checked;
  const body = {
    id, title,
    difficulty: document.getElementById('np-diff').value,
    timeLimit: Number(document.getElementById('np-tl').value) || 1000,
    memoryLimit: Number(document.getElementById('np-ml').value) || 256,
    description: document.getElementById('np-desc').value,
    input: document.getElementById('np-in').value,
    output: document.getElementById('np-out').value,
    note: document.getElementById('np-note').value,
    cases,
    spj: spjOn
      ? { enabled: true, lang: document.getElementById('np-spj-lang').value, source: document.getElementById('np-spj-src').value }
      : null,
  };
  msg.textContent = editingId ? '保存中…' : '创建中…';
  try {
    const r = editingId
      ? await api('/api/problem/' + editingId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await api('/api/problem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) location.hash = '#/problem/' + (editingId || id);
    else msg.textContent = (editingId ? '保存失败：' : '创建失败：') + (r.error || '未知错误');
  } catch (e) {
    msg.textContent = '错误：' + e.message;
  }
}

// ---------- utils ----------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- router ----------
function router() {
  // Strip leading "#" and optional "/": "#/problem/1001" -> "problem/1001"
  const path = (location.hash || '#/').replace(/^#\/?/, '');
  const parts = path.split('/');
  const run = (fn) => {
    Promise.resolve(fn()).catch((e) => {
      app.innerHTML = `<div class="err-box">加载出错：${escapeHtml(e && e.message)}</div>`;
    });
  };
  if (parts[0] === '' || parts[0] === 'problems') return run(renderProblemList);
  if (parts[0] === 'problem' && parts[1]) return run(() => renderProblem(parts[1]));
  if (parts[0] === 'submissions') return run(renderSubmissions);
  if (parts[0] === 'submission' && parts[1]) return run(() => renderSubmission(parts[1]));
  if (parts[0] === 'new') return run(() => renderNewProblem());
  if (parts[0] === 'edit' && parts[1]) return run(() => renderNewProblem(parts[1]));
  return run(renderProblemList);
}

// Intercept in-app links so navigation works even if `hashchange` is unreliable.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (location.hash === href) router();
  else location.hash = href; // triggers hashchange -> router
});

window.addEventListener('hashchange', router);
router();
