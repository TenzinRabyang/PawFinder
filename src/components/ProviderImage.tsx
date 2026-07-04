'use client'

import { useMemo, useState } from 'react'
import Image, { type ImageLoader } from 'next/image'

const PLACEHOLDER_SRC = '/pet-placeholder.svg'
const PLACEHOLDER_BLUR_DATA_URL =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDQwMCAzMDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSIzMDAiIGZpbGw9IiNGNkYxRTgiLz48Y2lyY2xlIGN4PSIyMDAiIGN5PSIxNDAiIHI9IjYwIiBmaWxsPSIjQzdCNDlDIi8+PHRleHQgeD0iMjAwIiB5PSIyNDIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM2Qzg2NzYiIGZvbnQtc2l6ZT0iMjgiIGZvbnQtZmFtaWx5PSJBcmlhbCI+UGF3RmluZGVyPC90ZXh0Pjwvc3ZnPg=='

type ProviderImageProps = {
  photoReference?: string | null
  alt: string
  sizes: string
  priority?: boolean
  className?: string
}

export function ProviderImage({ photoReference, alt, sizes, priority = false, className = 'object-cover' }: ProviderImageProps) {
  const [hasError, setHasError] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  const imageLoader = useMemo<ImageLoader>(
    () => ({ src, width, quality }) =>
      `/api/google-photo?photoReference=${encodeURIComponent(src)}&width=${width}${quality ? `&quality=${quality}` : ''}`,
    []
  )

  const showGooglePhoto = Boolean(photoReference && !hasError)

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#F6F1E8]">
      <Image
        src={PLACEHOLDER_SRC}
        alt=""
        fill
        sizes={sizes}
        className={`${className} transition-opacity duration-300 ${showGooglePhoto && isLoaded ? 'opacity-0' : 'opacity-100'}`}
        priority={priority}
        placeholder="blur"
        blurDataURL={PLACEHOLDER_BLUR_DATA_URL}
      />

      {showGooglePhoto && photoReference && (
        <Image
          loader={imageLoader}
          src={photoReference}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={`${className} transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
        />
      )}
    </div>
  )
}
