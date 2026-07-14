import * as baileys from "@whiskeysockets/baileys";
const makeWASocket = (
  typeof (baileys as any).makeWASocket === 'function'
    ? (baileys as any).makeWASocket
    : typeof baileys.default === 'function'
      ? baileys.default
      : baileys
) as any;
const { DisconnectReason, BufferJSON, initAuthCreds, proto } = baileys;
import pino from "pino";
import QRCode from "qrcode";
import { db } from "./server";

export let sock: any = null;
export let qrCodeBase64: string | null = null;
export let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';

async function useDatabaseAuthState(dbClient: any) {
  const cache = new Map<string, any>();
  const dirtyKeys = new Set<string>();
  let flushTimeout: NodeJS.Timeout | null = null;

  // Load all session data from DB into cache at startup
  try {
    console.log('[WhatsApp] Loading auth session cache from database...');
    const allRows = await dbClient.execute("SELECT key, value FROM whatsapp_session");
    for (const row of allRows.rows) {
      try {
        const parsed = JSON.parse(row.value, BufferJSON.reviver);
        cache.set(row.key, parsed);
      } catch (err) {
        console.error(`[WhatsApp] Failed to parse cached key ${row.key}`, err);
      }
    }
    console.log(`[WhatsApp] Session cache loaded. Total keys: ${cache.size}`);
  } catch (err) {
    console.error("[WhatsApp] Failed to load session cache from DB", err);
  }

  // Trigger flush of dirty keys to DB with debounce
  const triggerFlush = () => {
    if (flushTimeout) return;
    flushTimeout = setTimeout(async () => {
      flushTimeout = null;
      if (dirtyKeys.size === 0) return;
      
      const keysToFlush = Array.from(dirtyKeys);
      dirtyKeys.clear();
      
      console.log(`[WhatsApp] Flushing ${keysToFlush.length} dirty keys to DB...`);
      try {
        const statements = keysToFlush.map(key => {
          const data = cache.get(key);
          if (data === null || data === undefined) {
            return {
              sql: "DELETE FROM whatsapp_session WHERE key = ?",
              args: [key]
            };
          } else {
            const valStr = JSON.stringify(data, BufferJSON.replacer);
            return {
              sql: "INSERT OR REPLACE INTO whatsapp_session (key, value) VALUES (?, ?)",
              args: [key, valStr]
            };
          }
        });
        
        await dbClient.batch(statements);
        console.log(`[WhatsApp] Flushed ${statements.length} keys to DB successfully.`);
      } catch (err) {
        console.error("[WhatsApp] Failed to flush dirty keys to DB", err);
        // Restores keys to dirty list to retry on next flush
        for (const k of keysToFlush) {
          dirtyKeys.add(k);
        }
      }
    }, 2000);
  };

  const readData = (key: string) => {
    return cache.get(key) || null;
  };

  const writeData = (key: string, data: any) => {
    cache.set(key, data);
    dirtyKeys.add(key);
    triggerFlush();
  };

  let creds = readData("creds");
  if (!creds) {
    creds = initAuthCreds();
    writeData("creds", creds);
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: { [key: string]: any } = {};
          for (const id of ids) {
            let value = readData(`${type}-${id}`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data: any) => {
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const value = data[type][id];
              const key = `${type}-${id}`;
              writeData(key, value);
            }
          }
        }
      }
    },
    saveCreds: async () => {
      writeData("creds", creds);
    }
  };
}

export async function disconnectWhatsApp() {
  try {
    if (sock) {
      await sock.logout();
      sock.end(undefined);
    }
  } catch {}
  sock = null;
  qrCodeBase64 = null;
  connectionStatus = 'disconnected';
  try {
    await db.execute("DELETE FROM whatsapp_session");
  } catch {}
}

export async function initWhatsApp() {
  if (sock) return;
  connectionStatus = 'connecting';
  try {
    console.log('[WhatsApp] typeof baileys:', typeof baileys);
    console.log('[WhatsApp] keys of baileys:', Object.keys(baileys || {}));
    console.log('[WhatsApp] typeof baileys.default:', typeof (baileys as any).default);
    console.log('[WhatsApp] typeof (baileys as any).makeWASocket:', typeof (baileys as any).makeWASocket);
    console.log('[WhatsApp] typeof makeWASocket:', typeof makeWASocket);

    const { state, saveCreds } = await useDatabaseAuthState(db);
    const logger = pino({ level: 'silent' });
    
    sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        try {
          const qrSvg = await QRCode.toDataURL(qr);
          qrCodeBase64 = qrSvg;
        } catch (err) {
          console.error("Error generating QR code data URL", err);
        }
      }
      
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log('[WhatsApp] Connection closed. Status code:', statusCode, 'Error:', lastDisconnect?.error, 'Reconnecting...', shouldReconnect);
        
        sock = null;
        qrCodeBase64 = null;
        connectionStatus = 'disconnected';
        
        if (statusCode === DisconnectReason.loggedOut) {
          console.log('[WhatsApp] Logged out. Clearing credentials from DB...');
          try {
            await db.execute("DELETE FROM whatsapp_session");
          } catch (err) {
            console.error('[WhatsApp] Failed to clear credentials from DB', err);
          }
        }
        
        if (shouldReconnect) {
          setTimeout(initWhatsApp, 5000);
        }
      } else if (connection === 'open') {
        console.log('[WhatsApp] Connection opened successfully!');
        connectionStatus = 'connected';
        qrCodeBase64 = null;
      }
    });
  } catch (e) {
    console.error('[WhatsApp] Failed to init', e);
    connectionStatus = 'disconnected';
  }
}
