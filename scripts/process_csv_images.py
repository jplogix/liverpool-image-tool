from __future__ import annotations

import argparse
import csv
import io
import re
import sys
import zipfile
from pathlib import Path

import requests
from PIL import Image, ImageOps


FRAME_WIDTH = 940
FRAME_HEIGHT = 1215
HORIZONTAL_PADDING = 10
JPEG_QUALITY = 95


def clean_header(value: str) -> str:
    return value.lstrip("\ufeff").strip().lower()


def safe_filename(value: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", value).strip()
    return re.sub(r"\s+", " ", cleaned)


def render_frame(image: Image.Image, flip_x: bool = False) -> bytes:
    source = ImageOps.exif_transpose(image).convert("RGB")
    if flip_x:
        source = ImageOps.mirror(source)

    frame = Image.new("RGB", (FRAME_WIDTH, FRAME_HEIGHT), "white")
    available_width = FRAME_WIDTH - HORIZONTAL_PADDING * 2
    scale = min(available_width / source.width, FRAME_HEIGHT / source.height)
    output_size = (round(source.width * scale), round(source.height * scale))
    resized = source.resize(output_size, Image.Resampling.LANCZOS)
    paste_x = (FRAME_WIDTH - resized.width) // 2
    paste_y = (FRAME_HEIGHT - resized.height) // 2
    frame.paste(resized, (paste_x, paste_y))

    buffer = io.BytesIO()
    frame.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buffer.getvalue()


def fetch_image(url: str, timeout: int) -> Image.Image:
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    return Image.open(io.BytesIO(response.content))


def process_csv(input_csv: Path, output_zip: Path, timeout: int) -> tuple[int, list[str]]:
    errors: list[str] = []
    processed = 0

    with input_csv.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if not reader.fieldnames:
            raise ValueError("CSV has no header row.")

        header_map = {clean_header(header): header for header in reader.fieldnames}
        required = ["skui", "img1", "img2"]
        missing = [header for header in required if header not in header_map]
        if missing:
            raise ValueError(f"Missing required headers: {', '.join(missing)}")

        output_zip.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for row_number, row in enumerate(reader, start=2):
                sku = (row.get(header_map["skui"]) or "").strip()
                img1_url = (row.get(header_map["img1"]) or "").strip()
                img2_url = (row.get(header_map["img2"]) or "").strip()

                if not sku and not img1_url and not img2_url:
                    continue

                if not sku or not img1_url or not img2_url:
                    errors.append(f"Row {row_number}: missing SKUI, IMG1, or IMG2.")
                    continue

                filename_base = safe_filename(sku)

                try:
                    front = fetch_image(img2_url, timeout)
                    archive.writestr(f"{filename_base}-1.jpg", render_frame(front, flip_x=False))
                except Exception as error:  # noqa: BLE001
                    errors.append(f"Row {row_number} {sku}: IMG2 front view failed: {error}")

                try:
                    angle = fetch_image(img1_url, timeout)
                    archive.writestr(f"{filename_base}-2.jpg", render_frame(angle, flip_x=False))
                    archive.writestr(f"{filename_base}-3.jpg", render_frame(angle, flip_x=True))
                except Exception as error:  # noqa: BLE001
                    errors.append(f"Row {row_number} {sku}: IMG1 angle view failed: {error}")

                processed += 1
                if processed % 25 == 0:
                    print(f"Processed {processed} rows...", flush=True)

    return processed, errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("output_zip", type=Path)
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()

    processed, errors = process_csv(args.input_csv, args.output_zip, args.timeout)
    print(f"Rows processed: {processed}")
    print(f"Output zip: {args.output_zip}")
    print(f"Errors: {len(errors)}")

    if errors:
        error_log = args.output_zip.with_suffix(".errors.txt")
        error_log.write_text("\n".join(errors) + "\n", encoding="utf-8")
        print(f"Error log: {error_log}")

    return 0 if processed > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
