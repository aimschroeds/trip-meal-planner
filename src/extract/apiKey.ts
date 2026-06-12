// Deliberately localStorage, NOT Dexie: the Backup tab exports every Dexie
// table to a JSON file, and the API key must never end up inside a backup.
const STORAGE_KEY = 'anthropic-api-key'

export function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key.trim())
}

export function clearApiKey(): void {
  localStorage.removeItem(STORAGE_KEY)
}
