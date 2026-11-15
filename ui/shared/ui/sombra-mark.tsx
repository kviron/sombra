import { cn } from "@/shared/lib";

/** An original projected skull, with broken signal contours rather than solid armor. */
export function SombraMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={cn("sombra-mark size-6 shrink-0", className)}>
    <path d="M23 5h20l13 15v11M53 41l-9 12H22L10 39V23L23 8" stroke="#a657ff" strokeWidth="2"/>
    <path d="M25 13h14l10 11v15l-9 8v9h-5V45h-6v11h-5v-9l-9-8V24Z" fill="#b06aff" fillOpacity=".09" stroke="#d5a2ff" strokeWidth="2" strokeLinejoin="bevel"/>
    <path d="m18 27 11 4-3 6h-6Zm28 0-11 4 3 6h6Z" fill="#6ffff3"/>
    <path d="m32 36-3 6h6Z" fill="#d5a2ff"/>
    <path d="M22 21h20M17 25h30M18 40h9m11 0h8M23 44h4m11 0h3" stroke="#c581ff" strokeOpacity=".4"/>
    <path d="M2 23h10m40 12h10M7 42h10M45 10h12" stroke="#63f5ed" strokeWidth="2"/>
    <path d="M5 30h5m44-5h8M15 56h7m23-7h12" stroke="#ed6bdf" strokeWidth="2"/>
    <path d="M2 10V3h10m40 0h9v8M3 53v8h9m40 0h9v-8" stroke="#a657ff" strokeOpacity=".6"/>
  </svg>;
}
