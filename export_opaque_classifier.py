#!/usr/bin/env python3
"""Export glasses-detector eyeglasses + sunglasses classifiers to ONNX.

Two mutually exclusive binary heads → 3-way partition in the browser:
  sunglasses+ → opaque
  eyeglasses+ & sunglasses− → transparent (clear power glasses)
  both− → bare eyes

Run once offline:
  python -m venv .venv-glasses
  .venv-glasses/Scripts/pip install glasses-detector torch onnx onnxruntime onnxscript
  .venv-glasses/Scripts/python export_opaque_classifier.py --size small --out-dir public/models

Preprocessing (must match browser): 256×256 RGB, ImageNet mean/std.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from glasses_detector import GlassesClassifier

MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]
INPUT_SIZE = (256, 256)  # W, H
KINDS = (
  ("eyeglasses", "glasses_eyeglasses.onnx", "transparent_eyeglasses"),
  ("sunglasses", "glasses_sunglasses.onnx", "opaque_or_semi_transparent_glasses"),
)


def export_one(
  kind: str,
  out_path: Path,
  positive_class: str,
  size: str,
  opset: int,
) -> None:
  out_path.parent.mkdir(parents=True, exist_ok=True)
  meta_path = out_path.with_suffix(".meta.json")

  clf = GlassesClassifier(size=size, kind=kind, device="cpu")
  model = clf.model.eval()
  dummy = torch.randn(1, 3, INPUT_SIZE[1], INPUT_SIZE[0], dtype=torch.float32)

  torch.onnx.export(
    model,
    dummy,
    str(out_path),
    export_params=True,
    opset_version=opset,
    do_constant_folding=True,
    input_names=["input"],
    output_names=["logit"],
    dynamic_axes={
      "input": {0: "batch"},
      "logit": {0: "batch"},
    },
    dynamo=False,
  )

  meta = {
    "source": "glasses-detector",
    "kind": kind,
    "size": size,
    "task": "classification",
    "positive_class": positive_class,
    "input_name": "input",
    "output_name": "logit",
    "input_layout": "NCHW",
    "input_size": {"width": INPUT_SIZE[0], "height": INPUT_SIZE[1]},
    "color_order": "RGB",
    "normalize": {
      "scale_0_1": True,
      "mean": MEAN,
      "std": STD,
      "note": "ImageNet / albumentations defaults from glasses_detector BaseGlassesModel.predict",
    },
    "output": {
      "type": "logit",
      "activation": "sigmoid",
      "threshold_hint": 0.5,
      "interpretation": f"P({kind})=sigmoid(logit)",
    },
    "combine_with": {
      "eyeglasses": "glasses_eyeglasses.onnx",
      "sunglasses": "glasses_sunglasses.onnx",
      "partition": {
        "bare": "eyeglasses− & sunglasses−",
        "transparent": "eyeglasses+ & sunglasses−",
        "opaque": "sunglasses+ (eyeglasses either)",
      },
    },
  }
  meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

  try:
    import numpy as np
    import onnxruntime as ort

    sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
    ort_out = sess.run(None, {"input": dummy.numpy()})[0]
    with torch.inference_mode():
      torch_out = model(dummy).detach().cpu().numpy()
    max_diff = float(np.max(np.abs(ort_out.reshape(-1) - torch_out.reshape(-1))))
    print(f"[{kind}] ONNX vs Torch max |diff| = {max_diff:.6g}")
  except Exception as exc:  # noqa: BLE001
    print(f"[{kind}] Skipped ORT sanity check: {exc}")

  print(f"Wrote {out_path}")
  print(f"Wrote {meta_path}")


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument(
    "--size",
    default="small",
    choices=["small", "medium", "large", "s", "m", "l"],
    help="Model size (default: small — better latency for two forward passes).",
  )
  parser.add_argument(
    "--out-dir",
    default="public/models",
    help="Directory for both ONNX files (default: public/models).",
  )
  parser.add_argument(
    "--opset",
    type=int,
    default=17,
    help="ONNX opset version.",
  )
  # Back-compat: single sunglasses export path still accepted
  parser.add_argument(
    "--out",
    default=None,
    help="Deprecated. If set, only exports sunglasses to this path.",
  )
  args = parser.parse_args()

  if args.out:
    export_one(
      kind="sunglasses",
      out_path=Path(args.out),
      positive_class="opaque_or_semi_transparent_glasses",
      size=args.size,
      opset=args.opset,
    )
    return

  out_dir = Path(args.out_dir)
  for kind, filename, positive in KINDS:
    export_one(
      kind=kind,
      out_path=out_dir / filename,
      positive_class=positive,
      size=args.size,
      opset=args.opset,
    )

  # Keep legacy filename as a copy of sunglasses for older URLs
  sunglasses_src = out_dir / "glasses_sunglasses.onnx"
  legacy = out_dir / "glasses_opaque.onnx"
  if sunglasses_src.exists():
    legacy.write_bytes(sunglasses_src.read_bytes())
    meta_legacy = json.loads(sunglasses_src.with_suffix(".meta.json").read_text(encoding="utf-8"))
    meta_legacy["legacy_alias_of"] = "glasses_sunglasses.onnx"
    legacy.with_suffix(".meta.json").write_text(json.dumps(meta_legacy, indent=2), encoding="utf-8")
    print(f"Wrote legacy alias {legacy}")


if __name__ == "__main__":
  main()
