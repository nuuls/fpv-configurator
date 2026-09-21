import type { FcInfo } from '@/lib/msp/api'

/** e.g. "BTFL 2026.6.2" (or "BTFL 4.5.1" on firmware that predates calendar versions) */
export function formatFirmware(info: FcInfo): string {
  const { major, minor, patch, versionString } = info.version
  return `${info.variant} ${versionString || `${major}.${minor}.${patch}`}`
}

/** e.g. "1.48" */
export function formatApiVersion(info: FcInfo): string {
  return `${info.apiVersion.major}.${info.apiVersion.minor}`
}

/** SPEC §3: Betaflight 2026.x only. Calendar versions report major = year - 2000. */
export function isSupportedFirmware(info: FcInfo): boolean {
  return info.variant === 'BTFL' && info.version.major === 26
}
