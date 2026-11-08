package federation

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func TestChatAndGoldUTF8LimitsBeforeTransfer(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(503) }))
	defer server.Close()
	h := transportFor(t, server.URL, 0)
	_, err := h.Chat(context.Background(), org, brain, ChatRequest{OperationID: op1, Message: strings.Repeat("界", 1366)})
	if !errors.Is(err, ErrRequestRejected) || calls != 0 {
		t.Fatal("oversized UTF8 chat transferred or became uncertain", err)
	}
	_, err = h.GoldDecide(context.Background(), org, brain, GoldDecisionRequest{Reason: strings.Repeat("界", 334)})
	if !errors.Is(err, ErrRequestRejected) || calls != 0 {
		t.Fatal("oversized UTF8 review transferred or became uncertain", err)
	}
}
func TestChatTerminalRejectionDistinguishedFromUncertainOutcome(t *testing.T) {
	for status, want := range map[int]error{400: ErrRequestRejected, 409: ErrConversationConflict, 503: ErrUncertain} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(status) }))
			defer server.Close()
			h := transportFor(t, server.URL, 0)
			_, err := h.Chat(context.Background(), org, brain, ChatRequest{OperationID: op1, Message: "Synthetic valid draft"})
			if !errors.Is(err, want) {
				t.Fatal("definitive response confused with uncertain write", err)
			}
		})
	}
}

func TestGoldAudienceLocalRejectionIsDefinitiveBeforeTransfer(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(503) }))
	defer server.Close()
	h := transportFor(t, server.URL, 0)
	request := GoldProposalRequest{GenerationID: op2, Manifest: v1.GoldManifest{SchemaVersion: v1.SchemaVersion, OrganizationID: org, ManifestID: op1, AudienceBrainIDs: []v1.ID{brain}, Revisions: []v1.RevisionRef{{BrainID: brain, PageID: page, RevisionID: revision}}}}
	if request.Manifest.Validate() != nil {
		t.Fatal("synthetic gold manifest invalid")
	}
	for i := 0; i < 101; i++ {
		request.AudienceUserIDs = append(request.AudienceUserIDs, user)
	}
	if _, err := h.GoldPropose(context.Background(), org, brain, request); !errors.Is(err, ErrRequestRejected) || calls != 0 {
		t.Fatal("101 audience became uncertain transfer", err)
	}
	request.AudienceUserIDs = []v1.ID{user}
	if _, err := h.GoldPropose(context.Background(), org, brain, request); !errors.Is(err, ErrUncertain) || calls != 1 {
		t.Fatal("corrected audience could not transfer or server503 lost uncertainty", err)
	}
}
