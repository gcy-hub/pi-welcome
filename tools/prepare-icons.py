"""Build interchangeable monochrome animation segments from the two icon sheets."""
import gzip
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'assets'
OUT = ROOT / 'icons' / 'frames'
OUT.mkdir(exist_ok=True)
clips = json.load(gzip.open(ROOT / 'animations.json.gz'))['clips']
HEX = bytes(ord(format(round(i / 17), 'x')) for i in range(256))


def masks(side):
    img = Image.open(ROOT / 'icons' / f'pi-tui-{side}-icons.png').convert('RGB')
    # The references use a saturated violet foreground; exclude badges, labels and UI.
    r, g, b = np.array(img, dtype=int).transpose(2, 0, 1)
    # Final glyphs are solid silhouettes. Badges also use stepped shading for facial details.
    tone = np.where(g < 68, 140, np.where(g < 105, 194, 255)) if side == 'first' else 255
    alpha = Image.fromarray(np.where((b-g > 60) & (b-r > 35), tone, 0).astype('uint8'))
    if side == 'first':
        boxes = [(x-71, y-70, x+71, y+70) for y in [208, 511] for x in [167, 503, 839]]
    else:
        boxes = [(x, y, x+185, y+118) for y in [144, 535] for x in [109, 661, 1210]]
    for box in boxes:
        icon = alpha.crop(box)
        icon = icon.crop(icon.getbbox())
        yield icon


def frame(image, t, circle=None):
    box = (circle if circle is not None else image).getbbox() or (0, 0, 1, 1)
    if circle is not None and image.getbbox():
        a,b,c,d = image.getbbox(); x,y,z,w = box
        box = min(a,x), min(b,y), max(c,z), max(d,w)
    ink = image.crop(box).tobytes().translate(HEX).decode()
    ring = circle.crop(box).tobytes().translate(HEX).decode() if circle is not None else '0'*len(ink)
    return dict(at=t, box=box, ink=ink, circle=ring, menu=False)


def save(name, frames):
    (OUT / (name+'.json.gz')).write_bytes(gzip.compress(json.dumps(frames, separators=(',', ':')).encode(), mtime=0))


def eased(t):
    t = min(1, max(0, t)); return t*t*(3-2*t)


def paint(icon, cx, cy, width, height, scatter=0, effect='', progress=1):
    scale = min(width/icon.width, height/icon.height)
    w,h = round(icon.width*scale), round(icon.height*scale)
    stamp = icon.resize((w,h), Image.Resampling.BOX if scale < 1 else Image.Resampling.NEAREST)
    left,top = round(cx-w/2),round(cy-h/2)
    img = Image.new('L', (500,313))
    if not scatter:
        if effect=='slice' and progress<1:
            band=max(1,round(max(w,h)/8))
            for y in range(0,h,band):
                offset=round((1 if y//band%2 else -1)*105*(1-progress))
                img.paste(stamp.crop((0,y,w,min(h,y+band))), (left+offset,top+y))
        else:
            right=round(w*progress) if effect=='write' else w
            bottom=round(h*progress) if effect=='scan' else h
            img.paste(stamp.crop((0,0,right,bottom)), (left,top))
        return img
    # Split the full-detail stamp into moving particles, not the other way around.
    step=max(1,round(max(w,h)/24))
    for y in range(0,h,step):
        for x in range(0,w,step):
            tile=stamp.crop((x,y,min(x+step,w),min(y+step,h)))
            if not tile.getbbox(): continue
            a,b=cloud[(y//step*71+x//step*131)%len(cloud)]
            px,py=left+x+tile.width/2,top+y+tile.height/2
            tile=tile.resize(tuple(round(v+(2-v)*scatter) for v in tile.size), Image.Resampling.BOX)
            pos=(round(px+(a-px)*scatter-tile.width/2),round(py+(b-py)*scatter-tile.height/2))
            img.paste(tile,pos,tile.point(lambda v: 255 if v else 0))
    return img


mid = next(f for f in clips[1]['frames'] if f['at']==800)
x,y,r,b = mid['box']; cloud = [(x+i%(r-x), y+i//(r-x)) for i,v in enumerate(mid['ink']) if int(v,16)>6]
np.random.default_rng(42).shuffle(cloud)
for n,icon in enumerate(masks('first'),1):
    frames=[]
    for t in range(0,800,40):
        p=eased((t-320)/480)
        ring=Image.new('L',(500,313)); ImageDraw.Draw(ring).ellipse((176,82,323,230),fill=round(96*(1-p)))
        frames.append(frame(paint(icon,250,156,88,88,p),t,ring))
    save(f'first-{n}',frames)

for n,icon in enumerate(masks('last'),1):
    for clip in clips:
        k=int(clip['id']); particle=k in (2,3,4); frames=[]
        for f in clip['frames']:
            t=f['at']
            if particle and t<800: continue
            leave,land = {1:(150,680),2:(1600,2170),3:(1510,2090),4:(1580,2190),8:(70,1040)}.get(k,(0,850))
            p=eased((t-leave)/(land-leave)); s=eased((1250-t)/450) if particle else 0
            if k==4: p += .15*math.sin(math.pi*p*2)*p
            zoom=(1-p)*(2.5 if k==8 else .25)+1
            effect={1:'write',5:'write',6:'scan',7:'slice'}.get(k,'')
            cx,cy=(250-54.5*p,156-74.5*p) if k in (1,2,3,4,8) else (195.5,81.5)
            image=paint(icon,cx,cy,109*zoom,91*zoom,s,effect,eased(t/(550 if k==1 else land)))
            frames.append(frame(image,t))
            if t>=land: break
        save(f"last-{n}-{clip['id']}",frames)
