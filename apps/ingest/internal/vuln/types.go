package vuln

import "time"

type Severity string

const (
	SeverityCritical Severity = "critical"
	SeverityHigh     Severity = "high"
	SeverityMedium   Severity = "medium"
	SeverityLow      Severity = "low"
	SeverityNone     Severity = "none"
	SeverityUnknown  Severity = "unknown"
)

type FindingConfidence string

const (
	FindingConfidenceConfirmed   FindingConfidence = "confirmed"
	FindingConfidenceProbable    FindingConfidence = "probable"
	FindingConfidenceUnsupported FindingConfidence = "unsupported"
)

type CVERecord struct {
	CVEID             string
	Title             string
	Description       string
	Severity          Severity
	CVSSScore         *float64
	PublishedAt       *time.Time
	ModifiedAt        *time.Time
	Rejected          bool
	KnownExploited    bool
	KEVDueDate        *time.Time
	KEVVendorProject  string
	KEVProduct        string
	KEVRequiredAction string
	Source            string
	MetadataJSON      []byte
}

type AffectedPackage struct {
	ID                string
	CVEID             string
	Source            string
	DistroID          string
	DistroVersionID   string
	DistroCodename    string
	PackageName       string
	SourcePackageName string
	FixedVersion      string
	AffectedVersions  []string
	Repository        string
	Severity          Severity
	PackageState      string
	MetadataJSON      []byte
}

type KEVEntry struct {
	CVEID                      string
	VendorProject              string
	Product                    string
	KnownRansomwareCampaignUse bool
	DueDate                    *time.Time
	RequiredAction             string
}

type InventoryPackage struct {
	ID              string
	OrganisationID  string
	HostID          string
	Name            string
	Version         string
	Source          string
	DistroID        string
	DistroIDLike    []string
	DistroVersionID string
	DistroCodename  string
	SourceName      string
	SourceVersion   string
	Repository      string
}

func normalizeSeverity(value string) Severity {
	switch value {
	case "critical", "Critical", "CRITICAL":
		return SeverityCritical
	case "high", "High", "HIGH", "important", "Important", "IMPORTANT":
		return SeverityHigh
	case "medium", "Medium", "MEDIUM", "moderate", "Moderate", "MODERATE":
		return SeverityMedium
	case "low", "Low", "LOW":
		return SeverityLow
	case "none", "None", "NONE", "negligible", "Negligible", "NEGLIGIBLE":
		return SeverityNone
	default:
		return SeverityUnknown
	}
}

func sourceVersionForMatch(pkg InventoryPackage, affected AffectedPackage) string {
	if pkg.SourceName != "" && pkg.SourceName == affected.PackageName && pkg.SourceVersion != "" {
		return pkg.SourceVersion
	}
	return pkg.Version
}
