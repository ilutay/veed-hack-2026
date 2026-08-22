import argparse
import json
import re
import tempfile
import threading
import unittest
from pathlib import Path

from codex.tools import fal_media_agent


def lesson_fixture() -> dict:
    return {
        "topic": "How transformer attention works",
        "learning_objective": "Understand how attention selects useful context.",
        "audience": "curious software engineers",
        "duration_seconds": 125,
        "style_notes": ["quiet editorial diagrams", "blue, green, and coral accents"],
        "intro": {
            "hook": "Attention is the routing layer of a transformer.",
            "talking_head_script": "Let's make attention concrete.",
            "duration_seconds": 10,
        },
        "slides": [
            {
                "id": f"slide-{index:02d}",
                "title": f"Slide {index}",
                "key_points": [f"Point {index}"],
                "narration": f"Narration for slide {index}.",
                "visual_brief": f"Visual brief for slide {index}.",
                "duration_seconds": 20 + index,
            }
            for index in range(1, 6)
        ],
        "sources": [],
    }


def args_for(script: Path, output_dir: Path, mode: str = "dry-run") -> argparse.Namespace:
    return argparse.Namespace(
        script=script,
        output_dir=output_dir,
        run_id="unit-run",
        mode=mode,
        voice="Friendly_Person",
        emotion="happy",
        language="en",
        speed=1.2,
        image_size="landscape_16_9",
        image_steps=8,
        avatar_image_size="landscape_16_9",
        video_resolution="720p",
        max_workers=7,
        poll_interval_seconds=0,
        timeout_seconds=5,
        intro_seconds=5,
    )


class FakeFalClient:
    def __init__(self) -> None:
        self.submissions = []
        self.downloads = []
        self.lock = threading.Lock()

    def submit(self, endpoint_id, payload):
        if endpoint_id == fal_media_agent.TALKING_HEAD_VIDEO_ENDPOINT:
            request_id = "req-talking-head-video"
        elif endpoint_id == fal_media_agent.IMAGE_ENDPOINT:
            slide_match = re.search(r"Slide id: (slide-\d+)", payload["prompt"])
            request_id = f"req-{slide_match.group(1)}" if slide_match else "req-avatar"
        elif "[pause]" in payload.get("prompt", ""):
            # Only the combined multi-slide narration joins segments with
            # "[pause]"; the intro clip is a single short line of text.
            request_id = "req-voiceover"
        else:
            request_id = "req-intro-audio"
        with self.lock:
            self.submissions.append((endpoint_id, payload, request_id))
        return {
            "request_id": request_id,
            "status_url": f"https://queue.fal.run/{endpoint_id}/requests/{request_id}/status",
            "response_url": f"https://queue.fal.run/{endpoint_id}/requests/{request_id}/response",
        }

    def status(self, status_url):
        return {"status": "COMPLETED", "status_url": status_url}

    def result(self, response_url):
        request_id = response_url.split("/requests/")[1].split("/")[0]
        with self.lock:
            endpoint_id = next(
                endpoint
                for endpoint, _payload, submitted_id in self.submissions
                if submitted_id == request_id
            )
        if endpoint_id == fal_media_agent.TALKING_HEAD_VIDEO_ENDPOINT:
            return {
                "video": {
                    "url": f"https://fal.media/files/{request_id}.mp4?token=secret",
                    "content_type": "video/mp4",
                }
            }
        if endpoint_id == fal_media_agent.IMAGE_ENDPOINT:
            return {
                "images": [
                    {
                        "url": f"https://fal.media/files/{request_id}.png?token=secret",
                        "content_type": "image/png",
                    }
                ],
                "prompt": "used prompt",
            }
        return {
            "audio": {
                "url": f"https://fal.media/files/{request_id}.mp3?token=secret",
                "content_type": "audio/mpeg",
            }
        }

    def download(self, url, output_path):
        self.downloads.append((url, output_path))
        output_path.write_bytes(b"media")


class FalMediaAgentTests(unittest.TestCase):
    def test_dry_run_writes_payloads_manifest_and_estimated_timings(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            script_path = root / "lesson-script.input.json"
            script_path.write_text(json.dumps(lesson_fixture()), encoding="utf-8")

            manifest = fal_media_agent.run_agent(
                args_for(script_path, root / "run"),
                preflight=False,
            )

            content_dir = root / "run" / "02-content-generation"
            prompts = json.loads((content_dir / "slide-image-prompts.json").read_text())
            voice_payload = json.loads((content_dir / "voiceover-payload.json").read_text())
            intro_payload = json.loads((content_dir / "talking-head-intro-audio-payload.json").read_text())
            avatar_payload = json.loads((content_dir / "talking-head-avatar-payload.json").read_text())
            video_payload = json.loads((content_dir / "talking-head-video-payload.json").read_text())
            timings = json.loads((content_dir / "narration-timings.json").read_text())

            self.assertEqual(len(prompts), 5)
            self.assertEqual(prompts[0]["endpoint"], fal_media_agent.IMAGE_ENDPOINT)
            self.assertEqual(prompts[0]["payload"]["image_size"], "landscape_16_9")
            self.assertEqual(voice_payload["endpoint"], fal_media_agent.VOICE_ENDPOINT)
            self.assertIn("[pause]", voice_payload["payload"]["prompt"])
            self.assertEqual(
                voice_payload["payload"]["voice_setting"],
                {"voice_id": "Friendly_Person", "emotion": "happy", "speed": 1.2},
            )
            self.assertEqual(voice_payload["payload"]["language_boost"], "English")
            self.assertEqual(voice_payload["payload"]["output_format"], "url")
            self.assertEqual(intro_payload["endpoint"], fal_media_agent.VOICE_ENDPOINT)
            self.assertEqual(intro_payload["payload"]["prompt"], "Let's make attention concrete.")
            self.assertEqual(
                intro_payload["payload"]["voice_setting"],
                {"voice_id": "Friendly_Person", "emotion": "happy", "speed": 1.2},
            )
            self.assertEqual(intro_payload["target_duration_seconds"], 5)
            self.assertEqual(avatar_payload["endpoint"], fal_media_agent.AVATAR_IMAGE_ENDPOINT)
            self.assertEqual(avatar_payload["payload"]["image_size"], "landscape_16_9")
            self.assertEqual(video_payload["endpoint"], fal_media_agent.TALKING_HEAD_VIDEO_ENDPOINT)
            self.assertIsNone(video_payload["payload"]["image_url"])
            self.assertIsNone(video_payload["payload"]["audio_url"])
            self.assertEqual(video_payload["payload"]["resolution"], "720p")
            self.assertEqual(len(timings["segments"]), 5)
            self.assertTrue(timings["estimated"])
            self.assertEqual(manifest["assets"]["voiceover"]["media_type"], "audio/mpeg")
            self.assertEqual(manifest["assets"]["talking_head_intro_audio"]["media_type"], "audio/mpeg")
            self.assertEqual(
                manifest["assets"]["talking_head_intro_audio"]["provider_job_id"], "dry-run-intro-audio"
            )
            self.assertEqual(manifest["assets"]["talking_head_intro"]["provider"], "pending")
            self.assertEqual(manifest["assets"]["talking_head_avatar"]["provider_job_id"], "dry-run-avatar")
            self.assertEqual(manifest["assets"]["slide_images"][0]["provider_job_id"], "dry-run-slide-01")

    def test_markdown_full_script_is_normalized_to_lesson_script(self):
        markdown = """# Attention Lesson

Slide 1: Tokens become queries
Narration: Every token asks a question about the context around it.
Visual brief: Show tokens sending query arrows into a shared context table.
Key points:
- tokens
- queries
Duration: 12 seconds

Slide 2: Keys advertise matches
Narration: Keys describe what each token can offer to other tokens.
Visual: Matching badges beside each token.

Slide 3: Scores rank context
Narration: Attention scores rank which context should matter most.
Visual brief: A sorted bar chart connected to tokens.

Slide 4: Weights blend values
Narration: The model blends value vectors according to the attention weights.
Visual brief: Colored streams merging into a single representation.

Slide 5: Layers repeat the routing
Narration: Each layer repeats this process to build richer meaning.
Visual brief: Stacked transparent routing layers.
"""
        lesson = fal_media_agent.parse_markdown_script(markdown)

        self.assertEqual(lesson["topic"], "Attention Lesson")
        self.assertEqual(len(lesson["slides"]), 5)
        self.assertEqual(lesson["slides"][0]["id"], "slide-01")
        self.assertEqual(lesson["slides"][0]["duration_seconds"], 12)
        self.assertEqual(lesson["slides"][0]["key_points"], ["tokens", "queries"])
        self.assertIn("Matching badges", lesson["slides"][1]["visual_brief"])

    def test_test_mode_submits_all_images_one_voiceover_and_one_intro_audio(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            script_path = root / "lesson-script.input.json"
            script_path.write_text(json.dumps(lesson_fixture()), encoding="utf-8")
            fake_client = FakeFalClient()

            manifest = fal_media_agent.run_agent(
                args_for(script_path, root / "run", mode="test"),
                client=fake_client,
                preflight=False,
            )

            image_submissions = [
                item for item in fake_client.submissions if item[0] == fal_media_agent.IMAGE_ENDPOINT
            ]
            slide_submissions = [item for item in image_submissions if item[2] != "req-avatar"]
            avatar_submissions = [item for item in image_submissions if item[2] == "req-avatar"]
            voice_submissions = [
                item for item in fake_client.submissions if item[2] == "req-voiceover"
            ]
            intro_submissions = [
                item for item in fake_client.submissions if item[2] == "req-intro-audio"
            ]
            video_submissions = [
                item for item in fake_client.submissions
                if item[0] == fal_media_agent.TALKING_HEAD_VIDEO_ENDPOINT
            ]
            provider_response = json.loads(
                (root / "run" / "02-content-generation" / "provider" / "slide-01-response.json").read_text()
            )

            self.assertEqual(len(slide_submissions), 5)
            self.assertEqual(len(avatar_submissions), 1)
            self.assertEqual(len(voice_submissions), 1)
            self.assertEqual(len(intro_submissions), 1)
            self.assertEqual(len(video_submissions), 1)
            self.assertEqual(video_submissions[0][1]["resolution"], "720p")
            self.assertEqual(video_submissions[0][1]["image_url"], "https://fal.media/files/req-avatar.png?token=secret")
            self.assertEqual(video_submissions[0][1]["audio_url"], "https://fal.media/files/req-intro-audio.mp3?token=secret")
            self.assertEqual(len(fake_client.downloads), 9)
            self.assertEqual(provider_response["images"][0]["url"], "https://fal.media/files/req-slide-01.png")
            self.assertEqual(manifest["assets"]["slide_images"][0]["path"], "02-content-generation/slide-images/slide-01.png")
            self.assertEqual(manifest["assets"]["voiceover"]["provider_job_id"], "req-voiceover")
            self.assertEqual(manifest["assets"]["talking_head_intro_audio"]["provider_job_id"], "req-intro-audio")
            self.assertEqual(
                manifest["assets"]["talking_head_intro_audio"]["path"],
                "02-content-generation/talking-head-intro-audio.mp3",
            )
            self.assertNotIn("source_url", manifest["assets"]["talking_head_intro_audio"])
            self.assertNotIn("source_url", manifest["assets"]["talking_head_avatar"])
            self.assertEqual(manifest["assets"]["talking_head_avatar"]["provider_job_id"], "req-avatar")
            self.assertEqual(manifest["assets"]["talking_head_intro"]["provider"], "fal.ai")
            self.assertEqual(manifest["assets"]["talking_head_intro"]["provider_job_id"], "req-talking-head-video")
            self.assertEqual(
                manifest["assets"]["talking_head_intro"]["path"],
                "02-content-generation/talking-head-intro.mp4",
            )


if __name__ == "__main__":
    unittest.main()
