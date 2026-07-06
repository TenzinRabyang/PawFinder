/* eslint-disable @next/next/no-img-element */
'use client';

import { useMemo, useState } from "react";

type EditorialPhotoProps = {
  src: string;
  alt: string;
  className?: string;
  imageSize: "square_hd" | "square" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";
  fallbackPrompt: string;
  priority?: boolean;
};

function buildFallbackUrl(prompt: string, imageSize: EditorialPhotoProps["imageSize"]) {
  return `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=${imageSize}`;
}

export default function EditorialPhoto({
  src,
  alt,
  className,
  imageSize,
  fallbackPrompt,
  priority = false,
}: EditorialPhotoProps) {
  const fallbackSrc = useMemo(() => buildFallbackUrl(fallbackPrompt, imageSize), [fallbackPrompt, imageSize]);
  const [activeSrc, setActiveSrc] = useState(src);
  const [triedFallback, setTriedFallback] = useState(false);

  return (
    <img
      src={activeSrc}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={className}
      onError={() => {
        if (!triedFallback) {
          setTriedFallback(true);
          setActiveSrc(fallbackSrc);
        }
      }}
    />
  );
}
