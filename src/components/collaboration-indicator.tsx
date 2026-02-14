"use client";

import { Users, Activity } from "lucide-react";
import { useCollaboration } from "@/lib/use-collaboration";

interface CollaborationIndicatorProps {
  projectId: string;
  className?: string;
}

export function CollaborationIndicator({ projectId, className = "" }: CollaborationIndicatorProps) {
  const { onlineUsers, currentUserCount, isCollaborating } = useCollaboration(projectId);

  if (currentUserCount <= 1) {
    return (
      <div className={`flex items-center gap-2 text-muted-foreground text-sm ${className}`}>
        <Users className="w-4 h-4" />
        <span>Only you</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          {onlineUsers.slice(0, 3).map((user, index) => (
            <div
              key={user.userId}
              className={`w-7 h-7 rounded-full border-2 border-background flex items-center justify-center text-xs font-medium text-white ${getUserColor(index)}`}
              title={`${user.userName} ${user.isEditing ? "(editing)" : "(viewing)"}`}
            >
              {user.userName.charAt(0).toUpperCase()}
            </div>
          ))}
          {onlineUsers.length > 3 && (
            <div className="w-7 h-7 rounded-full border-2 border-background bg-muted flex items-center justify-center text-xs font-medium">
              +{onlineUsers.length - 3}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className={`w-3 h-3 ${isCollaborating ? "text-green-500" : "text-muted-foreground"}`} />
          <span className="text-sm text-muted-foreground">
            {onlineUsers.length + 1} active
          </span>
        </div>
      </div>
      
      {onlineUsers.some((u) => u.isEditing) && (
        <div className="flex items-center gap-1.5 text-xs text-amber-500">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          Someone is editing
        </div>
      )}
    </div>
  );
}

function getUserColor(index: number): string {
  const colors = [
    "bg-blue-500",
    "bg-green-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-yellow-500",
    "bg-indigo-500",
  ];
  return colors[index % colors.length];
}
