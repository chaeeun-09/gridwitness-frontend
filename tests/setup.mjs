const values = new Map()
globalThis.localStorage = {
  get length() { return values.size },
  getItem(key) { return values.get(String(key)) ?? null },
  setItem(key, value) { values.set(String(key), String(value)) },
  removeItem(key) { values.delete(String(key)) },
  clear() { values.clear() },
  key(index) { return [...values.keys()][index] ?? null },
}
const events = new EventTarget()
globalThis.window = events
globalThis.location = { hostname: 'localhost', origin: 'http://localhost:5173', pathname: '/', reload() {} }
window.location = location
window.localStorage = localStorage
globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible', hidden: false })
window.navigator = globalThis.navigator
window.document = globalThis.document
globalThis.fetch = async () => { throw new TypeError('Test transport is offline; install a request fixture for this test.') }
