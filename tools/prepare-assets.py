"""Prepare terminal animation masks and selection motion from the reference GIFs."""
import gzip
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageMath

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 500, 313
HEX = bytes(ord(format(round(v / 17), 'x')) for v in range(256))
BOX = (282, 72, 218, 183)
NAMES = ["手绘展开", "粒子聚合", "粒子滑入", "粒子弹入", "光标书写", "扫描显影", "切片归位", "缩放落位"]


def prepare_clip(path, name):
    frames = []
    time = 0
    menu_seen = False
    with Image.open(path) as image:
        for index in range(image.n_frames):
            image.seek(index)
            rgb = image.convert("RGB")
            menu_seen |= any(
                45 <= b <= 110 and r > g + 2 and b > r + 12
                for r, g, b in (rgb.getpixel((450, y)) for y in range(285, 315))
            )
            r, g, b = (channel.convert("I") for channel in rgb.split())
            channels = {"r": r, "g": g, "b": b}
            mask = ImageMath.eval("convert((b>95)*((b-27)*10>14*max(r-19,g-20))*(((b>=235)+(abs(r-g)>=12))>0)*255,'L')", **channels)
            alpha = rgb.getchannel("B").point(lambda value: min(255, max(0, round((value - 27) / 228 * 255))))
            ink = ImageChops.multiply(mask, alpha)
            circle = Image.new("L", rgb.size)
            if menu_seen:
                if name != "切片归位":
                    cropped = ink.crop((BOX[0], BOX[1], BOX[0] + BOX[2], BOX[1] + BOX[3]))
                    ink = Image.new("L", rgb.size)
                    ink.paste(cropped, BOX[:2])
                draw = ImageDraw.Draw(ink)
                draw.rectangle((0, 270, rgb.width, rgb.height), fill=0)
                draw.rectangle((505, 180, rgb.width, rgb.height), fill=0)
            else:
                circle = ImageMath.eval("convert((r>=40)*(r<=65)*(g>=40)*(g<=70)*(b>=45)*(b<=80)*(max(max(r,g),b)-min(min(r,g),b)<25)*100,'L')", **channels)
            if name in ("光标书写", "扫描显影", "切片归位"):
                ImageDraw.Draw(ink).rectangle((505, 180, rgb.width, rgb.height), fill=0)
            duration = image.info.get("duration", 40)
            ink, circle = [m.resize((WIDTH, HEIGHT), Image.Resampling.BOX) for m in (ink, circle)]
            box = ImageChops.lighter(ink, circle).getbbox() or (0, 0, 1, 1)
            def encode(mask):
                return mask.crop(box).tobytes().translate(HEX).decode('ascii')
            frames.append({"at": time, "box": box, "ink": encode(ink), "circle": encode(circle), "menu": menu_seen})
            time += duration
    assert any(char != "0" for char in frames[-1]["ink"]), path
    return {"id": path.stem[-2:], "name": name, "duration": time, "frames": frames}


def prepare_move(path):
    samples = []
    time = 0
    with Image.open(path) as image:
        for index in range(22):
            image.seek(index)
            rgb = image.convert("RGB")
            ys = [y for y in range(260, 410) if sum(abs(a - b) for a, b in zip(rgb.getpixel((600, y)), (53, 40, 88))) < 15]
            if index:
                top, bottom = min(ys), max(ys)
                samples.append([time - 620, round(((top + bottom) / 2 - 297.5) / 43, 5), round((bottom - top + 1) / 34, 5)])
            time += image.info.get("duration", 20)
    return [[0, 0, 1], *[sample for sample in samples if sample[0] > 0]]


if __name__ == "__main__":
    clips = [prepare_clip(ROOT / "assets" / "Anime" / f"startup-animation-{index:02}.gif", name) for index, name in enumerate(NAMES, 1)]
    data = {"width": WIDTH, "height": HEIGHT, "box": BOX, "clips": clips, "move": prepare_move(ROOT / "assets" / "Anime" / "Move.gif")}
    target = ROOT / "assets" / "animations.json.gz"
    with gzip.open(target, "wt", encoding="utf-8") as output:
        json.dump(data, output, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(clips)} animations, {sum(len(clip['frames']) for clip in clips)} frames, {len(data['move'])} motion samples: {target}")
