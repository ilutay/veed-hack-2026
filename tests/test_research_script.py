import json
import tempfile
import unittest
from pathlib import Path

from codex.tools import research_script

REPO = Path(__file__).resolve().parents[1]
FIXTURE_BRIEF = REPO / "codex/examples/fixture-run/00-topic-research/research-brief.json"
SCRIPT_SCHEMA = json.loads(
    (REPO / "codex/contracts/lesson-script.schema.json").read_text(encoding="utf-8")
)


class ResearchScriptTests(unittest.TestCase):
    def test_fixture_brief_becomes_valid_script(self):
        brief = json.loads(FIXTURE_BRIEF.read_text(encoding="utf-8"))
        script = research_script.build_script(brief)
        from codex.tools import topic_research

        topic_research.validate_instance(script, SCRIPT_SCHEMA)
        self.assertEqual(script["learning_objective"], brief["concept"])
        self.assertEqual(script["duration_seconds"], 15)
        self.assertEqual(sum(s["duration_seconds"] for s in script["slides"]), 15)
        self.assertGreaterEqual(len(script["slides"]), 5)
        self.assertLessEqual(len(script["slides"]), 6)
        narration = " ".join(s["narration"] for s in script["slides"])
        self.assertRegex(narration, r"600|six hundred")
        self.assertNotRegex(narration.casefold(), r"400%|four hundred")
        self.assertEqual(script["sources"], brief["sources"])
        self.assertEqual(len(script["next_video"]), 3)
        self.assertEqual([c["label"] for c in script["next_video"]], ["A", "B", "C"])

    def test_chrome_facts_are_dropped(self):
        brief = json.loads(FIXTURE_BRIEF.read_text(encoding="utf-8"))
        brief["facts"] = [
            {
                "id": "fact-00",
                "claim": "Skip to main content Wikipedia, the free encyclopedia",
                "source_id": "src-wikipedia-dotcom",
                "confidence": "low",
            },
            *brief["facts"],
        ]
        script = research_script.build_script(brief)
        joined = " ".join(s["narration"] for s in script["slides"]).casefold()
        self.assertNotIn("skip to main content", joined)

    def test_cli_writes_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "lesson-script.json"
            rc = research_script.main(["--brief", str(FIXTURE_BRIEF), "--output", str(out)])
            self.assertEqual(rc, 0)
            self.assertTrue(out.is_file())


if __name__ == "__main__":
    unittest.main()
