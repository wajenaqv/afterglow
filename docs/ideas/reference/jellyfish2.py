"""jellyfish2.py - a great bioluminescent jellyfish, a bell 60 cm across trailing a
veil of 160 tentacles and four ruffled oral arms, rising through the deep sea.
Drawn with ASCII characters and rendered straight to a 1080x1920 video for Reels.

    python jellyfish2.py                     -> jellyfish2.mp4
    python jellyfish2.py out.mp4             -> custom output name
    python jellyfish2.py --still 10 a.png    -> one frame at t=10s
    python jellyfish2.py --stills 2,9,13 dir -> several frames into a folder
"""
import math, os, re, shutil, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

W, H, FPS, DUR = 1080, 1920, 30, 20.0
TAU = math.tau
rng = np.random.default_rng(11)

CW, CH = 10, 16
COLS, ROWS = W // CW, 75
GY0, GH = 140, 75 * 16
SX0, SY0 = W / 2, GY0 + GH / 2


def font(names, size):
    for name in names:
        for d in ("C:/Windows/Fonts", "/usr/share/fonts/truetype/dejavu", "/Library/Fonts"):
            p = os.path.join(d, name)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


MONO = ["consola.ttf", "DejaVuSansMono.ttf", "Menlo.ttc"]
F_GRID, F_UI, F_CODE = font(MONO, 16), font(MONO, 26), font(MONO, 21)


def hash01(a, b, c=0.0):                  # cheap deterministic noise in [0, 1)
    v = np.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453
    return v - np.floor(v)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def key(frames, t):                       # eased keyframes [(time, value), ...]
    if t <= frames[0][0]:
        return frames[0][1]
    for (t0, v0), (t1, v1) in zip(frames, frames[1:]):
        if t < t1:
            return v0 + (v1 - v0) * float(smooth((t - t0) / (t1 - t0)))
    return frames[-1][1]


# --- water: 800 m down no sunlight is left; every photon here is made by an animal
BG_TOP, BG_BOT = np.array([3.0, 9.0, 21.0]), np.array([0.0, 2.0, 6.0])
BLUE = np.array([0.2, 0.58, 1.0])          # coelenterazine light, about 470 nm
CYAN = np.array([0.3, 0.86, 1.0])
GREEN = np.array([0.42, 1.0, 0.55])        # green fluorescent protein, 509 nm
CLEAR = np.array([0.62, 0.74, 0.95])       # clear jelly: seen only by the light it scatters
FRILL = np.array([0.95, 0.86, 0.92])
MASS = np.array([1.0, 0.72, 0.78])          # stomach and gonads: denser, milky
GUT = np.array([0.8, 0.12, 0.32])          # red pigment: nearly black under blue light
AMB = np.array([0.02, 0.03, 0.05])
ABSORB = np.array([1 / 900, 1 / 2600, 1 / 6000])   # per unit of depth: water eats red first


def water(Z):
    return np.exp(-np.maximum(Z - 1000, 0)[:, None] * ABSORB)


def orient(P, spin, roll, pitch):          # local body frame -> world (y is up)
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    cs, ss = np.cos(spin), np.sin(spin)
    x, z = x * cs + z * ss, -x * ss + z * cs
    cr, sr = np.cos(roll), np.sin(roll)
    x, y = x * cr - y * sr, x * sr + y * cr
    cp, sp = np.cos(pitch), np.sin(pitch)
    y, z = y * cp - z * sp, y * sp + z * cp
    return np.stack([x, y, z], -1)


# --- time: each animal's swim is integrated once on a fine clock
DT = 1 / 240
TT = np.arange(-14.0, DUR + 1.0, DT)


def pulses(t_first, period, r):
    p = t_first - period * math.ceil((t_first + 14) / period)
    out = []
    while p < DUR + 1:
        out.append(p)
        p += period * r.uniform(0.92, 1.08)
    return np.array(out)


# --- pulse: a quick squeeze of the bell, then a long slow relax as it refills with water
def contraction(ps):
    i = np.clip(np.searchsorted(ps, TT, "right") - 1, 0, len(ps) - 1)
    ph = TT - ps[i]
    gap = np.diff(np.append(ps, ps[-1] + 10))[i]
    up = 0.45
    rel = np.minimum(1.6, (gap - up) * 0.9)
    c = np.where(ph < up, smooth(ph / up), 1 - smooth((ph - up) / rel))
    return np.where(TT < ps[0], 0.0, c)


def thrust(ps):                            # each squeeze jets the bell forward, then it coasts
    v = np.zeros_like(TT)
    for p in ps:
        ph = np.maximum(TT - p, 0)
        v += (ph / 0.45) * np.exp(1 - ph / 0.45)
    return v


def make_jelly(seed, X0, Y0, Z, R, Hb, period, t_first, step, roll0, ntent, tent_L, oral_L, glow,
               pm=1.72, pitch=-0.06, NP=64, NA=200, n_t=110, n_o=90, alb=0.1, lum=1.0, on=((0, 1.0),),
               lappets=32, sink=-6.0, hero=False, clusters=0, n_oral=4, oral_w=0.3,
               fill=1.0, fan=1.0, tk=1.0):
    r = np.random.default_rng(seed)
    ps = pulses(t_first, period, r)
    q = r.uniform(0, TAU, 6)
    roll = roll0 + 0.07 * np.sin(0.21 * TT + q[0]) + 0.04 * np.sin(0.53 * TT + q[1])
    V = step / 1.223 * thrust(ps)                # each pulse carries the bell about `step` along its axis
    X = np.cumsum(-V * np.sin(roll)) * DT
    Y = np.cumsum(V * np.cos(roll) + sink) * DT
    X += X0 - np.interp(0.0, TT, X)
    Y += Y0 - np.interp(0.0, TT, Y)
    J = dict(ps=ps, C=contraction(ps), X=X, Y=Y, Z=float(Z), R=R, Hb=Hb, pm=pm, pitch=pitch, roll=roll,
             spin=0.035 * TT + q[2], lead=q[3], wob=q[4:6], glow=glow, alb=alb, lum=lum, on=on,
             lappets=lappets, n_t=n_t, n_o=n_o, hero=hero, oral_w=oral_w, fill=fill, fan=fan, tk=tk)
    J["PHI"] = np.linspace(0.02, pm, NP)[:, None] + r.uniform(-0.25, 0.25, (NP, NA)) * pm / NP
    J["TH"] = (np.arange(NA)[None, :] + 0.5 + r.uniform(-0.25, 0.25, (NP, NA))) * TAU / NA
    J["SPOT"] = r.random((NP, NA))
    # tentacles grow from the clefts between the lappets; a big animal carries them in eight
    # dense bundles, rows deep, hanging from just inside the rim
    if clusters:
        k = r.integers(clusters, size=ntent)
        th = (k + 0.5) * TAU / clusters + r.uniform(-1, 1, ntent) * 0.42 * TAU / clusters / 2
        inset = 0.97 - 0.16 * r.random(ntent) ** 1.5
    else:
        th = (r.integers(lappets, size=ntent) + 0.5) * TAU / lappets + r.normal(0, 0.02, ntent)
        inset = np.full(ntent, 0.95)
    thick = r.uniform(0.3, 0.8, ntent) * (np.where(r.random(ntent) < 0.12, 1.1, 0.45) if clusters else 1.0)
    amp = r.uniform(0.06, 0.16, ntent) * (1.7 if clusters else 1.0)
    J["TENT"] = [(th[i], r.uniform(*tent_L), r.uniform(0, TAU), thick[i], amp[i],
                  r.uniform(0, 1) ** 2, inset[i]) for i in range(ntent)]
    J["ORAL"] = [(k * TAU / n_oral + TAU / 8 + r.normal(0, 0.1), oral_L * r.uniform(0.8, 1.15), r.uniform(0, TAU))
                 for k in range(n_oral)]
    if hero:                                     # the stomach and folded gonads, a denser mass under the crown
        a_, b_ = np.meshgrid(np.linspace(0.05, 2.7, 40), np.linspace(0, TAU, 120, endpoint=False), indexing="ij")
        J["CM"] = (a_ + r.uniform(-0.02, 0.02, a_.shape), b_ + r.uniform(-0.03, 0.03, b_.shape))
    return J


def at(J, k, t):
    return np.interp(t, TT, J[k])


def axis(J, tau):                          # the way the crown points, i.e. the way it swims
    rl, p = at(J, "roll", tau), J["pitch"]
    return np.stack([-np.sin(rl), np.cos(rl) * np.cos(p), np.cos(rl) * np.sin(p)], -1)


def wake(J):                               # strands stream back along the swim and sag a little
    def f(tau):
        w = -0.75 * axis(J, tau) + np.array([0.0, -0.45, 0.0])
        return w / np.linalg.norm(w, axis=-1, keepdims=True)
    return f


def bell_shape(J, phi, th, c, tt):
    R, Hb, pm = J["R"], J["Hb"], J["pm"]
    u = phi / pm
    w1, w2 = J["wob"]
    soft = 1 + 0.025 * np.sin(2 * th + 0.6 * tt + w1) + 0.015 * np.sin(3 * th - 0.45 * tt + w2)   # never quite round
    groove = 1 - 0.03 * np.exp(-(np.sin(4 * th) / 0.18) ** 2) * u ** 1.5    # eight shallow radial grooves
    rho = R * np.sin(phi) * soft * groove * (1 - 0.2 * c * u ** 2)
    y = Hb * np.cos(phi) * (1 + 0.1 * c) * (2 - soft)
    # the thin rim lags the squeeze: it tucks in, then flares out as the bell relaxes
    rim = np.clip((u - 0.8) / 0.2, 0, None) ** 2
    rho = rho + R * rim * (0.09 * (1 - c) - 0.05 * c + 0.02 * np.sin(3 * th - 1.7 * tt))
    return rho, y - R * rim * (0.05 + 0.04 * c)


def lappet_edge(J, th):                    # the rim is cut into rounded lappets
    return 1 - 0.06 * (1 - np.sqrt(np.abs(np.cos(J["lappets"] * th / 2))))


def body_root(J, local):                   # a point fixed on the body, tracked back in time
    def f(tau):
        c = at(J, "C", tau)
        P = orient(local(c, tau), at(J, "spin", tau), at(J, "roll", tau), J["pitch"])
        return P + np.stack([at(J, "X", tau), at(J, "Y", tau), np.full_like(tau, J["Z"])], -1)
    return f


def margin(J, th0, inset=0.95):
    def local(c, tau):
        rho, y = bell_shape(J, J["pm"] * inset, th0, c, tau)
        return np.stack([rho * np.cos(th0), y, rho * np.sin(th0)], -1)
    return local


def trail(root, wake_fn, t, L, lag, n_out, amp=0.06, ph=0.0, curl=0.0):
    # a strand follows the path its root took a moment ago, then drifts with the water
    s = np.linspace(0, 1.4, 120)
    tau = t - s * L / lag
    P = root(tau) + (0.75 * s * L)[:, None] * wake_fn(tau)
    sw = amp * L * s ** 1.3
    P[:, 0] += sw * np.sin(TAU * 1.2 * s - 0.9 * t + ph) + 0.045 * L * s * np.sin(TAU * 3.5 * s - 1.7 * t + 3 * ph)
    P[:, 1] += 0.5 * sw * np.sin(TAU * 0.9 * s - 0.7 * t + 2 * ph)
    P[:, 2] += sw * np.cos(TAU * 1.0 * s - 0.8 * t + 2 * ph)
    if curl:                                   # loose tips coil into lazy spirals
        k = curl * 0.06 * L * np.clip((s - 0.7) / 0.6, 0, 1) ** 2
        P[:, 0] += k * np.cos(TAU * 4 * s - 1.3 * t + ph)
        P[:, 1] += k * np.sin(TAU * 4 * s - 1.3 * t + ph)
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    u = np.linspace(0, min(L, cum[-1]), n_out)          # keep the strand's true length
    return np.stack([np.interp(u, cum, P[:, k]) for k in range(3)], -1), u


def strand(Q):
    T = np.gradient(Q, axis=0)
    return np.linalg.norm(T, axis=1), np.arctan2(T[:, 1], T[:, 0])


# --- alarm: brushed by the comb jelly, it answers in waves of light
FLASH = [(12.0 + 0.55 * k, 0.8 ** k) for k in range(6)]


def alarm(t):
    return float(smooth((t - 11.9) / 0.3) * (1 - smooth((t - 14.2) / 1.4)))


def jelly(J, t, cam):
    c, spin, roll, pitch = float(at(J, "C", t)), float(at(J, "spin", t)), float(at(J, "roll", t)), J["pitch"]
    ctr = np.array([at(J, "X", t), at(J, "Y", t), J["Z"]])
    eye = np.array([cam[0], cam[1], 0.0])
    on = key(J["on"], t) * J["lum"]
    R, pm, hero = J["R"], J["pm"], J["hero"]
    crisp = 1.0 if J["Z"] < 2500 else 0.0
    out = []

    # --- bell: a soft dome of jelly, thick and milky at the crown, thin as glass at the rim
    phi, th = J["PHI"], J["TH"]
    ct = at(J, "C", t - 0.07 * (1 + np.cos(th - J["lead"])))     # the squeeze starts on one side
    rho, y = bell_shape(J, phi, th, ct, t)
    Pl = np.stack([rho * np.cos(th), y, rho * np.sin(th)], -1)
    nl = np.cross(0.5 * (np.roll(Pl, -1, 1) - np.roll(Pl, 1, 1)), np.gradient(Pl, axis=0))
    area = np.linalg.norm(nl, axis=-1)
    u = phi / pm
    keep = u <= lappet_edge(J, th)
    P = orient(Pl, spin, roll, pitch) + ctr
    n = orient(nl, spin, roll, pitch) / np.maximum(area, 1e-9)[..., None]
    v = eye - P
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    g = np.clip(1 / np.maximum(np.abs((n * v).sum(-1)), 0.16), 1, 6.0)   # path length through the jelly
    stripe = np.exp(-(np.sin(8 * th) / 0.16) ** 2)                       # sixteen radial bands
    alb = J["alb"] * (0.45 + 1.2 * (1 - u) ** 2) * (0.85 + 0.4 * stripe) * keep * (g / 2.5) ** (1.2 * hero)
    out.append(dict(kind="tissue", geom="area", P=P.reshape(-1, 3), m=(area * alb).ravel(),
                    col=CLEAR))

    # --- glow: the light lives in the tissue itself; every beat sends a ring of it from crown to rim
    def level(u, th, phi):
        lv = 0.22 * (0.7 + 0.6 * c)
        for p in J["ps"]:
            w = (t - p) / 0.8
            if -0.1 < w < 1.4:
                lv = lv + 0.7 * np.exp(-((u - w) / 0.12) ** 2)
        if hero:                                 # alarm: rings spread from where it was touched
            for F, a in FLASH:
                if 0 < t - F < 1.6:
                    d = R * np.hypot((1 - u) * pm, ((th - spin + np.pi) % TAU - np.pi) * np.sin(phi))
                    lv = lv + 1.4 * a * np.exp(-((d - 380 * (t - F)) / 40) ** 2)
        return lv
    lvl = level(u, th, phi)
    spots = 0.5 + 1.6 * (J["SPOT"] > 0.94) * (0.6 + 0.4 * np.sin(1.7 * t + 40 * J["SPOT"]))
    out.append(dict(kind="emit", geom="area", P=P.reshape(-1, 3), col=J["glow"],
                    m=(area * keep * spots * lvl * 0.08 * J["fill"] * (g / 2.0) ** (1.8 * hero) * on).ravel()))
    if hero:                                     # sixteen radial canals carry food, and light, out to the rim
        thc = ((np.arange(16) + 0.5) * TAU / 16)[None, :]
        phc = np.linspace(0.2, pm * 0.93, 80)[:, None] + 0 * thc
        rr, yy = bell_shape(J, phc, thc, at(J, "C", t - 0.07 * (1 + np.cos(thc - J["lead"]))), t)
        Pk = orient(np.stack([rr * np.cos(thc), yy, rr * np.sin(thc)], -1), spin, roll, pitch) + ctr
        T = np.gradient(Pk, axis=0)
        lc = level(phc / pm, thc + 0 * phc, phc)
        out.append(dict(kind="emit", geom="line", P=Pk.reshape(-1, 3), col=J["glow"], line=0.0,
                        m=(np.linalg.norm(T, axis=-1) * lc * 1.0 * on).ravel(),
                        ang=np.arctan2(T[..., 1], T[..., 0]).ravel()))
    # the ring canal glows softly all round the rim, with eight sense organs as brighter specks
    thm = np.linspace(0, TAU, 180, endpoint=False)
    rr, yy = bell_shape(J, pm * 0.93, thm, c, t)
    Pm = orient(np.stack([rr * np.cos(thm), yy, rr * np.sin(thm)], -1), spin, roll, pitch) + ctr
    rim = (0.12 + 0.4 * hero) * (0.7 + 0.6 * c) + 1.5 * alarm(t) * hero
    out.append(dict(kind="emit", geom="line", P=Pm, col=J.get("rimc", J["glow"]), m=np.full(len(thm), TAU * R / 180 * rim * on),
                    line=(0.6 + 0.4 * hero) * crisp, ang=np.arctan2(np.gradient(Pm[:, 1]), np.gradient(Pm[:, 0]))))
    thr = (np.arange(8) * 4 + 0.5) * TAU / J["lappets"]
    rr, yy = bell_shape(J, pm * 0.95, thr, c, t)
    Pr = orient(np.stack([rr * np.cos(thr), yy, rr * np.sin(thr)], -1), spin, roll, pitch) + ctr
    out.append(dict(kind="emit", geom="point", P=Pr, col=J.get("rimc", CYAN), m=(0.35 + 0.5 * hero) * on * (0.8 + 0.4 * c) * np.ones(8)))

    if hero:                                     # stomach and gonads: a folded, glowing mass inside the bell
        a_, b_ = J["CM"]
        lobe = np.abs(np.sin(2 * b_)) ** 0.7                            # four gonads, a clover seen from below
        fold = (0.55 + 0.6 * lobe + 0.12 * np.abs(np.sin(9 * b_ + 0.3 * np.sin(3 * a_))) ** 0.6
                + 0.06 * np.sin(13 * b_ + 9 * a_ - 0.8 * t) * np.sin(6 * a_))
        rr = 0.42 * R * np.sin(a_) * fold * (1 - 0.1 * c)
        yy = J["Hb"] * (0.38 + 0.36 * np.cos(a_)) * (1 + 0.08 * c)
        Pc = (orient(np.stack([rr * np.cos(b_), yy, rr * np.sin(b_)], -1), spin, roll, pitch) + ctr).reshape(-1, 3)
        each = 2.4 * (0.4 * R) ** 2 / a_.size
        out.append(dict(kind="tissue", geom="area", P=Pc, col=MASS, m=0.3 * each))
        core = ((0.45 + 0.5 * c + float(np.mean(lvl))) * (0.25 + 0.9 * lobe)
                * (0.7 + 0.6 * (np.sin(13 * b_ + 9 * a_) > 0.6))).ravel()
        out.append(dict(kind="emit", geom="area", P=Pc, col=np.array([0.45, 0.82, 1.0]), m=0.4 * each * core * on))

    # --- tentacles: long and fine, they stream back along the swim and coil at the tips
    launch = [(p + 0.4, 0.35) for p in J["ps"] if t - 3 < p + 0.4 <= t]
    if hero:
        launch += [(F + 0.15, 1.2 * a) for F, a in FLASH if t - 3 < F + 0.15 <= t]
    for th0, L, ph, thick, amp, curl, inset in J["TENT"]:
        out_dir = orient(np.array([math.cos(th0), 0.0, math.sin(th0)]), spin, roll, pitch)
        fan = (0.25 + 0.35 * float(hash01(th0, 7.0))) * J["fan"] * (0.4 + 0.6 * (inset - 0.8) / 0.17)   # inner rows hang straighter
        def wk(tau, d=out_dir, f=fan):
            w = wake(J)(tau) + f * d
            return w / np.linalg.norm(w, axis=-1, keepdims=True)
        lag = 280.0 + 160.0 * float(hash01(th0, 3.0))
        Q, uu = trail(body_root(J, margin(J, th0, inset)), wk, t, L, lag, J["n_t"], amp=amp, ph=ph, curl=curl)
        seg, ang = strand(Q)
        tis = seg * thick * (1 - 0.5 * uu / L)
        out.append(dict(kind="tissue", geom="line", P=Q, m=J["tk"] * 0.45 * tis, col=CLEAR, line=crisp, ang=ang))
        glow = J["tk"] * 0.1 * np.exp(-uu / (1400 + 1200 * hero)) + sum(a * np.exp(-((uu - (t - tl) * 600) / 35) ** 2)
                                            for tl, a in launch) * np.exp(-uu / 900)
        if hero and 11.5 < t < 12.0 and math.cos(th0 - spin) > 0.3:     # the touch runs up the tentacles
            glow = glow + 1.2 * np.exp(-((uu - 0.55 * L * (12.0 - t) / 0.5) / 35) ** 2)
        out.append(dict(kind="emit", geom="line", P=Q, m=tis * glow * on, col=J["glow"], line=crisp, ang=ang))

    # --- oral arms: four long frilled curtains, the heaviest part of the animal
    for th0, L, ph in J["ORAL"]:
        local = lambda c, tau, th0=th0: np.stack([0 * c + 0.1 * R * np.cos(th0), 0 * c + 0.12 * J["Hb"],
                                                  0 * c + 0.1 * R * np.sin(th0)], -1)
        Q, uu = trail(body_root(J, local), wake(J), t, L, 230.0, J["n_o"], amp=0.04 + 0.04 * hero, ph=ph)
        Q = Q + ((0.2 - 0.06 * hero) * uu)[:, None] * orient(np.array([math.cos(th0), 0.0, math.sin(th0)]), spin, roll, pitch)
        T = np.gradient(Q, axis=0)
        seg = np.linalg.norm(T, axis=1)
        Th = T / np.maximum(seg, 1e-9)[:, None]
        psi = th0 + spin + TAU * 1.0 * uu / L + 0.3 * np.sin(0.8 * t + th0)    # each curtain twists down its length
        d = np.stack([np.cos(psi), 0 * psi, np.sin(psi)], -1)
        d -= (d * Th).sum(-1, keepdims=True) * Th
        d /= np.maximum(np.linalg.norm(d, axis=-1, keepdims=True), 1e-9)
        nrm = np.cross(Th, d)
        wid = R * J["oral_w"] * (1 - 0.6 * uu / L) * (1 + 0.15 * np.sin(TAU * 2.3 * uu / L + th0)) + 8
        nk = 9 if len(uu) < 120 else 17
        kk = np.linspace(-1, 1, nk)[:, None]
        crk = R * (0.1 * np.abs(kk) ** 1.3 * np.sin(TAU * (12 * uu / L + 0.4 * kk) - 1.6 * t + th0)
                   + 0.035 * np.sin(TAU * 37 * uu / L + 5 * kk + th0))         # ruffled, crinkled edges
        Pg = Q[None] + (kk * wid)[..., None] * d[None] + crk[..., None] * nrm[None]
        Pf = Pg.reshape(-1, 3)
        mm = np.broadcast_to(seg * wid * 2 / nk, (nk, len(uu)))
        if hero:                                 # folds seen edge-on look brightest: the curtain reads as lace
            nf = np.cross(np.gradient(Pg, axis=0), np.gradient(Pg, axis=1))
            vf = eye - Pg
            cosv = np.abs((nf * vf).sum(-1)) / np.maximum(np.linalg.norm(nf, axis=-1) * np.linalg.norm(vf, axis=-1), 1e-9)
            mm = mm * (np.clip(1 / np.maximum(cosv, 0.2), 1, 4) / 2.0) ** 1.5 * (0.3 + 0.7 * smooth(uu / 400))
        out.append(dict(kind="tissue", geom="area", P=Pf, col=FRILL, m=(0.3 * mm).ravel(), frill=True))
        wave = sum(np.exp(-((uu - (t - p - 0.5) * 300) / 60) ** 2) for p in J["ps"] if 0 < t - p - 0.5 < 4)
        edge = np.where(np.abs(kk) > 0.6, 1.0, 0.25 * hero)
        em = edge * (0.05 + 0.11 * hero + 0.3 * wave + 0.45 * alarm(t) * hero) * np.exp(-uu / (1200 + 1300 * hero))
        ec = np.where(np.abs(kk)[..., None] > 0.6, ARM_EDGE, J["glow"]) if hero else J["glow"]
        out.append(dict(kind="emit", geom="area", P=Pf, col=np.broadcast_to(ec, (nk, len(uu), 3)).reshape(-1, 3) if hero else ec,
                        m=(0.03 * mm * em * on).ravel()))
    return out


RIM_GFP = np.array([0.35, 1.0, 0.72])       # aequorin's blue light, re-emitted green by GFP round the rim
ARM_EDGE = np.array([0.4, 0.92, 0.95])      # the frilled lips of the oral arms carry a little GFP too
HERO = make_jelly(1, X0=0, Y0=0, Z=1400, R=300, Hb=205, pm=1.62, alb=0.3, period=2.7, t_first=0.8, step=95,
                  roll0=0.24, pitch=0.24, ntent=160, clusters=8, tent_L=(800, 1700), oral_L=1500, oral_w=0.6, fill=0.3, fan=0.55, tk=0.7,
                  NP=96, NA=360, n_t=150, n_o=260, glow=np.array([0.25, 0.7, 1.0]), hero=True,
                  on=((0, 0.55), (2.8, 1.0), (17.0, 1.0), (19.8, 0.85)))
HERO["rimc"] = RIM_GFP

# --- camera: an ROV hovers in the water and keeps the jelly in frame
def follow(X, k=1.6):
    out = np.empty_like(X)
    out[0] = X[0]
    for i in range(1, len(X)):
        out[i] = out[i - 1] + DT / k * (X[i] - out[i - 1])
    return out


CAMX, CAMY = follow(HERO["X"]), follow(HERO["Y"])
_w = (TT >= 0) & (TT <= DUR)
CAMX += (HERO["X"] - CAMX)[_w].mean()             # the bell fills the top of the frame, its veil the rest
CAMY += (HERO["Y"] - CAMY)[_w].mean() - 245


def camera(t):
    f = 1400 + 60 * float(smooth(t / DUR))            # a very slow push in
    return (float(np.interp(t, TT, CAMX)) + 6 * math.sin(0.7 * t),
            float(np.interp(t, TT, CAMY)) + 5 * math.sin(0.53 * t + 1), f)


def place(sx, sy, Z):                      # where a far jelly starts, in screen terms
    return dict(X0=np.interp(0, TT, CAMX) + (sx - SX0) * Z / 1400, Y0=np.interp(0, TT, CAMY) - (sy - SY0) * Z / 1400, Z=Z)


BACK = [
    make_jelly(2, **place(190, 1000, 3000), R=150, Hb=125, period=2.2, t_first=0.4, step=95, roll0=0.3,
               ntent=14, tent_L=(350, 600), oral_L=380, glow=BLUE, NP=26, NA=80, n_t=50, n_o=40, lum=1.3),
    # a crystal jelly: a flat bell, dozens of short tentacles, a green-glowing rim
    make_jelly(3, **place(880, 330, 4800), R=200, Hb=110, period=2.6, t_first=1.3, step=90, roll0=0.5, pm=1.5,
               ntent=24, tent_L=(150, 260), oral_L=150, glow=GREEN, NP=22, NA=80, n_t=24, n_o=24, lum=1.4),
    make_jelly(4, **place(170, 380, 7000), R=200, Hb=165, period=2.0, t_first=0.2, step=100, roll0=0.35,
               ntent=10, tent_L=(400, 700), oral_L=400, glow=BLUE, NP=20, NA=60, n_t=36, n_o=30, lum=2.0),
]
JELLIES = [HERO] + BACK


# --- comb: a comb jelly glides past; its beating cilia split the light into rainbows
COMB_T = (5.8, 19.0)


def comb_center(tau):
    s = tau - COMB_T[0]
    f = 1400 + 60 * smooth(tau / DUR)
    sx, sy = 1160 - 74 * s, 880 - 10 * s + 18 * np.sin(0.8 * s)
    Z = 1150.0
    return np.stack([np.interp(tau, TT, CAMX) + (sx - SX0) * Z / f,
                     np.interp(tau, TT, CAMY) - (sy - SY0) * Z / f, np.full_like(s, Z)], -1)


def hsv(h):
    k = (np.array([0, 4, 2])[None, :] + h[:, None] * 6) % 6
    return 1 - 0.85 * np.clip(np.minimum(k, 4 - k), 0, 1)


def comb(t):
    if not COMB_T[0] < t < COMB_T[1]:
        return []
    ctr = comb_center(np.array([t]))[0]
    spin, roll, pitch = 0.6 * t, -(np.pi / 2 + 0.22) + 0.06 * math.sin(1.1 * t), 0.35
    a, b = 80.0, 58.0
    ph = np.linspace(0.05, np.pi - 0.05, 40)[:, None]
    th = np.linspace(0, TAU, 72, endpoint=False)[None, :]
    Pl = np.stack([b * np.sin(ph) * np.cos(th), a * np.cos(ph) + 0 * th, b * np.sin(ph) * np.sin(th)], -1)
    nl = np.stack([np.sin(ph) * np.cos(th) / b, np.cos(ph) / a + 0 * th, np.sin(ph) * np.sin(th) / b], -1)
    nl /= np.linalg.norm(nl, axis=-1, keepdims=True)
    P = orient(Pl, spin, roll, pitch) + ctr
    n = orient(nl, spin, roll, pitch)
    g = np.clip(1 / np.maximum(np.abs(n[..., 2]), 0.15), 1, 5.5)
    area = a * b * np.sin(ph) * (np.pi / 40) * (TAU / 72) + 0 * th
    out = [dict(kind="tissue", geom="area", P=P.reshape(-1, 3), m=(0.12 * area * g ** 1.3).ravel(), col=CLEAR,
                lift=0.05)]
    # eight comb rows; a beat runs down each row and the colour runs with it
    j = np.arange(8)[None, :]
    pr = np.linspace(0.3, 2.75, 44)[:, None]
    thr = j * TAU / 8
    Pr = orient(np.stack([1.03 * b * np.sin(pr) * np.cos(thr), 1.03 * a * np.cos(pr) + 0 * thr,
                          1.03 * b * np.sin(pr) * np.sin(thr)], -1), spin, roll, pitch) + ctr
    T = np.gradient(Pr, axis=0)
    q = 3.2 * pr - 5.5 * t + 0.8 * j
    beat = 0.2 + 0.8 * (0.5 + 0.5 * np.sin(q)) ** 3
    hue = (q / TAU * 0.35 + 0.12 * j + 0.1 * t) % 1
    out.append(dict(kind="tissue", geom="line", P=Pr.reshape(-1, 3), col=hsv(hue.ravel()), lift=0.6,
                    m=(2.2 * np.linalg.norm(T, axis=-1) * beat).ravel(), line=0.7,
                    ang=np.arctan2(T[..., 1], T[..., 0]).ravel()))
    out.append(dict(kind="emit", geom="line", P=Pr.reshape(-1, 3), col=np.array([0.3, 1.0, 0.85]),
                    m=(0.12 * np.linalg.norm(T, axis=-1) * beat).ravel()))     # its own faint blue-green glow
    # two long tentacles stream out behind it
    for side in (-1, 1):
        def root(tau, side=side):
            Pl = np.array([side * b * 0.9, -0.1 * a, 0.0])
            return orient(Pl, 0.6 * tau, -(np.pi / 2 + 0.22), 0.35) + comb_center(np.atleast_1d(tau))
        Q, u = trail(root, lambda tau: np.tile([0.99, -0.12, 0.0], (len(tau), 1)), t, 420, 300.0, 70,
                     amp=0.05, ph=side)
        seg, ang = strand(Q)
        out.append(dict(kind="tissue", geom="line", P=Q, m=0.5 * seg * (1 - 0.5 * u / 420), col=CLEAR,
                        line=1.0, ang=ang, lift=0.05))
    return out


# --- sparks: plankton that the jelly brushes against flash for a moment
def make_sparks():
    r = np.random.default_rng(5)
    T0, P = [], []
    def along(t0, lo, hi, spread):           # somewhere in the trailing tentacles
        k = len(t0)
        base = np.stack([at(HERO, "X", t0), at(HERO, "Y", t0), np.full(k, 1400.0)], -1)
        return base + wake(HERO)(t0) * r.uniform(lo, hi, k)[:, None] + r.normal(0, spread, (k, 3)) * [1, 1, 0.6]
    n = 120                                  # stirred up along the tentacles as the jelly swims
    t0 = r.uniform(1.0, DUR, n)
    T0.append(t0)
    P.append(along(t0, 150, 1000, 90))
    ta = r.uniform(11.8, 15.6, 900)          # the alarm sheds clouds of glowing mucus
    ta = ta[r.random(900) < np.array([alarm(x) for x in ta])][:280]
    T0.append(ta)
    P.append(along(ta, 0, 900, 120))
    n = 50                                   # far away, other animals answer
    t0 = r.uniform(0, DUR, n)
    Zf = r.uniform(2500, 7500, n)
    T0.append(t0)
    P.append(np.stack([np.interp(t0, TT, CAMX) + r.uniform(-0.5, 0.5, n) * W * Zf / 1400,
                       np.interp(t0, TT, CAMY) + r.uniform(-0.5, 0.5, n) * GH * Zf / 1400, Zf], -1))
    T0 = np.concatenate(T0)
    m = len(T0)
    return dict(t0=T0, P=np.concatenate(P), v=r.normal(0, 6, (m, 3)) + np.array([0, -4.0, 0]),
                I=r.uniform(0.6, 2.4, m), tau=r.uniform(0.18, 0.6, m),
                col=np.array([BLUE, CYAN, np.array([0.3, 1.0, 0.8])])[r.integers(0, 3, m)])


SPK = make_sparks()


def sparks(t):
    a = t - SPK["t0"]
    m = (a > 0) & (a < SPK["tau"] * 6)
    if not m.any():
        return []
    I = SPK["I"][m] * smooth(a[m] / 0.05) * np.exp(-a[m] / SPK["tau"][m])
    return [dict(kind="emit", geom="point", P=SPK["P"][m] + SPK["v"][m] * a[m, None], m=I, col=SPK["col"][m])]


# --- snow: marine snow, flakes of dead plankton drifting down forever
N_SNOW = 1700
SN_Z = 380 + 7600 * rng.random(N_SNOW) ** 0.8
SN_V = rng.uniform(4, 14, N_SNOW)
_hh, _hw = 0.55 * GH * SN_Z / 1400, 0.55 * W * SN_Z / 1400
SN_X = rng.uniform(-1, 1, N_SNOW) * _hw
SN_Y = rng.uniform(np.interp(0, TT, CAMY) - _hh, np.interp(DUR, TT, CAMY) + _hh + DUR * SN_V)
SN_PH = rng.uniform(0, TAU, N_SNOW)
SN_B = rng.uniform(0.25, 1.0, N_SNOW) ** 2
SN_CH = rng.choice(list(".'`,.:"), N_SNOW)


def snow(t):
    X = SN_X + 4 * np.sin(0.4 * t + SN_PH)
    Y = SN_Y - SN_V * t + 3 * np.cos(0.5 * t + 2 * SN_PH)
    return np.stack([X, Y, SN_Z], -1)


# --- light: every glowing thing lights the water and the tissue around it
def gk(n, cell, sig):
    i = np.arange(n) * cell
    return np.exp(-((i[:, None] - i[None, :]) / sig) ** 2 / 2)


KR1, KC1 = gk(ROWS, CH, 55.0), gk(COLS, CW, 55.0)
KR2, KC2 = gk(ROWS, CH, 190.0), gk(COLS, CW, 190.0)
KRH, KCH = gk(ROWS, CH, 95.0), gk(COLS, CW, 95.0)
K_LIT, L_CAP, K_DIRECT, GAIN = 0.06, 0.45, 1.0, 1.5


def spread(E, KR, KC):
    return np.einsum("lk,ikc->ilc", KC, np.tensordot(KR, E, axes=(1, 0)))


class Grid:
    def __init__(self):
        n = ROWS * COLS
        self.E, self.T = np.zeros((n, 3)), np.zeros((n, 3))
        self.LW, self.C2, self.S2, self.SD, self.PT, self.FY, self.FR = (np.zeros(n) for _ in range(7))


def project(P, cam):
    s = cam[2] / np.maximum(P[:, 2], 1.0)
    return SX0 + (P[:, 0] - cam[0]) * s, SY0 - (P[:, 1] - cam[1]) * s, s


def cells(sx, sy):
    ci, ri = np.floor(sx / CW).astype(int), np.floor((sy - GY0) / CH).astype(int)
    ok = (ci >= 0) & (ci < COLS) & (ri >= 0) & (ri < ROWS)
    return ri * COLS + ci, ok


def deposit(G, lay, cam, Lf=None):
    P = lay["P"]
    N = len(P)
    sx, sy, s = project(P, cam)
    idx, ok = cells(sx, sy)
    if not ok.any():
        return
    idx, s, fy = idx[ok], s[ok], ((sy[ok] - GY0) / CH) % 1
    m = np.broadcast_to(lay["m"], (N,))[ok]
    cov = m * s * s / (CW * CH) if lay["geom"] == "area" else m * s / CH if lay["geom"] == "line" else m
    col = np.broadcast_to(lay["col"], (N, 3))[ok] * water(P[ok, 2])
    if lay["kind"] == "tissue":                          # tissue only shows by the light that reaches it
        lit = L_CAP * (1 - np.exp(-K_LIT * Lf[idx] / L_CAP))
        val, buf, kb = cov[:, None] * col * (AMB + lay.get("lift", 0.0) + lit), G.T, 1.0
    else:
        val, buf, kb = cov[:, None] * col, G.E, K_DIRECT
    nn = ROWS * COLS
    for k in range(3):
        buf[:, k] += np.bincount(idx, val[:, k], nn)
    b = val.max(1) * kb
    if lay["geom"] == "point":
        G.PT += np.bincount(idx, b, nn)
    if lay.get("frill"):
        G.FR += np.bincount(idx, b, nn)
    if "line" in lay:
        lw = b * np.broadcast_to(lay["line"], (N,))[ok]
        a2 = 2 * np.broadcast_to(lay["ang"], (N,))[ok]
        G.LW += np.bincount(idx, lw, nn)
        G.C2 += np.bincount(idx, lw * np.cos(a2), nn)
        G.S2 += np.bincount(idx, lw * np.sin(a2), nn)
        G.FY += np.bincount(idx, lw * fy, nn)
        if "side" in lay:
            G.SD += np.bincount(idx, lw * np.broadcast_to(lay["side"], (N,))[ok], nn)


RAMP = np.array(list("..··::;=+*#%"))
FR_RAMP = np.array(list(".,:;~~=*%%#@"))


def compose(t):
    cam = camera(t)
    G = Grid()
    layers = sum((jelly(J, t, cam) for J in JELLIES), []) + comb(t) + sparks(t)
    for lay in layers:
        if lay["kind"] == "emit":
            deposit(G, lay, cam)
    E = G.E.reshape(ROWS, COLS, 3)
    Lw = spread(E, KR2, KC2)
    Lf = (spread(E, KR1, KC1) + 0.06 * Lw).reshape(-1, 3)
    Lh = spread(E, KRH, KCH)
    for lay in layers:
        if lay["kind"] == "tissue":
            deposit(G, lay, cam, Lf)

    B = G.T + K_DIRECT * G.E
    bm = B.max(1)
    lum = 1 - np.exp(-GAIN * bm)
    col = B / np.maximum(bm, 1e-9)[:, None]
    chars = np.full(ROWS * COLS, " ", "<U1")
    hh = hash01(np.arange(ROWS * COLS) % COLS, np.arange(ROWS * COLS) // COLS, math.floor(t * 8))
    draw = (lum > 0.06) | ((lum > 0.015) & (hh < lum * 9))
    chars[draw] = RAMP[np.clip((lum[draw] * 12).astype(int), 0, 11)]
    fr = draw & (G.FR / np.maximum(bm, 1e-9) > 0.5)           # ruffled curtains read as crinkled texture
    chars[fr] = FR_RAMP[np.clip((lum[fr] * 12).astype(int), 0, 11)]
    lf = G.LW / np.maximum(bm, 1e-9)
    coh = np.hypot(G.C2, G.S2) / np.maximum(G.LW, 1e-9)
    ang = np.degrees(0.5 * np.arctan2(G.S2, G.C2)) % 180
    dch = np.array(["-", "/", "|", "\\"])[((ang + 22.5) // 45).astype(int) % 4]
    vert = dch == "|"
    sd = G.SD / np.maximum(G.LW, 1e-9)
    dch = np.where(vert & (sd < -0.4), "(", np.where(vert & (sd > 0.4), ")", dch))
    fy = G.FY / np.maximum(G.LW, 1e-9)
    dch = np.where(dch == "-", np.where(fy < 0.3, "'", np.where(fy > 0.68, "_", "-")), dch)
    ln = draw & (lf > 0.45) & (coh > 0.5) & (lum > 0.2)
    chars[ln] = dch[ln]
    pt = draw & (G.PT / np.maximum(bm, 1e-9) > 0.5)
    chars[pt] = np.where(lum[pt] > 0.72, "*", np.where(lum[pt] > 0.4, "+", "."))
    rgb = col * (0.1 + 0.95 * lum)[:, None] + np.clip(lum - 0.8, 0, 1)[:, None] * 2.2
    rgb = (np.clip(rgb, 0, 1) * 255).astype(int)

    # marine snow: nearly invisible, until it drifts into somebody's light
    P = snow(t)
    sx, sy, s = project(P, cam)
    idx, ok = cells(sx, sy)
    Lc = np.zeros((len(P), 3))
    Lc[ok] = Lf[idx[ok]]
    near = np.exp(-np.abs(P[:, 2] - 1400) / 1300)
    sb = SN_B * (0.05 * np.exp(-(P[:, 2] - 600) / 3500) + 0.5 * Lc.max(1) * near) \
        * (0.65 + 0.35 * np.sin(2.1 * t + 5 * SN_PH))
    scol = np.array([0.55, 0.65, 0.85]) * 0.05 + 0.5 * Lc * near[:, None]
    scol = scol / np.maximum(scol.max(1), 1e-9)[:, None] * water(P[:, 2])
    on = ok & (P[:, 2] > 760) & (sb > 0.012)
    on[on] &= chars[idx[on]] == " "
    chars[idx[on]] = SN_CH[on]
    rgb[idx[on]] = (scol[on] * np.clip(0.12 + 2.2 * sb[on], 0, 1)[:, None] * 255).astype(int)

    # flakes right in front of the lens are out of focus: soft discs, not characters
    dof = np.zeros((GH // 4, W // 4, 3))
    nr = (P[:, 2] <= 760) & (sx > -40) & (sx < W + 40) & (sy > GY0 - 40) & (sy < GY0 + GH + 40)
    xi = np.clip((sx[nr] / 4).astype(int), 0, W // 4 - 1)
    yi = np.clip(((sy[nr] - GY0) / 4).astype(int), 0, GH // 4 - 1)
    np.add.at(dof, (yi, xi), (0.35 * SN_B[nr] * (0.08 + 1.2 * Lc[nr].max(1)))[:, None] * np.array([0.5, 0.7, 1.0]))
    return chars.reshape(ROWS, COLS), rgb.reshape(ROWS, COLS, 3), Lh, dof, G


# code panel: this very file scrolls by, following what is happening on screen
SRC = open(__file__, encoding="utf-8").read().splitlines()
NAME = os.path.basename(__file__)
TOK = re.compile(r"(?P<com>#.*)|(?P<str>\"[^\"]*\"|'[^']*')"
                 r"|(?P<kw>\b(?:def|for|in|if|elif|else|return|import|from|as|while|"
                 r"with|lambda|not|and|or|None|True|False|class)\b)|(?P<num>\b\d+(?:\.\d+)?\b)")
TOK_COL = {"com": (106, 115, 135), "str": (152, 195, 121), "kw": (198, 120, 221),
           "num": (209, 154, 102), None: (171, 178, 191)}


def tokens(line):
    out, pos = [], 0
    for m in TOK.finditer(line):
        out += [(line[pos:m.start()], None), (m.group(), m.lastgroup)]
        pos = m.end()
    return out + [(line[pos:], None)]


SRC_TOK = [tokens(l) for l in SRC]
PHASES = [(0.0, "water"), (0.6, "snow"), (1.6, "bell"), (3.2, "pulse"), (4.6, "glow"),
          (5.8, "tentacles"), (7.0, "comb"), (8.8, "oral arms"), (10.0, "light"), (11.6, "alarm"),
          (13.4, "sparks"), (15.2, "haze"), (17.0, "render"), (19.0, "encode"), (DUR, "encode")]
KEYS = [(t, next(i for i, l in enumerate(SRC) if l.strip().startswith("# --- " + name)))
        for t, name in PHASES]


def code_pos(t):
    for (t0, l0), (t1, l1) in zip(KEYS, KEYS[1:]):
        if t < t1 or t1 == KEYS[-1][0]:
            span = max(abs(l1 - l0) - 3, 0)
            drift = l0 + min((t - t0) * 2.5, span)
            if t > t1 - 0.5 and l1 != l0:
                end = l0 + min((t1 - 0.5 - t0) * 2.5, span)
                s = (t - (t1 - 0.5)) / 0.5
                return end + (l1 - end) * s * s * (3 - 2 * s)
            return drift
    return KEYS[-1][1]


PX, PY, PW, PH_ = 30, 1365, W - 60, 525
LH, CODE_TOP = 27, 52
CHAR_W = F_CODE.getlength("M")


def code_panel(t, img):
    panel = Image.new("RGB", (PW, PH_), (14, 17, 26))
    d = ImageDraw.Draw(panel)
    pos = code_pos(t)
    top = pos - 6
    cur = int(round(pos))
    for li in range(int(math.floor(top)), int(top) + 22):
        if not 0 <= li < len(SRC):
            continue
        yy = CODE_TOP + (li - top) * LH
        if yy < CODE_TOP - LH or yy > PH_:
            continue
        if li == cur:
            d.rectangle((0, yy - 2, PW, yy + LH - 3), fill=(28, 35, 54))
        d.text((12, yy), f"{li + 1:>3}", font=F_CODE, fill=(75, 82, 100))
        x = 70
        for seg, kind in SRC_TOK[li]:
            seg = seg[: max(0, int((PW - 20 - x) / CHAR_W))]
            if seg:
                d.text((x, yy), seg, font=F_CODE, fill=TOK_COL[kind])
                x += len(seg) * CHAR_W
    d.rectangle((0, 0, PW, 52), fill=(14, 17, 26))           # title bar over the code
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        d.ellipse((20 + i * 26, 16, 36 + i * 26, 32), fill=c)
    d.text((110, 11), NAME, font=F_UI, fill=(200, 205, 215))
    d.ellipse((PW - 250, 18, PW - 236, 32), fill=(40, 200, 64))
    d.text((PW - 228, 11), "running  30 fps", font=F_UI, fill=(140, 150, 165))
    d.line((0, 46, PW, 46), fill=(34, 40, 56), width=2)
    mask = Image.new("L", (PW, PH_), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, PW - 1, PH_ - 1), 18, fill=255)
    img.paste(panel, (PX, PY), mask)
    ImageDraw.Draw(img).rounded_rectangle((PX, PY, PX + PW - 1, PY + PH_ - 1), 18,
                                         outline=(38, 46, 64), width=2)


# --- haze: light scatters in the water, so every glow sits in a soft cloud of its own
BOX = (0, GY0 - 20, W, PY - 5)
_g = np.linspace(0, 1, H)[:, None, None]
BG_IMG = Image.fromarray((BG_TOP * (1 - _g) + BG_BOT * _g).repeat(W, 1).astype(np.uint8))
_vy, _vx = np.mgrid[0:BOX[3] - BOX[1], 0:W]
_vr = np.hypot((_vx - W / 2) / (W * 0.62), (_vy - (SY0 - BOX[1])) / ((BOX[3] - BOX[1]) * 0.58))
VIGNETTE = Image.fromarray((255 * (1 - 0.45 * smooth(_vr - 0.25))).astype(np.uint8)).convert("RGB")
HAZE_MAX, HAZE_K = 120.0, 30.0


def haze(Lh, dof):
    m = Lh.max(-1, keepdims=True)                     # soft roll-off: a bright glow never turns to fog
    h = Lh * HAZE_MAX * (1 - np.exp(-m / HAZE_K)) / np.maximum(m, 1e-9)
    h = Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).resize((W, GH), Image.BICUBIC)
    h = h.filter(ImageFilter.GaussianBlur(26))
    d = Image.fromarray(np.clip(dof * 255, 0, 255).astype(np.uint8)).resize((W, GH), Image.BILINEAR)
    h = ImageChops.add(h, d.filter(ImageFilter.GaussianBlur(10)))
    out = Image.new("RGB", (W, BOX[3] - BOX[1]))
    out.paste(h, (0, GY0 - BOX[1]))
    return out


# --- render: draw every lit cell, then let the light bloom softly
def frame(t):
    chars, rgb, Lh, dof, G = compose(t)
    txt = Image.new("RGB", (W, BOX[3] - BOX[1]))
    d = ImageDraw.Draw(txt)
    for r, c in np.argwhere(chars != " ").tolist():
        d.text((c * CW, GY0 - BOX[1] + r * CH), chars[r, c], font=F_GRID, fill=tuple(rgb[r, c].tolist()))
    glow = txt.filter(ImageFilter.GaussianBlur(2.5)).point(lambda v: int(v * 0.55))
    halo = txt.filter(ImageFilter.GaussianBlur(12)).point(lambda v: min(255, int(v * 0.9)))
    hot = txt.point(lambda v: min(255, max(0, v - 90) * 2))          # only the brightest lights bloom wide
    wide = hot.filter(ImageFilter.GaussianBlur(30)).point(lambda v: min(255, int(v * 1.6)))
    scene = BG_IMG.crop(BOX)
    for layer in (haze(Lh, dof), wide, halo, glow, txt):
        scene = ImageChops.add(scene, layer)
    scene = ImageChops.multiply(scene, VIGNETTE)
    img = BG_IMG.copy()
    img.paste(scene, BOX[:2])

    d = ImageDraw.Draw(img)
    depth = 843.0 - (float(at(HERO, "Y", t)) - float(at(HERO, "Y", 0))) / 1100
    beats = int(((HERO["ps"] >= 0) & (HERO["ps"] <= t)).sum())
    photons = G.E.sum() * 1.3e9
    d.text((36, 34), NAME, font=F_UI, fill=(200, 205, 215))
    d.text((36, 66), f"depth {depth:7.2f} m   4.2 \u00b0C   bell \u00d8 {2 * HERO['R'] / 1000:.2f} m",
           font=F_UI, fill=(120, 128, 145))
    d.text((36, 98), f"beats {beats:3d}   tentacles {len(HERO['TENT'])}   light {photons:.1e} ph/s",
           font=F_UI, fill=(120, 128, 145))
    ts = f"t {t:05.2f}s"
    d.text((W - 36 - F_UI.getlength(ts), 34), ts, font=F_UI, fill=(120, 128, 145))
    code_panel(t, img)
    return img


# --- encode: pipe raw frames into ffmpeg
def encode(out):
    ff = shutil.which("ffmpeg") or "ffmpeg"
    proc = subprocess.Popen(
        [ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium",
         "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
        stdin=subprocess.PIPE)
    total = int(DUR * FPS)
    for f in range(total):
        proc.stdin.write(frame(f / FPS).tobytes())
        if f % FPS == 0:
            print(f"\rrendering {f / FPS:4.0f}s / {DUR:.0f}s", end="", flush=True)
    proc.stdin.close()
    proc.wait()
    print(f"\rdone -> {out}            ")


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "--still":
        frame(float(sys.argv[2])).save(sys.argv[3])
    elif len(sys.argv) >= 4 and sys.argv[1] == "--stills":
        os.makedirs(sys.argv[3], exist_ok=True)
        for ts in sys.argv[2].split(","):
            frame(float(ts)).save(os.path.join(sys.argv[3], f"t{float(ts):05.2f}.png"))
    else:
        encode(sys.argv[1] if len(sys.argv) > 1 else "jellyfish2.mp4")
