/* Copyright 2016 Yury Karpovich
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*
 MSG Reader
 */

import { arraysEqual, concatUint8Arrays, fileTimeToDate, stripTrailingNul } from './utils';
import CONST from './const';
import DataStream, { ByteSource } from './data-stream-reader-lite';
import { decompressRtfToString } from './rtf';

export type { ByteSource };

/** Input accepted by the MsgReader constructor. */
export type MsgBuffer = ByteSource;

/** Thrown when the input is not a readable .msg (OLE compound document) file. */
export class InvalidMsgFileError extends Error {
    constructor(message = 'Unsupported file type! Input is not an Outlook .msg file.') {
        super(message);
        this.name = 'InvalidMsgFileError';
    }
}

/** Guards against corrupt files that declare absurd stream sizes. */
export const MAX_DOCUMENT_SIZE = 256 * 1024 * 1024;
/** Max FAT chain links followed for a single stream. */
const MAX_CHAIN_LENGTH = 300000;
/** Max directory entries parsed from a single file. */
const MAX_PROPERTIES = 200000;

// MSG Reader implementation

// check MSG file header
function isMSGFile(ds: DataStream): boolean {
    ds.seek(0);
    return arraysEqual(CONST.FILE_HEADER, ds.readInt8Array(CONST.FILE_HEADER.length));
}

// FAT utils
function getBlockOffsetAt(msgData: MsgData, offset: number): number {
    return (offset + 1) * msgData.bigBlockSize;
}

function getBlockCount(ds: DataStream, msgData: MsgData): number {
    return Math.max(1, Math.floor(ds.byteLength / msgData.bigBlockSize));
}

function getBlockAt(ds: DataStream, msgData: MsgData, offset: number): Int32Array {
    if (!Number.isInteger(offset) || offset < 0 || offset >= getBlockCount(ds, msgData)) {
        throw new RangeError(`FAT block index ${offset} is out of range`);
    }
    const startOffset = getBlockOffsetAt(msgData, offset);
    if (startOffset + msgData.bigBlockSize > ds.byteLength) {
        throw new RangeError(`FAT block ${offset} extends past end of file`);
    }
    ds.seek(startOffset);
    return ds.readInt32Array(msgData.bigBlockLength);
}

function getNextBlockInner(ds: DataStream, msgData: MsgData, offset: number, blockOffsetData: number[]): number {
    const currentBlock = Math.floor(offset / msgData.bigBlockLength);
    const currentBlockIndex = offset % msgData.bigBlockLength;

    const startBlockOffset = blockOffsetData[currentBlock];
    if (startBlockOffset === undefined) return CONST.MSG.END_OF_CHAIN;

    return getBlockAt(ds, msgData, startBlockOffset)[currentBlockIndex] as number;
}

function getNextBlock(ds: DataStream, msgData: MsgData, offset: number): number {
    return getNextBlockInner(ds, msgData, offset, msgData.batData ?? []);
}

function getNextBlockSmall(ds: DataStream, msgData: MsgData, offset: number): number {
    return getNextBlockInner(ds, msgData, offset, msgData.sbatData ?? []);
}

// convert binary data to dictionary
function parseMsgData(ds: DataStream): MsgData {
    const msgData: MsgData = headerData(ds);
    msgData.batData = batData(ds, msgData);
    msgData.sbatData = sbatData(ds, msgData);
    if (msgData.xbatCount > 0) {
        xbatData(ds, msgData);
    }
    msgData.propertyData = propertyData(ds, msgData);
    msgData.fieldsData = fieldsData(ds, msgData);

    return msgData;
}

export interface MsgData {
    bigBlockSize: number;
    bigBlockLength: number;
    xBlockLength: number;
    batCount: number;
    propertyStart: number;
    sbatStart: number;
    sbatCount: number;
    xbatStart: number;
    xbatCount: number;

    fieldsData?: MessageData;
    propertyData?: (Property | null)[];
    sbatData?: number[];
    batData?: number[];
    /** Memoized block ids backing the mini stream (root storage chain). */
    miniStreamBlocks?: number[] | null;
}

// extract header data
function headerData(ds: DataStream): MsgData {
    const bigBlockSize =
        ds.readByte(/*const position*/ 30) == CONST.MSG.L_BIG_BLOCK_MARK ? CONST.MSG.L_BIG_BLOCK_SIZE : CONST.MSG.S_BIG_BLOCK_SIZE;
    const bigBlockLength = bigBlockSize / 4;

    const batCount = ds.readInt(CONST.MSG.HEADER.BAT_COUNT_OFFSET);
    const propertyStart = ds.readInt(CONST.MSG.HEADER.PROPERTY_START_OFFSET);
    const sbatStart = ds.readInt(CONST.MSG.HEADER.SBAT_START_OFFSET);
    const sbatCount = ds.readInt(CONST.MSG.HEADER.SBAT_COUNT_OFFSET);
    const xbatStart = ds.readInt(CONST.MSG.HEADER.XBAT_START_OFFSET);
    const xbatCount = ds.readInt(CONST.MSG.HEADER.XBAT_COUNT_OFFSET);

    for (const [label, value] of [
        ['BAT count', batCount],
        ['SBAT count', sbatCount],
        ['XBAT count', xbatCount],
    ] as const) {
        if (!Number.isInteger(value) || value < 0 || value > MAX_CHAIN_LENGTH) {
            throw new InvalidMsgFileError(`Corrupt .msg header: invalid ${label} (${value}).`);
        }
    }

    return {
        // system data
        bigBlockSize,
        bigBlockLength,
        xBlockLength: bigBlockLength - 1,

        // header data
        batCount,
        propertyStart,
        sbatStart,
        sbatCount,
        xbatStart,
        xbatCount,
    };
}

function batCountInHeader(msgData: MsgData): number {
    const maxBatsInHeader = Math.floor((CONST.MSG.S_BIG_BLOCK_SIZE - CONST.MSG.HEADER.BAT_START_OFFSET) / 4);
    return Math.min(Math.max(msgData.batCount, 0), maxBatsInHeader);
}

function batData(ds: DataStream, msgData: MsgData): number[] {
    const result = new Array<number>(batCountInHeader(msgData));
    ds.seek(CONST.MSG.HEADER.BAT_START_OFFSET);
    for (let i = 0; i < result.length; i++) {
        result[i] = ds.readInt32();
    }
    return result;
}

function isChainTerminator(block: number): boolean {
    return block === CONST.MSG.END_OF_CHAIN || block === CONST.MSG.UNUSED_BLOCK;
}

function sbatData(ds: DataStream, msgData: MsgData): number[] {
    const result: number[] = [];
    let startIndex = msgData.sbatStart;
    const seen = new Set<number>();

    // NB: block 0 is a valid block id, so it must not be treated as falsy.
    for (let i = 0; i < msgData.sbatCount && startIndex >= 0 && !isChainTerminator(startIndex); i++) {
        if (seen.has(startIndex)) break; // cyclic FAT — stop instead of looping forever
        seen.add(startIndex);
        result.push(startIndex);
        startIndex = getNextBlock(ds, msgData, startIndex);
    }
    return result;
}

function xbatData(ds: DataStream, msgData: MsgData): void {
    const batDataRef = msgData.batData;
    if (!batDataRef) return;
    const batCount = batCountInHeader(msgData);
    const batCountTotal = msgData.batCount;
    let remainingBlocks = batCountTotal - batCount;

    let nextBlockAt = msgData.xbatStart;
    const seen = new Set<number>();
    for (let i = 0; i < msgData.xbatCount && remainingBlocks > 0; i++) {
        if (nextBlockAt < 0 || seen.has(nextBlockAt)) break;
        seen.add(nextBlockAt);
        const xBatBlock = getBlockAt(ds, msgData, nextBlockAt);

        const blocksToProcess = Math.min(remainingBlocks, msgData.xBlockLength);
        for (let j = 0; j < blocksToProcess; j++) {
            const blockStartAt = xBatBlock[j] as number;
            if (isChainTerminator(blockStartAt)) {
                break;
            }
            batDataRef.push(blockStartAt);
        }
        remainingBlocks -= blocksToProcess;

        nextBlockAt = xBatBlock[msgData.xBlockLength] as number;
        if (isChainTerminator(nextBlockAt)) break;
    }
}

// extract property data and property hierarchy
function propertyData(ds: DataStream, msgData: MsgData): (Property | null)[] {
    const props: (Property | null)[] = [];

    if (msgData.propertyStart < 0) {
        throw new InvalidMsgFileError('Corrupt .msg file: missing property storage.');
    }

    let currentOffset = msgData.propertyStart;
    const seen = new Set<number>();
    const maxBlocks = getBlockCount(ds, msgData) + 1;
    let blocksWalked = 0;

    while (currentOffset !== CONST.MSG.END_OF_CHAIN) {
        if (currentOffset < 0 || seen.has(currentOffset)) {
            throw new InvalidMsgFileError('Corrupt .msg file: broken property chain.');
        }
        seen.add(currentOffset);
        convertBlockToProperties(ds, msgData, currentOffset, props);
        if (props.length > MAX_PROPERTIES) {
            throw new InvalidMsgFileError('Corrupt .msg file: too many directory entries.');
        }
        currentOffset = getNextBlock(ds, msgData, currentOffset);
        if (++blocksWalked > maxBlocks) {
            throw new InvalidMsgFileError('Corrupt .msg file: property chain is too long.');
        }
    }
    const root = props[0];
    if (!root || root.type !== PropertyType.Root) {
        throw new InvalidMsgFileError('Corrupt .msg file: missing root storage entry.');
    }
    createPropertyHierarchy(props, /*property with index 0 (zero) always as root*/ root);
    return props;
}

function convertName(ds: DataStream, offset: number): string {
    const nameLength = ds.readShort(offset + CONST.MSG.PROP.NAME_SIZE_OFFSET);
    if (nameLength < 1) {
        return '';
    } else {
        return stripTrailingNul(ds.readStringAt(offset, nameLength / 2));
    }
}

export enum PropertyType {
    Directory = 1,
    Document = 2,
    Root = 5,
}

export interface Property {
    index: number;

    type: PropertyType;
    name: string;
    previousProperty: number;
    nextProperty: number;
    childProperty: number;
    startBlock: number;
    sizeBlock: number;
    children?: number[];
}

function convertProperty(ds: DataStream, index: number, offset: number): Property {
    return {
        index: index,
        type: ds.readByte(offset + CONST.MSG.PROP.TYPE_OFFSET) as PropertyType,
        name: convertName(ds, offset),
        // hierarchy
        previousProperty: ds.readInt(offset + CONST.MSG.PROP.PREVIOUS_PROPERTY_OFFSET),
        nextProperty: ds.readInt(offset + CONST.MSG.PROP.NEXT_PROPERTY_OFFSET),
        childProperty: ds.readInt(offset + CONST.MSG.PROP.CHILD_PROPERTY_OFFSET),
        // data offset
        startBlock: ds.readInt(offset + CONST.MSG.PROP.START_BLOCK_OFFSET),
        sizeBlock: ds.readInt(offset + CONST.MSG.PROP.SIZE_OFFSET),
    };
}

function convertBlockToProperties(
    ds: DataStream,
    msgData: MsgData,
    propertyBlockOffset: number,
    props: (Property | null)[]
): void {
    const propertyCount = Math.floor(msgData.bigBlockSize / CONST.MSG.PROP.PROPERTY_SIZE);
    const propertyOffset = getBlockOffsetAt(msgData, propertyBlockOffset);

    for (let i = 0; i < propertyCount; i++) {
        const entryOffset = propertyOffset + i * CONST.MSG.PROP.PROPERTY_SIZE;
        if (ds.byteLength < entryOffset + CONST.MSG.PROP.PROPERTY_SIZE) break;

        const propertyType = ds.readByte(entryOffset + CONST.MSG.PROP.TYPE_OFFSET);
        switch (propertyType) {
            case CONST.MSG.PROP.TYPE_ENUM.ROOT:
            case CONST.MSG.PROP.TYPE_ENUM.DIRECTORY:
            case CONST.MSG.PROP.TYPE_ENUM.DOCUMENT:
                props.push(convertProperty(ds, props.length, entryOffset));
                break;
            default:
                /* unknown property types */
                props.push(null);
        }
    }
}

function createPropertyHierarchy(props: (Property | null)[], nodeProperty: Property): void {
    const built = new Set<number>();
    const build = (node: Property): void => {
        if (built.has(node.index)) return;
        built.add(node.index);
        if (node.childProperty === CONST.MSG.PROP.NO_INDEX) {
            node.children = [];
            return;
        }
        node.children = [];
        const seen = new Set<number>();
        const queue: number[] = [node.childProperty];
        for (let head = 0; head < queue.length; head++) {
            const currentIndex = queue[head] as number;
            if (currentIndex === CONST.MSG.PROP.NO_INDEX || seen.has(currentIndex)) continue;
            seen.add(currentIndex);
            const current = currentIndex >= 0 && currentIndex < props.length ? props[currentIndex] ?? null : null;
            if (current == null) {
                continue;
            }
            (node.children as number[]).push(currentIndex);

            if (current.type === PropertyType.Directory) {
                build(current);
            }
            if (current.previousProperty !== CONST.MSG.PROP.NO_INDEX) {
                queue.push(current.previousProperty);
            }
            if (current.nextProperty !== CONST.MSG.PROP.NO_INDEX) {
                queue.push(current.nextProperty);
            }
        }
    };
    build(nodeProperty);
}

/** String-valued message fields (see CONST.MSG.FIELD.NAME_MAPPING). */
export interface MessageTextFields {
    /** PidTagSubject (0037). */
    subject?: string;
    /** PidTagNormalizedSubject (0E1D). */
    normalizedSubject?: string;
    /** PidTagSubjectPrefix (003D). */
    subjectPrefix?: string;
    /** PidTagMessageClass (001A), e.g. `IPM.Note`. */
    messageClass?: string;
    /** PidTagSenderName (0C1A). */
    senderName?: string;
    /** PidTagSenderEmailAddress (0C1F). */
    senderEmail?: string;
    /** PidTagSenderSmtpAddress (0C1E). */
    senderSmtpAddress?: string;
    /** PidTagBody (1000), plain text. */
    body?: string;
    /** PidTagBodyHtml (1013), raw HTML bytes when present. */
    bodyHtml?: Uint8Array;
    /** PidTagTransportMessageHeaders (007D). */
    headers?: string;
    /** PidTagRtfCompressed (1009). Use getRtfBody() to decompress. */
    compressedRtf?: Uint8Array;
    /** PidTagInternetMessageId (1035). */
    internetMessageId?: string;
    /** PidTagDisplayTo (0E04). */
    displayTo?: string;
    /** PidTagDisplayCc (0E03). */
    displayCc?: string;
    /** PidTagDisplayBcc (0E02). */
    displayBcc?: string;
}

export interface Attachment {
    /** Index into the property table of the `__substg1.3701*` stream. */
    dataId: number;
    /** Declared byte length of the attachment content. */
    contentLength: number;
    /** PidTagAttachLongFilename (3707). */
    fileName?: string;
    /** PidTagAttachFilename (3704, 8.3 short name). */
    fileNameShort?: string;
    /** PidTagAttachExtension (3703). */
    extension?: string;
    /** PidTagAttachMimeTag (370E). */
    mimeType?: string;
    /** PidTagAttachContentId (3712). */
    pidContentId?: string;
    /** PidTagAttachContentLocation (3716). */
    attachContentLocation?: string;
    /** PidTagAttachMethod (3705). */
    attachMethod?: number;
    /**
     * True when the attachment embeds another message (unsupported content).
     * @deprecated Use hasInnerMsg instead.
     */
    innerMsgContent?: boolean;
    /** True when the attachment embeds another message (unsupported content). */
    hasInnerMsg?: boolean;
    /** Decoded values for tags without a friendly name, keyed by 4-hex-digit class. */
    extraProperties?: Record<string, unknown>;
}

export interface Recipient {
    /** PidTagDisplayName (3001). */
    name?: string;
    /** PidTagEmailAddress (3003). */
    email?: string;
    /** PidTagAddressType (3002), e.g. `SMTP`. */
    addressType?: string;
    /** PidTagSmtpAddress (39FE). */
    smtpAddress?: string;
    /** PidTagSearchKey (300B). */
    searchKey?: Uint8Array;
    /** Decoded values for tags without a friendly name, keyed by 4-hex-digit class. */
    extraProperties?: Record<string, unknown>;
}

export interface MessageData extends MessageTextFields {
    attachments: Attachment[];
    recipients: Recipient[];
    /** Decoded values for tags without a friendly name, keyed by 4-hex-digit class. */
    extraProperties: Record<string, unknown>;
}

/**
 * Backwards-compatible alias for MessageData.
 * (The legacy `error`/`dataId`/`contentLength`/`innerMsgContent` members are
 * no longer populated; invalid files now throw InvalidMsgFileError.)
 */
export type FieldsData = MessageData;

/** Fully decoded attachment content. */
export interface AttachmentContent {
    fileName?: string;
    fileNameShort?: string;
    extension?: string;
    mimeType?: string;
    pidContentId?: string;
    contentLength: number;
    content: Uint8Array;
}

// extract real fields
function fieldsData(ds: DataStream, msgData: MsgData): MessageData {
    const fields: MessageData = {
        attachments: [],
        recipients: [],
        extraProperties: {},
    };
    const root = msgData.propertyData?.[0] ?? null;
    if (root) {
        fieldsDataDir(ds, msgData, root, fields);
    }
    return fields;
}

function fieldsDataDir(ds: DataStream, msgData: MsgData, dirProperty: Property, fields: MessageData | Attachment | Recipient): void {
    if (dirProperty && dirProperty.children && dirProperty.children.length > 0) {
        const propertyDataRef = msgData.propertyData;
        if (!propertyDataRef) return;
        for (let i = 0; i < dirProperty.children.length; i++) {
            const childIndex = dirProperty.children[i] as number;
            const childProperty = childIndex >= 0 && childIndex < propertyDataRef.length ? propertyDataRef[childIndex] ?? null : null;
            if (childProperty == null) continue;

            if (childProperty.type === PropertyType.Directory) {
                fieldsDataDirInner(ds, msgData, childProperty, fields);
            } else if (
                childProperty.type === PropertyType.Document &&
                childProperty.name.indexOf(CONST.MSG.FIELD.PREFIX.DOCUMENT) === 0
            ) {
                fieldsDataDocument(ds, msgData, childProperty, fields);
            }
        }
    }
}

function fieldsDataDirInner(
    ds: DataStream,
    msgData: MsgData,
    dirProperty: Property,
    fields: MessageData | Attachment | Recipient
): void {
    if (dirProperty.name.indexOf(CONST.MSG.FIELD.PREFIX.ATTACHMENT) === 0) {
        // attachment
        const attachmentField: Attachment = { dataId: -1, contentLength: 0, extraProperties: {} };
        (fields as MessageData).attachments.push(attachmentField);
        fieldsDataDir(ds, msgData, dirProperty, attachmentField);
    } else if (dirProperty.name.indexOf(CONST.MSG.FIELD.PREFIX.RECIPIENT) === 0) {
        // recipient
        const recipientField: Recipient = { extraProperties: {} };
        (fields as MessageData).recipients.push(recipientField);
        fieldsDataDir(ds, msgData, dirProperty, recipientField);
    } else if (dirProperty.name.indexOf(CONST.MSG.FIELD.PREFIX.NAMEID) === 0) {
        // unknown, skip
    } else {
        // other dir
        const childFieldType = getFieldType(dirProperty);
        if (childFieldType !== CONST.MSG.FIELD.DIR_TYPE.INNER_MSG) {
            fieldsDataDir(ds, msgData, dirProperty, fields);
        } else {
            // MSG as attachment currently isn't supported
            (fields as Attachment).innerMsgContent = true;
            (fields as Attachment).hasInnerMsg = true;
        }
    }
}

const SUBSTG_PATTERN = /^__substg1\.0?([0-9a-f]{4})([0-9a-f]{4})/i;

function splitSubstgName(name: string): { fieldClass: string; fieldType: string } | null {
    const match = SUBSTG_PATTERN.exec(name);
    if (!match) {
        // legacy fallback for nonstandard name shapes
        const value = name.substring(12).toLowerCase();
        if (value.length < 8) return null;
        return { fieldClass: value.substring(0, 4), fieldType: value.substring(4, 8) };
    }
    return { fieldClass: (match[1] as string).toLowerCase(), fieldType: (match[2] as string).toLowerCase() };
}

function fieldsDataDocument(
    ds: DataStream,
    msgData: MsgData,
    documentProperty: Property,
    fields: MessageData | Attachment | Recipient
): void {
    const split = splitSubstgName(documentProperty.name);
    if (!split) return;
    const { fieldClass, fieldType } = split;

    const fieldName = CONST.MSG.FIELD.NAME_MAPPING[fieldClass];
    const value = safeGetFieldValue(ds, msgData, documentProperty, fieldType);

    if (fieldName) {
        if (value !== null && value !== undefined) {
            (fields as unknown as Record<string, unknown>)[fieldName] = value;
        }
    } else if (value !== null && value !== undefined && fieldClass !== CONST.MSG.FIELD.CLASS_MAPPING.ATTACHMENT_DATA) {
        // Keep forward-compat data for tags without a friendly name, but only
        // scalar values: binaries (notably the 3701 attachment payload) would
        // needlessly duplicate memory.
        if (!(value instanceof Uint8Array)) {
            const extra = (fields as MessageData | Attachment | Recipient).extraProperties ?? {};
            extra[fieldClass] = value;
            (fields as MessageData | Attachment | Recipient).extraProperties = extra;
        }
    }
    if (fieldClass === CONST.MSG.FIELD.CLASS_MAPPING.ATTACHMENT_DATA) {
        // attachment specific info
        (fields as Attachment).dataId = documentProperty.index;
        (fields as Attachment).contentLength = documentProperty.sizeBlock;
    }
}

function getFieldType(fieldProperty: Property): string {
    return splitSubstgName(fieldProperty.name)?.fieldType ?? '';
}

/** Block ids backing the mini stream, memoized per parsed file. */
function getMiniStreamBlocks(ds: DataStream, msgData: MsgData): number[] {
    if (msgData.miniStreamBlocks !== undefined && msgData.miniStreamBlocks !== null) {
        return msgData.miniStreamBlocks;
    }
    const blocks: number[] = [];
    const rootProp = msgData.propertyData?.[0] ?? null;
    if (rootProp && rootProp.startBlock >= 0) {
        const seen = new Set<number>();
        const maxBlocks = getBlockCount(ds, msgData) + 1;
        let nextBlock = rootProp.startBlock;
        while (!isChainTerminator(nextBlock) && nextBlock >= 0 && !seen.has(nextBlock) && blocks.length < maxBlocks) {
            seen.add(nextBlock);
            blocks.push(nextBlock);
            nextBlock = getNextBlock(ds, msgData, nextBlock);
        }
    }
    msgData.miniStreamBlocks = blocks;
    return blocks;
}

/** Reads `length` bytes at mini-stream byte offset `byteOffset`. */
function readMiniByteRange(ds: DataStream, msgData: MsgData, byteOffset: number, length: number): Uint8Array {
    const miniBlocks = getMiniStreamBlocks(ds, msgData);
    const result = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
        const pos = byteOffset + filled;
        const bigBlockIndex = Math.floor(pos / msgData.bigBlockSize);
        const bigBlockOffset = pos % msgData.bigBlockSize;
        const blockId = miniBlocks[bigBlockIndex];
        if (blockId === undefined || blockId < 0) {
            throw new RangeError(`Mini stream byte offset ${pos} is out of range`);
        }
        const fileOffset = getBlockOffsetAt(msgData, blockId) + bigBlockOffset;
        const run = Math.min(length - filled, msgData.bigBlockSize - bigBlockOffset);
        if (fileOffset + run > ds.byteLength) {
            throw new RangeError('Mini stream data extends past end of file');
        }
        ds.seek(fileOffset);
        result.set(ds.readUint8Array(run), filled);
        filled += run;
    }
    return result;
}

function getMiniChain(ds: DataStream, msgData: MsgData, fieldProperty: Property): number[] {
    const blockChain: number[] = [];
    const maxBlocks = Math.ceil(fieldProperty.sizeBlock / CONST.MSG.SMALL_BLOCK_SIZE) + 1;
    let nextBlockSmall = fieldProperty.startBlock;
    const seen = new Set<number>();
    while (!isChainTerminator(nextBlockSmall) && nextBlockSmall >= 0 && !seen.has(nextBlockSmall)) {
        seen.add(nextBlockSmall);
        blockChain.push(nextBlockSmall);
        if (blockChain.length > maxBlocks || blockChain.length > MAX_CHAIN_LENGTH) break;
        nextBlockSmall = getNextBlockSmall(ds, msgData, nextBlockSmall);
    }
    return blockChain;
}

function getBigChain(ds: DataStream, msgData: MsgData, fieldProperty: Property): number[] {
    const blockChain: number[] = [];
    const needed = Math.ceil(fieldProperty.sizeBlock / msgData.bigBlockSize);
    const maxBlocks = Math.min(needed + 1, MAX_CHAIN_LENGTH);
    let nextBlock = fieldProperty.startBlock;
    const seen = new Set<number>();
    while (!isChainTerminator(nextBlock) && nextBlock >= 0 && !seen.has(nextBlock) && blockChain.length < maxBlocks) {
        seen.add(nextBlock);
        blockChain.push(nextBlock);
        nextBlock = getNextBlock(ds, msgData, nextBlock);
    }
    return blockChain;
}

function readBigByteRange(ds: DataStream, msgData: MsgData, chain: number[], sizeBlock: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let remaining = sizeBlock;
    for (const blockId of chain) {
        if (remaining <= 0) break;
        const fileOffset = getBlockOffsetAt(msgData, blockId);
        const chunkLength = Math.min(remaining, msgData.bigBlockSize);
        if (fileOffset + chunkLength > ds.byteLength) {
            throw new RangeError('Stream data extends past end of file');
        }
        ds.seek(fileOffset);
        parts.push(ds.readUint8Array(chunkLength));
        remaining -= chunkLength;
    }
    if (remaining > 0) {
        throw new RangeError('Stream chain is shorter than the declared stream size');
    }
    return concatUint8Arrays(parts, sizeBlock);
}

/**
 * Materializes the raw bytes of a DOCUMENT stream, following the BAT chain
 * for large streams and the SBAT/mini-stream chain for small ones.
 */
function getFieldBytes(ds: DataStream, msgData: MsgData, fieldProperty: Property): Uint8Array | null {
    if (!fieldProperty || fieldProperty.type !== PropertyType.Document) return null;
    const sizeBlock = fieldProperty.sizeBlock;
    if (!Number.isInteger(sizeBlock) || sizeBlock < 0 || sizeBlock > MAX_DOCUMENT_SIZE) {
        throw new RangeError(`Stream "${fieldProperty.name}" has an invalid size (${sizeBlock})`);
    }
    if (sizeBlock === 0 || fieldProperty.startBlock === CONST.MSG.END_OF_CHAIN) {
        return new Uint8Array(0);
    }

    if (sizeBlock < CONST.MSG.BIG_BLOCK_MIN_DOC_SIZE) {
        const chain = getMiniChain(ds, msgData, fieldProperty);
        if (chain.length === 0) {
            throw new RangeError(`Stream "${fieldProperty.name}" has no mini blocks`);
        }
        if (chain.length * CONST.MSG.SMALL_BLOCK_SIZE < sizeBlock) {
            throw new RangeError(`Stream "${fieldProperty.name}" chain is shorter than the declared stream size`);
        }
        if (chain.length === 1) {
            return readMiniByteRange(ds, msgData, (chain[0] as number) * CONST.MSG.SMALL_BLOCK_SIZE, sizeBlock);
        }
        const parts = chain.map((block) =>
            readMiniByteRange(ds, msgData, block * CONST.MSG.SMALL_BLOCK_SIZE, CONST.MSG.SMALL_BLOCK_SIZE)
        );
        return concatUint8Arrays(parts, sizeBlock).slice(0, sizeBlock);
    }

    const chain = getBigChain(ds, msgData, fieldProperty);
    if (chain.length === 0) {
        throw new RangeError(`Stream "${fieldProperty.name}" has no data blocks`);
    }
    return readBigByteRange(ds, msgData, chain, sizeBlock);
}

function decodeFieldValue(bytes: Uint8Array, type: string): string | Uint8Array | number | boolean | Date | null {
    const kind = CONST.MSG.FIELD.TYPE_MAPPING[type];
    switch (kind) {
        case 'string':
            return stripTrailingNul(new TextDecoder('windows-1252').decode(bytes));
        case 'unicode':
            return stripTrailingNul(new TextDecoder('utf-16le').decode(bytes));
        case 'binary':
            return bytes;
        case 'int':
            if (bytes.length < 4) return null;
            return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true);
        case 'bool':
            if (bytes.length < 2) return null;
            return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, true) !== 0;
        case 'time':
            if (bytes.length < 8) return null;
            return fileTimeToDate(bytes);
        default:
            return null;
    }
}

function getFieldValue(
    ds: DataStream,
    msgData: MsgData,
    fieldProperty: Property,
    type: string
): string | Uint8Array | number | boolean | Date | null {
    const bytes = getFieldBytes(ds, msgData, fieldProperty);
    if (bytes === null) return null;
    // Embedded-message streams (000D) have no scalar decoding; expose raw bytes.
    if (type === CONST.MSG.FIELD.DIR_TYPE.INNER_MSG) return bytes;
    return decodeFieldValue(bytes, type);
}

/** Lenient variant used while building message fields: corrupt streams decode as null. */
function safeGetFieldValue(
    ds: DataStream,
    msgData: MsgData,
    fieldProperty: Property,
    type: string
): string | Uint8Array | number | boolean | Date | null {
    try {
        return getFieldValue(ds, msgData, fieldProperty, type);
    } catch (err) {
        if (err instanceof RangeError) return null;
        throw err;
    }
}

export default class MsgReader {
    private ds: DataStream;
    private fileData: MsgData | null = null;

    constructor(input: MsgBuffer) {
        this.ds = new DataStream(input, 0, DataStream.LITTLE_ENDIAN);
        if (this.ds.byteLength < 8) {
            throw new InvalidMsgFileError('Input is too small to be an Outlook .msg file.');
        }
    }

    /** Non-throwing check: true when `input` starts with the OLE compound-document magic. */
    static isMsgFile(input: MsgBuffer): boolean {
        try {
            const ds = new DataStream(input, 0, DataStream.LITTLE_ENDIAN);
            if (ds.byteLength < 8) return false;
            return isMSGFile(ds);
        } catch {
            return false;
        }
    }

    private ensureParsed(): MsgData {
        if (!isMSGFile(this.ds)) {
            throw new InvalidMsgFileError();
        }
        if (this.fileData == null) {
            this.fileData = parseMsgData(this.ds);
        }
        return this.fileData;
    }

    /**
     * Returns message metadata, recipients and attachment descriptors.
     * Attachment *contents* are not loaded; use getAttachment() for those.
     * The returned object is a shallow copy — mutating it does not affect
     * the reader — but binary payloads (compressedRtf, bodyHtml) are shared
     * views and should be treated as read-only.
     */
    getFileData(): MessageData {
        const parsed = this.ensureParsed();
        const fields = parsed.fieldsData as MessageData;
        return {
            ...fields,
            attachments: fields.attachments.map((attachment) => ({ ...attachment })),
            recipients: fields.recipients.map((recipient) => ({ ...recipient })),
            extraProperties: { ...fields.extraProperties },
        };
    }

    /** Returns the parsed OLE directory entries (for advanced use). */
    getProperties(): (Property | null)[] {
        return (this.ensureParsed().propertyData ?? []).slice();
    }

    /**
     * Reads an attachment's content.
     * @param attachment attachment index, or an attachment descriptor from getFileData().
     */
    getAttachment(attachment: number | Attachment): AttachmentContent {
        if (typeof attachment === 'number') {
            return this.getAttachmentByIndex(attachment);
        }
        return this.getAttachmentData(attachment);
    }

    /** Reads an attachment's content by its index in `getFileData().attachments`. */
    getAttachmentByIndex(index: number): AttachmentContent {
        const attachments = this.ensureParsed().fieldsData?.attachments ?? [];
        const attachment = attachments[index];
        if (!attachment) {
            throw new RangeError(`Attachment index ${index} is out of range (found ${attachments.length} attachment(s)).`);
        }
        return this.getAttachmentData(attachment);
    }

    /** Reads an attachment's content from its descriptor. */
    getAttachmentData(attachment: Attachment): AttachmentContent {
        if (!attachment || typeof attachment.dataId !== 'number') {
            throw new TypeError('Invalid attachment descriptor: missing dataId.');
        }
        const parsed = this.ensureParsed();
        const propertyDataRef = parsed.propertyData ?? [];
        const fieldProperty =
            Number.isInteger(attachment.dataId) && attachment.dataId >= 0 && attachment.dataId < propertyDataRef.length
                ? propertyDataRef[attachment.dataId] ?? null
                : null;
        if (!fieldProperty || fieldProperty.type !== PropertyType.Document) {
            throw new Error(`Attachment "${attachment.fileName ?? '?'}" points at a missing data stream.`);
        }
        const content = getFieldBytes(this.ds, parsed, fieldProperty) ?? new Uint8Array(0);

        return {
            fileName: attachment.fileName,
            fileNameShort: attachment.fileNameShort,
            extension: attachment.extension,
            mimeType: attachment.mimeType,
            pidContentId: attachment.pidContentId,
            contentLength: content.length,
            content,
        };
    }

    /**
     * Decompresses the PidTagRtfCompressed body to an RTF string.
     * Returns null when the message has no compressed RTF body.
     */
    getRtfBody(): string | null {
        const compressedRtf = this.ensureParsed().fieldsData?.compressedRtf;
        if (!compressedRtf || compressedRtf.length === 0) return null;
        return decompressRtfToString(compressedRtf);
    }
}
