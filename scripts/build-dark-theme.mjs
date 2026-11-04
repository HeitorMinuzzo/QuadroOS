// Generates src/dark.generated.css from the light stylesheets.
//
// Every colour-bearing declaration is repeated, in the original order and layer, under
// :where(:root[data-theme='dark']), which adds no specificity. The cascade therefore resolves
// exactly as in the light theme; only the colours change:
//   - light backgrounds become dark surfaces (lighter in light = darker in dark),
//   - dark text becomes light text, light borders become dark borders,
//   - saturated mid-tone colours (status labels, group colours, primary) stay as they are.
// Run `npm run theme:dark` after changing colours in the light stylesheets.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = [
  'theme.css',
  'styles.css',
  'workflow.css',
  'controls.css',
  'automations.css',
  'interface.css',
  'column-values.css',
  'task-updates.css',
  'refresh.css',
]
const SCOPE = ":where(:root[data-theme='dark'])"

// ---------- colour maths (sRGB <-> OKLab) ----------
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
function rgbToOklch([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), Math.atan2(B, A)]
}
function oklchToRgb([L, C, h]) {
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255))
}
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] }
function parse(token) {
  const named = NAMED[token.toLowerCase()]
  if (named) return named
  if (token.startsWith('oklch(')) {
    const [l, c, hue, a] = token
      .slice(6, -1)
      .split(/[\s/]+/)
      .filter(Boolean)
      .map((p) => (p.endsWith('%') ? Number(p.slice(0, -1)) / 100 : Number(p)))
    return [...oklchToRgb([l, c, ((hue || 0) * Math.PI) / 180]), a ?? 1]
  }
  if (token.startsWith('#')) {
    let hex = token.slice(1)
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('')
    const n = (i) => parseInt(hex.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1]
  }
  const parts = token
    .match(/[\d.]+%?/g)
    ?.map((p) => (p.endsWith('%') ? Number(p.slice(0, -1)) / 100 : Number(p)))
  if (!parts || parts.length < 3) return null
  return [parts[0], parts[1], parts[2], parts[3] ?? 1]
}
function format([r, g, b], alpha) {
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
  return alpha >= 1
    ? hex
    : hex +
        Math.round(alpha * 255)
          .toString(16)
          .padStart(2, '0')
}

const SLATE = (275 * Math.PI) / 180
// kind: 'surface' | 'ink' | 'line'
function darken(token, kind) {
  const rgba = parse(token)
  if (!rgba) return token
  const alpha = rgba[3]
  const [L, C, h] = rgbToOklch(rgba)
  if (kind === 'ink') {
    if (L > 0.62 || alpha < 0.45) return token
    // Near-black text becomes near-white; muted greys and coloured text stay distinguishable.
    return format(oklchToRgb([Math.min(0.95, 1 - L * 0.5), Math.min(C, 0.16), h]), alpha)
  }
  if (L < 0.75 || alpha < 0.8) return token
  // Neutral greys get the slate tint of the app rail; light tints keep a muted version of their hue.
  const [chroma, hue] = C < 0.012 ? [0.014, SLATE] : [Math.min(C, 0.07) * 0.75, h]
  if (kind === 'line') return format(oklchToRgb([0.33 + (1 - L) * 0.55, chroma, hue]), alpha)
  // Surfaces: white maps to the darkest panel, slightly darker greys map a step lighter.
  return format(oklchToRgb([0.215 + (1 - L) * 0.95, chroma, hue]), alpha)
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\boklch\([^)]*\)|\b(?:white|black)\b/g
function mapValue(value, kind) {
  // The primary blue is tuned for white text on buttons; as a text colour on dark surfaces it
  // needs the lighter --primary-text defined in src/dark.css.
  const mapped = kind === 'ink' ? value.replace(/var\(--primary\)/g, 'var(--primary-text)') : value
  return mapped.replace(COLOR, (token) => darken(token, kind))
}
function kindFor(prop) {
  if (prop.startsWith('--')) {
    if (/(ink|text|foreground|fg|font)/.test(prop) || /[a-z]-muted$/.test(prop)) return 'ink'
    if (/(border|line|ring|focus|outline|divider)/.test(prop)) return 'line'
    if (/shadow/.test(prop)) return 'shadow'
    return 'surface'
  }
  if (
    prop === 'color' ||
    prop === 'fill' ||
    prop === 'stroke' ||
    prop === 'caret-color' ||
    prop === '-webkit-text-fill-color' ||
    prop === 'text-decoration-color'
  )
    return 'ink'
  if (prop.startsWith('border') || prop.startsWith('outline') || prop === 'column-rule')
    return 'line'
  if (prop === 'box-shadow') return 'shadow'
  if (prop === 'background' || prop === 'background-color' || prop === 'background-image')
    return 'surface'
  return null
}
function mapShadow(value) {
  // Light glows and focus rings become dark tints; dark drop shadows are kept as they are.
  return value.replace(COLOR, (token) => darken(token, 'surface'))
}

function scopeSelector(selector) {
  return selector
    .split(',')
    .map((part) => {
      const s = part.trim()
      if (s === ':root') return ":root:where([data-theme='dark'])"
      if (s.startsWith(':root')) return `:root:where([data-theme='dark'])${s.slice(5)}`
      if (s === 'html' || s.startsWith('html ') || s.startsWith('html:') || s.startsWith('html['))
        return `html:where([data-theme='dark'])${s.slice(4)}`
      return `${SCOPE} ${s}`
    })
    .join(', ')
}

function convertContainer(container, out) {
  container.each((node) => {
    if (node.type === 'rule') {
      if (node.parent?.type === 'atrule' && /keyframes$/i.test(node.parent.name)) return
      const decls = []
      node.each((child) => {
        if (child.type !== 'decl') return
        const kind = kindFor(child.prop)
        if (!kind) return
        const value = kind === 'shadow' ? mapShadow(child.value) : mapValue(child.value, kind)
        decls.push(postcss.decl({ prop: child.prop, value, important: child.important }))
      })
      if (decls.length)
        out.append(postcss.rule({ selector: scopeSelector(node.selector), nodes: decls }))
    } else if (node.type === 'atrule') {
      if (
        /keyframes$|font-face|import|custom-variant|theme|tailwind|source|plugin/i.test(node.name)
      )
        return
      if (!node.nodes) return
      const copy = postcss.atRule({ name: node.name, params: node.params })
      convertContainer(node, copy)
      if (copy.nodes?.length) out.append(copy)
    }
  })
}

const output = postcss.root()
for (const file of FILES) {
  const source = readFileSync(join(root, 'src', file), 'utf8')
  const parsed = postcss.parse(source, { from: file })
  const section = postcss.root()
  convertContainer(parsed, section)
  if (!section.nodes.length) continue
  output.append(postcss.comment({ text: ` from ${file} ` }))
  output.append(section.nodes)
}
const header =
  '/* Generated by scripts/build-dark-theme.mjs from the light stylesheets. Do not edit by hand:\n   run `npm run theme:dark`. Hand-tuned dark rules live in src/dark.css. */\n'
writeFileSync(join(root, 'src', 'dark.generated.css'), header + output.toString() + '\n')
console.log(`dark.generated.css: ${output.nodes.length} blocks`)
