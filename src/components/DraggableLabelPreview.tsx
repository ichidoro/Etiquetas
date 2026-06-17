import React, { useRef, useState, useCallback, useEffect } from 'react';
import { LabelFormat, ElementPosition } from '../types';
import { getDefaultElementHeight } from '../utils/zebra';
import JsBarcode from 'jsbarcode';

interface DraggableLabelPreviewProps {
  format: LabelFormat;
  product: { sku: string; item_name: string; ean13?: string; dun14?: string };
  positions: ElementPosition[];
  onPositionsChange: (positions: ElementPosition[]) => void;
  selectedParts: { name: boolean; sku: boolean; ean13: boolean; dun14: boolean };
}

export function DraggableLabelPreview({
  format,
  product,
  positions,
  onPositionsChange,
  selectedParts,
}: DraggableLabelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [interaction, setInteraction] = useState<{
    type: 'drag' | 'resize';
    elementId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Scale: pixels per mm
  const [scale, setScale] = useState(6);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      const h = entries[0].contentRect.height;
      const sx = (w - 40) / format.width;
      const sy = (h - 40) / format.height;
      setScale(Math.max(3, Math.min(sx, sy, 14)));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [format.width, format.height]);

  const mmToPx = (mm: number) => mm * scale;

  // Visible elements
  const visibleElements = positions.filter(p => {
    if (p.id === 'name') return selectedParts.name && product.item_name;
    if (p.id === 'sku') return selectedParts.sku && product.sku;
    if (p.id === 'ean13') return selectedParts.ean13 && product.ean13;
    if (p.id === 'dun14') return selectedParts.dun14 && product.dun14;
    return false;
  });

  const handleMouseDown = useCallback((e: React.MouseEvent, elementId: string, type: 'drag' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    const el = (type === 'drag' ? e.currentTarget : e.currentTarget.parentElement) as HTMLElement;
    const rect = el.getBoundingClientRect();
    setInteraction({
      type,
      elementId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!interaction || !labelRef.current) return;
    const labelRect = labelRef.current.getBoundingClientRect();
    const pos = positions.find(p => p.id === interaction.elementId);
    if (!pos) return;

    if (interaction.type === 'drag') {
      // Calculate X as offset from centered base position
      const elementWidthMm = format.width * 0.85;
      const baseCenterMm = (format.width - elementWidthMm) / 2;
      const rawXMm = (e.clientX - labelRect.left - interaction.offsetX) / scale;
      const newX = rawXMm - baseCenterMm; // offset from center (0 = centered)
      const newY = (e.clientY - labelRect.top - interaction.offsetY) / scale;
      // Allow generous range: half the label width in either direction
      const maxOffset = format.width / 2;
      const clampedX = Math.max(-maxOffset, Math.min(newX, maxOffset));
      const clampedY = Math.max(-2, Math.min(newY, format.height - pos.h));
      const newPositions = positions.map(p =>
        p.id === interaction.elementId
          ? { ...p, x: Math.round(clampedX * 10) / 10, y: Math.round(clampedY * 10) / 10 }
          : p
      );
      onPositionsChange(newPositions);
    } else {
      // Resize — only change height
      const newBottomY = (e.clientY - labelRect.top) / scale;
      const newH = newBottomY - pos.y;
      const minH = pos.id === 'name' ? 2 : 4;
      const maxH = format.height - pos.y;
      const clampedH = Math.max(minH, Math.min(newH, maxH));
      const newPositions = positions.map(p =>
        p.id === interaction.elementId
          ? { ...p, h: Math.round(clampedH * 10) / 10 }
          : p
      );
      onPositionsChange(newPositions);
    }
  }, [interaction, scale, positions, format, onPositionsChange]);

  const handleMouseUp = useCallback(() => {
    setInteraction(null);
  }, []);

  // Barcode data URL cache
  const barcodeCache = useRef<Map<string, string>>(new Map());

  const generateBarcodeDataUrl = (value: string, bFormat: string, heightPx: number): string | null => {
    const key = `${value}-${bFormat}-${Math.round(heightPx)}`;
    if (barcodeCache.current.has(key)) return barcodeCache.current.get(key)!;
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, value, {
        format: bFormat,
        displayValue: true,
        margin: 2,
        height: Math.max(15, heightPx * 0.7),
        fontSize: Math.max(8, Math.min(12, heightPx * 0.15)),
        width: 1.5,
      });
      const url = canvas.toDataURL('image/png');
      barcodeCache.current.set(key, url);
      return url;
    } catch {
      return null;
    }
  };

  const renderElement = (pos: ElementPosition) => {
    const isActive = interaction?.elementId === pos.id;
    const isDragging = isActive && interaction?.type === 'drag';
    const isResizing = isActive && interaction?.type === 'resize';
    const heightPx = mmToPx(pos.h);

    // Center element horizontally within the label, offset by pos.x
    const elementWidthPx = mmToPx(format.width) * 0.85;
    const baseCenterX = (mmToPx(format.width) - elementWidthPx) / 2;
    const xOffsetPx = mmToPx(pos.x);

    const style: React.CSSProperties = {
      position: 'absolute',
      left: `${baseCenterX + xOffsetPx}px`,
      top: `${mmToPx(pos.y)}px`,
      width: `${elementWidthPx}px`,
      height: `${heightPx}px`,
      cursor: isDragging ? 'grabbing' : 'grab',
      zIndex: isActive ? 50 : 10,
      userSelect: 'none',
      transition: isActive ? 'none' : 'box-shadow 0.15s ease',
    };

    const borderColor = isActive ? 'border-blue-500' : 'border-transparent hover:border-blue-400';
    const bgColor = isActive ? 'bg-blue-50/80' : 'hover:bg-blue-50/40';
    const shadow = isDragging ? 'shadow-lg ring-2 ring-blue-300' : isResizing ? 'shadow-md ring-1 ring-blue-200' : 'hover:shadow';

    if (pos.id === 'name') {
      return (
        <div
          key={pos.id}
          style={style}
          className={`rounded border ${borderColor} ${bgColor} ${shadow} flex items-center justify-center relative group/el`}
          onMouseDown={(e) => handleMouseDown(e, pos.id, 'drag')}
        >
          <div
            className="text-black font-bold text-center leading-tight px-1 truncate w-full"
            style={{ fontSize: `${mmToPx(pos.fontSize || 3)}px` }}
          >
            {product.item_name.substring(0, 30)}
          </div>
          {/* Resize handle */}
          <div
            className="absolute bottom-0 left-1/4 right-1/4 h-[4px] cursor-ns-resize opacity-0 group-hover/el:opacity-100 flex items-center justify-center"
            onMouseDown={(e) => handleMouseDown(e, pos.id, 'resize')}
          >
            <div className="w-8 h-[3px] bg-blue-400 rounded-full" />
          </div>
        </div>
      );
    }

    // Barcode elements
    const barcodeFormat =
      pos.id === 'sku' ? 'CODE128' :
      pos.id === 'ean13' ? 'EAN13' : 'ITF14';
    const value =
      pos.id === 'sku' ? product.sku :
      pos.id === 'ean13' ? product.ean13! :
      product.dun14!;

    const barcodeUrl = generateBarcodeDataUrl(value, barcodeFormat, heightPx);

    return (
      <div
        key={pos.id}
        style={style}
        className={`rounded border ${borderColor} ${bgColor} ${shadow} flex items-center justify-center relative group/el overflow-hidden`}
        onMouseDown={(e) => handleMouseDown(e, pos.id, 'drag')}
      >
        {barcodeUrl ? (
          <img
            src={barcodeUrl}
            alt={pos.id}
            className="max-h-full max-w-full object-contain pointer-events-none"
            draggable={false}
          />
        ) : (
          <span className="text-[9px] text-red-500 font-mono">{pos.id}: {value}</span>
        )}
        {/* Resize handle */}
        <div
          className="absolute bottom-0 left-1/4 right-1/4 h-[5px] cursor-ns-resize opacity-0 group-hover/el:opacity-100 flex items-center justify-center"
          onMouseDown={(e) => handleMouseDown(e, pos.id, 'resize')}
        >
          <div className="w-10 h-[3px] bg-blue-400 rounded-full" />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
          Vista Previa
          <span className="text-[10px] font-normal text-slate-400 normal-case tracking-normal">(arrastra · borde inferior redimensiona)</span>
        </h3>
      </div>

      <div
        ref={containerRef}
        className="flex-1 bg-gradient-to-br from-slate-100 to-slate-50 rounded-lg border border-slate-200 flex items-center justify-center p-5 min-h-[220px] overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Ruler and Canvas Wrapper */}
        <div className="relative" style={{
          paddingTop: '20px',
          paddingLeft: '20px',
          width: `${mmToPx(format.width) + 20}px`,
          height: `${mmToPx(format.height) + 20}px`,
        }}>
          {/* Horizontal Ruler (Top) */}
          <div className="absolute top-0 left-[20px] h-[20px] overflow-visible" style={{ width: `${mmToPx(format.width)}px` }}>
            <svg width={mmToPx(format.width)} height="20" className="overflow-visible select-none">
              {Array.from({ length: format.width + 1 }).map((_, mm) => {
                const x = mmToPx(mm);
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
          <div className="absolute top-[20px] left-0 w-[20px] overflow-visible" style={{ height: `${mmToPx(format.height)}px` }}>
            <svg width="20" height={mmToPx(format.height)} className="overflow-visible select-none">
              {Array.from({ length: format.height + 1 }).map((_, mm) => {
                const y = mmToPx(mm);
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

          {/* Label surface */}
          <div
            ref={labelRef}
            className="bg-white relative shadow-[0_2px_12px_rgba(0,0,0,0.12)] border border-slate-200 overflow-visible"
            style={{
              width: `${mmToPx(format.width)}px`,
              height: `${mmToPx(format.height)}px`,
            }}
          >
          {/* 5mm grid */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `
              linear-gradient(to right, rgba(0,0,0,0.04) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(0,0,0,0.04) 1px, transparent 1px)
            `,
            backgroundSize: `${mmToPx(5)}px ${mmToPx(5)}px`,
          }} />

          {/* Draggable elements */}
          {visibleElements.map(renderElement)}

          {/* Empty state */}
          {visibleElements.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs text-slate-300">Sin elementos</span>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Dimensions */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 px-0.5">
        <span>{format.width}×{format.height} mm</span>
        <span>{format.dpi} DPI</span>
      </div>
    </div>
  );
}
