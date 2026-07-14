import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Search, Settings, Save, X, Cpu, MessageSquare } from 'lucide-react';
import { LineaProceso } from '../types';

interface LineasProcesoManagerProps {
  onShowToast?: (message: string, type: 'success' | 'error') => void;
}

const EMPTY_FORM: Omit<LineaProceso, 'id'> = { codigo: '', descripcion: '', tipo_maquina: '', whatsapp_group_id: '', whatsapp_phone: '', operador: '' };

export function LineasProcesoManager({ onShowToast }: LineasProcesoManagerProps) {
  const [lineas, setLineas] = useState<LineaProceso[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<Omit<LineaProceso, 'id'>>({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);

  // inline edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Omit<LineaProceso, 'id'>>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // delete confirmation
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const toast = useCallback(
    (message: string, type: 'success' | 'error') => {
      onShowToast?.(message, type);
    },
    [onShowToast],
  );

  const fetchLineas = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/lineas-proceso');
      if (!res.ok) throw new Error('Error al cargar líneas de proceso');
      const data: LineaProceso[] = await res.json();
      setLineas(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const [whatsappGroups, setWhatsappGroups] = useState<{ id: string; name: string }[]>([]);

  const fetchWhatsappGroups = useCallback(async () => {
    try {
      const resStatus = await fetch('/api/whatsapp/status');
      if (resStatus.ok) {
        const statusData = await resStatus.json();
        if (statusData.status === 'connected') {
          const resGroups = await fetch('/api/whatsapp/groups');
          if (resGroups.ok) {
            const groupsData = await resGroups.json();
            setWhatsappGroups(groupsData);
          }
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchLineas();
    fetchWhatsappGroups();
  }, [fetchLineas, fetchWhatsappGroups]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.codigo.trim() || !createForm.descripcion.trim()) {
      toast('Código y descripción son obligatorios', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/lineas-proceso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al crear la línea de proceso');
      }
      toast('Línea de proceso creada correctamente', 'success');
      setShowCreateModal(false);
      setCreateForm({ ...EMPTY_FORM });
      await fetchLineas();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast(msg, 'error');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (linea: LineaProceso) => {
    setEditingId(linea.id ?? null);
    setEditForm({ 
      codigo: linea.codigo, 
      descripcion: linea.descripcion, 
      tipo_maquina: linea.tipo_maquina || '',
      whatsapp_group_id: linea.whatsapp_group_id || '',
      whatsapp_phone: linea.whatsapp_phone || '',
      operador: linea.operador || ''
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ ...EMPTY_FORM });
  };

  const handleUpdate = async () => {
    if (editingId == null) return;
    if (!editForm.codigo.trim() || !editForm.descripcion.trim()) {
      toast('Código y descripción son obligatorios', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/lineas-proceso/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al actualizar la línea de proceso');
      }
      toast('Línea de proceso actualizada correctamente', 'success');
      cancelEdit();
      await fetchLineas();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (deletingId == null) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/lineas-proceso/${deletingId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar la línea de proceso');
      toast('Línea de proceso eliminada correctamente', 'success');
      setDeletingId(null);
      await fetchLineas();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast(msg, 'error');
    } finally {
      setDeleting(false);
    }
  };

  // filter
  const filtered = lineas.filter(
    (l) =>
      l.codigo.toLowerCase().includes(search.toLowerCase()) ||
      l.descripcion.toLowerCase().includes(search.toLowerCase()) ||
      (l.tipo_maquina && l.tipo_maquina.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 sm:p-8">
      {/* Title & Actions */}
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Líneas de Proceso</h2>
          <p className="text-sm text-slate-500 mt-1">
            Administra las líneas de producción y envasado del sistema.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="mt-4 sm:mt-0 inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nueva Línea
        </button>
      </div>

      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Buscar por código, descripción o máquina..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Main Content */}
      {loading && lineas.length === 0 ? (
        <div className="text-center py-12 text-slate-500 italic text-sm">
          Cargando líneas de proceso...
        </div>
      ) : error && lineas.length === 0 ? (
        <div className="text-center py-12 text-red-500 font-medium text-sm">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500 italic text-sm">
          No se encontraron líneas de proceso.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th scope="col" className="px-6 py-3 border-b border-slate-200">
                  Código
                </th>
                <th scope="col" className="px-6 py-3 border-b border-slate-200">
                  Descripción
                </th>
                <th scope="col" className="px-6 py-3 border-b border-slate-200">
                  Tipo de Máquina
                </th>
                <th scope="col" className="px-6 py-3 border-b border-slate-200">
                  Operador
                </th>
                 <th scope="col" className="px-6 py-3 border-b border-slate-200">
                  Grupo WhatsApp
                </th>
                <th scope="col" className="px-6 py-3 border-b border-slate-200">
                  Teléfono Directo
                </th>
                <th scope="col" className="px-6 py-3 border-b border-slate-200 text-right">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-150 text-sm text-slate-700">
              {filtered.map((linea) => {
                const isEditing = editingId === linea.id;
                return (
                  <tr key={linea.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-slate-900">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.codigo}
                          onChange={(e) => setEditForm({ ...editForm, codigo: e.target.value })}
                          className="w-24 px-2 py-1 rounded border border-slate-300 focus:outline-none focus:border-blue-500 text-xs font-semibold"
                        />
                      ) : (
                        <span className="px-2 py-1 rounded bg-slate-100 text-xs font-bold text-slate-600 border border-slate-200">
                          {linea.codigo}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.descripcion}
                          onChange={(e) =>
                            setEditForm({ ...editForm, descripcion: e.target.value })
                          }
                          className="w-full max-w-xs px-2 py-1 rounded border border-slate-300 focus:outline-none focus:border-blue-500 text-xs"
                        />
                      ) : (
                        linea.descripcion
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.tipo_maquina}
                          onChange={(e) =>
                            setEditForm({ ...editForm, tipo_maquina: e.target.value })
                          }
                          className="w-36 px-2 py-1 rounded border border-slate-300 focus:outline-none focus:border-blue-500 text-xs"
                        />
                      ) : (
                        linea.tipo_maquina || <span className="text-slate-400 italic">No especificada</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-550">
                      {isEditing ? (
                        <input
                          type="text"
                          placeholder="Ej: Juan Pérez"
                          value={editForm.operador || ''}
                          onChange={(e) =>
                            setEditForm({ ...editForm, operador: e.target.value })
                          }
                          className="w-36 px-2 py-1 rounded border border-slate-300 focus:outline-none focus:border-blue-500 text-xs text-slate-800 bg-white"
                        />
                      ) : (
                        linea.operador || <span className="text-slate-400 italic">No especificado</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                      {isEditing ? (
                        <select
                          value={editForm.whatsapp_group_id || ''}
                          onChange={(e) =>
                            setEditForm({ ...editForm, whatsapp_group_id: e.target.value || null })
                          }
                          className="w-44 px-2 py-1 rounded border border-slate-300 focus:outline-none focus:border-blue-500 text-xs bg-white text-slate-800"
                        >
                          <option value="">Global / Por Defecto</option>
                          {whatsappGroups.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      ) : (
                        (() => {
                          const g = whatsappGroups.find(x => x.id === linea.whatsapp_group_id);
                          return g ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-500 font-semibold">
                              <MessageSquare className="w-3.5 h-3.5" />
                              {g.name}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">Global / Por Defecto</span>
                          );
                        })()
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                      {isEditing ? (
                        <input
                          type="text"
                          placeholder="Ej: +56912345678"
                          value={editForm.whatsapp_phone || ''}
                          onChange={(e) =>
                            setEditForm({ ...editForm, whatsapp_phone: e.target.value })
                          }
                          className="w-36 px-2 py-1 rounded border border-slate-300 focus:outline-none focus:border-blue-500 text-xs text-slate-800 bg-white"
                        />
                      ) : (
                        linea.whatsapp_phone ? (
                          <span className="text-slate-700 font-medium">
                            {linea.whatsapp_phone}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">No asignado</span>
                        )
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-medium">
                      {isEditing ? (
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={handleUpdate}
                            disabled={saving}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"
                            title="Guardar"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1 text-slate-400 hover:bg-slate-100 rounded cursor-pointer"
                            title="Cancelar"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => startEdit(linea)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors cursor-pointer"
                            title="Editar"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeletingId(linea.id ?? null)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-slate-900 px-6 py-4 text-white flex justify-between items-center">
              <h3 className="font-bold text-sm tracking-wide uppercase flex items-center gap-2">
                <Cpu className="w-4 h-4 text-blue-400" />
                Nueva Línea de Proceso
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Código de la Línea *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: L1, EN-01"
                  value={createForm.codigo}
                  onChange={(e) => setCreateForm({ ...createForm, codigo: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Descripción / Nombre *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Línea de Envasado 1"
                  value={createForm.descripcion}
                  onChange={(e) => setCreateForm({ ...createForm, descripcion: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Tipo de Máquina
                </label>
                <input
                  type="text"
                  placeholder="Ej: Etiquetadora Rotativa, Llenadora"
                  value={createForm.tipo_maquina}
                  onChange={(e) => setCreateForm({ ...createForm, tipo_maquina: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Operador de la Línea
                </label>
                <input
                  type="text"
                  placeholder="Ej: Juan Pérez"
                  value={createForm.operador || ''}
                  onChange={(e) => setCreateForm({ ...createForm, operador: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Grupo de WhatsApp (Destinatario)
                </label>
                <select
                  value={createForm.whatsapp_group_id || ''}
                  onChange={(e) => setCreateForm({ ...createForm, whatsapp_group_id: e.target.value || null })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none bg-white"
                >
                  <option value="">Global / Por Defecto</option>
                  {whatsappGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Número de Teléfono Directo (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ej: +56912345678"
                  value={createForm.whatsapp_phone || ''}
                  onChange={(e) => setCreateForm({ ...createForm, whatsapp_phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Si se especifica, los reportes se enviarán a este número personal. Si se deja vacío, se enviará al grupo.
                </p>
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold text-slate-650 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {creating ? 'Creando...' : 'Crear Línea'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE DIALOG */}
      {deletingId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-bold text-slate-850 mb-2">¿Eliminar Línea de Proceso?</h3>
            <p className="text-sm text-slate-500 mb-6">
              Esta acción es irreversible y eliminará la línea del catálogo. Las planificaciones asociadas a esta línea podrían quedar sin referencia.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold text-slate-650 hover:bg-slate-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-650 hover:bg-red-700 text-white rounded-lg text-sm font-semibold shadow-sm cursor-pointer disabled:opacity-50"
              >
                {deleting ? 'Eliminando...' : 'Sí, Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
