// Lint rules for an avatar-studio script. Pure: file checks go through an `exists(path)` function the caller gives.
// Every issue is { level: 'error' | 'warn', where, rule, message }.
import { FORMATS, FORMAT_NAMES } from './layout.mjs'
import { DEFAULT_COLORS, matchWord, lineWords } from './plan.mjs'

export const SCRIPT_FIELDS = ['format', 'head', 'character', 'label', 'title', 'panel', 'lines', 'end', 'lowerThird', 'colors', 'voice', 'speed', 'lang',
  'pronounce', 'captions', 'captionWords', 'fps', 'seed', 'lead', 'gap', 'tail', 'mouth', 'poster']
export const LINE_FIELDS = ['say', 'points', 'pause', 'voice', 'speed']
export const LIKENESS = ['original', 'licensed', 'real-person-with-consent']
export const LIMITS = { pointWords: 7, pointChars: 56, titleWords: 8, endWords: 8, lineWords: 45, labelChars: 48, labelWarn: 36, nameChars: 40, roleChars: 64 }
const LABEL_WORDS = /computer|generated|synthetic|\bai\b|animated|virtual/i

const issue = (level, where, rule, message) => ({ level, where, rule, message })
const isHex = (c) => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)
const countWords = (s) => String(s || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/** relative luminance of a #rgb or #rrggbb colour (WCAG) */
export function luminance(hex) {
  let h = hex.slice(1)
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

function colorRules(colors, out) {
  const C = { ...DEFAULT_COLORS, ...(colors || {}) }
  for (const [k, v] of Object.entries(colors || {})) {
    if (!(k in DEFAULT_COLORS)) out.push(issue('warn', `colors.${k}`, 'unknown-field', `"${k}" is not a colour avatar-studio uses (${Object.keys(DEFAULT_COLORS).join(', ')})`))
    else if (!isHex(v)) out.push(issue('error', `colors.${k}`, 'color', `"${v}" is not a #rrggbb colour`))
  }
  const pairs = [['ink', 'bg', 'text on the background', 4.5], ['ink', 'card', 'text on a card', 4.5], ['captionText', 'caption', 'caption text', 4.5],
    ['captionWord', 'caption', 'the spoken caption word', 3], ['accent', 'bg', 'accent on the background', 3], ['soft', 'bg', 'soft text on the background', 3]]
  for (const [fg, bg, what, min] of pairs) {
    if (!isHex(C[fg]) || !isHex(C[bg])) continue
    const r = contrast(C[fg], C[bg])
    if (r < min) out.push(issue(r < min * 0.66 ? 'error' : 'warn', `colors.${fg}`, 'contrast', `${what} has contrast ${r.toFixed(1)}:1, needs ${min}:1 to read (${C[fg]} on ${C[bg]})`))
  }
}

function pointRules(script, out) {
  let count = 0
  ;(script.lines || []).forEach((line, li) => {
    if (!line || typeof line !== 'object') return
    if (line.points !== undefined && !Array.isArray(line.points)) { out.push(issue('error', `lines[${li}].points`, 'type', 'points must be a list')); return }
    ;(line.points || []).forEach((p, pi) => {
      const where = `lines[${li}].points[${pi}]`
      count++
      if (!p || typeof p.text !== 'string' || !p.text.trim()) { out.push(issue('error', where, 'point-text', 'a point needs "text"')); return }
      if (!p.at) out.push(issue('error', where, 'point-at', `"${p.text}" needs "at": a word of this line, said when the point should appear`))
      else if (matchWord(lineWords(line.say), p.at) < 0) out.push(issue('error', where, 'point-at', `"at": "${p.at}" is not a word in this line ("${line.say}")`))
      if (countWords(p.text) > LIMITS.pointWords || p.text.length > LIMITS.pointChars) out.push(issue('warn', where, 'point-length', `"${p.text}" is long for the side panel: keep a point to ${LIMITS.pointWords} words`))
    })
  })
  return count
}

/** a head folder inside the project: relative, no "..", no dot-folders */
export function safeHeadPath(head) {
  if (typeof head !== 'string' || !head || head.startsWith('/') || head.includes('\\') || /^[a-z]:/i.test(head)) return false
  return head.split('/').every((part) => part && !part.startsWith('.'))
}

function likenessRules(script, out) {
  const c = script.character
  if (!c || typeof c !== 'object') { out.push(issue('error', 'character', 'likeness', 'say who the character is and where the face comes from: "character": { "name", "role", "likeness": "original" }')); return }
  if (!LIKENESS.includes(c.likeness)) out.push(issue('error', 'character.likeness', 'likeness', `say where the face comes from: one of ${LIKENESS.join(', ')}`))
  if (c.likeness === 'real-person-with-consent' && c.consent !== true) out.push(issue('error', 'character.consent', 'consent', 'the picture shows a real person: set "consent": true only after that person has agreed to this use'))
}

/**
 * All issues for a script. `exists(relativePath)` says whether a file in the project exists.
 * `format` overrides the script's format (as --format does).
 */
export function lintScript(script, { exists = () => true, format } = {}) {
  const out = []
  if (!script || typeof script !== 'object' || Array.isArray(script)) return [issue('error', 'script', 'shape', 'script.json must hold one JSON object')]
  for (const k of Object.keys(script)) if (!SCRIPT_FIELDS.includes(k)) out.push(issue('warn', k, 'unknown-field', `"${k}" is not a script field (${SCRIPT_FIELDS.join(', ')})`))
  const fmt = format || script.format || 'landscape'
  if (!FORMAT_NAMES.includes(fmt)) out.push(issue('error', 'format', 'format', `"${fmt}" is not a format: ${FORMAT_NAMES.join(', ')}`))
  if (!Array.isArray(script.lines) || !script.lines.length) out.push(issue('error', 'lines', 'lines', 'the script needs "lines": [{ "say": "..." }]'))
  ;(Array.isArray(script.lines) ? script.lines : []).forEach((line, li) => {
    const where = `lines[${li}]`
    if (!line || typeof line !== 'object' || !String(line.say || '').trim()) { out.push(issue('error', where, 'say', 'every line needs "say": the words to speak')); return }
    for (const k of Object.keys(line)) if (!LINE_FIELDS.includes(k)) out.push(issue('warn', `${where}.${k}`, 'unknown-field', `"${k}" is not a line field (${LINE_FIELDS.join(', ')})`))
    if (countWords(line.say) > LIMITS.lineWords) out.push(issue('warn', where, 'line-length', `${countWords(line.say)} words in one line: split it so points and nods can follow the sentences`))
    if ((String(line.say).match(/\*/g) || []).length % 2) out.push(issue('warn', where, 'emphasis', 'an odd number of * marks: mark a stressed word like *this*'))
  })
  const count = pointRules(script, out)
  if (FORMATS[fmt] && count > FORMATS[fmt].capacity) out.push(issue('error', 'points', 'capacity', `${count} points, but the ${fmt} side panel holds ${FORMATS[fmt].capacity}`))
  for (const [k, max] of [['title', LIMITS.titleWords], ['end', LIMITS.endWords]]) {
    const v = script[k]
    if (v === undefined) continue
    if (!v || typeof v !== 'object' || typeof v.text !== 'string') out.push(issue('error', k, 'shape', `"${k}" must be { "text": "...", "sub": "..." }`))
    else if (countWords(v.text) > max) out.push(issue('warn', `${k}.text`, 'length', `"${v.text}" is long: keep it to ${max} words`))
  }
  if ('label' in script && (typeof script.label !== 'string' || !script.label.trim())) out.push(issue('error', 'label', 'label', 'the on-screen label cannot be turned off: it tells viewers the character is computer-generated'))
  else if (typeof script.label === 'string' && script.label.length > LIMITS.labelChars) out.push(issue('error', 'label', 'label-length', `the label is ${script.label.length} characters; keep it to ${LIMITS.labelChars} so it fits on every frame (e.g. "Computer-generated character")`))
  else if (typeof script.label === 'string' && script.label.length > LIMITS.labelWarn) out.push(issue('warn', 'label', 'label-length', `the label is ${script.label.length} characters: it will be drawn smaller or on two lines; shorter reads better`))
  if (typeof script.label === 'string' && script.label.trim() && !LABEL_WORDS.test(script.label)) out.push(issue('warn', 'label', 'label', `"${script.label}" should say plainly that the character is computer-generated`))
  likenessRules(script, out)
  colorRules(script.colors, out)
  if (script.speed !== undefined && !(script.speed >= 0.5 && script.speed <= 2)) out.push(issue('error', 'speed', 'speed', 'speed must be between 0.5 and 2'))
  if (script.voice !== undefined && !/^[a-z]{2}_[a-z]+$/.test(script.voice)) out.push(issue('warn', 'voice', 'voice', `"${script.voice}" does not look like a Kokoro voice name (af_heart, am_michael, bf_emma, ...)`))
  if (script.fps !== undefined && ![24, 25, 30, 60].includes(script.fps)) out.push(issue('error', 'fps', 'fps', 'fps must be 24, 25, 30 or 60'))
  if (script.seed !== undefined && !Number.isInteger(script.seed)) out.push(issue('error', 'seed', 'seed', 'seed must be a whole number'))
  for (const k of Object.keys(script.pronounce || {})) { try { new RegExp(k) } catch (e) { out.push(issue('error', `pronounce["${k}"]`, 'pronounce', `not a valid pattern: ${e.message}`)) } }
  const c = script.character && typeof script.character === 'object' ? script.character : {}
  if (typeof c.name === 'string' && c.name.length > LIMITS.nameChars) out.push(issue('warn', 'character.name', 'strap-length', `the name is long for the name strap: keep it to ${LIMITS.nameChars} characters`))
  if (typeof c.role === 'string' && c.role.length > LIMITS.roleChars) out.push(issue('warn', 'character.role', 'strap-length', `the role is long for the name strap: keep it to ${LIMITS.roleChars} characters`))
  const head = script.head ?? 'head'
  if (!safeHeadPath(head)) { out.push(issue('error', 'head', 'head-path', `"head": ${JSON.stringify(head)} must be a folder inside the project (relative, no "..")`)); return out }
  for (const f of ['head.glb', 'head.json']) if (!exists(`${head}/${f}`)) out.push(issue('error', 'head', 'head-files', `${head}/${f} is missing: run "avatar head <project>" or copy a built head there`))
  return out
}

export function formatIssues(issues) {
  if (!issues.length) return 'no problems found'
  return issues.map((i) => `${i.level === 'error' ? 'ERROR' : 'warn '} ${i.where}: ${i.message}`).join('\n')
}
