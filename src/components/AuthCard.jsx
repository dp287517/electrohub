import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export default function AuthCard({ title, subtitle, children }) {
  const navigate = useNavigate();

  // 🧩 Étape 1 : détecte si un token Bubble est présent dans l’URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incoming = params.get("token");

    if (incoming) {
      console.log("✅ Token Bubble reçu depuis l’URL :", incoming);

      // 1️⃣ Enregistre le token côté ElectroHub
      localStorage.setItem("bubble_token", incoming);

      // 2️⃣ (Optionnel) Login automatique via Bubble — décommenter si tu veux activer
      /*
      (async () => {
        try {
          const res = await api.bubble.login(incoming);
          if (res?.ok) {
            localStorage.setItem("eh_token", res.jwt);
            localStorage.setItem("eh_user", JSON.stringify(res.user));
            // Nettoie l’URL et redirige
            window.history.replaceState({}, "", window.location.pathname);
            navigate("/dashboard");
          }
        } catch (e) {
          console.error("Auto Bubble login failed", e);
        }
      })();
      */

      // 3️⃣ Nettoie l’URL pour ne pas laisser ?token=... visible
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [navigate]);

  // 🧩 Étape 2 : bouton manuel pour se connecter via Bubble
  async function handleBubbleLogin() {
    try {
      const token = localStorage.getItem("bubble_token");
      if (!token) {
        alert("Aucun token Bubble trouvé");
        return;
      }

      const res = await api.bubble.login(token);
      if (res?.ok) {
        console.log("✅ Connexion Bubble réussie :", res);
        localStorage.setItem("eh_token", res.jwt);
        localStorage.setItem("eh_user", JSON.stringify(res.user));
        navigate("/dashboard");
      } else {
        alert("Échec de la connexion via Bubble");
      }
    } catch (err) {
      console.error("❌ Erreur Bubble login :", err);
      alert("Erreur lors de la connexion via Bubble");
    }
  }

  // 🧩 UI
  return (
    <div className="container-narrow">
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
          {children}

          {/* Bouton Bubble */}
          <button
            onClick={handleBubbleLogin}
            className="mt-4 w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Se connecter via Bubble
          </button>
        </div>
      </div>
    </div>
  );
}
