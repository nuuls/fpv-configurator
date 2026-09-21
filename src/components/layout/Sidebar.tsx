import { NavLink } from 'react-router'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/routes'
import { useUnsavedStore } from '@/stores/unsaved'

export const SIDEBAR_ID = 'sidebar-tabs'

interface SidebarProps {
  disabled: boolean
  /** Below `md` the sidebar is a drawer over the page; `open` has no effect on wider screens. */
  open: boolean
  onClose: () => void
}

export function Sidebar({ disabled, open, onClose }: SidebarProps) {
  const dirtyPaths = useUnsavedStore((s) => s.dirtyPaths)

  return (
    <>
      {open && <div aria-hidden className="absolute inset-0 z-30 bg-black/50 md:hidden" onClick={onClose} />}
      <nav
        id={SIDEBAR_ID}
        aria-label="Tabs"
        aria-disabled={disabled}
        className={cn(
          'flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-background p-3',
          'max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:transition-[translate,visibility] max-md:duration-200',
          !open && 'max-md:invisible max-md:-translate-x-full',
        )}
      >
        {ROUTES.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            tabIndex={disabled ? -1 : undefined}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive && !disabled && 'bg-accent text-accent-foreground',
                disabled && 'pointer-events-none opacity-40',
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
    </>
  )
}
