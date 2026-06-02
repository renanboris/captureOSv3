"""Time-bender smoke test (relocated from the repo root to ``tests/``).

Originally this lived at the repository root as ``test_timebender.py`` -- an
orphaned manual script that ran ``compose_video_with_freeze_frames`` against a
hardcoded local recording and printed the result. Test-discovery conventions
(and the ``production-hardening`` bugfix, clauses 1.12 -> 2.12) require it under
``tests/``.

It is now a proper, discoverable ``pytest`` test: the module no longer executes
the composition at import time (which would have run ffmpeg during collection).
The original manual demonstration is preserved under ``if __name__ ==
"__main__"`` so it can still be run directly.

    **Validates: Requirements 2.12, 3.8**
"""

from video_eng.time_bender import compose_video_with_freeze_frames


def test_compose_video_with_freeze_frames_returns_false_for_missing_input():
    """A missing input video yields ``False`` (observed baseline, no exception)."""
    timeline = [
        {"timestamp": 2.0, "audio_path": "data/audios/sess_missing/passo_1.mp3"}
    ]
    result = compose_video_with_freeze_frames(
        "data/raw_videos/does_not_exist_raw.webm",
        "test_output.mp4",
        timeline,
    )
    assert result is False


if __name__ == "__main__":
    # Original manual demonstration, preserved for direct invocation.
    timeline = [
        {"timestamp": 2.0, "audio_path": "data/audios/sess_1779454156678/passo_1.mp3"}
    ]
    print("Iniciando teste...")
    res = compose_video_with_freeze_frames(
        "data/raw_videos/sess_1779454156678_raw.webm",
        "test_output.mp4",
        timeline,
    )
    print("Resultado:", res)
