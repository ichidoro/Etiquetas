import React, { useState, useEffect, useMemo } from "react";
import { X, Printer, Download, Copy, Check, Code, Minus, Plus, Calendar } from "lucide-react";
import { Product, LabelFormat } from "../types";

// ─── localStorage helpers ───────────────────────────────────────────────────
const PRINTER_STORAGE_KEY = "zebra-default-printer";

function loadDefaultPrinter(): string {
  try {
    return localStorage.getItem(PRINTER_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveDefaultPrinter(name: string) {
  try {
    localStorage.setItem(PRINTER_STORAGE_KEY, name);
  } catch {}
}

// ─── Date helpers ───────────────────────────────────────────────────────────
function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

// ─── ZPL generation ─────────────────────────────────────────────────────────
function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

interface TraceZplParams {
  format: LabelFormat;
  elabDate: Date;
  vencDate: Date;
  productName: string;
  dateFontMm: number;
  nameFontMm: number;
  copies: number;
}

function generateTraceZpl({
  format,
  elabDate,
  vencDate,
  productName,
  dateFontMm,
  nameFontMm,
  copies,
}: TraceZplParams): string {
  const dpi = format.dpi;
  const widthDots = mmToDots(format.width, dpi);
  const heightDots = mmToDots(format.height, dpi);
  const darkness = format.darkness;
  const speed = format.printSpeed;

  const marginL = mmToDots(format.marginLeft, dpi);
  const marginT = mmToDots(format.marginTop, dpi);
  const usableWidth = widthDots - marginL - mmToDots(format.marginRight, dpi);
  const usableHeight = heightDots - marginT - mmToDots(format.marginBottom, dpi);

  // Font sizes in dots
  const dateFontH = mmToDots(dateFontMm, dpi);
  const dateFontW = Math.round(dateFontH * 0.6);
  const nameFontH = mmToDots(nameFontMm, dpi);
  const nameFontW = Math.round(nameFontH * 0.6);

  // Vertical layout: 3 lines evenly distributed
  const totalTextHeight = dateFontH * 2 + nameFontH;
  const spacing = Math.round((usableHeight - totalTextHeight) / 4);
  const y1 = marginT + spacing;
  const y2 = y1 + dateFontH + spacing;
  const y3 = y2 + dateFontH + spacing;

  const x = marginL;
  const fbWidth = usableWidth;

  const elabStr = formatDDMMYYYY(elabDate);
  const vencStr = formatDDMMYYYY(vencDate);

  return [
    "^XA",
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    `~SD${darkness}`,
    `^PR${speed}`,
    `^FO${x},${y1}^FB${fbWidth},1,0,C,0^A0N,${dateFontH},${dateFontW}^FDELAB: ${elabStr}^FS`,
    `^FO${x},${y2}^FB${fbWidth},1,0,C,0^A0N,${dateFontH},${dateFontW}^FDVENC: ${vencStr}^FS`,
    `^FO${x},${y3}^FB${fbWidth},1,0,C,0^A0N,${nameFontH},${nameFontW}^FD${productName}^FS`,
    `^PQ${copies},0,1,Y`,
    "^XZ",
  ].join("\n");
}

// ─── Component ──────────────────────────────────────────────────────────────
interface TracePrintModalProps {
  product: Product;
  labelFormats: LabelFormat[];
  activeFormatId: string;
  onClose: () => void;
  onShowToast?: (message: string, type: "success" | "error") => void;
}

export function TracePrintModal({
  product,
  labelFormats,
  activeFormatId: initialFormatId,
  onClose,
  onShowToast,
}: TracePrintModalProps) {
  // ── Format selector ────────────────────────────────────────────────────
  const [activeFormatId, setActiveFormatId] = useState(initialFormatId);
  const currentFormat =
    labelFormats.find((f) => f.id === activeFormatId) || labelFormats[0];

  // ── Date state ─────────────────────────────────────────────────────────
  const [elabDate, setElabDate] = useState(() => new Date());
  const hasCaducidad =
    product.caducidad !== null &&
    product.caducidad !== undefined &&
    product.caducidad > 0;
  const [manualDays, setManualDays] = useState<number>(hasCaducidad ? product.caducidad! : 30);

  const expirationDays = hasCaducidad ? product.caducidad! : manualDays;
  const vencDate = useMemo(
    () => addDays(elabDate, expirationDays),
    [elabDate, expirationDays]
  );

  // ── Font sizes (mm) ───────────────────────────────────────────────────
  const [dateFontMm, setDateFontMm] = useState(4);
  const [nameFontMm, setNameFontMm] = useState(3);
  const [copies, setCopies] = useState(1);

  const clampFont = (val: number) => Math.max(1.5, Math.min(8, val));

  // ── Printer state ─────────────────────────────────────────────────────
  const [systemPrinters, setSystemPrinters] = useState<
    { Name: string; PortName: string; DriverName: string }[]
  >([]);
  const [selectedSystemPrinter, setSelectedSystemPrinter] = useState("");
  const [usbPrinting, setUsbPrinting] = useState(false);

  // ── Clipboard state ───────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);

  // ── Fetch printers on mount ───────────────────────────────────────────
  useEffect(() => {
    const savedPrinter = loadDefaultPrinter();
    fetch("/api/system-printers")
      .then((r) => r.json())
      .then((printers: any[]) => {
        setSystemPrinters(printers);
        if (savedPrinter && printers.some((p) => p.Name === savedPrinter)) {
          setSelectedSystemPrinter(savedPrinter);
        } else {
          const zebra = printers.find(
            (p) =>
              p.DriverName?.toLowerCase().includes("zebra") ||
              p.Name?.toLowerCase().includes("zebra")
          );
          if (zebra) setSelectedSystemPrinter(zebra.Name);
          else if (printers.length > 0) setSelectedSystemPrinter(printers[0].Name);
        }
      })
      .catch(() => {});
  }, []);

  const handlePrinterChange = (name: string) => {
    setSelectedSystemPrinter(name);
    saveDefaultPrinter(name);
  };

  // ── ZPL Generation ────────────────────────────────────────────────────
  const zplCode = useMemo(
    () =>
      generateTraceZpl({
        format: currentFormat,
        elabDate,
        vencDate,
        productName: product.item_name,
        dateFontMm,
        nameFontMm,
        copies,
      }),
    [currentFormat, elabDate, vencDate, product.item_name, dateFontMm, nameFontMm, copies]
  );

  // ── Actions ───────────────────────────────────────────────────────────
  const handleCopyZpl = () => {
    navigator.clipboard.writeText(zplCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZPL = () => {
    const blob = new Blob([zplCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trazabilidad_${product.sku}.zpl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleUsbSystemPrint = async () => {
    if (!selectedSystemPrinter) {
      onShowToast?.("Selecciona una impresora del sistema", "error");
      return;
    }
    setUsbPrinting(true);
    try {
      const res = await fetch("/api/print/usb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zpl: zplCode, printerName: selectedSystemPrinter }),
      });
      const data = await res.json();
      if (res.ok) {
        onShowToast?.(`✅ ${data.message}`, "success");
      } else {
        onShowToast?.(data.error || "Error de impresión", "error");
      }
    } catch (e: any) {
      onShowToast?.("Error de conexión: " + e.message, "error");
    } finally {
      setUsbPrinting(false);
    }
  };

  // ── Preview calculations ──────────────────────────────────────────────
  const previewScale = 3; // px per mm for visual preview
  const pW = currentFormat.width * previewScale;
  const pH = currentFormat.height * previewScale;
  const pML = currentFormat.marginLeft * previewScale;
  const pMR = currentFormat.marginRight * previewScale;
  const pMT = currentFormat.marginTop * previewScale;
  const pMB = currentFormat.marginBottom * previewScale;
  const usableW = pW - pML - pMR;
  const usableH = pH - pMT - pMB;

  const pDateFont = dateFontMm * previewScale;
  const pNameFont = nameFontMm * previewScale;
  const totalH = pDateFont * 2 + pNameFont;
  const pSpacing = (usableH - totalH) / 4;
  const pY1 = pMT + pSpacing;
  const pY2 = pY1 + pDateFont + pSpacing;
  const pY3 = pY2 + pDateFont + pSpacing;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm print:hidden">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh] mx-4">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-slate-800 to-slate-900">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-400" />
              <span>Trazabilidad: {product.sku}</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              {product.item_name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1 flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Content ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[420px]">
            {/* ── Left Column: Data Inputs & Controls ──────────── */}
            <div className="border-r border-slate-100 p-5 bg-slate-50/70 flex flex-col gap-5">
              {/* Caducidad warning */}
              {!hasCaducidad && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                  <span className="text-amber-500 text-sm leading-none mt-0.5">⚠️</span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-amber-700">
                      Sin caducidad configurada
                    </p>
                    <p className="text-[10px] text-amber-600 mt-0.5">
                      Ingresa los días de vida útil manualmente.
                    </p>
                  </div>
                </div>
              )}

              {/* Dates Section */}
              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                  Fechas
                </h3>
                <div className="space-y-3">
                  {/* Elaboration date */}
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg border border-slate-200">
                    <Calendar className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">
                        Elaboración
                      </div>
                      <input
                        type="date"
                        value={toInputDate(elabDate)}
                        onChange={(e) => setElabDate(new Date(e.target.value + "T12:00:00"))}
                        className="w-full text-sm font-semibold text-slate-800 bg-transparent outline-none mt-0.5 cursor-pointer"
                      />
                    </div>
                    <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded">
                      {formatDDMMYYYY(elabDate)}
                    </span>
                  </div>

                  {/* Days input (only if no caducidad) */}
                  {!hasCaducidad && (
                    <div className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg border border-amber-200">
                      <span className="text-amber-400 text-sm flex-shrink-0">📅</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] font-semibold text-amber-500 uppercase tracking-wide">
                          Días de vida útil
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={9999}
                          value={manualDays}
                          onChange={(e) => setManualDays(Math.max(1, Number(e.target.value)))}
                          className="w-full text-sm font-semibold text-slate-800 bg-transparent outline-none mt-0.5"
                        />
                      </div>
                    </div>
                  )}

                  {/* Expiration date (readonly) */}
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg border border-slate-200">
                    <Calendar className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">
                        Vencimiento
                      </div>
                      <div className="text-sm font-semibold text-slate-800 mt-0.5">
                        {formatDDMMYYYY(vencDate)}
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-1 rounded">
                      {expirationDays} días
                    </span>
                  </div>
                </div>
              </div>

              {/* Font Sizes Section */}
              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                  Tamaño de fuente
                </h3>
                <div className="space-y-2">
                  {/* Date font */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide flex-1">
                      Fechas
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setDateFontMm(clampFont(dateFontMm - 0.5))}
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-[11px] font-bold text-slate-700 w-10 text-center tabular-nums">
                        {dateFontMm.toFixed(1)}
                      </span>
                      <button
                        onClick={() => setDateFontMm(clampFont(dateFontMm + 0.5))}
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <span className="text-[8px] text-slate-400 ml-0.5">mm</span>
                    </div>
                  </div>

                  {/* Name font */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide flex-1">
                      Nombre
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setNameFontMm(clampFont(nameFontMm - 0.5))}
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-[11px] font-bold text-slate-700 w-10 text-center tabular-nums">
                        {nameFontMm.toFixed(1)}
                      </span>
                      <button
                        onClick={() => setNameFontMm(clampFont(nameFontMm + 0.5))}
                        className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <span className="text-[8px] text-slate-400 ml-0.5">mm</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Copies */}
              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Copias
                </h3>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Number(e.target.value)))}
                  className="w-full rounded-md border border-slate-200 bg-white shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-slate-800 outline-none font-semibold"
                />
              </div>
            </div>

            {/* ── Right Column: Preview + Print Console ─────────── */}
            <div className="flex flex-col">
              {/* Visual Preview */}
              <div className="p-4 bg-white border-b border-slate-100 flex-1 flex flex-col">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                  Vista previa
                </h3>
                <div className="flex-1 flex items-center justify-center">
                  <div
                    className="bg-white border-2 border-slate-300 rounded shadow-md relative"
                    style={{ width: pW, height: pH }}
                  >
                    {/* Margin guides */}
                    <div
                      className="absolute border border-dashed border-slate-200 pointer-events-none"
                      style={{
                        left: pML,
                        top: pMT,
                        width: usableW,
                        height: usableH,
                      }}
                    />
                    {/* ELAB line */}
                    <div
                      className="absolute text-center font-bold text-slate-800 leading-none truncate"
                      style={{
                        left: pML,
                        top: pY1,
                        width: usableW,
                        fontSize: pDateFont,
                        lineHeight: `${pDateFont}px`,
                      }}
                    >
                      ELAB: {formatDDMMYYYY(elabDate)}
                    </div>
                    {/* VENC line */}
                    <div
                      className="absolute text-center font-bold text-slate-800 leading-none truncate"
                      style={{
                        left: pML,
                        top: pY2,
                        width: usableW,
                        fontSize: pDateFont,
                        lineHeight: `${pDateFont}px`,
                      }}
                    >
                      VENC: {formatDDMMYYYY(vencDate)}
                    </div>
                    {/* Product name */}
                    <div
                      className="absolute text-center font-bold text-slate-800 leading-none truncate"
                      style={{
                        left: pML,
                        top: pY3,
                        width: usableW,
                        fontSize: pNameFont,
                        lineHeight: `${pNameFont}px`,
                      }}
                    >
                      {product.item_name}
                    </div>
                  </div>
                </div>
              </div>

              {/* Print Console */}
              <div className="bg-slate-800 p-4 flex flex-col text-white">
                <div className="flex items-center gap-2 mb-3">
                  <Code className="w-3.5 h-3.5 text-blue-400" />
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Consola de Impresión
                  </h3>
                </div>

                {/* Format selector */}
                <div className="mb-2.5">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Formato
                  </label>
                  <select
                    className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer"
                    value={activeFormatId}
                    onChange={(e) => setActiveFormatId(e.target.value)}
                  >
                    {labelFormats.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Printer selector */}
                {systemPrinters.length > 0 && (
                  <div className="mb-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                        Impresora
                      </label>
                      {selectedSystemPrinter === loadDefaultPrinter() && (
                        <span className="text-[9px] text-emerald-400 font-medium">
                          ★ predeterminada
                        </span>
                      )}
                    </div>
                    <select
                      className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer"
                      value={selectedSystemPrinter}
                      onChange={(e) => handlePrinterChange(e.target.value)}
                    >
                      {systemPrinters.map((p) => (
                        <option key={p.Name} value={p.Name}>
                          {p.Name} ({p.PortName})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Print & Download buttons */}
                <div className="space-y-2 mb-3">
                  <button
                    onClick={handleUsbSystemPrint}
                    disabled={usbPrinting || !selectedSystemPrinter}
                    className="w-full flex items-center justify-center px-4 py-2.5 outline-none rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors border border-emerald-500 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    <span>{usbPrinting ? "Enviando..." : "🖨️ Imprimir Trazabilidad"}</span>
                  </button>
                  <button
                    onClick={handleDownloadZPL}
                    className="w-full flex items-center justify-center px-3 py-1.5 outline-none rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-[11px] transition-colors border border-slate-600 cursor-pointer"
                  >
                    <Download className="w-3 h-3 mr-1.5" />
                    <span>Descargar .ZPL</span>
                  </button>
                </div>

                {/* ZPL Code display */}
                <div className="bg-slate-950 border border-slate-900 rounded-md p-2 overflow-hidden relative group min-h-[80px]">
                  <pre className="text-[8px] text-emerald-400 font-mono whitespace-pre-wrap break-all h-full overflow-y-auto custom-scrollbar leading-relaxed">
                    {zplCode}
                  </pre>
                  <button
                    onClick={handleCopyZpl}
                    className="absolute top-1 right-1 p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Copiar ZPL"
                  >
                    {copied ? (
                      <Check className="w-3 h-3 text-green-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
                {copied && (
                  <p className="text-[10px] text-green-400 mt-0.5 text-right font-medium">
                    ¡Copiado!
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          <div className="text-[10px] text-slate-400">
            <span>
              {currentFormat.width}×{currentFormat.height}mm · {currentFormat.dpi} DPI
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
