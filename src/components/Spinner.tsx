// Indicador de carregamento: a própria bola do Let's Play girando.
// Herda a cor do texto (currentColor), então funciona dentro de qualquer botão.

const SWEEPS = [0, 120, 240].map((deg) => {
  const r = (deg * Math.PI) / 180;
  const pts: [number, number][] = [[14, -20], [56, -38], [80, -14], [82, 24]];
  const p = pts.map(([x, y]) => [
    x * Math.cos(r) - y * Math.sin(r),
    x * Math.sin(r) + y * Math.cos(r),
  ]);
  return `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)} C ${p[1][0].toFixed(1)} ${p[1][1].toFixed(1)} ${p[2][0].toFixed(1)} ${p[2][1].toFixed(1)} ${p[3][0].toFixed(1)} ${p[3][1].toFixed(1)}`;
});

export default function Spinner({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="-110 -110 220 220"
      width={size}
      height={size}
      className={`lp-spin ${className}`}
      role="status"
      aria-label="Carregando"
    >
      <circle r="100" fill="none" stroke="currentColor" strokeWidth="12" opacity="0.22" />
      {SWEEPS.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** Bloco centralizado para telas inteiras carregando. */
export function LoadingScreen({ label = "Carregando..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-[var(--brand)]">
      <Spinner size={44} />
      <p className="text-sm font-medium text-[var(--ink-soft)]">{label}</p>
    </div>
  );
}
