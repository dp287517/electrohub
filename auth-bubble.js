// auth-bubble.js
import fetch from "node-fetch";
import jwt from "jsonwebtoken";

/**
 * 🔐 Vérifie le token d’un utilisateur Bubble via ton workflow Bubble sécurisé
 * Ce workflow doit renvoyer : { success: true, user: "email@domaine.com" }
 */
export async function verifyBubbleToken(bubbleToken) {
  if (!bubbleToken) throw new Error("Missing token");

  const verifyUrl =
    process.env.BUBBLE_VERIFY_URL ||
    "https://haleon-tool.io/api/1.1/wf/verify_token";

  const apiKey =
    process.env.BUBBLE_PRIVATE_KEY ||
    "851cbb99c81df43edd4f81942bdf5006";

  console.log("🌐 Verifying Bubble token via:", verifyUrl);

  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`, // Sécurité Bubble API
    },
    body: JSON.stringify({ token: bubbleToken }),
  });

  // Gestion d’erreur HTTP
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bubble verification failed (${res.status}): ${text}`);
  }

  let text = await res.text();
  console.log("🧾 Bubble raw response:", text);

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    console.error("❌ Impossible de parser la réponse JSON Bubble");
  }
  console.log("🔍 Bubble parsed response:", data);


  // ✅ Réponse attendue : { success: true, user: "email@domaine.com" }
  if (!data?.success || !data?.user) {
    throw new Error("Invalid Bubble response");
  }

  // Renvoie un objet utilisateur simplifié
  const email = String(data.user).trim().toLowerCase();
  const name = email.split("@")[0].replace(/[._-]+/g, " ");
  return {
    id: email,
    email,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    origin: "bubble",
  };
}

/**
 * 🧩 Crée un JWT local pour ElectroHub à partir des infos Bubble
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
