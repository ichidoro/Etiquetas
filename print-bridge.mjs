/**
 * ZebraBridge Print Server — Standalone
 * 
 * Lightweight local server that enables printing from the Cloud-hosted app.
 * Runs on port 3000 and exposes:
 *   GET  /api/system-printers  → list Windows printers
 *   POST /api/print/usb        → send ZPL to a named printer
 * 
 * Auto-registers itself in the Cloud DB so other PCs on the
 * same WiFi can discover and use it automatically.
 * 
 * Usage: node print-bridge.mjs
 */

import http from "node:http";
import https from "node:https";
import { execSync, exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 3000;
const CLOUD_URL = "https://zebra-bridge-pro-684852789183.us-central1.run.app";

// ── Get local LAN IP address ─────────────────────────────────────────────────
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip loopback and non-IPv4
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

// ── CORS headers for Cloud access ────────────────────────────────────────────
function setCors(res, req) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── Get Windows printers via PowerShell ──────────────────────────────────────
function getSystemPrinters() {
  try {
    const ps = `Get-Printer | Select-Object Name, PortName, DriverName | ConvertTo-Json -Compress`;
    const raw = execSync(`powershell -NoProfile -Command "${ps}"`, {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.error("Error listing printers:", err.message);
    return [];
  }
}

// ── Send ZPL to printer via temp file + raw print ────────────────────────────
function printZpl(zpl, printerName) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `zpl_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, zpl, "utf-8");

    const safeName = printerName.replace(/"/g, '\\"');
    const cmd = `powershell -NoProfile -Command "Copy-Item -Path '${tmpFile}' -Destination '\\\\localhost\\${safeName}' -Force"`;

    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err) {
        // Fallback: use Out-Printer
        const cmd2 = `powershell -NoProfile -Command "Get-Content '${tmpFile}' -Raw | Out-Printer -Name '${safeName}'"`;
        fs.writeFileSync(tmpFile, zpl, "utf-8");
        exec(cmd2, { timeout: 15000 }, (err2) => {
          try { fs.unlinkSync(tmpFile); } catch {}
          if (err2) reject(err2);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// ── Auto-register with Cloud DB ──────────────────────────────────────────────
function registerWithCloud(localIp, printers) {
  const hostname = os.hostname();
  const id = `bridge-${hostname}-${localIp}`.replace(/[^a-zA-Z0-9\-\.]/g, '_');
  
  const data = JSON.stringify({
    id,
    hostname,
    localIp,
    port: PORT,
    printers: printers.map(p => ({ Name: p.Name, DriverName: p.DriverName }))
  });

  const url = new URL(`${CLOUD_URL}/api/bridges/register`);
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    },
    timeout: 10000,
  };

  const req = https.request(options, (res) => {
    let body = "";
    res.on("data", (c) => body += c);
    res.on("end", () => {
      if (res.statusCode === 200) {
        console.log(`☁️  Registrado en Cloud: ${hostname} (${localIp})`);
      } else {
        console.log(`⚠️  Cloud registro falló: ${res.statusCode} ${body}`);
      }
    });
  });

  req.on("error", (err) => {
    console.log(`⚠️  Cloud no disponible: ${err.message}`);
  });

  req.write(data);
  req.end();
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCors(res, req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /api/system-printers
  if (url.pathname === "/api/system-printers" && req.method === "GET") {
    const printers = getSystemPrinters();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(printers));
    return;
  }

  // POST /api/print/usb
  if (url.pathname === "/api/print/usb" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { zpl, printerName } = JSON.parse(body);
        if (!zpl || !printerName) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing zpl or printerName" }));
          return;
        }
        await printZpl(zpl, printerName);
        console.log(`🖨️  ZPL enviado a "${printerName}"`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: `Impreso en ${printerName}` }));
      } catch (err) {
        console.error("Print error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Health check
  if (url.pathname === "/" || url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "ZebraBridge Print Server" }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── Poll Cloud print queue for pending jobs ──────────────────────────────────
function getBridgeId(localIp) {
  const hostname = os.hostname();
  return `bridge-${hostname}-${localIp}`.replace(/[^a-zA-Z0-9\-\.]/g, '_');
}

function pollPrintQueue(bridgeId) {
  const url = new URL(`${CLOUD_URL}/api/print-queue/pending/${bridgeId}`);
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: "GET",
    timeout: 10000,
  };

  const req = https.request(options, (res) => {
    let body = "";
    res.on("data", (c) => body += c);
    res.on("end", async () => {
      try {
        const jobs = JSON.parse(body);
        if (!Array.isArray(jobs) || jobs.length === 0) return;
        
        console.log(`📋 ${jobs.length} trabajo(s) en cola`);
        
        for (const job of jobs) {
          try {
            await printZpl(job.zpl, job.printerName);
            console.log(`🖨️  Cola: Impreso en "${job.printerName}" (job ${job.id})`);
            markJobComplete(job.id, "completed");
          } catch (err) {
            console.error(`❌ Cola: Error imprimiendo job ${job.id}:`, err.message);
            markJobComplete(job.id, "error");
          }
        }
      } catch {}
    });
  });

  req.on("error", () => {}); // Silently ignore network errors
  req.end();
}

function markJobComplete(jobId, status) {
  const url = new URL(`${CLOUD_URL}/api/print-queue/${jobId}`);
  const data = JSON.stringify({ status });
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    },
    timeout: 10000,
  };

  const req = https.request(options, () => {});
  req.on("error", () => {});
  req.write(data);
  req.end();
}

// Listen on all interfaces (0.0.0.0) so other PCs on the LAN can reach us
server.listen(PORT, "0.0.0.0", () => {
  const printers = getSystemPrinters();
  const localIp = getLocalIp();
  const bridgeId = getBridgeId(localIp);

  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║       🖨️  ZebraBridge Print Server              ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Local:      http://localhost:${PORT}              ║`);
  console.log(`║  Red WiFi:   http://${localIp.padEnd(15)}:${PORT}    ║`);
  console.log(`║  Impresoras: ${String(printers.length).padEnd(2)} detectadas                    ║`);
  console.log(`║  Bridge ID:  ${bridgeId.substring(0, 35).padEnd(35)} ║`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║  ✅ Accesible desde la nube via cola de impresión║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");
  printers.forEach((p) => console.log(`  ✅ ${p.Name}`));
  console.log("");

  // Register immediately and then every 2 minutes
  registerWithCloud(localIp, printers);
  setInterval(() => {
    const currentPrinters = getSystemPrinters();
    registerWithCloud(localIp, currentPrinters);
  }, 2 * 60 * 1000);

  // Poll print queue every 5 seconds
  console.log("📋 Polling cola de impresión cada 5 segundos...");
  setInterval(() => pollPrintQueue(bridgeId), 5000);
});

