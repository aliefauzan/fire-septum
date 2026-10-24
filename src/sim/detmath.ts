// Deterministic elementary functions for the simulation.
//
// ECMAScript leaves Math.exp, Math.log, Math.sin, Math.atan, Math.pow and friends
// "implementation-approximated": V8, SpiderMonkey and JavaScriptCore may differ in the
// last bit, and one flipped bit can flip a random threshold in a run, so a record made in
// Chromium might not re-run bit-for-bit in Firefox or Safari. These versions use only
// + − × ÷, Math.sqrt, Math.round and Math.abs, which IEEE 754 fixes exactly, so every
// engine gets the same bits. The algorithms are the classic fdlibm ones (Sun
// Microsystems, 1993), accurate to about one unit in the last place.
//
// FROZEN: records sealed with `math: 'det1'` must re-run to the same bits forever. Never
// change a constant or an operation order here; add a 'det2' instead.

export interface MathLib {
  exp(x: number): number;
  log(x: number): number;
  sin(x: number): number;
  cos(x: number): number;
  atan(x: number): number;
  atan2(y: number, x: number): number;
  pow(x: number, y: number): number;
  hypot(x: number, y: number): number;
  sqrt(x: number): number;
}

/** Math ids a record can name. Unset (records made before 24 Oct 2026) means the engine's own Math. */
export type MathMode = 'det1';

export const NATIVE: MathLib = Math;

const dv = new DataView(new ArrayBuffer(8));
const hiWord = (x: number) => { dv.setFloat64(0, x); return dv.getInt32(0); };
const loWord = (x: number) => { dv.setFloat64(0, x); return dv.getUint32(4); };
const fromWords = (hi: number, lo: number) => { dv.setInt32(0, hi); dv.setUint32(4, lo); return dv.getFloat64(0); };

/** 2^k for integer k, built from its bit pattern (exact). */
function pow2(k: number): number {
  if (k > 1023) return pow2(1023) * pow2(k - 1023);
  if (k < -1022) return pow2(-1022) * pow2(k + 1022);
  return fromWords((k + 1023) << 20, 0);
}

const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;

function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.782712893383973096) return Infinity;
  if (x < -745.13321910194110842) return 0;
  if (Math.abs(x) < 3.725290298461914e-9) return 1 + x;
  const k = Math.round(x * INV_LN2);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  return k === 0 ? y : y * pow2(k);
}

const LG1 = 6.666666666666735130e-01;
const LG2 = 3.999999999940941908e-01;
const LG3 = 2.857142874366239149e-01;
const LG4 = 2.222219843214978396e-01;
const LG5 = 1.818357216161805012e-01;
const LG6 = 1.531383769920937332e-01;
const LG7 = 1.479819860511658591e-01;

function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k = -54; } // subnormal: scale by 2^54
  let hx = hiWord(x);
  const lx = loWord(x);
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  x = fromWords(hx | (i ^ 0x3ff00000), lx); // x in [sqrt(2)/2, sqrt(2))
  k += i >> 20;
  const f = x - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
}

const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

/** sin and cos on [−π/4, π/4]. */
function kSin(x: number): number {
  const z = x * x, v = z * x;
  return x + v * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}
function kCos(x: number): number {
  const z = x * x;
  return 1 - (0.5 * z - z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))))));
}

// π/2 split into three parts of 33 bits each (Cody–Waite), exact for |n| < 2^20.
const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_3 = 2.02226624871116645580e-21;

/** Quadrant and remainder of x / (π/2). */
function reduce(x: number): [number, number] {
  const n = Math.round(x * INV_PIO2);
  return [((n % 4) + 4) % 4, ((x - n * PIO2_1) - n * PIO2_2) - n * PIO2_3];
}

function sin(x: number): number {
  if (!isFinite(x)) return NaN;
  const [q, r] = reduce(x);
  return q === 0 ? kSin(r) : q === 1 ? kCos(r) : q === 2 ? -kSin(r) : -kCos(r);
}

function cos(x: number): number {
  if (!isFinite(x)) return NaN;
  const [q, r] = reduce(x);
  return q === 0 ? kCos(r) : q === 1 ? -kSin(r) : q === 2 ? -kCos(r) : kSin(r);
}

const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];

function atan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0;
  let a = Math.abs(x);
  if (a >= 7.378697629483821e19) return neg ? -ATAN_HI[3] - ATAN_LO[3] : ATAN_HI[3] + ATAN_LO[3];
  let id = -1;
  if (a < 0.4375) {
    if (a < 1.862645149230957e-9) return x;
  } else if (a < 1.1875) {
    if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); }
    else { id = 1; a = (a - 1) / (a + 1); }
  } else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); }
  else { id = 3; a = -1 / a; }
  const z = a * a, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) { const r = a - a * (s1 + s2); return neg ? -r : r; }
  const r = ATAN_HI[id] - ((a * (s1 + s2) - ATAN_LO[id]) - a);
  return neg ? -r : r;
}

const PI = 3.1415926535897931160e+00;
const PI_LO = 1.2246467991473531772e-16;

function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x === 0) return y > 0 ? PI / 2 : y < 0 ? -PI / 2 : (1 / x < 0 ? (1 / y < 0 ? -PI : PI) : y);
  if (y === 0) return x > 0 ? y : (1 / y < 0 ? -PI : PI);
  if (!isFinite(x) || !isFinite(y)) return exactInfAtan2(y, x);
  const t = atan(Math.abs(y / x));
  if (x > 0) return y > 0 ? t : -t;
  const r = PI - (t - PI_LO);
  return y > 0 ? r : -r;
}

/** Infinite arguments have exact answers built from π. */
function exactInfAtan2(y: number, x: number): number {
  const s = y < 0 ? -1 : 1;
  if (!isFinite(x) && !isFinite(y)) return s * (x > 0 ? PI / 4 : 3 * PI / 4);
  if (!isFinite(y)) return s * PI / 2;
  return x > 0 ? s * 0 : s * PI;
}

function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) return Number.isInteger(y) ? (Math.abs(y) % 2 === 1 ? -1 : 1) * exp(y * log(-x)) : NaN;
  return exp(y * log(x));
}

const hypot = (x: number, y: number) => Math.sqrt(x * x + y * y);

export const DET1: MathLib = { exp, log, sin, cos, atan, atan2, pow, hypot, sqrt: Math.sqrt };

export const mathLib = (mode?: MathMode): MathLib => (mode === 'det1' ? DET1 : NATIVE);
