import React, { useState, useEffect, useCallback } from "react";
import { X, Printer, Code, Copy, Check, Download, RotateCcw, Type, Barcode, Save, Minus, Plus, Usb, Wifi, WifiOff } from "lucide-react";
import { Product, LabelFormat, ElementPosition, SavedLabelLayout } from "../types";
import { DraggableLabelPreview } from "./DraggableLabelPreview";
import { generateZpl, calculateDefaultPositions, getDefaultElementHeight } from "../utils/zebra";
import { isWebUSBSupported, getAlreadyPairedPrinters, requestUSBPrinter, sendZPLviaUSB, forgetUSBPrinter } from "../utils/webusb";
import { isRunningOnCloud, discoverBridgeUrl, fetchPrinters, sendPrintJob, recordPrint } from "../utils/printBridge";

// localStorage keys
const LAYOUT_STORAGE_KEY = 'zebra-label-layout';
const PRINTER_STORAGE_KEY = 'zebra-default-printer';

function loadSavedLayout(formatId: string): SavedLabelLayout | null {
  try {
    const raw = localStorage.getItem(`${LAYOUT_STORAGE_KEY}-${formatId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveLayout(formatId: string, layout: SavedLabelLayout) {
  try {
    localStorage.setItem(`${LAYOUT_STORAGE_KEY}-${formatId}`, JSON.stringify(layout));
  } catch {}
}

function loadDefaultPrinter(): string {
  try { return localStorage.getItem(PRINTER_STORAGE_KEY) || ''; } catch { return ''; }
}

function saveDefaultPrinter(name: string) {
  try { localStorage.setItem(PRINTER_STORAGE_KEY, name); } catch {}
}

interface PrintModalProps {
  product: Product;
  labelFormats: LabelFormat[];
  activeFormatId: string;
  theme: 'dark' | 'light' | 'glass';
  onChangeTheme: (theme: 'dark' | 'light' | 'glass') => void;
  onClose: () => void;
  onShowToast?: (message: string, type: 'success' | 'error') => void;
}

export function PrintModal({
  product,
  labelFormats,
  activeFormatId: initialFormatId,
  theme,
  onChangeTheme,
  onClose,
  onShowToast,
}: PrintModalProps) {
  const [activeFormatId, setActiveFormatId] = useState(initialFormatId);

  const themeBg = 
    theme === 'dark' ? 'bg-slate-900 text-slate-100 border border-slate-800 shadow-2xl' :
    theme === 'glass' ? 'bg-slate-950/75 backdrop-blur-md text-slate-100 border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]' :
    'bg-slate-50 text-slate-800 border border-slate-200 shadow-2xl';

  const col1Bg = 
    theme === 'dark' ? 'bg-slate-950/40 border-r border-slate-800' :
    theme === 'glass' ? 'bg-white/5 border-r border-white/5' :
    'bg-slate-100/70 border-r border-slate-200';

  const col2Bg = 
    theme === 'dark' ? 'bg-slate-900/60' :
    theme === 'glass' ? 'bg-white/10' :
    'bg-white';

  const col3Bg = 
    theme === 'dark' ? 'bg-slate-950 border-t border-slate-900' :
    theme === 'glass' ? 'bg-black/40 border-t border-white/5' :
    'bg-slate-800 border-t border-slate-200 text-white';

  const inputClass = theme === 'light'
    ? "w-full rounded-md border border-slate-300 bg-white shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-slate-800 outline-none cursor-pointer"
    : "w-full rounded-md border border-slate-700 bg-slate-800 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer";

  const baseLabelFormat =
    labelFormats.find((f) => f.id === activeFormatId) || labelFormats[0];

  // Load saved layout for current format, or use defaults
  const savedLayout = loadSavedLayout(activeFormatId);

  const [selectedParts, setSelectedParts] = useState(() =>
    savedLayout?.selectedParts ?? {
      name: baseLabelFormat?.showName ?? true,
      sku: baseLabelFormat?.showSku ?? true,
      ean13: baseLabelFormat?.showEan13 ?? true,
      dun14: baseLabelFormat?.showDun14 ?? true,
    }
  );

  const [quantity, setQuantity] = useState(1);

  // Sync when activeFormatId changes — load saved or defaults
  useEffect(() => {
    const saved = loadSavedLayout(activeFormatId);
    if (saved) {
      setSelectedParts(saved.selectedParts);
      setElementPositions(saved.positions);
      setIsCustomPositions(true);
    } else if (baseLabelFormat) {
      setSelectedParts({
        name: baseLabelFormat.showName,
        sku: baseLabelFormat.showSku,
        ean13: baseLabelFormat.showEan13,
        dun14: baseLabelFormat.showDun14,
      });
      setElementPositions(calculateDefaultPositions(currentFormatForCalc, product));
      setIsCustomPositions(false);
    }
  }, [activeFormatId]);

  const [copied, setCopied] = useState(false);
  const [systemPrinters, setSystemPrinters] = useState<{Name: string; PortName: string; DriverName: string}[]>([]);
  const [selectedSystemPrinter, setSelectedSystemPrinter] = useState<string>('');
  const [usbPrinting, setUsbPrinting] = useState(false);
  const [layoutSaved, setLayoutSaved] = useState(!!savedLayout);

  // Print Bridge state
  const [localBridgeAvailable, setLocalBridgeAvailable] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(null);
  const [onCloud] = useState(isRunningOnCloud());

  // WebUSB state (last resort fallback)
  const [webUsbDevice, setWebUsbDevice] = useState<USBDevice | null>(null);
  const [webUsbSupported] = useState(isWebUSBSupported());
  const [useWebUsb, setUseWebUsb] = useState(false);

  const currentFormat = {
    ...baseLabelFormat,
    showName: selectedParts.name,
    showSku: selectedParts.sku,
    showEan13: selectedParts.ean13,
    showDun14: selectedParts.dun14,
  };

  // For internal calculation where we don't want circular deps
  const currentFormatForCalc = {
    ...baseLabelFormat,
    showName: true, showSku: true, showEan13: true, showDun14: true,
  };

  const [elementPositions, setElementPositions] = useState<ElementPosition[]>(() =>
    savedLayout?.positions ?? calculateDefaultPositions(currentFormat, product)
  );
  const [isCustomPositions, setIsCustomPositions] = useState(!!savedLayout);

  // Recalculate default positions when selected parts change (only if not custom)
  useEffect(() => {
    if (!isCustomPositions) {
      setElementPositions(calculateDefaultPositions(currentFormat, product));
    }
  }, [selectedParts.name, selectedParts.sku, selectedParts.ean13, selectedParts.dun14, isCustomPositions]);

  const handlePositionsChange = (newPositions: ElementPosition[]) => {
    setElementPositions(newPositions);
    setIsCustomPositions(true);
    setLayoutSaved(false);
  };

  const handleResetPositions = () => {
    setElementPositions(calculateDefaultPositions(currentFormat, product));
    setIsCustomPositions(false);
    setLayoutSaved(false);
    // Remove saved layout
    try { localStorage.removeItem(`${LAYOUT_STORAGE_KEY}-${activeFormatId}`); } catch {}
  };

  const handleSaveLayout = () => {
    const layout: SavedLabelLayout = {
      positions: elementPositions,
      selectedParts,
    };
    saveLayout(activeFormatId, layout);
    setLayoutSaved(true);
    onShowToast?.('✅ Diseño guardado como predeterminado', 'success');
  };

  // Font size controls for name element
  const namePosition = elementPositions.find(p => p.id === 'name');
  const currentFontSize = namePosition?.fontSize || 3;

  const changeFontSize = (delta: number) => {
    const newSize = Math.max(1.5, Math.min(8, currentFontSize + delta));
    const newPositions = elementPositions.map(p =>
      p.id === 'name' ? { ...p, fontSize: Math.round(newSize * 10) / 10 } : p
    );
    setElementPositions(newPositions);
    setIsCustomPositions(true);
    setLayoutSaved(false);
  };

  useEffect(() => {
    const savedPrinter = loadDefaultPrinter();

    const loadPrinters = async () => {
      let discoveredUrl: string | null = null;
      if (onCloud) {
        discoveredUrl = await discoverBridgeUrl();
        setBridgeUrl(discoveredUrl);
        setLocalBridgeAvailable(!!discoveredUrl);
      }

      const printers = await fetchPrinters(!!discoveredUrl, discoveredUrl);
      setSystemPrinters(printers);

      if (printers.length > 0) {
        if (savedPrinter && printers.some(p => p.Name === savedPrinter)) {
          setSelectedSystemPrinter(savedPrinter);
        } else {
          const zebra = printers.find(p => p.DriverName?.toLowerCase().includes('zebra') || p.Name?.toLowerCase().includes('zebra'));
          if (zebra) setSelectedSystemPrinter(zebra.Name);
          else setSelectedSystemPrinter(printers[0].Name);
        }
      } else if (onCloud && !discoveredUrl && webUsbSupported) {
        setUseWebUsb(true);
        const paired = await getAlreadyPairedPrinters();
        if (paired.length > 0) setWebUsbDevice(paired[0]);
      }
    };

    loadPrinters();
  }, []);

  // Save printer as default when changed
  const handlePrinterChange = (name: string) => {
    setSelectedSystemPrinter(name);
    saveDefaultPrinter(name);
  };

  const cols = currentFormat.labelsPerRow || 1;
  const calculatedRows = Math.ceil(quantity / cols);
  const totalPhysicalLabels = calculatedRows * cols;
  const isExactMultiple = quantity % cols === 0;

  // Generate ZPL
  let zplCode = generateZpl(
    product.sku,
    product.item_name,
    product.ean13,
    product.dun14,
    currentFormat,
    elementPositions,
    totalPhysicalLabels,
  );

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
    if (useWebUsb) {
      if (!webUsbDevice) { onShowToast?.('Conecta una impresora USB primero', 'error'); return; }
      setUsbPrinting(true);
      try {
        await sendZPLviaUSB(webUsbDevice, zplCode);
        onShowToast?.(`✅ ZPL enviado a ${webUsbDevice.productName || 'impresora USB'} vía WebUSB`, 'success');
      } catch (e: any) {
        onShowToast?.(e.message || 'Error WebUSB', 'error');
        setWebUsbDevice(null);
      } finally { setUsbPrinting(false); }
    } else {
      if (!selectedSystemPrinter) { onShowToast?.('Selecciona una impresora del sistema', 'error'); return; }
      setUsbPrinting(true);
      const result = await sendPrintJob(zplCode, selectedSystemPrinter, localBridgeAvailable, bridgeUrl);
      recordPrint({
        productName: product.item_name,
        productSku: product.sku,
        printerName: selectedSystemPrinter,
        mode: isRunningOnCloud() ? 'cloud' : 'local',
        copies: quantity,
        status: result.ok ? 'success' : 'error',
        details: result.ok ? undefined : result.message,
      });
      if (result.ok) onShowToast?.(`✅ ${result.message}`, 'success');
      else onShowToast?.(result.message, 'error');
      setUsbPrinting(false);
    }
  };

  const handleConnectWebUsb = async () => {
    try {
      const device = await requestUSBPrinter();
      if (device) {
        setWebUsbDevice(device);
        onShowToast?.(`✅ Conectada: ${device.productName || 'Impresora USB'}`, 'success');
      }
    } catch (e: any) { onShowToast?.(e.message || 'Error al conectar', 'error'); }
  };

  const handleDisconnectWebUsb = async () => {
    await forgetUSBPrinter();
    setWebUsbDevice(null);
  };

  const handleToggleElement = (elementId: 'name' | 'sku' | 'ean13' | 'dun14') => {
    const isChecking = !selectedParts[elementId];
    setSelectedParts(prev => ({ ...prev, [elementId]: isChecking }));
    setLayoutSaved(false);

    if (isChecking) {
      const hasPos = elementPositions.some(p => p.id === elementId);
      if (!hasPos) {
        const h = getDefaultElementHeight(elementId, currentFormat);
        // Find bottom-most position of existing active elements
        let maxY = currentFormat.marginTop;
        const visiblePos = elementPositions.filter(p => {
          if (p.id === 'name') return selectedParts.name;
          if (p.id === 'sku') return selectedParts.sku;
          if (p.id === 'ean13') return selectedParts.ean13;
          if (p.id === 'dun14') return selectedParts.dun14;
          return false;
        });

        for (const pos of visiblePos) {
          const bottom = pos.y + pos.h;
          if (bottom > maxY) {
            maxY = bottom;
          }
        }

        const gap = 1;
        const newY = maxY + gap;
        
        // Clamp Y so it doesn't go off the bottom of the label
        const clampedY = Math.min(currentFormat.height - h, newY);

        setElementPositions(prev => [
          ...prev,
          { id: elementId, x: 0, y: Math.round(clampedY * 10) / 10, h }
        ]);
      }
    }
  };
  // Element definitions
  const elementDefs = [
    { id: 'name' as const, label: 'Nombre', value: product.item_name, available: true },
    { id: 'sku' as const, label: 'SKU (Code 128)', value: product.sku, available: true },
    { id: 'ean13' as const, label: 'EAN 13', value: product.ean13 || '', available: !!product.ean13 },
    { id: 'dun14' as const, label: 'DUN 14', value: product.dun14 || '', available: !!product.dun14 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm print:hidden">
      <div className={`rounded-xl overflow-hidden flex flex-col max-h-[92vh] mx-4 w-full max-w-5xl ${themeBg}`}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-700/50 flex justify-between items-center bg-gradient-to-r from-slate-800 to-slate-900">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white tracking-wide">
              Imprimir: {product.sku}
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{product.item_name}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-700/60 p-0.5 rounded-lg border border-slate-600/40">
              {(['dark', 'light', 'glass'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    onChangeTheme(t);
                    localStorage.setItem('tracelabel-theme', t);
                  }}
                  className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase transition-all cursor-pointer ${
                    theme === t
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700/40'
                  }`}
                >
                  {t === 'glass' ? 'Vidrio' : t === 'dark' ? 'Oscuro' : 'Claro'}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 flex-shrink-0 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12">

            {/* Column 1: Elements */}
            <div className={`lg:col-span-4 p-4 flex flex-col ${col1Bg}`}>
              <h3 className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>
                Elementos
              </h3>

              <div className="space-y-1.5">
                {elementDefs.filter(e => e.available).map(el => {
                  const checked = selectedParts[el.id];
                  const isName = el.id === 'name';
                  const itemClass = checked
                    ? (theme === 'light' ? 'bg-blue-50 border-blue-200 text-slate-800 shadow-sm font-semibold' : 'bg-blue-600/20 border-blue-500/30 text-blue-450')
                    : (theme === 'light' ? 'bg-white border-slate-200 text-slate-500 opacity-60 hover:opacity-100' : 'bg-slate-800/20 border-slate-700/30 text-slate-400 opacity-60 hover:opacity-100');

                  return (
                    <div key={el.id}>
                      <button
                        onClick={() => handleToggleElement(el.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all duration-150 border cursor-pointer ${itemClass}`}
                      >
                        <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold transition-colors ${
                          checked ? 'bg-blue-500 text-white' : (theme === 'light' ? 'bg-slate-200 text-slate-400' : 'bg-slate-850 text-slate-650')
                        }`}>
                          <span>{checked ? '✓' : '\u00A0'}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`text-[9px] font-semibold uppercase tracking-wide leading-none mb-0.5 ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>
                            {el.label}
                          </div>
                          <div className="text-[11px] font-medium truncate">
                            {el.value}
                          </div>
                        </div>
                        {isName ? <Type className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                          : <Barcode className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />}
                      </button>

                      {/* Font size control for name */}
                      {isName && checked && (
                        <div className={`mt-1 ml-7 flex items-center gap-2 px-2 py-1.5 rounded-md border ${
                          theme === 'light' ? 'bg-white border-slate-200 text-slate-700' : 'bg-slate-800/40 border-slate-800/60 text-slate-300'
                        }`}>
                          <span className={`text-[8px] font-medium uppercase tracking-wide ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>Fuente</span>
                          <div className="flex items-center gap-1 ml-auto">
                            <button
                              onClick={() => changeFontSize(-0.5)}
                              className={`w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer ${
                                theme === 'light' ? 'bg-slate-100 hover:bg-slate-200 text-slate-650' : 'bg-slate-700 hover:bg-slate-600 text-slate-250'
                              }`}
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-[11px] font-bold w-8 text-center tabular-nums">
                              {currentFontSize.toFixed(1)}
                            </span>
                            <button
                              onClick={() => changeFontSize(0.5)}
                              className={`w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer ${
                                theme === 'light' ? 'bg-slate-100 hover:bg-slate-200 text-slate-650' : 'bg-slate-700 hover:bg-slate-600 text-slate-250'
                              }`}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                            <span className="text-[8px] opacity-50 ml-0.5">mm</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Save / Reset buttons */}
              <div className="mt-auto pt-3 space-y-1.5">
                  {isCustomPositions && (
                    <div className="space-y-1.5">
                      <button
                        onClick={handleSaveLayout}
                        className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                          layoutSaved
                            ? 'text-emerald-600 bg-emerald-50/10 border border-emerald-500/20'
                            : 'text-white bg-blue-600 hover:bg-blue-500 border border-blue-500 shadow-sm'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          {layoutSaved
                            ? <><Check className="w-3 h-3" /><span>Guardado ✓</span></>
                            : <><Save className="w-3 h-3" /><span>Guardar diseño</span></>
                          }
                        </span>
                      </button>
                      <button
                        onClick={handleResetPositions}
                        className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium border rounded-lg transition-colors cursor-pointer ${
                          theme === 'light'
                            ? 'text-slate-550 hover:text-slate-700 bg-white border-slate-200 hover:bg-slate-50'
                            : 'text-slate-400 hover:text-slate-200 bg-slate-800/40 border-slate-850 hover:bg-slate-800'
                        }`}
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Restablecer</span>
                      </button>
                    </div>
                  )}
              </div>
            </div>

            {/* Column 2: Label Preview */}
            <div className={`lg:col-span-8 p-4 flex flex-col items-center justify-center ${col2Bg}`}>
              <div className={`text-[10px] font-bold uppercase tracking-widest mb-3 opacity-60 self-start ${theme === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>
                Vista Previa (arrastra · borde inferior redimensiona)
              </div>
              <div className="flex-1 w-full h-full flex items-center justify-center">
                <DraggableLabelPreview
                  format={currentFormat}
                  product={product}
                  positions={elementPositions}
                  onPositionsChange={handlePositionsChange}
                  selectedParts={selectedParts}
                />
              </div>
            </div>

          </div>
        </div>

        {/* ── BOTTOM ROW: full-width print console ── */}
        <div className={`p-4 flex-shrink-0 border-t ${col3Bg}`}>
          <div className="flex items-center gap-2 mb-3">
            <Code className={`w-3.5 h-3.5 ${theme === 'light' ? 'text-blue-600' : 'text-blue-400'}`} />
            <h3 className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'light' ? 'text-slate-550 font-bold' : 'text-slate-400'}`}>
              Consola de Impresión
            </h3>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
            {/* Format selector */}
            <div>
              <label htmlFor="print-format" className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>Formato</label>
              <select
                id="print-format"
                aria-label="Formato de etiqueta"
                className={inputClass}
                value={activeFormatId}
                onChange={(e) => setActiveFormatId(e.target.value)}
              >
                {labelFormats.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {/* Quantity selector */}
            <div>
              <label htmlFor="print-copies" className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>¿Cuántas etiquetas desea imprimir?</label>
              <input
                id="print-copies"
                aria-label="Cantidad de copias"
                type="number" min="1" max="999"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className={inputClass}
              />
              {cols > 1 && (
                <div className="mt-1.5 text-[9px] leading-snug">
                  {isExactMultiple ? (
                    <span className="text-emerald-500 font-medium">✅ Equivale exactamente a {calculatedRows} {calculatedRows === 1 ? 'fila completa' : 'filas completas'}.</span>
                  ) : (
                    <span className={theme === 'light' ? 'text-slate-500' : 'text-slate-400'}>
                      💡 Se imprimirán {calculatedRows} filas (= {totalPhysicalLabels} etiquetas en total) para cubrir las {quantity} solicitadas. <strong className={theme === 'light' ? 'text-blue-600' : 'text-blue-400'}>Te sugerimos imprimir {totalPhysicalLabels} para no desperdiciar la fila completa.</strong>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Printer selector */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="print-printer" className={`text-[10px] font-semibold uppercase tracking-wider ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>Impresora</label>
                {useWebUsb ? (
                  <span className="text-[9px] text-blue-400 font-medium flex items-center gap-1">
                    <Usb className="w-3 h-3" /> WebUSB
                  </span>
                ) : (
                  selectedSystemPrinter === loadDefaultPrinter() && systemPrinters.length > 0 && (
                    <span className="text-[9px] text-emerald-400 font-medium">★ predeterminada</span>
                  )
                )}
              </div>
              {useWebUsb ? (
                webUsbDevice ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-md border border-emerald-600 bg-emerald-900/30 text-sm p-2 text-emerald-300 flex items-center gap-2">
                      <Usb className="w-4 h-4" />
                      <span className="truncate">{webUsbDevice.productName || 'Impresora USB'}</span>
                    </div>
                    <button onClick={handleDisconnectWebUsb} className="p-2 rounded-md border border-slate-700 bg-slate-800 hover:bg-red-700 text-slate-400 hover:text-white transition-colors cursor-pointer" title="Desconectar">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button onClick={handleConnectWebUsb}
                    className="w-full rounded-md border-2 border-dashed border-blue-500 bg-blue-900/20 hover:bg-blue-900/40 text-sm p-2.5 text-blue-300 hover:text-blue-200 transition-colors flex items-center justify-center gap-2 cursor-pointer">
                    <Usb className="w-4 h-4" />
                    <span>Conectar Impresora USB</span>
                  </button>
                )
              ) : (
                systemPrinters.length > 0 ? (
                  <select
                    id="print-printer"
                    aria-label="Seleccionar impresora"
                    className={inputClass}
                    value={selectedSystemPrinter}
                    onChange={(e) => handlePrinterChange(e.target.value)}
                  >
                    {systemPrinters.map((p) => (
                      <option key={p.Name} value={p.Name}>
                        {p.Name} ({p.PortName})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className={`w-full rounded-md border text-sm p-2 italic ${
                    theme === 'light' ? 'border-slate-350 bg-slate-200 text-slate-500' : 'border-slate-800 bg-slate-900/40 text-slate-500'
                  }`}>Sin impresoras detectadas</div>
                )
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mt-3 items-end">
            {/* Buttons */}
            <div className="lg:col-span-4 flex flex-col gap-1.5 font-bold">
              <button
                onClick={handleUsbSystemPrint}
                disabled={usbPrinting || (useWebUsb ? !webUsbDevice : !selectedSystemPrinter)}
                className="w-full flex items-center justify-center px-4 py-2.5 outline-none rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors border border-emerald-500 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Printer className="w-4 h-4 mr-2" />
                <span>{usbPrinting ? 'Enviando...' : '🖨️ Imprimir Etiqueta'}</span>
              </button>
              <button
                onClick={handleDownloadZPL}
                className={`w-full flex items-center justify-center px-3 py-1.5 outline-none rounded-md font-medium text-[11px] transition-colors border cursor-pointer ${
                  theme === 'light'
                    ? 'bg-slate-200 hover:bg-slate-300 text-slate-700 border-slate-300'
                    : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border-slate-700'
                }`}
              >
                <Download className="w-3 h-3 mr-1.5" />
                Descargar .ZPL
              </button>
            </div>

            {/* ZPL Code */}
            <div className="lg:col-span-8 bg-slate-950 border border-slate-900 rounded-md p-2 overflow-hidden relative group max-h-[90px] h-[90px]">
              <pre className="text-[8px] text-emerald-400 font-mono whitespace-pre-wrap break-all h-full overflow-y-auto custom-scrollbar leading-relaxed">
                {zplCode}
              </pre>
              <button
                onClick={handleCopyZpl}
                className="absolute top-1 right-1 p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                title="Copiar ZPL"
              >
                {copied
                  ? <Check className="w-3 h-3 text-green-400" />
                  : <Copy className="w-3 h-3" />
                }
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`px-5 py-2.5 border-t flex justify-between items-center ${
          theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-slate-950/60 border-slate-800'
        }`}>
          <div className="text-[10px]">
            {layoutSaved && <span className="text-emerald-500 font-medium">✓ Diseño guardado</span>}
          </div>
          <button
            onClick={onClose}
            className={`px-4 py-1.5 text-sm font-medium border rounded-md transition-colors shadow-sm cursor-pointer ${
              theme === 'light'
                ? 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50'
                : 'text-slate-300 bg-slate-800 border-slate-700 hover:bg-slate-700'
            }`}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
