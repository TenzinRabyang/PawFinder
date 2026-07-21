import Image from 'next/image'

type BrandLogoProps = {
  className?: string
  showWordmark?: boolean
  iconSize?: number
  priority?: boolean
  wordmarkClassName?: string
  iconClassName?: string
  gapClassName?: string
}

export default function BrandLogo({
  className = '',
  showWordmark = true,
  iconSize = 32,
  priority = false,
  wordmarkClassName = 'font-display text-xl tracking-[-0.03em] text-[#20261F]',
  iconClassName = '',
  gapClassName,
}: BrandLogoProps) {
  return (
    <span className={`inline-flex items-center ${gapClassName ?? (showWordmark ? 'gap-2.5' : 'gap-0')} ${className}`.trim()}>
      <span
        className="relative shrink-0"
        style={{ width: iconSize, height: iconSize }}
        aria-hidden="true"
      >
        <Image
          src="/pawfinder-logo.svg"
          alt="PawFinder logo"
          fill
          sizes={`${iconSize}px`}
          priority={priority}
          className={`object-contain ${iconClassName}`.trim()}
        />
      </span>
      {showWordmark ? <span className={wordmarkClassName}>PawFinder</span> : null}
    </span>
  )
}
