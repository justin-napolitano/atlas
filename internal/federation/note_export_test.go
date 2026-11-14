package federation

import (
	"archive/tar"
	"bytes"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
	"io"
	"testing"
)

func TestNoteArchivePreservesExactWritingAndSafeIDs(t *testing.T) {
	brain := v1.ID("30000000-0000-0000-0000-000000000001")
	page := v1.ID("40000000-0000-0000-0000-000000000001")
	body := "---\r\ntype: incident\r\n---\r\nΩ العربية 日本語\r\n"
	data, err := noteArchive(brain, []WorkingPage{{ReplicaPage: ReplicaPage{PageID: page, Local: v1.PageContent{Title: "../../untrusted title", Body: body, State: v1.Active}}, Version: 3}})
	if err != nil {
		t.Fatal(err)
	}
	reader := tar.NewReader(bytes.NewReader(data))
	header, err := reader.Next()
	if err != nil || header.Name != string(page)+".md" || header.Mode != 0600 {
		t.Fatal("unsafe archive path or mode")
	}
	got, _ := io.ReadAll(reader)
	if string(got) != body {
		t.Fatal("archive changed exact writing")
	}
	header, err = reader.Next()
	if err != nil || header.Name != "manifest.json" {
		t.Fatal("manifest missing")
	}
	manifest, _ := io.ReadAll(reader)
	if !bytes.Contains(manifest, []byte(`"local_version":3`)) {
		t.Fatal("local version not captured")
	}
}
