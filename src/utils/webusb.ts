/**
 * WebUSB printing utility for Zebra printers.
 * Falls back to this when server-side printing is unavailable (e.g. Cloud Run).
 *
 * Zebra vendor IDs: 0x0a5f (Zebra Technologies)
 * Some older models may use 0x0536 or similar.
 */

const ZEBRA_VENDOR_IDS = [0x0a5f, 0x0536];

// Store the paired device globally so we don't re-ask permission each time
let pairedDevice: USBDevice | null = null;

/** Check if WebUSB is available in this browser */
export function isWebUSBSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

/** Get the currently paired device (if any) */
export function getPairedDevice(): USBDevice | null {
  return pairedDevice;
}

/**
 * Request the user to select a USB printer from a browser dialog.
 * Returns the selected device or null if cancelled.
 */
export async function requestUSBPrinter(): Promise<USBDevice | null> {
  if (!isWebUSBSupported()) {
    throw new Error("WebUSB no está soportado en este navegador. Usa Google Chrome.");
  }

  try {
    // First try with Zebra vendor filter
    const device = await navigator.usb.requestDevice({
      filters: [
        ...ZEBRA_VENDOR_IDS.map((vendorId) => ({ vendorId })),
        // Also allow any printer class device (class 7)
        { classCode: 7 },
      ],
    });

    pairedDevice = device;
    return device;
  } catch (e: any) {
    if (e.name === "NotFoundError") {
      // User cancelled the dialog
      return null;
    }
    throw e;
  }
}

/**
 * Try to get already-paired devices without asking user again.
 */
export async function getAlreadyPairedPrinters(): Promise<USBDevice[]> {
  if (!isWebUSBSupported()) return [];
  try {
    const devices = await navigator.usb.getDevices();
    return devices.filter(
      (d) =>
        ZEBRA_VENDOR_IDS.includes(d.vendorId) ||
        d.configuration?.interfaces?.some((i) =>
          i.alternates.some((a) => a.interfaceClass === 7)
        )
    );
  } catch {
    return [];
  }
}

/**
 * Send raw ZPL data to a USB printer.
 */
export async function sendZPLviaUSB(
  device: USBDevice,
  zpl: string
): Promise<void> {
  try {
    // Open the device
    await device.open();

    // Select configuration (usually config 1)
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    // Find the printer interface
    const iface = device.configuration?.interfaces?.find((i) =>
      i.alternates.some(
        (a) => a.interfaceClass === 7 // Printer class
      )
    );

    if (!iface) {
      // Try the first interface as fallback
      const fallbackIface = device.configuration?.interfaces?.[0];
      if (!fallbackIface) {
        throw new Error("No se encontró interfaz de impresora en el dispositivo USB.");
      }
      await device.claimInterface(fallbackIface.interfaceNumber);

      // Find OUT endpoint
      const outEndpoint = fallbackIface.alternate.endpoints.find(
        (e) => e.direction === "out"
      );

      if (!outEndpoint) {
        throw new Error("No se encontró endpoint de salida en la impresora.");
      }

      const data = new TextEncoder().encode(zpl);
      await device.transferOut(outEndpoint.endpointNumber, data);
    } else {
      await device.claimInterface(iface.interfaceNumber);

      // Find the OUT endpoint (for sending data to printer)
      const alt = iface.alternates.find((a) => a.interfaceClass === 7);
      const outEndpoint = alt?.endpoints.find((e) => e.direction === "out");

      if (!outEndpoint) {
        throw new Error("No se encontró endpoint de salida en la impresora.");
      }

      // Send ZPL as raw bytes
      const data = new TextEncoder().encode(zpl);
      await device.transferOut(outEndpoint.endpointNumber, data);
    }

    // Release interface and close
    await device.close();
  } catch (e: any) {
    // Try to close device on error
    try {
      await device.close();
    } catch {}

    if (e.message?.includes("claimed") || e.message?.includes("SecurityError")) {
      throw new Error(
        "Windows tiene la impresora bloqueada. Necesitas:\n" +
        "1. Desinstalar el driver actual de la Zebra\n" +
        "2. Reinstalarla con driver WinUSB (Zadig)\n" +
        "Esto es una limitación de Windows con WebUSB."
      );
    }
    throw e;
  }
}

/**
 * High-level function: print ZPL to a Zebra printer via WebUSB.
 * Handles device selection if needed.
 */
export async function printViaWebUSB(zpl: string): Promise<{ success: boolean; message: string }> {
  if (!isWebUSBSupported()) {
    return { success: false, message: "WebUSB no soportado. Usa Google Chrome." };
  }

  try {
    // Use already-paired device or ask user
    let device = pairedDevice;

    if (!device) {
      // Check if we have previously paired devices
      const paired = await getAlreadyPairedPrinters();
      if (paired.length > 0) {
        device = paired[0];
        pairedDevice = device;
      }
    }

    if (!device) {
      device = await requestUSBPrinter();
      if (!device) {
        return { success: false, message: "No se seleccionó impresora." };
      }
    }

    await sendZPLviaUSB(device, zpl);
    return {
      success: true,
      message: `ZPL enviado a ${device.productName || "impresora USB"} vía WebUSB`,
    };
  } catch (e: any) {
    pairedDevice = null; // Reset on error
    return { success: false, message: e.message || "Error de impresión WebUSB" };
  }
}

/** Forget the paired device (for switching printers) */
export async function forgetUSBPrinter(): Promise<void> {
  if (pairedDevice) {
    try {
      await pairedDevice.forget();
    } catch {}
    pairedDevice = null;
  }
}
