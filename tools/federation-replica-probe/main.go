// Synthetic cross-process acceptance harness. All note storage is disposable and
// each client uses the production Go SQLite/HTTP components. The server harness
// supplies local signed test identities and a disposable PostgreSQL instance.
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/justin-napolitano/atlas/internal/federation"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

type source struct {
	user  v1.ID
	token string
}

func (s source) Credential(_ context.Context, origin string) (federation.Credential, error) {
	return federation.Credential{Origin: origin, UserID: s.user, BearerToken: s.token}, nil
}
func main() {
	if run() != nil {
		fmt.Fprintln(os.Stderr, "durable replica interoperability: failed")
		os.Exit(1)
	}
	fmt.Println("durable replica interoperability: passed")
}
func run() error {
	fail := errors.New("synthetic interoperability check failed")
	get := func(name string) string { return os.Getenv("ATLAS_REPLICA_PROBE_" + name) }
	origin := get("URL")
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() {
		return fail
	}
	ids := map[string]v1.ID{}
	for _, name := range []string{"ORGANIZATION_ID", "BRAIN_ID", "ALICE_USER_ID", "BOB_USER_ID", "PAGE_ID"} {
		ids[name] = v1.ID(get(name))
		if v1.ValidateID(ids[name]) != nil {
			return fail
		}
	}
	marker := get("CONTENT_MARKER")
	if marker == "" || get("TOKEN_ALICE") == "" || get("TOKEN_BOB") == "" || ids["ALICE_USER_ID"] == ids["BOB_USER_ID"] {
		return fail
	}
	root, err := os.MkdirTemp("", "atlas-replica-probe-")
	if err != nil {
		return fail
	}
	defer os.RemoveAll(root)
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return fail
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	brain, page := ids["BRAIN_ID"], ids["PAGE_ID"]
	identities := []federation.ReplicaIdentity{
		{OrganizationID: ids["ORGANIZATION_ID"], UserID: ids["ALICE_USER_ID"], DeviceID: "90000000-0000-4000-8000-000000000011", Origin: origin},
		{OrganizationID: ids["ORGANIZATION_ID"], UserID: ids["BOB_USER_ID"], DeviceID: "90000000-0000-4000-8000-000000000012", Origin: origin},
	}
	paths := []string{filepath.Join(root, "alice.sqlite"), filepath.Join(root, "bob.sqlite")}
	clients := make([]*federation.Replica, 2)
	httpClients := make([]*federation.HTTPTransport, 2)
	engines := make([]*federation.Engine, 2)
	for i, id := range identities {
		clients[i], err = federation.OpenReplica(ctx, paths[i], id, true)
		if err != nil {
			return fail
		}
		defer func(i int) { _ = clients[i].Close() }(i)
		token := get("TOKEN_ALICE")
		if i == 1 {
			token = get("TOKEN_BOB")
		}
		httpClients[i], err = federation.NewHTTPTransport(federation.HTTPTransportConfig{Origin: origin, UserID: id.UserID, Credentials: source{id.UserID, token}})
		if err != nil {
			return fail
		}
		defer httpClients[i].CloseIdleConnections()
		engines[i], err = clients[i].Select(ctx, httpClients[i], brain)
		if err != nil {
			return fail
		}
	}
	key := func(i int) federation.Key {
		return federation.Key{OrganizationID: ids["ORGANIZATION_ID"], BrainID: brain, UserID: identities[i].UserID}
	}
	op := func(i int, id string, revision int64, body string) v1.Operation {
		return v1.Operation{SchemaVersion: v1.SchemaVersion, OrganizationID: ids["ORGANIZATION_ID"], BrainID: brain, PageID: page, DeviceID: identities[i].DeviceID, OperationID: v1.ID(id), BaseRevision: revision, Payload: v1.PageContent{Title: "Synthetic shared incident", Body: body, State: v1.Active}}
	}
	restart := func(i int) error {
		if err := clients[i].Close(); err != nil {
			return err
		}
		var err error
		clients[i], err = federation.OpenReplica(ctx, paths[i], identities[i], false)
		if err == nil {
			engines[i] = clients[i].Engine(httpClients[i])
		}
		return err
	}
	send := func(i int) error {
		sent, err := engines[i].ProcessOne(ctx, key(i))
		if !sent && err == nil {
			return fail
		}
		return err
	}
	initial := op(0, "90000000-0000-4000-8000-000000000101", 0, marker+"\r\nالعربية 日本語 👩🏽‍💻 é\t")
	if _, err = clients[0].Edit(ctx, engines[0], initial); err != nil {
		return fail
	}
	if restart(0) != nil || send(0) != nil {
		return fail
	}
	if clients[1].RefreshPage(ctx, engines[1], httpClients[1], brain, page) != nil {
		return fail
	}
	base, err := clients[1].Page(ctx, brain, page)
	if err != nil || base.Local != initial.Payload || base.Remote == nil || base.Remote.Revision != 1 {
		return fail
	}
	bob := op(1, "90000000-0000-4000-8000-000000000102", 1, initial.Payload.Body+"\nBob offline edit")
	if _, err = clients[1].Edit(ctx, engines[1], bob); err != nil || restart(1) != nil {
		return fail
	}
	alice := op(0, "90000000-0000-4000-8000-000000000103", 1, initial.Payload.Body+"\nAlice concurrent edit")
	if _, err = clients[0].Edit(ctx, engines[0], alice); err != nil || send(0) != nil {
		return fail
	}
	if err = send(1); !errors.Is(err, federation.ErrConflict) {
		return fail
	}
	conflicted, err := engines[1].Entry(ctx, key(1), bob.OperationID)
	if err != nil || conflicted.Receipt == nil || conflicted.Receipt.Conflict == nil {
		return fail
	}
	c := conflicted.Receipt.Conflict
	if c.Base == nil || c.Base.Content != initial.Payload || c.Local != bob.Payload || c.Server == nil || c.Server.Content != alice.Payload || c.Server.Revision != 2 {
		return fail
	}
	draft, err := clients[1].Page(ctx, brain, page)
	if err != nil || draft.Local != bob.Payload || draft.Base == nil || draft.Base.Content != initial.Payload {
		return fail
	}
	merged := op(1, "90000000-0000-4000-8000-000000000104", 2, alice.Payload.Body+"\nReviewed merge: Bob offline edit")
	if _, err = clients[1].Resolve(ctx, engines[1], bob.OperationID, merged); err != nil || send(1) != nil {
		return fail
	}
	if clients[0].RefreshPage(ctx, engines[0], httpClients[0], brain, page) != nil {
		return fail
	}
	converged, err := clients[0].Page(ctx, brain, page)
	if err != nil || converged.Local != merged.Payload || converged.Remote == nil || converged.Remote.Revision != 3 {
		return fail
	}
	tombstone := op(0, "90000000-0000-4000-8000-000000000105", 3, merged.Payload.Body)
	tombstone.Payload.State = v1.Deleted
	if _, err = clients[0].Edit(ctx, engines[0], tombstone); err != nil || send(0) != nil {
		return fail
	}
	if clients[1].RefreshPage(ctx, engines[1], httpClients[1], brain, page) != nil || restart(1) != nil {
		return fail
	}
	deleted, err := clients[1].Page(ctx, brain, page)
	if err != nil || deleted.Local != tombstone.Payload || deleted.Remote == nil || deleted.Remote.Revision != 4 {
		return fail
	}
	// Queue a local operation before revocation; the denied pull must suspend it
	// without discarding writing or making any further remote write attempt.
	pending := op(1, "90000000-0000-4000-8000-000000000106", 4, merged.Payload.Body+"\nUnsent before revocation")
	if _, err = clients[1].Edit(ctx, engines[1], pending); err != nil {
		return fail
	}
	fmt.Println("READY_FOR_REVOCATION")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "REVOKED" {
		return fail
	}
	if err = clients[1].RefreshPage(ctx, engines[1], httpClients[1], brain, page); !errors.Is(err, federation.ErrRevoked) {
		return fail
	}
	if sent, err := engines[1].ProcessOne(ctx, key(1)); sent || !errors.Is(err, federation.ErrRevoked) {
		return fail
	}
	retained, err := clients[1].Page(ctx, brain, page)
	if err != nil || retained.Local != pending.Payload {
		return fail
	}
	entry, err := engines[1].Entry(ctx, key(1), pending.OperationID)
	if err != nil || entry.Status != federation.Suspended || entry.Operation != pending {
		return fail
	}
	return nil
}
