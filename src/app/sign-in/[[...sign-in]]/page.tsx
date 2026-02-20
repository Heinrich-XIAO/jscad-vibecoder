"use client";

import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-lg">
        <h1 className="text-center text-xl font-semibold mb-6 text-foreground">
          Welcome back to OpenMech
        </h1>
        <SignIn />
      </div>
    </div>
  );
}
