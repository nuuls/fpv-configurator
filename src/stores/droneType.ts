import { create } from 'zustand'
import { DEFAULT_DRONE_TYPE, type DroneType } from '@/lib/motors/model'

interface DroneTypeState {
  /**
   * The drone type the recommendations are for. Only picks slider ranges and hints; nothing is written to the FC.
   * Kept for the session until the drone-type setup step (SPEC §2) remembers it per FC.
   */
  droneType: DroneType
  setDroneType: (droneType: DroneType) => void
}

export const useDroneTypeStore = create<DroneTypeState>()((set) => ({
  droneType: DEFAULT_DRONE_TYPE,
  setDroneType: (droneType) => set({ droneType }),
}))
