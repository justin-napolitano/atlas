package federation

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func TestSQLiteEntryEncodingPreservesLargestEscapedWriting(t *testing.T) {
	op := operation(op1, 0, strings.Repeat("\x01", v1.MaxBodyBytes))
	hash, err := v1.OperationDigest(op)
	if err != nil {
		t.Fatal(err)
	}
	args, err := entryArgs(Entry{Key: testKey, Operation: op, RequestSHA256: hash, Status: Pending})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := v1.DecodeOperation(args[0].([]byte))
	if err != nil {
		t.Fatal("persisted operation cannot be read back", err)
	}
	if decoded != op {
		t.Fatal("SQLite serialization changed writing")
	}
}

func TestSQLiteSchemaConstraintsOnDisposableDatabase(t *testing.T) {
	bin, err := exec.LookPath("sqlite3")
	if err != nil {
		t.Skip("sqlite3 CLI unavailable; database/sql driver integration remains separate")
	}
	db := filepath.Join(t.TempDir(), "synthetic.db")
	run := func(sql string) error {
		cmd := exec.Command(bin, "-bail", db)
		cmd.Stdin = strings.NewReader("PRAGMA foreign_keys=ON;\n" + sql)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return &schemaError{string(out)}
		}
		return nil
	}
	if err = run(SQLiteSchema + SQLiteSchema); err != nil {
		t.Fatal(err)
	}
	if err = run("INSERT INTO federation_brains VALUES('org','brain','user',1,0,1,1,0,'');"); err != nil {
		t.Fatal(err)
	}
	pending := "INSERT INTO federation_outbox(organization_id,brain_id,user_id,operation_id,operation_json,request_sha256,status,attempt,receipt_json,resolution_operation_id,error_code) VALUES('org','brain','user','op',X'7B7D','" + strings.Repeat("a", 64) + "','pending',0,NULL,NULL,'');"
	if err = run(pending); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		"UPDATE federation_outbox SET status='unexpected';",
		"UPDATE federation_outbox SET status='accepted';",
		"UPDATE federation_outbox SET status='resolved',receipt_json=X'7B7D',resolution_operation_id='missing';",
		"UPDATE federation_outbox SET brain_id='another-brain';",
		"UPDATE federation_outbox SET operation_json=X'7B2278223A317D';",
		"UPDATE federation_outbox SET request_sha256='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';",
		"DELETE FROM federation_brains;",
		"UPDATE federation_brains SET cursor=printf('%.*c',8193,'x');",
	} {
		if err = run(sql); err == nil {
			t.Fatalf("schema accepted invalid statement %q", sql)
		}
	}
}

type schemaError struct{ s string }

func (e *schemaError) Error() string { return e.s }
