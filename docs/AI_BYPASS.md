# AI Deblurring Bypass — Technical Deep Dive

How to make blurred content unrecoverable by modern AI/ML deblurring systems.
This document covers the mathematics, the threat models, and implementable
techniques for a browser extension.

---

## 1. Why Gaussian Blur Is Weak

### The mathematics of recoverability

Gaussian blur is a **linear convolution**:

```
output(x,y) = Σ Σ input(x+i, y+j) · G(i,j,σ)
```

Where G is the Gaussian kernel: `G(x,y,σ) = (1/(2πσ²)) · e^(-(x²+y²)/(2σ²))`

In the **frequency domain** (via Fourier transform), convolution becomes
multiplication:

```
Output(u,v) = Input(u,v) · G̃(u,v)
```

Where `G̃(u,v) = e^(-2π²σ²(u²+v²))` — a Gaussian that approaches zero at
high frequencies but **never reaches zero**. This means:

- Every frequency component is **attenuated**, not destroyed
- Given `Output` and `G̃`, you can compute `Input = Output / G̃`
- This is **Wiener deconvolution**: `Input ≈ Output · G̃* / (|G̃|² + NSR)`

The only thing preventing perfect recovery is **noise**. The signal-to-noise
ratio (SNR) at frequency (u,v) is:

```
SNR(u,v) = |Input(u,v)|² / |Noise(u,v)|² · |G̃(u,v)|²
```

At high frequencies where `G̃` is very small, SNR drops below 1 and recovery
fails. The **crossover frequency** where SNR = 1 determines the resolution
limit of recovery. For text at 16px font with σ=5 (CSS blur(10px)), the
crossover is roughly at the spatial frequency of character strokes — meaning
individual characters become unresolvable.

### Why the attacker has an advantage

CSS blur parameters are **visible in the DOM**:

```js
getComputedStyle(element).filter  // "blur(10px)"
```

The attacker knows the **exact kernel**. This eliminates the need for blind
deconvolution (estimating the kernel from the blurred image), which is the
hard part of image deblurring. With known kernel, deconvolution is a
straightforward inverse problem.

### What AI models add beyond classical deconvolution

Classical Wiener deconvolution amplifies noise at high frequencies. AI models
replace the noise-amplification problem with **learned priors**:

```
Traditional: Input ≈ Output / G̃  (amplifies noise)
AI model:    Input ≈ f(Output, θ)  (learned mapping, fills in plausible detail)
```

The model `f` was trained on millions of (blurred, original) pairs. It learns:
- Natural image statistics (edges are common, gradients follow power law)
- Text structure (limited alphabet, known fonts, horizontal baseline)
- Face geometry (eyes, nose, mouth have predictable spatial relationships)

These **priors** allow AI to "hallucinate" plausible high-frequency detail
that Wiener deconvolution cannot recover. For text, this is particularly
dangerous because the alphabet is small (~62 characters for alphanumeric)
and fonts are predictable.

---

## 2. Threat Model: Who Attacks Blur?

### Casual observer (shoulder-surfing, screen share viewer)
- **Capability**: human visual perception only
- **Defeated by**: any blur radius ≥ 5px
- **Our current default (10px)**: sufficient

### Screenshot + manual enhancement
- **Capability**: Photoshop unsharp mask, levels adjustment
- **Defeated by**: blur radius ≥ 8px for body text
- **Our current default**: sufficient

### Screenshot + OCR
- **Capability**: Tesseract, Google Vision API, AWS Textract
- **Defeated by**: blur radius ≥ 10px for body text, ≥ 15px for large headings
- **Our current default**: borderline — 10px defeats Tesseract but Google Vision
  may partially read large text

### Screenshot + AI deblurring
- **Capability**: DeblurGAN-v2, Restormer, NAFNet, DiffBIR
- **Defeated by**: blur radius ≥ 15px for body text, ≥ 20px for headings
  OR non-Gaussian blur (pixelation, median, compound)
- **Our current default**: vulnerable at 10px against SOTA models

### DOM extraction (DevTools, extensions, scripts)
- **Capability**: direct text content access
- **CSS blur provides zero protection** — this requires different mitigation
  (content replacement, server-side redaction)

---

## 3. Bypass Techniques — How Each Works

### 3.1 Pixelation (Most Effective, Easiest to Implement)

**How it works mathematically:**

Pixelation is **downsampling + nearest-neighbor upsampling**:

```
Step 1: For each k×k block, compute average color
        block_avg = (1/k²) · Σ pixel(x,y) for (x,y) in block

Step 2: Replace all pixels in block with block_avg
```

This is equivalent to a **low-pass filter** (box filter of size k) followed
by **decimation** (keeping only 1 sample per k pixels), then **replication**
(copying that sample k² times).

**Shannon's sampling theorem** guarantees that spatial frequencies above
`f_max = 1/(2k)` cycles/pixel are **permanently destroyed**. No algorithm —
classical or AI — can recover them because they simply don't exist in the
decimated representation.

**Information loss**: For a k×k block, k² pixels are reduced to 1 value.
The entropy reduction is:

```
H_after ≤ H_before / k² + log₂(quantization_levels)
```

At k=16: 256 pixels → 1 value. 99.6% of spatial information is destroyed.

**Why AI fails**: Super-resolution models (Real-ESRGAN, SwinIR) trained at
4× upscaling can produce plausible detail. But at 16×, the model must
"invent" 255 out of every 256 pixels. The output is a **hallucination** —
it looks plausible but contains fabricated content. For text, this means
the model might produce readable characters, but they are **not the original
characters**. The probability of correctly guessing all characters in a
word drops exponentially with word length.

**Implementation in a browser extension:**

```js
// For <img> elements: draw to small canvas, scale back up
function pixelateImage(img, blockSize) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Step 1: Draw at reduced resolution (1 pixel per block)
  const w = Math.ceil(img.naturalWidth / blockSize);
  const h = Math.ceil(img.naturalHeight / blockSize);
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);

  // Step 2: Scale back up with nearest-neighbor interpolation
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.imageSmoothingEnabled = false;  // nearest-neighbor
  ctx.drawImage(canvas, 0, 0, w, h, 0, 0, canvas.width, canvas.height);

  // Step 3: Replace image source
  img.src = canvas.toDataURL();
}
```

For **CSS-only** pixelation (no content replacement):

```css
.pb-pixelated {
  image-rendering: pixelated;
  /* Downscale then upscale via CSS — works on img elements */
}
```

But CSS-only pixelation doesn't work for text/DOM content — it requires
canvas capture first.

---

### 3.2 Noise Injection (Destroys Recovery Bands)

**How it works mathematically:**

After blurring, add random noise to each pixel:

```
noisy(x,y) = blurred(x,y) + N(0, σ_noise)
```

Where N(0, σ_noise) is Gaussian noise with zero mean and standard deviation
σ_noise.

Deconvolution tries to recover the original by dividing by the blur kernel
in frequency domain:

```
recovered(u,v) = noisy(u,v) / G̃(u,v)
                = blurred(u,v)/G̃(u,v) + N(u,v)/G̃(u,v)
                = original(u,v) + N(u,v)/G̃(u,v)
```

The noise term `N(u,v)/G̃(u,v)` is **amplified** at high frequencies where
`G̃` is small. This amplification makes the recovered image dominated by
noise at exactly the frequencies where the original detail was.

**The Wiener filter** tries to balance this:

```
W(u,v) = G̃*(u,v) / (|G̃(u,v)|² + σ²_noise/σ²_signal)
```

When `σ²_noise` is large relative to `σ²_signal · |G̃|²`, the filter
suppresses recovery — it correctly determines that there's more noise than
signal at that frequency and gives up.

**AI models** face the same fundamental problem: at frequencies where noise
power exceeds the attenuated signal power, recovery is impossible regardless
of architecture. The model must choose between amplifying noise and losing
detail. Training on noisy-blurred data helps but cannot violate information
theory.

**Effective noise levels:**

| σ_noise (0-255 scale) | Effect on deblurring |
|---|---|
| 5 | Slight degradation — SOTA models still recover most detail |
| 15 | Significant degradation — fine text becomes unrecoverable |
| 25 | Severe degradation — only large shapes survive |
| 50+ | Complete defeat — models produce garbage |

**Implementation:**

```js
function addNoiseToCanvas(ctx, width, height, sigma) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Box-Muller transform for Gaussian noise
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const noise = z * sigma;

    data[i]     = Math.max(0, Math.min(255, data[i]     + noise)); // R
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise)); // G
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise)); // B
    // Alpha unchanged
  }

  ctx.putImageData(imageData, 0, 0);
}
```

---

### 3.3 Median Filter (Non-Linear, Non-Invertible)

**How it works:**

For each pixel, sort all values in a k×k neighborhood and take the middle
value:

```
output(x,y) = median({ input(x+i, y+j) : -r ≤ i,j ≤ r })
```

**Why it's non-invertible:**

The median operation is a **many-to-one mapping**. Consider three input
neighborhoods:

```
[1, 5, 9]  → median = 5
[2, 5, 8]  → median = 5
[3, 5, 7]  → median = 5
```

Three different inputs produce the same output. There is no inverse function
that can determine which of the three was the original. This is fundamentally
different from Gaussian blur, where the linear convolution is (in principle)
invertible.

In the frequency domain, the median filter **cannot be expressed as a
transfer function**. It is a non-linear operation that violates the
superposition principle:

```
median(a + b) ≠ median(a) + median(b)
```

This means frequency-domain deconvolution is **mathematically impossible**
for median-filtered content. AI models must learn a non-linear inverse
mapping, which is a much harder problem than learning the inverse of a
linear convolution.

**Multi-pass compound (Gaussian → Median):**

The most effective approach for defeating AI deblurring is to chain a
linear blur with a non-linear filter:

```
Step 1: Apply Gaussian blur (linear, partially invertible alone)
Step 2: Apply median filter (non-linear, makes step 1 irreversible)
```

The compound operation `median(gaussian(input))` is:
- Not expressible as any single convolution kernel
- Not invertible (median step destroys the linear relationship)
- Outside the training distribution of most deblurring models
  (they were trained on purely linear blur)

**Implementation (Canvas):**

```js
function medianFilter(ctx, width, height, radius) {
  const src = ctx.getImageData(0, 0, width, height);
  const dst = ctx.createImageData(width, height);
  const srcData = src.data;
  const dstData = dst.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {  // R, G, B channels
        const values = [];
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = Math.min(width - 1, Math.max(0, x + dx));
            const ny = Math.min(height - 1, Math.max(0, y + dy));
            values.push(srcData[(ny * width + nx) * 4 + c]);
          }
        }
        values.sort((a, b) => a - b);
        dstData[(y * width + x) * 4 + c] = values[Math.floor(values.length / 2)];
      }
      dstData[(y * width + x) * 4 + 3] = 255;  // Alpha
    }
  }

  ctx.putImageData(dst, 0, 0);
}
```

**Performance note:** O(k² · log(k²)) per pixel. At radius=2 (5×5 kernel),
this is ~25 comparisons per pixel per channel. For a 800×600 image:
~36M comparisons. Takes ~50-200ms on modern hardware. Acceptable for
single-image processing, too slow for real-time or bulk application.

---

### 3.4 Color Quantization (Destroys Gradients)

**How it works:**

Reduce the number of distinct color levels per channel:

```
quantized(x,y) = round(original(x,y) / step) * step
where step = 256 / num_levels
```

At 16 levels per channel: step = 16. A value of 137 becomes 128.

**Why it defeats deblurring:**

Gaussian blur produces smooth gradients. Deblurring algorithms use these
gradients to estimate edge positions and reconstruct detail. Quantization
converts smooth gradients into **staircase steps** — the fine gradient
information that deblurring relies on is replaced by flat plateaus and
sharp step boundaries.

In the frequency domain, quantization adds **quantization noise** that is
correlated with the signal (unlike additive random noise). This correlation
confuses both classical and AI deblurring:

```
quantized = original + q_noise(original)
```

Where `q_noise` depends on the signal value — it's a non-linear,
signal-dependent distortion.

**Implementation:**

```js
function quantizeCanvas(ctx, width, height, levels) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const step = 256 / levels;

  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.round(data[i]     / step) * step;  // R
    data[i + 1] = Math.round(data[i + 1] / step) * step;  // G
    data[i + 2] = Math.round(data[i + 2] / step) * step;  // B
  }

  ctx.putImageData(imageData, 0, 0);
}
```

---

### 3.5 Frosted Glass (Displacement + Blur)

**How it works:**

Two operations:

1. **Displacement**: Shift each pixel's sampling position by a random offset
   derived from a noise texture:

   ```
   displaced(x,y) = input(x + noise_x(x,y) · A, y + noise_y(x,y) · A)
   ```

   Where A is the amplitude (pixels of displacement) and `noise_x`, `noise_y`
   are 2D noise fields (Perlin, simplex, or white noise).

2. **Blur**: Apply Gaussian blur to the displaced result.

**Why it defeats AI:**

The displacement is a **spatially-varying geometric transform** — it moves
content to unpredictable positions before blurring. To reverse this, an
attacker must:

1. Determine the blur kernel (easy — it's Gaussian)
2. Deblur the result (possible with SOTA models)
3. Determine the displacement field (requires knowing the noise seed)
4. Reverse the displacement (requires the exact field)

Step 3 is the killer. The noise field is a high-entropy random signal that
cannot be inferred from the output. Even if the blur is perfectly reversed,
the displaced content is spatially scrambled.

**The entropy argument:**

A displacement field of dimensions W×H with amplitude A has entropy:

```
H_displacement = W × H × log₂(2A + 1)  bits
```

For a 800×600 image with A=10: H = 480,000 × 4.4 ≈ 2.1 million bits.
This is the amount of information the attacker must guess to reverse the
displacement. Brute-force search is computationally infeasible.

**SVG implementation:**

```html
<svg style="display:none">
  <filter id="pb-frosted">
    <feTurbulence type="turbulence" baseFrequency="0.05"
                  numOctaves="3" seed="42" result="noise" />
    <feDisplacementMap in="SourceGraphic" in2="noise"
                       scale="15" xChannelSelector="R" yChannelSelector="G" />
    <feGaussianBlur stdDeviation="4" />
  </filter>
</svg>
```

```css
.pb-frosted {
  filter: url(#pb-frosted);
}
```

The `seed` parameter in `feTurbulence` controls the noise pattern. Changing
it per-element or per-session adds entropy.

---

### 3.6 Channel-Independent Processing

**How it works:**

Apply different blur operations to each color channel independently:

```
output_R = blur(input_R, σ_R)
output_G = blur(input_G, σ_G)
output_B = blur(input_B, σ_B)
```

Where σ_R ≠ σ_G ≠ σ_B.

Or more aggressively, **shuffle channels** before blurring:

```
temp_R = input_G    // swap R and G
temp_G = input_R
temp_B = input_B
output = blur(temp)
```

**Why it defeats AI:**

Natural images have strong inter-channel correlation — edges appear in all
three channels at the same location, skin tones follow predictable R/G/B
ratios, etc. AI deblurring models exploit these correlations as priors.

When channels are processed independently with different kernels, the
correlations are destroyed. The model receives an image where:
- Red edges are at different positions than green edges (different blur radii)
- Color ratios no longer follow natural image statistics
- The model's learned color priors produce incorrect results

---

## 4. Comparison: Effectiveness vs Implementation Cost

| Technique | AI Resistance | CSS-Only? | Canvas Required? | Perf Cost | Complexity |
|---|---|---|---|---|---|
| Higher Gaussian σ (15-20px) | Moderate | Yes | No | None | Trivial |
| Pixelation k≥16 | Very High | Images only | For text | Low | Low |
| Noise injection σ≥25 | Very High | No | Yes | Moderate | Low |
| Median filter r=2 | High | No | Yes | High | Medium |
| Color quantization ≤16 | High | No | Yes | Low | Low |
| Frosted glass | High | SVG filter | No | Low | Medium |
| Channel shuffle + blur | High | No | Yes | Moderate | Medium |
| Compound (blur→median→noise) | Very High | No | Yes | High | High |
| Pixelation + noise | Very High | No | Yes (for text) | Moderate | Low |

---

## 5. Recommended Implementation Priority

### Phase 1: CSS-only improvements (no Canvas)

1. **Raise max blur radius** in settings to 30px (currently 20px max)
2. **Frosted glass mode** via SVG feTurbulence + feDisplacementMap filter
3. Document security levels in popup UI

### Phase 2: Canvas-based modes for images

4. **Pixelation mode** for MEDIA category — Canvas downscale + nearest-neighbor
5. **Noise injection** post-blur — Canvas getImageData + random noise

### Phase 3: Advanced compound modes

6. **Compound pipeline**: Gaussian blur → median filter → noise → quantize
7. **Per-element mode selection** — different techniques per category
8. **Content-aware**: heavier processing for detected text regions

---

## 6. What Doesn't Work (Common Misconceptions)

### "Just increase the blur radius"
Diminishing returns. Gaussian blur at σ=20 is strong against classical
deconvolution but AI models with text priors can still extract fragments.
The fundamental issue is that Gaussian blur is **linear and invertible in
principle** — adding more radius reduces but never eliminates recoverability.

### "Blur twice"
`blur(blur(input, σ₁), σ₂) = blur(input, √(σ₁² + σ₂²))` — multiple
Gaussian passes are equivalent to a single pass with larger radius. Two
blurs of 8px = one blur of ~11.3px. No additional security.

### "Use a very complex CSS filter chain"
`filter: blur(8px) brightness(1.1) contrast(0.9) saturate(0.8)` — all of
these are linear operations. The compound filter is still a linear transfer
function that can be inverted. Only non-linear operations (median,
displacement, quantization) add real security.

### "Hide with opacity"
`opacity: 0.01` — the content is still rendered and accessible in the DOM.
Opacity affects compositing, not the content. Screenshot at the right
exposure adjustment reveals the content.

---

## 7. Real-World Attack Tools

| Tool | What it does | Defeats |
|---|---|---|
| **Depix** (GitHub) | Recovers pixelated text via De Bruijn sequence matching | Pixelation k≤8 with known font |
| **Unredacter** (Bishop Fox) | Brute-force character matching on pixelated screenshots | Pixelation k≤10 with constrained character set |
| **DeblurGAN-v2** | GAN-based image deblurring | Gaussian blur σ≤5, motion blur ≤25px |
| **Restormer** | Transformer-based restoration | Gaussian σ≤8, general degradation |
| **NAFNet** | Efficient deblurring network | Gaussian σ≤8 |
| **CodeFormer** | Face-specific restoration | Heavily degraded faces (uses face prior) |
| **Real-ESRGAN** | Super-resolution (upscaling pixelated images) | Pixelation k≤4-6 |
| **DiffBIR** | Diffusion-based blind restoration | General degradation, moderate blur |
| **Topaz Photo AI** | Commercial ML restoration | Gaussian blur, noise, compression |
| **Remini** | Mobile face restoration app | Blurred/low-res faces |

### Defense-in-depth against these tools

| Tool class | Defeated by |
|---|---|
| Brute-force matching (Depix, Unredacter) | Noise injection (adds entropy beyond matching threshold) |
| Linear deblurring (DeblurGAN, Restormer, NAFNet) | Non-linear step (median filter) OR high σ (≥15) |
| Face-specific (CodeFormer, GFPGAN, Remini) | Displacement (frosted glass) destroys facial geometry |
| Super-resolution (Real-ESRGAN, SwinIR) | Pixelation k≥16 (below Nyquist, cannot reconstruct) |
| Diffusion-based (DiffBIR, StableSR) | Compound pipeline (blur + median + noise + quantize) |
