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
        self.assertTrue(capabilities["capabilities"]["jobExecution"])
        self.assertTrue(capabilities["capabilities"]["ansiblePing"])
        self.assertFalse(capabilities["capabilities"]["playbookExecution"])

    def test_openapi_payload_is_json_serialisable(self):
        payload = server.openapi_payload()
        self.assertEqual(payload["openapi"], "3.1.0")
        self.assertIn("/api/v1/runs/ansible-ping", payload["paths"])
        json.dumps(payload)

    def test_validate_ansible_ping_request_rejects_missing_hosts(self):
        with self.assertRaisesRegex(ValueError, "hosts"):
            server.validate_ansible_ping_request({
                "credential": {
                    "username": "deploy",
                    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
                },
                "hosts": [],
            })

    @mock.patch("server.run_ansible_ping_command")
    def test_run_ansible_ping_shapes_per_host_results(self, run_command):
        run_command.return_value = server.CommandResult(
            returncode=0,
            stdout='{"plays":[{"tasks":[{"hosts":{"host-1":{"ok":1,"failed":0}}}]}]}',
            stderr="",
            elapsedMs=25,
        )

        payload = server.run_ansible_ping({
            "credential": {
                "username": "deploy",
                "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
            },
            "hosts": [{"id": "host-1", "name": "host-1", "address": "10.0.0.10", "port": 22}],
        })

        self.assertEqual(payload["ok"], True)
        self.assertEqual(payload["hosts"][0]["id"], "host-1")
        self.assertEqual(payload["hosts"][0]["status"], "success")
        self.assertEqual(payload["hosts"][0]["exitCode"], 0)
        self.assertEqual(payload["elapsedMs"], 25)


if __name__ == "__main__":
    unittest.main()
