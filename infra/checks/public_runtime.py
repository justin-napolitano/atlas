"""Additional v2 coverage: Checkov 3.3.29's CKV_GCP_102 covers v1 IAM only.

The product explicitly permits anonymous approved public files. This check scopes
that access and forbids credential injection/IAM bypass; it is not a review waiver
or proof of live effective IAM. Terraform contracts separately bind the reader SA.
"""
import re
from checkov.common.models.enums import CheckResult, CheckCategories
from checkov.terraform.checks.resource.base_resource_check import BaseResourceCheck


def value(conf, key, default=None):
    item = conf.get(key, default)
    if isinstance(item, list): return item[0] if len(item) == 1 else default
    return item


def public_contract(kind, conf):
    if kind == "google_cloud_run_v2_service_iam_member":
        member = value(conf, "member")
        if member == "allAuthenticatedUsers": return False
        if member != "allUsers": return True
        name = value(conf, "name", "")
        public_name = name == '${google_cloud_run_v2_service.public[0].name}' or bool(re.fullmatch(r"[a-z][a-z0-9-]{2,15}-public", name))
        return public_name and value(conf, "role") == "roles/run.invoker"
    if value(conf, "invoker_iam_disabled") is not False: return False
    labels = value(conf, "labels", {})
    if labels.get("visibility") != "approved-public": return True
    template = value(conf, "template", {})
    containers = template.get("containers", [])
    if len(containers) != 1: return False
    container = containers[0]
    return (value(conf, "deletion_protection") is True and bool(value(template, "service_account"))
        and not template.get("vpc_access") and not template.get("volumes")
        and not container.get("env") and not container.get("volume_mounts")
        and value(template, "execution_environment") == "EXECUTION_ENVIRONMENT_GEN2"
        and value(template, "max_instance_request_concurrency") == 16
        and value(template, "timeout") == "30s")


class ApprovedPublicRuntime(BaseResourceCheck):
    def __init__(self):
        super().__init__(name="Scope anonymous v2 access and isolate approved-public runtime from authoring credentials",
            id="CKV_RESEARCH_GCP_1", categories=(CheckCategories.GENERAL_SECURITY,),
            supported_resources=("google_cloud_run_v2_service", "google_cloud_run_v2_service_iam_member"))

    def scan_resource_conf(self, conf):
        return CheckResult.PASSED if public_contract(self.entity_type, conf) else CheckResult.FAILED


check = ApprovedPublicRuntime()
