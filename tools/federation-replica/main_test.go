package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/justin-napolitano/atlas/internal/federation"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func TestCLIExplicitCreateDisabledPreviewSnapshot(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "replica.sqlite")
	identity := federation.ReplicaIdentity{OrganizationID: "10000000-0000-0000-0000-000000000001", UserID: "10000000-0000-0000-0000-000000000002", DeviceID: "10000000-0000-0000-0000-000000000003", Origin: "https://synthetic.invalid"}
	args := []string{"-db", path, "-organization", string(identity.OrganizationID), "-user", string(identity.UserID), "-device", string(identity.DeviceID), "-origin", identity.Origin}
	var output bytes.Buffer
	if err = run(append([]string{"init"}, args...), strings.NewReader(""), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "disabled") {
		t.Fatal("new replica was not disabled")
	}
	if err = run(append([]string{"init"}, args...), strings.NewReader(""), &output); err == nil {
		t.Fatal("init replaced file")
	}
	output.Reset()
	if err = run(append([]string{"preview"}, args...), strings.NewReader(""), &output); err != nil {
		t.Fatal(err)
	}
	var preview federation.ReplicaPreview
	if json.Unmarshal(output.Bytes(), &preview) != nil || preview.Identity != identity || preview.Operations != 0 {
		t.Fatal("preview mismatch")
	}
	backup := filepath.Join(dir, "snapshot.sqlite")
	if err = run(append(append([]string{"snapshot"}, args...), "-destination", backup), strings.NewReader(""), &output); err != nil {
		t.Fatal(err)
	}
	r, err := federation.OpenReplica(context.Background(), backup, identity, false)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	state, err := r.Engine(nil).State(context.Background(), federation.Key{OrganizationID: identity.OrganizationID, UserID: identity.UserID, BrainID: v1.ID("10000000-0000-0000-0000-000000000004")})
	if err != nil || state.Enabled {
		t.Fatal("snapshot enabled sync", err)
	}
}
