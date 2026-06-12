/**
 * Print Bridge — Auto-discovers print servers and uses Cloud queue as fallback
 * 
 * Flow:
 * 1. App opens from Cloud Run
 * 2. Check if localhost:3000 is available (local bridge on same PC)
 * 3. If not → get registered bridges from Cloud DB
 * 4. Use Cloud print queue to send jobs (bridge polls & prints)
 * 5. Fallback to WebUSB only as last resort
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

/** Get the first active bridge from cloud DB */
async function getActiveBridge(): Promise<{ id: string; printers: { Name: string; DriverName: string }[] } | null> {
  try {
    const res = await fetch("/api/bridges");
    if (!res.ok) return null;
    const bridges = await res.json();
    if (bridges.length === 0) return null;
    return bridges[0]; // Use first available bridge
  } catch {
    return null;
  }
}

/** Fetch system printers — auto-discovers bridge or gets from cloud registry */
export async function fetchPrinters(
  useLocalBridge?: boolean,
  bridgeUrl?: string | null
): Promise<{ Name: string; PortName: string; DriverName: string }[]> {
  
  // Direct local bridge (localhost:3000 on same PC)
  if (bridgeUrl && bridgeUrl !== "CLOUD_QUEUE") {
    try {
      console.log(`[PrintBridge] Fetching printers from: ${bridgeUrl}`);
      const res = await fetch(`${bridgeUrl}/api/system-printers`);
      if (!res.ok) return [];
      const printers = await res.json();
      console.log(`[PrintBridge] Found ${printers.length} printers`);
      return printers;
    } catch (err) {
      console.log("[PrintBridge] Error fetching printers from bridge:", err);
      return [];
    }
  }

  // Cloud queue mode — get printers from bridge registry
  if (bridgeUrl === "CLOUD_QUEUE") {
    const bridge = await getActiveBridge();
    if (bridge && bridge.printers) {
      console.log(`[PrintBridge] Got ${bridge.printers.length} printers from cloud registry`);
      // The bridge registry stores printers as {Name, DriverName}, add dummy PortName
      return bridge.printers.map((p: any) => ({
        Name: p.Name,
        PortName: "",
        DriverName: p.DriverName || "",
      }));
    }
    console.log("[PrintBridge] No bridges registered in cloud");
    return [];
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

/** Send ZPL to printer — via direct bridge or cloud queue */
export async function sendPrintJob(
  zpl: string,
  printerName: string,
  useLocalBridge?: boolean,
  bridgeUrl?: string | null
): Promise<{ ok: boolean; message: string }> {
  
  // Cloud queue mode — send via cloud relay
  if (bridgeUrl === "CLOUD_QUEUE") {
    console.log(`[PrintBridge] Sending print job via CLOUD QUEUE → ${printerName}`);
    const bridge = await getActiveBridge();
    if (!bridge) {
      return { ok: false, message: "No hay ningún bridge activo. Ejecuta el instalador en el PC con impresoras." };
    }
    
    try {
      const res = await fetch("/api/print-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bridgeId: bridge.id,
          zpl,
          printerName,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        return { ok: true, message: "Trabajo enviado a la cola. Se imprimirá en unos segundos..." };
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
      return { ok: true, message: data.message || "Impresión exitosa" };
    }
    return { ok: false, message: data.error || "Error de impresión" };
  } catch (e: any) {
    return { ok: false, message: "Error de conexión con servidor local: " + e.message };
  }
}
