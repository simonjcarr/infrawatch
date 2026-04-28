package vuln

import (
	"strconv"
	"strings"
	"unicode"
)

func CompareDistroVersion(source, a, b string) int {
	switch source {
	case "dpkg", "apt", "ubuntu", "debian":
		return normalizeCompare(compareDebianVersion(a, b))
	case "rpm", "dnf", "yum", "redhat", "rhel", "fedora", "centos":
		return normalizeCompare(compareRPMVersion(a, b))
	case "apk", "alpine":
		return normalizeCompare(compareAlpineVersion(a, b))
	default:
		return normalizeCompare(compareNaturalVersion(a, b))
	}
}

func normalizeCompare(v int) int {
	if v < 0 {
		return -1
	}
	if v > 0 {
		return 1
	}
	return 0
}

func compareDebianVersion(a, b string) int {
	ae, au, ar := splitDebianVersion(a)
	be, bu, br := splitDebianVersion(b)
	if ae != be {
		return ae - be
	}
	if c := debianPartCompare(au, bu); c != 0 {
		return c
	}
	return debianPartCompare(ar, br)
}

func splitDebianVersion(v string) (epoch int, upstream, revision string) {
	if before, after, ok := strings.Cut(v, ":"); ok {
		if parsed, err := strconv.Atoi(before); err == nil {
			epoch = parsed
			v = after
		}
	}
	if idx := strings.LastIndex(v, "-"); idx >= 0 {
		return epoch, v[:idx], v[idx+1:]
	}
	return epoch, v, ""
}

func debianPartCompare(a, b string) int {
	for len(a) > 0 || len(b) > 0 {
		an := takeDebianNonDigit(a)
		bn := takeDebianNonDigit(b)
		if c := debianLexCompare(an, bn); c != 0 {
			return c
		}
		a = a[len(an):]
		b = b[len(bn):]

		ad := takeDigits(a)
		bd := takeDigits(b)
		if c := compareNumericStrings(ad, bd); c != 0 {
			return c
		}
		a = a[len(ad):]
		b = b[len(bd):]
	}
	return 0
}

func takeDebianNonDigit(s string) string {
	i := 0
	for i < len(s) && !unicode.IsDigit(rune(s[i])) {
		i++
	}
	return s[:i]
}

func takeDigits(s string) string {
	i := 0
	for i < len(s) && unicode.IsDigit(rune(s[i])) {
		i++
	}
	return s[:i]
}

func debianLexCompare(a, b string) int {
	for len(a) > 0 || len(b) > 0 {
		ac := debianOrderChar(a)
		bc := debianOrderChar(b)
		if ac != bc {
			return ac - bc
		}
		if len(a) > 0 {
			a = a[1:]
		}
		if len(b) > 0 {
			b = b[1:]
		}
	}
	return 0
}

func debianOrderChar(s string) int {
	if s == "" {
		return 0
	}
	c := rune(s[0])
	if c == '~' {
		return -1
	}
	if unicode.IsLetter(c) {
		return int(c)
	}
	return int(c) + 256
}

func compareRPMVersion(a, b string) int {
	ae, av := splitEpoch(a)
	be, bv := splitEpoch(b)
	if ae != be {
		return ae - be
	}
	return rpmvercmp(av, bv)
}

func splitEpoch(v string) (int, string) {
	before, after, ok := strings.Cut(v, ":")
	if !ok {
		return 0, v
	}
	epoch, err := strconv.Atoi(before)
	if err != nil {
		return 0, v
	}
	return epoch, after
}

func rpmvercmp(a, b string) int {
	for len(a) > 0 || len(b) > 0 {
		a = strings.TrimLeftFunc(a, rpmSeparator)
		b = strings.TrimLeftFunc(b, rpmSeparator)
		if a == "" || b == "" {
			return len(a) - len(b)
		}

		anum := unicode.IsDigit(rune(a[0]))
		bnum := unicode.IsDigit(rune(b[0]))
		if anum && !bnum {
			return 1
		}
		if !anum && bnum {
			return -1
		}

		as := takeRPMPart(a, anum)
		bs := takeRPMPart(b, bnum)
		var c int
		if anum {
			c = compareNumericStrings(as, bs)
		} else {
			c = strings.Compare(as, bs)
		}
		if c != 0 {
			return c
		}
		a = a[len(as):]
		b = b[len(bs):]
	}
	return 0
}

func rpmSeparator(r rune) bool {
	return !(unicode.IsDigit(r) || unicode.IsLetter(r) || r == '~')
}

func takeRPMPart(s string, numeric bool) string {
	i := 0
	for i < len(s) {
		isDigit := unicode.IsDigit(rune(s[i]))
		if isDigit != numeric || rpmSeparator(rune(s[i])) {
			break
		}
		i++
	}
	return s[:i]
}

func compareAlpineVersion(a, b string) int {
	return compareNaturalVersion(a, b)
}

func compareNaturalVersion(a, b string) int {
	for len(a) > 0 || len(b) > 0 {
		if a == "" || b == "" {
			return len(a) - len(b)
		}
		anum := unicode.IsDigit(rune(a[0]))
		bnum := unicode.IsDigit(rune(b[0]))
		as := takeNaturalPart(a, anum)
		bs := takeNaturalPart(b, bnum)
		var c int
		if anum && bnum {
			c = compareNumericStrings(as, bs)
		} else {
			c = strings.Compare(as, bs)
		}
		if c != 0 {
			return c
		}
		a = a[len(as):]
		b = b[len(bs):]
	}
	return 0
}

func takeNaturalPart(s string, numeric bool) string {
	i := 0
	for i < len(s) && unicode.IsDigit(rune(s[i])) == numeric {
		i++
	}
	return s[:i]
}

func compareNumericStrings(a, b string) int {
	a = strings.TrimLeft(a, "0")
	b = strings.TrimLeft(b, "0")
	if a == "" {
		a = "0"
	}
	if b == "" {
		b = "0"
	}
	if len(a) != len(b) {
		return len(a) - len(b)
	}
	return strings.Compare(a, b)
}
