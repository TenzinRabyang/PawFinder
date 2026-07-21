import Image from 'next/image'

type BrandLogoProps = {
  className?: string
  showWordmark?: boolean
  iconSize?: number
  priority?: boolean
  wordmarkClassName?: string
  iconClassName?: string
}

export default function BrandLogo({
  className = '',
  showWordmark = true,
  iconSize = 40,
  priority = false,
  wordmarkClassName = 'font-display text-xl tracking-[-0.03em] text-[#20261F]',
  iconClassName = '',
}: BrandLogoProps) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`.trim()}>
      <Image
        src="/pawfinder-logo.svg"
        alt="PawFinder logo"
        width={iconSize}
        height={iconSize}
        priority={priority}
        className={`h-auto w-auto shrink-0 object-contain ${iconClassName}`.trim()}
      />
      {showWordmark ? <span className={wordmarkClassName}>PawFinder</span> : null}
    </span>
  )
}
