import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Search, Users, Save, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Empleado {
  id?: number;
  nombre: string;
  linea_proceso: string;
  labor: string;
}

interface EmpleadosManagerProps {
  onShowToast?: (message: string, type: 'success' | 'error') => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_FORM: Empleado = { nombre: '', linea_proceso: '', labor: '' };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmpleadosManager({ onShowToast }: EmpleadosManagerProps) {
  // ---- state ---------------------------------------------------------------
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');

  // create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<Empleado>({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);

  // inline edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Empleado>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // delete confirmation
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ---- helpers -------------------------------------------------------------
  const toast = useCallback(
    (message: string, type: 'success' | 'error') => {
      onShowToast?.(message, type);
    },
    [onShowToast],
  );

  // ---- fetch ---------------------------------------------------------------
  const fetchEmpleados = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/empleados');
      if (!res.ok) throw new Error('Error al cargar operadores');
      const data: Empleado[] = await res.json();
      setEmpleados(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchEmpleados();
  }, [fetchEmpleados]);

  // ---- create --------------------------------------------------------------
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/empleados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      if (!res.ok) throw new Error('Error al crear operador');
      toast('Operador creado correctamente', 'success');
      setShowCreateModal(false);
      setCreateForm({ ...EMPTY_FORM });
      await fetchEmpleados();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast(msg, 'error');
    } finally {
      setCreating(false);
    }
  };

  // ---- update --------------------------------------------------------------
  const startEdit = (emp: Empleado) => {
    setEditingId(emp.id ?? null);
    setEditForm({ nombre: emp.nombre, linea_proceso: emp.linea_proceso, labor: emp.labor });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ ...EMPTY_FORM });
  };

  const handleUpdate = async () => {
    if (editingId == null) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/empleados/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error('Error al actualizar operador');
      toast('Operador actualizado correctamente', 'success');
      cancelEdit();
      await fetchEmpleados();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ---- delete --------------------------------------------------------------
  const confirmDelete = async () => {
    if (deletingId == null) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/empleados/${deletingId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar operador');
      toast('Operador eliminado correctamente', 'success');
      setDeletingId(null);
      await fetchEmpleados();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast(msg, 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ---- filter --------------------------------------------------------------
  const filtered = empleados.filter((emp) => {
    const q = search.toLowerCase();
    return (
      emp.nombre.toLowerCase().includes(q) ||
      emp.linea_proceso.toLowerCase().includes(q) ||
      emp.labor.toLowerCase().includes(q)
    );
  });

  // ---- render helpers ------------------------------------------------------
  const inputClass =
    'w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  const btnPrimary =
    'inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-500 border border-transparent rounded-md shadow-sm hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors';

  const btnSecondary =
    'inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors';

  // =========================================================================
  // JSX
  // =========================================================================

  return (
    <div className="space-y-6">
      {/* ---- Header -------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              <span>Operadores</span>
            </h2>
            <p className="text-sm text-slate-500">
              <span>Gestiona los operadores de línea</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          className={btnPrimary}
          onClick={() => setShowCreateModal(true)}
        >
          <Plus className="w-4 h-4 mr-2" />
          <span>Agregar Operador</span>
        </button>
      </div>

      {/* ---- Search bar ---------------------------------------------------- */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar por nombre, línea o labor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg shadow-sm text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
        />
      </div>

      {/* ---- Error state --------------------------------------------------- */}
      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
          <span>{error}</span>
        </div>
      )}

      {/* ---- Loading state ------------------------------------------------- */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
            <span className="text-sm text-slate-500">Cargando operadores…</span>
          </div>
        </div>
      )}

      {/* ---- Empty state --------------------------------------------------- */}
      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 bg-slate-100 rounded-full mb-4">
            <Users className="w-10 h-10 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700">
            <span>{search ? 'Sin resultados' : 'No hay operadores'}</span>
          </h3>
          <p className="text-sm text-slate-500 mt-1 max-w-xs">
            <span>
              {search
                ? 'Intenta con otro término de búsqueda.'
                : 'Agrega un operador para empezar.'}
            </span>
          </p>
        </div>
      )}

      {/* ---- Table --------------------------------------------------------- */}
      {!loading && filtered.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <span>#</span>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <span>Nombre</span>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <span>Línea Proceso</span>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <span>Labor</span>
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <span>Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {filtered.map((emp, idx) => {
                const isEditing = editingId === emp.id;
                return (
                  <tr
                    key={emp.id ?? idx}
                    className="hover:bg-slate-50/60 transition-colors"
                  >
                    {/* # */}
                    <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">
                      <span>{idx + 1}</span>
                    </td>

                    {/* Nombre */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          value={editForm.nombre}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, nombre: e.target.value }))
                          }
                          className={inputClass}
                          autoFocus
                        />
                      ) : (
                        <span className="text-sm font-medium text-slate-800">
                          {emp.nombre}
                        </span>
                      )}
                    </td>

                    {/* Línea Proceso */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          value={editForm.linea_proceso}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              linea_proceso: e.target.value,
                            }))
                          }
                          className={inputClass}
                        />
                      ) : (
                        <span className="text-sm text-slate-600">
                          {emp.linea_proceso}
                        </span>
                      )}
                    </td>

                    {/* Labor */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          value={editForm.labor}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, labor: e.target.value }))
                          }
                          className={inputClass}
                        />
                      ) : (
                        <span className="text-sm text-slate-600">{emp.labor}</span>
                      )}
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <div className="inline-flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={handleUpdate}
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded-md transition-colors disabled:opacity-50"
                              title="Guardar"
                            >
                              <Save className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-md transition-colors"
                              title="Cancelar"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(emp)}
                              className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-md transition-colors"
                              title="Editar"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingId(emp.id ?? null)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Registro count ------------------------------------------------ */}
      {!loading && empleados.length > 0 && (
        <div className="text-xs text-slate-400 text-right">
          <span>
            {filtered.length} de {empleados.length} operador
            {empleados.length !== 1 ? 'es' : ''}
          </span>
        </div>
      )}

      {/* ================================================================== */}
      {/* Create Modal                                                       */}
      {/* ================================================================== */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">
                <span>Nuevo Operador</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateForm({ ...EMPTY_FORM });
                }}
                className="text-slate-400 hover:text-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                  <span>Nombre *</span>
                </label>
                <input
                  required
                  value={createForm.nombre}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, nombre: e.target.value }))
                  }
                  className={inputClass}
                  placeholder="Ej: Juan Pérez"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                  <span>Línea de Proceso *</span>
                </label>
                <input
                  required
                  value={createForm.linea_proceso}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, linea_proceso: e.target.value }))
                  }
                  className={inputClass}
                  placeholder="Ej: Línea 1"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                  <span>Labor *</span>
                </label>
                <input
                  required
                  value={createForm.labor}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, labor: e.target.value }))
                  }
                  className={inputClass}
                  placeholder="Ej: Empaque"
                />
              </div>

              <div className="pt-4 flex justify-end space-x-3 border-t border-slate-200 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateForm({ ...EMPTY_FORM });
                  }}
                  className={btnSecondary}
                >
                  <span>Cancelar</span>
                </button>
                <button type="submit" disabled={creating} className={btnPrimary}>
                  {creating ? (
                    <span>Guardando…</span>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      <span>Guardar</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* Delete Confirmation Dialog                                         */}
      {/* ================================================================== */}
      {deletingId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-full">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">
                  <span>Eliminar Operador</span>
                </h3>
              </div>
              <p className="text-sm text-slate-600">
                <span>
                  ¿Estás seguro de que deseas eliminar este operador? Esta acción no
                  se puede deshacer.
                </span>
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeletingId(null)}
                  className={btnSecondary}
                >
                  <span>Cancelar</span>
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={confirmDelete}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-red-500 border border-transparent rounded-md shadow-sm hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 transition-colors"
                >
                  {deleting ? (
                    <span>Eliminando…</span>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      <span>Eliminar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
