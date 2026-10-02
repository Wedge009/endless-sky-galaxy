// Per-viewer settings that survive a reload. Falls back to the defaults if
// localStorage is unavailable (private browsing etc.).

const PREFIX = 'endless-sky-galaxy:'

/**
 * @template T
 * @param {string} key
 * @param {T} initial
 * @returns {T}
 */
export function load(key, initial) {
  try {
    const stored = localStorage.getItem(PREFIX + key)
    if (stored !== null) return { ...initial, ...JSON.parse(stored) }
  } catch {
    // Corrupt or unavailable - use the defaults.
  }
  return initial
}

/** @param {string} key @param {unknown} value */
export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Unavailable - the setting just won't persist.
  }
}
