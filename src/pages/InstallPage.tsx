import { useState, useEffect } from "react";
import { Monitor, Smartphone, Tv, Download, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const InstallPage = () => {
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);

    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  const platforms = [
    {
      icon: Tv,
      name: "Android TV",
      steps: [
        "Abre Chrome en tu Android TV",
        "Navega a esta URL",
        "Presiona el menú (⋮) → 'Instalar app'",
        "La app aparecerá en tu launcher",
      ],
    },
    {
      icon: Monitor,
      name: "Samsung (Tizen)",
      steps: [
        "Abre el navegador de Samsung",
        "Navega a esta URL",
        "Añade a favoritos o pantalla de inicio",
        "Accede desde la pantalla principal",
      ],
    },
    {
      icon: Monitor,
      name: "LG (webOS)",
      steps: [
        "Abre el navegador web de LG",
        "Navega a esta URL",
        "Añade como marcador",
        "Accede rápidamente desde marcadores",
      ],
    },
    {
      icon: Tv,
      name: "Hisense (VIDAA)",
      steps: [
        "Abre el navegador VEWD/Opera de Hisense",
        "Escribe esta URL manualmente",
        "Guarda como marcador o favorito",
        "Accede desde marcadores cada vez",
      ],
    },
    {
      icon: Tv,
      name: "Philips / Otros Smart TV",
      steps: [
        "Busca el navegador web en tu TV",
        "Navega a esta URL",
        "Guarda como favorito/marcador",
        "Accede desde favoritos para usar la app",
      ],
    },
    {
      icon: Smartphone,
      name: "Android / iPhone",
      steps: [
        "Abre Chrome (Android) o Safari (iPhone)",
        "Navega a esta URL",
        "Android: Menú → 'Instalar app'",
        "iPhone: Compartir → 'Añadir a inicio'",
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 text-white p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate("/login")}
          className="mb-6 text-cyan-400 hover:text-cyan-300"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver al login
        </Button>

        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold mb-3 bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            Instalar Omnisync TV
          </h1>
          <p className="text-slate-400 text-lg">
            Instala la app en tu dispositivo para una experiencia completa
          </p>
        </div>

        {/* Install button for compatible browsers */}
        {deferredPrompt && !isInstalled && (
          <div className="flex justify-center mb-10">
            <Button
              onClick={handleInstall}
              size="lg"
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-lg px-8 py-6 rounded-xl shadow-lg shadow-cyan-500/25"
            >
              <Download className="w-5 h-5 mr-2" />
              Instalar Omnisync TV
            </Button>
          </div>
        )}

        {isInstalled && (
          <div className="flex justify-center mb-10">
            <div className="flex items-center gap-2 bg-green-500/20 text-green-400 px-6 py-3 rounded-xl border border-green-500/30">
              <Check className="w-5 h-5" />
              <span className="font-medium">¡App instalada correctamente!</span>
            </div>
          </div>
        )}

        {/* Platform instructions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {platforms.map((platform) => (
            <div
              key={platform.name}
              className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-2xl p-6 hover:border-cyan-500/30 transition-colors"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-cyan-500/10">
                  <platform.icon className="w-6 h-6 text-cyan-400" />
                </div>
                <h2 className="text-xl font-semibold">{platform.name}</h2>
              </div>
              <ol className="space-y-2">
                {platform.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-slate-300 text-sm">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>

        <p className="text-center text-slate-500 text-sm mt-10">
          Omnisync TV · Tu televisión en todas partes
        </p>
      </div>
    </div>
  );
};

export default InstallPage;
