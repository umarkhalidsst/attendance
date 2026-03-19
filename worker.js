import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as XLSX from 'xlsx';

const app = new Hono();

// Enable CORS for all routes
app.use('/*', cors());

// 0. Root Route (To confirm Worker is running)
app.get('/', (c) => c.text("Attendance API is running! Go to your frontend website to use the app."));

// Helper: Convert Workbook to JSON
function workbookToJson(workbook) {
  const out = {};
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    out[sheetName] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  });
  return out;
}

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

export default app;