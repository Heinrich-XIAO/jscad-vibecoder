"use client";

import { useState, useMemo, useCallback } from "react";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { Plus, Settings, Trash2, Clock, Box, LayoutTemplate, ChevronRight, Search, X, Keyboard } from "lucide-react";
import { SettingsDialog } from "@/components/settings-dialog";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { useKeyboardShortcuts, type KeyboardShortcut } from "@/lib/use-keyboard-shortcuts";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const router = useRouter();
  
  // Handle case where Convex is not configured
  let projects: any;
  let templates: any;
  let createProject: any;
  let deleteProject: any;
  let convexError: string | null = null;
  
  try {
    projects = useQuery(api.projects.list);
    templates = useQuery(api.templates.list);
    createProject = useMutation(api.projects.create);
    deleteProject = useMutation(api.projects.remove);
  } catch (error) {
    convexError = "Convex not configured. Run: npx convex dev --once --configure=new";
  }
  
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleCreateProject = useCallback(async () => {
    setIsCreating(true);
    try {
      const projectId = await createProject({
        name: "Untitled Project",
        description: "",
      });
      router.push(`/project/${projectId}`);
    } finally {
      setIsCreating(false);
    }
  }, [createProject, router]);

  const handleCreateFromTemplate = async (templateId: string) => {
    setIsCreating(true);
    try {
      const projectId = await createProject({
        name: "New Project from Template",
        description: "",
        templateId: templateId as `templates:${string}`,
      });
      router.push(`/project/${projectId}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete this project?")) {
      await deleteProject({ id });
    }
  };

  const shortcuts: KeyboardShortcut[] = useMemo(
    () => [
      {
        key: "n",
        ctrl: true,
        handler: handleCreateProject,
        description: "New project",
        group: "Actions",
      },
      {
        key: ",",
        ctrl: true,
        handler: () => setShowSettings(true),
        description: "Open settings",
        group: "Navigation",
      },
      {
        key: "Escape",
        handler: () => {
          if (showShortcuts) setShowShortcuts(false);
          else if (showSettings) setShowSettings(false);
        },
        description: "Close dialogs",
        group: "Navigation",
        alwaysEnabled: true,
      },
      {
        key: "?",
        shift: true,
        handler: () => setShowShortcuts((v) => !v),
        description: "Show keyboard shortcuts",
        group: "Navigation",
      },
    ],
    [handleCreateProject, showShortcuts, showSettings]
  );

  useKeyboardShortcuts(shortcuts);

  // Show error state if Convex is not configured
  if (convexError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <Box className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Setup Required</h2>
          <p className="text-muted-foreground mb-6">{convexError}</p>
          <div className="bg-muted p-4 rounded-lg text-left text-sm font-mono mb-4">
            <p className="text-muted-foreground"># Run this command:</p>
            <p className="text-primary">npx convex dev --once --configure=new</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Then refresh the page after Convex is initialized.
          </p>
        </div>
      </div>
    );
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Filter projects based on search query
  const filteredProjects = projects?.filter((project: { _id: string; name: string; description?: string; updatedAt: number }) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      project.name.toLowerCase().includes(query) ||
      (project.description?.toLowerCase().includes(query) ?? false)
    );
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <Box className="w-8 h-8 text-primary" />
            <h1 className="text-2xl font-bold">JSCAD Vibecoder</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowShortcuts(true)}
              className="p-2 hover:bg-secondary rounded-lg transition-colors"
              title="Keyboard Shortcuts (?)"
            >
              <Keyboard className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-secondary rounded-lg transition-colors"
              title="Settings (Ctrl+,)"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">Your Projects</h2>
            {projects && projects.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {filteredProjects?.length} of {projects.length}
              </span>
            )}
          </div>
          <button
            onClick={handleCreateProject}
            disabled={isCreating}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {isCreating ? "Creating..." : "New Project"}
          </button>
        </div>

        {/* Search Bar */}
        {projects && projects.length > 0 && (
          <div className="mb-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-10 py-2 bg-card border border-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}

        {projects === undefined ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading projects...
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12">
            <Box className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No projects yet</h3>
            <p className="text-muted-foreground mb-6">
              Create your first 3D modeling project
            </p>
            <button
              onClick={handleCreateProject}
              disabled={isCreating}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 mx-auto"
            >
              <Plus className="w-4 h-4" />
              {isCreating ? "Creating..." : "Create Project"}
            </button>
          </div>
        ) : filteredProjects?.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No projects found</h3>
            <p className="text-muted-foreground mb-6">
              No projects match &ldquo;{searchQuery}&rdquo;
            </p>
            <button
              onClick={() => setSearchQuery("")}
              className="text-primary hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects?.map((project: { _id: string; name: string; description?: string; updatedAt: number }) => (
              <div
                key={project._id}
                onClick={() => router.push(`/project/${project._id}`)}
                className="group bg-card border border-border rounded-lg p-5 cursor-pointer hover:border-primary/50 hover:bg-card/80 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                    {project.name}
                  </h3>
                  <button
                    onClick={(e) => handleDeleteProject(project._id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {project.description && (
                  <p className="text-muted-foreground text-sm mb-4 line-clamp-2">
                    {project.description}
                  </p>
                )}
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>Updated {formatDate(project.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Templates Section */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <LayoutTemplate className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-semibold">Templates</h2>
            </div>
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
            >
              {showTemplates ? "Hide" : "Show All"}
              <ChevronRight className={`w-4 h-4 transition-transform ${showTemplates ? "rotate-90" : ""}`} />
            </button>
          </div>

          {templates === undefined ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading templates...
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No templates available
            </div>
          ) : (
            <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${showTemplates ? "" : "max-h-48 overflow-hidden"}`}>
              {templates.map((template: { _id: string; name: string; description: string; category: string }) => (
                <div
                  key={template._id}
                  className="group bg-card border border-border rounded-lg p-5 hover:border-primary/50 hover:bg-card/80 transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                        {template.name}
                      </h3>
                      <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                        {template.category}
                      </span>
                    </div>
                  </div>
                  <p className="text-muted-foreground text-sm mb-4 line-clamp-2">
                    {template.description}
                  </p>
                  <button
                    onClick={() => handleCreateFromTemplate(template._id)}
                    disabled={isCreating}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm hover:bg-secondary/80 transition-colors disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                    {isCreating ? "Creating..." : "Use Template"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <SettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <KeyboardShortcutsDialog
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        shortcuts={shortcuts}
      />
    </div>
  );
}