// Command federation-http-probe runs synthetic, loopback-only HTTP interoperability
// checks. It does not open a workspace, persist notes, or read app credentials.
package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"reflect"
	"time"

	"github.com/justin-napolitano/atlas/internal/federation"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

type credentials struct {
	user  v1.ID
	token string
}

func (c credentials) Credential(_ context.Context, origin string) (federation.Credential, error) {
	return federation.Credential{Origin: origin, UserID: c.user, BearerToken: c.token}, nil
}

func main() {
	if run() != nil {
		fmt.Fprintln(os.Stderr, "federation HTTP interoperability: failed")
		os.Exit(1)
	}
	fmt.Println("federation HTTP interoperability: 5 checks passed")
}

func run() error {
	failed := errors.New("probe check failed")
	origin := os.Getenv("ATLAS_HTTP_PROBE_URL")
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() {
		return failed
	}
	ids := map[string]v1.ID{}
	for _, name := range []string{"ORGANIZATION_ID", "BRAIN_ID", "DENIED_BRAIN_ID", "USER_ID", "DEVICE_ID", "PAGE_ID"} {
		ids[name] = v1.ID(os.Getenv("ATLAS_HTTP_PROBE_" + name))
		if v1.ValidateID(ids[name]) != nil {
			return failed
		}
	}
	token := os.Getenv("ATLAS_HTTP_PROBE_TOKEN")
	marker := os.Getenv("ATLAS_HTTP_PROBE_CONTENT_MARKER")
	if token == "" || marker == "" || ids["BRAIN_ID"] == ids["DENIED_BRAIN_ID"] {
		return failed
	}
	transport, err := federation.NewHTTPTransport(federation.HTTPTransportConfig{Origin: origin, UserID: ids["USER_ID"], Credentials: credentials{ids["USER_ID"], token}})
	if err != nil {
		return failed
	}
	defer transport.CloseIdleConnections()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	op := v1.Operation{SchemaVersion: v1.SchemaVersion, OrganizationID: ids["ORGANIZATION_ID"], BrainID: ids["BRAIN_ID"], DeviceID: ids["DEVICE_ID"], PageID: ids["PAGE_ID"], OperationID: "90000000-0000-4000-8000-000000000001", Payload: v1.PageContent{Title: "Synthetic interoperability", Body: marker + "\r\nالعربية 日本語 👩🏽‍💻", State: v1.Active}}
	first, err := transport.Apply(ctx, op)
	if err != nil || first.Outcome != v1.Accepted || !first.Matches(op) {
		return failed
	}
	replay, err := transport.Apply(ctx, op)
	if err != nil || !reflect.DeepEqual(first, replay) {
		return failed
	}
	stale := op
	stale.OperationID = "90000000-0000-4000-8000-000000000002"
	stale.Payload.Body += "\nUnmerged local writing"
	conflict, err := transport.Apply(ctx, stale)
	if err != nil || conflict.Outcome != v1.Conflicted || conflict.Conflict == nil || conflict.Conflict.Local != stale.Payload || conflict.Conflict.Server == nil || conflict.Conflict.Server.Content != op.Payload || conflict.Conflict.Server.Revision != first.Revision {
		return failed
	}
	unauthenticated, err := federation.NewHTTPTransport(federation.HTTPTransportConfig{Origin: origin, UserID: ids["USER_ID"], Credentials: credentials{ids["USER_ID"], token + "-invalid"}})
	if err != nil {
		return failed
	}
	defer unauthenticated.CloseIdleConnections()
	if _, err := unauthenticated.Apply(ctx, op); !errors.Is(err, federation.ErrAuthenticationRequired) {
		return failed
	}
	denied := op
	denied.BrainID = ids["DENIED_BRAIN_ID"]
	if _, err := transport.Apply(ctx, denied); !errors.Is(err, federation.ErrAccessDenied) {
		return failed
	}
	return nil
}
