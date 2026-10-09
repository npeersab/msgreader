import { crc32 } from './utils.js';

/**
 * Compressed RTF (LZFu) decompression per MS-OXRTFCP
 * ("Rich Text Format (RTF) Compression Algorithm").
 *
 * Algorithm ported from the MIT-licensed `compressed_rtf` Python package by
 * delimitry (https://github.com/delimitry/compressed_rtf), which implements
 * the same specification.
 */

export const RTF_MAGIC_COMPRESSED = 'LZFu';
export const RTF_MAGIC_UNCOMPRESSED = 'MELA';

/** Max accepted decompressed RTF size (256 MiB) — guards corrupt headers. */
export const MAX_RTF_SIZE = 256 * 1024 * 1024;

const INIT_DICT_TEXT =
    '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\' +
    'fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New ' +
    'RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\' +
    'f0\\fs20\\b\\i\\u\\tab\\tx';

const INIT_DICT_SIZE = 207;
const MAX_DICT_SIZE = 4096;

export interface CompressedRtfHeader {
    /** Total size of the data following this field structure, +12. */
    compressedSize: number;
    /** Size of the decompressed RTF body in bytes. */
    uncompressedSize: number;
    /** 'LZFu' (compressed) or 'MELA' (stored raw). */
    magic: string;
    /** CRC-32 of the compressed payload (0 for uncompressed). */
    crc: number;
}

function buildInitDict(): Uint8Array {
    const dict = new Uint8Array(MAX_DICT_SIZE);
    dict.fill(0x20); // pad with spaces, per spec
    for (let i = 0; i < INIT_DICT_TEXT.length && i < INIT_DICT_SIZE; i++) {
        dict[i] = INIT_DICT_TEXT.charCodeAt(i) & 0xff;
    }
    return dict;
}

function readHeader(data: Uint8Array): { header: CompressedRtfHeader; contents: Uint8Array } {
    if (data.length < 16) {
        throw new Error(`Invalid compressed RTF data: expected at least 16 bytes, got ${data.length}`);
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const compressedSize = view.getUint32(0, true);
    const uncompressedSize = view.getUint32(4, true);
    const magic = String.fromCharCode(data[8] as number, data[9] as number, data[10] as number, data[11] as number);
    const crc = view.getUint32(12, true);
    if (magic !== RTF_MAGIC_COMPRESSED && magic !== RTF_MAGIC_UNCOMPRESSED) {
        throw new Error(`Unknown RTF compression magic: ${JSON.stringify(magic)}`);
    }
    if (uncompressedSize > MAX_RTF_SIZE) {
        throw new Error(`Refusing to decompress RTF of declared size ${uncompressedSize}`);
    }
    const payloadLength = Math.min(Math.max(compressedSize - 12, 0), data.length - 16);
    const contents = data.slice(16, 16 + payloadLength);
    return { header: { compressedSize, uncompressedSize, magic, crc }, contents };
}

export interface DecompressRtfOptions {
    /**
     * Verify the payload CRC-32 (LZFu) / zero CRC (MELA). Defaults to true.
     * Disable to salvage data from files with a corrupt checksum.
     */
    verifyCrc?: boolean;
}

/**
 * Decompresses a `__substg1.0_10090102` (PidTagRtfCompressed) payload.
 * Returns the raw (still RTF-markup) bytes.
 */
export function decompressRtf(data: Uint8Array, options?: DecompressRtfOptions): Uint8Array {
    const verifyCrc = options?.verifyCrc !== false;
    const { header, contents } = readHeader(data);

    if (header.magic === RTF_MAGIC_UNCOMPRESSED) {
        if (verifyCrc && header.crc !== 0) {
            throw new Error('Invalid uncompressed RTF: CRC must be 0x00000000');
        }
        return contents.slice(0, header.uncompressedSize);
    }

    if (verifyCrc && crc32(contents, { init: 0, xorOut: 0 }) !== header.crc) {
        throw new Error('Invalid compressed RTF: CRC mismatch, the data is corrupt');
    }

    const dict = buildInitDict();
    let writeOffset = INIT_DICT_SIZE;
    const output = new Uint8Array(header.uncompressedSize);
    let outLength = 0;
    let pos = 0;
    let done = false;

    const emit = (char: number): void => {
        if (outLength >= output.length) return;
        output[outLength++] = char;
        dict[writeOffset] = char;
        writeOffset = (writeOffset + 1) % MAX_DICT_SIZE;
    };

    while (!done && pos < contents.length && outLength < output.length) {
        const control = contents[pos++] as number;
        for (let bit = 0; bit < 8; bit++) {
            if (done || outLength >= output.length) break;
            if ((control & (1 << bit)) === 0) {
                // literal token (8 bit)
                if (pos >= contents.length) break;
                emit(contents[pos++] as number);
            } else {
                // dictionary reference token (16 bit, big-endian)
                if (pos + 1 >= contents.length) break;
                const token = (((contents[pos] as number) << 8) | (contents[pos + 1] as number)) >>> 0;
                pos += 2;
                const offset = (token >>> 4) & 0xfff;
                const actualLength = (token & 0xf) + 2;
                // end indicator: reference points at the current write position
                if (writeOffset === offset) {
                    done = true;
                    break;
                }
                for (let step = 0; step < actualLength; step++) {
                    emit(dict[(offset + step) % MAX_DICT_SIZE] as number);
                    if (outLength >= output.length) break;
                }
            }
        }
    }

    return outLength === output.length ? output : output.slice(0, outLength);
}

/**
 * Decompresses a PidTagRtfCompressed payload and decodes it to a string.
 * RTF bodies are single-byte (ANSI) text; windows-1252 is the default
 * decoding, matching Outlook's typical code page.
 */
export function decompressRtfToString(data: Uint8Array, encoding = 'windows-1252', options?: DecompressRtfOptions): string {
    return new TextDecoder(encoding).decode(decompressRtf(data, options));
}
