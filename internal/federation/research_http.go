package federation

import (
	"bytes"
	"io"
	"net/http"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

// ResearchHTTPClient exposes only the two research endpoints for a trusted,
// configured scope. Bearer credentials remain inside HTTPTransport. Research
// records are validated and stored by the separate typed research client.
func (h *HTTPTransport) ResearchHTTPClient(org, brain v1.ID) (*http.Client, error) {
	if v1.ValidateID(org) != nil || v1.ValidateID(brain) != nil {
		return nil, ErrAccessDenied
	}
	return &http.Client{Timeout: h.timeout, Transport: researchTransport{h, brainPath(org, brain) + "/research"}, CheckRedirect: func(*http.Request, []*http.Request) error { return ErrAccessDenied }}, nil
}

type researchTransport struct {
	h    *HTTPTransport
	path string
}

func (t researchTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	u := r.URL
	if u == nil || u.Scheme != t.h.base.Scheme || u.Host != t.h.base.Host || u.User != nil || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" ||
		!(r.Method == http.MethodGet && u.Path == t.path+"/state" || r.Method == http.MethodPost && u.Path == t.path+"/operations") {
		return nil, ErrAccessDenied
	}
	var data []byte
	if r.Body != nil {
		defer r.Body.Close()
		var err error
		// This serialized request bound is dedicated to research, never note/chat APIs.
		data, err = io.ReadAll(io.LimitReader(r.Body, 512*1024+1))
		if err != nil || len(data) > 512*1024 || r.Method == http.MethodGet && len(data) != 0 {
			return nil, ErrRequestRejected
		}
	}
	credential, err := t.h.credentials.Credential(r.Context(), t.h.origin)
	if err != nil || credential.Origin != t.h.origin || credential.UserID != t.h.userID || len(credential.BearerToken) == 0 || len(credential.BearerToken) > 16384 {
		return nil, ErrAuthenticationRequired
	}
	for _, b := range []byte(credential.BearerToken) {
		if b < 0x21 || b > 0x7e {
			return nil, ErrAuthenticationRequired
		}
	}
	request, err := http.NewRequestWithContext(r.Context(), r.Method, u.String(), bytes.NewReader(data))
	if err != nil {
		return nil, ErrRequestRejected
	}
	request.Header.Set("Authorization", "Bearer "+credential.BearerToken)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Cache-Control", "no-store")
	response, err := t.h.client.Do(request)
	if err != nil {
		return nil, ErrUncertain
	}
	defer response.Body.Close()
	result, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	if err != nil {
		return nil, ErrUncertain
	}
	if len(result) > 4*1024*1024 {
		return nil, ErrInvalidReceipt
	}
	response.Body = io.NopCloser(bytes.NewReader(result))
	response.ContentLength = int64(len(result))
	return response, nil
}
