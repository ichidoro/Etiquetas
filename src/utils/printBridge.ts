/**
 * Print Bridge — Auto-discovers print servers on the LAN
 * 
 * Flow:
 * 1. App opens from Cloud Run
 * 2. Check if localhost:3000 is available (local bridge on same PC)
 * 3. If not → query Cloud DB for registered bridges on the LAN
 * 4. Try each bridge IP until one responds
 * 5. Use that bridge for printing
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

/** Discover bridge URL — tries localhost first, then LAN bridges from DB */
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

  // 2. Query Cloud DB for registered bridges
  console.log("[PrintBridge] Localhost not available, searching LAN bridges...");
  try {
    const res = await fetch("/api/bridges");
    if (!res.ok) return null;
    const bridges = await res.json();
    
    if (bridges.length === 0) {
      console.log("[PrintBridge] No bridges registered");
      return null;
    }

    console.log(`[PrintBridge] Found ${bridges.length} registered bridge(s), testing...`);

    // 3. Try each bridge
    for (const bridge of bridges) {
      const url = `http://${bridge.localIp}:${bridge.port}`;
      console.log(`[PrintBridge] Testing ${bridge.hostname} at ${url}...`);
      if (await pingBridge(url)) {
        console.log(`[PrintBridge] ✅ LAN bridge found: ${bridge.hostname} (${bridge.localIp})`);
        return url;
      }
    }

    console.log("[PrintBridge] No reachable bridges found on LAN");
    return null;
  } catch (err) {
    console.log("[PrintBridge] Error discovering bridges:", err);
    return null;
  }
}

/** Fetch system printers — auto-discovers bridge */
export async function fetchPrinters(
  useLocalBridge?: boolean,
  bridgeUrl?: string | null
): Promise<{ Name: string; PortName: string; DriverName: string }[]> {
  // If bridgeUrl is explicitly provided, use it
  const baseUrl = bridgeUrl || (useLocalBridge ? LOCAL_SERVER_URL : "");

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

/** Send ZPL to printer — via discovered bridge */
export async function sendPrintJob(
  zpl: string,
  printerName: string,
  useLocalBridge?: boolean,
  bridgeUrl?: string | null
): Promise<{ ok: boolean; message: string }> {
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
      return { ok: true, message: data.message || "Impresión exitosa" };
    }
    return { ok: false, message: data.error || "Error de impresión" };
  } catch (e: any) {
    return { ok: false, message: "Error de conexión con servidor local: " + e.message };
  }
}
