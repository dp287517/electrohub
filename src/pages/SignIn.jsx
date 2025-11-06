import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { post } from "../lib/api.js";
import AuthCard from "../components/AuthCard.jsx";

export default function SignIn() {
  const navigate = useNavigate();
  const [hasBubbleToken, setHasBubbleToken] = useState(false);

  // Vérifie s’il y a un token Bubble dans le localStorage
  useEffect(() => {
    const token = localStorage.getItem("bubble_token");
    setHasBubbleToken(!!token);
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = form.get("email");
    const password = form.get("password");
    try {
      const { token } = await post("/api/auth/signin", { email, password });
      localStorage.setItem("eh_token", token);
      localStorage.setItem(
        "eh_user",
        JSON.stringify({ email, site: "Nyon", department: "Maintenance" })
      );
      navigate("/dashboard");
    } catch (err) {
      alert("Sign in failed: " + err.message);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to access your dashboard."
    >
      <form className="space-y-5" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            className="input mt-1"
            id="email"
            name="email"
            type="email"
            placeholder="you@company.com"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            className="input mt-1"
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            required
          />
        </div>

        {/* Menu déroulant External company */}
        <div>
          <label className="label" htmlFor="company">
            Company
          </label>
          <select
            id="company"
            name="company"
            className="input mt-1"
            defaultValue="haleon"
          >
            <option value="haleon">Haleon</option>
            <option value="external">External Company</option>
          </select>
        </div>

        <div className="flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" className="rounded" /> Remember me
          </label>
        </div>

        <button className="btn btn-primary w-full" type="submit">
          Sign in
        </button>

        {/* Bouton Connect with Haleon-tool */}
        {hasBubbleToken && (
          <button
            onClick={() => window.location.replace("/signin?token=" + localStorage.getItem("bubble_token"))}
            className="mt-4 w-full py-2 px-4 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all duration-300 animate-pulse"
          >
            Connect with Haleon-tool
          </button>
        )}

        {/* Bouton retour vers Haleon-tool */}
        <a
          href="https://haleon-tool.io"
          className="block mt-4 text-center text-sm text-gray-600 hover:text-gray-800 underline"
        >
          Return to Haleon-tool
        </a>
      </form>
    </AuthCard>
  );
}
