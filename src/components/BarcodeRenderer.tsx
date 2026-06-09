import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeRendererProps {
  value: string;
  format?: string;
  width?: number;
  height?: number;
  displayValue?: boolean;
}

export function BarcodeRenderer({
  value,
  format = "CODE128",
  width = 2,
  height = 50,
  displayValue = true
}: BarcodeRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && value) {
      try {
        JsBarcode(canvasRef.current, value, {
          format,
          width,
          height,
          displayValue,
          margin: 10,
        });
      } catch (err) {
        console.error("Barcode generation error", err);
      }
    }
  }, [value, format, width, height, displayValue]);

  if (!value) return null;

  return <canvas ref={canvasRef} />;
}
