/**
 * Print Bridge — Detects if a local print server is running on localhost:3000
 * and routes print requests there when the app is opened from Cloud Run.
 * 
 * Flow:
 * 1. App opens from Cloud Run (https://zebra-bridge-pro-xxx.run.app)
 * 2. Frontend checks if localhost:3000 is available (local print server)
 * 3. If available → fetch printers and send ZPL to localhost
 * 4. If not available → show "install local agent" message
 */

const LOCAL_SERVER_URL = "http://localhost:3000";
const PING_TIMEOUT = 2000; // 2 seconds

/** Check if we're running on Cloud (not localhost) */
export function isRunningOnCloud(): boolean {
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1";
}

/** Check if the local print server is reachable */
export async function isLocalServerAvailable(): Promise<boolean> {
  if (!isRunningOnCloud()) {
    // We ARE the local server, no need to check
    return false; // false means "use normal API, don't redirect"
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT);

    const res = await fetch(`${LOCAL_SERVER_URL}/api/system-printers`, {
      signal: controller.signal,
      mode: "cors",
    });

    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/** Fetch system printers — from local server if on Cloud, otherwise normal API */
export async function fetchPrinters(
  useLocalBridge: boolean
): Promise<{ Name: string; PortName: string; DriverName: string }[]> {
  const baseUrl = useLocalBridge ? LOCAL_SERVER_URL : "";

  try {
    const res = await fetch(`${baseUrl}/api/system-printers`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/** Send ZPL to printer — via local server if on Cloud */
export async function sendPrintJob(
  zpl: string,
  printerName: string,
  useLocalBridge: boolean
): Promise<{ ok: boolean; message: string }> {
  const baseUrl = useLocalBridge ? LOCAL_SERVER_URL : "";

  try {
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
    return { ok: false, message: "Error de conexión: " + e.message };
  }
}
