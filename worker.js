import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as XLSX from 'xlsx';
import { serveStatic } from 'hono/cloudflare-workers';
import manifest from '__STATIC_CONTENT_MANIFEST';

const app = new Hono();

// Enable CORS for all routes
app.use('/*', cors());

// Helper: Convert Workbook to JSON
function workbookToJson(workbook) {
  const out = {};
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    out[sheetName] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  });
  return out;
}

// 0. Principals Data Routes
app.get('/api/principals', async (c) => {
  const principals = await c.env.ATTENDANCE_KV.get('principals', { type: 'json' });
  return c.json({ principals: principals || [] });
});

app.post('/api/principals', async (c) => {
  try {
    const body = await c.req.json();
    if (body.principals) {
      await c.env.ATTENDANCE_KV.put('principals', JSON.stringify(body.principals));
      return c.json({ success: true });
    }
    return c.json({ error: "Missing data" }, 400);
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

// Teachers Data Routes
app.get('/api/teachers', async (c) => {
  const teachers = await c.env.ATTENDANCE_KV.get('teachers', { type: 'json' });
  return c.json({ teachers: teachers || [] });
});

app.post('/api/teachers', async (c) => {
  try {
    const body = await c.req.json();
    if (body.teachers) {
      await c.env.ATTENDANCE_KV.put('teachers', JSON.stringify(body.teachers));
      return c.json({ success: true });
    }
    return c.json({ error: "Missing data" }, 400);
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

// Sheets Data Routes
app.get('/api/sheets', async (c) => {
  const principalId = c.req.query('principalId');
  if (!principalId) return c.json({ sheets: {} });
  const sheets = await c.env.ATTENDANCE_KV.get(`sheets_${principalId}`, { type: 'json' });
  return c.json({ sheets: sheets || {} });
});

app.post('/api/sheets', async (c) => {
  try {
    const body = await c.req.json();
    if (body.sheets && body.principalId) {
      await c.env.ATTENDANCE_KV.put(`sheets_${body.principalId}`, JSON.stringify(body.sheets));
      return c.json({ success: true });
    }
    return c.json({ error: "Missing data" }, 400);
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

// 1. Upload Route (Replaces multer logic)
app.post('/api/upload', async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file) {
      return c.json({ error: "Missing file" }, 400);
    }

    // Cloudflare Workers receive files as Blobs/Files, convert to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
    const payload = workbookToJson(workbook);

    return c.json({ sheets: payload });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// 2. Google Sheet Data Route
app.get('/api/google-sheet', async (c) => {
  const sheetId = c.req.query('sheetId');
  const sheetName = c.req.query('sheetName');
  const gid = c.req.query('gid');

  if (!sheetId) return c.json({ error: "Missing sheetId" }, 400);

  const params = [];
  if (gid) params.push(`gid=${encodeURIComponent(gid)}`);
  else if (sheetName) params.push(`sheet=${encodeURIComponent(sheetName)}`);

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv${params.length ? `&${params.join("&")}` : ""}`;

  try {
    const resp = await fetch(url);
    const text = await resp.text();

    if (!resp.ok || text.trim().startsWith("<")) {
      return c.json({ error: "Unable to fetch sheet. Make sure it is public." }, 400);
    }

    const workbook = XLSX.read(text, { type: "string" });
    const data = workbookToJson(workbook);
    return c.json({ sheets: data });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// 3. Google Sheet Worksheets Route
app.get('/api/google-sheet-worksheets', async (c) => {
  const sheetId = c.req.query('sheetId');
  if (!sheetId) return c.json({ error: "Missing sheetId" }, 400);

  const url = `https://spreadsheets.google.com/feeds/worksheets/${encodeURIComponent(sheetId)}/public/basic?alt=json`;

  try {
    const resp = await fetch(url);
    const text = await resp.text();

    if (!resp.ok || text.trim().startsWith("<")) {
       return c.json({ error: "Unable to list sheets. Check permissions." }, 400);
    }

    const json = JSON.parse(text);
    const sheets = (json.feed.entry || []).map((entry) => {
      const title = entry.title?.$t || "";
      const id = entry.id?.$t || "";
      const match = id.match(/.*\/([^/]+)$/);
      const gid = match ? match[1] : null;
      return { title, gid };
    });

    return c.json({ sheets });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Serve static assets (Frontend)
app.get('/*', serveStatic({ 
  root: './', 
  manifest,
  rewriteRequestPath: (path) => path === '/' ? '/index.html' : path 
}));

export default app;