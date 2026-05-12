import json
import unittest
from unittest import mock

import server


def private_key_block() -> str:
    return "\n".join([
        f"{'-' * 5}BEGIN OPENSSH PRIVATE KEY{'-' * 5}",
        "fixture-key-body",
        f"{'-' * 5}END OPENSSH PRIVATE KEY{'-' * 5}",
    ])


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
                    "privateKey": private_key_block(),
                },
                "hosts": [],
            })

    def test_inventory_text_uses_hostname_as_ansible_alias(self):
        inventory = server.inventory_text([
            {
                "id": "faspa3cinwzc10930aa1rqra",
                "name": "web-01.example.test",
                "address": "10.0.0.10",
                "port": 2222,
            }
        ], "deploy")

        self.assertIn(
            "web-01.example.test ansible_host=10.0.0.10 ansible_user=deploy ansible_port=2222",
            inventory,
        )
        self.assertNotIn("faspa3cinwzc10930aa1rqra ansible_host=", inventory)

    @mock.patch("server.run_ansible_ping_command")
    def test_run_ansible_ping_shapes_per_host_results(self, run_command):
        run_command.return_value = server.CommandResult(
            returncode=1,
            stdout='{"plays":[{"tasks":[{"hosts":{"server-1.example.test":{"ok":1,"failed":0}}}]}]}',
            stderr="",
            elapsedMs=25,
        )

        payload = server.run_ansible_ping({
            "credential": {
                "username": "deploy",
                "privateKey": private_key_block(),
            },
            "hosts": [{"id": "host-1", "name": "server-1.example.test", "address": "10.0.0.10", "port": 22}],
        })

        self.assertEqual(payload["ok"], True)
        self.assertEqual(payload["hosts"][0]["id"], "host-1")
        self.assertEqual(payload["hosts"][0]["name"], "server-1.example.test")
        self.assertEqual(payload["hosts"][0]["status"], "success")
        self.assertEqual(payload["hosts"][0]["exitCode"], 0)
        self.assertEqual(payload["elapsedMs"], 25)

    @mock.patch("server.run_ansible_ping_command")
    def test_run_ansible_ping_returns_host_scoped_output(self, run_command):
        run_command.return_value = server.CommandResult(
            returncode=0,
            stdout=json.dumps({
                "plays": [{
                    "tasks": [{
                        "hosts": {
                            "host-1": {"ping": "pong", "changed": False},
                            "host-2": {"ping": "pong", "changed": False},
                        },
                    }],
                }],
            }),
            stderr="\n".join([
                "[WARNING]: Host 'host-1' is using the discovered Python interpreter at '/usr/bin/python3.12'",
                "[WARNING]: Host 'host-2' is using the discovered Python interpreter at '/usr/bin/python3.12'",
            ]),
            elapsedMs=25,
        )

        payload = server.run_ansible_ping({
            "credential": {
                "username": "deploy",
                "privateKey": private_key_block(),
            },
            "hosts": [
                {"id": "host-1", "name": "host-1", "address": "10.0.0.10", "port": 22},
                {"id": "host-2", "name": "host-2", "address": "10.0.0.11", "port": 22},
            ],
        })

        self.assertIn("host-1", payload["hosts"][0]["stdout"])
        self.assertNotIn("host-2", payload["hosts"][0]["stdout"])
        self.assertIn("Host 'host-1'", payload["hosts"][0]["stderr"])
        self.assertNotIn("Host 'host-2'", payload["hosts"][0]["stderr"])
        self.assertIn("host-2", payload["hosts"][1]["stdout"])
        self.assertNotIn("host-1", payload["hosts"][1]["stdout"])
        self.assertIn("Host 'host-2'", payload["hosts"][1]["stderr"])
        self.assertNotIn("Host 'host-1'", payload["hosts"][1]["stderr"])


if __name__ == "__main__":
    unittest.main()
