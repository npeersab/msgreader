import { uInt2int } from './utils.js';

/**
 * Maps a 4-hex-digit property class (e.g. `0037`) to a friendly field name.
 * Keep in sync with the `SomeOxProps`-style interfaces in `msg-reader.ts`.
 */
const NAME_MAPPING: Record<string, string> = {
    // message specific
    '001a': 'messageClass',
    '0037': 'subject',
    '003d': 'subjectPrefix',
    '007d': 'headers',
    '0c1a': 'senderName',
    '0c1e': 'senderSmtpAddress',
    '0c1f': 'senderEmail',
    '0e02': 'displayBcc',
    '0e03': 'displayCc',
    '0e04': 'displayTo',
    '0e1d': 'normalizedSubject',
    '1000': 'body',
    '1009': 'compressedRtf',
    '1013': 'bodyHtml',
    '1035': 'internetMessageId',
    '3ffd': 'messageCodepage',
    // attachment specific
    '3703': 'extension',
    '3704': 'fileNameShort',
    '3705': 'attachMethod',
    '3707': 'fileName',
    '370e': 'mimeType',
    '3712': 'pidContentId',
    '3716': 'attachContentLocation',
    // recipient specific
    '3001': 'name',
    '3002': 'addressType',
    '3003': 'email',
    '300b': 'searchKey',
    '39fe': 'smtpAddress',
};

const CONST = {
    FILE_HEADER: uInt2int([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    MSG: {
        UNUSED_BLOCK: -1,
        END_OF_CHAIN: -2,

        S_BIG_BLOCK_SIZE: 0x0200,
        S_BIG_BLOCK_MARK: 9,

        L_BIG_BLOCK_SIZE: 0x1000,
        L_BIG_BLOCK_MARK: 12,

        SMALL_BLOCK_SIZE: 0x0040,
        BIG_BLOCK_MIN_DOC_SIZE: 0x1000,
        HEADER: {
            PROPERTY_START_OFFSET: 0x30,

            BAT_START_OFFSET: 0x4c,
            BAT_COUNT_OFFSET: 0x2c,

            SBAT_START_OFFSET: 0x3c,
            SBAT_COUNT_OFFSET: 0x40,

            XBAT_START_OFFSET: 0x44,
            XBAT_COUNT_OFFSET: 0x48,
        },
        PROP: {
            NO_INDEX: -1,
            PROPERTY_SIZE: 0x0080,

            NAME_SIZE_OFFSET: 0x40,
            MAX_NAME_LENGTH: /*NAME_SIZE_OFFSET*/ 0x40 / 2 - 1,
            TYPE_OFFSET: 0x42,
            PREVIOUS_PROPERTY_OFFSET: 0x44,
            NEXT_PROPERTY_OFFSET: 0x48,
            CHILD_PROPERTY_OFFSET: 0x4c,
            START_BLOCK_OFFSET: 0x74,
            SIZE_OFFSET: 0x78,
            TYPE_ENUM: {
                DIRECTORY: 1,
                DOCUMENT: 2,
                ROOT: 5,
            },
        },
        FIELD: {
            PREFIX: {
                ATTACHMENT: '__attach_version1.0',
                RECIPIENT: '__recip_version1.0',
                DOCUMENT: '__substg1.',
                NAMEID: '__nameid_version1.0',
            },
            NAME_MAPPING,
            CLASS_MAPPING: {
                ATTACHMENT_DATA: '3701',
            },
            TYPE_MAPPING: {
                '001e': 'string',
                '001f': 'unicode',
                '0102': 'binary',
                '0003': 'int',
                '000b': 'bool',
                '0040': 'time',
            } as Record<string, string>,
            DIR_TYPE: {
                INNER_MSG: '000d',
            },
        },
    },
};

export default CONST;
