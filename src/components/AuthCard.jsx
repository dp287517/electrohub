import { api } from "../lib/api";
import { useNavigate } from "react-router-dom";

export default function AuthCard({ title, subtitle, children }) {
  const navigate = useNavigate();

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

  return (
    <div className="container-narrow">
      <div className="grid md:grid-cols-2 gap-10 py-12 items-center">
        <div className="hidden md:block">
          <div className="relative">
            <div className="absolute -inset-10 bg-gradient-to-br from-brand-100 via-white to-transparent rounded-[2rem] blur-2xl"></div>
            <div className="card p-8 relative">
              <h2 className="text-2xl font-semibold mb-4">Built for Electrical Excellence</h2>
              <p className="text-gray-600 leading-relaxed">
                ElectroHub centralizes ATEX, Obsolescence, Selectivity, Fault Level Assessment, and Arc Flash workflows.
              </p>
              <ul className="mt-6 space-y-2 text-gray-700">
                <li>• Site & Department based access</li>
                <li>• Neon + Render ready</li>
                <li>• Modern, responsive UI</li>
              </ul>
            </div>
          </div>
        </div>

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
