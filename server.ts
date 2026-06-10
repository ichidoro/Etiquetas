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

app.use(cors());
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
}

initDb().catch((err) => {
  console.error("Failed to initialize database:", err);
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
      args: [sku, item_name, business_line || null, family || null, ean13 || null, dun14 || null, marca || null, caducidad || null, isActivo, isp || null],
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
      args: [sku, item_name, business_line || null, family || null, ean13 || null, dun14 || null, marca || null, caducidad || null, isActivo, isp || null, id],
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
        p.marca || null,
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
  } = req.body;
  try {
    await db.execute({
      sql: "INSERT INTO label_formats (id, name, width, height, dpi, darkness, printSpeed, orientation, marginTop, marginBottom, marginLeft, marginRight, labelsPerRow, labelsPerColumn, horizontalGap, verticalGap, showName, showSku, showEan13, showDun14) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
  } = req.body;
  try {
    await db.execute({
      sql: "UPDATE label_formats SET name=?, width=?, height=?, dpi=?, darkness=?, printSpeed=?, orientation=?, marginTop=?, marginBottom=?, marginLeft=?, marginRight=?, labelsPerRow=?, labelsPerColumn=?, horizontalGap=?, verticalGap=?, showName=?, showSku=?, showEan13=?, showDun14=? WHERE id=?",
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
        const printers = Array.isArray(parsed) ? parsed : [parsed];
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
      return res.status(500).json({ error: `Error de impresión: ${stderr || err.message}` });
    }

    const output = stdout.trim();
    if (output === 'OK') {
      console.log(`🖨️ ZPL enviado a "${printerName}"`);
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
  });
}

startServer();
