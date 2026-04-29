# Frosted Glass on Images: The Mathematics Behind SVG Filter Distortion

The frosted-glass / icy effect produced by stacking SVG filter primitives looks like one effect but is actually the composition of three classical image-processing operations: **band-limited noise synthesis**, **coordinate-domain resampling**, and **low-pass convolution**. This writeup walks through what each primitive computes as a function from input pixels to output pixels, why composition order matters, and how the math constrains what you can and cannot do for both aesthetics and privacy.

---

## 1. The Pipeline as Math

An SVG filter is a directed acyclic graph where each `<fe...>` primitive is a function `f : Image* → Image`. For our frosted-glass case the relevant compositions look like:

```
N      = feTurbulence()                       : ()       → Image_noise
W(I)   = feDisplacementMap(I, N, scale)       : Image    → Image      (resampling)
B(I)   = feGaussianBlur(I, σ)                 : Image    → Image      (convolution)

Output = B(W(W(I_source)))    or    W(B(I_source))    etc.
```

Each primitive is defined pointwise — `out(x, y) = g(inputs at some neighborhood of (x, y))`. Two are **local** (gaussian blur reads a small neighborhood; turbulence reads no input at all), and one is **non-local** (`feDisplacementMap` reads from `(x + Δx, y + Δy)`, where Δ can span tens of pixels).

This is why ordering matters: convolution and resampling don't commute.

---

## 2. `feTurbulence` — Perlin / Fractal Noise

`feTurbulence` synthesizes a noise image. The SVG 1.1 spec explicitly cites Perlin's algorithm — "For a detailed description… see *Texturing and Modeling*, Ebert et al."

### 2.1 The base noise function (Perlin's gradient noise)

For a 2-D point `p = (x, y)`:

1. Find the four lattice corners around `p` — `(i, j), (i+1, j), (i, j+1), (i+1, j+1)`.
2. Each corner has a pseudo-random unit gradient vector `g_ij`, picked by hashing the integer coordinates through a 256-entry permutation table seeded by `seed`. Perlin's reference implementation uses `hash = p[p[X] + Y]` modulo the permutation length.
3. For each corner compute the offset `d_ij = p − (i, j)` and the dot product `n_ij = g_ij · d_ij`.
4. Bilinearly interpolate the four `n_ij` using a **fade curve** on the fractional offsets `(u, v) = (x − i, y − j)`:

```
fade(t) = 6t^5 − 15t^4 + 10t^3      // Perlin 2002, "Improving Noise"
noise(x,y) = lerp(v',
                  lerp(u', n_00, n_10),
                  lerp(u', n_01, n_11))
where u' = fade(u), v' = fade(v)
```

The quintic was specifically chosen so that both the first and second derivatives are zero at `t = 0` and `t = 1`. This makes the noise field `C²` continuous — important because the next stage (`feDisplacementMap`) effectively differentiates the field implicitly when warping, and any second-order kink would print as a visible crease.

**Why it's band-limited.** Energy is concentrated near the lattice frequency. There are no features smaller than ~one lattice cell (interpolation forces zero crossings at integer lattice points) and no features larger than one lattice cell (each cell's gradient is independently randomized). This is the property that lets you stack octaves cleanly — each octave occupies a different frequency band with little overlap.

### 2.2 `type="turbulence"` vs `type="fractalNoise"`

The SVG 1.1 turbulence reference cites Ebert et al.'s formulation, in which classical Perlin noise is signed (roughly `[−1, +1]`). The spec wraps it for the canvas as follows:

- `fractalNoise`: takes the signed noise, scales/biases it into `[0, 1]`, i.e. `0.5 + 0.5 * noise`. Result: a smooth gray field hovering around 50%.
- `turbulence`: takes the **absolute value** of the signed noise — `|noise|`. Result: a field that hits zero everywhere the original noise crossed zero, producing the characteristic dark "creases" / cellular look that Perlin originally used to model marble and clouds.

In the frequency domain, `|·|` is a non-linearity. It folds the negative half of the spectrum onto the positive half and **doubles the apparent frequency** of any given component (a sine of frequency `f` rectified looks roughly like a wave of frequency `2f` plus DC). That's why `turbulence` looks "busier" than `fractalNoise` at the same `baseFrequency`, and why it adds a DC offset (the mean of `|noise|` is non-zero).

For the icy crystal aesthetic, `fractalNoise` is usually the right choice — you want the smooth signed swings to drive symmetric +/– displacement.

### 2.3 `baseFrequency`

The unit is **cycles per filter coordinate unit**. Inside the default `filterUnits="objectBoundingBox"` context, the filter region is normalized to `[0, 1] × [0, 1]` so `baseFrequency=0.05` means 0.05 cycles per object width — features ~20 element-widths big. With `filterUnits="userSpaceOnUse"` it's cycles per CSS pixel, so `baseFrequency=0.02` ≈ feature size ~50 px. The relationship for the dominant feature size is:

```
feature_size_px  ≈  1 / baseFrequency      (in whatever the active unit is)
```

You can pass two numbers for `baseFrequencyX` and `baseFrequencyY` independently — useful for stretched, fibrous noise.

### 2.4 `numOctaves` — fractional Brownian motion

The full output at one pixel is the fBm sum:

```
fBm(x) = Σ_{i=0}^{N−1}  a_i · noise( f_i · x )
       a_i = persistence^i        // amplitude
       f_i = lacunarity^i · f_0   // frequency
```

SVG hard-codes `lacunarity = 2` and `persistence = 0.5`, matching Quilez's canonical form (`G = 2^(−H)` with `H = 1`). With those numbers, each octave doubles spatial frequency and halves amplitude, which puts the power spectrum on a `1/f^β` slope (`β = 2H + 1 = 3` per Quilez), i.e. about **9 dB drop per octave** of energy. After 3–4 octaves, the next octave contributes < 12% of the amplitude budget and is mostly drowned by anti-aliasing — that's the math behind "3–4 octaves usually enough."

### 2.5 `seed`

`seed` selects which permutation of the 256-entry hash table is used. Different seeds produce statistically identical noise but with different specific feature placement — used to vary instances without changing the look.

### 2.6 The output is RGBA

`feTurbulence` runs the noise function **independently** for each of R, G, B, A using different sub-tables of the permutation. So the output isn't a grayscale field repeated — it's four uncorrelated noise fields packed into one image. That matters next: `feDisplacementMap` uses one channel for X and a *different* channel for Y, getting independent horizontal and vertical perturbations from a single turbulence pass.

---

## 3. `feDisplacementMap` — Coordinate Resampling

The spec formula (per W3C and reproduced verbatim by MDN) is:

```
P'(x, y)  ←  P( x + scale · (XC(x, y) − 0.5),
                y + scale · (YC(x, y) − 0.5) )
```

where `P` is the input image (`in`), `XC` / `YC` are the channel values from the displacement map (`in2`) selected by `xChannelSelector` / `yChannelSelector`, normalized to `[0, 1]`. `scale` is in filter coordinate units (effectively pixels at the filter's primitive subregion resolution).

### 3.1 This is a backward warp, not a forward push

The formula reads: "to produce the output pixel at `(x, y)`, **fetch** the input pixel at offset `(x + Δx, y + Δy)`." This is a **gather**, not a scatter. It guarantees every output pixel gets exactly one source value (no holes, no overlaps), which is why displacement maps don't tear images.

The `−0.5` recenters the unsigned channel range `[0, 1]` to a signed range `[−0.5, +0.5]`, so a flat 50%-gray map produces zero displacement, brighter pushes one way, darker pushes the other.

### 3.2 Sampling: bilinear vs nearest

The spec is silent on the sampling kernel — browsers do roughly bilinear interpolation in practice but it's implementation-defined. Bilinear is `C⁰` continuous so warps look smooth, but it acts as a mild low-pass itself (kernel ≈ 2×2 box), which slightly attenuates high frequencies in the source as a side effect of warping. Nearest-neighbour produces visibly jagged/aliased edges where the displacement gradient is steep — this is what shows up at the boundaries of high-`scale` warps.

### 3.3 Composition of warps

Stacking two displacement maps:

```
W₂(W₁(I))  =  I( x + Δ₁(x, y) + Δ₂(x + Δ₁, y + Δ₁), … )
```

The second warp's offsets are evaluated at the **already-warped coordinates**, so you don't get a simple sum of displacements — you get a non-linear coordinate composition. This is what creates the "broken-glass" look in two-pass setups: a small high-frequency map riding on top of a large low-frequency one produces detail at multiple scales without doubling the noise primitive cost.

### 3.4 Frequency-domain intuition

Loosely (the warp is non-linear so this isn't strict, but it's a useful guide):

- High-frequency map × small `scale` → grain / sparkle. Each pixel is shoved by ~1 px in a chaotic direction; image looks "noisy."
- Low-frequency map × large `scale` → smooth warp. Image looks like it's been pushed under flowing water; large coherent regions slide together.
- Combining the two = "ice."

---

## 3.5 Beyond Perlin: Other Noise Types (and How to Get Them into SVG)

`feTurbulence` is hard-coded by the spec to gradient (Perlin/fBm) noise. The primitive has no `type="worley"` knob. Anything else has to enter the pipeline via **`<feImage>`** referencing a pre-rendered or canvas-generated noise texture.

### Noise zoo — what each kind looks like and how to make it

| Type | Visual character | How it's built | Aesthetic match for ice |
|---|---|---|---|
| **Perlin gradient** | Smooth swirls, rounded blobs, wavy water | Random unit gradients at lattice corners; dot-product with offsets; fade-interpolate | Decent — "wavy frost" |
| **Simplex** (Perlin 2001) | Same as Perlin but cleaner at higher dims | Triangular lattice; fewer directional artifacts | Same aesthetic; not in SVG |
| **Value noise** | Smoother but blockier than Perlin | Random *values* (not gradients) at lattice corners, interpolated | Worse — looks soft |
| **Worley / cellular** (Voronoi) | **Polygonal cells with sharp grain boundaries** | Distance to N feature points; F1 = nearest, F2 = second-nearest | **Best for shattered glass / ice grain** |
| **Wavelet noise** (Cook 2005) | Smooth, perfectly band-limited, no aliasing | Wavelet basis synthesis | Marginal upgrade over Perlin |
| **Gabor noise** (Lagae 2009) | Oriented streaks, anisotropic stripes | Sparse sum of Gabor kernels | Frosted condensation streaks |
| **Curl noise** | Fluid flow swirls, vortices | Take curl of Perlin vector field — divergence-free | Wrong vibe — smoke/fluid |
| **Phasor noise** (2019) | Fingerprint ridges, parallel grooves | Phase-domain synthesis | Striated ice |
| **White noise** | TV static | Random per pixel | Useless — destroys structure |
| **Pink / brown noise** | Spatial 1/f static | White noise filtered for 1/f spectrum | Better than white but no shape |

### Three ways to get non-Perlin noise into an SVG filter

**Option A — pre-rendered tileable PNG via `<feImage>`**

```xml
<filter id="ice" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"
        x="0" y="0" width="W" height="H">
  <feImage href="data:image/png;base64,..." preserveAspectRatio="none"
           x="0" y="0" width="W" height="H" result="noise"/>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="40"/>
  <feGaussianBlur stdDeviation="10"/>
</filter>
```

- Generate the texture once (offline JS or Python script), embed as base64.
- Channel-pack: e.g. `R = F1` (smooth ramp), `G = F2 − F1` (cell-edge spike) — `feDisplacementMap` then reads R for x-shove and G for y-shove and gets two displacement modes from one pass.
- Cost: similar to or slightly cheaper than `feTurbulence` (no procedural compute).
- Bundle cost: ~50–120 KB for a 256×256 base64 PNG; depends on point count and compressibility.
- Drawback: same texture repeats across the filter region (looks tiled if the region is much larger than the texture). Fine for full-page blur where the user won't scrutinise tile edges.

**Caveat from testing (2026-04-27):** in Chromium, `<feImage>` would not paint into the filter graph until both `filterUnits="userSpaceOnUse"` and `primitiveUnits="userSpaceOnUse"` were set explicitly with absolute pixel `x`/`y`/`width`/`height` matching the filtered element. With default `objectBoundingBox` units, the primitive subregion silently resolved to zero area — the filter ran but the noise channel was empty (so displacement scale × 0 = 0, looked like plain blur). Worth flagging in code comments next to any `feImage` usage.

**Option B — fake-cellular via Perlin compositing**

`feColorMatrix` with a high-contrast slope on a `feTurbulence` pass posterises the smooth Perlin into hard-edged blobs. Stack two passes at different frequencies for a Voronoi-ish look. Drawback: still fundamentally Perlin underneath, won't have the crisp piecewise-linear edges of true Worley. Cheap (no PNG payload).

**Option C — canvas / WebGL render-to-texture**

Procedurally generate any noise type per-frame in a hidden canvas; reference via `feImage` pointing at the canvas data URL. Full flexibility, JS work each frame, biggest perf cost. Overkill for static frost.

### Worley specifically — math reference

Given N feature points `{p_1, ..., p_N}` scattered in the unit square (with the 8 neighbouring tile copies for seamless wrap):

```
F1(x) = min_i ||x − p_i||
F2(x) = min_{i ≠ argmin F1} ||x − p_i||
```

The interesting derived signals:

| Signal | Property | Useful as |
|---|---|---|
| `F1` | Smooth ramp, 0 at cell centres → max at cell corners | Source distance map (smooth shoves toward edges) |
| `F2 − F1` | Zero almost everywhere; spikes near grain boundaries | Cell-edge highlighter (sharp shoves at boundaries) |
| `1 − F1` | Inverted F1 — peaks at centres | Bright spots at cell middles (specular hint) |

**Cell density**: with N points scattered in a unit square, mean cell area ≈ `1/N`, mean cell diameter ≈ `1/√N`. For a 256×256 texture stretched across a 1200×720 stage region (~4.7× zoom in X, ~2.8× in Y), N=24 gives ~250-px cells (one per thumbnail), N=80 gives ~140-px cells (3-5 cells per thumbnail).

### Empirical comparison: Perlin (path 4c) vs Worley (path 5)

Tested at σ=10, displacement scale=40, six stacked stages (1200×720 each) at 120 Hz vsync.

| Filter | Median frame | p95 | Visual character |
|---|---|---|---|
| path 4c — Perlin (baseFreq 0.006 + 0.04, scale 60 + 20) | 13.1 ms | 17.8 ms | Wavy ice ridges, organic curves |
| path 5 — Worley (256-px tile, 80 points, channel-packed F1/F2−F1) | 13.4 ms | 14.5 ms | Straight slip-plane shoves at cell edges, "shattered glass" |

Costs are within noise of each other. **Perlin reads as "ice / frost"; Worley reads as "shattered glass."** Both valid privacy filters at σ=10; the choice is aesthetic.

For frosted-glass UX (what the extension wants), Perlin is closer to the mental model. Worley is a credible alternative if a "cracked glass" look is desirable for, say, a redaction-with-attitude mode.

### Hybrid possibility (untested)

Combine both via `feMerge` or sequential displacement passes: Perlin first (smooth flowing warps), Worley second (riding straight-edge slip-planes on top of the warped image). The two-warp composition rule from §3.3 means the slip planes appear distorted — closer to "ice with internal fractures" than either alone.

---

## 4. `feGaussianBlur` — Convolution

The 2-D Gaussian kernel is:

```
G(x, y; σ) = (1 / (2π σ²)) · exp( −(x² + y²) / (2σ²) )
```

`stdDeviation` is `σ` in filter coordinate units; you can pass two values for elliptical blur. Convolution is `out(x, y) = ∑_{u,v} G(u, v) · in(x − u, y − v)`.

### 4.1 Separability

`G(x, y) = G₁(x) · G₁(y)` where `G₁(t) = (1/√(2π σ²)) exp(−t²/(2σ²))`. So a 2-D Gaussian convolution is two 1-D passes — `O(σ)` work per pixel instead of `O(σ²)`. Browsers exploit this. The SVG spec further permits a three-pass box-blur approximation (central-limit theorem: repeated box convolution converges to Gaussian; three passes hits ~3 % error), and that's what most browser engines actually ship — the visible result is essentially indistinguishable for σ ≳ 2.

### 4.2 Frequency response

The Fourier transform of a Gaussian is a Gaussian:

```
Ĝ(f_x, f_y; σ) = exp( −2π² σ² (f_x² + f_y²) )
```

So `feGaussianBlur` is a **low-pass filter** with frequency response that decays as `exp(−2π² σ² f²)`. A frequency `f` is attenuated by `~e⁻¹` (≈ 37%) when `f ≈ 1 / (π σ √2)` ≈ `0.225 / σ` cycles/px — i.e., feature size `~4.4σ` pixels.

In practical terms: **anything smaller than ~σ pixels is essentially destroyed.** This is the math behind "the gaussian melts the displacement detail" — every spatial frequency above `~1/σ` is suppressed by orders of magnitude.

---

## 5. Composition Order Matters

`B ∘ W` and `W ∘ B` are not the same operator.

**`blur → displace`.** First the source is smoothed; then the smoothed result is warped. Output reads as soft + warped. The displacement field's high-frequency detail still shows up — but it shows up *displacing already-blurred content*, which means the warp's fine structure has nothing crisp to act on. The crystal "edges" don't appear because the source has no edges left.

**`displace → blur`.** First the source is warped (preserving high-frequency detail in the warp itself); then the warped image is blurred. The blur destroys any warped feature smaller than ~σ. So if `scale ≪ σ`, the warp is invisible — you've spent compute generating noise that the gaussian eats.

**The frosted-glass sweet spot: `displace → displace → blur` with `scale > σ`.**

Concretely, with `scale ≈ 40` px and `σ ≈ 6` px: the displacement creates coherent "shoves" at the ~20–40 px scale. The gaussian erases anything < 6 px — but most of the displacement-induced features are 20+ px, so they survive. What you see is a softened image with visible mid-scale "facets" — the math signature of ice.

---

## 6. Why This Looks Like Ice

Real frosted glass works by **micro-scale surface roughness**: every point on the glass has a slightly different normal, so refraction directions vary point-to-point. The eye integrates over those varying directions and sees a blurred background, but at angles where the local normal happens to align coherently you get visible distortion — the "facets."

The SVG approximation maps cleanly:

| Real optics | SVG analogue |
|---|---|
| Diffuse refraction integrated over micro-roughness | `feGaussianBlur` (low-pass) |
| Coherent local refraction along surface normals | `feDisplacementMap` driven by smooth `feTurbulence` |
| Sub-pixel surface jitter | second high-frequency turbulence + small-scale displacement |
| Specular highlights on wet ice | `feSpecularLighting` (Phong / Blinn-Phong; not used here for cost) |

Crystal facets emerge precisely when **displacement scale > gaussian σ** AND **base noise frequency low enough to produce features bigger than σ**. Both conditions must hold; violate either and you get plain blur with no character.

Adding `feSpecularLighting` would push it from "ice" to "wet ice with a light source." It applies the Phong reflection model (`I = k_s · (R · V)^n`) using the height-map gradient as the surface normal — the cost is another kernel pass plus a normal computation per pixel.

---

## 7. Privacy Implication of the Math

This is the most important section if the filter is used to hide content.

**Displacement preserves information.** `feDisplacementMap` is (in principle) **invertible**: if the attacker knows the displacement field `Δ`, they can compute `I(x + Δ⁻¹(x, y))` and recover the original. It's a permutation of pixel positions — the entropy is unchanged. Even without the field, displacement only redistributes pixels; bag-of-pixels statistics are preserved, and recognizable structure leaks through whenever `scale` is small relative to feature size.

**Gaussian blur destroys information.** It's a low-pass filter; frequencies above `~1/σ` are attenuated to negligible amplitudes. By the Nyquist theorem, deconvolution can recover frequencies above the noise floor but no higher — once a frequency's amplitude is below the quantization/dither floor, that information is gone. This is irreversible in any practical sense.

**For privacy, σ must exceed the smallest feature you want to hide.** Concretely:

- Body text x-height ≈ 7–9 px → σ ≥ 9 px (call it 10–12 to be safe).
- License plate digits at typical screenshot resolution ≈ 12–16 px → σ ≥ 16 px.
- Faces at thumbnail scale ≈ 30 px → σ ≥ 30 px.

Displacement alone is **not** privacy. Displacement-then-blur is, provided σ meets the feature-size bound.

---

## 8. Practical Tuning Rules (Distilled From the Math)

| Goal | Knob | Rule |
|---|---|---|
| Bigger crystal facets | `baseFrequency` | Lower it. `baseFrequency ≈ 1 / desired_feature_px`. |
| Stronger distortion | `scale` on `feDisplacementMap` | Increase. Cap at ~½ the smallest layout dimension — beyond that, gather coords fall outside the element bounds and the browser samples filter background (often transparent black). |
| More privacy | `stdDeviation` | Increase σ. Must exceed smallest hideable feature size in pixels. |
| Crystals survive the blur | Relative sizing | Ensure displacement `scale > σ`. Otherwise the gaussian erases warp detail. |
| Grain / sparkle | Stack two turbulences | Second `feTurbulence` with high `baseFrequency` (~0.5–1.0 cycles/px), feed into a low-`scale` (4–8 px) `feDisplacementMap`. |
| Avoid second-order creases in warps | `type="fractalNoise"` | Use `fractalNoise` not `turbulence` for displacement source — `|·|` rectification adds folds that print as visible ridges. |
| Cheap "ice" | Pipeline order | `turbulence → displace → displace → blur` (two stacked warps, blur last). |

---

## Sources

- [W3C SVG 1.1 (Second Edition) — Filter Effects (table of contents)](https://www.w3.org/TR/SVG11/filters.html)
- [W3C SVG 2 (current draft)](https://www.w3.org/TR/SVG2/)
- [MDN — `<feDisplacementMap>` (reproduces W3C displacement formula)](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap)
- [MDN — `<feTurbulence>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feTurbulence)
- [MDN — `<feGaussianBlur>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feGaussianBlur)
- [MDN — `stdDeviation` attribute](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stdDeviation)
- [Wikipedia — Perlin noise (algorithm + fade curve)](https://en.wikipedia.org/wiki/Perlin_noise)
- [Wikipedia — Gaussian blur (kernel, separability, Fourier)](https://en.wikipedia.org/wiki/Gaussian_blur)
- [Wikipedia — Box blur (CLT approximation of Gaussian)](https://en.wikipedia.org/wiki/Box_blur)
- [Wikipedia — Fractional Brownian motion](https://en.wikipedia.org/wiki/Fractional_Brownian_motion)
- [Ken Perlin, "Improving Noise" (SIGGRAPH 2002) — official PDF](https://mrl.cs.nyu.edu/~perlin/paper445.pdf)
- [Ken Perlin — Improved Noise reference implementation](https://mrl.cs.nyu.edu/~perlin/noise/)
- [NVIDIA GPU Gems 2, Ch. 26 — Implementing Improved Perlin Noise](https://developer.nvidia.com/gpugems/gpugems2/part-iii-high-quality-rendering/chapter-26-implementing-improved-perlin-noise)
- [NVIDIA GPU Gems, Ch. 5 — Implementing Improved Perlin Noise](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-5-implementing-improved-perlin-noise)
- [Inigo Quilez — fBm (gain, lacunarity, spectral density)](https://iquilezles.org/articles/fbm/)
- [Inigo Quilez — More on noise](https://iquilezles.org/articles/morenoise/)
- [The Book of Shaders — Fractal Brownian Motion](https://thebookofshaders.com/13/)
- [Adrian Biagioli — Understanding Perlin Noise (walkthrough of Perlin's reference impl)](https://adrianb.io/2014/08/09/perlinnoise.html)
- [Scratchapixel — Improved Perlin Noise](https://www.scratchapixel.com/lessons/procedural-generation-virtual-worlds/perlin-noise-part-2/improved-perlin-noise.html)
- [Codrops — SVG Filter Effects: Creating Texture with `feTurbulence`](https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/)
- [Intel — Investigation of fast real-time GPU-based image blur algorithms](https://www.intel.com/content/www/us/en/developer/articles/technical/an-investigation-of-fast-real-time-gpu-based-image-blur-algorithms.html)
- [Ivan Kuckir — Fastest Gaussian Blur (linear time / box approximation)](https://blog.ivank.net/fastest-gaussian-blur.html)

---

**Notes on what could not be fully verified from primary sources:**

- The W3C SVG 1.1 Second Edition single-page filters document repeatedly truncated before reaching §15.16, §15.17, and §15.20 (the actual sections covering `feDisplacementMap`, `feGaussianBlur`, `feTurbulence`). The displacement formula in §3 is sourced from MDN, which reproduces it verbatim; Gaussian and turbulence behaviors come from Wikipedia + the NVIDIA GPU Gems chapters + Perlin's own paper, which match the spec's algorithmic intent. The `0.225/σ` numerical conversion in §4.2 is derived from `Ĝ = e⁻¹` and is standard, but treat it as derivation rather than direct quote.
- The exact "absolute value vs. unsigned remap" definition of `turbulence` vs. `fractalNoise` is consistent with Ebert et al.'s formulation that the SVG spec cites, but the spec's literal words for it could not be pulled via WebFetch — treat that paragraph as the consensus interpretation widely echoed across MDN, Codrops, and `svgwrite`'s docs.
