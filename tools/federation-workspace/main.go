// federation-workspace launches a separate opt-in loopback UI. Login is not
// implemented: verified MU credentials must be injected by the trusted launcher.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/justin-napolitano/atlas/internal/federation"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

type accountConfig struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	DBPath          string `json:"db_path"`
	OrganizationID  v1.ID  `json:"organization_id"`
	UserID          v1.ID  `json:"user_id"`
	DeviceID        v1.ID  `json:"device_id"`
	Origin          string `json:"origin"`
	TokenEnv        string `json:"token_env"`
	Create          bool   `json:"create"`
	UpgradeSnapshot string `json:"upgrade_snapshot"`
	ChatEnabled     bool   `json:"chat_enabled"`
	GoldEnabled     bool   `json:"gold_enabled"`
	SourcesEnabled  bool   `json:"sources_enabled"`
	ResearchEnabled bool   `json:"research_enabled"`
}
type configuration struct {
	Listen              string          `json:"listen"`
	AssetsDir           string          `json:"assets_dir"`
	LaunchFile          string          `json:"launch_file"`
	Accounts            []accountConfig `json:"accounts"`
	PrivateWorkspaceURL string          `json:"private_workspace_url"`
}
type credentials struct {
	user  v1.ID
	token string
}

func (c credentials) Credential(_ context.Context, origin string) (federation.Credential, error) {
	return federation.Credential{Origin: origin, UserID: c.user, BearerToken: c.token}, nil
}
func main() {
	if run() != nil {
		fmt.Fprintln(os.Stderr, "collaboration workspace could not start; check private configuration")
		os.Exit(1)
	}
}
func run() error {
	configPath := flag.String("config", "", "explicit private configuration file")
	flag.Parse()
	info, err := os.Lstat(*configPath)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return errors.New("private configuration required")
	}
	file, err := os.Open(*configPath)
	if err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(file, 65537))
	file.Close()
	if err != nil || len(data) > 65536 {
		return errors.New("invalid configuration")
	}
	var config configuration
	if v1.DecodeStrict(data, &config) != nil || len(config.Accounts) == 0 || len(config.Accounts) > 20 || !filepath.IsAbs(config.AssetsDir) || !filepath.IsAbs(config.LaunchFile) {
		return errors.New("invalid configuration")
	}
	if config.Listen == "" {
		config.Listen = "127.0.0.1:0"
	}
	host, _, err := net.SplitHostPort(config.Listen)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return errors.New("literal loopback bind required")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	var accounts []federation.BridgeAccount
	for _, a := range config.Accounts {
		for _, privatePath := range []string{a.DBPath, config.LaunchFile, *configPath} {
			relative, err := filepath.Rel(config.AssetsDir, privatePath)
			if err != nil || relative == "." || !strings.HasPrefix(relative, ".."+string(os.PathSeparator)) && relative != ".." {
				return errors.New("runtime files must be outside browser assets")
			}
		}
		if !strings.HasPrefix(a.TokenEnv, "ATLAS_CREDENTIAL_") {
			return errors.New("explicit scoped credential environment required")
		}
		r, err := federation.OpenReplica(ctx, a.DBPath, federation.ReplicaIdentity{OrganizationID: a.OrganizationID, UserID: a.UserID, DeviceID: a.DeviceID, Origin: a.Origin}, a.Create)
		if err != nil {
			return err
		}
		defer r.Close()
		if a.UpgradeSnapshot != "" {
			if err = r.UpgradeWorkspace(ctx, a.UpgradeSnapshot); err != nil {
				return err
			}
		}
		h, err := federation.NewHTTPTransport(federation.HTTPTransportConfig{Origin: a.Origin, UserID: a.UserID, Credentials: credentials{a.UserID, os.Getenv(a.TokenEnv)}, RequireGeneration: true})
		if err != nil {
			return err
		}
		defer h.CloseIdleConnections()
		accounts = append(accounts, federation.BridgeAccount{ID: a.ID, Name: a.Name, Replica: r, Transport: h, ChatEnabled: a.ChatEnabled, GoldEnabled: a.GoldEnabled, SourcesEnabled: a.SourcesEnabled, ResearchEnabled: a.ResearchEnabled})
	}
	listener, err := net.Listen("tcp", config.Listen)
	if err != nil {
		return err
	}
	defer listener.Close()
	origin := "http://" + listener.Addr().String()
	research := newResearchBridge(config.Accounts)
	defer research.close()
	bridge, code, err := federation.NewBridge(federation.BridgeConfig{Origin: origin, Accounts: accounts, Assets: os.DirFS(config.AssetsDir), PrivateWorkspaceURL: config.PrivateWorkspaceURL, ResearchHandler: research.serve})
	if err != nil {
		return err
	}
	launch, err := os.OpenFile(config.LaunchFile, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	err = json.NewEncoder(launch).Encode(map[string]string{"url": origin + "/workspace.html?collaboration=1", "code": code})
	if err == nil {
		err = launch.Sync()
	}
	closeErr := launch.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	fmt.Println("Collaboration workspace ready. Read the private launch file for its URL and one-time setup code.")
	server := &http.Server{Handler: bridge, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 150 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	go func() {
		<-ctx.Done()
		shutdown, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = server.Shutdown(shutdown)
	}()
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
