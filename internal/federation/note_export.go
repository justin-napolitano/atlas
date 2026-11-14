package federation

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
	"net/http"
	"time"
)

// Export is an explicit local backup. It preserves exact pending writing and
// uses UUID paths; titles and frontmatter cannot become filesystem paths.
func noteArchive(brain v1.ID, pages []WorkingPage) ([]byte, error) {
	if v1.ValidateID(brain) != nil || len(pages) > 1000 {
		return nil, ErrRequestRejected
	}
	var out bytes.Buffer
	writer := tar.NewWriter(&out)
	type entry struct {
		PageID  v1.ID        `json:"page_id"`
		Title   string       `json:"title"`
		State   v1.PageState `json:"state"`
		Version int64        `json:"local_version"`
		SHA256  string       `json:"sha256"`
	}
	manifest := struct {
		Format  string  `json:"format"`
		BrainID v1.ID   `json:"brain_id"`
		Pages   []entry `json:"pages"`
	}{"atlas-local-notes-v1", brain, []entry{}}
	total := 0
	seen := map[v1.ID]bool{}
	for _, page := range pages {
		if v1.ValidateID(page.PageID) != nil || seen[page.PageID] {
			return nil, ErrInvalidReceipt
		}
		seen[page.PageID] = true
		body := []byte(page.Local.Body)
		total += len(body)
		if total > 32*1024*1024 {
			return nil, ErrRequestRejected
		}
		hash := sha256.Sum256(body)
		manifest.Pages = append(manifest.Pages, entry{page.PageID, page.Local.Title, page.Local.State, page.Version, hex.EncodeToString(hash[:])})
		if err := writer.WriteHeader(&tar.Header{Name: string(page.PageID) + ".md", Mode: 0600, Size: int64(len(body)), ModTime: time.Unix(0, 0), Typeflag: tar.TypeReg}); err != nil {
			return nil, err
		}
		if _, err := writer.Write(body); err != nil {
			return nil, err
		}
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		return nil, err
	}
	if err = writer.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0600, Size: int64(len(data)), ModTime: time.Unix(0, 0), Typeflag: tar.TypeReg}); err != nil {
		return nil, err
	}
	if _, err = writer.Write(data); err != nil {
		return nil, err
	}
	if err = writer.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
func (b *Bridge) exportNotes(ctx context.Context, w http.ResponseWriter, a BridgeAccount, brain v1.ID) {
	// Refresh read authority before offering a complete local backup; a failed
	// check never silently falls back to an offline or revoked source.
	if _, err := a.Transport.ReadAuthority(ctx, a.Replica.identity.OrganizationID, brain); err != nil {
		b.result(w, nil, err)
		return
	}
	pages, err := a.Replica.WorkingPages(ctx, brain)
	if err != nil {
		b.result(w, nil, err)
		return
	}
	data, err := noteArchive(brain, pages)
	if err != nil {
		if errors.Is(err, ErrRequestRejected) {
			bridgeError(w, 413, "export_too_large")
		} else {
			b.result(w, nil, err)
		}
		return
	}
	w.Header().Set("Content-Type", "application/x-tar")
	w.Header().Set("Content-Disposition", `attachment; filename="`+string(brain)+`.tar"`)
	w.WriteHeader(200)
	_, _ = w.Write(data)
}
