export function arraysEqual(a: ArrayLike<unknown>, b: ArrayLike<unknown>): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export function uInt2int(data: number[]): number[] {
    const result = new Array<number>(data.length);
    for (let i = 0; i < data.length; i++) {
        result[i] = (data[i] as number << 24) >> 24;
    }
    return result;
}

/**
 * Strips trailing NUL (`\0`) characters from a decoded string.
 * OLE property names and PidTag string values are NUL-terminated and the
 * terminator is included in the stored length, so it must be removed.
 */
export function stripTrailingNul(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 0) {
        end--;
    }
    return end === value.length ? value : value.slice(0, end);
}

/** Concatenates parts into a single Uint8Array of the given total length. */
export function concatUint8Arrays(parts: Uint8Array[], totalLength: number): Uint8Array {
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        const chunkLength = Math.min(part.length, totalLength - offset);
        if (chunkLength <= 0) break;
        result.set(part.subarray(0, chunkLength), offset);
        offset += chunkLength;
    }
    return result;
}

// CRC-32 (IEEE 802.3) lookup table, built lazily.
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
    if (crcTable) return crcTable;
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    crcTable = table;
    return table;
}

/** Options for {@link crc32}. */
export interface Crc32Options {
    /** Initial register value. Defaults to 0xFFFFFFFF (IEEE). */
    init?: number;
    /** Final XOR value. Defaults to 0xFFFFFFFF (IEEE). */
    xorOut?: number;
}

/**
 * Computes CRC-32 (polynomial 0xEDB88320) over the given bytes.
 * Defaults to the standard IEEE parameters (init/xorOut 0xFFFFFFFF, so
 * `crc32("123456789") === 0xCBF43926`). Pass `{ init: 0, xorOut: 0 }` for
 * the variant used by MS-OXRTFCP compressed-RTF checksums.
 */
export function crc32(data: Uint8Array, options?: Crc32Options): number {
    const table = getCrcTable();
    let crc = (options?.init ?? 0xffffffff) >>> 0;
    for (let i = 0; i < data.length; i++) {
        crc = (table[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
    }
    return (crc ^ (options?.xorOut ?? 0xffffffff)) >>> 0;
}

const FILETIME_EPOCH_DIFF_MS = 11644473600000; // ms between 1601-01-01 and 1970-01-01

/**
 * Maps a Windows codepage number (PidTagMessageCodepage, e.g. 1252) to a
 * WHATWG encoding label suitable for TextDecoder. Unknown codepages fall
 * back to windows-1252, matching historical behavior for 001E strings.
 */
export function codepageToEncoding(codepage: number): string {
    switch (codepage) {
        case 874:
            return 'windows-874';
        case 932:
            return 'shift_jis';
        case 936:
            return 'gbk';
        case 949:
            return 'euc-kr';
        case 950:
            return 'big5';
        case 1250:
            return 'windows-1250';
        case 1251:
            return 'windows-1251';
        case 1252:
            return 'windows-1252';
        case 1253:
            return 'windows-1253';
        case 1254:
            return 'windows-1254';
        case 1255:
            return 'windows-1255';
        case 1256:
            return 'windows-1256';
        case 1257:
            return 'windows-1257';
        case 1258:
            return 'windows-1258';
        case 65001:
            return 'utf-8';
        default:
            return 'windows-1252';
    }
}

/** Decodes single-byte text with the given encoding label, falling back to windows-1252. */
export function decodeSingleByteString(bytes: Uint8Array, encoding: string): string {
    try {
        return new TextDecoder(encoding).decode(bytes);
    } catch {
        return new TextDecoder('windows-1252').decode(bytes);
    }
}

/**
 * Converts an 8-byte Windows FILETIME (100ns intervals since 1601-01-01,
 * little-endian) to a Date. Returns null for a zero FILETIME.
 */
export function fileTimeToDate(bytes: Uint8Array): Date | null {
    if (bytes.length < 8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const low = view.getUint32(0, true);
    const high = view.getUint32(4, true);
    if (low === 0 && high === 0) return null;
    const fileTime = (BigInt(high) << 32n) | BigInt(low);
    const ms = Number(fileTime / 10000n) - FILETIME_EPOCH_DIFF_MS;
    if (!Number.isFinite(ms)) return null;
    return new Date(ms);
}
