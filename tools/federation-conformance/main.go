// federation-conformance validates Atlas against a coordinator-pinned MU fixture.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "federation conformance:", err)
		os.Exit(1)
	}
}

func run() error {
	root := flag.String("root", ".", "Atlas repository root")
	fixture := flag.String("fixtures", "testdata/federation/cases.json", "canonical synthetic fixture path")
	expected := flag.String("sha256", "", "optional additional reviewed fixture SHA-256")
	flag.Parse()
	if filepath.ToSlash(filepath.Clean(*fixture)) != "testdata/federation/cases.json" {
		return errors.New("only the fixed canonical fixture path is permitted")
	}
	data, err := verifyProvenance(*root, *expected)
	if err != nil {
		return err
	}
	report, err := v1.CheckConformance(data)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(report)
}

type provenance struct {
	ContractVersion string `json:"contract_version"`
	Repository      string `json:"upstream_repository"`
	Commit          string `json:"upstream_commit"`
	Files           []struct {
		Upstream string `json:"upstream_path"`
		Path     string `json:"path"`
		SHA256   string `json:"sha256"`
	} `json:"files"`
}

var allowedFiles = map[string]string{
	"internal/federation/contracts/v1/types.go":       "contracts/v1/types.go",
	"internal/federation/contracts/v1/validate.go":    "contracts/v1/validate.go",
	"internal/federation/contracts/v1/conformance.go": "contracts/v1/conformance.go",
	"testdata/federation/cases.json":                  "contracts/v1/testdata/cases.json",
}

func lowerHex(value string, bytes int) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == bytes && hex.EncodeToString(decoded) == value
}

// The manifest is a reviewed pin, not a signature or a network trust decision.
// Both manifest names and opened paths are fixed; os.Root also rejects escaping symlinks.
func verifyProvenance(directory, extraFixtureHash string) ([]byte, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, errors.New("repository root is unavailable")
	}
	defer root.Close()
	read := func(path string, limit int64) ([]byte, error) {
		file, err := root.Open(path)
		if err != nil {
			return nil, errors.New("a pinned artifact is unavailable")
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, limit+1))
		if err != nil || int64(len(data)) > limit {
			return nil, errors.New("a pinned artifact is unreadable or too large")
		}
		return data, nil
	}
	data, err := read("testdata/federation/provenance.json", 65536)
	if err != nil {
		return nil, err
	}
	var manifest provenance
	if v1.DecodeStrict(data, &manifest) != nil || manifest.ContractVersion != v1.SchemaVersion || manifest.Repository != "https://github.com/digital-group-vaults/MU-TH-UR" || !lowerHex(manifest.Commit, 20) || len(manifest.Files) != len(allowedFiles) {
		return nil, errors.New("invalid contract provenance manifest")
	}
	seen := map[string]bool{}
	var fixture []byte
	for _, file := range manifest.Files {
		upstream, allowed := allowedFiles[file.Path]
		if !allowed || upstream != file.Upstream || seen[file.Path] || !lowerHex(file.SHA256, sha256.Size) {
			return nil, errors.New("provenance contains an unknown, duplicate or invalid fixed path")
		}
		seen[file.Path] = true
		content, err := read(file.Path, int64(v1.MaxRequestBytes))
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(content)
		if hex.EncodeToString(digest[:]) != file.SHA256 {
			return nil, errors.New("a canonical source or fixture differs from its provenance checksum")
		}
		if file.Path == "testdata/federation/cases.json" {
			if extraFixtureHash != "" && (!lowerHex(extraFixtureHash, sha256.Size) || extraFixtureHash != file.SHA256) {
				return nil, errors.New("fixture differs from the additional reviewed SHA-256")
			}
			fixture = content
		}
	}
	if fixture == nil {
		return nil, errors.New("canonical fixture is missing from provenance")
	}
	return fixture, nil
}
