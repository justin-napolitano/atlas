"""Keep literal Terraform flags aligned with the natively verified logging policy."""
import json
from pathlib import Path
import re

root=Path(__file__).resolve().parents[2]
policy=json.loads((root/"config/postgres-observability.json").read_text())
expected={**policy["native"],**policy["cloud_sql"]}
source=(root/"infra/gcp/main.tf").read_text()
pairs=re.findall(r'database_flags\s*\{\s*name\s*=\s*"([^"]+)"\s*value\s*=\s*"([^"]+)"\s*\}',source)
actual=dict(pairs)
if len(actual)!=len(pairs) or actual!=expected:
    raise SystemExit("Terraform SQL flags differ from the shared logging policy; update and verify both explicitly")
print(json.dumps({"validated_sql_flags":len(actual),"native_log_probe":"required by PostgreSQL contracts CI"}))
