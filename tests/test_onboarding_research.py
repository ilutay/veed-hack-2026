from __future__ import annotations

import argparse
import json
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

from codex.tools import onboarding_research
from codex.tools import topic_research


REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PACK = (
    REPO_ROOT / "codex/examples/fixture-run/00-topic-research/onboarding/pack.json"
)
FIXTURE_TAVILY = REPO_ROOT / "codex/examples/fixture-run/00-topic-research/tavily"
PACK_SCHEMA = json.loads(
    (REPO_ROOT / "codex/contracts/onboarding-pack.schema.json").read_text(encoding="utf-8")
)
PERFECT_ANSWERS = {"q-01": "b", "q-02": "c", "q-03": "b", "q-04": "a", "q-05": "c"}


def args_for(
    output_dir: Path,
    *,
    stage: str = "quiz",
    slug: str = "ada",
    interests: list | None = None,
    goal: str | None = "understand the basics",
    answers_json: str | None = None,
    mode: str = "dry-run",
) -> argparse.Namespace:
    if interests is None:
        interests = ["the dot-com bubble", "compound interest"]
    return argparse.Namespace(
        stage=stage,
        slug=slug,
        output_dir=output_dir,
        interests=interests,
        goal=goal,
        answers_json=answers_json,
        mode=mode,
        fixture_pack=FIXTURE_PACK,
        timeout_seconds=5,
    )


def blocked_urlopen(*_args, **_kwargs):
    raise AssertionError("urllib.request.urlopen must not be called")


def load_tavily_fixtures() -> dict:
    return {
        name: json.loads((FIXTURE_TAVILY / f"{name}.json").read_text(encoding="utf-8"))
        for name in ("ground_facts", "strategy", "next_topics", "extract")
    }


class FakeTavilyClient:
    def __init__(self, fixtures: dict) -> None:
        self.fixtures = fixtures
        self.calls: list[tuple[str, dict]] = []

    def search(self, payload: dict) -> dict:
        self.calls.append(("search", payload))
        query = payload.get("query") or ""
        if "next lesson topics" in query:
            return self.fixtures["next_topics"]
        return self.fixtures["ground_facts"]

    def extract(self, payload: dict) -> dict:
        self.calls.append(("extract", payload))
        return self.fixtures["extract"]


class OnboardingResearchTests(unittest.TestCase):
    def test_fixture_pack_matches_schema(self):
        pack = json.loads(FIXTURE_PACK.read_text(encoding="utf-8"))
        topic_research.validate_instance(pack, PACK_SCHEMA)
        self.assertEqual(pack["research"]["mode"], "dry-run")
        self.assertEqual(pack["research"]["provider"], "fixture")
        self.assertEqual(pack["research"]["credits"], 0)
        self.assertGreaterEqual(len(pack["quiz"]["questions"]), 3)

    def test_dry_run_quiz_writes_valid_pack_without_network(self):
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            urllib.request, "urlopen", blocked_urlopen
        ), mock.patch.object(topic_research.urllib.request, "urlopen", blocked_urlopen):
            root = Path(temp_dir)
            pack = onboarding_research.run_onboarding(args_for(root))

            topic_research.validate_instance(pack, PACK_SCHEMA)
            self.assertEqual(pack["research"]["mode"], "dry-run")
            self.assertEqual(pack["research"]["provider"], "fixture")
            self.assertEqual(pack["research"]["credits"], 0)
            self.assertEqual(pack["research"]["calls"], 0)
            notes = " ".join(pack["style_notes"]).casefold()
            self.assertIn("not live-researched", notes)

            written = json.loads((root / "onboarding-pack.json").read_text(encoding="utf-8"))
            topic_research.validate_instance(written, PACK_SCHEMA)
            self.assertFalse((root / "learner-profile.json").exists())

    def test_dry_run_quiz_substitutes_cli_slug_and_interests(self):
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            urllib.request, "urlopen", blocked_urlopen
        ):
            root = Path(temp_dir)
            interests = ["photosynthesis", "gravity"]
            pack = onboarding_research.run_onboarding(
                args_for(
                    root,
                    slug="ada",
                    interests=interests,
                    goal="understand the basics",
                )
            )
            self.assertEqual(pack["slug"], "ada")
            self.assertEqual(pack["interests"], interests)
            self.assertEqual(pack["goal"], "understand the basics")
            topics = [question["topic"] for question in pack["quiz"]["questions"]]
            self.assertEqual(set(topics), set(interests))
            for index, question in enumerate(pack["quiz"]["questions"]):
                self.assertEqual(question["topic"], interests[index % len(interests)])
                self.assertEqual(question["correct_id"], PERFECT_ANSWERS[question["id"]])

    def test_dry_run_recommend_perfect_score_is_advanced(self):
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            urllib.request, "urlopen", blocked_urlopen
        ):
            root = Path(temp_dir)
            onboarding_research.run_onboarding(args_for(root))
            pack = onboarding_research.run_onboarding(
                args_for(
                    root,
                    stage="recommend",
                    answers_json=json.dumps(PERFECT_ANSWERS),
                )
            )
            topic_research.validate_instance(pack, PACK_SCHEMA)
            correct, total, level = onboarding_research.score_answers(pack, PERFECT_ANSWERS)
            self.assertEqual((correct, total, level), (5, 5, "advanced"))
            self.assertEqual(pack["level"], "advanced")
            self.assertEqual(pack["quiz_score"], {"correct": 5, "total": 5})
            self.assertEqual(len(pack["recommendations"]), 3)
            self.assertTrue(all(item["level"] == "advanced" for item in pack["recommendations"]))
            notes = " ".join(pack["style_notes"]).casefold()
            self.assertIn("dry-run", notes)

    def test_dry_run_recommend_all_wrong_is_beginner(self):
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            urllib.request, "urlopen", blocked_urlopen
        ):
            root = Path(temp_dir)
            quiz = onboarding_research.run_onboarding(args_for(root))
            wrong = {}
            for question in quiz["quiz"]["questions"]:
                wrong[question["id"]] = next(
                    choice["id"]
                    for choice in question["choices"]
                    if choice["id"] != question["correct_id"]
                )
            pack = onboarding_research.run_onboarding(
                args_for(root, stage="recommend", answers_json=json.dumps(wrong))
            )
            correct, total, level = onboarding_research.score_answers(pack, wrong)
            self.assertEqual(correct, 0)
            self.assertEqual(total, 5)
            self.assertEqual(level, "beginner")
            self.assertEqual(pack["level"], "beginner")
            self.assertEqual(len(pack["recommendations"]), 3)
            self.assertTrue(all(item["level"] == "beginner" for item in pack["recommendations"]))

    def test_live_quiz_uses_injected_client_without_network(self):
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            urllib.request, "urlopen", blocked_urlopen
        ), mock.patch.object(topic_research.urllib.request, "urlopen", blocked_urlopen):
            fake = FakeTavilyClient(load_tavily_fixtures())
            pack = onboarding_research.run_onboarding(
                args_for(Path(temp_dir), mode="live"),
                client=fake,
                preflight=False,
            )
            topic_research.validate_instance(pack, PACK_SCHEMA)
            self.assertEqual(pack["research"]["mode"], "live")
            self.assertEqual(pack["research"]["provider"], "tavily")
            self.assertGreaterEqual(len(pack["quiz"]["questions"]), 3)
            kinds = [kind for kind, _ in fake.calls]
            self.assertGreaterEqual(kinds.count("search"), 1)
            self.assertIn("extract", kinds)
            self.assertEqual(kinds[0], "search")
            self.assertEqual(kinds[-1], "extract")
            self.assertTrue(all(kind in {"search", "extract"} for kind in kinds))
            search_bodies = [payload for kind, payload in fake.calls if kind == "search"]
            extract_bodies = [payload for kind, payload in fake.calls if kind == "extract"]
            self.assertTrue(all(body.get("search_depth") == "basic" for body in search_bodies))
            self.assertTrue(all(body.get("include_usage") is True for body in search_bodies))
            self.assertTrue(all(body.get("include_raw_content") == "markdown" for body in search_bodies))
            self.assertEqual(extract_bodies[0]["include_usage"], True)
            self.assertLessEqual(len(extract_bodies[0]["urls"]), 5)

            source_ids = {item["id"] for item in pack.get("sources") or []}
            for question in pack["quiz"]["questions"]:
                self.assertIn(question["correct_id"], {"a", "b", "c", "d"})
                self.assertIn(question["source_id"], source_ids)
                choice_ids = [choice["id"] for choice in question["choices"]]
                self.assertEqual(choice_ids, ["a", "b", "c", "d"])

    def test_status_json_ready_on_success(self):
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            urllib.request, "urlopen", blocked_urlopen
        ):
            root = Path(temp_dir)
            onboarding_research.run_onboarding(args_for(root))
            status = json.loads((root / "onboarding" / "status.json").read_text(encoding="utf-8"))
            self.assertEqual(status["status"], "ready")
            self.assertEqual(status["stage"], "quiz")
            self.assertNotIn("error", status)


if __name__ == "__main__":
    unittest.main()
