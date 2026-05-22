import asyncio
from video_eng.time_bender import compose_video_with_freeze_frames

timeline = [
    {"timestamp": 2.0, "audio_path": "data/audios/sess_1779454156678/passo_1.mp3"}
]

print("Iniciando teste...")
res = compose_video_with_freeze_frames(
    "data/raw_videos/sess_1779454156678_raw.webm",
    "test_output.mp4",
    timeline
)
print("Resultado:", res)
