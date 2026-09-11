/*
 * SMI-V Plus publish proxy — Cloudflare Worker
 *
 * Holds the real GitHub token server-side (Worker secret, never shipped to the browser).
 * The static site (docs/ui.js) POSTs the report payload here; this Worker writes it to
 * GitHub on the site's behalf. This is what lets the public GitHub Pages site publish
 * with zero prompts, without a real GitHub PAT ever appearing in public JS (which GitHub's
 * push protection blocks anyway).
 *
 * SITE_KEY is NOT a real secret — it ships inside public client JS by design, so anyone
 * reading the source can find it. Its only job is to stop random bots/crawlers from
 * stumbling onto this endpoint and overwriting data.json. Worst case if someone copies it:
 * they can publish garbage to data.json/history (defacement, recoverable from history) —
 * they get no other GitHub access. That is the actual, bounded blast radius of this design.
 */

const GH_OWNER = 'thering999';
const GH_REPO = 'smiv_plus';
const GH_PATH = 'docs/data.json';
const GH_HISTORY_INDEX_PATH = 'docs/history/index.json';
const GH_HISTORY_KEEP = 30;
const ALLOWED_ORIGIN = 'https://thering999.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Site-Key',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function ghGetFile(path, token) {
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'smiv-plus-worker' },
  });
  if (res.status === 404) return { sha: null, json: null };
  if (!res.ok) throw new Error(`read ${path} failed (${res.status})`);
  const j = await res.json();
  const text = decodeURIComponent(escape(atob(j.content.replace(/\n/g, ''))));
  return { sha: j.sha, json: JSON.parse(text) };
}

async function ghPutFile(path, obj, sha, token, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'smiv-plus-worker' },
    body: JSON.stringify({ message, content, sha: sha || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `write ${path} failed (${res.status})`);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }

    const siteKey = request.headers.get('X-Site-Key') || '';
    if (!env.SITE_KEY || siteKey !== env.SITE_KEY) {
      return json({ error: 'unauthorized' }, 401);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }
    if (!payload || !Array.isArray(payload.patients) || !payload.publishedAt) {
      return json({ error: 'payload missing patients[]/publishedAt' }, 400);
    }

    const token = env.GH_TOKEN;
    if (!token) return json({ error: 'server not configured (GH_TOKEN missing)' }, 500);

    try {
      const messageBase = `publish data.json (${payload.patients.length} คน) — ${new Date().toLocaleString('th-TH')}`;

      const main = await ghGetFile(GH_PATH, token);
      await ghPutFile(GH_PATH, payload, main.sha, token, messageBase);

      const snapshotPath = `docs/history/${String(payload.publishedAt).replace(/[:.]/g, '-')}.json`;
      const snap = await ghGetFile(snapshotPath, token);
      await ghPutFile(snapshotPath, payload, snap.sha, token, `history snapshot — ${messageBase}`);

      const idx = await ghGetFile(GH_HISTORY_INDEX_PATH, token);
      let list = Array.isArray(idx.json) ? idx.json : [];
      list.push({
        file: snapshotPath, publishedAt: payload.publishedAt,
        patientCount: payload.patients.length, fiscalYear: (payload.settings && payload.settings.current_fiscal_year_be) || null,
      });
      if (list.length > GH_HISTORY_KEEP) list = list.slice(list.length - GH_HISTORY_KEEP);
      await ghPutFile(GH_HISTORY_INDEX_PATH, list, idx.sha, token, `update history index (${list.length} รายการ)`);

      return json({ ok: true, patientCount: payload.patients.length });
    } catch (err) {
      return json({ error: err.message || String(err) }, 502);
    }
  },
};
