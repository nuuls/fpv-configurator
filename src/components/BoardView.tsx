import type { CSSProperties } from 'react'
import type { Attitude } from '@/lib/msp/messages'
import type { BoardAlignment } from '@/lib/orientation/model'

// Sign conventions in one place: flip these if the model moves opposite to the real quad.
const ROLL_SIGN = 1 // positive roll = right side down
const PITCH_SIGN = -1 // positive pitch = nose up
const YAW_SIGN = 1 // positive yaw = clockwise seen from above

const rotation = (roll: number, pitch: number, yaw: number) =>
  `rotateZ(${YAW_SIGN * yaw}deg) rotateX(${PITCH_SIGN * pitch}deg) rotateY(${ROLL_SIGN * roll}deg)`

const preserve3d: CSSProperties = { transformStyle: 'preserve-3d' }
const ARM: CSSProperties = { position: 'absolute', left: '50%', top: '50%', width: 210, height: 14, marginLeft: -105, marginTop: -7 }

/**
 * Dependency-free 3D view (CSS transforms): a quad frame that follows the live attitude, with the
 * flight controller board inside it rotated by the chosen board alignment. Nose points "up" the screen.
 */
export function BoardView({ alignment, attitude }: { alignment: BoardAlignment; attitude: Attitude | null }) {
  const live = attitude ?? { roll: 0, pitch: 0, yaw: 0 }

  return (
    <div
      role="img"
      aria-label={`Flight controller rotated yaw ${alignment.yaw}°, roll ${alignment.roll}°, pitch ${alignment.pitch}°`}
      style={{ perspective: 900, width: 280, height: 240 }}
      className="flex items-center justify-center"
    >
      {/* camera: looking down at the quad from behind */}
      <div style={{ ...preserve3d, transform: 'rotateX(55deg)' }}>
        {/* heading is left out on purpose: the nose always points away from the viewer */}
        <div style={{ ...preserve3d, transform: rotation(live.roll, live.pitch, 0), width: 220, height: 220, position: 'relative' }}>
          <div className="rounded-full bg-muted-foreground/50" style={{ ...ARM, transform: 'rotateZ(45deg)' }} />
          <div className="rounded-full bg-muted-foreground/50" style={{ ...ARM, transform: 'rotateZ(-45deg)' }} />
          {[
            [18, 18],
            [162, 18],
            [18, 162],
            [162, 162],
          ].map(([left, top], i) => (
            <div
              key={i}
              className={i < 2 ? 'border-primary/80' : 'border-muted-foreground/60'}
              style={{ position: 'absolute', left, top, width: 40, height: 40, borderRadius: '50%', borderWidth: 3 }}
            />
          ))}

          {/* the flight controller, lifted off the frame so tilts stay visible */}
          <div
            style={{
              ...preserve3d,
              position: 'absolute',
              left: 75,
              top: 75,
              width: 70,
              height: 70,
              transform: `translateZ(18px) ${rotation(alignment.roll, alignment.pitch, alignment.yaw)}`,
            }}
          >
            <div className="flex size-full items-start justify-center rounded-md border-2 border-primary bg-card text-primary shadow-lg">
              <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor" aria-hidden="true">
                <path d="M12 2 5 12h4.5v10h5V12H19z" />
              </svg>
            </div>
            {/* underside, visible when mounted upside down */}
            <div
              className="absolute inset-0 rounded-md border-2 border-muted-foreground bg-muted"
              style={{ transform: 'translateZ(-3px)', backfaceVisibility: 'hidden', rotate: 'y 180deg' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
