"use client";

import { useState, useRef, forwardRef, useImperativeHandle, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import type { ExtractedParameter } from "@/lib/parameter-extractor";

export interface ParameterSlidersHandle {
  focusFirst: () => void;
}

interface ParameterSlidersProps {
  parameters: ExtractedParameter[];
  values: Record<string, number | boolean | string>;
  onChange: (name: string, value: number | boolean | string) => void;
  onReset?: (name: string) => void;
  className?: string;
}

export const ParameterSliders = forwardRef<ParameterSlidersHandle, ParameterSlidersProps>(({
  parameters,
  values,
  onChange,
  onReset,
  className = "",
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focusFirst: () => {
      const input = containerRef.current?.querySelector("input");
      input?.focus();
    },
  }));

  if (parameters.length === 0) return null;

  return (
    <div ref={containerRef} className={`space-y-3 ${className}`}>
      {parameters.map((param) => (
        <ParameterControl
          key={param.name}
          parameter={param}
          value={values[param.name] !== undefined ? values[param.name] : param.value}
          onChange={(value) => onChange(param.name, value as number | boolean | string)}
          onReset={onReset ? () => onReset(param.name) : undefined}
        />
      ))}
    </div>
  );
});

ParameterSliders.displayName = "ParameterSliders";

function ParameterControl({
  parameter,
  value,
  onChange,
  onReset,
}: {
  parameter: ExtractedParameter;
  value: unknown;
  onChange: (value: unknown) => void;
  onReset?: () => void;
}) {
  const [localValue, setLocalValue] = useState(value);

  // Sync local state with external value changes (e.g., reset)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const isDefault = localValue === (parameter.initial ?? parameter.value);

  const handleChange = (newValue: unknown) => {
    setLocalValue(newValue);
    onChange(newValue);
  };

  if (parameter.type === "number") {
    return (
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground min-w-[60px] truncate">
          {parameter.label}
        </label>
        <input
          type="range"
          min={parameter.min ?? 0}
          max={parameter.max ?? 200}
          step={parameter.step ?? 0.1}
          value={localValue as number}
          onChange={(e) => handleChange(parseFloat(e.target.value))}
          className="flex-1 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReset}
            disabled={!onReset || isDefault}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              onReset && !isDefault
                ? "text-muted-foreground hover:text-foreground"
                : "text-transparent"
            }`}
            title={onReset && !isDefault ? "Reset to default" : undefined}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          <input
            type="number"
            value={localValue as number}
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            onChange={(e) => handleChange(parseFloat(e.target.value))}
            className="w-14 bg-background border border-input rounded px-1 py-1 text-xs text-foreground text-right"
          />
        </div>
      </div>
    );
  }

  if (parameter.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground min-w-[60px] truncate">
          {parameter.label}
        </label>
        <input
          type="checkbox"
          checked={localValue as boolean}
          onChange={(e) => handleChange(e.target.checked)}
          className="accent-primary"
        />
        {onReset && !isDefault && (
          <button
            onClick={onReset}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors ml-auto"
            title="Reset to default"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  if (parameter.type === "text") {
    return (
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground min-w-[60px] truncate">
          {parameter.label}
        </label>
        <input
          type="text"
          value={localValue as string}
          onChange={(e) => handleChange(e.target.value)}
          className="flex-1 bg-background border border-input rounded px-2 py-1 text-xs text-foreground"
        />
        {onReset && !isDefault && (
          <button
            onClick={onReset}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Reset to default"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return null;
}
