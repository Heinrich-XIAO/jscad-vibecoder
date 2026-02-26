import Link from "next/link";
import { auth } from "@/lib/auth-server";
import { ArrowRight, Box, LogIn } from "lucide-react";
import DashboardPage from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { userId } = await auth();

  if (userId) {
    return <DashboardPage />;
  }

  return (
    <main className="min-h-screen bg-background px-6">
      <section className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center py-10">
        <div className="w-full rounded-3xl border border-border bg-card/80 p-8 shadow-xl backdrop-blur-sm sm:p-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <Box className="h-6 w-6 text-primary" />
            </div>
            <span className="text-lg font-semibold">OpenMech</span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            AI-powered CAD for fast mechanical ideas.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Build parametric 3D parts in minutes. Sign in to create projects, iterate with AI,
            and export for printing.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <LogIn className="h-4 w-4" />
              Login
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-5 py-2.5 font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Getting Started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
