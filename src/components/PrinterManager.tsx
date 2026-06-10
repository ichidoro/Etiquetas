import React, { useState, useEffect, useCallback } from "react";
import { Printer, RefreshCw, Star, Check, AlertCircle, Wifi, WifiOff, Usb } from "lucide-react";
import { isRunningOnCloud, isLocalServerAvailable, fetchPrinters as bridgeFetchPrinters } from "../utils/printBridge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SystemPrinter {
  Name: string;
  PortName: string;
  DriverName: string;
  PrinterStatus: number;
}

interface PrinterManagerProps {
  onShowToast?: (message: string, type: "success" | "error") => void;
}

const PRINTER_STORAGE_KEY = "zebra-default-printer";
const PRINTER_HISTORY_KEY = "zebra-printer-history";

// Status codes → labels
function statusLabel(code: number): { text: string; color: string } {
  switch (code) {
    case 0:
      return { text: "Normal", color: "text-emerald-600" };
    case 1:
      return { text: "Pausada", color: "text-amber-600" };
    case 2:
      return { text: "Error", color: "text-red-600" };
    case 3:
      return { text: "Eliminando", color: "text-red-500" };
    case 4:
      return { text: "Atasco de papel", color: "text-red-600" };
    case 5:
      return { text: "Sin papel", color: "text-amber-600" };
    case 6:
      return { text: "Impresión manual", color: "text-blue-600" };
    default:
      return { text: `Código ${code}`, color: "text-slate-500" };
  }
}

function portIcon(portName: string) {
  if (portName?.startsWith("USB")) {
    return <Usb className="w-3.5 h-3.5 text-slate-400" />;
  }
  return <Wifi className="w-3.5 h-3.5 text-slate-400" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PrinterManager({ onShowToast }: PrinterManagerProps) {
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [defaultPrinter, setDefaultPrinter] = useState<string>(
    () => localStorage.getItem(PRINTER_STORAGE_KEY) || ""
  );
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PRINTER_HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [onCloud] = useState(isRunningOnCloud());
  const [bridgeAvailable, setBridgeAvailable] = useState(false);
  const [bridgeChecked, setBridgeChecked] = useState(false);

  const toast = useCallback(
    (message: string, type: "success" | "error") => {
      onShowToast?.(message, type);
    },
    [onShowToast]
  );

  // ---- Fetch printers -------------------------------------------------------
  const fetchPrinters = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let useBridge = false;
      if (onCloud) {
        useBridge = await isLocalServerAvailable();
        setBridgeAvailable(useBridge);
        setBridgeChecked(true);
      }

      const data = await bridgeFetchPrinters(useBridge) as SystemPrinter[];
      setPrinters(data);

      if (data.length === 0 && onCloud && !useBridge) {
        setError("Servidor local no detectado. Ejecuta instalar_zebra.bat en este PC.");
      }

      // Update history: merge detected with saved history
      const names = data.map((p) => p.Name);
      setHistory((prev) => {
        const merged = Array.from(new Set([...prev, ...names]));
        localStorage.setItem(PRINTER_HISTORY_KEY, JSON.stringify(merged));
        return merged;
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      setError(msg);
      toast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [toast, onCloud]);

  useEffect(() => {
    fetchPrinters();
  }, [fetchPrinters]);

  // ---- Set default ----------------------------------------------------------
  const handleSetDefault = (name: string) => {
    setDefaultPrinter(name);
    localStorage.setItem(PRINTER_STORAGE_KEY, name);
    toast(`Impresora predeterminada: ${name}`, "success");
  };

  const handleClearDefault = () => {
    setDefaultPrinter("");
    localStorage.removeItem(PRINTER_STORAGE_KEY);
    toast("Impresora predeterminada eliminada", "success");
  };

  // ---- Check if a printer is currently connected ----------------------------
  const isConnected = (name: string) =>
    printers.some((p) => p.Name === name);

  // ---- Render ---------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-violet-100 rounded-lg">
            <Printer className="w-6 h-6 text-violet-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              <span>Impresoras</span>
            </h2>
            <p className="text-sm text-slate-500">
              <span>
                Detección, historial y predeterminada
              </span>
            </p>
            {onCloud && bridgeChecked && (
              bridgeAvailable ? (
                <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <Wifi className="w-3 h-3" /> Conectado al servidor local
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  <WifiOff className="w-3 h-3" /> Sin servidor local — ejecuta instalar_zebra.bat
                </span>
              )
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={fetchPrinters}
          disabled={loading}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
          />
          <span>Detectar Impresoras</span>
        </button>
      </div>

      {/* Default Printer Banner */}
      {defaultPrinter && (
        <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-center gap-3">
            <Star className="w-5 h-5 text-amber-500 fill-amber-400" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                <span>Impresora predeterminada</span>
              </p>
              <p className="text-xs text-amber-600 font-mono">
                <span>{defaultPrinter}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClearDefault}
            className="text-xs text-amber-600 hover:text-amber-800 underline transition-colors"
          >
            <span>Quitar</span>
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-500 rounded-full animate-spin" />
            <span className="text-sm text-slate-500">
              Detectando impresoras del sistema…
            </span>
          </div>
        </div>
      )}

      {/* Printers detected now */}
      {!loading && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">
            <span>
              Impresoras detectadas ({printers.length})
            </span>
          </h3>

          {printers.length === 0 ? (
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center">
              <Printer className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-slate-500">
                <span>No se detectaron impresoras en el sistema</span>
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {printers.map((p) => {
                const isDefault = defaultPrinter === p.Name;
                const st = statusLabel(p.PrinterStatus);
                const isZebra =
                  p.DriverName?.toLowerCase().includes("zebra") ||
                  p.Name?.toLowerCase().includes("zebra");

                return (
                  <div
                    key={p.Name}
                    className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                      isDefault
                        ? "bg-blue-50/50 border-blue-300 shadow-sm"
                        : "bg-white border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`p-2 rounded-lg ${
                          isZebra
                            ? "bg-violet-100"
                            : "bg-slate-100"
                        }`}
                      >
                        <Printer
                          className={`w-5 h-5 ${
                            isZebra
                              ? "text-violet-600"
                              : "text-slate-500"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate flex items-center gap-2">
                          <span>{p.Name}</span>
                          {isZebra && (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-violet-100 text-violet-700 rounded">
                              ZEBRA
                            </span>
                          )}
                          {isDefault && (
                            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400 flex-shrink-0" />
                          )}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            {portIcon(p.PortName)}
                            <span>{p.PortName}</span>
                          </span>
                          <span className={`text-xs font-medium ${st.color}`}>
                            {st.text}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          <span>{p.DriverName}</span>
                        </p>
                      </div>
                    </div>

                    {/* Set as default button */}
                    <div className="flex-shrink-0 ml-3">
                      {isDefault ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-100 rounded-lg">
                          <Check className="w-3.5 h-3.5" />
                          <span>Predeterminada</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(p.Name)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors cursor-pointer"
                        >
                          <Star className="w-3.5 h-3.5" />
                          <span>Predeterminar</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* History of previously used printers */}
      {!loading && history.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">
            <span>Historial de impresoras</span>
          </h3>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {history.map((name) => {
              const connected = isConnected(name);
              return (
                <div
                  key={name}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        connected ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    <span className="text-sm text-slate-700 truncate font-mono">
                      {name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        connected
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {connected ? "Conectada" : "No detectada"}
                    </span>
                    {connected && defaultPrinter !== name && (
                      <button
                        type="button"
                        onClick={() => handleSetDefault(name)}
                        className="text-[10px] text-blue-500 hover:text-blue-700 underline cursor-pointer transition-colors"
                      >
                        <span>Predeterminar</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
        <p className="text-xs text-slate-500 leading-relaxed">
          <span>
            La impresora predeterminada se usará automáticamente en todas las
            ventanas de impresión (códigos de barra y trazabilidad). Puedes
            cambiarla en cualquier momento desde aquí o directamente en la
            ventana de impresión.
          </span>
        </p>
      </div>
    </div>
  );
}
