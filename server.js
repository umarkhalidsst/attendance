require("dotenv").config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
// Serve static files from the current directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // Fallback to root if file not found in public

// Explicitly serve index.html on root to avoid "Cannot GET /"
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err) res.status(500).send("Error: index.html not found in public folder. Please ensure 'public/index.html' exists.");
    });
});

// --- In-Memory Data (Resets on restart) ---
let principalsData = [];
let teachersData = [];
let sheetsData = {};

// --- Login Route ---
app.get('/api/principals', (req, res) => {
    res.json({ principals: principalsData });
});

app.post('/api/principals', (req, res) => {
    const { principals } = req.body;
    if (principals) {
        principalsData = principals;
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "Missing data" });
    }
});

app.get('/api/teachers', (req, res) => {
    res.json({ teachers: teachersData });
});

app.post('/api/teachers', (req, res) => {
    const { teachers } = req.body;
    if (teachers) {
        teachersData = teachers;
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "Missing data" });
    }
});

// --- Helper: Convert Workbook to JSON ---
function workbookToJson(workbook) {
  const out = {};
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    out[sheetName] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  });
  return out;
}

// --- Upload Route ---
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Missing file" });
        
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheets = workbookToJson(workbook);
        
        res.json({ sheets });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Attendance App running at http://localhost:${PORT}`);
});