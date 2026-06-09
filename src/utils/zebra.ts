import { LabelFormat, ElementPosition } from "../types";

export const defaultLabelFormat: LabelFormat = {
  id: "default",
  name: "Estándar 50x25mm",
  width: 50,
  height: 25,
  dpi: 203,
  darkness: 15,
  printSpeed: 3,
  orientation: "N",
  marginTop: 2,
  marginBottom: 0,
  marginLeft: 2,
  marginRight: 0,
  labelsPerRow: 1,
  labelsPerColumn: 1,
  horizontalGap: 2,
  verticalGap: 0,
  showName: true,
  showSku: true,
  showEan13: true,
  showDun14: true,
};

/** Default height of each element type in mm */
export function getDefaultElementHeight(id: string, format: LabelFormat): number {
  if (id === 'name') return 3;
  // Barcode: reasonable default based on label height
  return Math.max(8, format.height * 0.35);
}

/** Calculate default auto-stacked positions (tight, centered horizontally) */
export function calculateDefaultPositions(
  format: LabelFormat,
  product: { sku: string; item_name: string; ean13?: string; dun14?: string },
): ElementPosition[] {
  const gap = 1; // 1mm gap between elements
  const positions: ElementPosition[] = [];
  let currentY = format.marginTop;

  // Center X: elements will be centered within the label
  const centerX = 0; // 0 means "auto-center" — handled in ZPL generation

  const elements: { id: ElementPosition['id']; show: boolean; hasData: boolean }[] = [
    { id: 'name', show: format.showName, hasData: !!product.item_name },
    { id: 'sku', show: format.showSku, hasData: !!product.sku },
    { id: 'ean13', show: format.showEan13, hasData: !!product.ean13 },
    { id: 'dun14', show: format.showDun14, hasData: !!product.dun14 },
  ];

  for (const el of elements) {
    if (el.show && el.hasData) {
      const h = getDefaultElementHeight(el.id, format);
      positions.push({ id: el.id, x: centerX, y: currentY, h });
      currentY += h + gap;
    }
  }

  return positions;
}

export function generateZpl(
  sku: string,
  itemName: string,
  ean13?: string,
  dun14?: string,
  format: LabelFormat = defaultLabelFormat,
  customPositions?: ElementPosition[],
): string {
  const dpmm = format.dpi === 300 ? 12 : 8;

  const labelWidthDots = Math.round(format.width * dpmm);
  const labelHeightDots = Math.round(format.height * dpmm);
  const gapDots = Math.round(format.horizontalGap * dpmm);
  const marginLeftDots = Math.round(format.marginLeft * dpmm);

  const totalPw = Math.max(
    labelWidthDots,
    labelWidthDots * format.labelsPerRow +
      gapDots * Math.max(0, format.labelsPerRow - 1) +
      marginLeftDots,
  );
  const ll = labelHeightDots;

  let zpl = "^XA\n";
  zpl += `^PW${totalPw}\n`;
  zpl += `^LL${ll}\n`;
  zpl += `~SD${format.darkness}\n`;
  zpl += `^PR${format.printSpeed}\n`;

  // Font setup
  const fontH = Math.round(3 * dpmm);
  const fontW = Math.round(2.5 * dpmm);

  const orientation = format.orientation;
  const verticalGapDots = Math.round((format.verticalGap || 2) * dpmm);

  // Calculate positions
  const positions = customPositions || calculateDefaultPositions(
    format,
    { sku, item_name: itemName, ean13, dun14 },
  );

  const posMap = new Map<string, ElementPosition>();
  for (const p of positions) posMap.set(p.id, p);

  // Usable label width for centering (in dots)
  const usableWidth = labelWidthDots - marginLeftDots;

  const verticalCount = format.labelsPerColumn || 1;
  const horizontalCount = format.labelsPerRow || 1;

  for (let row = 0; row < verticalCount; row++) {
    for (let col = 0; col < horizontalCount; col++) {
      const colOffsetX = marginLeftDots + col * (labelWidthDots + gapDots);
      const rowOffsetY = row * (labelHeightDots + verticalGapDots);

      // Name — centered with ^FB field block
      if (format.showName && itemName && posMap.has('name')) {
        const pos = posMap.get('name')!;
        const y = rowOffsetY + Math.round(pos.y * dpmm);
        // Use ^FB for horizontal centering of text
        const fbWidth = usableWidth;
        zpl += `^FO${colOffsetX},${y}^FB${fbWidth},1,0,C,0^A0${orientation},${fontH},${fontW}^FD${itemName.substring(0, 30)}^FS\n`;
      }

      // SKU (Code 128) — centered
      if (format.showSku && sku && posMap.has('sku')) {
        const pos = posMap.get('sku')!;
        const bHeight = Math.round(pos.h * dpmm);
        const y = rowOffsetY + Math.round(pos.y * dpmm);
        // Approximate barcode width for Code128: ~11 * chars * moduleWidth(2) dots
        const approxBarcodeWidth = Math.min(sku.length * 22 + 40, usableWidth);
        const centerX = colOffsetX + Math.round((usableWidth - approxBarcodeWidth) / 2);
        zpl += `^FO${Math.max(colOffsetX, centerX)},${y}^BC${orientation},${bHeight},Y,N,N^FD${sku}^FS\n`;
      }

      // EAN13 — centered
      if (format.showEan13 && ean13 && posMap.has('ean13')) {
        const pos = posMap.get('ean13')!;
        const bHeight = Math.round(pos.h * dpmm);
        const y = rowOffsetY + Math.round(pos.y * dpmm);
        // EAN13 is always 95 modules wide; at default module width ~190 dots
        const approxBarcodeWidth = 190;
        const centerX = colOffsetX + Math.round((usableWidth - approxBarcodeWidth) / 2);
        zpl += `^FO${Math.max(colOffsetX, centerX)},${y}^BE${orientation},${bHeight},Y,N^FD${ean13}^FS\n`;
      }

      // DUN14 — centered
      if (format.showDun14 && dun14 && posMap.has('dun14')) {
        const pos = posMap.get('dun14')!;
        const bHeight = Math.round(pos.h * dpmm);
        const y = rowOffsetY + Math.round(pos.y * dpmm);
        // ITF14 approximate width: ~14 chars * 2 * moduleWidth(2)
        const approxBarcodeWidth = Math.min(dun14.length * 18 + 40, usableWidth);
        const centerX = colOffsetX + Math.round((usableWidth - approxBarcodeWidth) / 2);
        zpl += `^FO${Math.max(colOffsetX, centerX)},${y}^B2${orientation},${bHeight},Y,N,N^FD${dun14}^FS\n`;
      }
    }
  }

  zpl += "^PQ1,0,1,Y\n";
  zpl += "^XZ\n";
  return zpl;
}
