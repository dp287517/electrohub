// auth-bubble.js
import fetch from "node-fetch";
import jwt from "jsonwebtoken";

/**
 * Vérifie le token d’un utilisateur Bubble via ton workflow Bubble sécurisé
 */
export async function verifyBubbleToken(bubbleToken) {
  if (!bubbleToken) throw new Error("Missing token");

  // ✅ URL Bubble en production
  const verifyUrl =
    process.env.BUBBLE_VERIFY_URL ||
    "https://haleon-tool.io/api/1.1/wf/verify_token";

  // 🔒 Clé API Bubble (ne pas exposer côté client)
  const apiKey =
    process.env.BUBBLE_PRIVATE_KEY || "851cbb99c81df43edd4f81942bdf5006";

  // Appel vers Bubble
  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`, // ✅ Auth sécurisée
    },
    body: JSON.stringify({ token: bubbleToken }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bubble verification failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  // ✅ Exemple attendu : { success: true, user: { email, name, id } }
  if (!data?.user?.email) throw new Error("Invalid Bubble response");

  return data.user;
}

/**
 * Crée un JWT local pour ElectroHub à partir des infos Bubble
 */
export function signLocalJWT(user) {
  const payload = {
    id: user.id || user.email,
    name: user.name || user.email,
    email: user.email,
    source: "bubble",
  };
  const secret = process.env.JWT_SECRET || "devsecret";
  return jwt.sign(payload, secret, { expiresIn: "2h" });
}
