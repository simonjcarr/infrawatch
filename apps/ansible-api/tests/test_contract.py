import json
import unittest
from unittest import mock

import server


class AnsibleApiContractTests(unittest.TestCase):
    @mock.patch("server.ansible_version", return_value="2.19.0")
    def test_health_payload_reports_ansible_provider(self, _version):
        self.assertEqual(server.health_payload(), {
            "ok": True,
            "provider": "ansible",
            "ansibleVersion": "2.19.0",
        })

    def test_capabilities_mark_job_execution_unimplemented(self):
        capabilities = server.capabilities_payload()
        self.assertEqual(capabilities["provider"], "ansible")
        self.assertTrue(capabilities["capabilities"]["health"])
        self.assertFalse(capabilities["capabilities"]["jobExecution"])
        self.assertFalse(capabilities["capabilities"]["playbookExecution"])

    def test_openapi_payload_is_json_serialisable(self):
        payload = server.openapi_payload()
        self.assertEqual(payload["openapi"], "3.1.0")
        json.dumps(payload)


if __name__ == "__main__":
    unittest.main()
