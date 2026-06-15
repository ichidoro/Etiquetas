import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, Trash2, Filter, Download, Printer, Clock, CheckCircle, XCircle, Cloud, Usb } from "lucide-react";

interface PrintRecord {
  id: number;
  timestamp: string;
  productName: string | null;
  productSku: string | null;
  printerName: string;
  mode: string;
  copies: number;
  status: string;
  bridgeId: string | null;
  details: string | null;
}

export function PrintHistory() {
  const [records, setRecords] = useState<PrintRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/print-history?limit=500");
      if (!res.ok) return;
      const data = await res.json();
      setRecords(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const clearHistory = async () => {
    if (!confirm("¿Borrar todo el historial de impresión?")) return;
    try {
      await fetch("/api/print-history", { method: "DELETE" });
      setRecords([]);
    } catch {}
  };

  const exportHistory = () => {
    const header = "Fecha,Hora,Producto,SKU,Impresora,Modo,Copias,Estado\n";
    const rows = filtered
      .map((r) => {
        const d = new Date(r.timestamp + "Z");
        return `${d.toLocaleDateString("es")},${d.toLocaleTimeString("es")},${(r.productName || "").replace(/,/g, ";")},${r.productSku || ""},${r.printerName.replace(/,/g, ";")},${r.mode},${r.copies},${r.status}`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `historial-impresion-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filtered = records.filter((r) => {
    if (filterMode !== "all" && r.mode !== filterMode) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (
        (r.productName || "").toLowerCase().includes(s) ||
        (r.productSku || "").toLowerCase().includes(s) ||
        r.printerName.toLowerCase().includes(s)
      );
    }
    return true;
  });

  // Stats
  const totalToday = records.filter((r) => {
    const d = new Date(r.timestamp + "Z");
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length;

  const totalSuccess = records.filter((r) => r.status === "success").length;
  const totalError = records.filter((r) => r.status === "error").length;
  const totalCopies = records.reduce((acc, r) => acc + (r.copies || 1), 0);

  // Group by date
  const groupByDate = (items: PrintRecord[]) => {
    const groups: { [key: string]: PrintRecord[] } = {};
    for (const item of items) {
      const d = new Date(item.timestamp + "Z");
      const key = d.toLocaleDateString("es", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  };

  const grouped = groupByDate(filtered);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-2xl font-bold text-slate-800">{totalToday}</div>
          <div className="text-xs text-slate-500">Impresiones hoy</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-2xl font-bold text-emerald-600">{totalSuccess}</div>
          <div className="text-xs text-slate-500">Exitosas</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-2xl font-bold text-red-500">{totalError}</div>
          <div className="text-xs text-slate-500">Con error</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-2xl font-bold text-blue-600">{totalCopies}</div>
          <div className="text-xs text-slate-500">Total etiquetas</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-slate-800">Registro de Impresiones</h3>
              <span className="text-xs text-slate-400">{filtered.length} registros</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar producto o impresora..."
                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-600 w-48"
              />
              <select
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value)}
                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-600"
              >
                <option value="all">Todos los modos</option>
                <option value="local">Local / USB</option>
                <option value="cloud">Nube / Cola</option>
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-600"
              >
                <option value="all">Todos los estados</option>
                <option value="success">Exitosas</option>
                <option value="error">Con error</option>
              </select>
              <button
                onClick={fetchHistory}
                className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                title="Refrescar"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={exportHistory}
                className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                title="Exportar CSV"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={clearHistory}
                className="p-1.5 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                title="Borrar historial"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Records */}
        <div className="max-h-[600px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              Cargando historial...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Clock className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">No hay registros de impresion</p>
              <p className="text-xs mt-1">Las impresiones apareceran aqui automaticamente</p>
            </div>
          ) : (
            Object.entries(grouped).map(([dateLabel, items]) => (
              <div key={dateLabel}>
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                  <span className="text-xs font-semibold text-slate-500 uppercase">{dateLabel}</span>
                  <span className="text-xs text-slate-400 ml-2">({items.length})</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map((r) => {
                    const d = new Date(r.timestamp + "Z");
                    const isError = r.status === "error";
                    return (
                      <div
                        key={r.id}
                        className={`px-4 py-3 hover:bg-slate-50 transition-colors ${isError ? "bg-red-50/30" : ""}`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Status icon */}
                          {isError ? (
                            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                          ) : (
                            <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                          )}

                          {/* Main content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-800 truncate">
                                {r.productName || "Etiqueta libre"}
                              </span>
                              {r.productSku && (
                                <span className="text-xs font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {r.productSku}
                                </span>
                              )}
                              {r.copies > 1 && (
                                <span className="text-xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                  x{r.copies}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Printer className="w-3 h-3 text-slate-400" />
                              <span className="text-xs text-slate-500 truncate">{r.printerName}</span>
                              {r.details && isError && (
                                <span className="text-xs text-red-500 truncate">{r.details}</span>
                              )}
                            </div>
                          </div>

                          {/* Mode badge */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {r.mode === "cloud" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                                <Cloud className="w-3 h-3" /> Nube
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
                                <Usb className="w-3 h-3" /> Local
                              </span>
                            )}
                          </div>

                          {/* Time */}
                          <span className="text-xs text-slate-400 flex-shrink-0 tabular-nums">
                            {d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
