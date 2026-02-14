"use client";

import { useEffect, useState, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

interface UserPresence {
  userId: string;
  userName: string;
  isEditing: boolean;
  lastSeen: number;
}

interface UseCollaborationReturn {
  onlineUsers: UserPresence[];
  currentUserCount: number;
  isCollaborating: boolean;
  updatePresence: (isEditing: boolean) => void;
}

/**
 * Hook for tracking real-time collaboration/presence
 * Shows which users are currently viewing/editing a project
 */
export function useCollaboration(projectId: string): UseCollaborationReturn {
  const [currentUserId] = useState(() => `user_${Math.random().toString(36).substr(2, 9)}`);
  const [currentUserName] = useState(() => `User ${Math.floor(Math.random() * 1000)}`);
  
  // Query for online users
  const presenceData = useQuery(api.presence.list, { projectId: projectId as Id<"projects"> });
  
  // Mutation to update presence
  const updatePresenceMutation = useMutation(api.presence.update);
  
  // Cleanup presence on unmount
  useEffect(() => {
    const heartbeat = setInterval(() => {
      updatePresenceMutation({
        projectId: projectId as Id<"projects">,
        userId: currentUserId,
        userName: currentUserName,
        isEditing: false,
      }).catch(console.error);
    }, 30000); // Heartbeat every 30 seconds

    return () => {
      clearInterval(heartbeat);
    };
  }, [projectId, currentUserId, currentUserName, updatePresenceMutation]);
  
  const updatePresence = useCallback((isEditing: boolean) => {
    updatePresenceMutation({
      projectId: projectId as Id<"projects">,
      userId: currentUserId,
      userName: currentUserName,
      isEditing,
    }).catch(console.error);
  }, [projectId, currentUserId, currentUserName, updatePresenceMutation]);
  
  // Filter out current user and stale presence (older than 2 minutes)
  const onlineUsers = (presenceData || [])
    .filter((user: { userId: string; lastSeen: number }) => {
      const isCurrentUser = user.userId === currentUserId;
      const isStale = Date.now() - user.lastSeen > 2 * 60 * 1000;
      return !isCurrentUser && !isStale;
    }) as UserPresence[];
  
  return {
    onlineUsers,
    currentUserCount: onlineUsers.length + 1, // +1 for current user
    isCollaborating: onlineUsers.length > 0,
    updatePresence,
  };
}
