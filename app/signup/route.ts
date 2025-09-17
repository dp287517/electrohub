import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const { email, password, name, site, department } = await request.json();
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { 
        email, 
        name, 
        password: hashedPassword, 
        site, 
        department,
        plan_tier: 1  // Default pour nouveaux users
      },
    });
    return NextResponse.json({ success: true, userId: user.id }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: "Erreur création compte" }, { status: 500 });
  }
}
