import base64
import json
import os
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import openwakeword
from openwakeword.model import Model

PREFERRED_FRAME_LENGTH = 1280
DEFAULT_SAMPLE_RATE = 16000
DEFAULT_COOLDOWN_SECONDS = 1.5


def emit(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def emit_error(message, exc=None):
    emit(
        {
            "type": "error",
            "message": message,
            "traceback": traceback.format_exc() if exc else None,
        }
    )


def normalize_key(value):
    return value.lower().replace(" ", "_").replace("-", "_")


def resolve_model(requested_model_name):
    model_path = os.environ.get("SPIRA_OPENWAKEWORD_MODEL_PATH", "").strip()
    if model_path:
        path = Path(model_path)
        model = Model(wakeword_models=[str(path)], inference_framework="onnx")
        return model, next(iter(model.models.keys()))

    requested = normalize_key(requested_model_name or "hey_jarvis")
    models_dir = Path(openwakeword.__file__).parent / "resources" / "models"
    for candidate in sorted(models_dir.glob("*.onnx")):
        normalized_name = normalize_key(candidate.stem.replace("_v0.1", ""))
        if normalized_name == requested:
            model = Model(wakeword_models=[str(candidate)], inference_framework="onnx")
            return model, next(iter(model.models.keys()))

    raise RuntimeError(f"No bundled openWakeWord model matched '{requested_model_name}'")


def handle_audio(model, model_key, cooldown_seconds, threshold):
    last_detection_at = 0.0

    for raw_line in sys.stdin:
        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError:
            continue

        message_type = payload.get("type")
        if message_type == "shutdown":
            return

        if message_type != "audio":
            continue

        pcm_b64 = payload.get("pcm", "")
        if not pcm_b64:
            continue

        audio = np.frombuffer(base64.b64decode(pcm_b64), dtype=np.int16)
        predictions = model.predict(audio)
        score = float(predictions.get(model_key, 0.0))
        now = time.monotonic()
        if score >= threshold and now - last_detection_at >= cooldown_seconds:
            last_detection_at = now
            emit({"type": "detected", "score": score})


def main():
    threshold = float(os.environ.get("SPIRA_OPENWAKEWORD_THRESHOLD", "0.5"))
    requested_model_name = os.environ.get("SPIRA_OPENWAKEWORD_MODEL_NAME", "").strip()
    try:
        model, model_key = resolve_model(requested_model_name)
        emit(
            {
                "type": "ready",
                "sampleRate": DEFAULT_SAMPLE_RATE,
                "preferredFrameLength": PREFERRED_FRAME_LENGTH,
                "modelKey": model_key,
            }
        )
        handle_audio(model, model_key, DEFAULT_COOLDOWN_SECONDS, threshold)
    except Exception as exc:
        emit_error("openWakeWord worker failed", exc)
        raise


if __name__ == "__main__":
    main()
