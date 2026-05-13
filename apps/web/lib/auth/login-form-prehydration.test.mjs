import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const loginFormSource = readFileSync(
  new URL('../../app/(auth)/login/login-form.tsx', import.meta.url),
  'utf8',
)

test('login forms do not submit credentials as native GET requests before hydration', () => {
  assert.match(loginFormSource, /const \[isHydrated, setIsHydrated\] = useState\(false\)/)
  assert.match(loginFormSource, /useEffect\(\(\) => \{\s*setIsHydrated\(true\)\s*\}, \[\]\)/)
  assert.match(loginFormSource, /<form method="post" onSubmit=\{localForm\.handleSubmit\(onLocalSubmit\)\}>/)
  assert.match(loginFormSource, /disabled=\{!isHydrated \|\| localForm\.formState\.isSubmitting\}/)
  assert.match(loginFormSource, /disabled=\{!isHydrated \|\| domainForm\.formState\.isSubmitting/)
})
