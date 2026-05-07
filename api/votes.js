import { put, list } from '@vercel/blob';

// ── Configuration ────────────────────────────────────────────────────────
// Update BLOB_TOKEN_ENV to match the exact env var name Vercel assigns
// when you create your Blob store (e.g. BLOB_PUB_READ_WRITE_TOKEN)
const BLOB_TOKEN_ENV = 'BLOB_READ_WRITE_TOKEN';
const BLOB_PREFIX    = 'md_votes_v1/';   // each vote is its own file — no race conditions
const SECRET         = 'bestrane2026results';

// ── Helpers ───────────────────────────────────────────────────────────────
function getToken() {
  return process.env[BLOB_TOKEN_ENV];
}

// Each vote stored as md_votes_v1/{ts}-{rand}.json — POST only writes,
// GET lists + fetches all. No read-modify-write = no race conditions.
async function writeVote(vote) {
  const token = getToken();
  const rand  = Math.random().toString(36).slice(2, 8);
  const name  = `${BLOB_PREFIX}${Date.now()}-${rand}.json`;
  await put(name, JSON.stringify(vote), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    token
  });
}

async function readVotes() {
  const token = getToken();
  try {
    const { blobs } = await list({ prefix: BLOB_PREFIX, token });
    if (!blobs || blobs.length === 0) return [];
    const results = await Promise.all(
      blobs.map(async blob => {
        try {
          const res = await fetch(blob.downloadUrl || blob.url);
          return res.ok ? await res.json() : null;
        } catch { return null; }
      })
    );
    return results
      .filter(Boolean)
      .sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  } catch {
    return [];
  }
}

function sanitiseVote(body) {
  if (!body || typeof body !== 'object') return null;
  if (!Array.isArray(body.ranked) || body.ranked.length === 0) return null;

  const allowed = new Set(['mastery', 'adaptable', 'genuine', 'driven', 'grounded']);
  const ranked = body.ranked
    .filter(id => typeof id === 'string' && allowed.has(id))
    .slice(0, 5);
  if (ranked.length === 0) return null;

  const rankComments = {};
  if (body.rankComments && typeof body.rankComments === 'object') {
    for (const [k, v] of Object.entries(body.rankComments)) {
      if (typeof v === 'string' && v.trim()) {
        rankComments[k] = v.slice(0, 1000);
      }
    }
  }

  const chipComments = {};
  if (body.chipComments && typeof body.chipComments === 'object') {
    for (const [k, v] of Object.entries(body.chipComments)) {
      if (typeof k === 'string' && allowed.has(k) && typeof v === 'string' && v.trim()) {
        chipComments[k] = v.slice(0, 1000);
      }
    }
  }

  const other = typeof body.other === 'string' ? body.other.slice(0, 2000) : '';
  const ts    = typeof body.ts === 'string' ? body.ts : new Date().toISOString();

  return { ts, ranked, rankComments, chipComments, other };
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-results-secret');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    }

    const vote = sanitiseVote(body);
    if (!vote) {
      return res.status(400).json({ error: 'Invalid vote data. ranked must be a non-empty array.' });
    }

    try {
      await writeVote(vote);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Error saving vote:', err);
      return res.status(500).json({ error: 'Failed to save vote.' });
    }
  }

  if (req.method === 'GET') {
    const headerSecret = req.headers['x-results-secret'];
    const querySecret  = req.query?.secret;
    const provided     = headerSecret || querySecret;

    if (provided !== SECRET) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    try {
      const votes = await readVotes();
      return res.status(200).json(votes);
    } catch (err) {
      console.error('Error reading votes:', err);
      return res.status(500).json({ error: 'Failed to read votes.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}
