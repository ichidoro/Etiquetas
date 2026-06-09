import React, { useState, useEffect } from "react";
import { X, Printer, Code, Copy, Check, Download, RotateCcw } from "lucide-react";
import { Product, LabelFormat, ElementPosition } from "../types";
import { BarcodeRenderer } from "./BarcodeRenderer";
import { DraggableLabelPreview } from "./DraggableLabelPreview";
import { generateZpl, calculateDefaultPositions } from "../utils/zebra";

interface PrintModalProps {
  product: Product;
  labelFormats: LabelFormat[];
  activeFormatId: string;
  onClose: () => void;
  onShowToast?: (message: string, type: 'success' | 'error') => void;
}

export function PrintModal({
  product,
  labelFormats,
  activeFormatId: initialFormatId,
  onClose,
  onShowToast,
}: PrintModalProps) {
  const [activeFormatId, setActiveFormatId] = useState(initialFormatId);
  const baseLabelFormat =
    labelFormats.find((f) => f.id === activeFormatId) || labelFormats[0];

  // Local toggles for which codes to print
  const [selectedParts, setSelectedParts] = useState({
    name: baseLabelFormat?.showName ?? true,
    sku: baseLabelFormat?.showSku ?? true,
    ean13: baseLabelFormat?.showEan13 ?? true,
    dun14: baseLabelFormat?.showDun14 ?? true,
  });

  const [quantity, setQuantity] = useState(1);

  // Sync when activeFormatId changes
  React.useEffect(() => {
    if (baseLabelFormat) {
      setSelectedParts({
        name: baseLabelFormat.showName,
        sku: baseLabelFormat.showSku,
        ean13: baseLabelFormat.showEan13,
        dun14: baseLabelFormat.showDun14,
      });
    }
  }, [baseLabelFormat]);

  const [copied, setCopied] = useState(false);
  const [systemPrinters, setSystemPrinters] = useState<{Name: string; PortName: string; DriverName: string}[]>([]);
  const [selectedSystemPrinter, setSelectedSystemPrinter] = useState<string>('');
  const [usbPrinting, setUsbPrinting] = useState(false);

  // Element positions for drag & drop
  const currentFormat = {
    ...baseLabelFormat,
    showName: selectedParts.name,
    showSku: selectedParts.sku,
    showEan13: selectedParts.ean13,
    showDun14: selectedParts.dun14,
  };

  const [elementPositions, setElementPositions] = useState<ElementPosition[]>(() =>
    calculateDefaultPositions(currentFormat, product)
  );
  const [isCustomPositions, setIsCustomPositions] = useState(false);

  // Recalculate default positions when format or selected parts change (only if not custom)
  useEffect(() => {
    if (!isCustomPositions) {
      setElementPositions(calculateDefaultPositions(currentFormat, product));
    }
  }, [activeFormatId, selectedParts.name, selectedParts.sku, selectedParts.ean13, selectedParts.dun14, isCustomPositions]);

  const handlePositionsChange = (newPositions: ElementPosition[]) => {
    setElementPositions(newPositions);
    setIsCustomPositions(true);
  };

  const handleResetPositions = () => {
    setElementPositions(calculateDefaultPositions(currentFormat, product));
    setIsCustomPositions(false);
  };

  // Fetch Windows system printers on mount
  useEffect(() => {
    fetch('/api/system-printers')
      .then(r => r.json())
      .then((printers: any[]) => {
        setSystemPrinters(printers);
        const zebra = printers.find(p => p.DriverName?.toLowerCase().includes('zebra') || p.Name?.toLowerCase().includes('zebra'));
        if (zebra) setSelectedSystemPrinter(zebra.Name);
        else if (printers.length > 0) setSelectedSystemPrinter(printers[0].Name);
      })
      .catch(() => {});
  }, []);

  // Generate ZPL with positions
  let zplCode = generateZpl(
    product.sku,
    product.item_name,
    product.ean13,
    product.dun14,
    currentFormat,
    elementPositions,
  );
  zplCode = zplCode.replace("^PQ1,0,1,Y", `^PQ${quantity},0,1,Y`);

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
    a.download = `etiqueta_${product.sku}.zpl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleUsbSystemPrint = async () => {
    if (!selectedSystemPrinter) {
      onShowToast?.('Selecciona una impresora del sistema', 'error');
      return;
    }
    setUsbPrinting(true);
    try {
      const res = await fetch('/api/print/usb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zpl: zplCode, printerName: selectedSystemPrinter }),
      });
      const data = await res.json();
      if (res.ok) {
        onShowToast?.(`✅ ${data.message}`, 'success');
      } else {
        onShowToast?.(data.error || 'Error de impresión', 'error');
      }
    } catch (e: any) {
      onShowToast?.('Error de conexión: ' + e.message, 'error');
    } finally {
      setUsbPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm print:hidden">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh] mx-4">
        {/* Header */}
        <div className="px-6 py-3.5 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-slate-800 to-slate-900">
          <div>
            <h2 className="text-base font-bold text-white">
              Imprimir: {product.sku}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-md">{product.item_name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content — 3 columns */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 h-full">

            {/* Column 1: Element Selection */}
            <div className="lg:col-span-3 border-r border-slate-100 p-4 bg-slate-50/50">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Elementos
              </h3>

              <div className="space-y-2">
                {/* Name toggle */}
                <label className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 bg-white cursor-pointer hover:border-blue-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedParts.name}
                    onChange={(e) =>
                      setSelectedParts((prev) => ({ ...prev, name: e.target.checked }))
                    }
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase">Nombre</div>
                    <div className="text-xs text-slate-700 truncate font-medium">{product.item_name}</div>
                  </div>
                </label>

                {/* SKU toggle */}
                <label className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 bg-white cursor-pointer hover:border-blue-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedParts.sku}
                    onChange={(e) =>
                      setSelectedParts((prev) => ({ ...prev, sku: e.target.checked }))
                    }
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase">SKU (Code 128)</div>
                    <div className="h-8 mt-0.5">
                      <BarcodeRenderer value={product.sku} format="CODE128" height={25} width={1} />
                    </div>
                  </div>
                </label>

                {/* EAN13 toggle */}
                {product.ean13 && (
                  <label className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 bg-white cursor-pointer hover:border-blue-300 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedParts.ean13}
                      onChange={(e) =>
                        setSelectedParts((prev) => ({ ...prev, ean13: e.target.checked }))
                      }
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase">EAN 13</div>
                      <div className="h-8 mt-0.5">
                        <BarcodeRenderer value={product.ean13} format="EAN13" height={25} width={1} />
                      </div>
                    </div>
                  </label>
                )}

                {/* DUN14 toggle */}
                {product.dun14 && (
                  <label className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 bg-white cursor-pointer hover:border-blue-300 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedParts.dun14}
                      onChange={(e) =>
                        setSelectedParts((prev) => ({ ...prev, dun14: e.target.checked }))
                      }
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase">DUN 14 (ITF-14)</div>
                      <div className="h-8 mt-0.5">
                        <BarcodeRenderer value={product.dun14} format="ITF14" height={25} width={1} />
                      </div>
                    </div>
                  </label>
                )}
              </div>

              {/* Reset positions button */}
              {isCustomPositions && (
                <button
                  onClick={handleResetPositions}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Resetear posiciones
                </button>
              )}
            </div>

            {/* Column 2: Label Preview (Drag & Drop) */}
            <div className="lg:col-span-5 p-4 flex flex-col bg-white">
              <DraggableLabelPreview
                format={currentFormat}
                product={product}
                positions={elementPositions}
                onPositionsChange={handlePositionsChange}
                selectedParts={selectedParts}
              />
            </div>

            {/* Column 3: Print Controls */}
            <div className="lg:col-span-4 bg-slate-800 p-4 flex flex-col text-white">
              <div className="flex items-center gap-2 mb-3">
                <Code className="w-4 h-4 text-blue-400" />
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Consola de Impresión
                </h3>
              </div>

              {/* Format + Quantity */}
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
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

                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Copias
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none font-semibold"
                  />
                </div>
              </div>

              {/* Printer Selection */}
              {systemPrinters.length > 0 && (
                <div className="mb-4">
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Impresora
                  </label>
                  <select
                    className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer"
                    value={selectedSystemPrinter}
                    onChange={(e) => setSelectedSystemPrinter(e.target.value)}
                  >
                    {systemPrinters.map((p) => (
                      <option key={p.Name} value={p.Name}>
                        {p.Name} ({p.PortName})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Print actions */}
              <div className="space-y-2 mb-4">
                <button
                  onClick={handleUsbSystemPrint}
                  disabled={usbPrinting || !selectedSystemPrinter}
                  className="w-full flex items-center justify-center px-4 py-3 outline-none rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors border border-emerald-500 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Printer className="w-5 h-5 mr-2" />
                  {usbPrinting ? 'Enviando...' : '🖨️ Imprimir Etiqueta'}
                </button>

                <button
                  onClick={handleDownloadZPL}
                  className="w-full flex items-center justify-center px-3 py-2 outline-none rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-xs transition-colors border border-slate-600 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Descargar .ZPL
                </button>
              </div>

              {/* ZPL Code Preview */}
              <div className="flex-1 bg-slate-950 border border-slate-900 rounded-md p-2.5 overflow-hidden relative group min-h-[100px]">
                <pre className="text-[9px] text-emerald-400 font-mono whitespace-pre-wrap break-all h-full overflow-y-auto custom-scrollbar leading-relaxed">
                  {zplCode}
                </pre>
                <button
                  onClick={handleCopyZpl}
                  className="absolute top-1.5 right-1.5 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title="Copiar ZPL"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              {copied && (
                <p className="text-[10px] text-green-400 mt-1 text-right font-medium">
                  ¡Copiado!
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          <div className="text-[10px] text-slate-400">
            {isCustomPositions && (
              <span className="text-blue-500 font-medium">Posiciones personalizadas activas</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
