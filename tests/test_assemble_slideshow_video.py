import json
import tempfile
import unittest
from pathlib import Path

from codex.tools import assemble_slideshow_video as assembler


def timings_fixture(estimated: bool = True) -> dict:
    return {
        "estimated": estimated,
        "segments": [
            {"slide_id": f"slide-{index:02d}", "start_seconds": index - 1, "end_seconds": index}
            for index in range(1, 4)
        ],
    }


def content_dir(root: Path, *, estimated: bool = True, slides: int = 3) -> Path:
    content = root / "02-content-generation"
    slide_dir = content / "slide-images"
    slide_dir.mkdir(parents=True)
    for index in range(1, slides + 1):
        (slide_dir / f"slide-{index:02d}.png").write_bytes(b"png")
    (content / "voiceover.mp3").write_bytes(b"mp3")
    (content / "narration-timings.json").write_text(json.dumps(timings_fixture(estimated)))
    return content


def segments_for(durations: list[float]) -> list[assembler.Segment]:
    segments = []
    start = 0.0
    for index, duration in enumerate(durations, start=1):
        segments.append(
            assembler.Segment(
                slide_id=f"slide-{index:02d}",
                start_seconds=start,
                end_seconds=start + duration,
                image=Path(f"slide-{index:02d}.png"),
            )
        )
        start += duration
    return segments


class LoadSegmentsTest(unittest.TestCase):
    def test_reads_timings_in_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            content = content_dir(Path(tmp))
            images = assembler.slide_images(content / "slide-images")
            segments, estimated = assembler.load_segments(
                content / "narration-timings.json", images
            )

            self.assertTrue(estimated)
            self.assertEqual([segment.slide_id for segment in segments], ["slide-01", "slide-02", "slide-03"])
            self.assertEqual(segments[2].end_seconds, 3.0)

    def test_missing_image_for_timed_slide_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            content = content_dir(Path(tmp), slides=2)
            images = assembler.slide_images(content / "slide-images")

            with self.assertRaises(assembler.AssemblyError):
                assembler.load_segments(content / "narration-timings.json", images)

    def test_without_timings_slides_split_evenly(self):
        with tempfile.TemporaryDirectory() as tmp:
            content = content_dir(Path(tmp))
            images = assembler.slide_images(content / "slide-images")
            segments, estimated = assembler.load_segments(None, images)

            self.assertTrue(estimated)
            self.assertEqual(len(segments), 3)
            self.assertEqual(segments[0].start_seconds, 0.0)


class FitSegmentsTest(unittest.TestCase):
    def test_close_enough_timeline_is_left_alone(self):
        segments, applied = assembler.fit_segments(segments_for([5.0, 5.0]), 10.1, "auto", True)

        self.assertEqual(applied, "none")
        self.assertEqual(segments[-1].end_seconds, 10.0)

    def test_auto_scales_estimated_timings(self):
        segments, applied = assembler.fit_segments(segments_for([5.0, 10.0]), 30.0, "auto", True)

        self.assertEqual(applied, "scale")
        self.assertAlmostEqual(segments[0].end_seconds, 10.0)
        self.assertAlmostEqual(segments[-1].end_seconds, 30.0)

    def test_auto_pads_last_slide_for_measured_timings(self):
        segments, applied = assembler.fit_segments(segments_for([5.0, 10.0]), 30.0, "auto", False)

        self.assertEqual(applied, "pad-last")
        self.assertAlmostEqual(segments[0].end_seconds, 5.0)
        self.assertAlmostEqual(segments[-1].end_seconds, 30.0)

    def test_strict_refuses_a_mismatch(self):
        with self.assertRaises(assembler.AssemblyError):
            assembler.fit_segments(segments_for([5.0, 10.0]), 30.0, "strict", True)


class FfmpegCommandTest(unittest.TestCase):
    def test_concat_graph_holds_each_slide_for_its_own_duration(self):
        command = assembler.build_ffmpeg_command(
            segments_for([4.0, 6.0]),
            Path("voiceover.mp3"),
            Path("out.mp4"),
            width=1920,
            height=1080,
            fps=30,
            background="black",
            crossfade=0.0,
            overwrite=True,
        )
        graph = command[command.index("-filter_complex") + 1]

        self.assertEqual(command[command.index("-loop") + 3], "4.000")
        self.assertIn("concat=n=2:v=1:a=0[vout]", graph)
        self.assertEqual(command[command.index("-map") + 1], "[vout]")
        self.assertIn("2:a", command)

    def test_crossfade_extends_clips_and_offsets_by_slide_start(self):
        command = assembler.build_ffmpeg_command(
            segments_for([4.0, 6.0]),
            Path("voiceover.mp3"),
            Path("out.mp4"),
            width=1280,
            height=720,
            fps=24,
            background="white",
            crossfade=0.5,
            overwrite=True,
        )
        graph = command[command.index("-filter_complex") + 1]

        self.assertEqual(command[command.index("-loop") + 3], "4.500")
        self.assertIn("xfade=transition=fade:duration=0.500:offset=4.000", graph)

    def test_crossfade_longer_than_a_slide_is_rejected(self):
        with self.assertRaises(assembler.AssemblyError):
            assembler.build_ffmpeg_command(
                segments_for([0.4, 6.0]),
                Path("voiceover.mp3"),
                Path("out.mp4"),
                width=1920,
                height=1080,
                fps=30,
                background="black",
                crossfade=0.5,
                overwrite=True,
            )


class ResolveInputsTest(unittest.TestCase):
    def test_content_dir_finds_every_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            content = content_dir(Path(tmp))
            args = assembler.parse_args(["--content-dir", str(content), "--output", "out.mp4"])
            slides_dir, audio, timings = assembler.resolve_inputs(args)

            self.assertEqual(slides_dir, content / "slide-images")
            self.assertEqual(audio, content / "voiceover.mp3")
            self.assertEqual(timings, content / "narration-timings.json")

    def test_missing_audio_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            content = content_dir(Path(tmp))
            (content / "voiceover.mp3").unlink()
            args = assembler.parse_args(["--content-dir", str(content), "--output", "out.mp4"])

            with self.assertRaises(assembler.AssemblyError):
                assembler.resolve_inputs(args)


if __name__ == "__main__":
    unittest.main()
