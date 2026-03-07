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

/**
 * DataStreamReaderLite
 *  reads scalars, arrays and structs of data from an ArrayBuffer.
 * It's like a file-like DataView on steroids.
 *
 * @param {ArrayBuffer} arrayBuffer ArrayBuffer to read from.
 * @param {?Number} byteOffset Offset from arrayBuffer beginning for the DataStreamReaderLite
 * .
 * @param {?Boolean} endianness DataStreamReaderLite
 * .BIG_ENDIAN or DataStreamReaderLite
 * .LITTLE_ENDIAN (the default).
 */
export default class DataStreamReaderLite {
    private _byteOffset: number;
    position = 0;
    private _buffer: ArrayBufferLike;
    private _dataView: DataView;

    constructor(
        arrayBuffer?: ArrayBuffer | { buffer: ArrayBuffer; byteOffset: number; byteLength: number },
        byteOffset?: number,
        public endianness: boolean = DataStreamReaderLite.LITTLE_ENDIAN
    ) {
        this._byteOffset = byteOffset || 0;
        if (arrayBuffer instanceof ArrayBuffer) {
            this.buffer = arrayBuffer;
        } else if (typeof arrayBuffer === 'object') {
            this.dataView = arrayBuffer as any;
            if (byteOffset) {
                this._byteOffset += byteOffset;
            }
        } else {
            this.buffer = new ArrayBuffer(arrayBuffer || 1);
        }
    }

    /**
     * Big-endian const to use as default endianness.
     * @type {boolean}
     */
    static readonly BIG_ENDIAN: boolean = false;

    /**
     * Little-endian const to use as default endianness.
     * @type {boolean}
     */
    static readonly LITTLE_ENDIAN: boolean = true;

    /**
     * Whether to extend DataStreamReaderLite
     *  buffer when trying to write beyond its size.
     * If set, the buffer is reallocated to twice its current size until the
     * requested write fits the buffer.
     * @type {boolean}
     */
    private _dynamicSize: boolean = true;
    get dynamicSize(): boolean {
        return this._dynamicSize;
    }

    set dynamicSize(v: boolean) {
        if (!v) {
            this._trimAlloc();
        }
        this._dynamicSize = v;
    }

    /**
     * Virtual byte length of the DataStreamReaderLite
     *  backing buffer.
     * Updated to be max of original buffer size and last written size.
     * If dynamicSize is false is set to buffer size.
     * @type {number}
     */
    private _byteLength: number = 0;

    /**
     * Returns the byte length of the DataStreamReaderLite
     *  object.
     * @type {number}
     */
    get byteLength(): number {
        return this._byteLength - this._byteOffset;
    }

    /**
     * Set/get the backing ArrayBuffer of the DataStreamReaderLite
     *  object.
     * The setter updates the DataView to point to the new buffer.
     * @type {Object}
     */
    get buffer(): ArrayBufferLike {
        this._trimAlloc();
        return this._buffer;
    }

    set buffer(v: ArrayBuffer) {
        this._buffer = v;
        this._dataView = new DataView(this._buffer, this._byteOffset);
        this._byteLength = this._buffer.byteLength;
    }

    /**
     * Set/get the byteOffset of the DataStreamReaderLite
     *  object.
     * The setter updates the DataView to point to the new byteOffset.
     * @type {number}
     */
    get byteOffset(): number {
        return this._byteOffset;
    }

    set byteOffset(v: number) {
        this._byteOffset = v;
        this._dataView = new DataView(this._buffer, this._byteOffset);
        this._byteLength = this._buffer.byteLength;
    }

    /**
     * Set/get the backing DataView of the DataStreamReaderLite
     *  object.
     * The setter updates the buffer and byteOffset to point to the DataView values.
     * @type get: DataView, set: {buffer: ArrayBuffer, byteOffset: number, byteLength: number}
     */
    get dataView(): DataView {
        return this._dataView;
    }

    set dataView(v: DataView) {
        this._byteOffset = v.byteOffset;
        this._buffer = v.buffer;
        this._dataView = new DataView(this._buffer, this._byteOffset);
        this._byteLength = this._byteOffset + v.byteLength;
    }

    /**
     * Internal function to resize the DataStreamReaderLite
     *  buffer when required.
     * @param {number} extra Number of bytes to add to the buffer allocation.
     * @return {null}
     */
    private _realloc(extra: number): null {
        if (!this._dynamicSize) {
            return;
        }
        const req = this._byteOffset + this.position + extra;
        let blen = this._buffer.byteLength;
        if (req <= blen) {
            if (req > this._byteLength) {
                this._byteLength = req;
            }
            return;
        }
        if (blen < 1) {
            blen = 1;
        }
        while (req > blen) {
            blen *= 2;
        }
        const buf = new ArrayBuffer(blen);
        const src = new Uint8Array(this._buffer);
        const dst = new Uint8Array(buf, 0, src.length);
        dst.set(src);
        this.buffer = buf;
        this._byteLength = req;
    }

    /**
     * Internal function to trim the DataStreamReaderLite
     *  buffer when required.
     * Used for stripping out the extra bytes from the backing buffer when
     * the virtual byteLength is smaller than the buffer byteLength (happens after
     * growing the buffer with writes and not filling the extra space completely).
     * @return {null}
     */
    private _trimAlloc(): void {
        if (this._byteLength === this._buffer.byteLength) {
            return;
        }
        const buf = new ArrayBuffer(this._byteLength);
        const dst = new Uint8Array(buf);
        const src = new Uint8Array(this._buffer, 0, dst.length);
        dst.set(src);
        this.buffer = buf;
    }

    /**
     * Sets the DataStreamReaderLite
     *  read/write position to given position.
     * Clamps between 0 and DataStreamReaderLite
     *  length.
     * @param {number} pos Position to seek to.
     * @return {null}
     */
    seek(pos: number): void {
        const npos = Math.max(0, Math.min(this.byteLength, pos));
        this.position = isNaN(npos) || !isFinite(npos) ? 0 : npos;
    }

    /**
     * Returns true if the DataStreamReaderLite
     *  seek pointer is at the end of buffer and
     * there's no more data to read.
     * @return {boolean} True if the seek pointer is at the end of the buffer.
     */
    isEof(): boolean {
        return this.position >= this.byteLength;
    }

    /**
     * Maps a Uint8Array into the DataStreamReaderLite
     *  buffer.
     *
     * Nice for quickly reading in data.
     *
     * @param {number} length Number of elements to map.
     * @return {Object} Uint8Array to the DataStreamReaderLite
     *  backing buffer.
     */
    mapUint8Array(length: number): Uint8Array {
        this._realloc(length);
        const arr = new Uint8Array(this._buffer, this.byteOffset + this.position, length);
        this.position += length;
        return arr;
    }

    /**
        Reads a 16-bit int from the DataStreamReaderLite
        with the offset
  
   @param {number} offset The offset.
   @return {number} The read number.
    */
    readShort(offset: number): number {
        this.seek(offset);
        return this.readInt16();
    }

    /**
   Reads an 8-bit int from the DataStreamReaderLite
    with the offset.
  
   @param {number} offset The offset.
   @return {number} The read number.
   */
    readByte(offset: number): number {
        this.seek(offset);
        return this.readInt8();
    }

    /**
   Read UCS-2 string of desired length and offset from the DataStreamReaderLite
   .
  
   @param {number} offset The offset.
   @param {number} length The length of the string to read.
   @return {string} The read string.
   */
    readStringAt(offset: number, length: number): string {
        this.seek(offset);
        return this.readUCS2String(length);
    }

    /**
     * Reads an Int32Array of desired length and endianness from the DataStreamReaderLite
     * .
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Int32Array.
     */
    readInt32Array(length: number, e?: boolean): Int32Array {
        length = length == null ? this.byteLength - this.position / 4 : length;
        const arr = new Int32Array(length);
        DataStreamReaderLite.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        DataStreamReaderLite.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads an Int8Array of desired length from the DataStreamReaderLite
     * .
     *
     * @param {number} length Number of elements to map.
     * @return {Object} The read Int8Array.
     */
    readInt8Array(length: number): Int8Array {
        length = length == null ? this.byteLength - this.position : length;
        const arr = new Int8Array(length);
        DataStreamReaderLite.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Uint16Array of desired length and endianness from the DataStreamReaderLite
     * .
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Uint16Array.
     */
    readUint16Array(length: number, e?: boolean): Uint16Array {
        length = length == null ? this.byteLength - this.position / 2 : length;
        const arr = new Uint16Array(length);
        DataStreamReaderLite.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        DataStreamReaderLite.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Uint8Array of desired length from the DataStreamReaderLite
     * .
     *
     * @param {number} length Number of elements to map.
     * @return {Object} The read Uint8Array.
     */
    readUint8Array(length: number): Uint8Array {
        length = length == null ? this.byteLength - this.position : length;
        const arr = new Uint8Array(length);
        DataStreamReaderLite.memcpy(arr.buffer, 0, this.buffer, this.byteOffset + this.position, length * arr.BYTES_PER_ELEMENT);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a 32-bit int from the DataStreamReaderLite
     *  with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readInt32(e?: boolean): number {
        const v = this._dataView.getInt32(this.position, e == null ? this.endianness : e);
        this.position += 4;
        return v;
    }

    /**
     * Reads a 16-bit int from the DataStreamReaderLite
     *  with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readInt16(e?: boolean): number {
        const v = this._dataView.getInt16(this.position, e == null ? this.endianness : e);
        this.position += 2;
        return v;
    }

    /**
     * Reads an 8-bit int from the DataStreamReaderLite
     * .
     *
     * @return {number} The read number.
     */
    readInt8(): number {
        const v = this._dataView.getInt8(this.position);
        this.position += 1;
        return v;
    }

    /**
   Reads a 32-bit int from the DataStreamReaderLite
    with the offset.
  
   @param {number} offset The offset.
   @return {number} The read number.
   */
    readInt(offset: number): number {
        this.seek(offset);
        return this.readInt32();
    }

    /**
     * Native endianness. Either DataStreamReaderLite
     * .BIG_ENDIAN or DataStreamReaderLite
     * .LITTLE_ENDIAN
     * depending on the platform endianness.
     *
     * @type {boolean}
     */
    static readonly endianness: boolean = new Int8Array(new Int16Array([1]).buffer)[0] > 0;

    /**
     * Copies byteLength bytes from the src buffer at srcOffset to the
     * dst buffer at dstOffset.
     *
     * @param {Object} dst Destination ArrayBuffer to write to.
     * @param {number} dstOffset Offset to the destination ArrayBuffer.
     * @param {Object} src Source ArrayBuffer to read from.
     * @param {number} srcOffset Offset to the source ArrayBuffer.
     * @param {number} byteLength Number of bytes to copy.
     */
    static memcpy(dst: ArrayBufferLike, dstOffset: number, src: ArrayBufferLike, srcOffset: number, byteLength: number) {
        const dstU8 = new Uint8Array(dst, dstOffset, byteLength);
        const srcU8 = new Uint8Array(src, srcOffset, byteLength);
        dstU8.set(srcU8);
    }

    /**
     * Converts array to native endianness in-place.
     *
     * @param {Object} array Typed array to convert.
     * @param {boolean} arrayIsLittleEndian True if the data in the array is
     * little-endian. Set false for big-endian.
     * @return {Object} The converted typed array.
     */
    static arrayToNative(array: TypedArray, arrayIsLittleEndian: boolean): object {
        if (arrayIsLittleEndian === this.endianness) {
            return array;
        } else {
            return this.flipArrayEndianness(array); // ???
        }
    }

    /**
     * Flips typed array endianness in-place.
     *
     * @param {Object} array Typed array to flip.
     * @return {Object} The converted typed array.
     */
    static flipArrayEndianness(array: TypedArray): object {
        const u8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < array.byteLength; i += array.BYTES_PER_ELEMENT) {
            for (
                // tslint:disable-next-line one-variable-per-declaration
                let j = i + array.BYTES_PER_ELEMENT - 1, k = i;
                j > k;
                j--, k++
            ) {
                const tmp = u8[k];
                u8[k] = u8[j];
                u8[j] = tmp;
            }
        }
        return array;
    }

    /**
     * Creates an array from an array of character codes.
     * Uses String.fromCharCode in chunks for memory efficiency and then concatenates
     * the resulting string chunks.
     *
     * @param {TypedArray} array Array of character codes.
     * @return {string} String created from the character codes.
     */
    static createStringFromArray(array: TypedArray): string {
        const chunkSize = 0x8000;
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(String.fromCharCode.apply(null, array.subarray(i, i + chunkSize)));
        }
        return chunks.join('');
    }

    /**
     * Read UCS-2 string of desired length and endianness from the DataStreamReaderLite
     * .
     *
     * @param {number} length The length of the string to read.
     * @param {boolean} endianness The endianness of the string data in the DataStreamReaderLite
     * .
     * @return {string} The read string.
     */
    readUCS2String(length: number, endianness?: boolean): string {
        return DataStreamReaderLite.createStringFromArray(this.readUint16Array(length, endianness));
    }

    /**
     * Read a string of desired length and encoding from the DataStreamReaderLite
     * .
     *
     * @param {number} length The length of the string to read in bytes.
     * @param {?string} encoding The encoding of the string data in the DataStreamReaderLite
     * .
     * Defaults to ASCII.
     * @return {string} The read string.
     */
    readString(length: number, encoding?: string): string {
        if (encoding == null || encoding === 'ASCII') {
            return DataStreamReaderLite.createStringFromArray(
                this.mapUint8Array(length == null ? this.byteLength - this.position : length)
            );
        } else {
            return new TextDecoder(encoding).decode(this.mapUint8Array(length));
        }
    }
}

/* Fix for Opera 12 not defining BYTES_PER_ELEMENT in typed array prototypes. */
if (Uint8Array.prototype.BYTES_PER_ELEMENT === undefined) {
    Object.defineProperties(Uint8Array.prototype, { BYTES_PER_ELEMENT: { value: Uint8Array.BYTES_PER_ELEMENT } });
    Object.defineProperties(Int8Array.prototype, { BYTES_PER_ELEMENT: { value: Int8Array.BYTES_PER_ELEMENT } });
    Object.defineProperties(Uint8ClampedArray.prototype, { BYTES_PER_ELEMENT: { value: Uint8ClampedArray.BYTES_PER_ELEMENT } });
    Object.defineProperties(Uint16Array.prototype, { BYTES_PER_ELEMENT: { value: Uint16Array.BYTES_PER_ELEMENT } });
    Object.defineProperties(Int16Array.prototype, { BYTES_PER_ELEMENT: { value: Int16Array.BYTES_PER_ELEMENT } });
    Object.defineProperties(Uint32Array.prototype, { BYTES_PER_ELEMENT: { value: Uint32Array.BYTES_PER_ELEMENT } });
    Object.defineProperties(Int32Array.prototype, { BYTES_PER_ELEMENT: { value: Int32Array.BYTES_PER_ELEMENT } });
    Object.defineProperties(Float64Array.prototype, { BYTES_PER_ELEMENT: { value: Float64Array.BYTES_PER_ELEMENT } });
}
