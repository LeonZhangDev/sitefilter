# -*- coding: utf-8 -*-
"""纯标准库生成 SiteFilter 扩展图标（无需 PIL）"""
import zlib, struct, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')

BG = (23, 26, 38)
RING = (0, 229, 255)
SLASH = (255, 77, 109)


def rounded_rect(x, y, w, h, r, px, py):
    if px < x or py < y or px >= x + w or py >= y + h:
        return False
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def dist_to_seg(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def color_at(u, v, size):
    """u,v in [0,1)"""
    x = u * size
    y = v * size
    col = None

    if rounded_rect(0, 0, size, size, size * 0.22, x, y):
        col = BG

    cx = cy = size / 2.0
    r = size * 0.27
    d = math.hypot(x - cx, y - cy)
    if abs(d - r) <= size * 0.035:
        col = RING

    if dist_to_seg(x, y, size * 0.28, size * 0.72, size * 0.72, size * 0.28) <= size * 0.035:
        col = SLASH

    if col is None:
        return None
    return col + (255,)


def render(size, ss=3):
    buf = bytearray()
    for py in range(size):
        buf.append(0)  # filter type 0
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    u = (px + (sx + 0.5) / ss) / size
                    v = (py + (sy + 0.5) / ss) / size
                    c = color_at(u, v, size)
                    if c:
                        a = c[3] / 255.0
                        acc[0] += c[0] * a
                        acc[1] += c[1] * a
                        acc[2] += c[2] * a
                        acc[3] += a
            n = ss * ss
            if acc[3] == 0:
                buf += bytes((0, 0, 0, 0))
            else:
                a = acc[3] / n
                buf += bytes((
                    int(acc[0] / acc[3]),
                    int(acc[1] / acc[3]),
                    int(acc[2] / acc[3]),
                    int(round(a * 255)),
                ))
    return bytes(buf)


def write_png(path, size):
    raw = render(size)
    w = h = size

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print('wrote', path, os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    for s in (16, 32, 48, 128):
        write_png(os.path.join(OUT, 'icon%d.png' % s), s)
