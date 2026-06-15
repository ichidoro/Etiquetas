/**
 * Print Bridge — Auto-discovers print servers and uses Cloud queue as fallback
 * 
 * Flow:
 * 1. App opens from Cloud Run
 * 2. Check if localhost:3000 is available (local bridge on same PC)
 * 3. If not → get ALL registered bridges from Cloud DB
 * 4. Merge printers from ALL bridges
 * 5. Send print job to the bridge that HAS the target printer
 */

const LOCAL_SERVER_URL = "http://localhost:3000";
const PING_TIMEOUT = 5000;

/** Check if we're running on Cloud (not localhost) */
export function isRunningOnCloud(): boolean {
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1";
}

/** Try to reach a bridge at a specific URL */
async function pingBridge(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/** Check if the local print server is reachable */
export async function isLocalServerAvailable(): Promise<boolean> {
  if (!isRunningOnCloud()) {
    return false; // We ARE the local server
  }
  return pingBridge(LOCAL_SERVER_URL);
}

/** Discover bridge URL — tries localhost first, then returns cloud queue info */
export async function discoverBridgeUrl(): Promise<string | null> {
  if (!isRunningOnCloud()) {
    return null; // Use normal API (same origin)
  }

  // 1. Try localhost first (bridge on same PC)
  console.log("[PrintBridge] Trying localhost...");
  if (await pingBridge(LOCAL_SERVER_URL)) {
    console.log("[PrintBridge] ✅ Local bridge found at localhost");
    return LOCAL_SERVER_URL;
  }

  // 2. No direct bridge available — will use cloud queue
  console.log("[PrintBridge] No direct bridge, will use cloud print queue");
  return "CLOUD_QUEUE";
}

// ── Bridge registry cache ────────────────────────────────────────────────────
interface BridgeInfo {
  id: string;
  hostname: string;
  localIp: string;
  printers: { Name: string; DriverName: string }[];
}

// Map: printerName → bridgeId (for routing print jobs)
let printerToBridge: Map<string, string> = new Map();

/** Get ALL active bridges from cloud DB */
async function getAllBridges(): Promise<BridgeInfo[]> {
  try {
    const res = await fetch("/api/bridges");
    if (!res.ok) return [];
    const bridges = await res.json();
    return bridges;
  } catch {
    return [];
  }
}

/** Find which bridge has a specific printer */
function findBridgeForPrinter(printerName: string): string | null {
  return printerToBridge.get(printerName) || null;
}

/** Fetch system printers — auto-discovers bridge or gets from cloud registry */
export async function fetchPrinters(
  useLocalBridge?: boolean,
  bridgeUrl?: string | null
): Promise<{ Name: string; PortName: string; DriverName: string; _bridgeId?: string; _bridgeHost?: string }[]> {
  
  // On cloud with local bridge — show ONLY cloud bridge printers (with hostname)
  // Don't show local drivers since they're misleading (driver installed ≠ physically connected)
  if (bridgeUrl && bridgeUrl !== "CLOUD_QUEUE") {
    const allPrinters: { Name: string; PortName: string; DriverName: string; _bridgeId?: string; _bridgeHost?: string }[] = [];
    const seen = new Set<string>();

    try {
      const bridges = await getAllBridges();
      printerToBridge = new Map();
      for (const bridge of bridges) {
        if (!bridge.printers || bridge.printers.length === 0) continue;
        console.log(`[PrintBridge] Bridge "${bridge.hostname}" → ${bridge.printers.length} impresoras`);
        
        for (const p of bridge.printers) {
          // Key = name+bridge to allow same printer on different PCs
          const key = `${p.Name}__${bridge.id}`;
          printerToBridge.set(p.Name, bridge.id);
          
          if (!seen.has(key)) {
            seen.add(key);
            allPrinters.push({
              Name: p.Name,
              PortName: `via ${bridge.hostname}`,
              DriverName: p.DriverName || "",
              _bridgeId: bridge.id,
              _bridgeHost: bridge.hostname,
            });
          }
        }
      }
      console.log(`[PrintBridge] Total: ${allPrinters.length} impresoras de ${bridges.length} bridge(s)`);
    } catch (err) {
      console.log("[PrintBridge] Error fetching bridges:", err);
      // Fallback: try local bridge directly
      try {
        const res = await fetch(`${bridgeUrl}/api/system-printers`);
        if (res.ok) {
          const printers = await res.json();
          return printers;
        }
      } catch {}
    }

    return allPrinters;
  }

  // Cloud queue mode — get printers from ALL bridges and merge
  if (bridgeUrl === "CLOUD_QUEUE") {
    const bridges = await getAllBridges();
    if (bridges.length === 0) {
      console.log("[PrintBridge] No bridges registered in cloud");
      return [];
    }

    // Clear and rebuild printer→bridge mapping
    printerToBridge = new Map();
    const allPrinters: { Name: string; PortName: string; DriverName: string; _bridgeId?: string; _bridgeHost?: string }[] = [];
    const seen = new Set<string>();

    for (const bridge of bridges) {
      if (!bridge.printers || bridge.printers.length === 0) continue;
      console.log(`[PrintBridge] Bridge "${bridge.hostname}" (${bridge.localIp}) → ${bridge.printers.length} impresoras`);
      
      for (const p of bridge.printers) {
        // Register which bridge has this printer
        printerToBridge.set(p.Name, bridge.id);
        
        // Avoid duplicates (same printer name on multiple bridges)
        if (!seen.has(p.Name)) {
          seen.add(p.Name);
          allPrinters.push({
            Name: p.Name,
            PortName: `via ${bridge.hostname}`,
            DriverName: p.DriverName || "",
            _bridgeId: bridge.id,
            _bridgeHost: bridge.hostname,
          });
        }
      }
    }

    console.log(`[PrintBridge] Total: ${allPrinters.length} impresoras de ${bridges.length} bridge(s)`);
    return allPrinters;
  }

  // Same origin (running locally)
  const baseUrl = useLocalBridge ? LOCAL_SERVER_URL : "";
  try {
    console.log(`[PrintBridge] Fetching printers from: ${baseUrl || "(same origin)"}`);
    const res = await fetch(`${baseUrl}/api/system-printers`);
    if (!res.ok) return [];
    const printers = await res.json();
    console.log(`[PrintBridge] Found ${printers.length} printers`);
    return printers;
  } catch (err) {
    console.log("[PrintBridge] Error fetching printers:", err);
    return [];
  }
}

/** Record a print job in history (fire-and-forget) */
export function recordPrint(opts: {
  productName?: string;
  productSku?: string;
  printerName: string;
  mode: 'local' | 'cloud';
  copies?: number;
  status: 'success' | 'error';
  bridgeId?: string;
  details?: string;
}) {
  fetch("/api/print-history", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  }).catch(() => {}); // fire-and-forget
}

/** Send ZPL to printer — via direct bridge or cloud queue */
export async function sendPrintJob(
  zpl: string,
  printerName: string,
  useLocalBridge?: boolean,
  bridgeUrl?: string | null
): Promise<{ ok: boolean; message: string }> {
  
  // Local mode — always print directly via same-origin endpoint
  if (!isRunningOnCloud()) {
    try {
      console.log(`[PrintBridge] Local mode → direct print to /api/print/usb → ${printerName}`);
      const res = await fetch("/api/print/usb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zpl, printerName }),
      });
      const data = await res.json();
      if (res.ok) {
        return { ok: true, message: data.message || "Impresion directa exitosa" };
      }
      return { ok: false, message: data.error || "Error de impresión" };
    } catch (e: any) {
      return { ok: false, message: "Error de conexión con servidor local: " + e.message };
    }
  }

  // Cloud queue mode — find the RIGHT bridge for this printer
  if (bridgeUrl === "CLOUD_QUEUE") {
    // Find which bridge has this printer
    let targetBridgeId = findBridgeForPrinter(printerName);
    
    // If not in cache, refresh bridges and try again
    if (!targetBridgeId) {
      const bridges = await getAllBridges();
      for (const bridge of bridges) {
        if (bridge.printers?.some((p: any) => p.Name === printerName)) {
          targetBridgeId = bridge.id;
          break;
        }
      }
    }

    // Still not found? Use any bridge with printers
    if (!targetBridgeId) {
      const bridges = await getAllBridges();
      const withPrinters = bridges.find((b: any) => b.printers?.length > 0);
      if (withPrinters) {
        targetBridgeId = withPrinters.id;
        console.log(`[PrintBridge] Printer "${printerName}" not found on any bridge. Using "${withPrinters.hostname}" as fallback.`);
      }
    }

    if (!targetBridgeId) {
      return { ok: false, message: "No hay ningún bridge con impresoras activas. Ejecuta el instalador en el PC con impresoras." };
    }

    console.log(`[PrintBridge] CLOUD QUEUE → bridge "${targetBridgeId}" → "${printerName}"`);

    try {
      const res = await fetch("/api/print-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bridgeId: targetBridgeId,
          zpl,
          printerName,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        return { ok: true, message: "☁️ Enviado via nube. Imprimiendo en ~5 segundos..." };
      }
      return { ok: false, message: data.error || "Error al encolar impresión" };
    } catch (e: any) {
      return { ok: false, message: "Error de conexión con la nube: " + e.message };
    }
  }

  // Direct bridge or same origin
  const baseUrl = bridgeUrl || (useLocalBridge ? LOCAL_SERVER_URL : "");

  try {
    console.log(`[PrintBridge] Sending print job to: ${baseUrl || "(same origin)"} → ${printerName}`);
    const res = await fetch(`${baseUrl}/api/print/usb`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zpl, printerName }),
    });
    const data = await res.json();
    if (res.ok) {
      return { ok: true, message: data.message || "Impresion directa exitosa" };
    }
    return { ok: false, message: data.error || "Error de impresión" };
  } catch (e: any) {
    return { ok: false, message: "Error de conexión con servidor local: " + e.message };
  }
}
