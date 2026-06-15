import 'dotenv/config';
import express from "express";
import cors from "cors";
import path from "path";
// vite is imported dynamically in dev mode only (it's a devDependency)
import { createClient } from "@libsql/client";
import net from 'net';
import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// CORS: fully open — this is a local print bridge, not a public API
app.use(cors());
// Explicit preflight for all routes (ensures Cloud→localhost works)
app.options('*', cors());
app.use(express.json());

// Initialize Turso (Cloud only)
const dbUrl = process.env.TURSO_DATABASE_URL;
const dbToken = process.env.TURSO_AUTH_TOKEN;

if (!dbUrl || !dbUrl.includes('libsql://')) {
  console.error('\n❌ ERROR: TURSO_DATABASE_URL no configurada o inválida.');
  console.error('   Crea un archivo .env con:');
  console.error('   TURSO_DATABASE_URL="libsql://tu-db.turso.io"');
  console.error('   TURSO_AUTH_TOKEN="tu-token"\n');
  process.exit(1);
}

console.log(`✅ Conectando a Turso Cloud: ${dbUrl.split('?')[0]}`);

const db = createClient({
  url: dbUrl,
  authToken: dbToken,
});

async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      item_name TEXT NOT NULL,
      business_line TEXT,
      family TEXT,
      ean13 TEXT,
      dun14 TEXT,
      marca TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS label_formats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      dpi INTEGER NOT NULL,
      darkness INTEGER NOT NULL,
      printSpeed INTEGER NOT NULL,
      orientation TEXT NOT NULL,
      marginTop INTEGER NOT NULL,
      marginBottom INTEGER NOT NULL DEFAULT 2,
      marginLeft INTEGER NOT NULL,
      marginRight INTEGER NOT NULL DEFAULT 2,
      labelsPerRow INTEGER NOT NULL,
      labelsPerColumn INTEGER NOT NULL DEFAULT 1,
      horizontalGap REAL NOT NULL,
      verticalGap REAL NOT NULL DEFAULT 2,
      showName INTEGER NOT NULL,
      showSku INTEGER NOT NULL,
      showEan13 INTEGER NOT NULL,
      showDun14 INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 9100,
      type TEXT NOT NULL DEFAULT 'network',
      is_default INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Try adding new columns if they don't exist
  try {
    await db.execute(
      "ALTER TABLE label_formats ADD COLUMN marginBottom INTEGER NOT NULL DEFAULT 2;",
    );
  } catch {}
  try {
    await db.execute(
      "ALTER TABLE label_formats ADD COLUMN marginRight INTEGER NOT NULL DEFAULT 2;",
    );
  } catch {}
  try {
    await db.execute(
      "ALTER TABLE label_formats ADD COLUMN labelsPerColumn INTEGER NOT NULL DEFAULT 1;",
    );
  } catch {}
  try {
    await db.execute(
      "ALTER TABLE label_formats ADD COLUMN verticalGap REAL NOT NULL DEFAULT 2;",
    );
  } catch {}
  try {
    await db.execute(
      "ALTER TABLE label_formats ADD COLUMN labelShift REAL NOT NULL DEFAULT 0;",
    );
  } catch {}
  try {
    await db.execute(
      "ALTER TABLE label_formats ADD COLUMN labelTop REAL NOT NULL DEFAULT 0;",
    );
  } catch {}

  // Migrate products table
  try {
    await db.execute("ALTER TABLE products ADD COLUMN business_line TEXT;");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN family TEXT;");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN caducidad INTEGER;");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN activo INTEGER DEFAULT 1;");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN isp TEXT;");
  } catch {}

  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS empleados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT,
      nombre TEXT NOT NULL,
      linea_proceso TEXT,
      labor TEXT
    )`);
  } catch {}

  // Migration: add codigo column if missing
  try {
    await db.execute("ALTER TABLE empleados ADD COLUMN codigo TEXT;");
  } catch {}

  // Table: label_designs
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS label_designs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      format_id TEXT NOT NULL,
      elements TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}

  // Table: print_bridges (auto-discovery of LAN print servers)
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS print_bridges (
      id TEXT PRIMARY KEY,
      hostname TEXT NOT NULL,
      localIp TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 3000,
      printers TEXT NOT NULL DEFAULT '[]',
      lastSeen TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}

  // Table: print_queue (relay print jobs from cloud to bridge)
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS print_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bridgeId TEXT NOT NULL,
      zpl TEXT NOT NULL,
      printerName TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT
    )`);
  } catch {}

  // Table: system_logs (diagnostic console)
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL DEFAULT 'info',
      source TEXT NOT NULL DEFAULT 'server',
      message TEXT NOT NULL,
      details TEXT
    )`);
  } catch {}

  // Table: print_history (track all print jobs)
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS print_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      productName TEXT,
      productSku TEXT,
      printerName TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'local',
      copies INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'success',
      bridgeId TEXT,
      details TEXT
    )`);
  } catch {}

  // Seed label formats only if empty (preserves cloud data)
  try {
    const formatsResult = await db.execute(
      "SELECT COUNT(*) as count FROM label_formats",
    );
    if (formatsResult.rows[0].count === 0) {
      await db.execute({
        sql: "INSERT INTO label_formats (id, name, width, height, dpi, darkness, printSpeed, orientation, marginTop, marginLeft, labelsPerRow, horizontalGap, showName, showSku, showEan13, showDun14) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          "default",
          "Estándar 50x25mm (1 Col)",
          50, 25, 203, 15, 3, "N", 2, 2, 1, 2, 1, 1, 1, 1,
        ],
      });
      console.log("Default label format created.");
    }
  } catch (e) {
    console.error("Seed error", e);
  }

  const productCount = await db.execute("SELECT COUNT(*) as count FROM products");
  console.log(`📦 ${productCount.rows[0].count} productos en la base de datos Turso.`);

  // Migration: uppercase all existing marcas
  try {
    await db.execute("UPDATE products SET marca = UPPER(marca) WHERE marca IS NOT NULL AND marca != UPPER(marca)");
  } catch {}
}

// ── Logging helper ───────────────────────────────────────────────────────────
async function addLog(level: 'info' | 'warn' | 'error' | 'success', source: string, message: string, details?: string) {
  try {
    await db.execute({
      sql: "INSERT INTO system_logs (level, source, message, details) VALUES (?, ?, ?, ?)",
      args: [level, source, message, details || null],
    });
    // Auto-cleanup: keep only last 24h
    await db.execute("DELETE FROM system_logs WHERE timestamp < datetime('now', '-1 day')");
  } catch {}
}

initDb().then(() => {
  addLog('info', 'server', 'Servidor iniciado', `Platform: ${os.platform()}, Node: ${process.version}`);
}).catch((err) => {
  console.error("Failed to initialize database:", err);
});

// API: Logs
app.get("/api/logs", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const result = await db.execute({
      sql: "SELECT * FROM system_logs ORDER BY id DESC LIMIT ?",
      args: [limit],
    });
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/logs", async (_req, res) => {
  try {
    await db.execute("DELETE FROM system_logs");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Print History
app.get("/api/print-history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 200;
    const result = await db.execute({
      sql: "SELECT * FROM print_history ORDER BY id DESC LIMIT ?",
      args: [limit],
    });
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/print-history", async (req, res) => {
  try {
    const { productName, productSku, printerName, mode, copies, status, bridgeId, details } = req.body;
    await db.execute({
      sql: "INSERT INTO print_history (productName, productSku, printerName, mode, copies, status, bridgeId, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [productName || null, productSku || null, printerName, mode || 'local', copies || 1, status || 'success', bridgeId || null, details || null],
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/print-history", async (_req, res) => {
  try {
    await db.execute("DELETE FROM print_history");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API Routes
app.get("/api/config", (req, res) => {
  const isCloud = (process.env.TURSO_DATABASE_URL || "").includes("libsql://");
  res.json({
    dbType: isCloud ? "turso-cloud" : "local-sqlite",
    dbUrl: process.env.TURSO_DATABASE_URL || "file:local.db",
  });
});

app.get("/api/products", async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM products ORDER BY id DESC");
    const products = result.rows.map((row: any) => ({
      ...row,
      activo: row.activo !== 0, // treating 1 or null as active
    }));
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.post("/api/products", async (req, res) => {
  const { sku, item_name, business_line, family, ean13, dun14, marca, caducidad, activo, isp } = req.body;
  try {
    const isActivo = activo !== undefined ? (activo ? 1 : 0) : 1;
    const result = await db.execute({
      sql: "INSERT INTO products (sku, item_name, business_line, family, ean13, dun14, marca, caducidad, activo, isp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [sku, item_name, business_line || null, family || null, ean13 || null, dun14 || null, marca ? String(marca).toUpperCase() : null, caducidad || null, isActivo, isp || null],
    });
    res.status(201).json({
      id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
      sku,
      item_name,
      business_line,
      family,
      ean13,
      dun14,
      marca,
      caducidad,
      activo: isActivo === 1,
      isp,
    });
  } catch (error: any) {
    console.error("POST product err:", error);
    res
      .status(500)
      .json({
        error: `Error saving to database: ${error.message || "Unknown error"}`,
      });
  }
});

app.put("/api/products/:id", async (req, res) => {
  const { id } = req.params;
  const { sku, item_name, business_line, family, ean13, dun14, marca, caducidad, activo, isp } = req.body;
  try {
    const isActivo = activo !== undefined ? (activo ? 1 : 0) : 1;
    await db.execute({
      sql: "UPDATE products SET sku = ?, item_name = ?, business_line = ?, family = ?, ean13 = ?, dun14 = ?, marca = ?, caducidad = ?, activo = ?, isp = ? WHERE id = ?",
      args: [sku, item_name, business_line || null, family || null, ean13 || null, dun14 || null, marca ? String(marca).toUpperCase() : null, caducidad || null, isActivo, isp || null, id],
    });
    res.json({ id, sku, item_name, business_line, family, ean13, dun14, marca, caducidad, activo: isActivo === 1, isp });
  } catch (error: any) {
    console.error(error);
    res
      .status(500)
      .json({ error: `Failed to update product: ${error.message}` });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute({
      sql: "DELETE FROM products WHERE id = ?",
      args: [id],
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

app.post("/api/products/batch", async (req, res) => {
  const products = req.body.products;
  if (!products || !Array.isArray(products)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const statements = products.map((p: any) => ({
      sql: "INSERT INTO products (sku, item_name, business_line, family, ean13, dun14, marca, caducidad, activo, isp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sku) DO UPDATE SET item_name=excluded.item_name, business_line=excluded.business_line, family=excluded.family, ean13=excluded.ean13, dun14=excluded.dun14, marca=excluded.marca, caducidad=excluded.caducidad, activo=excluded.activo, isp=excluded.isp",
      args: [
        p.sku,
        p.item_name,
        p.business_line || null,
        p.family || null,
        p.ean13 || null,
        p.dun14 || null,
        p.marca ? String(p.marca).toUpperCase() : null,
        p.caducidad || null,
        p.activo !== undefined ? (p.activo ? 1 : 0) : 1,
        p.isp || null,
      ],
    }));

    // Execute batch transaction
    await db.batch(statements, "write");
    res.status(200).json({ success: true, count: products.length });
  } catch (error: any) {
    console.error(error);
    res
      .status(500)
      .json({ error: `Failed to batch insert products: ${error.message}` });
  }
});

// ── Print Bridges API (auto-discovery) ────────────────────────────────────
app.post("/api/bridges/register", async (req, res) => {
  try {
    const { id, hostname, localIp, port, printers } = req.body;
    if (!id || !localIp) {
      return res.status(400).json({ error: "Missing id or localIp" });
    }
    await db.execute({
      sql: `INSERT INTO print_bridges (id, hostname, localIp, port, printers, lastSeen)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              hostname = ?, localIp = ?, port = ?, printers = ?, lastSeen = datetime('now')`,
      args: [id, hostname || '', localIp, port || 3000, JSON.stringify(printers || []),
             hostname || '', localIp, port || 3000, JSON.stringify(printers || [])]
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("Bridge register error:", error);
    res.status(500).json({ error: "Failed to register bridge" });
  }
});

app.get("/api/bridges", async (req, res) => {
  try {
    // Only return bridges seen in the last 2 minutes
    const result = await db.execute(
      "SELECT * FROM print_bridges WHERE lastSeen > datetime('now', '-2 minutes')"
    );
    const bridges = result.rows.map((row) => ({
      ...row,
      printers: JSON.parse((row.printers as string) || '[]')
    }));
    res.json(bridges);
  } catch (error) {
    console.error("Bridge list error:", error);
    res.status(500).json({ error: "Failed to list bridges" });
  }
});

// ── Print Queue API (relay for LAN printing via Cloud) ──────────────────

// Client submits a print job to the queue
app.post("/api/print-queue", async (req, res) => {
  try {
    const { bridgeId, zpl, printerName } = req.body;
    if (!bridgeId || !zpl || !printerName) {
      return res.status(400).json({ error: "Missing bridgeId, zpl, or printerName" });
    }
    await db.execute({
      sql: "INSERT INTO print_queue (bridgeId, zpl, printerName) VALUES (?, ?, ?)",
      args: [bridgeId, zpl, printerName],
    });
    res.json({ message: "Print job queued" });
    addLog('info', 'print-queue', `Job encolado para \"${printerName}\"`, `Bridge: ${bridgeId}`);
  } catch (error) {
    console.error("Queue error:", error);
    res.status(500).json({ error: "Failed to queue print job" });
  }
});

// Bridge polls for pending jobs
app.get("/api/print-queue/pending/:bridgeId", async (req, res) => {
  try {
    const { bridgeId } = req.params;
    const result = await db.execute({
      sql: "SELECT * FROM print_queue WHERE bridgeId = ? AND status = 'pending' ORDER BY createdAt ASC LIMIT 5",
      args: [bridgeId],
    });
    res.json(result.rows);
  } catch (error) {
    console.error("Queue poll error:", error);
    res.status(500).json({ error: "Failed to poll queue" });
  }
});

// Bridge marks a job as completed
app.patch("/api/print-queue/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const { status } = req.body;
    await db.execute({
      sql: "UPDATE print_queue SET status = ?, completedAt = datetime('now') WHERE id = ?",
      args: [status || 'completed', parseInt(jobId)],
    });
    // Clean up old completed jobs (older than 1 hour)
    await db.execute("DELETE FROM print_queue WHERE status != 'pending' AND createdAt < datetime('now', '-1 hour')");
    res.json({ message: "Job updated" });
  } catch (error) {
    console.error("Queue update error:", error);
    res.status(500).json({ error: "Failed to update job" });
  }
});

// Download Bridge file — used by the installer BAT
app.get("/api/download-bridge", (req, res) => {
  const bridgePath = path.join(process.cwd(), "print-bridge.mjs");
  if (fs.existsSync(bridgePath)) {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Content-Disposition", "attachment; filename=print-bridge.mjs");
    res.send(fs.readFileSync(bridgePath, "utf-8"));
  } else {
    res.status(404).json({ error: "Bridge file not found" });
  }
});

// Label Formats API
app.get("/api/label-formats", async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM label_formats");
    const formats = result.rows.map((row) => ({
      ...row,
      showName: Boolean(row.showName),
      showSku: Boolean(row.showSku),
      showEan13: Boolean(row.showEan13),
      showDun14: Boolean(row.showDun14),
    }));
    res.json(formats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch label formats" });
  }
});

app.post("/api/label-formats", async (req, res) => {
  const {
    id,
    name,
    width,
    height,
    dpi,
    darkness,
    printSpeed,
    orientation,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    labelsPerRow,
    labelsPerColumn,
    horizontalGap,
    verticalGap,
    showName,
    showSku,
    showEan13,
    showDun14,
    labelShift,
    labelTop,
  } = req.body;
  try {
    await db.execute({
      sql: "INSERT INTO label_formats (id, name, width, height, dpi, darkness, printSpeed, orientation, marginTop, marginBottom, marginLeft, marginRight, labelsPerRow, labelsPerColumn, horizontalGap, verticalGap, showName, showSku, showEan13, showDun14, labelShift, labelTop) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        id,
        name,
        width,
        height,
        dpi,
        darkness,
        printSpeed,
        orientation,
        marginTop,
        marginBottom ?? 2,
        marginLeft,
        marginRight ?? 2,
        labelsPerRow,
        labelsPerColumn ?? 1,
        horizontalGap,
        verticalGap ?? 2,
        showName ? 1 : 0,
        showSku ? 1 : 0,
        showEan13 ? 1 : 0,
        showDun14 ? 1 : 0,
        labelShift ?? 0,
        labelTop ?? 0,
      ],
    });
    res.status(201).json(req.body);
  } catch (error: any) {
    console.error(error);
    res
      .status(500)
      .json({ error: `Failed to save label format: ${error.message}` });
  }
});

app.put("/api/label-formats/:id", async (req, res) => {
  const { id } = req.params;
  const {
    name,
    width,
    height,
    dpi,
    darkness,
    printSpeed,
    orientation,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    labelsPerRow,
    labelsPerColumn,
    horizontalGap,
    verticalGap,
    showName,
    showSku,
    showEan13,
    showDun14,
    labelShift,
    labelTop,
  } = req.body;
  try {
    await db.execute({
      sql: "UPDATE label_formats SET name=?, width=?, height=?, dpi=?, darkness=?, printSpeed=?, orientation=?, marginTop=?, marginBottom=?, marginLeft=?, marginRight=?, labelsPerRow=?, labelsPerColumn=?, horizontalGap=?, verticalGap=?, showName=?, showSku=?, showEan13=?, showDun14=?, labelShift=?, labelTop=? WHERE id=?",
      args: [
        name,
        width,
        height,
        dpi,
        darkness,
        printSpeed,
        orientation,
        marginTop,
        marginBottom ?? 2,
        marginLeft,
        marginRight ?? 2,
        labelsPerRow,
        labelsPerColumn ?? 1,
        horizontalGap,
        verticalGap ?? 2,
        showName ? 1 : 0,
        showSku ? 1 : 0,
        showEan13 ? 1 : 0,
        showDun14 ? 1 : 0,
        labelShift ?? 0,
        labelTop ?? 0,
        id,
      ],
    });
    res.json(req.body);
  } catch (error: any) {
    console.error(error);
    res
      .status(500)
      .json({ error: `Failed to update label format: ${error.message}` });
  }
});

app.delete("/api/label-formats/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute({
      sql: "DELETE FROM label_formats WHERE id = ?",
      args: [id],
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete label format" });
  }
});

// Printer Management API
app.get('/api/printers', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM printers ORDER BY is_default DESC, name ASC');
    const printers = result.rows.map((row: any) => ({
      ...row,
      is_default: Boolean(row.is_default),
    }));
    res.json(printers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch printers' });
  }
});

app.post('/api/printers', async (req, res) => {
  const { name, ip, port, type } = req.body;
  if (!name || !ip) {
    return res.status(400).json({ error: 'Name and IP are required' });
  }
  try {
    const result = await db.execute({
      sql: 'INSERT INTO printers (name, ip, port, type) VALUES (?, ?, ?, ?)',
      args: [name, ip, port || 9100, type || 'network'],
    });
    res.status(201).json({
      id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
      name, ip, port: port || 9100, type: type || 'network', is_default: false,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: `Failed to add printer: ${error.message}` });
  }
});

app.put('/api/printers/:id', async (req, res) => {
  const { id } = req.params;
  const { name, ip, port, type, is_default } = req.body;
  try {
    if (is_default) {
      await db.execute('UPDATE printers SET is_default = 0');
    }
    await db.execute({
      sql: 'UPDATE printers SET name = ?, ip = ?, port = ?, type = ?, is_default = ? WHERE id = ?',
      args: [name, ip, port || 9100, type || 'network', is_default ? 1 : 0, id],
    });
    res.json({ id: Number(id), name, ip, port: port || 9100, type: type || 'network', is_default: Boolean(is_default) });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: `Failed to update printer: ${error.message}` });
  }
});

app.delete('/api/printers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute({ sql: 'DELETE FROM printers WHERE id = ?', args: [id] });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete printer' });
  }
});

app.post('/api/print', async (req, res) => {
  const { zpl, printerId, printerIp, printerPort } = req.body;
  if (!zpl) {
    return res.status(400).json({ error: 'ZPL data is required' });
  }

  let targetIp = printerIp;
  let targetPort = printerPort || 9100;

  // If printerId is provided, look up the printer
  if (printerId && !printerIp) {
    try {
      const result = await db.execute({ sql: 'SELECT * FROM printers WHERE id = ?', args: [printerId] });
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Printer not found' });
      }
      targetIp = result.rows[0].ip as string;
      targetPort = result.rows[0].port as number;
    } catch (error) {
      return res.status(500).json({ error: 'Failed to look up printer' });
    }
  }

  if (!targetIp) {
    return res.status(400).json({ error: 'Printer IP is required (either via printerId or printerIp)' });
  }

  // Send ZPL via raw TCP socket to port 9100
  const client = new net.Socket();
  let responded = false;

  const timeout = setTimeout(() => {
    if (!responded) {
      responded = true;
      client.destroy();
      res.status(504).json({ error: `Timeout connecting to printer at ${targetIp}:${targetPort}` });
    }
  }, 5000);

  client.connect(targetPort, targetIp, () => {
    client.write(zpl, () => {
      client.end();
    });
  });

  client.on('close', () => {
    clearTimeout(timeout);
    if (!responded) {
      responded = true;
      res.json({ success: true, message: `ZPL sent to ${targetIp}:${targetPort}` });
    }
  });

  client.on('error', (err: any) => {
    clearTimeout(timeout);
    if (!responded) {
      responded = true;
      console.error('Print TCP error:', err.message);
      res.status(500).json({ error: `Failed to connect to printer at ${targetIp}:${targetPort}: ${err.message}` });
    }
  });
});

app.post('/api/print/test', async (req, res) => {
  const { ip, port } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'Printer IP is required' });
  }

  const targetPort = port || 9100;
  const client = new net.Socket();
  let responded = false;

  const timeout = setTimeout(() => {
    if (!responded) {
      responded = true;
      client.destroy();
      res.status(504).json({ error: `Timeout: No response from ${ip}:${targetPort}` });
    }
  }, 3000);

  client.connect(targetPort, ip, () => {
    clearTimeout(timeout);
    if (!responded) {
      responded = true;
      client.destroy();
      res.json({ success: true, message: `Successfully connected to ${ip}:${targetPort}` });
    }
  });

  client.on('error', (err: any) => {
    clearTimeout(timeout);
    if (!responded) {
      responded = true;
      res.status(500).json({ error: `Cannot connect to ${ip}:${targetPort}: ${err.message}` });
    }
  });
});

// ===== USB PRINTING VIA WINDOWS SPOOLER =====

// List system printers (Windows)
app.get('/api/system-printers', (req, res) => {
  if (os.platform() !== 'win32') {
    return res.json([]);
  }
  exec('powershell -NoProfile -Command "Get-Printer | Select-Object Name, PortName, DriverName, PrinterStatus | ConvertTo-Json -Compress"',
    { timeout: 5000 },
    (err, stdout) => {
      if (err) {
        console.error('Get-Printer error:', err.message);
        return res.json([]);
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const all = Array.isArray(parsed) ? parsed : [parsed];
        // Only show Zebra printers (ZDesigner drivers)
        const printers = all.filter((p: any) => p.DriverName && p.DriverName.includes('ZDesigner'));
        res.json(printers);
      } catch {
        res.json([]);
      }
    }
  );
});

// Print raw ZPL to a Windows system printer (USB)
app.post('/api/print/usb', async (req, res) => {
  const { zpl, printerName } = req.body;
  if (!zpl || !printerName) {
    return res.status(400).json({ error: 'ZPL and printer name are required' });
  }

  // Write ZPL to temp file
  const tempFile = path.join(os.tmpdir(), `zebra_label_${Date.now()}.zpl`);
  fs.writeFileSync(tempFile, zpl, 'utf-8');

  const scriptPath = path.join(process.cwd(), 'scripts', 'raw-print.ps1');
  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -PrinterName "${printerName.replace(/"/g, '\`"')}" -FilePath "${tempFile}"`;

  exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
    // Cleanup temp file just in case
    try { fs.unlinkSync(tempFile); } catch {}

    if (err) {
      console.error('USB print error:', err.message, stderr);
      addLog('error', 'print-usb', `Error imprimiendo en "${printerName}"`, stderr || err.message);
      return res.status(500).json({ error: `Error de impresión: ${stderr || err.message}` });
    }

    const output = stdout.trim();
    if (output === 'OK') {
      console.log(`🖨️ ZPL enviado a "${printerName}"`);
      addLog('success', 'print-usb', `Impreso en "${printerName}"`, `Directo USB/Local`);
      res.json({ success: true, message: `Etiqueta enviada a ${printerName}` });
    } else {
      console.error('Print result:', output);
      res.status(500).json({ error: `Impresión fallida: ${output}` });
    }
  });
});

// ─── Empleados CRUD ─────────────────────────────────────────────────────────
app.get('/api/empleados', async (_req, res) => {
  try {
    const result = await db.execute('SELECT * FROM empleados ORDER BY nombre');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/empleados', async (req, res) => {
  const { nombre, linea_proceso, labor } = req.body;
  try {
    // Auto-generate next correlative code: 001, 002, ...
    const maxResult = await db.execute('SELECT MAX(CAST(codigo AS INTEGER)) as maxCode FROM empleados');
    const maxCode = Number(maxResult.rows[0]?.maxCode) || 0;
    const codigo = String(maxCode + 1).padStart(3, '0');

    const result = await db.execute({
      sql: 'INSERT INTO empleados (codigo, nombre, linea_proceso, labor) VALUES (?, ?, ?, ?)',
      args: [codigo, nombre, linea_proceso || null, labor || null],
    });
    res.status(201).json({
      id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
      codigo,
      nombre,
      linea_proceso,
      labor,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/empleados/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, linea_proceso, labor } = req.body;
  try {
    await db.execute({
      sql: 'UPDATE empleados SET nombre = ?, linea_proceso = ?, labor = ? WHERE id = ?',
      args: [nombre, linea_proceso || null, labor || null, Number(id)],
    });
    res.json({ id: Number(id), codigo: req.body.codigo, nombre, linea_proceso, labor });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/empleados/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute({ sql: 'DELETE FROM empleados WHERE id = ?', args: [Number(id)] });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Label Designs CRUD ──────────────────────────────────────────────────────
app.get('/api/label-designs', async (_req, res) => {
  try {
    const result = await db.execute('SELECT * FROM label_designs ORDER BY updated_at DESC');
    const rows = result.rows.map((r: any) => ({
      ...r,
      elements: JSON.parse(r.elements || '[]'),
    }));
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/label-designs', async (req, res) => {
  const { name, format_id, elements } = req.body;
  try {
    const now = new Date().toISOString();
    const result = await db.execute({
      sql: 'INSERT INTO label_designs (name, format_id, elements, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: [name, format_id, JSON.stringify(elements), now, now],
    });
    res.status(201).json({
      id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
      name, format_id, elements, created_at: now, updated_at: now,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/label-designs/:id', async (req, res) => {
  const { id } = req.params;
  const { name, format_id, elements } = req.body;
  try {
    const now = new Date().toISOString();
    await db.execute({
      sql: 'UPDATE label_designs SET name = ?, format_id = ?, elements = ?, updated_at = ? WHERE id = ?',
      args: [name, format_id, JSON.stringify(elements), now, Number(id)],
    });
    res.json({ id: Number(id), name, format_id, elements, updated_at: now });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/label-designs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute({ sql: 'DELETE FROM label_designs WHERE id = ?', args: [Number(id)] });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 ZebraBridge Pro running on http://localhost:${PORT}`);
    console.log(`   DB: Turso Cloud`);
    console.log(`   Printing: USB (Windows Spooler) + TCP/IP (Port 9100)\n`);

    // Auto-register as bridge + poll print queue (only on Windows / non-Cloud)
    if (os.platform() === 'win32') {
      startBridgeServices();
    }
  });
}

// ── Bridge auto-registration & queue polling (for dev/local server) ──────────
function getLocalIp(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function startBridgeServices() {
  const localIp = getLocalIp();
  const hostname = os.hostname();
  const bridgeId = `bridge-${hostname}-${localIp}`.replace(/[^a-zA-Z0-9\-\.]/g, '_');

  console.log(`\n☁️  Bridge ID: ${bridgeId}`);
  console.log(`   Local IP: ${localIp}`);

  // Register with cloud DB
  async function registerBridge() {
    try {
      const printers = await new Promise<any[]>((resolve) => {
        exec('powershell -NoProfile -Command "Get-Printer | Select-Object Name, DriverName | ConvertTo-Json -Compress"',
          { timeout: 5000 },
          (err, stdout) => {
            if (err) { resolve([]); return; }
            try {
              const parsed = JSON.parse(stdout.trim());
              const all = Array.isArray(parsed) ? parsed : [parsed];
              // Only register Zebra printers
              resolve(all.filter((p: any) => p.DriverName && p.DriverName.includes('ZDesigner')));
            } catch { resolve([]); }
          }
        );
      });

      await db.execute({
        sql: `INSERT INTO print_bridges (id, hostname, localIp, port, printers, lastSeen)
              VALUES (?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
              hostname = ?, localIp = ?, port = ?, printers = ?, lastSeen = datetime('now')`,
        args: [bridgeId, hostname, localIp, PORT, JSON.stringify(printers),
               hostname, localIp, PORT, JSON.stringify(printers)]
      });
      console.log(`☁️  Registrado en Cloud: ${hostname} (${localIp}) — ${printers.length} impresoras`);
      addLog('info', 'bridge', `Bridge registrado: ${hostname}`, `IP: ${localIp}, ${printers.length} impresoras`);
    } catch (err: any) {
      console.log(`⚠️  Error registrando bridge: ${err.message}`);
    }
  }

  // Poll print queue for pending jobs
  async function pollQueue() {
    try {
      const result = await db.execute({
        sql: "SELECT * FROM print_queue WHERE bridgeId = ? AND status = 'pending' ORDER BY createdAt ASC LIMIT 5",
        args: [bridgeId],
      });

      if (result.rows.length === 0) return;

      console.log(`📋 ${result.rows.length} trabajo(s) en cola`);

      for (const job of result.rows) {
        try {
          const zpl = job.zpl as string;
          const printerName = job.printerName as string;
          const tempFile = path.join(os.tmpdir(), `zpl_queue_${Date.now()}.txt`);
          fs.writeFileSync(tempFile, zpl, 'utf-8');

          const scriptPath = path.join(process.cwd(), 'scripts', 'raw-print.ps1');
          const safeName = printerName.replace(/"/g, '`"');
          await new Promise<void>((resolve, reject) => {
            exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -PrinterName "${safeName}" -FilePath "${tempFile}"`,
              { timeout: 15000 },
              (err, stdout) => {
                const output = (stdout || '').trim();
                try { fs.unlinkSync(tempFile); } catch {}
                if (err || output.startsWith('FAIL') || output.startsWith('ERROR')) {
                  reject(new Error(output || err?.message || 'Print failed'));
                } else {
                  resolve();
                }
              }
            );
          });

          console.log(`🖨️  Cola: Impreso en "${printerName}" (job ${job.id})`);
          addLog('success', 'print-queue', `Cola: Impreso en "${printerName}"`, `Job ID: ${job.id}`);
          await db.execute({
            sql: "UPDATE print_queue SET status = 'completed', completedAt = datetime('now') WHERE id = ?",
            args: [job.id as number],
          });
        } catch (err: any) {
          console.error(`❌ Cola: Error job ${job.id}: ${err.message}`);
          addLog('error', 'print-queue', `Cola: Error en "${printerName}"`, `Job ${job.id}: ${err.message}`);
          await db.execute({
            sql: "UPDATE print_queue SET status = 'error', completedAt = datetime('now') WHERE id = ?",
            args: [job.id as number],
          });
        }
      }

      // Cleanup old jobs
      await db.execute("DELETE FROM print_queue WHERE status != 'pending' AND createdAt < datetime('now', '-1 hour')");
    } catch {}
  }

  // Start services
  registerBridge();
  setInterval(registerBridge, 30 * 1000); // Every 30 seconds

  console.log("📋 Polling cola de impresión cada 5 segundos...");
  setInterval(pollQueue, 5000); // Every 5 seconds
}

startServer();

