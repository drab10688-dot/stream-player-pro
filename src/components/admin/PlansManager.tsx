import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Edit2, Save, X, Package, Tag } from 'lucide-react';
import { motion } from 'framer-motion';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  categories: string[];
  price: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

const PlansManager = () => {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', categories: '' as string, price: 0, sort_order: 0 });
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  const fetchPlans = async () => {
    const { data, error } = await (supabase
      .from('plans' as any)
      .select('*')
      .order('sort_order', { ascending: true }) as any);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setPlans((data as any[]) || []);
    }
    setLoading(false);
  };

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('channels')
      .select('category');
    if (data) {
      const unique = [...new Set(data.map((c: any) => c.category))].sort();
      setAvailableCategories(unique);
    }
  };

  useEffect(() => {
    fetchPlans();
    fetchCategories();
  }, []);

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Error', description: 'El nombre es requerido', variant: 'destructive' });
      return;
    }
    const categories = form.categories.split(',').map(c => c.trim()).filter(Boolean);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      categories,
      price: form.price,
      sort_order: form.sort_order,
    };

    if (editingId) {
      const { error } = await (supabase.from('plans' as any).update(payload as any) as any).eq('id', editingId);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Plan actualizado' });
    } else {
      const { error } = await (supabase.from('plans' as any).insert(payload as any) as any);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Plan creado' });
    }
    resetForm();
    fetchPlans();
  };

  const resetForm = () => {
    setForm({ name: '', description: '', categories: '', price: 0, sort_order: 0 });
    setShowForm(false);
    setEditingId(null);
  };

  const handleEdit = (p: Plan) => {
    setForm({
      name: p.name,
      description: p.description || '',
      categories: p.categories.join(', '),
      price: p.price,
      sort_order: p.sort_order,
    });
    setEditingId(p.id);
    setShowForm(true);
  };

  const toggleActive = async (p: Plan) => {
    const { error } = await (supabase.from('plans' as any).update({ is_active: !p.is_active } as any) as any).eq('id', p.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: p.is_active ? 'Plan desactivado' : 'Plan activado' });
    fetchPlans();
  };

  const handleDelete = async (id: string) => {
    const { error } = await (supabase.from('plans' as any).delete() as any).eq('id', id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Plan eliminado' });
    fetchPlans();
  };

  const addCategory = (cat: string) => {
    const current = form.categories.split(',').map(c => c.trim()).filter(Boolean);
    if (!current.includes(cat)) {
      setForm({ ...form, categories: [...current, cat].join(', ') });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-xl text-foreground">Planes ({plans.length})</h2>
        <Button onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: '', description: '', categories: '', price: 0, sort_order: 0 }); }} className="gradient-primary text-primary-foreground gap-2">
          <Plus className="w-4 h-4" /> Nuevo Plan
        </Button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Nombre del plan (ej: Básico, Premium)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={50} />
            <Input placeholder="Descripción (opcional)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={200} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Precio</label>
              <Input type="number" min={0} step={0.01} value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} className="bg-secondary border-border text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Orden</label>
              <Input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} className="bg-secondary border-border text-foreground" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Categorías incluidas (separadas por coma)</label>
            <Input placeholder="Deportes, Películas, Noticias" value={form.categories} onChange={e => setForm({ ...form, categories: e.target.value })} className="bg-secondary border-border text-foreground" />
          </div>
          {availableCategories.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Categorías existentes (click para agregar)</label>
              <div className="flex flex-wrap gap-1.5">
                {availableCategories.map(cat => (
                  <Badge key={cat} variant="outline" className="cursor-pointer hover:bg-primary/10 text-xs" onClick={() => addCategory(cat)}>
                    <Tag className="w-3 h-3 mr-1" /> {cat}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={resetForm} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
            <Button onClick={handleSave} className="gradient-primary text-primary-foreground"><Save className="w-4 h-4 mr-1" /> {editingId ? 'Actualizar' : 'Crear'}</Button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : plans.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay planes. Crea uno para organizar las parrillas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className={`glass rounded-xl p-4 ${!p.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${p.is_active ? 'bg-primary/20' : 'bg-muted'}`}>
                    <Package className={`w-5 h-5 ${p.is_active ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-sm">{p.name}</p>
                      {p.price > 0 && <span className="text-xs text-primary font-mono">${p.price}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.categories.map(cat => (
                        <Badge key={cat} variant="secondary" className="text-[10px] py-0">{cat}</Badge>
                      ))}
                      {p.categories.length === 0 && <span className="text-xs text-muted-foreground">Sin categorías</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(p)} className="text-xs text-muted-foreground">
                    {p.is_active ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(p)} className="text-muted-foreground hover:text-primary">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PlansManager;
