import React, { useRef, useState, useEffect } from "react";
import { LabelFormat } from "../types";
import { generateCalibrationZpl } from "../utils/zebra";
import { isRunningOnCloud, discoverBridgeUrl, fetchPrinters, sendPrintJob } from "../utils/printBridge";
import { Printer, Ruler, Loader2 } from "lucide-react";

interface LabelPreviewProps {
  format: LabelFormat;
  onShowToast?: (message: string, type: "success" | "error") => void;
}

export function LabelPreview({ format, onShowToast }: LabelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(3);

  const [printers, setPrinters] = useState<{ Name: string; DriverName: string; _bridgeHost?: string }[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [localBridgeAvailable, setLocalBridgeAvailable] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    async function loadPrinters(isBackground = false) {
      if (!isBackground) setLoadingPrinters(true);
      try {
        const onCloud = isRunningOnCloud();
        let discoveredUrl: string | null = null;
        if (onCloud) {
          discoveredUrl = await discoverBridgeUrl();
          if (!isMounted) return;
          setBridgeUrl(discoveredUrl);
          setLocalBridgeAvailable(!!discoveredUrl);
        }

        const data = await fetchPrinters(!!discoveredUrl, discoveredUrl);
        if (!isMounted) return;
        setPrinters(data);
        
        if (data.length > 0) {
          const savedPrinter = localStorage.getItem('zebra-default-printer');
          setSelectedPrinter(current => {
            // Keep current selection if it is still online
            if (current && data.some(p => p.Name === current)) {
              return current;
            }
            // Otherwise fallback to saved default
            if (savedPrinter && data.some(p => p.Name === savedPrinter)) {
              return savedPrinter;
            }
            // Or find any Zebra
            const zebra = data.find(p => p.DriverName?.toLowerCase().includes('zebra') || p.Name?.toLowerCase().includes('zebra'));
            return zebra ? zebra.Name : data[0].Name;
          });
        }
      } catch (err) {
        console.error("Error loading printers", err);
      } finally {
        if (isMounted && !isBackground) setLoadingPrinters(false);
      }
    }
    
    loadPrinters(false);

    const interval = setInterval(() => {
      loadPrinters(true);
    }, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [format.id]);

  const handleCalibrationPrint = async () => {
    if (!selectedPrinter) {
      onShowToast?.("Selecciona una impresora", "error");
      return;
    }
    setPrinting(true);
    try {
      const calZpl = generateCalibrationZpl(format);
      const result = await sendPrintJob(calZpl, selectedPrinter, localBridgeAvailable, bridgeUrl);
      if (result.ok) {
        onShowToast?.("Test de calibración enviado", "success");
      } else {
        onShowToast?.("Error: " + (result.message || "No se pudo enviar"), "error");
      }
    } catch (err: any) {
      onShowToast?.("Error al conectar con la impresora: " + err.message, "error");
    } finally {
      setPrinting(false);
    }
  };

  // Calcular dimensiones totales del "papel" de respaldo (backing) en mm
  const paperWidthMm =
    format.marginLeft +
    format.labelsPerRow * format.width +
    Math.max(0, format.labelsPerRow - 1) * format.horizontalGap +
    format.marginRight;

  const paperHeightMm =
    format.marginTop +
    format.labelsPerColumn * format.height +
    Math.max(0, format.labelsPerColumn - 1) * format.verticalGap +
    format.marginBottom;

  useEffect(() => {
    if (!containerRef.current || paperWidthMm === 0) return;
    const observer = new ResizeObserver((entries) => {
      const containerWidth = entries[0].contentRect.width;
      const containerHeight = entries[0].contentRect.height;
      // Queremos que el rollo ocupe al menos el 80% del contenedor sin pasarse (tanto en ancho como en alto)
      const scaleByWidth = (containerWidth * 0.8) / paperWidthMm;
      const scaleByHeight = (containerHeight * 0.8) / (paperHeightMm || 1);
      
      // Aseguramos un mínimo de 1.5 y un máximo de 8 para la escala
      setScale(Math.max(1.5, Math.min(scaleByWidth, scaleByHeight, 8)));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [paperWidthMm]);

  // Convertir a píxeles para el renderizado
  const paperWidthPx = paperWidthMm * scale;
  const paperHeightPx = paperHeightMm * scale;

  return (
    <div className="bg-slate-100 rounded-lg p-6 border border-slate-200 flex flex-col items-center justify-center">
      <h3 className="text-sm font-semibold text-slate-700 mb-6 w-full text-center">
        Vista Previa de Disposición
      </h3>

      <div 
        ref={containerRef}
        className="w-full flex-1 flex items-center min-h-[500px] 2xl:min-h-[600px] justify-center overflow-auto"
      >
        {/* Ruler and Roll Wrapper */}
        <div className="relative" style={{
          paddingTop: '20px',
          paddingLeft: '20px',
          width: `${paperWidthPx + 20}px`,
          height: `${paperHeightPx + 20}px`,
        }}>
          {/* Horizontal Ruler (Top) */}
          <div className="absolute top-0 left-[20px] h-[20px] overflow-visible" style={{ width: `${paperWidthPx}px` }}>
            <svg width={paperWidthPx} height="20" className="overflow-visible select-none">
              {Array.from({ length: Math.ceil(paperWidthMm) + 1 }).map((_, mm) => {
                if (mm > paperWidthMm) return null;
                const x = mm * scale;
                let h = 3;
                let showLabel = false;
                if (mm % 5 === 0) { h = 8; showLabel = true; }
                return (
                  <g key={`h-tick-${mm}`}>
                    <line x1={x} y1={20} x2={x} y2={20 - h} stroke="#94a3b8" strokeWidth="1" />
                    {showLabel && (
                      <text x={x} y={9} textAnchor="middle" fontSize="7px" fill="#64748b" fontWeight="bold">{mm}</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Vertical Ruler (Left) */}
          <div className="absolute top-[20px] left-0 w-[20px] overflow-visible" style={{ height: `${paperHeightPx}px` }}>
            <svg width="20" height={paperHeightPx} className="overflow-visible select-none">
              {Array.from({ length: Math.ceil(paperHeightMm) + 1 }).map((_, mm) => {
                if (mm > paperHeightMm) return null;
                const y = mm * scale;
                let w = 3;
                let showLabel = false;
                if (mm % 5 === 0) { w = 8; showLabel = true; }
                return (
                  <g key={`v-tick-${mm}`}>
                    <line x1={20} y1={y} x2={20 - w} y2={y} stroke="#94a3b8" strokeWidth="1" />
                    {showLabel && (
                      <text x={9} y={y + 3} textAnchor="end" fontSize="7px" fill="#64748b" fontWeight="bold">{mm}</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Contenedor que simula el rollo gris continuo */}
          <div
            className="bg-[#e0e0e0] absolute shadow-inner overflow-hidden border border-slate-300 flex items-center justify-center rounded-sm"
            style={{ left: '20px', top: '20px', width: `${paperWidthPx}px`, height: `${paperHeightPx}px` }}
          >
            <div
              className="flex flex-col relative"
              style={{
                gap: `${format.verticalGap * scale}px`,
                paddingTop: `${format.marginTop * scale}px`,
                paddingBottom: `${format.marginBottom * scale}px`,
                paddingLeft: `${format.marginLeft * scale}px`,
                paddingRight: `${format.marginRight * scale}px`,
              }}
            >
              {Array.from({
                length: Math.min(5, Math.max(1, format.labelsPerColumn)),
              }).map((_, rowIndex) => (
                <div
                  key={rowIndex}
                  className="flex"
                  style={{ gap: `${format.horizontalGap * scale}px` }}
                >
                  {Array.from({
                    length: Math.min(10, Math.max(1, format.labelsPerRow)),
                  }).map((_, colIndex) => (
                    <div
                      key={colIndex}
                      className="bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] rounded-sm border border-slate-200 flex items-center justify-center relative overflow-hidden"
                      style={{
                        width: `${format.width * scale}px`,
                        height: `${format.height * scale}px`,
                      }}
                    >
                      {/* 5mm grid */}
                      <div className="absolute inset-0 pointer-events-none" style={{
                        backgroundImage: `
                          linear-gradient(to right, rgba(0,0,0,0.03) 1px, transparent 1px),
                          linear-gradient(to bottom, rgba(0,0,0,0.03) 1px, transparent 1px)
                        `,
                        backgroundSize: `${5 * scale}px ${5 * scale}px`,
                      }} />

                      {/* Contenido simbólico de la etiqueta */}
                      <div className="flex flex-col items-center justify-center space-y-1 opacity-20">
                        <div className="w-3/4 h-1 bg-black rounded"></div>
                        <div className="w-1/2 h-1 bg-black rounded"></div>
                        <div className="w-full px-2 mt-2">
                          <div className="w-full h-4 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjIwIj48cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIyMCIgZmlsbD0iIzAwMCIvPjwvc3ZnPg==')] bg-repeat-x"></div>
                        </div>
                      </div>

                      {/* Cotas (medidas) en la primera etiqueta */}
                      {rowIndex === 0 && colIndex === 0 && (
                        <div className="absolute inset-x-0 -bottom-5 text-[9px] text-center text-blue-600 font-medium whitespace-nowrap" style={{ fontSize: `${Math.max(9, scale * 2.5)}px`, bottom: `-${Math.max(16, scale * 5)}px` }}>
                          {format.width}mm
                        </div>
                      )}
                      {rowIndex === 0 && colIndex === 0 && (
                        <div className="absolute inset-y-0 -left-6 flex items-center justify-center text-[9px] text-blue-600 font-medium whitespace-nowrap -rotate-90" style={{ fontSize: `${Math.max(9, scale * 2.5)}px`, left: `-${Math.max(20, scale * 6)}px` }}>
                          {format.height}mm
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="w-full mt-6 bg-white p-3 rounded border border-slate-200 text-xs text-slate-600 space-y-1">
        <div className="flex justify-between">
          <span>Ancho total del rollo (aprox):</span>
          <span className="font-medium text-slate-800">
            {paperWidthMm.toFixed(1)} mm
          </span>
        </div>
        <div className="flex justify-between">
          <span>Columnas:</span>
          <span className="font-medium text-slate-800">
            {format.labelsPerRow}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Orientación configurada:</span>
          <span className="font-medium text-slate-800">
            {format.orientation === "N" ? "Normal" : "Rotada"}
          </span>
        </div>
      </div>

      {/* Centralized Calibration Test Panel */}
      <div className="w-full mt-4 bg-slate-50 border border-slate-200 p-4 rounded-lg flex flex-col gap-3 shadow-inner">
        <div className="flex items-center gap-2 text-slate-800 font-semibold border-b pb-2">
          <Ruler className="w-4 h-4 text-amber-600 animate-pulse" />
          <span>Central de Calibración Física</span>
        </div>
        
        <p className="text-[11px] text-slate-500 leading-normal">
          Usa este panel para calibrar físicamente las dimensiones y alineación del papel (punto 0,0) imprimiendo una regla patrón.
        </p>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="calibration-printer-select" className="sr-only">Seleccionar Impresora</label>
            <select
              id="calibration-printer-select"
              aria-label="Seleccionar Impresora"
              disabled={loadingPrinters || printing}
              value={selectedPrinter}
              onChange={(e) => {
                setSelectedPrinter(e.target.value);
                localStorage.setItem('zebra-default-printer', e.target.value);
              }}
              className="w-full text-xs rounded border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
            >
              {loadingPrinters ? (
                <option>Buscando impresoras...</option>
              ) : printers.length === 0 ? (
                <option value="">No se encontraron impresoras</option>
              ) : (
                printers.map((p) => (
                  <option key={p.Name} value={p.Name}>
                    {p.Name} {p._bridgeHost ? `(${p._bridgeHost})` : ""}
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            onClick={handleCalibrationPrint}
            disabled={printing || loadingPrinters || printers.length === 0}
            className="flex items-center justify-center gap-1.5 px-4 py-1.5 outline-none rounded bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-colors border border-amber-500 shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            title="Imprimir regla de calibración y bordes para calibrar el punto 0,0"
          >
            {printing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Imprimiendo...</span>
              </>
            ) : (
              <>
                <Printer className="w-3.5 h-3.5" />
                <span>📏 Imprimir Calibración</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
