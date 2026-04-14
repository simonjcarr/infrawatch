/**
 * Pragmatic version comparison for software inventory.
 *
 * Strategy (applied in order):
 *  1. Try semver.coerce on both sides and compare with semver.compare.
 *  2. Strip Debian/RPM epoch prefix ("2:" → "") and distro suffix
 *     ("-1ubuntu1", "-1.el8", etc.) then retry semver.
 *  3. Fall back to natural sort: split on [.-] and compare segments numerically
 *     when both parse as integers, lexically otherwise.
 *
 * Limitation: perfect Debian/RPM comparison semantics require dpkg/rpmvercmp
 * logic which is complex to port. For "between X and Y" queries on epoch-heavy
 * versions, recommend using "prefix" mode instead.
 */
import semver from 'semver'

/** Strip leading epoch ("2:") and trailing distro suffix ("-1ubuntu1" etc.) */
function stripEpochAndSuffix(v: string): string {
  // Remove epoch like "2:" or "1:"
  const withoutEpoch = v.replace(/^\d+:/, '')
  // Remove distro suffix: -<digits><letters...> at the end
  return withoutEpoch.replace(/-\d+[a-zA-Z][^.]*$/, '')
}

function naturalCompare(a: string, b: string): -1 | 0 | 1 {
  const segmentsA = a.split(/[\.\-]/)
  const segmentsB = b.split(/[\.\-]/)
  const len = Math.max(segmentsA.length, segmentsB.length)
  for (let i = 0; i < len; i++) {
    const sa = segmentsA[i] ?? ''
    const sb = segmentsB[i] ?? ''
    const na = parseInt(sa, 10)
    const nb = parseInt(sb, 10)
    if (!isNaN(na) && !isNaN(nb)) {
      if (na < nb) return -1
      if (na > nb) return 1
    } else {
      if (sa < sb) return -1
      if (sa > sb) return 1
    }
  }
  return 0
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  // 1. Direct semver
  const ca = semver.coerce(a)
  const cb = semver.coerce(b)
  if (ca && cb) {
    const result = semver.compare(ca, cb)
    return result < 0 ? -1 : result > 0 ? 1 : 0
  }

  // 2. Strip epoch/distro suffix and retry
  const sa = stripEpochAndSuffix(a)
  const sb = stripEpochAndSuffix(b)
  const csa = semver.coerce(sa)
  const csb = semver.coerce(sb)
  if (csa && csb) {
    const result = semver.compare(csa, csb)
    return result < 0 ? -1 : result > 0 ? 1 : 0
  }

  // 3. Natural sort fallback
  return naturalCompare(a, b)
}

/**
 * Returns true if version `v` falls within [lo, hi] inclusive.
 * Uses the same comparison strategy as compareVersions.
 */
export function versionInRange(v: string, lo: string, hi: string): boolean {
  return compareVersions(v, lo) >= 0 && compareVersions(v, hi) <= 0
}
