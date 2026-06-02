import 'server-only'

export function readServerEnv(name: string): string | undefined {
  const raw = process.env[name]
  if (raw == null) return undefined

  let value = raw.trim()
  for (let i = 0; i < 2; i += 1) {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim()
    }
  }

  return value && value !== '""' && value !== "''" ? value : undefined
}

export function getServerEnvStatus(name: string): { exists: boolean; configured: boolean } {
  return {
    exists: Object.prototype.hasOwnProperty.call(process.env, name),
    configured: Boolean(readServerEnv(name)),
  }
}

export function readFirstServerEnv(names: string[]): { value?: string; source?: string } {
  for (const name of names) {
    const value = readServerEnv(name)
    if (value) return { value, source: name }
  }
  return {}
}
