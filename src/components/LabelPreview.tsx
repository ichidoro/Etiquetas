import React, { useRef, useState, useEffect } from "react";
import { LabelFormat } from "../types";

interface LabelPreviewProps {
  format: LabelFormat;
}

export function LabelPreview({ format }: LabelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(3);

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
        {/* Contenedor que simula el rollo gris continuo */}
        <div
          className="bg-[#e0e0e0] relative shadow-inner overflow-hidden border-y border-slate-300 flex items-center justify-center"
          style={{ width: `${paperWidthPx}px`, minHeight: `${Math.max(200, paperHeightPx + 40)}px` }}
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
                    className="bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] rounded-sm border border-slate-200 flex items-center justify-center relative"
                    style={{
                      width: `${format.width * scale}px`,
                      height: `${format.height * scale}px`,
                    }}
                  >
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
    </div>
  );
}
