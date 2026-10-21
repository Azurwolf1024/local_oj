'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUB_DIR = path.join(__dirname, '..', 'data', 'submissions');

function ensureDir() {
  fs.mkdirSync(SUB_DIR, { recursive: true });
}

function newId() {
  return (
    Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
  ).toUpperCase();
}

function createSubmission({ problemId, problemTitle, language, code }) {
  ensureDir();
  const id = newId();
  const rec = {
    id,
    problemId,
    problemTitle,
    language,
    code,
    status: 'Judging',
    verdict: null,
    compileError: null,
    error: null,
    cases: [],
    passed: 0,
    total: 0,
    time: 0,
    memory: 0,
    submittedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(SUB_DIR, id + '.json'), JSON.stringify(rec, null, 2));
  return rec;
}

function updateSubmission(id, patch) {
  const file = path.join(SUB_DIR, id + '.json');
  if (!fs.existsSync(file)) return null;
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(rec, patch);
  fs.writeFileSync(file, JSON.stringify(rec, null, 2));
  return rec;
}

function getSubmission(id) {
  const file = path.join(SUB_DIR, id + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listSubmissions(limit = 50) {
  ensureDir();
  return fs
    .readdirSync(SUB_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(SUB_DIR, f), 'utf8'));
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
    .slice(0, limit)
    .map(({ code, ...rest }) => rest); // don't ship full source in list
}

// All submissions without a limit or code-stripping (used for status/aggregation).
function listAllSubmissions() {
  ensureDir();
  return fs
    .readdirSync(SUB_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(SUB_DIR, f), 'utf8'));
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
}

module.exports = {
  createSubmission,
  updateSubmission,
  getSubmission,
  listSubmissions,
  listAllSubmissions,
};
