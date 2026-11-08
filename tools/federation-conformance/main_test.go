package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func copyPin(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	paths := []string{"testdata/federation/provenance.json"}
	for path := range allowedFiles {
		paths = append(paths, path)
	}
	for _, path := range paths {
		data, err := os.ReadFile(filepath.Join("../..", path))
		if err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(root, path)
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(target, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestProvenanceChecksAllFixedArtifacts(t *testing.T) {
	root := copyPin(t)
	if _, err := verifyProvenance(root, ""); err != nil {
		t.Fatal(err)
	}
	for path := range allowedFiles {
		t.Run(path, func(t *testing.T) {
			root := copyPin(t)
			file, err := os.OpenFile(filepath.Join(root, path), os.O_APPEND|os.O_WRONLY, 0600)
			if err != nil {
				t.Fatal(err)
			}
			_, _ = file.WriteString("\n// synthetic alteration\n")
			_ = file.Close()
			if _, err = verifyProvenance(root, ""); err == nil {
				t.Fatal("tampered artifact passed provenance")
			}
		})
	}
}

func TestProvenanceRejectsTraversalDuplicatesAndEscapingSymlinks(t *testing.T) {
	for _, kind := range []string{"traversal", "duplicate", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			root := copyPin(t)
			manifestPath := filepath.Join(root, "testdata/federation/provenance.json")
			data, _ := os.ReadFile(manifestPath)
			var m provenance
			if json.Unmarshal(data, &m) != nil {
				t.Fatal("fixture manifest")
			}
			switch kind {
			case "traversal":
				m.Files[0].Path = "../outside"
			case "duplicate":
				m.Files[1] = m.Files[0]
			case "symlink":
				path := filepath.Join(root, m.Files[0].Path)
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				outside := filepath.Join(t.TempDir(), "outside")
				if err := os.WriteFile(outside, []byte("synthetic"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, path); err != nil {
					t.Skip("symlink unavailable")
				}
			}
			if kind != "symlink" {
				data, _ = json.Marshal(m)
				if err := os.WriteFile(manifestPath, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := verifyProvenance(root, ""); err == nil {
				t.Fatal("invalid manifest path passed")
			}
		})
	}
}
