import React, { useState, useEffect, useRef } from 'react';
import { X, Save } from 'lucide-react';
import { Product, TipoEmpaqueSecundario, TipoEnvasePrimario, TipoTapa } from '../types';

interface ProductFormProps {
  product?: Product;
  onSave: (product: Omit<Product, 'id'>) => Promise<void>;
  onClose: () => void;
  tiposEmpaque?: TipoEmpaqueSecundario[];
  tiposEnvasePrimario?: TipoEnvasePrimario[];
  tiposTapa?: TipoTapa[];
}

export function ProductForm({ product, onSave, onClose, tiposEmpaque = [], tiposEnvasePrimario = [], tiposTapa = [] }: ProductFormProps) {
  const [formData, setFormData] = useState({
    sku: '',
    item_name: '',
    business_line: '',
    family: '',
    ean13: '',
    dun14: '',
    isp: '',
    marca: '',
    caducidad: '',
    activo: true,
    termocontraible_default: false,
    envase_secundario_default: false,
    envase_secundario_tipo: 'NO APLICA',
    envase_primario_tipo: 'BOTELLA',
    tapa_tipo: 'NO APLICA',
    cant_grupal: '',
    cant_individual: '',
    formato: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [isPrimarioDropdownOpen, setIsPrimarioDropdownOpen] = useState(false);
  const [primarioSearchQuery, setPrimarioSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [isTapaDropdownOpen, setIsTapaDropdownOpen] = useState(false);
  const [tapaSearchQuery, setTapaSearchQuery] = useState("");
  const tapaDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsPrimarioDropdownOpen(false);
      }
      if (tapaDropdownRef.current && !tapaDropdownRef.current.contains(event.target as Node)) {
        setIsTapaDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (product) {
      setFormData({
        sku: product.sku || '',
        item_name: product.item_name || '',
        business_line: product.business_line || '',
        family: product.family || '',
        ean13: product.ean13 || '',
        dun14: product.dun14 || '',
        isp: product.isp || '',
        marca: product.marca || '',
        caducidad: product.caducidad ? product.caducidad.toString() : '',
        activo: product.activo ?? true,
        termocontraible_default: !!(product.envase_secundario_default ?? product.termocontraible_default),
        envase_secundario_default: !!(product.envase_secundario_default ?? product.termocontraible_default),
        envase_secundario_tipo: product.envase_secundario_tipo || (product.envase_secundario_default === 1 || product.termocontraible_default === 1 ? 'TERMOCONTRAIBLE' : 'NO APLICA'),
        envase_primario_tipo: product.envase_primario_tipo || 'BOTELLA',
        tapa_tipo: product.tapa_tipo || 'NO APLICA',
        cant_grupal: product.cant_grupal !== undefined && product.cant_grupal !== null ? product.cant_grupal.toString() : '',
        cant_individual: product.cant_individual !== undefined && product.cant_individual !== null ? product.cant_individual.toString() : '',
        formato: product.formato || ''
      });
    }
  }, [product]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => {
        const next = { ...prev, [name]: checked };
        if (name === 'envase_secundario_default' || name === 'termocontraible_default') {
          next.envase_secundario_default = checked;
          next.termocontraible_default = checked;
        }
        return next;
      });
    } else {
      const val = name === 'marca' ? value.toUpperCase() : value;
      setFormData(prev => {
        const next = { ...prev, [name]: val };
        if (name === 'envase_secundario_tipo') {
          const hasSecondary = val !== 'NO APLICA';
          next.envase_secundario_default = hasSecondary;
          next.termocontraible_default = hasSecondary;
        }
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const submitData: Omit<Product, 'id'> = {
        ...formData,
        caducidad: formData.caducidad ? parseInt(formData.caducidad, 10) : undefined,
        cant_grupal: formData.cant_grupal ? parseInt(formData.cant_grupal, 10) : 0,
        cant_individual: formData.cant_individual ? parseInt(formData.cant_individual, 10) : 0,
        formato: formData.formato || ''
      };
      await onSave(submitData);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al guardar el producto');
    } finally {
      setLoading(false);
    }
  };

  const empaquesList = tiposEmpaque && tiposEmpaque.length > 0
    ? tiposEmpaque
    : [
        { nombre: 'NO APLICA', requiere_empaque_grupal: 0 },
        { nombre: 'TERMOCONTRAIBLE', requiere_empaque_grupal: 1 },
        { nombre: 'CAJA', requiere_empaque_grupal: 1 }
      ];

  const envasesPrimariosList = React.useMemo(() => {
    const list = tiposEnvasePrimario && tiposEnvasePrimario.length > 0 ? tiposEnvasePrimario : [{ nombre: 'BOTELLA' }, { nombre: 'BIDÓN' }, { nombre: 'DOYPACK' }];
    return list.filter(t => (t.activo !== 0) || (t.nombre === formData.envase_primario_tipo));
  }, [tiposEnvasePrimario, formData.envase_primario_tipo]);

  const tapasList = React.useMemo(() => {
    const list = tiposTapa && tiposTapa.length > 0 ? [...tiposTapa] : [{ nombre: 'NO APLICA' }];
    if (!list.some(t => t.nombre === 'NO APLICA')) {
      list.unshift({ nombre: 'NO APLICA', codigo: '' });
    }
    return list.filter(t => (t.activo !== 0) || (t.nombre === formData.tapa_tipo) || (t.nombre === 'NO APLICA'));
  }, [tiposTapa, formData.tapa_tipo]);

  const selectedEnvase = envasesPrimariosList.find(t => t.nombre === formData.envase_primario_tipo);
  const selectedLabel = selectedEnvase
    ? (selectedEnvase.codigo ? `${selectedEnvase.codigo} ${selectedEnvase.nombre}` : selectedEnvase.nombre)
    : (formData.envase_primario_tipo || 'BOTELLA');

  const selectedTapa = tapasList.find(t => t.nombre === formData.tapa_tipo);
  const selectedTapaLabel = selectedTapa
    ? (selectedTapa.codigo ? `${selectedTapa.codigo} ${selectedTapa.nombre}` : selectedTapa.nombre)
    : (formData.tapa_tipo || 'NO APLICA');

  const filteredEnvases = envasesPrimariosList.filter(tipo => {
    const label = tipo.codigo ? `${tipo.codigo} ${tipo.nombre}` : tipo.nombre;
    return label.toLowerCase().includes(primarioSearchQuery.toLowerCase());
  });

  const filteredTapas = tapasList.filter(tipo => {
    const label = tipo.codigo ? `${tipo.codigo} ${tipo.nombre}` : tipo.nombre;
    return label.toLowerCase().includes(tapaSearchQuery.toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">
            {product ? 'Editar Producto' : 'Nuevo Producto'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">SKU *</label>
            <input 
              required
              name="sku"
              value={formData.sku}
              onChange={handleChange}
              disabled={!!product} // Typically shouldn't edit SKU once created
              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500 text-sm"
              placeholder="Ej: AGL40"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Nombre del Item *</label>
            <input 
              required
              name="item_name"
              value={formData.item_name}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
              placeholder="Ej: LUBRICANTE SPRAY"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Línea de Negocio</label>
              <input 
                name="business_line"
                value={formData.business_line}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Ej: Automotriz"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Familia</label>
              <input 
                name="family"
                value={formData.family}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Ej: Lubricantes"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">EAN 13</label>
            <input 
              name="ean13"
              value={formData.ean13}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
              placeholder="Opcional"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">DUN 14</label>
            <input 
              name="dun14"
              value={formData.dun14}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
              placeholder="Opcional"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1" translate="no">ISP</label>
              <input 
                name="isp"
                value={formData.isp}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono uppercase"
                placeholder="Código alfanumérico"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Marca</label>
              <input 
                name="marca"
                value={formData.marca}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm uppercase"
                placeholder="Opcional"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Caducidad (Días)</label>
              <input 
                name="caducidad"
                type="number"
                min="0"
                value={formData.caducidad}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Ej: 360"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Cant. Grupal</label>
              <input 
                name="cant_grupal"
                type="number"
                min="0"
                value={formData.cant_grupal}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Ej: 10"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Cant. Individual</label>
              <input 
                name="cant_individual"
                type="number"
                min="0"
                value={formData.cant_individual}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Ej: 1"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Formato</label>
              <input 
                name="formato"
                type="text"
                value={formData.formato}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Ej: 5 LT, 650 CC"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4">
            <div className="relative" ref={dropdownRef}>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Envase Primario
              </label>
              <button
                type="button"
                onClick={() => {
                  setIsPrimarioDropdownOpen(!isPrimarioDropdownOpen);
                  setPrimarioSearchQuery("");
                }}
                className="flex items-center justify-between w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold cursor-pointer text-left h-[30px]"
              >
                <span className="truncate">{selectedLabel}</span>
                <span className="text-slate-400 ml-1">▼</span>
              </button>

              {isPrimarioDropdownOpen && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden flex flex-col max-h-[280px]">
                  <div className="p-1.5 border-b border-slate-100 bg-slate-50">
                    <input
                      type="text"
                      placeholder="Buscar envase..."
                      value={primarioSearchQuery}
                      onChange={(e) => setPrimarioSearchQuery(e.target.value)}
                      className="w-full px-2 py-1 border border-slate-200 rounded text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                      autoFocus
                    />
                  </div>
                  <div className="overflow-y-auto max-h-[220px] divide-y divide-slate-50">
                    {filteredEnvases.length > 0 ? (
                      filteredEnvases.map((tipo) => {
                        const optLabel = tipo.codigo ? `${tipo.codigo} ${tipo.nombre}` : tipo.nombre;
                        const isSelected = tipo.nombre === formData.envase_primario_tipo;
                        return (
                          <button
                            key={tipo.id || tipo.nombre}
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, envase_primario_tipo: tipo.nombre }));
                              setIsPrimarioDropdownOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-left text-xs font-semibold transition-colors truncate block ${
                              isSelected
                                ? "bg-blue-600 text-white"
                                : "text-slate-700 hover:bg-slate-50 cursor-pointer"
                            }`}
                          >
                            {optLabel}
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-2 text-xs text-slate-400 text-center font-semibold">
                        No se encontraron envases
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="envase_secundario_tipo" className="block text-xs font-bold text-slate-700 mb-1">
                Envase Secundario
              </label>
              <select
                id="envase_secundario_tipo"
                name="envase_secundario_tipo"
                value={formData.envase_secundario_tipo}
                onChange={handleChange}
                className="block w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-800 focus:ring-blue-500 focus:border-blue-500 font-semibold"
              >
                {empaquesList.map((tipo) => (
                  <option key={tipo.id || tipo.nombre} value={tipo.nombre}>
                    {tipo.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="relative" ref={tapaDropdownRef}>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Tipo de Tapa
              </label>
              <button
                type="button"
                onClick={() => {
                  setIsTapaDropdownOpen(!isTapaDropdownOpen);
                  setTapaSearchQuery("");
                }}
                className="flex items-center justify-between w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold cursor-pointer text-left h-[30px]"
              >
                <span className="truncate">{selectedTapaLabel}</span>
                <span className="text-slate-400 ml-1">▼</span>
              </button>

              {isTapaDropdownOpen && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden flex flex-col max-h-[280px]">
                  <div className="p-1.5 border-b border-slate-100 bg-slate-50">
                    <input
                      type="text"
                      placeholder="Buscar tapa..."
                      value={tapaSearchQuery}
                      onChange={(e) => setTapaSearchQuery(e.target.value)}
                      className="w-full px-2 py-1 border border-slate-200 rounded text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                      autoFocus
                    />
                  </div>
                  <div className="overflow-y-auto max-h-[220px] divide-y divide-slate-50">
                    {filteredTapas.length > 0 ? (
                      filteredTapas.map((tipo) => {
                        const optLabel = tipo.codigo ? `${tipo.codigo} ${tipo.nombre}` : tipo.nombre;
                        const isSelected = tipo.nombre === formData.tapa_tipo;
                        return (
                          <button
                            key={tipo.id || tipo.nombre}
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, tapa_tipo: tipo.nombre }));
                              setIsTapaDropdownOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-left text-xs font-semibold transition-colors truncate block ${
                              isSelected
                                ? "bg-blue-600 text-white"
                                : "text-slate-700 hover:bg-slate-50 cursor-pointer"
                            }`}
                          >
                            {optLabel}
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-2 text-xs text-slate-400 text-center font-semibold">
                        No se encontraron tapas
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div></div>
          </div>

          <div className="flex items-center pt-2">
            <input
              id="activo"
              name="activo"
              type="checkbox"
              checked={formData.activo}
              onChange={handleChange}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded cursor-pointer"
            />
            <label htmlFor="activo" className="ml-2 block text-xs font-semibold text-slate-700 cursor-pointer">
              Producto Activo
            </label>
          </div>

            <div className="pt-4 flex justify-end space-x-3 border-t border-slate-200 mt-6">
            <button 
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors shadow-sm"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 border border-transparent rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-400 flex items-center shadow-sm transition-colors"
            >
              {loading ? 'Guardando...' : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Guardar
                </>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
