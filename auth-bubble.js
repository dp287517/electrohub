// auth-bubble.js
import fetch from "node-fetch";
import jwt from "jsonwebtoken";

/**
 * Vérifie le token d’un utilisateur Bubble via un workflow Bubble sécurisé
 * (à adapter à ton endpoint Bubble API)
 */
export async function verifyBubbleToken(bubbleToken) {
  if (!bubbleToken) throw new Error("Missing token");

  // ⚙️ Remplace cette URL par ton workflow Bubble
  const verifyUrl = process.env.BUBBLE_VERIFY_URL || "https://yourapp.bubbleapps.io/api/1.1/wf/verify_token";

  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: bubbleToken }),
  });

  if (!res.ok) throw new Error(`Bubble verification failed (${res.status})`);
  const data = await res.json();

  // ✅ Exemple de réponse attendue de Bubble :
  // { success: true, user: { email, name, id } }

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
