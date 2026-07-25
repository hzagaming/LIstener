const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason)
  const onAbort = () => {
    clearTimeout(timer)
    reject(signal.reason)
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort)
    resolve()
  }, milliseconds)
  signal?.addEventListener('abort', onAbort, { once: true })
})

const withAbort = (promise, signal) => {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

export const createRequestScheduler = ({
  minIntervalMs = 0,
  now = Date.now,
  waitImpl = wait,
} = {}) => {
  const interval = Number(minIntervalMs)
  if (!Number.isFinite(interval) || interval < 0 || interval > 2_147_483_647) {
    throw new Error('valid request interval is required')
  }
  let nextRequestAt = 0
  let queue = Promise.resolve()

  return (operation, signal) => {
    if (signal?.aborted) return Promise.reject(signal.reason)
    const acquire = async () => {
      if (signal?.aborted) throw signal.reason
      const delay = Math.max(0, nextRequestAt - now())
      if (delay) {
        await withAbort(Promise.resolve().then(() => waitImpl(delay, signal)), signal)
      }
      if (signal?.aborted) throw signal.reason
      nextRequestAt = now() + interval
    }
    const permit = queue.then(acquire, acquire)
    queue = permit.catch(() => undefined)
    const scheduled = permit.then(() => {
      if (signal?.aborted) throw signal.reason
      return operation()
    })
    return withAbort(scheduled, signal)
  }
}
