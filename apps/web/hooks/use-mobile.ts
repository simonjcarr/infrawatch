import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribeToMediaQuery(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function readIsMobile() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMediaQuery,
    readIsMobile,
    () => false,
  )
}
