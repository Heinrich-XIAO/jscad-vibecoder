"use client";

import { useEffect, useState } from "react";
import { generateThumbnail } from "@/lib/thumbnail-generator";
import { Box } from "lucide-react";

interface ThumbnailPreviewProps {
  geometry: unknown[];
  className?: string;
}

export function ThumbnailPreview({ geometry, className = "" }: ThumbnailPreviewProps) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const generate = async () => {
      if (!geometry || geometry.length === 0) {
        setThumbnail(null);
        return;
      }

      setIsGenerating(true);
      try {
        const dataUrl = await generateThumbnail(geometry, 300, 300);
        setThumbnail(dataUrl);
      } catch (error) {
        console.error("Failed to generate thumbnail:", error);
        setThumbnail(null);
      } finally {
        setIsGenerating(false);
      }
    };

    generate();
  }, [geometry]);

  if (isGenerating) {
    return (
      <div className={`bg-muted rounded-lg flex items-center justify-center ${className}`}>
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!thumbnail) {
    return (
      <div className={`bg-muted rounded-lg flex items-center justify-center ${className}`}>
        <Box className="w-8 h-8 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={thumbnail}
      alt="3D Preview"
      className={`rounded-lg object-cover bg-muted ${className}`}
    />
  );
}
