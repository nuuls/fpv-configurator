/**
 * VTX tables by manufacturer → model (docs/tabs/vtx.md). Values are copied from Betaflight's official presets
 * (github.com/betaflight/firmware-presets, `presets/4.3/vtx/`, all marked valid for 2026.6) — don't invent
 * tables here: wrong power values make a VTX transmit at a different power than the label says.
 */
import type { VtxBand, VtxPowerLevel, VtxTable } from './model'

/** Decides what the power values mean, and which VTX type has to be picked on the Ports tab. */
export type VtxProtocol = 'SmartAudio 2.0' | 'SmartAudio 2.1' | 'Tramp'

export interface VtxPreset {
  id: string
  manufacturer: string
  name: string
  protocol: VtxProtocol
  table: VtxTable
}

type BandRow = [name: string, letter: string, frequencies: number[]]

const A = [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725]
const B = [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866]
const E = [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945]
const F = [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880]
const R = [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917]
const LOW_RACE = [5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621]
// Regulatory variants used by several presets: channels outside the allowed range are 0 (= not available).
const A_EU = [5865, 5845, 5825, 5805, 5785, 5765, 5745, 0]
const F_EU = [5740, 5760, 5780, 5800, 5820, 5840, 5860, 0]
const R_EU = [0, 0, 0, 5769, 5806, 5843, 0, 0]
const E_US = [5705, 5685, 5665, 0, 5885, 5905, 0, 0]

const LONG_NAMES: BandRow[] = [
  ['BOSCAM_A', 'A', A],
  ['BOSCAM_B', 'B', B],
  ['BOSCAM_E', 'E', E],
  ['FATSHARK', 'F', F],
  ['RACEBAND', 'R', R],
]
const SHORT_NAMES: BandRow[] = [
  ['A', 'A', A],
  ['B', 'B', B],
  ['E', 'E', E],
  ['F', 'F', F],
  ['R', 'R', R],
]
const EU: BandRow[] = [
  ['BOSCAM_A', 'A', A_EU],
  ['BOSCAM_B', 'B', B],
  ['FATSHARK', 'F', F_EU],
  ['RACEBAND', 'R', R_EU],
]
const US: BandRow[] = [
  ['BOSCAM_A', 'A', A],
  ['BOSCAM_B', 'B', B],
  ['BOSCAM_E', 'E', E_US],
  ['FATSHARK', 'F', F],
  ['RACEBAND', 'R', R],
]
const RUSH: BandRow[] = [
  ['BAND_A', 'A', A],
  ['BAND_B', 'B', B],
  ['BAND_E', 'E', [5705, 5685, 5665, 5665, 5885, 5905, 5905, 5905]], // the 37-channel (US) version
  ['AIRWAVE', 'F', F],
  ['RACEBAND', 'R', R],
]
const OPENVTX_LOW_RACE = [5333, 5373, 5413, 5453, 5493, 5533, 5573, 5613]

const bands = (rows: BandRow[], isFactory: boolean): VtxBand[] =>
  rows.map(([name, letter, frequencies]) => ({
    name,
    letter,
    isFactory,
    frequencies: [...frequencies],
  }))

/** "25:14" = label 25, value 14. */
const power = (...levels: string[]): VtxPowerLevel[] =>
  levels.map((level) => {
    const [label = '', value = ''] = level.split(':')
    return { label, value: Number(value) }
  })

const preset = (
  manufacturer: string,
  name: string,
  protocol: VtxProtocol,
  bandList: VtxBand[],
  powerLevels: VtxPowerLevel[],
): VtxPreset => ({
  id: `${manufacturer} ${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, ''),
  manufacturer,
  name,
  protocol,
  table: { bands: bandList, powerLevels },
})

const TRAMP_POWER = power('25:25', '100:100', '200:200', '400:400', '600:600')

export const VTX_PRESETS: VtxPreset[] = [
  preset(
    'AKK',
    'FX2 Dominator 2W',
    'SmartAudio 2.0',
    bands(SHORT_NAMES, false),
    power('250:0', '500:1', '1W:2', '2W:3'),
  ),

  preset(
    'DarwinFPV',
    '25/200/400/600 mW VTX',
    'SmartAudio 2.0',
    bands(LONG_NAMES, true),
    power('25:0', '200:1', '400:2', '600:3'),
  ),

  preset(
    'Diatone',
    'Mamba Ultra 1000',
    'Tramp',
    bands(US, false),
    power('25:25', '200:100', '400:200', '800:400', '1W:600'),
  ),
  preset(
    'Diatone',
    'Mamba Ultra 1000 (EU)',
    'Tramp',
    bands(EU, false),
    power('25:25', '200:100', '400:200', '800:400', '1W:600'),
  ),

  preset(
    'Eachine',
    'TX805',
    'SmartAudio 2.0',
    bands(LONG_NAMES, true),
    power('25:0', '200:1', '600:2', '800:3'),
  ),
  preset(
    'Eachine',
    'TX806 leaf',
    'SmartAudio 2.0',
    bands(LONG_NAMES, true),
    power('25:0', '200:1', '400:2', '800:3', '1W:4'),
  ),
  preset(
    'Eachine',
    'TX1200',
    'SmartAudio 2.0',
    bands(LONG_NAMES, true),
    power('25:0', '200:1', '600:2', '1W2:3'),
  ),
  preset(
    'Eachine',
    'Nano VTX (v1/v2/v3)',
    'Tramp',
    bands(LONG_NAMES, true),
    power('25:25', '100:100', '200:200', '400:400'),
  ),
  preset(
    'Eachine',
    'ATX03S / VTX03S',
    'SmartAudio 2.0',
    bands(LONG_NAMES, true),
    power('25:0', '50:1', '100:2', '200:3'),
  ),
  preset('Eachine', 'TX06 / xx65 AIO', 'SmartAudio 2.0', bands(LONG_NAMES, true), power('25:0')),

  preset('Emax', 'NanoHawk 1S', 'SmartAudio 2.0', bands(LONG_NAMES, true), power('25:0')),

  preset(
    'Foxeer',
    'Reaper Extreme 2.5W',
    'Tramp',
    bands(LONG_NAMES, false),
    power('25:25', '200:100', '500:200', '1.5:400', '2.5:600'),
  ),

  preset(
    'GEPRC',
    'MATEN 5.8G 2.5W VTX PRO',
    'Tramp',
    bands(
      [
        ...LONG_NAMES,
        ['BAND_L', 'L', LOW_RACE],
        ['BAND_U', 'U', [5325, 5348, 5366, 5384, 5402, 5420, 5436, 5456]],
      ],
      false,
    ),
    power('25:25', '200:200', '600:600', '1W6:1600', 'MAX:2500'),
  ),
  preset(
    'GEPRC',
    'RAD 5.8G 2.5W',
    'Tramp',
    bands(SHORT_NAMES, false),
    power('25:25', '200:200', '600:600', '1W6:1600', '2W5:2500'),
  ),

  preset('ImmersionRC', 'Tramp Nano / Tramp HV', 'Tramp', bands(LONG_NAMES, false), TRAMP_POWER),

  preset(
    'JHEMCU',
    'RuiBet Tran-3016W',
    'Tramp',
    bands(LONG_NAMES, false),
    power('25:25', '200:200', '400:400', '800:800', 'MAX:1600'),
  ),
  preset(
    'JHEMCU',
    '5.8G 2.5W',
    'Tramp',
    bands(SHORT_NAMES, false),
    power('25:25', '400:100', '800:200', '1W5:400', '2W5:600', '0MW:1'),
  ),
  preset('JHEMCU', 'VTX20-600', 'Tramp', bands(LONG_NAMES, false), TRAMP_POWER),
  preset(
    'JHEMCU',
    'VTX30-800',
    'Tramp',
    bands(LONG_NAMES, false),
    power('25:25', '100:100', '200:200', '400:400', '800:800'),
  ),

  preset(
    'OpenVTx',
    'OpenVTx (SmartAudio)',
    'SmartAudio 2.1',
    bands([...LONG_NAMES, ['LOWRACE', 'L', OPENVTX_LOW_RACE]], true),
    power('0:1', 'RCE:2', '25:14', '100:20', '400:26'),
  ),
  preset(
    'OpenVTx',
    'OpenVTx (Tramp)',
    'Tramp',
    bands(
      [
        ...LONG_NAMES,
        ['LOWRACE', 'L', OPENVTX_LOW_RACE],
        ['IMD6', 'I', [5732, 5765, 5828, 5840, 5866, 5740, 0, 0]],
      ],
      false,
    ),
    power('0:1', 'RCE:2', '25:25', '100:100', '400:400'),
  ),

  preset(
    'PandaRC',
    'VT5804 BAT',
    'Tramp',
    bands(SHORT_NAMES, false),
    power('25:25', '400:100', '800:200', '1W5:400', '2W5:600'),
  ),

  preset(
    'Rush',
    'Tank Ultimate Plus / Mini / II',
    'SmartAudio 2.1',
    bands(RUSH, false),
    power('25:14', '200:23', '500:27', '800:29'),
  ),
  preset(
    'Rush',
    'Tiny Tank',
    'SmartAudio 2.1',
    bands(RUSH, false),
    power('25:14', '100:20', '200:23', '350:25'),
  ),
  preset(
    'Rush',
    'Tank Racing',
    'SmartAudio 2.1',
    bands(RUSH, false),
    power('25:14', '50:17', '200:23', '500:27'),
  ),
  preset(
    'Rush',
    'Tank Solo',
    'SmartAudio 2.1',
    bands(RUSH, false),
    power('25:14', '400:26', '800:29', 'MAX:32'),
  ),

  preset(
    'SpeedyBee',
    'TX800',
    'Tramp',
    bands(US, false),
    power('25:25', '200:200', '400:400', '800:600', '800:600'),
  ),
  preset(
    'SpeedyBee',
    'TX800 (EU)',
    'Tramp',
    bands(EU, false),
    power('25:25', '200:200', '400:400', '800:600', '800:600'),
  ),
  preset(
    'SpeedyBee',
    'TX Ultra',
    'Tramp',
    bands([...LONG_NAMES, ['LOWRACE', 'L', LOW_RACE]], false),
    power('25:25', '200:100', '800:200', 'MAX:500'),
  ),
  preset(
    'SpeedyBee',
    'TX Ultra (EU)',
    'Tramp',
    bands(EU, false),
    power('25:25', '200:100', '800:200', 'MAX:500'),
  ),

  preset(
    'TBS',
    'Unify Pro32 HV',
    'SmartAudio 2.1',
    bands(LONG_NAMES, true),
    power('25:14', '100:20', '400:26', '1W+:36'),
  ),
  preset(
    'TBS',
    'Unify Pro32 Nano',
    'SmartAudio 2.1',
    bands(LONG_NAMES, true),
    power('25:14', '100:20', '400:26', 'MAX:36'),
  ),
  preset(
    'TBS',
    'Unify EVO 5G8 (HV)',
    'SmartAudio 2.1',
    bands(LONG_NAMES, true),
    power('25:14', '100:20', '500:27', '800:36'),
  ),
  preset(
    'TBS',
    'Unify Pro HV 800 mW / Unify Pro V3 (5 V)',
    'SmartAudio 2.0',
    bands(LONG_NAMES, true),
    power('25:0', '200:1', '500:2', '800:3'),
  ),
  preset(
    'TBS',
    'Unify Pro HV Race',
    'SmartAudio 2.0',
    bands(LONG_NAMES, true),
    power('25:0', '200:1'),
  ),
  preset(
    'TBS',
    'Unify Pro Nano (not Pro32)',
    'SmartAudio 2.0',
    bands(LONG_NAMES, true),
    power('25:0', '50:1'),
  ),
]

export const VTX_MANUFACTURERS: string[] = [...new Set(VTX_PRESETS.map((p) => p.manufacturer))]

export function presetsOf(manufacturer: string): VtxPreset[] {
  return VTX_PRESETS.filter((p) => p.manufacturer === manufacturer)
}

export function findPreset(id: string): VtxPreset | undefined {
  return VTX_PRESETS.find((p) => p.id === id)
}
