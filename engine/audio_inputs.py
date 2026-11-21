"""What in an avatar-studio script changes the voice or the timing.

engine/lib/plan.mjs (audioInputs) builds the same object. gen_audio.py stores it in build/timeline.json, and the
render commands refuse a timeline whose stored inputs differ from the script's (tests/audio.test.mjs checks that
the two versions agree). Plain Python, no imports, so it runs anywhere:  python3 audio_inputs.py < script.json
"""
import json
import sys


def audio_inputs(script: dict) -> dict:
    def obj(value):
        return value if isinstance(value, dict) else None

    def line(entry):
        entry = entry if isinstance(entry, dict) else {}
        return {"say": entry.get("say"), "pause": entry.get("pause"), "voice": entry.get("voice"), "speed": entry.get("speed")}

    title, end = obj(script.get("title")), obj(script.get("end"))
    lines = script.get("lines") if isinstance(script.get("lines"), list) else []
    return {"lines": [line(entry) for entry in lines],
            "voice": script.get("voice"), "speed": script.get("speed"), "lang": script.get("lang"), "pronounce": script.get("pronounce"),
            "fps": script.get("fps"), "lead": script.get("lead"), "gap": script.get("gap"), "tail": script.get("tail"),
            "title": {"hold": title.get("hold")} if title else None, "end": {"hold": end.get("hold")} if end else None}


if __name__ == "__main__":
    print(json.dumps(audio_inputs(json.load(sys.stdin))))
