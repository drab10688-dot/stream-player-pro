import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Plus, Trash2, Send, Bell, Megaphone, Image } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface Ad {
  id: number;
  title: string;
  message: string;
  imageUrl: string;
  active: boolean;
  createdAt: string;
}

const AdminPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [ads, setAds] = useState<Ad[]>([
    {
      id: 1,
      title: 'Promoción Especial',
      message: '¡50% de descuento en el plan premium este mes!',
      imageUrl: '',
      active: true,
      createdAt: '2026-02-28',
    },
    {
      id: 2,
      title: 'Nuevo Contenido',
      message: 'Se han agregado 200 canales nuevos en HD',
      imageUrl: '',
      active: false,
      createdAt: '2026-02-27',
    },
  ]);

  const [newAd, setNewAd] = useState({ title: '', message: '', imageUrl: '' });
  const [showForm, setShowForm] = useState(false);

  const handleAdd = () => {
    if (!newAd.title.trim() || !newAd.message.trim()) {
      toast({ title: 'Error', description: 'Completa título y mensaje', variant: 'destructive' });
      return;
    }
    const ad: Ad = {
      id: Date.now(),
      title: newAd.title.trim(),
      message: newAd.message.trim(),
      imageUrl: newAd.imageUrl.trim(),
      active: true,
      createdAt: new Date().toISOString().split('T')[0],
    };
    setAds([ad, ...ads]);
    setNewAd({ title: '', message: '', imageUrl: '' });
    setShowForm(false);
    toast({ title: 'Publicidad creada', description: 'Se enviará a todos los usuarios' });
  };

  const toggleAd = (id: number) => {
    setAds(ads.map(ad => ad.id === id ? { ...ad, active: !ad.active } : ad));
  };

  const deleteAd = (id: number) => {
    setAds(ads.filter(ad => ad.id !== id));
    toast({ title: 'Eliminado', description: 'Publicidad eliminada correctamente' });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-border/50">
        <div className="container flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </Button>
            <div className="flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-accent" />
              <h1 className="font-display font-bold text-lg text-foreground">Gestión de Publicidad</h1>
            </div>
          </div>
          <Button
            onClick={() => setShowForm(!showForm)}
            className="gradient-primary text-primary-foreground gap-2"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nueva</span>
          </Button>
        </div>
      </header>

      <main className="container px-4 py-6 max-w-3xl space-y-6">
        {/* New Ad Form */}
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-2xl p-6 space-y-4"
          >
            <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Crear Notificación / Publicidad
            </h2>
            <Input
              placeholder="Título del aviso"
              value={newAd.title}
              onChange={(e) => setNewAd({ ...newAd, title: e.target.value })}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              maxLength={100}
            />
            <Textarea
              placeholder="Mensaje del aviso..."
              value={newAd.message}
              onChange={(e) => setNewAd({ ...newAd, message: e.target.value })}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground min-h-[100px]"
              maxLength={500}
            />
            <div className="relative">
              <Image className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="URL de imagen (opcional)"
                value={newAd.imageUrl}
                onChange={(e) => setNewAd({ ...newAd, imageUrl: e.target.value })}
                className="pl-10 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                maxLength={500}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" onClick={() => setShowForm(false)} className="text-muted-foreground">
                Cancelar
              </Button>
              <Button onClick={handleAdd} className="gradient-primary text-primary-foreground gap-2">
                <Send className="w-4 h-4" />
                Enviar a Usuarios
              </Button>
            </div>
          </motion.div>
        )}

        {/* Ads List */}
        <div className="space-y-3">
          <h2 className="font-display font-semibold text-foreground text-lg">
            Avisos Activos ({ads.filter(a => a.active).length})
          </h2>
          {ads.length === 0 ? (
            <div className="glass rounded-2xl p-12 text-center">
              <Megaphone className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No hay avisos publicados</p>
            </div>
          ) : (
            ads.map((ad, i) => (
              <motion.div
                key={ad.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`glass rounded-xl p-5 ${ad.active ? 'border-primary/30' : 'opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-display font-semibold text-foreground">{ad.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${ad.active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                        {ad.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{ad.message}</p>
                    <p className="text-xs text-muted-foreground mt-2">{ad.createdAt}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleAd(ad.id)}
                      className="text-muted-foreground hover:text-primary text-xs"
                    >
                      {ad.active ? 'Desactivar' : 'Activar'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteAd(ad.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminPage;
