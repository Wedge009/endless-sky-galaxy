// Where a system's stellar objects are on a given date, as the game works it
// out: each orbits its parent (or the system's centre) at its distance, with
// its period, starting from its offset (System::SetDate). Periods that aren't
// given come from the masses involved (System::FinishLoading).

const MONTH_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/**
 * Days since 1 January of year 1, as Date::DaysSinceEpoch counts them.
 * @param {number} day @param {number} month @param {number} year
 */
export function daysSinceEpoch(day, month, year) {
  let days = day + MONTH_DAYS[month - 1]
  if (month > 2 && !(year % 4) && (year % 100 || !(year % 400))) ++days
  let y = year - 1
  days += 146097 * Math.floor(y / 400)
  y %= 400
  days += 36524 * Math.floor(y / 100)
  y %= 100
  days += 1461 * Math.floor(y / 4)
  y %= 4
  return days + 365 * y
}

/**
 * The inverse, for showing a date.
 * @param {number} days
 * @returns {[number, number, number]} day, month, year
 */
export function dateFromDays(days) {
  let year = Math.max(1, Math.floor(days / 365.2425))
  while (daysSinceEpoch(1, 1, year + 1) <= days) ++year
  while (daysSinceEpoch(1, 1, year) > days) --year
  let month = 12
  while (daysSinceEpoch(1, month, year) > days) --month
  return [days - daysSinceEpoch(1, month, year) + 1, month, year]
}

/**
 * Every object in a system with what's needed to place it: its parent's index
 * in the list, and its speed in degrees per day.
 * @param {any} system
 * @param {Record<string, { mass?: number }>} stars  sprite -> what stars.txt says of it
 */
export function orbitsOf(system, stars) {
  /** @type {{ object: any, parent: number, speed: number, isStar: boolean }[]} */
  const list = []
  /** @param {any[]} objects @param {number} parent */
  const add = (objects, parent) => {
    for (const object of objects) {
      list.push({ object, parent, speed: 0, isStar: object.sprite?.startsWith('star/') ?? false })
      add(object.children, list.length - 1)
    }
  }
  add(system.objects, -1)

  const mass = (/** @type {string | null} */ sprite) => (sprite && stars[sprite]?.mass) || 0
  let numStars = 0
  let starMass = 0
  let starDistance = 0
  for (const o of list)
    if (o.isStar && mass(o.object.sprite)) {
      numStars++
      starMass += mass(o.object.sprite)
      starDistance += o.object.distance
    }
  // With no stars, everything is taken to orbit the first object.
  let nextIsStar = false
  if (!numStars && list.length) {
    nextIsStar = true
    numStars = 1
    starMass = mass(list[0].object.sprite)
  }

  for (const o of list) {
    let period = o.object.period
    if (!period) {
      period = 10
      const { distance } = o.object
      if (!distance) {
        // At the centre.
      } else if (o.parent >= 0) {
        const parentMass = mass(list[o.parent].object.sprite)
        if (parentMass) period = Math.sqrt(distance ** 3 / parentMass)
      } else if (!starMass) {
        // No mass to orbit; the game warns and uses 10.
      } else if (o.isStar || nextIsStar) {
        nextIsStar = false
        if (numStars > 1) period = Math.sqrt(starDistance ** 3 / starMass)
      } else {
        period = Math.sqrt(distance ** 3 / starMass)
      }
    }
    o.speed = 360 / period
  }
  return list
}

/**
 * Where each object is on a day, in map units from the system's centre, with
 * y pointing down the screen as in game.
 * @param {ReturnType<typeof orbitsOf>} orbits
 * @param {number} days  since the epoch, fractions allowed
 * @returns {number[][]}
 */
export function positionsOn(orbits, days) {
  /** @type {number[][]} */
  const positions = []
  for (const o of orbits) {
    // Angle::Unit is (sin, -cos) of the angle in degrees.
    const radians = ((days * o.speed + o.object.offset) % 360) * Math.PI / 180
    const x = Math.sin(radians) * o.object.distance
    const y = -Math.cos(radians) * o.object.distance
    const parent = o.parent >= 0 ? positions[o.parent] : [0, 0]
    positions.push([x + parent[0], y + parent[1]])
  }
  return positions
}
