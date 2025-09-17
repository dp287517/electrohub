"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [department, setDepartment] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, site, department }),
      });
      if (res.ok) router.push("/signin");
      else setError("Erreur lors de la création du compte");
    } catch (err) {
      setError("Erreur lors de la création du compte");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
        <h1 className="text-2xl font-bold mb-6 text-center">Sign Up for ElectroHub</h1>
        {error && <p className="text-red-500 mb-4">{error}</p>}
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-3 mb-4 border rounded"
            required
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 mb-4 border rounded"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 mb-4 border rounded"
            required
          />
          <input
            type="text"
            placeholder="Site (e.g., Nyon)"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            className="w-full p-3 mb-4 border rounded"
            required
          />
          <input
            type="text"
            placeholder="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="w-full p-3 mb-4 border rounded"
            required
          />
          <button type="submit" className="w-full bg-green-500 text-white p-3 rounded hover:bg-green-600">
            Sign Up
          </button>
        </form>
        <p className="mt-4 text-center">
          Have an account? <a href="/signin" className="text-blue-500">Sign In</a>
        </p>
      </div>
    </div>
  );
}
