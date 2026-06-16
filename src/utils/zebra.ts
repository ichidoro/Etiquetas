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
  totalLabels?: number,
): string {
  const dpmm = format.dpi === 300 ? 12 : 8;

  const labelWidthDots = Math.round(format.width * dpmm);
  const labelHeightDots = Math.round(format.height * dpmm);
  const gapDots = Math.round(format.horizontalGap * dpmm);
  const marginLeftDots = Math.round(format.marginLeft * dpmm);
  const marginRightDots = Math.round((format.marginRight || 0) * dpmm);
  const marginTopDots = Math.round((format.marginTop || 0) * dpmm);

  // Total print width: left margin + labels + gaps + right margin
  const gridWidth = labelWidthDots * format.labelsPerRow +
    gapDots * Math.max(0, format.labelsPerRow - 1);
  const totalPw = marginLeftDots + gridWidth + marginRightDots;
  const verticalGapDots = Math.round((format.verticalGap || 2) * dpmm);
  const verticalCount = format.labelsPerColumn || 1;
  const ll = verticalCount * labelHeightDots +
    Math.max(0, verticalCount - 1) * verticalGapDots;

  const orientation = format.orientation;
  const horizontalCount = format.labelsPerRow || 1;

  // Calculate positions
  const positions = customPositions || calculateDefaultPositions(
    format,
    { sku, item_name: itemName, ean13, dun14 },
  );
  const posMap = new Map<string, ElementPosition>();
  for (const p of positions) posMap.set(p.id, p);

  // Font defaults
  const defaultFontHmm = 3;

  // How many labels per "page" (one ZPL ^XA..^XZ block)
  const labelsPerPage = horizontalCount * verticalCount;

  // If totalLabels is specified, generate exact count across multiple pages
  const total = totalLabels || labelsPerPage; // default = fill one full page
  const numPages = Math.ceil(total / labelsPerPage);

  let fullZpl = "";
  let labelsGenerated = 0;

  for (let page = 0; page < numPages; page++) {
    let zpl = "^XA\n";
    zpl += `^PW${totalPw}\n`;
    zpl += `^LL${ll}\n`;
    zpl += `~SD${format.darkness}\n`;
    zpl += `^PR${format.printSpeed}\n`;
    // NOTE: ^LS removed — column positioning handled via marginLeft + colOffsetX
    const topDots = Math.round((format.labelTop || 0) * dpmm);
    if (topDots !== 0) zpl += `^LT${topDots}\n`;

    for (let row = 0; row < verticalCount; row++) {
      for (let col = 0; col < horizontalCount; col++) {
        if (labelsGenerated >= total) break; // stop when we have enough

        const colOffsetX = marginLeftDots + col * (labelWidthDots + gapDots);
        const rowOffsetY = row * (labelHeightDots + verticalGapDots);

        // Name
        if (format.showName && itemName && posMap.has('name')) {
          const pos = posMap.get('name')!;
          const fsMm = pos.fontSize || defaultFontHmm;
          const fontH = Math.round(fsMm * dpmm);
          const fontW = Math.round((fsMm * 0.8) * dpmm);
          const y = rowOffsetY + Math.round(pos.y * dpmm);
          const xOffset = Math.round(pos.x * dpmm);
          zpl += `^FO${Math.max(0, colOffsetX + xOffset)},${y}^FB${labelWidthDots},1,0,C,0^A0${orientation},${fontH},${fontW}^FD${itemName.substring(0, 40)}^FS\n`;
        }

        // SKU (Code 128)
        if (format.showSku && sku && posMap.has('sku')) {
          const pos = posMap.get('sku')!;
          const bHeight = Math.round(pos.h * dpmm);
          const y = rowOffsetY + Math.round(pos.y * dpmm);
          let x: number;
          if (pos.x !== 0) {
            x = colOffsetX + Math.round(pos.x * dpmm);
          } else {
            const approxBarcodeWidth = Math.min(sku.length * 22 + 40, labelWidthDots);
            x = colOffsetX + Math.round((labelWidthDots - approxBarcodeWidth) / 2);
          }
          zpl += `^FO${Math.max(0, x)},${y}^BC${orientation},${bHeight},Y,N,N^FD${sku}^FS\n`;
        }

        // EAN13
        if (format.showEan13 && ean13 && posMap.has('ean13')) {
          const pos = posMap.get('ean13')!;
          const bHeight = Math.round(pos.h * dpmm);
          const y = rowOffsetY + Math.round(pos.y * dpmm);
          const firstDigitOffset = 18;
          let x: number;
          if (pos.x !== 0) {
            x = colOffsetX + Math.round(pos.x * dpmm);
          } else {
            const totalVisualWidth = 190 + firstDigitOffset;
            const leftPadding = Math.round((labelWidthDots - totalVisualWidth) / 2);
            x = colOffsetX + leftPadding + firstDigitOffset;
          }
          zpl += `^FO${Math.max(firstDigitOffset, x)},${y}^BE${orientation},${bHeight},Y,N^FD${ean13}^FS\n`;
        }

        // DUN14
        if (format.showDun14 && dun14 && posMap.has('dun14')) {
          const pos = posMap.get('dun14')!;
          const bHeight = Math.round(pos.h * dpmm);
          const y = rowOffsetY + Math.round(pos.y * dpmm);
          let x: number;
          if (pos.x !== 0) {
            x = colOffsetX + Math.round(pos.x * dpmm);
          } else {
            const approxBarcodeWidth = Math.min(dun14.length * 18 + 40, labelWidthDots);
            x = colOffsetX + Math.round((labelWidthDots - approxBarcodeWidth) / 2);
          }
          zpl += `^FO${Math.max(0, x)},${y}^B2${orientation},${bHeight},Y,N,N^FD${dun14}^FS\n`;
        }

        labelsGenerated++;
      }
      if (labelsGenerated >= total) break;
    }

    zpl += "^PQ1\n";
    zpl += "^XZ\n";
    fullZpl += zpl;
  }

  return fullZpl;
}

/**
 * Generate a calibration/ruler test label.
 * Draws borders, ruler tick marks every 5mm, center crosshairs,
 * and dimension labels for each label cell in the grid.
 */
export function generateCalibrationZpl(format: LabelFormat): string {
  const dpmm = format.dpi === 300 ? 12 : 8;
  const lw = Math.round(format.width * dpmm);   // label width dots
  const lh = Math.round(format.height * dpmm);   // label height dots
  const gapH = Math.round(format.horizontalGap * dpmm);
  const gapV = Math.round((format.verticalGap || 2) * dpmm);
  const ml = Math.round(format.marginLeft * dpmm);
  const cols = format.labelsPerRow || 1;
  const rows = format.labelsPerColumn || 1;

  const pw = Math.max(lw, lw * cols + gapH * Math.max(0, cols - 1) + ml);
  const ll = rows * lh + Math.max(0, rows - 1) * gapV;

  let z = "^XA\n";
  z += `^PW${pw}\n^LL${ll}\n~SD${format.darkness}\n^PR${format.printSpeed}\n`;
  // NOTE: ^LS removed — column positioning handled via marginLeft + colOffsetX
  const topDots = Math.round((format.labelTop || 0) * dpmm);
  if (topDots !== 0) z += `^LT${topDots}\n`;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ox = ml + col * (lw + gapH);  // cell origin X
      const oy = row * (lh + gapV);       // cell origin Y

      // 1. Border rectangle (2-dot thick)
      z += `^FO${ox},${oy}^GB${lw},${lh},2^FS\n`;

      // 2. Horizontal ruler ticks along TOP and BOTTOM (every 5mm)
      const tickSmall = Math.round(lh * 0.06);  // short tick
      const tickBig = Math.round(lh * 0.12);    // long tick (every 10mm)
      for (let mm = 5; mm < format.width; mm += 5) {
        const tx = ox + Math.round(mm * dpmm);
        const tLen = mm % 10 === 0 ? tickBig : tickSmall;
        // Top ticks
        z += `^FO${tx},${oy}^GB1,${tLen},1^FS\n`;
        // Bottom ticks
        z += `^FO${tx},${oy + lh - tLen}^GB1,${tLen},1^FS\n`;
        // Number label at 10mm intervals (top)
        if (mm % 10 === 0) {
          z += `^FO${tx - 6},${oy + tLen + 1}^A0N,12,10^FD${mm}^FS\n`;
        }
      }

      // 3. Vertical ruler ticks along LEFT and RIGHT (every 5mm)
      for (let mm = 5; mm < format.height; mm += 5) {
        const ty = oy + Math.round(mm * dpmm);
        const tLen = mm % 10 === 0 ? tickBig : tickSmall;
        // Left ticks
        z += `^FO${ox},${ty}^GB${tLen},1,1^FS\n`;
        // Right ticks
        z += `^FO${ox + lw - tLen},${ty}^GB${tLen},1,1^FS\n`;
        // Number label at 10mm intervals (left)
        if (mm % 10 === 0) {
          z += `^FO${ox + tLen + 2},${ty - 6}^A0N,12,10^FD${mm}^FS\n`;
        }
      }

      // 4. Center crosshair (10-dot lines)
      const cx = ox + Math.round(lw / 2);
      const cy = oy + Math.round(lh / 2);
      z += `^FO${cx - 16},${cy}^GB32,1,1^FS\n`;  // horizontal
      z += `^FO${cx},${cy - 16}^GB1,32,1^FS\n`;  // vertical

      // 5. Corner dots (3×3)
      const d = 4; // dot size
      const m = 3; // margin from edge
      z += `^FO${ox + m},${oy + m}^GB${d},${d},${d}^FS\n`;  // top-left
      z += `^FO${ox + lw - m - d},${oy + m}^GB${d},${d},${d}^FS\n`;  // top-right
      z += `^FO${ox + m},${oy + lh - m - d}^GB${d},${d},${d}^FS\n`;  // bottom-left
      z += `^FO${ox + lw - m - d},${oy + lh - m - d}^GB${d},${d},${d}^FS\n`;  // bottom-right

      // 6. Dimension label at center
      const dimText = `${format.width}x${format.height}`;
      z += `^FO${cx - 20},${cy + 6}^A0N,12,10^FD${dimText}^FS\n`;

      // 7. Column/Row label
      z += `^FO${cx - 10},${cy - 20}^A0N,14,12^FDC${col + 1}R${row + 1}^FS\n`;
    }
  }

  z += "^PQ1\n^XZ\n";
  return z;
}
