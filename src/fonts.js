/**
 * fonts.js — Embedded font assets for text-masking modes.
 *
 * DISC font (text-security-disc, noppa/text-security — OFL-1.1):
 *   Maps every Unicode codepoint to a filled disc glyph (●) via cmap format 13.
 *   Used as "bl-si-redact-disc" for blur-all `masked` mode.
 *   784 bytes WOFF2.
 *
 * ASTERISK font (generated with fontTools — OFL-1.1):
 *   Maps every BMP codepoint to a 6-arm asterisk (*) glyph via cmap format 4.
 *   Used as "bl-si-redact-asterisk" for PII `asterisked` mode.
 *   372 bytes WOFF2.
 *
 * Both are base64-encoded inline to avoid cross-origin issues in injected stylesheets.
 *
 * Exposed as blsi.Fonts (IIFE — no ES module syntax).
 */

const BlurrySiteFonts = (() => {
  "use strict";

  const DISC_B64 =
    "d09GMgABAAAAAAMQAAoAAAAACAAAAALIAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAAggAKcHILBgABNgIkAwYEIAWJSAcvG0gHEZWcjBRfHNjNPraIGU7SkQoTFkXoFRjv8FUcbDmIj4fv117P3fcRQioFRseKQUaWwJVVVVWlqUSWQCqzAXDOVp+vqsnVapWIlhw7yBoEhhMnHFYCHMKOvkR03bf6e9V3k5C0pdB3/e9T0qkd4MMPltYAwwl4rBdKBw5Q6WQJiMe2JfXQzxqDHiJHyBCRoyWk9D0eokh2Ww9se/9MHLHYawD4n5f/Ls/b722ATVs377KRPE9jOdKY88cWRA5gIghJDQ1N8AfoA89ygvcYf4pg/Ec+TgiEgQwZEhIKKKCIIkoooYwyKqigiipqqKGOOhpooIkmWmihjTY66PxOyEABGSZiKqAAQnQ6B6/n1u98x4262u0Js8WuS9OPfJk+/cuR6bOAtTcIJOZcuOuj7bV/Kyl9h9f38fFYbrefcSYrI8lAQDMUDxExOyyGlfQ/vVsg0xGArgJ1t5MoVLEcA2Gq5ci0HECy2rnswoOiU55kl1xUjEQJdXtiFM3sEWm9lqWFmgZbjP05LRVBvbqdHux9wpyGnbGWEX6p5JEHp+lXirTnJ5QhZa5Rrsq9D67r+24QRrdzndcmBzUrQ9xXb6hp/3Kt1h1kLEFUI/CLVKdW/dqtdrVRNqpIyLr2KxU5WYVXmZuskh+VXqlluyjNMNPGBGcj6JOF0MC+M9Ucc48RhDxCB6QQzssN7C3m8bmbGCrG7VXU5FY+yGdUakVOvwKllMExtmsLwzMsVQFGpi5UbHxfXhb762Voh6fTcKeW03OxxicY73eTpa8bxhIzeWR+wnoJ6j/4kBejs2xf69j7pOSUzmzPCqNy4cojtlsLwpBhb++AtcBHQcpyGZgkYrGUBTwXn2/RF12BjlQTI1XSvANELqO18DPB+UIyNkJSZBsoX7wh7DlfsyVfTshpuSjLSv9H3fwD+a36nwAAkBFZ5aSOqp+7Bg==";

  const ASTERISK_B64 =
    "d09GMgABAAAAAAFoAAoAAAAAAswAAAEhAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAAKApYWgE2AiQDBgsGAAQgBYEKByYbEQJArwd4Qwv101asdOGiWkTh4TWsoo45lX90RNWqZfXM/TzfHx57DqGxnJBgsWiPFKB36mZ7AWebsK3/zW2YhhB33nnp8yXbvAE6CJPnCjJtVoArxKtw/nVyfKKD+LckcGx5kkgQZphTLmnLipPT4fqLWmXoRjoxwHIiwtWwXQ1oV34B8ofBFYhmjjXr4AwQXDFEQIGOji2cADqI1tHBi6SwI1LyuEjwysj//awmcxqetLfbdQQE4ccl+1/4B9/318wdU8uCpkDYaFG9I4aLugAAUhni2xOUNQ0UAAC6VwGxj4Aysa9JZ5F4cdbBsuFtNVh7a21lAfLDAvtRXoW9k/oEAg0sX1qWT6UCkDtYPuwOpU1r1wuUaqcBsMFEE18H";

  const DISC_FONT_FACE =
    `@font-face {` +
    ` font-family: "bl-si-redact-disc";` +
    ` src: url("data:font/woff2;base64,${DISC_B64}") format("woff2");` +
    ` font-display: block;` +
    `}`;

  const ASTERISK_FONT_FACE =
    `@font-face {` +
    ` font-family: "bl-si-redact-asterisk";` +
    ` src: url("data:font/woff2;base64,${ASTERISK_B64}") format("woff2");` +
    ` font-display: block;` +
    `}`;

  return Object.freeze({ DISC_FONT_FACE, ASTERISK_FONT_FACE });
})();

blsi.Fonts = BlurrySiteFonts;
