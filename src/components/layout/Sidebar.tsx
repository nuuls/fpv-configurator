import { NavLink } from 'react-router'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/routes'
import { useUnsavedStore } from '@/stores/unsaved'

export function Sidebar({ disabled }: { disabled: boolean }) {
  const dirtyPaths = useUnsavedStore((s) => s.dirtyPaths)

  return (
    <nav
      aria-label="Tabs"
      aria-disabled={disabled}
      className={cn('flex w-52 shrink-0 flex-col gap-1 border-r p-3', disabled && 'pointer-events-none opacity-40')}
    >
      {ROUTES.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          tabIndex={disabled ? -1 : undefined}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
              isActive && !disabled && 'bg-accent text-accent-foreground',
            )
          }
        >
          <Icon className="size-4" />
          {label}
          {dirtyPaths.includes(path) && (
            <span title="Unsaved changes" aria-label="Unsaved changes" className="ml-auto size-2 rounded-full bg-primary" />
          )}
        </NavLink>
      ))}
    </nav>
  )
}
