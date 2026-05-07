type CarrTechLogoProps = {
  className?: string
  markClassName?: string
  productClassName?: string
  showProduct?: boolean
}

export function CarrTechLogo({
  className,
  markClassName,
  productClassName,
  showProduct = true,
}: CarrTechLogoProps) {
  return (
    <div className={className ?? 'flex items-center gap-2'}>
      <CarrTechMark className={markClassName ?? 'size-7 shrink-0'} />
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="font-semibold tracking-tight text-foreground">CarrTech</span>
        {showProduct ? (
          <>
            <span className="text-muted-foreground">/</span>
            <span className={productClassName ?? 'font-semibold tracking-tight text-[#0A8FA3]'}>CT-Ops</span>
          </>
        ) : null}
      </div>
    </div>
  )
}

function CarrTechMark({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className={className}>
      <path
        fill="none"
        stroke="#0F2533"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.8"
        d="M49 18 33 9 12 21v22l21 12 16-9M43 22l-10-6-14 8v16l14 8 10-6"
      />
      <path
        fill="none"
        stroke="#0A8FA3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
        d="M16 34h24M26 34v15M26 34l10-9"
      />
      <circle cx="16" cy="34" r="2.8" fill="#F8FAFC" stroke="#0A8FA3" strokeWidth="2.2" />
      <circle cx="26" cy="34" r="2.8" fill="#F8FAFC" stroke="#0A8FA3" strokeWidth="2.2" />
      <circle cx="40" cy="34" r="2.8" fill="#F8FAFC" stroke="#0A8FA3" strokeWidth="2.2" />
      <circle cx="26" cy="49" r="2.8" fill="#F8FAFC" stroke="#0A8FA3" strokeWidth="2.2" />
      <circle cx="36" cy="25" r="2.5" fill="#F8FAFC" stroke="#0A8FA3" strokeWidth="2.2" />
    </svg>
  )
}
