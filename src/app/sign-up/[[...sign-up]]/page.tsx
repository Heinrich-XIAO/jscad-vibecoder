"use client";

import { SignUp } from "@clerk/nextjs";
import { CLERK_DISABLED } from "@/lib/auth-config";

export default function SignUpPage() {
  if (CLERK_DISABLED) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-lg">
          <h1 className="text-center text-xl font-semibold mb-3 text-foreground">Clerk Disabled</h1>
          <p className="text-center text-sm text-muted-foreground">
            Authentication is disabled for this environment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-lg">
        <h1 className="text-center text-xl font-semibold mb-6 text-foreground">
          Create your OpenMech account
        </h1>
        <SignUp />
      </div>
    </div>
  );
}
