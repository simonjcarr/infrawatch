import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_PASSWORD_GENERATOR_OPTIONS,
  estimatePasswordStrength,
  generatePassword,
  normalisePasswordGeneratorOptions,
} from './password-generator.ts'

function createCyclingRandomInt() {
  let current = 0
  return (max) => {
    const next = current % max
    current += 1
    return next
  }
}

test('generatePassword creates a bounded password with every selected character class', () => {
  const password = generatePassword(
    {
      ...DEFAULT_PASSWORD_GENERATOR_OPTIONS,
      length: 20,
      includeLowercase: true,
      includeUppercase: true,
      includeNumbers: true,
      includeSymbols: true,
      excludeAmbiguous: false,
    },
    createCyclingRandomInt(),
  )

  assert.equal(password.length, 20)
  assert.match(password, /[a-z]/)
  assert.match(password, /[A-Z]/)
  assert.match(password, /[0-9]/)
  assert.match(password, /[^A-Za-z0-9]/)
})

test('generatePassword excludes ambiguous characters when requested', () => {
  const password = generatePassword(
    {
      ...DEFAULT_PASSWORD_GENERATOR_OPTIONS,
      length: 64,
      includeLowercase: true,
      includeUppercase: true,
      includeNumbers: true,
      includeSymbols: false,
      excludeAmbiguous: true,
    },
    createCyclingRandomInt(),
  )

  assert.doesNotMatch(password, /[O0oIl1]/)
})

test('normalisePasswordGeneratorOptions clamps risky option values', () => {
  const options = normalisePasswordGeneratorOptions({
    length: 500,
    wordCount: 99,
    separator: 'too-long',
    customSymbols: '',
  })

  assert.equal(options.length, 128)
  assert.equal(options.wordCount, 10)
  assert.equal(options.separator, '-')
  assert.equal(options.customSymbols, DEFAULT_PASSWORD_GENERATOR_OPTIONS.customSymbols)
})

test('generatePassword creates memorable passphrases from the shared generator', () => {
  const passphrase = generatePassword(
    {
      ...DEFAULT_PASSWORD_GENERATOR_OPTIONS,
      mode: 'passphrase',
      wordCount: 4,
      separator: '.',
      capitalizeWords: true,
      includePassphraseNumber: true,
    },
    createCyclingRandomInt(),
  )

  assert.match(passphrase, /^[A-Z][a-z]+(\.[A-Z][a-z]+){3}\.[0-9]{2}$/)
})

test('estimatePasswordStrength reports stronger entropy for longer generated secrets', () => {
  const weak = estimatePasswordStrength('abc123')
  const strong = estimatePasswordStrength('aB3!aB3!aB3!aB3!aB3!')

  assert.equal(weak.label, 'Weak')
  assert.ok(strong.entropyBits > weak.entropyBits)
  assert.ok(strong.score > weak.score)
})
