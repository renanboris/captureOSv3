"""Property 12 (Preservation) — Static Asset Serving and Test Discovery.

Spec: ``.kiro/specs/production-hardening`` (bugfix). Validates that for inputs
where the bug condition does NOT hold, the system continues to:

* serve static assets from every existing ``StaticFiles`` mount point, and
* discover and pass the existing time-bender tests (which relocate to ``tests/``
  during the fix).

**Validates: Requirements 3.7, 3.8**

Observation-first methodology
-----------------------------
Before writing these assertions the UNFIXED code was driven directly:

* Each of the 8 mounts (``/videos_gerados``, ``/editor``, ``/artifacts``,
  ``/screenshots``, ``/simlink``, ``/scorm``, ``/audios``, ``/scorm-player``)
  served a probe asset with ``200`` (exact bytes) and returned ``404`` for a
  missing file.
* ``video_eng.time_bender`` imported and exposed
  ``compose_video_with_freeze_frames``; it returned ``False`` for a missing
  input video, and ``_calculate_segments`` produced one freeze + one audio
  delay per event with non-decreasing delays and a trailing final freeze.

These observed baselines are encoded below so the test PASSES on unfixed code
and continues to pass (no regression) after the fix.

This is a PRESERVATION test: it MUST PASS on the unfixed code.
"""

from __future__ import annotations

import os
import string
import uuid
from pathlib import Path
from typing import Dict, Iterator

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

# --------------------------------------------------------------------------- #
# The static mounts the API exposes (mount path -> backing directory).
# Mirrors the StaticFiles mounts in api/main.py; the API creates these dirs at
# import time so they always exist when the app is importable.
# --------------------------------------------------------------------------- #
EXPECTED_MOUNTS: Dict[str, str] = {
    "/videos_gerados": "data/videos_gerados",
    "/editor": "frontend_legacy/editor",
    "/artifacts": "data/artifacts",
    "/screenshots": "data/simlink_screenshots",
    "/simlink": "frontend_legacy/simlink",
    "/scorm": "data/scorm",
    "/audios": "data/audios",
    "/scorm-player": "scorm_eng/templates",
}

REPO_ROOT = Path(__file__).resolve().parent.parent

# Filenames safe to use verbatim in a URL path (no escaping needed).
_SAFE_FILENAME_CHARS = string.ascii_letters + string.digits + "_-"


@pytest.fixture
def probe_asset_writer() -> Iterator["_ProbeWriter"]:
    """Write a uniquely-named asset into a mount's backing dir and auto-clean it.

    Only files this helper creates are removed on teardown, so pre-existing
    assets in the real product directories are never disturbed.
    """
    writer = _ProbeWriter()
    try:
        yield writer
    finally:
        writer.cleanup()


class _ProbeWriter:
    def __init__(self) -> None:
        self._created: list[Path] = []

    def write(self, directory: str, filename: str, content: str) -> Path:
        abs_dir = (REPO_ROOT / directory)
        abs_dir.mkdir(parents=True, exist_ok=True)
        path = abs_dir / filename
        path.write_text(content, encoding="utf-8")
        self._created.append(path)
        return path

    def cleanup(self) -> None:
        for path in self._created:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


# --------------------------------------------------------------------------- #
# 3.7 — Static asset serving
# --------------------------------------------------------------------------- #
def test_all_expected_static_mounts_are_present(app):
    """The exact set of static mount points is unchanged (baseline)."""
    mounted_paths = {
        route.path
        for route in app.routes
        if route.__class__.__name__ == "Mount"
    }
    for mount in EXPECTED_MOUNTS:
        assert mount in mounted_paths, f"missing static mount: {mount}"


@pytest.mark.parametrize("mount,directory", sorted(EXPECTED_MOUNTS.items()))
def test_each_mount_serves_its_asset(client, probe_asset_writer, mount, directory):
    """Each mount resolves a present asset to 200 with exact content (baseline)."""
    filename = f"_pbt_probe_{uuid.uuid4().hex}.txt"
    content = f"probe-{mount}"
    probe_asset_writer.write(directory, filename, content)

    resp = client.get(f"{mount}/{filename}")
    assert resp.status_code == 200, f"{mount} did not serve its asset"
    assert resp.text == content


@pytest.mark.parametrize("mount", sorted(EXPECTED_MOUNTS))
def test_each_mount_returns_404_for_missing_asset(client, mount):
    """A missing asset under a mount returns 404 (baseline)."""
    resp = client.get(f"{mount}/__definitely_missing_{uuid.uuid4().hex}__.txt")
    assert resp.status_code == 404


@settings(
    max_examples=10,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    mount=st.sampled_from(sorted(EXPECTED_MOUNTS)),
    name=st.text(alphabet=_SAFE_FILENAME_CHARS, min_size=1, max_size=24),
    body=st.text(
        alphabet=st.characters(blacklist_categories=("Cs", "Cc")),
        min_size=0,
        max_size=64,
    ),
)
def test_static_mounts_resolve_assets_across_mount_set(client, mount, name, body):
    """Scoped PBT: for any mount in the set, a written asset resolves to its bytes.

    Generates requests across the full set of mount points with random
    filenames/contents and asserts each still resolves to exactly the asset
    that was placed under that mount.
    """
    directory = EXPECTED_MOUNTS[mount]
    filename = f"_pbt_probe_{name}_{uuid.uuid4().hex}.txt"
    path = (REPO_ROOT / directory)
    path.mkdir(parents=True, exist_ok=True)
    asset_path = path / filename
    asset_path.write_text(body, encoding="utf-8")
    try:
        resp = client.get(f"{mount}/{filename}")
        assert resp.status_code == 200, f"{mount} failed to serve {filename!r}"
        assert resp.text == body
    finally:
        try:
            asset_path.unlink(missing_ok=True)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
# 3.8 — Test discovery: the time-bender tests are discovered and pass
# --------------------------------------------------------------------------- #
def test_time_bender_module_is_discoverable_and_exposes_compose():
    """The time-bender code is importable and exposes its entry point.

    This is the discovery half of 3.8: wherever ``test_timebender.py`` lives
    (root today, ``tests/`` after the fix), the module under test must import
    and expose ``compose_video_with_freeze_frames``.
    """
    from video_eng import time_bender

    assert hasattr(time_bender, "compose_video_with_freeze_frames")
    assert callable(time_bender.compose_video_with_freeze_frames)


def test_compose_returns_false_for_missing_input_video():
    """Observed baseline: a missing input video yields ``False`` (no exception)."""
    from video_eng.time_bender import compose_video_with_freeze_frames

    result = compose_video_with_freeze_frames(
        "does/not/exist.webm",
        "unused_output.mp4",
        [{"timestamp": 2.0, "audio_path": "missing.mp3"}],
    )
    assert result is False


def test_calculate_segments_matches_observed_baseline():
    """Observed baseline of the freeze-frame timeline computation.

    For the two-event timeline observed on unfixed code, every event produces a
    freeze + an audio delay, audio delays are non-decreasing, and the timeline
    ends with a trailing final freeze frame.
    """
    from video_eng.time_bender import _calculate_segments

    events = [
        {"timestamp": 2.0, "audio_path": "a1.mp3", "audio_duration": 1.5},
        {"timestamp": 5.0, "audio_path": "a2.mp3", "audio_duration": 2.0},
    ]
    segments, audio_delays = _calculate_segments(events, video_duration=10.0)

    assert len(audio_delays) == len(events)
    assert [d[0] for d in audio_delays] == ["a1.mp3", "a2.mp3"]
    # Delays are placed in non-decreasing order along the expanded timeline.
    assert all(
        audio_delays[i][1] <= audio_delays[i + 1][1]
        for i in range(len(audio_delays) - 1)
    )
    # One freeze segment per event plus a trailing final freeze.
    freeze_count = sum(1 for seg in segments if seg[0] == "freeze")
    assert freeze_count == len(events) + 1
    assert segments[-1][0] == "freeze"


@settings(max_examples=10, deadline=None)
@given(
    timestamps=st.lists(
        st.floats(min_value=0.5, max_value=90.0, allow_nan=False, allow_infinity=False),
        min_size=1,
        max_size=6,
        unique=True,
    ),
    durations=st.lists(
        st.floats(min_value=0.3, max_value=5.0, allow_nan=False, allow_infinity=False),
        min_size=1,
        max_size=6,
    ),
)
def test_calculate_segments_invariants_hold(timestamps, durations):
    """Scoped PBT over the time-bender timeline math (observed invariants).

    For any valid set of in-range events, the unfixed computation keeps these
    invariants: one audio delay per event, exactly ``n+1`` freeze segments
    (one per event plus the trailing final freeze), non-decreasing audio
    delays, and a trailing final freeze.
    """
    from video_eng.time_bender import _calculate_segments

    video_duration = 100.0
    ordered = sorted(t for t in timestamps if t < video_duration)
    if not ordered:
        return  # nothing in range; not a meaningful timeline
    events = [
        {
            "timestamp": ts,
            "audio_path": f"a{i}.mp3",
            "audio_duration": durations[i % len(durations)],
        }
        for i, ts in enumerate(ordered)
    ]

    segments, audio_delays = _calculate_segments(events, video_duration)

    assert len(audio_delays) == len(events)
    assert all(
        audio_delays[i][1] <= audio_delays[i + 1][1]
        for i in range(len(audio_delays) - 1)
    )
    freeze_count = sum(1 for seg in segments if seg[0] == "freeze")
    assert freeze_count == len(events) + 1
    assert segments[-1][0] == "freeze"
