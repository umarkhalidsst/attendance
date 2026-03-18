const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage() });

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.toString().replace(/[^0-9]/g, "");
  if (!digits) return null;

  if (digits.startsWith("92") && digits.length === 12) {
    return "+" + digits;
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return "+92" + digits.slice(1);
  }
  if (digits.length === 10) {
    return "+92" + digits;
  }
  if (digits.length === 12 && digits.startsWith("923")) {
    return "+" + digits;
  }

  // Fallback: just return digits (maybe already included +)
  return "+" + digits;
}

function workbookToJson(workbook) {
  const out = {};
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    out[sheetName] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  });
  return out;
}

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Missing file" });
  }

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const payload = workbookToJson(workbook);
  res.json({ sheets: payload });
});

app.get("/api/google-sheet", async (req, res) => {
  const { sheetId, sheetName, gid } = req.query;
  if (!sheetId) {
    return res.status(400).json({ error: "Missing sheetId" });
  }

  // Use "gviz/tq" endpoint and parse CSV to avoid CORS issues when served from this server.
  // If `gid` is provided (from the URL hash), prefer it; otherwise send sheet name.
  const params = [];
  if (gid) {
    params.push(`gid=${encodeURIComponent(gid)}`);
  } else if (sheetName) {
    params.push(`sheet=${encodeURIComponent(sheetName)}`);
  }

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    sheetId
  )}/gviz/tq?tqx=out:csv${params.length ? `&${params.join("&")}` : ""}`;

  try {
    const resp = await fetch(url);
    const text = await resp.text();

    // Google sometimes returns HTML (login page / 404) when the sheet isn’t public.
    if (!resp.ok || text.trim().startsWith("<")) {
      const snippet = text.trim().slice(0, 320).replace(/\n/g, " ");
      throw new Error(
        `Unable to fetch sheet (status=${resp.status}). Make sure the Google Sheet is shared as 'Anyone with the link can view'. Response snippet: ${snippet}`
      );
    }

    const workbook = XLSX.read(text, { type: "string" });
    const data = workbookToJson(workbook);
    res.json({ sheets: data });
  } catch (err) {
    console.error("/api/google-sheet error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/google-sheet-worksheets", async (req, res) => {
  const { sheetId } = req.query;
  if (!sheetId) {
    return res.status(400).json({ error: "Missing sheetId" });
  }

  const url = `https://spreadsheets.google.com/feeds/worksheets/${encodeURIComponent(
    sheetId
  )}/public/basic?alt=json`;

  try {
    const resp = await fetch(url);
    const text = await resp.text();

    // Google returns HTML when the sheet is not public or the URL is invalid.
    if (!resp.ok || text.trim().startsWith("<")) {
      const snippet = text.trim().slice(0, 320).replace(/\n/g, " ");
      throw new Error(
        `Unable to list sheets (status=${resp.status}). Make sure the Google Sheet is shared as 'Anyone with the link can view'. Response snippet: ${snippet}`
      );
    }

    const json = JSON.parse(text);

    const sheets = (json.feed.entry || []).map((entry) => {
      const title = entry.title?.$t || "";
      const id = entry.id?.$t || "";
      const match = id.match(/.*\/([^/]+)$/);
      const gid = match ? match[1] : null;
      return { title, gid };
    });

    res.json({ sheets });
  } catch (err) {
    console.error("/api/google-sheet-worksheets error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Attendance app running on http://localhost:${PORT}`);
});
