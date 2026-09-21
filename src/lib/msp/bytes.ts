/** Little-endian sequential reader over an MSP payload. Throws RangeError when reading past the end. */
export class ByteReader {
  private readonly view: DataView
  private readonly bytes: Uint8Array
  private offset = 0

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset
  }

  u8(): number {
    const value = this.view.getUint8(this.offset)
    this.offset += 1
    return value
  }

  u16(): number {
    const value = this.view.getUint16(this.offset, true)
    this.offset += 2
    return value
  }

  i16(): number {
    const value = this.view.getInt16(this.offset, true)
    this.offset += 2
    return value
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  skip(length: number): void {
    if (length > this.remaining) throw new RangeError('Skip past end of payload')
    this.offset += length
  }

  ascii(length: number): string {
    if (length > this.remaining) throw new RangeError('Read past end of payload')
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return String.fromCharCode(...slice)
  }

  /** String prefixed with its length as a u8. */
  pascalString(): string {
    return this.ascii(this.u8())
  }
}

/** Little-endian growable writer for building MSP payloads. */
export class ByteWriter {
  private readonly data: number[] = []

  u8(value: number): this {
    this.data.push(value & 0xff)
    return this
  }

  u16(value: number): this {
    this.data.push(value & 0xff, (value >> 8) & 0xff)
    return this
  }

  i16(value: number): this {
    return this.u16(value & 0xffff)
  }

  u32(value: number): this {
    this.data.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff)
    return this
  }

  ascii(text: string): this {
    for (let i = 0; i < text.length; i++) this.data.push(text.charCodeAt(i) & 0x7f)
    return this
  }

  pascalString(text: string): this {
    return this.u8(text.length).ascii(text)
  }

  zeros(length: number): this {
    for (let i = 0; i < length; i++) this.data.push(0)
    return this
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.data)
  }
}
