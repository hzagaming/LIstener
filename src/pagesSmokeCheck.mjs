import { pathToFileURL } from 'node:url'

const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1]

export const inspectPageHtml = (html, pageUrl) => {
  if (/<script\b[^>]*\bsrc=["'][^"']*\/src\/[^"']+\.(?:jsx?|tsx?)["']/i.test(html)) {
    throw new Error('deployed page exposes a source entry instead of a production bundle')
  }

  const page = new URL(pageUrl)
  const resources = []
  for (const tag of html.match(/<(?:link|script)\b[^>]*>/gi) ?? []) {
    const rel = attribute(tag, 'rel')?.toLowerCase() ?? ''
    const type = tag.startsWith('<script') ? 'script' : rel.includes('stylesheet') ? 'stylesheet' : rel.includes('icon') ? 'icon' : ''
    const value = attribute(tag, type === 'script' ? 'src' : 'href')
    if (!type || !value) continue
    const resource = new URL(value, page)
    if (resource.origin !== page.origin || !resource.pathname.startsWith(page.pathname)) {
      throw new Error(`${type} is outside the deployed project path: ${resource.href}`)
    }
    resources.push({ type, url: resource.href })
  }

  for (const type of ['icon', 'script', 'stylesheet']) {
    if (!resources.some((resource) => resource.type === type)) throw new Error(`deployed page is missing its ${type}`)
  }
  return resources
}

export const verifyPage = async (pageUrl, fetchPage = fetch) => {
  const page = new URL(pageUrl)
  page.searchParams.set('pages-check', Date.now().toString())
  const response = await fetchPage(page, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${page.pathname} returned ${response.status}`)
  if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('deployed page has an invalid HTML content type')

  const resources = inspectPageHtml(await response.text(), pageUrl)
  const expectedTypes = { icon: /^image\//, script: /javascript/, stylesheet: /text\/css/ }
  await Promise.all(resources.map(async (resource) => {
    const asset = await fetchPage(resource.url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(10_000) })
    if (!asset.ok) throw new Error(`${new URL(resource.url).pathname} returned ${asset.status}`)
    const contentType = asset.headers.get('content-type') ?? ''
    if (!expectedTypes[resource.type].test(contentType)) throw new Error(`${resource.type} has invalid content type: ${contentType || 'missing'}`)
  }))
  return resources
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entry) {
  const pageUrl = process.argv[2]
  if (!pageUrl) throw new Error('usage: node src/pagesSmokeCheck.mjs <pages-url>')
  const delay = Number(process.env.PAGES_VERIFY_DELAY_MS ?? 0)
  if (Number.isFinite(delay) && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
  const resources = await verifyPage(pageUrl)
  console.log(`Verified ${pageUrl} and ${resources.length} critical resources`)
}
