"use client";

import { useState, useCallback, useRef } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

interface UseUndoRedoReturn<T> {
  state: T;
  setState: (newState: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: (initialState: T) => void;
}

/**
 * Hook for managing undo/redo history
 * @param initialState - The initial state value
 * @param maxHistory - Maximum number of history states to keep (default: 50)
 */
export function useUndoRedo<T>(initialState: T, maxHistory: number = 50): UseUndoRedoReturn<T> {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: [],
  });

  // Use a ref to track if we're currently undoing/redoing to prevent double updates
  const isTimeTraveling = useRef(false);

  const setState = useCallback((newState: T | ((prev: T) => T)) => {
    if (isTimeTraveling.current) {
      isTimeTraveling.current = false;
      return;
    }

    setHistory((prevHistory) => {
      const resolvedState = typeof newState === "function" 
        ? (newState as (prev: T) => T)(prevHistory.present)
        : newState;

      // Don't add to history if the state hasn't changed
      if (resolvedState === prevHistory.present) {
        return prevHistory;
      }

      const newPast = [...prevHistory.past, prevHistory.present];
      
      // Limit history size
      if (newPast.length > maxHistory) {
        newPast.shift();
      }

      return {
        past: newPast,
        present: resolvedState,
        future: [], // Clear future when new state is set
      };
    });
  }, [maxHistory]);

  const undo = useCallback(() => {
    setHistory((prevHistory) => {
      if (prevHistory.past.length === 0) return prevHistory;

      const newPast = prevHistory.past.slice(0, -1);
      const newPresent = prevHistory.past[prevHistory.past.length - 1];

      isTimeTraveling.current = true;

      return {
        past: newPast,
        present: newPresent,
        future: [prevHistory.present, ...prevHistory.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((prevHistory) => {
      if (prevHistory.future.length === 0) return prevHistory;

      const [newPresent, ...newFuture] = prevHistory.future;

      isTimeTraveling.current = true;

      return {
        past: [...prevHistory.past, prevHistory.present],
        present: newPresent,
        future: newFuture,
      };
    });
  }, []);

  const reset = useCallback((newInitialState: T) => {
    setHistory({
      past: [],
      present: newInitialState,
      future: [],
    });
  }, []);

  return {
    state: history.present,
    setState,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    reset,
  };
}
