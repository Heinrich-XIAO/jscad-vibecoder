"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { useRouter } from "next/navigation";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component to catch and handle React errors gracefully
 * Prevents the entire app from crashing when a component fails
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-card border border-border rounded-xl p-8 shadow-lg">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-destructive/10 rounded-full">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
                <p className="text-sm text-muted-foreground">
                  The application encountered an unexpected error
                </p>
              </div>
            </div>

            {/* Error details */}
            <div className="bg-muted rounded-lg p-4 mb-6 overflow-auto">
              <p className="text-sm font-mono text-destructive mb-2">
                {this.state.error?.name}: {this.state.error?.message}
              </p>
              {this.state.errorInfo && (
                <pre className="text-xs text-muted-foreground overflow-x-auto">
                  {this.state.errorInfo.componentStack}
                </pre>
              )}
            </div>

            {/* Common fixes */}
            {this.state.error?.message.includes("Cannot read properties of undefined") && (
              <div className="bg-amber-950/30 border border-amber-900/30 rounded-lg p-4 mb-6">
                <p className="text-sm text-amber-200 font-medium mb-2">Possible solution:</p>
                <p className="text-sm text-amber-200/80 mb-2">
                  This error often occurs when Convex is not initialized.
                </p>
                <code className="block bg-amber-950/50 p-2 rounded text-xs font-mono text-amber-200">
                  npx convex dev --once --configure=new
                </code>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={this.handleRetry}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-secondary transition-colors"
              >
                <Home className="w-4 h-4" />
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Wrapper component to use error boundary with hooks
 */
export function ErrorBoundaryWrapper({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
