export type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

/** Anything we can build a read-only byte stream over. */
export type ByteSource =
    | ArrayBuffer
    | SharedArrayBuffer
    | ArrayBufferView
    | { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }
    | number
    | null
    | undefined;

/**
 * DataStreamReaderLite (read-only).
 *
 * Reads scalars, arrays and strings from an ArrayBuffer (or any
 * ArrayBuffer view such as Node.js Buffer / Uint8Array / DataView).
 * Unlike the original DataStream implementation this class never writes,
 * never reallocates and never copies the backing store: all reads are
 * bounds-checked and throw a RangeError on overrun instead of silently
 * clamping, so corrupt files fail loudly at the read site.
 */
export default class DataStreamReaderLite {
    position = 0;
    public endianness: boolean = DataStreamReaderLite.LITTLE_ENDIAN;

    private _bytes: Uint8Array;
    private _view: DataView;

    constructor(arrayBuffer?: ByteSource, byteOffset?: number, endianness?: boolean) {
        if (endianness !== undefined) {
            this.endianness = endianness;
        }
        const extraOffset = byteOffset || 0;
        if (typeof arrayBuffer === 'number') {
            const buf = new ArrayBuffer(arrayBuffer || 1);
            this._bytes = new Uint8Array(buf);
        } else if (
            arrayBuffer instanceof ArrayBuffer ||
            (typeof SharedArrayBuffer !== 'undefined' && arrayBuffer instanceof SharedArrayBuffer)
        ) {
            this._bytes = new Uint8Array(arrayBuffer as ArrayBuffer, extraOffset);
        } else if (ArrayBuffer.isView(arrayBuffer)) {
            const view = arrayBuffer as ArrayBufferView;
            this._bytes = new Uint8Array(view.buffer, view.byteOffset + extraOffset, view.byteLength - extraOffset);
        } else if (typeof arrayBuffer === 'object' && arrayBuffer !== null) {
            const shaped = arrayBuffer as unknown as { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
            this._bytes = new Uint8Array(shaped.buffer, shaped.byteOffset + extraOffset, shaped.byteLength - extraOffset);
        } else {
            this._bytes = new Uint8Array(new ArrayBuffer(1));
        }
        this._view = new DataView(this._bytes.buffer, this._bytes.byteOffset, this._bytes.byteLength);
    }

    /** Big-endian const to use as endianness. */
    static readonly BIG_ENDIAN: boolean = false;

    /** Little-endian const to use as endianness. */
    static readonly LITTLE_ENDIAN: boolean = true;

    /**
     * Native endianness. Either DataStreamReaderLite.BIG_ENDIAN or
     * DataStreamReaderLite.LITTLE_ENDIAN depending on the platform.
     */
    static readonly endianness: boolean = new Int8Array(new Int16Array([1]).buffer)[0] === 1;

    /** Number of readable bytes in this stream. */
    get byteLength(): number {
        return this._bytes.byteLength;
    }

    /** Raw readable bytes (live view, do not mutate). */
    get bytes(): Uint8Array {
        return this._bytes;
    }

    private ensureAvailable(length: number): void {
        if (length < 0 || this.position + length > this._bytes.byteLength) {
            throw new RangeError(
                `DataStream read of ${length} byte(s) at position ${this.position} exceeds buffer length ${this._bytes.byteLength}`
            );
        }
    }

    /**
     * Sets the read position. Values are clamped between 0 and the stream
     * length (historical behavior); use the throwing read methods to detect
     * corrupt offsets.
     */
    seek(pos: number): void {
        const npos = Math.max(0, Math.min(this._bytes.byteLength, pos));
        this.position = isNaN(npos) || !isFinite(npos) ? 0 : npos;
    }

    /** True when the read pointer is at (or past) the end of the buffer. */
    isEof(): boolean {
        return this.position >= this._bytes.byteLength;
    }

    /**
     * Returns a copy of the next `length` bytes.
     * (The historical name is kept; unlike the original this returns a copy,
     * never a live mapping into a growable buffer.)
     */
    mapUint8Array(length: number): Uint8Array {
        this.ensureAvailable(length);
        const copy = this._bytes.slice(this.position, this.position + length);
        this.position += length;
        return copy;
    }

    /** Reads a 16-bit int at the given absolute offset. */
    readShort(offset: number): number {
        this.seek(offset);
        return this.readInt16();
    }

    /** Reads an 8-bit int at the given absolute offset. */
    readByte(offset: number): number {
        this.seek(offset);
        return this.readInt8();
    }

    /** Reads a UCS-2 string of `length` characters at the given absolute offset. */
    readStringAt(offset: number, length: number): string {
        this.seek(offset);
        return this.readUCS2String(length);
    }

    /** Reads a 32-bit int at the given absolute offset. */
    readInt(offset: number): number {
        this.seek(offset);
        return this.readInt32();
    }

    /**
     * Reads an Int32Array of the desired length and endianness.
     * Uses a bulk copy on little-endian platforms, per-element DataView
     * reads otherwise, so the result is correct regardless of platform.
     */
    readInt32Array(length: number, e?: boolean): Int32Array {
        const littleEndian = e == null ? this.endianness : e;
        const remaining = Math.floor((this._bytes.byteLength - this.position) / 4);
        const count = length == null ? remaining : length;
        this.ensureAvailable(count * 4);
        const arr = new Int32Array(count);
        if (littleEndian === (DataStreamReaderLite.endianness as boolean)) {
            arr.set(new Int32Array(this._bytes.buffer, this._bytes.byteOffset + this.position, count));
            this.position += arr.byteLength;
        } else {
            for (let i = 0; i < count; i++) {
                arr[i] = this.readInt32(littleEndian);
            }
        }
        return arr;
    }

    /** Reads an Int8Array of the desired length. */
    readInt8Array(length: number): Int8Array {
        const remaining = this._bytes.byteLength - this.position;
        const count = length == null ? remaining : length;
        this.ensureAvailable(count);
        const arr = new Int8Array(count);
        arr.set(new Int8Array(this._bytes.buffer, this._bytes.byteOffset + this.position, count));
        this.position += arr.byteLength;
        return arr;
    }

    /** Reads a Uint16Array of the desired length and endianness. */
    readUint16Array(length: number, e?: boolean): Uint16Array {
        const littleEndian = e == null ? this.endianness : e;
        const remaining = Math.floor((this._bytes.byteLength - this.position) / 2);
        const count = length == null ? remaining : length;
        this.ensureAvailable(count * 2);
        const arr = new Uint16Array(count);
        if (littleEndian === (DataStreamReaderLite.endianness as boolean)) {
            arr.set(new Uint16Array(this._bytes.buffer, this._bytes.byteOffset + this.position, count));
            this.position += arr.byteLength;
        } else {
            for (let i = 0; i < count; i++) {
                arr[i] = this.readUint16(littleEndian);
            }
        }
        return arr;
    }

    /** Reads a Uint8Array copy of the desired length. */
    readUint8Array(length: number): Uint8Array {
        const remaining = this._bytes.byteLength - this.position;
        const count = length == null ? remaining : length;
        this.ensureAvailable(count);
        const copy = this._bytes.slice(this.position, this.position + count);
        this.position += count;
        return copy;
    }

    /** Reads a 32-bit int with the desired endianness. */
    readInt32(e?: boolean): number {
        this.ensureAvailable(4);
        const v = this._view.getInt32(this.position, e == null ? this.endianness : e);
        this.position += 4;
        return v;
    }

    /** Reads an unsigned 32-bit int with the desired endianness. */
    readUint32(e?: boolean): number {
        this.ensureAvailable(4);
        const v = this._view.getUint32(this.position, e == null ? this.endianness : e);
        this.position += 4;
        return v;
    }

    /** Reads a 16-bit int with the desired endianness. */
    readInt16(e?: boolean): number {
        this.ensureAvailable(2);
        const v = this._view.getInt16(this.position, e == null ? this.endianness : e);
        this.position += 2;
        return v;
    }

    /** Reads an unsigned 16-bit int with the desired endianness. */
    readUint16(e?: boolean): number {
        this.ensureAvailable(2);
        const v = this._view.getUint16(this.position, e == null ? this.endianness : e);
        this.position += 2;
        return v;
    }

    /** Reads an 8-bit int. */
    readInt8(): number {
        this.ensureAvailable(1);
        const v = this._view.getInt8(this.position);
        this.position += 1;
        return v;
    }

    /** Reads an unsigned 8-bit int. */
    readUint8(): number {
        this.ensureAvailable(1);
        const v = this._view.getUint8(this.position);
        this.position += 1;
        return v;
    }

    /**
     * Copies byteLength bytes from the src buffer at srcOffset to the
     * dst buffer at dstOffset.
     */
    static memcpy(dst: ArrayBufferLike, dstOffset: number, src: ArrayBufferLike, srcOffset: number, byteLength: number): void {
        const dstU8 = new Uint8Array(dst, dstOffset, byteLength);
        const srcU8 = new Uint8Array(src, srcOffset, byteLength);
        dstU8.set(srcU8);
    }

    /**
     * Creates a string from an array of character codes, chunk by chunk.
     */
    static createStringFromArray(array: TypedArray): string {
        const chunkSize = 0x8000;
        const chunks: string[] = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(String.fromCharCode.apply(null, Array.from(array.subarray(i, i + chunkSize)) as number[]));
        }
        return chunks.join('');
    }

    /** Reads a UCS-2/UTF-16LE string of `length` characters. */
    readUCS2String(length: number, endianness?: boolean): string {
        return DataStreamReaderLite.createStringFromArray(this.readUint16Array(length, endianness));
    }

    /**
     * Reads a string of `length` bytes. Defaults to single-byte
     * (windows-1252, ASCII-compatible) decoding; any other TextDecoder
     * encoding label may be passed explicitly.
     */
    readString(length: number, encoding?: string): string {
        if (encoding == null || encoding === 'ASCII') {
            const count = length == null ? this._bytes.byteLength - this.position : length;
            return DataStreamReaderLite.createStringFromArray(this.mapUint8Array(count));
        }
        return new TextDecoder(encoding).decode(this.mapUint8Array(length));
    }
}
