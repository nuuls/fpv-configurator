const SIZE = 120
const RADIUS = SIZE / 2
const PIXELS_PER_DEGREE = 1.2

/** Minimal artificial horizon. Angles in degrees; positive roll = right wing down, positive pitch = nose up. */
export function AttitudeIndicator({ roll, pitch }: { roll: number; pitch: number }) {
  const pitchOffset = Math.max(-RADIUS, Math.min(RADIUS, pitch * PIXELS_PER_DEGREE))

  return (
    <svg
      role="img"
      aria-label={`Attitude: roll ${roll.toFixed(0)}°, pitch ${pitch.toFixed(0)}°`}
      width={SIZE}
      height={SIZE}
      viewBox={`${-RADIUS} ${-RADIUS} ${SIZE} ${SIZE}`}
      className="shrink-0"
    >
      <defs>
        <clipPath id="attitude-clip">
          <circle r={RADIUS - 1} />
        </clipPath>
      </defs>
      <g clipPath="url(#attitude-clip)">
        <g transform={`rotate(${-roll}) translate(0 ${pitchOffset})`}>
          <rect x={-SIZE} y={-SIZE * 2} width={SIZE * 2} height={SIZE * 2} fill="oklch(0.62 0.12 240)" />
          <rect x={-SIZE} y={0} width={SIZE * 2} height={SIZE * 2} fill="oklch(0.45 0.08 60)" />
          <line x1={-SIZE} x2={SIZE} stroke="white" strokeWidth={1.5} />
        </g>
      </g>
      {/* Fixed aircraft reference */}
      <path d="M-34 0h22M12 0h22M0 -3v6" stroke="var(--primary)" strokeWidth={3} strokeLinecap="round" fill="none" />
      <circle r={RADIUS - 1} fill="none" stroke="var(--border)" strokeWidth={2} />
    </svg>
  )
}
