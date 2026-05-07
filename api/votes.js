import { put, list } from '@vercel/blob';

// ── Configuration ────────────────────────────────────────────────────────
// Update BLOB_TOKEN_ENV to match the exact env var name Vercel assigns
// when you create your Blob store (e.g. BLOB_PUB_READ_WRITE_TOKEN)
const BLOB_TOKEN_ENV = 'BLOB_READ_WRITE_TOKEN';
const BLOB_PATHNAME  = 'md_votes_v1.json';
const SECRET         = 'bestrane2024results';

// ── Helpers ───────────────────────────────────────────────────────────────
function getToken() {
  return process.env[BLOB_TOKEN_ENV];
}

async function readVotes() {
  const token = getToken();
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, token });
    if (!blobs || blobs.length === 0) return [];
    const blobUrl = blobs[0].url;
    const res = await fetch(blobUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function writeVotes(votes) {
  const token = getToken();
  await put(BLOB_PATHNAME, JSON.stringify(votes), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token
  });
}

function sanitiseVote(body) {
  if (!body || typeof body !== 'object') return null;
  if (!Array.isArray(body.ranked) || body.ranked.length === 0) return null;

  const allowed = new Set(['mastery', 'adaptable', 'genuine', 'driven', 'grounded']);
  const ranked = body.ranked
    .filter(id => typeof id === 'string' && allowed.has(id))
    .slice(0, 4);
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
  // CORS headers for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-results-secret');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // ── POST: submit a vote ───────────────────────────────────────────────
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
      const votes = await readVotes();
      votes.push(vote);
      await writeVotes(votes);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Error saving vote:', err);
      return res.status(500).json({ error: 'Failed to save vote.' });
    }
  }

  // ── GET: retrieve all votes ───────────────────────────────────────────
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
