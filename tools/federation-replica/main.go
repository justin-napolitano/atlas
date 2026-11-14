// Command federation-replica is an explicitly selected, separate SQLite client.
// It never discovers an owner workspace or enables a background sync process.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/justin-napolitano/atlas/internal/federation"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

type credentialSource struct {
	user  v1.ID
	token string
}

func (c credentialSource) Credential(_ context.Context, origin string) (federation.Credential, error) {
	return federation.Credential{Origin: origin, UserID: c.user, BearerToken: c.token}, nil
}
func main() {
	if err := run(os.Args[1:], os.Stdin, os.Stdout); err != nil {
		message := "replica operation failed"
		for _, known := range []error{federation.ErrDisabled, federation.ErrRevoked, federation.ErrAuthenticationRequired, federation.ErrAccessDenied, federation.ErrConflict, federation.ErrDraftPending, federation.ErrUncertain} {
			if errors.Is(err, known) {
				message = known.Error()
				break
			}
		}
		fmt.Fprintln(os.Stderr, message)
		os.Exit(1)
	}
}

func run(args []string, input io.Reader, output io.Writer) error {
	if len(args) == 0 {
		return errors.New("command required: init, select, edit, resolve, push, refresh, page, disable, status")
	}
	command := args[0]
	flags := flag.NewFlagSet("federation-replica", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	path := flags.String("db", "", "absolute path to a separate private replica file")
	organization := flags.String("organization", "", "selected organization UUID")
	user := flags.String("user", "", "verified account UUID")
	device := flags.String("device", "", "stable device UUID")
	origin := flags.String("origin", "", "exact selected service origin")
	brain := flags.String("brain", "", "explicit brain UUID")
	page := flags.String("page", "", "explicit page UUID")
	oldID := flags.String("conflict", "", "operation UUID of inspected conflict (resolve only)")
	destination := flags.String("destination", "", "new private snapshot/restore file path")
	if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 {
		return errors.New("invalid command arguments")
	}
	switch command {
	case "init", "select", "edit", "resolve", "push", "refresh", "page", "disable", "status", "preview", "snapshot", "restore":
	default:
		return errors.New("unknown command")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	identity := federation.ReplicaIdentity{OrganizationID: v1.ID(*organization), UserID: v1.ID(*user), DeviceID: v1.ID(*device), Origin: *origin}
	r, err := federation.OpenReplica(ctx, *path, identity, command == "init")
	if err != nil {
		return err
	}
	defer r.Close()
	if command == "init" {
		_, err = fmt.Fprintln(output, "private replica created; synchronization disabled")
		return err
	}
	if command == "preview" {
		preview, err := r.Preview(ctx)
		if err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(preview)
	}
	if command == "snapshot" || command == "restore" {
		if err := r.Snapshot(ctx, *destination); err != nil {
			return err
		}
		_, err = fmt.Fprintln(output, "verified private copy created; synchronization disabled in copy")
		return err
	}
	brainID := v1.ID(*brain)
	if v1.ValidateID(brainID) != nil {
		return federation.ErrAccessDenied
	}
	key := federation.Key{OrganizationID: identity.OrganizationID, BrainID: brainID, UserID: identity.UserID}
	engine := r.Engine(nil)
	var transport *federation.HTTPTransport
	if command == "select" || command == "push" || command == "refresh" {
		transport, err = federation.NewHTTPTransport(federation.HTTPTransportConfig{Origin: identity.Origin, UserID: identity.UserID, Credentials: credentialSource{identity.UserID, os.Getenv("ATLAS_REPLICA_TOKEN")}})
		if err != nil {
			return err
		}
		defer transport.CloseIdleConnections()
		engine = r.Engine(transport)
	}
	switch command {
	case "select":
		_, err = r.Select(ctx, transport, brainID)
	case "disable":
		err = engine.Disable(ctx, key)
	case "status":
		state, e := engine.State(ctx, key)
		if e != nil {
			return e
		}
		return json.NewEncoder(output).Encode(state)
	case "edit", "resolve":
		data, e := io.ReadAll(io.LimitReader(input, v1.MaxRequestBytes+1))
		if e != nil {
			return e
		}
		if len(data) > v1.MaxRequestBytes {
			return errors.New("operation too large")
		}
		op, e := v1.DecodeOperation(data)
		if e != nil {
			return e
		}
		if op.BrainID != brainID {
			return federation.ErrAccessDenied
		}
		if command == "resolve" {
			_, err = r.Resolve(ctx, engine, v1.ID(*oldID), op)
		} else {
			_, err = r.Edit(ctx, engine, op)
		}
	case "push":
		_, err = engine.ProcessOne(ctx, key)
	case "refresh":
		err = r.RefreshPage(ctx, engine, transport, brainID, v1.ID(*page))
	case "page":
		if v1.ValidateID(v1.ID(*page)) != nil {
			return federation.ErrAccessDenied
		}
		result, e := r.Page(ctx, brainID, v1.ID(*page))
		if e != nil {
			return e
		}
		return json.NewEncoder(output).Encode(result)
	}
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(output, "replica operation committed")
	return err
}
