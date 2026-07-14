import React, { useState, useEffect, useCallback } from 'react';
import { 
  Send, RefreshCw, AlertCircle, CheckCircle, Wifi, WifiOff, Loader2, 
  Trash2, Save, Users, HelpCircle
} from 'lucide-react';

interface WhatsAppConfigTabProps {
  theme: 'light' | 'dark' | 'glass';
  onShowToast?: (message: string, type: 'success' | 'error') => void;
}

export function WhatsAppConfigTab({ theme, onShowToast }: WhatsAppConfigTabProps) {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingQr, setLoadingQr] = useState(false);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [autoNotifyEnabled, setAutoNotifyEnabled] = useState(false);
  const [autoNotifyTime, setAutoNotifyTime] = useState('06:00');
  const [savingAutoConfig, setSavingAutoConfig] = useState(false);

  // Styling helpers
  const cardBg = theme === 'light' 
    ? 'bg-white border-slate-200 text-slate-800' 
    : theme === 'glass'
      ? 'bg-slate-900/60 backdrop-blur-md border-slate-700/40 text-white'
      : 'bg-slate-950 border-slate-800 text-white';

  const textMuted = theme === 'light' ? 'text-slate-500' : 'text-slate-400';
  const textTitle = theme === 'light' ? 'text-slate-800' : 'text-white';
  const borderCol = theme === 'light' ? 'border-slate-250' : 'border-slate-800';

  const inputClass = `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 transition-all ${
    theme === 'light' 
      ? 'border-slate-200 bg-slate-50 text-slate-800 focus:bg-white focus:border-blue-500 focus:ring-blue-500' 
      : 'border-slate-750 bg-slate-900 text-white focus:bg-slate-950 focus:border-blue-500 focus:ring-blue-500'
  }`;

  // ---- Get Status -----------------------------------------------------------
  const checkStatus = useCallback(async (showLoading = false) => {
    if (showLoading) setLoadingStatus(true);
    try {
      const res = await fetch('/api/whatsapp/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
        if (data.status === 'connected') {
          setQrCode(null);
        } else if (data.status === 'connecting' && data.qr) {
          setQrCode(data.qr);
        } else if (data.status === 'disconnected') {
          setQrCode(null);
        }
      }
    } catch (err) {
      console.error("Error checkStatus", err);
    } finally {
      if (showLoading) setLoadingStatus(false);
    }
  }, []);

  // ---- Get Groups list ------------------------------------------------------
  const fetchGroups = useCallback(async () => {
    if (status !== 'connected') return;
    setLoadingGroups(true);
    try {
      const res = await fetch('/api/whatsapp/groups');
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
      }
    } catch (err) {
      console.error("Error fetching groups", err);
    } finally {
      setLoadingGroups(false);
    }
  }, [status]);

  // ---- Load Current Config --------------------------------------------------
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config/whatsapp_recipient');
      if (res.ok) {
        const data = await res.json();
        if (data.value) {
          setRecipient(data.value);
        }
      }

      const resEnabled = await fetch('/api/config/whatsapp_auto_notify_enabled');
      if (resEnabled.ok) {
        const data = await resEnabled.json();
        setAutoNotifyEnabled(data.value === 'true');
      }

      const resTime = await fetch('/api/config/whatsapp_auto_notify_time');
      if (resTime.ok) {
        const data = await resTime.json();
        if (data.value) {
          setAutoNotifyTime(data.value);
        }
      }
    } catch {}
  }, []);

  // On mount
  useEffect(() => {
    checkStatus(true);
    fetchConfig();
  }, [checkStatus, fetchConfig]);

  // Poll status when connecting
  useEffect(() => {
    let interval: any = null;
    if (status === 'connecting') {
      interval = setInterval(() => {
        checkStatus();
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status, checkStatus]);

  // Fetch groups when connected changes
  useEffect(() => {
    if (status === 'connected') {
      fetchGroups();
    } else {
      setGroups([]);
    }
  }, [status, fetchGroups]);

  // ---- Actions -------------------------------------------------------------
  const handleConnect = async () => {
    setLoadingQr(true);
    setQrCode(null);
    try {
      const res = await fetch('/api/whatsapp/qr');
      if (res.ok) {
        const data = await res.json();
        setQrCode(data.qr);
        setStatus('connecting');
      } else {
        // Si no está disponible de inmediato (está iniciando), marcamos como conectando
        // para que el poller de checkStatus intente obtenerlo
        setStatus('connecting');
      }
    } catch (err) {
      onShowToast?.('Error al conectar con WhatsApp', 'error');
    } finally {
      setLoadingQr(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('¿Estás seguro de que deseas desconectar la cuenta de WhatsApp? Se eliminarán los datos de sesión.')) {
      return;
    }
    setLoadingStatus(true);
    try {
      const res = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
      if (res.ok) {
        setStatus('disconnected');
        setQrCode(null);
        onShowToast?.('Cuenta de WhatsApp desconectada', 'success');
      } else {
        throw new Error('Error al desconectar');
      }
    } catch (err) {
      onShowToast?.('Error al desconectar', 'error');
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient.trim()) {
      onShowToast?.('Por favor ingresa un destinatario o selecciona un grupo', 'error');
      return;
    }
    setSavingConfig(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'whatsapp_recipient', value: recipient }),
      });
      if (res.ok) {
        onShowToast?.('Destinatario de WhatsApp guardado correctamente', 'success');
      } else {
        throw new Error('Error al guardar');
      }
    } catch (err) {
      onShowToast?.('Error al guardar la configuración', 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveAutoNotifyConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAutoConfig(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'whatsapp_auto_notify_enabled', value: String(autoNotifyEnabled) }),
      });

      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'whatsapp_auto_notify_time', value: autoNotifyTime }),
      });

      onShowToast?.('Configuración de envío automático guardada con éxito', 'success');
    } catch (err: any) {
      onShowToast?.('Error al guardar la configuración: ' + err.message, 'error');
    } finally {
      setSavingAutoConfig(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 2 Column Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Left Column: Connection Status & QR */}
        <div className={`${cardBg} rounded-xl shadow-sm border p-6 md:col-span-1 flex flex-col justify-between`}>
          <div>
            <h3 className="font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Wifi className="w-4 h-4 text-blue-500" />
              Estado de la Conexión
            </h3>

            {loadingStatus ? (
              <div className="flex items-center gap-2 text-xs italic text-slate-400 py-6">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                Verificando estado...
              </div>
            ) : (
              <div className="space-y-4">
                {/* Status indicator badge */}
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    status === 'connected' 
                      ? 'bg-emerald-500 animate-pulse' 
                      : status === 'connecting' 
                        ? 'bg-amber-500 animate-pulse' 
                        : 'bg-red-500'
                  }`} />
                  <span className="text-xs font-bold uppercase tracking-wide">
                    {status === 'connected' 
                      ? 'Conectado (WhatsApp listo)' 
                      : status === 'connecting' 
                        ? 'Esperando escaneo QR...' 
                        : 'Desconectado'}
                  </span>
                </div>

                <p className={`text-xs ${textMuted} leading-relaxed`}>
                  {status === 'connected' 
                    ? 'La sesión del Jefe de Producción está vinculada de forma segura. El servidor puede enviar reportes automáticamente.'
                    : 'Para activar los envíos automáticos de planificación a WhatsApp, debes vincular una cuenta móvil.'}
                </p>

                {/* QR Code Container */}
                {status !== 'connected' && (
                  <div className="mt-4 flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-lg min-h-[220px]">
                    {loadingQr ? (
                      <div className="text-center space-y-2">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
                        <span className="text-[11px] text-slate-400 block">Generando código QR...</span>
                      </div>
                    ) : qrCode ? (
                      <div className="text-center space-y-4">
                        <img 
                          src={qrCode} 
                          alt="Escanear QR de WhatsApp" 
                          className="w-40 h-40 border border-slate-200 rounded p-1 bg-white" 
                        />
                        <span className="text-[10px] font-bold text-amber-600 block uppercase tracking-wide">
                          Abre WhatsApp &gt; Dispositivos Vinculados &gt; Escanear
                        </span>
                      </div>
                    ) : (
                      <div className="text-center p-4 text-xs text-slate-400 italic">
                        <WifiOff className="w-8 h-8 text-slate-350 mx-auto mb-2" />
                        Haz clic abajo para generar el código QR.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-slate-100 dark:border-slate-800 mt-6">
            {status === 'connected' ? (
              <button
                onClick={handleDisconnect}
                disabled={loadingStatus}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <WifiOff className="w-3.5 h-3.5" />
                Desconectar Cuenta
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={loadingQr || status === 'connecting'}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingQr ? 'animate-spin' : ''}`} />
                Vincular Celular
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Destination Group Config */}
        <div className={`${cardBg} rounded-xl shadow-sm border p-6 md:col-span-2 flex flex-col justify-between`}>
          <div>
            <h3 className="font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" />
              Configuración del Grupo de Destino
            </h3>

            {status !== 'connected' ? (
              <div className="p-8 bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-lg text-center text-xs text-slate-400">
                <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                <span>Primero debes vincular el celular de WhatsApp en el panel izquierdo para seleccionar el grupo de destino.</span>
              </div>
            ) : (
              <form onSubmit={handleSaveConfig} className="space-y-6">
                
                {/* Group dropdown */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Selecciona un Grupo de WhatsApp
                    </label>
                    {status === 'connected' && !loadingGroups && (
                      <button
                        type="button"
                        onClick={fetchGroups}
                        className="text-[10px] font-bold text-blue-500 hover:text-blue-600 flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <RefreshCw className="w-2.5 h-2.5 animate-pulse" /> Refrescar lista de grupos
                      </button>
                    )}
                  </div>
                  {loadingGroups ? (
                    <div className="flex items-center gap-2 text-xs italic text-slate-400 py-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                      Cargando tus grupos...
                    </div>
                  ) : groups.length === 0 ? (
                    <div className="text-xs text-slate-400 italic bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 p-3 rounded-lg flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-blue-500" />
                      <span>No se detectaron grupos activos de forma automática. Si acabas de conectar WhatsApp, dale unos momentos y haz click en "Refrescar lista". También puedes usar el campo avanzado de abajo.</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <select
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Selecciona el grupo...</option>
                        {groups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400 italic">
                        La lista muestra todos los grupos de WhatsApp donde participa el número vinculado.
                      </p>
                    </div>
                  )}
                </div>

                {/* Manual JID field */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    O ingresa ID manual de destinatario (Avanzado)
                  </label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="Ej: 1203630283478@g.us o 56912345678"
                    className={inputClass}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Para enviar a un número individual, ingresa el código del país seguido del teléfono (ej: 56912345678). Para grupos, usa el formato ID de WhatsApp (@g.us).
                  </p>
                </div>

                {/* Save button */}
                <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="submit"
                    disabled={savingConfig || !recipient}
                    className="inline-flex items-center gap-1.5 py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {savingConfig ? 'Guardando...' : 'Guardar Destinatario'}
                  </button>
                </div>

              </form>
            )}
          </div>

          {/* Help card */}
          <div className={`mt-6 p-4 rounded-xl border flex items-start gap-3 text-xs leading-relaxed ${
            theme === 'light'
              ? 'bg-blue-50 border-blue-150 text-blue-800'
              : 'bg-blue-950/20 border-blue-900/30 text-blue-400'
          }`}>
            <HelpCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">¿Cómo funciona la vinculación? </span>
              Al escanear el QR, el servidor crea una sesión autorizada permanente. 
              <strong> Esto no interfiere con el uso diario de WhatsApp en el celular del jefe de producción.</strong> 
              El bot solo enviará los reportes PDF generados de forma automática cuando presiones "Notificar" en el módulo de Planificación.
            </div>
          </div>
        </div>

        {/* Row 2: Automated Sending Config */}
        <div className={`${cardBg} rounded-xl shadow-sm border p-6 md:col-span-3 mt-6`}>
          <h3 className="font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-500" />
            Envío Automático de Reportes Diarios
          </h3>
          
          <p className={`text-xs ${textMuted} leading-relaxed mb-6`}>
            Configura una hora fija para que el sistema despache de forma automática la planificación de producción de todas las líneas al destinatario correspondiente configurado para cada línea (grupo de WhatsApp o teléfonos directos).
          </p>

          <form onSubmit={handleSaveAutoNotifyConfig} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Toggle Switch */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Estado del Envío Automático
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAutoNotifyEnabled(!autoNotifyEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                      autoNotifyEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        autoNotifyEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span className="text-xs font-semibold">
                    {autoNotifyEnabled ? 'Habilitado' : 'Deshabilitado'}
                  </span>
                </div>
              </div>

              {/* Time Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Hora de Envío Diario
                </label>
                <input
                  type="time"
                  disabled={!autoNotifyEnabled}
                  value={autoNotifyTime}
                  onChange={(e) => setAutoNotifyTime(e.target.value)}
                  className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                />
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="submit"
                disabled={savingAutoConfig}
                className="inline-flex items-center gap-1.5 py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {savingAutoConfig ? 'Guardando...' : 'Guardar Configuración de Envío'}
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  );
}
