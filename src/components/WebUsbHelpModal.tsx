import React from "react";
import { X, Usb, Monitor, Settings, AlertTriangle, ExternalLink } from "lucide-react";

interface WebUsbHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WebUsbHelpModal({ isOpen, onClose }: WebUsbHelpModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-white sticky top-0 z-10">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Usb className="w-6 h-6 text-blue-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">
              Guía de Solución de Problemas: WebUSB
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-8 bg-slate-50/50">
          
          {/* Error: Permission Policy */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-red-100 p-2 rounded-lg text-red-600">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">1. Error: "Access to the feature 'usb' is disallowed by permissions policy"</h3>
            </div>
            <p className="text-slate-600 mb-4 ml-12">
              Este error ocurre típicamente porque la aplicación se está ejecutando dentro de un "iframe" (como en la vista previa del editor de código). Por seguridad web, los permisos de hardware (como el USB) no se permiten en sitios incrustados.
            </p>
            <div className="ml-12 p-4 bg-orange-50 border border-orange-100 rounded-lg text-orange-800 text-sm">
              <span className="font-semibold block mb-1">Solución:</span>
              Debes abrir la aplicación directamente en una nueva pestaña usando su URL propia (por ejemplo, el enlace "Shared App" o el enlace directo en tu navegador), fuera de cualquier vista de editor o iframe.
            </div>
          </div>

          {/* Windows Driver Issues */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-slate-100 p-2 rounded-lg text-slate-600">
                <Monitor className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">2. Error: "Failed to execute 'open' on 'USBDevice': Access denied."</h3>
            </div>
            <p className="text-slate-600 mb-4 ml-12">
              Este error significa que el sistema operativo (Windows) detecta que <strong>ya tienes el controlador oficial de Zebra instalado</strong>. Este software retiene el acceso USB en "modo exclusivo", bloqueando cualquier conexión directa de nuestro botón "WebUSB".
            </p>
            <div className="ml-12 mb-5 p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-sm shadow-sm">
              <strong className="block mb-2 text-base text-blue-800">✅ SOLUCIÓN RECOMENDADA (Más fácil)</strong>
              <p>Dado que ya tienes el software oficial de Zebra y funciona bien, <strong>cancela y usa el botón grande azul "Imprimir con Driver Zebra (Recomendado)"</strong>. Este usa el diálogo de impresión oficial de Windows y funciona excelente con tu controlador actual del fabricante.</p>
            </div>
            <div className="ml-12 space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
              <h4 className="font-semibold text-slate-700">⚠️ SOLUCIÓN AVANZADA (Solo si requieres envío ZPL crudo usando el botón "WebUSB"):</h4>
              <p className="text-sm text-slate-600 mb-2">WebUSB requiere reemplazar el controlador oficial de Zebra por uno genérico. Note que esto desactivará momentáneamente tu programa Zebra Designer nativo.</p>
              <ol className="list-decimal list-inside text-sm text-slate-600 space-y-2">
                <li>Descarga la herramienta <a href="https://zadig.akeo.ie/" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center">Zadig <ExternalLink className="w-3 h-3 ml-1" /></a>.</li>
                <li>Abre Zadig y ve al menú <strong>Options</strong> {">"} <strong>List All Devices</strong>.</li>
                <li>Selecciona tu impresora (ej: "Zebra Printer") en la lista.</li>
                <li>Verifica en el espacio a la derecha de la flecha verde que diga <strong>WinUSB</strong>.</li>
                <li>Haz clic en <strong>Replace Driver</strong>.</li>
              </ol>
            </div>
          </div>

          {/* macOS OS Driver Issues */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-slate-100 p-2 rounded-lg text-slate-600">
                <Monitor className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">3. macOS o Linux: Permisos o bloqueo de red</h3>
            </div>
            <p className="text-slate-600 mb-4 ml-12">
              En general, macOS y Linux pueden acceder a dispositivos USB genéricos a través de WebUSB. Sin embargo, puede haber advertencias si otro servicio está operando en la impresora.
            </p>
            <div className="ml-12 text-sm text-slate-600">
              Asegúrate de que estás ingresando mediante <span className="font-mono bg-slate-100 px-1 rounded text-pink-600">https://</span> o en modo de desarrollo local si estás usando conexiones no seguras. Google Chrome solo expone la API de WebUSB en contextos seguros (HTTPS o localhost).
            </div>
          </div>

          {/* Browser Settings */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-slate-100 p-2 rounded-lg text-slate-600">
                <Settings className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">4. Permisos del Navegador (Chrome / Edge)</h3>
            </div>
            <p className="text-slate-600 mb-2 ml-12 text-sm">
              Incluso si todo lo demás está correcto, el navegador puede tener bloqueado el sitio.
            </p>
            <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-12">
              <li>Haz clic en el icono de candado o configuración a la izquierda de la URL en tu navegador (barra de direcciones).</li>
              <li>Asegúrate de que no haya permisos bloqueados para USB.</li>
              <li>Prueba reiniciar el navegador completamente por si el dispositivo de hardware quedó en estado "bloqueado / en uso" por otra pestaña de manera zombie.</li>
            </ul>
          </div>
          
        </div>
        
        <div className="p-6 border-t border-slate-100 bg-white sticky bottom-0 text-right">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors"
          >
            Entendido, cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
