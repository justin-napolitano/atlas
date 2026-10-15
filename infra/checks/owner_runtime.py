"""Cloud Run owner policy: native IAP, dedicated identity and IAM-only SQL proxy."""
from checkov.common.models.enums import CheckResult, CheckCategories
from checkov.terraform.checks.resource.base_resource_check import BaseResourceCheck
from public_runtime import value


def owner_contract(kind, conf):
    if kind == 'google_iap_web_cloud_run_service_iam_binding':
        members = value(conf, 'members', [])
        return (value(conf, 'role') == 'roles/iap.httpsResourceAccessor' and isinstance(members, list)
                and len(members) == 1 and members[0] in {'user:${var.owner_release.owner_email}', 'user:var.owner_release.owner_email'})
    labels = value(conf, 'labels', {})
    if labels.get('visibility') != 'private-owner': return True
    template = value(conf, 'template', {})
    containers = template.get('containers', [])
    names = {value(container, 'name'): container for container in containers}
    return (value(conf, 'iap_enabled') is True and value(conf, 'invoker_iam_disabled') is False
            and value(conf, 'deletion_protection') is True
            and value(template, 'service_account') in {'${google_service_account.runtime["owner-api"].email}', 'google_service_account.runtime["owner-api"].email'}
            and value(template, 'max_instance_request_concurrency') == 8
            and value(template, 'vpc_access', {}).get('egress') == ['PRIVATE_RANGES_ONLY']
            and set(names) == {'owner', 'sql-proxy'}
            and '--auto-iam-authn' in value(names['sql-proxy'], 'args', [])
            and '--private-ip' in value(names['sql-proxy'], 'args', []))


class PrivateOwnerRuntime(BaseResourceCheck):
    def __init__(self):
        super().__init__(name='Require native IAP, one owner and private IAM SQL for owner runtime',
                         id='CKV_RESEARCH_GCP_2', categories=(CheckCategories.GENERAL_SECURITY,),
                         supported_resources=('google_cloud_run_v2_service', 'google_iap_web_cloud_run_service_iam_binding'))
    def scan_resource_conf(self, conf):
        return CheckResult.PASSED if owner_contract(self.entity_type, conf) else CheckResult.FAILED


check = PrivateOwnerRuntime()
