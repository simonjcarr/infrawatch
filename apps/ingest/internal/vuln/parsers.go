package vuln

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"
)

func ParseCISAKEV(r io.Reader) ([]KEVEntry, error) {
	var doc struct {
		Vulnerabilities []struct {
			CVEID                      string `json:"cveID"`
			VendorProject              string `json:"vendorProject"`
			Product                    string `json:"product"`
			KnownRansomwareCampaignUse string `json:"knownRansomwareCampaignUse"`
			DueDate                    string `json:"dueDate"`
			RequiredAction             string `json:"requiredAction"`
		} `json:"vulnerabilities"`
	}
	if err := json.NewDecoder(r).Decode(&doc); err != nil {
		return nil, err
	}
	out := make([]KEVEntry, 0, len(doc.Vulnerabilities))
	for _, v := range doc.Vulnerabilities {
		cveID := strings.TrimSpace(v.CVEID)
		if cveID == "" {
			continue
		}
		var due *time.Time
		if v.DueDate != "" {
			if parsed, err := time.Parse("2006-01-02", v.DueDate); err == nil {
				due = &parsed
			}
		}
		out = append(out, KEVEntry{
			CVEID:                      cveID,
			VendorProject:              v.VendorProject,
			Product:                    v.Product,
			KnownRansomwareCampaignUse: strings.EqualFold(v.KnownRansomwareCampaignUse, "known"),
			DueDate:                    due,
			RequiredAction:             v.RequiredAction,
		})
	}
	return out, nil
}

func ParseDebianTracker(r io.Reader) ([]CVERecord, []AffectedPackage, error) {
	var doc map[string]map[string]struct {
		Description string `json:"description"`
		Releases    map[string]struct {
			Status       string `json:"status"`
			FixedVersion string `json:"fixed_version"`
			Urgency      string `json:"urgency"`
		} `json:"releases"`
	}
	if err := json.NewDecoder(r).Decode(&doc); err != nil {
		return nil, nil, err
	}

	cves := make(map[string]CVERecord)
	var affected []AffectedPackage
	for pkgName, byCVE := range doc {
		for cveID, entry := range byCVE {
			if _, ok := cves[cveID]; !ok {
				cves[cveID] = CVERecord{
					CVEID:       cveID,
					Description: entry.Description,
					Severity:    SeverityUnknown,
					Source:      "debian-tracker",
				}
			}
			for codename, rel := range entry.Releases {
				if !debianReleaseCanAffect(rel.Status, rel.FixedVersion) {
					continue
				}
				affected = append(affected, AffectedPackage{
					CVEID:          cveID,
					Source:         "debian-tracker",
					DistroID:       "debian",
					DistroCodename: codename,
					PackageName:    pkgName,
					FixedVersion:   cleanFixedVersion(rel.FixedVersion),
					Severity:       normalizeSeverity(rel.Urgency),
					PackageState:   rel.Status,
				})
			}
		}
	}

	records := make([]CVERecord, 0, len(cves))
	for _, record := range cves {
		records = append(records, record)
	}
	return records, affected, nil
}

func debianReleaseCanAffect(status, fixed string) bool {
	status = strings.ToLower(strings.TrimSpace(status))
	fixed = strings.TrimSpace(fixed)
	if status == "not-affected" || status == "undetermined" {
		return false
	}
	return fixed != "" && !strings.HasPrefix(fixed, "<")
}

func ParseAlpineSecDB(r io.Reader, release, repository string) ([]CVERecord, []AffectedPackage, error) {
	var doc struct {
		Packages []struct {
			Pkg struct {
				Name string `json:"name"`
			} `json:"pkg"`
			Secfixes map[string][]string `json:"secfixes"`
		} `json:"packages"`
	}
	if err := json.NewDecoder(r).Decode(&doc); err != nil {
		return nil, nil, err
	}

	release = strings.TrimPrefix(release, "v")
	cves := make(map[string]CVERecord)
	var affected []AffectedPackage
	for _, pkg := range doc.Packages {
		name := strings.TrimSpace(pkg.Pkg.Name)
		if name == "" {
			continue
		}
		for fixedVersion, cveIDs := range pkg.Secfixes {
			fixedVersion = cleanFixedVersion(fixedVersion)
			if fixedVersion == "" {
				continue
			}
			for _, cveID := range cveIDs {
				cveID = strings.TrimSpace(cveID)
				if cveID == "" || !strings.HasPrefix(cveID, "CVE-") {
					continue
				}
				cves[cveID] = CVERecord{CVEID: cveID, Severity: SeverityUnknown, Source: "alpine-secdb"}
				affected = append(affected, AffectedPackage{
					CVEID:           cveID,
					Source:          "alpine-secdb",
					DistroID:        "alpine",
					DistroVersionID: release,
					PackageName:     name,
					FixedVersion:    fixedVersion,
					Repository:      repository,
					Severity:        SeverityUnknown,
				})
			}
		}
	}

	records := make([]CVERecord, 0, len(cves))
	for _, record := range cves {
		records = append(records, record)
	}
	return records, affected, nil
}

func ParseUbuntuOSVDocument(r io.Reader) ([]CVERecord, []AffectedPackage, error) {
	var doc struct {
		ID       string   `json:"id"`
		Details  string   `json:"details"`
		Aliases  []string `json:"aliases"`
		Upstream []string `json:"upstream"`
		Severity []struct {
			Type  string `json:"type"`
			Score string `json:"score"`
		} `json:"severity"`
		Published string `json:"published"`
		Modified  string `json:"modified"`
		Affected  []struct {
			Package struct {
				Ecosystem string `json:"ecosystem"`
				Name      string `json:"name"`
				Purl      string `json:"purl"`
			} `json:"package"`
			Ranges []struct {
				Events []struct {
					Fixed string `json:"fixed"`
				} `json:"events"`
			} `json:"ranges"`
			Versions []string `json:"versions"`
		} `json:"affected"`
	}
	if err := json.NewDecoder(r).Decode(&doc); err != nil {
		return nil, nil, err
	}

	cveID := firstCVE(doc.Upstream)
	if cveID == "" {
		cveID = firstCVE(doc.Aliases)
	}
	if cveID == "" && strings.Contains(doc.ID, "CVE-") {
		cveID = strings.TrimPrefix(doc.ID, "UBUNTU-")
	}
	if cveID == "" {
		return nil, nil, nil
	}

	record := CVERecord{
		CVEID:       cveID,
		Description: doc.Details,
		Severity:    ubuntuSeverity(doc.Severity),
		Source:      "ubuntu-osv",
	}
	if t := parseRFC3339(doc.Published); t != nil {
		record.PublishedAt = t
	}
	if t := parseRFC3339(doc.Modified); t != nil {
		record.ModifiedAt = t
	}

	var affected []AffectedPackage
	for _, a := range doc.Affected {
		if strings.TrimSpace(a.Package.Name) == "" {
			continue
		}
		versionID, codename := parseUbuntuEcosystem(a.Package.Ecosystem, a.Package.Purl)
		fixed := ""
		for _, rng := range a.Ranges {
			for _, event := range rng.Events {
				if event.Fixed != "" {
					fixed = event.Fixed
				}
			}
		}
		affected = append(affected, AffectedPackage{
			CVEID:            cveID,
			Source:           "ubuntu-osv",
			DistroID:         "ubuntu",
			DistroVersionID:  versionID,
			DistroCodename:   codename,
			PackageName:      a.Package.Name,
			FixedVersion:     cleanFixedVersion(fixed),
			AffectedVersions: a.Versions,
			Severity:         record.Severity,
		})
	}
	return []CVERecord{record}, affected, nil
}

func ParseNVDAPI(r io.Reader) ([]CVERecord, int, error) {
	var doc struct {
		TotalResults    int `json:"totalResults"`
		Vulnerabilities []struct {
			CVE struct {
				ID           string `json:"id"`
				Published    string `json:"published"`
				LastModified string `json:"lastModified"`
				VulnStatus   string `json:"vulnStatus"`
				Descriptions []struct {
					Lang  string `json:"lang"`
					Value string `json:"value"`
				} `json:"descriptions"`
				Metrics map[string][]struct {
					CVSSData struct {
						BaseScore    float64 `json:"baseScore"`
						BaseSeverity string  `json:"baseSeverity"`
					} `json:"cvssData"`
				} `json:"metrics"`
			} `json:"cve"`
		} `json:"vulnerabilities"`
	}
	if err := json.NewDecoder(r).Decode(&doc); err != nil {
		return nil, 0, err
	}
	records := make([]CVERecord, 0, len(doc.Vulnerabilities))
	for _, v := range doc.Vulnerabilities {
		record := CVERecord{
			CVEID:       v.CVE.ID,
			Description: englishDescription(v.CVE.Descriptions),
			Severity:    SeverityUnknown,
			Rejected:    strings.EqualFold(v.CVE.VulnStatus, "Rejected"),
			Source:      "nvd",
		}
		if t := parseRFC3339(v.CVE.Published); t != nil {
			record.PublishedAt = t
		}
		if t := parseRFC3339(v.CVE.LastModified); t != nil {
			record.ModifiedAt = t
		}
		if score, severity, ok := nvdBestMetric(v.CVE.Metrics); ok {
			record.CVSSScore = &score
			record.Severity = normalizeSeverity(severity)
		}
		if record.CVEID != "" {
			records = append(records, record)
		}
	}
	return records, doc.TotalResults, nil
}

func firstCVE(values []string) string {
	for _, value := range values {
		if strings.HasPrefix(value, "CVE-") {
			return value
		}
	}
	return ""
}

func ubuntuSeverity(items []struct {
	Type  string `json:"type"`
	Score string `json:"score"`
}) Severity {
	for _, item := range items {
		if strings.EqualFold(item.Type, "Ubuntu") {
			return normalizeSeverity(item.Score)
		}
	}
	return SeverityUnknown
}

func parseUbuntuEcosystem(ecosystem, purl string) (versionID, codename string) {
	parts := strings.Split(ecosystem, ":")
	for _, part := range parts {
		if strings.Count(part, ".") == 1 && len(part) >= 4 {
			versionID = part
			break
		}
	}
	if parsed, err := url.Parse(purl); err == nil {
		distro := parsed.Query().Get("distro")
		if _, after, ok := strings.Cut(distro, "/"); ok {
			codename = after
		} else if distro != "" {
			codename = distro
		}
	}
	return versionID, codename
}

func englishDescription(items []struct {
	Lang  string `json:"lang"`
	Value string `json:"value"`
}) string {
	for _, item := range items {
		if item.Lang == "en" {
			return item.Value
		}
	}
	if len(items) > 0 {
		return items[0].Value
	}
	return ""
}

func nvdBestMetric(metrics map[string][]struct {
	CVSSData struct {
		BaseScore    float64 `json:"baseScore"`
		BaseSeverity string  `json:"baseSeverity"`
	} `json:"cvssData"`
}) (float64, string, bool) {
	for _, key := range []string{"cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"} {
		values := metrics[key]
		if len(values) > 0 {
			return values[0].CVSSData.BaseScore, values[0].CVSSData.BaseSeverity, true
		}
	}
	return 0, "", false
}

func parseRFC3339(value string) *time.Time {
	if value == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil
	}
	return &t
}

func cleanFixedVersion(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "0" || strings.HasPrefix(value, "<") {
		return ""
	}
	return value
}

func encodeMetadata(v any) []byte {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

func parseRedHatCVEList(r io.Reader) ([]CVERecord, []AffectedPackage, error) {
	var rows []struct {
		CVE                 string   `json:"CVE"`
		BugzillaDescription string   `json:"bugzilla_description"`
		Severity            string   `json:"severity"`
		PublicDate          string   `json:"public_date"`
		CVSS3Score          string   `json:"cvss3_score"`
		AffectedPackages    []string `json:"affected_packages"`
		AffectedRelease     []struct {
			ProductName string `json:"product_name"`
			Package     string `json:"package"`
			Advisory    string `json:"advisory"`
		} `json:"affected_release"`
	}
	if err := json.NewDecoder(r).Decode(&rows); err != nil {
		return nil, nil, err
	}
	var cves []CVERecord
	var affected []AffectedPackage
	for _, row := range rows {
		if row.CVE == "" {
			continue
		}
		record := CVERecord{
			CVEID:       row.CVE,
			Description: row.BugzillaDescription,
			Severity:    normalizeSeverity(row.Severity),
			Source:      "redhat-security-data",
		}
		if score, err := parseFloat(row.CVSS3Score); err == nil {
			record.CVSSScore = &score
		}
		if t := parseRFC3339(row.PublicDate); t != nil {
			record.PublishedAt = t
		}
		cves = append(cves, record)
		for _, rel := range row.AffectedRelease {
			name, fixed := splitRedHatFixedPackage(rel.Package)
			if name == "" || fixed == "" {
				continue
			}
			affected = append(affected, AffectedPackage{
				CVEID:           row.CVE,
				Source:          "redhat-security-data",
				DistroID:        "rhel",
				DistroVersionID: redHatProductVersion(rel.ProductName),
				PackageName:     name,
				FixedVersion:    fixed,
				Severity:        record.Severity,
				PackageState:    "fixed",
				MetadataJSON: encodeMetadata(map[string]string{
					"advisory":     rel.Advisory,
					"product_name": rel.ProductName,
					"package":      rel.Package,
				}),
			})
		}
		for _, pkg := range row.AffectedPackages {
			name, fixed := splitRedHatAffectedPackage(pkg)
			if name == "" || fixed == "" {
				continue
			}
			affected = append(affected, AffectedPackage{
				CVEID:        row.CVE,
				Source:       "redhat-security-data",
				DistroID:     "rhel",
				PackageName:  name,
				FixedVersion: fixed,
				Severity:     record.Severity,
				PackageState: "probable",
				MetadataJSON: encodeMetadata(map[string]string{
					"source": "affected_packages",
					"raw":    pkg,
				}),
			})
		}
	}
	return cves, affected, nil
}

func parseFloat(value string) (float64, error) {
	var out float64
	_, err := fmt.Sscanf(value, "%f", &out)
	return out, err
}

func splitRedHatAffectedPackage(value string) (name, fixed string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", ""
	}
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return "", ""
	}
	name = fields[0]
	if idx := strings.LastIndex(value, "fixed in "); idx >= 0 {
		fixed = strings.TrimSpace(value[idx+len("fixed in "):])
		if parsedName, parsedFixed := splitRedHatFixedPackage(fixed); parsedName != "" && parsedFixed != "" {
			name = parsedName
			fixed = parsedFixed
		}
	}
	return name, fixed
}

func splitRedHatFixedPackage(value string) (name, fixed string) {
	value = strings.TrimSpace(value)
	value = strings.TrimSuffix(value, ".src.rpm")
	value = strings.TrimSuffix(value, ".rpm")
	value = stripRPMArchitecture(value)
	if value == "" {
		return "", ""
	}

	releaseDash := strings.LastIndex(value, "-")
	if releaseDash <= 0 || releaseDash == len(value)-1 {
		return "", ""
	}
	release := value[releaseDash+1:]
	beforeRelease := value[:releaseDash]

	versionDash := strings.LastIndex(beforeRelease, "-")
	if versionDash <= 0 || versionDash == len(beforeRelease)-1 {
		return "", ""
	}
	name = strings.TrimSpace(beforeRelease[:versionDash])
	version := strings.TrimSpace(beforeRelease[versionDash+1:])
	if name == "" || version == "" || release == "" {
		return "", ""
	}
	return name, version + "-" + release
}

func stripRPMArchitecture(value string) string {
	idx := strings.LastIndex(value, ".")
	if idx <= 0 || idx == len(value)-1 {
		return value
	}
	switch value[idx+1:] {
	case "aarch64", "i386", "i486", "i586", "i686", "noarch", "ppc64le", "s390x", "src", "x86_64":
		return value[:idx]
	default:
		return value
	}
}

func redHatProductVersion(productName string) string {
	fields := strings.Fields(productName)
	for i := len(fields) - 1; i >= 0; i-- {
		field := strings.Trim(fields[i], "(),")
		if field == "" {
			continue
		}
		if isVersionLike(field) {
			return field
		}
	}
	return ""
}

func isVersionLike(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r < '0' || r > '9') && r != '.' {
			return false
		}
	}
	return true
}
