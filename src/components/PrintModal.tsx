import React, { useState, useEffect, useCallback } from "react";
import { X, Printer, Code, Copy, Check, Download, RotateCcw, Type, Barcode, Save, Minus, Plus, Usb, Wifi, WifiOff } from "lucide-react";
import { Product, LabelFormat, ElementPosition, SavedLabelLayout } from "../types";
import { DraggableLabelPreview } from "./DraggableLabelPreview";
import { generateZpl, calculateDefaultPositions, generateCalibrationZpl } from "../utils/zebra";
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

  // Generate ZPL
  let zplCode = generateZpl(
    product.sku,
    product.item_name,
    product.ean13,
    product.dun14,
    currentFormat,
    elementPositions,
    quantity,
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
        mode: bridgeUrl === 'CLOUD_QUEUE' ? 'cloud' : 'local',
        copies: copies,
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

  // Element definitions
  const elementDefs = [
    { id: 'name' as const, label: 'Nombre', value: product.item_name, available: true },
    { id: 'sku' as const, label: 'SKU (Code 128)', value: product.sku, available: true },
    { id: 'ean13' as const, label: 'EAN 13', value: product.ean13 || '', available: !!product.ean13 },
    { id: 'dun14' as const, label: 'DUN 14', value: product.dun14 || '', available: !!product.dun14 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm print:hidden">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh] mx-4">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-gradient-to-r from-slate-800 to-slate-900">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white tracking-wide">
              Imprimir: {product.sku}
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{product.item_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[400px]">

            {/* Column 1: Elements */}
            <div className="lg:col-span-3 border-r border-slate-100 p-4 bg-slate-50/70 flex flex-col">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                Elementos
              </h3>

              <div className="space-y-1.5">
                {elementDefs.filter(e => e.available).map(el => {
                  const checked = selectedParts[el.id];
                  const isName = el.id === 'name';
                  return (
                    <div key={el.id}>
                      <button
                        onClick={() => {
                          setSelectedParts(prev => ({ ...prev, [el.id]: !prev[el.id] }));
                          setLayoutSaved(false);
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all duration-150 ${
                          checked
                            ? 'bg-blue-50 border border-blue-200 shadow-sm'
                            : 'bg-white border border-slate-200 opacity-50 hover:opacity-80'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold transition-colors ${
                          checked ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-400'
                        }`}>
                          <span>{checked ? '✓' : '\u00A0'}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide leading-none mb-0.5">
                            {el.label}
                          </div>
                          <div className="text-[11px] text-slate-700 font-medium truncate">
                            {el.value}
                          </div>
                        </div>
                        {isName ? <Type className={`w-3.5 h-3.5 flex-shrink-0 ${checked ? 'text-blue-400' : 'text-slate-300'}`} />
                          : <Barcode className={`w-3.5 h-3.5 flex-shrink-0 ${checked ? 'text-blue-400' : 'text-slate-300'}`} />}
                      </button>

                      {/* Font size control for name */}
                      {isName && checked && (
                        <div className="mt-1 ml-7 flex items-center gap-2 px-2 py-1.5 bg-white rounded-md border border-slate-200">
                          <span className="text-[9px] text-slate-400 font-medium uppercase tracking-wide">Fuente</span>
                          <div className="flex items-center gap-1 ml-auto">
                            <button
                              onClick={() => changeFontSize(-0.5)}
                              className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-[11px] font-bold text-slate-700 w-8 text-center tabular-nums">
                              {currentFontSize.toFixed(1)}
                            </span>
                            <button
                              onClick={() => changeFontSize(0.5)}
                              className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                            <span className="text-[8px] text-slate-400 ml-0.5">mm</span>
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
                        className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-lg transition-colors ${
                          layoutSaved
                            ? 'text-emerald-600 bg-emerald-50 border border-emerald-200'
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
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-slate-500 hover:text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Restablecer</span>
                      </button>
                    </div>
                  )}
              </div>
            </div>

            {/* Column 2: Label Preview */}
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
                <Code className="w-3.5 h-3.5 text-blue-400" />
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Consola de Impresión
                </h3>
              </div>

              <div className="space-y-2.5 mb-3">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Formato</label>
                  <select
                    className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none cursor-pointer"
                    value={activeFormatId}
                    onChange={(e) => setActiveFormatId(e.target.value)}
                  >
                    {labelFormats.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Etiquetas</label>
                  <input
                    type="number" min="1" max="999"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-600 bg-slate-700 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm p-2 text-white outline-none font-semibold"
                  />
                </div>
              </div>

              {/* Printer — with WebUSB fallback */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Impresora</label>
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
                      <button onClick={handleDisconnectWebUsb} className="p-2 rounded-md border border-slate-600 bg-slate-700 hover:bg-red-700 text-slate-400 hover:text-white transition-colors" title="Desconectar">
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
                  ) : (
                    <div className="w-full rounded-md border border-slate-600 bg-slate-700 text-sm p-2 text-slate-500 italic">Sin impresoras detectadas</div>
                  )
                )}
              </div>

              {/* Print button */}
              <div className="space-y-2 mb-3">
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
                  className="w-full flex items-center justify-center px-3 py-1.5 outline-none rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-[11px] transition-colors border border-slate-600 cursor-pointer"
                >
                  <Download className="w-3 h-3 mr-1.5" />
                  Descargar .ZPL
                </button>
                <button
                  onClick={async () => {
                    const calZpl = generateCalibrationZpl(currentFormat);
                    if (selectedSystemPrinter) {
                      try {
                        await sendPrintJob(calZpl, selectedSystemPrinter, localBridgeAvailable, bridgeUrl);
                        onShowToast?.('Test de calibración enviado', 'success');
                      } catch {
                        onShowToast?.('Error al enviar calibración', 'error');
                      }
                    } else {
                      const blob = new Blob([calZpl], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `calibracion_${currentFormat.width}x${currentFormat.height}.zpl`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }
                  }}
                  disabled={usbPrinting}
                  className="w-full flex items-center justify-center px-3 py-1.5 outline-none rounded-md bg-amber-700 hover:bg-amber-600 text-amber-100 font-medium text-[11px] transition-colors border border-amber-600 cursor-pointer disabled:opacity-50"
                >
                  📏 Test de Calibración (regla)
                </button>
              </div>

              {/* ZPL Code */}
              <div className="flex-1 bg-slate-950 border border-slate-900 rounded-md p-2 overflow-hidden relative group min-h-[80px]">
                <pre className="text-[8px] text-emerald-400 font-mono whitespace-pre-wrap break-all h-full overflow-y-auto custom-scrollbar leading-relaxed">
                  {zplCode}
                </pre>
                <button
                  onClick={handleCopyZpl}
                  className="absolute top-1 right-1 p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title="Copiar ZPL"
                >
                  {copied
                    ? <Check className="w-3 h-3 text-green-400" />
                    : <Copy className="w-3 h-3" />
                  }
                </button>
              </div>
              {copied && <p className="text-[10px] text-green-400 mt-0.5 text-right font-medium">¡Copiado!</p>}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          <div className="text-[10px] text-slate-400">
            {layoutSaved && <span className="text-emerald-500 font-medium">✓ Diseño guardado</span>}
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
