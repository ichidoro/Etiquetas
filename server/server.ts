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
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function callAutoTable(doc: any, options: any) {
  const fn: any = typeof autoTable === 'function'
    ? autoTable
    : (autoTable as any).default || (autoTable as any).autoTable;
  if (typeof fn !== 'function') {
    throw new Error('jspdf-autotable could not be loaded as a function');
  }
  fn(doc, options);
}

function formatRecipientJid(rec: string): string {
  const clean = rec.trim();
  if (!clean) return '';
  if (clean.includes('@')) {
    return clean;
  }
  const digits = clean.replace(/\D/g, '');
  if (!digits) return '';
  return `${digits}@s.whatsapp.net`;
}

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

export const db = createClient({
  url: dbUrl,
  authToken: dbToken,
});

import { initWhatsApp, disconnectWhatsApp, connectionStatus, qrCodeBase64, sock } from "./whatsapp";

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
      marca TEXT,
      termocontraible_default INTEGER DEFAULT 0,
      envase_secundario_default INTEGER DEFAULT 0,
      cant_grupal INTEGER DEFAULT 0,
      cant_individual INTEGER DEFAULT 0,
      formato TEXT
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

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tipos_empaque_secundario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      requiere_empaque_grupal INTEGER DEFAULT 1
    )
  `);

  try {
    const checkTypes = await db.execute("SELECT COUNT(*) as count FROM tipos_empaque_secundario");
    const count = Number(checkTypes.rows[0]?.count || 0);
    if (count === 0) {
      await db.execute("INSERT INTO tipos_empaque_secundario (nombre, requiere_empaque_grupal) VALUES ('NO APLICA', 0)");
      await db.execute("INSERT INTO tipos_empaque_secundario (nombre, requiere_empaque_grupal) VALUES ('TERMOCONTRAIBLE', 1)");
      await db.execute("INSERT INTO tipos_empaque_secundario (nombre, requiere_empaque_grupal) VALUES ('CAJA', 1)");
    }
  } catch (e) {
    console.error("Error seeding tipos_empaque_secundario", e);
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tipos_envase_primario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT DEFAULT '',
      nombre TEXT UNIQUE NOT NULL,
      activo INTEGER DEFAULT 1
    )
  `);

  try {
    await db.execute("ALTER TABLE tipos_envase_primario ADD COLUMN codigo TEXT DEFAULT '';");
  } catch (e) {}
  try {
    await db.execute("ALTER TABLE tipos_envase_primario ADD COLUMN activo INTEGER DEFAULT 1;");
  } catch (e) {}

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tipos_tapa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT DEFAULT '',
      nombre TEXT UNIQUE NOT NULL,
      activo INTEGER DEFAULT 1
    )
  `);

  try {
    const checkSeed = await db.execute("SELECT COUNT(*) as count FROM tipos_tapa");
    const count = Number(checkSeed.rows[0]?.count || 0);
    if (count === 0) {
      const defaultTapas = [
        { codigo: '2015', nombre: 'TAPA TRANSPARENTE BOTELLA PET 1LT / 2LT' },
        { codigo: '600', nombre: 'TAPA AZUL SINEA' },
        { codigo: '601', nombre: 'TAPA BLANCA DETERGENTE' },
        { codigo: '605', nombre: 'TAPA NEGRA SINEA' },
        { codigo: '606', nombre: 'TAPA NARANJA SINEA' },
        { codigo: '610', nombre: 'TAPA ROJA SINEA' },
        { codigo: '620', nombre: 'TAPA VERDE SINEA' },
        { codigo: '7047', nombre: 'TAPA TRANSPARENTE SINEA' },
        { codigo: '7055', nombre: 'TAPA LAVALOZAS 750ML' },
        { codigo: '7057', nombre: 'TAPA TRANSPARENTE PARA SUAVIZANTE' }
      ];
      for (const t of defaultTapas) {
        await db.execute({
          sql: "INSERT INTO tipos_tapa (codigo, nombre) VALUES (?, ?)",
          args: [t.codigo, t.nombre]
        });
      }
      console.log("Tipos de tapa seeded successfully.");
    }
  } catch (e) {
    console.error("Error seeding tipos_tapa", e);
  }

  try {
    const checkSeed = await db.execute("SELECT COUNT(*) as count FROM tipos_envase_primario WHERE codigo = '209'");
    const hasSeed = Number(checkSeed.rows[0]?.count || 0) > 0;
    if (!hasSeed) {
      // Migrate existing products to their new counterparts if they exist
      try {
        await db.execute("UPDATE products SET envase_primario_tipo = 'BIDON PLASTICO APILABLE AZUL' WHERE envase_primario_tipo = 'APILABLE AZUL'");
        await db.execute("UPDATE products SET envase_primario_tipo = 'BIDON PLASTICO APILABLE BLANCO' WHERE envase_primario_tipo = 'APILABLE BLANCO'");
        await db.execute("UPDATE products SET envase_primario_tipo = 'BIDON PLASTICO APILABLE BLANCO' WHERE envase_primario_tipo = 'BIDÓN'");
        await db.execute("UPDATE products SET envase_primario_tipo = 'BIDON PLASTICO 5 LT APILABLE' WHERE envase_primario_tipo = 'APILABLE NATURAL'");
        await db.execute("UPDATE products SET envase_primario_tipo = 'GALON AMARILLO 4 LTS' WHERE envase_primario_tipo = 'GALON AMARILLO'");
        await db.execute("UPDATE products SET envase_primario_tipo = 'GALON NATURAL 4 LTS' WHERE envase_primario_tipo = 'GALON NATURAL'");
        await db.execute("UPDATE products SET envase_primario_tipo = 'BOTELLA PET 1 LT' WHERE envase_primario_tipo = 'BOTELLA' OR envase_primario_tipo = 'PET'");
        await db.execute("UPDATE products SET envase_primario_tipo = 'POTES 1 KILO' WHERE envase_primario_tipo = 'POTE'");
      } catch (e) {
        console.error("Error migrating old product envase_primario_tipo references", e);
      }

      await db.execute("DELETE FROM tipos_envase_primario");
      const defaultEnvasesPrimarios = [
        { codigo: '209', nombre: 'BIDON PLASTICO APILABLE AZUL' },
        { codigo: '202', nombre: 'BIDON PLASTICO 5 LT APILABLE' },
        { codigo: '205', nombre: 'BIDON PLASTICO DETERGENTE 3 LTS AZUL' },
        { codigo: '211', nombre: 'BIDON PLASTICO DETERGENTE 3 LTS CELESTE' },
        { codigo: '207', nombre: 'BIDON PLASTICO DETERGENTE 3 LTS VERDE' },
        { codigo: '300', nombre: 'GALON AMARILLO 4 LTS' },
        { codigo: '400', nombre: 'GALON NATURAL 4 LTS' },
        { codigo: '112102014', nombre: 'BOTELLA MAESTRO PLOMERO NEGRA 1 LT' },
        { codigo: '2015', nombre: 'TAPA TRANSPARENTE BOTELLA PET 1LT / 2LT' },
        { codigo: '2021', nombre: 'BOTELLA POLIETILENO NATURAL 1 LT (DESENG)' },
        { codigo: '2022', nombre: 'GATILLO (TRIGER ESTANDAR)' },
        { codigo: '2023', nombre: 'BOTELLA . PEAD 500 ML C/C BLANCO' },
        { codigo: '2024', nombre: 'BOMBA DISPENSADORA JABON' },
        { codigo: '4450', nombre: 'ENVASE PLASTICOS 4,5 LTS NATURAL' },
        { codigo: '4451', nombre: 'ENVASE PLASTICOS 4,5 LTS AMARILLO' },
        { codigo: '4452', nombre: 'ENVASE PLASTICOS 4,5 LTS NEGRO' },
        { codigo: '500', nombre: 'BOTELLA PET 1 LT' },
        { codigo: '5051', nombre: 'POTES 1 KILO' },
        { codigo: '510', nombre: 'BOTELLA PET 1 LT CILINDRICA' },
        { codigo: '600', nombre: 'TAPA AZUL SINEA' },
        { codigo: '601', nombre: 'TAPA BLANCA DETERGENTE' },
        { codigo: '6013', nombre: 'BIDON PLASTICO 10 LT.' },
        { codigo: '605', nombre: 'TAPA NEGRA SINEA' },
        { codigo: '606', nombre: 'TAPA NARANJA SINEA' },
        { codigo: '610', nombre: 'TAPA ROJA SINEA' },
        { codigo: '620', nombre: 'TAPA VERDE SINEA' },
        { codigo: '70238', nombre: 'BOTELLA PET 1/2 LITRO' },
        { codigo: '7047', nombre: 'TAPA TRANSPARENTE SINEA' },
        { codigo: '7050', nombre: 'BIDON PLASTICO APILABLE BLANCO' },
        { codigo: '7054', nombre: 'BOTELLA LAVALOZA 750 ML' },
        { codigo: '7055', nombre: 'TAPA LAVALOZAS 750ML' },
        { codigo: '7056', nombre: 'BOTELLA SUAVIZANTE 1 LT' },
        { codigo: '7057', nombre: 'TAPA TRANSPARENTE PARA SUAVIZANTE' },
        { codigo: '7081', nombre: 'BIDON PET 5 LTS TAPA AZUL' },
        { codigo: '7092', nombre: 'BIDON PLASTICO BLANCO 10 LTS' },
        { codigo: '7097', nombre: 'BIDON PET 2LT' }
      ];
      for (const env of defaultEnvasesPrimarios) {
        await db.execute({
          sql: "INSERT INTO tipos_envase_primario (codigo, nombre) VALUES (?, ?)",
          args: [env.codigo, env.nombre]
        });
      }
      console.log("Tipos de envase primario seeded successfully.");
    }
  } catch (e) {
    console.error("Error seeding tipos_envase_primario", e);
  }

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
    await db.execute("ALTER TABLE products ADD COLUMN termocontraible_default INTEGER DEFAULT 0;");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN envase_secundario_default INTEGER DEFAULT 0;");
    await db.execute("UPDATE products SET envase_secundario_default = termocontraible_default;");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN cant_grupal INTEGER DEFAULT 0;");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN cant_individual INTEGER DEFAULT 0;");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN formato TEXT;");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN envase_secundario_tipo TEXT DEFAULT 'NO APLICA';");
    await db.execute("UPDATE products SET envase_secundario_tipo = 'TERMOCONTRAIBLE' WHERE envase_secundario_default = 1 AND (envase_secundario_tipo IS NULL OR envase_secundario_tipo = 'NO APLICA');");
    await db.execute("UPDATE products SET envase_secundario_tipo = 'NO APLICA' WHERE (envase_secundario_default = 0 OR envase_secundario_default IS NULL) AND envase_secundario_tipo IS NULL;");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN envase_primario_tipo TEXT DEFAULT 'BOTELLA';");
  } catch {}
  try {
    await db.execute("ALTER TABLE products ADD COLUMN tapa_tipo TEXT DEFAULT 'NO APLICA';");
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

  // Migrate print_history table columns if they do not exist
  try {
    await db.execute("ALTER TABLE print_history ADD COLUMN label_type TEXT;");
  } catch {}
  try {
    await db.execute("ALTER TABLE print_history ADD COLUMN format_id TEXT;");
  } catch {}
  try {
    await db.execute("ALTER TABLE print_history ADD COLUMN labels_per_row INTEGER DEFAULT 1;");
  } catch {}
  try {
    await db.execute("ALTER TABLE print_history ADD COLUMN physical_labels INTEGER DEFAULT 1;");
  } catch {}
  try {
    await db.execute("ALTER TABLE print_history ADD COLUMN waste_labels INTEGER DEFAULT 0;");
  } catch {}
  try {
    await db.execute("ALTER TABLE print_history ADD COLUMN operator_code TEXT;");
  } catch {}
  try {
    await db.execute("ALTER TABLE print_history ADD COLUMN process_line TEXT;");
  } catch {}
  try {
    await db.execute("ALTER TABLE print_history ADD COLUMN printed_barcodes TEXT;");
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

  // Create lineas_proceso table
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS lineas_proceso (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      descripcion TEXT NOT NULL,
      tipo_maquina TEXT
    )`);
    // Migration: add whatsapp_group_id column to lineas_proceso if it doesn't exist
    try {
      await db.execute(`ALTER TABLE lineas_proceso ADD COLUMN whatsapp_group_id TEXT DEFAULT NULL`);
    } catch (e) {}
    // Migration: add whatsapp_phone column to lineas_proceso if it doesn't exist
    try {
      await db.execute(`ALTER TABLE lineas_proceso ADD COLUMN whatsapp_phone TEXT DEFAULT NULL`);
    } catch (e) {}
    // Migration: add operador column to lineas_proceso if it doesn't exist
    try {
      await db.execute(`ALTER TABLE lineas_proceso ADD COLUMN operador TEXT DEFAULT NULL`);
    } catch (e) {}
  } catch (e) {
    console.error("Error creating lineas_proceso table", e);
  }

  // Create planificaciones table
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS planificaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      linea_id INTEGER NOT NULL,
      product_sku TEXT NOT NULL,
      cantidad_programada INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      turno TEXT,
      estado TEXT DEFAULT 'programado',
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    try {
      await db.execute(`ALTER TABLE planificaciones ADD COLUMN termocontraible TEXT DEFAULT 'Sin Termocontraible'`);
    } catch (e) {}
    try {
      await db.execute(`ALTER TABLE planificaciones ADD COLUMN envase_secundario TEXT DEFAULT 'Sin Envase Secundario'`);
      await db.execute(`UPDATE planificaciones SET envase_secundario = 'Con Envase Secundario' WHERE termocontraible = 'Termocontraible'`);
      await db.execute(`UPDATE planificaciones SET envase_secundario = 'Sin Envase Secundario' WHERE termocontraible = 'Sin Termocontraible' OR termocontraible IS NULL`);
    } catch (e) {}
    try {
      await db.execute(`ALTER TABLE planificaciones ADD COLUMN observaciones TEXT DEFAULT NULL`);
    } catch (e) {}
    try {
      await db.execute(`ALTER TABLE planificaciones ADD COLUMN prioridad INTEGER DEFAULT 0`);
    } catch (e) {}
    try {
      await db.execute(`ALTER TABLE planificaciones ADD COLUMN envase_secundario_tipo TEXT DEFAULT 'NO APLICA'`);
      await db.execute(`UPDATE planificaciones SET envase_secundario_tipo = 'TERMOCONTRAIBLE' WHERE (envase_secundario = 'Con Envase Secundario' OR termocontraible = 'Termocontraible') AND (envase_secundario_tipo IS NULL OR envase_secundario_tipo = 'NO APLICA')`);
      await db.execute(`UPDATE planificaciones SET envase_secundario_tipo = 'NO APLICA' WHERE envase_secundario_tipo IS NULL`);
    } catch (e) {}
    try {
      await db.execute(`UPDATE planificaciones SET turno = 'Mañana' WHERE turno = 'Día' OR turno = 'dia' OR turno = 'DIA'`);
    } catch (e) {}
  } catch (e) {
    console.error("Error creating planificaciones table", e);
  }

  // Create system_config table
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  } catch (e) {
    console.error("Error creating system_config table", e);
  }

  // Create whatsapp_session table (for baileys session persistence)
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS whatsapp_session (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  } catch (e) {
    console.error("Error creating whatsapp_session table", e);
  }

  // Create whatsapp_notification_history table
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_notification_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        linea_id INTEGER NOT NULL,
        fecha TEXT NOT NULL,
        version INTEGER DEFAULT 1,
        whatsapp_msg_id TEXT NOT NULL,
        whatsapp_recipient TEXT NOT NULL,
        content_state TEXT DEFAULT NULL,
        sent_type TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (e) {
    console.error("Error creating whatsapp_notification_history table", e);
  }

  const productCount = await db.execute("SELECT COUNT(*) as count FROM products");
  console.log(`📦 ${productCount.rows[0].count} productos en la base de datos Turso.`);

  // Migration: uppercase all existing marcas
  try {
    await db.execute("UPDATE products SET marca = UPPER(marca) WHERE marca IS NOT NULL AND marca != UPPER(marca)");
  } catch {}

  // Alignment: Synchronize all pending planificaciones with their product's current envase_secundario_tipo on startup
  try {
    await db.execute(`
      UPDATE planificaciones
      SET envase_secundario_tipo = (
        SELECT envase_secundario_tipo 
        FROM products 
        WHERE products.sku = planificaciones.product_sku
      )
      WHERE estado = 'programado'
        AND EXISTS (
          SELECT 1 
          FROM products 
          WHERE products.sku = planificaciones.product_sku 
            AND products.envase_secundario_tipo IS NOT NULL
        )
    `);
    console.log("🔄 Sincronizados empaques secundarios de planificaciones programadas con Maestro de SKU.");
  } catch (e) {
    console.error("Error al sincronizar empaques secundarios de planificaciones:", e);
  }
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
  db.execute("SELECT COUNT(*) as count FROM whatsapp_session WHERE key = 'creds'")
    .then((res) => {
      if (res.rows[0]?.count > 0) {
        const isLocalDev = process.env.NODE_ENV !== "production";
        const enableForce = process.env.ENABLE_WHATSAPP === "true";
        if (isLocalDev && !enableForce) {
          console.log("\n[WhatsApp] ⚠️  Entorno local detectado. Se omite la auto-conexión de WhatsApp para evitar conflictos de sesión con el servidor de producción.");
          console.log("[WhatsApp]    Si deseas forzar la conexión en local, agrega la variable ENABLE_WHATSAPP=true en tu archivo .env.\n");
        } else {
          console.log("[WhatsApp] Sesión detectada en base de datos. Auto-conectando...");
          initWhatsApp().catch(() => {});
        }
      }
    })
    .catch((err) => {
      console.error("[WhatsApp] Error al verificar sesión en la base de datos:", err);
    });
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
    const {
      productName,
      productSku,
      printerName,
      mode,
      copies,
      status,
      bridgeId,
      details,
      label_type,
      format_id,
      labels_per_row,
      physical_labels,
      waste_labels,
      operator_code,
      process_line,
      printed_barcodes,
    } = req.body;

    await db.execute({
      sql: `INSERT INTO print_history (
        productName, productSku, printerName, mode, copies, status, bridgeId, details,
        label_type, format_id, labels_per_row, physical_labels, waste_labels,
        operator_code, process_line, printed_barcodes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        productName || null,
        productSku || null,
        printerName,
        mode || 'local',
        copies || 1,
        status || 'success',
        bridgeId || null,
        details || null,
        label_type || null,
        format_id || null,
        labels_per_row || 1,
        physical_labels || 1,
        waste_labels || 0,
        operator_code || null,
        process_line || null,
        printed_barcodes || null,
      ],
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
      business_line: row.business_line ? row.business_line.toUpperCase() : row.business_line,
      family: row.family ? row.family.toUpperCase() : row.family,
      envase_secundario_default: row.envase_secundario_default === 1 || row.termocontraible_default === 1,
      termocontraible_default: row.envase_secundario_default === 1 || row.termocontraible_default === 1,
      envase_secundario_tipo: row.envase_secundario_tipo || (row.envase_secundario_default === 1 ? 'TERMOCONTRAIBLE' : 'NO APLICA'),
      envase_primario_tipo: row.envase_primario_tipo || 'BOTELLA',
      tapa_tipo: row.tapa_tipo || 'NO APLICA',
    }));
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.post("/api/products", async (req, res) => {
  const { sku, item_name, business_line, family, ean13, dun14, marca, caducidad, activo, isp, termocontraible_default, envase_secundario_default, cant_grupal, cant_individual, formato, envase_secundario_tipo, envase_primario_tipo, tapa_tipo } = req.body;
  try {
    const isActivo = activo !== undefined ? (activo ? 1 : 0) : 1;
    const envTipo = envase_secundario_tipo || (envase_secundario_default || termocontraible_default ? 'TERMOCONTRAIBLE' : 'NO APLICA');
    const isEnvaseSecDefault = envTipo !== 'NO APLICA' ? 1 : 0;
    const cantGrupal = cant_grupal !== undefined && cant_grupal !== null ? Number(cant_grupal) : 0;
    const cantIndividual = cant_individual !== undefined && cant_individual !== null ? Number(cant_individual) : 0;
    const envPrimTipo = envase_primario_tipo || 'BOTELLA';
    const capTipo = tapa_tipo || 'NO APLICA';

    const result = await db.execute({
      sql: "INSERT INTO products (sku, item_name, business_line, family, ean13, dun14, marca, caducidad, activo, isp, termocontraible_default, envase_secundario_default, cant_grupal, cant_individual, formato, envase_secundario_tipo, envase_primario_tipo, tapa_tipo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [sku, item_name, business_line ? String(business_line).toUpperCase() : null, family ? String(family).toUpperCase() : null, ean13 || null, dun14 || null, marca ? String(marca).toUpperCase() : null, caducidad || null, isActivo, isp || null, isEnvaseSecDefault, isEnvaseSecDefault, cantGrupal, cantIndividual, formato || null, envTipo, envPrimTipo, capTipo],
    });
    res.status(201).json({
      id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
      sku,
      item_name,
      business_line: business_line ? String(business_line).toUpperCase() : business_line,
      family: family ? String(family).toUpperCase() : family,
      ean13,
      dun14,
      marca,
      caducidad,
      activo: isActivo === 1,
      isp,
      envase_secundario_default: isEnvaseSecDefault === 1,
      termocontraible_default: isEnvaseSecDefault === 1,
      cant_grupal: cantGrupal,
      cant_individual: cantIndividual,
      formato,
      envase_secundario_tipo: envTipo,
      envase_primario_tipo: envPrimTipo,
      tapa_tipo: capTipo,
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
  const { sku, item_name, business_line, family, ean13, dun14, marca, caducidad, activo, isp, termocontraible_default, envase_secundario_default, cant_grupal, cant_individual, formato, envase_secundario_tipo, envase_primario_tipo, tapa_tipo } = req.body;
  try {
    const isActivo = activo !== undefined ? (activo ? 1 : 0) : 1;
    const envTipo = envase_secundario_tipo || (envase_secundario_default || termocontraible_default ? 'TERMOCONTRAIBLE' : 'NO APLICA');
    const isEnvaseSecDefault = envTipo !== 'NO APLICA' ? 1 : 0;
    const cantGrupal = cant_grupal !== undefined && cant_grupal !== null ? Number(cant_grupal) : 0;
    const cantIndividual = cant_individual !== undefined && cant_individual !== null ? Number(cant_individual) : 0;
    const envPrimTipo = envase_primario_tipo || 'BOTELLA';
    const capTipo = tapa_tipo || 'NO APLICA';

    await db.execute({
      sql: "UPDATE products SET sku = ?, item_name = ?, business_line = ?, family = ?, ean13 = ?, dun14 = ?, marca = ?, caducidad = ?, activo = ?, isp = ?, termocontraible_default = ?, envase_secundario_default = ?, cant_grupal = ?, cant_individual = ?, formato = ?, envase_secundario_tipo = ?, envase_primario_tipo = ?, tapa_tipo = ? WHERE id = ?",
      args: [sku, item_name, business_line ? String(business_line).toUpperCase() : null, family ? String(family).toUpperCase() : null, ean13 || null, dun14 || null, marca ? String(marca).toUpperCase() : null, caducidad || null, isActivo, isp || null, isEnvaseSecDefault, isEnvaseSecDefault, cantGrupal, cantIndividual, formato || null, envTipo, envPrimTipo, capTipo, id],
    });
    // Synchronize pending planificaciones with the new packaging type of this SKU
    await db.execute({
      sql: "UPDATE planificaciones SET envase_secundario_tipo = ? WHERE product_sku = ? AND estado = 'programado'",
      args: [envTipo, sku]
    });
    res.json({ id: Number(id), sku, item_name, business_line: business_line ? String(business_line).toUpperCase() : business_line, family: family ? String(family).toUpperCase() : family, ean13, dun14, marca, caducidad, activo: isActivo === 1, isp, envase_secundario_default: isEnvaseSecDefault === 1, termocontraible_default: isEnvaseSecDefault === 1, cant_grupal: cantGrupal, cant_individual: cantIndividual, formato, envase_secundario_tipo: envTipo, envase_primario_tipo: envPrimTipo, tapa_tipo: capTipo });
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
    const statements = products.map((p: any) => {
      const envTipo = p.envase_secundario_tipo || (p.envase_secundario_default || p.termocontraible_default ? 'TERMOCONTRAIBLE' : 'NO APLICA');
      const isEnvaseSecDefault = envTipo !== 'NO APLICA' ? 1 : 0;
      const envPrimTipo = p.envase_primario_tipo || 'BOTELLA';
      return {
        sql: "INSERT INTO products (sku, item_name, business_line, family, ean13, dun14, marca, caducidad, activo, isp, termocontraible_default, envase_secundario_default, cant_grupal, cant_individual, formato, envase_secundario_tipo, envase_primario_tipo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sku) DO UPDATE SET item_name=excluded.item_name, business_line=excluded.business_line, family=excluded.family, ean13=excluded.ean13, dun14=excluded.dun14, marca=excluded.marca, caducidad=excluded.caducidad, activo=excluded.activo, isp=excluded.isp, termocontraible_default=excluded.termocontraible_default, envase_secundario_default=excluded.envase_secundario_default, cant_grupal=excluded.cant_grupal, cant_individual=excluded.cant_individual, formato=excluded.formato, envase_secundario_tipo=excluded.envase_secundario_tipo, envase_primario_tipo=excluded.envase_primario_tipo",
        args: [
          p.sku,
          p.item_name,
          p.business_line ? String(p.business_line).toUpperCase() : null,
          p.family ? String(p.family).toUpperCase() : null,
          p.ean13 || null,
          p.dun14 || null,
          p.marca ? String(p.marca).toUpperCase() : null,
          p.caducidad || null,
          p.activo !== undefined ? (p.activo ? 1 : 0) : 1,
          p.isp || null,
          isEnvaseSecDefault,
          isEnvaseSecDefault,
          p.cant_grupal !== undefined && p.cant_grupal !== null ? Number(p.cant_grupal) : 0,
          p.cant_individual !== undefined && p.cant_individual !== null ? Number(p.cant_individual) : 0,
          p.formato || null,
          envTipo,
          envPrimTipo,
        ],
      };
    });

    // Execute batch transaction
    await db.batch(statements, "write");

    // Sincronizar empaques de planificaciones programadas
    const syncStatements = products.map((p: any) => {
      const envTipo = p.envase_secundario_tipo || (p.envase_secundario_default || p.termocontraible_default ? 'TERMOCONTRAIBLE' : 'NO APLICA');
      return {
        sql: "UPDATE planificaciones SET envase_secundario_tipo = ? WHERE product_sku = ? AND estado = 'programado'",
        args: [envTipo, p.sku]
      };
    });
    if (syncStatements.length > 0) {
      await db.batch(syncStatements, "write");
    }

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
  const bridgePath = path.join(process.cwd(), "bridge", "print-bridge.mjs");
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

// Tipos de Empaque Secundario API
app.get('/api/tipos-empaque-secundario', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM tipos_empaque_secundario ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch tipos de empaque secundario' });
  }
});

app.post('/api/tipos-empaque-secundario', async (req, res) => {
  const { nombre, requiere_empaque_grupal } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'Nombre es requerido' });
  }
  const cleanName = nombre.trim().toUpperCase();
  const reqGrupal = requiere_empaque_grupal ? 1 : 0;
  try {
    const result = await db.execute({
      sql: 'INSERT INTO tipos_empaque_secundario (nombre, requiere_empaque_grupal) VALUES (?, ?)',
      args: [cleanName, reqGrupal],
    });
    res.status(201).json({
      id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
      nombre: cleanName,
      requiere_empaque_grupal: reqGrupal,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: `Failed to add empaque tipo: ${error.message}` });
  }
});

app.delete('/api/tipos-empaque-secundario/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const checkType = await db.execute({ sql: 'SELECT nombre FROM tipos_empaque_secundario WHERE id = ?', args: [id] });
    if (checkType.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de empaque no encontrado' });
    }
    const nombre = String(checkType.rows[0].nombre);

    // Check usage in products
    const prodCheck = await db.execute({ sql: 'SELECT COUNT(*) as count FROM products WHERE envase_secundario_tipo = ?', args: [nombre] });
    const prodCount = Number(prodCheck.rows[0]?.count || 0);

    // Check usage in planificaciones
    const planCheck = await db.execute({ sql: 'SELECT COUNT(*) as count FROM planificaciones WHERE envase_secundario_tipo = ?', args: [nombre] });
    const planCount = Number(planCheck.rows[0]?.count || 0);

    if (prodCount > 0 || planCount > 0) {
      return res.status(400).json({ error: `No se puede eliminar este tipo de empaque porque está siendo utilizado por ${prodCount} producto(s) y ${planCount} planificación(es).` });
    }

    await db.execute({ sql: 'DELETE FROM tipos_empaque_secundario WHERE id = ?', args: [id] });
    res.json({ success: true });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: `Failed to delete empaque tipo: ${error.message}` });
  }
});

app.put('/api/tipos-empaque-secundario/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, requiere_empaque_grupal } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'Nombre es requerido' });
  }
  const cleanNewName = nombre.trim().toUpperCase();
  const reqGrupal = requiere_empaque_grupal ? 1 : 0;

  try {
    const currentResult = await db.execute({
      sql: 'SELECT nombre FROM tipos_empaque_secundario WHERE id = ?',
      args: [id]
    });
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de empaque secundario no encontrado' });
    }
    const currentName = String(currentResult.rows[0].nombre);

    await db.execute({
      sql: 'UPDATE tipos_empaque_secundario SET nombre = ?, requiere_empaque_grupal = ? WHERE id = ?',
      args: [cleanNewName, reqGrupal, id]
    });

    if (cleanNewName !== currentName) {
      await db.execute({
        sql: 'UPDATE products SET envase_secundario_tipo = ? WHERE envase_secundario_tipo = ?',
        args: [cleanNewName, currentName]
      });
      await db.execute({
        sql: 'UPDATE planificaciones SET envase_secundario_tipo = ? WHERE envase_secundario_tipo = ?',
        args: [cleanNewName, currentName]
      });
    }

    res.json({ success: true, nombre: cleanNewName, requiere_empaque_grupal: reqGrupal });
  } catch (error: any) {
    console.error(error);
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Este tipo de empaque ya existe' });
    }
    res.status(500).json({ error: `Failed to update empaque tipo: ${error.message}` });
  }
});

// Tipos de Envase Primario API
app.get('/api/tipos-envase-primario', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM tipos_envase_primario ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch tipos de envase primario' });
  }
});

app.post('/api/tipos-envase-primario', async (req, res) => {
  const { codigo, nombre, activo } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'Nombre es requerido' });
  }
  const cleanName = nombre.trim().toUpperCase();
  const cleanCodigo = (codigo || "").trim().toUpperCase();
  const cleanActivo = activo === 0 ? 0 : 1;
  try {
    const result = await db.execute({
      sql: 'INSERT INTO tipos_envase_primario (codigo, nombre, activo) VALUES (?, ?, ?)',
      args: [cleanCodigo, cleanName, cleanActivo],
    });
    res.status(201).json({
      id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
      codigo: cleanCodigo,
      nombre: cleanName,
      activo: cleanActivo
    });
  } catch (error: any) {
    console.error(error);
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Este tipo de envase ya existe' });
    }
    res.status(500).json({ error: `Failed to add envase tipo: ${error.message}` });
  }
});

app.put('/api/tipos-envase-primario/:id', async (req, res) => {
  const { id } = req.params;
  const { codigo, nombre, activo } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'Nombre es requerido' });
  }
  const cleanNewName = nombre.trim().toUpperCase();
  const cleanNewCodigo = (codigo || "").trim().toUpperCase();
  const cleanActivo = activo === 0 ? 0 : 1;

  try {
    const currentResult = await db.execute({
      sql: 'SELECT nombre FROM tipos_envase_primario WHERE id = ?',
      args: [id]
    });
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de envase primario no encontrado' });
    }
    const currentName = String(currentResult.rows[0].nombre);

    await db.execute({
      sql: 'UPDATE tipos_envase_primario SET codigo = ?, nombre = ?, activo = ? WHERE id = ?',
      args: [cleanNewCodigo, cleanNewName, cleanActivo, id]
    });

    if (cleanNewName !== currentName) {
      await db.execute({
        sql: 'UPDATE products SET envase_primario_tipo = ? WHERE envase_primario_tipo = ?',
        args: [cleanNewName, currentName]
      });
    }

    res.json({ success: true, codigo: cleanNewCodigo, nombre: cleanNewName, activo: cleanActivo });
  } catch (error: any) {
    console.error(error);
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Este tipo de envase ya existe' });
    }
    res.status(500).json({ error: `Failed to update envase tipo: ${error.message}` });
  }
});

app.delete('/api/tipos-envase-primario/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const checkType = await db.execute({ sql: 'SELECT nombre FROM tipos_envase_primario WHERE id = ?', args: [id] });
    if (checkType.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de envase no encontrado' });
    }
    const nombre = String(checkType.rows[0].nombre);

    // Check usage in products
    const prodCheck = await db.execute({ sql: 'SELECT COUNT(*) as count FROM products WHERE envase_primario_tipo = ?', args: [nombre] });
    const prodCount = Number(prodCheck.rows[0]?.count || 0);

    if (prodCount > 0) {
      return res.status(400).json({ error: `No se puede eliminar este tipo de envase porque está siendo utilizado por ${prodCount} producto(s).` });
    }

    await db.execute({ sql: 'DELETE FROM tipos_envase_primario WHERE id = ?', args: [id] });
    res.json({ success: true });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: `Failed to delete envase tipo: ${error.message}` });
  }
});

// Tipos de Tapa API
app.get('/api/tipos-tapa', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM tipos_tapa ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch tipos de tapa' });
  }
});

app.post('/api/tipos-tapa', async (req, res) => {
  const { codigo, nombre, activo } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'Nombre es requerido' });
  }
  const cleanName = nombre.trim().toUpperCase();
  const cleanCodigo = (codigo || "").trim().toUpperCase();
  const cleanActivo = activo === 0 ? 0 : 1;
  try {
    const result = await db.execute({
      sql: 'INSERT INTO tipos_tapa (codigo, nombre, activo) VALUES (?, ?, ?)',
      args: [cleanCodigo, cleanName, cleanActivo],
    });
    res.status(201).json({
      id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
      codigo: cleanCodigo,
      nombre: cleanName,
      activo: cleanActivo
    });
  } catch (error: any) {
    console.error(error);
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Este tipo de tapa ya existe' });
    }
    res.status(500).json({ error: `Failed to add tapa tipo: ${error.message}` });
  }
});

app.put('/api/tipos-tapa/:id', async (req, res) => {
  const { id } = req.params;
  const { codigo, nombre, activo } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'Nombre es requerido' });
  }
  const cleanNewName = nombre.trim().toUpperCase();
  const cleanNewCodigo = (codigo || "").trim().toUpperCase();
  const cleanActivo = activo === 0 ? 0 : 1;

  try {
    const currentResult = await db.execute({
      sql: 'SELECT nombre FROM tipos_tapa WHERE id = ?',
      args: [id]
    });
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de tapa no encontrado' });
    }
    const currentName = String(currentResult.rows[0].nombre);

    await db.execute({
      sql: 'UPDATE tipos_tapa SET codigo = ?, nombre = ?, activo = ? WHERE id = ?',
      args: [cleanNewCodigo, cleanNewName, cleanActivo, id]
    });

    if (cleanNewName !== currentName) {
      await db.execute({
        sql: 'UPDATE products SET tapa_tipo = ? WHERE tapa_tipo = ?',
        args: [cleanNewName, currentName]
      });
    }

    res.json({ success: true, codigo: cleanNewCodigo, nombre: cleanNewName, activo: cleanActivo });
  } catch (error: any) {
    console.error(error);
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Este tipo de tapa ya existe' });
    }
    res.status(500).json({ error: `Failed to update tapa tipo: ${error.message}` });
  }
});

app.delete('/api/tipos-tapa/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const checkType = await db.execute({ sql: 'SELECT nombre FROM tipos_tapa WHERE id = ?', args: [id] });
    if (checkType.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de tapa no encontrado' });
    }
    const nombre = String(checkType.rows[0].nombre);

    // Check usage in products
    const prodCheck = await db.execute({ sql: 'SELECT COUNT(*) as count FROM products WHERE tapa_tipo = ?', args: [nombre] });
    const prodCount = Number(prodCheck.rows[0]?.count || 0);

    if (prodCount > 0) {
      return res.status(400).json({ error: `No se puede eliminar este tipo de tapa porque está siendo utilizado por ${prodCount} producto(s).` });
    }

    await db.execute({ sql: 'DELETE FROM tipos_tapa WHERE id = ?', args: [id] });
    res.json({ success: true });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: `Failed to delete tapa tipo: ${error.message}` });
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
        // Only show Zebra and Generic / Text Only printers
        const printers = all.filter((p: any) => p.DriverName && (
          p.DriverName.includes('ZDesigner') || 
          p.DriverName.includes('Generic') || 
          p.DriverName.includes('Text Only') || 
          p.DriverName.includes('Solo Texto')
        ));
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

  const scriptPath = path.join(process.cwd(), 'bridge', 'scripts', 'raw-print.ps1');
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

// ─── Líneas de Proceso CRUD ──────────────────────────────────────────────────
app.get('/api/lineas-proceso', async (_req, res) => {
  try {
    const result = await db.execute('SELECT * FROM lineas_proceso ORDER BY codigo');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/lineas-proceso', async (req, res) => {
  const { codigo, descripcion, tipo_maquina, whatsapp_group_id, whatsapp_phone, operador } = req.body;
  if (!codigo || !descripcion) {
    return res.status(400).json({ error: "Faltan campos obligatorios (código, descripción)" });
  }
  try {
    const result = await db.execute({
      sql: 'INSERT INTO lineas_proceso (codigo, descripcion, tipo_maquina, whatsapp_group_id, whatsapp_phone, operador) VALUES (?, ?, ?, ?, ?, ?)',
      args: [codigo, descripcion, tipo_maquina || null, whatsapp_group_id || null, whatsapp_phone || null, operador || null],
    });
    res.status(201).json({
      id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
      codigo,
      descripcion,
      tipo_maquina,
      whatsapp_group_id,
      whatsapp_phone,
      operador,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/lineas-proceso/:id', async (req, res) => {
  const { id } = req.params;
  const { codigo, descripcion, tipo_maquina, whatsapp_group_id, whatsapp_phone, operador } = req.body;
  if (!codigo || !descripcion) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }
  try {
    await db.execute({
      sql: 'UPDATE lineas_proceso SET codigo = ?, descripcion = ?, tipo_maquina = ?, whatsapp_group_id = ?, whatsapp_phone = ?, operador = ? WHERE id = ?',
      args: [codigo, descripcion, tipo_maquina || null, whatsapp_group_id || null, whatsapp_phone || null, operador || null, Number(id)],
    });
    res.json({ id: Number(id), codigo, descripcion, tipo_maquina, whatsapp_group_id, whatsapp_phone, operador });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/lineas-proceso/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute({ sql: 'DELETE FROM lineas_proceso WHERE id = ?', args: [Number(id)] });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Planificaciones CRUD ────────────────────────────────────────────────────
app.get('/api/planificaciones', async (req, res) => {
  const { fecha, fecha_inicio, fecha_fin } = req.query;
  try {
    let query = `
      SELECT 
        p.id, 
        p.linea_id, 
        p.product_sku, 
        p.cantidad_programada, 
        p.fecha, 
        p.turno, 
        p.estado,
        p.termocontraible,
        p.envase_secundario,
        p.envase_secundario_tipo,
        p.observaciones,
        p.prioridad,
        p.created_at,
        lp.codigo as linea_codigo, 
        lp.descripcion as linea_descripcion,
        lp.tipo_maquina as linea_tipo_maquina,
        lp.operador as linea_operador,
        lp.whatsapp_group_id as linea_whatsapp_group_id,
        lp.whatsapp_phone as linea_whatsapp_phone,
        prod.item_name as product_name,
        prod.marca as product_marca,
        prod.family as product_family,
        prod.cant_grupal as product_cant_grupal,
        prod.cant_individual as product_cant_individual,
        prod.formato as product_formato,
        prod.envase_secundario_tipo as product_envase_secundario_tipo,
        prod.envase_primario_tipo as product_envase_primario_tipo,
        prod.tapa_tipo as product_tapa_tipo,
        (SELECT MAX(version) FROM whatsapp_notification_history WHERE linea_id = p.linea_id AND fecha = p.fecha) as current_version,
        (SELECT content_state FROM whatsapp_notification_history WHERE linea_id = p.linea_id AND fecha = p.fecha ORDER BY id DESC LIMIT 1) as last_notified_state
      FROM planificaciones p
      LEFT JOIN lineas_proceso lp ON p.linea_id = lp.id
      LEFT JOIN products prod ON p.product_sku = prod.sku
    `;
    let args: any[] = [];
    if (fecha) {
      query += " WHERE p.fecha = ?";
      args.push(fecha);
    } else if (fecha_inicio && fecha_fin) {
      query += " WHERE p.fecha BETWEEN ? AND ?";
      args.push(fecha_inicio, fecha_fin);
    }
    query += " ORDER BY p.fecha ASC, lp.codigo, p.prioridad ASC, p.id ASC";
    
    const result = await db.execute({ sql: query, args });
    
    // Map database rows to guarantee both termocontraible and envase_secundario exist
    const mapped = result.rows.map((row: any) => {
      const envSec = row.envase_secundario || (row.termocontraible === 'Termocontraible' ? 'Con Envase Secundario' : 'Sin Envase Secundario');
      const termo = row.termocontraible || (envSec === 'Con Envase Secundario' ? 'Termocontraible' : 'Sin Termocontraible');
      const envSecTipo = row.envase_secundario_tipo || row.product_envase_secundario_tipo || (envSec === 'Con Envase Secundario' || termo === 'Termocontraible' ? 'TERMOCONTRAIBLE' : 'NO APLICA');
      return {
        ...row,
        envase_secundario: envSec,
        termocontraible: termo,
        envase_secundario_tipo: envSecTipo
      };
    });
    res.json(mapped);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/planificaciones', async (req, res) => {
  const { linea_id, product_sku, cantidad_programada, fecha, turno, estado, termocontraible, envase_secundario, observaciones, envase_secundario_tipo } = req.body;
  if (!linea_id || !product_sku || !cantidad_programada || !fecha) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }
  try {
    const maxOrderRes = await db.execute({
      sql: 'SELECT MAX(prioridad) as max_p FROM planificaciones WHERE linea_id = ? AND fecha = ?',
      args: [Number(linea_id), fecha]
    });
    const nextPriority = (maxOrderRes.rows[0]?.max_p !== null && maxOrderRes.rows[0]?.max_p !== undefined)
      ? Number(maxOrderRes.rows[0].max_p) + 1
      : 1;

    const envSecTipo = envase_secundario_tipo || (envase_secundario === 'Con Envase Secundario' || termocontraible === 'Termocontraible' ? 'TERMOCONTRAIBLE' : 'NO APLICA');
    const envSecValue = envSecTipo !== 'NO APLICA' ? 'Con Envase Secundario' : 'Sin Envase Secundario';
    const termoValue = envSecTipo === 'TERMOCONTRAIBLE' ? 'Termocontraible' : 'Sin Termocontraible';

    const result = await db.execute({
      sql: 'INSERT INTO planificaciones (linea_id, product_sku, cantidad_programada, fecha, turno, estado, termocontraible, envase_secundario, observaciones, prioridad, envase_secundario_tipo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [
        Number(linea_id), 
        product_sku, 
        Number(cantidad_programada), 
        fecha, 
        turno || null, 
        estado || 'programado', 
        termoValue,
        envSecValue, 
        observaciones || null,
        nextPriority,
        envSecTipo
      ],
    });
    res.status(201).json({
      id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
      linea_id,
      product_sku,
      cantidad_programada,
      fecha,
      turno,
      estado: estado || 'programado',
      termocontraible: termoValue,
      envase_secundario: envSecValue,
      observaciones: observaciones || null,
      prioridad: nextPriority,
      envase_secundario_tipo: envSecTipo,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/planificaciones/:id', async (req, res) => {
  const { id } = req.params;
  const { linea_id, product_sku, cantidad_programada, fecha, turno, estado, termocontraible, envase_secundario, observaciones, envase_secundario_tipo } = req.body;
  if (!linea_id || !product_sku || !cantidad_programada || !fecha) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }
  try {
    const envSecTipo = envase_secundario_tipo || (envase_secundario === 'Con Envase Secundario' || termocontraible === 'Termocontraible' ? 'TERMOCONTRAIBLE' : 'NO APLICA');
    const envSecValue = envSecTipo !== 'NO APLICA' ? 'Con Envase Secundario' : 'Sin Envase Secundario';
    const termoValue = envSecTipo === 'TERMOCONTRAIBLE' ? 'Termocontraible' : 'Sin Termocontraible';

    await db.execute({
      sql: 'UPDATE planificaciones SET linea_id = ?, product_sku = ?, cantidad_programada = ?, fecha = ?, turno = ?, estado = ?, termocontraible = ?, envase_secundario = ?, observaciones = ?, envase_secundario_tipo = ? WHERE id = ?',
      args: [
        Number(linea_id), 
        product_sku, 
        Number(cantidad_programada), 
        fecha, 
        turno || null, 
        estado || 'programado', 
        termoValue,
        envSecValue, 
        observaciones || null, 
        envSecTipo,
        Number(id)
      ],
    });
    res.json({ id: Number(id), linea_id, product_sku, cantidad_programada, fecha, turno, estado, termocontraible: termoValue, envase_secundario: envSecValue, observaciones, envase_secundario_tipo: envSecTipo });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/planificaciones/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute({ sql: 'DELETE FROM planificaciones WHERE id = ?', args: [Number(id)] });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/planificaciones/:id/move', async (req, res) => {
  const { id } = req.params;
  const { direction } = req.body; // 'up' | 'down'
  try {
    // 1. Get current plan details
    const currentRes = await db.execute({
      sql: 'SELECT linea_id, fecha, prioridad FROM planificaciones WHERE id = ?',
      args: [Number(id)]
    });
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: "Planificación no encontrada" });
    }
    const currentItem = currentRes.rows[0];
    const linea_id = currentItem.linea_id as number;
    const fecha = currentItem.fecha as string;

    // 2. Fetch all plans for this line and date, sorted
    const listRes = await db.execute({
      sql: 'SELECT id, prioridad FROM planificaciones WHERE linea_id = ? AND fecha = ? ORDER BY prioridad ASC, id ASC',
      args: [linea_id, fecha]
    });
    const items = listRes.rows.map((r: any) => ({ id: Number(r.id), prioridad: Number(r.prioridad || 0) }));
    
    const idx = items.findIndex(item => item.id === Number(id));
    if (idx === -1) {
      return res.status(404).json({ error: "Elemento no encontrado en la lista" });
    }

    let targetIdx = -1;
    if (direction === 'up' && idx > 0) {
      targetIdx = idx - 1;
    } else if (direction === 'down' && idx < items.length - 1) {
      targetIdx = idx + 1;
    }

    if (targetIdx !== -1) {
      const activeItem = items[idx];
      const targetItem = items[targetIdx];

      // Swap prioridades in DB
      let currPriority = targetItem.prioridad;
      let targPriority = activeItem.prioridad;
      
      if (currPriority === targPriority) {
        // Clean re-sequence of all items to be safe
        for (let i = 0; i < items.length; i++) {
          await db.execute({
            sql: 'UPDATE planificaciones SET prioridad = ? WHERE id = ?',
            args: [i + 1, items[i].id]
          });
        }
        // Now call swap recursively or do it again
        const reFetch = await db.execute({
          sql: 'SELECT id, prioridad FROM planificaciones WHERE linea_id = ? AND fecha = ? ORDER BY prioridad ASC, id ASC',
          args: [linea_id, fecha]
        });
        const reItems = reFetch.rows.map((r: any) => ({ id: Number(r.id), prioridad: Number(r.prioridad) }));
        const reIdx = reItems.findIndex(item => item.id === Number(id));
        const reTargetIdx = direction === 'up' ? reIdx - 1 : reIdx + 1;
        
        await db.batch([
          { sql: 'UPDATE planificaciones SET prioridad = ? WHERE id = ?', args: [reItems[reTargetIdx].prioridad, reItems[reIdx].id] },
          { sql: 'UPDATE planificaciones SET prioridad = ? WHERE id = ?', args: [reItems[reIdx].prioridad, reItems[reTargetIdx].id] }
        ]);
      } else {
        await db.batch([
          { sql: 'UPDATE planificaciones SET prioridad = ? WHERE id = ?', args: [currPriority, activeItem.id] },
          { sql: 'UPDATE planificaciones SET prioridad = ? WHERE id = ?', args: [targPriority, targetItem.id] }
        ]);
      }
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Config CRUD ─────────────────────────────────────────────────────────────
app.get('/api/config/:key', async (req, res) => {
  const { key } = req.params;
  try {
    const result = await db.execute({
      sql: 'SELECT value FROM system_config WHERE key = ?',
      args: [key]
    });
    if (result.rows.length > 0) {
      res.json({ key, value: result.rows[0].value });
    } else {
      res.json({ key, value: null });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config', async (req, res) => {
  const { key, value } = req.body;
  try {
    await db.execute({
      sql: 'INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)',
      args: [key, value]
    });
    res.json({ key, value });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function parseFormatoToLiters(formatoStr: string | null | undefined): number {
  if (!formatoStr) return 0;
  const clean = formatoStr.trim().toLowerCase();
  if (!clean) return 0;
  
  const mlMatch = clean.match(/^([\d.,]+)\s*(cc|ml|mls)$/);
  if (mlMatch) {
    const val = parseFloat(mlMatch[1].replace(',', '.'));
    return isNaN(val) ? 0 : val / 1000;
  }
  
  const lMatch = clean.match(/^([\d.,]+)\s*(l|lt|lts|litro|litros)$/);
  if (lMatch) {
    const val = parseFloat(lMatch[1].replace(',', '.'));
    return isNaN(val) ? 0 : val;
  }
  
  const val = parseFloat(clean.replace(',', '.'));
  return isNaN(val) ? 0 : val;
}

app.get('/api/dashboard/history-stats', async (req, res) => {
  try {
    const query = `
      SELECT p.fecha, p.cantidad_programada, prod.formato as product_formato
      FROM planificaciones p
      LEFT JOIN products prod ON p.product_sku = prod.sku
    `;
    const result = await db.execute(query);
    
    const dailyLiters = new Map<string, number>();
    
    for (const row of result.rows) {
      const fecha = row.fecha as string;
      const cantidad = Number(row.cantidad_programada || 0);
      const formato = row.product_formato as string;
      
      const litersPerEnvase = parseFormatoToLiters(formato);
      const totalLitersForRecord = cantidad * litersPerEnvase;
      
      const currentDayLiters = dailyLiters.get(fecha) || 0;
      dailyLiters.set(fecha, currentDayLiters + totalLitersForRecord);
    }
    
    let totalLitersSum = 0;
    let absoluteRecordLitersSingleDay = 0;
    
    for (const dayLiters of dailyLiters.values()) {
      totalLitersSum += dayLiters;
      if (dayLiters > absoluteRecordLitersSingleDay) {
        absoluteRecordLitersSingleDay = dayLiters;
      }
    }
    
    const uniqueDatesCount = dailyLiters.size;
    const globalAverageLitersPerDay = uniqueDatesCount > 0 ? (totalLitersSum / uniqueDatesCount) : 0;
    
    res.json({
      globalAverageLitersPerDay,
      absoluteRecordLitersSingleDay
    });
  } catch (error: any) {
    console.error("Error calculating dashboard history stats:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: connectionStatus,
    hasQr: !!qrCodeBase64,
    qr: qrCodeBase64,
  });
});

app.get('/api/whatsapp/qr', async (req, res) => {
  if (connectionStatus === 'disconnected') {
    initWhatsApp().catch(() => {});
  }
  
  let attempts = 0;
  while (!qrCodeBase64 && attempts < 10 && connectionStatus === 'connecting') {
    await new Promise(resolve => setTimeout(resolve, 500));
    attempts++;
  }
  
  if (qrCodeBase64) {
    res.json({ qr: qrCodeBase64 });
  } else {
    res.status(400).json({ error: "QR no disponible o ya conectado", status: connectionStatus });
  }
});

app.get('/api/whatsapp/groups', async (req, res) => {
  if (connectionStatus !== 'connected' || !sock) {
    return res.status(400).json({ error: "WhatsApp no está conectado" });
  }
  try {
    const list = await sock.groupFetchAllParticipating();
    const groups = Object.values(list).map((g: any) => ({
      id: g.id,
      name: g.subject,
    }));
    res.json(groups);
  } catch (e: any) {
    console.warn("⚠️ [Groups] Error fetching groups:", e.message);
    res.json([]); // Return empty list gracefully instead of 500
  }
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
  try {
    await disconnectWhatsApp();
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/reset-today-versions', async (req, res) => {
  const { fecha } = req.body;
  if (!fecha) {
    return res.status(400).json({ error: "Falta la fecha" });
  }

  try {
    const historyRes = await db.execute({
      sql: `SELECT id, whatsapp_msg_id, whatsapp_recipient FROM whatsapp_notification_history WHERE fecha = ?`,
      args: [fecha]
    });

    console.log(`🧹 [ResetToday] Encontrados ${historyRes.rows.length} mensajes para la fecha ${fecha}`);

    if (connectionStatus === 'connected' && sock) {
      for (const row of historyRes.rows) {
        const msgId = row.whatsapp_msg_id as string;
        const recipient = row.whatsapp_recipient as string;
        if (msgId && recipient) {
          try {
            await sock.sendMessage(recipient, {
              delete: {
                id: msgId,
                fromMe: true,
                remoteJid: recipient
              }
            });
            console.log(`🗑️ [ResetToday] Mensaje ${msgId} eliminado con éxito de ${recipient}`);
          } catch (delErr: any) {
            console.error(`❌ [ResetToday] Error al eliminar mensaje ${msgId}: ${delErr.message}`);
          }
        }
      }
    } else {
      console.warn("⚠️ [ResetToday] WhatsApp no conectado. No se pudieron eliminar los mensajes del chat.");
    }

    await db.execute({
      sql: `DELETE FROM whatsapp_notification_history WHERE fecha = ?`,
      args: [fecha]
    });

    res.json({ success: true, count: historyRes.rows.length });
  } catch (e: any) {
    console.error("❌ [ResetToday] Error general:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/whatsapp/send-plan', async (req, res) => {
  const { pdfBase64, filename, caption: rawCaption, recipient, linea_id, fecha, plan_state } = req.body;
  if (!pdfBase64) {
    return res.status(400).json({ error: "Falta el archivo PDF en base64" });
  }
  if (!recipient) {
    return res.status(400).json({ error: "Falta el destinatario de WhatsApp" });
  }
  if (connectionStatus !== 'connected' || !sock) {
    return res.status(400).json({ error: "WhatsApp no está conectado. Vincula el celular del Jefe de Producción en Configuración." });
  }
  
  try {
    const buffer = Buffer.from(pdfBase64, 'base64');
    // Split by commas or semicolons
    const targets = recipient.split(/[,;]+/).map((r: string) => r.trim()).filter(Boolean).map(formatRecipientJid).filter(Boolean);
    
    if (targets.length === 0) {
      return res.status(400).json({ error: "Destinatario no válido" });
    }

    let version = 1;
    let shouldSend = true;

    if (linea_id && fecha && plan_state) {
      // 1. Check if the plan has changed compared to the last manual send
      const lastNotifResult = await db.execute({
        sql: `SELECT version, content_state, whatsapp_msg_id, whatsapp_recipient 
              FROM whatsapp_notification_history 
              WHERE linea_id = ? AND fecha = ? 
              ORDER BY id DESC`,
        args: [Number(linea_id), fecha]
      });

      if (lastNotifResult.rows.length > 0) {
        const lastNotif = lastNotifResult.rows[0];
        if (lastNotif.content_state === plan_state) {
          // Identical plan state! No notification needed
          shouldSend = false;
          version = Number(lastNotif.version);
        } else {
          // Changed! Delete previous version's messages in the chats
          const prevVersion = lastNotif.version;
          const prevMessages = lastNotifResult.rows.filter((r: any) => r.version === prevVersion);
          
          for (const msg of prevMessages) {
            if (msg.whatsapp_msg_id && msg.whatsapp_recipient) {
              try {
                await sock.sendMessage(msg.whatsapp_recipient, {
                  delete: {
                    remoteJid: msg.whatsapp_recipient,
                    fromMe: true,
                    id: msg.whatsapp_msg_id
                  }
                });
              } catch (deleteErr: any) {
                console.warn(`No se pudo eliminar mensaje previo ${msg.whatsapp_msg_id}:`, deleteErr.message);
              }
            }
          }
          version = Number(prevVersion) + 1;
        }
      }
    }

    if (!shouldSend) {
      return res.json({ success: true, changed: false, version });
    }

    // Label caption with the version
    let caption = rawCaption || 'Reporte de Planificación';
    if (linea_id && fecha) {
      if (version > 1) {
        caption = caption.replace(
          '📋 *Planificación de Producción - AquaOps*',
          `⚠️ *PLANIFICACIÓN MODIFICADA (VERSIÓN ${version})* ⚠️\n📋 *Planificación de Producción - AquaOps*`
        );
      } else {
        caption = caption.replace(
          '📋 *Planificación de Producción - AquaOps*',
          `📋 *Planificación de Producción - AquaOps* (Versión ${version})`
        );
      }
    }

    for (const target of targets) {
      const sent = await sock.sendMessage(target, {
        document: buffer,
        mimetype: 'application/pdf',
        fileName: filename || 'planificacion.pdf',
        caption: caption,
      });

      if (linea_id && fecha && sent && sent.key && sent.key.id) {
        await db.execute({
          sql: `INSERT INTO whatsapp_notification_history (linea_id, fecha, version, whatsapp_msg_id, whatsapp_recipient, content_state, sent_type)
                VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
          args: [Number(linea_id), fecha, version, sent.key.id, target, plan_state || null]
        });
      }
    }
    
    res.json({ success: true, changed: true, version });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Automated WhatsApp Daily Scheduler
async function checkAndSendAutoNotifications(force = false) {
  try {
    // 1. Check if enabled
    const enabledRes = await db.execute({
      sql: "SELECT value FROM system_config WHERE key = 'whatsapp_auto_notify_enabled'",
    });
    const isEnabled = enabledRes.rows.length > 0 && enabledRes.rows[0].value === 'true';
    if (!isEnabled) {
      return { success: false, reason: "Deshabilitado en la configuración" };
    }

    // 2. Check time
    const timeRes = await db.execute({
      sql: "SELECT value FROM system_config WHERE key = 'whatsapp_auto_notify_time'",
    });
    const autoNotifyTime = timeRes.rows.length > 0 ? (timeRes.rows[0].value as string) : '06:00';

    // 3. Get current date & time in Chile
    const now = new Date();
    const dateFormatter = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const dateParts = dateFormatter.formatToParts(now);
    const day = dateParts.find(p => p.type === 'day')?.value;
    const month = dateParts.find(p => p.type === 'month')?.value;
    const year = dateParts.find(p => p.type === 'year')?.value;
    const currentDateStr = `${year}-${month}-${day}`;

    const timeFormatter = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const currentTimeStr = timeFormatter.format(now);

    // Compare current hour & minute (HH:MM)
    if (!force && currentTimeStr !== autoNotifyTime) {
      return { success: false, reason: `Hora no coincide (${currentTimeStr} vs ${autoNotifyTime})` };
    }

    // 4. Check if already sent today (only if not forced)
    if (!force) {
      const lastSentRes = await db.execute({
        sql: "SELECT value FROM system_config WHERE key = 'last_auto_notify_date'",
      });
      const lastSentDate = lastSentRes.rows.length > 0 ? (lastSentRes.rows[0].value as string) : '';
      if (lastSentDate === currentDateStr) {
        return { success: false, reason: `Ya fue enviado hoy (${currentDateStr})` };
      }
    }

    // 5. Check and wait for WhatsApp connection status (up to 15 seconds)
    if (connectionStatus === 'connecting' || connectionStatus === 'disconnected') {
      console.log(`⏰ [AutoNotify] WhatsApp en estado: '${connectionStatus}'. Esperando hasta 15 segundos a que se conecte...`);
      for (let i = 0; i < 30; i++) { // 30 * 500ms = 15 seconds
        if (connectionStatus === 'connected' && sock) {
          console.log("⏰ [AutoNotify] ¡WhatsApp conectado con éxito después de la espera!");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (connectionStatus !== 'connected' || !sock) {
      console.error("⏰ [AutoNotify] Error: WhatsApp no está conectado o sock no inicializado");
      return { success: false, reason: "WhatsApp no está conectado" };
    }

    // 6. Get global fallback recipient
    const globalRecRes = await db.execute({
      sql: "SELECT value FROM system_config WHERE key = 'whatsapp_recipient'",
    });
    const globalRecipient = globalRecRes.rows.length > 0 ? (globalRecRes.rows[0].value as string) : '';

    // 7. Fetch lineas and plans
    const lineasRes = await db.execute("SELECT * FROM lineas_proceso ORDER BY codigo ASC");
    const plansRes = await db.execute({
      sql: `SELECT p.*, prod.item_name as product_name, prod.marca as product_marca, prod.family as product_family, prod.envase_secundario_tipo as product_envase_secundario_tipo
            FROM planificaciones p 
            LEFT JOIN products prod ON p.product_sku = prod.sku 
            WHERE p.fecha = ?`,
      args: [currentDateStr]
    });

    const lineas = lineasRes.rows;
    const plans = plansRes.rows;

    if (plans.length === 0) {
      console.log(`⏰ [AutoNotify] No hay producción planificada para hoy (${currentDateStr}). Permaneciendo en silencio.`);
      // Update lastSentDate so we don't keep polling or checking for the rest of today
      await db.execute({
        sql: "INSERT OR REPLACE INTO system_config (key, value) VALUES ('last_auto_notify_date', ?)",
        args: [currentDateStr]
      });
      return { success: true, sent: 0, message: "No hay planificaciones programadas para hoy" };
    }

    // 8. Update lastSentDate to mark as processed for today
    await db.execute({
      sql: "INSERT OR REPLACE INTO system_config (key, value) VALUES ('last_auto_notify_date', ?)",
      args: [currentDateStr]
    });
    console.log(`⏰ [AutoNotify] Iniciando envío programado de reportes para el día: ${currentDateStr}`);

    // Map plans to lines
    const plansByLinea = new Map<number, any[]>();
    plans.forEach((p: any) => {
      if (!plansByLinea.has(p.linea_id)) {
        plansByLinea.set(p.linea_id, []);
      }
      plansByLinea.get(p.linea_id)!.push(p);
    });

    // Sort plans by priority order, falling back to ID
    plansByLinea.forEach((list) => {
      list.sort((a, b) => {
        const pA = a.prioridad || 0;
        const pB = b.prioridad || 0;
        if (pA !== pB) return pA - pB;
        return (a.id as number) - (b.id as number);
      });
    });

    let sentCount = 0;

    // 9. Process and send reports per line
    for (const linea of lineas) {
      const linePlans = plansByLinea.get(linea.id as number) || [];
      if (linePlans.length === 0) continue; // Skip unscheduled lines

      const recipientsList: string[] = [];
      if (linea.whatsapp_phone && (linea.whatsapp_phone as string).trim()) {
        recipientsList.push(linea.whatsapp_phone as string);
      }
      if (linea.whatsapp_group_id && (linea.whatsapp_group_id as string).trim()) {
        recipientsList.push(linea.whatsapp_group_id as string);
      }
      if (recipientsList.length === 0 && globalRecipient && globalRecipient.trim()) {
        recipientsList.push(globalRecipient);
      }

      const targetRecipient = recipientsList.join(',');
      if (!targetRecipient || !targetRecipient.trim()) {
        console.warn(`⏰ [AutoNotify] Línea ${linea.codigo} tiene producción hoy pero no cuenta con teléfono, grupo o receptor global configurado.`);
        continue;
      }

      // Serialize current state to check for changes
      const sortedPlans = [...linePlans].sort((a, b) => {
        const pA = a.prioridad || 0;
        const pB = b.prioridad || 0;
        if (pA !== pB) return pA - pB;
        return (a.id as number) - (b.id as number);
      });
      const stateObj = sortedPlans.map(p => ({
        sku: p.product_sku,
        qty: p.cantidad_programada,
        turno: p.turno,
        termo: p.envase_secundario || p.termocontraible || 'Sin Envase Secundario',
        obs: p.observaciones || '',
        prioridad: p.prioridad || 0
      }));
      const planState = JSON.stringify(stateObj);

      // Check last notification state
      const lastNotifResult = await db.execute({
        sql: `SELECT version, content_state, whatsapp_msg_id, whatsapp_recipient 
              FROM whatsapp_notification_history 
              WHERE linea_id = ? AND fecha = ? 
              ORDER BY id DESC`,
        args: [linea.id, currentDateStr]
      });

      let autoVersion = 1;
      let shouldSend = true;

      if (lastNotifResult.rows.length > 0) {
        const lastNotif = lastNotifResult.rows[0];
        if (lastNotif.content_state === planState) {
          shouldSend = false;
          autoVersion = Number(lastNotif.version);
          console.log(`⏰ [AutoNotify] Línea ${linea.codigo} tiene plan idéntico al ya enviado hoy. Saltando envío.`);
        } else {
          // Changed! Delete previous version's messages in the chats
          const prevVersion = lastNotif.version;
          const prevMessages = lastNotifResult.rows.filter((r: any) => r.version === prevVersion);
          
          for (const msg of prevMessages) {
            if (msg.whatsapp_msg_id && msg.whatsapp_recipient) {
              try {
                await sock.sendMessage(msg.whatsapp_recipient, {
                  delete: {
                    remoteJid: msg.whatsapp_recipient,
                    fromMe: true,
                    id: msg.whatsapp_msg_id
                  }
                });
                console.log(`🗑️ [AutoNotify] Mensaje previo ${msg.whatsapp_msg_id} eliminado de ${msg.whatsapp_recipient}`);
              } catch (deleteErr: any) {
                console.warn(`No se pudo eliminar mensaje previo ${msg.whatsapp_msg_id}:`, deleteErr.message);
              }
            }
          }
          autoVersion = Number(prevVersion) + 1;
        }
      }

      if (!shouldSend) {
        continue;
      }

      try {
        // Generate PDF
        const doc = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: 'a4',
        });

        // Draw slate-900 header
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 297, 35, 'F');

        // Title
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('AQUAOPS - PLANIFICACIÓN DE PRODUCCIÓN', 14, 15);
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(203, 213, 225);
        doc.text(`Fecha del Reporte: ${currentDateStr}`, 14, 25);

        // Load and embed AquaOps logo
        try {
          let logoPath = path.join(process.cwd(), 'src', 'public', 'aquaops-logo.png');
          if (!fs.existsSync(logoPath)) {
            logoPath = path.join(process.cwd(), 'dist', 'aquaops-logo.png');
          }
          if (fs.existsSync(logoPath)) {
            const logoBuffer = fs.readFileSync(logoPath);
            const logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
            doc.addImage(logoBase64, 'PNG', 263, 7.5, 20, 20);
          }
        } catch (logoErr) {
          console.error("Error al cargar logo para PDF automático:", logoErr);
        }

        // Body Info
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('Planificación Diaria por Línea de Proceso', 14, 48);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        
        // Details
        doc.text('INFORMACIÓN DE LÍNEA', 14, 56);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(`Línea: [${linea.codigo}] ${linea.descripcion || ''}`, 14, 61);
        doc.setFont('helvetica', 'normal');
        doc.text(`Máquina: ${linea.tipo_maquina || 'No especificada'}`, 14, 66);
        doc.text(`Operador: ${linea.operador || 'No asignado'}`, 14, 71);

        doc.setTextColor(100, 116, 139);
        doc.text('INFORMACIÓN GENERAL', 180, 56);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(`Fecha Planificada: ${currentDateStr}`, 180, 61);
        doc.setFont('helvetica', 'normal');
        doc.text(`Versión: Reporte Oficial (Auto)`, 180, 66);

        const tableBody = linePlans.map((p: any, idx: number) => {
          const envSecTipo = p.envase_secundario_tipo || p.product_envase_secundario_tipo || (p.envase_secundario === 'Con Envase Secundario' || p.termocontraible === 'Termocontraible' ? 'TERMOCONTRAIBLE' : 'NO APLICA');
          const envSecLabel = envSecTipo === 'NO APLICA' ? '-' : envSecTipo;
          return [
            (idx + 1).toString(),
            p.turno || 'Mañana',
            p.product_sku,
            p.product_name || 'Desconocido',
            p.product_marca || 'S/M',
            envSecLabel,
            p.cantidad_programada.toLocaleString(),
            (p.estado || 'programado').toUpperCase().replace('_', ' '),
            p.observaciones || '-'
          ];
        });

        const totalQty = linePlans.reduce((sum: number, p: any) => sum + (p.cantidad_programada || 0), 0);

        callAutoTable(doc, {
          head: [['N°', 'Turno', 'SKU', 'Producto', 'Marca', 'Env. Sec.', 'Cantidad', 'Estado', 'Observaciones']],
          body: tableBody,
          foot: [['', '', '', '', '', 'Total Envases:', totalQty.toLocaleString(), '', '']],
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7.5 },
          startY: 80,
          theme: 'grid',
          headStyles: { fillColor: [30, 41, 59] },
          styles: { fontSize: 8, cellPadding: 3 },
        });

        // Signatures
        const finalY = (doc as any).lastAutoTable.finalY + 30;
        doc.setDrawColor(203, 213, 225);
        doc.line(30, finalY, 100, finalY);
        doc.line(197, finalY, 267, finalY);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text('Firma Jefe de Producción', 42, finalY + 5);
        doc.text('Firma Operador Responsable', 212, finalY + 5);

        doc.setFontSize(7);
        doc.text('Generado automáticamente por AquaOps Pro Cloud.', 14, 200);

        const pdfBase64 = doc.output('datauristring').split(',')[1];
        const buffer = Buffer.from(pdfBase64, 'base64');
        const filename = `planificacion_${linea.codigo}_${currentDateStr}.pdf`;

        // Caption text
        let caption = `📋 *Planificación de Producción - AquaOps* (Automático)\n\n` +
          `🔹 *Línea*: ${linea.codigo} (${linea.descripcion || 'S/D'})\n` +
          `🔹 *Fecha*: ${currentDateStr}\n\n` +
          `*Productos Programados:*\n`;

        linePlans.forEach((p: any, idx: number) => {
          let lineStr = `*${idx + 1}.* [${p.turno}] *${p.product_sku}* / ${p.product_name || 'S/N'}`;
          if (p.product_marca) {
            lineStr += ` / ${p.product_marca}`;
          }
          lineStr += ` / *${p.cantidad_programada.toLocaleString()}*`;
          const envSecTipo = p.envase_secundario_tipo || p.product_envase_secundario_tipo || (p.envase_secundario === 'Con Envase Secundario' || p.termocontraible === 'Termocontraible' ? 'TERMOCONTRAIBLE' : 'NO APLICA');
          if (envSecTipo !== 'NO APLICA') {
            lineStr += ` / *${envSecTipo}*`;
          }
          
          if (p.observaciones && p.observaciones.trim()) {
            lineStr += ` _(Obs: ${p.observaciones})_`;
          }
          caption += lineStr + `\n`;
        });
        
        caption += `\n📌 _Se adjunta reporte PDF oficial de planificación._`;

        // Add warning or version number to the caption
        if (autoVersion > 1) {
          caption = caption.replace(
            `📋 *Planificación de Producción - TraceLabel* (Automático)`,
            `⚠️ *PLANIFICACIÓN MODIFICADA (VERSIÓN ${autoVersion})* ⚠️\n📋 *Planificación de Producción - TraceLabel* (Automático)`
          );
        } else {
          caption = caption.replace(
            `📋 *Planificación de Producción - TraceLabel* (Automático)`,
            `📋 *Planificación de Producción - TraceLabel* (Automático) (Versión ${autoVersion})`
          );
        }

        const targets = targetRecipient.split(/[,;]+/).map((r: string) => r.trim()).filter(Boolean).map(formatRecipientJid).filter(Boolean);
        for (const target of targets) {
          const sent = await sock.sendMessage(target, {
            document: buffer,
            mimetype: 'application/pdf',
            fileName: filename,
            caption: caption,
          });

          if (sent && sent.key && sent.key.id) {

            await db.execute({
              sql: `INSERT INTO whatsapp_notification_history (linea_id, fecha, version, whatsapp_msg_id, whatsapp_recipient, content_state, sent_type)
                    VALUES (?, ?, ?, ?, ?, ?, 'auto')`,
              args: [linea.id, currentDateStr, autoVersion, sent.key.id, target, planState]
            });
          }
        }
        console.log(`⏰ [AutoNotify] Reporte enviado y registrado para la línea ${linea.codigo} a ${targetRecipient}`);
        sentCount++;
      } catch (err: any) {
        console.error(`⏰ [AutoNotify] Error enviando reporte para la línea ${linea.codigo}: ${err.message}`);
      }
    }
    return { success: true, sent: sentCount, message: `Despacho automático procesado para ${sentCount} líneas` };
  } catch (e: any) {
    console.error("⏰ [AutoNotify] Error en bucle del planificador automático:", e.message);
    throw e;
  }
}

app.get('/api/whatsapp/auto-notify-trigger', async (req, res) => {
  const { secret } = req.query;
  const expectedSecret = 'tracelabel_auto_notify_secret_2026_xyz';
  if (secret !== expectedSecret) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    const result = await checkAndSendAutoNotifications(true);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      configFile: path.join(process.cwd(), "config/vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    // Prevent caching of PWA assets like manifest.json and sw.js
    app.use((req, res, next) => {
      if (req.url === "/manifest.json" || req.url === "/sw.js") {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      }
      next();
    });

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
        exec('powershell -NoProfile -Command "Get-Printer | Where-Object { $_.DriverName -like \'*ZDesigner*\' -or $_.DriverName -like \'*Generic*\' -or $_.DriverName -like \'*Text Only*\' -or $_.DriverName -like \'*Solo Texto*\' } | Select-Object Name, PortName, DriverName | ConvertTo-Json -Compress"',
          { timeout: 10000 },
          (err, stdout) => {
            if (err) { resolve([]); return; }
            try {
              const raw = (stdout || '').trim();
              if (!raw) { resolve([]); return; }
              const parsed = JSON.parse(raw);
              const all = Array.isArray(parsed) ? parsed : [parsed];
              for (const p of all) {
                console.log(`  ✅ ${p.Name} (${p.PortName || 'N/A'}) — ${p.DriverName}`);
              }
              resolve(all);
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

          const scriptPath = path.join(process.cwd(), 'bridge', 'scripts', 'raw-print.ps1');
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

  console.log("⏰ Iniciando planificador de WhatsApp automático...");
  checkAndSendAutoNotifications();
  setInterval(checkAndSendAutoNotifications, 30 * 1000); // Check every 30 seconds
}

startServer();

