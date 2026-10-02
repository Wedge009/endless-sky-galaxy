// Readable names for the story choices that scripts/events.js finds, keyed by
// the choice's key: the anchor mission of an outcome, or the sibling missions
// joined with " | ". The options of an outcome are "done" and "not done".
//
// This only names choices and picks their defaults; finding them is
// automatic. Without a default here, a choice defaults to its first option.
// Where one is set, neither path is clearly the more usual, so it's a pick.
//
// A choice missing from here is still offered, under its mission names, so a
// new branch in a later version of the game shows up rather than being
// silently applied. Keys that no longer match are reported by the extractor.

/** @type {Record<string, { label: string, options: Record<string, string>, default?: string }>} */
export const choiceLabels = {
  'FW Defend New Tibet': {
    label: 'Free Worlds: outcome of the war',
    options: { 'done': 'Reconciliation', 'not done': 'Checkmate' },
  },
  'FW Pirates: Attack 1 | FW Pirates: Diplomacy 1': {
    label: 'Free Worlds: the southern pirates',
    options: { 'FW Pirates: Attack 1': 'Attack', 'FW Pirates: Diplomacy 1': 'Negotiate' },
    default: 'FW Pirates: Diplomacy 1',
  },
  'FW Northern 4.1A | FW Northern 4.2A': {
    label: 'Free Worlds: Poisonwood (karma and Oathkeeper reputation)',
    options: { 'FW Northern 4.1A': 'Liberated', 'FW Northern 4.2A': 'Reverts to the Republic' },
  },
  'FW Bloodsea 1.1 | FW Bloodsea 1.2': {
    label: 'Free Worlds: Bloodsea',
    options: { 'FW Bloodsea 1.1': 'Joins the Free Worlds', 'FW Bloodsea 1.2': 'Independent' },
  },
  'Wanderers: Sestor: Bomb Zenith 1 | Wanderers: Sestor: Farpoint Attack 2': {
    label: 'Wanderers: the Sestor at Zenith',
    options: { 'Wanderers: Sestor: Bomb Zenith 1': 'Bomb Zenith', 'Wanderers: Sestor: Farpoint Attack 2': 'Attack Farpoint first' },
  },
  'Wanderers: Alpha Surveillance C | Wanderers: Alpha Surveillance C (Naughty)': {
    label: 'Wanderers: the stolen micro-satellite',
    options: { 'Wanderers: Alpha Surveillance C': 'Not stolen', 'Wanderers: Alpha Surveillance C (Naughty)': 'Stolen' },
  },
}
