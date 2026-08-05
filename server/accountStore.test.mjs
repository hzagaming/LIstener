import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccountStore, hashPassword, verifyPassword } from './accountStore.mjs'

test('stores users, hashed sessions, and revisioned state in SQLite', async () => {
  const store = createAccountStore({ filename: ':memory:', now: () => 1_700_000_000_000 })
  try {
    const passwordHash = await hashPassword('correct horse battery staple')
    assert.equal(await verifyPassword('correct horse battery staple', passwordHash), true)
    assert.equal(await verifyPassword('wrong password', passwordHash), false)

    const user = store.createUser('User@Example.com', passwordHash)
    assert.equal(user.email, 'user@example.com')
    assert.throws(() => store.createUser('user@example.com', passwordHash), /already exists/)

    store.createSession(user.id, 'token-hash', 1_700_000_100_000)
    assert.equal(store.findSession('token-hash')?.email, 'user@example.com')
    assert.equal(store.findSession('expired-token'), null)

    assert.deepEqual(store.getUserState(user.id), { state: null, revision: 0, updatedAt: null })
    const first = store.saveUserState(user.id, { version: 1, liked: [] }, 0)
    assert.equal(first.revision, 1)
    assert.throws(
      () => store.saveUserState(user.id, { version: 1, liked: [] }, 0),
      (error) => error?.code === 'STATE_CONFLICT' && error.current.revision === 1,
    )
    store.deleteSession('token-hash')
    assert.equal(store.findSession('token-hash'), null)
  } finally {
    store.close()
  }
})
