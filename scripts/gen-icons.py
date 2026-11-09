# 生成消息中心 / 设置入口所需的描边图标（墨黑杂志风：1.5px 描边、无填充）
# 用法：python scripts/gen-icons.py
# 输出：images/*.png（48x48，4 倍超采样后缩小做抗锯齿）

import os
import math
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'images')

S = 48
SS = 4              # 超采样倍数
W = 1.6             # 描边宽度（超采样前的逻辑像素）
INK = (26, 26, 26, 255)
RED = (214, 69, 43, 255)


def canvas():
    img = Image.new('RGBA', (S * SS, S * SS), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def sc(v):
    """逻辑坐标 -> 超采样坐标"""
    return v * SS


def line(d, x1, y1, x2, y2, color=INK, width=W):
    d.line([sc(x1), sc(y1), sc(x2), sc(y2)], fill=color, width=int(round(width * SS)))
    # 圆头端点
    r = width * SS / 2.0
    for (x, y) in ((x1, y1), (x2, y2)):
        d.ellipse([sc(x) - r, sc(y) - r, sc(x) + r, sc(y) + r], fill=color)


def rect(d, x1, y1, x2, y2, color=INK, width=W, radius=0):
    if radius:
        d.rounded_rectangle(
            [sc(x1), sc(y1), sc(x2), sc(y2)],
            radius=sc(radius), outline=color, width=int(round(width * SS)))
    else:
        d.rectangle([sc(x1), sc(y1), sc(x2), sc(y2)],
                    outline=color, width=int(round(width * SS)))


def ellipse(d, cx, cy, rx, ry, color=INK, width=W):
    d.ellipse([sc(cx - rx), sc(cy - ry), sc(cx + rx), sc(cy + ry)],
              outline=color, width=int(round(width * SS)))


def poly(d, pts, color=INK, width=W):
    p = [(sc(x), sc(y)) for (x, y) in pts]
    d.polygon(p, outline=color)
    if len(p) > 2:
        d.line(p + [p[0]], fill=color, width=int(round(width * SS)), joint='curve')


def save(img, name):
    img = img.resize((S, S), Image.LANCZOS)
    path = os.path.join(OUT, name)
    img.save(path, 'PNG', optimize=True)
    print('  %-22s %d B' % (name, os.path.getsize(path)))


def icon_gear():
    """设置入口：齿轮"""
    img, d = canvas()
    cx, cy = 24, 24
    r_out, r_in = 13.0, 9.2
    # 8 个齿
    for i in range(8):
        a = math.radians(i * 45)
        x0 = cx + (r_out - 1.4) * math.cos(a)
        y0 = cy + (r_out - 1.4) * math.sin(a)
        x1 = cx + (r_out + 2.6) * math.cos(a)
        y1 = cy + (r_out + 2.6) * math.sin(a)
        line(d, x0, y0, x1, y1, width=W + 0.35)
    ellipse(d, cx, cy, r_out, r_out, width=W + 0.35)
    ellipse(d, cx, cy, r_in, r_in, width=W)
    ellipse(d, cx, cy, 4.2, 4.2, width=W)
    save(img, 'icon-settings.png')


def icon_bell():
    """消息中心入口：铃铛"""
    img, d = canvas()
    # 顶部挂钩
    d.arc([sc(21.5), sc(3), sc(26.5), sc(8)], start=180, end=360,
          fill=INK, width=int(round(W * SS)))
    # 钟身穹顶：椭圆上半
    d.arc([sc(13), sc(9), sc(35), sc(31)], start=180, end=360,
          fill=INK, width=int(round(W * SS)))
    # 两侧竖壁
    line(d, 13, 20, 13, 29)
    line(d, 35, 20, 35, 29)
    # 裙边横线
    line(d, 9, 29, 39, 29, width=W + 0.1)
    # 底部铃锤
    d.arc([sc(20.5), sc(29), sc(27.5), sc(36)], start=0, end=180,
          fill=INK, width=int(round(W * SS)))
    save(img, 'icon-bell.png')


def icon_check():
    """通知类型：勾选框"""
    img, d = canvas()
    rect(d, 10, 10, 38, 38, radius=2)
    line(d, 17, 24, 22, 30, width=W + 0.2)
    line(d, 22, 30, 31, 18, width=W + 0.2)
    save(img, 'icon-msg-check.png')


def icon_alert():
    """通知类型：感叹号"""
    img, d = canvas()
    ellipse(d, 24, 24, 14, 14)
    line(d, 24, 16.5, 24, 27)
    d.ellipse([sc(22.8), sc(30), sc(25.2), sc(32.4)], fill=INK)
    save(img, 'icon-msg-alert.png')


def icon_shield():
    """通知类型：盾牌"""
    img, d = canvas()
    poly(d, [(24, 7), (39, 13), (39, 25), (24, 41), (9, 25), (9, 13)], width=W)
    save(img, 'icon-msg-shield.png')


def icon_broom():
    """一键已读：清扫"""
    img, d = canvas()
    # 扫帚杆（右上到左下）
    line(d, 33, 7, 19, 27, width=W + 0.1)
    # 刷头连接段
    line(d, 19, 27, 13, 33, width=W + 0.1)
    # 刷头：横杆 + 三束刷毛
    line(d, 8, 33, 18, 33, width=W + 0.2)
    for i in range(4):
        x = 9 + i * 3
        line(d, x, 34, x - 1.6, 41, width=W - 0.2)
    # 扫过的痕
    line(d, 6, 43, 20, 43, width=W - 0.4)
    save(img, 'icon-broom.png')


def icon_trash():
    """清空全部：垃圾桶"""
    img, d = canvas()
    line(d, 9, 13, 39, 13, width=W)               # 顶盖
    line(d, 19, 13, 20, 9, width=W)               # 盖柄左
    line(d, 29, 13, 28, 9, width=W)               # 盖柄右
    line(d, 20, 9, 28, 9, width=W)                # 盖柄横
    poly(d, [(13, 13), (35, 13), (33, 40), (15, 40)], width=W)   # 桶身
    line(d, 21, 19, 21, 34, width=W - 0.2)        # 内竖线
    line(d, 27, 19, 27, 34, width=W - 0.2)
    save(img, 'icon-trash.png')


def icon_gear_alt():
    """设置入口备选：双线滑块（用户原话「双线」按钮）"""
    img, d = canvas()
    line(d, 9, 17, 39, 17, width=W)
    line(d, 9, 31, 39, 31, width=W)
    d.ellipse([sc(15), sc(14.5), sc(21), sc(19.5)], fill=INK)
    d.ellipse([sc(27), sc(28.5), sc(33), sc(33.5)], fill=INK)
    save(img, 'icon-sliders.png')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    print('生成图标 ->', OUT)
    icon_gear()
    icon_bell()
    icon_check()
    icon_alert()
    icon_shield()
    icon_broom()
    icon_trash()
    icon_gear_alt()
    print('完成')
