import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({ where: { email: credentials.email } });
        if (!user || !user.password) return null;
        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;
        return user;
      },
    }),
  ],
  pages: {
    signIn: "/signin",
  },
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
