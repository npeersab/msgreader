import MsgReader from './msg-reader';
import { InvalidMsgFileError, MAX_DOCUMENT_SIZE, PropertyType } from './msg-reader';
import { decompressRtf, decompressRtfToString } from './rtf';
import { codepageToEncoding } from './utils';

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
} from './msg-reader';
export type { CompressedRtfHeader, DecompressRtfOptions } from './rtf';

export default MsgReader;
