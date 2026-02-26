import Link from "next/link";
import { auth } from "@/lib/auth-server";
import { CLERK_DISABLED } from "@/lib/auth-config";
import { ArrowRight, Box, Zap, Bot, Download, Settings, Play, Github } from "lucide-react";
import DashboardPage from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { userId } = await auth();

  if (userId) {
    return <DashboardPage />;
  }

  return (
    <main className="min-h-screen bg-background">
      <nav className="flex h-16 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <Box className="h-5 w-5 text-primary" />
          </div>
          <span className="font-bold text-lg">OpenMech</span>
        </div>
        <div className="flex items-center gap-4">
          {CLERK_DISABLED && (
            <Link
              href="/playground"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Playground
            </Link>
          )}
          {!CLERK_DISABLED && (
            <Link
              href="/sign-in"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Login
            </Link>
          )}
        </div>
      </nav>

      <section className="flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            AI-powered CAD for
            <span className="text-primary"> mechanical ideas</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground sm:text-xl max-w-2xl mx-auto">
            Build parametric 3D parts in minutes. Describe what you want, 
            AI generates the code, you export for printing.
          </p>
          
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
            {CLERK_DISABLED ? (
              <Link
                href="/playground"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-lg font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Play className="h-5 w-5" />
                Try Playground
              </Link>
            ) : (
              <Link
                href="/sign-up"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-lg font-medium text-primary-foreground hover:bg-primary/90"
              >
                Sign Up Free
              </Link>
            )}
            <Link
              href={CLERK_DISABLED ? "/playground" : "/sign-in"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-6 py-3 text-lg font-medium hover:bg-secondary"
            >
              {CLERK_DISABLED ? "Try Playground" : "Sign In"}
            </Link>
            <Link
              href="https://github.com/Heinrich-XIAO/openmech"
              target="_blank"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-6 py-3 text-lg font-medium hover:bg-secondary"
            >
              <Github className="h-5 w-5" />
              GitHub
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-muted/30 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-bold text-center mb-12">How it works</h2>
          <div className="grid gap-8 sm:grid-cols-3">
            <div className="flex flex-col items-center text-center">
              <div className="rounded-full bg-primary/10 p-4 mb-4">
                <Bot className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">1. Describe</h3>
              <p className="text-sm text-muted-foreground">
                Tell the AI what you want to build in plain English
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="rounded-full bg-primary/10 p-4 mb-4">
                <Zap className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">2. Generate</h3>
              <p className="text-sm text-muted-foreground">
                AI writes the parametric CAD code automatically
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="rounded-full bg-primary/10 p-4 mb-4">
                <Download className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">3. Export</h3>
              <p className="text-sm text-muted-foreground">
                Export STL or step files for 3D printing or machining
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-bold text-center mb-12">Features</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-6">
              <Zap className="h-6 w-6 text-primary mb-3" />
              <h3 className="font-semibold mb-2">Parametric Design</h3>
              <p className="text-sm text-muted-foreground">
                Variables and parameters that update your model instantly
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <Bot className="h-6 w-6 text-primary mb-3" />
              <h3 className="font-semibold mb-2">AI Generation</h3>
              <p className="text-sm text-muted-foreground">
                Natural language to CAD code in seconds
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <Box className="h-6 w-6 text-primary mb-3" />
              <h3 className="font-semibold mb-2">JSCAD Compatible</h3>
              <p className="text-sm text-muted-foreground">
                Full access to JSCAD modeling primitives and operations
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <Settings className="h-6 w-6 text-primary mb-3" />
              <h3 className="font-semibold mb-2">Animation Support</h3>
              <p className="text-sm text-muted-foreground">
                Build moving mechanisms with phase-aware diagnostics
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <Download className="h-6 w-6 text-primary mb-3" />
              <h3 className="font-semibold mb-2">Export Ready</h3>
              <p className="text-sm text-muted-foreground">
                STL, OBJ, and STEP formats for manufacturing
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <Github className="h-6 w-6 text-primary mb-3" />
              <h3 className="font-semibold mb-2">Open Source</h3>
              <p className="text-sm text-muted-foreground">
                Free and open, built with Next.js and JSCAD
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Box className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">OpenMech</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Built with JSCAD and Next.js
          </p>
        </div>
      </footer>
    </main>
  );
}
