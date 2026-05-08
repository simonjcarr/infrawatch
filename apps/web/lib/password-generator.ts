export type PasswordGeneratorMode = 'password' | 'passphrase'

export interface PasswordGeneratorOptions {
  mode: PasswordGeneratorMode
  length: number
  includeLowercase: boolean
  includeUppercase: boolean
  includeNumbers: boolean
  includeSymbols: boolean
  excludeAmbiguous: boolean
  customSymbols: string
  wordCount: number
  separator: string
  capitalizeWords: boolean
  includePassphraseNumber: boolean
}

export interface PasswordStrengthEstimate {
  entropyBits: number
  label: 'Weak' | 'Fair' | 'Strong' | 'Excellent'
  score: 0 | 1 | 2 | 3
}

export type PasswordGeneratorRandomInt = (maxExclusive: number) => number

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const NUMBERS = '0123456789'
const DEFAULT_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?'
const AMBIGUOUS_CHARACTERS = new Set('O0oIl1'.split(''))
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128
const MIN_WORD_COUNT = 3
const MAX_WORD_COUNT = 10

const PASSPHRASE_WORDS = [
  'anchor',
  'atlas',
  'beacon',
  'binary',
  'brisk',
  'canyon',
  'cedar',
  'cipher',
  'cobalt',
  'comet',
  'coral',
  'delta',
  'ember',
  'falcon',
  'fathom',
  'fibre',
  'forge',
  'harbor',
  'hazel',
  'helium',
  'indigo',
  'ion',
  'jade',
  'kepler',
  'lagoon',
  'lattice',
  'lumen',
  'matrix',
  'meridian',
  'nebula',
  'nickel',
  'nova',
  'onyx',
  'orbit',
  'parity',
  'pixel',
  'plasma',
  'quartz',
  'radar',
  'raven',
  'relay',
  'ripple',
  'signal',
  'silicon',
  'summit',
  'tango',
  'tidal',
  'vector',
  'velvet',
  'vertex',
  'violet',
  'zenith',
]

export const DEFAULT_PASSWORD_GENERATOR_OPTIONS: PasswordGeneratorOptions = {
  mode: 'password',
  length: 20,
  includeLowercase: true,
  includeUppercase: true,
  includeNumbers: true,
  includeSymbols: true,
  excludeAmbiguous: true,
  customSymbols: DEFAULT_SYMBOLS,
  wordCount: 4,
  separator: '-',
  capitalizeWords: false,
  includePassphraseNumber: true,
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
}

function normaliseSymbols(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_SYMBOLS
  }
  const unique = Array.from(new Set(value.trim().split(''))).join('')
  return unique || DEFAULT_SYMBOLS
}

function normaliseSeparator(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_PASSWORD_GENERATOR_OPTIONS.separator
  }
  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= 3 ? trimmed : DEFAULT_PASSWORD_GENERATOR_OPTIONS.separator
}

export function normalisePasswordGeneratorOptions(
  input: Partial<PasswordGeneratorOptions> = {},
): PasswordGeneratorOptions {
  return {
    mode: input.mode === 'passphrase' ? 'passphrase' : 'password',
    length: clampInteger(
      input.length,
      MIN_PASSWORD_LENGTH,
      MAX_PASSWORD_LENGTH,
      DEFAULT_PASSWORD_GENERATOR_OPTIONS.length,
    ),
    includeLowercase: input.includeLowercase ?? DEFAULT_PASSWORD_GENERATOR_OPTIONS.includeLowercase,
    includeUppercase: input.includeUppercase ?? DEFAULT_PASSWORD_GENERATOR_OPTIONS.includeUppercase,
    includeNumbers: input.includeNumbers ?? DEFAULT_PASSWORD_GENERATOR_OPTIONS.includeNumbers,
    includeSymbols: input.includeSymbols ?? DEFAULT_PASSWORD_GENERATOR_OPTIONS.includeSymbols,
    excludeAmbiguous: input.excludeAmbiguous ?? DEFAULT_PASSWORD_GENERATOR_OPTIONS.excludeAmbiguous,
    customSymbols: normaliseSymbols(input.customSymbols),
    wordCount: clampInteger(
      input.wordCount,
      MIN_WORD_COUNT,
      MAX_WORD_COUNT,
      DEFAULT_PASSWORD_GENERATOR_OPTIONS.wordCount,
    ),
    separator: normaliseSeparator(input.separator),
    capitalizeWords: input.capitalizeWords ?? DEFAULT_PASSWORD_GENERATOR_OPTIONS.capitalizeWords,
    includePassphraseNumber:
      input.includePassphraseNumber ?? DEFAULT_PASSWORD_GENERATOR_OPTIONS.includePassphraseNumber,
  }
}

function removeAmbiguousCharacters(characters: string): string {
  return characters
    .split('')
    .filter((character) => !AMBIGUOUS_CHARACTERS.has(character))
    .join('')
}

function getSelectedCharacterSets(options: PasswordGeneratorOptions): string[] {
  const sets = [
    options.includeLowercase ? LOWERCASE : '',
    options.includeUppercase ? UPPERCASE : '',
    options.includeNumbers ? NUMBERS : '',
    options.includeSymbols ? options.customSymbols : '',
  ]
    .map((characters) => (options.excludeAmbiguous ? removeAmbiguousCharacters(characters) : characters))
    .filter(Boolean)

  if (sets.length === 0) {
    throw new Error('Select at least one character type before generating a password.')
  }
  return sets
}

function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('Random range must be a positive integer.')
  }
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure browser crypto is required to generate passwords.')
  }

  const maximumUint32 = 0xffffffff
  const limit = maximumUint32 - (maximumUint32 % maxExclusive)
  const buffer = new Uint32Array(1)
  let value = 0
  do {
    cryptoApi.getRandomValues(buffer)
    value = buffer[0] ?? 0
  } while (value >= limit)

  return value % maxExclusive
}

function randomCharacter(characters: string, randomInt: PasswordGeneratorRandomInt): string {
  return characters[randomInt(characters.length)]!
}

function shuffleCharacters(characters: string[], randomInt: PasswordGeneratorRandomInt): string[] {
  const shuffled = [...characters]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1)
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!]
  }
  return shuffled
}

function capitalizeWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function generateCharacterPassword(
  options: PasswordGeneratorOptions,
  randomInt: PasswordGeneratorRandomInt,
): string {
  const sets = getSelectedCharacterSets(options)
  if (options.length < sets.length) {
    throw new Error('Password length is too short for the selected character types.')
  }

  const allCharacters = sets.join('')
  const characters = sets.map((set) => randomCharacter(set, randomInt))
  while (characters.length < options.length) {
    characters.push(randomCharacter(allCharacters, randomInt))
  }

  return shuffleCharacters(characters, randomInt).join('')
}

function generatePassphrase(options: PasswordGeneratorOptions, randomInt: PasswordGeneratorRandomInt): string {
  const words = Array.from({ length: options.wordCount }, () => {
    const word = PASSPHRASE_WORDS[randomInt(PASSPHRASE_WORDS.length)]!
    return options.capitalizeWords ? capitalizeWord(word) : word
  })

  if (options.includePassphraseNumber) {
    words.push(String(randomInt(90) + 10))
  }

  return words.join(options.separator)
}

export function generatePassword(
  input: Partial<PasswordGeneratorOptions> = {},
  randomInt: PasswordGeneratorRandomInt = secureRandomInt,
): string {
  const options = normalisePasswordGeneratorOptions(input)
  return options.mode === 'passphrase'
    ? generatePassphrase(options, randomInt)
    : generateCharacterPassword(options, randomInt)
}

export function estimatePasswordStrength(password: string): PasswordStrengthEstimate {
  const uniqueCharacters = new Set(password.split('')).size
  const hasLowercase = /[a-z]/.test(password)
  const hasUppercase = /[A-Z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSymbol = /[^A-Za-z0-9]/.test(password)
  const poolSize =
    (hasLowercase ? 26 : 0) +
    (hasUppercase ? 26 : 0) +
    (hasNumber ? 10 : 0) +
    (hasSymbol ? DEFAULT_SYMBOLS.length : 0)
  const repetitionPenalty = uniqueCharacters <= 2 && password.length > 4 ? 0.5 : 1
  const entropyBits = password.length && poolSize
    ? Math.round(password.length * Math.log2(poolSize) * repetitionPenalty)
    : 0

  if (entropyBits >= 100) {
    return { entropyBits, label: 'Excellent', score: 3 }
  }
  if (entropyBits >= 70) {
    return { entropyBits, label: 'Strong', score: 2 }
  }
  if (entropyBits >= 45) {
    return { entropyBits, label: 'Fair', score: 1 }
  }
  return { entropyBits, label: 'Weak', score: 0 }
}
