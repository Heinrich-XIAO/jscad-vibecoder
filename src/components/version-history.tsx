"use client";

import { History, GitBranch } from "lucide-react";

interface Version {
  _id: string;
  versionNumber: number;
  source: "ai" | "manual" | "parameter-tweak";
  prompt?: string;
  code?: string;
  isValid: boolean;
  errorMessage?: string;
  _creationTime: number;
}

interface VersionHistoryProps {
  versions: Version[];
  currentVersionId?: string | null;
  onLoadVersion: (code: string, versionId: string) => void;
  className?: string;
}

export function VersionHistory({
  versions,
  currentVersionId,
  onLoadVersion,
  className = "",
}: VersionHistoryProps) {
  if (versions.length === 0) {
    return (
      <div className={`text-center py-4 text-zinc-600 text-sm ${className}`}>
        No versions yet
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-medium text-zinc-200">Version History</h3>
      </div>
      {versions.map((version) => (
        <button
          key={version._id}
          onClick={() => onLoadVersion(version.code || "", version._id)}
          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
            version._id === currentVersionId
              ? "bg-primary/20 border border-primary/30 text-primary"
              : "hover:bg-secondary text-muted-foreground"
          }`}
        >
          <div className="flex items-center gap-2">
            <GitBranch className="w-3 h-3 flex-shrink-0" />
            <span className="font-medium">v{version.versionNumber}</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                version.source === "ai"
                  ? "bg-indigo-900/50 text-indigo-300"
                  : version.source === "manual"
                    ? "bg-emerald-900/50 text-emerald-300"
                    : "bg-amber-900/50 text-amber-300"
              }`}
            >
              {version.source}
            </span>
            {!version.isValid && (
              <span className="text-xs text-red-400">error</span>
            )}
          </div>
          {version.prompt && (
            <p className="text-xs text-zinc-600 mt-1 truncate">
              {version.prompt}
            </p>
          )}
          <p className="text-xs text-zinc-700 mt-0.5">
            {new Date(version._creationTime).toLocaleString()}
          </p>
        </button>
      ))}
    </div>
  );
}
