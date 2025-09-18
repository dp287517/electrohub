import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sign } from "jsonwebtoken";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const token = sign(
      { id: user.id.toString(), email: user.email, site: user.site, department: user.department, plan_tier: user.plan_tier },
      process.env.AUTH_SECRET || "super-secret-key",
      { expiresIn: "1h" }
    );
    return NextResponse.json({ token, user: { id: user.id, email: user.email, site: user.site, department: user.department } });
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de la connexion" }, { status: 500 });
  }
}
