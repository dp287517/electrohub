import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export default function AuthCard({ title, subtitle, children }) {
  const navigate = useNavigate();
  const [hasHaleonToken, setHasHaleonToken] = useState(false);

  // 🧩 Étape 1 : détecte si un token Bubble est présent dans l’URL ou localStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incoming = params.get("token");

    if (incoming) {
      console.log("✅ Token Haleon reçu depuis l’URL :", incoming);
      localStorage.setItem("bubble_token", incoming);
      setHasHaleonToken(true);
      window.history.replaceState({}, "", window.location.pathname);
    } else {
      // Vérifie si un token Haleon existe déjà en localStorage
      const existing = localStorage.getItem("bubble_token");
      if (existing) {
        setHasHaleonToken(true);
      }
    }
  }, [navigate]);

  // 🧩 Étape 2 : connexion via Haleon
  async function handleBubbleLogin() {
    try {
      const token = localStorage.getItem("bubble_token");
      if (!token) {
        alert("Aucun token Haleon trouvé — connectez-vous d’abord via haleon-tool.io");
        return;
      }

      const res = await api.bubble.login(token);
      if (res?.ok) {
        console.log("✅ Connexion Haleon réussie :", res);
        localStorage.setItem("eh_token", res.jwt);
        localStorage.setItem("eh_user", JSON.stringify(res.user));
        navigate("/dashboard");
      } else {
        alert("Échec de la connexion via Haleon");
      }
    } catch (err) {
      console.error("❌ Erreur Haleon login :", err);
      alert("Erreur lors de la connexion via Haleon");
    }
  }

  return (
    <div className="container-narrow">
      <style>
        {`
          @keyframes pulseSlow {
            0%, 100% { transform: scale(1); box-shadow: 0 0 0px rgba(59,130,246,0.5); }
            50% { transform: scale(1.03); box-shadow: 0 0 20px rgba(59,130,246,0.4); }
          }
          .animate-pulse-slow {
            animation: pulseSlow 2.5s ease-in-out infinite;
          }
        `}
      </style>

      <div className="grid md:grid-cols-2 gap-10 py-12 items-center">
        {/* Section gauche */}
        <div className="hidden md:block">
          <div className="relative">
            <div className="absolute -inset-10 bg-gradient-to-br from-brand-100 via-white to-transparent rounded-[2rem] blur-2xl"></div>
            <div className="card p-8 relative">
              <h2 className="text-2xl font-semibold mb-4">
                Built for Electrical Excellence
              </h2>
              <p className="text-gray-600 leading-relaxed">
                ElectroHub centralizes ATEX, Obsolescence, Selectivity, Fault
                Level Assessment, and Arc Flash workflows. Secure, site-scoped
                data. Fast. Professional.
              </p>
              <ul className="mt-6 space-y-2 text-gray-700">
                <li>• Site & Department based access</li>
                <li>• Neon + Render ready</li>
                <li>• Modern, responsive UI</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Section droite (login) */}
        <div className="card p-8">
          <h1 className="text-3xl font-bold mb-2">{title}</h1>
          <p className="text-gray-600 mb-8">{subtitle}</p>

          {/* 🔥 Bouton Haleon Account dynamique — seulement si token détecté */}
          {hasHaleonToken && (
            <button
              onClick={handleBubbleLogin}
              className="w-full mb-6 py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 via-blue-700 to-blue-800 shadow-lg hover:shadow-xl hover:scale-[1.05] transition-all duration-200 animate-pulse-slow relative overflow-hidden"
            >
              <span className="relative z-10">Haleon-tool account</span>
              <span className="absolute inset-0 bg-gradient-to-r from-blue-400 via-blue-500 to-blue-700 opacity-0 hover:opacity-100 transition-opacity duration-300 rounded-xl"></span>
            </button>
          )}

          {children}
        </div>
      </div>
    </div>
  );
}
