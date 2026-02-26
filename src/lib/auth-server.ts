import { auth as clerkAuth } from "@clerk/nextjs/server";
import { CLERK_DISABLED } from "@/lib/auth-config";

export async function auth() {
  if (CLERK_DISABLED) {
    return {
      userId: null,
      sessionId: null,
      orgId: null,
      actor: null,
      getToken: async () => null,
      has: () => false,
      redirectToSignIn: () => undefined,
      protect: async () => undefined,
      debug: () => undefined,
    };
  }

  return clerkAuth();
}
