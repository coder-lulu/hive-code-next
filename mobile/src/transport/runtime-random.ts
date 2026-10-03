import { getRandomBytes } from 'expo-crypto'

export function mobileRuntimeRandomBytes(length: number): Uint8Array {
  return new Uint8Array(getRandomBytes(length))
}
