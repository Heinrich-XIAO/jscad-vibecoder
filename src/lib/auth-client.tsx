"use client";

import type React from "react";

import {
  SignedIn as ClerkSignedIn,
  SignedOut as ClerkSignedOut,
  SignInButton as ClerkSignInButton,
  UserButton as ClerkUserButton,
  useAuth as useClerkAuth,
} from "@clerk/nextjs";
import { CLERK_DISABLED } from "@/lib/auth-config";

export function useAuth() {
  if (CLERK_DISABLED) {
    return {
      isLoaded: true,
      isSignedIn: false,
      userId: null,
      sessionId: null,
      actor: null,
      orgId: null,
      orgRole: null,
      orgSlug: null,
      has: () => false,
      signOut: async () => undefined,
      getToken: async () => null,
    };
  }

  return useClerkAuth();
}

export function SignedIn({ children }: { children: React.ReactNode }) {
  if (CLERK_DISABLED) return null;
  return <ClerkSignedIn>{children}</ClerkSignedIn>;
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  if (CLERK_DISABLED) return <>{children}</>;
  return <ClerkSignedOut>{children}</ClerkSignedOut>;
}

type SignInButtonProps = React.ComponentProps<typeof ClerkSignInButton>;

export function SignInButton(props: SignInButtonProps) {
  if (CLERK_DISABLED) {
    return <>{props.children ?? null}</>;
  }
  return <ClerkSignInButton {...props} />;
}

type UserButtonProps = React.ComponentProps<typeof ClerkUserButton>;

export function UserButton(props: UserButtonProps) {
  if (CLERK_DISABLED) return null;
  return <ClerkUserButton {...props} />;
}
