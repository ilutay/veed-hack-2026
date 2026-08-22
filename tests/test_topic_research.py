import argparse
import json
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

from codex.tools import topic_research


REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_BRIEF = REPO_ROOT / "codex/examples/fixture-run/00-topic-research/research-brief.json"
FIXTURE_SCRIPT = REPO_ROOT / "codex/examples/fixture-run/lesson-script.json"
FIXTURE_TAVILY = REPO_ROOT / "codex/examples/fixture-run/00-topic-research/tavily"
BRIEF_SCHEMA = json.loads(
    (REPO_ROOT / "codex/contracts/research-brief.schema.json").read_text(encoding="utf-8")
)
SCRIPT_SCHEMA = json.loads(
    (REPO_ROOT / "codex/contracts/lesson-script.schema.json").read_text(encoding="utf-8")
)


def args_for(
    output_dir: Path,
    *,
    topic: str = "The dot-com bubble",
    mode: str = "dry-run",
    taste_profile: Path | None = None,
    run_id: str = "unit-run",
) -> argparse.Namespace:
    return argparse.Namespace(
        topic=topic,
        output_dir=output_dir,
        run_id=run_id,
        taste_profile=taste_profile,
        audience="general learners",
        mode=mode,
        fixture_dir=FIXTURE_TAVILY,
        timeout_seconds=5,
    )


def load_tavily_fixtures() -> dict:
    return {
        name: json.loads((FIXTURE_TAVILY / f"{name}.json").read_text(encoding="utf-8"))
        for name in ("ground_facts", "strategy", "next_topics", "extract")
    }


def blocked_urlopen(*_args, **_kwargs):
    raise AssertionError("urllib.request.urlopen must not be called")


class FakeTavilyClient:
    def __init__(self, fixtures: dict) -> None:
        self.fixtures = fixtures
        self.calls: list[tuple[str, dict]] = []

    def search(self, payload: dict) -> dict:
        self.calls.append(("search", payload))
        query = payload["query"]
        if payload.get("include_raw_content") == "markdown":
            return self.fixtures["ground_facts"]
        if query.startswith("how to teach"):
            return self.fixtures["strategy"]
        return self.fixtures["next_topics"]

    def extract(self, payload: dict) -> dict:
        self.calls.append(("extract", payload))
        return self.fixtures["extract"]


def numbers_in(text: str) -> set[str]:
    return set(topic_research.re.findall(r"\d+(?:\.\d+)?", text.replace(",", "")))


class TopicResearchTests(unittest.TestCase):
    def test_fixture_brief_matches_schema(self):
        brief = json.loads(FIXTURE_BRIEF.read_text(encoding="utf-8"))
        topic_research.validate_instance(brief, BRIEF_SCHEMA)
        self.assertEqual(brief["research"]["credits"], 0)
        self.assertEqual(brief["research"]["mode"], "dry-run")
        self.assertEqual(brief["research"]["provider"], "fixture")
        self.assertTrue(any("600%" in fact["claim"] for fact in brief["facts"]))

    def test_dry_run_writes_valid_brief_with_zero_credits_and_no_network(self):
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            urllib.request, "urlopen", blocked_urlopen
        ), mock.patch.object(topic_research.urllib.request, "urlopen", blocked_urlopen):
            root = Path(temp_dir)
            brief = topic_research.run_research(args_for(root / "run"))

            topic_research.validate_instance(brief, BRIEF_SCHEMA)
            self.assertEqual(brief["research"]["credits"], 0)
            self.assertEqual(brief["research"]["calls"], 0)
            self.assertEqual(brief["research"]["mode"], "dry-run")
            self.assertEqual(brief["research"]["provider"], "fixture")
            self.assertTrue(any("600%" in fact["claim"] for fact in brief["facts"]))
            self.assertEqual(brief["strategy"]["id"], "contrast-cases")
            self.assertEqual(
                {item["direction"] for item in brief["next_topics"]},
                {"deeper", "wider", "applied"},
            )
            self.assertEqual(brief["taste_hints"]["pace"], 0)
            self.assertEqual(brief["taste_hints"]["depth"], 0)
            self.assertEqual(brief["taste_hints"]["concreteness"], 0)

            written = json.loads(
                (root / "run" / "00-topic-research" / "research-brief.json").read_text()
            )
            self.assertEqual(written["research"]["credits"], 0)
            provider_dir = root / "run" / "00-topic-research" / "provider"
            self.assertTrue((provider_dir / "ground_facts-request.json").exists())
            self.assertTrue((provider_dir / "ground_facts-response.json").exists())
            self.assertTrue((provider_dir / "extract-request.json").exists())
            request = json.loads((provider_dir / "ground_facts-request.json").read_text())
            self.assertEqual(request["payload"]["include_usage"], True)
            self.assertEqual(request["payload"]["search_depth"], "advanced")
            self.assertEqual(request["payload"]["include_raw_content"], "markdown")
            extract_request = json.loads((provider_dir / "extract-request.json").read_text())
            self.assertEqual(extract_request["payload"]["include_usage"], True)
            self.assertLessEqual(len(extract_request["payload"]["urls"]), 5)

    def test_unmatched_topic_placeholder_is_honest_and_offline(self):
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            urllib.request, "urlopen", blocked_urlopen
        ):
            brief = topic_research.run_research(
                args_for(Path(temp_dir) / "run", topic="Photosynthesis")
            )
            topic_research.validate_instance(brief, BRIEF_SCHEMA)
            self.assertEqual(brief["research"]["credits"], 0)
            self.assertEqual(brief["research"]["provider"], "fixture")
            self.assertEqual(brief["research"]["mode"], "dry-run")
            notes = " ".join(brief["style_notes"]).casefold()
            self.assertIn("dry-run", notes)
            self.assertIn("not live-researched", notes)
            self.assertTrue(any("placeholder" in fact["claim"].casefold() for fact in brief["facts"]))

    def test_missing_taste_profile_is_all_zeroes(self):
        hints = topic_research.public_taste_hints(topic_research.load_taste_hints(None))
        self.assertEqual(hints, {"pace": 0, "depth": 0, "concreteness": 0})

    def test_taste_profile_axes_are_forwarded(self):
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            urllib.request, "urlopen", blocked_urlopen
        ):
            profile_path = Path(temp_dir) / "taste-profile.json"
            profile_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "updated_at": "2026-08-22",
                        "axes": {"pace": 0.5, "depth": -0.25, "concreteness": 1},
                        "strategy_weights": {"contrast-cases": 0.4},
                        "history": [],
                    }
                ),
                encoding="utf-8",
            )
            brief = topic_research.run_research(
                args_for(Path(temp_dir) / "run", taste_profile=profile_path)
            )
            self.assertEqual(brief["taste_hints"]["pace"], 0.5)
            self.assertEqual(brief["taste_hints"]["depth"], -0.25)
            self.assertEqual(brief["taste_hints"]["concreteness"], 1)

    def test_live_path_sums_usage_credits_without_real_network(self):
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            urllib.request, "urlopen", blocked_urlopen
        ):
            fake = FakeTavilyClient(load_tavily_fixtures())
            brief = topic_research.run_research(
                args_for(Path(temp_dir) / "run", mode="live"),
                client=fake,
                preflight=False,
            )
            topic_research.validate_instance(brief, BRIEF_SCHEMA)
            self.assertEqual(brief["research"]["provider"], "tavily")
            self.assertEqual(brief["research"]["mode"], "live")
            self.assertEqual(brief["research"]["credits"], 6)
            self.assertEqual(brief["research"]["calls"], 4)
            self.assertEqual(len(fake.calls), 4)
            search_bodies = [payload for kind, payload in fake.calls if kind == "search"]
            extract_bodies = [payload for kind, payload in fake.calls if kind == "extract"]
            self.assertTrue(all(body.get("include_usage") is True for body in search_bodies))
            self.assertEqual(extract_bodies[0]["include_usage"], True)
            self.assertEqual(len(extract_bodies[0]["urls"]), 5)


class ResearchScriptGroundingTests(unittest.TestCase):
    def test_fixture_script_narration_is_traceable_to_brief(self):
        brief = json.loads(FIXTURE_BRIEF.read_text(encoding="utf-8"))
        script = json.loads(FIXTURE_SCRIPT.read_text(encoding="utf-8"))
        topic_research.validate_instance(brief, BRIEF_SCHEMA)
        topic_research.validate_instance(script, SCRIPT_SCHEMA)

        self.assertEqual(script["learning_objective"], brief["concept"])
        self.assertEqual(script["sources"], brief["sources"])
        source_ids = {item["id"] for item in brief["sources"]}
        fact_ids = {item["source_id"] for item in brief["facts"]}
        fact_claims = " ".join(item["claim"] for item in brief["facts"])
        fact_numbers = numbers_in(fact_claims)

        for slide in script["slides"]:
            self.assertTrue(slide.get("source_ids"), f"{slide['id']} has no source_ids")
            for source_id in slide["source_ids"]:
                self.assertIn(source_id, source_ids)
                self.assertIn(source_id, fact_ids)
            for number in numbers_in(slide["narration"]):
                self.assertIn(
                    number,
                    fact_numbers,
                    f"{slide['id']} narrates {number!r} which is not in the brief facts",
                )

        slide_03 = next(slide for slide in script["slides"] if slide["id"] == "slide-03")
        narration = slide_03["narration"].casefold()
        self.assertRegex(narration, r"600|six hundred")
        self.assertNotRegex(narration, r"400|four hundred")
        self.assertTrue(any("600%" in fact["claim"] for fact in brief["facts"]))
        self.assertFalse(any("400%" in fact["claim"] for fact in brief["facts"]))

        labels = [item["label"] for item in script["next_video"]]
        self.assertEqual(labels, ["A", "B", "C"][: len(labels)])
        self.assertEqual(len(script["next_video"]), len(brief["next_topics"]))
        for choice, nxt in zip(script["next_video"], brief["next_topics"]):
            self.assertIn(nxt["topic"].split(",")[0], choice["direction"])


if __name__ == "__main__":
    unittest.main()
