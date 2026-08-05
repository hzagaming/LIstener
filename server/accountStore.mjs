import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'

const scrypt = promisify(scryptCallback)
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }

export const sessionTokenHash = (token) => createHash('sha256').update(token).digest('hex')

export const hashPassword = async (password) => {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) throw new Error('invalid password')
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64, SCRYPT_OPTIONS)
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`
}

export const verifyPassword = async (password, encoded) => {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false
  const [algorithm, saltValue, hashValue, extra] = encoded.split('$')
  if (algorithm !== 'scrypt' || !saltValue || !hashValue || extra) return false
  try {
    const expected = Buffer.from(hashValue, 'base64url')
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length, SCRYPT_OPTIONS))
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export const createAccountStore = ({ filename, now = Date.now } = {}) => {
  if (typeof filename !== 'string' || !filename.trim()) throw new Error('database filename is required')
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const database = new Database(filename, { timeout: 5_000 })
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  if (filename !== ':memory:') database.pragma('journal_mode = WAL')
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS user_states (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  const insertUser = database.prepare('INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
  const findUserByEmail = database.prepare('SELECT id, email, password_hash AS passwordHash FROM users WHERE email = ?')
  const insertSession = database.prepare('INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
  const selectSession = database.prepare(`
    SELECT users.id, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `)
  const deleteSession = database.prepare('DELETE FROM sessions WHERE token_hash = ?')
  const deleteExpiredSessions = database.prepare('DELETE FROM sessions WHERE expires_at <= ?')
  const selectState = database.prepare('SELECT state_json AS stateJson, revision, updated_at AS updatedAt FROM user_states WHERE user_id = ?')
  const insertState = database.prepare(`
    INSERT INTO user_states (user_id, state_json, revision, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, revision = excluded.revision, updated_at = excluded.updated_at
  `)

  const getUserState = (userId) => {
    const row = selectState.get(userId)
    return row
      ? { state: JSON.parse(row.stateJson), revision: row.revision, updatedAt: row.updatedAt }
      : { state: null, revision: 0, updatedAt: null }
  }
  const saveTransaction = database.transaction((userId, state, expectedRevision) => {
    const current = getUserState(userId)
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw Object.assign(new Error('user state changed on another device'), { code: 'STATE_CONFLICT', current })
    }
    const updatedAt = now()
    const revision = current.revision + 1
    insertState.run(userId, JSON.stringify(state), revision, updatedAt)
    return { state, revision, updatedAt }
  })

  return {
    createUser(email, passwordHash) {
      const normalizedEmail = email.trim().toLocaleLowerCase()
      const timestamp = now()
      const user = { id: randomUUID(), email: normalizedEmail }
      try {
        insertUser.run(user.id, user.email, passwordHash, timestamp, timestamp)
      } catch (error) {
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') throw Object.assign(new Error('account already exists'), { code: 'ACCOUNT_EXISTS' })
        throw error
      }
      return user
    },
    findUserByEmail(email) { return findUserByEmail.get(email.trim().toLocaleLowerCase()) ?? null },
    createSession(userId, tokenHash, expiresAt) {
      deleteExpiredSessions.run(now())
      insertSession.run(tokenHash, userId, now(), expiresAt)
    },
    findSession(tokenHash) { return selectSession.get(tokenHash, now()) ?? null },
    deleteSession(tokenHash) { deleteSession.run(tokenHash) },
    getUserState,
    saveUserState(userId, state, expectedRevision) { return saveTransaction.immediate(userId, state, expectedRevision) },
    close() { if (database.open) database.close() },
  }
}
