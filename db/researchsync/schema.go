// Package researchsync owns the dedicated Atlas research SQLite schema.
package researchsync

import _ "embed"

// Schema is embedded from the reviewed migration to prevent runtime/schema drift.
//
//go:embed 0001.sql
var Schema string
