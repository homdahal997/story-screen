import asyncio, sys, subprocess
sys.path.insert(0, "/app/backend")
import core, pipeline
from routes import _stitch_items

PID = "c69332993aec4f1fbbae370a70726c09"

async def main():
    ep = await core.db.episodes.find_one({"project_id": PID, "episode_number": 1}, {"_id": 0})
    items = _stitch_items(ep)
    print("stitch items (path, has_audio):")
    for p, a in items:
        print("   audio" if a else "   SILENT", p[-40:])
    print("total clips:", len(items))
    blobs = []
    for path, has_audio in items:
        data, _ = await core.load_bytes(path)
        blobs.append((data, has_audio))
        print(f"  fetched {len(data)} bytes audio={has_audio}")
    out = await asyncio.get_event_loop().run_in_executor(None, pipeline.stitch_episode, blobs, "vertical")
    print("FINAL MP4 bytes:", len(out))
    with open("/tmp/final_cut.mp4", "wb") as f:
        f.write(out)
    ff = pipeline._ffmpeg_exe()
    # probe duration/resolution via ffmpeg
    r = subprocess.run([ff, "-i", "/tmp/final_cut.mp4"], capture_output=True, text=True)
    for line in r.stderr.splitlines():
        if "Duration" in line or "Stream" in line:
            print("  ", line.strip())

asyncio.run(main())
