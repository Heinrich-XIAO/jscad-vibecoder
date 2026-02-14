"use client";

import { useState, useRef, forwardRef, useImperativeHandle } from "react";
import type { ExtractedParameter } from "@/lib/parameter-extractor";

export interface ParameterSlidersHandle {
  focusFirst: () => void;
}

interface ParameterSlidersProps {
  parameters: ExtractedParameter[];
  values: Record<string, number | boolean | string>;
  onChange: (name: string, value: number | boolean | string) => void;
  className?: string;
}

export const ParameterSliders = forwardRef<ParameterSlidersHandle, ParameterSlidersProps>(({
  parameters,
  values,
  onChange,
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
}: {
  parameter: ExtractedParameter;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [localValue, setLocalValue] = useState(value);

  const handleChange = (newValue: unknown) => {
    setLocalValue(newValue);
    onChange(newValue);
  };

  if (parameter.type === "number") {
    return (
      <div className="flex items-center gap-3">
        <label className="text-xs text-zinc-400 min-w-[80px] truncate">
          {parameter.label}
        </label>
        <input
          type="range"
          min={parameter.min ?? 0}
          max={parameter.max ?? 200}
          step={parameter.step ?? 0.1}
          value={localValue as number}
          onChange={(e) => handleChange(parseFloat(e.target.value))}
          className="flex-1 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />
        <input
          type="number"
          value={localValue as number}
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          onChange={(e) => handleChange(parseFloat(e.target.value))}
          className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 text-right"
        />
      </div>
    );
  }

  if (parameter.type === "boolean") {
    return (
      <div className="flex items-center gap-3">
        <label className="text-xs text-zinc-400 min-w-[80px] truncate">
          {parameter.label}
        </label>
        <input
          type="checkbox"
          checked={localValue as boolean}
          onChange={(e) => handleChange(e.target.checked)}
          className="accent-indigo-500"
        />
      </div>
    );
  }

  if (parameter.type === "text") {
    return (
      <div className="flex items-center gap-3">
        <label className="text-xs text-zinc-400 min-w-[80px] truncate">
          {parameter.label}
        </label>
        <input
          type="text"
          value={localValue as string}
          onChange={(e) => handleChange(e.target.value)}
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
        />
      </div>
    );
  }

  return null;
}
