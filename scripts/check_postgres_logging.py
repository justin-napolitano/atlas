#!/usr/bin/env python3
"""Inspect real native PostgreSQL logs in an explicitly isolated CI database."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
import uuid

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/"research-library/testing/logging-probe"
SENTINEL="RESEARCH_LOGGING_PROBE_READY"


def settings():
    policy=json.loads((ROOT/"config/postgres-observability.json").read_text())
    flags=policy["native"]
    required={"log_statement":"ddl","log_min_duration_statement":"-1","log_min_error_statement":"error",
              "log_error_verbosity":"terse","log_parameter_max_length":"0","log_parameter_max_length_on_error":"0"}
    if type(policy["version"]) is not int or policy["version"]!=1 or any(flags.get(key)!=value for key,value in required.items()):
        raise ValueError("Unsafe or unsupported logging policy")
    return flags


def connection():
    dsn=os.environ.get("RESEARCH_TEST_DATABASE_URL","")
    config=conninfo_to_dict(dsn)
    if (os.environ.get("RESEARCH_LOGGING_PROBE_ALLOW_CONFIGURE")!="isolated-ci-only" or
        config.get("host") not in {"localhost","127.0.0.1","postgres"} or
        config.get("dbname")!="research_test" or config.get("user")!="postgres"):
        raise ValueError("This probe is only for the explicit isolated CI database")
    return psycopg.connect(dsn,autocommit=True,connect_timeout=5)


def configure():
    flags=settings()
    with connection() as conn:
        for name,value in flags.items():
            conn.execute(sql.SQL("ALTER SYSTEM SET {} = {}").format(sql.Identifier(name),sql.Literal(value)))
        conn.execute("SELECT pg_reload_conf()")
    for attempt in range(20):
        with connection() as conn:
            actual=dict(conn.execute("SELECT name,setting FROM pg_settings WHERE name=ANY(%s)",(list(flags),)).fetchall())
        good=True
        for name,value in flags.items():
            setting=actual.get(name,"").replace(" ","")
            accepted={value}
            if name=="log_connections":
                accepted.update({"all","receipt,authentication,authorization","receipt,authentication,authorization,setup_durations"})
            if setting not in accepted:
                good=False
        if good:
            print(json.dumps({"configured_native_flags":len(flags),"cloud_sql_audit":"requires_deployed_verification"}))
            return
        time.sleep(.1)
    raise ValueError("Native server settings did not match the policy")


def probe():
    marker="SYNTHETIC_PRIVATE_NOTE_"+uuid.uuid4().hex
    WORK.mkdir(parents=True,exist_ok=True,mode=0o700)
    marker_file=WORK/"marker.txt"
    with marker_file.open("w",encoding="utf-8") as stream:
        os.chmod(marker_file,0o600); stream.write(marker)
    with connection() as conn:
        conn.execute("CREATE TEMP TABLE research_log_privacy_probe(secret text,should_fail boolean CHECK(NOT should_fail))")
        conn.execute("INSERT INTO research_log_privacy_probe VALUES(%s,%s)",(marker,False))
        if conn.execute("SELECT secret FROM research_log_privacy_probe WHERE secret=%s",(marker,)).fetchone()[0]!=marker:
            raise ValueError("Probe write/read failed")
        try:
            conn.execute("INSERT INTO research_log_privacy_probe VALUES(%s,%s)",(marker,True))
        except psycopg.errors.CheckViolation:
            pass
        else:
            raise ValueError("Expected constraint error was not raised")
        conn.execute("SET statement_timeout='25ms'")
        try:
            conn.execute("SELECT %s,pg_sleep(%s)",(marker,.1))
        except psycopg.errors.QueryCanceled:
            pass
        else:
            raise ValueError("Expected bounded-query timeout was not raised")
        conn.execute("SET statement_timeout='0'")
        conn.execute("DO $$ BEGIN RAISE LOG 'RESEARCH_LOGGING_PROBE_READY'; END $$")
    print(json.dumps({"probe":"complete","cases":["bound_write","bound_read","constraint_error","statement_timeout"]}))


def verify(path):
    marker=(WORK/"marker.txt").read_text()
    if path.stat().st_size>50_000_000:
        raise ValueError("Unexpectedly large CI log")
    logs=path.read_text(encoding="utf-8",errors="replace")
    if SENTINEL not in logs:
        raise ValueError("Probe sentinel missing: log capture is incomplete")
    if marker in logs:
        raise ValueError("Private synthetic note appeared in database logs")
    if "violates check constraint" not in logs or "statement timeout" not in logs:
        raise ValueError("Expected error paths are absent from captured logs")
    print(json.dumps({"private_marker_leaked":False,"sentinel_present":True,"error_paths_present":True,"log_bytes":path.stat().st_size}))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=["configure","probe","verify"])
    parser.add_argument("--log-file",type=Path)
    args=parser.parse_args()
    try:
        if args.action=="configure": configure()
        elif args.action=="probe": probe()
        elif args.log_file is not None: verify(args.log_file)
        else: raise ValueError("A captured CI log file is required")
    except (ValueError,OSError,psycopg.Error) as error:
        print(f"Logging verification failed ({type(error).__name__}); inspect policy and isolated CI setup without printing note bodies.",file=sys.stderr)
        return 1
    return 0


if __name__=="__main__":
    raise SystemExit(main())
