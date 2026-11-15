import { cn } from "@/shared/lib";
import { SombraMark } from "./sombra-mark";

/** Shared, font-independent lettering for every product signature. */
export function SombraLogo({ className }: { className?: string }) {
  return <span role="img" aria-label="Sombra" className={cn("sombra-logo", className)}>
    <SombraMark />
    <svg className="sombra-wordmark" viewBox="0 0 188 32" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="4" strokeLinejoin="bevel" strokeLinecap="square">
        <path d="M25 5H8L3 10v3l20 6v4l-5 4H2" />
        <path d="M39 5h13l5 5v12l-5 5H39l-5-5V10Z" />
        <path d="M68 27V5l12 13L92 5v22" />
        <path d="M104 27V5h17l5 5-5 6 6 6-6 5Zm1-11h16" />
        <path d="M138 27V5h17l5 5-5 7h-17m12 0 11 10" />
        <path d="M170 27V11l7-6h3l6 6v16m-15-10h14" />
      </g>
      <path d="M1 16h8m44 0h7m42 0h7m46 0h7" stroke="#65f5e9" strokeWidth="2" />
      <path d="M18 31h10m53-30h12m78 30h14" stroke="#b77aff" strokeWidth="2" />
    </svg>
  </span>;
}
