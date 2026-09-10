// Every emoji in the garden's growth-stage tables must render on a computer,
// not only on a phone.
//
// A family reported a blank picture at the Seed stage on her desktop while
// her iPhone showed it. The two stage tables used 🫘 (Emoji 14.0, 2021) for
// Seed and 🪴 (Emoji 13.0, 2020). Windows 10 and older macOS system fonts
// carry neither, so both stages drew as a blank box: the Seed stage is what
// every new family sees first, and hers was empty. Every other stage in the
// table was already pre-2016.
//
// The rule this holds: nothing in these tables may use a codepoint added
// after Emoji 12.0 (2019), which is old enough to be in the shipped fonts of
// any machine a homeschool family is realistically using.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TABLES = [
  ['app/dashboard/garden/page.tsx', 'GROWTH_STAGES'],
  ['app/child/page.tsx', 'GROWTH_STAGES'],
] as const

/** The `emoji: "..."` values inside the named table literal. */
function stageEmoji(relPath: string, tableName: string): string[] {
  const src = readFileSync(resolve(import.meta.dirname, '..', relPath), 'utf8')
  const start = src.indexOf(`const ${tableName} = [`)
  assert.notEqual(start, -1, `${tableName} not found in ${relPath}`)
  const end = src.indexOf('\n];', start)
  assert.notEqual(end, -1, `${tableName} literal not closed in ${relPath}`)
  const table = src.slice(start, end)
  return [...table.matchAll(/emoji:\s*"([^"]+)"/g)].map((m) => m[1])
}

/**
 * Codepoints first assigned in Emoji 13.0 (Unicode 13.0) or later, i.e. the
 * ones a 2020-or-older system font will not have. Anything at or above
 * U+1FA70 is Unicode 12.0's Symbols and Pictographs Extended-A block or
 * newer, which is exactly the risky range; the 2019 additions in it are also
 * too new for a Windows 10 install that has never been updated.
 */
function tooNew(emoji: string): boolean {
  for (const ch of emoji) {
    const cp = ch.codePointAt(0)!
    if (cp >= 0x1fa70) return true
  }
  return false
}

for (const [relPath, tableName] of TABLES) {
  test(`${relPath} ${tableName} uses no emoji newer than a 2019 system font`, () => {
    const found = stageEmoji(relPath, tableName)
    assert.ok(found.length >= 8, `expected the full stage ladder, got ${found.length}`)
    const offenders = found.filter(tooNew)
    assert.deepEqual(
      offenders,
      [],
      'These render as a blank box on Windows 10 and older macOS. Pick an Emoji 1.0 equivalent.',
    )
  })

  test(`${relPath} Seed is 🌰 and Seedling is 🍃`, () => {
    const found = stageEmoji(relPath, tableName)
    // Position, not just presence: the two replacements have to land on the
    // stages that were broken, and the rest of the ladder must not move.
    assert.equal(found[0], '🌰', 'Seed')
    assert.equal(found[1], '🌱', 'Sprouting, unchanged')
    assert.equal(found[2], '🍃', 'Seedling')
    assert.equal(found[3], '🌿', 'Growing, unchanged')
    assert.equal(found[4], '🌳', 'Young Tree, unchanged')
    assert.equal(found[5], '🌲', 'Flourishing, unchanged')
    assert.equal(found[6], '🌸', 'Blossoming, unchanged')
    assert.equal(found[7], '🍎', 'Bearing Fruit, unchanged')
  })

  test(`${relPath} the retired codepoints are gone`, () => {
    const src = readFileSync(resolve(import.meta.dirname, '..', relPath), 'utf8')
    const table = src.slice(src.indexOf(`const ${tableName} = [`), src.indexOf('\n];', src.indexOf(`const ${tableName} = [`)))
    assert.ok(!table.includes('\u{1FAD8}'), 'beans (Emoji 14.0) is back in the table')
    assert.ok(!table.includes('\u{1FAB4}'), 'potted plant (Emoji 13.0) is back in the table')
  })
}

test('the garden stage thresholds and labels did not move', () => {
  const src = readFileSync(resolve(import.meta.dirname, '..', 'app/dashboard/garden/page.tsx'), 'utf8')
  const start = src.indexOf('const GROWTH_STAGES = [')
  const table = src.slice(start, src.indexOf('\n];', start))
  const mins = [...table.matchAll(/min:\s*(\d+)/g)].map((m) => Number(m[1]))
  assert.deepEqual(mins, [0, 1, 10, 25, 50, 100, 200, 500])
  const names = [...table.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(names, [
    'Seed', 'Sprouting', 'Seedling', 'Growing',
    'Young Tree', 'Flourishing', 'Blossoming', 'Bearing Fruit',
  ])
})
