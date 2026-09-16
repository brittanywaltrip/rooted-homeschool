// The two optional keys a resource carries in its existing metadata column.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  resourceCardBodyClass,
  resourceCardShellClass,
  resourceImagePath,
  resourceSubject,
  validateResourceImagePath,
  validateResourceSubject,
  withResourceMetadata,
} from './resource-metadata.ts'

test('the image: a path under /resources/ with a picture extension', () => {
  assert.equal(resourceImagePath({ image: '/resources/fall/leaf-hunt.webp' }), '/resources/fall/leaf-hunt.webp')
  assert.equal(resourceImagePath({ image: '/resources/x.png' }), '/resources/x.png')
  assert.equal(resourceImagePath({ image: '/resources/x.JPG' }), '/resources/x.JPG', 'extension check is case-insensitive')
  assert.equal(resourceImagePath({ image: '  /resources/fall/leaf-hunt.webp  ' }), '/resources/fall/leaf-hunt.webp')
})

test('the image: anything else is ignored rather than rendered', () => {
  // next/image against an unconfigured remote host is a 400 on the page, and a
  // broken picture is worse than no picture.
  assert.equal(resourceImagePath({ image: 'https://example.com/a.webp' }), null)
  assert.equal(resourceImagePath({ image: 'http://example.com/a.webp' }), null)
  assert.equal(resourceImagePath({ image: '/resources/../../secret.webp' }), null, 'no walking out of public/')
  assert.equal(resourceImagePath({ image: '/printables/a.webp' }), null, 'only under /resources/')
  assert.equal(resourceImagePath({ image: '/resources/a.pdf' }), null)
  assert.equal(resourceImagePath({ image: '' }), null)
  assert.equal(resourceImagePath({ image: 42 }), null)
  assert.equal(resourceImagePath({ image: { path: '/resources/a.webp' } }), null)
  assert.equal(resourceImagePath({}), null)
  assert.equal(resourceImagePath(null), null)
  assert.equal(resourceImagePath(undefined), null)
})

test('the subject: a short string, or nothing', () => {
  assert.equal(resourceSubject({ subject: 'Science' }), 'Science')
  assert.equal(resourceSubject({ subject: '  Nature  Study ' }), 'Nature Study')
  assert.equal(resourceSubject({ subject: 'x'.repeat(24) }), 'x'.repeat(24))
  assert.equal(resourceSubject({ subject: 'x'.repeat(25) }), null, '25 characters is a sentence, not a pill')
  assert.equal(resourceSubject({ subject: '   ' }), null)
  assert.equal(resourceSubject({ subject: 7 }), null)
  assert.equal(resourceSubject({}), null)
  assert.equal(resourceSubject(null), null)
})

test('the admin form says what is wrong, and says nothing when the field is empty', () => {
  assert.equal(validateResourceImagePath(''), null, 'the picture is optional')
  assert.equal(validateResourceImagePath('   '), null)
  assert.equal(validateResourceImagePath('/resources/fall/leaf-hunt.webp'), null)
  assert.match(validateResourceImagePath('https://example.com/a.webp')!, /Start the path with \/resources\//)
  assert.match(validateResourceImagePath('/resources/../a.webp')!, /dots/)
  assert.match(validateResourceImagePath('/resources/a.pdf')!, /\.webp, \.png, \.jpg/)

  assert.equal(validateResourceSubject(''), null)
  assert.equal(validateResourceSubject('Science'), null)
  assert.match(validateResourceSubject('x'.repeat(25))!, /24 characters/)
})

test('saving keeps every other key in the column', () => {
  // metadata belongs to more than this form; the admin select reads the row's
  // object and this spreads it rather than replacing it.
  const existing = { image: '/resources/old.webp', subject: 'Art', affiliate: true, note: 'keep me' }
  assert.deepEqual(withResourceMetadata(existing, { image: '/resources/new.webp', subject: 'Science' }), {
    image: '/resources/new.webp',
    subject: 'Science',
    affiliate: true,
    note: 'keep me',
  })
  // Clearing a field removes the key rather than storing an empty string.
  assert.deepEqual(withResourceMetadata(existing, { image: '', subject: '' }), { affiliate: true, note: 'keep me' })
  assert.deepEqual(withResourceMetadata(null, { image: '/resources/a.webp' }), { image: '/resources/a.webp' })
  assert.deepEqual(withResourceMetadata('not an object', { subject: 'Math' }), { subject: 'Math' })
  assert.deepEqual(withResourceMetadata(['array'], { subject: 'Math' }), { subject: 'Math' })
})

test('a resource with no picture renders exactly the card it always did', () => {
  // The pre-change markup, byte for byte: `<div className="bg-white rounded-2xl
  // border border-[#e8e5e0] hover:bg-[#faf9f7] transition-all p-5">` with no
  // wrapper inside it.
  assert.equal(
    resourceCardShellClass(false),
    'bg-white rounded-2xl border border-[#e8e5e0] hover:bg-[#faf9f7] transition-all p-5',
  )
  assert.equal(resourceCardBodyClass(false), '', 'no extra wrapper padding without a picture')
  // With one, the padding moves inside so the picture reaches the card's edges.
  assert.equal(
    resourceCardShellClass(true),
    'bg-white rounded-2xl border border-[#e8e5e0] hover:bg-[#faf9f7] transition-all overflow-hidden',
  )
  assert.equal(resourceCardBodyClass(true), 'p-5')
})

test('the picture is the same click as the title', () => {
  const src = readFileSync(resolve(import.meta.dirname, '..', 'app/dashboard/resources/page.tsx'), 'utf8')
  const card = src.slice(src.indexOf('function ResourceCard'), src.indexOf('// ─── Main Page'))
  assert.match(card, /const openResource = \(\) => trackResourceClick\(/)
  // Both the picture and the title call it, and both open the same way.
  assert.equal((card.match(/onClick=\{openResource\}/g) ?? []).length, 2)
  assert.equal((card.match(/target="_blank"/g) ?? []).length, 2)
  assert.equal((card.match(/rel="noopener noreferrer"/g) ?? []).length, 2)
  assert.match(card, /loading="lazy"/)
  assert.match(card, /sizes="\(max-width: 640px\) 100vw, 480px"/)
  assert.match(card, /alt=\{r\.title\}/)
})

test('the block is "This Season" and the category key never moved', () => {
  const src = readFileSync(resolve(import.meta.dirname, '..', 'app/dashboard/resources/page.tsx'), 'utf8')
  assert.match(src, /This Season/)
  assert.match(src, /Free picks for right now\./)
  assert.match(src, /back_to_school: "This Season"/, 'the label changed')
  assert.match(src, /back_to_school: "🍂"/)
  // The only mention left is the comment explaining why the KEY still says it.
  const withoutComments = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!withoutComments.includes('Back to School'), 'no "Back to School" copy left on the page')
  assert.match(src, /r\.category === "back_to_school"/, 'and the key is untouched, so no row moves')
})
