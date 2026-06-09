import React, { useRef, useState, useCallback, useEffect } from 'react';
import { LabelFormat, ElementPosition } from '../types';
import { getElementHeights } from '../utils/zebra';
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
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Scale: pixels per mm — auto-calculate to fit container
  const [scale, setScale] = useState(6);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      const h = entries[0].contentRect.height;
      const sx = (w - 32) / format.width; // 16px padding each side
      const sy = (h - 32) / format.height;
      setScale(Math.max(2, Math.min(sx, sy, 12)));
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [format.width, format.height]);

  const heights = getElementHeights(format);

  // Convert mm position to px
  const mmToPx = (mm: number) => mm * scale;

  // Get visible elements
  const visibleElements = positions.filter(p => {
    if (p.id === 'name') return selectedParts.name && product.item_name;
    if (p.id === 'sku') return selectedParts.sku && product.sku;
    if (p.id === 'ean13') return selectedParts.ean13 && product.ean13;
    if (p.id === 'dun14') return selectedParts.dun14 && product.dun14;
    return false;
  });

  const handleMouseDown = useCallback((e: React.MouseEvent, elementId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    setDragging(elementId);
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !labelRef.current) return;
    const labelRect = labelRef.current.getBoundingClientRect();
    const pos = positions.find(p => p.id === dragging);
    if (!pos) return;

    const newX = (e.clientX - labelRect.left - dragOffset.x) / scale;
    const newY = (e.clientY - labelRect.top - dragOffset.y) / scale;

    // Clamp within label bounds
    const elementH = heights[dragging] || 3;
    const clampedX = Math.max(0, Math.min(newX, format.width - 5));
    const clampedY = Math.max(0, Math.min(newY, format.height - elementH));

    const newPositions = positions.map(p =>
      p.id === dragging ? { ...p, x: Math.round(clampedX * 10) / 10, y: Math.round(clampedY * 10) / 10 } : p
    );
    onPositionsChange(newPositions);
  }, [dragging, dragOffset, scale, positions, format, heights, onPositionsChange]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Generate barcode data URLs for preview
  const generateBarcodeDataUrl = (value: string, bFormat: string, previewHeight: number): string | null => {
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, value, {
        format: bFormat,
        displayValue: true,
        margin: 2,
        height: Math.max(20, previewHeight),
        fontSize: 10,
        width: 1.2,
      });
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  const renderElement = (pos: ElementPosition) => {
    const h = heights[pos.id];
    const isDragged = dragging === pos.id;

    const style: React.CSSProperties = {
      position: 'absolute',
      left: `${mmToPx(pos.x)}px`,
      top: `${mmToPx(pos.y)}px`,
      cursor: isDragged ? 'grabbing' : 'grab',
      zIndex: isDragged ? 50 : 10,
      userSelect: 'none',
      transition: isDragged ? 'none' : 'box-shadow 0.15s ease',
      maxWidth: `${mmToPx(format.width - pos.x)}px`,
    };

    const baseClasses = `rounded-sm border transition-colors ${
      isDragged
        ? 'border-blue-500 bg-blue-50/80 shadow-lg ring-2 ring-blue-300'
        : 'border-transparent hover:border-blue-400 hover:bg-blue-50/50 hover:shadow-md'
    }`;

    if (pos.id === 'name') {
      return (
        <div
          key={pos.id}
          style={{ ...style, height: `${mmToPx(h)}px` }}
          className={baseClasses}
          onMouseDown={(e) => handleMouseDown(e, pos.id)}
        >
          <div
            className="text-black font-bold leading-tight px-1 truncate"
            style={{ fontSize: `${Math.max(8, scale * 1.8)}px` }}
          >
            {product.item_name.substring(0, 30)}
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

    const barcodeUrl = generateBarcodeDataUrl(value, barcodeFormat, mmToPx(h - 3));

    return (
      <div
        key={pos.id}
        style={{ ...style, height: `${mmToPx(h)}px` }}
        className={baseClasses}
        onMouseDown={(e) => handleMouseDown(e, pos.id)}
      >
        {barcodeUrl ? (
          <img
            src={barcodeUrl}
            alt={pos.id}
            className="h-full object-contain pointer-events-none"
            draggable={false}
          />
        ) : (
          <div className="flex items-center justify-center h-full px-2">
            <span className="text-xs text-red-500 font-mono">{pos.id}: {value}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
        <span>Vista Previa</span>
        <span className="text-[10px] font-normal text-slate-400 normal-case">(arrastra los elementos)</span>
      </h3>

      <div
        ref={containerRef}
        className="flex-1 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center p-4 min-h-[200px] overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Label surface */}
        <div
          ref={labelRef}
          className="bg-white relative shadow-lg border border-slate-300 overflow-hidden"
          style={{
            width: `${mmToPx(format.width)}px`,
            height: `${mmToPx(format.height)}px`,
          }}
        >
          {/* Grid guides */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `
              linear-gradient(to right, rgba(0,0,0,0.03) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(0,0,0,0.03) 1px, transparent 1px)
            `,
            backgroundSize: `${mmToPx(5)}px ${mmToPx(5)}px`,
          }} />

          {/* Margin guides */}
          <div className="absolute pointer-events-none border border-dashed border-blue-200/60" style={{
            left: `${mmToPx(format.marginLeft)}px`,
            top: `${mmToPx(format.marginTop)}px`,
            right: `${mmToPx(format.marginRight)}px`,
            bottom: `${mmToPx(format.marginBottom)}px`,
          }} />

          {/* Draggable elements */}
          {visibleElements.map(renderElement)}

          {/* Empty state */}
          {visibleElements.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs text-slate-300 font-medium">Sin elementos seleccionados</span>
            </div>
          )}
        </div>
      </div>

      {/* Dimensions info */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 px-1">
        <span>{format.width}×{format.height}mm</span>
        <span>{format.dpi} DPI</span>
      </div>
    </div>
  );
}
