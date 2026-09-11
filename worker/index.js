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
const GH_HISTORY_KEEP = 15; // ลดจาก 30 — ทุก snapshot copy ข้อมูลผู้ป่วยเต็มไฟล์ เก็บมากไปทำให้ repo บวมเรื่อยๆ
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
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'smiv-plus-worker', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (res.status === 404) return { sha: null, json: null };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`read ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const j = await res.json();
  const text = decodeURIComponent(escape(atob(j.content.replace(/\n/g, ''))));
  return { sha: j.sha, json: JSON.parse(text) };
}

async function ghPutFile(path, obj, sha, token, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'smiv-plus-worker', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ message, content, sha: sha || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.message || `write ${path} failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
}

async function ghDeleteFile(path, sha, token, message) {
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'smiv-plus-worker', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ message, sha }),
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `delete ${path} failed (${res.status})`);
  }
}

// เขียนไฟล์แบบ retry เอง 1 ครั้งถ้าชน sha conflict (409) — เกิดได้เวลามีคนกด publish ซ้อนกันเป๊ะๆ
async function ghGetThenPut(path, obj, token, message) {
  const cur = await ghGetFile(path, token);
  try {
    await ghPutFile(path, obj, cur.sha, token, message);
  } catch (err) {
    if (err.status !== 409) throw err;
    const fresh = await ghGetFile(path, token);
    await ghPutFile(path, obj, fresh.sha, token, message);
  }
}

// อ่าน-แก้-เขียน index ประวัติ พร้อม retry เต็มรูปแบบถ้าชน conflict (อ่านใหม่+append ใหม่ ไม่ใช่แค่เขียนซ้ำ)
async function updateHistoryIndex(entry, token, attempt = 0) {
  const idx = await ghGetFile(GH_HISTORY_INDEX_PATH, token);
  let list = Array.isArray(idx.json) ? idx.json : [];
  list.push(entry);
  let dropped = [];
  if (list.length > GH_HISTORY_KEEP) {
    dropped = list.slice(0, list.length - GH_HISTORY_KEEP);
    list = list.slice(list.length - GH_HISTORY_KEEP);
  }
  try {
    await ghPutFile(GH_HISTORY_INDEX_PATH, list, idx.sha, token, `update history index (${list.length} รายการ)`);
  } catch (err) {
    if (err.status === 409 && attempt < 2) return updateHistoryIndex(entry, token, attempt + 1);
    throw err;
  }
  // ลบไฟล์ snapshot เดิมของรายการที่หลุดออกจาก index จริงๆ ไม่ให้ค้างในระบบเปล่าๆ (ล้มเหลวได้โดยไม่ทำให้ publish ทั้งหมดพัง)
  for (const old of dropped) {
    try {
      const snap = await ghGetFile(old.file, token);
      if (snap.sha) await ghDeleteFile(old.file, snap.sha, token, `prune old history snapshot: ${old.file}`);
    } catch (e) { /* ไม่ critical — เก็บ orphan ไว้ดีกว่า publish ล้มเหลว */ }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const siteKey = request.headers.get('X-Site-Key') || '';
    if (!env.SITE_KEY || siteKey !== env.SITE_KEY) {
      return json({ error: 'unauthorized' }, 401);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }

    const token = env.GH_TOKEN;
    if (!token) return json({ error: 'server not configured (GH_TOKEN missing)' }, 500);

    if (payload && payload.action === 'delete_history') {
      const file = String(payload.file || '');
      if (!file.startsWith('docs/history/')) return json({ error: 'invalid file path' }, 400);
      try {
        const idx = await ghGetFile(GH_HISTORY_INDEX_PATH, token);
        const list = (Array.isArray(idx.json) ? idx.json : []).filter(e => e.file !== file);
        await ghPutFile(GH_HISTORY_INDEX_PATH, list, idx.sha, token, `delete history entry: ${file}`);
        const snap = await ghGetFile(file, token);
        if (snap.sha) await ghDeleteFile(file, snap.sha, token, `delete history snapshot: ${file}`);
        return json({ ok: true, remaining: list.length });
      } catch (err) {
        return json({ error: err.message || String(err) }, 502);
      }
    }

    if (!payload || !Array.isArray(payload.patients) || !payload.publishedAt) {
      return json({ error: 'payload missing patients[]/publishedAt' }, 400);
    }

    try {
      const messageBase = `publish data.json (${payload.patients.length} คน) — ${new Date().toLocaleString('th-TH')}`;

      await ghGetThenPut(GH_PATH, payload, token, messageBase);

      const snapshotPath = `docs/history/${String(payload.publishedAt).replace(/[:.]/g, '-')}.json`;
      await ghGetThenPut(snapshotPath, payload, token, `history snapshot — ${messageBase}`);

      const newEntry = {
        file: snapshotPath, publishedAt: payload.publishedAt,
        patientCount: payload.patients.length, fiscalYear: (payload.settings && payload.settings.current_fiscal_year_be) || null,
      };
      await updateHistoryIndex(newEntry, token);

      return json({ ok: true, patientCount: payload.patients.length });
    } catch (err) {
      return json({ error: err.message || String(err) }, 502);
    }
  },
};
