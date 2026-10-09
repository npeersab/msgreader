import MsgReader from './msg-reader.js';
import { InvalidMsgFileError, MAX_DOCUMENT_SIZE, PropertyType } from './msg-reader.js';
import { decompressRtf, decompressRtfToString } from './rtf.js';
import { codepageToEncoding } from './utils.js';

export { MsgReader, InvalidMsgFileError, MAX_DOCUMENT_SIZE, PropertyType, decompressRtf, decompressRtfToString, codepageToEncoding };
export type {
    Attachment,
    AttachmentContent,
    ByteSource,
    FieldsData,
    MessageData,
    MessageTextFields,
    MsgBuffer,
    MsgData,
    Property,
    Recipient,
} from './msg-reader.js';
export type { CompressedRtfHeader, DecompressRtfOptions } from './rtf.js';

export default MsgReader;
