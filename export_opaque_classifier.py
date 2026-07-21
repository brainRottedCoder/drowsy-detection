#!/usr/bin/env python3
"""Export glasses-detector sunglasses (opaque-lens) classifier to ONNX.

Run once offline:
  python -m venv .venv-glasses
  .venv-glasses/Scripts/pip install glasses-detector torch onnx onnxruntime   # Windows
  .venv-glasses/Scripts/python export_opaque_classifier.py --size small --out public/models/glasses_opaque.onnx

Kind is ``sunglasses`` in glasses-detector (= opaque / semi-transparent lenses).
Preprocessing (must match browser): resize 256x256, ImageNet mean/std.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from glasses_detector import GlassesClassifier


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument(
    "--size",
    default="small",
    choices=["small", "medium", "large", "s", "m", "l"],
    help="Model size alias (default: small).",
  )
  parser.add_argument(
    "--out",
    default="public/models/glasses_opaque.onnx",
    help="Output ONNX path (default: public/models/glasses_opaque.onnx).",
  )
  parser.add_argument(
    "--opset",
    type=int,
    default=17,
    help="ONNX opset version.",
  )
  args = parser.parse_args()

  out_path = Path(args.out)
  out_path.parent.mkdir(parents=True, exist_ok=True)
  meta_path = out_path.with_suffix(".meta.json")

  # sunglasses = opaque / semi-transparent lens class in this package
  clf = GlassesClassifier(size=args.size, kind="sunglasses", device="cpu")
  model = clf.model.eval()

  input_size = (256, 256)  # W, H — matches BaseGlassesModel.predict default
  mean = [0.485, 0.456, 0.406]
  std = [0.229, 0.224, 0.225]

  dummy = torch.randn(1, 3, input_size[1], input_size[0], dtype=torch.float32)

  # Prefer the legacy exporter: more stable for this tiny binary classifier,
  # and avoids UTF-8 console issues in the new dynamo path on Windows.
  torch.onnx.export(
    model,
    dummy,
    str(out_path),
    export_params=True,
    opset_version=args.opset,
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
    "kind": "sunglasses",
    "size": args.size,
    "task": "classification",
    "positive_class": "opaque_or_semi_transparent_glasses",
    "input_name": "input",
    "output_name": "logit",
    "input_layout": "NCHW",
    "input_size": {"width": input_size[0], "height": input_size[1]},
    "color_order": "RGB",
    "normalize": {
      "scale_0_1": True,
      "mean": mean,
      "std": std,
      "note": "ImageNet / albumentations defaults from glasses_detector BaseGlassesModel.predict",
    },
    "output": {
      "type": "logit",
      "activation": "sigmoid",
      "threshold_hint": 0.5,
      "interpretation": "P(positive)=sigmoid(logit); higher => sunglasses/opaque lenses more likely",
    },
  }
  meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

  # Sanity: run ONNX Runtime vs torch
  try:
    import onnxruntime as ort
    import numpy as np

    sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
    ort_out = sess.run(None, {"input": dummy.numpy()})[0]
    with torch.inference_mode():
      torch_out = model(dummy).detach().cpu().numpy()
    max_diff = float(np.max(np.abs(ort_out.reshape(-1) - torch_out.reshape(-1))))
    print(f"ONNX vs Torch max |diff| = {max_diff:.6g}")
  except Exception as exc:  # noqa: BLE001
    print(f"Skipped ORT sanity check: {exc}")

  print(f"Wrote {out_path}")
  print(f"Wrote {meta_path}")


if __name__ == "__main__":
  main()
