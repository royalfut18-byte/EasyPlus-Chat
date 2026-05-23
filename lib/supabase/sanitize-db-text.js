const HIGH_SURROGATE_START = 0xd800
const HIGH_SURROGATE_END = 0xdbff
const LOW_SURROGATE_START = 0xdc00
const LOW_SURROGATE_END = 0xdfff

function isHighSurrogate(code) {
  return code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END
}

function isLowSurrogate(code) {
  return code >= LOW_SURROGATE_START && code <= LOW_SURROGATE_END
}

function sanitizeDatabaseText(value) {
  if (typeof value !== 'string' || value.length === 0) return value

  let sanitized = ''
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)

    if (code === 0) continue

    if (isHighSurrogate(code)) {
      const next = value.charCodeAt(i + 1)
      if (isLowSurrogate(next)) {
        sanitized += value[i] + value[i + 1]
        i += 1
      }
      continue
    }

    if (isLowSurrogate(code)) continue

    sanitized += value[i]
  }

  return sanitized
}

function sanitizeJsonForDatabase(value) {
  if (typeof value === 'string') return sanitizeDatabaseText(value)
  if (Array.isArray(value)) return value.map(sanitizeJsonForDatabase)
  if (!value || typeof value !== 'object') return value

  const sanitized = {}
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = sanitizeJsonForDatabase(item)
  }
  return sanitized
}

module.exports = {
  sanitizeDatabaseText,
  sanitizeJsonForDatabase,
}
