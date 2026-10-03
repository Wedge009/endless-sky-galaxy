// Sorting events into those a reference assumes happened and those that hang
// on a story choice, from a small storyline with one of each kind of branch.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseData } from '../scripts/dataFile.js'
import { analyseEvents } from '../scripts/events.js'

/** An event that gives system `system` government `government`. @param {string} name @param {string} system @param {string} government */
const event = (name, system, government) => `event "${name}"\n\tsystem ${system}\n\t\tgovernment ${government}\n`

const STORY = [
  // Dated: every new game has it.
  'event "war"\n\tdate 1 1 3014\n\tsystem A\n\t\tgovernment War\n',
  // A chain whose second step follows from a condition the first sets.
  'mission "Chain 1"\n\ton complete\n\t\tevent "chain done"\n\t\tset "chain flag"\n',
  event('chain done', 'A', 'One'),
  'mission "Chain 2"\n\tto offer\n\t\thas "chain flag"\n\ton complete\n\t\tevent "chain later"\n',
  event('chain later', 'A', 'Two'),
  // An outcome: take up "Big Choice", or turn it down and follow "Alt Path".
  'mission "Big Choice"\n\tto offer\n\t\thas "Chain 2: done"\n\ton offer\n\t\tconversation\n\t\t\tchoice\n\t\t\t\t"Yes."\n\t\t\t\t"No."\n\t\t\t\t\tdecline\n\ton complete\n\t\tevent "path one"\n',
  'mission "Alt Path"\n\tto offer\n\t\thas "Chain 2: done"\n\t\tnot "Big Choice: done"\n\ton complete\n\t\tevent "path two"\n',
  event('path one', 'B', 'P'),
  event('path two', 'B', 'Q'),
  // Siblings: whichever is offered first rules out the other.
  'mission "Left"\n\tto offer\n\t\thas "Chain 1: done"\n\t\tnot "Right: offered"\n\ton complete\n\t\tevent "went left"\n',
  'mission "Right"\n\tto offer\n\t\thas "Chain 1: done"\n\t\tnot "Left: offered"\n\ton complete\n\t\tevent "went right"\n',
  event('went left', 'C', 'L'),
  event('went right', 'C', 'R'),
  // A side mission that lapses once the main one is done: not a choice.
  'mission "Main"\n\tto offer\n\t\thas "Chain 1: done"\n\ton complete\n\t\tevent "main done"\n',
  'mission "Side"\n\tto offer\n\t\thas "Chain 1: done"\n\tto fail\n\t\thas "Main: done"\n',
  event('main done', 'D', 'M'),
  // A conversation that always ends by declining: declining is the way on.
  'mission "Talk"\n\tto offer\n\t\thas "Chain 1: done"\n\ton offer\n\t\tconversation\n\t\t\t"Hello."\n\t\t\t\tdecline\n',
  'mission "After Talk"\n\tto offer\n\t\thas "Talk: declined"\n\ton complete\n\t\tevent "after talk"\n',
  event('after talk', 'E', 'T'),
  // Nothing triggers this one.
  event('orphan', 'A', 'Nobody'),
].join('\n')

const { events, choices } = analyseEvents(parseData(STORY), {
  isRelevant: node => node.children.some(c => c.tokens[0] === 'system'),
  labels: { 'Big Choice': { label: 'The big choice', options: { 'done': 'Accept', 'not done': 'Decline' } } },
})

test('assumes events on the path through each storyline', () => {
  for (const name of ['chain done', 'chain later', 'main done', 'after talk']) assert.equal(events[name].status, 'assumed', name)
})

test('assumes dated events, and orders them first', () => {
  assert.equal(events.war.status, 'assumed')
  assert.equal(events.war.date, '3014-01-01')
  assert.equal(events.war.order, 0)
})

test('orders a storyline\'s events, following conditions set along the way', () => {
  assert.ok(events['chain done'].order < events['chain later'].order)
})

test('finds an outcome choice: a declinable mission, or the path that follows declining it', () => {
  const choice = choices.find(c => c.key === 'Big Choice')
  assert.ok(choice)
  assert.equal(choice.label, 'The big choice')
  assert.deepEqual(choice.options.map(o => [o.id, o.label, o.events]), [['done', 'Accept', ['path one']], ['not done', 'Decline', ['path two']]])
  assert.equal(choice.default, 'done')
  assert.deepEqual(events['path two'].choices, [{ choice: 'Big Choice', option: 'not done' }])
})

test('finds a choice between siblings that rule each other out', () => {
  const choice = choices.find(c => c.key === 'Left | Right')
  assert.ok(choice)
  assert.deepEqual(choice.options.map(o => o.events), [['went left'], ['went right']])
})

test('makes no choice of a side mission that lapses, or a conversation that declines', () => {
  assert.equal(choices.length, 2)
})

test('notes events that nothing triggers', () => {
  assert.equal(events.orphan.status, 'never')
})
