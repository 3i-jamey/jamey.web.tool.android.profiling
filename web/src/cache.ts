import type { FactPack } from './types'

const DATABASE = 'trace-difference'
const STORE = 'fact-packs'
const LAST = 'last'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function cacheFactPack(pack: FactPack) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(pack, LAST)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

export async function loadCachedFactPack() {
  const database = await openDatabase()
  const pack = await new Promise<FactPack | undefined>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(LAST)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  database.close()
  return pack
}
